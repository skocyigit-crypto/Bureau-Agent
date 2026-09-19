/**
 * Une icone cliquable doit tenir ses trois promesses.
 *
 * Balayage du 19/09 sur les 187 fichiers de l'application, en trois mesures :
 *
 *  1. OU MENE-T-ELLE ? Chaque destination de navigation doit correspondre a
 *     une `<Route path>` declaree. Resultat : aucune destination cassee.
 *  2. QUE CONSERVE-T-ELLE ? Chaque chemin d'API appele doit exister dans
 *     l'inventaire des routes du serveur (675 operations). Resultat : les
 *     quinze signalements etaient des artefacts — quatorze chemins tronques
 *     par l'interpolation, et `/api/voice/live`, qui est une montee en
 *     WebSocket et n'a donc pas a figurer dans un inventaire HTTP.
 *  3. FAIT-ELLE QUELQUE CHOSE ? Un bouton porteur d'une icone doit avoir un
 *     gestionnaire, etre un `submit`, etre `disabled` a dessein, ou etre
 *     enveloppe par son declencheur. UN seul manquait vraiment :
 *     `pages/contact-detail.tsx`, le crayon « Modifier » de chaque tache
 *     liee. Il prenait le focus au clavier et s'annoncait au lecteur
 *     d'ecran, sans rien faire — le pire etat pour une commande, puisqu'elle
 *     promet une action qui n'existe pas.
 *
 * Le detecteur a demande trois corrections avant de dire vrai, et c'est la
 * lecon a garder : `<Button([^>]*)>` coupe les attributs au premier `>`,
 * c'est-a-dire au milieu de `onClick={() => ...}`, et faisait passer pour
 * muets tous les boutons a gestionnaire inline (75 signalements, dont 66
 * faux). On lit donc les attributs en comptant les accolades, et on regarde
 * aussi le declencheur qui ENVELOPPE le bouton.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dirname, "..");

function fichiers(dir: string, acc: string[] = []): string[] {
  for (const nom of readdirSync(dir)) {
    const p = join(dir, nom);
    if (statSync(p).isDirectory()) fichiers(p, acc);
    else if (/\.tsx$/.test(nom) && !/\.test\./.test(nom)) acc.push(p);
  }
  return acc;
}

const sources = fichiers(SRC);

/** Attributs de la balise, en comptant les accolades (cf. entete). */
function attributs(src: string, debut: number): { attrs: string; apres: number } {
  let i = debut;
  let profondeur = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "{") profondeur++;
    else if (c === "}") profondeur--;
    else if (c === ">" && profondeur === 0) break;
    i++;
  }
  return { attrs: src.slice(debut, i), apres: i };
}

const ENVELOPPES = /<(Link|a|DialogTrigger|DropdownMenuTrigger|PopoverTrigger|SheetTrigger|AlertDialogTrigger|TooltipTrigger|label)\b[\s\S]{0,200}?>\s*$/;

describe("les boutons a icone font quelque chose", () => {
  const muets: string[] = [];

  for (const fichier of sources) {
    const src = readFileSync(fichier, "utf8");
    for (const m of src.matchAll(/<Button\b/g)) {
      const { attrs, apres } = attributs(src, m.index! + 7);
      const fin = src.indexOf("</Button>", apres);
      if (fin === -1) continue;
      const contenu = src.slice(apres + 1, fin);
      if (contenu.length > 400) continue;

      const aIcone =
        /<[A-Z][A-Za-z0-9]*\s+className="[^"]*\bw-\d/.test(contenu) ||
        /<[A-Z][A-Za-z0-9]*\s*\/>/.test(contenu);
      if (!aIcone) continue;

      // `disabled` est une inaction VOULUE et visible: chargement en cours,
      // plateforme indisponible, fonction annoncee. Elle ne ment pas.
      const agit =
        /onClick|type="submit"|onSubmit|form=|asChild|disabled/.test(attrs) ||
        /<(a|Link)\b/.test(contenu) ||
        ENVELOPPES.test(src.slice(Math.max(0, m.index! - 400), m.index!));

      if (!agit) {
        const ligne = src.slice(0, m.index!).split("\n").length;
        muets.push(`${fichier.replace(SRC, "")}:${ligne}`);
      }
    }
  }

  it("aucun bouton a icone n'est muet", () => {
    expect(
      muets,
      `bouton focusable, annonce au lecteur d'ecran, et sans effet:\n${muets.join("\n")}`,
    ).toEqual([]);
  });

  it("le balayage lit bien l'application", () => {
    // Un detecteur qui n'ouvre aucun fichier passerait toujours.
    expect(sources.length, "aucun fichier balaye: ce controle ne prouve rien").toBeGreaterThan(100);
  });

  it("il reconnait un bouton muet", () => {
    const exemple = `<Button variant="ghost" size="icon"><Edit className="w-4 h-4" /></Button>`;
    const { attrs, apres } = attributs(exemple, 7);
    const contenu = exemple.slice(apres + 1, exemple.indexOf("</Button>"));
    const agit = /onClick|type="submit"|onSubmit|form=|asChild|disabled/.test(attrs) || /<(a|Link)\b/.test(contenu);
    expect(agit, "le detecteur ne verrait pas le defaut qu'il est cense voir").toBe(false);
  });

  it("il ne se laisse pas tromper par la fleche d'une fonction inline", () => {
    // C'est le faux positif qui noyait la mesure: le `>` de `=>` fermait la
    // balise pour une regex naive.
    const exemple = `<Button onClick={() => setPage(p => p + 1)}><ChevronRight className="w-4 h-4" /></Button>`;
    const { attrs } = attributs(exemple, 7);
    expect(attrs).toContain("onClick");
  });

  it("il tient compte du declencheur qui enveloppe le bouton", () => {
    const exemple = `<Link href="/taches">\n  <Button><Plus className="w-4 h-4" /></Button>`;
    const i = exemple.indexOf("<Button");
    expect(ENVELOPPES.test(exemple.slice(0, i))).toBe(true);
  });
});

describe("les destinations de navigation existent", () => {
  const app = readFileSync(join(SRC, "App.tsx"), "utf8");
  const routes = [...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
  const motifs = routes.map((r) => new RegExp("^" + r.replace(/:[^/]+/g, "[^/]+").replace(/\//g, "\\/") + "$"));
  const existe = (chemin: string) => motifs.some((re) => re.test(chemin));

  const cassees: string[] = [];
  for (const fichier of sources) {
    const src = readFileSync(fichier, "utf8");
    src.split("\n").forEach((ligne, i) => {
      if (/^\s*(\/\/|\*)/.test(ligne)) return;
      for (const m of ligne.matchAll(/(?:setLocation|navigate)\(\s*["'`](\/[^"'`${?]*)["'`?]/g)) {
        if (!existe(m[1])) cassees.push(`${fichier.replace(SRC, "")}:${i + 1} -> ${m[1]}`);
      }
      for (const m of ligne.matchAll(/href=["'](\/[^"'#?${]*)["']/g)) {
        if (m[1].startsWith("/api/") || m[1].startsWith("//")) continue;
        if (!existe(m[1])) cassees.push(`${fichier.replace(SRC, "")}:${i + 1} -> ${m[1]}`);
      }
    });
  }

  it("le routeur declare bien des routes", () => {
    expect(routes.length, "aucune route lue: la comparaison ne prouve rien").toBeGreaterThan(30);
  });

  it("aucun clic ne mene a la page introuvable", () => {
    expect(cassees, `destination absente du routeur:\n${cassees.join("\n")}`).toEqual([]);
  });
});
