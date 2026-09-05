/**
 * Sert le BUILD du site vitrine avec les en-tetes de production.
 *
 * Meme raison que `serve-app.mjs`: `vite preview` sert le build, mais nu —
 * aucun des en-tetes que Caddy pose en production. Le test ne pourrait alors
 * pas affirmer ce qu'on lui demande d'affirmer, a savoir qu'une politique de
 * securite du contenu n'empeche aucune page de s'afficher.
 *
 * Ici la CSP est bloquante en test ET en production (voir
 * csp.tanitim.policy.md): ce site est statique et toutes ses ressources sont
 * locales, donc ce que le test ouvre est ce que le visiteur ouvre.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, "..", "artifacts", "tanitim", "dist", "public");
const PORT = Number(process.env.PORT || 4321);
const CSP = fs.readFileSync(path.join(here, "..", "deploy", "csp.tanitim.policy"), "utf8").trim();

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff",
  ".webmanifest": "application/manifest+json", ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

if (!fs.existsSync(path.join(ROOT, "index.html"))) {
  console.error(`Build introuvable: ${ROOT}. Lancer d'abord le build de tanitim.`);
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
  .listen(PORT, "127.0.0.1", () => console.log(`vitrine servie sur ${PORT} (CSP bloquante)`));
