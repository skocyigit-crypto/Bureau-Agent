// One-off generator for the French "Connexion Google Workspace" user guide (PDF).
// Run: node scripts/generate-google-guide.mjs
// pdfkit is a dependency of @workspace/api-server; resolve it from there.
import { createRequire } from "node:module";
import { mkdirSync, createWriteStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// pdfkit is a dependency of @workspace/api-server (not hoisted to the root), so
// resolve it through that package's module graph instead of a hardcoded version path.
const require = createRequire(join(ROOT, "artifacts/api-server/package.json"));
const PDFDocument = require("pdfkit");
const OUT_DIR = join(ROOT, "guides");
mkdirSync(OUT_DIR, { recursive: true });
const OUT = join(OUT_DIR, "Connexion-Google-Workspace.pdf");

const BLUE = "#2563eb";
const DARK = "#0f172a";
const GRAY = "#475569";
const LIGHT = "#94a3b8";
const AMBER_BG = "#fef3c7";
const AMBER_TX = "#92400e";
const RED = "#b91c1c";
const BOX_BG = "#f1f5f9";

const doc = new PDFDocument({
  size: "A4",
  bufferPages: true,
  margins: { top: 56, bottom: 64, left: 56, right: 56 },
  info: {
    Title: "Connexion Google Workspace — Agent de Bureau",
    Author: "Agent de Bureau",
    Subject: "Guide pas à pas : connecter Gmail, Agenda et Drive",
  },
});
doc.pipe(createWriteStream(OUT));

const PAGE_W = doc.page.width;
const M = doc.page.margins.left;
const CONTENT_W = PAGE_W - doc.page.margins.left - doc.page.margins.right;

function ensureSpace(h) {
  if (doc.y + h > doc.page.height - doc.page.margins.bottom) doc.addPage();
}

function h1(txt) {
  ensureSpace(40);
  doc.moveDown(0.6);
  doc.fillColor(DARK).font("Helvetica-Bold").fontSize(16).text(txt, { width: CONTENT_W });
  const y = doc.y + 4;
  doc.save().moveTo(M, y).lineTo(M + CONTENT_W, y).lineWidth(2).strokeColor(BLUE).stroke().restore();
  doc.moveDown(0.8);
}

function h2(txt) {
  ensureSpace(28);
  doc.moveDown(0.4);
  doc.fillColor(BLUE).font("Helvetica-Bold").fontSize(12.5).text(txt, { width: CONTENT_W });
  doc.moveDown(0.3);
}

function para(txt) {
  doc.fillColor(GRAY).font("Helvetica").fontSize(10.5).text(txt, { width: CONTENT_W, lineGap: 2 });
  doc.moveDown(0.4);
}

function step(n, title, desc) {
  ensureSpace(46);
  const startY = doc.y;
  const r = 11;
  const cx = M + r;
  const cy = startY + r;
  doc.save().circle(cx, cy, r).fill(BLUE).restore();
  doc
    .fillColor("#ffffff")
    .font("Helvetica-Bold")
    .fontSize(11)
    .text(String(n), M, cy - 6, { width: 2 * r, align: "center", lineBreak: false });
  const tx = M + 2 * r + 12;
  const tw = CONTENT_W - 2 * r - 12;
  doc.fillColor(DARK).font("Helvetica-Bold").fontSize(11).text(title, tx, startY + 1, { width: tw, lineGap: 1 });
  if (desc) {
    doc.fillColor(GRAY).font("Helvetica").fontSize(10).text(desc, tx, doc.y + 1, { width: tw, lineGap: 1.5 });
  }
  doc.moveDown(0.7);
  doc.x = M;
}

function bullet(txt) {
  ensureSpace(18);
  const x = M + 6;
  const y = doc.y + 5;
  doc.save().circle(x, y, 1.8).fill(BLUE).restore();
  doc.fillColor(GRAY).font("Helvetica").fontSize(10.5).text(txt, M + 16, doc.y, { width: CONTENT_W - 16, lineGap: 2 });
  doc.moveDown(0.25);
  doc.x = M;
}

function callout(label, txt, opts = {}) {
  const bg = opts.bg || AMBER_BG;
  const tc = opts.tc || AMBER_TX;
  doc.font("Helvetica-Bold").fontSize(10);
  const labelH = doc.heightOfString(label, { width: CONTENT_W - 28 });
  doc.font("Helvetica").fontSize(10);
  const txtH = doc.heightOfString(txt, { width: CONTENT_W - 28, lineGap: 2 });
  const boxH = labelH + txtH + 22;
  ensureSpace(boxH + 8);
  const y0 = doc.y;
  doc.save().roundedRect(M, y0, CONTENT_W, boxH, 6).fill(bg).restore();
  doc.fillColor(tc).font("Helvetica-Bold").fontSize(10).text(label, M + 14, y0 + 10, { width: CONTENT_W - 28 });
  doc.fillColor(tc).font("Helvetica").fontSize(10).text(txt, M + 14, doc.y + 2, { width: CONTENT_W - 28, lineGap: 2 });
  doc.y = y0 + boxH + 8;
  doc.x = M;
}

function codeLine(txt) {
  doc.font("Courier").fontSize(9.5);
  const h = doc.heightOfString(txt, { width: CONTENT_W - 20 }) + 12;
  ensureSpace(h + 4);
  const y0 = doc.y;
  doc.save().roundedRect(M, y0, CONTENT_W, h, 4).fill(BOX_BG).restore();
  doc.fillColor(DARK).font("Courier").fontSize(9.5).text(txt, M + 10, y0 + 6, { width: CONTENT_W - 20 });
  doc.y = y0 + h + 6;
  doc.x = M;
}

// ---------- Cover header ----------
doc.save().rect(0, 0, PAGE_W, 150).fill(BLUE).restore();
doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(13).text("AGENT DE BUREAU", M, 40);
doc.fillColor("#dbeafe").font("Helvetica").fontSize(10).text("Votre secrétariat augmenté par l'IA", M, 60);
doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(22).text("Connexion à Google Workspace", M, 90, { width: CONTENT_W });
doc.fillColor("#dbeafe").font("Helvetica").fontSize(11).text("Gmail · Agenda · Drive — guide pas à pas", M, 120, { width: CONTENT_W });
doc.y = 172;
doc.x = M;

para(
  "Ce guide explique comment connecter votre compte Google (Gmail, Agenda et Drive) à Agent de Bureau. " +
    "Il comporte deux parties : la connexion au quotidien pour chaque utilisateur, puis une configuration " +
    "unique réservée à l'administrateur (à faire une seule fois pour toute l'entreprise)."
);

// ---------- Part 1: Users ----------
h1("Partie 1 — Connecter votre Gmail (utilisateur)");
para("Cette opération prend moins d'une minute. Elle est à refaire par chaque collaborateur qui souhaite connecter sa boîte.");
step(1, "Ouvrez la page Google Workspace", "Dans le menu de gauche, cliquez sur « Google Workspace » (icône globe).");
step(2, "Lancez la connexion", "Cliquez sur le bouton bleu « Se connecter avec Google ».");
step(3, "Choisissez votre compte", "Dans la fenêtre Google qui s'ouvre, sélectionnez l'adresse Gmail à connecter.");
step(4, "Autorisez les accès", "Acceptez les 3 autorisations demandées — Gmail, Agenda et Drive — puis cliquez sur « Autoriser ».");
step(5, "C'est connecté", "De retour dans l'application, vos derniers emails, événements et fichiers s'affichent automatiquement. L'Agent Mail IA est alors disponible.");
callout(
  "Bon à savoir",
  "Agent de Bureau ne demande par défaut que 3 accès (Gmail, Agenda, Drive) pour une connexion simple et rapide. " +
    "Les autres services Google (Docs, Sheets, Contacts, Tâches) peuvent être ajoutés plus tard, à la demande.",
  { bg: "#dbeafe", tc: "#1e3a8a" }
);

// ---------- Part 2: Admin ----------
doc.addPage();
h1("Partie 2 — Configuration unique (administrateur)");
para(
  "À faire UNE SEULE FOIS par l'administrateur, dans la console Google Cloud du compte propriétaire. " +
    "Sans cette configuration, Google bloque la connexion avec une erreur « 403 ». Une fois faite, tous les utilisateurs peuvent se connecter."
);

h2("Étape A — Activer les 3 API Google");
para("Ouvrez console.cloud.google.com, puis dans la barre de recherche en haut, activez successivement :");
bullet("Gmail API — cliquez sur « Activer ».");
bullet("Google Calendar API — cliquez sur « Activer ».");
bullet("Google Drive API — cliquez sur « Activer ».");
callout(
  "Important",
  "Si une seule de ces API n'est pas activée, Google fait échouer TOUTE la connexion avec le message « 403 — you do not have access to this page ». Vérifiez que les trois sont bien activées."
);

h2("Étape B — Publier l'écran de consentement OAuth");
para("Menu « API et services » → « Écran de consentement OAuth » :");
bullet("Type d'utilisateur : choisissez « External » (sauf si tous les comptes appartiennent à votre organisation Google Workspace).");
bullet("Statut de publication : s'il est sur « Testing », ajoutez votre adresse Gmail dans « Test users », OU cliquez sur « Publish app » pour passer en Production.");
bullet("Renseignez les champs obligatoires : nom de l'application et email de support.");

h2("Étape C — Déclarer l'URI de redirection");
para("Menu « API et services » → « Identifiants » → ouvrez votre « ID client OAuth 2.0 » → section « URI de redirection autorisés ». Ajoutez l'adresse de production :");
codeLine("https://bureau-agent.replit.app/api/google-oauth/callback");
para("Si vous testez aussi depuis l'environnement de développement, ajoutez également l'URL de développement correspondante (terminée par /api/google-oauth/callback), puis enregistrez.");

// ---------- Part 3: Troubleshooting ----------
doc.addPage();
h1("Partie 3 — En cas de problème");

h2("« 403 — you do not have access to this page »");
para("Ce n'est pas un bug de l'application : la configuration Google (Partie 2) est incomplète. Vérifiez dans l'ordre :");
bullet("L'écran de consentement OAuth est en mode « Testing » et votre compte n'est pas dans la liste « Test users » → ajoutez-le, ou publiez l'application.");
bullet("Le type d'utilisateur est « Internal » alors que vous vous connectez avec un compte externe → passez en « External ».");
bullet("Une des API (Gmail / Agenda / Drive) n'est pas activée → activez-la.");

h2("« Error 400 : redirect_uri_mismatch »");
para("L'adresse de redirection n'est pas (ou mal) déclarée côté Google. Reprenez l'Étape C et vérifiez que l'URI est identique, au caractère près :");
codeLine("https://bureau-agent.replit.app/api/google-oauth/callback");

h2("La fenêtre Google ne s'ouvre pas");
bullet("Autorisez les fenêtres pop-up pour le site dans votre navigateur.");
bullet("Réessayez après quelques minutes : les changements dans Google Cloud peuvent mettre un peu de temps à se propager.");

callout(
  "Aide dans l'application",
  "Vous retrouvez ces étapes à tout moment dans l'application : bouton « ? » (Centre d'aide) en bas à droite, rubrique « Connecter Google Workspace (Gmail) ».",
  { bg: "#dcfce7", tc: "#166534" }
);

// Footers on every buffered page (drawn after content to avoid pagination recursion).
const range = doc.bufferedPageRange();
for (let i = range.start; i < range.start + range.count; i++) {
  doc.switchToPage(i);
  const y = doc.page.height - 44;
  doc
    .save()
    .font("Helvetica")
    .fontSize(8)
    .fillColor(LIGHT)
    .text("Agent de Bureau — Guide de connexion Google Workspace", M, y, {
      width: CONTENT_W,
      align: "left",
      lineBreak: false,
    })
    .text(`Page ${i - range.start + 1} / ${range.count}`, M, y, {
      width: CONTENT_W,
      align: "right",
      lineBreak: false,
    })
    .restore();
}
doc.flushPages();

doc.end();
console.log("PDF written to", OUT);
