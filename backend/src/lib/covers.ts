import { createHash } from "node:crypto";
import { mkdirSync, unlinkSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { AppError } from "./errors.js";

export const MAX_COVER_BYTES = 10 * 1024 * 1024; // 10 MB

export type CoverKind = "png" | "jpeg" | "webp" | "pdf";

const KIND_MIME: Record<CoverKind, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  pdf: "application/pdf",
};

export function coverMimeToKind(mime: string | null | undefined): "image" | "pdf" | null {
  if (!mime) return null;
  if (mime === KIND_MIME.pdf) return "pdf";
  if (Object.values(KIND_MIME).includes(mime)) return "image";
  return null;
}

export function coverKindMime(kind: CoverKind): string {
  return KIND_MIME[kind];
}

/**
 * Detecta o tipo REAL pelo magic bytes — extensão e content-type declarado não são confiáveis.
 */
export function detectCoverKind(buffer: Buffer): CoverKind | null {
  if (buffer.length < 8) return null;
  if (buffer.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return "png"; // %PNG
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  if (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "webp";
  if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") return "pdf";
  return null;
}

/** Diretório de uploads resolvido a partir do pacote (funciona em src/ e dist/). */
export function coversDir(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url)); // src/lib ou dist/lib
  const root = join(moduleDir, "..", "..");
  return join(root, "uploads", "covers");
}

/**
 * Salva a capa com NOME GERADO PELO SERVIDOR (nunca usa o nome do arquivo enviado —
 * elimina path traversal). Retorna o nome do arquivo e o mime validado.
 */
export function saveCover(
  productId: string,
  buffer: Buffer,
  previousFile: string | null,
): { file: string; mime: string } {
  if (buffer.length === 0) throw new AppError("COVER_EMPTY", 400);
  if (buffer.length > MAX_COVER_BYTES) throw new AppError("COVER_TOO_LARGE", 413);
  const kind = detectCoverKind(buffer);
  if (!kind) throw new AppError("COVER_INVALID_TYPE", 415);
  const dir = coversDir();
  mkdirSync(dir, { recursive: true });
  const file = `${productId}-${createHash("sha256").update(buffer).digest("hex").slice(0, 12)}.${kind}`;
  const target = join(dir, basename(file)); // basename: defesa extra contra qualquer fuga de diretório
  // Remove a capa anterior (arquivo diferente) para não acumular órfãos
  if (previousFile) {
    const previousPath = join(dir, basename(previousFile));
    if (previousPath !== target && existsSync(previousPath)) unlinkSync(previousPath);
  }
  writeFileSync(target, buffer);
  return { file, mime: KIND_MIME[kind] };
}

export function deleteCoverFile(file: string | null | undefined): void {
  if (!file) return;
  const target = join(coversDir(), basename(file));
  if (existsSync(target)) unlinkSync(target);
}

export function coverFilePath(file: string): string | null {
  const target = join(coversDir(), basename(file));
  return existsSync(target) ? target : null;
}

/** Garante que o mime servido está na whitelist (defesa em profundidade). */
export function isAllowedCoverMime(mime: string): boolean {
  return Object.values(KIND_MIME).includes(mime);
}

export const coverUploadLimits = { fileSize: MAX_COVER_BYTES };
