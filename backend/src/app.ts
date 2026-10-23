import Fastify, { type FastifyError } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import fastifyStatic from "@fastify/static";
import multipart from "@fastify/multipart";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./config/env.js";
import { AppError } from "./lib/errors.js";
import { coverUploadLimits } from "./lib/covers.js";
import { catalogRoutes } from "./modules/catalog/catalog.routes.js";
import { orderRoutes } from "./modules/orders/order.routes.js";
import { paymentRoutes } from "./modules/payments/payment.routes.js";
import { shippingRoutes } from "./modules/shipping/shipping.routes.js";
import { adminRoutes } from "./modules/admin/admin.routes.js";

/** Resolve o diretório do painel admin em dev (src/) e produção (dist/ com assets copiados). */
function resolveAdminRoot(): string {
  const moduleDir = fileURLToPath(new URL(".", import.meta.url));
  if (existsSync(join(moduleDir, "modules/admin/admin.html"))) return join(moduleDir, "modules/admin");
  return join(process.cwd(), "src/modules/admin");
}

export function buildApp() {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: ["req.headers.authorization", "req.headers.cookie", "*.email", "*.shippingAddress"],
    },
    // Atrás de proxy reverso usa X-Forwarded-For para IP real (rate limit e logs por cliente).
    trustProxy: env.TRUST_PROXY,
  });
  app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
      },
    },
    // HSTS só faz sentido atrás de TLS; em dev permanece desligado.
    hsts: env.NODE_ENV === "production" ? { maxAge: 31536000, includeSubDomains: true } : false,
  });
  app.register(sensible);
  app.register(rateLimit, { max: 100, timeWindow: "1 minute" });
  app.register(multipart, { limits: coverUploadLimits });
  // Em desenvolvimento aceita também a variante 127.0.0.1 do próprio host (mesma máquina).
  const corsOrigins =
    env.NODE_ENV === "production" ? env.FRONTEND_ORIGIN : [env.FRONTEND_ORIGIN, "http://127.0.0.1:5500"];
  app.register(cors, { origin: corsOrigins, methods: ["GET", "POST", "PATCH"] });
  app.register(fastifyStatic, { root: resolveAdminRoot(), prefix: "/admin/", index: false });
  app.get("/health", async () => ({ status: "ok" }));
  app.register(catalogRoutes, { prefix: "/api" });
  app.register(orderRoutes, { prefix: "/api" });
  app.register(paymentRoutes, { prefix: "/api" });
  app.register(shippingRoutes, { prefix: "/api" });
  app.register(adminRoutes, { prefix: "/api" });
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      request.log.warn({ event: "app_error", code: error.code }, "Handled application error");
      return reply.code(error.status).send({ error: error.code });
    }
    // Erros 4xx do framework (JSON inválido, rate limit) preservam o status sem vazar detalhes.
    const status = typeof error.statusCode === "number" ? error.statusCode : undefined;
    if (status !== undefined && status >= 400 && status < 500) {
      request.log.warn({ event: "request_error", status }, "Rejected request");
      return reply.code(status).send({ error: "REQUEST_ERROR" });
    }
    request.log.error({ err: error }, "Unhandled request error");
    return reply.code(500).send({ error: "INTERNAL_SERVER_ERROR" });
  });
  return app;
}
