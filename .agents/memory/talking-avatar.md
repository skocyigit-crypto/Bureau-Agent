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
