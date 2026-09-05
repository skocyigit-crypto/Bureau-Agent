import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const specDir = resolve(here, "..");
const root = resolve(specDir, "..", "..");
const routesDir = join(root, "artifacts", "api-server", "src", "routes");
const outputPath = join(specDir, "runtime-routes.generated.json");
const methods = ["get", "post", "put", "patch", "delete"];

function normalizePath(path) {
  return path
    .replace(/\/+/g, "/")
    .replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, "{$1}")
    .replace(/\/$/, "") || "/";
}

function collectRuntimeRoutes() {
  const operations = [];
  const indexSource = readFileSync(join(routesDir, "index.ts"), "utf8");
  const importByVariable = new Map();
  // `import X from "./y"` ET `import X, { Z } from "./y"`.
  //
  // La seconde forme manquait, et le defaut ne se voyait pas: sans
  // correspondance variable -> fichier, le prefixe de montage etait
  // simplement absent, et les routes du fichier concerne apparaissaient a la
  // racine. `routes/google-oauth.ts` est importe avec un export nomme a cote
  // (`import googleOAuthRouter, { googleOAuthCallbackRouter } from ...`), si
  // bien que ses routes etaient inventoriees comme `/auth-url`, `/config`,
  // `/disconnect` au lieu de `/google-oauth/...`.
  //
  // Un inventaire qui nomme mal une route n'est pas un inventaire incomplet:
  // il affirme l'existence d'une adresse qui n'existe pas, et tait celle qui
  // existe. La porte de CI le comparait a la realite sans jamais s'en
  // apercevoir, puisqu'elle se comparait a elle-meme.
  for (const match of indexSource.matchAll(/import\s+([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?\s*from\s+["']\.\/([^"']+)["']/g)) {
    importByVariable.set(match[1], `${match[2]}.ts`);
  }
  const mountPrefixByFile = new Map();
  for (const match of indexSource.matchAll(/router\.use\(\s*["']([^"']+)["']\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g)) {
    const file = importByVariable.get(match[2]);
    if (file) mountPrefixByFile.set(file, match[1]);
  }
  const pattern = new RegExp(
    String.raw`\brouter\.(${methods.join("|")})\s*\(\s*(["'\x60])([^"'\x60]+)\2`,
    "g",
  );

  for (const name of readdirSync(routesDir).filter((entry) => entry.endsWith(".ts")).sort()) {
    const path = join(routesDir, name);
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(pattern)) {
      const rawPath = match[3];
      // Template-string paths with interpolation cannot be represented
      // statically; all normal Express declarations are still captured.
      if (!rawPath.startsWith("/") || rawPath.includes("${")) continue;
      operations.push({
        method: match[1],
        path: normalizePath(`${mountPrefixByFile.get(name) ?? ""}${rawPath}`),
        source: relative(root, path).replaceAll("\\", "/"),
      });
    }
  }

  return operations.sort((a, b) =>
    a.path.localeCompare(b.path) || a.method.localeCompare(b.method) || a.source.localeCompare(b.source),
  );
}

function collectDocumentedRoutes() {
  const source = readFileSync(join(specDir, "openapi.yaml"), "utf8");
  const documented = new Set();
  let currentPath = null;
  for (const line of source.split(/\r?\n/)) {
    const pathMatch = /^  (\/[^:]+):\s*$/.exec(line);
    if (pathMatch) {
      currentPath = normalizePath(pathMatch[1]);
      continue;
    }
    const methodMatch = /^    (get|post|put|patch|delete):\s*$/.exec(line);
    if (currentPath && methodMatch) documented.add(`${methodMatch[1]} ${currentPath}`);
  }
  return documented;
}

const runtime = collectRuntimeRoutes();
const documented = collectDocumentedRoutes();
const unique = new Map();
for (const operation of runtime) {
  const key = `${operation.method} ${operation.path}`;
  const previous = unique.get(key);
  if (previous) {
    previous.sources.push(operation.source);
  } else {
    unique.set(key, {
      method: operation.method,
      path: operation.path,
      documented: documented.has(key),
      sources: [operation.source],
    });
  }
}

const operations = [...unique.values()];
const report = {
  generatedFrom: "artifacts/api-server/src/routes/*.ts",
  summary: {
    runtimeOperations: operations.length,
    documentedOperations: operations.filter((item) => item.documented).length,
    undocumentedOperations: operations.filter((item) => !item.documented).length,
  },
  operations,
};
const rendered = `${JSON.stringify(report, null, 2)}\n`;

if (process.argv.includes("--check")) {
  let existing = "";
  try {
    existing = readFileSync(outputPath, "utf8");
  } catch {
    // Report is missing; fail with the same remediation as a stale report.
  }
  // Comparaison sur le CONTENU, pas sur les octets: sous Windows, git rend le
  // fichier avec des fins de ligne CRLF alors que ce script ecrit du LF. La
  // porte declarait alors « inventaire perime » a chaque execution locale,
  // et `routes:write` ne produisait aucune difference — un developpeur ne
  // pouvait donc ni la satisfaire ni comprendre pourquoi. En CI (Linux) elle
  // passait, ce qui rendait le defaut invisible la ou on regarde.
  const normalize = (text) => text.split("\r\n").join("\n");
  if (normalize(existing) !== normalize(rendered)) {
    console.error("Runtime route inventory is stale. Run: pnpm --filter @workspace/api-spec routes:write");
    process.exit(1);
  }
  console.log(
    `Route inventory OK: ${report.summary.runtimeOperations} runtime, ` +
      `${report.summary.documentedOperations} documented.`,
  );
} else {
  writeFileSync(outputPath, rendered);
  console.log(`Wrote ${outputPath}`);
}
