import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma 7: a URL de conexão do CLI (migrate/studio) vive aqui, não mais no schema.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts"
  },
  datasource: {
    url: env("DATABASE_URL")
  }
});
