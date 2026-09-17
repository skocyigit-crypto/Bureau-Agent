/**
 * Porte locale : TOUTES les etapes du CI, sans s'arreter au premier rouge.
 *
 *   node scripts/kapi-locale.mjs            # typecheck-and-build + test
 *   KAPI_JOBS=typecheck-and-build node scripts/kapi-locale.mjs
 *   KAPI_DATABASE_URL=postgres://postgres@127.0.0.1:5432/base_de_test ...
 *
 * - Les etapes viennent de .github/workflows/ci.yml (voir kapi-locale-lib).
 * - Une porte qui s'arrete au premier echec cache le second : on les lance
 *   toutes et on rend la liste complete des rouges.
 * - La poussee de schema du job `test` ne tourne que sur une base LOCALE
 *   (127.0.0.1/localhost) : `push --force` sur une autre base detruit des
 *   donnees.
 * - Les lignes ajoutees depuis origin/main sont scannees pour des secrets :
 *   le depot est public.
 */
import { execSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { etapesCi, secretsDansDiff } from "./kapi-locale-lib.mjs";

const RACINE = new URL("..", import.meta.url);
const jobs = (process.env.KAPI_JOBS ?? "typecheck-and-build,test").split(",");
const etapes = etapesCi(readFileSync(new URL(".github/workflows/ci.yml", RACINE), "utf8"), jobs);
const base = process.env.KAPI_DATABASE_URL ?? "";
const baseLocale = /^postgres(ql)?:\/\/[^@]*@?(127\.0\.0\.1|localhost)[:/]/.test(base);

const resultats = [];
for (const e of etapes) {
  const schema = e.run.includes("drizzle-kit push");
  if (e.job === "test" && !baseLocale) {
    resultats.push({ ...e, statut: "IGNOREE", note: "KAPI_DATABASE_URL absente ou non locale" });
    continue;
  }
  if (schema && !baseLocale) { resultats.push({ ...e, statut: "IGNOREE", note: "base non locale" }); continue; }
  const debut = Date.now();
  console.log(`\n>>> [${e.job}] ${e.nom || e.run}`);
  // Sortie heritee : un processus enfant dont on ne lit pas le tube se bloque
  // quand le tampon est plein (piege releve par la session Assise).
  const r = spawnSync(e.run, {
    cwd: new URL(e.dossier ? `${e.dossier}/` : ".", RACINE), shell: true, stdio: "inherit",
    env: { ...process.env, ...(baseLocale ? { DATABASE_URL: base } : {}) },
  });
  resultats.push({ ...e, statut: r.status === 0 ? "OK" : "ROUGE", duree: Math.round((Date.now() - debut) / 1000) });
}

let diff = "";
try { diff = execSync("git diff origin/main...HEAD", { cwd: RACINE, maxBuffer: 64 * 1024 * 1024 }).toString(); } catch { /* pas de origin/main */ }
const secrets = secretsDansDiff(diff);

console.log("\n" + "=".repeat(70));
for (const r of resultats) console.log(`${r.statut.padEnd(8)} [${r.job}] ${r.nom || r.run}${r.duree != null ? ` (${r.duree}s)` : ""}${r.note ? ` — ${r.note}` : ""}`);
console.log(secrets.length ? `ROUGE    secrets dans le diff : ${secrets.join(", ")}` : "OK       aucun secret dans le diff depuis origin/main");
const rouges = resultats.filter((r) => r.statut === "ROUGE").length + (secrets.length ? 1 : 0);
console.log(rouges ? `\n${rouges} rouge(s).` : "\nPorte locale : tout est vert.");
process.exit(rouges ? 1 : 0);
