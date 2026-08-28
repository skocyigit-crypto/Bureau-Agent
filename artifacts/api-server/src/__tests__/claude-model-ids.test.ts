/**
 * Regression: aucun identifiant de modele Claude RETIRE ne doit pouvoir
 * atteindre l'API Anthropic.
 *
 * Anthropic a retire Claude 3.5 / 3.7 / 3 Opus le 19/02/2026. Un appel avec
 * l'un de ces IDs renvoie un 404 `not_found_error` — indistinguable, dans un
 * `catch` generique, d'une cle invalide. Le endpoint de test de cle BYOK
 * (`POST /ai-providers/:id/test`) pingait justement "claude-3-5-haiku-latest"
 * et repondait donc "clé invalide ou quota épuisé" a des organisations dont la
 * cle Anthropic etait parfaitement valide.
 *
 * Deux verrous complementaires ici :
 *  1. `resolveClaudeModelId` remappe les IDs retires vers leur successeur, sur
 *     l'API directe comme sur Vertex ;
 *  2. un scan statique du code serveur interdit de re-coder en dur un ID
 *     retire — c'est la forme qu'avait prise la panne d'origine.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const { resolveClaudeModelId, getAnthropicMode } = await import(
  "@workspace/integrations-anthropic-ai"
);

/** Variables qui pilotent le choix de la voie de credentials Anthropic. */
const CREDENTIAL_ENV = [
  "ANTHROPIC_PROVIDER",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_VERTEX_PROJECT_ID",
  "AI_INTEGRATIONS_ANTHROPIC_BASE_URL",
  "AI_INTEGRATIONS_ANTHROPIC_API_KEY",
] as const;

/**
 * Execute `fn` avec exactement l'environnement Anthropic decrit par `env`, puis
 * restaure l'etat precedent. On repart d'une table rase: sinon une cle presente
 * dans l'environnement de la machine de test changerait le mode resolu.
 */
function withAnthropicEnv<T>(
  env: Partial<Record<(typeof CREDENTIAL_ENV)[number], string>>,
  fn: () => T,
): T {
  const previous = new Map(CREDENTIAL_ENV.map((k) => [k, process.env[k]]));
  for (const key of CREDENTIAL_ENV) delete process.env[key];
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
  try {
    return fn();
  } finally {
    for (const key of CREDENTIAL_ENV) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** IDs servis par Anthropic aujourd'hui (catalogue du 2026-06-24). */
const LIVE_MODEL_IDS = new Set([
  "claude-fable-5",
  "claude-mythos-5",
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-opus-4-5",
  "claude-sonnet-5",
  "claude-sonnet-4-6",
  "claude-sonnet-4-5",
  "claude-haiku-4-5",
]);

/**
 * IDs retires : tout appel avec ceux-ci renvoie 404.
 *
 * Liste alignee sur platform.claude.com/docs/en/about-claude/model-deprecations
 * (verifiee le 2026-08-28). Les trois premieres familles sont les plus
 * dangereuses en pratique : Opus 4.1 n'est retire que depuis le 2026-08-05 et
 * Sonnet 4 / Opus 4 depuis le 2026-06-15, donc ils restent tres presents dans
 * du code ou des variables d'environnement ecrits il y a quelques mois.
 */
const RETIRED_MODEL_IDS = [
  "claude-opus-4-1",
  "claude-opus-4-1-20250805",
  "claude-opus-4-0",
  "claude-opus-4-20250514",
  "claude-sonnet-4-0",
  "claude-sonnet-4-20250514",
  "claude-3-haiku-20240307",
  "claude-3-5-haiku-latest",
  "claude-3-5-haiku-20241022",
  "claude-3-5-sonnet-latest",
  "claude-3-5-sonnet-20241022",
  "claude-3-5-sonnet-20240620",
  "claude-3-7-sonnet-latest",
  "claude-3-7-sonnet-20250219",
  "claude-3-opus-latest",
  "claude-3-opus-20240229",
  "claude-3-sonnet-20240229",
  "claude-2.1",
  "claude-2.0",
  "claude-1.0",
  "claude-1.1",
  "claude-1.2",
  "claude-1.3",
  "claude-instant-1.0",
  "claude-instant-1.1",
  "claude-instant-1.2",
];

const withVertex = <T,>(projectId: string | undefined, fn: () => T): T =>
  withAnthropicEnv(
    projectId === undefined
      ? { ANTHROPIC_API_KEY: "sk-ant-test" }
      : { ANTHROPIC_VERTEX_PROJECT_ID: projectId },
    fn,
  );

describe("resolution des identifiants de modele Claude", () => {
  it("remappe tous les modeles retires vers un modele encore servi (API directe)", () => {
    withVertex(undefined, () => {
      for (const retired of RETIRED_MODEL_IDS) {
        const resolved = resolveClaudeModelId(retired);
        expect(resolved, `${retired} doit etre remappe`).not.toBe(retired);
        expect(LIVE_MODEL_IDS.has(resolved), `${retired} -> ${resolved}`).toBe(
          true,
        );
      }
    });
  });

  it("remappe aussi les modeles retires sur Vertex AI", () => {
    withVertex("projet-test", () => {
      for (const retired of RETIRED_MODEL_IDS) {
        expect(LIVE_MODEL_IDS.has(resolveClaudeModelId(retired))).toBe(true);
      }
    });
  });

  it("laisse les modeles courants intacts sur l'API directe", () => {
    withVertex(undefined, () => {
      for (const live of LIVE_MODEL_IDS) {
        expect(resolveClaudeModelId(live)).toBe(live);
      }
    });
  });

  it("resout les alias '-latest' en version explicite sur Vertex", () => {
    // Vertex refuse les alias mouvants et exige un identifiant de version.
    withVertex("projet-test", () => {
      expect(resolveClaudeModelId("claude-sonnet-4-6-latest")).toBe(
        "claude-sonnet-4-6",
      );
      expect(resolveClaudeModelId("claude-haiku-4-5-latest")).toBe(
        "claude-haiku-4-5",
      );
    });
  });
});

describe("choix de la voie de credentials Anthropic", () => {
  it("prefere une cle API explicite a Vertex", () => {
    // Regression: Vertex etait prioritaire, donc sur un projet ou Vertex est
    // configure mais inutilisable (404 sur le modele / quota a zero), definir
    // ANTHROPIC_API_KEY ne servait a rien — Claude restait mort.
    expect(
      withAnthropicEnv(
        {
          ANTHROPIC_API_KEY: "sk-ant-test",
          ANTHROPIC_VERTEX_PROJECT_ID: "projet-test",
        },
        getAnthropicMode,
      ),
    ).toBe("direct");
  });

  it("retombe sur Vertex quand aucune cle n'est definie", () => {
    expect(
      withAnthropicEnv(
        { ANTHROPIC_VERTEX_PROJECT_ID: "projet-test" },
        getAnthropicMode,
      ),
    ).toBe("vertex");
  });

  it("respecte ANTHROPIC_PROVIDER quand il force un mode", () => {
    expect(
      withAnthropicEnv(
        {
          ANTHROPIC_PROVIDER: "vertex",
          ANTHROPIC_API_KEY: "sk-ant-test",
          ANTHROPIC_VERTEX_PROJECT_ID: "projet-test",
        },
        getAnthropicMode,
      ),
    ).toBe("vertex");
  });

  it("n'active le proxy que si base URL ET cle sont presentes", () => {
    expect(
      withAnthropicEnv(
        { AI_INTEGRATIONS_ANTHROPIC_API_KEY: "k" },
        getAnthropicMode,
      ),
    ).toBe("none");
    expect(
      withAnthropicEnv(
        {
          AI_INTEGRATIONS_ANTHROPIC_BASE_URL: "https://proxy.invalid",
          AI_INTEGRATIONS_ANTHROPIC_API_KEY: "k",
        },
        getAnthropicMode,
      ),
    ).toBe("proxy");
  });

  it("signale 'none' quand aucune voie n'est configuree", () => {
    expect(withAnthropicEnv({}, getAnthropicMode)).toBe("none");
  });
});

describe("scan statique du code serveur", () => {
  const SRC = join(import.meta.dirname, "..");

  function collectSources(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "__tests__") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) collectSources(full, out);
      else if (entry.endsWith(".ts")) out.push(full);
    }
    return out;
  }

  it("ne code en dur aucun identifiant de modele Claude retire", () => {
    const offenders: string[] = [];
    for (const file of collectSources(SRC)) {
      const source = readFileSync(file, "utf8");
      for (const retired of RETIRED_MODEL_IDS) {
        if (source.includes(`"${retired}"`)) {
          offenders.push(`${file.slice(SRC.length + 1)}: ${retired}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("expose un modele rapide Claude courant pour le test de cle BYOK", () => {
    const aiUtils = readFileSync(join(SRC, "services/ai-utils.ts"), "utf8");
    const providers = readFileSync(join(SRC, "routes/ai-providers.ts"), "utf8");

    expect(aiUtils).toContain("export const ANTHROPIC_FAST_MODEL");
    // Le ping de validation doit passer par la constante ET par le resolveur :
    // sinon un ID retire ou un alias refuse par Vertex repart en production.
    expect(providers).toContain(
      "model: resolveClaudeModelId(ANTHROPIC_FAST_MODEL)",
    );
  });
});
