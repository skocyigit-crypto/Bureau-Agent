/**
 * L'ecran du raccordement a la plateforme agreee, et le bouton de
 * transmission sur les factures.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAvailableSettingsTabs } from "@/pages/settings/settings-access";
import { PLATEFORMES_CONNUES } from "@/pages/settings/tab-plateforme-agreee";

const SRC = join(import.meta.dirname, "..");
const RACINE = join(SRC, "..", "..", "..");
const lire = (...p: string[]) => readFileSync(join(SRC, ...p), "utf8");
const LANGUES = ["fr", "en", "tr", "es", "de", "ar"];
const SPEC = JSON.parse(readFileSync(join(RACINE, "artifacts", "api-server", "src", "__tests__", "fixtures", "afnor-xp-z12-013-flow-1.3.0.json"), "utf8"));

describe("l'onglet du raccordement", () => {
  it("est offert a l'administrateur", () => {
    expect(getAvailableSettingsTabs(true, false)).toContain("plateforme-agreee");
  });

  it("pas a un agent : la route le refuserait", () => {
    expect(getAvailableSettingsTabs(false, false)).not.toContain("plateforme-agreee");
  });

  it("est branche dans la page des parametres", () => {
    const s = lire("pages", "settings.tsx");
    expect(s).toContain('<TabsTrigger value="plateforme-agreee"');
    expect(s).toContain("<TabPlateformeAgreee />");
  });

  it("l'adresse pre-remplie de Super PDP est celle de SA specification publiee", () => {
    // La valeur vient de la spec (champ servers), pas d'une recopie a la main.
    const sp = PLATEFORMES_CONNUES.find((p) => p.nom === "Super PDP")!;
    expect(sp.urlFlow).toBe(SPEC.servers[0].url);
    expect(new URL(sp.urlJeton).origin).toBe(new URL(SPEC.servers[0].url).origin);
    expect(SPEC.components.securitySchemes.BearerAuth.flows.clientCredentials.tokenUrl).toBe(new URL(sp.urlJeton).pathname);
  });

  it("le secret est un champ masque, jamais pre-rempli", () => {
    const s = lire("pages", "settings", "tab-plateforme-agreee.tsx");
    expect(s).toMatch(/id="pa-client-secret" type="password"/);
    // Au chargement, le formulaire remet le secret a vide.
    expect(s).toMatch(/clientId: d\.clientId \?\? "", clientSecret: "" \}/);
  });

  it("les champs obligatoires signalent leur erreur (RGAA 11.10)", () => {
    const s = lire("pages", "settings", "tab-plateforme-agreee.tsx");
    for (const id of ["pa-nom", "pa-client-id", "pa-client-secret"]) expect(s).toContain(`signalerChamp("${id}"`);
  });
});

describe("le bouton de transmission sur les factures", () => {
  const s = lire("pages", "admin-factures-client.tsx");

  it("n'est montre qu'aux administrateurs", () => {
    expect(s).toMatch(/peutTransmettre = user\.role === "administrateur" \|\| user\.role === "super_admin"/);
  });

  it("jamais pour un brouillon, ni pour une facture deja deposee non rejetee", () => {
    expect(s).toMatch(/f\.status !== "brouillon" && \(!f\.paFlowId \|\| f\.paStatut === "Error"\)/);
  });

  it("demande confirmation : une facture transmise ne se retire pas", () => {
    const i = s.indexOf("const handleTransmettre");
    expect(s.slice(i, i + 300)).toContain("confirmAction(");
  });

  it("appelle la route de transmission", () => {
    expect(s).toContain("/api/factures-client/${f.id}/transmettre");
  });

  it("le bouton a un nom qui cite la facture", () => {
    expect(s).toContain('aria-label={t("adminFacturesClient.pa.transmitFor", { reference: f.reference })}');
  });
});

describe("traductions", () => {
  for (const l of LANGUES) {
    it(`${l} : onglet, ecran et statuts`, () => {
      const j = JSON.parse(lire("i18n", "locales", `${l}.json`));
      expect(j.settings.tabs.plateformeAgreee?.trim()).toBeTruthy();
      for (const k of ["title", "why", "save", "test"]) expect(j.settingsPlateformeAgreee[k]?.trim(), `${l}.${k}`).toBeTruthy();
      for (const k of ["nom", "clientId", "urlFlow", "urlJeton", "clientSecret"]) expect(j.settingsPlateformeAgreee.fields[k]?.trim()).toBeTruthy();
      for (const k of ["Pending", "Ok", "Error"]) expect(j.adminFacturesClient.pa.status[k]?.trim()).toBeTruthy();
      expect(j.adminFacturesClient.pa.transmitFor).toContain("{{reference}}");
    });
  }
});
