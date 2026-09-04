#!/usr/bin/env node
/**
 * Audit des dependances de production, avec une distinction que
 * `pnpm audit` ne fait pas: « des vulnerabilites ont ete trouvees » et
 * « l'audit n'a pas pu etre execute » sortent tous les deux en 1.
 *
 * Pourquoi ce script existe. Le 2026-09-04, la meme PR a echoue deux fois de
 * suite sur `ERR_SOCKET_TIMEOUT` en interrogeant registry.npmjs.org — aucune
 * vulnerabilite, juste un registre injoignable. Une barriere qui tombe pour
 * une raison sans rapport avec le code apprend une seule chose a l'equipe:
 * relancer jusqu'a ce que ce soit vert. A ce moment-la elle ne protege plus
 * rien, parce que plus personne ne lit ce qu'elle dit.
 *
 * Le compromis est donc explicite:
 *  - une vulnerabilite haute ou critique fait echouer le build, comme avant;
 *  - une panne reseau est reessayee, puis signalee tres visiblement et laisse
 *    passer. L'audit porte sur des avis publies, pas sur le diff en cours:
 *    ne pas pouvoir l'interroger ne rend pas cette modification dangereuse,
 *    et le prochain build le refera. Ce choix est ecrit ici pour qu'il reste
 *    un choix, et non un accident;
 *  - toute AUTRE erreur (sortie illisible, argument invalide) fait echouer:
 *    on ne laisse pas passer ce qu'on ne comprend pas.
 *
 * Usage: node scripts/security-audit.mjs
 */
import { spawnSync } from "node:child_process";

const ATTEMPTS = 3;
const BACKOFF_MS = [5_000, 20_000];

/**
 * Commande d'audit, injectable UNIQUEMENT pour rendre verifiables les trois
 * chemins de decision (propre / vulnerable / registre injoignable) sans
 * dependre de l'etat reel du registre au moment du test.
 */
const AUDIT_CMD = process.env.SECURITY_AUDIT_CMD;

/** Marqueurs d'un registre injoignable, pas d'un probleme de dependance. */
const NETWORK_MARKERS = [
  "ERR_SOCKET_TIMEOUT",
  "FetchError",
  "ENOTFOUND",
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "socket hang up",
  "network",
];

function runAudit() {
  const result = AUDIT_CMD
    ? spawnSync(AUDIT_CMD, { encoding: "utf8", shell: true })
    : spawnSync(
        "pnpm",
        ["audit", "--prod", "--audit-level", "high", "--json"],
        { encoding: "utf8", shell: process.platform === "win32" },
      );
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status,
  };
}

/**
 * Compte les avis haute/critique. On lit le JSON plutot que le code de
 * sortie: c'est lui qui distingue « zero vulnerabilite » d'« audit rate ».
 */
function severeCount(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  const v = parsed?.metadata?.vulnerabilities ?? {};
  return (v.high ?? 0) + (v.critical ?? 0);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

let lastOutput = "";
for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
  const { stdout, stderr, status } = runAudit();
  lastOutput = `${stdout}\n${stderr}`;

  const severe = severeCount(stdout);
  if (severe !== null) {
    if (severe === 0) {
      console.log("Audit: aucune vulnerabilite haute ou critique dans les dependances de production.");
      process.exit(0);
    }
    console.error(`Audit: ${severe} vulnerabilite(s) haute(s)/critique(s).\n`);
    console.error(stdout);
    process.exit(1);
  }

  const networkProblem = NETWORK_MARKERS.some((m) => lastOutput.includes(m));
  if (!networkProblem) {
    // Sortie illisible sans cause reseau identifiee: on ne devine pas.
    console.error("Audit: sortie illisible et sans panne reseau identifiee — echec.\n");
    console.error(lastOutput.slice(0, 4000));
    process.exit(status === 0 ? 1 : (status ?? 1));
  }

  if (attempt < ATTEMPTS) {
    const wait = AUDIT_CMD ? 10 : (BACKOFF_MS[attempt - 1] ?? BACKOFF_MS.at(-1));
    console.warn(`Audit: registre injoignable (tentative ${attempt}/${ATTEMPTS}), nouvelle tentative dans ${wait / 1000}s.`);
    sleep(wait);
  }
}

console.warn(
  "\n=============================================================\n" +
  "AUDIT NON EXECUTE: registry.npmjs.org injoignable apres " + ATTEMPTS + " tentatives.\n" +
  "Le build n'est PAS bloque — l'audit porte sur des avis publies, pas sur\n" +
  "cette modification, et le prochain build le refera. Si ce message revient\n" +
  "souvent, c'est le reseau de la CI qu'il faut regarder, pas les dependances.\n" +
  "=============================================================\n",
);
console.warn(lastOutput.slice(0, 2000));
process.exit(0);
