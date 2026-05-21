/**
 * TypeScript mirror of the Python KPI math (pipelines/notebooks/gold/kpis_per_ticker.py).
 * Both sides are golden-tested against tests/fixtures/kpi_hand/*.json.
 */

export function returnLog(priceSeries: readonly number[]): number {
  if (priceSeries.length < 2) return Number.NaN;
  const first = priceSeries[0];
  const last = priceSeries[priceSeries.length - 1];
  if (first <= 0) return Number.NaN;
  return Math.log(last / first);
}

export function dailyLogReturns(priceSeries: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < priceSeries.length; i++) {
    const prev = priceSeries[i - 1];
    const curr = priceSeries[i];
    if (prev > 0 && curr > 0) out.push(Math.log(curr / prev));
  }
  return out;
}

export function annualizedVolatility(dailyReturns: readonly number[]): number {
  const n = dailyReturns.length;
  if (n < 2) return Number.NaN;
  const mean = dailyReturns.reduce((a, b) => a + b, 0) / n;
  const variance = dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

export function maxDrawdown(priceSeries: readonly number[]): number {
  let peak = Number.NEGATIVE_INFINITY;
  let worst = 0;
  for (const p of priceSeries) {
    if (p > peak) peak = p;
    if (peak > 0) {
      const dd = (p - peak) / peak;
      if (dd < worst) worst = dd;
    }
  }
  return worst;
}

export function sharpeVsCdi(dailyReturns: readonly number[], cdiAnnual: number): number {
  const vol = annualizedVolatility(dailyReturns);
  if (!Number.isFinite(vol) || vol === 0) return Number.NaN;
  const meanAnnual = (dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length) * 252;
  return (meanAnnual - cdiAnnual) / vol;
}
