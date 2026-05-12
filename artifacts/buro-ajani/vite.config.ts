import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const rawPort = process.env.PORT || "19542";
const port = Number(rawPort);

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

function applySecurityHeaders(res: { setHeader(k: string, v: string): void }) {
  res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
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
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
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
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
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
