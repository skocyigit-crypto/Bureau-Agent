/**
 * Le controle d'origine de l'upgrade WebSocket etait inerte en production.
 *
 * CE QUI A ETE MESURE
 *
 * L'endpoint vocal `/api/voice/live` construisait sa PROPRE allowlist
 * d'origines, a la main, a partir de `REPLIT_DOMAINS` et `REPLIT_DEV_DOMAIN`.
 * Verification faite sur le service Cloud Run de production: ces deux
 * variables n'y sont PAS definies — seules `ALLOWED_ORIGINS` et `PUBLIC_URL`
 * le sont.
 *
 * Sa liste etait donc vide, et sa condition
 *
 *     if (origin && allowedOrigins.size > 0 && !allowedOrigins.has(origin))
 *
 * ne pouvait jamais se declencher. Le controle anti-CSRF de la poignee de
 * main WebSocket ne s'executait pas, exactement la situation que le
 * commentaire place au-dessus declarait insuffisante: « la verification du
 * cookie de session n'est PAS suffisante seule ».
 *
 * DEUX PORTES OUVERTES, PAS UNE
 *
 *   1. `allowedOrigins.size > 0` — liste vide, controle desactive. C'est
 *      l'etat de la production.
 *   2. `origin &&` — en-tete `Origin` absent, controle saute. Un client
 *      non-navigateur suffisait a passer.
 *
 * Les deux sont desormais des REFUS. Un navigateur envoie toujours `Origin`
 * sur une poignee de main WebSocket, et le seul client de cet endpoint est
 * l'application web (`VoiceLive.tsx`, qui utilise `window.location.host`):
 * fermer ne coute rien de legitime.
 *
 * La liste vient maintenant de la meme source que CORS et le CSRF HTTP. Deux
 * listes pour la meme question donnent tot ou tard deux reponses — et celle
 * qui se trompe est toujours celle qu'on ne regarde pas.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  originWebSocketAutorisee,
  originesWebSocket,
  resolveAllowedOrigins,
} from "../lib/origines-autorisees";

const ENV_ORIGINE = [
  "ALLOWED_ORIGINS",
  "REPLIT_DOMAINS",
  "REPLIT_DEV_DOMAIN",
  "PUBLIC_URL",
  "APP_URL",
  "REPLIT_DEPLOYMENT_URL",
  "REPLIT_EXPO_DEV_DOMAIN",
  "NODE_ENV",
] as const;

let sauvegarde: Record<string, string | undefined> = {};

beforeEach(() => {
  sauvegarde = {};
  for (const k of ENV_ORIGINE) {
    sauvegarde[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_ORIGINE) {
    if (sauvegarde[k] === undefined) delete process.env[k];
    else process.env[k] = sauvegarde[k];
  }
});

describe("la configuration reelle de la production", () => {
  it("ALLOWED_ORIGINS suffit a remplir la liste", () => {
    // C'est exactement ce que le service Cloud Run definit — et c'est
    // precisement ce que l'ancienne liste du WebSocket ne lisait pas.
    process.env.ALLOWED_ORIGINS = "https://agentdebureau.fr,https://app.agentdebureau.fr";
    process.env.NODE_ENV = "production";
    const liste = originesWebSocket();
    expect(liste).toContain("https://agentdebureau.fr");
    expect(liste).toContain("https://app.agentdebureau.fr");
  });

  it("les seules variables Replit ne sont plus la seule source", () => {
    // Garde-fou contre un retour en arriere: sans REPLIT_*, la liste doit
    // rester remplie des lors que la configuration reelle est presente.
    process.env.ALLOWED_ORIGINS = "https://agentdebureau.fr";
    process.env.NODE_ENV = "production";
    expect(resolveAllowedOrigins().length).toBeGreaterThan(0);
  });

  it("PUBLIC_URL est retenue, reduite a son origine", () => {
    process.env.PUBLIC_URL = "https://app.agentdebureau.fr/chemin/ignore";
    expect(resolveAllowedOrigins()).toContain("https://app.agentdebureau.fr");
  });
});

describe("le refus est ferme par defaut", () => {
  it("une liste vide REFUSE, au lieu de tout accepter", () => {
    // L'etat exact de la production avant correction. L'ancienne condition
    // laissait passer; celle-ci refuse.
    const v = originWebSocketAutorisee("https://site-malveillant.example", []);
    expect(v.ok).toBe(false);
    expect(v.raison).toMatch(/aucune origine/i);
  });

  it("un en-tete Origin absent REFUSE", () => {
    // Seconde porte: un client non-navigateur omettait simplement l'en-tete.
    // Il ne restait alors que le cookie de session, que le code lui-meme
    // declare insuffisant contre le CSRF.
    const v = originWebSocketAutorisee(undefined, ["https://agentdebureau.fr"]);
    expect(v.ok).toBe(false);
    expect(v.raison).toMatch(/absent/i);
  });

  it("un Origin vide REFUSE aussi", () => {
    const v = originWebSocketAutorisee("", ["https://agentdebureau.fr"]);
    expect(v.ok).toBe(false);
  });

  it("une origine etrangere REFUSE", () => {
    const v = originWebSocketAutorisee("https://site-malveillant.example", [
      "https://agentdebureau.fr",
    ]);
    expect(v.ok).toBe(false);
    expect(v.raison).toMatch(/non autorisee/i);
  });

  it("l'origine legitime est ACCEPTEE", () => {
    // L'erreur inverse compte autant: une porte fermee sur les clients
    // legitimes est une panne, pas une securite.
    const v = originWebSocketAutorisee("https://agentdebureau.fr", [
      "https://agentdebureau.fr",
    ]);
    expect(v.ok).toBe(true);
  });

  it("la comparaison est exacte, pas un prefixe", () => {
    // `https://agentdebureau.fr.attaquant.example` commence par l'origine
    // legitime. Une comparaison par prefixe l'accepterait.
    const v = originWebSocketAutorisee("https://agentdebureau.fr.attaquant.example", [
      "https://agentdebureau.fr",
    ]);
    expect(v.ok).toBe(false);
  });

  it("le schema compte: http n'est pas https", () => {
    const v = originWebSocketAutorisee("http://agentdebureau.fr", [
      "https://agentdebureau.fr",
    ]);
    expect(v.ok).toBe(false);
  });
});

describe("le developpement reste utilisable", () => {
  it("localhost est autorise hors production", () => {
    // Un developpeur passe par le proxy Vite et n'a pas de domaine public.
    process.env.NODE_ENV = "test";
    process.env.ALLOWED_ORIGINS = "https://agentdebureau.fr";
    expect(originesWebSocket()).toContain("http://localhost");
  });

  it("localhost n'est PAS autorise en production", () => {
    // Sinon la porte reste entrouverte la ou elle compte.
    process.env.NODE_ENV = "production";
    process.env.ALLOWED_ORIGINS = "https://agentdebureau.fr";
    const liste = originesWebSocket();
    expect(liste).not.toContain("http://localhost");
    expect(liste).not.toContain("http://localhost:5173");
  });
});

describe("le point d'entree WebSocket utilise bien cette source", () => {
  it("voice-live n'a plus sa propre allowlist", async () => {
    // GARDE STATIQUE, assumee comme telle: le comportement de l'upgrade WS
    // ne se teste pas sans ouvrir un vrai socket. Ce qu'on peut interdire,
    // c'est la FORME qui a cause la panne — une seconde liste construite sur
    // place a partir des seules variables Replit.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(
      join(import.meta.dirname, "..", "routes", "voice-live.ts"),
      "utf8",
    );
    expect(
      /allowedOrigins\s*=\s*new Set<string>\(\)/.test(source),
      "voice-live reconstruit une allowlist locale: elle divergera.",
    ).toBe(false);
    expect(source).toContain("originWebSocketAutorisee");
  });

  it("la condition permissive `size > 0` a disparu", async () => {
    // C'est elle qui rendait le controle inerte quand la liste etait vide.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(
      join(import.meta.dirname, "..", "routes", "voice-live.ts"),
      "utf8",
    );
    expect(/allowedOrigins\.size\s*>\s*0/.test(source)).toBe(false);
  });
});
