import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    setupFiles: ["./src/test/setup.ts"],
    // Testes de integração compartilham o PostgreSQL: roda os arquivos em sequência.
    fileParallelism: false
  }
});
