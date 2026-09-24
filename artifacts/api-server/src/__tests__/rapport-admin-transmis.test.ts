import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { appliquerAuthentification } from "../services/support-inbox";
import { LONGUEUR_MAX_SUJET, prioriteSupport, versEmailSupport } from "../services/transfert-rapport-admin";

const ROUTE = readFileSync(join(import.meta.dirname, "..", "routes", "admin-reports.ts"), "utf8");
// L ecran /admin-reports a ete retire : il portait le meme formulaire en
// moins complet, et son onglet « equipe » faisait doublon avec Utilisateurs.
// Les deux invariants qu il verifiait valent pour l ecran qui RESTE — ils
// decrivent ce que le produit doit faire, pas quel fichier le fait.
const MOBILE = readFileSync(join(import.meta.dirname, "..", "..", "..", "mobile", "app", "reports.tsx"), "utf8");
const rapport = { id: 42, userEmail: "a@b.fr", userName: "A B", orgName: "SARL X", subject: "Fuite", message: "Detail", category: "securite", priority: "normal" };

describe("le rapport arrive au support", () => {
  it("la route transmet a la file support apres insertion", () => {
    const i = ROUTE.indexOf("db.insert(adminReportsTable)");
    const apres = ROUTE.slice(i);
    // On verrouille la CONDITION et sa proximite avec l'appel : chercher le
    // seul texte de l'appel laissait survivre `if (false)` (mutation mesuree).
    expect(apres).toMatch(/if \(report\.userEmail\) \{\s*void processIncomingSupportEmail\(versEmailSupport\(/);
  });
  it("la transmission est marquee authentifiee", () => expect(ROUTE).toContain("authentifie: { priorite: prioriteSupport("));
  it("la reponse dit ou arrivera la reponse", () => expect(ROUTE).toContain("reponseParEmailA"));
  it("identifiant stable : pas de doublon au rejeu", () => expect(versEmailSupport(rapport).messageId).toBe("admin-report-42"));
  it("la reponse part a l'auteur", () => expect(versEmailSupport(rapport).from).toBe("a@b.fr"));
  it("l'organisation et la categorie accompagnent le message", () => {
    const e = versEmailSupport(rapport);
    expect(e.text).toContain("SARL X");
    expect(e.subject).toContain("securite");
  });
});

describe("priorite", () => {
  it("securite est toujours haute", () => expect(prioriteSupport("securite", "basse")).toBe("haute"));
  it("urgente est haute", () => expect(prioriteSupport("general", "urgente")).toBe("haute"));
  it("normal est moyenne", () => expect(prioriteSupport("general", "normal")).toBe("moyenne"));
  it("basse reste basse", () => expect(prioriteSupport("general", "basse")).toBe("basse"));
});

describe("authentifie : ni spam, ni abaisse", () => {
  const c = { category: "spam", priority: "basse" as const, confidence: 0.9 };
  it("un spam authentifie devient support", () => expect(appliquerAuthentification(c, { authentifie: { priorite: "moyenne" } }).category).toBe("support"));
  it("l'IA ne peut pas abaisser la priorite", () => expect(appliquerAuthentification(c, { authentifie: { priorite: "haute" } }).priority).toBe("haute"));
  it("l'IA peut la relever", () => {
    expect(appliquerAuthentification({ ...c, priority: "haute" as const }, { authentifie: { priorite: "basse" } }).priority).toBe("haute");
  });
  it("un e-mail anonyme garde son tri spam", () => expect(appliquerAuthentification(c, {}).category).toBe("spam"));
});

describe("ce qui cassait autrement", () => {
  it("sujet borne a la colonne (varchar 300 : sinon 500)", () => {
    expect(LONGUEUR_MAX_SUJET).toBe(300);
    expect(ROUTE).toContain("subject.trim().length > LONGUEUR_MAX_SUJET");
  });
  it("les compteurs sont des entiers (« 1 » + « 2 » = « 12 »)", () => {
    const i = ROUTE.indexOf('"/admin-reports/stats"');
    const bloc = ROUTE.slice(i);
    expect(bloc.match(/count\(\*\) filter \([^`]*\)::int`/g)?.length).toBe(4);
  });
  it("le mobile n'a plus de boutons vers une route qui repond toujours 403", () => {
    expect(MOBILE).not.toContain("updateReportStatus");
  });
  it("le mobile annonce l'envoi et l'echec", () => {
    // L ecran qui reste fermait son formulaire sans un mot. Pour un
    // signalement au support, un envoi silencieux se confond avec un envoi
    // perdu : on renvoie, ou on renonce.
    expect(MOBILE).toContain('t("reportsScreen.sentTitle")');
    expect(MOBILE).toContain('t("common.actionFailed")');
  });
});
