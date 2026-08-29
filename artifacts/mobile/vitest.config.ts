import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests deterministes de logique pure (sans React Native / Expo). On se limite
// au repertoire lib pour ne pas charger de code RN dans l'environnement node.
export default defineConfig({
  resolve: {
    alias: {
      // Meme alias que `paths` dans tsconfig.json. Sans lui, tout module
      // important un autre fichier par `@/...` echoue a la resolution: on
      // etait alors contraint de mocker jusqu'aux dependances pures qu'on
      // voulait justement exercer.
      // `fileURLToPath(import.meta.url)` puis `dirname`: passer un objet URL
      // ici declenche TS2345, le tsconfig mobile chargeant a la fois le `URL`
      // du DOM et celui de Node.
      "@": dirname(fileURLToPath(import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
