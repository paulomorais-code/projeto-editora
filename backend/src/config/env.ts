import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// .env relativo ao pacote (funciona rodando de qualquer diretório — mesmo padrão do F-12).
dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), "../../.env") });
dotenv.config();
import dotenv from "dotenv";
import { z } from "zod";

// "" em variáveis opcionais deve contar como "não definida" (comum em .env versionados de exemplo).
const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;
const optionalSecret = (schema: z.ZodString) => z.preprocess(emptyToUndefined, schema.optional());

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3333),
  HOST: z.string().default("127.0.0.1"),
  DATABASE_URL: z.string().min(1),
  FRONTEND_ORIGIN: z.string().url().default("http://localhost:5500"),
  TRUST_PROXY: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  MERCADOPAGO_ACCESS_TOKEN: optionalSecret(z.string()),
  MERCADOPAGO_WEBHOOK_SECRET: optionalSecret(z.string()),
  EDITOR_API_TOKEN: optionalSecret(z.string().min(32)),
  ADMIN_API_TOKEN: optionalSecret(z.string().min(32)),
  ORDER_ACCESS_SECRET: optionalSecret(z.string().min(32)),
  ORDER_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(24),
  // LGPD: dias após os quais pedidos DELIVERED/CANCELLED têm PII removida. 0 = rotina desligada.
  RETENTION_DAYS: z.coerce.number().int().min(0).max(3650).default(0),
  EMAIL_ENC_KEY: optionalSecret(z.string().min(32)),
  CORREIOS_BASE_URL: optionalSecret(z.string().url()),
  CORREIOS_CLIENT_ID: optionalSecret(z.string()),
  CORREIOS_CLIENT_SECRET: optionalSecret(z.string()),
  CORREIOS_CONTRACT_NUMBER: optionalSecret(z.string()),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug"]).default("info"),
});

export const env = schema.parse(process.env);
