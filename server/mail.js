// E-mails aux clients via Brevo (https://developers.brevo.com/reference/sendtransacemail).
// Variables Railway : BREVO_API_KEY (clé API Brevo), BREVO_SENDER (adresse d'envoi validée dans Brevo),
//                     BREVO_SENDER_NAME (défaut « Prière Sacrée »), EMAIL_DAILY_LIMIT (défaut 290 : plan gratuit = 300/jour).
const BREVO_URL = process.env.BREVO_URL || 'https://api.brevo.com/v3/smtp/email';
const APP_URL = process.env.APP_URL || 'https://app-parcoursdefoi.online';
const SUPPORT = process.env.SUPPORT_EMAIL || 'lr.bussine@gmail.com';
const cfg = () => ({ key: process.env.BREVO_API_KEY || '', sender: process.env.BREVO_SENDER || '', senderName: process.env.BREVO_SENDER_NAME || 'Prière Sacrée',
  limit: Math.max(1, +process.env.EMAIL_DAILY_LIMIT || 290) });

const h = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function firstName(name) {
  const f = String(name || '').trim().split(/\s+/)[0] || '';
  if (!/^[\p{L}'-]{2,30}$/u.test(f)) return '';
  return f.charAt(0).toUpperCase() + f.slice(1).toLowerCase();
}
// E-mail d'annonce du nouvel accès : gros caractères, fond clair, un seul bouton (public 50 ans et +)
function accessEmail(email, name) {
  const p = firstName(name), link = APP_URL + '/?e=' + encodeURIComponent(email);
  const subject = p ? `${p}, votre accès à Prière Sacrée est prêt` : 'Votre accès à Prière Sacrée est prêt';
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${h(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4efe4;font-family:Georgia,'Times New Roman',serif;color:#1c2540">
<div style="display:none;max-height:0;overflow:hidden">Votre e-mail est déjà prêt : un seul bouton à toucher.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4efe4"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;border:1px solid #e3d6b8">
<tr><td style="padding:30px 26px 6px;text-align:center">
 <div style="font-size:15px;letter-spacing:3px;color:#8a6a1e;font-family:Arial,sans-serif;font-weight:bold">✦ PRIÈRE SACRÉE ✦</div>
 <h1 style="margin:16px 0 0;font-size:30px;line-height:1.25;font-weight:normal;color:#1c2540">${p ? 'Bonjour ' + h(p) + ',' : 'Bonjour,'}</h1>
</td></tr>
<tr><td style="padding:12px 26px 0;font-size:20px;line-height:1.6;text-align:center">
 Votre espace <b>Prière Sacrée</b> vous attend dans notre nouvelle application.<br>Tout est prêt pour vous.
</td></tr>
<tr><td style="padding:22px 26px 0">
 <div style="background:#fbf6ea;border:2px solid #dcc084;border-radius:12px;padding:16px;text-align:center">
  <div style="font-size:17px;color:#5b4a22;font-family:Arial,sans-serif">Votre e-mail d'accès :</div>
  <div style="font-size:22px;font-weight:bold;margin-top:6px;word-break:break-all;font-family:Arial,sans-serif;color:#1c2540"><a href="${h(link)}" style="color:#1c2540;text-decoration:none">${h(email)}</a></div>
  <div style="font-size:15px;color:#6b6b6b;margin-top:6px;font-family:Arial,sans-serif">(l'adresse utilisée lors de votre achat)</div>
 </div>
</td></tr>
<tr><td align="center" style="padding:26px 26px 6px">
 <a href="${h(link)}" style="display:inline-block;background:#b98f3c;background-image:linear-gradient(90deg,#d9b866,#b98f3c);color:#ffffff;text-decoration:none;font-family:Arial,sans-serif;font-size:21px;font-weight:bold;letter-spacing:1px;padding:20px 34px;border-radius:12px">OUVRIR MON ESPACE</a>
</td></tr>
<tr><td style="padding:16px 26px 0;font-size:19px;line-height:1.6">
 En touchant le bouton, votre e-mail est <b>déjà rempli</b>. Il vous suffit de :
 <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:10px;font-size:19px;line-height:1.5">
  <tr><td valign="top" style="padding:6px 12px 6px 0;font-weight:bold;color:#8a6a1e">1.</td><td style="padding:6px 0">Écrire votre nom</td></tr>
  <tr><td valign="top" style="padding:6px 12px 6px 0;font-weight:bold;color:#8a6a1e">2.</td><td style="padding:6px 0">Choisir un mot de passe (6 caractères minimum)<br><span style="font-size:16px;color:#6b6b6b">Conseil : notez-le sur un papier.</span></td></tr>
  <tr><td valign="top" style="padding:6px 12px 6px 0;font-weight:bold;color:#8a6a1e">3.</td><td style="padding:6px 0">Toucher « Créer mon accès et entrer »</td></tr>
 </table>
 <p style="margin:16px 0 0">C'est tout ! La prochaine fois, l'application vous reconnaîtra.</p>
</td></tr>
<tr><td style="padding:22px 26px 0;font-size:17px;line-height:1.6;color:#3a3a3a">
 <b>Besoin d'aide ?</b> Répondez simplement à cet e-mail : nous vous aidons avec plaisir.
</td></tr>
<tr><td style="padding:26px 26px 30px;font-size:19px;line-height:1.5;text-align:center;font-style:italic;color:#5b4a22">
 Que la paix et la protection vous accompagnent,<br><span style="font-style:normal;font-weight:bold">L'équipe Prière Sacrée</span>
</td></tr>
</table>
<p style="max-width:560px;font-family:Arial,sans-serif;font-size:13px;line-height:1.5;color:#7a7a7a;margin:16px auto 0;text-align:center">
 Si le bouton ne fonctionne pas, copiez cette adresse dans votre navigateur :<br><a href="${h(link)}" style="color:#8a6a1e;word-break:break-all">${h(link)}</a><br><br>
 Vous recevez cet e-mail car vous avez acheté Prière Sacrée avec l'adresse ${h(email)}.</p>
</td></tr></table></body></html>`;
  const text = `${p ? 'Bonjour ' + p + ',' : 'Bonjour,'}

Votre espace Prière Sacrée vous attend dans notre nouvelle application.

Votre e-mail d'accès : ${email}
(l'adresse utilisée lors de votre achat)

Ouvrez votre espace : ${link}

Votre e-mail est déjà rempli. Il vous suffit de :
1. Écrire votre nom
2. Choisir un mot de passe (6 caractères minimum) — notez-le sur un papier
3. Toucher « Créer mon accès et entrer »

Besoin d'aide ? Répondez simplement à cet e-mail.

Que la paix et la protection vous accompagnent,
L'équipe Prière Sacrée`;
  return { subject, html, text };
}
async function brevoSend(to, name, msg, tag) {
  const c = cfg();
  const r = await fetch(BREVO_URL, { method: 'POST', headers: { 'api-key': c.key, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sender: { name: c.senderName, email: c.sender }, to: [{ email: to, ...(name ? { name: String(name).slice(0, 100) } : {}) }],
      replyTo: { email: SUPPORT, name: c.senderName }, subject: msg.subject, htmlContent: msg.html, textContent: msg.text, tags: [tag] }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.message || j.code || ('Brevo ' + r.status)).toString().slice(0, 300));
  return j.messageId || null;
}
module.exports = { cfg, accessEmail, brevoSend, APP_URL };
