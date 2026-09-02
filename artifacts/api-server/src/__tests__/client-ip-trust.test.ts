import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? "postgres://user:pass@127.0.0.1:5432/testdb";
});

import { resolveClientIp } from "../lib/request-ip";

/**
 * Qui a le droit de declarer l'IP du visiteur.
 *
 * `X-Real-Client-IP` decide de l'identite retenue pour TOUTES les limites par
 * IP: anti-force-brute de la connexion, plafonds des pages publiques, bans du
 * Guardian. Il etait accepte tel quel.
 *
 * Or le service API repond publiquement sur son URL `run.app` — verifie: 200
 * sur /api/healthz sans passer par le proxy. Sur ce chemin, l'en-tete est
 * simplement ce que l'appelant a bien voulu ecrire. En le changeant a chaque
 * requete, on rendait inoperante toute limite par IP.
 *
 * Le jeton partage tranche: Caddy le pose, un appelant direct ne le connait
 * pas.
 *
 * DEPLOIEMENT EN TROIS TEMPS, d'ou les tests sur l'etat « non active »: ce
 * code part d'abord sans effet, puis Caddy pose le jeton, puis la variable
 * active le controle. Activer avant que Caddy ne pose le jeton ferait perdre
 * la vraie IP de tous les visiteurs — l'incident du 2026-07-14, ou un seul
 * visiteur pouvait faire bannir tout le monde.
 */

const req = (headers: Record<string, string>) =>
  ({ headers, ip: "10.0.0.1", socket: { remoteAddress: "10.0.0.1" } }) as any;

afterEach(() => {
  delete process.env.PROXY_SHARED_TOKEN;
});

describe("controle non active", () => {
  it("ne change rien au comportement en place", () => {
    // Etape 1 du deploiement: le code part, sans effet.
    expect(resolveClientIp(req({ "x-real-client-ip": "203.0.113.7" }))).toBe("203.0.113.7");
    expect(resolveClientIp(req({ "x-forwarded-for": "203.0.113.7, 10.1.1.1" }))).toBe("203.0.113.7");
  });
});

describe("controle active", () => {
  it("accepte l'en-tete quand le proxy s'identifie", () => {
    process.env.PROXY_SHARED_TOKEN = "jeton-secret-de-test";

    const ip = resolveClientIp(req({
      "x-proxy-token": "jeton-secret-de-test",
      "x-real-client-ip": "203.0.113.7",
    }));

    expect(ip).toBe("203.0.113.7");
  });

  it("ignore l'en-tete d'un appelant direct", () => {
    // Le coeur du correctif: sans jeton, l'appelant ne choisit plus son
    // identite.
    process.env.PROXY_SHARED_TOKEN = "jeton-secret-de-test";

    const ip = resolveClientIp(req({
      "x-real-client-ip": "1.2.3.4",
      "x-forwarded-for": "1.2.3.4, 198.51.100.9",
    }));

    expect(ip, "l'IP annoncee par l'appelant a ete retenue").not.toBe("1.2.3.4");
    expect(ip).toBe("198.51.100.9");
  });

  it("rejette un jeton faux", () => {
    process.env.PROXY_SHARED_TOKEN = "jeton-secret-de-test";

    const ip = resolveClientIp(req({
      "x-proxy-token": "jeton-secret-de-tesX",
      "x-real-client-ip": "1.2.3.4",
      "x-forwarded-for": "1.2.3.4, 198.51.100.9",
    }));

    expect(ip).toBe("198.51.100.9");
  });

  it("ne se laisse pas berner par un jeton de longueur differente", () => {
    // `timingSafeEqual` leve si les longueurs different: la comparaison doit
    // sortir proprement avant, sinon la resolution d'IP jetterait sur une
    // requete quelconque.
    process.env.PROXY_SHARED_TOKEN = "jeton-secret-de-test";

    expect(() => resolveClientIp(req({
      "x-proxy-token": "court",
      "x-forwarded-for": "1.2.3.4, 198.51.100.9",
    }))).not.toThrow();
  });

  it("prend la DERNIERE entree de X-Forwarded-For", () => {
    // L'appelant choisit le debut de la liste, l'infrastructure ecrit a la
    // fin. Le choix reste correct que la plateforme ecrase l'en-tete (une
    // seule entree) ou qu'elle ajoute la sienne (la derniere).
    process.env.PROXY_SHARED_TOKEN = "jeton-secret-de-test";

    expect(resolveClientIp(req({ "x-forwarded-for": "9.9.9.9" }))).toBe("9.9.9.9");
    expect(resolveClientIp(req({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3" }))).toBe("3.3.3.3");
  });

  it("retombe sur la socket quand rien n'est declare", () => {
    process.env.PROXY_SHARED_TOKEN = "jeton-secret-de-test";

    expect(resolveClientIp(req({}))).toBe("10.0.0.1");
  });
});
