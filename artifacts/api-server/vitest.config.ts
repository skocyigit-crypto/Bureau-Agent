import { defineConfig } from "vitest/config";

/**
 * Base de donnees locale par defaut pour les tests.
 *
 * 19 fichiers de tests touchent la base et echouaient tous des l'import, sur
 * un « DATABASE_URL must be set » — pas une regression, juste une variable
 * absente. Une suite qui s'ouvre sur 19 fichiers rouges par defaut n'apprend
 * rien a personne: on cesse de la lire, et le jour ou un vrai test casse
 * (isolation des locataires, controle d'acces) il passe avec les autres.
 *
 * D'ou ce defaut, qui vise une base DEDIEE et jetable, jamais une base de
 * travail: ces tests vident des tables.
 *
 * Il ne peut pas masquer une erreur de configuration:
 *   - en CI, DATABASE_URL est fourni par le pipeline, donc ce defaut ne
 *     s'applique jamais;
 *   - si CI est defini SANS DATABASE_URL, on laisse volontairement la
 *     variable vide pour obtenir l'erreur explicite d'origine plutot qu'un
 *     refus de connexion obscur;
 *   - en local sans Postgres, la connexion echoue — donc rouge, jamais vert
 *     par accident.
 *
 * POUR CREER CETTE BASE: `pnpm --filter @workspace/db setup-test-db`
 */
const LOCAL_TEST_DB = "postgres://postgres@127.0.0.1:5432/bureau_agent_test";
const env: Record<string, string> = {};
if (!process.env.DATABASE_URL && !process.env.CI) {
  env.DATABASE_URL = LOCAL_TEST_DB;
}

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
    env,
  },
});
