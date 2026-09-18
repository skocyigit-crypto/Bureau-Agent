import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Pages legales — ce qui peut etre publie, et ce qui ne peut pas l'etre.
 *
 * Verifie sur service-public.gouv.fr (fiche F31228, base LCEN art. 6 et 19):
 * le numero d'immatriculation au RCS et le TELEPHONE de l'hebergeur sont
 * obligatoires; le SIRET ne remplace pas le RCS. Le defaut de mentions legales
 * est puni d'un an d'emprisonnement et 75 000 € d'amende.
 *
 * Ces valeurs sont des faits propres a la societe (Kbis, contrat
 * d'hebergement) ou des decisions commerciales. Elles ne peuvent pas etre
 * devinees, et une valeur inventee sur une page legale engage la societe.
 *
 * D'ou deux mecanismes, et un principe commun: rien d'incomplet ne doit
 * atteindre le public, mais l'attente d'une saisie ne doit pas non plus
 * bloquer les deploiements sans rapport.
 *
 *  - Mentions legales: chaque valeur manquante fait disparaitre SA ligne
 *    (`@/lib/legal-info`). La page reste publiable et n'est pas degradee — la
 *    mention manquait deja avant. La remplir suffit a corriger la page.
 *  - CGV: les decisions manquantes sont au milieu de phrases contractuelles,
 *    donc la page ne peut pas etre publiee a moitie. Elle reste un projet NON
 *    ROUTE tant qu'elles ne sont pas prises. C'est ce que ce test verrouille:
 *    on ne peut pas la mettre en ligne par inadvertance.
 */

const PAGES_DIR = import.meta.dirname;
const SRC = path.resolve(PAGES_DIR, "..");

const read = (p: string) => fs.readFileSync(p, "utf8");
const readPage = (file: string) => read(path.join(PAGES_DIR, file));

/** Marqueurs de valeur en attente, quelle que soit la page. */
const PENDING = /<<[^>]*(à completer|à decider)[^>]*>>/g;

describe("pages publiees", () => {
  it("n'affichent aucun marqueur de valeur en attente", () => {
    // Une page legale affichant « à completer » est un defaut plus visible
    // encore que la mention manquante.
    for (const file of ["mentions-legales.tsx", "confidentialite.tsx", "cgu.tsx", "cgv.tsx", "dpa.tsx", "accessibilite.tsx"]) {
      const markers = readPage(file).match(PENDING) ?? [];
      expect(markers, `${file}: ${markers.join(" | ")}`).toEqual([]);
    }
  });

  it("omettent les mentions non renseignees au lieu de les inventer", () => {
    const source = readPage("mentions-legales.tsx");
    expect(source).toContain("isPublished(LEGAL_INFO.rcs)");
    expect(source).toContain("isPublished(LEGAL_INFO.hebergeurTelephone)");
  });

  it("conservent les mentions deja obtenues", () => {
    const source = readPage("mentions-legales.tsx");
    for (const mention of ["SIRET", "TVA intracommunautaire", "Directeur de la publication", "Google Cloud EMEA"]) {
      expect(source, `mention manquante: ${mention}`).toContain(mention);
    }
  });
});

describe("identite de l'editeur", () => {
  /**
   * Ces valeurs engagent la societe: elles doivent correspondre au registre,
   * pas a un souvenir.
   *
   * La forme juridique etait publiee comme « SASU ». Le registre officiel
   * porte la categorie juridique 5710, dont le libelle INSEE est « Societe
   * par actions simplifiee (SAS) » — la SASU releve du code 5720. La SASU
   * n'est d'ailleurs pas une forme distincte, seulement une SAS a associe
   * unique: ecrire « SAS » est exact dans tous les cas, « SASU » seulement
   * s'il n'y a qu'un associe. Corrige apres verification au registre et
   * confirmation de l'editeur sur son Kbis.
   */
  it("annonce la forme juridique du registre", () => {
    for (const page of ["mentions-legales.tsx", "cgu.tsx", "cgv.tsx", "confidentialite.tsx", "gizlilik.tsx"]) {
      const source = readPage(page);
      if (!source.includes("SK GROUP")) continue;
      expect(source, `${page}: forme juridique obsolete`).not.toContain("SASU");
    }
  });

  it("porte les identifiants tels qu'ils figurent au registre", () => {
    const source = readPage("mentions-legales.tsx");
    // Releves sur recherche-entreprises.api.gouv.fr (INSEE) le 2026-09-01.
    expect(source).toContain("890 977 648 00017");
    expect(source).toContain("17 rue Saint-Exupéry, 67500 Haguenau");
  });

  it("publie le RCS et le capital une fois obtenus", () => {
    const legal = fs.readFileSync(path.join(SRC, "lib", "legal-info.ts"), "utf8");
    // Confirmes par l'editeur sur son Kbis: greffe de Strasbourg, 1 000 €.
    expect(legal).toMatch(/rcs:\s*"Strasbourg 890 977 648"/);
    expect(legal).toMatch(/capitalSocial:\s*"1 000 €"/);
    // Le prefixe « RCS » est porte par l'etiquette de la ligne, pas par la
    // valeur: le laisser ici afficherait « RCS : RCS Strasbourg ... ».
    expect(legal).not.toMatch(/rcs:\s*"RCS /);
  });
});

describe("CGV en projet", () => {
  const cgv = readPage("cgv.tsx");
  const hasPendingDecisions = (cgv.match(PENDING) ?? []).length > 0;

  it("n'est ni routee ni liee tant que des decisions restent en attente", () => {
    if (!hasPendingDecisions) return; // decisions prises: la page peut etre publiee

    const app = read(path.join(SRC, "App.tsx"));
    const footer = read(path.join(SRC, "components", "layout", "Footer.tsx"));

    expect(app, "CGV routee alors que des clauses sont incompletes").not.toContain('path="/cgv"');
    expect(footer, "CGV liee alors que des clauses sont incompletes").not.toContain('href="/cgv"');
  });

  it("garde la trace des decisions qui restent a prendre", () => {
    // Le projet doit rester explicite sur ce qui manque, sinon il sera publie
    // un jour tel quel.
    expect(cgv).toContain("A FAIRE RELIRE PAR UN CONSEIL");
  });

  it("couvre les clauses qui ne dependent d'aucune decision", () => {
    // Ce qui decoule de la loi est deja redige et ne doit pas disparaitre.
    for (const clause of ["L441-10", "réversibilité", "Droit applicable"]) {
      expect(cgv, `clause manquante: ${clause}`).toMatch(new RegExp(clause, "i"));
    }
  });
});

describe("adresses e-mail publiees", () => {
  /**
   * Une adresse imprimee sur une page legale doit recevoir du courrier. La
   * declaration d'accessibilite et la politique de confidentialite doivent
   * offrir un canal de contact qui FONCTIONNE, et les mentions legales un
   * editeur joignable; une boite sans destination transforme chacune de ces
   * obligations en promesse vide.
   *
   * Le routage se configure dans le tableau de bord Cloudflare, pas ici — ce
   * depot ne peut donc pas prouver qu'une adresse recoit vraiment. Ce qu'il
   * peut garantir, c'est qu'aucune adresse ne soit publiee sans figurer sur la
   * liste a router du README du Worker: c'est precisement l'oubli qui a laisse
   * quatre adresses hors routage.
   */
  const README = path.resolve(
    SRC, "..", "..", "..", "deploy", "cloudflare-email-worker", "README.md",
  );
  const routed = read(README);
  const EMAIL = /[a-zA-Z0-9._-]+@agentdebureau\.fr/g;

  it("figurent toutes sur la liste a router", () => {
    const published = new Set<string>();
    for (const file of fs.readdirSync(PAGES_DIR).filter((f) => f.endsWith(".tsx"))) {
      for (const address of readPage(file).match(EMAIL) ?? []) {
        published.add(address);
      }
    }
    expect(published.size, "aucune adresse trouvee — le scan est casse").toBeGreaterThan(0);

    const missing = [...published].filter((a) => !routed.includes(a));
    expect(
      missing,
      `Adresses publiees mais absentes de la liste a router:\n${missing.join("\n")}`,
    ).toEqual([]);
  });
});

describe("declaration d'accessibilite", () => {
  const page = readPage("accessibilite.tsx");

  it("annonce l'etat reel sans inventer de taux de conformite", () => {
    // Declarer une conformite non mesuree serait une fausse declaration.
    expect(page).toContain("non conforme");
    expect(page).not.toMatch(/taux de conformité (est|de) \d/);
  });

  it("ouvre une voie de contact et une voie de recours", () => {
    // `contact@` plutot qu'une adresse dediee: elle est deja routee, donc elle
    // recoit vraiment. Le canal de signalement est un element obligatoire de la
    // declaration — une adresse specialisee qui n'existe pas ne vaut rien.
    expect(page).toContain("contact@agentdebureau.fr");
    expect(page).toContain("Défenseur des droits");
  });
});

/**
 * La dette de mentions obligatoires, comptee plutot qu'oubliee.
 *
 * Le 18/09/2026, `hebergeurTelephone` etait vide depuis des semaines. La page
 * se comportait correctement — elle masque la ligne au lieu d'inventer un
 * numero — et c'est precisement pourquoi le manque etait invisible: rien ne
 * distinguait « pas encore renseigne » de « rien a renseigner ».
 *
 * Ce test ne bloque pas les deploiements: il fige le NOMBRE de mentions
 * obligatoires encore vides. Remplir la valeur fait echouer le test, qui
 * demande alors de baisser le compteur — c'est le seul moment ou une dette
 * legale doit interrompre quelqu'un. L'augmenter exige la meme décision
 * explicite.
 *
 * Reference: LCEN art. 6-III (identification de l'hebergeur: nom, adresse ET
 * telephone), C. com. R123-237 (RCS, capital). Le defaut de mentions legales
 * est puni d'un an d'emprisonnement et 75 000 € d'amende (LCEN art. 6-VI).
 */
describe("dette de mentions legales obligatoires", () => {
  const INFOS = read(path.join(SRC, "lib", "legal-info.ts"));

  /**
   * Valeur litterale d'un champ de LEGAL_INFO, ou null s'il n'existe pas.
   *
   * Lecture ligne a ligne plutot qu'une expression reguliere multiligne: le
   * fichier est en CRLF sous Windows et en LF ailleurs, et une expression qui
   * depend du saut de ligne ne mesurerait plus la meme chose selon la machine.
   */
  function valeur(champ: string): string | null {
    for (const ligne of INFOS.split("\n")) {
      const debut = ligne.trim();
      if (!debut.startsWith(`${champ}:`)) continue;
      const guillemets = debut.match(/"([^"]*)"/);
      if (guillemets) return guillemets[1]!;
    }
    return null;
  }

  const OBLIGATOIRES = ["rcs", "capitalSocial", "hebergeurTelephone"] as const;

  /**
   * Mentions obligatoires encore vides. A BAISSER des qu'une valeur est
   * obtenue — c'est le but de ce compteur.
   *
   * 18/09/2026: 1 — le telephone de l'hebergeur (contrat Google Cloud EMEA).
   */
  const DETTE_ATTENDUE = 1;

  it("chaque mention obligatoire existe dans le fichier", () => {
    for (const champ of OBLIGATOIRES) {
      expect(valeur(champ), `champ absent de legal-info.ts: ${champ}`).not.toBeNull();
    }
  });

  it("le nombre de mentions obligatoires vides est celui qu'on a decide", () => {
    const vides = OBLIGATOIRES.filter((c) => (valeur(c) ?? "").trim() === "");
    expect(
      vides.length,
      vides.length < DETTE_ATTENDUE
        ? `Bonne nouvelle: ${vides.join(", ") || "plus rien"} — baissez DETTE_ATTENDUE a ${vides.length}.`
        : `Mentions obligatoires vides: ${vides.join(", ")}. Les remplir, ou assumer la hausse explicitement.`,
    ).toBe(DETTE_ATTENDUE);
  });

  it("la dette restante est nommee, pas anonyme", () => {
    // Un compteur sans nom ne dit pas quoi aller chercher ni aupres de qui.
    const vides = OBLIGATOIRES.filter((c) => (valeur(c) ?? "").trim() === "");
    for (const champ of vides) {
      // La valeur manquante doit etre accompagnee, quelque part dans le
      // fichier, de l'endroit ou aller la chercher.
      const indexChamp = INFOS.indexOf(`${champ}:`);
      const contexte = INFOS.slice(Math.max(0, indexChamp - 600), indexChamp);
      expect(
        /Source|COMMENT COMPLETER/.test(contexte),
        `${champ} est vide sans indiquer ou trouver la valeur`,
      ).toBe(true);
    }
  });

  it("une mention obligatoire deja obtenue ne redevient pas vide en silence", () => {
    expect(valeur("rcs")).not.toBe("");
    expect(valeur("capitalSocial")).not.toBe("");
  });
});

/**
 * Les durees de conservation annoncees doivent etre celles qui sont appliquees.
 *
 * Mesure le 18/09: la politique annoncait « Enregistrements d'appels : selon
 * parametrage client (max. 12 mois par defaut) ». Aucun reglage par client
 * n'existe — `services/retention-cron.ts` applique une duree unique pour toute
 * la plateforme. Annoncer un choix qu'on ne propose pas, c'est promettre une
 * maitrise que le client n'a pas, alors que l'article 13 du RGPD demande
 * d'indiquer la duree exacte.
 *
 * Ce test lit la duree DANS LE CODE qui l'applique: recopier la valeur ne
 * verifierait que la copie.
 */
describe("durees de conservation: annoncees = appliquees", () => {
  const POLITIQUE = readPage("confidentialite.tsx");
  const CRON = read(path.resolve(PAGES_DIR, "..", "..", "..", "api-server", "src", "services", "retention-cron.ts"));

  /** La duree appliquee aux enregistrements d'appel, en jours. */
  function joursAppliques(): number {
    const m = CRON.match(/RETENTION_DAYS = Number\(process\.env\.CALL_RECORDING_RETENTION_DAYS \?\? (\d+)\)/);
    expect(m, "duree de retention introuvable dans retention-cron.ts").not.toBeNull();
    return Number(m![1]);
  }

  it("la politique annonce la duree reellement appliquee", () => {
    const mois = Math.round(joursAppliques() / 30.44);
    expect(POLITIQUE, `le cron efface a ${joursAppliques()} jours (~${mois} mois)`).toContain(`${mois} mois`);
  });

  it("elle n'annonce plus un reglage par client qui n'existe pas", () => {
    const parametrable = /Enregistrements d'appels[^<]*param[eé]trage client/i.test(POLITIQUE);
    const reglageExiste = /organisationId|orgId/.test(CRON.split("RETENTION_DAYS")[1] ?? "");
    expect(parametrable && !reglageExiste, "reglage annonce mais absent du code").toBe(false);
  });

  it("elle dit ce qui se passe au terme du delai", () => {
    expect(POLITIQUE).toMatch(/effac[eé]s? automatiquement|supprim[eé]s? automatiquement/i);
  });

  it("la purge efface bien l'enregistrement ET sa transcription", () => {
    // Effacer l'URL en gardant le texte integral de l'appel ne conserverait
    // rien de moins: la transcription est la meme donnee, ecrite autrement.
    expect(CRON).toMatch(/recordingUrl: null, transcription: null/);
  });
});
