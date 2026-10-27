import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AppError } from "./errors.js";

export const MAX_CATALOG_PDF_BYTES = 50 * 1024 * 1024; // 50 MB

function catalogDir(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url)); // src/lib ou dist/lib
  return join(moduleDir, "..", "..", "uploads", "catalog");
}

function catalogPath(): string {
  return join(catalogDir(), "catalogo.pdf");
}

export function saveCatalogPdf(buffer: Buffer): void {
  if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") throw new AppError("CATALOG_INVALID_TYPE", 415);
  if (buffer.length > MAX_CATALOG_PDF_BYTES) throw new AppError("CATALOG_TOO_LARGE", 413);
  mkdirSync(catalogDir(), { recursive: true });
  writeFileSync(catalogPath(), buffer);
}

export function removeCatalogPdf(): void {
  const path = catalogPath();
  if (existsSync(path)) unlinkSync(path);
}

export function catalogPdfPath(): string | null {
  const path = catalogPath();
  return existsSync(path) ? path : null;
}

export function catalogPdfMime(): string {
  return "application/pdf";
}
