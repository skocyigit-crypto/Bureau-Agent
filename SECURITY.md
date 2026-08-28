# Security policy — dependency audit

The CI quality gate runs `pnpm run security:audit`
(`pnpm audit --prod --audit-level high`) on every push to `main`
(see [deploy/cloudbuild.yaml](deploy/cloudbuild.yaml), step `quality-gate`).
A build that trips this gate never reaches Cloud Run.

Version floors for known-vulnerable transitive packages live in
`pnpm.overrides` in [package.json](package.json). Prefer raising a floor there
over suppressing an advisory — suppression is the last resort, only for
advisories with **no patched version at all**.

## Suppressed advisories

Suppressions live in `pnpm.auditConfig.ignoreGhsas` in `package.json`. JSON
carries no comments, so each entry must be justified here. Re-check them
whenever the audit is touched; delete the entry as soon as a patch ships.

### `image-size` — GHSA-w3rx-r6r6-pgpr, GHSA-5p2g-fcmc-qvqq

- **Added**: 2026-08-28
- **Severity**: high (2 advisories), denial of service only — no code
  execution, no data disclosure.
- **What**: the ICNS parser (`w3rx`) and the JXL/HEIF parsers (`5p2g`) can be
  driven into an infinite loop by a crafted image.
- **Why suppressed**: there is **no fixed release**. The advisory reports
  `Patched versions: <0.0.0`, and `image-size@2.0.2` — the latest version
  published — is itself vulnerable. No override can resolve this; the gate
  would block every deployment indefinitely.
- **Reachability**:
  - `artifacts/api-server > pptxgenjs > image-size` — the only path that runs
    in production. Reached when pptxgenjs measures an image while generating a
    `.pptx`. Worst case is a hung request handler.
  - `artifacts/mobile > expo-camera > expo > @expo/cli > metro > image-size` —
    Expo build tooling. Not shipped to users.
- **Removal condition**: delete both GHSAs from `ignoreGhsas` as soon as
  `image-size` publishes a fixed release (watch
  <https://github.com/image-size/image-size/releases>), or when `pptxgenjs`
  drops the dependency. Then run `pnpm run security:audit` to confirm the gate
  passes without the suppression.
