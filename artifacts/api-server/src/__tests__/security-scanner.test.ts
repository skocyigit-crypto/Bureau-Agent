/**
 * Tests de regression du scanner de liens & fichiers (Concierge/Gateway).
 *
 * Le paquet securite (scanner d'URL, scanner de documents, bypass de la
 * detection de menaces) a ete durci apres revue de code mais n'avait
 * aucun test automatise. Cette suite verrouille le comportement de
 * securite pour qu'une evolution future ne puisse pas rouvrir
 * silencieusement une faille (ex: accepter un lien `javascript:`
 * dangereux ou un fichier surdimensionne).
 *
 * Trois axes:
 *   1. Allowlist de schemas d'URL (analyzeUrlHeuristic): http/https
 *      acceptes ; javascript:/data:/file:/blob:/vbscript: => "dangerous".
 *   2. Bornes du scanner de documents (route /security/scan-document):
 *      data-URI base64 valide, chaine non-data avec virgule, limite
 *      exacte de 10 Mo, un octet de trop (413), base64 invalide (400).
 *   3. Bypass de threatDetection: endpoints de scan joignables, variantes
 *      trailing-slash / query-string gerees, pas d'elargissement a
 *      d'autres routes.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";
process.env.DISABLE_CSRF_DEV = "1";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { inArray } from "drizzle-orm";
import { db, organisationsTable, usersTable } from "@workspace/db";
import app from "../app";
import { mintApiToken } from "../lib/api-token";
import { analyzeUrlHeuristic } from "../services/url-safety";

// Plafond decode du scanner de documents (doit rester aligne avec
// MAX_SCAN_DECODED_BYTES dans routes/security.ts).
const MAX_SCAN_DECODED_BYTES = 10 * 1024 * 1024;

let orgId: number;
let userId: number;
let token: string;
const stamp = Date.now();

beforeAll(async () => {
  const [org] = await db
    .insert(organisationsTable)
    .values({
      name: `Scan Test Org ${stamp}`,
      slug: `scan-test-${stamp}`,
      maxUsers: 5,
      actif: true,
    })
    .returning({ id: organisationsTable.id });
  orgId = org.id;

  // NB: on utilise un super_admin pour piloter les endpoints. Les routes
  // montees apres `router.use(requireSuperAdmin, ...)` (sans prefixe de
  // chemin) dans routes/index.ts sont actuellement gardees globalement
  // par requireSuperAdmin, donc un agent/administrateur recevrait 403
  // avant meme d'atteindre le handler de scan. Le role n'influe pas sur
  // la LOGIQUE du scanner (allowlist, bornes, bypass) que cette suite
  // verrouille; super_admin offre simplement un chemin propre vers le
  // handler. (Voir tache de suivi sur la garde super_admin globale.)
  const [user] = await db
    .insert(usersTable)
    .values({
      email: `scan-admin-${stamp}@example.test`,
      passwordHash: "x",
      nom: "Admin",
      prenom: "Scan",
      role: "super_admin",
      organisationId: orgId,
      actif: true,
    })
    .returning({ id: usersTable.id });
  userId = user.id;

  token = mintApiToken({
    userId,
    userRole: "super_admin",
    organisationId: orgId,
    userEmail: `scan-admin-${stamp}@example.test`,
    prenom: "Scan",
    nom: "Admin",
  });
});

afterAll(async () => {
  try {
    await db.delete(usersTable).where(inArray(usersTable.id, [userId]));
    await db.delete(organisationsTable).where(inArray(organisationsTable.id, [orgId]));
  } catch {
    // best-effort: ids uniques par run grace a `stamp`.
  }
});

// Helper: construit une chaine base64 dont la taille DECODEE est
// exactement `decodedBytes` (rempli de 'A' pour eviter les heuristiques
// binaires comme le ratio d'octets nuls).
function base64OfDecodedSize(decodedBytes: number): string {
  return Buffer.alloc(decodedBytes, 0x41).toString("base64");
}

// ── 1. Allowlist de schemas d'URL ─────────────────────────────────────────────
describe("analyzeUrlHeuristic — allowlist de schemas", () => {
  it("accepte https:// (non dangereux, sans rejet de schema)", () => {
    const r = analyzeUrlHeuristic("https://example.com/page");
    expect(r.risk).not.toBe("dangerous");
    expect(r.isHttps).toBe(true);
    expect(r.reasons.join(" ")).not.toMatch(/Schema/i);
  });

  it("accepte http:// (non dangereux, signale juste la connexion non securisee)", () => {
    const r = analyzeUrlHeuristic("http://example.com/page");
    expect(r.risk).not.toBe("dangerous");
    expect(r.reasons.join(" ")).not.toMatch(/Schema/i);
  });

  for (const proto of ["javascript", "data", "file", "blob", "vbscript"] as const) {
    it(`classe ${proto}: comme "dangerous"`, () => {
      const sample =
        proto === "data"
          ? "data:text/html,<script>alert(1)</script>"
          : proto === "blob"
            ? "blob:https://example.com/0d3f"
            : proto === "file"
              ? "file:///etc/passwd"
              : proto === "vbscript"
                ? "vbscript:msgbox(1)"
                : "javascript:alert(document.cookie)";
      const r = analyzeUrlHeuristic(sample);
      expect(r.risk).toBe("dangerous");
      expect(r.reasons.join(" ")).toMatch(/Schema d'URL non autorise/i);
    });
  }
});

// ── 2. Bornes du scanner de documents ─────────────────────────────────────────
describe("POST /api/security/scan-document — bornes", () => {
  function postDoc(content: string, filename = "test.bin") {
    return request(app)
      .post("/api/security/scan-document")
      .set("Authorization", `Bearer ${token}`)
      .set("Origin", "http://localhost")
      .send({ content, filename });
  }

  it("accepte un data-URI base64 valide (200)", async () => {
    const b64 = Buffer.from("hello world", "utf-8").toString("base64");
    const res = await postDoc(`data:text/plain;base64,${b64}`, "note.txt");
    expect(res.status).toBe(200);
    expect(res.body.safe).toBe(true);
    expect(res.body.size).toBe("hello world".length);
  });

  it("rejette une chaine non-data contenant une virgule (400, pas de slice generique)", async () => {
    // "QUJD" = base64 de "ABC". L'ancien comportement bogue aurait coupe
    // a la 1ere virgule et scanne "QUJD"; le comportement durci traite
    // toute la chaine comme base64 -> virgule invalide -> 400.
    const res = await postDoc("notdata,QUJD");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/base64/i);
  });

  it("accepte la taille decodee exacte de 10 Mo (200)", async () => {
    const b64 = base64OfDecodedSize(MAX_SCAN_DECODED_BYTES);
    const res = await postDoc(b64, "exact.bin");
    expect(res.status).toBe(200);
    expect(res.body.size).toBe(MAX_SCAN_DECODED_BYTES);
  });

  it("rejette un octet au-dessus de la limite (413)", async () => {
    const b64 = base64OfDecodedSize(MAX_SCAN_DECODED_BYTES + 1);
    const res = await postDoc(b64, "toobig.bin");
    expect(res.status).toBe(413);
  });

  it("rejette du base64 malforme/invalide (400)", async () => {
    const res = await postDoc("!!!ceci n'est pas du base64@@@");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/base64/i);
  });
});

// ── 3. Bypass de threatDetection ──────────────────────────────────────────────
describe("threatDetection — bypass des endpoints de scan", () => {
  it("scan-url est joignable malgre un payload javascript: (bypass + verdict dangereux)", async () => {
    const res = await request(app)
      .post("/api/security/scan-url")
      .set("Authorization", `Bearer ${token}`)
      .set("Origin", "http://localhost")
      .send({ url: "javascript:alert(document.cookie)" });
    expect(res.status).toBe(200);
    expect(res.body.risk).toBe("dangerous");
  });

  it("scan-url avec query-string reste bypasse (pas de THREAT_DETECTED)", async () => {
    const res = await request(app)
      .post("/api/security/scan-url?source=email")
      .set("Authorization", `Bearer ${token}`)
      .set("Origin", "http://localhost")
      .send({ url: "javascript:alert(1)" });
    expect(res.status).toBe(200);
    expect(res.body.code).not.toBe("THREAT_DETECTED");
  });

  it("scan-url avec trailing-slash reste bypasse (pas de THREAT_DETECTED)", async () => {
    const res = await request(app)
      .post("/api/security/scan-url/")
      .set("Authorization", `Bearer ${token}`)
      .set("Origin", "http://localhost")
      .send({ url: "javascript:alert(1)" });
    expect(res.body.code).not.toBe("THREAT_DETECTED");
    expect(res.status).not.toBe(400);
  });

  it("bypass se produit AVANT l'auth (payload javascript: sans token => 401, pas THREAT_DETECTED)", async () => {
    // threatDetection est monte au niveau app AVANT requireAuth. Si le
    // bypass fonctionne, un payload dangereux sur scan-url franchit
    // threatDetection puis bute sur l'auth (401) plutot que d'etre
    // bloque a 400 THREAT_DETECTED. Cela isole le comportement du
    // middleware, independamment de la chaine de roles en aval.
    const res = await request(app)
      .post("/api/security/scan-url")
      .set("Origin", "http://localhost")
      .send({ url: "javascript:alert(document.cookie)" });
    expect(res.status).toBe(401);
    expect(res.body.code).not.toBe("THREAT_DETECTED");
  });

  it("scan-document avec un filename malveillant est bypasse (reach le handler)", async () => {
    const b64 = Buffer.from("ok", "utf-8").toString("base64");
    const res = await request(app)
      .post("/api/security/scan-document")
      .set("Authorization", `Bearer ${token}`)
      .set("Origin", "http://localhost")
      .send({ content: b64, filename: "<script>alert(1)</script>.txt" });
    // Sans bypass, threatDetection bloquerait (400 THREAT_DETECTED) avant
    // le handler. Avec bypass, le handler scanne et repond 200.
    expect(res.status).toBe(200);
    expect(res.body.code).not.toBe("THREAT_DETECTED");
  });

  it("ne s'elargit PAS aux autres routes /security (scan admin toujours protege)", async () => {
    // /security/scan (admin) n'est PAS dans l'allowlist de bypass: un
    // payload malveillant doit etre bloque par threatDetection AVANT
    // meme d'atteindre requireAuth.
    const res = await request(app)
      .post("/api/security/scan")
      .set("Origin", "http://localhost")
      .send({ content: "QUJD", filename: "<script>alert(1)</script>" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("THREAT_DETECTED");
  });
});
