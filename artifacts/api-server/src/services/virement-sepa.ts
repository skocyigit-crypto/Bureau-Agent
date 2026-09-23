/**
 * virement-sepa.ts — le fichier de virements que l'on remet a sa banque.
 *
 * POURQUOI. Le produit sait LIRE un releve bancaire (camt.053) et rapprocher
 * les encaissements. Dans l'autre sens, rien : payer ses fournisseurs et ses
 * sous-traitants se faisait a la main, ligne par ligne, dans la banque en
 * ligne — c'est la ou se glissent les fautes de frappe d'IBAN et les oublis
 * d'echeance. Un fichier de remise supprime la ressaisie.
 *
 * POURQUOI UN FICHIER, ET PAS UNE API BANCAIRE. Une API DSP2 suppose un
 * contrat avec un agregateur agree (Powens, Bridge...), une reconnexion tous
 * les 180 jours et des frais par compte ; EBICS suppose un contrat bancaire et
 * un certificat. Le fichier XML, lui, ne suppose rien : toutes les banques
 * francaises l'acceptent en remise, et il n'engage l'entreprise chez personne.
 * C'est la meme logique que camt.053 en entree.
 *
 * POURQUOI pain.001.001.09. La place bancaire francaise migre a ISO 20022 :
 * au 15 novembre 2026 les remises SEPA passent a cette version, et le CFONB
 * 320 n'est plus maintenu depuis janvier 2026. Emettre la version precedente
 * aurait condamne le client a refaire le travail dans deux mois.
 *
 * CE MODULE EST PUR : entrees egales, sortie egale. Il ne lit pas la base, ne
 * connait pas les depenses, et ne decide pas ce qui est paye — c'est la route
 * qui choisit les lignes, et l'humain qui remet le fichier a sa banque.
 */

/** Longueurs maximales de la norme (ISO 20022, usage SEPA). */
const MAX_NOM = 70;
const MAX_LIBELLE = 140;
const MAX_ID = 35;

export interface BeneficiaireVirement {
  /** Identifiant interne, repris en bout de chaine pour le rapprochement. */
  reference: string;
  nom: string;
  iban: string;
  bic?: string | null;
  /** En euros, deux decimales, strictement positif. */
  montant: number;
  /** Ce que le beneficiaire lira sur son releve (numero de facture). */
  libelle?: string | null;
}

export interface DonneurOrdre {
  nom: string;
  iban: string;
  bic?: string | null;
}

export interface DemandeVirement {
  donneur: DonneurOrdre;
  beneficiaires: BeneficiaireVirement[];
  /** Date d'execution souhaitee (AAAA-MM-JJ). */
  dateExecution: string;
  /** Horodatage de creation du fichier. */
  maintenant: Date;
  /** Rend l'identifiant de message unique d'une remise a l'autre. */
  identifiantRemise: string;
}

export interface FichierVirement {
  xml: string;
  identifiantMessage: string;
  nombre: number;
  total: string;
}

export class ErreurVirement extends Error {
  /**
   * La phrase rendue a l-ecran. Elle est ecrite ici, pour le responsable, et
   * ne contient ni IBAN ni detail technique : le message d-une exception
   * recopie tel quel finit par exposer ce qu-il ne faut pas.
   */
  readonly messagePublic: string;
  constructor(message: string, readonly reference?: string) {
    super(message);
    this.name = "ErreurVirement";
    this.messagePublic = message;
  }
}

/** Retire espaces et tirets, met en majuscules. */
export function normaliserIban(iban: string): string {
  return String(iban ?? "").replace(/[\s-]/g, "").toUpperCase();
}

/**
 * Validite d'un IBAN : structure, puis reste 1 modulo 97 (ISO 13616).
 *
 * Une faute de frappe d'IBAN ne se rattrape pas : le virement part, et
 * l'argent revient — au mieux — plusieurs jours plus tard. Le controle ici
 * coute une ligne et evite cela.
 */
export function ibanValide(iban: string): boolean {
  const n = normaliserIban(iban);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(n)) return false;
  const reordonne = n.slice(4) + n.slice(0, 4);
  let reste = 0;
  for (const caractere of reordonne) {
    const valeur = /\d/.test(caractere) ? caractere : String(caractere.charCodeAt(0) - 55);
    for (const chiffre of valeur) reste = (reste * 10 + Number(chiffre)) % 97;
  }
  return reste === 1;
}

/** BIC : 8 ou 11 caracteres. Facultatif en SEPA depuis 2016. */
export function bicValide(bic: string): boolean {
  return /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(String(bic ?? "").replace(/\s/g, "").toUpperCase());
}

function echapper(texte: string): string {
  return String(texte ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/**
 * Nettoie un texte destine au fichier : caracteres de controle retires,
 * longueur bornee. Les accents restent — la norme SEPA accepte l'UTF-8, et
 * remplacer « Fréres » par « Freres » sur un releve est une alteration inutile.
 */
function texte(valeur: string | null | undefined, max: number): string {
  return echapper(String(valeur ?? "").replace(/[\p{Cc}\p{Cf}]/gu, " ").trim().slice(0, max));
}

/** Deux decimales exactes, sans notation scientifique. */
function montantXml(montant: number): string {
  return (Math.round(montant * 100) / 100).toFixed(2);
}

/**
 * Construit la remise. Leve des l'instant ou une ligne est inutilisable : un
 * fichier a moitie juste serait rejete EN BLOC par la banque, sans dire quelle
 * ligne l'a fait tomber.
 */
export function construireVirementSepa(demande: DemandeVirement): FichierVirement {
  const { donneur, beneficiaires, dateExecution, maintenant, identifiantRemise } = demande;

  if (!ibanValide(donneur.iban)) {
    throw new ErreurVirement("L'IBAN de l'entreprise est invalide : corrigez-le dans les parametres.");
  }
  if (donneur.bic && !bicValide(donneur.bic)) {
    throw new ErreurVirement("Le BIC de l'entreprise est invalide.");
  }
  if (!texte(donneur.nom, MAX_NOM)) {
    throw new ErreurVirement("Le nom de l'entreprise est obligatoire sur une remise.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateExecution)) {
    throw new ErreurVirement("La date d'execution doit s'ecrire AAAA-MM-JJ.");
  }
  if (beneficiaires.length === 0) {
    throw new ErreurVirement("Aucun paiement a remettre.");
  }

  const lignes: string[] = [];
  let total = 0;
  const referencesVues = new Set<string>();

  for (const b of beneficiaires) {
    const nom = texte(b.nom, MAX_NOM);
    if (!nom) throw new ErreurVirement("Un beneficiaire sans nom ne peut pas etre paye.", b.reference);
    if (!ibanValide(b.iban)) throw new ErreurVirement(`IBAN invalide pour ${nom}.`, b.reference);
    if (b.bic && !bicValide(b.bic)) throw new ErreurVirement(`BIC invalide pour ${nom}.`, b.reference);
    if (!Number.isFinite(b.montant) || b.montant <= 0) {
      throw new ErreurVirement(`Montant invalide pour ${nom}.`, b.reference);
    }
    // Deux lignes portant la meme reference de bout en bout rendraient le
    // rapprochement du releve ambigu : on refuse plutot que de deviner.
    const ref = texte(b.reference, MAX_ID) || "SANS-REF";
    if (referencesVues.has(ref)) throw new ErreurVirement(`Deux paiements portent la reference ${ref}.`, b.reference);
    referencesVues.add(ref);

    total += Math.round(b.montant * 100) / 100;
    const agent = b.bic ? `\n        <CdtrAgt><FinInstnId><BICFI>${texte(b.bic, 11).toUpperCase()}</BICFI></FinInstnId></CdtrAgt>` : "";
    const libelle = texte(b.libelle, MAX_LIBELLE);
    lignes.push(
      `      <CdtTrfTxInf>
        <PmtId><InstrId>${ref}</InstrId><EndToEndId>${ref}</EndToEndId></PmtId>
        <Amt><InstdAmt Ccy="EUR">${montantXml(b.montant)}</InstdAmt></Amt>${agent}
        <Cdtr><Nm>${nom}</Nm></Cdtr>
        <CdtrAcct><Id><IBAN>${normaliserIban(b.iban)}</IBAN></Id></CdtrAcct>${
        libelle ? `\n        <RmtInf><Ustrd>${libelle}</Ustrd></RmtInf>` : ""
      }
      </CdtTrfTxInf>`,
    );
  }

  const identifiantMessage = texte(identifiantRemise, MAX_ID) || "REMISE";
  const somme = montantXml(total);
  const creation = maintenant.toISOString().replace(/\.\d{3}Z$/, "Z");
  const agentDonneur = donneur.bic
    ? `<DbtrAgt><FinInstnId><BICFI>${texte(donneur.bic, 11).toUpperCase()}</BICFI></FinInstnId></DbtrAgt>`
    // Sans BIC, la norme veut un agent tout de meme : « NOTPROVIDED » est la
    // forme admise, et les banques francaises l'acceptent en remise SEPA.
    : `<DbtrAgt><FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId></DbtrAgt>`;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${identifiantMessage}</MsgId>
      <CreDtTm>${creation}</CreDtTm>
      <NbOfTxs>${beneficiaires.length}</NbOfTxs>
      <CtrlSum>${somme}</CtrlSum>
      <InitgPty><Nm>${texte(donneur.nom, MAX_NOM)}</Nm></InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${identifiantMessage}</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <BtchBookg>false</BtchBookg>
      <NbOfTxs>${beneficiaires.length}</NbOfTxs>
      <CtrlSum>${somme}</CtrlSum>
      <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>
      <ReqdExctnDt><Dt>${dateExecution}</Dt></ReqdExctnDt>
      <Dbtr><Nm>${texte(donneur.nom, MAX_NOM)}</Nm></Dbtr>
      <DbtrAcct><Id><IBAN>${normaliserIban(donneur.iban)}</IBAN></Id></DbtrAcct>
      ${agentDonneur}
      <ChrgBr>SLEV</ChrgBr>
${lignes.join("\n")}
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>
`;

  return { xml, identifiantMessage, nombre: beneficiaires.length, total: somme };
}
