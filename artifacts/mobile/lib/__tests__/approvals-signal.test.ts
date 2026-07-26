/**
 * Bus interne du badge "File d'approbation".
 *
 * Ce qu'il protege: le compteur reste l'etat serveur (il ne baisse que quand
 * une proposition est reellement tranchee), mais il doit revalider tout de
 * suite quand l'agent en depose une — sinon l'utilisateur ouvre l'app apres
 * une notification push et voit un badge a zero pendant une minute.
 *
 * Trois pieges figes ici: le desabonnement doit vraiment couper (un ecran
 * demonte qui continue a sonder rallume une instance Cloud Run facturee), un
 * abonne qui jette ne doit pas priver les autres du signal, et se desabonner
 * pendant l'emission ne doit pas interrompre la diffusion en cours.
 */
import { describe, expect, it, vi } from "vitest";

import { notifyApprovalsChanged, onApprovalsChanged } from "../approvals-signal";

describe("approvals-signal", () => {
  it("previent les abonnes", () => {
    const listener = vi.fn();
    const off = onApprovalsChanged(listener);

    notifyApprovalsChanged();

    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });

  it("ne previent plus apres desabonnement", () => {
    const listener = vi.fn();
    const off = onApprovalsChanged(listener);
    off();

    notifyApprovalsChanged();

    expect(listener).not.toHaveBeenCalled();
  });

  it("isole un abonne defaillant", () => {
    const boom = vi.fn(() => { throw new Error("écran démonté"); });
    const sain = vi.fn();
    const offBoom = onApprovalsChanged(boom);
    const offSain = onApprovalsChanged(sain);

    expect(() => notifyApprovalsChanged()).not.toThrow();
    expect(sain).toHaveBeenCalledTimes(1);

    offBoom();
    offSain();
  });

  it("supporte un desabonnement pendant l'emission", () => {
    const second = vi.fn();
    let offSecond = () => {};
    const first = vi.fn(() => { offSecond(); });
    const offFirst = onApprovalsChanged(first);
    offSecond = onApprovalsChanged(second);

    notifyApprovalsChanged();

    // La copie de la liste avant parcours garantit que le second abonne recoit
    // quand meme CE signal-la; il ne recevra simplement plus les suivants.
    expect(second).toHaveBeenCalledTimes(1);

    notifyApprovalsChanged();
    expect(second).toHaveBeenCalledTimes(1);

    offFirst();
  });
});
