/**
 * Une sauvegarde n'a de valeur que si elle est COMPLETE, BORNEE au bon client
 * et SANS SECRET. Ces trois proprietes sont verrouillees ici; la premiere est
 * verifiee contre le schema lui-meme, pour qu'une table ajoutee demain sans
 * etre couverte fasse tomber le test plutot que de disparaitre silencieusement
 * de l'export.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  backupFileName,
  EXCLUDED_TABLES,
  readStoredBackup,
  redactRow,
  REDACTED_COLUMNS,
  tableCountsOf,
  TENANT_TABLES,
  type BackupContent,
} from "../services/tenant-backup";

const SCHEMA_DIR = join(import.meta.dirname, "..", "..", "..", "..", "lib", "db", "src", "schema");

/** Tables du schema portant une colonne organisation_id. */
function schemaTenantTables(): string[] {
  const found: string[] = [];
  for (const file of readdirSync(SCHEMA_DIR)) {
    if (!file.endsWith(".ts") || file === "index.ts") continue;
    const src = readFileSync(join(SCHEMA_DIR, file), "utf8");
    for (const m of src.matchAll(/export const \w+ = pgTable\(\s*"([^"]+)"\s*,\s*\{/g)) {
      const open = src.indexOf("{", m.index! + m[0].length - 1);
      let depth = 0, end = open;
      for (let i = open; i < src.length; i++) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
      }
      if (/organisation_id/.test(src.slice(open, end))) found.push(m[1]);
    }
  }
  return found;
}

describe("perimetre de la sauvegarde", () => {
  it("couvre toutes les tables portant organisation_id", () => {
    const schema = schemaTenantTables();
    const covered = new Set<string>(TENANT_TABLES);
    const missing = schema.filter((t) => !covered.has(t) && !(t in EXCLUDED_TABLES));

    expect(schema.length).toBeGreaterThan(50);
    expect(
      missing,
      `tables tenant absentes de la sauvegarde (donnees que le client ne recupererait pas): ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("ne liste aucune table qui n'existe plus au schema", () => {
    const schema = new Set(schemaTenantTables());
    const ghosts = TENANT_TABLES.filter((t) => !schema.has(t));

    expect(ghosts, `tables listees mais absentes du schema: ${ghosts.join(", ")}`).toEqual([]);
  });

  it("s'exclut elle-meme, sinon chaque sauvegarde contiendrait les precedentes", () => {
    expect(EXCLUDED_TABLES).toHaveProperty("organisation_backups");
    expect(TENANT_TABLES).not.toContain("organisation_backups");
  });
});

describe("redactRow", () => {
  it("retire les secrets tout en gardant la forme de la ligne", () => {
    const row = {
      id: 7,
      email: "client@example.test",
      password_hash: "$2b$10$aaaaaaaaaaaaaaaaaaaaaa",
      mfa_secret: "JBSWY3DPEHPK3PXP",
      access_token: "ya29.a0Af...",
      refresh_token: "1//09xyz...",
      client_secret_enc: "enc:abcdef",
      key_hash: "sha256:deadbeef",
      nom: "Durand",
    };

    const safe = redactRow(row);

    expect(Object.keys(safe)).toEqual(Object.keys(row));
    for (const secret of ["password_hash", "mfa_secret", "access_token", "refresh_token", "client_secret_enc", "key_hash"]) {
      expect(safe[secret], secret).toBeNull();
    }
    expect(safe.email).toBe("client@example.test");
    expect(safe.nom).toBe("Durand");
    expect(safe.id).toBe(7);
  });

  it("ne laisse passer aucune valeur de secret dans le JSON exporte", () => {
    const serialized = JSON.stringify(redactRow({
      password_hash: "SECRET-A", refresh_token: "SECRET-B", secret: "SECRET-C", secrets: "SECRET-D",
      titre: "Devis toiture",
    }));

    expect(serialized).not.toContain("SECRET-");
    expect(serialized).toContain("Devis toiture");
  });

  it("couvre les noms de colonnes sensibles connus du schema", () => {
    for (const column of ["password_hash", "mfa_secret", "key_hash", "access_token", "refresh_token", "client_secret_enc"]) {
      expect(REDACTED_COLUMNS.has(column), column).toBe(true);
    }
  });
});

describe("integrite du contenu stocke", () => {
  const content: BackupContent = {
    meta: {
      organisationId: 1, organisationName: "Durand Travaux", exportedAt: "2026-09-02T02:00:00.000Z",
      format: "ajant-bureau/organisation-backup", version: 1, tables: 2, rows: 3,
      redactedColumns: [], excludedTables: {},
    },
    tables: { contacts: [{ id: 1 }, { id: 2 }], calls: [{ id: 9 }], tasks: [] },
  };

  it("relit exactement ce qui a ete ecrit", () => {
    const json = JSON.stringify(content);
    const stored = { content: gzipSync(Buffer.from(json, "utf8")), checksum: createHash("sha256").update(json).digest("hex") };

    const read = readStoredBackup(stored);

    expect(read.valid).toBe(true);
    expect(JSON.parse(read.json)).toEqual(content);
  });

  it("signale un contenu abime au lieu de le livrer", () => {
    const json = JSON.stringify(content);
    const stored = {
      content: gzipSync(Buffer.from(json.replace("Durand", "Dupont"), "utf8")),
      checksum: createHash("sha256").update(json).digest("hex"),
    };

    expect(readStoredBackup(stored).valid).toBe(false);
  });

  it("compte les lignes par table et ignore les tables vides", () => {
    expect(tableCountsOf(content)).toEqual({ contacts: 2, calls: 1 });
  });

  it("compresse reellement un export repetitif", () => {
    const big = JSON.stringify({ ...content, tables: { contacts: Array.from({ length: 500 }, (_, i) => ({ id: i, ville: "Bordeaux" })) } });
    const gz = gzipSync(Buffer.from(big, "utf8"), { level: 9 });

    expect(gz.length).toBeLessThan(big.length / 5);
    expect(gunzipSync(gz).toString("utf8")).toBe(big);
  });
});

describe("backupFileName", () => {
  it("derive un nom lisible et sans caractere de chemin", () => {
    const name = backupFileName("Durand Travaux", new Date("2026-09-02T02:15:30.000Z"));

    expect(name).toBe("sauvegarde-durand-travaux-2026-09-02-02-15-30.json.gz");
    expect(name).not.toContain("/");
  });

  it("resiste a un nom d'organisation hostile ou vide", () => {
    for (const hostile of ["../../etc/passwd", '"; rm -rf /', "", "///"]) {
      const name = backupFileName(hostile, new Date("2026-09-02T00:00:00.000Z"));
      expect(name).not.toContain("/");
      expect(name).not.toContain("..");
      expect(name).not.toContain('"');
      expect(name.endsWith(".json.gz")).toBe(true);
    }
  });

  it("accepte une organisation sans nom", () => {
    expect(backupFileName(null, new Date("2026-09-02T00:00:00.000Z")))
      .toBe("sauvegarde-organisation-2026-09-02-00-00-00.json.gz");
  });
});
