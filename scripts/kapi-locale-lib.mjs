/**
 * Lecture des etapes `run:` de .github/workflows/ci.yml, sans dependance.
 *
 * Pourquoi DERIVER plutot que recopier : une liste tenue a la main derive
 * du CI des qu'une etape y est ajoutee — et la porte locale verte ne dit plus
 * rien. Constat du 17/09 (session batiflow) : typecheck et tests verts, build
 * rouge sur une etape que personne ne lancait en local.
 */

/** Etapes ignorees en local : installation, outillage CI, portes GitHub. */
export const IGNOREES = [/^corepack enable$/, /^pnpm install/, /playwright install/, /\$\{\{/, /^python /];

/** Rend [{ job, nom, run, dossier }] pour les jobs demandes, dans l'ordre du fichier. */
export function etapesCi(yaml, jobs) {
  const lignes = yaml.split(/\r?\n/);
  const etapes = [];
  let job = null;
  let courante = null;
  const fermer = () => { if (courante && courante.run) etapes.push(courante); courante = null; };
  for (let i = 0; i < lignes.length; i++) {
    const l = lignes[i];
    const mJob = /^ {2}([a-z0-9-]+):\s*$/.exec(l);
    if (mJob) { fermer(); job = mJob[1]; continue; }
    if (!job || !jobs.includes(job)) continue;
    const mDebut = /^ {6}- (name|uses|run):\s*(.*)$/.exec(l);
    if (mDebut) {
      fermer();
      courante = { job, nom: "", run: "", dossier: null };
      if (mDebut[1] === "name") courante.nom = mDebut[2].trim();
      if (mDebut[1] === "run") courante.run = lireRun(lignes, i, mDebut[2]);
      continue;
    }
    if (!courante) continue;
    const mCle = /^ {8}(name|run|working-directory):\s*(.*)$/.exec(l);
    if (!mCle) continue;
    if (mCle[1] === "name") courante.nom = mCle[2].trim();
    if (mCle[1] === "working-directory") courante.dossier = mCle[2].trim();
    if (mCle[1] === "run") courante.run = lireRun(lignes, i, mCle[2]);
  }
  fermer();
  return etapes.filter((e) => !IGNOREES.some((re) => re.test(e.run)));
}

/** `run: cmd`, `run: >-` (plie) ou `run: |` (litteral). */
function lireRun(lignes, i, valeur) {
  const v = valeur.trim();
  if (v !== ">-" && v !== "|" && v !== ">") return v;
  const indent = (lignes[i].match(/^\s*/)[0].length) + 2;
  const corps = [];
  for (let k = i + 1; k < lignes.length; k++) {
    const l = lignes[k];
    if (l.trim() === "") { corps.push(""); continue; }
    if (l.match(/^\s*/)[0].length < indent) break;
    corps.push(l.slice(indent));
  }
  while (corps.length && corps[corps.length - 1] === "") corps.pop();
  return v === "|" ? corps.join("\n") : corps.join(" ").replace(/\s+/g, " ").trim();
}

/** Motifs de secrets a ne jamais pousser (depot PUBLIC). */
export const MOTIFS_SECRETS = [
  ["cle Stripe", /\b(sk|rk)_(live|test)_[0-9A-Za-z]{16,}/],
  ["cle Google", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["cle privee", /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["jeton GitHub", /\bgh[pousr]_[0-9A-Za-z]{36,}\b/],
  ["cle Anthropic/OpenAI", /\bsk-(ant-)?[0-9A-Za-z_-]{32,}\b/],
  ["URL Postgres avec mot de passe", /postgres(ql)?:\/\/[^:\s/]+:[^@\s]{8,}@(?!127\.0\.0\.1|localhost)/],
];

/** Lignes AJOUTEES d'un diff unifie qui ressemblent a un secret. */
export function secretsDansDiff(diff) {
  const trouves = [];
  let fichier = "";
  for (const l of diff.split(/\r?\n/)) {
    const m = /^\+\+\+ b\/(.*)$/.exec(l);
    if (m) { fichier = m[1]; continue; }
    if (!l.startsWith("+") || l.startsWith("+++")) continue;
    for (const [nom, re] of MOTIFS_SECRETS) if (re.test(l)) trouves.push(`${fichier}: ${nom}`);
  }
  return trouves;
}
