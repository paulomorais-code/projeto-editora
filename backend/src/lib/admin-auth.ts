import type { FastifyReply, FastifyRequest } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";

const MAX_FAILURES = 5;
const BLOCK_MS = 15 * 60 * 1000;

interface AttemptEntry {
  count: number;
  firstAt: number;
  blockedUntil: number;
}

/** Registro em memória de falhas por IP: 5 erros em 15 min ⇒ bloqueio de 15 min (anti-força-bruta, F-02). */
const attempts = new Map<string, AttemptEntry>();

export function adminBlockedSeconds(ip: string): number {
  const entry = attempts.get(ip);
  if (!entry) return 0;
  const now = Date.now();
  if (entry.blockedUntil > now) return Math.ceil((entry.blockedUntil - now) / 1000);
  // Bloqueio expirado ou janela de contagem vencida: recomeça do zero.
  if (entry.blockedUntil !== 0 || now - entry.firstAt > BLOCK_MS) attempts.delete(ip);
  return 0;
}

export function registerAdminFailure(ip: string): void {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.blockedUntil > now || now - entry.firstAt > BLOCK_MS) {
    attempts.set(ip, { count: 1, firstAt: now, blockedUntil: 0 });
    return;
  }
  entry.count += 1;
  if (entry.count >= MAX_FAILURES) entry.blockedUntil = now + BLOCK_MS;
}

export function clearAdminFailures(ip: string): void {
  attempts.delete(ip);
}

export function resetAdminAttempts(): void {
  attempts.clear();
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const editorToken = env.EDITOR_API_TOKEN || env.ADMIN_API_TOKEN;
  if (!editorToken) return reply.code(503).send({ error: "EDITOR_NOT_CONFIGURED" });

  const blockedFor = adminBlockedSeconds(request.ip);
  if (blockedFor > 0) {
    request.log.warn(
      { event: "admin_blocked", retryAfterSeconds: blockedFor },
      "Admin attempts exhausted for IP",
    );
    return reply.code(429).header("retry-after", String(blockedFor)).send({ error: "TOO_MANY_ATTEMPTS" });
  }

  const supplied = request.headers["x-admin-token"];
  const expected = Buffer.from(editorToken);
  const actual = typeof supplied === "string" ? Buffer.from(supplied) : Buffer.alloc(0);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    registerAdminFailure(request.ip);
    request.log.warn({ event: "admin_auth_failed" }, "Invalid admin token");
    return reply.code(401).send({ error: "UNAUTHORIZED" });
  }
  clearAdminFailures(request.ip);
}
