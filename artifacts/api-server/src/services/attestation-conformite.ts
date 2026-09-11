/**
 * attestation-conformite.ts — l'attestation individuelle de l'editeur.
 *
 * L'article 286-I-3° bis du CGI impose a l'assujetti qui enregistre les
 * reglements de ses clients un logiciel satisfaisant quatre conditions. Il doit
 * pouvoir le PROUVER: par un certificat d'organisme accredite (NF525), ou par
 * une attestation individuelle de l'editeur. La loi de finances pour 2025 avait
 * supprime cette seconde voie; celle pour 2026 l'a retablie.
 *
 * L'amende est de 7 500 € par logiciel non conforme, et c'est l'utilisateur qui
 * la paie. L'attestation est donc, litteralement, la piece qui protege le
 * client — et l'editeur qui la signe engage sa responsabilite sur son contenu.
 *
 * CE QUE CE MODULE REFUSE DE FAIRE
 *
 * Il ne produit pas un texte publicitaire. Une attestation qui affirmerait plus
 * que ce que le logiciel fait serait pire qu'une absence d'attestation: elle
 * donnerait au client une fausse assurance jusqu'au controle, et exposerait
 * l'editeur.
 *
 * Chaque affirmation est donc rattachee a un mecanisme VERIFIABLE, nomme dans
 * le document, que le client peut declencher lui-meme:
 *
 *     GET /api/encaissements/verifier       -> inalterabilite, securisation
 *     GET /api/encaissements/conservation   -> conservation
 *     GET /api/encaissements/archive        -> archivage
 *
 * Une attestation dont on peut refaire la demonstration est d'une autre nature
 * qu'une attestation qu'il faut croire.
 *
 * Module PUR: le texte depend des donnees fournies, pas de l'heure ni de la
 * base. Deux appels avec les memes entrees produisent le meme document — ce
 * qui permet de le tester mot pour mot.
 */

export interface IdentiteEditeur {
  raisonSociale: string;
  siret: string | null;
  adresse: string | null;
}

export interface IdentiteClient {
  raisonSociale: string;
  siret: string | null;
}

export interface ContexteAttestation {
  editeur: IdentiteEditeur;
  client: IdentiteClient;
  /** Nom et version du logiciel, tels qu'ils sont deployes. */
  logiciel: string;
  version: string;
  /** Date d'emission, ISO 8601. Injectee pour rendre le document testable. */
  emiseLe: string;
}

/**
 * Les quatre conditions, avec le mecanisme qui les realise.
 *
 * Le libelle de chaque condition reprend les termes de l'article, sans les
 * reformuler: une attestation qui paraphraserait la loi laisserait un doute sur
 * ce qu'elle couvre exactement.
 */
export const CONDITIONS = [
  {
    nom: "Inalterabilite",
    exigence:
      "Les donnees de reglement enregistrees ne peuvent etre modifiees ni supprimees apres leur enregistrement.",
    mecanisme:
      "Les reglements sont inscrits dans un journal en ajout seul. Aucune interface, aucune " +
      "route de l'API ne permet de modifier ni de supprimer une ecriture: les verbes HTTP " +
      "correspondants n'existent pas. Une correction s'effectue exclusivement par une ecriture " +
      "inverse, qui s'ajoute a la suite du journal et laisse l'ecriture d'origine visible.",
    verification: "GET /api/encaissements/verifier",
  },
  {
    nom: "Securisation",
    exigence:
      "Les donnees d'origine et les modifications successives sont securisees et conservees.",
    mecanisme:
      "Chaque ecriture porte l'empreinte cryptographique (SHA-256) de l'ecriture precedente. " +
      "Toute modification d'une ecriture anterieure rompt les empreintes de toutes les " +
      "ecritures suivantes, ce qui rend l'alteration detectable par le calcul et non par " +
      "l'observation. La numerotation est continue et sans trou, par organisation.",
    verification: "GET /api/encaissements/verifier",
  },
  {
    nom: "Conservation",
    exigence:
      "Le logiciel calcule et enregistre des donnees cumulatives et recapitulatives lors des " +
      "clotures journalieres, mensuelles et annuelles.",
    mecanisme:
      "Chaque cloture fige un total cumule depuis l'origine, qui n'est jamais remis a zero, " +
      "ainsi que le total de la periode et les bornes des ecritures couvertes. Les clotures " +
      "sont elles-memes chainees entre elles. Une ecriture datee dans une periode deja close " +
      "est refusee a l'enregistrement.",
    verification: "GET /api/encaissements/conservation",
  },
  {
    nom: "Archivage",
    exigence:
      "Les donnees sont archivees selon une periodicite au plus annuelle, et les archives sont " +
      "figees et conservees.",
    mecanisme:
      "L'archive d'une periode est un fichier autonome, signe par son empreinte, contenant les " +
      "ecritures, les clotures qui les couvrent, et le mode d'emploi permettant de recalculer " +
      "ces empreintes sans ce logiciel. Elle reste donc verifiable si l'editeur venait a " +
      "disparaitre ou si l'abonnement prenait fin.",
    verification: "GET /api/encaissements/archive",
  },
] as const;

/**
 * Ce que l'attestation ne couvre PAS, et qui doit y figurer.
 *
 * Une attestation qui tairait ses limites en creerait de nouvelles: le client
 * croirait couvert ce qui ne l'est pas, et l'editeur aurait laisse croire.
 */
export const LIMITES = [
  "Cette attestation porte sur l'enregistrement des reglements. Elle ne porte pas sur la " +
    "tenue de la comptabilite generale, qui releve du logiciel comptable du client ou de son " +
    "expert-comptable.",
  "Elle atteste des dispositifs mis en oeuvre par le logiciel. Elle ne prejuge pas de " +
    "l'exactitude des montants saisis, qui releve de l'utilisateur.",
  "Elle vaut pour la version indiquee. Une version anterieure ne beneficie pas des memes " +
    "dispositifs.",
] as const;

/**
 * Produit le texte de l'attestation.
 *
 * Le format est du texte brut plutot qu'un PDF: il se lit, se copie, se joint a
 * un courriel et s'archive sans outil. Un PDF genere ajouterait une dependance
 * a une piece dont la valeur est precisement d'etre lisible partout.
 */
export function redigerAttestation(ctx: ContexteAttestation): string {
  const date = ctx.emiseLe.slice(0, 10);
  const lignes: string[] = [];

  lignes.push("ATTESTATION INDIVIDUELLE DE L'EDITEUR");
  lignes.push("Article 286-I-3° bis du code general des impots");
  lignes.push("");
  lignes.push(`Emise le ${date}`);
  lignes.push("");

  lignes.push("EDITEUR");
  lignes.push(`  ${ctx.editeur.raisonSociale}`);
  if (ctx.editeur.siret) lignes.push(`  SIRET ${ctx.editeur.siret}`);
  if (ctx.editeur.adresse) lignes.push(`  ${ctx.editeur.adresse}`);
  lignes.push("");

  lignes.push("BENEFICIAIRE");
  lignes.push(`  ${ctx.client.raisonSociale}`);
  if (ctx.client.siret) lignes.push(`  SIRET ${ctx.client.siret}`);
  lignes.push("");

  lignes.push("LOGICIEL");
  lignes.push(`  ${ctx.logiciel}, version ${ctx.version}`);
  lignes.push("");

  lignes.push(
    "L'editeur soussigne atteste que le logiciel designe ci-dessus satisfait, pour",
  );
  lignes.push(
    "l'enregistrement des reglements de ses clients, aux conditions d'inalterabilite,",
  );
  lignes.push(
    "de securisation, de conservation et d'archivage des donnees prevues au 3° bis du I",
  );
  lignes.push("de l'article 286 du code general des impots.");
  lignes.push("");

  for (const c of CONDITIONS) {
    lignes.push(`${c.nom.toUpperCase()}`);
    lignes.push(`  Exigence — ${c.exigence}`);
    lignes.push(`  Dispositif — ${c.mecanisme}`);
    lignes.push(`  Verifiable par — ${c.verification}`);
    lignes.push("");
  }

  lignes.push("PORTEE ET LIMITES");
  for (const l of LIMITES) lignes.push(`  - ${l}`);
  lignes.push("");

  lignes.push(
    "Les dispositifs decrits sont verifiables a tout moment par le beneficiaire, depuis",
  );
  lignes.push(
    "son propre compte, au moyen des routes indiquees. Chaque verification produit un",
  );
  lignes.push(
    "resultat daté, et designe le cas echeant la premiere anomalie rencontree ainsi que",
  );
  lignes.push("son numero d'ecriture.");
  lignes.push("");

  lignes.push(`Fait le ${date}.`);
  lignes.push(`${ctx.editeur.raisonSociale}`);

  return lignes.join("\n");
}

/** Nom du fichier remis au client. */
export function nomAttestation(client: IdentiteClient, emiseLe: string): string {
  const sain = client.raisonSociale.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `attestation-286-i-3bis-${sain || "client"}-${emiseLe.slice(0, 10)}.txt`;
}
