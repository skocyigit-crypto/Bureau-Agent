/**
 * Le trafic ne bascule que si la revision candidate a prouve qu'elle repond.
 * Le script reel est execute avec un faux `gcloud` et un faux `curl` qui
 * journalisent leurs appels : on lit ce qui a ete FAIT, pas ce qui est ecrit.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RACINE = join(import.meta.dirname, "..", "..", "..", "..");
const SCRIPT = join(RACINE, "deploy", "deploiement-canari.sh");
const CLOUDBUILD = readFileSync(join(RACINE, "deploy", "cloudbuild.yaml"), "utf8");

function banc(reponseSonde: string) {
  const d = mkdtempSync(join(tmpdir(), "canari-"));
  const journal = join(d, "journal.txt").split(String.fromCharCode(92)).join("/");
  const gcloud = join(d, "gcloud").split(String.fromCharCode(92)).join("/");
  const curl = join(d, "curl").split(String.fromCharCode(92)).join("/");
  writeFileSync(gcloud, `#!/usr/bin/env bash
echo "gcloud $*" >> "${journal}"
case "$*" in *"services describe"*) echo "https://agent-de-bureau-api-abc123-od.a.run.app";; esac
exit 0
`);
  writeFileSync(curl, `#!/usr/bin/env bash
echo "curl $*" >> "${journal}"
printf '%s' '${reponseSonde}'
`);
  chmodSync(gcloud, 0o755); chmodSync(curl, 0o755);
  const lancer = (...args: string[]) => {
    try {
      execFileSync("bash", [SCRIPT.split(String.fromCharCode(92)).join("/"), ...args], {
        env: { ...process.env, GCLOUD: gcloud, CURL: curl, CANARI_ESSAIS: "2", CANARI_PAUSE_S: "0" }, stdio: "pipe",
      });
      return 0;
    } catch (e: any) { return e.status as number; }
  };
  const lire = () => (existsSync(journal) ? readFileSync(journal, "utf8") : "");
  return { lancer, lire };
}
const ARGS_API = ["svc-api", "img:abc123", "europe-west9", "/api/healthz", '"build":"abc123"', '"db":"connected"', "--", "--session-affinity"];

describe("revision saine", () => {
  const { lancer, lire } = banc('{"status":"ok","db":"connected","build":"abc123"}');
  const code = lancer(...ARGS_API);
  const j = lire();
  it("sortie 0", () => expect(code).toBe(0));
  it("deploiement SANS trafic, etiquete, options transmises", () => {
    expect(j).toMatch(/gcloud run deploy svc-api --image=img:abc123 --region=europe-west9 --platform=managed --no-traffic --tag=candidat --session-affinity/);
  });
  it("sonde l'URL etiquetee du service", () => expect(j).toContain("https://candidat---agent-de-bureau-api-abc123-od.a.run.app/api/healthz"));
  it("bascule le trafic APRES la sonde", () => {
    expect(j).toContain("gcloud run services update-traffic svc-api --region=europe-west9 --to-latest");
    expect(j.indexOf("curl")).toBeLessThan(j.indexOf("update-traffic"));
  });
});

describe("revision qui ne prouve rien", () => {
  it("mauvais build : pas de bascule, sortie 1", () => {
    const { lancer, lire } = banc('{"status":"ok","db":"connected","build":"ANCIEN"}');
    expect(lancer(...ARGS_API)).toBe(1);
    expect(lire()).not.toContain("update-traffic");
  });
  it("base injoignable : pas de bascule", () => {
    const { lancer, lire } = banc('{"status":"degraded","db":"unreachable","build":"abc123"}');
    expect(lancer(...ARGS_API)).toBe(1);
    expect(lire()).not.toContain("update-traffic");
  });
  it("reponse vide : pas de bascule, et tous les essais sont faits", () => {
    const { lancer, lire } = banc("");
    expect(lancer(...ARGS_API)).toBe(1);
    expect(lire().match(/^curl /gm)?.length).toBe(2);
  });
  it("aucun critere de sonde : refus avant tout deploiement", () => {
    const { lancer, lire } = banc("ok");
    expect(lancer("svc", "img", "r", "/", "--")).toBe(2);
    expect(lire()).not.toContain("run deploy");
  });
});

describe("branchement dans le pipeline", () => {
  for (const [etape, service] of [["deploy-api", "_API_SERVICE"], ["deploy-web", "_WEB_SERVICE"], ["deploy-tanitim", "_TANITIM_SERVICE"]] as const) {
    it(`${etape} passe par le canari`, () => {
      const i = CLOUDBUILD.indexOf(`- id: ${etape}`);
      const bloc = CLOUDBUILD.slice(i, CLOUDBUILD.indexOf("waitFor:", i));
      expect(bloc).toContain("bash deploy/deploiement-canari.sh");
      expect(bloc).toContain(`'\${${service}}'`);
      expect(bloc).not.toMatch(/exec gcloud run deploy/);
    });
  }
  it("l'API exige le build attendu ET une base connectee", () => {
    const i = CLOUDBUILD.indexOf("- id: deploy-api");
    const bloc = CLOUDBUILD.slice(i, CLOUDBUILD.indexOf("waitFor:", i));
    expect(bloc).toContain(`'"build":"\${_TAG}"'`);
    expect(bloc).toContain(`'"db":"connected"'`);
  });
});
