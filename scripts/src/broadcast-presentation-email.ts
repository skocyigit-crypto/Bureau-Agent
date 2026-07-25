/**
 * Envoi ponctuel d'un email de presentation d'Ajant Bureau a tous les
 * utilisateurs actifs de la plateforme.
 *
 * SECURITE / IRREVERSIBILITE
 * --------------------------
 * Ce script ecrit vers l'exterieur (vraies boites mail de vrais clients).
 * Il est donc en DRY-RUN par defaut : sans `--send`, il se contente de lister
 * les destinataires resolus et n'envoie rien. Il faut passer `--send`
 * explicitement pour declencher l'envoi.
 *
 * Destinataires : tous les utilisateurs `actif = true` avec un email plausible.
 * Les doublons d'adresse (meme personne dans plusieurs organisations) sont
 * dedupliques : une seule copie par adresse.
 *
 * Envoi via Resend (meme provider que l'API — voir
 * artifacts/api-server/src/services/email.ts). Le script n'importe PAS le
 * service de l'API pour rester autonome : il utilise directement la cle
 * plateforme RESEND_API_KEY, sans BYOK par organisation (c'est un message de
 * la plateforme, pas d'un locataire).
 *
 * Usage :
 *   # 1. Lister les destinataires, sans rien envoyer
 *   pnpm --filter @workspace/scripts run broadcast-presentation
 *
 *   # 2. Envoi de test a une seule adresse
 *   pnpm --filter @workspace/scripts run broadcast-presentation -- --send --only=moi@exemple.fr
 *
 *   # 3. Envoi reel a tous les utilisateurs actifs
 *   pnpm --filter @workspace/scripts run broadcast-presentation -- --send
 *
 * Variables d'environnement requises :
 *   DATABASE_URL     - base de production
 *   RESEND_API_KEY   - cle d'envoi plateforme
 *   RESEND_FROM_EMAIL (optionnel) - defaut "Ajant Bureau <noreply@agentdebureau.fr>"
 *   APP_URL / PUBLIC_URL (optionnel) - defaut https://agentdebureau.fr
 */
import { Resend } from "resend";

const args = process.argv.slice(2);

// ── Execution depuis un poste local, via Cloud SQL Auth Proxy ──────────────
// En production (Cloud Run), DATABASE_URL pointe vers la socket unix
// `/cloudsql/<instance>` — inexistante sur un poste Windows/macOS. Plutot que
// de demander a l'operateur de reecrire a la main une chaine contenant le mot
// de passe (source d'erreurs et d'exposition du secret), on reecrit ici :
// la socket est remplacee par l'hote local ou ecoute le proxy.
//
//   .\cloud-sql-proxy.exe --port 5433 <project>:<region>:<instance>
//   $env:CLOUD_SQL_PROXY_PORT = "5433"   # ou --proxy-port=5433
//
// Le mot de passe n'est jamais touche : on ne manipule que la portion de la
// chaine situee APRES le dernier `@`, ou il ne peut pas apparaitre.
function rewriteForLocalProxy(raw: string, port: string): string {
  const at = raw.lastIndexOf("@");
  if (at === -1) return raw;
  const credentials = raw.slice(0, at + 1); // postgresql://user:motdepasse@
  let tail = raw.slice(at + 1); // [hote]/base?parametres

  // 1. Retirer le parametre `host=/cloudsql/...` (forme Cloud Run).
  tail = tail.replace(/([?&])host=%2Fcloudsql%2F[^&]*/i, "$1").replace(/([?&])host=\/cloudsql\/[^&]*/i, "$1");
  // 2. Le proxy termine lui-meme le TLS ; la liaison locale est en clair.
  tail = tail.replace(/([?&])sslmode=[^&]*/i, "$1");
  // 3. Nettoyer les separateurs de query devenus orphelins.
  tail = tail.replace(/[?&]+$/, "").replace(/\?&+/, "?").replace(/&&+/g, "&");
  // 4. Remplacer la portion hote (tout ce qui precede le premier `/`) par le proxy.
  const slash = tail.indexOf("/");
  const rest = slash === -1 ? "" : tail.slice(slash);
  return `${credentials}127.0.0.1:${port}${rest}`;
}

const rawDbUrl = process.env.DATABASE_URL || "";
const proxyPort =
  args.find((a) => a.startsWith("--proxy-port="))?.slice("--proxy-port=".length) ||
  process.env.CLOUD_SQL_PROXY_PORT ||
  "";
if (rawDbUrl.includes("/cloudsql/") || rawDbUrl.includes("%2Fcloudsql%2F")) {
  if (!proxyPort) {
    console.error(
      "DATABASE_URL pointe vers une socket Cloud SQL, injoignable depuis ce poste.\n" +
        "Demarrez le proxy puis relancez avec --proxy-port=<port> :\n" +
        "  .\\cloud-sql-proxy.exe --port 5433 <project>:<region>:<instance>\n" +
        "  ... run broadcast-presentation -- --proxy-port=5433",
    );
    process.exit(1);
  }
  process.env.DATABASE_URL = rewriteForLocalProxy(rawDbUrl, proxyPort);
  console.log(`[proxy] Connexion redirigee vers 127.0.0.1:${proxyPort}`);
}

// Import dynamique : @workspace/db lit DATABASE_URL et ouvre le pool des le
// chargement du module. Il doit donc etre importe APRES la reecriture ci-dessus
// (un `import` statique serait hisse en tete de fichier et lirait l'ancienne valeur).
const { pool } = await import("@workspace/db");
const SEND = args.includes("--send");
const ONLY = args.find((a) => a.startsWith("--only="))?.slice("--only=".length)?.trim().toLowerCase() || null;

const APP_URL = process.env.PUBLIC_URL || process.env.APP_URL || "https://agentdebureau.fr";
const FROM = process.env.RESEND_FROM_EMAIL || "Ajant Bureau <noreply@agentdebureau.fr>";

// Delai entre deux envois. Resend limite a ~10 requetes/seconde sur les plans
// standards ; 150ms laisse une marge confortable et evite les 429 qui
// feraient echouer une partie du lot sans qu'on sache lesquels.
const DELAY_MS = 150;

const SUBJECT = "Ajant Bureau : tout ce que votre plateforme sait faire";

interface Recipient {
  email: string;
  prenom: string;
  nom: string;
}

const SELECT_RECIPIENTS = `
  SELECT DISTINCT ON (lower(email))
         lower(email) AS email,
         prenom,
         nom
  FROM users
  WHERE actif = true
    AND email IS NOT NULL
    AND email LIKE '%@%.%'
    -- Domaines reserves par la RFC 2606 : comptes de diagnostic / de test
    -- crees par la plateforme. Y ecrire garantit un bounce, ce qui degrade
    -- la reputation d'expediteur du domaine pour TOUS les envois suivants.
    AND lower(email) NOT LIKE '%@example.com'
    AND lower(email) NOT LIKE '%@example.org'
    AND lower(email) NOT LIKE '%@example.net'
    AND lower(email) NOT LIKE '%@test.com'
  ORDER BY lower(email), id ASC
`;

function buildHtml(prenom: string): string {
  const greeting = prenom?.trim() ? `Bonjour ${escapeHtml(prenom.trim())},` : "Bonjour,";
  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:600px;margin:40px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

    <div style="background:linear-gradient(135deg,#0f1729 0%,#1a2744 100%);padding:40px 32px;text-align:center;">
      <h1 style="color:#ffffff;font-size:26px;margin:0;">Ajant Bureau</h1>
      <p style="color:rgba(255,255,255,0.65);font-size:14px;margin:10px 0 0;">Votre bureau, pilote par l'intelligence artificielle</p>
    </div>

    <div style="padding:32px;">
      <p style="color:#0f1729;font-size:16px;margin:0 0 16px;">${greeting}</p>
      <p style="color:#475569;font-size:15px;line-height:1.7;margin:0 0 24px;">
        Vous utilisez <strong>Ajant Bureau</strong> — et beaucoup de nos clients n'exploitent
        qu'une partie de la plateforme. Voici, en une page, l'ensemble de ce que votre
        compte sait deja faire.
      </p>

      <h2 style="color:#0f1729;font-size:17px;margin:0 0 4px;">Piloter votre activite au quotidien</h2>
      <ul style="color:#475569;font-size:14px;line-height:1.9;margin:8px 0 24px;padding-left:20px;">
        <li><strong>CRM &amp; contacts</strong> — clients, prospects et pipeline commercial au meme endroit</li>
        <li><strong>Telephonie integree</strong> — appels entrants et sortants, historique, notes d'appel</li>
        <li><strong>Taches &amp; agenda</strong> — attribution, rappels, calendrier partage de l'equipe</li>
        <li><strong>Messagerie interne</strong> — echanges d'equipe rattaches aux dossiers concernes</li>
      </ul>

      <h2 style="color:#0f1729;font-size:17px;margin:0 0 4px;">Gerer le commercial et l'administratif</h2>
      <ul style="color:#475569;font-size:14px;line-height:1.9;margin:8px 0 24px;padding-left:20px;">
        <li><strong>Devis &amp; factures</strong> — edition, envoi, suivi des reglements</li>
        <li><strong>Relances automatiques</strong> — les factures impayees sont relancees sans que vous y pensiez</li>
        <li><strong>Depenses &amp; commandes fournisseurs</strong> — la contrepartie achats de votre activite</li>
        <li><strong>Projets &amp; chantiers</strong> — avancement, intervenants, documents rattaches</li>
        <li><strong>Stock</strong> — etat des references et mouvements</li>
      </ul>

      <h2 style="color:#0f1729;font-size:17px;margin:0 0 4px;">Ce que l'IA fait pour vous</h2>
      <ul style="color:#475569;font-size:14px;line-height:1.9;margin:8px 0 24px;padding-left:20px;">
        <li><strong>Assistant vocal "Hey Bureau"</strong> — dictez une tache, un contact, une note</li>
        <li><strong>Lecture automatique de documents</strong> — un devis ou une facture scannee devient une fiche remplie</li>
        <li><strong>Agents autonomes &amp; file d'approbation</strong> — l'IA prepare les actions, vous validez d'un clic</li>
        <li><strong>Automatisations</strong> — vos regles metier declenchees toutes seules</li>
        <li><strong>Analyses &amp; rapports</strong> — l'etat reel de votre activite, sans tableur</li>
      </ul>

      <h2 style="color:#0f1729;font-size:17px;margin:0 0 4px;">Et aussi</h2>
      <ul style="color:#475569;font-size:14px;line-height:1.9;margin:8px 0 24px;padding-left:20px;">
        <li><strong>Integration Google Workspace</strong> — Drive, Agenda, Gmail</li>
        <li><strong>Suivi du personnel (pointage)</strong>, y compris reconnaissance faciale</li>
        <li><strong>Application mobile iOS &amp; Android</strong>, et installation sur le bureau (PWA)</li>
        <li><strong>Roles &amp; permissions</strong> — chacun voit ce qui le concerne</li>
      </ul>

      <div style="text-align:center;margin:32px 0 8px;">
        <a href="${APP_URL}" style="display:inline-block;background:#f59e0b;color:#0f1729;text-decoration:none;padding:15px 44px;border-radius:12px;font-size:15px;font-weight:700;">
          Ouvrir Ajant Bureau
        </a>
      </div>

      <p style="color:#64748b;font-size:13px;line-height:1.7;margin:24px 0 0;">
        Une fonctionnalite vous manque, ou vous ne savez pas par ou commencer ?
        Repondez simplement a cet email — nous vous repondons.
      </p>
    </div>

    <div style="background:#f8fafc;padding:20px 32px;text-align:center;border-top:1px solid #e2e8f0;">
      <p style="color:#94a3b8;font-size:12px;margin:0 0 4px;">
        Support : <a href="mailto:support@agentdebureau.fr" style="color:#f59e0b;">support@agentdebureau.fr</a>
      </p>
      <p style="color:#94a3b8;font-size:11px;margin:0;">
        &copy; ${new Date().getFullYear()} SK GROUP — Tous droits reserves
      </p>
    </div>
  </div>
</body>
</html>`;
}

function buildText(prenom: string): string {
  const greeting = prenom?.trim() ? `Bonjour ${prenom.trim()},` : "Bonjour,";
  return `${greeting}

Vous utilisez Ajant Bureau. Voici, en une page, l'ensemble de ce que votre compte sait deja faire.

PILOTER VOTRE ACTIVITE AU QUOTIDIEN
- CRM & contacts : clients, prospects et pipeline commercial au meme endroit
- Telephonie integree : appels entrants/sortants, historique, notes d'appel
- Taches & agenda : attribution, rappels, calendrier partage de l'equipe
- Messagerie interne rattachee aux dossiers

GERER LE COMMERCIAL ET L'ADMINISTRATIF
- Devis & factures : edition, envoi, suivi des reglements
- Relances automatiques des factures impayees
- Depenses & commandes fournisseurs
- Projets & chantiers : avancement, intervenants, documents
- Stock : references et mouvements

CE QUE L'IA FAIT POUR VOUS
- Assistant vocal "Hey Bureau" : dictez une tache, un contact, une note
- Lecture automatique de documents : un devis scanne devient une fiche remplie
- Agents autonomes & file d'approbation : l'IA prepare, vous validez
- Automatisations : vos regles metier declenchees toutes seules
- Analyses & rapports sur l'etat reel de votre activite

ET AUSSI
- Integration Google Workspace (Drive, Agenda, Gmail)
- Suivi du personnel (pointage), reconnaissance faciale
- Application mobile iOS & Android, installation bureau (PWA)
- Roles & permissions

Ouvrir Ajant Bureau : ${APP_URL}

Une question ? Repondez simplement a cet email.

Support : support@agentdebureau.fr
SK GROUP`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const { rows } = await pool.query<Recipient>(SELECT_RECIPIENTS);
  let recipients = rows;

  if (ONLY) {
    const match = recipients.find((r) => r.email === ONLY);
    // On garde le prenom reel si l'adresse existe en base, sinon on envoie
    // quand meme (utile pour tester vers une adresse hors plateforme).
    recipients = [match ?? { email: ONLY, prenom: "", nom: "" }];
    console.log(`[--only] Envoi restreint a ${ONLY}${match ? "" : " (adresse absente de la base)"}`);
  }

  console.log(`Destinataires resolus : ${recipients.length}`);
  console.log(`Objet   : ${SUBJECT}`);
  console.log(`From    : ${FROM}`);
  console.log(`App URL : ${APP_URL}`);

  if (!SEND) {
    console.log("\n--- DRY-RUN (aucun envoi) — relancez avec --send pour envoyer ---");
    for (const r of recipients) console.log(`  ${r.email}  (${r.prenom} ${r.nom})`.trimEnd());
    await pool.end();
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("RESEND_API_KEY absent — impossible d'envoyer.");
    await pool.end();
    process.exit(1);
  }

  const resend = new Resend(apiKey);
  let ok = 0;
  const failures: Array<{ email: string; error: string }> = [];

  for (const [i, r] of recipients.entries()) {
    try {
      const result = await resend.emails.send({
        from: FROM,
        to: [r.email],
        subject: SUBJECT,
        html: buildHtml(r.prenom),
        text: buildText(r.prenom),
      });
      if (result.error) {
        const msg = (result.error as any)?.message || JSON.stringify(result.error);
        failures.push({ email: r.email, error: msg });
        console.error(`  [${i + 1}/${recipients.length}] ECHEC ${r.email} : ${msg}`);
      } else {
        ok++;
        console.log(`  [${i + 1}/${recipients.length}] OK    ${r.email} (${result.data?.id})`);
      }
    } catch (err: any) {
      failures.push({ email: r.email, error: err.message });
      console.error(`  [${i + 1}/${recipients.length}] ECHEC ${r.email} : ${err.message}`);
    }
    if (i < recipients.length - 1) await sleep(DELAY_MS);
  }

  console.log(`\nTermine : ${ok} envoye(s), ${failures.length} echec(s).`);
  if (failures.length) {
    console.log("Echecs :");
    for (const f of failures) console.log(`  ${f.email} — ${f.error}`);
  }

  await pool.end();
  if (failures.length) process.exit(1);
}

main().catch(async (err) => {
  console.error("Erreur fatale :", err);
  await pool.end().catch(() => {});
  process.exit(1);
});
