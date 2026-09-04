/**
 * platform-invoice-issue.ts — emettre une facture de la plateforme.
 *
 * Ce que la plateforme envoyait a ses clients n'etait pas une facture. Il n'y
 * avait ni numero, ni date d'emission, ni TVA, ni identite de l'acheteur:
 * seulement une periode, un plan et un montant. L'editeur qui vend un logiciel
 * de facturation emettait donc des documents que ce meme logiciel refuserait.
 *
 * Ce qui manquait, et pourquoi:
 *
 *   - le NUMERO. L'article 242 nonies A de l'annexe II au CGI impose « un
 *     numero unique base sur une sequence chronologique continue, sans
 *     rupture ». Il est attribue a l'emission et jamais au brouillon: un
 *     brouillon abandonne creerait un trou dans la suite.
 *   - la TVA. Les CGV annoncent des prix « exprimes en euros hors taxes » et
 *     une TVA qui « s'y ajoute ». Aucune ligne ne la portait: le client ne
 *     pouvait pas la deduire, et le total affiche n'etait pas la somme due.
 *   - l'IDENTITE DE L'ACHETEUR, figee. Lire le nom depuis `organisations` a
 *     l'affichage donnerait le nom d'aujourd'hui: un client qui change de
 *     raison sociale reecrirait toutes ses factures passees.
 *
 * L'identite du VENDEUR n'est pas copiee ici: elle est la meme sur toutes les
 * factures et figure aux mentions legales. La dupliquer par ligne inviterait a
 * la desynchroniser.
 */

import { sql, eq } from "drizzle-orm";
import { db, invoicesTable, organisationsTable } from "@workspace/db";

/** `FAC-2026-000001`: prefixe, annee, compteur sur six chiffres. */
const WIDTH = 6;
const PREFIX = "FAC";

/**
 * Taux de TVA applique aux abonnements, en pourcentage.
 *
 * 20 % — le taux normal francais — parce que c'est la situation annoncee:
 * editeur etabli en France, prix HT, TVA en sus. Reglable pour un changement
 * de taux ou un regime particulier, mais jamais devine par client: une
 * exoneration (autoliquidation intracommunautaire, client hors UE) suppose de
 * verifier le numero de TVA de l'acheteur, ce que le produit ne fait pas
 * encore. Appliquer 20 % a tout le monde est le choix prudent: on ne peut pas
 * reclamer a tort une TVA non due sans que le client le voie et le conteste,
 * alors qu'une TVA omise reste due par le vendeur.
 */
export const TAUX_TVA = Number(process.env.PLATFORM_VAT_RATE ?? 20);

interface Executeur {
  execute: (q: unknown) => Promise<unknown>;
}

/**
 * Attribue le prochain numero de la plateforme.
 *
 * A appeler DANS la transaction qui emet la facture: si l'emission echoue, le
 * compteur revient en arriere avec elle et la sequence reste sans trou.
 * L'increment se fait par `ON CONFLICT DO UPDATE`, donc sous le verrou de
 * l'ecriture elle-meme — un `SELECT max()+1` donnerait deux fois le meme
 * numero avec trois instances Cloud Run.
 */
export async function nextPlatformInvoiceNumber(
  tx: Executeur,
  year: number = new Date().getFullYear(),
): Promise<string> {
  const result = await tx.execute(sql`
    INSERT INTO platform_invoice_sequences (year, last_number, updated_at)
    VALUES (${year}, 1, now())
    ON CONFLICT (year)
    DO UPDATE SET last_number = platform_invoice_sequences.last_number + 1, updated_at = now()
    RETURNING last_number
  `);

  const rows = Array.isArray(result)
    ? (result as { last_number: number }[])
    : ((result as { rows?: { last_number: number }[] })?.rows ?? []);
  const valeur = rows[0]?.last_number;
  if (typeof valeur !== "number" || !Number.isFinite(valeur)) {
    // Ne pas retomber sur un numero aleatoire: ce serait revenir au defaut
    // qu'on corrige, en silence. Mieux vaut refuser d'emettre.
    throw new Error("Numerotation des factures plateforme indisponible");
  }
  return `${PREFIX}-${year}-${String(valeur).padStart(WIDTH, "0")}`;
}

/** Arrondi au centime, en evitant les surprises de la virgule flottante. */
function centimes(montant: number): string {
  return (Math.round(montant * 100) / 100).toFixed(2);
}

export interface ResultatEmission {
  reference: string;
  vatAmount: string;
  totalTtc: string;
}

/**
 * Emet une facture: numero, date, TVA et identite de l'acheteur.
 *
 * Idempotent — une facture qui porte deja un numero est renvoyee telle quelle.
 * Un cron qui repasse, un double clic sur « valider », une reprise apres
 * erreur: aucun de ces cas ne doit consommer un second numero.
 */
export async function emettreFacturePlateforme(invoiceId: number): Promise<ResultatEmission> {
  return db.transaction(async (tx) => {
    const [facture] = await tx.select().from(invoicesTable)
      .where(eq(invoicesTable.id, invoiceId))
      .for("update");
    if (!facture) throw new Error(`Facture ${invoiceId} introuvable`);

    if (facture.reference) {
      return {
        reference: facture.reference,
        vatAmount: facture.vatAmount,
        totalTtc: facture.totalTtc,
      };
    }

    const [org] = await tx.select().from(organisationsTable)
      .where(eq(organisationsTable.id, facture.organisationId));

    const ht = Number(facture.totalAmount);
    const tva = (ht * TAUX_TVA) / 100;
    const emiseLe = new Date();
    // L'annee du numero est celle de l'emission, pas celle de la periode
    // facturee: une facture de decembre emise en janvier appartient a la
    // sequence de janvier.
    const reference = await nextPlatformInvoiceNumber(tx, emiseLe.getFullYear());

    await tx.update(invoicesTable).set({
      reference,
      issuedAt: emiseLe,
      vatRate: centimes(TAUX_TVA),
      vatAmount: centimes(tva),
      totalTtc: centimes(ht + tva),
      buyerSnapshot: org
        ? {
            name: org.name,
            address: org.address ?? null,
            siret: org.siret ?? null,
            tvaNumber: org.tvaNumber ?? null,
          }
        : null,
    }).where(eq(invoicesTable.id, invoiceId));

    return { reference, vatAmount: centimes(tva), totalTtc: centimes(ht + tva) };
  });
}
