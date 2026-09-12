/**
 * Une sauvegarde qui ne se restaure pas n'est pas une sauvegarde.
 *
 * C'est le parcours dont l'echec coute le plus cher: le jour ou un client
 * appelle parce qu'il a perdu ses donnees, il n'y a pas de seconde chance. Et
 * c'est aussi celui qu'on ne joue jamais, parce que le jouer demande de
 * detruire quelque chose.
 *
 * On le joue donc ici, sur une base de test: creer des donnees reconnaissables,
 * sauvegarder, DETRUIRE, puis restaurer et verifier qu'elles sont revenues.
 * L'etape qui compte est la derniere — une restauration qui rend 200 sans rien
 * remettre serait le pire des cas, puisqu'elle rassure.
 */
const BASE = process.env.BASE ?? "http://127.0.0.1:8080";

/*
 * Ce script DETRUIT des donnees pour verifier qu'on sait les recuperer. C'est
 * le seul moyen d'eprouver une restauration — mais c'est aussi exactement ce
 * qu'on ne veut jamais lancer par erreur ailleurs que sur une base jetable.
 *
 * Le refus est volontairement bete et non contournable par une option: une
 * adresse locale, ou rien.
 */
const LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE);
if (!LOCAL) {
  console.error(`REFUS: ce script supprime des donnees et ne s'execute que sur une base locale.\nAdresse demandee: ${BASE}`);
  process.exit(2);
}

let cookie = "";
const echecs = [];

async function appel(methode, chemin, corps) {
  const res = await fetch(`${BASE}/api${chemin}`, {
    method: methode,
    headers: { "Content-Type": "application/json", Origin: BASE, ...(cookie ? { Cookie: cookie } : {}) },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
  return { statut: res.status, donnees: await res.json().catch(() => null) };
}

function etape(nom, ok, detail = "") {
  console.log(`${ok ? "OK   " : "ECHEC"} ${nom}${detail ? " — " + detail : ""}`);
  if (!ok) echecs.push(nom + (detail ? ": " + detail : ""));
}

async function compterContacts(marque) {
  const r = await appel("GET", `/contacts?search=${marque}`);
  const liste = r.donnees?.contacts ?? r.donnees?.data ?? r.donnees ?? [];
  return Array.isArray(liste) ? liste.filter((c) => c.firstName === marque).length : 0;
}

await appel("POST", "/auth/login", { email: "verif@local.test", password: "VerifLocal!2026" });
if (!cookie) { console.log("connexion impossible"); process.exit(1); }

// --- 1. Des donnees reconnaissables -----------------------------------------
const debutDonnees = Date.now();
const marque = `Sauvegarde-${Date.now().toString().slice(-6)}`;
const ids = [];
for (let i = 0; i < 3; i++) {
  const r = await appel("POST", "/contacts", {
    firstName: marque, lastName: `Client ${i}`, phone: "0388111111", category: "client",
  });
  const id = r.donnees?.id ?? r.donnees?.contact?.id;
  if (id) ids.push(id);
}
etape("creer trois contacts", ids.length === 3, `${ids.length}/3`);
if (ids.length !== 3) process.exit(1);

// --- 2. Sauvegarder ----------------------------------------------------------
const sauv = await appel("POST", "/my-backups", {});
let backupId = sauv.donnees?.id ?? sauv.donnees?.backup?.id;

if (sauv.statut === 429) {
  // Une sauvegarde manuelle est soumise a un delai d'attente, pour qu'on ne
  // puisse pas en declencher en rafale. Ce n'est pas un echec: on reprend la
  // plus recente, qui contient deja les contacts crees juste avant si elle
  // date de cette execution. Sinon on le dit et on s'arrete, plutot que de
  // restaurer une sauvegarde trop ancienne et de conclure n'importe quoi.
  const liste = await appel("GET", "/my-backups");
  const existantes = liste.donnees?.backups ?? liste.donnees?.items ?? liste.donnees ?? [];
  const derniere = Array.isArray(existantes) ? existantes[0] : null;
  // Le critere n'est pas « recente » mais « POSTERIEURE aux donnees creees ».
  // Une sauvegarde prise avant elles ne les contient pas: la restauration ne
  // rendrait rien, et le script conclurait a tort que la restauration est
  // cassee. Accuser le produit d'un defaut qui vient de l'outil est la pire
  // sortie possible pour un outil de verification.
  const posterieure = derniere?.createdAt && new Date(derniere.createdAt).getTime() > debutDonnees;
  if (posterieure) {
    backupId = derniere.id;
    etape("sauvegarde reutilisee (delai d'attente actif)", true, `id ${backupId}`);
  } else {
    console.log(`\nDelai d'attente actif, et la derniere sauvegarde precede les donnees creees.`);
    console.log(`(${sauv.donnees?.error ?? ""})`);
    console.log("La verification ne peut pas conclure: relancez quand le delai sera ecoule.");
    process.exit(0);
  }
} else {
  etape("creer une sauvegarde", sauv.statut < 400 && !!backupId, `statut ${sauv.statut}, id ${backupId}`);
}

if (!backupId) {
  console.log("reponse:", JSON.stringify(sauv.donnees)?.slice(0, 300));
  process.exit(1);
}

// --- 3. Detruire --------------------------------------------------------------
const sup = await appel("POST", "/bulk/contacts/delete", { ids });
etape("supprimer les donnees", sup.statut < 400, `deleted=${sup.donnees?.deleted}`);
etape("elles ont bien disparu", (await compterContacts(marque)) === 0);

// --- 4. Ce que la restauration annonce ---------------------------------------
const apercu = await appel("GET", `/my-backups/${backupId}/restore-preview`);
etape("apercu de restauration disponible", apercu.statut < 400, `statut ${apercu.statut}`);
if (apercu.statut < 400) {
  console.log("     apercu:", JSON.stringify(apercu.donnees).slice(0, 220));
}

// --- 5. Restaurer --------------------------------------------------------------
const rest = await appel("POST", `/my-backups/${backupId}/restore`, {});
etape("restauration acceptee", rest.statut < 400, `statut ${rest.statut}`);
if (rest.statut >= 400) console.log("     reponse:", JSON.stringify(rest.donnees)?.slice(0, 300));

// --- 6. L'etape qui compte ----------------------------------------------------
const revenus = await compterContacts(marque);
etape("les donnees sont REVENUES", revenus === 3, `${revenus}/3 retrouves`);

console.log("\n" + "=".repeat(60));
console.log(echecs.length === 0
  ? "SAUVEGARDE: les donnees detruites ont ete recuperees."
  : `${echecs.length} probleme(s):\n  - ` + echecs.join("\n  - "));
process.exitCode = echecs.length === 0 ? 0 : 1;
