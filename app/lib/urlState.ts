/**
 * URL state codec for portfolio sharing.
 *
 * Encodes a portfolio config as base64-encoded JSON in the `?p=` query string.
 * Keeps payloads tiny by storing only ticker:weight pairs (no extras).
 */

export type PortfolioConfig = {
  v: 1;
  picks: { t: string; w: number }[]; // ticker, weight (fractional, sums to 1)
  window?: "1y" | "5y" | "full";
};

export function encodeConfig(cfg: PortfolioConfig): string {
  const json = JSON.stringify(cfg);
  // base64url
  if (typeof window === "undefined") {
    return Buffer.from(json, "utf-8").toString("base64url");
  }
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeConfig(s: string | null | undefined): PortfolioConfig | null {
  if (!s) return null;
  try {
    let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const json =
      typeof window === "undefined"
        ? Buffer.from(b64, "base64").toString("utf-8")
        : decodeURIComponent(escape(atob(b64)));
    const parsed = JSON.parse(json) as PortfolioConfig;
    if (parsed.v !== 1 || !Array.isArray(parsed.picks)) return null;
    return parsed;
  } catch {
    return null;
  }
}
