---
name: r3f WebGL in headless/no-GPU
description: Why a react-three-fiber <Canvas> must ship a non-WebGL fallback, and why the screenshot tool reports a false-positive WebGL error.
---

Any react-three-fiber `<Canvas>` (or raw THREE.WebGLRenderer) must degrade
gracefully when WebGL is unavailable, or it throws "Error creating WebGL
context" and the vite runtime-error overlay swallows the page.

**Why:** the Replit `screenshot` tool's headless browser has NO GPU, so it can
NEVER create a WebGL context. A WebGL error in the tanitim log / screenshot is
a FALSE POSITIVE — it works in real browsers. Do not "fix" the 3D code in
response to it; verify the fallback path instead.

**How to apply:** guard the Canvas with (a) a capability check
(`canvas.getContext('webgl'|'experimental-webgl')`) AND (b) a class error
boundary (`getDerivedStateFromError`) around `<Canvas>`, rendering a 2D
fallback on either signal. On tanitim the fallback reuses the same
`@workspace/ai-avatar` viseme engine via the 2D SVG `AvatarFace`, so lip-sync
+ TTS still work with zero WebGL.
