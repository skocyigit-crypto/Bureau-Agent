// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";

// framer-motion drives whileInView via IntersectionObserver and runs real
// animations — neither is meaningful here, so collapse motion.* to plain DOM
// passthroughs and let AnimatePresence render children immediately.
vi.mock("framer-motion", async () => {
  const React = await import("react");
  const passthrough = (tag: string) =>
    React.forwardRef((props: Record<string, unknown>, ref: unknown) => {
      const {
        whileInView, initial, animate, exit, transition, viewport,
        whileHover, whileTap, variants, layout, layoutId, ...rest
      } = props as Record<string, unknown>;
      return React.createElement(tag, { ...rest, ref });
    });
  const motion = new Proxy({}, { get: (_t, tag: string) => passthrough(tag) });
  return {
    motion,
    AnimatePresence: ({ children }: { children: unknown }) => children,
  };
});

// The 3D/audio talking avatar is irrelevant to the focus assertion.
vi.mock("@workspace/ai-avatar", () => ({
  TalkingAvatar: () => null,
}));

import { AjanDemo } from "./AjanDemo";

describe("AjanDemo — keyboard accessibility", () => {
  beforeEach(() => {
    // jsdom's rAF is unreliable inside the test window; make the focus-return
    // callback fire deterministically so waitFor can observe it.
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      return setTimeout(() => cb(0), 0) as unknown as number;
    });
    // suggestions GET (on mount) + demo-chat POST (on send) both resolve here.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (typeof url === "string" && url.includes("/suggestions")) {
          return { ok: true, json: async () => ({ suggestions: [] }) } as Response;
        }
        return { ok: true, json: async () => ({ reply: "Bonjour !" }) } as Response;
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns focus to the question input after a message is sent", async () => {
    render(<AjanDemo />);

    const input = screen.getByLabelText(
      "Posez votre question à l'Ajant Bureau",
    ) as HTMLInputElement;

    // Move focus elsewhere first so a real focus-return is observable.
    input.blur();
    expect(document.activeElement).not.toBe(input);

    fireEvent.change(input, { target: { value: "Quels sont vos horaires ?" } });
    fireEvent.click(screen.getByLabelText("Envoyer la question"));

    // The assistant reply must arrive (proves the send completed)...
    await waitFor(() => expect(screen.getByText("Bonjour !")).toBeTruthy());
    // ...and keyboard focus must come back to the question input (the a11y
    // guarantee). Re-query because React may remount the node across renders.
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByLabelText("Posez votre question à l'Ajant Bureau"),
      ),
    );
  });
});
