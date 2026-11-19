// Funnel « relance » : acheteurs qui ne sont jamais entrés dans l'app.
// 3 e-mails par jour pendant 5 jours (15 au total), aux heures de Paris adaptées à un public de 40 ans et plus :
// le café du matin, la pause du déjeuner, la soirée calme après le dîner. S'arrête dès que la personne entre dans l'app.
// Chaque e-mail parle d'une leçon précise et le bouton ouvre l'app directement sur cette leçon (lien ?e=… + #route).
const SLOTS = ['08:15', '12:30', '19:45'];             // heure de Paris
// {p} = prénom (ou rien), chaque étape : s = objet, pre = aperçu dans la boîte de réception, b = paragraphes, cta, go = route de l'app
const STEPS = [
 { s: '{p}votre espace est ouvert… il ne manque que vous', pre: 'Tout est prêt : un seul bouton à toucher.', go: '',
   b: ["Votre achat est bien confirmé et votre espace <b>Prière Sacrée</b> est ouvert depuis hier.", "Vos prières, vos programmes et vos bonus vous attendent. Il ne manque plus qu'une chose : <b>vous</b>.", "En touchant le bouton, votre e-mail est déjà rempli. Choisissez simplement un mot de passe, et vous y êtes."], cta: 'Entrer dans mon espace' },
 { s: 'Une prière a été scellée pour vous ce matin', pre: "Elle ne s'ouvre qu'une fois par jour, et seulement pour vous.", go: 'message',
   b: ["Chaque matin, une prière est choisie pour vous et placée sous un <b>sceau de cire</b>.", "Celle d'aujourd'hui vous attend encore. Personne d'autre ne reçoit la même que vous.", "Touchez le sceau, et découvrez aussi ce qu'elle signifie <b>pour votre journée</b>."], cta: 'Briser le sceau' },
 { s: 'Pourquoi tant de prières restent sans réponse ?', pre: "Ce n'est pas un manque de foi. C'est autre chose…", go: 'prog-fond-1',
   b: ["Vous priez, sincèrement. Et pourtant, parfois, rien ne semble bouger.", "Dans la première leçon des <b>Fondements de la Foi</b>, un frère franciscain explique le piège dans lequel tombent presque tous les croyants : <i>prier en pilote automatique</i>.", "Ce soir, prenez 4 minutes. Vous ne prierez plus jamais de la même façon."], cta: 'Voir la leçon 1' },
 { s: "{p}la Grande Prière de saint Antoine vous attend", pre: 'En la lisant, de nouvelles leçons se débloquent.', go: 'saint-antoine',
   b: ["Saint Antoine est connu pour retrouver ce qui est perdu : les objets, mais aussi la paix, l'espérance et la confiance.", "Sa <b>Grande Prière</b> est la porte d'entrée de votre espace. Lisez-la une fois en entier…", "…et un cadeau se débloque : les <b>Prières Puissantes à l'Archange Michel</b>."], cta: 'Lire la Grande Prière' },
 { s: 'Le secret des 5 minutes', pre: "Ce que font, chaque jour, ceux dont la prière porte du fruit.", go: 'prog-fond-2',
   b: ["Notre esprit parle sans arrêt : soucis, listes, souvenirs. Alors la prière glisse dessus sans y entrer.", "La deuxième leçon des <b>Fondements de la Foi</b> vous donne un geste tout simple : <b>5 minutes de silence</b>, sans rien forcer.", "C'est souvent là que Dieu se fait enfin entendre."], cta: 'Découvrir la leçon 2' },
 { s: 'Ce soir, mettez vos écouteurs 🎧', pre: 'Un sage vous attend dans une bibliothèque cachée.', go: 'prog-freq-1',
   b: ["Dans une bibliothèque oubliée, sous un rayon de lumière, un sage vous attend.", "Il vous ouvre le portail des <b>7 Fréquences de l'Accélération Divine</b> : <i>« Ici, un jour est comme mille ans. »</i>", "Installez-vous confortablement, mettez vos écouteurs, et écoutez son message jusqu'au bout."], cta: "Écouter l'introduction" },
 { s: "Le chant que saint Michel n'ignore jamais", pre: 'Protection pour vous, votre maison et ceux que vous aimez.', go: 'prog-chant-1',
   b: ["Il y a des jours où l'on se sent attaqué : par la peur, par la fatigue, par les mauvaises nouvelles.", "Le <b>Chant Sacré de l'Archange Michel</b> est une prière chantée pour l'appeler à se tenir devant vous.", "Écoutez-le une fois ce matin. Beaucoup le gardent ensuite pour chaque matin difficile."], cta: 'Écouter le Chant Sacré' },
 { s: '{p}avez-vous oublié votre accès ?', pre: "Votre e-mail est déjà rempli. Il reste une seule étape.", go: '',
   b: ["Nous remarquons que vous n'êtes pas encore entré dans votre espace. Ce n'est pas grave : c'est très simple.", "1. Touchez le bouton ci-dessous.<br>2. Écrivez votre nom.<br>3. Choisissez un mot de passe et notez-le sur un papier.", "Un souci ? <b>Répondez simplement à cet e-mail</b>, une vraie personne vous aide."], cta: 'Entrer maintenant' },
 { s: 'La fréquence qui brise le cycle des retards', pre: 'Ce qui traîne depuis des années peut enfin avancer.', go: 'prog-freq-2',
   b: ["Un projet qui n'aboutit pas. Une réponse qui n'arrive pas. Un cycle qui se répète.", "La première des 7 Fréquences, <b>L'Éveil</b>, a été pensée pour une seule chose : briser ce cycle des retards.", "Écoutez-la ce soir, de préférence avec des écouteurs, juste avant de dormir."], cta: "Écouter L'Éveil" },
 { s: 'Votre ange gardien est-il réveillé ?', pre: 'Il est à vos côtés depuis votre naissance.', go: 'prog-chant-2',
   b: ["La Bible le dit : Dieu a placé un ange pour vous garder dans toutes vos voies.", "Mais beaucoup vivent sans jamais lui parler. Dans <b>Activation de votre Ange Gardien</b>, vous apprenez à le reconnaître et à l'appeler.", "Une leçon courte, très douce, à vivre ce matin."], cta: 'Réveiller mon ange gardien' },
 { s: 'Un seul verset peut guider toute votre journée', pre: 'La méthode la plus simple de la Bible.', go: 'prog-fond-3',
   b: ["Pas besoin de lire des chapitres entiers. <b>Un seul verset</b>, lu lentement, peut éclairer toute une journée.", "Dans la troisième leçon des <b>Fondements de la Foi</b>, vous apprenez à poser une question à Dieu… et à la porter avec vous jusqu'au soir.", "Essayez dès aujourd'hui : vous serez surpris des réponses."], cta: 'Voir la leçon 3' },
 { s: '21 jours pour devenir une créature nouvelle', pre: 'Un pas avec Dieu chaque jour. Le premier est aujourd\'hui.', go: 'defi',
   b: ["Purifier ce qui pèse. Semer de bonnes graines. Puis marcher vers la moisson.", "Le défi <b>21 Jours de Renouveau</b> vous propose un petit pas chaque jour : un verset, une prière à dire, un geste sacré.", "À la fin, un <b>certificat d'alliance</b> à votre nom vous attend. Le Jour 1 est déjà ouvert."], cta: 'Commencer le Jour 1' },
 { s: "La prière de guérison de l'archange Raphaël", pre: 'Pour le corps fatigué, le cœur blessé et ceux que vous aimez.', go: 'prog-chant-3',
   b: ["Raphaël signifie « Dieu guérit ».", "Dans <b>Le Sceau de la Guérison Divine</b>, vous recevez sa prière pour le corps, pour le cœur, et pour un proche qui souffre.", "Pensez à quelqu'un qui en a besoin, et écoutez-la pour lui ce matin."], cta: 'Recevoir la prière de Raphaël' },
 { s: 'Quand les murailles tombent…', pre: 'Ce qui bloque votre abondance depuis longtemps.', go: 'prog-freq-5',
   b: ["Les murailles de Jéricho sont tombées sans un seul coup d'épée : par la foi, la patience et le son.", "La fréquence <b>La Résonance de Jéricho</b> s'attaque aux blocages qui empêchent l'abondance d'entrer dans votre vie.", "Ce midi, offrez-vous 5 minutes avec vos écouteurs."], cta: 'Écouter Jéricho' },
 { s: '{p}c\'est mon dernier message', pre: 'Votre espace reste ouvert. Je ne vous écrirai plus.', go: '',
   b: ["Depuis 5 jours, je vous écris pour vous montrer ce qui vous attend : les prières, les fréquences, le défi des 21 jours.", "C'est mon dernier message. Votre espace reste ouvert, et tout y est gardé pour vous.", "Si quelque chose vous empêche d'entrer, <b>répondez à cet e-mail</b> : je vous aide personnellement. Et si vous êtes prêt, il suffit d'un geste."], cta: 'Entrer dans mon espace' },
];
const h = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const strip = s => String(s).replace(/<br>/g, '\n').replace(/<[^>]+>/g, '');
function funnelEmail(n, email, name, appUrl, firstName) {
  const st = STEPS[n], p = firstName(name);
  const subject = st.s.replace('{p}', p ? p + ', ' : '').replace(/^./, c => c.toUpperCase());
  const link = appUrl + '/?e=' + encodeURIComponent(email) + (st.go ? '#' + st.go : '');
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${h(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4efe4;font-family:Georgia,'Times New Roman',serif;color:#1c2540">
<div style="display:none;max-height:0;overflow:hidden">${h(st.pre)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4efe4"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;border:1px solid #e3d6b8">
<tr><td style="padding:28px 26px 4px;text-align:center"><div style="font-size:15px;letter-spacing:3px;color:#8a6a1e;font-family:Arial,sans-serif;font-weight:bold">✦ PRIÈRE SACRÉE ✦</div>
 <h1 style="margin:16px 0 0;font-size:28px;line-height:1.25;font-weight:normal;color:#1c2540">${p ? 'Bonjour ' + h(p) + ',' : 'Bonjour,'}</h1></td></tr>
<tr><td style="padding:10px 28px 0;font-size:20px;line-height:1.6">${st.b.map(x => `<p style="margin:14px 0 0">${x}</p>`).join('')}</td></tr>
<tr><td align="center" style="padding:26px 26px 4px"><a href="${h(link)}" style="display:inline-block;background:#b98f3c;background-image:linear-gradient(90deg,#d9b866,#b98f3c);color:#ffffff;text-decoration:none;font-family:Arial,sans-serif;font-size:20px;font-weight:bold;letter-spacing:1px;padding:19px 30px;border-radius:12px">${h(st.cta.toUpperCase())}</a></td></tr>
<tr><td style="padding:14px 28px 0;text-align:center;font-family:Arial,sans-serif;font-size:15px;color:#6b6b6b">Votre e-mail d'accès : <b style="color:#1c2540">${h(email)}</b><br>(il est déjà rempli quand vous touchez le bouton)</td></tr>
<tr><td style="padding:24px 26px 28px;font-size:19px;line-height:1.5;text-align:center;font-style:italic;color:#5b4a22">Que la paix vous accompagne,<br><span style="font-style:normal;font-weight:bold">L'équipe Prière Sacrée</span></td></tr>
</table>
<p style="max-width:560px;font-family:Arial,sans-serif;font-size:13px;line-height:1.5;color:#7a7a7a;margin:16px auto 0;text-align:center">
 Si le bouton ne fonctionne pas : <a href="${h(link)}" style="color:#8a6a1e;word-break:break-all">${h(link)}</a><br>
 Vous recevez cet e-mail car vous avez acheté Prière Sacrée avec l'adresse ${h(email)}. Ces rappels s'arrêtent dès votre première connexion.</p>
</td></tr></table></body></html>`;
  const text = `${p ? 'Bonjour ' + p + ',' : 'Bonjour,'}\n\n${st.b.map(strip).join('\n\n')}\n\n${st.cta} : ${link}\n\nVotre e-mail d'accès : ${email}\n\nQue la paix vous accompagne,\nL'équipe Prière Sacrée`;
  return { subject, html, text };
}
// heure de Paris (HH:MM) et date (AAAA-MM-JJ)
function parisNow(d = new Date()) {
  const f = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const g = t => f.find(x => x.type === t).value;
  return { day: `${g('year')}-${g('month')}-${g('day')}`, min: +g('hour') * 60 + +g('minute') };
}
// créneau en cours (index) si on est dans les 90 minutes qui suivent un horaire, sinon -1
function currentSlot(d = process.env.FUNNEL_FAKE_NOW ? new Date(require('fs').readFileSync(process.env.FUNNEL_FAKE_NOW, 'utf8').trim()) : new Date()) {  // FUNNEL_FAKE_NOW : tests seulement
  const { day, min } = parisNow(d);
  for (let i = SLOTS.length - 1; i >= 0; i--) { const [hh, mm] = SLOTS[i].split(':').map(Number), t = hh * 60 + mm;
    if (min >= t && min < t + 90) return { key: day + ' ' + SLOTS[i], i }; }
  return null;
}
module.exports = { STEPS, SLOTS, funnelEmail, currentSlot, parisNow };
