import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

/**
 * Analyse statique du depot.
 *
 * Pourquoi il n'y en avait pas, et pourquoi ce reglage-la. 260 000 lignes de
 * TypeScript sans linter: le premier passage en configuration "recommandee"
 * a rendu 28 650 signalements — un chiffre qui ne se corrige pas, donc une
 * barriere que personne n'aurait activee. En regardant d'ou ils venaient:
 *
 *  - 25 398 (89 %) venaient des deux bundles Expo de `static-build/`, du code
 *    genere et minifie qui n'est meme pas suivi par git;
 *  - 2 270 de `no-explicit-any`, qui n'est pas une classe de bugs mais un choix
 *    de rigueur de typage — un chantier a part entiere, pas un correctif;
 *  - 253 de `no-undef`, que TypeScript verifie deja mieux, et que l'equipe
 *    typescript-eslint recommande explicitement de desactiver sur du TS.
 *
 * Reste 602 signalements reels dans 211 fichiers, dont 10 seulement sont
 * auto-corrigeables. Les corriger a l'aveugle — en particulier retirer des
 * variables "inutilisees" — serait un risque plus grand que le defaut.
 *
 * D'ou ce reglage en cliquet: ces regles-la restent en AVERTISSEMENT, et la CI
 * fige leur nombre (`--max-warnings`). Le stock existant ne bloque personne,
 * mais il ne peut plus grandir; toute autre regle, elle, est une erreur des
 * aujourd'hui. La barriere protege donc immediatement contre les regressions,
 * et le stock ne peut que descendre.
 */
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      // Sorties de build, pas du code source.
      "**/static-build/**",
      "**/.expo/**",
      "artifacts/mobile/android/**",
      "artifacts/mobile/ios/**",
      "test-results/**",
      "playwright-report/**",
      // Code genere (codegen depuis la spec d'API) et dependance vendue.
      "**/generated/**",
      "**/vendor/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // TypeScript fait ce controle, et mieux: il connait les globals de chaque
      // cible (DOM, Node, React Native) sans qu'on les redeclare ici.
      "no-undef": "off",
      // Chantier de typage a part entiere: 2 270 occurrences. L'activer
      // aujourd'hui reviendrait a desactiver le linter entier demain.
      "@typescript-eslint/no-explicit-any": "off",

      // ── Le stock fige (voir l'en-tete) ─────────────────────────────────────
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      "@typescript-eslint/no-unsafe-function-type": "warn",
      "@typescript-eslint/ban-ts-comment": "warn",
      "no-empty": "warn",
      "no-empty-pattern": "warn",
      "no-useless-escape": "warn",
      "no-useless-assignment": "warn",
      "no-control-regex": "warn",
      "no-regex-spaces": "warn",
      "no-irregular-whitespace": "warn",
      "no-case-declarations": "warn",
      "prefer-const": "warn",
      "preserve-caught-error": "warn",
    },
  },
  {
    // Les regles des hooks React. Elles ne sont pas ajoutees ici par gout:
    // le code portait deja 30 commentaires `eslint-disable-next-line
    // react-hooks/exhaustive-deps`, laisses par un outillage disparu. Sans le
    // plugin, ESLint refusait ces lignes ("rule not found") et, surtout, la
    // regle que ces commentaires supposaient active ne surveillait plus rien.
    files: ["artifacts/buro-ajani/**/*.{ts,tsx}", "artifacts/mobile/**/*.{ts,tsx}", "artifacts/tanitim/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
);
