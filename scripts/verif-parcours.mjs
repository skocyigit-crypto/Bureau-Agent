/**
 * Parcours metier reel, de bout en bout, contre une API qui tourne.
 *
 * Les suites de tests couvrent des fonctions; ce script couvre ce qu'un client
 * fait vraiment: il se connecte, cree un contact, emet une facture, encaisse un
 * reglement, puis demande au journal de prouver qu'il n'a pas ete altere.
 *
 * Chaque etape affiche son code HTTP. Rien n'est suppose: si une etape echoue,
 * le script s'arrete et dit laquelle.
 */
const BASE = process.env.BASE ?? "http://127.0.0.1:8099";
const EMAIL = process.env.EMAIL ?? "verif@local.test";
const MOTDEPASSE = process.env.MOTDEPASSE ?? "VerifLocal!2026";

let cookie = "";
const echecs = [];

async function appel(methode, chemin, corps) {
  const res = await fetch(`${BASE}/api${chemin}`, {
    method: methode,
    headers: { "Content-Type": "application/json", Origin: BASE, ...(cookie ? { Cookie: cookie } : {}) },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  const brut = res.headers.getSetCookie?.() ?? [];
  if (brut.length) cookie = brut.map((c) => c.split(";")[0]).join("; ");
  let donnees = null;
  try { donnees = await res.json(); } catch { /* reponse sans corps */ }
  return { statut: res.status, donnees };
}

async function etape(nom, fn, attendu = (r) => r.statut < 400) {
  const r = await fn();
  const ok = attendu(r);
  if (!ok) echecs.push(`${nom} -> ${r.statut} ${JSON.stringify(r.donnees)?.slice(0, 300)}`);
  console.log(`${ok ? "OK  " : "ECHEC"} ${nom} (${r.statut})`);
  return r;
}

// --- 1. Connexion -----------------------------------------------------------
const connexion = await etape("connexion", () =>
  appel("POST", "/auth/login", { email: EMAIL, password: MOTDEPASSE }));
if (!cookie) {
  console.log("\nAucune session obtenue — le reste du parcours n'a pas de sens.");
  console.log(JSON.stringify(connexion.donnees)?.slice(0, 400));
  process.exit(1);
}

// --- 2. Identite et donnees de base ----------------------------------------
await etape("profil courant", () => appel("GET", "/auth/me"));
await etape("tableau de bord", () => appel("GET", "/dashboard/summary"));
await etape("liste des taches", () => appel("GET", "/tasks"));
await etape("liste des contacts", () => appel("GET", "/contacts"));
await etape("liste des projets", () => appel("GET", "/projets"));
await etape("liste des devis", () => appel("GET", "/devis"));
await etape("liste des factures", () => appel("GET", "/factures-client"));

// --- 3. Creation d'un contact ----------------------------------------------
const suffixe = Date.now().toString().slice(-6);
const contact = await etape("creer un contact", () =>
  appel("POST", "/contacts", {
    firstName: "Verification",
    lastName: `Parcours ${suffixe}`,
    phone: "0388000000",
    email: `verif${suffixe}@exemple.fr`,
    category: "client",
  }));
const contactId = contact.donnees?.id ?? contact.donnees?.contact?.id;

// --- 4. Emission d'une facture ---------------------------------------------
const facture = await etape("emettre une facture", () =>
  appel("POST", "/factures-client", {
    title: `Chantier de verification ${suffixe}`,
    clientName: `Verification Parcours ${suffixe}`,
    clientCompany: "Chantier Test SARL",
    clientAddress: "1 rue du Test\n67000 Strasbourg",
    contactId: contactId ?? undefined,
    items: [{ description: "Pose de cloisons", quantity: 2, unitPrice: 500, taxRate: 20 }],
    dueDate: new Date(Date.now() + 30 * 86400000).toISOString(),
  }));
const factureId = facture.donnees?.id ?? facture.donnees?.facture?.id;
console.log(`     facture id = ${factureId}`);

// --- 5. Le PDF sort-il vraiment ? ------------------------------------------
if (factureId) {
  const res = await fetch(`${BASE}/api/factures-client/${factureId}/pdf`, { headers: { Cookie: cookie, Origin: BASE } });
  const buf = Buffer.from(await res.arrayBuffer());
  const estPdf = buf.subarray(0, 5).toString("latin1") === "%PDF-";
  const ok = res.ok && estPdf && buf.length > 1000;
  if (!ok) echecs.push(`PDF de facture -> ${res.status}, ${buf.length} octets`);
  console.log(`${ok ? "OK  " : "ECHEC"} PDF de facture (${res.status}, ${buf.length} octets, entete=${estPdf})`);
}

// --- 6. Encaissement inalterable -------------------------------------------
if (factureId) {
  await etape("enregistrer un encaissement", () =>
    appel("POST", "/encaissements", {
      factureId,
      montant: 600,
      moyen: "virement",
      dateEncaissement: new Date().toISOString(),
    }));
  await etape("verifier la chaine d'empreintes", () => appel("GET", "/encaissements/verifier"),
    (r) => r.statut === 200 && r.donnees?.intacte === true);
  await etape("verifier la conservation", () => appel("GET", "/encaissements/conservation?type=journaliere"),
    (r) => r.statut === 200 && r.donnees?.coherent === true);
  await etape("attestation de conformite", () => appel("GET", "/encaissements/attestation"));
}

// --- 7. Verdict -------------------------------------------------------------
console.log("\n" + "=".repeat(60));
if (echecs.length === 0) {
  console.log("PARCOURS COMPLET: aucune etape en echec.");
} else {
  console.log(`${echecs.length} etape(s) en echec:`);
  for (const e of echecs) console.log("  - " + e);
  process.exitCode = 1;
}
