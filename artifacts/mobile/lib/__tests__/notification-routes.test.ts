/**
 * Cible de navigation d'une notification.
 *
 * C'est une frontiere de securite doublee d'un chemin fonctionnel critique :
 *  - le payload vient de l'exterieur (notification push distante), donc une
 *    liste blanche trop laxiste enverrait l'utilisateur vers une route
 *    arbitraire de l'app;
 *  - trop stricte ou mal normalisee, le tap sur la notification ne fait rien
 *    ou ouvre une liste au lieu de la ressource concernee — le bug typique
 *    "j'ai appuye sur la notif et il ne s'est rien passe".
 */
import { describe, it, expect } from "vitest";
import {
  extractNotificationTarget,
  ALLOWED_NOTIFICATION_ROUTES,
} from "../notification-routes";

describe("extractNotificationTarget — liste blanche", () => {
  it("accepte les routes emises par le serveur et le contexte de badges", () => {
    for (const route of ALLOWED_NOTIFICATION_ROUTES) {
      expect(extractNotificationTarget({ route })?.pathname, route).toBe(route);
    }
  });

  it("refuse une route hors liste", () => {
    expect(extractNotificationTarget({ route: "/settings" })).toBeNull();
    expect(extractNotificationTarget({ route: "/(tabs)/index" })).toBeNull();
  });

  it("refuse un payload absent, vide ou non-textuel", () => {
    expect(extractNotificationTarget(undefined)).toBeNull();
    expect(extractNotificationTarget(null)).toBeNull();
    expect(extractNotificationTarget({})).toBeNull();
    expect(extractNotificationTarget({ route: 42 })).toBeNull();
  });
});

describe("extractNotificationTarget — resourceId", () => {
  it("accepte un nombre (notification locale)", () => {
    expect(extractNotificationTarget({ route: "/messages", resourceId: 12 })?.resourceId).toBe(12);
  });

  it("accepte une chaine (payload push serialise en JSON)", () => {
    expect(extractNotificationTarget({ route: "/messages", resourceId: "12" })?.resourceId).toBe(12);
  });

  it("ignore une valeur inexploitable au lieu de rejeter la navigation", () => {
    const target = extractNotificationTarget({ route: "/messages", resourceId: "abc" });
    expect(target?.pathname).toBe("/messages");
    expect(target?.resourceId).toBeUndefined();
  });
});

describe("extractNotificationTarget — filtre scan", () => {
  it("relaie un filtre court", () => {
    expect(extractNotificationTarget({ route: "/documents", scan: "dangerous" })?.scan).toBe("dangerous");
  });

  it("ignore un filtre vide ou demesure", () => {
    expect(extractNotificationTarget({ route: "/documents", scan: "" })?.scan).toBeUndefined();
    expect(
      extractNotificationTarget({ route: "/documents", scan: "x".repeat(33) })?.scan,
    ).toBeUndefined();
  });
});
