import { describe, expect, it } from "vitest";
import { detectCoverKind, coverMimeToKind, isAllowedCoverMime } from "./covers.js";

describe("detecção de capa por magic bytes", () => {
  it("reconhece PNG", () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(16),
    ]);
    expect(detectCoverKind(png)).toBe("png");
  });
  it("reconhece JPEG", () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
    expect(detectCoverKind(jpeg)).toBe("jpeg");
  });
  it("reconhece WebP", () => {
    const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]);
    expect(detectCoverKind(webp)).toBe("webp");
  });
  it("reconhece PDF", () => {
    expect(detectCoverKind(Buffer.from("%PDF-1.4\n..."))).toBe("pdf");
  });
  it("rejeita arquivo renomeado (texto com extensão .png)", () => {
    expect(detectCoverKind(Buffer.from("isto nao e um png"))).toBeNull();
  });
  it("rejeita buffer vazio/curto", () => {
    expect(detectCoverKind(Buffer.alloc(0))).toBeNull();
    expect(detectCoverKind(Buffer.from([0x89, 0x50]))).toBeNull();
  });
});

describe("mime da capa", () => {
  it("mapea mime para tipo de renderização", () => {
    expect(coverMimeToKind("image/png")).toBe("image");
    expect(coverMimeToKind("application/pdf")).toBe("pdf");
    expect(coverMimeToKind("text/html")).toBeNull();
    expect(coverMimeToKind(null)).toBeNull();
  });
  it("whitelist de mime bloqueia html/svg na rota de capa", () => {
    expect(isAllowedCoverMime("image/png")).toBe(true);
    expect(isAllowedCoverMime("text/html")).toBe(false);
    expect(isAllowedCoverMime("image/svg+xml")).toBe(false);
  });
});
