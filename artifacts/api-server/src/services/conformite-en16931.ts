/**
 * Une facture electronique rejetee est un paiement qui n'arrive pas.
 *
 * A partir de la reforme, une facture ne part plus par courriel: elle transite
 * par une plateforme (PDP) ou par Chorus Pro, qui la VALIDE avant de la
 * transmettre. Si le XML ne respecte pas la norme EN 16931, la plateforme la
 * refuse — et l'artisan apprend le probleme au moment ou il attendait son
 * argent, sans savoir quoi corriger.
 *
 * Ce module pose la question avant: ce que nous produisons passerait-il?
 *
 * Pourquoi il ne suffit pas d'avoir genere le XML correctement. Les champs
 * viennent de donnees saisies par l'utilisateur — une adresse client vide, un
 * pays absent, une ligne sans designation. Le generateur ne peut pas inventer
 * ce qui manque; il produit alors un XML bien forme mais NON CONFORME. Bien
 * forme et conforme sont deux choses differentes, et c'est precisement la
 * seconde que la plateforme verifie.
 *
 * Perimetre: les regles « BR » du noyau EN 16931 qui portent sur la PRESENCE
 * des donnees obligatoires et sur la COHERENCE des totaux. Ce n'est pas un
 * validateur Schematron complet — il en existe, ils exigent une chaine Java —
 * et ce module ne pretend pas l'etre: il couvre ce qui casse en pratique,
 * c'est-a-dire des champs absents et des totaux qui ne s'additionnent pas.
 *
 * Chaque manquement porte son identifiant de regle: c'est ce que la plateforme
 * citera dans son rejet, et donc ce qui permet de faire le lien.
 */

/** Un manquement a la norme, dit dans les termes de la norme. */
export interface Manquement {
  /** Identifiant officiel, ex. « BR-06 ». C'est ce que citera la plateforme. */
  regle: string;
  /** Ce qui manque, en francais, pour l'utilisateur qui doit corriger. */
  explication: string;
}

export interface VerdictConformite {
  conforme: boolean;
  manquements: Manquement[];
}

/** Contenu texte d'un element, ou null. Le premier trouve dans la portee donnee. */
function valeur(xml: string, balise: string): string | null {
  const m = new RegExp(`<${balise}[^>]*>([^<]*)</${balise}>`).exec(xml);
  const v = m?.[1]?.trim();
  return v ? v : null;
}

/** Toutes les occurrences d'un bloc, contenu compris. */
function blocs(xml: string, balise: string): string[] {
  return [...xml.matchAll(new RegExp(`<${balise}[^>]*>([\\s\\S]*?)</${balise}>`, "g"))].map((m) => m[1]);
}

/**
 * Somme en centimes.
 *
 * Les totaux sont compares en ENTIERS, jamais en flottants: 0.1 + 0.2 ne fait
 * pas 0.3, et une facture refusee pour un centime d'ecart d'arrondi serait un
 * defaut invente par le verificateur lui-meme.
 */
function centimes(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/**
 * Verifie un CII EN 16931 (profil COMFORT) et dit ce qui manque.
 *
 * Rend toujours la LISTE COMPLETE des manquements, jamais le premier seul:
 * corriger une facture champ par champ, en la renvoyant a chaque fois, est ce
 * qui rend ces plateformes detestables.
 */
export function verifierEn16931(xml: string): VerdictConformite {
  const manquements: Manquement[] = [];
  const exiger = (regle: string, present: unknown, explication: string) => {
    if (!present) manquements.push({ regle, explication });
  };

  // --- Identification du document -------------------------------------------
  exiger("BR-01", /GuidelineSpecifiedDocumentContextParameter/.test(xml),
    "L'identifiant de specification (le profil suivi) est absent.");
  exiger("BR-02", valeur(xml, "ram:ID"),
    "Le numero de facture est absent.");
  exiger("BR-03", valeur(xml, "udt:DateTimeString"),
    "La date d'emission est absente.");
  exiger("BR-04", valeur(xml, "ram:TypeCode"),
    "Le code de type de document est absent (380 pour une facture).");
  exiger("BR-05", valeur(xml, "ram:InvoiceCurrencyCode"),
    "La devise de la facture est absente.");

  // --- Les deux parties ------------------------------------------------------
  const vendeur = blocs(xml, "ram:SellerTradeParty")[0] ?? "";
  const acheteur = blocs(xml, "ram:BuyerTradeParty")[0] ?? "";

  exiger("BR-06", valeur(vendeur, "ram:Name"),
    "Le nom du vendeur est absent.");
  exiger("BR-07", valeur(acheteur, "ram:Name"),
    "Le nom du client est absent.");
  exiger("BR-08", blocs(vendeur, "ram:PostalTradeAddress").length > 0,
    "L'adresse postale du vendeur est absente.");
  exiger("BR-09", valeur(vendeur, "ram:CountryID"),
    "Le code pays du vendeur est absent.");
  exiger("BR-10", blocs(acheteur, "ram:PostalTradeAddress").length > 0,
    "L'adresse postale du client est absente.");
  exiger("BR-11", valeur(acheteur, "ram:CountryID"),
    "Le code pays du client est absent.");

  // --- Les lignes ------------------------------------------------------------
  const lignes = blocs(xml, "ram:IncludedSupplyChainTradeLineItem");
  exiger("BR-16", lignes.length > 0,
    "La facture ne comporte aucune ligne.");

  lignes.forEach((ligne, i) => {
    const rang = i + 1;
    exiger("BR-21", valeur(ligne, "ram:LineID"),
      `Ligne ${rang}: l'identifiant de ligne est absent.`);
    exiger("BR-25", valeur(ligne, "ram:Name"),
      `Ligne ${rang}: la designation de l'article est absente.`);
    exiger("BR-24", blocs(ligne, "ram:NetPriceProductTradePrice").length > 0,
      `Ligne ${rang}: le prix unitaire net est absent.`);
    exiger("BR-26", valeur(ligne, "ram:LineTotalAmount"),
      `Ligne ${rang}: le montant net de la ligne est absent.`);
  });

  // --- Ventilation de TVA ----------------------------------------------------
  //
  // `ram:ApplicableTradeTax` apparait a DEUX niveaux: sur chaque ligne (taux
  // applique, sans base) et dans la ventilation du document (base imposable
  // par categorie). Seule la seconde porte BT-116. Les confondre faisait
  // reclamer une base imposable sur des lignes qui n'en ont pas a porter —
  // un manquement invente par le verificateur, exactement ce qu'il doit
  // eviter de produire.
  const reglement = blocs(xml, "ram:ApplicableHeaderTradeSettlement")[0] ?? "";
  const taxes = blocs(reglement, "ram:ApplicableTradeTax").filter((t) => /ram:CategoryCode/.test(t));
  exiger("BR-45", taxes.length > 0,
    "La ventilation de TVA est absente: une facture doit porter au moins une categorie.");
  taxes.forEach((taxe, i) => {
    exiger("BR-46", valeur(taxe, "ram:BasisAmount"),
      `Ventilation ${i + 1}: la base imposable est absente.`);
    exiger("BR-47", valeur(taxe, "ram:CategoryCode"),
      `Ventilation ${i + 1}: la categorie de TVA est absente.`);
  });

  // --- Totaux ---------------------------------------------------------------
  const resume = blocs(xml, "ram:SpecifiedTradeSettlementHeaderMonetarySummation")[0] ?? "";
  const sommeLignes = centimes(valeur(resume, "ram:LineTotalAmount"));
  const horsTaxe = centimes(valeur(resume, "ram:TaxBasisTotalAmount"));
  const tva = centimes(valeur(resume, "ram:TaxTotalAmount"));
  const total = centimes(valeur(resume, "ram:GrandTotalAmount"));
  const du = centimes(valeur(resume, "ram:DuePayableAmount"));

  exiger("BR-12", sommeLignes !== null, "La somme des lignes est absente.");
  exiger("BR-13", horsTaxe !== null, "Le total hors taxes est absent.");
  exiger("BR-14", total !== null, "Le total toutes taxes comprises est absent.");
  exiger("BR-15", du !== null, "Le montant restant du est absent.");

  // Coherence. Sans allocations ni charges au niveau document — le generateur
  // n'en produit pas — le total hors taxes EST la somme des lignes.
  if (sommeLignes !== null && horsTaxe !== null && sommeLignes !== horsTaxe) {
    manquements.push({
      regle: "BR-CO-13",
      explication: `Le total hors taxes (${horsTaxe / 100}) ne vaut pas la somme des lignes (${sommeLignes / 100}).`,
    });
  }
  if (horsTaxe !== null && tva !== null && total !== null && horsTaxe + tva !== total) {
    manquements.push({
      regle: "BR-CO-15",
      explication: `Le total TTC (${total / 100}) ne vaut pas hors taxes + TVA (${(horsTaxe + tva) / 100}).`,
    });
  }

  // La somme des bases de TVA doit couvrir le total hors taxes: une categorie
  // oubliee passerait sinon inapercue, et c'est exactement ce qu'un controle
  // fiscal recalcule.
  if (horsTaxe !== null && taxes.length > 0) {
    const sommeBases = taxes
      .map((t) => centimes(valeur(t, "ram:BasisAmount")) ?? 0)
      .reduce((a, b) => a + b, 0);
    if (sommeBases !== horsTaxe) {
      manquements.push({
        regle: "BR-CO-10",
        explication: `La somme des bases de TVA (${sommeBases / 100}) ne vaut pas le total hors taxes (${horsTaxe / 100}).`,
      });
    }
  }

  return { conforme: manquements.length === 0, manquements };
}
