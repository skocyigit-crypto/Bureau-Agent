/**
 * Réglages par org du moteur proactif — bornage des fenêtres.
 *
 * `clampInt` est le garde-fou PUR qui borne les valeurs réglables par
 * l'utilisateur (délai SLA messages, seuil « client silencieux ») avant qu'elles
 * n'atteignent les détecteurs. Cette suite verrouille :
 *   - une valeur dans la plage est conservée (arrondie),
 *   - une valeur hors plage est ramenée à la borne la plus proche,
 *   - une valeur invalide (NaN/null/undefined) replie sur le défaut,
 *   - les bornes « client silencieux » restent disjointes d'inactive_contact
 *     (max strictement < INACTIVE_CONTACT_DAYS) pour garder la fenêtre non vide.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { describe, expect, it } from "vitest";
import {
  clampInt,
  INACTIVE_CONTACT_DAYS,
  MESSAGE_SLA_HOURS_MIN,
  MESSAGE_SLA_HOURS_MAX,
  QUIET_CUSTOMER_AFTER_DAYS_MIN,
  QUIET_CUSTOMER_AFTER_DAYS_MAX,
} from "../services/proactive-engine";

describe("clampInt", () => {
  it("conserve une valeur dans la plage, arrondie", () => {
    expect(clampInt(12, 1, 168, 8)).toBe(12);
    expect(clampInt(12.6, 1, 168, 8)).toBe(13);
  });

  it("ramène une valeur trop basse à la borne min", () => {
    expect(clampInt(0, 1, 168, 8)).toBe(1);
    expect(clampInt(-50, 1, 168, 8)).toBe(1);
  });

  it("ramène une valeur trop haute à la borne max", () => {
    expect(clampInt(9999, 1, 168, 8)).toBe(168);
  });

  it("replie les valeurs non numériques sur le défaut", () => {
    expect(clampInt(undefined, 1, 168, 8)).toBe(8);
    expect(clampInt("abc", 1, 168, 8)).toBe(8);
    expect(clampInt(NaN, 1, 168, 8)).toBe(8);
  });

  it("accepte une chaîne numérique (champ de formulaire)", () => {
    expect(clampInt("24", 1, 168, 8)).toBe(24);
  });
});

describe("bornes des réglages proactifs", () => {
  it("SLA messages : plage cohérente (1 h à 1 semaine)", () => {
    expect(MESSAGE_SLA_HOURS_MIN).toBe(1);
    expect(MESSAGE_SLA_HOURS_MAX).toBe(168);
  });

  it("client silencieux : max strictement sous le seuil d'inactivité", () => {
    expect(QUIET_CUSTOMER_AFTER_DAYS_MIN).toBe(1);
    expect(QUIET_CUSTOMER_AFTER_DAYS_MAX).toBe(INACTIVE_CONTACT_DAYS - 1);
    // Garantit une fenêtre [seuil ; INACTIVE_CONTACT_DAYS[ jamais vide.
    expect(QUIET_CUSTOMER_AFTER_DAYS_MAX).toBeLessThan(INACTIVE_CONTACT_DAYS);
  });
});
