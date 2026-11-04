import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, unlinkSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { AppError } from "./errors.js";

const execFileAsync = promisify(execFile);

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
  return join(moduleDir, "..", "..", "uploads", "covers");
}

function gravarImagem(
  productId: string,
  buffer: Buffer,
  previousFile: string | null,
  ext: string,
  mime: string,
): { file: string; mime: string } {
  const dir = coversDir();
  mkdirSync(dir, { recursive: true });
  const file = `${productId}-${createHash("sha256").update(buffer).digest("hex").slice(0, 12)}.${ext}`;
  const target = join(dir, basename(file)); // basename: defesa extra contra qualquer fuga de diretório
  // Remove a capa anterior (arquivo diferente) para não acumular órfãos
  if (previousFile) {
    const previousPath = join(dir, basename(previousFile));
    if (previousPath !== target && existsSync(previousPath)) unlinkSync(previousPath);
  }
  writeFileSync(target, buffer);
  return { file, mime };
}

/**
 * Converte a 1ª página de um PDF em JPEG (pdftoppm/poppler).
 * Assim a capa funciona como IMAGEM em todo o site (cards, detalhe) —
 * <embed> de PDF não renderiza de forma confiável nos navegadores.
 */
async function pdfParaJpeg(buffer: Buffer): Promise<Buffer> {
  const tmp = join(tmpdir(), `capa-${randomBytes(6).toString("hex")}`);
  writeFileSync(`${tmp}.pdf`, buffer);
  try {
    await execFileAsync("pdftoppm", [
      "-jpeg",
      "-jpegopt",
      "quality=88",
      "-r",
      "120",
      "-singlefile",
      `${tmp}.pdf`,
      tmp,
    ]);
    const jpgPath = `${tmp}.jpg`;
    if (!existsSync(jpgPath)) throw new Error("pdftoppm não gerou saída");
    return readFileSync(jpgPath);
  } catch (error) {
    // Detalhe técnico (ferramenta ausente/CSV corrompido) fica no servidor;
    // o editor recebe código estável e a orientação de enviar PNG/JPG.
    console.error("[covers] falha ao converter PDF:", error);
    throw new AppError("COVER_PDF_CONVERT_FAILED", 422);
  } finally {
    for (const sufixo of [".pdf", ".jpg"]) {
      const lixo = `${tmp}${sufixo}`;
      if (existsSync(lixo)) unlinkSync(lixo);
    }
  }
}

/**
 * Salva a capa com NOME GERADO PELO SERVIDOR (nunca usa o nome do arquivo enviado —
 * elimina path traversal). PDFs são convertidos em JPEG (1ª página) para renderizar
 * como imagem em todo o site.
 */
export async function saveCover(
  productId: string,
  buffer: Buffer,
  previousFile: string | null,
): Promise<{ file: string; mime: string }> {
  if (buffer.length === 0) throw new AppError("COVER_EMPTY", 400);
  if (buffer.length > MAX_COVER_BYTES) throw new AppError("COVER_TOO_LARGE", 413);
  const kind = detectCoverKind(buffer);
  if (!kind) throw new AppError("COVER_INVALID_TYPE", 415);

  if (kind === "pdf") {
    const jpg = await pdfParaJpeg(buffer);
    return gravarImagem(productId, jpg, previousFile, "jpg", KIND_MIME.jpeg);
  }
  return gravarImagem(productId, buffer, previousFile, kind, KIND_MIME[kind]);
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
