import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { rm } from "node:fs/promises";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies
globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true });

  await esbuild({
    entryPoints: [path.resolve(artifactDir, "src/index.ts")],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    // Some packages may not be bundleable, so we externalize them, we can add more here as needed.
    // Some of the packages below may not be imported or installed, but we're adding them in case they are in the future.
    // Examples of unbundleable packages:
    // - uses native modules and loads them dynamically (e.g. sharp)
    // - use path traversal to read files (e.g. @google-cloud/secret-manager loads sibling .proto files)
    external: [
      "*.node",
      "sharp",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "bcrypt",
      "argon2",
      "fsevents",
      "re2",
      "farmhash",
      "xxhash-addon",
      "bufferutil",
      "utf-8-validate",
      "ssh2",
      "cpu-features",
      "dtrace-provider",
      "isolated-vm",
      "lightningcss",
      "pg-native",
      "oracledb",
      "mongodb-client-encryption",
      "nodemailer",
      "handlebars",
      "knex",
      "typeorm",
      "protobufjs",
      // Resolves its own table.sql relative to __dirname at runtime — bundling
      // rewrites that to the wrong location (dist/), breaking session-table
      // auto-creation with ENOENT.
      "connect-pg-simple",
      // Meme cause, consequence plus lourde: pdfkit lit les metriques de ses
      // polices standard (`data/Helvetica.afm`) relativement a __dirname. Une
      // fois empaquete, il les cherche dans `dist/data/`, ou personne ne les
      // copie — et TOUTE generation de PDF echoue en ENOENT.
      //
      // Invisible jusqu'ici parce que les suites de tests executent les
      // SOURCES, ou le fichier est a sa place: le defaut n'existait que dans
      // le serveur reellement livre. Mesure du 2026-09-11, en lancant le
      // binaire de production en local: `GET /factures-client/:id/pdf` rendait
      // 500 avec « ENOENT ... dist/data/Helvetica.afm ».
      //
      // fontkit suit pdfkit: c'est lui qui lit les polices incorporees.
      "pdfkit",
      "fontkit",
      "onnxruntime-node",
      "@tensorflow/*",
      "@prisma/client",
      "@mikro-orm/*",
      "@grpc/*",
      "@swc/*",
      "@aws-sdk/*",
      "@azure/*",
      "@opentelemetry/*",
      "@google-cloud/*",
      "@google/*",
      "googleapis",
      "firebase-admin",
      "@parcel/watcher",
      "@sentry/profiling-node",
      "@tree-sitter/*",
      "aws-sdk",
      "classic-level",
      "dd-trace",
      "ffi-napi",
      "grpc",
      "hiredis",
      "kerberos",
      "leveldown",
      "miniflare",
      "mysql2",
      "newrelic",
      "odbc",
      "piscina",
      "realm",
      "ref-napi",
      "rocksdb",
      "sass-embedded",
      "sequelize",
      "serialport",
      "snappy",
      "tinypool",
      "usb",
      "workerd",
      "wrangler",
      "zeromq",
      "zeromq-prebuilt",
      "playwright",
      "puppeteer",
      "puppeteer-core",
      "electron",
    ],
    sourcemap: "linked",
    plugins: [
      // pino relies on workers to handle logging, instead of externalizing it we use a plugin to handle it
      esbuildPluginPino({ transports: ["pino-pretty"] })
    ],
    // Make sure packages that are cjs only (e.g. express) but are bundled continue to work in our esm output file
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
    `,
    },
  });

  await verifierExternes(distDir);
}

/**
 * Verifie APRES coup que les paquets qui doivent rester hors du paquet y sont
 * restes.
 *
 * La liste `external` est une intention; ceci en est la mesure. Les deux ne
 * coincident pas toujours: il suffit qu'une entree soit retiree, renommee, ou
 * qu'une dependance transitive rentre par une autre porte, et le defaut ne se
 * voit NULLE PART — les suites de tests executent les sources, ou tout est a
 * sa place. Seul le binaire livre est casse.
 *
 * C'est exactement ce qui s'est produit avec pdfkit (2026-09-11): empaquete,
 * il cherchait `data/Helvetica.afm` a cote du bundle, et toute generation de
 * PDF rendait 500 en production pendant que la CI restait verte.
 *
 * Le controle est ici, et pas dans un test, parce que c'est ici que la
 * propriete existe: elle porte sur le FICHIER PRODUIT, pas sur le code source.
 */
async function verifierExternes(distDir) {
  const { readFile } = await import("node:fs/promises");
  const sortie = await readFile(path.join(distDir, "index.mjs"), "utf8");

  // Ceux dont l'absence casse silencieusement une fonction entiere du produit.
  // `fontkit` n'y figure pas: il n'est jamais importe par NOTRE code, c'est
  // pdfkit qui le charge. Le chercher dans la sortie reviendrait a exiger une
  // chose qui n'a aucune raison d'y etre — un controle qui echoue pour de
  // mauvaises raisons finit desactive.
  const obligatoires = ["pdfkit", "connect-pg-simple"];

  // Les trois formes possibles dans une sortie ESM: `import(...)` (chargement
  // differe, la forme utilisee pour pdfkit), `from "..."`, `require("...")`.
  const manquants = obligatoires.filter(
    (m) => !new RegExp(`(from\\s*|require\\(|import\\()\\s*["']${m}["']`).test(sortie),
  );

  if (manquants.length > 0) {
    throw new Error(
      `Ces paquets devaient rester externes et ont ete empaquetes: ${manquants.join(", ")}.\n` +
        "Ils lisent leurs propres fichiers relativement a __dirname; une fois empaquetes ils les\n" +
        "cherchent dans dist/ et echouent en ENOENT a l'execution — sans qu'aucun test ne le voie.",
    );
  }

  // Contre-epreuve: si pdfkit avait ete empaquete, ses metriques de polices
  // standard apparaitraient dans la sortie. Le premier controle dit « la porte
  // existe »; celui-ci dit « personne n'est passe par la fenetre ».
  if (/\.afm["'`]/.test(sortie)) {
    throw new Error(
      "La sortie contient des references a des fichiers .afm: pdfkit a ete empaquete malgre tout.",
    );
  }

  console.log(`[build] externes verifies: ${obligatoires.join(", ")}`);
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
