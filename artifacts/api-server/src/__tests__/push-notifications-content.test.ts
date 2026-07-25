/**
 * Relai de notifications push distantes — selection des evenements.
 *
 * `pushContentForEvent` est la seule barriere entre le flux d'evenements
 * interne (tres bavard : chaque mise a jour de liste, chaque ping SSE) et le
 * telephone de l'utilisateur. Deux regressions y sont couteuses et
 * silencieuses :
 *   - trop permissive -> l'app devient une source de bruit, l'utilisateur coupe
 *     les notifications au niveau de l'OS, et cette coupure est definitive ;
 *   - trop restrictive -> on retombe sur le probleme d'origine (aucune alerte
 *     quand l'app est fermee).
 * Ces tests figent le contrat, y compris la route de deep-link, qui doit rester
 * dans la liste blanche de `artifacts/mobile/app/_layout.tsx`.
 */
import { describe, expect, it, vi } from "vitest";

// `vi.hoisted` s'execute AVANT les imports (les imports ESM sont hoistes) : le
// module @workspace/db refuse de se charger sans DATABASE_URL. Ces tests ne
// touchent aucune base — seule la fonction pure de selection est exercee.
vi.hoisted(() => {
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? "postgres://user:pass@127.0.0.1:5432/testdb";
});

import { pushContentForEvent } from "../services/push-notifications";
import type { SyncEvent } from "../services/broadcaster";

function event(partial: Partial<SyncEvent>): SyncEvent {
  return { type: "message", action: "created", ts: 0, ...partial } as SyncEvent;
}

// Doit rester synchronise avec ALLOWED_ROUTES dans app/_layout.tsx : une route
// hors liste est ignoree cote mobile, donc le tap sur la notification ne fait
// rien du tout.
const MOBILE_ALLOWED_ROUTES = new Set([
  "/messages",
  "/(tabs)/tasks",
  "/(tabs)/calls",
  "/calendar",
  "/tasks",
  "/projets",
  "/documents",
  "/file-approbation",
]);

describe("pushContentForEvent — evenements notifies", () => {
  it("notifie un nouveau message", () => {
    expect(pushContentForEvent(event({ type: "message" }))?.route).toBe("/messages");
  });

  it("notifie une nouvelle tache", () => {
    expect(pushContentForEvent(event({ type: "task" }))?.route).toBe("/(tabs)/tasks");
  });

  it("notifie un nouvel appel", () => {
    expect(pushContentForEvent(event({ type: "call" }))?.route).toBe("/(tabs)/calls");
  });

  it("notifie un rappel quelle que soit l'action", () => {
    expect(pushContentForEvent(event({ type: "reminder", action: "updated" }))).not.toBeNull();
  });

  it("reprend le libelle porte par un rappel", () => {
    const content = pushContentForEvent(
      event({ type: "reminder", action: "updated", meta: { title: "RDV dans 10 min" } }),
    );
    expect(content?.title).toBe("RDV dans 10 min");
  });

  it("n'emet que des routes acceptees par la liste blanche mobile", () => {
    const types: SyncEvent["type"][] = ["message", "task", "call", "calendar", "reminder", "security"];
    for (const type of types) {
      const content = pushContentForEvent(event({ type }));
      expect(content, `type ${type}`).not.toBeNull();
      expect(MOBILE_ALLOWED_ROUTES.has(content!.route), `route ${content!.route}`).toBe(true);
    }
  });
});

/**
 * Supervision humaine: une proposition IA qui n'alerte personne equivaut a une
 * absence de supervision (elle expire au bout de 14 jours). Mais notifier
 * CHAQUE proposition est tout aussi nuisible: un cron peut en mettre dix en
 * file d'un coup. Le contrat fige donc le compromis: seules les priorites
 * hautes interrompent, le reste passe par le badge et le resume quotidien.
 */
describe("pushContentForEvent — propositions a approuver", () => {
  const proposition = (meta: Record<string, unknown>): SyncEvent =>
    event({ type: "proposition", action: "created", meta });

  it("notifie une proposition prioritaire vers la file d'approbation", () => {
    const content = pushContentForEvent(proposition({ priority: "haute", title: "Relancer M. Durand" }));
    expect(content?.route).toBe("/file-approbation");
    expect(MOBILE_ALLOWED_ROUTES.has(content!.route)).toBe(true);
  });

  it("reprend le titre de la proposition comme corps de notification", () => {
    const content = pushContentForEvent(proposition({ priority: "urgente", title: "Relancer M. Durand" }));
    expect(content?.body).toBe("Relancer M. Durand");
  });

  it("reste lisible si la proposition n'a pas de titre", () => {
    const content = pushContentForEvent(proposition({ priority: "critique" }));
    expect(content?.body).toMatch(/validation/i);
  });

  it("ne notifie pas les propositions ordinaires (anti-bruit)", () => {
    expect(pushContentForEvent(proposition({ priority: "moyenne", title: "x" }))).toBeNull();
    expect(pushContentForEvent(proposition({ priority: "basse", title: "x" }))).toBeNull();
    expect(pushContentForEvent(proposition({ title: "sans priorite" }))).toBeNull();
  });
});

describe("pushContentForEvent — bruit ignore", () => {
  it("ignore les pings de maintien de connexion", () => {
    expect(pushContentForEvent(event({ type: "ping", action: "ping" }))).toBeNull();
  });

  it("ignore les mises a jour et suppressions ordinaires", () => {
    expect(pushContentForEvent(event({ type: "contact", action: "updated" }))).toBeNull();
    expect(pushContentForEvent(event({ type: "task", action: "deleted" }))).toBeNull();
  });

  it("ignore les rafraichissements de tableau de bord", () => {
    expect(pushContentForEvent(event({ type: "dashboard", action: "created" }))).toBeNull();
  });
});
