/**
 * Ouvre CHAQUE ecran de l'application, connecte, et dit lesquels sont casses.
 *
 * Pourquoi cet outil existe: les suites de tests couvrent des fonctions, et
 * `verif-parcours.mjs` couvre l'API. Ni l'un ni l'autre n'ouvre un ecran. Or
 * tout ce que le client paie est derriere l'authentification — un ecran blanc
 * ou une erreur JavaScript y serait invisible pour tout le reste du depot.
 *
 * Trois defauts sont cherches, et ils ne se ressemblent pas:
 *
 *   - la page BLANCHE: le rendu a echoue, il ne reste rien a lire;
 *   - l'erreur de SCRIPT: la page s'affiche mais une partie ne fonctionne pas;
 *   - la cle de TRADUCTION nue (`taches.titre` affiche tel quel): la page
 *     marche et ment sur son propre etat — le defaut le plus discret des trois.
 *
 * Les appels reseau en echec sont comptes separement: un 404 sur une donnee
 * absente n'est pas un ecran casse, et les confondre rendrait le rapport
 * inutilisable.
 */
import { chromium } from "@playwright/test";

const APP = process.env.APP ?? "http://127.0.0.1:5173";
const EMAIL = process.env.EMAIL ?? "verif@local.test";
const MOTDEPASSE = process.env.MOTDEPASSE ?? "VerifLocal!2026";

/** Les ecrans, tels que declares dans App.tsx (ceux sans parametre d'URL). */
const ECRANS = [
  "/", "/abonnement", "/activite-recente", "/admin", "/admin/audit",
  "/admin/dashboard", "/admin/factures-b2b", "/agents-ia", "/analyse", "/appels",
  "/asistan", "/assistant-proactif", "/audit", "/auto-audit", "/automatisations",
  "/base-connaissances", "/calendrier", "/commandant-ia", "/contacts",
  "/contacts/import", "/corbeille", "/depenses", "/devis", "/diagnostic-poste",
  "/document-ia", "/documents", "/equipe-ia", "/equipe/localisation", "/factures",
  "/file-approbation", "/gestion-licence", "/gmail-agent", "/google-workspace",
  "/guide", "/ia-apprentissage", "/import", "/logiciels", "/messages",
  "/notes-internes", "/notifications", "/onboarding", "/organisations",
  "/parametres", "/performance", "/pointage", "/projets", "/prospects",
  "/protection-donnees", "/rapport-executif", "/rapports", "/recherche-web",
  "/reglements", "/saisie-chantier", "/sante-technique", "/securite", "/taches",
  "/telecharger", "/telephonie", "/tresorerie", "/utilisateurs", "/whatsapp",
];

/**
 * Decoupage en lots.
 *
 * La limite de l'application porte sur un quart d'heure glissant. Soixante et
 * un ecrans, dont chacun interroge `/auth/me` et plusieurs sondes de fond, la
 * depassent d'un seul tenant QUELLE QUE SOIT la pause entre deux ecrans —
 * ralentir ne fait que repartir le meme total sur plus longtemps.
 *
 * D'ou les lots: `DEBUT=0 FIN=20`, puis le lot suivant un quart d'heure plus
 * tard. C'est la seule facon d'obtenir un verdict sur un ecran plutot qu'un
 * constat sur notre propre cadence.
 */
const DEBUT = Number(process.env.DEBUT ?? 0);
const FIN = Number(process.env.FIN ?? ECRANS.length);
const A_VISITER = ECRANS.slice(DEBUT, FIN);

const navigateur = await chromium.launch();
const contexte = await navigateur.newContext();
const page = await contexte.newPage();

// --- Connexion ---------------------------------------------------------------
await page.goto(`${APP}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.fill('input[type="email"]', EMAIL);
await page.fill('input[type="password"]', MOTDEPASSE);
await Promise.all([
  page.waitForLoadState("networkidle").catch(() => {}),
  page.click('button[type="submit"]'),
]);
await page.waitForTimeout(2500);

const connecte = !(await page.locator('input[type="password"]').count());
console.log(connecte ? "Connexion: OK\n" : "Connexion: ECHEC — le reste n'a pas de sens\n");
if (!connecte) {
  await navigateur.close();
  process.exit(1);
}

// --- Parcours des ecrans -----------------------------------------------------
const casses = [];
const nonJuges = [];

/**
 * Pause entre deux ecrans.
 *
 * Sans elle, l'outil se fait limiter par l'application — et rapporte alors ses
 * PROPRES 429 comme si les ecrans etaient casses. Premiere mesure faite sans
 * pause: soixante ecrans « en probleme », tous pour la meme raison, aucune
 * n'ayant de rapport avec eux. Un outil de verification qui provoque ce qu'il
 * mesure ne mesure rien.
 *
 * Le groupe de routes le plus strict autorise 200 appels par quart d'heure,
 * soit environ treize par minute; trois secondes entre deux ecrans laissent la
 * marge necessaire.
 */
const PAUSE_MS = Number(process.env.PAUSE_MS ?? 3000);

for (const chemin of A_VISITER) {
  await page.waitForTimeout(PAUSE_MS);
  const erreurs = [];
  const reseau = [];
  const limite = [];
  const onErr = (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    // Meme raison que pour le reseau: le message de console qui accompagne un
    // 429 decrit notre propre cadence, pas l ecran.
    if (t.includes("429")) return;
    erreurs.push(t.slice(0, 160));
  };
  const onPageErr = (e) => erreurs.push(`exception: ${String(e).slice(0, 160)}`);
  const onRep = (r) => {
    const code = r.status();
    if (code < 400) return;
    // 429 = l'application nous limite. Ce n'est PAS un ecran casse, c'est une
    // mesure qui n'a pas pu se faire — et confondre les deux est ce qui a
    // produit le premier rapport, ou soixante ecrans etaient declares « en
    // probleme » sans qu'aucun ne le soit.
    (code === 429 ? limite : reseau).push(`${code} ${new URL(r.url()).pathname}`);
  };

  page.on("console", onErr);
  page.on("pageerror", onPageErr);
  page.on("response", onRep);

  let texte = "";
  try {
    await page.goto(`${APP}${chemin}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(1800);
    texte = (await page.locator("body").innerText().catch(() => "")).trim();
  } catch (e) {
    erreurs.push(`navigation: ${String(e).slice(0, 120)}`);
  }

  page.off("console", onErr);
  page.off("pageerror", onPageErr);
  page.off("response", onRep);

  // Une cle de traduction nue ressemble a `section.sous.cle`: des mots colles
  // par des points, sans espace. On exige deux points pour ne pas confondre
  // avec une phrase terminee par un nom de fichier.
  const clesNues = [...texte.matchAll(/\b[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*\.[a-zA-Z0-9.]+\b/g)]
    .map((m) => m[0])
    .filter((c) => !c.includes("..") && !/\.(js|ts|tsx|json|png|svg|fr|com|io)$/.test(c));

  const vide = texte.length < 60;
  const probleme = vide || erreurs.length > 0 || reseau.length > 0 || clesNues.length > 0;

  if (probleme) {
    casses.push({ chemin, vide, erreurs, reseau, clesNues: [...new Set(clesNues)].slice(0, 3) });
  }
  // Un ecran limite n'est ni bon ni mauvais: il n'a pas ete juge. Le dire
  // separement est la seule facon d'avoir un rapport utilisable.
  if (limite.length > 0) nonJuges.push({ chemin, limite: [...new Set(limite)] });

  const etat = probleme ? "PROBLEME" : limite.length > 0 ? "NON JUGE" : "OK      ";
  console.log(`${etat} ${chemin.padEnd(24)} ${texte.length} car.` +
    (vide ? " [VIDE]" : "") +
    (erreurs.length ? ` [${erreurs.length} err]` : "") +
    (reseau.length ? ` [${reseau.length} x 4xx/5xx]` : "") +
    (limite.length ? ` [${limite.length} x 429 — notre cadence]` : "") +
    (clesNues.length ? ` [cle nue: ${clesNues[0]}]` : ""));
}

await navigateur.close();

// --- Verdict -----------------------------------------------------------------
console.log("\n" + "=".repeat(70));
console.log(`${A_VISITER.length} ecrans ouverts · ${casses.length} en probleme · ${nonJuges.length} non juges (limite atteinte)\n`);

if (nonJuges.length > 0) {
  // Dit en clair, parce qu'un ecran non juge est une question ouverte et non
  // une bonne nouvelle. Relancer par lots, ou espacer davantage (PAUSE_MS).
  console.log(`Non juges — l'application nous a limites, ce n'est pas un defaut des ecrans:`);
  console.log(`  ${nonJuges.map((n) => n.chemin).join(", ")}\n`);
}

if (casses.length === 0) {
  console.log(`Aucun probleme sur les ${A_VISITER.length - nonJuges.length} ecrans reellement juges.`);
} else {
  console.log(`${casses.length} ecran(s) sur ${A_VISITER.length} a regarder:\n`);
  for (const c of casses) {
    console.log(`  ${c.chemin}`);
    if (c.vide) console.log("      page quasi vide");
    for (const e of c.erreurs.slice(0, 2)) console.log(`      erreur: ${e}`);
    for (const r of c.reseau.slice(0, 2)) console.log(`      reseau: ${r}`);
    for (const k of c.clesNues) console.log(`      cle de traduction nue: ${k}`);
  }
  process.exitCode = 1;
}
