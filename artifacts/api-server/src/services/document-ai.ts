import { db, contactsTable, tasksTable, stockArticlesTable, devisTable, facturesClientTable, projetsTable, prospectsTable } from "@workspace/db";
import { eq, ilike, or, and } from "drizzle-orm";
import { logger } from "../lib/logger";
import { safeJsonParse, aiCallWithRetry } from "./ai-utils";

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

const VISUAL_MIME_TYPES = [
  "application/pdf",
  "image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp", "image/tiff",
];

async function extractTextFromFile(base64Content: string, mimeType: string, fileName: string): Promise<string | null> {
  const buffer = Buffer.from(base64Content, "base64");

  if (mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || mimeType === "application/vnd.ms-excel" || fileName.match(/\.xlsx?$/i)) {
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(buffer, { type: "buffer" });
      const sheets: string[] = [];
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(sheet, { FS: " | ", RS: "\n" });
        const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        sheets.push(`=== Feuille: ${sheetName} (${json.length} lignes) ===\n${csv}\n\nDonnees JSON:\n${JSON.stringify(json.slice(0, 200), null, 1)}`);
      }
      return `CONTENU EXCEL (${workbook.SheetNames.length} feuille(s)):\n\n${sheets.join("\n\n")}`;
    } catch (err: any) {
      logger.warn({ err, fileName }, "Excel parse error");
      return null;
    }
  }

  if (mimeType === "text/csv" || fileName.match(/\.csv$/i)) {
    try {
      const text = buffer.toString("utf-8");
      const lines = text.split("\n");
      const header = lines[0] || "";
      const dataLines = lines.slice(0, 201);
      return `CONTENU CSV (${lines.length} lignes):\nColonnes: ${header}\n\n${dataLines.join("\n")}`;
    } catch (err: any) {
      logger.warn({ err, fileName }, "CSV parse error");
      return null;
    }
  }

  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || fileName.match(/\.docx$/i)) {
    try {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      return `CONTENU WORD (DOCX):\n\n${result.value.slice(0, 30000)}`;
    } catch (err: any) {
      logger.warn({ err, fileName }, "Word parse error");
      return null;
    }
  }

  if (mimeType === "text/plain" || mimeType === "application/rtf" || fileName.match(/\.(txt|rtf)$/i)) {
    try {
      return `CONTENU TEXTE:\n\n${buffer.toString("utf-8").slice(0, 30000)}`;
    } catch {
      return null;
    }
  }

  if (mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation" || mimeType === "application/vnd.ms-powerpoint" || fileName.match(/\.pptx?$/i)) {
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(buffer, { type: "buffer" });
      const slides: string[] = [];
      for (const name of workbook.SheetNames) {
        const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name], { FS: " | " });
        slides.push(`--- Slide: ${name} ---\n${csv}`);
      }
      return `CONTENU PRESENTATION (${workbook.SheetNames.length} slides):\n\n${slides.join("\n\n")}`;
    } catch {
      return null;
    }
  }

  return null;
}

export async function analyzeDocument(
  base64Content: string,
  mimeType: string,
  fileName: string,
  orgId: number
): Promise<ExtractedData> {
  const { ai } = await import("@workspace/integrations-gemini-ai");

  const isVisual = VISUAL_MIME_TYPES.includes(mimeType);
  let contentParts: any[];

  if (isVisual) {
    contentParts = [
      { inlineData: { mimeType, data: base64Content } },
      { text: `${ANALYSIS_PROMPT}\n\nNom du fichier: ${fileName}\nType MIME: ${mimeType}` },
    ];
  } else {
    const extractedText = await extractTextFromFile(base64Content, mimeType, fileName);
    if (!extractedText) {
      return {
        documentType: "inconnu",
        confidence: 0,
        title: fileName,
        summary: "Impossible de lire le contenu de ce fichier.",
        destination: "aucun",
        destinationReason: "Le format du fichier n'a pas pu etre analyse.",
        extractedFields: {},
        suggestedActions: [],
        relatedEntities: [],
        warnings: [`Le format ${mimeType} n'a pas pu etre lu correctement.`],
        rawAnalysis: "",
      };
    }
    contentParts = [
      { text: `${ANALYSIS_PROMPT}\n\nNom du fichier: ${fileName}\nType MIME: ${mimeType}\n\n${extractedText}` },
    ];
  }

  const response = await aiCallWithRetry(
    () => ai.models.generateContent({
      model: "gemini-2.5-pro",
      contents: [{ role: "user", parts: contentParts }],
      config: { maxOutputTokens: 16384, responseMimeType: "application/json" },
    }),
    { label: `document-ai:${fileName}`, maxRetries: 2 }
  );

  const text = response.text ?? "{}";
  const FALLBACK_DOC_ANALYSIS: any = null;
  const parsed: any = safeJsonParse<any>(text, FALLBACK_DOC_ANALYSIS);
  if (parsed === null) {
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

export interface ProcessedRow {
  rowIndex: number;
  fields: Record<string, any>;
  errors: string[];
  warnings: string[];
  duplicateOf?: { id: number; name: string };
}

export interface ProcessResult {
  understood: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
  suggestedModule: DestinationModule;
  suggestedModuleReason: string;
  columns: string[];
  columnMapping: Record<string, string>;
  rows: ProcessedRow[];
  summary: string;
  dataPreview: Record<string, any>[];
}

const PROCESS_PROMPT = `Tu es un assistant IA expert en extraction de donnees structurees.
Analyse le contenu du fichier et extrais TOUTES les lignes/enregistrements sous forme structuree.

Tu dois retourner un JSON avec cette structure exacte:
{
  "understood": "Description en francais de ce que tu as compris du fichier (type de donnees, nombre d'enregistrements, colonnes detectees)",
  "suggestedModule": "contacts|taches|messages|factures|devis|prospects|stock|projets|aucun",
  "suggestedModuleReason": "Explication de pourquoi ce module est le bon pour ces donnees",
  "columns": ["liste des colonnes/champs detectes dans le fichier"],
  "columnMapping": {
    "colonne_originale": "champ_cible_dans_le_module"
  },
  "rows": [
    {
      "rowIndex": 0,
      "fields": {
        "champ1": "valeur1",
        "champ2": "valeur2"
      },
      "errors": ["erreurs detectees pour cette ligne"],
      "warnings": ["avertissements pour cette ligne"]
    }
  ],
  "summary": "Resume: X enregistrements valides, Y erreurs detectees, Z doublons potentiels"
}

REGLES DE MAPPING PAR MODULE:
- contacts: firstName, lastName, email, phone, mobile, company, category, address, notes
- taches: title, description, status (en_attente|en_cours|termine), priority (basse|moyenne|haute|urgente), dueDate (ISO), assignedTo
- messages: subject, content, senderName, senderEmail
- factures: numero, client, montantHT, montantTTC, tva, dateEmission, dateEcheance, lignes
- prospects: firstName, lastName, email, phone, company, status, value, notes

REGLES IMPORTANTES:
1. Extrais CHAQUE ligne/enregistrement du fichier — ne fais pas de resume
2. Pour les contacts: si un seul nom est donne, mets-le en lastName avec firstName vide
3. Pour les telephones: garde le format original
4. Pour les dates: convertis en ISO (YYYY-MM-DD)
5. Si un champ est vide ou manquant, marque-le comme erreur si c'est obligatoire
6. Champs obligatoires contacts: lastName, phone OU email
7. Champs obligatoires taches: title
8. Detecte les doublons potentiels entre les lignes
9. Retourne UNIQUEMENT du JSON valide`;

// ── MULTI-MODEL AI ANALYSIS ───────────────────────────────────────────────────

export interface ModelAnalysis {
  model: string;
  provider: "gemini" | "openai" | "claude";
  summary: string;
  keyPoints: string[];
  insights: string;
  recommendations: string[];
  risks: string[];
  sentiment: "positif" | "neutre" | "negatif";
  urgency: "haute" | "moyenne" | "basse";
  tokensUsed?: number;
  durationMs?: number;
  error?: string;
}

export interface MultiModelResult {
  gemini?: ModelAnalysis;
  openai?: ModelAnalysis;
  claude?: ModelAnalysis;
  consensus: {
    summary: string;
    topKeyPoints: string[];
    agreementScore: number; // 0-100
  };
  analyzedAt: string;
}

const MULTI_ANALYSIS_PROMPT = (fileName: string, mimeType: string) => `Tu es un expert analyste documentaire pour un bureau professionnel français.
Analyse CE DOCUMENT et retourne UNIQUEMENT un JSON valide avec cette structure:
{
  "summary": "résumé concis du document en 2-3 phrases",
  "keyPoints": ["point clé 1", "point clé 2", "point clé 3", "point clé 4", "point clé 5"],
  "insights": "analyse approfondie et observations uniques sur ce document (3-5 phrases)",
  "recommendations": ["action recommandée 1", "action recommandée 2", "action recommandée 3"],
  "risks": ["risque ou point d'attention 1", "risque 2"],
  "sentiment": "positif|neutre|negatif",
  "urgency": "haute|moyenne|basse"
}
Fichier: ${fileName}
Type: ${mimeType}
RETOURNE UNIQUEMENT DU JSON VALIDE.`;

const QA_SYSTEM_PROMPT = `Tu es un assistant expert qui répond aux questions sur des documents professionnels en français.
Réponds de manière précise, structurée et utile. Base-toi UNIQUEMENT sur le contenu du document fourni.
Si l'information n'est pas dans le document, dis-le clairement.`;

async function runGeminiAnalysis(contentParts: any[], fileName: string, mimeType: string): Promise<ModelAnalysis> {
  const t0 = Date.now();
  const { ai } = await import("@workspace/integrations-gemini-ai");
  const response = await aiCallWithRetry(
    () => ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [...contentParts, { text: MULTI_ANALYSIS_PROMPT(fileName, mimeType) }] }],
      config: { maxOutputTokens: 4096, responseMimeType: "application/json" },
    }),
    { label: "multi-gemini", maxRetries: 2 }
  );
  const parsed = safeJsonParse<any>(response.text ?? "{}", {});
  return {
    model: "gemini-2.5-flash", provider: "gemini",
    summary: parsed.summary || "", keyPoints: parsed.keyPoints || [],
    insights: parsed.insights || "", recommendations: parsed.recommendations || [],
    risks: parsed.risks || [], sentiment: parsed.sentiment || "neutre",
    urgency: parsed.urgency || "basse",
    tokensUsed: response.usageMetadata?.totalTokenCount ?? 0,
    durationMs: Date.now() - t0,
  };
}

async function runOpenAIAnalysis(textContent: string, fileName: string, mimeType: string, imageBase64?: string): Promise<ModelAnalysis> {
  const t0 = Date.now();
  const { openai } = await import("@workspace/integrations-openai-ai-server");

  const messages: any[] = [];
  if (imageBase64 && (mimeType.startsWith("image/") || mimeType === "application/pdf")) {
    messages.push({
      role: "user", content: [
        { type: "image_url", image_url: { url: `data:${mimeType.startsWith("image/") ? mimeType : "image/jpeg"};base64,${imageBase64}`, detail: "high" } },
        { type: "text", text: MULTI_ANALYSIS_PROMPT(fileName, mimeType) },
      ]
    });
  } else {
    messages.push({ role: "user", content: `${MULTI_ANALYSIS_PROMPT(fileName, mimeType)}\n\nCONTENU DU DOCUMENT:\n${textContent.slice(0, 12000)}` });
  }

  const response = await aiCallWithRetry(
    () => openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      max_tokens: 2048,
      response_format: { type: "json_object" },
    }),
    { label: "multi-openai", maxRetries: 2 }
  );
  const parsed = safeJsonParse<any>(response.choices[0]?.message?.content ?? "{}", {});
  return {
    model: "gpt-4o", provider: "openai",
    summary: parsed.summary || "", keyPoints: parsed.keyPoints || [],
    insights: parsed.insights || "", recommendations: parsed.recommendations || [],
    risks: parsed.risks || [], sentiment: parsed.sentiment || "neutre",
    urgency: parsed.urgency || "basse",
    tokensUsed: response.usage?.total_tokens ?? 0,
    durationMs: Date.now() - t0,
  };
}

async function runClaudeAnalysis(textContent: string, fileName: string, mimeType: string, imageBase64?: string): Promise<ModelAnalysis> {
  const t0 = Date.now();
  const { anthropic } = await import("@workspace/integrations-anthropic-ai");

  let content: any;
  if (imageBase64 && mimeType.startsWith("image/")) {
    content = [
      { type: "image", source: { type: "base64", media_type: mimeType as any, data: imageBase64 } },
      { type: "text", text: MULTI_ANALYSIS_PROMPT(fileName, mimeType) },
    ];
  } else {
    content = `${MULTI_ANALYSIS_PROMPT(fileName, mimeType)}\n\nCONTENU DU DOCUMENT:\n${textContent.slice(0, 12000)}`;
  }

  const response = await aiCallWithRetry(
    () => anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 2048,
      system: "Tu es un analyste documentaire expert. Retourne uniquement du JSON valide.",
      messages: [{ role: "user", content }],
    }),
    { label: "multi-claude", maxRetries: 2 }
  );
  const rawText = (response.content[0] as any)?.text ?? "{}";
  const parsed = safeJsonParse<any>(rawText, {});
  return {
    model: "claude-sonnet-4-5", provider: "claude",
    summary: parsed.summary || "", keyPoints: parsed.keyPoints || [],
    insights: parsed.insights || "", recommendations: parsed.recommendations || [],
    risks: parsed.risks || [], sentiment: parsed.sentiment || "neutre",
    urgency: parsed.urgency || "basse",
    tokensUsed: (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0),
    durationMs: Date.now() - t0,
  };
}

export async function analyzeDocumentMultiModel(
  base64Content: string,
  mimeType: string,
  fileName: string,
): Promise<MultiModelResult> {
  const isVisual = VISUAL_MIME_TYPES.includes(mimeType);
  const isImage = mimeType.startsWith("image/");

  // Extract text for non-visual models
  let textContent = "";
  if (!isImage) {
    const extracted = await extractTextFromFile(base64Content, mimeType, fileName);
    textContent = extracted ?? `Fichier: ${fileName} (${mimeType})`;
  } else {
    textContent = `Image: ${fileName}`;
  }

  // Gemini content parts (native multimodal)
  const geminiParts: any[] = isVisual
    ? [{ inlineData: { mimeType, data: base64Content } }]
    : [{ text: `CONTENU DU DOCUMENT:\n${textContent.slice(0, 20000)}` }];

  // Run all 3 models in parallel
  const [geminiRes, openaiRes, claudeRes] = await Promise.allSettled([
    runGeminiAnalysis(geminiParts, fileName, mimeType),
    runOpenAIAnalysis(textContent, fileName, mimeType, isImage ? base64Content : undefined),
    runClaudeAnalysis(textContent, fileName, mimeType, isImage ? base64Content : undefined),
  ]);

  const gemini  = geminiRes.status  === "fulfilled" ? geminiRes.value  : { model: "gemini-2.5-flash", provider: "gemini"  as const, error: (geminiRes.reason as any)?.message, summary: "", keyPoints: [], insights: "", recommendations: [], risks: [], sentiment: "neutre" as const, urgency: "basse" as const };
  const openai  = openaiRes.status  === "fulfilled" ? openaiRes.value  : { model: "gpt-4o",           provider: "openai"  as const, error: (openaiRes.reason as any)?.message, summary: "", keyPoints: [], insights: "", recommendations: [], risks: [], sentiment: "neutre" as const, urgency: "basse" as const };
  const claude  = claudeRes.status  === "fulfilled" ? claudeRes.value  : { model: "claude-sonnet-4-5",provider: "claude"  as const, error: (claudeRes.reason as any)?.message, summary: "", keyPoints: [], insights: "", recommendations: [], risks: [], sentiment: "neutre" as const, urgency: "basse" as const };

  // Build consensus
  const allPoints = [...(gemini.keyPoints ?? []), ...(openai.keyPoints ?? []), ...(claude.keyPoints ?? [])];
  const uniquePoints = [...new Set(allPoints)].slice(0, 8);
  const summaries = [gemini.summary, openai.summary, claude.summary].filter(Boolean);
  const successCount = [geminiRes, openaiRes, claudeRes].filter(r => r.status === "fulfilled").length;

  return {
    gemini, openai, claude,
    consensus: {
      summary: summaries[0] || "",
      topKeyPoints: uniquePoints,
      agreementScore: Math.round((successCount / 3) * 100),
    },
    analyzedAt: new Date().toISOString(),
  };
}

// ── DOCUMENT Q&A ──────────────────────────────────────────────────────────────
export interface QAAnswer {
  model: string;
  provider: string;
  answer: string;
  tokensUsed?: number;
  durationMs?: number;
  error?: string;
}

export async function askDocumentQuestion(
  question: string,
  documentContext: string,
  fileName: string,
  mimeType: string,
  models: Array<"gemini" | "openai" | "claude">,
  imageBase64?: string,
): Promise<QAAnswer[]> {
  const answers: QAAnswer[] = [];

  const tasks = models.map(async (m) => {
    const t0 = Date.now();
    const context = documentContext.slice(0, 15000);
    const userPrompt = `Document: "${fileName}"\n\n${imageBase64 && mimeType.startsWith("image/") ? "" : `CONTENU:\n${context}\n\n`}Question: ${question}`;

    try {
      if (m === "gemini") {
        const { ai } = await import("@workspace/integrations-gemini-ai");
        const parts: any[] = imageBase64 && VISUAL_MIME_TYPES.includes(mimeType)
          ? [{ inlineData: { mimeType, data: imageBase64 } }, { text: `${QA_SYSTEM_PROMPT}\n\n${userPrompt}` }]
          : [{ text: `${QA_SYSTEM_PROMPT}\n\n${userPrompt}` }];
        const res = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [{ role: "user", parts }],
          config: { maxOutputTokens: 2048 },
        });
        answers.push({ model: "gemini-2.5-flash", provider: "gemini", answer: res.text ?? "", tokensUsed: res.usageMetadata?.totalTokenCount ?? 0, durationMs: Date.now() - t0 });
      } else if (m === "openai") {
        const { openai } = await import("@workspace/integrations-openai-ai-server");
        const msgContent: any = imageBase64 && mimeType.startsWith("image/")
          ? [{ type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}`, detail: "high" } }, { type: "text", text: userPrompt }]
          : userPrompt;
        const res = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [{ role: "system", content: QA_SYSTEM_PROMPT }, { role: "user", content: msgContent }],
          max_tokens: 2048,
        });
        answers.push({ model: "gpt-4o", provider: "openai", answer: res.choices[0]?.message?.content ?? "", tokensUsed: res.usage?.total_tokens ?? 0, durationMs: Date.now() - t0 });
      } else if (m === "claude") {
        const { anthropic } = await import("@workspace/integrations-anthropic-ai");
        const content: any = imageBase64 && mimeType.startsWith("image/")
          ? [{ type: "image", source: { type: "base64", media_type: mimeType, data: imageBase64 } }, { type: "text", text: userPrompt }]
          : userPrompt;
        const res = await anthropic.messages.create({
          model: "claude-sonnet-4-5",
          max_tokens: 2048,
          system: QA_SYSTEM_PROMPT,
          messages: [{ role: "user", content }],
        });
        answers.push({ model: "claude-sonnet-4-5", provider: "claude", answer: (res.content[0] as any)?.text ?? "", tokensUsed: (res.usage?.input_tokens ?? 0) + (res.usage?.output_tokens ?? 0), durationMs: Date.now() - t0 });
      }
    } catch (err: any) {
      const modelNames = { gemini: "gemini-2.5-flash", openai: "gpt-4o", claude: "claude-sonnet-4-5" };
      answers.push({ model: modelNames[m], provider: m, answer: "", error: err.message });
    }
  });

  await Promise.all(tasks);
  return answers;
}

export async function processDocumentForImport(
  base64Content: string,
  mimeType: string,
  fileName: string,
  orgId: number
): Promise<ProcessResult> {
  const { ai } = await import("@workspace/integrations-gemini-ai");

  const isVisual = VISUAL_MIME_TYPES.includes(mimeType);
  let contentParts: any[];

  if (isVisual) {
    contentParts = [
      { inlineData: { mimeType, data: base64Content } },
      { text: `${PROCESS_PROMPT}\n\nFichier: ${fileName}\nType: ${mimeType}` },
    ];
  } else {
    const extractedText = await extractTextFromFile(base64Content, mimeType, fileName);
    if (!extractedText) {
      return {
        understood: "Impossible de lire le contenu de ce fichier.",
        totalRows: 0, validRows: 0, errorRows: 0,
        suggestedModule: "aucun",
        suggestedModuleReason: "Le fichier n'a pas pu etre lu.",
        columns: [], columnMapping: {}, rows: [],
        summary: "Echec de lecture du fichier.", dataPreview: [],
      };
    }
    contentParts = [
      { text: `${PROCESS_PROMPT}\n\nFichier: ${fileName}\nType: ${mimeType}\n\n${extractedText}` },
    ];
  }

  const response = await ai.models.generateContent({
    model: "gemini-2.5-pro",
    contents: [{ role: "user", parts: contentParts }],
    config: { maxOutputTokens: 32768, responseMimeType: "application/json" },
  });

  const text = response.text ?? "{}";
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    logger.error({ text: text.substring(0, 500) }, "Process: impossible de parser la reponse");
    return {
      understood: "Erreur d'analyse IA — reponse invalide.",
      totalRows: 0, validRows: 0, errorRows: 0,
      suggestedModule: "aucun",
      suggestedModuleReason: "",
      columns: [], columnMapping: {}, rows: [],
      summary: "Erreur IA.", dataPreview: [],
    };
  }

  const rows: ProcessedRow[] = (parsed.rows || []).map((r: any, i: number) => ({
    rowIndex: r.rowIndex ?? i,
    fields: r.fields || {},
    errors: r.errors || [],
    warnings: r.warnings || [],
    duplicateOf: r.duplicateOf || undefined,
  }));

  const validRows = rows.filter(r => r.errors.length === 0).length;
  const errorRows = rows.filter(r => r.errors.length > 0).length;

  const existingDuplicates = await checkDuplicatesInDb(rows, parsed.suggestedModule || "aucun", orgId);
  for (const dup of existingDuplicates) {
    const row = rows.find(r => r.rowIndex === dup.rowIndex);
    if (row) {
      row.duplicateOf = dup.existing;
      row.warnings.push(`Doublon potentiel: ${dup.existing.name} (ID: ${dup.existing.id})`);
    }
  }

  return {
    understood: parsed.understood || "",
    totalRows: rows.length,
    validRows,
    errorRows,
    suggestedModule: parsed.suggestedModule || "aucun",
    suggestedModuleReason: parsed.suggestedModuleReason || "",
    columns: parsed.columns || [],
    columnMapping: parsed.columnMapping || {},
    rows,
    summary: parsed.summary || `${rows.length} enregistrement(s) detecte(s), ${validRows} valide(s), ${errorRows} erreur(s).`,
    dataPreview: rows.slice(0, 5).map(r => r.fields),
  };
}

async function checkDuplicatesInDb(
  rows: ProcessedRow[],
  module: string,
  orgId: number
): Promise<{ rowIndex: number; existing: { id: number; name: string } }[]> {
  const duplicates: { rowIndex: number; existing: { id: number; name: string } }[] = [];

  if (module !== "contacts") return duplicates;

  const orgFilter = eq(contactsTable.organisationId, orgId);

  for (const row of rows.slice(0, 100)) {
    const f = row.fields;
    try {
      if (f.email) {
        const [match] = await db.select({ id: contactsTable.id, firstName: contactsTable.firstName, lastName: contactsTable.lastName })
          .from(contactsTable).where(and(orgFilter, ilike(contactsTable.email, f.email))).limit(1);
        if (match) {
          duplicates.push({ rowIndex: row.rowIndex, existing: { id: match.id, name: `${match.firstName || ""} ${match.lastName || ""}`.trim() } });
          continue;
        }
      }
      if (f.phone) {
        const cleaned = String(f.phone).replace(/\s+/g, "");
        const [match] = await db.select({ id: contactsTable.id, firstName: contactsTable.firstName, lastName: contactsTable.lastName })
          .from(contactsTable).where(and(orgFilter, or(ilike(contactsTable.phone, `%${cleaned}%`), ilike(contactsTable.mobile, `%${cleaned}%`)))).limit(1);
        if (match && !duplicates.find(d => d.rowIndex === row.rowIndex)) {
          duplicates.push({ rowIndex: row.rowIndex, existing: { id: match.id, name: `${match.firstName || ""} ${match.lastName || ""}`.trim() } });
        }
      }
    } catch (e) { logger.warn({ err: e }, "[DocumentAI] duplicate check failed"); }
  }

  return duplicates;
}

export interface ImportResult {
  success: boolean;
  totalImported: number;
  totalSkipped: number;
  totalErrors: number;
  importedIds: number[];
  errors: { rowIndex: number; error: string }[];
  skipped: { rowIndex: number; reason: string }[];
}

export async function importRowsToModule(
  rows: ProcessedRow[],
  targetModule: string,
  orgId: number,
  userId: number | null,
  skipDuplicates: boolean = true,
  selectedRows?: number[]
): Promise<ImportResult> {
  const result: ImportResult = {
    success: true, totalImported: 0, totalSkipped: 0, totalErrors: 0,
    importedIds: [], errors: [], skipped: [],
  };

  const rowsToImport = selectedRows
    ? rows.filter(r => selectedRows.includes(r.rowIndex))
    : rows;

  for (const row of rowsToImport) {
    if (row.errors.length > 0) {
      result.skipped.push({ rowIndex: row.rowIndex, reason: `Erreurs: ${row.errors.join(", ")}` });
      result.totalSkipped++;
      continue;
    }

    if (skipDuplicates && row.duplicateOf) {
      result.skipped.push({ rowIndex: row.rowIndex, reason: `Doublon de ${row.duplicateOf.name} (ID: ${row.duplicateOf.id})` });
      result.totalSkipped++;
      continue;
    }

    try {
      let createdId: number | undefined;

      switch (targetModule) {
        case "contacts": {
          const f = row.fields;
          const [created] = await db.insert(contactsTable).values({
            organisationId: orgId,
            firstName: f.firstName || "",
            lastName: f.lastName || f.name || "",
            email: f.email || null,
            phone: f.phone || "",
            mobile: f.mobile || null,
            company: f.company || null,
            category: f.category || "autre",
            address: f.address || null,
            notes: f.notes || null,
            createdBy: userId,
          }).returning({ id: contactsTable.id });
          createdId = created.id;
          break;
        }
        case "taches": {
          const f = row.fields;
          const [created] = await db.insert(tasksTable).values({
            organisationId: orgId,
            title: f.title || "Tache importee",
            description: f.description || null,
            status: f.status || "en_attente",
            priority: f.priority || "moyenne",
            dueDate: f.dueDate ? new Date(f.dueDate) : null,
            assignedTo: f.assignedTo || null,
            createdBy: userId,
          }).returning({ id: tasksTable.id });
          createdId = created.id;
          break;
        }
        default: {
          result.skipped.push({ rowIndex: row.rowIndex, reason: `Module non supporte pour l'import: ${targetModule}` });
          result.totalSkipped++;
          continue;
        }
      }

      if (createdId) {
        result.importedIds.push(createdId);
        result.totalImported++;
      }
    } catch (err: any) {
      logger.error({ err, rowIndex: row.rowIndex }, "Import row error");
      result.errors.push({ rowIndex: row.rowIndex, error: err.message });
      result.totalErrors++;
    }
  }

  result.success = result.totalErrors === 0;
  return result;
}
