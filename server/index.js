// Temps d'Abondance : petit serveur (Railway) entre l'app et la base Postgres.
//  POST /api/events        ← l'app envoie les actions des clients (écriture seule)
//  GET  /admin             → panneau admin (admin.html)
//  POST /api/admin/login   → mot de passe admin (variable ADMIN_PASSWORD) → jeton de 12 h
//  GET  /api/admin/...     → lecture des données (jeton obligatoire)
// Variables Railway : DATABASE_URL (référence au service Postgres), ADMIN_PASSWORD (choisi par Lucas). ADMIN_SECRET facultatif.
const http = require('http'), crypto = require('crypto'), fs = require('fs'), path = require('path');
const { Pool } = require('pg');
let geoip = null; try { geoip = require('geoip-lite'); } catch (e) { console.warn('geoip-lite indisponible : pays non renseigné'); }

const PORT = process.env.PORT || 8080;
const PASS = process.env.ADMIN_PASSWORD || '';
// clé de signature des jetons : ADMIN_SECRET si défini, sinon dérivée du mot de passe de la base (secret, jamais affiché)
const SECRET = process.env.ADMIN_SECRET || (process.env.DATABASE_URL ? crypto.createHash('sha256').update('ta-admin:' + process.env.DATABASE_URL).digest('hex') : '');
if (!process.env.DATABASE_URL) console.error('⚠️ DATABASE_URL manquante : ajoutez la variable (référence au Postgres).');
if (PASS.length < 8) console.error('⚠️ ADMIN_PASSWORD (8+ caractères) manquant : le panneau admin reste fermé.');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5,
  ssl: process.env.PGSSL === '1' ? { rejectUnauthorized: false } : undefined });
const ADMIN_HTML = path.join(__dirname, '..', 'admin.html');

// ---------- utilitaires ----------
const str = (v, n) => (v == null ? null : String(v).slice(0, n));
const sha = s => crypto.createHash('sha256').update(String(s)).digest();
const sign = s => crypto.createHmac('sha256', SECRET).update(s).digest('hex');
function clientIp(req) {
  const chain = String(req.headers['x-forwarded-for'] || '');
  const parts = chain.split(',').map(s => s.trim()).filter(Boolean);
  // Railway ajoute l'IP réelle en dernier ; X-Real-IP si présent
  const ip = String(req.headers['x-real-ip'] || parts[parts.length - 1] || req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  return { ip: ip.slice(0, 64) || null, chain: chain.slice(0, 300) || null };
}
function country(ip) { try { const g = geoip && ip && geoip.lookup(ip); return g ? g.country : null; } catch (e) { return null; } }
function send(res, code, body, headers = {}) {
  const json = typeof body !== 'string';
  res.writeHead(code, { 'Content-Type': json ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(json ? JSON.stringify(body) : body);
}
function readBody(req, max = 64 * 1024) {
  return new Promise((ok, ko) => { let size = 0, chunks = [];
    req.on('data', c => { size += c.length; if (size > max) { ko(new Error('trop gros')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8'))); req.on('error', ko); });
}
// limite simple par IP
const buckets = new Map();
function limited(key, max, ms) { const now = Date.now(), b = buckets.get(key) || { n: 0, t: now };
  if (now - b.t > ms) { b.n = 0; b.t = now; } b.n++; buckets.set(key, b); return b.n > max; }
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now - b.t > 3600e3) buckets.delete(k); }, 600e3).unref();

// ---------- jetons admin ----------
function makeToken() { const exp = String(Date.now() + 12 * 3600e3); return exp + '.' + sign(exp); }
function okToken(req) {
  const t = String(req.headers.authorization || '').replace(/^Bearer /, ''); const [exp, sig] = t.split('.');
  if (!exp || !sig || !SECRET || +exp < Date.now()) return false;
  const a = Buffer.from(sig), b = Buffer.from(sign(exp)); return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- routes ----------
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const TYPE_RE = /^[a-z_]{2,40}$/;

async function postEvents(req, res) {
  const { ip, chain } = clientIp(req);
  if (limited('ev:' + ip, 240, 60e3)) return send(res, 429, { error: 'trop de requêtes' }, CORS);
  let arr; try { arr = JSON.parse(await readBody(req)); } catch (e) { return send(res, 400, { error: 'JSON invalide' }, CORS); }
  if (!Array.isArray(arr)) arr = [arr];
  arr = arr.slice(0, 50).filter(e => e && typeof e === 'object' && TYPE_RE.test(e.type));
  if (!arr.length) return send(res, 204, '', CORS);
  const cc = country(ip), cols = ['client_ts', 'email', 'name', 'device', 'session', 'type', 'detail', 'page', 'ua', 'lang', 'tz', 'screen', 'ip', 'ip_chain', 'country'];
  const vals = [], rows = arr.map((e, i) => {
    let ts = new Date(e.client_ts); ts = isNaN(ts) ? null : ts.toISOString();
    let detail = e.detail && typeof e.detail === 'object' ? e.detail : {}; if (JSON.stringify(detail).length > 4000) detail = { trop_long: true };
    vals.push(ts, str(e.email, 200) && str(e.email, 200).toLowerCase().trim(), str(e.name, 200), str(e.device, 64), str(e.session, 64), e.type,
      JSON.stringify(detail), str(e.page, 40), str(e.ua, 400), str(e.lang, 20), str(e.tz, 60), str(e.screen, 20), ip, chain, cc);
    return '(' + cols.map((_, j) => '$' + (i * cols.length + j + 1)).join(',') + ')';
  });
  try { await pool.query(`insert into events (${cols.join(',')}) values ${rows.join(',')}`, vals); send(res, 204, '', CORS); }
  catch (e) { console.error('insert', e.message); send(res, 500, { error: 'base' }, CORS); }
}

async function adminLogin(req, res) {
  const { ip } = clientIp(req);
  if (limited('login:' + ip, 8, 15 * 60e3)) return send(res, 429, { error: 'Muitas tentativas. Espere 15 minutos.' });
  let b = {}; try { b = JSON.parse(await readBody(req, 4096)); } catch (e) {}
  if (PASS.length < 8 || !SECRET) return send(res, 503, { error: 'Falta a variável ADMIN_PASSWORD (8+ caracteres) no serviço app do Railway.' });
  if (!crypto.timingSafeEqual(sha(b.password || ''), sha(PASS))) return send(res, 401, { error: 'Senha incorreta.' });
  send(res, 200, { token: makeToken() });
}

async function adminGet(req, res, url) {
  if (!okToken(req)) return send(res, 401, { error: 'Sessão expirada' });
  const q = url.searchParams, lim = Math.min(+q.get('limit') || 200, 1000);
  try {
    if (url.pathname === '/api/admin/clients') {
      const r = await pool.query('select * from clients order by last_seen desc limit 10000'); return send(res, 200, r.rows);
    }
    if (url.pathname === '/api/admin/recent') {
      const t = q.get('type'); const r = t
        ? await pool.query('select * from events where type = $1 order by created_at desc limit $2', [t, lim])
        : await pool.query('select * from events order by created_at desc limit $1', [lim]);
      return send(res, 200, r.rows);
    }
    if (url.pathname === '/api/admin/client') {
      const email = String(q.get('email') || '').toLowerCase();
      const d = await pool.query('select distinct device from events where email = $1 and device is not null', [email]);
      const devs = d.rows.map(x => x.device);
      // tout ce que ce client a fait, y compris avant de se connecter sur ses appareils
      const r = await pool.query('select * from events where email = $1 or (device = any($2) and (email is null or email = $1)) order by created_at asc, id asc limit 20000', [email, devs]);
      return send(res, 200, { email, devices: devs, events: r.rows });
    }
    send(res, 404, { error: 'introuvable' });
  } catch (e) { console.error('admin', e.message); send(res, 500, { error: 'base : ' + e.message }); }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'OPTIONS') return send(res, 204, '', { ...CORS, 'Access-Control-Max-Age': '86400' });
    if (url.pathname === '/api/events' && req.method === 'POST') return await postEvents(req, res);
    if (url.pathname === '/api/admin/login' && req.method === 'POST') return await adminLogin(req, res);
    if (url.pathname.startsWith('/api/admin/') && req.method === 'GET') return await adminGet(req, res, url);
    if (url.pathname === '/health') { try { await pool.query('select 1'); return send(res, 200, 'ok'); } catch (e) { return send(res, 503, 'base indisponible'); } }
    if (url.pathname === '/admin' || url.pathname === '/admin/' || url.pathname === '/admin.html') {
      return send(res, 200, fs.readFileSync(ADMIN_HTML, 'utf8'), { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' });
    }
    if (url.pathname === '/') { res.writeHead(302, { Location: '/admin' }); return res.end(); }
    send(res, 404, 'introuvable');
  } catch (e) { console.error(e); send(res, 500, { error: 'erreur' }); }
});

(async () => {
  for (let i = 1; i <= 10; i++) {
    try { await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8')); console.log('Base prête.'); break; }
    catch (e) { console.error(`Base pas encore prête (essai ${i}) :`, e.message); await new Promise(r => setTimeout(r, 3000)); }
  }
  server.listen(PORT, () => console.log('Serveur sur le port ' + PORT));
})();
