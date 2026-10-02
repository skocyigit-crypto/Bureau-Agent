/**
 * CRM : chronologie d'un client, doublons, fusion.
 *
 * Trois besoins du plan (section 5) qui reposent sur la meme connaissance :
 * QUELLES lignes de la base designent un contact. La liste
 * `REFERENCES_CONTACT` en est la source unique. La chronologie la lit pour
 * savoir quoi montrer, la fusion pour savoir quoi deplacer — et un test
 * (crm-complet-db.test.ts) la confronte a `information_schema`, pour qu'une
 * table ajoutee demain avec un `contact_id` ne soit pas oubliee par la fusion.
 * Une fusion qui oublie une table ne perd rien tout de suite : elle laisse des
 * lignes rattachees a une fiche supprimee, que la cle etrangere passe ensuite
 * a NULL. La perte est silencieuse, c'est pour cela qu'elle est testee.
 */
import { and, eq, sql } from "drizzle-orm";
import { contactsTable, db, deletedRowsTable } from "@workspace/db";
import { entreesCorbeille, type DeletionContext } from "./trash";
import { nomDeRapprochement } from "../lib/rapprochement-contact";

// ---------------------------------------------------------------------------
// References au contact
// ---------------------------------------------------------------------------

/**
 * Colonnes qui portent l'identifiant d'un contact, hors `compte_client`
 * (traite a part : contrainte UNIQUE et suppression en cascade).
 *
 * `tasks.related_contact_id` et `face_profiles.contact_id` n'ont PAS de cle
 * etrangere : rien en base ne les remettrait a NULL. Les oublier laisserait
 * des lignes pointer vers un identifiant qui n'existe plus.
 */
export const REFERENCES_CONTACT: ReadonlyArray<{ table: string; colonne: string }> = [
  { table: "calls", colonne: "contact_id" },
  { table: "messages", colonne: "contact_id" },
  { table: "devis", colonne: "contact_id" },
  { table: "factures_client", colonne: "contact_id" },
  { table: "projets", colonne: "contact_id" },
  { table: "prospects", colonne: "contact_id" },
  { table: "calendar_events", colonne: "related_contact_id" },
  { table: "appointment_offers", colonne: "related_contact_id" },
  { table: "tasks", colonne: "related_contact_id" },
  { table: "whatsapp_conversations", colonne: "contact_id" },
  { table: "face_profiles", colonne: "contact_id" },
];

/** Traitee a part : un contact a au plus un compte client (UNIQUE). */
export const REFERENCE_COMPTE_CLIENT = { table: "compte_client", colonne: "contact_id" } as const;

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/**
 * Telephone au format E.164 quand on sait le deduire, sinon les chiffres seuls.
 *
 * Seule la France est deduite (0X XX XX XX XX -> +33...). Un numero etranger
 * saisi sans indicatif garde ses chiffres bruts : lui inventer un pays
 * rapprocherait deux personnes differentes, ce qui est pire que de manquer un
 * doublon. Moins de 8 chiffres : rien, un numero court rapproche n'importe qui.
 */
export function telephoneE164(brut: string | null | undefined): string | null {
  const s = String(brut ?? "").trim();
  if (!s) return null;
  const chiffres = s.replace(/\D/g, "");
  if (chiffres.length < 8) return null;
  if (s.startsWith("+")) return `+${chiffres}`;
  if (chiffres.startsWith("00")) return `+${chiffres.slice(2)}`;
  if (chiffres.length === 10 && chiffres.startsWith("0")) return `+33${chiffres.slice(1)}`;
  if (chiffres.length === 11 && chiffres.startsWith("33")) return `+${chiffres}`;
  return chiffres;
}

export function emailNormalise(brut: string | null | undefined): string | null {
  const e = String(brut ?? "").trim().toLowerCase();
  return e.includes("@") ? e : null;
}

function sansAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Nom + societe. Le nom seul ne suffit pas : deux « Jean Martin » sont deux
 * clients tant qu'on ne sait rien d'autre. La societe peut etre vide, mais
 * elle doit l'etre des deux cotes.
 */
export function cleNomSociete(firstName: string | null, lastName: string | null, company: string | null): string | null {
  const nom = nomDeRapprochement(firstName, lastName);
  if (!nom) return null;
  return `${sansAccents(nom)}|${sansAccents(company ?? "")}`;
}

// ---------------------------------------------------------------------------
// Doublons
// ---------------------------------------------------------------------------

export type MotifDoublon = "telephone" | "email" | "nom_societe";
export type ContactResume = { id: number; firstName: string; lastName: string; company: string | null; email: string | null; phone: string; mobile: string | null; createdAt: Date };
export type GroupeDoublons = { motif: MotifDoublon; valeur: string; contacts: ContactResume[] };

/**
 * Plafond de lecture : la detection se fait en memoire, sur les contacts
 * d'UNE organisation. Une PME du BTP en compte quelques milliers ; au-dela,
 * on lit les plus recents plutot que de saturer la memoire de l'instance.
 */
const PLAFOND_CONTACTS = 20000;

async function contactsDeLOrganisation(orgId: number): Promise<ContactResume[]> {
  return db.select({
    id: contactsTable.id, firstName: contactsTable.firstName, lastName: contactsTable.lastName,
    company: contactsTable.company, email: contactsTable.email, phone: contactsTable.phone,
    mobile: contactsTable.mobile, createdAt: contactsTable.createdAt,
  }).from(contactsTable)
    .where(eq(contactsTable.organisationId, orgId))
    .orderBy(sql`${contactsTable.id} desc`)
    .limit(PLAFOND_CONTACTS);
}

export function grouperDoublons(contacts: ContactResume[]): GroupeDoublons[] {
  const index = new Map<string, { motif: MotifDoublon; valeur: string; ids: Set<number> }>();
  const ajouter = (motif: MotifDoublon, valeur: string | null, id: number) => {
    if (!valeur) return;
    const k = `${motif}:${valeur}`;
    const g = index.get(k) ?? { motif, valeur, ids: new Set<number>() };
    g.ids.add(id);
    index.set(k, g);
  };
  for (const c of contacts) {
    ajouter("telephone", telephoneE164(c.phone), c.id);
    ajouter("telephone", telephoneE164(c.mobile), c.id);
    ajouter("email", emailNormalise(c.email), c.id);
    ajouter("nom_societe", cleNomSociete(c.firstName, c.lastName, c.company), c.id);
  }
  const parId = new Map(contacts.map((c) => [c.id, c]));
  return [...index.values()]
    .filter((g) => g.ids.size > 1)
    .map((g) => ({
      motif: g.motif,
      valeur: g.valeur,
      contacts: [...g.ids].sort((a, b) => a - b).map((id) => parId.get(id)!),
    }));
}

export async function doublonsDeLOrganisation(orgId: number): Promise<GroupeDoublons[]> {
  return grouperDoublons(await contactsDeLOrganisation(orgId));
}

/** Les fiches suspectees d'etre le meme client que `contactId`, avec leurs motifs. */
export async function doublonsDuContact(orgId: number, contactId: number): Promise<Array<ContactResume & { motifs: MotifDoublon[] }> | null> {
  const tous = await contactsDeLOrganisation(orgId);
  if (!tous.some((c) => c.id === contactId)) return null;
  const motifs = new Map<number, Set<MotifDoublon>>();
  for (const g of grouperDoublons(tous)) {
    if (!g.contacts.some((c) => c.id === contactId)) continue;
    for (const c of g.contacts) {
      if (c.id === contactId) continue;
      const m = motifs.get(c.id) ?? new Set<MotifDoublon>();
      m.add(g.motif);
      motifs.set(c.id, m);
    }
  }
  const parId = new Map(tous.map((c) => [c.id, c]));
  return [...motifs.entries()].map(([id, m]) => ({ ...parId.get(id)!, motifs: [...m] }));
}

// ---------------------------------------------------------------------------
// Fusion
// ---------------------------------------------------------------------------

export type ResultatFusion =
  | { ok: true; deplaces: Record<string, number[]>; conserve: typeof contactsTable.$inferSelect; absorbeId: number }
  | { ok: false; raison: "introuvable" | "meme_contact" | "compte_client_double" };

/**
 * Absorbe `absorbeId` dans `conserveId`, en UNE transaction.
 *
 * Ordre et raisons :
 *  1. Les deux fiches sont verrouillees (FOR UPDATE, dans l'ordre des
 *     identifiants) : deux fusions croisees simultanees ne peuvent pas
 *     s'entre-absorber ; la seconde trouve une fiche disparue et s'arrete.
 *  2. Le compte client : la cle est UNIQUE et la suppression du contact le
 *     detruirait en CASCADE — l'historique de paiement partirait avec. S'il
 *     n'appartient qu'a la fiche absorbee, il suit ; si les deux en ont un,
 *     on refuse plutot que de choisir a la place de l'utilisateur.
 *  3. Chaque reference est repointee, bornee a l'organisation.
 *  4. Les champs vides de la fiche conservee sont completes ; les notes sont
 *     mises bout a bout, jamais remplacees.
 *  5. La fiche absorbee part a la corbeille DANS la transaction : si
 *     l'archivage echoue, rien n'est fusionne.
 */
export async function fusionnerContacts(orgId: number, conserveId: number, absorbeId: number, ctx: DeletionContext): Promise<ResultatFusion> {
  if (conserveId === absorbeId) return { ok: false, raison: "meme_contact" };
  return db.transaction(async (tx) => {
    const verrou = await tx.execute(sql`
      SELECT id FROM contacts
      WHERE organisation_id = ${orgId} AND id IN (${conserveId}, ${absorbeId})
      ORDER BY id FOR UPDATE
    `);
    if ((verrou as { rows: unknown[] }).rows.length !== 2) return { ok: false as const, raison: "introuvable" as const };

    const comptes = await tx.execute(sql`
      SELECT contact_id FROM compte_client
      WHERE organisation_id = ${orgId} AND contact_id IN (${conserveId}, ${absorbeId})
    `);
    const lignesComptes = (comptes as unknown as { rows: Array<{ contact_id: number }> }).rows;
    if (lignesComptes.length === 2) return { ok: false as const, raison: "compte_client_double" as const };

    const deplaces: Record<string, number[]> = {};
    for (const ref of [...REFERENCES_CONTACT, REFERENCE_COMPTE_CLIENT]) {
      const r = await tx.execute(sql`
        UPDATE ${sql.identifier(ref.table)} SET ${sql.identifier(ref.colonne)} = ${conserveId}
        WHERE ${sql.identifier(ref.colonne)} = ${absorbeId} AND organisation_id = ${orgId}
        RETURNING id
      `);
      deplaces[ref.table] = (r as unknown as { rows: Array<{ id: number }> }).rows.map((x) => Number(x.id));
    }

    const [conserve] = await tx.select().from(contactsTable).where(and(eq(contactsTable.id, conserveId), eq(contactsTable.organisationId, orgId)));
    const [absorbe] = await tx.select().from(contactsTable).where(and(eq(contactsTable.id, absorbeId), eq(contactsTable.organisationId, orgId)));
    const vide = (v: unknown) => v === null || v === undefined || (typeof v === "string" && !v.trim());
    const complements: Partial<typeof contactsTable.$inferInsert> = {};
    for (const champ of ["email", "mobile", "company", "address"] as const) {
      if (vide(conserve![champ]) && !vide(absorbe![champ])) complements[champ] = absorbe![champ];
    }
    if (!vide(absorbe!.notes)) {
      complements.notes = vide(conserve!.notes) ? absorbe!.notes : `${conserve!.notes}\n\n— Fusion de la fiche #${absorbeId} —\n${absorbe!.notes}`;
    }
    const etiquettes = [...new Set([...(conserve!.tags ?? []), ...(absorbe!.tags ?? [])])];
    if (etiquettes.length) complements.tags = etiquettes;
    complements.totalCalls = (conserve!.totalCalls ?? 0) + (absorbe!.totalCalls ?? 0);
    complements.updatedBy = ctx.userId ?? null;
    const [maj] = await tx.update(contactsTable).set(complements)
      .where(and(eq(contactsTable.id, conserveId), eq(contactsTable.organisationId, orgId))).returning();

    const [supprime] = await tx.delete(contactsTable)
      .where(and(eq(contactsTable.id, absorbeId), eq(contactsTable.organisationId, orgId))).returning();
    const entrees = entreesCorbeille(contactsTable, [supprime as unknown as Record<string, unknown>], ctx);
    // Pas d'entree = pas de filet : on annule plutot que de supprimer sans recours.
    if (entrees.length !== 1) throw new Error("corbeille indisponible pour contacts");
    await tx.insert(deletedRowsTable).values(entrees);

    return { ok: true as const, deplaces, conserve: maj!, absorbeId };
  });
}

/** Lignes deja rattachees a un contact donne, par table (pour l'apercu avant fusion). */
export async function comptesDeReferences(orgId: number, contactIds: number[]): Promise<Record<number, Record<string, number>>> {
  const out: Record<number, Record<string, number>> = {};
  for (const id of contactIds) out[id] = {};
  if (!contactIds.length) return out;
  for (const ref of [...REFERENCES_CONTACT, REFERENCE_COMPTE_CLIENT]) {
    const r = await db.execute(sql`
      SELECT ${sql.identifier(ref.colonne)} AS cid, count(*)::int AS n FROM ${sql.identifier(ref.table)}
      WHERE organisation_id = ${orgId} AND ${sql.identifier(ref.colonne)} IN (${sql.join(contactIds.map((i) => sql`${i}`), sql`, `)})
      GROUP BY 1
    `);
    for (const row of (r as unknown as { rows: Array<{ cid: number; n: number }> }).rows) out[Number(row.cid)]![ref.table] = Number(row.n);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Chronologie
// ---------------------------------------------------------------------------

export type ElementChronologie = {
  type: string;
  id: number;
  date: string;
  titre: string | null;
  statut: string | null;
  detail: string | null;
  montant: number | null;
  lien: string;
};

/**
 * Lien vers la fiche de chaque element. Les ecrans sans route par
 * identifiant (devis, factures, messages) ouvrent leur liste.
 */
function lienDe(type: string, id: number): string {
  switch (type) {
    case "appel": return `/appels/${id}`;
    case "devis": return `/devis?id=${id}`;
    case "facture": return `/factures?id=${id}`;
    case "rendez_vous": return `/calendrier?id=${id}`;
    case "offre_rdv": return `/calendrier`;
    case "tache": return `/taches?id=${id}`;
    case "chantier": return `/projets/${id}`;
    case "opportunite": return `/prospects/${id}`;
    case "whatsapp": return `/whatsapp`;
    default: return `/messages`;
  }
}

export const LIMITE_CHRONOLOGIE_MAX = 100;

/**
 * Le fil d'un client, du plus recent au plus ancien.
 *
 * CHAQUE sous-requete porte `organisation_id = orgId` : la cle etrangere ne
 * garantit que l'existence du contact, pas qu'il appartient a la meme
 * organisation que la ligne. Une ligne d'un autre locataire forgee avec cet
 * identifiant ne doit pas apparaitre ici — c'est ce que verifie le test
 * d'isolation.
 *
 * Pagination par curseur (date, type, id) plutot que par decalage : un appel
 * qui arrive pendant qu'on fait defiler ne decale pas la page suivante.
 */
export async function chronologieDuContact(
  orgId: number,
  contactId: number,
  opts: { limite?: number; avant?: { date: string; type: string; id: number } | null } = {},
): Promise<{ elements: ElementChronologie[]; suivant: string | null } | null> {
  const [c] = await db.select({ id: contactsTable.id }).from(contactsTable)
    .where(and(eq(contactsTable.id, contactId), eq(contactsTable.organisationId, orgId)));
  if (!c) return null;
  const limite = Math.min(Math.max(opts.limite ?? 30, 1), LIMITE_CHRONOLOGIE_MAX);
  const curseur = opts.avant
    ? sql`WHERE (t.date, t.type, t.id) < (${opts.avant.date}::timestamptz, ${opts.avant.type}, ${opts.avant.id})`
    : sql``;
  const r = await db.execute(sql`
    SELECT * FROM (
      SELECT 'appel'::text AS type, id, created_at AS date, coalesce(contact_name, phone_number) AS titre, status AS statut, direction AS detail, NULL::numeric AS montant
        FROM calls WHERE organisation_id = ${orgId} AND contact_id = ${contactId}
      UNION ALL
      SELECT CASE WHEN type = 'note' THEN 'note' ELSE 'message' END, id, created_at, left(content, 200), type, phone_number, NULL
        FROM messages WHERE organisation_id = ${orgId} AND contact_id = ${contactId}
      UNION ALL
      SELECT 'whatsapp', wm.id, wm.created_at, left(wm.body, 200), wm.direction, NULL, NULL
        FROM whatsapp_messages wm
        JOIN whatsapp_conversations wc ON wc.id = wm.conversation_id AND wc.organisation_id = ${orgId}
        WHERE wm.organisation_id = ${orgId} AND wc.contact_id = ${contactId}
      UNION ALL
      SELECT 'devis', id, created_at, reference || ' — ' || title, status, NULL, total_amount
        FROM devis WHERE organisation_id = ${orgId} AND contact_id = ${contactId}
      UNION ALL
      SELECT 'facture', id, created_at, reference, status, NULL, total_amount
        FROM factures_client WHERE organisation_id = ${orgId} AND contact_id = ${contactId}
      UNION ALL
      SELECT 'rendez_vous', id, start_date, title, status, type, NULL
        FROM calendar_events WHERE organisation_id = ${orgId} AND related_contact_id = ${contactId}
      UNION ALL
      SELECT 'offre_rdv', id, created_at, reason, status, channel, NULL
        FROM appointment_offers WHERE organisation_id = ${orgId} AND related_contact_id = ${contactId}
      UNION ALL
      SELECT 'tache', id, created_at, title, status, NULL, NULL
        FROM tasks WHERE organisation_id = ${orgId} AND related_contact_id = ${contactId}
      UNION ALL
      SELECT 'chantier', id, created_at, title, status, NULL, NULL
        FROM projets WHERE organisation_id = ${orgId} AND contact_id = ${contactId}
      UNION ALL
      SELECT 'opportunite', id, created_at, title, stage, NULL, value
        FROM prospects WHERE organisation_id = ${orgId} AND contact_id = ${contactId}
    ) t
    ${curseur}
    ORDER BY t.date DESC, t.type DESC, t.id DESC
    LIMIT ${limite + 1}
  `);
  const lignes = (r as { rows: Array<Record<string, unknown>> }).rows;
  const elements = lignes.slice(0, limite).map((l) => {
    const type = String(l.type);
    const id = Number(l.id);
    return {
      type, id,
      date: new Date(l.date as string).toISOString(),
      titre: (l.titre as string | null) ?? null,
      statut: (l.statut as string | null) ?? null,
      detail: (l.detail as string | null) ?? null,
      montant: l.montant == null ? null : Number(l.montant),
      lien: lienDe(type, id),
    };
  });
  const dernier = elements[elements.length - 1];
  const suivant = lignes.length > limite && dernier ? `${dernier.date}|${dernier.type}|${dernier.id}` : null;
  return { elements, suivant };
}

/** `date|type|id` -> curseur, ou null si illisible. */
export function lireCurseur(brut: unknown): { date: string; type: string; id: number } | null {
  if (typeof brut !== "string" || !brut) return null;
  const [date, type, id] = brut.split("|");
  if (!date || !type || !id || Number.isNaN(Date.parse(date)) || !/^\d+$/.test(id)) return null;
  return { date, type, id: Number(id) };
}

