import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const rawPort = process.env.PORT;
const port = rawPort ? Number(rawPort) : 3000;
const basePath = process.env.BASE_PATH || "/";

// Security headers Vite plugin. Mirrors the helmet config used by
// artifacts/api-server (HSTS preload-eligible, COOP/CORP same-origin,
// XFO DENY, full Permissions-Policy deny-list, no-sniff, strict-origin
// referrer). CSP is intentionally NOT set here because Vite dev needs
// inline scripts + eval for HMR; CSP belongs on the production reverse
// proxy (Caddy/nginx) where it is wired up in deploy/.
// Liste alignee sur les noms reconnus par Chromium courant. Les directives
// `ambient-light-sensor`, `battery`, `document-domain`,
// `execution-while-not-rendered`, `execution-while-out-of-viewport`,
// `navigation-override` et `web-share` ont ete retirees: elles produisaient
// des warnings "Unrecognized feature" en console sans renforcer la politique
// (un nom inconnu est ignore par le navigateur).
const PERMISSIONS_POLICY = [
  "accelerometer=()", "autoplay=()", "camera=()", "cross-origin-isolated=()",
  "display-capture=()", "encrypted-media=()", "fullscreen=()", "geolocation=()",
  "gyroscope=()", "hid=()", "identity-credentials-get=()", "idle-detection=()",
  "interest-cohort=()", "keyboard-map=()", "magnetometer=()", "microphone=()",
  "midi=()", "payment=()", "picture-in-picture=()",
  "publickey-credentials-get=()", "screen-wake-lock=()", "serial=()",
  "sync-xhr=()", "usb=()", "xr-spatial-tracking=()",
].join(", ");

// IMPORTANT: en developpement Replit, l'apercu de l'app est rendu DANS
// un iframe cross-origin servi par `*.spock.replit.dev` (Canvas + preview
// pane). X-Frame-Options: DENY bloque tout iframe -> ecran blanc dans
// l'apercu. La parade: ne jamais emettre XFO en dev, et utiliser CSP
// `frame-ancestors` whitelistant les domaines Replit. En production
// (Caddy/nginx), XFO DENY + frame-ancestors 'none' restent appliques par
// le reverse proxy de deploiement (voir deploy/Caddyfile).
const IS_DEV_REPLIT = process.env.NODE_ENV !== "production" || process.env.REPL_ID !== undefined;
const FRAME_ANCESTORS_DEV = "'self' https://*.replit.dev https://*.repl.co https://replit.com https://*.spock.replit.dev";

function applySecurityHeaders(res: { setHeader(k: string, v: string): void }) {
  res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  if (IS_DEV_REPLIT) {
    res.setHeader("Content-Security-Policy", `frame-ancestors ${FRAME_ANCESTORS_DEV}`);
  } else {
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
  }
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", IS_DEV_REPLIT ? "cross-origin" : "same-origin");
  res.setHeader("Permissions-Policy", PERMISSIONS_POLICY);
}

const securityHeadersPlugin: PluginOption = {
  name: "security-headers",
  configureServer(server) {
    server.middlewares.use((_req, res, next) => { applySecurityHeaders(res); next(); });
  },
  configurePreviewServer(server) {
    server.middlewares.use((_req, res, next) => { applySecurityHeaders(res); next(); });
  },
};

export default defineConfig({
  base: basePath,
  plugins: [
    securityHeadersPlugin,
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Vendor chunks separes: les libs animations/icones changent
        // beaucoup moins souvent que le code applicatif, donc isoler
        // permet aux navigateurs de garder le hash en cache long-terme
        // entre deux deploiements ou seul le code applicatif bouge.
        // Limites pratiques aussi la taille du chunk principal.
        manualChunks: {
          "vendor-framer": ["framer-motion"],
          "vendor-icons": ["lucide-react"],
          "vendor-react": ["react", "react-dom", "wouter"],
        },
      },
    },
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
