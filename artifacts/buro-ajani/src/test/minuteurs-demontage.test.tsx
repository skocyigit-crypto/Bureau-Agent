/**
 * Un composant qui disparait annule ses minuteurs.
 *
 * Le 29/09, la porte de deploiement (Cloud Build) a echoue : le centre
 * d'aide, monte dans la mise en page, programmait un setState 200 ms apres
 * son rendu ferme ; le test de la mise en page se terminait avant, l'
 * environnement etait detruit, et le minuteur tombait sur « window is not
 * defined ». La suite etait verte, l'erreur non geree faisait sortir vitest
 * en echec — selon la charge de la machine. Ici, sans attendre : le minuteur
 * de fermeture programme par le composant doit avoir ete annule au demontage.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { I18nProvider } from "@/i18n";
import { HelpCenter } from "@/components/help-center";

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe("le centre d'aide", () => {
  it("annule son minuteur de fermeture quand il disparait", () => {
    const programmes: unknown[] = [];
    const annules = new Set<unknown>();
    const vraiSetTimeout = globalThis.setTimeout;
    const vraiClearTimeout = globalThis.clearTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number, ...args: unknown[]) => {
      const id = vraiSetTimeout(fn, ms, ...args);
      if (ms === 200) programmes.push(id);
      return id;
    }) as typeof setTimeout);
    vi.spyOn(globalThis, "clearTimeout").mockImplementation(((id?: Parameters<typeof clearTimeout>[0]) => {
      annules.add(id);
      return vraiClearTimeout(id);
    }) as typeof clearTimeout);

    localStorage.setItem("app.lang", "fr");
    const { unmount } = render(<I18nProvider><HelpCenter /></I18nProvider>);
    act(() => {});
    expect(programmes.length, "le minuteur de fermeture n'a pas ete programme — le test ne mesure plus rien").toBeGreaterThan(0);
    unmount();
    const survivants = programmes.filter((id) => !annules.has(id));
    expect(survivants, "un minuteur de 200 ms survit au demontage").toEqual([]);
  });
});
