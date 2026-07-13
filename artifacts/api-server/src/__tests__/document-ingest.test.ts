/**
 * Tâche #162 — tests du pipeline d'ingestion et de scan de fichiers.
 *
 * `ingestDocument()` est l'unique porte d'entree pour TOUT fichier qui entre
 * dans le systeme (upload UI, Gmail, Drive, WhatsApp). Ses garde-fous (validation
 * type/taille, garde heuristique synchrone, declenchement du scan en arriere-plan,
 * etiquetage de la source) sont critiques pour la securite : une regression
 * pourrait laisser passer un fichier dangereux ou casser un canal. Cette suite
 * verrouille ce comportement.
 *
 * Les dependances lourdes (base de donnees Postgres, moteur antivirus) sont
 * mockees pour garder ces tests rapides, deterministes et reellement unitaires :
 *   - `@workspace/db` : on capture les appels insert/update/select.
 *   - `../middleware/security` : on controle le verdict heuristique et on
 *     espionne `logSecurityEvent` + le scan complet en arriere-plan.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Les factories de vi.mock sont hoistees en haut du fichier : les variables
// qu'elles referencent doivent l'etre aussi via vi.hoisted.
const {
  insertReturning,
  insertValues,
  dbInsert,
  updateWhere,
  updateSet,
  dbUpdate,
  selectLimit,
  selectWhere,
  selectFrom,
  dbSelect,
  scanBase64Content,
  scanBase64ContentFullCached,
  logSecurityEvent,
} = vi.hoisted(() => {
  // db.insert(table).values(obj).returning() -> [doc]
  // db.update(table).set(obj).where(cond)     -> resolu
  // db.select(cols).from(table).where(cond).limit(n) -> [] (aucun verdict reutilisable)
  const insertReturning = vi.fn(async () => [{ id: 4242, tags: [] }]);
  const insertValues = vi.fn((_values: Record<string, unknown>) => ({
    returning: insertReturning,
  }));
  const dbInsert = vi.fn(() => ({ values: insertValues }));

  const updateWhere = vi.fn(async () => undefined);
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const dbUpdate = vi.fn(() => ({ set: updateSet }));

  const selectLimit = vi.fn(async () => [] as unknown[]);
  const selectWhere = vi.fn(() => ({ limit: selectLimit }));
  const selectFrom = vi.fn(() => ({ where: selectWhere }));
  const dbSelect = vi.fn(() => ({ from: selectFrom }));

  const scanBase64Content = vi.fn(() => ({
    safe: true,
    threats: [] as string[],
    fileType: "PDF",
    sha256: "deadbeef",
    size: 3,
    scannedAt: new Date().toISOString(),
    engine: "heuristic",
  }));
  const scanBase64ContentFullCached = vi.fn(async () => ({
    result: {
      safe: true,
      threats: [] as string[],
      sha256: "deadbeef",
      engine: "VirusTotal",
      engineDetail: "clean",
      scannedAt: new Date().toISOString(),
    },
    storedReused: false,
  }));
  const logSecurityEvent = vi.fn();

  return {
    insertReturning,
    insertValues,
    dbInsert,
    updateWhere,
    updateSet,
    dbUpdate,
    selectLimit,
    selectWhere,
    selectFrom,
    dbSelect,
    scanBase64Content,
    scanBase64ContentFullCached,
    logSecurityEvent,
  };
});

vi.mock("@workspace/db", () => ({
  db: { insert: dbInsert, update: dbUpdate, select: dbSelect },
  // Les colonnes ne servent qu'a construire des clauses eq()/and() jamais
  // executees (db mockee). Un Proxy renvoie un jeton inoffensif par colonne.
  documentsTable: new Proxy(
    {},
    { get: (_t, prop) => ({ __col: String(prop) }) },
  ),
}));

vi.mock("../middleware/security", () => ({
  scanBase64Content,
  scanBase64ContentFullCached,
  logSecurityEvent,
}));

vi.mock("../lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import {
  ingestDocument,
  resolveMime,
  MAX_FILE_SIZE_MB,
} from "../services/document-ingest";

// Petit PDF valide (base64), repute "sain" par le mock heuristique.
const PDF_B64 = Buffer.from("%PDF-1.4 fake pdf body").toString("base64");

beforeEach(() => {
  vi.clearAllMocks();
  // Verdict heuristique par defaut: sain.
  scanBase64Content.mockReturnValue({
    safe: true,
    threats: [],
    fileType: "PDF",
    sha256: "deadbeef",
    size: 3,
    scannedAt: new Date().toISOString(),
    engine: "heuristic",
  });
  insertReturning.mockResolvedValue([{ id: 4242, tags: [] }]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveMime — repli sur la table d'extensions", () => {
  it("conserve un type MIME deja autorise", () => {
    expect(resolveMime("rapport.pdf", "application/pdf")).toBe("application/pdf");
  });

  it("retombe sur la table d'extensions quand le MIME annonce est inconnu", () => {
    // application/octet-stream n'est pas autorise -> on resout via .xlsx.
    expect(resolveMime("budget.xlsx", "application/octet-stream")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(resolveMime("photo.png", "binary/unknown")).toBe("image/png");
    expect(resolveMime("notes.txt", "")).toBe("text/plain");
  });

  it("renvoie le MIME annonce tel quel quand l'extension est inconnue", () => {
    // Ni le MIME ni l'extension ne sont mappables: on retourne l'entree brute
    // (ce sera ensuite rejete par la validation d'ingestDocument).
    expect(resolveMime("malware.exe", "application/x-msdownload")).toBe(
      "application/x-msdownload",
    );
  });
});

describe("ingestDocument — rejets (validation type/taille)", () => {
  it("rejette quand fileContent ou fileName manque", async () => {
    const r1 = await ingestDocument({
      orgId: 1,
      userId: 1,
      fileContent: "",
      fileName: "x.pdf",
    });
    expect(r1.status).toBe("rejected");

    const r2 = await ingestDocument({
      orgId: 1,
      userId: 1,
      fileContent: PDF_B64,
      fileName: "",
    });
    expect(r2.status).toBe("rejected");

    expect(dbInsert).not.toHaveBeenCalled();
  });

  it("rejette un type de fichier non autorise (.exe)", async () => {
    const r = await ingestDocument({
      orgId: 1,
      userId: 1,
      fileContent: Buffer.from("MZ executable").toString("base64"),
      fileName: "malware.exe",
      mimeType: "application/x-msdownload",
    });
    expect(r.status).toBe("rejected");
    if (r.status === "rejected") {
      expect(r.error).toMatch(/non autorise/i);
    }
    expect(dbInsert).not.toHaveBeenCalled();
  });

  it("rejette un fichier vide (0 octet decode)", async () => {
    // "====" est une chaine base64 non vide qui decode vers 0 octet :
    // passe la garde "requis" puis echoue sur la garde "Fichier vide".
    const r = await ingestDocument({
      orgId: 1,
      userId: 1,
      fileContent: "====",
      fileName: "vide.pdf",
      mimeType: "application/pdf",
    });
    expect(r.status).toBe("rejected");
    if (r.status === "rejected") {
      expect(r.error).toMatch(/vide/i);
    }
    expect(dbInsert).not.toHaveBeenCalled();
  });

  it("rejette un fichier au-dela de la taille maximale", async () => {
    const oversized = Buffer.alloc(MAX_FILE_SIZE_MB * 1024 * 1024 + 1).toString(
      "base64",
    );
    const r = await ingestDocument({
      orgId: 1,
      userId: 1,
      fileContent: oversized,
      fileName: "gros.pdf",
      mimeType: "application/pdf",
    });
    expect(r.status).toBe("rejected");
    if (r.status === "rejected") {
      expect(r.error).toMatch(/volumineux/i);
    }
    // Taille verifiee AVANT l'heuristique et l'insert.
    expect(scanBase64Content).not.toHaveBeenCalled();
    expect(dbInsert).not.toHaveBeenCalled();
  });

  it("rejette un type d'entite invalide", async () => {
    const r = await ingestDocument({
      orgId: 1,
      userId: 1,
      fileContent: PDF_B64,
      fileName: "doc.pdf",
      mimeType: "application/pdf",
      entityType: "pas-une-entite",
    });
    expect(r.status).toBe("rejected");
    if (r.status === "rejected") {
      expect(r.error).toMatch(/entite invalide/i);
    }
    expect(dbInsert).not.toHaveBeenCalled();
  });
});

describe("ingestDocument — blocage heuristique (menace evidente)", () => {
  it("ne stocke pas, journalise un evenement de securite et renvoie les menaces", async () => {
    scanBase64Content.mockReturnValue({
      safe: false,
      threats: ["Signature EICAR detectee"],
      fileType: "inconnu",
      sha256: "badhash",
      size: 10,
      scannedAt: new Date().toISOString(),
      engine: "heuristic",
    });

    const r = await ingestDocument({
      orgId: 7,
      userId: 99,
      fileContent: PDF_B64,
      fileName: "facture.pdf",
      mimeType: "application/pdf",
      source: "gmail",
      ip: "203.0.113.5",
    });

    expect(r.status).toBe("blocked");
    if (r.status === "blocked") {
      expect(r.threats).toEqual(["Signature EICAR detectee"]);
    }
    // Pas d'insertion : le fichier dangereux ne doit jamais etre stocke.
    expect(dbInsert).not.toHaveBeenCalled();
    // Un evenement de securite critique est journalise, mentionnant le canal.
    expect(logSecurityEvent).toHaveBeenCalledTimes(1);
    const [eventType, ip, userId, detail, severity] =
      logSecurityEvent.mock.calls[0];
    expect(eventType).toBe("malicious_upload_blocked");
    expect(ip).toBe("203.0.113.5");
    expect(userId).toBe(99);
    expect(detail).toMatch(/gmail/);
    expect(severity).toBe("critical");
  });
});

describe("ingestDocument — creation (insertion + tag source + scan en arriere-plan)", () => {
  it("insere la ligne, applique le tag source:<canal> et declenche le scan complet", async () => {
    const r = await ingestDocument({
      orgId: 12,
      userId: 34,
      fileContent: PDF_B64,
      fileName: "contrat.pdf",
      mimeType: "application/pdf",
      tags: ["important"],
      source: "drive",
      ip: "198.51.100.9",
    });

    expect(r.status).toBe("created");
    if (r.status === "created") {
      expect(r.doc.id).toBe(4242);
    }

    expect(dbInsert).toHaveBeenCalledTimes(1);
    const inserted = insertValues.mock.calls[0][0] as unknown as {
      organisationId: number;
      uploadedBy: number;
      originalName: string;
      mimeType: string;
      tags: string[];
      status: string;
    };
    expect(inserted.organisationId).toBe(12);
    expect(inserted.uploadedBy).toBe(34);
    expect(inserted.originalName).toBe("contrat.pdf");
    expect(inserted.mimeType).toBe("application/pdf");
    expect(inserted.status).toBe("uploaded");
    // Le tag de canal est ajoute aux tags existants, sans doublon.
    expect(inserted.tags).toContain("important");
    expect(inserted.tags).toContain("source:drive");

    // Le scan complet en arriere-plan est declenche (fire-and-forget).
    await vi.waitFor(() => {
      expect(scanBase64ContentFullCached).toHaveBeenCalledTimes(1);
    });
    // Le verdict est persiste via une mise a jour de la ligne inseree.
    await vi.waitFor(() => {
      expect(dbUpdate).toHaveBeenCalled();
    });
  });

  it("resout le MIME via l'extension quand le type annonce est generique", async () => {
    const xlsx = Buffer.from("PK fake xlsx").toString("base64");
    const r = await ingestDocument({
      orgId: 1,
      userId: 1,
      fileContent: xlsx,
      fileName: "budget.xlsx",
      mimeType: "application/octet-stream",
    });
    expect(r.status).toBe("created");
    const inserted = insertValues.mock.calls[0][0] as unknown as { mimeType: string };
    expect(inserted.mimeType).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  });

  it("ne declenche PAS le scan en arriere-plan quand triggerScan vaut false", async () => {
    const r = await ingestDocument({
      orgId: 1,
      userId: 1,
      fileContent: PDF_B64,
      fileName: "doc.pdf",
      mimeType: "application/pdf",
      triggerScan: false,
    });
    expect(r.status).toBe("created");
    expect(dbInsert).toHaveBeenCalledTimes(1);
    // Laisse une eventuelle microtache s'executer pour eviter un faux negatif.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(scanBase64ContentFullCached).not.toHaveBeenCalled();
  });

  it("n'ajoute aucun tag source quand source est absent", async () => {
    const r = await ingestDocument({
      orgId: 1,
      userId: 1,
      fileContent: PDF_B64,
      fileName: "doc.pdf",
      mimeType: "application/pdf",
      tags: ["a", "b"],
      triggerScan: false,
    });
    expect(r.status).toBe("created");
    const inserted = insertValues.mock.calls[0][0] as unknown as { tags: string[] };
    expect(inserted.tags).toEqual(["a", "b"]);
    expect(inserted.tags.some((t) => t.startsWith("source:"))).toBe(false);
  });
});
