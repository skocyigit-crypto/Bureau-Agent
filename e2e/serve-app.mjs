/**
 * Sert le BUILD de l'application avec les en-tetes de production.
 *
 * `vite preview` sert bien le build, mais nu: aucun des en-tetes que Caddy pose
 * en production. Or c'est precisement ce que ces tests doivent pouvoir affirmer
 * — qu'une politique de securite du contenu n'empeche pas l'application de
 * s'afficher. Un serveur statique de vingt lignes rapproche donc le test de la
 * realite plus surement qu'un preview.
 *
 * La CSP est appliquee ici en mode BLOQUANT, alors qu'elle est encore
 * `Report-Only` en production (voir deploy/csp.policy.md): c'est voulu. En test
 * on veut que la moindre violation fasse echouer; en production on ne veut
 * casser aucune page tant que les parcours authentifies n'ont pas ete ouverts
 * un a un.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, "..", "artifacts", "buro-ajani", "dist", "public");
const PORT = Number(process.env.PORT || 4322);
const CSP = fs.readFileSync(path.join(here, "..", "deploy", "csp.policy"), "utf8").trim();

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff",
  ".webmanifest": "application/manifest+json", ".txt": "text/plain; charset=utf-8",
};

if (!fs.existsSync(path.join(ROOT, "index.html"))) {
  console.error(`Build introuvable: ${ROOT}. Lancer d'abord le build de buro-ajani.`);
  process.exit(1);
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://placeholder");
    let file = path.join(ROOT, decodeURIComponent(url.pathname));
    // Repli SPA: toute route inconnue rend index.html, comme Caddy (try_files).
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(ROOT, "index.html");
    }
    res.setHeader("Content-Security-Policy", CSP);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Type", TYPES[path.extname(file)] ?? "application/octet-stream");
    res.end(fs.readFileSync(file));
  })
  .listen(PORT, "127.0.0.1", () => console.log(`application servie sur ${PORT} (CSP bloquante)`));
