/**
 * Client de l'API Chorus Pro (sphere publique), intermediee par PISTE.
 *
 * POURQUOI CE MODULE EXISTE
 *
 * Une facture adressee a une commune, a un departement, a un hopital ou a un
 * office HLM ne se transmet pas comme une facture entre entreprises : elle se
 * depose sur Chorus Pro. Pour une entreprise du batiment, dont une part du
 * carnet vient de la commande publique, une facture non deposee est une
 * facture non payee. Le raccordement a une plateforme agreee, deja present,
 * ne couvre pas ce chemin.
 *
 * CE QU'IL FAIT
 *  - jeton OAuth2 « client credentials » aupres de PISTE, mis en cache ;
 *  - depot d'un fichier de facture (Factur-X PDF/A-3 ou XML) ;
 *  - consultation du compte rendu du depot, qui dit si Chorus Pro a integre
 *    ou rejete le flux ;
 *  - recherche d'une structure publique par SIRET, pour verifier que
 *    l'acheteur est bien raccorde avant d'emettre.
 *
 * CE QU'IL NE FAIT PAS. Il ne decide rien et n'ecrit pas en base : les routes
 * s'en chargent. Il ne construit pas la facture non plus — le Factur-X vient
 * de `facture-document`, le meme fichier que celui remis au client.
 *
 * DEUX PRECAUTIONS QUI ONT DEJA SERVI AILLEURS DANS CE PRODUIT
 *  - `redirect: "manual"` : une reponse qui redirige ferait partir le jeton,
 *    le compte technique et la facture vers une adresse jamais controlee ;
 *  - aucun corps de reponse dans le message d'erreur rendu a l'utilisateur :
 *    il peut contenir l'identifiant du compte technique.
 *
 * Les chemins sont ici, mais la BASE est une donnee du raccordement : l'AIFE
 * distingue qualification et production, et fait evoluer ses adresses.
 */
import { and, eq } from "drizzle-orm";

export const DELAI_CHORUS_MS = 20_000;

/** Chemins de l'API, relatifs a la base du raccordement. */
export const CHEMIN_DEPOT = "/factures/v1/deposer/flux";
export const CHEMIN_COMPTE_RENDU = "/transverses/v1/consulter/cr";
export const CHEMIN_STRUCTURES = "/structures/v1/rechercher";

export interface RaccordementChorus {
  organisationId: number;
  urlBase: string;
  urlJeton: string;
  clientId: string;
  clientSecret: string;
  compteTechnique: string;
  motDePasseTechnique: string;
  idUtilisateurCourant?: number | null;
  syntaxeFlux: string;
}

/** Ce que Chorus Pro rend au depot d'un flux. */
export interface DepotChorus {
  codeRetour: number;
  libelle?: string;
  numeroFluxDepot: string;
}

/** Ce que rend la consultation du compte rendu d'un depot. */
export interface CompteRenduChorus {
  numeroFluxDepot?: string;
  etatCourantFlux?: string;
  dateDepot?: string;
  nomFichier?: string;
  libelle?: string;
}

/**
 * Erreur de dialogue avec Chorus Pro. `messagePublic` est une phrase fixe,
 * ecrite ici pour le responsable ; le corps de la reponse reste dans `corps`,
 * pour le journal seulement.
 */
export class ErreurChorus extends Error {
  readonly messagePublic: string;
  constructor(message: string, readonly statut?: number, readonly corps?: string) {
    super(message);
    this.name = "ErreurChorus";
    this.messagePublic = message;
  }
}

const base = (url: string) => url.replace(/\/+$/, "");

// ── Jeton PISTE ─────────────────────────────────────────────────────────────

const jetons = new Map<string, { valeur: string; expireA: number }>();

const cleJeton = (r: RaccordementChorus) => `${r.organisationId}:${r.urlJeton}:${r.clientId}`;

export function oublierJetonChorus(r: RaccordementChorus): void {
  jetons.delete(cleJeton(r));
}

export async function obtenirJetonChorus(r: RaccordementChorus, maintenant = Date.now()): Promise<string> {
  const enCache = jetons.get(cleJeton(r));
  // Marge de 60 s : un jeton qui expire pendant le depot ferait echouer l'envoi.
  if (enCache && enCache.expireA - 60_000 > maintenant) return enCache.valeur;

  const rep = await fetch(r.urlJeton, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: r.clientId,
      client_secret: r.clientSecret,
      scope: "openid",
    }),
    signal: AbortSignal.timeout(DELAI_CHORUS_MS),
    redirect: "manual",
  });
  if (!rep.ok) {
    throw new ErreurChorus(`PISTE a refuse l'authentification (HTTP ${rep.status}).`, rep.status);
  }
  const json = (await rep.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new ErreurChorus("PISTE n'a pas rendu de jeton d'acces.");
  const duree = Number.isFinite(json.expires_in) ? Number(json.expires_in) : 3600;
  jetons.set(cleJeton(r), { valeur: json.access_token, expireA: maintenant + duree * 1000 });
  return json.access_token;
}

/**
 * En-tete `cpro-account` : le compte technique Chorus Pro, encode en base64.
 *
 * Il ne remplace pas le jeton, il s'y ajoute — PISTE authentifie le LOGICIEL,
 * l'en-tete authentifie le COMPTE au nom duquel on depose.
 */
export function enteteCompte(r: RaccordementChorus): string {
  return Buffer.from(`${r.compteTechnique}:${r.motDePasseTechnique}`, "utf8").toString("base64");
}

async function appeler(r: RaccordementChorus, chemin: string, corps: unknown): Promise<Response> {
  const jeton = await obtenirJetonChorus(r);
  const rep = await fetch(`${base(r.urlBase)}${chemin}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jeton}`,
      "cpro-account": enteteCompte(r),
      "Content-Type": "application/json;charset=utf-8",
      Accept: "application/json;charset=utf-8",
    },
    body: JSON.stringify(corps),
    signal: AbortSignal.timeout(DELAI_CHORUS_MS),
    redirect: "manual",
  });
  // Jeton revoque ou expire cote PISTE : le prochain appel en redemande un.
  if (rep.status === 401) oublierJetonChorus(r);
  return rep;
}

/** Un message lisible par le responsable, par code HTTP. */
export function messageRefusChorus(statut: number): string {
  switch (statut) {
    case 400: return "Chorus Pro a juge la demande invalide.";
    case 401:
    case 403: return "Chorus Pro refuse l'acces : verifiez le compte technique et les identifiants PISTE.";
    case 404: return "L'adresse de l'API Chorus Pro est introuvable : verifiez l'URL du raccordement.";
    case 413: return "Le fichier depasse la taille acceptee par Chorus Pro.";
    case 429: return "Chorus Pro limite le nombre d'envois : reessayez dans quelques minutes.";
    case 500:
    case 502:
    case 503: return "Chorus Pro est momentanement indisponible.";
    default: return `Chorus Pro a repondu par une erreur (HTTP ${statut}).`;
  }
}

async function lireJson(rep: Response, quoi: string): Promise<Record<string, any>> {
  if (rep.status < 200 || rep.status >= 300) {
    const texte = await rep.text().catch(() => "");
    throw new ErreurChorus(messageRefusChorus(rep.status), rep.status, texte.slice(0, 2000));
  }
  const json = (await rep.json().catch(() => null)) as Record<string, any> | null;
  if (!json) throw new ErreurChorus(`Chorus Pro a repondu sans contenu lisible (${quoi}).`);
  return json;
}

// ── Depot d'une facture ─────────────────────────────────────────────────────

/**
 * Depose un fichier de facture.
 *
 * `codeRetour` vaut 0 quand Chorus Pro accepte ; toute autre valeur est un
 * refus METIER, rendu avec un 200 HTTP. Le confondre avec un succes ferait
 * afficher « transmise » a l'ecran pour une facture que personne n'a recue —
 * exactement le genre de silence que ce produit s'interdit.
 */
export async function deposerFluxFacture(
  r: RaccordementChorus,
  fichier: Buffer,
  nomFichier: string,
): Promise<DepotChorus> {
  const corps: Record<string, unknown> = {
    fichierFlux: fichier.toString("base64"),
    nomFichier: nomFichier.slice(0, 50),
    syntaxeFlux: r.syntaxeFlux,
    avecSignature: false,
  };
  if (r.idUtilisateurCourant) corps.idUtilisateurCourant = r.idUtilisateurCourant;

  const json = await lireJson(await appeler(r, CHEMIN_DEPOT, corps), "depot");
  const code = Number(json.codeRetour);
  const numero = json.numeroFluxDepot ?? json.NumeroFluxDepot;
  if (code !== 0 || !numero) {
    throw new ErreurChorus(
      `Chorus Pro a refuse le depot${json.libelle ? ` : ${String(json.libelle).slice(0, 200)}` : "."}`,
      undefined,
      JSON.stringify(json).slice(0, 2000),
    );
  }
  return { codeRetour: code, libelle: json.libelle, numeroFluxDepot: String(numero) };
}

// ── Suivi du depot ──────────────────────────────────────────────────────────

/**
 * Compte rendu d'un depot : c'est lui, et non la reponse au depot, qui dit si
 * la facture a ete INTEGREE. Un depot accepte peut etre rejete ensuite.
 */
export async function consulterCompteRendu(
  r: RaccordementChorus,
  numeroFluxDepot: string,
  dateDepot?: string,
): Promise<CompteRenduChorus> {
  const corps: Record<string, unknown> = { numeroFluxDepot, syntaxeFlux: r.syntaxeFlux };
  if (dateDepot) corps.dateDepot = dateDepot;
  const json = await lireJson(await appeler(r, CHEMIN_COMPTE_RENDU, corps), "compte rendu");
  return {
    numeroFluxDepot: json.numeroFluxDepot ?? json.NumeroFluxDepot,
    etatCourantFlux: json.etatCourantFlux ?? json.EtatCourantFlux,
    dateDepot: json.dateDepotFlux ?? json.DateDepotFlux,
    nomFichier: json.nomFichierFlux ?? json.NomFichierFlux,
    libelle: json.libelle,
  };
}

/**
 * Recherche une structure publique par SIRET, pour verifier avant d'emettre
 * que l'acheteur est raccorde a Chorus Pro.
 */
export async function rechercherStructure(r: RaccordementChorus, siret: string): Promise<Record<string, any>> {
  const nettoye = siret.replace(/\s/g, "");
  if (!/^\d{14}$/.test(nettoye)) throw new ErreurChorus("Le SIRET doit comporter quatorze chiffres.");
  return lireJson(
    await appeler(r, CHEMIN_STRUCTURES, { structure: { identifiantStructure: nettoye } }),
    "recherche de structure",
  );
}

/**
 * Verifie le raccordement sans rien deposer : un jeton obtenu, et un appel
 * qui prouve que le compte technique est accepte.
 */
export async function verifierRaccordementChorus(r: RaccordementChorus): Promise<{ jeton: true; compte: boolean }> {
  await obtenirJetonChorus(r);
  const rep = await appeler(r, CHEMIN_STRUCTURES, { structure: { identifiantStructure: "00000000000000" } });
  if (rep.status === 401 || rep.status === 403) {
    throw new ErreurChorus(messageRefusChorus(rep.status), rep.status);
  }
  return { jeton: true, compte: rep.status < 500 };
}

// ── Lecture du raccordement ─────────────────────────────────────────────────

/**
 * Le raccordement d'une organisation, secrets dechiffres, ou null s'il n'y en
 * a pas ou qu'il est desactive.
 */
export async function raccordementChorusDe(organisationId: number): Promise<RaccordementChorus | null> {
  const { db, raccordementsChorusProTable } = await import("@workspace/db");
  const { decryptSensitiveData } = await import("../lib/crypto");
  const [ligne] = await db
    .select()
    .from(raccordementsChorusProTable)
    .where(and(
      eq(raccordementsChorusProTable.organisationId, organisationId),
      eq(raccordementsChorusProTable.actif, true),
    ));
  if (!ligne) return null;
  return {
    organisationId,
    urlBase: ligne.urlBase,
    urlJeton: ligne.urlJeton,
    clientId: ligne.clientId,
    clientSecret: decryptSensitiveData(ligne.clientSecretChiffre),
    compteTechnique: ligne.compteTechnique,
    motDePasseTechnique: decryptSensitiveData(ligne.motDePasseTechniqueChiffre),
    idUtilisateurCourant: ligne.idUtilisateurCourant,
    syntaxeFlux: ligne.syntaxeFlux,
  };
}
