#!/usr/bin/env node
/**
 * Creer — ou retablir — un acces super-administrateur.
 *
 * POURQUOI CE SCRIPT EXISTE. Aucun chemin ne creait de super-administrateur :
 * ni semis, ni variable d'environnement, ni ecran. Le role existe partout dans
 * le code (`requireSuperAdmin`, les ecrans `/admin/*`), mais rien ne permettait
 * d'en fabriquer un — sauf a ecrire la ligne en base a la main, avec le risque
 * de poser un `password_hash` que la connexion ne sait pas verifier.
 *
 * CE QU'IL NE FAIT PAS, ET C'EST VOULU. Il n'affiche JAMAIS le mot de passe
 * sur la sortie standard : il le lit dans un fichier que vous designez, ou en
 * genere un et l'ecrit dans un fichier dont il ne donne que le CHEMIN. Un mot
 * de passe affiche se retrouve dans l'historique du terminal, dans les
 * journaux de l'outil qui l'a lance, et parfois dans un rapport partage.
 *
 * Il ne cree pas non plus d'organisation par defaut en silence : un
 * super-administrateur rattache a une organisation inventee fausserait les
 * comptes et les licences. Il faut nommer celle qu'on veut, ou n'en mettre
 * aucune — le super-administrateur n'en exige pas.
 *
 * USAGE
 *   DATABASE_URL=... node scripts/creer-super-admin.mjs \
 *       --email=vous@exemple.fr --prenom=... --nom=... \
 *       [--organisation=<id>] [--mot-de-passe-fichier=<chemin>] [--confirmer]
 *
 * Sans `--confirmer`, il ne fait que DECRIRE ce qu'il changerait.
 * Sans `--mot-de-passe-fichier`, il en genere un et vous dit ou il l'a ecrit.
 *
 * Si le compte existe deja, il est PROMU : role super_admin, compte reactive,
 * compteur d'echecs remis a zero et verrouillage leve — ce sont les trois
 * raisons pour lesquelles une connexion echoue avec le bon mot de passe.
 */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, chmodSync } from "node:fs";
import { relative, resolve } from "node:path";
import { homedir } from "node:os";
import bcrypt from "bcryptjs";
import pg from "pg";

const { Client } = pg;

/** Les arguments, sous la forme --clef=valeur. */
const args = new Map(
  process.argv.slice(2).map((a) => {
    const i = a.indexOf("=");
    return i < 0 ? [a.replace(/^--/, ""), "true"] : [a.slice(2, i), a.slice(i + 1)];
  }),
);

const email = (args.get("email") ?? "").trim().toLowerCase();
const prenom = args.get("prenom") ?? "Super";
const nom = args.get("nom") ?? "Admin";
const organisation = args.get("organisation");
const fichierMotDePasse = args.get("mot-de-passe-fichier");
const confirmer = args.has("confirmer");

function mourir(message) {
  console.error(`[super-admin] ${message}`);
  process.exit(1);
}

if (!process.env.DATABASE_URL) mourir("DATABASE_URL est requise.");
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  mourir("--email=<adresse valide> est requis.");
}

/**
 * Le mot de passe : lu d'un fichier, ou genere.
 *
 * 24 octets en base64url : assez pour qu'une attaque hors ligne sur un hash
 * bcrypt cout 12 n'ait pas d'interet, et copiable d'un seul geste.
 *
 * ECRIT HORS DU DEPOT, et ce n'est pas un detail : ce depot est PUBLIC. La
 * premiere version ecrivait dans le repertoire courant — donc, lance depuis
 * la racine, a cote des sources. Le fichier n'etait ni suivi ni ignore : un
 * `git add -A` l'aurait mis en attente, et une poussee l'aurait publie. On
 * ecrit donc dans le repertoire personnel, jamais dans l'arbre de travail.
 */
function repertoirePersonnel() {
  return process.env.HOME || process.env.USERPROFILE || homedir();
}

function obtenirMotDePasse() {
  if (fichierMotDePasse) {
    const chemin = resolve(fichierMotDePasse);
    let contenu;
    try { contenu = readFileSync(chemin, "utf8"); } catch (e) {
      mourir(`fichier de mot de passe illisible : ${chemin} (${e.code ?? e.message})`);
    }
    const mdp = contenu.trim();
    if (mdp.length < 12) mourir("le mot de passe doit faire au moins 12 caracteres.");
    return { mdp, chemin, genere: false };
  }
  const mdp = randomBytes(24).toString("base64url");
  const chemin = resolve(repertoirePersonnel(), `super-admin-${Date.now()}.txt`);
  // Garde-fou : si le repertoire personnel se trouvait DANS le depot, on
  // refuse plutot que d'y deposer un secret.
  if (!relative(process.cwd(), chemin).startsWith("..")) {
    mourir(`refus d'ecrire un secret dans l'arbre de travail : ${chemin}`);
  }
  writeFileSync(chemin, `${mdp}\n`, { encoding: "utf8", mode: 0o600 });
  try { chmodSync(chemin, 0o600); } catch { /* systemes sans droits POSIX */ }
  return { mdp, chemin, genere: true };
}

const client = new Client({ connectionString: process.env.DATABASE_URL });

try {
  await client.connect();

  // Garde-fou : on refuse d'agir sur une base dont le schema n'est pas celui
  // attendu, plutot que d'ecrire une ligne que la connexion ne lira pas.
  const { rows: colonnes } = await client.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users'`,
  );
  const presentes = new Set(colonnes.map((c) => c.column_name));
  const requises = ["email", "password_hash", "role", "actif", "tentatives_echouees", "verrouille_jusqua"];
  const manquantes = requises.filter((c) => !presentes.has(c));
  if (colonnes.length === 0) mourir("table `users` introuvable : mauvaise base ?");
  if (manquantes.length > 0) mourir(`colonnes absentes de \`users\` : ${manquantes.join(", ")}`);

  if (organisation !== undefined) {
    const { rows } = await client.query("SELECT id, name FROM organisations WHERE id = $1", [organisation]);
    if (rows.length === 0) mourir(`organisation ${organisation} introuvable — creez-la d'abord, ou omettez --organisation.`);
    console.log(`[super-admin] organisation : ${rows[0].name} (#${rows[0].id})`);
  } else {
    console.log("[super-admin] sans organisation — le role super_admin n'en exige pas.");
  }

  const { rows: existants } = await client.query(
    "SELECT id, role, actif, verrouille_jusqua, tentatives_echouees FROM users WHERE lower(email) = $1",
    [email],
  );
  const existant = existants[0];

  if (existant) {
    console.log(
      `[super-admin] compte existant #${existant.id} : role=${existant.role}, actif=${existant.actif}, ` +
      `echecs=${existant.tentatives_echouees}, verrouille=${existant.verrouille_jusqua ? "oui" : "non"}`,
    );
  } else {
    console.log("[super-admin] aucun compte a cette adresse : il sera cree.");
  }

  if (!confirmer) {
    console.log("\n[super-admin] SIMULATION — rien n'a ete ecrit.");
    console.log("[super-admin] relancez avec --confirmer pour appliquer.");
    process.exit(0);
  }

  const { mdp, chemin, genere } = obtenirMotDePasse();
  const hash = await bcrypt.hash(mdp, 12);

  if (existant) {
    // On leve AUSSI le verrouillage et les echecs : ce sont les deux raisons
    // pour lesquelles une connexion echoue alors que le mot de passe est bon.
    await client.query(
      `UPDATE users SET password_hash = $1, role = 'super_admin', actif = true,
              tentatives_echouees = 0, verrouille_jusqua = NULL, updated_at = now()
        WHERE id = $2`,
      [hash, existant.id],
    );
    console.log(`[super-admin] compte #${existant.id} promu et debloque.`);
  } else {
    const { rows } = await client.query(
      `INSERT INTO users (email, password_hash, nom, prenom, role, actif, organisation_id)
       VALUES ($1, $2, $3, $4, 'super_admin', true, $5) RETURNING id`,
      [email, hash, nom, prenom, organisation ?? null],
    );
    console.log(`[super-admin] compte #${rows[0].id} cree.`);
  }

  console.log(`[super-admin] identifiant : ${email}`);
  console.log(`[super-admin] mot de passe ${genere ? "genere" : "lu"} dans : ${chemin}`);
  if (genere) {
    console.log("[super-admin] ouvrez ce fichier, notez le mot de passe, puis SUPPRIMEZ-LE.");
  }
  console.log("[super-admin] le mot de passe n'est volontairement pas affiche ici.");
} catch (err) {
  mourir(err?.message ?? String(err));
} finally {
  await client.end().catch(() => {});
}
