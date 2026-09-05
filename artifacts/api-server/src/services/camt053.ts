/**
 * camt053.ts — lire un releve bancaire ISO 20022 (camt.053).
 *
 * POURQUOI CE FORMAT, et pas un autre. Les virements entraient a la main, par
 * `/billing/upload-bank`, avec les champs qu'on voulait bien recopier. Or le
 * rapprochement automatique ne vaut que ce que vaut la reference recue: la
 * litterature donne 85 a 95 % d'appariement quand la remise porte une
 * reference structuree, contre 50 a 60 % sans.
 *
 * camt.053 est le format qui la preserve. Contrairement au MT940 et aux
 * exports CSV, il NE TRONQUE PAS l'information de remise, et il la range dans
 * des champs distincts: la reference structuree du creancier
 * (`RmtInf/Strd/CdtrRefInf/Ref`), le texte libre (`RmtInf/Ustrd`), et la
 * reference de bout en bout posee par le donneur d'ordre (`Refs/EndToEndId`).
 * La majorite des banques francaises le proposent depuis 2023, et il ne depend
 * d'aucun agregateur, d'aucun contrat, d'aucun certificat eIDAS — lesquels
 * coutent 3 000 a 8 000 EUR par an pour un acces PSD2 direct.
 *
 * CE QUE CE MODULE NE FAIT PAS. Il ne decide rien: il lit. Le rapprochement
 * reste dans `payment-matching.ts`, qui n'applique automatiquement qu'une
 * reference de facture reconnue. Separer la lecture de la decision, c'est
 * pouvoir eprouver chacune sans l'autre.
 */

import { XMLParser } from "fast-xml-parser";

/**
 * Le fichier fourni n'est pas un releve exploitable.
 *
 * Distincte d'une erreur technique: elle designe une entree invalide, et
 * l'appelant doit repondre 400 — pas 500. Un exploitant qui depose le mauvais
 * fichier doit lire « ce fichier n'est pas un releve », pas « erreur interne ».
 */
export class ReleveIllisible extends Error {
  constructor(raison: string) {
    super(`Releve camt.053 illisible: ${raison}`);
    this.name = "ReleveIllisible";
  }
}

export interface EcritureCamt {
  /** Montant, positif. Seuls les credits sont retournes. */
  montant: number;
  devise: string;
  /** Date de comptabilisation, ou date de valeur a defaut. */
  date: Date | null;
  /**
   * Reference attribuee par la banque a cette ecriture. Censee etre unique —
   * mais toutes les banques ne l'honorent pas, d'ou l'empreinte composite
   * calculee par `empreinte()` plutot qu'une confiance aveugle.
   */
  refBanque: string | null;
  /** Reference posee par le donneur d'ordre (`EndToEndId`). */
  refDeBoutEnBout: string | null;
  /** Reference structuree du creancier, quand le payeur en a mis une. */
  refStructuree: string | null;
  /** Communication libre, telle que saisie par le payeur. */
  communication: string | null;
  /** Nom du donneur d'ordre. */
  payeur: string | null;
  payeurIban: string | null;
}

/** Premiere valeur non vide d'un champ qui peut etre absent, unique ou repete. */
function premier(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) {
    for (const x of v) {
      const r = premier(x);
      if (r) return r;
    }
    return null;
  }
  if (typeof v === "object") return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

/** Toujours un tableau: camt.053 rend un objet quand il n'y a qu'un element. */
function liste<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function date(v: unknown): Date | null {
  const s = premier(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * Empreinte d'une ecriture, pour ne pas l'importer deux fois.
 *
 * Le meme releve redepose — par prudence, par erreur, ou parce qu'un mois
 * chevauche le precedent — creerait autant de paiements en double, et donc
 * autant de factures soldees a tort. `AcctSvcrRef` est cense identifier
 * l'ecriture de facon unique, mais la norme est inegalement respectee: on ne
 * s'y fie donc pas seul. L'empreinte combine ce que la banque affirme et ce
 * qu'on observe.
 */
export function empreinte(e: EcritureCamt): string {
  const jour = e.date ? e.date.toISOString().slice(0, 10) : "sans-date";
  return [
    e.refBanque ?? "",
    jour,
    e.montant.toFixed(2),
    e.devise,
    e.refDeBoutEnBout ?? "",
    e.payeurIban ?? "",
    (e.communication ?? "").slice(0, 80),
  ].join("|");
}

/**
 * Lit un fichier camt.053 et rend les CREDITS.
 *
 * Les debits sont ecartes: ce module sert l'encaissement, et importer les
 * depenses ferait entrer dans la table des paiements des lignes qu'aucune
 * facture ne peut solder.
 */
export function lireCamt053(xml: string): EcritureCamt[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    // Les balises camt sont deja explicites; on veut les valeurs telles quelles.
    parseTagValue: false,
    trimValues: true,
    // Pas d'entites externes: un releve arrive d'un tiers, et un analyseur XML
    // qui les resout est une porte ouverte (XXE).
    processEntities: false,
  });

  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch (err: unknown) {
    // L'analyseur REFUSE un fichier qui declare des entites externes plutot que
    // de les ignorer — c'est le bon comportement, et c'est aussi celui qu'il
    // faut traduire. Laisser remonter l'erreur brute donnerait un 500 opaque
    // sur ce qui est en realite un fichier invalide: l'exploitant chercherait
    // une panne la ou il n'a qu'un mauvais releve.
    throw new ReleveIllisible(
      err instanceof Error ? err.message : "format non reconnu",
    );
  }
  const racine = (doc?.Document ?? doc) as Record<string, unknown>;
  const rapport = (racine?.BkToCstmrStmt ?? {}) as Record<string, unknown>;

  const ecritures: EcritureCamt[] = [];

  for (const stmt of liste(rapport.Stmt as Record<string, unknown> | Record<string, unknown>[])) {
    for (const ntry of liste(stmt.Ntry as Record<string, unknown> | Record<string, unknown>[])) {
      // CRDT = credit. Un debit ne solde aucune facture.
      if (premier(ntry.CdtDbtInd) !== "CRDT") continue;

      const amt = ntry.Amt as Record<string, unknown> | string | undefined;
      const montantBrut =
        typeof amt === "object" && amt !== null ? premier((amt as Record<string, unknown>)["#text"]) : premier(amt);
      const montant = Number(montantBrut);
      if (!Number.isFinite(montant) || montant <= 0) continue;

      const devise =
        (typeof amt === "object" && amt !== null
          ? premier((amt as Record<string, unknown>)["@_Ccy"])
          : null) ?? "EUR";

      const dtls = liste(
        (ntry.NtryDtls as Record<string, unknown> | undefined)?.TxDtls as
          | Record<string, unknown>
          | Record<string, unknown>[]
          | undefined,
      );
      // Une ecriture peut regrouper plusieurs operations. On lit la premiere:
      // un lot mal reparti doit rester une suggestion, pas une certitude.
      const tx = dtls[0] ?? {};
      const refs = (tx.Refs ?? {}) as Record<string, unknown>;
      const rmt = (tx.RmtInf ?? {}) as Record<string, unknown>;
      const strd = liste(rmt.Strd as Record<string, unknown> | Record<string, unknown>[] | undefined)[0] ?? {};
      const cdtrRef = ((strd.CdtrRefInf ?? {}) as Record<string, unknown>).Ref;

      const parties = (tx.RltdPties ?? {}) as Record<string, unknown>;
      const dbtr = (parties.Dbtr ?? {}) as Record<string, unknown>;
      const dbtrAcct = ((parties.DbtrAcct ?? {}) as Record<string, unknown>).Id as
        | Record<string, unknown>
        | undefined;

      ecritures.push({
        montant,
        devise,
        date:
          date((ntry.BookgDt as Record<string, unknown> | undefined)?.Dt) ??
          date((ntry.BookgDt as Record<string, unknown> | undefined)?.DtTm) ??
          date((ntry.ValDt as Record<string, unknown> | undefined)?.Dt),
        refBanque: premier(ntry.AcctSvcrRef) ?? premier(refs.AcctSvcrRef),
        refDeBoutEnBout: premier(refs.EndToEndId),
        refStructuree: premier(cdtrRef),
        communication: premier(rmt.Ustrd),
        payeur: premier(dbtr.Nm),
        payeurIban: premier(dbtrAcct?.IBAN),
      });
    }
  }

  return ecritures;
}

/**
 * Tout le texte de l'ecriture susceptible de porter un numero de facture.
 *
 * L'ordre suit la fiabilite: reference structuree, puis reference de bout en
 * bout, puis communication libre, puis nom du payeur. Le rapprochement les
 * concatene — c'est lui qui cherche une reference de facture dedans.
 */
export function texteRapprochement(e: EcritureCamt): string {
  return [e.refStructuree, e.refDeBoutEnBout, e.communication, e.payeur]
    .filter(Boolean)
    .join(" ");
}
