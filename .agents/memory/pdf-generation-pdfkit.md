---
name: PDF generation with pdfkit (one-off guides)
description: How to generate styled PDFs from a Node script in this monorepo without crashes or brittle paths.
---

# Generating PDFs with pdfkit

When producing a PDF from a standalone Node script (e.g. a user guide), two
non-obvious traps cause failures:

## 1. Footer/header via `pageAdded` handler → stack overflow
Drawing text inside a `doc.on("pageAdded", ...)` handler recurses when a long
`doc.text()` auto-paginates: the handler's own `text()` triggers another page
flush mid-flow → `RangeError: Maximum call stack size exceeded` in
`PDFObject.convert`.

**Rule:** open the doc with `bufferPages: true`, render ALL content first, then
loop `doc.bufferedPageRange()` with `doc.switchToPage(i)` to stamp footers, then
`doc.flushPages()` before `doc.end()`. Never draw page chrome from `pageAdded`.

## 2. Resolving a non-hoisted dependency
`pdfkit` lives only under the owning package (it's a dep of
`@workspace/api-server`), not the repo-root `node_modules`. A bare
`require("pdfkit")` from a root/scripts file fails, and hardcoding the
`.pnpm/pdfkit@<version>/...` store path breaks on any version bump.

**Rule:** anchor resolution to the owning package:
`createRequire(join(ROOT, "artifacts/api-server/package.json"))` then
`require("pdfkit")`. Version-agnostic, survives lockfile changes.

**Why:** both bit during the French Google-Workspace guide generation; the fixes
are the reliable patterns to reuse for any future programmatic PDF.

## Language/fonts
pdfkit's built-in Helvetica uses WinAnsi encoding: French accents (é è à ç ô ù î)
render fine, but Turkish ş ğ ı İ do NOT — for Turkish output you must embed a TTF
with those glyphs (none are reliably installed here), so prefer French/Latin-1
content unless a TTF is bundled.
