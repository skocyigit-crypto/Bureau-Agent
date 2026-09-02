import { describe,expect,it } from "vitest";
import { getAvailableSettingsTabs, resolveSettingsTabFromQuery } from "./settings-access";

describe("getAvailableSettingsTabs", () => {
  it("limits regular users to personal settings", () => {
    expect(getAvailableSettingsTabs(false, false)).toEqual([
      "appels", "preferences-ia", "installation", "notifications",
    ]);
  });

  it("exposes organisation settings to administrators without update controls", () => {
    const tabs = getAvailableSettingsTabs(true, false);
    expect(tabs).toContain("api-webhooks");
    expect(tabs).not.toContain("mises-a-jour");
  });

  it("exposes update controls only to super administrators", () => {
    expect(getAvailableSettingsTabs(true, true)).toContain("mises-a-jour");
  });
});

describe("resolveSettingsTabFromQuery", () => {
  const adminTabs = getAvailableSettingsTabs(true, false);

  it("opens the tab the incoming link asked for", () => {
    // /parametres?tab=abonnement — le lien des bannieres d'essai et de licence.
    expect(resolveSettingsTabFromQuery("?tab=abonnement", adminTabs, "profil")).toBe("abonnement");
    expect(resolveSettingsTabFromQuery("?tab=sauvegardes", adminTabs, "profil")).toBe("sauvegardes");
  });

  it("falls back when no tab is requested", () => {
    expect(resolveSettingsTabFromQuery("", adminTabs, "profil")).toBe("profil");
    expect(resolveSettingsTabFromQuery("?other=1", adminTabs, "appels")).toBe("appels");
  });

  it("refuses a tab the role cannot open", () => {
    // Un utilisateur simple qui suit un lien vers un onglet d'administration
    // doit voir son onglet par defaut, pas un panneau vide.
    const userTabs = getAvailableSettingsTabs(false, false);
    expect(resolveSettingsTabFromQuery("?tab=abonnement", userTabs, "appels")).toBe("appels");
    expect(resolveSettingsTabFromQuery("?tab=mises-a-jour", adminTabs, "profil")).toBe("profil");
  });

  it("refuses an unknown tab instead of rendering nothing", () => {
    expect(resolveSettingsTabFromQuery("?tab=%%%", adminTabs, "profil")).toBe("profil");
    expect(resolveSettingsTabFromQuery("?tab=", adminTabs, "profil")).toBe("profil");
  });
});