import { defineConfig } from "vitest/config";

// Tests deterministes de logique pure (sans React Native / Expo). On se limite
// au repertoire lib pour ne pas charger de code RN dans l'environnement node.
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
