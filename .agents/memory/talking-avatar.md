---
name: Talking AI avatar (on-device, FR+TR)
description: Cross-platform animated talking avatar with lip-sync; web/mobile split and the privacy constraint that governs TTS voice selection.
---

# Talking AI avatar

A free, on-device animated avatar with viseme lip-sync that appears in the web
app, the marketing site, and the mobile app, speaking French and Turkish.

## Web vs mobile split (do not merge them)
- Shared lib `@workspace/ai-avatar` is **DOM-only** (SVG + Web Speech API). It is
  consumed by the Vite web apps only.
- The Expo app must **not** import that lib (its types pull in DOM). Instead the
  pure viseme core is **duplicated** into the mobile app and the face is
  re-implemented with `react-native-svg` + `expo-speech`.
- **Why:** importing a DOM-typed lib into the Expo typecheck breaks it; the
  viseme core is tiny and pure, so duplication is the lower-risk seam.
- **How to apply:** when changing lip-sync mapping, update BOTH the lib core and
  the mobile copy in lockstep, or the two platforms drift.

## Privacy constraint: on-device voices only (fail closed)
- TTS must use only **local** voices (`SpeechSynthesisVoice.localService === true`
  on web). Cloud-backed voices send the text to a remote server, violating the
  "no data leaves device" guarantee. Default is `requireLocal: true`.
- When no local voice exists for the requested language, **do not speak**
  (mouth stays at rest) rather than falling back to a remote voice.
- **Why:** the feature was explicitly specced as "no data leaves the device";
  the browser's default voice pick can silently be a remote one.
- **How to apply:** never relax the local-voice filter to "fix" silent speech on
  a machine without local FR/TR voices — the fix is to surface that no local
  voice is installed, not to send text to the cloud. Native `expo-speech` uses
  the OS engine (on-device) so it is acceptable as-is.

## Lip-sync timing
- Web prefers Web Speech `onboundary` events, with a ~90ms timer fallback for
  browsers without boundary support.
- Mobile (expo-speech gives no boundary events) drives visemes purely on a steady
  timer (~85ms) while speaking and stops on `onDone`/`onStopped`/`onError`.

## Reusable AvatarDock (controls wrapper around TalkingAvatar)
- `AvatarDock` wraps `TalkingAvatar` with FR/TR toggle, mute, replay/stop, a
  "no local voice on this device" hint, and persisted voice prefs. Web copy:
  `lib/ai-avatar/src/AvatarDock.tsx` (localStorage). Mobile copy:
  `artifacts/mobile/components/AvatarDock.tsx` (AsyncStorage). Same web/mobile
  duplication rule as the avatar core applies.
- `autoSpeak` prop (default true): true = chat screens (each new assistant
  reply is spoken as it arrives). false = summary/briefing screens — nothing
  speaks on load; the user replays on demand. Use false anywhere a screen would
  otherwise auto-speak a long block on entry (annoying UX).
- **How to apply:** give each host a unique `storageKey` so voice prefs don't
  collide; feed the dock the latest assistant/summary text, not the whole thread.

## AvatarFace renders TINY in production — never size-gate core detail
- Every real usage of `AvatarFace`/`TalkingAvatar` is **44–56px** (floating button,
  dock, demo). A size-based LOD gate (e.g. "only show cheeks/lashes/headset when
  size ≥ 92") therefore hides the richness in 100% of real renders.
- **Why:** the avatar was once size-gated and looked "too simple" everywhere because
  no caller ever hit the threshold.
- **How to apply:** keep facial detail ungated. Only reserve the few sub-pixel-fiddly
  bits (the mic boom) behind a low threshold (`size >= 72`). Verify at ~44px, not at
  the 220px default, before declaring it done.

## AvatarPalette is a public exported type — extend it additively only
- `AvatarPalette` is exported from `@workspace/ai-avatar`. Any field you add to it
  must be **optional** (`?`), with the concrete value living in `DEFAULT_PALETTE`
  (typed `Required<AvatarPalette>`) and merged in at render.
- **Why:** making new fields required is a breaking API change — external callers
  that typed a `palette` object before the field existed fail typecheck.
- **How to apply:** new look-and-feel knobs → optional prop + default. Same rule for
  any new `AvatarFace`/`TalkingAvatar` prop (keep them optional / pass-through).

## The `gaze` prop must gate EVERY motion source
- Disabling gaze means three things must stop, not one: the `mousemove` listener,
  the idle-saccade `setInterval`, AND the rAF loop's gaze→pupil/head contribution.
- **Why:** gating only the cursor listener still leaves saccades mutating the target
  and the rAF easing pupils/head — eyes keep wandering when the caller asked for a
  still face.
- **How to apply:** when `gaze` is false, collapse the gaze target to centre inside
  the rAF tick (so pupils recentre then stay static) and early-return the saccade
  effect; include `gaze` in both effects' dep arrays.

## voice-assistant screen is intentionally EXCLUDED from AvatarDock
- The mobile `voice-assistant` screen already drives `expo-speech` directly with
  its own full-screen wave UI. Adding an AvatarDock there would double-speak the
  same text (two TTS engines firing at once).
- **Why:** AvatarDock auto-speaks `text`; the screen already speaks it.
- **How to apply:** do NOT add AvatarDock to voice-assistant. If a single
  speaking head is ever wanted there, first remove the screen's own
  `Speech.speak` calls so only one TTS source remains.
