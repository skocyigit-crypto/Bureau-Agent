/**
 * Seme le compte utilise par `verif-ecrans.mjs`: une organisation active et son
 * administrateur.
 *
 * Il passe par l'INSCRIPTION PUBLIQUE plutot que par un INSERT en base. Deux
 * raisons, et la seconde est la plus importante:
 *
 *  - aucune dependance en plus (ni pg, ni bcrypt): le script n'a besoin que de
 *    `fetch`, donc il tourne partout ou tourne Node;
 *  - le compte est cree par le MEME chemin qu'un vrai client. Un semis qui
 *    ecrit directement en base peut produire un etat qu'aucune inscription ne
 *    produirait (abonnement absent, acceptation des CGV manquante) — et les
 *    ecrans ouverts ensuite ne diraient plus rien de ce que voit un client.
 *
 * Idempotent: si le compte existe deja, l'API repond 409 et le script le dit
 * sans echouer.
 *
 * Usage: BASE=http://127.0.0.1:8080 node scripts/semer-verif.mjs
 */
const BASE = process.env.BASE ?? "http://127.0.0.1:8080";
const EMAIL = process.env.EMAIL ?? "verif@local.test";
const MOTDEPASSE = process.env.MOTDEPASSE ?? "VerifLocal!2026";

// Le banc ecrit un compte de test: il ne doit jamais viser autre chose qu'une
// API locale. Meme regle que verif-sauvegarde.mjs.
const hote = new URL(BASE).hostname;
if (!["127.0.0.1", "localhost", "::1", "api", "api-server"].includes(hote)) {
  console.error(`Refus: ${hote} n'est pas une API locale. Ce script cree un compte de test.`);
  process.exit(1);
}

const reponse = await fetch(`${BASE}/api/auth/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: BASE },
  body: JSON.stringify({
    orgName: "Verif Locale",
    firstName: "Verif",
    lastName: "Locale",
    email: EMAIL,
    password: MOTDEPASSE,
    // Exige depuis que la reserve aux professionnels est verifiee
    // (services/inscription-saisie.ts). Numero a cle de Luhn valide.
    siret: "552100554",
    acceptedTerms: true,
  }),
});

let corps = null;
try { corps = await reponse.json(); } catch { /* reponse sans corps */ }

// `process.exitCode` plutot que `process.exit()`: sur Windows, quitter
// pendant qu une connexion fetch se ferme fait avorter le processus (libuv),
// et le script rendait 127 alors qu il avait reussi.
if (reponse.status === 201) {
  console.log(`[semer-verif] compte cree: ${EMAIL} (organisation ${corps?.organisation?.id ?? "?"})`);
} else if (reponse.status === 409) {
  console.log(`[semer-verif] compte deja present: ${EMAIL}`);
} else {
  console.error(`[semer-verif] echec (${reponse.status}): ${JSON.stringify(corps)?.slice(0, 300)}`);
  process.exitCode = 1;
}
