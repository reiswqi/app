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
// ---------- l'app elle-même (domaine app-parcoursdefoi.online) : seulement la page, img/ et video/ ----------
const ROOT = path.join(__dirname, '..');
const APP_HTML = path.join(ROOT, 'temps-abondance.html');
const MIME = { '.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.ico': 'image/x-icon' };
function serveFile(req, res, file, cache) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'introuvable');
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const h = { 'Content-Type': type, 'Cache-Control': cache, 'Accept-Ranges': 'bytes', 'Last-Modified': st.mtime.toUTCString() };
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (m && (m[1] || m[2])) {   // vidéos : lecture par morceaux (avancer / reculer)
      let start = m[1] ? +m[1] : st.size - +m[2], end = m[1] && m[2] ? +m[2] : st.size - 1;
      if (start >= st.size || start > end) { res.writeHead(416, { 'Content-Range': 'bytes */' + st.size }); return res.end(); }
      end = Math.min(end, st.size - 1);
      res.writeHead(206, { ...h, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...h, 'Content-Length': st.size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}
function serveStatic(req, res, url) {
  let p; try { p = decodeURIComponent(url.pathname); } catch (e) { return false; }
  if (p === '/' || p === '/index.html' || p === '/temps-abondance.html') { serveFile(req, res, APP_HTML, 'no-cache'); return true; }
  if (!/^\/(img|video)\/[\w.-]+$/.test(p)) return false;      // rien d'autre du dépôt n'est servi
  serveFile(req, res, path.join(ROOT, p), 'public, max-age=86400'); return true;
}

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

// ---------- ventes KashPay ----------
// Variables Railway : KASHPAY_WEBHOOK_SECRET (clé de signature copiée dans KashPay → Intégrations → Webhooks)
//                     ACCESS_MODE = open (défaut : tout le monde peut créer un compte) | buyers (seulement les acheteurs)
const KP_SECRET = process.env.KASHPAY_WEBHOOK_SECRET || '';
const ACCESS_MODE = process.env.ACCESS_MODE === 'buyers' ? 'buyers' : 'open';
const PAID_EV = new Set(['order.paid', 'subscription.created', 'subscription.renewed', 'manual.grant']);
let lastWebhook = null;
function readRaw(req, max = 256 * 1024) {
  return new Promise((ok, ko) => { let size = 0, chunks = [];
    req.on('data', c => { size += c.length; if (size > max) { ko(new Error('trop gros')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => ok(Buffer.concat(chunks))); req.on('error', ko); });
}
const tsOrNull = v => { const d = new Date(v); return v && !isNaN(d) ? d.toISOString() : null; };
async function savePurchase(ev, ip) {
  const d = ev.data || {}, c = d.customer || {}, pd = d.payment_details || {};
  const r = await pool.query(`insert into purchases (event, kp_id, status, email, name, phone, amount, net_amount, currency, offers, payment_id, card_holder,
      paid_at, refunded_at, chargeback_at, event_at, tracking, raw, ip)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) on conflict (event, kp_id) do nothing returning id`,
    [str(ev.event, 60), str(d.id, 100), str(d.status, 40), c.email ? String(c.email).trim().toLowerCase().slice(0, 200) : null, str(c.name, 200), str(c.phone, 40),
     Number.isFinite(+d.amount) ? Math.round(+d.amount) : null, Number.isFinite(+d.net_amount) ? Math.round(+d.net_amount) : null, str(d.currency, 10),
     JSON.stringify(Array.isArray(d.offers) ? d.offers : []), str(pd.id, 100), str(pd.card_holder_name, 200),
     tsOrNull(d.paid_at), tsOrNull(d.refunded_at), tsOrNull(d.chargeback_at), tsOrNull(ev.created_at), JSON.stringify(d.tracking || {}), JSON.stringify(ev), ip]);
  return r.rowCount > 0;
}
async function kashpayWebhook(req, res) {
  const { ip } = clientIp(req);
  if (!KP_SECRET) { console.error('Webhook KashPay reçu mais KASHPAY_WEBHOOK_SECRET manque'); return send(res, 503, { error: 'secret manquant' }); }
  let raw; try { raw = await readRaw(req); } catch (e) { return send(res, 413, { error: 'trop gros' }); }
  const sig = String(req.headers['x-kashpay-signature'] || ''), exp = 'sha256=' + crypto.createHmac('sha256', KP_SECRET).update(raw).digest('hex');
  const a = Buffer.from(sig), b = Buffer.from(exp);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) { console.warn('Webhook KashPay : signature invalide depuis', ip); return send(res, 401, { error: 'signature invalide' }); }
  let ev; try { ev = JSON.parse(raw.toString('utf8')); } catch (e) { return send(res, 400, { error: 'JSON invalide' }); }
  try { const fresh = await savePurchase(ev, ip); lastWebhook = { at: new Date().toISOString(), event: ev.event, fresh };
    console.log('Webhook KashPay', ev.event, (ev.data || {}).id, fresh ? 'enregistré' : 'déjà reçu'); }
  catch (e) { console.error('purchase', e.message); return send(res, 500, { error: 'base' }); }   // KashPay renverra
  send(res, 200, { received: true });
}
// accès d'un e-mail : payé (au moins une commande payée non remboursée), bloqué (tout remboursé / contesté)
async function accessOf(email) {
  const r = await pool.query('select event, kp_id from purchases where email = $1 order by received_at, id', [email]);
  const orders = new Map();
  for (const p of r.rows) {
    const st = PAID_EV.has(p.event) ? 'paid' : p.event === 'order.refunded' ? 'refunded' : p.event === 'order.chargeback' ? 'chargeback' : null;
    if (st) orders.set(p.kp_id, st);
  }
  const v = [...orders.values()], paid = v.includes('paid');
  return { paid, blocked: !paid && (v.includes('refunded') || v.includes('chargeback')), reason: v.includes('chargeback') ? 'chargeback' : v.includes('refunded') ? 'refunded' : null };
}
// ---------- e-mail d'accès aux acheteurs (Brevo) ----------
const MAIL = require('./mail');
// acheteurs avec accès, sans compte, qui n'ont pas encore reçu l'e-mail (les achats de test KashPay sont ignorés)
async function mailPending() {
  const r = await pool.query(`select p.email, (array_agg(p.name order by p.received_at desc) filter (where p.name is not null))[1] as name
    from purchases p
    where p.email is not null and p.event in ('order.paid','subscription.created','subscription.renewed','manual.grant')
      and p.email !~ '@example\\.(com|org|net)$' and coalesce(p.kp_id,'') not like 'test\\_%'
      and not exists (select 1 from users u where u.email = p.email)
      and not exists (select 1 from email_log l where l.email = p.email and l.kind in ('acces','funnel1') and l.status = 'sent')
    group by p.email order by min(p.received_at)`);
  const out = []; for (const x of r.rows) if (!(await accessOf(x.email)).blocked) out.push(x); return out;
}
async function sentToday() { const r = await pool.query("select count(*)::int n from email_log where status = 'sent' and sent_at > now() - interval '24 hours'"); return r.rows[0].n; }
async function mailOne(email, name, kind) {
  try { const id = await MAIL.brevoSend(email, name, MAIL.accessEmail(email, name), kind);
    await pool.query('insert into email_log (email, kind, status, message_id) values ($1,$2,$3,$4)', [email, kind, 'sent', id]); return true; }
  catch (e) { await pool.query('insert into email_log (email, kind, status, error) values ($1,$2,$3,$4)', [email, kind, 'failed', e.message]); return e.message; }
}
let mailBusy = false;
// ---------- funnel de relance (acheteurs jamais entrés) ----------
const FUN = require('./funnel');
async function getSetting(k, d) { const r = await pool.query('select value from settings where key = $1', [k]); return r.rows[0] ? r.rows[0].value : d; }
async function setSetting(k, v) { await pool.query('insert into settings (key, value) values ($1,$2) on conflict (key) do update set value = $2, updated_at = now()', [k, v]); }
// acheteurs (KashPay ou libérés) qui ne sont jamais entrés : pas de compte, aucun événement avec leur e-mail
async function funnelLeads() {
  const r = await pool.query(`select p.email, (array_agg(p.name order by p.received_at desc) filter (where p.name is not null))[1] as name, min(p.received_at) as since,
      (select count(*)::int from email_log l where l.email = p.email and l.kind like 'funnel%' and l.status = 'sent') as sent,
      (select max(sent_at) from email_log l where l.email = p.email and l.kind like 'funnel%' and l.status = 'sent') as last_at,
      exists(select 1 from email_log l where l.email = p.email and l.kind = 'acces' and l.status = 'sent') as got_access
    from purchases p
    where p.email is not null and p.event in ('order.paid','subscription.created','subscription.renewed','manual.grant')
      and p.email !~ '@example\\.(com|org|net)$' and coalesce(p.kp_id,'') not like 'test\\_%'
      and not exists (select 1 from users u where u.email = p.email)
      and not exists (select 1 from events e where e.email = p.email)
    group by p.email order by min(p.received_at)`);
  const out = []; for (const x of r.rows) if (!(await accessOf(x.email)).blocked) out.push(x); return out;
}
let funnelBusy = false, funnelLast = null;
async function funnelTick() {
  if (funnelBusy) return; funnelBusy = true;
  try {
    const c = MAIL.cfg(); if (!c.key || !c.sender || (await getSetting('funnel', 'off')) !== 'on') return;
    const slot = FUN.currentSlot(); if (!slot) return;
    let room = Math.max(0, c.limit - await sentToday()), sent = 0;
    for (const L of await funnelLeads()) {
      if (!room) break;
      if (Date.now() - new Date(L.since) < 20 * 60e3) continue;                 // laisser 20 min après l'achat
      const done = await pool.query("select kind from email_log where email = $1 and kind like 'funnel%' and status = 'sent'", [L.email]);
      const kinds = new Set(done.rows.map(x => x.kind));
      if ((await pool.query("select 1 from email_log where email = $1 and slot = $2", [L.email, slot.key])).rowCount) continue; // déjà un e-mail dans ce créneau
      let n = 0; while (n < FUN.STEPS.length && (kinds.has('funnel' + (n + 1)) || (n === 0 && L.got_access))) n++;
      if (n >= FUN.STEPS.length) continue;
      try { const id = await MAIL.brevoSend(L.email, L.name, FUN.funnelEmail(n, L.email, L.name, MAIL.APP_URL, MAIL.firstName), 'funnel');
        await pool.query('insert into email_log (email, kind, status, message_id, slot) values ($1,$2,$3,$4,$5)', [L.email, 'funnel' + (n + 1), 'sent', id, slot.key]); sent++; room--; }
      catch (e) { await pool.query('insert into email_log (email, kind, status, error, slot) values ($1,$2,$3,$4,$5)', [L.email, 'funnel' + (n + 1), 'failed', e.message, slot.key]); }
    }
    if (sent) { funnelLast = { at: new Date().toISOString(), slot: slot.key, sent }; console.log('Funnel', slot.key, sent, 'e-mail(s)'); }
  } catch (e) { console.error('funnel', e.message); } finally { funnelBusy = false; }
}
// MAIL_OUTBOX (variable Railway, JSON [{id,to,name,subject,text}]) : réponses ponctuelles aux clients, envoyées une seule fois (email_log kind = avulso:id)
async function outboxTick() {
  let list; try { list = JSON.parse(process.env.MAIL_OUTBOX || '[]'); } catch (e) { return console.log('MAIL_OUTBOX illisible'); }
  if (!Array.isArray(list) || !MAIL.cfg().key || !MAIL.cfg().sender) return;
  for (const m of list) {
    if (!m || !m.id || !m.to || !m.subject || !m.text) continue;
    const kind = 'avulso:' + String(m.id).slice(0, 60), to = String(m.to).trim().toLowerCase();
    const { rows } = await pool.query("select 1 from email_log where email=$1 and kind=$2 and status='sent' limit 1", [to, kind]);
    if (rows.length) continue;
    try { const id = await MAIL.brevoSend(to, m.name, MAIL.customEmail(m.subject, m.text), 'avulso');
      await pool.query('insert into email_log (email, kind, status, message_id) values ($1,$2,$3,$4)', [to, kind, 'sent', id]); console.log('E-mail avulso envoyé', kind); }
    catch (e) { await pool.query('insert into email_log (email, kind, status, error) values ($1,$2,$3,$4)', [to, kind, 'failed', e.message]); console.log('E-mail avulso échec', kind, e.message); }
  }
}
setTimeout(() => outboxTick().catch(e => console.log('outbox', e.message)), 20e3).unref();
setInterval(() => outboxTick().catch(e => console.log('outbox', e.message)), 10 * 60e3).unref();
setInterval(funnelTick, process.env.FUNNEL_FAKE_NOW ? 1500 : 5 * 60e3).unref(); setTimeout(funnelTick, 30e3).unref();
async function adminFunnel(req, res, url) {
  if (!okToken(req)) return send(res, 401, { error: 'Sessão expirada' });
  if (req.method === 'GET' && url.pathname === '/api/admin/funnel') {
    const leads = await funnelLeads();
    const totals = await pool.query("select kind, count(*)::int n from email_log where kind like 'funnel%' and status = 'sent' group by kind");
    const conv = await pool.query(`select count(distinct l.email)::int n from email_log l where l.kind like 'funnel%' and l.status = 'sent'
      and (exists (select 1 from users u where u.email = l.email) or exists (select 1 from events e where e.email = l.email))`);
    return send(res, 200, { on: (await getSetting('funnel', 'off')) === 'on', slots: FUN.SLOTS, last: funnelLast,
      steps: FUN.STEPS.map((x, i) => ({ n: i + 1, day: Math.floor(i / 3) + 1, at: FUN.SLOTS[i % 3], subject: x.s.replace('{p}', '').replace(/^./, c => c.toUpperCase()), go: x.go,
        sent: (totals.rows.find(t => t.kind === 'funnel' + (i + 1)) || {}).n || 0 })),
      leads: leads.map(x => ({ email: x.email, name: x.name, since: x.since, sent: x.sent + (x.got_access && !x.sent ? 0 : 0), last_at: x.last_at, got_access: x.got_access })),
      converted: conv.rows[0].n });
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/funnel/preview') {
    const n = Math.max(1, Math.min(FUN.STEPS.length, +url.searchParams.get('n') || 1)) - 1, m = FUN.funnelEmail(n, 'marie.dupont@gmail.com', 'Marie Dupont', MAIL.APP_URL, MAIL.firstName);
    return send(res, 200, { subject: m.subject, html: m.html });
  }
  let b = {}; try { b = JSON.parse(await readBody(req, 4096)); } catch (e) {}
  if (req.method === 'POST' && url.pathname === '/api/admin/funnel/toggle') { await setSetting('funnel', b.on ? 'on' : 'off'); if (b.on) setTimeout(funnelTick, 1000); return send(res, 200, { on: !!b.on }); }
  if (req.method === 'POST' && url.pathname === '/api/admin/funnel/test') {
    const c = MAIL.cfg(); if (!c.key || !c.sender) return send(res, 503, { error: 'Brevo não configurado.' });
    const to = String(b.email || '').trim().toLowerCase(), n = Math.max(1, Math.min(FUN.STEPS.length, +b.n || 1)) - 1;
    if (!EMAIL_RE.test(to)) return send(res, 400, { error: 'E-mail inválido.' });
    try { await MAIL.brevoSend(to, 'Lucas', FUN.funnelEmail(n, to, 'Lucas', MAIL.APP_URL, MAIL.firstName), 'test');
      await pool.query('insert into email_log (email, kind, status) values ($1,$2,$3)', [to, 'test', 'sent']); return send(res, 200, { ok: true }); }
    catch (e) { return send(res, 502, { error: 'Brevo recusou: ' + e.message }); }
  }
  send(res, 404, { error: 'introuvable' });
}
async function adminMail(req, res, url) {
  if (!okToken(req)) return send(res, 401, { error: 'Sessão expirada' });
  const c = MAIL.cfg(), ready = !!(c.key && c.sender);
  if (url.pathname === '/api/admin/mail/status' && req.method === 'GET') {
    const pend = await mailPending(), today = await sentToday();
    const t = await pool.query("select count(*) filter (where status='sent' and kind='acces')::int sent, count(*) filter (where status='failed')::int failed from email_log");
    const lastErr = await pool.query("select email, error, sent_at from email_log where status='failed' order by id desc limit 3");
    return send(res, 200, { ready, sender: c.sender, senderName: c.senderName, limit: c.limit, sentToday: today, remainingToday: Math.max(0, c.limit - today),
      pending: pend.length, sent: t.rows[0].sent, failed: t.rows[0].failed, lastErrors: lastErr.rows, busy: mailBusy });
  }
  if (url.pathname === '/api/admin/mail/preview' && req.method === 'GET') {
    const m = MAIL.accessEmail(url.searchParams.get('email') || 'marie.dupont@gmail.com', url.searchParams.get('name') || 'Marie Dupont');
    return send(res, 200, { subject: m.subject, html: m.html });
  }
  if (!ready) return send(res, 503, { error: 'Falta configurar BREVO_API_KEY e BREVO_SENDER no Railway.' });
  let b = {}; try { b = JSON.parse(await readBody(req, 4096)); } catch (e) {}
  if (url.pathname === '/api/admin/mail/test' && req.method === 'POST') {
    const to = String(b.email || '').trim().toLowerCase(); if (!EMAIL_RE.test(to)) return send(res, 400, { error: 'E-mail inválido.' });
    const ok = await mailOne(to, b.name || 'Lucas', 'test'); return ok === true ? send(res, 200, { ok: true }) : send(res, 502, { error: 'Brevo recusou: ' + ok });
  }
  if (url.pathname === '/api/admin/mail/send' && req.method === 'POST') {
    if (mailBusy) return send(res, 409, { error: 'Um envio já está em andamento.' });
    const room = Math.max(0, c.limit - await sentToday()), want = Math.min(room, Math.max(1, +b.max || room));
    if (!want) return send(res, 429, { error: 'Limite de hoje atingido. Continue amanhã.' });
    const list = (await mailPending()).slice(0, want); mailBusy = true; let sent = 0, failed = 0; const errors = [];
    try { for (let i = 0; i < list.length; i += 5) {          // 5 à la fois
        const rs = await Promise.all(list.slice(i, i + 5).map(x => mailOne(x.email, x.name, 'acces')));
        rs.forEach((r, k) => { if (r === true) sent++; else { failed++; if (errors.length < 5) errors.push(list[i + k].email + ' : ' + r); } });
        if (failed >= 10 && !sent) break;                    // clé ou expéditeur invalide : on arrête tout de suite
      } } finally { mailBusy = false; }
    return send(res, 200, { sent, failed, errors, left: (await mailPending()).length });
  }
  send(res, 404, { error: 'introuvable' });
}
const BLOCK_MSG = r => r === 'chargeback'
  ? "L'accès à ce compte est suspendu suite à une contestation de paiement. Écrivez-nous pour le rétablir."
  : "L'accès à ce compte a été clôturé suite au remboursement de votre achat.";

// ---------- comptes clients (mot de passe) ----------
const EMAIL_RE = /^[^\s@]{1,100}@[^\s@]{1,100}\.[^\s@]{2,30}$/;
const scryptP = (pw, salt) => new Promise((ok, ko) => crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => e ? ko(e) : ok(k)));
async function hashPass(pw) { const salt = crypto.randomBytes(16); const k = await scryptP(pw, salt); return 'scrypt$' + salt.toString('hex') + '$' + k.toString('hex'); }
async function checkPass(pw, stored) {
  const [alg, salt, hex] = String(stored).split('$'); if (alg !== 'scrypt') return false;
  const k = await scryptP(pw, Buffer.from(salt, 'hex')), h = Buffer.from(hex, 'hex'); return k.length === h.length && crypto.timingSafeEqual(k, h);
}
// jeton client : « uid.date.signature » (sans fin : le client reste connecté sur son appareil)
const userTok = uid => { const p = uid + '.' + Date.now(); return p + '.' + sign('u:' + p); };
function tokUid(t) {
  const [uid, iat, sig] = String(t || '').split('.'); if (!uid || !iat || !sig || !SECRET) return null;
  const a = Buffer.from(sig), b = Buffer.from(sign('u:' + uid + '.' + iat)); return a.length === b.length && crypto.timingSafeEqual(a, b) ? +uid : null;
}
const userCache = new Map();
async function userById(uid) {
  if (userCache.has(uid)) return userCache.get(uid);
  const r = await pool.query('select id, email, name from users where id = $1', [uid]); const u = r.rows[0] || null; if (u) userCache.set(uid, u); return u;
}
async function serverEvent(req, type, email, uid, detail, body = {}) {   // événement écrit par le serveur (connexion, inscription…)
  const { ip, chain } = clientIp(req);
  await pool.query(`insert into events (email, name, device, session, type, detail, ua, ip, ip_chain, country, uid, verified, client_ts)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())`,
    [email, str(body.name, 200), str(body.device, 64), str(body.session, 64), type, JSON.stringify(detail || {}), str(req.headers['user-agent'], 400), ip, chain, country(ip), uid, !!uid]).catch(e => console.error('event', e.message));
}
const pub = u => ({ name: u.name, email: u.email });
async function authRoute(req, res, url) {
  const { ip } = clientIp(req);
  let b = {}; try { b = JSON.parse(await readBody(req, 8192)); } catch (e) { return send(res, 400, { error: 'Requête invalide.' }, CORS); }
  const email = String(b.email || '').trim().toLowerCase().slice(0, 200), pw = String(b.password || '');
  const R = (code, body) => send(res, code, body, CORS);
  if (url.pathname === '/api/auth/check') {
    if (limited('chk:' + ip, 40, 15 * 60e3)) return R(429, { error: 'Trop de tentatives. Réessayez dans quelques minutes.' });
    if (!EMAIL_RE.test(email)) return R(400, { error: 'Adresse e-mail invalide.' });
    const r = await pool.query('select 1 from users where email = $1', [email]); return R(200, { exists: r.rowCount > 0 });
  }
  if (url.pathname === '/api/auth/register') {
    if (limited('reg:' + ip, 10, 3600e3)) return R(429, { error: 'Trop de tentatives. Réessayez dans une heure.' });
    const name = String(b.name || '').trim().slice(0, 120);
    if (!EMAIL_RE.test(email)) return R(400, { error: 'Adresse e-mail invalide.' });
    if (name.length < 2) return R(400, { error: 'Indiquez votre nom.' });
    if (pw.length < 6 || pw.length > 200) return R(400, { error: 'Le mot de passe doit contenir au moins 6 caractères.' });
    const acc = await accessOf(email);
    if (acc.blocked) { await serverEvent(req, 'access_denied', email, null, { raison: acc.reason, etape: 'inscription' }, b); return R(403, { error: BLOCK_MSG(acc.reason), blocked: true }); }
    if (ACCESS_MODE === 'buyers' && !acc.paid) { await serverEvent(req, 'access_denied', email, null, { raison: 'pas_achat', etape: 'inscription' }, b);
      return R(403, { error: "Nous ne trouvons pas d'achat avec cet e-mail. Utilisez l'adresse e-mail de votre achat ou écrivez-nous.", nobuy: true }); }
    const h = await hashPass(pw);
    const r = await pool.query(`insert into users (email, name, pass_hash, created_ip, created_country, created_ua, created_device, last_login_at)
      values ($1,$2,$3,$4,$5,$6,$7, now()) on conflict (email) do nothing returning id, email, name`, [email, name, h, ip, country(ip), str(req.headers['user-agent'], 400), str(b.device, 64)]);
    if (!r.rowCount) return R(409, { error: 'Un compte existe déjà avec cet e-mail. Entrez votre mot de passe.', exists: true });
    const u = r.rows[0]; await serverEvent(req, 'register', email, u.id, { consent: str(b.consent, 40) }, { ...b, name });
    return R(200, { tok: userTok(u.id), ...pub(u) });
  }
  if (url.pathname === '/api/auth/login') {
    if (limited('log:' + ip, 15, 15 * 60e3) || limited('logm:' + email, 10, 15 * 60e3)) return R(429, { error: 'Trop de tentatives. Réessayez dans 15 minutes.' });
    const r = await pool.query('select * from users where email = $1', [email]); const u = r.rows[0];
    if (!u || !(await checkPass(pw, u.pass_hash))) { await serverEvent(req, 'login_fail', email, null, { compte: !!u }, b); return R(401, { error: 'E-mail ou mot de passe incorrect.' }); }
    const acc = await accessOf(email);
    if (acc.blocked) { await serverEvent(req, 'access_denied', email, u.id, { raison: acc.reason, etape: 'connexion' }, b); return R(403, { error: BLOCK_MSG(acc.reason), blocked: true }); }
    await pool.query('update users set last_login_at = now() where id = $1', [u.id]);
    await serverEvent(req, 'login_ok', email, u.id, { temporaire: u.pass_by === 'admin' }, { ...b, name: u.name });
    return R(200, { tok: userTok(u.id), ...pub(u), temp: u.pass_by === 'admin' });
  }
  if (url.pathname === '/api/auth/me') {          // à l'ouverture de l'app : le compte est-il toujours actif ?
    const uid = tokUid(b.tok); if (!uid) return R(401, { error: 'Session expirée.' });
    const u = await userById(uid); if (!u) return R(401, { error: 'Compte introuvable.' });
    const acc = await accessOf(u.email); if (acc.blocked) return R(200, { ok: false, blocked: true, error: BLOCK_MSG(acc.reason) });
    return R(200, { ok: true });
  }
  if (url.pathname === '/api/auth/forgot') {        // envoie un lien de réinitialisation par e-mail (réponse identique que le compte existe ou non)
    if (limited('fg:' + ip, 6, 3600e3) || limited('fgm:' + email, 3, 3600e3)) return R(429, { error: 'Trop de demandes. Réessayez dans une heure.' });
    if (!EMAIL_RE.test(email)) return R(400, { error: 'Adresse e-mail invalide.' });
    const c = MAIL.cfg(); if (!c.key || !c.sender) return R(503, { error: "L'envoi d'e-mails n'est pas disponible. Écrivez-nous." });
    const u = (await pool.query('select id, name from users where email = $1', [email])).rows[0];
    if (u && !(await accessOf(email)).blocked) {
      const token = crypto.randomBytes(24).toString('base64url');
      await pool.query("insert into password_resets (email, token_hash, expires_at, ip) values ($1,$2, now() + interval '1 hour', $3)", [email, sha(token).toString('hex'), ip]);
      try { const id = await MAIL.brevoSend(email, u.name, MAIL.resetEmail(email, u.name, token), 'reset');
        await pool.query('insert into email_log (email, kind, status, message_id) values ($1,$2,$3,$4)', [email, 'reset', 'sent', id]); }
      catch (e) { await pool.query('insert into email_log (email, kind, status, error) values ($1,$2,$3,$4)', [email, 'reset', 'failed', e.message]); return R(502, { error: "L'e-mail n'a pas pu être envoyé. Réessayez ou écrivez-nous." }); }
      await serverEvent(req, 'reset_request', email, u.id, {}, { ...b, name: u.name });
    }
    return R(200, { ok: true });
  }
  if (url.pathname === '/api/auth/reset') {         // le lien de l'e-mail : nouveau mot de passe, puis connexion directe
    if (limited('rs:' + ip, 15, 3600e3)) return R(429, { error: 'Trop de tentatives. Réessayez plus tard.' });
    const token = String(b.token || '');
    if (pw.length < 6 || pw.length > 200) return R(400, { error: 'Le mot de passe doit contenir au moins 6 caractères.' });
    const r = await pool.query('update password_resets set used_at = now() where token_hash = $1 and used_at is null and expires_at > now() returning email', [sha(token).toString('hex')]);
    if (!r.rowCount) return R(400, { error: 'Ce lien a expiré ou a déjà été utilisé. Demandez-en un nouveau.', expired: true });
    const em = r.rows[0].email, u = (await pool.query("update users set pass_hash = $1, pass_by = 'client', pass_changed_at = now(), last_login_at = now() where email = $2 returning id, email, name", [await hashPass(pw), em])).rows[0];
    if (!u) return R(400, { error: 'Compte introuvable.' });
    if ((await accessOf(em)).blocked) return R(403, { error: BLOCK_MSG((await accessOf(em)).reason), blocked: true });
    await pool.query('update password_resets set used_at = now() where email = $1 and used_at is null', [em]);   // les autres liens deviennent invalides
    await serverEvent(req, 'reset_done', em, u.id, {}, { ...b, name: u.name });
    return R(200, { tok: userTok(u.id), ...pub(u) });
  }
  if (url.pathname === '/api/auth/password') {      // nouveau mot de passe (après un mot de passe temporaire)
    const uid = tokUid(b.tok); if (!uid) return R(401, { error: 'Session expirée, reconnectez-vous.' });
    if (pw.length < 6 || pw.length > 200) return R(400, { error: 'Le mot de passe doit contenir au moins 6 caractères.' });
    const u = await userById(uid); if (!u) return R(401, { error: 'Compte introuvable.' });
    await pool.query("update users set pass_hash = $1, pass_by = 'client', pass_changed_at = now() where id = $2", [await hashPass(pw), uid]);
    await serverEvent(req, 'password_set', u.email, uid, {}, { ...b, name: u.name });
    return R(200, { ok: true });
  }
  R(404, { error: 'introuvable' });
}
// mot de passe temporaire lisible (sans 0/O, 1/l)
const tempPass = () => { const a = 'abcdefghjkmnpqrstuvwxyz23456789'; let s = ''; const r = crypto.randomBytes(10); for (const x of r) s += a[x % a.length]; return s.slice(0, 5) + '-' + s.slice(5); };


async function postEvents(req, res) {
  const { ip, chain } = clientIp(req);
  if (limited('ev:' + ip, 240, 60e3)) return send(res, 429, { error: 'trop de requêtes' }, CORS);
  let arr; try { arr = JSON.parse(await readBody(req)); } catch (e) { return send(res, 400, { error: 'JSON invalide' }, CORS); }
  // format { tok, ev:[…] } : actions rattachées au compte connecté (vérifié par le serveur)
  let user = null; if (arr && !Array.isArray(arr) && Array.isArray(arr.ev)) { const uid = tokUid(arr.tok); if (uid) user = await userById(uid).catch(() => null); arr = arr.ev; }
  if (!Array.isArray(arr)) arr = [arr];
  arr = arr.slice(0, 50).filter(e => e && typeof e === 'object' && TYPE_RE.test(e.type));
  if (!arr.length) return send(res, 204, '', CORS);
  const cc = country(ip), cols = ['client_ts', 'email', 'name', 'device', 'session', 'type', 'detail', 'page', 'ua', 'lang', 'tz', 'screen', 'ip', 'ip_chain', 'country', 'uid', 'verified'];
  const vals = [], rows = arr.map((e, i) => {
    let ts = new Date(e.client_ts); ts = isNaN(ts) ? null : ts.toISOString();
    let detail = e.detail && typeof e.detail === 'object' ? e.detail : {}; if (JSON.stringify(detail).length > 4000) detail = { trop_long: true };
    vals.push(ts, user ? user.email : (str(e.email, 200) && str(e.email, 200).toLowerCase().trim()), str(e.name, 200), str(e.device, 64), str(e.session, 64), e.type,
      JSON.stringify(detail), str(e.page, 40), str(e.ua, 400), str(e.lang, 20), str(e.tz, 60), str(e.screen, 20), ip, chain, cc, user ? user.id : null, !!user);
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
      const r = await pool.query(`select c.*, u.created_at as account_at, u.last_login_at, u.pass_by, p.paid, p.refunded, p.chargeback, p.first_paid
        from clients c left join users u on u.email = c.email
        left join (select email, bool_or(event in ('order.paid','subscription.created','subscription.renewed','manual.grant')) as paid,
                          bool_or(event = 'order.refunded') as refunded, bool_or(event = 'order.chargeback') as chargeback,
                          min(coalesce(paid_at, received_at)) filter (where event in ('order.paid','manual.grant')) as first_paid
                   from purchases group by email) p on p.email = c.email
        order by c.last_seen desc limit 10000`);
      return send(res, 200, r.rows);
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
      const a = await pool.query('select id, email, name, pass_by, pass_changed_at, created_at, created_ip, created_country, created_ua, created_device, last_login_at from users where email = $1', [email]);
      const pu = await pool.query('select id, received_at, event, kp_id, status, email, name, phone, amount, net_amount, currency, offers, payment_id, card_holder, paid_at, refunded_at, chargeback_at, event_at, tracking from purchases where email = $1 order by received_at, id', [email]);
      return send(res, 200, { email, devices: devs, events: r.rows, account: a.rows[0] || null, purchases: pu.rows, access: await accessOf(email) });
    }
    if (url.pathname === '/api/admin/sales') {
      const r = await pool.query(`select p.id, p.received_at, p.event, p.kp_id, p.status, p.email, p.name, p.amount, p.currency, p.offers, p.paid_at, p.tracking,
          exists(select 1 from events e where e.email = p.email) as in_app, exists(select 1 from users u where u.email = p.email) as has_account
        from purchases p order by p.received_at desc limit $1`, [lim]);
      return send(res, 200, r.rows);
    }
    if (url.pathname === '/api/admin/offers') {      // cliques sur les cartes d'offres (cross-sell) : « Découvrir », cadenas premium, « Bientôt »
      const r = await pool.query(`select case when detail->>'a' in ('offer','buy') then 'offer:' || coalesce(detail->>'id','?') when detail->>'a' = 'lockgo' then 'lock:' || coalesce(detail->>'i','?') else detail->>'a' end as k,
          count(*)::int as clicks, count(distinct coalesce(email, device))::int as people,
          (count(*) filter (where created_at > now() - interval '24 hours'))::int as d1, (count(*) filter (where created_at > now() - interval '7 days'))::int as d7,
          max(created_at) as last
        from events where type = 'act' and detail->>'a' in ('offer','buy','lockgo','later','upd') group by 1 order by clicks desc`);
      const who = await pool.query(`select coalesce(detail->>'id','') as id, email, (array_agg(name order by created_at desc) filter (where name is not null))[1] as name, count(*)::int n, max(created_at) as last
        from events where type = 'act' and detail->>'a' in ('offer','buy') and email is not null group by 1, 2 order by max(created_at) desc limit 300`);
      return send(res, 200, { rows: r.rows, who: who.rows });
    }
    if (url.pathname === '/api/admin/config') return send(res, 200, { mode: ACCESS_MODE, webhookSecret: !!KP_SECRET, lastWebhook,
      webhookUrl: 'https://' + (req.headers['x-forwarded-host'] || req.headers.host) + '/api/webhooks/kashpay' });
    send(res, 404, { error: 'introuvable' });
  } catch (e) { console.error('admin', e.message); send(res, 500, { error: 'base : ' + e.message }); }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'OPTIONS') return send(res, 204, '', { ...CORS, 'Access-Control-Max-Age': '86400' });
    if (url.pathname === '/api/events' && req.method === 'POST') return await postEvents(req, res);
    if (url.pathname === '/api/admin/login' && req.method === 'POST') return await adminLogin(req, res);
    if (url.pathname.startsWith('/api/admin/mail/')) return await adminMail(req, res, url);
    if (url.pathname.startsWith('/api/admin/funnel')) return await adminFunnel(req, res, url);
    if (url.pathname.startsWith('/api/admin/') && req.method === 'GET') return await adminGet(req, res, url);
    if (url.pathname === '/api/admin/reset' && req.method === 'POST') {      // mot de passe temporaire pour un client qui l'a oublié
      if (!okToken(req)) return send(res, 401, { error: 'Sessão expirada' });
      let b = {}; try { b = JSON.parse(await readBody(req, 4096)); } catch (e) {}
      const email = String(b.email || '').toLowerCase(), pw = tempPass();
      const r = await pool.query("update users set pass_hash = $1, pass_by = 'admin', pass_changed_at = now() where email = $2 returning id", [await hashPass(pw), email]);
      if (!r.rowCount) return send(res, 404, { error: 'Esse cliente ainda não criou conta com senha.' });
      await serverEvent(req, 'reset_admin', email, r.rows[0].id, { par: 'admin' });
      return send(res, 200, { password: pw });
    }
    if (url.pathname.startsWith('/api/auth/') && req.method === 'POST') return await authRoute(req, res, url);
    if (url.pathname === '/api/webhooks/kashpay' && req.method === 'POST') return await kashpayWebhook(req, res);
    if (url.pathname === '/api/admin/grant' && req.method === 'POST') {      // libérer l'accès à la main (achat ancien, autre moyen de paiement…)
      if (!okToken(req)) return send(res, 401, { error: 'Sessão expirada' });
      let b = {}; try { b = JSON.parse(await readBody(req, 512 * 1024)); } catch (e) {}
      // un e-mail ({email}) ou une liste collée ({emails: "a@x.fr, b@y.fr …"} ou tableau) : jusqu'à 5000 d'un coup
      const raw = Array.isArray(b.emails) ? b.emails.join(' ') : String(b.emails || b.email || '');
      const list = [...new Set((raw.match(/[^\s,;<>"'()]+@[^\s,;<>"'()]+\.[^\s,;<>"'()]+/g) || []).map(x => x.trim().toLowerCase()).filter(x => EMAIL_RE.test(x)))].slice(0, 5000);
      if (!list.length) return send(res, 400, { error: 'Nenhum e-mail válido encontrado.' });
      let added = 0, already = 0; const ip = clientIp(req).ip;
      for (const [i, email] of list.entries()) {
        if ((await accessOf(email)).paid) { already++; continue; }
        await savePurchase({ event: 'manual.grant', created_at: new Date().toISOString(), data: { id: 'manual-' + Date.now() + '-' + i, status: 'paid', customer: { email }, paid_at: new Date().toISOString() } }, ip);
        await serverEvent(req, 'grant_admin', email, null, { par: 'admin', lot: list.length > 1 ? list.length : undefined }); added++;
      }
      return send(res, 200, { ok: true, total: list.length, added, already });
    }
    if (url.pathname === '/health') { try { await pool.query('select 1'); return send(res, 200, 'ok'); } catch (e) { return send(res, 503, 'base indisponible'); } }
    if (url.pathname === '/admin' || url.pathname === '/admin/' || url.pathname === '/admin.html') {
      return send(res, 200, fs.readFileSync(ADMIN_HTML, 'utf8'), { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && serveStatic(req, res, url)) return;
    send(res, 404, 'introuvable');
  } catch (e) { console.error(e); send(res, 500, { error: 'erreur' }); }
});

(async () => {
  for (let i = 1; i <= 10; i++) {
    try { await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8')); console.log('Base prête.'); break; }
    catch (e) { console.error(`Base pas encore prête (essai ${i}) :`, e.message); await new Promise(r => setTimeout(r, 3000)); }
  }
  server.listen(PORT, () => console.log('Serveur sur le port ' + PORT + ' · accès : ' + ACCESS_MODE + ' · webhook KashPay : ' + (KP_SECRET ? 'prêt' : 'clé manquante')));
})();
