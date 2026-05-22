import { describe, expect, it } from "vitest";

import { decodeConfig, encodeConfig, type PortfolioConfig } from "./urlState";

describe("encodeConfig / decodeConfig — round-trip", () => {
  it("encodes then decodes back to the original config", () => {
    const cfg: PortfolioConfig = {
      v: 1,
      picks: [
        { t: "PETR4.SA", w: 0.40 },
        { t: "VALE3.SA", w: 0.35 },
        { t: "ITUB4.SA", w: 0.25 },
      ],
      window: "5y",
    };
    const encoded = encodeConfig(cfg);
    const decoded = decodeConfig(encoded);
    expect(decoded).toEqual(cfg);
  });

  it("encoded string is URL-safe (no '+', '/', or '=' padding)", () => {
    const cfg: PortfolioConfig = {
      v: 1,
      picks: Array.from({ length: 30 }, (_, i) => ({ t: `TKR${i}.SA`, w: 1 / 30 })),
    };
    const encoded = encodeConfig(cfg);
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it("survives a roundtrip with non-ASCII ticker names", () => {
    const cfg: PortfolioConfig = {
      v: 1,
      picks: [{ t: "ÇÃO11.SA", w: 1.0 }],
    };
    const encoded = encodeConfig(cfg);
    const decoded = decodeConfig(encoded);
    expect(decoded?.picks[0].t).toBe("ÇÃO11.SA");
  });
});

describe("decodeConfig — defensive parsing", () => {
  it("returns null for null/undefined/empty input", () => {
    expect(decodeConfig(null)).toBeNull();
    expect(decodeConfig(undefined)).toBeNull();
    expect(decodeConfig("")).toBeNull();
  });

  it("returns null for invalid base64", () => {
    expect(decodeConfig("!!!not-base64!!!")).toBeNull();
  });

  it("returns null for valid base64 of non-JSON content", () => {
    const malformed = Buffer.from("not json", "utf-8").toString("base64url");
    expect(decodeConfig(malformed)).toBeNull();
  });

  it("returns null when version is not 1", () => {
    const cfg = { v: 2, picks: [] };
    const encoded = Buffer.from(JSON.stringify(cfg), "utf-8").toString("base64url");
    expect(decodeConfig(encoded)).toBeNull();
  });

  it("returns null when picks is missing or not an array", () => {
    const cfg = { v: 1 };
    const encoded = Buffer.from(JSON.stringify(cfg), "utf-8").toString("base64url");
    expect(decodeConfig(encoded)).toBeNull();
  });
});
