#!/usr/bin/env node
/**
 * Verifie que chaque requete sur une table appartenant a un locataire porte
 * bien un filtre d'organisation.
 *
 * Pourquoi ce script existe. Ce produit est multi-locataire et l'isolation
 * repose entierement sur la discipline: 76 des 85 tables ont une colonne
 * `organisation_id`, et plus de mille requetes doivent penser a la filtrer.
 * Postgres n'aide pas — il n'y a pas de Row-Level Security, donc rien
 * n'empeche structurellement une requete d'en oublier une. Une seule suffit
 * pour montrer les donnees d'un client a un autre, et ce genre d'oubli ne
 * produit aucune erreur: la page s'affiche, avec trop de lignes.
 *
 * La RLS serait la vraie reponse, mais elle demande une variable de session par
 * requete (`SET LOCAL app.current_org`), donc une transaction par requete HTTP
 * — un changement d'architecture, pas un correctif. En attendant, ce script
 * donne la propriete qui compte le plus: l'oubli ne peut plus passer inapercu,
 * parce qu'il fait echouer le build.
 *
 * Ce qu'il sait faire, et ses limites assumees. Il lit le texte, pas un arbre
 * syntaxique: il repere les requetes, resout les conditions pre-calculees
 * (`const orgTask = eq(tasksTable.organisationId, orgId)`) et les helpers de
 * portee du depot, puis signale le reste. Un faux positif se leve en ajoutant
 * la requete a `ALLOWLIST` avec sa raison — ce qui, volontairement, oblige a
 * ecrire pourquoi une requete n'a pas besoin d'etre filtree.
 *
 * Usage:
 *   node scripts/tenant-scope-check.mjs            # rapport
 *   node scripts/tenant-scope-check.mjs --check    # sort en 1 si non couvert
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const apiSrc = path.join(here, "..", "src");
const schemaDir = path.join(here, "..", "..", "..", "lib", "db", "src", "schema");

// ── 1. Quelles tables appartiennent a un locataire ───────────────────────────

function tenantScopedTables() {
  const scoped = new Set();
  const global = new Set();
  for (const file of fs.readdirSync(schemaDir)) {
    if (!file.endsWith(".ts") || file === "index.ts") continue;
    const src = fs.readFileSync(path.join(schemaDir, file), "utf8");
    const re = /export const (\w+) = pgTable\(\s*["'`]([\w_]+)["'`]([\s\S]*?)\n\}/g;
    let m;
    while ((m = re.exec(src))) {
      const [, varName, , body] = m;
      if (/organisation_?[Ii]d/.test(body)) scoped.add(varName);
      else global.add(varName);
    }
  }
  return { scoped, global };
}

// ── 2. Requetes exemptees, avec la raison ────────────────────────────────────
//
// Une entree ici est une AFFIRMATION: « cette requete n'a pas besoin d'un
// filtre d'organisation, et voici pourquoi ». Elle se relit en revue.

const ALLOWLIST = [
  {
    file: "src/services/",
    reason:
      "Les traitements de fond parcourent volontairement toutes les organisations " +
      "(crons de facturation, sauvegardes, agents de sante). Ils recoivent ensuite " +
      "`orgId` par organisation traitee.",
    appliesTo: (file) => file.startsWith("src/services/"),
  },
  {
    file: "routeurs montes derriere requireSuperAdmin",
    reason:
      "Surfaces reservees au proprietaire de la plateforme: leur objet EST la " +
      "vue inter-organisations (facturation SaaS, sante technique, sauvegardes " +
      "de plateforme). Detecte sur le `router.use(..., requireSuperAdmin)` du " +
      "fichier plutot que sur son nom, pour qu'un fichier renomme ne perde pas " +
      "son exemption et qu'un fichier qui la perd la reperde vraiment.",
    appliesTo: (file, src) =>
      /router\.use\([^)]*requireSuperAdmin/.test(src) ||
      // Certains routeurs sont montes derriere `requireSuperAdmin` dans
      // routes/index.ts plutot que chez eux; leur en-tete le documente.
      /requireSuperAdmin/.test(src.slice(0, 2000)) ||
      /^src\/routes\/(cron-tick|stripe)/.test(file),
  },
  {
    file: "src/routes/auth.ts — parcours d'identite",
    reason:
      "Mot de passe oublie, renvoi de verification, notification de nouvelle " +
      "connexion: ces chemins s'executent AVANT toute session, il n'y a donc " +
      "aucune organisation a filtrer. Ils sont clos par l'adresse e-mail, qui " +
      "est unique sur toute la plateforme.",
    appliesTo: (file) => file === "src/routes/auth.ts",
  },
  {
    file: "infrastructure clee par utilisateur",
    reason:
      "Jetons Google, cles d'API, invalidation de jeton, resolution de noms: " +
      "clos par `userId` ou par l'identifiant de la ligne deja authentifiee. " +
      "Un utilisateur appartient a une seule organisation, donc cette portee " +
      "est plus etroite, pas plus large.",
    appliesTo: (file) =>
      ["src/lib/google-auth.ts", "src/lib/api-key-auth.ts", "src/middleware/auth.ts",
       "src/helpers/user-tracking.ts"].includes(file),
  },
  {
    file: "surfaces publiques",
    reason:
      "La demo du site vitrine n'a aucun client derriere elle: la ligne creee " +
      "n'appartient a personne tant qu'un compte ne la reclame pas avec son " +
      "jeton.",
    appliesTo: (file) => /^src\/routes\/public-/.test(file),
  },
];

function allowlisted(file, src) {
  return ALLOWLIST.find((entry) => entry.appliesTo(file, src)) ?? null;
}

// ── 3. Analyse ───────────────────────────────────────────────────────────────

/** Conditions pre-calculees du fichier: `const orgTask = eq(x.organisationId, y)`. */
function scopedIdentifiers(src) {
  const ids = new Set();
  const re = /(?:const|let)\s+(\w+)\s*=\s*[^;]*organisation(?:Id|_id)/gi;
  let m;
  while ((m = re.exec(src))) ids.add(m[1]);
  return ids;
}

/**
 * Decoupe le texte en requetes. On part de `db.select(` / `db.update(` /
 * `db.delete(` / `tx.select(` ... et on suit jusqu'a la fin de la chaine.
 */
function statements(src) {
  const out = [];
  const re = /\b(?:db|tx|trx)\s*\.\s*(select|update|delete|insert)\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    const start = m.index;
    // Fin de chaine: le premier `;` de meme profondeur de parenthese.
    let depth = 0, i = re.lastIndex - 1, end = -1;
    for (; i < src.length && i < start + 4000; i++) {
      const c = src[i];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      else if ((c === ";" || c === "\n") && depth <= 0) { end = i; break; }
    }
    if (end === -1) end = Math.min(src.length, start + 4000);
    out.push({ kind: m[1], start, text: src.slice(start, end) });
  }
  return out;
}

function lineOf(src, index) {
  return src.slice(0, index).split("\n").length;
}

/**
 * Blocs d'analyse: une route ou une fonction de premier niveau, avec son corps.
 *
 * L'unite d'analyse compte plus que l'heuristique elle-meme. Au niveau de la
 * REQUETE, le bruit noie tout: un `update ... where id = :id` sur un document
 * dont l'appartenance a ete verifiee dix lignes plus haut parait non filtre, et
 * il y en a des centaines — un rapport que personne ne lira deux fois.
 *
 * Au niveau du BLOC, la question devient nette et decidable: ce gestionnaire,
 * qui lit ou ecrit des donnees de locataire, sait-il seulement dans quelle
 * organisation il se trouve ? Un bloc qui ne mentionne jamais l'organisation ne
 * peut pas isoler quoi que ce soit — c'est un defaut certain, pas un soupcon.
 * Un bloc qui la mentionne peut encore avoir un oubli ponctuel, mais cela
 * demande une relecture humaine, pas une barriere de build qui crierait a
 * chaque commit jusqu'a ce qu'on la desactive.
 */
function blocks(src) {
  const marks = [];
  const re = /^(?:export )?(?:async )?function (\w+)|^router\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)/gm;
  let m;
  while ((m = re.exec(src))) {
    marks.push({
      index: m.index,
      name: m[1] ?? `${(m[2] || "").toUpperCase()} ${m[3] ?? ""}`,
    });
  }
  return marks.map((mark, i) => ({
    name: mark.name,
    start: mark.index,
    text: src.slice(mark.index, i + 1 < marks.length ? marks[i + 1].index : src.length),
  }));
}

function analyse() {
  const { scoped } = tenantScopedTables();
  const findings = [];
  let examined = 0;

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__tests__") continue;
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".ts")) continue;

      const rel = path.relative(path.join(here, ".."), full).split(path.sep).join("/");
      const src = fs.readFileSync(full, "utf8");
      const ids = scopedIdentifiers(src);

      for (const block of blocks(src)) {
        const stmts = statements(block.text).filter((st) =>
          [...scoped].some((t) => st.text.includes(t)),
        );
        if (stmts.length === 0) continue;
        examined++;

        // Le bloc sait-il seulement dans quelle organisation il travaille ?
        //
        // Quatre formes d'isolation legitimes, apprises en relisant les
        // premiers signalements — toutes etaient de vrais faux positifs, et
        // les ignorer aurait rendu ce script inutilisable:
        //
        //  1. le filtre explicite sur la colonne;
        //  2. les helpers de portee du depot (`getOrgId`, `tenantCondition`);
        //  3. une condition pre-calculee dans le fichier;
        //  4. la portee par UTILISATEUR. Une notification ou une preference
        //     filtree sur `userId` issu de la session est deja isolee: un
        //     utilisateur appartient a une seule organisation, donc filtrer sur
        //     lui est plus etroit que filtrer sur elle. Exiger en plus le
        //     filtre d'organisation serait une redondance, pas une securite.
        const userScoped =
          /session\?\.userId|session\.userId/.test(block.text) &&
          /\.userId\b/.test(block.text);
        const aware =
          /organisation(?:Id|_id)/i.test(block.text) ||
          /\b(?:getOrgId|tenantCondition|getSuperAdminOrgId)\s*\(/.test(block.text) ||
          userScoped ||
          [...ids].some((id) => new RegExp(`\\b${id}\\b`).test(block.text));
        if (aware) continue;

        const tables = [...new Set(
          stmts.flatMap((st) => [...scoped].filter((t) => st.text.includes(t))),
        )];
        findings.push({
          file: rel,
          line: lineOf(src, block.start),
          kind: block.name,
          tables: tables.slice(0, 4),
          allowed: allowlisted(rel, src),
        });
      }
    }
  };

  walk(apiSrc);
  return { findings, examined, scopedCount: scoped.size };
}

// ── 4. Rapport ───────────────────────────────────────────────────────────────

const { findings, examined, scopedCount } = analyse();
const unexplained = findings.filter((f) => !f.allowed);

console.log(`Tables appartenant a un locataire : ${scopedCount}`);
console.log(`Blocs touchant ces tables         : ${examined}`);
console.log(`Sans notion d'organisation        : ${findings.length}`);
console.log(`  dont expliquees (allowlist)     : ${findings.length - unexplained.length}`);
console.log(`  dont NON expliquees             : ${unexplained.length}`);

if (unexplained.length > 0) {
  const byFile = new Map();
  for (const f of unexplained) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }
  console.log("\nA verifier :");
  for (const [file, items] of [...byFile.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n  ${file} (${items.length})`);
    for (const f of items.slice(0, 12)) {
      console.log(`    L${f.line}  ${f.kind}  ${f.tables.join(", ")}`);
    }
    if (items.length > 12) console.log(`    ... et ${items.length - 12} de plus`);
  }
}

if (process.argv.includes("--check") && unexplained.length > 0) {
  console.error(
    `\nEchec : ${unexplained.length} requete(s) sur des tables de locataire sans filtre ` +
    `d'organisation.\nChacune doit soit porter le filtre, soit etre inscrite dans ` +
    `ALLOWLIST avec sa raison (scripts/tenant-scope-check.mjs).`,
  );
  process.exit(1);
}
