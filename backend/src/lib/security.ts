import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { env } from "../config/env.js";

export function hashForLookup(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

export function parseBearerToken(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

/**
 * Tokens de acesso a pedido (anti-IDOR, F-06).
 * HMAC stateless sobre o ID: sem coluna no banco, verificação em tempo constante.
 * O material da chave é ORDER_ACCESS_SECRET; na ausência dela, deriva de DATABASE_URL
 * (quem tem a URL do banco já tem o banco — o token não acrescenta superfície).
 */
function hmacKey(prefix: string): Buffer {
  const material = env.ORDER_ACCESS_SECRET ?? env.DATABASE_URL;
  return createHash("sha256").update(`${prefix}:${material}`).digest();
}

export function signOrderId(orderId: string): string {
  return createHmac("sha256", hmacKey("nascente-order-access")).update(orderId).digest("base64url");
}

export function verifyOrderToken(orderId: string, token: string): boolean {
  const expected = Buffer.from(signOrderId(orderId));
  const received = Buffer.from(token);
  return received.length === expected.length && timingSafeEqual(expected, received);
}

/**
 * Cotação de frete assinada (frete cobrado sem confiar no cliente).
 * Token = base64url(payload) + "." + HMAC — o payload viaja dentro do token, então o
 * pedido revalida CEP, peso, validade e opções sem tocar o provedor de novo.
 */
export interface ShippingQuoteOption {
  service: string;
  priceCents: number;
  deadlineDays?: number;
}

export interface ShippingQuotePayload {
  p: string;
  w: number;
  e: number;
  o: ShippingQuoteOption[];
}

export function signQuoteToken(payload: ShippingQuotePayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", hmacKey("nascente-shipping-quote")).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifyQuoteToken(token: string): ShippingQuotePayload | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = createHmac("sha256", hmacKey("nascente-shipping-quote")).update(body).digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as ShippingQuotePayload;
    if (
      typeof payload.p !== "string" ||
      typeof payload.w !== "number" ||
      typeof payload.e !== "number" ||
      !Array.isArray(payload.o)
    )
      return null;
    if (payload.e < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * E-mail do comprador criptografado em repouso (AES-256-GCM) — LGPD.
 * O hash continua existindo para busca; a versão criptografada permite contato
 * operacional (confirmação, rastreio) sem e-mail em texto puro no banco.
 */
function emailKey(): Buffer {
  const material = env.EMAIL_ENC_KEY ?? env.ORDER_ACCESS_SECRET ?? env.DATABASE_URL;
  return createHash("sha256").update(`nascente-email:${material}`).digest();
}

export function encryptEmail(email: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", emailKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(email.trim().toLowerCase(), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

export function decryptEmail(encrypted: string | null | undefined): string | null {
  if (!encrypted) return null;
  try {
    const data = Buffer.from(encrypted, "base64");
    const iv = data.subarray(0, 12);
    const tag = data.subarray(12, 28);
    const ciphertext = data.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", emailKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
