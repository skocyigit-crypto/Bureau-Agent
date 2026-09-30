/**
 * LE DOSSIER D'UN CHANTIER (plan du 29/09, sections 6 et 8).
 *
 * Ce qui manquait, et ce n'etait pas un ecran : rien ne rattachait une depense,
 * une facture, un encaissement ou un appel a un chantier. Les montants
 * existaient tous, aucun n'etait ADDITIONNABLE par affaire. On pouvait donc
 * repondre « combien ai-je depense ce mois-ci » et pas « ce chantier me
 * rapporte-t-il quelque chose » — la seule des deux questions dont depend la
 * survie de l'entreprise.
 *
 * LES CINQ MONTANTS, ET POURQUOI CEUX-LA
 *
 *   engage    = devis initial accepte + avenants acceptes
 *   depense   = depenses approuvees rattachees au chantier
 *   facture   = factures emises (ni brouillon, ni annulee)
 *   encaisse  = journal des encaissements des factures du chantier
 *
 * `engage` est la reference, et c'est le point le plus important de ce fichier.
 * L'ecran « Aujourd'hui » comparait la depense a `projets.budget`, une colonne
 * saisie a la main : sur un chantier ouvert depuis un devis elle reste NULLE,
 * et le depassement de budget ne pouvait donc JAMAIS s'afficher la ou il
 * compte. On compare desormais a ce sur quoi le client s'est engage — c'est
 * aussi la seule grandeur qu'un litige permet d'opposer.
 *
 * `budget` n'est pas supprime : une entreprise peut vouloir se fixer une
 * enveloppe de depenses differente du prix de vente. Il devient une PREVISION
 * facultative, plus la reference.
 *
 * CHAQUE MONTANT PORTE SES SOURCES. Le plan l'exige mot pour mot : « Her finans
 * rakamından kaynak kayda gidilebilmeli. » Un total sans ses lignes est une
 * affirmation ; avec ses lignes, c'est une addition qu'on peut refaire. Les
 * listes sont donc rendues avec le total, pas derriere un second appel.
 *
 * CE QUI N'EST PAS CALCULE ICI, VOLONTAIREMENT
 *
 *   - aucune « marge prevue » ni « rentabilite estimee ». La marge constatee
 *     (engage - depense) est une soustraction de faits enregistres ; une marge
 *     PREVUE supposerait de deviner les depenses restantes, et le plan interdit
 *     les estimations de rentabilite sans source ;
 *   - aucun pourcentage d'avancement deduit des depenses. Depenser la moitie du
 *     budget ne veut pas dire avoir fait la moitie du travail, et un
 *     pourcentage d'avancement engage une situation de travaux, donc un
 *     paiement.
 */
import {
  db, avenantsTable, calendarEventsTable, callsTable, contactsTable, depensesTable, devisTable,
  documentsTable, encaissementsTable, facturesClientTable, journalChantierTable, projetsTable,
  tasksTable, usersTable,
} from "@workspace/db";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";

/** Une ligne qui justifie un montant : on peut l'ouvrir et refaire l'addition. */
export type Source = {
  /** `depense` | `facture` | `encaissement` | `devis` | `avenant` */
  tur: string;
  id: number;
  /** Reference ou intitule tel qu'enregistre — donnee, pas texte d'interface. */
  baslik: string;
  detay: string | null;
  tutar: number;
  zaman: string | null;
  /** Fiche de l'enregistrement. */
  href: string;
};

export type Montant = {
  /** En unites de la devise du chantier (euros), jamais en centimes. */
  toplam: number;
  /** Nombre de lignes qui composent le total, meme si `kaynaklar` est tronque. */
  adet: number;
  kaynaklar: Source[];
  /** Vrai si `kaynaklar` ne montre pas tout. */
  fazlasi: boolean;
};

export type MontantsChantier = {
  devise: string;
  /** Le marche initial accepte. Zero si le chantier n'a pas ete ouvert depuis un devis. */
  teklif: Montant;
  /** Les avenants ACCEPTES. Un avenant envoye ou refuse ne compte pas. */
  ekIsler: Montant;
  /** teklif + ekIsler : ce sur quoi le client s'est engage. */
  onayliIs: number;
  gider: Montant;
  faturalanan: Montant;
  tahsilEdilen: Montant;
  /** onayliIs - gider. Une soustraction de faits, pas une prevision. */
  marj: number;
  /** onayliIs - faturalanan : ce qui reste a facturer. */
  faturalanmayan: number;
  /** faturalanan - tahsilEdilen : ce qui reste a encaisser. */
  tahsilEdilmeyen: number;
  /** Vrai quand la depense depasse ce qui a ete accepte, et qu'il y a un accepte. */
  asim: boolean;
  /** L'enveloppe que l'entreprise s'est eventuellement fixee. Prevision, pas reference. */
  butcePrevision: number | null;
};

/** Factures qui existent vraiment : un brouillon n'est pas emis, une annulee ne compte plus. */
export const STATUTS_FACTURE_EMISE = ["envoyee", "partiellement_payee", "en_retard", "payee"] as const;

const LIMITE_SOURCES = 100;

/**
 * Les colonnes du chantier, QUALIFIEES, pour les sous-requetes correlees.
 *
 * Mesure du 30/09 (`.toSQL()` sur la base de banc) : dans une requete a table
 * unique, Drizzle ecrit une colonne placee DIRECTEMENT dans un champ `sql` de
 * la liste de selection sans son prefixe — `${projetsTable.id}` y devient
 * `"id"`. (Dans un `where`, ou imbriquee dans un autre `sql`, il la
 * qualifie : la meme expression change de sens selon l endroit ou on la pose.)
 *
 * Dans une sous-requete correlee, `"id"` se resout sur la table INTERIEURE :
 *   - `from avenants av join devis da ... where av.projet_id = "id"` leve
 *     « column reference id is ambiguous » — c est la panne qui a revele le
 *     probleme (comparaison par affaire en 500) ;
 *   - `from factures_client fc where fc.projet_id = "id"` ne leve RIEN : il
 *     compare chaque facture a elle-meme et rend un total faux, sans erreur.
 *
 * On ecrit donc le nom complet, qui ne se resout que d une facon, ou que
 * l expression soit posee.
 */
const P_ID = sql.raw(`"projets"."id"`);
const P_DEVIS_ID = sql.raw(`"projets"."devis_id"`);
// Chaque sous-requete est bornee a l organisation du chantier, comme le sont
// les requetes de `montantsDuChantier` : sans quoi une ligne mal rattachee
// (import, correction manuelle) entrerait dans la comparaison et dans
// « Aujourd hui » mais pas dans le dossier — deux ecrans, deux chiffres.
const P_ORG = sql.raw(`"projets"."organisation_id"`);

function nombre(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number.parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function arrondi(n: number): number {
  return Math.round(n * 100) / 100;
}

function instant(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const v = d instanceof Date ? d : new Date(d);
  return Number.isNaN(v.getTime()) ? null : v.toISOString();
}

function montant(kaynaklar: Source[]): Montant {
  const toplam = arrondi(kaynaklar.reduce((s, k) => s + k.tutar, 0));
  return {
    toplam,
    adet: kaynaklar.length,
    kaynaklar: kaynaklar.slice(0, LIMITE_SOURCES),
    fazlasi: kaynaklar.length > LIMITE_SOURCES,
  };
}

/**
 * Les cinq montants d'un chantier, avec leurs sources.
 *
 * Toutes les requetes portent `organisationId` : le numero de chantier vient de
 * l'URL, et un identifiant d'une autre organisation ne doit rien rendre.
 */
export async function montantsDuChantier(organisationId: number, projetId: number): Promise<MontantsChantier | null> {
  const [projet] = await db
    .select({
      id: projetsTable.id,
      devisId: projetsTable.devisId,
      budget: projetsTable.budget,
      currency: projetsTable.currency,
    })
    .from(projetsTable)
    .where(and(eq(projetsTable.id, projetId), eq(projetsTable.organisationId, organisationId)))
    .limit(1);
  if (!projet) return null;

  // 1. Le marche initial. On le relit meme si `projets.devisId` le designe :
  //    il ne compte que s'il est ACCEPTE, et un devis peut avoir ete repasse en
  //    brouillon depuis l'ouverture du chantier.
  const devisInitial = projet.devisId
    ? await db
        .select({
          id: devisTable.id, reference: devisTable.reference, title: devisTable.title,
          totalAmount: devisTable.totalAmount, status: devisTable.status, acceptedAt: devisTable.acceptedAt,
        })
        .from(devisTable)
        .where(and(
          eq(devisTable.id, projet.devisId),
          eq(devisTable.organisationId, organisationId),
          eq(devisTable.status, "accepte"),
        ))
        .limit(1)
    : [];

  const teklif = montant(devisInitial.map((d) => ({
    tur: "devis",
    id: d.id,
    baslik: d.reference,
    detay: d.title,
    tutar: nombre(d.totalAmount),
    zaman: instant(d.acceptedAt),
    href: `/devis?id=${d.id}`,
  })));

  // 2. Les avenants acceptes. `avenants` dit lesquels appartiennent au
  //    chantier ; `devis.status` dit lesquels sont accordes.
  const avenants = await db
    .select({
      avenantId: avenantsTable.id, motif: avenantsTable.motif,
      devisId: devisTable.id, reference: devisTable.reference,
      totalAmount: devisTable.totalAmount, acceptedAt: devisTable.acceptedAt,
    })
    .from(avenantsTable)
    .innerJoin(devisTable, eq(devisTable.id, avenantsTable.devisId))
    .where(and(
      eq(avenantsTable.projetId, projetId),
      eq(avenantsTable.organisationId, organisationId),
      eq(devisTable.status, "accepte"),
    ))
    .orderBy(desc(avenantsTable.id));

  const ekIsler = montant(avenants.map((a) => ({
    tur: "avenant",
    id: a.avenantId,
    baslik: a.reference,
    detay: a.motif,
    tutar: nombre(a.totalAmount),
    zaman: instant(a.acceptedAt),
    href: `/devis?id=${a.devisId}`,
  })));

  // 3. Les depenses APPROUVEES. Une depense en file d'inspection n'est pas
  //    encore un cout du chantier : elle peut etre un doublon ou un faux
  //    positif de l'extraction, et la compter ferait clignoter un depassement
  //    qui n'existe pas.
  const depenses = await db
    .select({
      id: depensesTable.id, vendor: depensesTable.vendor, title: depensesTable.title,
      reference: depensesTable.reference, amountTtc: depensesTable.amountTtc,
      expenseDate: depensesTable.expenseDate, category: depensesTable.category,
    })
    .from(depensesTable)
    .where(and(
      eq(depensesTable.projetId, projetId),
      eq(depensesTable.organisationId, organisationId),
      eq(depensesTable.status, "approuve"),
    ))
    .orderBy(desc(depensesTable.expenseDate));

  const gider = montant(depenses.map((d) => ({
    tur: "depense",
    id: d.id,
    baslik: d.vendor || d.title || d.reference || `#${d.id}`,
    detay: d.category,
    tutar: nombre(d.amountTtc),
    zaman: instant(d.expenseDate),
    href: `/depenses?id=${d.id}`,
  })));

  // 4. Les factures emises.
  const factures = await db
    .select({
      id: facturesClientTable.id, reference: facturesClientTable.reference, title: facturesClientTable.title,
      totalAmount: facturesClientTable.totalAmount, status: facturesClientTable.status,
      dueDate: facturesClientTable.dueDate,
    })
    .from(facturesClientTable)
    .where(and(
      eq(facturesClientTable.projetId, projetId),
      eq(facturesClientTable.organisationId, organisationId),
      inArray(facturesClientTable.status, [...STATUTS_FACTURE_EMISE]),
    ))
    .orderBy(desc(facturesClientTable.id));

  const faturalanan = montant(factures.map((f) => ({
    tur: "facture",
    id: f.id,
    baslik: f.reference,
    detay: f.title,
    tutar: nombre(f.totalAmount),
    zaman: instant(f.dueDate),
    href: `/factures?id=${f.id}`,
  })));

  // 5. Les encaissements. La source de verite est le JOURNAL, pas
  //    `factures_client.paid_amount` : cette colonne est un cache d'affichage
  //    modifiable, le journal est chaine et inalterable (art. 286-I-3 bis CGI).
  //    Les annulations y sont des montants negatifs : la somme les prend en
  //    compte sans traitement particulier.
  const idsFacture = factures.map((f) => f.id);
  const encaissements = idsFacture.length
    ? await db
        .select({
          id: encaissementsTable.id, numero: encaissementsTable.numero,
          factureId: encaissementsTable.factureId, montantCentimes: encaissementsTable.montantCentimes,
          moyen: encaissementsTable.moyen, sens: encaissementsTable.sens,
          dateEncaissement: encaissementsTable.dateEncaissement,
        })
        .from(encaissementsTable)
        .where(and(
          eq(encaissementsTable.organisationId, organisationId),
          inArray(encaissementsTable.factureId, idsFacture),
        ))
        .orderBy(desc(encaissementsTable.numero))
    : [];

  const referenceParFacture = new Map(factures.map((f) => [f.id, f.reference]));
  const tahsilEdilen = montant(encaissements.map((e) => ({
    tur: "encaissement",
    id: e.id,
    baslik: `#${e.numero}`,
    detay: [referenceParFacture.get(e.factureId ?? -1), e.moyen, e.sens === "annulation" ? "annulation" : null]
      .filter(Boolean).join(" · ") || null,
    tutar: arrondi(e.montantCentimes / 100),
    zaman: instant(e.dateEncaissement),
    href: `/factures?id=${e.factureId ?? ""}`,
  })));

  const onayliIs = arrondi(teklif.toplam + ekIsler.toplam);
  return {
    devise: projet.currency,
    teklif,
    ekIsler,
    onayliIs,
    gider,
    faturalanan,
    tahsilEdilen,
    marj: arrondi(onayliIs - gider.toplam),
    faturalanmayan: arrondi(onayliIs - faturalanan.toplam),
    tahsilEdilmeyen: arrondi(faturalanan.toplam - tahsilEdilen.toplam),
    asim: onayliIs > 0 && gider.toplam > onayliIs,
    butcePrevision: projet.budget == null ? null : nombre(projet.budget),
  };
}

/**
 * Ce qu'un chantier a depasse, en SQL, pour une liste de chantiers.
 *
 * Meme definition que `montantsDuChantier` — la comparaison porte sur ce qui a
 * ete accepte, pas sur `projets.budget`. Extrait ici parce que « Aujourd'hui »
 * doit poser la question sur TOUS les chantiers d'un coup : appeler la fonction
 * ci-dessus par chantier ferait six requetes par ligne.
 *
 * Renvoie un fragment vrai/faux utilisable en `where`.
 */
export function depassementSql() {
  const engage = sql`(
    coalesce((
      select sum(di.total_amount)::numeric from devis di
      where di.id = ${P_DEVIS_ID} and di.organisation_id = ${P_ORG} and di.status = 'accepte'
    ), 0)
    + coalesce((
      select sum(da.total_amount)::numeric from avenants av
      join devis da on da.id = av.devis_id
      where av.projet_id = ${P_ID} and av.organisation_id = ${P_ORG} and da.organisation_id = ${P_ORG} and da.status = 'accepte'
    ), 0)
  )`;
  const depense = sql`coalesce((
    select sum(dp.amount_ttc)::numeric from depenses dp
    where dp.projet_id = ${P_ID} and dp.organisation_id = ${P_ORG} and dp.status = 'approuve'
  ), 0)`;
  return { engage, depense, depasse: sql`${engage} > 0 and ${depense} > ${engage}` };
}

export type OngletsChantier = {
  ekip: { isim: string; rol: string | null; gorevAdedi: number }[];
  planning: { id: number; baslik: string; tur: string; baslangic: string; bitis: string; durum: string | null }[];
  gorevler: { id: number; baslik: string; durum: string; sorumlu: string | null; vade: string | null }[];
  gunluk: {
    id: number; jour: string; meteo: string | null; effectif: number | null;
    travaux: string; incidents: string | null; brouillon: boolean; yazan: string | null; fotoAdedi: number;
  }[];
  belgeler: { id: number; isim: string; tur: string; boyut: number; kategori: string | null; zaman: string | null }[];
  gorusmeler: { id: number; kisi: string | null; numara: string; yon: string; durum: string; sure: number; not: string | null; zaman: string | null }[];
  /**
   * TOUS les avenants, quel que soit leur etat. `montants.ekIsler` ne compte
   * que les acceptes ; cette liste montre aussi ceux qui attendent un accord,
   * pour qu un supplement en suspens reste VISIBLE sans etre compte — le plan
   * demande que l ek iş soit « suivi comme un etat a part ».
   */
  avenantlar: { id: number; devisId: number; reference: string; motif: string; statut: string; tutar: number; zaman: string | null }[];
};

/** Le chantier lui-meme, ses montants et le contenu de ses onglets. */
export type DossierChantier = {
  projet: {
    id: number; baslik: string; aciklama: string | null; durum: string; oncelik: string;
    musteri: string | null; adres: string | null; sorumlu: string | null;
    baslangic: string | null; bitis: string | null; gercekBitis: string | null;
    kabul: string | null; kabulCekinceli: boolean; cekinceler: string | null;
    ilerleme: number; devisId: number | null; prospectId: number | null; contactId: number | null;
  };
  montants: MontantsChantier;
  onglets: OngletsChantier;
};

export async function dossierChantier(organisationId: number, projetId: number): Promise<DossierChantier | null> {
  const [projet] = await db
    .select()
    .from(projetsTable)
    .where(and(eq(projetsTable.id, projetId), eq(projetsTable.organisationId, organisationId)))
    .limit(1);
  if (!projet) return null;

  const montants = await montantsDuChantier(organisationId, projetId);
  if (!montants) return null;

  const [taches, creneaux, notes, belges, appels, tousAvenants] = await Promise.all([
    db.select({
      id: tasksTable.id, title: tasksTable.title, status: tasksTable.status,
      assignedTo: tasksTable.assignedTo, dueDate: tasksTable.dueDate,
    }).from(tasksTable)
      .where(and(eq(tasksTable.projetId, projetId), eq(tasksTable.organisationId, organisationId)))
      .orderBy(desc(tasksTable.dueDate)).limit(200),

    db.select({
      id: calendarEventsTable.id, title: calendarEventsTable.title, type: calendarEventsTable.type,
      startDate: calendarEventsTable.startDate, endDate: calendarEventsTable.endDate,
      status: calendarEventsTable.status,
    }).from(calendarEventsTable)
      .where(and(eq(calendarEventsTable.projetId, projetId), eq(calendarEventsTable.organisationId, organisationId)))
      .orderBy(calendarEventsTable.startDate).limit(200),

    db.select({
      id: journalChantierTable.id, jour: journalChantierTable.jour, meteo: journalChantierTable.meteo,
      effectif: journalChantierTable.effectif, travaux: journalChantierTable.travaux,
      incidents: journalChantierTable.incidents, brouillon: journalChantierTable.brouillon,
      prenom: usersTable.prenom, nom: usersTable.nom,
      fotoAdedi: sql<number>`(
        select count(*)::int from documents dd
        where dd.entity_type = 'journal_chantier' and dd.entity_id = "journal_chantier"."id"
      )`,
    }).from(journalChantierTable)
      .leftJoin(usersTable, eq(usersTable.id, journalChantierTable.redigePar))
      .where(and(eq(journalChantierTable.projetId, projetId), eq(journalChantierTable.organisationId, organisationId)))
      .orderBy(desc(journalChantierTable.jour)).limit(120),

    db.select({
      id: documentsTable.id, originalName: documentsTable.originalName, mimeType: documentsTable.mimeType,
      fileSize: documentsTable.fileSize, category: documentsTable.category, createdAt: documentsTable.createdAt,
    }).from(documentsTable)
      .where(and(
        eq(documentsTable.organisationId, organisationId),
        eq(documentsTable.entityType, "projet"),
        eq(documentsTable.entityId, projetId),
      ))
      .orderBy(desc(documentsTable.createdAt)).limit(200),

    db.select({
      id: callsTable.id, contactName: callsTable.contactName, phoneNumber: callsTable.phoneNumber,
      direction: callsTable.direction, status: callsTable.status, duration: callsTable.duration,
      notes: callsTable.notes, createdAt: callsTable.createdAt,
      contactPrenom: contactsTable.firstName,
      contactNom: contactsTable.lastName,
    }).from(callsTable)
      .leftJoin(contactsTable, eq(contactsTable.id, callsTable.contactId))
      .where(and(eq(callsTable.projetId, projetId), eq(callsTable.organisationId, organisationId)))
      .orderBy(desc(callsTable.createdAt)).limit(200),

    db.select({
      id: avenantsTable.id, devisId: devisTable.id, reference: devisTable.reference, motif: avenantsTable.motif,
      statut: devisTable.status, totalAmount: devisTable.totalAmount, createdAt: avenantsTable.createdAt,
    }).from(avenantsTable)
      .innerJoin(devisTable, eq(devisTable.id, avenantsTable.devisId))
      .where(and(eq(avenantsTable.projetId, projetId), eq(avenantsTable.organisationId, organisationId)))
      .orderBy(desc(avenantsTable.id)).limit(200),
  ]);

  // L'equipe : les noms inscrits sur la fiche, plus toute personne a qui une
  // tache du chantier est assignee. Une personne qui travaille dessus sans
  // figurer sur la fiche est quand meme de l'equipe — c'est le cas courant du
  // renfort envoye pour trois jours.
  const charge = new Map<string, number>();
  for (const t of taches) {
    if (!t.assignedTo) continue;
    charge.set(t.assignedTo, (charge.get(t.assignedTo) ?? 0) + 1);
  }
  const ekip: OngletsChantier["ekip"] = [];
  const vus = new Set<string>();
  if (projet.assignedTo) { vus.add(projet.assignedTo); ekip.push({ isim: projet.assignedTo, rol: "sorumlu", gorevAdedi: charge.get(projet.assignedTo) ?? 0 }); }
  for (const m of projet.teamMembers ?? []) {
    if (!m || vus.has(m)) continue;
    vus.add(m);
    ekip.push({ isim: m, rol: "ekip", gorevAdedi: charge.get(m) ?? 0 });
  }
  for (const [isim, adet] of charge) {
    if (vus.has(isim)) continue;
    vus.add(isim);
    ekip.push({ isim, rol: null, gorevAdedi: adet });
  }

  return {
    projet: {
      id: projet.id,
      baslik: projet.title,
      aciklama: projet.description,
      durum: projet.status,
      oncelik: projet.priority,
      musteri: projet.clientCompany || projet.clientName,
      adres: projet.address,
      sorumlu: projet.assignedTo,
      baslangic: instant(projet.startDate),
      bitis: instant(projet.endDate),
      gercekBitis: instant(projet.actualEndDate),
      kabul: instant(projet.receptionDate),
      kabulCekinceli: projet.receptionWithReserves,
      cekinceler: projet.receptionReserves,
      ilerleme: projet.progress,
      devisId: projet.devisId,
      prospectId: projet.prospectId,
      contactId: projet.contactId,
    },
    montants,
    onglets: {
      ekip,
      planning: creneaux.map((c) => ({
        id: c.id, baslik: c.title, tur: c.type,
        baslangic: instant(c.startDate)!, bitis: instant(c.endDate)!, durum: c.status,
      })),
      gorevler: taches.map((t) => ({
        id: t.id, baslik: t.title, durum: t.status, sorumlu: t.assignedTo, vade: instant(t.dueDate),
      })),
      gunluk: notes.map((n) => ({
        id: n.id, jour: n.jour, meteo: n.meteo, effectif: n.effectif, travaux: n.travaux,
        incidents: n.incidents, brouillon: n.brouillon,
        yazan: [n.prenom, n.nom].filter(Boolean).join(" ") || null,
        fotoAdedi: Number(n.fotoAdedi ?? 0),
      })),
      belgeler: belges.map((d) => ({
        id: d.id, isim: d.originalName, tur: d.mimeType, boyut: d.fileSize,
        kategori: d.category, zaman: instant(d.createdAt),
      })),
      gorusmeler: appels.map((a) => ({
        id: a.id, kisi: [a.contactPrenom, a.contactNom].filter(Boolean).join(" ") || a.contactName, numara: a.phoneNumber,
        yon: a.direction, durum: a.status, sure: a.duration, not: a.notes, zaman: instant(a.createdAt),
      })),
      avenantlar: tousAvenants.map((a) => ({
        id: a.id, devisId: a.devisId, reference: a.reference, motif: a.motif,
        statut: a.statut, tutar: nombre(a.totalAmount), zaman: instant(a.createdAt),
      })),
    },
  };
}

/**
 * La comparaison par affaire (plan du 29/09, section 8).
 *
 * Un tableau par chantier des memes cinq montants. Calcule en UNE requete avec
 * des sous-requetes correlees : la version « une boucle sur montantsDuChantier »
 * faisait six requetes par chantier, soit 300 pour cinquante chantiers.
 *
 * Ce tableau ne porte PAS les sources : sur une liste, elles seraient illisibles
 * et le corps de reponse enorme. Chaque ligne mene au dossier du chantier, qui
 * les porte.
 */
export type LigneComparaison = {
  id: number;
  baslik: string;
  durum: string;
  musteri: string | null;
  devise: string;
  teklif: number;
  ekIsler: number;
  onayliIs: number;
  gider: number;
  faturalanan: number;
  tahsilEdilen: number;
  marj: number;
  faturalanmayan: number;
  tahsilEdilmeyen: number;
  asim: boolean;
};

export async function comparaisonParAffaire(organisationId: number, limite = 200): Promise<LigneComparaison[]> {
  const statutsEmis = STATUTS_FACTURE_EMISE.map((s) => `'${s}'`).join(", ");
  const lignes = await db
    .select({
      id: projetsTable.id,
      baslik: projetsTable.title,
      durum: projetsTable.status,
      clientName: projetsTable.clientName,
      clientCompany: projetsTable.clientCompany,
      devise: projetsTable.currency,
      teklif: sql<string>`coalesce((
        select sum(di.total_amount)::numeric from devis di
        where di.id = ${P_DEVIS_ID} and di.organisation_id = ${P_ORG} and di.status = 'accepte'
      ), 0)`,
      ekIsler: sql<string>`coalesce((
        select sum(da.total_amount)::numeric from avenants av
        join devis da on da.id = av.devis_id
        where av.projet_id = ${P_ID} and av.organisation_id = ${P_ORG} and da.organisation_id = ${P_ORG} and da.status = 'accepte'
      ), 0)`,
      gider: sql<string>`coalesce((
        select sum(dp.amount_ttc)::numeric from depenses dp
        where dp.projet_id = ${P_ID} and dp.organisation_id = ${P_ORG} and dp.status = 'approuve'
      ), 0)`,
      faturalanan: sql<string>`coalesce((
        select sum(fc.total_amount)::numeric from factures_client fc
        where fc.projet_id = ${P_ID} and fc.organisation_id = ${P_ORG} and fc.status in (${sql.raw(statutsEmis)})
      ), 0)`,
      tahsilEdilen: sql<string>`coalesce((
        select sum(en.montant_centimes)::numeric / 100 from encaissements en
        join factures_client fc2 on fc2.id = en.facture_id
        where fc2.projet_id = ${P_ID} and fc2.organisation_id = ${P_ORG} and en.organisation_id = ${P_ORG} and fc2.status in (${sql.raw(statutsEmis)})
      ), 0)`,
    })
    .from(projetsTable)
    .where(eq(projetsTable.organisationId, organisationId))
    .orderBy(desc(projetsTable.id))
    .limit(limite);

  return lignes.map((l) => {
    const teklif = nombre(l.teklif);
    const ekIsler = nombre(l.ekIsler);
    const gider = nombre(l.gider);
    const faturalanan = nombre(l.faturalanan);
    const tahsilEdilen = nombre(l.tahsilEdilen);
    const onayliIs = arrondi(teklif + ekIsler);
    return {
      id: l.id,
      baslik: l.baslik,
      durum: l.durum,
      musteri: l.clientCompany || l.clientName,
      devise: l.devise,
      teklif: arrondi(teklif),
      ekIsler: arrondi(ekIsler),
      onayliIs,
      gider: arrondi(gider),
      faturalanan: arrondi(faturalanan),
      tahsilEdilen: arrondi(tahsilEdilen),
      marj: arrondi(onayliIs - gider),
      faturalanmayan: arrondi(onayliIs - faturalanan),
      tahsilEdilmeyen: arrondi(faturalanan - tahsilEdilen),
      asim: onayliIs > 0 && gider > onayliIs,
    };
  });
}

/** Utilise par la route d'ouverture d'avenant pour refuser un devis deja rattache. */
export async function avenantExistant(organisationId: number, devisId: number) {
  const [ligne] = await db
    .select({ id: avenantsTable.id, projetId: avenantsTable.projetId })
    .from(avenantsTable)
    .where(and(eq(avenantsTable.devisId, devisId), eq(avenantsTable.organisationId, organisationId)))
    .limit(1);
  return ligne ?? null;
}

/** Empeche d'ouvrir un avenant sur un devis qui est le marche initial d'un chantier. */
export async function estMarcheInitial(organisationId: number, devisId: number) {
  const [ligne] = await db
    .select({ id: projetsTable.id })
    .from(projetsTable)
    .where(and(
      eq(projetsTable.devisId, devisId),
      eq(projetsTable.organisationId, organisationId),
      isNotNull(projetsTable.devisId),
    ))
    .limit(1);
  return ligne ?? null;
}
