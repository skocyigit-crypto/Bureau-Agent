/**
 * Client de l'API normalisee AFNOR XP Z12-013 « Flow » (version 1.3.0).
 *
 * POURQUOI LA NORME ET NON L'API D'UN FOURNISSEUR
 *
 * Ajant Bureau n'est pas une plateforme agreee (PA) : il produit la facture
 * Factur-X, et c'est la PA choisie par le client qui la transmet a
 * l'acheteur et a l'administration. Les plateformes exposent chacune leur
 * API propre, mais aussi l'API AFNOR, commune. Coder contre la norme laisse
 * le client libre de sa plateforme : il renseigne les adresses de la sienne
 * et les identifiants OAuth2 qu'elle lui delivre.
 *
 * Specification de reference : xp-z12-013-flow-1.3.0.json, publiee par les
 * plateformes (copie dans __tests__/fixtures, et c'est contre ELLE que les
 * tests verifient les requetes, pas contre une recopie faite ici).
 *
 * CE QUE FAIT CE MODULE
 *  - jeton OAuth2 « client credentials », mis en cache jusqu'a expiration ;
 *  - depot d'un flux (POST /v1/flows, multipart : `file` + `flowInfo`) ;
 *  - recherche de flux (POST /v1/flows/search), pour suivre l'accuse de
 *    reception d'une facture emise et lister les factures recues ;
 *  - verification de disponibilite (GET /v1/healthcheck).
 *
 * Chaque appel est borne dans le temps : une plateforme lente ne doit pas
 * tenir une requete de l'application ouverte indefiniment.
 */
import { createHash } from "node:crypto";

export const DELAI_PA_MS = 20_000;

export interface RaccordementPA {
  organisationId: number;
  urlFlow: string;
  urlJeton: string;
  clientId: string;
  clientSecret: string;
}

/** Accuse de reception d'un flux (FlowAckStatus). */
export type StatutAccuse = "Pending" | "Ok" | "Error";

export interface DetailAccuse {
  item: string;
  level: string;
  reasonCode: string;
  reasonMessage: string;
}

/** Ce que la plateforme rend a propos d'un flux (schema `Flow`, champs utilises). */
export interface FluxPA {
  flowId: string;
  submittedAt?: string;
  updatedAt?: string;
  name?: string;
  trackingId?: string;
  flowSyntax?: string;
  flowType?: string;
  flowDirection?: "In" | "Out";
  processingRule?: string;
  acknowledgement?: { status: StatutAccuse; details?: DetailAccuse[] };
}

/**
 * Erreur de dialogue avec la plateforme. Son message est une phrase FIXE,
 * redigee ici pour le responsable (voir messageRefus) : jamais le corps de la
 * reponse de la plateforme, garde a part dans `corps` pour le journal.
 */
export class ErreurPA extends Error {
  readonly messagePublic: string;
  constructor(message: string, readonly statut?: number, readonly corps?: string) {
    super(message);
    this.name = "ErreurPA";
    this.messagePublic = message;
  }
}

/** Retire les « / » finaux : « https://x/afnor-flow/ » + « /v1/flows ». */
function base(url: string): string {
  return url.replace(/\/+$/, "");
}

// ── Jeton OAuth2 ────────────────────────────────────────────────────────────

const jetons = new Map<string, { valeur: string; expireA: number }>();

/** Cle de cache : l'organisation ET l'identifiant — un changement d'identifiants invalide le jeton. */
const cleJeton = (r: RaccordementPA) => `${r.organisationId}:${r.urlJeton}:${r.clientId}`;

export function oublierJeton(r: RaccordementPA): void {
  jetons.delete(cleJeton(r));
}

export async function obtenirJeton(r: RaccordementPA, maintenant = Date.now()): Promise<string> {
  const enCache = jetons.get(cleJeton(r));
  // Marge de 60 s : un jeton qui expire pendant la requete ferait echouer le depot.
  if (enCache && enCache.expireA - 60_000 > maintenant) return enCache.valeur;

  const corps = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: r.clientId,
    client_secret: r.clientSecret,
  });
  const rep = await fetch(r.urlJeton, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: corps,
    signal: AbortSignal.timeout(DELAI_PA_MS),
  });
  if (!rep.ok) {
    // Le corps n'est PAS repris dans le message : il peut contenir l'identifiant.
    throw new ErreurPA(`La plateforme a refuse l'authentification (HTTP ${rep.status}).`, rep.status);
  }
  const json = (await rep.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new ErreurPA("La plateforme n'a pas rendu de jeton d'acces.");
  const duree = Number.isFinite(json.expires_in) ? Number(json.expires_in) : 300;
  jetons.set(cleJeton(r), { valeur: json.access_token, expireA: maintenant + duree * 1000 });
  return json.access_token;
}

async function appeler(r: RaccordementPA, chemin: string, init: RequestInit): Promise<Response> {
  const jeton = await obtenirJeton(r);
  const rep = await fetch(`${base(r.urlFlow)}${chemin}`, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${jeton}`, Accept: "application/json" },
    signal: AbortSignal.timeout(DELAI_PA_MS),
  });
  if (rep.status === 401) oublierJeton(r); // jeton revoque : le prochain appel en redemande un
  return rep;
}

// ── Depot d'une facture ─────────────────────────────────────────────────────

/** Les champs `flowInfo` d'un depot de facture Factur-X (schema FlowInfo). */
export function infoFlux(nomFichier: string, trackingId: string, fichier: Buffer) {
  return {
    flowSyntax: "Factur-X" as const,
    flowProfile: "Basic" as const,
    processingRule: "B2B" as const,
    name: nomFichier.slice(0, 255),
    trackingId: trackingId.slice(0, 64),
    sha256: createHash("sha256").update(fichier).digest("hex"),
  };
}

export async function deposerFacture(
  r: RaccordementPA,
  pdf: Buffer,
  nomFichier: string,
  trackingId: string,
): Promise<FluxPA> {
  const form = new FormData();
  form.append("flowInfo", new Blob([JSON.stringify(infoFlux(nomFichier, trackingId, pdf))], { type: "application/json" }));
  form.append("file", new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), nomFichier);
  const rep = await appeler(r, "/v1/flows", { method: "POST", body: form });
  if (rep.status !== 202 && rep.status !== 200 && rep.status !== 201) {
    const texte = await rep.text().catch(() => "");
    throw new ErreurPA(messageRefus(rep.status), rep.status, texte.slice(0, 2000));
  }
  const flux = (await rep.json()) as FluxPA;
  if (!flux.flowId) throw new ErreurPA("La plateforme n'a pas rendu d'identifiant de flux.");
  return flux;
}

/** Un message lisible par le responsable, par code HTTP de la norme. */
export function messageRefus(statut: number): string {
  switch (statut) {
    case 400: return "La plateforme a juge la demande invalide.";
    case 401:
    case 403: return "La plateforme refuse l'acces : verifiez les identifiants du raccordement.";
    case 413: return "Le fichier depasse la taille acceptee par la plateforme.";
    case 422: return "La plateforme a rejete la facture (contenu non conforme).";
    case 429: return "La plateforme limite le nombre d'envois : reessayez dans quelques minutes.";
    case 503: return "La plateforme est momentanement indisponible.";
    default: return `La plateforme a repondu par une erreur (HTTP ${statut}).`;
  }
}

// ── Recherche de flux ───────────────────────────────────────────────────────

export interface FiltresFlux {
  trackingId?: string;
  flowDirection?: Array<"In" | "Out">;
  flowType?: string[];
  ackStatus?: StatutAccuse;
  updatedAfter?: string;
}

export async function rechercherFlux(
  r: RaccordementPA,
  where: FiltresFlux,
  options: { limit?: number; cursor?: string } = {},
): Promise<{ results: FluxPA[]; nextCursor?: string }> {
  const corps: Record<string, unknown> = { where, limit: Math.min(options.limit ?? 25, 100) };
  if (options.cursor) corps.cursor = options.cursor;
  const rep = await appeler(r, "/v1/flows/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corps),
  });
  if (!rep.ok) throw new ErreurPA(messageRefus(rep.status), rep.status);
  const json = (await rep.json()) as { results?: FluxPA[]; nextCursor?: string };
  return { results: json.results ?? [], nextCursor: json.nextCursor };
}

/** L'accuse le plus recent d'une facture emise, retrouvee par son trackingId. */
export async function accuseDeFacture(r: RaccordementPA, trackingId: string): Promise<FluxPA | null> {
  const { results } = await rechercherFlux(r, { trackingId, flowDirection: ["Out"] }, { limit: 10 });
  if (results.length === 0) return null;
  return [...results].sort((a, b) => (b.updatedAt ?? b.submittedAt ?? "").localeCompare(a.updatedAt ?? a.submittedAt ?? ""))[0]!;
}

export async function verifierDisponibilite(r: RaccordementPA): Promise<void> {
  const rep = await appeler(r, "/v1/healthcheck", { method: "GET" });
  if (!rep.ok) throw new ErreurPA(messageRefus(rep.status), rep.status);
}

/** Identifiant de suivi stable d'une facture : l'organisation et son numero. */
export function trackingIdFacture(organisationId: number, reference: string): string {
  return `ab-${organisationId}-${reference}`.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64);
}
