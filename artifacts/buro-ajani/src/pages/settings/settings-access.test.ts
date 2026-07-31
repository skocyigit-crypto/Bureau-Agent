import { describe,expect,it } from "vitest";
import { getAvailableSettingsTabs } from "./settings-access";

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