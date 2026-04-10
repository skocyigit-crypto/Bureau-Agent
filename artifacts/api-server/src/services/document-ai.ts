import { db, contactsTable, tasksTable, stockArticlesTable, devisTable, facturesClientTable, projetsTable, prospectsTable } from "@workspace/db";
import { eq, ilike, or, and } from "drizzle-orm";
import { logger } from "../lib/logger";

export type DocumentType =
  | "facture"
  | "devis"
  | "bon_commande"
  | "bon_livraison"
  | "contrat"
  | "cv"
  | "carte_visite"
  | "courrier"
  | "releve_bancaire"
  | "inventaire"
  | "rapport"
  | "formulaire"
  | "piece_identite"
  | "attestation"
  | "note_frais"
  | "planning"
  | "inconnu";

export type DestinationModule =
  | "contacts"
  | "prospects"
  | "factures"
  | "devis"
  | "stock"
  | "projets"
  | "taches"
  | "messages"
  | "aucun";

export interface ExtractedData {
  documentType: DocumentType;
  confidence: number;
  title: string;
  summary: string;
  destination: DestinationModule;
  destinationReason: string;
  extractedFields: Record<string, any>;
  suggestedActions: SuggestedAction[];
  relatedEntities: RelatedEntity[];
  warnings: string[];
  rawAnalysis: string;
}

export interface SuggestedAction {
  action: string;
  module: DestinationModule;
  label: string;
  description: string;
  data: Record<string, any>;
  priority: "haute" | "moyenne" | "basse";
}

export interface RelatedEntity {
  type: "contact" | "prospect" | "facture" | "devis" | "projet" | "stock";
  id: number;
  name: string;
  matchReason: string;
}

export interface ActionResult {
  success: boolean;
  module: string;
  action: string;
  message: string;
  createdId?: number;
  details?: Record<string, any>;
}

const ANALYSIS_PROMPT = `Tu es un assistant IA expert en gestion documentaire pour un bureau professionnel francais.
Analyse le document fourni et extrais TOUTES les informations pertinentes.

Tu dois retourner un JSON avec cette structure exacte:
{
  "documentType": "facture|devis|bon_commande|bon_livraison|contrat|cv|carte_visite|courrier|releve_bancaire|inventaire|rapport|formulaire|piece_identite|attestation|note_frais|planning|inconnu",
  "confidence": 0.0-1.0,
  "title": "titre descriptif du document",
  "summary": "resume concis en 2-3 phrases",
  "destination": "contacts|prospects|factures|devis|stock|projets|taches|messages|aucun",
  "destinationReason": "explication de pourquoi ce module est le bon",
  "extractedFields": {
    // Champs extraits selon le type de document:
    // Pour facture: numero, date, fournisseur, montantHT, montantTTC, tva, lignes[], echeance, iban, reference
    // Pour devis: numero, date, client, montantHT, montantTTC, validite, lignes[], conditions
    // Pour bon_commande: numero, date, fournisseur, articles[], montantTotal
    // Pour contrat: parties[], dateDebut, dateFin, objet, montant, clauses[]
    // Pour cv: nom, prenom, email, telephone, competences[], experience[], formation[]
    // Pour carte_visite: nom, prenom, societe, poste, email, telephone, adresse
    // Pour courrier: expediteur, destinataire, date, objet, contenu_resume
    // Pour releve_bancaire: banque, compte, periode, soldeDebut, soldeFin, operations[]
    // Pour inventaire: articles[], lieu, date, responsable
    // Pour note_frais: employe, date, montantTotal, lignes[], justificatifs
    // Pour planning: periodes[], personnes[], activites[]
    // Pour rapport: titre, auteur, date, sections[], conclusions
    // Ajoute tout champ pertinent trouve dans le document
  },
  "suggestedActions": [
    {
      "action": "creer_contact|creer_prospect|creer_facture|creer_devis|ajouter_stock|creer_tache|creer_projet|envoyer_message|archiver",
      "module": "contacts|prospects|factures|devis|stock|projets|taches|messages|aucun",
      "label": "Libelle court de l'action",
      "description": "Description detaillee de ce que l'action va faire",
      "data": {},
      "priority": "haute|moyenne|basse"
    }
  ],
  "warnings": ["avertissements eventuels: donnees manquantes, qualite faible, etc."],
  "matchHints": {
    "personNames": ["noms de personnes trouvees dans le document"],
    "companyNames": ["noms de societes trouvees"],
    "emails": ["adresses email trouvees"],
    "phones": ["numeros de telephone trouves"],
    "references": ["numeros de reference, commande, facture, etc."]
  }
}

Regles importantes:
1. Sois EXHAUSTIF dans l'extraction des champs
2. Pour les montants, utilise toujours des strings avec 2 decimales (ex: "1250.00")
3. Pour les dates, utilise le format ISO (YYYY-MM-DD)
4. Propose TOUTES les actions pertinentes (pas seulement une)
5. Si un CV est detecte, propose de creer un contact ET un prospect
6. Si une facture est detectee, propose de la creer dans le module factures ET de creer/mettre a jour le contact fournisseur
7. Si un inventaire/bon de commande contient des articles, propose de les ajouter au stock
8. Retourne UNIQUEMENT du JSON valide, rien d'autre`;

export async function analyzeDocument(
  base64Content: string,
  mimeType: string,
  fileName: string,
  orgId: number
): Promise<ExtractedData> {
  const { ai } = await import("@workspace/integrations-gemini-ai");

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{
      role: "user",
      parts: [
        {
          inlineData: {
            mimeType,
            data: base64Content,
          },
        },
        {
          text: `${ANALYSIS_PROMPT}\n\nNom du fichier: ${fileName}\nType MIME: ${mimeType}`,
        },
      ],
    }],
    config: { maxOutputTokens: 16384, responseMimeType: "application/json" },
  });

  const text = response.text ?? "{}";
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    logger.error({ text }, "Document AI: impossible de parser la reponse");
    return {
      documentType: "inconnu",
      confidence: 0,
      title: fileName,
      summary: "Impossible d'analyser ce document.",
      destination: "aucun",
      destinationReason: "L'analyse du document a echoue.",
      extractedFields: {},
      suggestedActions: [],
      relatedEntities: [],
      warnings: ["L'analyse IA n'a pas pu extraire les donnees du document."],
      rawAnalysis: text,
    };
  }

  const relatedEntities = await findRelatedEntities(parsed.matchHints || {}, orgId);

  return {
    documentType: parsed.documentType || "inconnu",
    confidence: parsed.confidence || 0,
    title: parsed.title || fileName,
    summary: parsed.summary || "",
    destination: parsed.destination || "aucun",
    destinationReason: parsed.destinationReason || "",
    extractedFields: parsed.extractedFields || {},
    suggestedActions: (parsed.suggestedActions || []).map((a: any) => ({
      action: a.action || "archiver",
      module: a.module || "aucun",
      label: a.label || "",
      description: a.description || "",
      data: a.data || {},
      priority: a.priority || "moyenne",
    })),
    relatedEntities,
    warnings: parsed.warnings || [],
    rawAnalysis: text,
  };
}

async function findRelatedEntities(
  hints: { personNames?: string[]; companyNames?: string[]; emails?: string[]; phones?: string[]; references?: string[] },
  orgId: number
): Promise<RelatedEntity[]> {
  const entities: RelatedEntity[] = [];
  const orgFilter = eq(contactsTable.organisationId, orgId);

  try {
    if (hints.emails?.length) {
      for (const email of hints.emails.slice(0, 5)) {
        const contacts = await db.select({ id: contactsTable.id, firstName: contactsTable.firstName, lastName: contactsTable.lastName })
          .from(contactsTable)
          .where(and(orgFilter, ilike(contactsTable.email, email)))
          .limit(1);
        if (contacts[0]) {
          entities.push({
            type: "contact",
            id: contacts[0].id,
            name: `${contacts[0].firstName || ""} ${contacts[0].lastName || ""}`.trim(),
            matchReason: `Email correspondant: ${email}`,
          });
        }
      }
    }

    if (hints.phones?.length) {
      for (const phone of hints.phones.slice(0, 5)) {
        const cleaned = phone.replace(/\s+/g, "");
        const contacts = await db.select({ id: contactsTable.id, firstName: contactsTable.firstName, lastName: contactsTable.lastName })
          .from(contactsTable)
          .where(and(orgFilter, or(
            ilike(contactsTable.phone, `%${cleaned}%`),
            ilike(contactsTable.mobile, `%${cleaned}%`)
          )))
          .limit(1);
        if (contacts[0] && !entities.find(e => e.type === "contact" && e.id === contacts[0].id)) {
          entities.push({
            type: "contact",
            id: contacts[0].id,
            name: `${contacts[0].firstName || ""} ${contacts[0].lastName || ""}`.trim(),
            matchReason: `Telephone correspondant: ${phone}`,
          });
        }
      }
    }

    if (hints.companyNames?.length) {
      for (const company of hints.companyNames.slice(0, 5)) {
        const contacts = await db.select({ id: contactsTable.id, firstName: contactsTable.firstName, lastName: contactsTable.lastName, company: contactsTable.company })
          .from(contactsTable)
          .where(and(orgFilter, ilike(contactsTable.company, `%${company}%`)))
          .limit(3);
        for (const c of contacts) {
          if (!entities.find(e => e.type === "contact" && e.id === c.id)) {
            entities.push({
              type: "contact",
              id: c.id,
              name: `${c.firstName || ""} ${c.lastName || ""}`.trim() + (c.company ? ` (${c.company})` : ""),
              matchReason: `Societe correspondante: ${company}`,
            });
          }
        }
      }
    }

    if (hints.personNames?.length) {
      for (const name of hints.personNames.slice(0, 5)) {
        const parts = name.split(/\s+/);
        if (parts.length < 2) continue;
        const contacts = await db.select({ id: contactsTable.id, firstName: contactsTable.firstName, lastName: contactsTable.lastName })
          .from(contactsTable)
          .where(and(orgFilter, or(
            and(ilike(contactsTable.firstName, `%${parts[0]}%`), ilike(contactsTable.lastName, `%${parts[parts.length - 1]}%`)),
            and(ilike(contactsTable.firstName, `%${parts[parts.length - 1]}%`), ilike(contactsTable.lastName, `%${parts[0]}%`))
          )))
          .limit(2);
        for (const c of contacts) {
          if (!entities.find(e => e.type === "contact" && e.id === c.id)) {
            entities.push({
              type: "contact",
              id: c.id,
              name: `${c.firstName || ""} ${c.lastName || ""}`.trim(),
              matchReason: `Nom correspondant: ${name}`,
            });
          }
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, "Document AI: erreur lors de la recherche d'entites liees");
  }

  return entities.slice(0, 10);
}

export async function executeDocumentAction(
  action: SuggestedAction,
  extractedFields: Record<string, any>,
  orgId: number,
  userId: number
): Promise<ActionResult> {
  try {
    switch (action.action) {
      case "creer_contact": {
        const data = { ...extractedFields, ...action.data };
        const firstName = data.prenom || data.nom?.split(" ")[0] || "Nouveau";
        const lastName = data.nom?.split(" ").slice(1).join(" ") || data.nom || "Contact";
        const phone = data.telephone || data.phone || data.mobile || "non renseigne";
        const [contact] = await db.insert(contactsTable).values({
          organisationId: orgId,
          firstName,
          lastName,
          email: data.email || null,
          phone,
          mobile: data.mobile || null,
          company: data.societe || data.company || data.fournisseur || null,
          address: data.adresse || null,
          category: data.category || "client",
          notes: data.notes || `Importe via Document IA`,
        }).returning({ id: contactsTable.id });
        return {
          success: true,
          module: "contacts",
          action: "creer_contact",
          message: `Contact cree: ${firstName} ${lastName}`,
          createdId: contact.id,
        };
      }

      case "creer_prospect": {
        const data = { ...extractedFields, ...action.data };
        const contactName = data.nom || `${data.prenom || ""} ${data.nom || ""}`.trim() || "Prospect";
        const title = data.titre || data.objet || `Prospect - ${contactName}`;
        const [prospect] = await db.insert(prospectsTable).values({
          organisationId: orgId,
          title,
          description: data.description || `Importe via Document IA`,
          contactName,
          company: data.societe || data.company || null,
          email: data.email || null,
          phone: data.telephone || data.phone || null,
          stage: "nouveau",
          priority: "moyenne",
          source: "document_ia",
          probability: 50,
          notes: `Importe via Document IA`,
        }).returning({ id: prospectsTable.id });
        return {
          success: true,
          module: "prospects",
          action: "creer_prospect",
          message: `Prospect cree: ${title}`,
          createdId: prospect.id,
        };
      }

      case "creer_tache": {
        const data = { ...extractedFields, ...action.data };
        const taskTitle = data.title || data.titre || data.objet || "Tache depuis document";
        const [task] = await db.insert(tasksTable).values({
          organisationId: orgId,
          title: taskTitle,
          description: data.description || data.contenu_resume || action.description,
          status: "en_attente",
          priority: action.priority === "haute" ? "haute" : action.priority === "basse" ? "basse" : "moyenne",
          assignedTo: userId.toString(),
        }).returning({ id: tasksTable.id });
        return {
          success: true,
          module: "taches",
          action: "creer_tache",
          message: `Tache creee: ${taskTitle}`,
          createdId: task.id,
        };
      }

      case "ajouter_stock": {
        const articles = action.data.articles || extractedFields.articles || [];
        if (!Array.isArray(articles) || articles.length === 0) {
          const data = { ...extractedFields, ...action.data };
          const [article] = await db.insert(stockArticlesTable).values({
            organisationId: orgId,
            name: data.name || data.nom || "Article importe",
            reference: data.reference || `DOC-${Date.now()}`,
            description: data.description || "",
            category: data.category || "general",
            quantity: parseInt(data.quantity || data.quantite || "0"),
            minQuantity: parseInt(data.minQuantity || "5"),
            unitPrice: data.unitPrice || data.prix || "0.00",
            supplier: data.supplier || data.fournisseur || null,
            location: data.location || data.emplacement || null,
            unit: data.unit || "piece",
            status: "en_stock",
          }).returning({ id: stockArticlesTable.id });
          return {
            success: true,
            module: "stock",
            action: "ajouter_stock",
            message: `1 article ajoute au stock`,
            createdId: article.id,
          };
        }

        let added = 0;
        for (const item of articles) {
          try {
            await db.insert(stockArticlesTable).values({
              organisationId: orgId,
              name: item.name || item.nom || "Article",
              reference: item.reference || `DOC-${Date.now()}-${added}`,
              description: item.description || "",
              category: item.category || "general",
              quantity: parseInt(item.quantity || item.quantite || "0"),
              minQuantity: parseInt(item.minQuantity || "5"),
              unitPrice: item.unitPrice || item.prix || "0.00",
              supplier: item.supplier || item.fournisseur || null,
              location: item.location || null,
              unit: item.unit || "piece",
              status: "en_stock",
            });
            added++;
          } catch (e) {
            logger.warn({ err: e, item }, "Document AI: erreur ajout article stock");
          }
        }
        return {
          success: true,
          module: "stock",
          action: "ajouter_stock",
          message: `${added} article(s) ajoute(s) au stock`,
          details: { count: added },
        };
      }

      case "creer_facture": {
        const data = { ...extractedFields, ...action.data };
        const reference = data.numero || data.reference || `FA-DOC-${Date.now()}`;
        const clientName = data.client || data.fournisseur || data.nom || "Client";
        const [facture] = await db.insert(facturesClientTable).values({
          organisationId: orgId,
          reference,
          title: data.titre || data.objet || `Facture ${reference}`,
          clientName,
          clientEmail: data.email || null,
          clientPhone: data.telephone || data.phone || null,
          clientCompany: data.societe || data.company || data.fournisseur || null,
          clientAddress: data.adresse || null,
          status: "brouillon",
          dueDate: data.echeance ? new Date(data.echeance) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          subtotal: data.montantHT || "0.00",
          taxAmount: data.montantTVA || "0.00",
          totalAmount: data.montantTTC || data.montantHT || "0.00",
          items: data.lignes || [],
          notes: `Importee via Document IA`,
        }).returning({ id: facturesClientTable.id });
        return {
          success: true,
          module: "factures",
          action: "creer_facture",
          message: `Facture creee: ${reference}`,
          createdId: facture.id,
        };
      }

      case "creer_devis": {
        const data = { ...extractedFields, ...action.data };
        const reference = data.numero || data.reference || `DV-DOC-${Date.now()}`;
        const clientName = data.client || data.nom || "Client";
        const [devis] = await db.insert(devisTable).values({
          organisationId: orgId,
          reference,
          title: data.titre || data.objet || `Devis ${reference}`,
          clientName,
          clientEmail: data.email || null,
          clientPhone: data.telephone || data.phone || null,
          clientCompany: data.societe || data.company || null,
          clientAddress: data.adresse || null,
          status: "brouillon",
          validUntil: data.validite ? new Date(data.validite) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          subtotal: data.montantHT || "0.00",
          taxAmount: data.montantTVA || "0.00",
          totalAmount: data.montantTTC || data.montantHT || "0.00",
          items: data.lignes || [],
          notes: `Importe via Document IA`,
        }).returning({ id: devisTable.id });
        return {
          success: true,
          module: "devis",
          action: "creer_devis",
          message: `Devis cree: ${reference}`,
          createdId: devis.id,
        };
      }

      case "creer_projet": {
        const data = { ...extractedFields, ...action.data };
        const projetTitle = data.titre || data.objet || "Projet depuis document";
        const [projet] = await db.insert(projetsTable).values({
          organisationId: orgId,
          title: projetTitle,
          description: data.description || data.contenu_resume || action.description,
          status: "planifie",
          priority: "moyenne",
          clientName: data.client || data.nom || null,
          clientCompany: data.societe || data.company || null,
          budget: data.montant || data.budget || null,
          startDate: data.dateDebut ? new Date(data.dateDebut) : null,
          endDate: data.dateFin ? new Date(data.dateFin) : null,
          progress: 0,
        }).returning({ id: projetsTable.id });
        return {
          success: true,
          module: "projets",
          action: "creer_projet",
          message: `Projet cree: ${projetTitle}`,
          createdId: projet.id,
        };
      }

      default:
        return {
          success: false,
          module: action.module,
          action: action.action,
          message: `Action non supportee: ${action.action}`,
        };
    }
  } catch (err: any) {
    logger.error({ err, action }, "Document AI: erreur lors de l'execution de l'action");
    return {
      success: false,
      module: action.module,
      action: action.action,
      message: `Erreur: ${err.message}`,
    };
  }
}
