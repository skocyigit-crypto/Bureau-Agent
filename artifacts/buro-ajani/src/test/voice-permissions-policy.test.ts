import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workspaceRoot = resolve(import.meta.dirname, "../../../..");

/**
 * Les fichiers qui posent reellement un Permissions-Policy.
 *
 * Les deux Caddyfile ont ete ajoutes le 2026-09-03, apres avoir constate en
 * ligne que `app.agentdebureau.fr` ne renvoyait AUCUN Permissions-Policy. Ce
 * test surveillait pourtant trois fichiers — mais aucun des trois ne sert le
 * document de l'application en production: `vite.config.ts` est le serveur de
 * developpement, `nginx.conf` une cible d'auto-hebergement inutilisee, et
 * `app.ts` ne pose le header que sur les reponses JSON de /api. La politique
 * existait donc partout sauf la ou un navigateur la lit.
 */
const FICHIERS_AVEC_POLITIQUE = [
  "artifacts/buro-ajani/vite.config.ts",
  "artifacts/api-server/src/app.ts",
  "deploy/non-docker/nginx.conf",
  // Sert le document de l'application en production (Dockerfile.web.cloudrun).
  "deploy/Caddyfile.cloudrun",
  // Sert le document de l'application en Docker Compose (Dockerfile.web).
  "deploy/Caddyfile",
];

describe("VoiceLive Permissions-Policy", () => {
  it.each(FICHIERS_AVEC_POLITIQUE)(
    "allows first-party microphone capture in %s",
    (relativePath) => {
      const source = readFileSync(resolve(workspaceRoot, relativePath), "utf8");

      expect(source).toContain("microphone=(self)");
      expect(source).not.toMatch(/microphone=\(\)(?:[\"',;]|\s+always)/);
    },
  );

  it.each(FICHIERS_AVEC_POLITIQUE)(
    "refuse la geolocalisation et le pistage par cohorte dans %s",
    (relativePath) => {
      // Ces deux directives-la sont le coeur de la politique: sans elles, le
      // header pourrait exister tout en n'interdisant rien.
      const source = readFileSync(resolve(workspaceRoot, relativePath), "utf8");

      expect(source).toContain("geolocation=()");
      expect(source).toContain("interest-cohort=()");
    },
  );
});
