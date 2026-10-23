import { describe, expect, it } from "vitest";
import { encryptEmail, decryptEmail, signQuoteToken, verifyQuoteToken } from "./security.js";

describe("quote token (frete assinado)", () => {
  const payload = {
    p: "74000000",
    w: 280,
    e: Date.now() + 60_000,
    o: [{ service: "PAC", priceCents: 1970 }],
  };

  it("roundtrip válido preserva as opções", () => {
    const token = signQuoteToken(payload);
    const verified = verifyQuoteToken(token);
    expect(verified?.p).toBe("74000000");
    expect(verified?.o[0]?.priceCents).toBe(1970);
  });

  it("rejeita token adulterado ou malformado", () => {
    expect(verifyQuoteToken("abc.def")).toBeNull();
    const token = signQuoteToken(payload);
    expect(verifyQuoteToken(token.slice(0, -2) + "XX")).toBeNull();
  });

  it("rejeita cotação expirada", () => {
    const expired = signQuoteToken({ ...payload, e: Date.now() - 1000 });
    expect(verifyQuoteToken(expired)).toBeNull();
  });
});

describe("email criptografado (LGPD)", () => {
  it("roundtrip preserva o e-mail normalizado", () => {
    const enc = encryptEmail("  Comprador@Example.COM ");
    expect(enc).not.toContain("comprador");
    expect(decryptEmail(enc)).toBe("comprador@example.com");
  });

  it("retorna null para dado corrompido ou ausente", () => {
    expect(decryptEmail(null)).toBeNull();
    expect(decryptEmail("")).toBeNull();
    expect(decryptEmail("dados-invalidos")).toBeNull();
  });
});
