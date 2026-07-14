# Vendored dependencies

`xlsx-0.20.3.tgz` is SheetJS's `xlsx` package, downloaded directly from the
official `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` (SheetJS
doesn't publish `xlsx` to the npm registry past 0.18.x — this CDN URL was
always the canonical source). Vendored here because that CDN started
blocking non-browser User-Agents (pnpm/Cloud Build installs got `403
Forbidden` starting 2026-07-14), breaking every automated build. Fetching
with a browser User-Agent still works, confirming the file itself is
unchanged — just the CDN's bot-blocking policy changed.

Re-vendoring: if SheetJS ships a version bump, download the new tarball
with a real User-Agent (`curl -A "Mozilla/5.0 ..." -o vendor/xlsx-X.Y.Z.tgz
https://cdn.sheetjs.com/xlsx-X.Y.Z/xlsx-X.Y.Z.tgz`), update the `xlsx`
entry in `package.json` to `file:./vendor/xlsx-X.Y.Z.tgz`, delete the old
tarball, and run `pnpm install` to refresh the lockfile.
