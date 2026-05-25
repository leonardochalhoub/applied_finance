/**
 * Rolling-window persistence test of Markowitz — the proper empirical
 * translation of Kahneman's (1984) "Illusion of Skill" finding to
 * portfolio optimization.
 *
 * Kahneman's original study computed the correlation of manager rankings
 * across consecutive years; he found mean correlation ≈ 0.01 across 378
 * year-pairs. The conclusion: no skill, only luck.
 *
 * The analogous test for Markowitz is:
 *  1. Slide a (train, test) window across history with step size `step`.
 *  2. In each window, fit Markowitz on train, compute ex-post Sharpe on
 *     test, and rank Markowitz against a properly-matched concentrated-K
 *     null distribution (M samples of K-bets on the same universe).
 *  3. Plot Markowitz's percentile inside that null over windows.
 *  4. Compute the lag-1 autocorrelation of the percentile series.
 *
 * If the autocorrelation is close to 0, Markowitz's ranking in window t
 * does NOT predict its ranking in window t+1 — i.e., its apparent
 * "winning" or "losing" is just regime noise, exactly Kahneman's finding.
 *
 * If the autocorrelation is strongly positive (say > 0.4), there IS
 * persistence — Markowitz consistently outperforms (or underperforms)
 * across regimes, suggesting genuine informational content.
 *
 * The second statistic is the Jaccard similarity of MV's top-K pick set
 * between consecutive windows. High Jaccard ⇒ MV picks the same ativos
 * across regimes (consistent worldview). Low Jaccard ⇒ MV chases
 * window-specific noise.
 *
 * Implementation note: re-uses `_fitMarkowitzExAnte` and
 * `_concentratedSample` from `./illusion.ts` — same shrinkage stack and
 * same concentration-matched null.
 */

import { buildFrontier } from "./markowitz";
import { ledoitWolf, jensenCorrectMu, jorionShrinkMu } from "./mvEstimators";
import { dot, matVec } from "./matrix";
import { mulberry32, type Rng } from "./prng";
import { applyMacroAnchor } from "./shrinkage";

export type WindowSnapshot = {
  /** 1-based window index for the UI. */
  index: number;
  /** Dates bounding train and test for this window. */
  trainStart: string;
  trainEnd: string;
  testStart: string;
  testEnd: string;
  /** Markowitz weights chosen on the train window (length N). */
  weights: number[];
  /** Top-K tickers (by absolute weight) — used for Jaccard between windows. */
  topKTickers: string[];
  /** Effective K, derived from the chosen weights' HHI. */
  effectiveK: number;
  /** Sharpe ex-ante under raw μ̂_train (the "promessa"). */
  sharpeExAnte: number;
  /** Sharpe ex-post on the test window (what was delivered). */
  sharpeExPost: number;
  /** 1/N realized Sharpe on the test window. */
  sharpeEqualWeight: number;
  /** Percentile of MV ex-post inside the concentrated-K random null. */
  percentileConcentrated: number;
  /** Percentile of MV ex-post inside the Dirichlet(1) diversified null. */
  percentileDirichlet: number;
};

export type RollingPersistenceResult = {
  windows: WindowSnapshot[];
  /** Universe tickers (constant across windows). */
  tickers: string[];
  /** Lag-1 Pearson autocorrelation of the percentile series — Kahneman's
   *  statistic. Returns 0 when fewer than 3 windows. */
  percentileLag1Autocorr: number;
  /** Mean Jaccard similarity of consecutive top-K pick sets. 1 ⇒ MV picks
   *  identical ativos across windows; 0 ⇒ no overlap. */
  jaccardAdjacentMean: number;
  /** Lag-1 autocorrelation of the picks (Spearman-like via Jaccard). Same
   *  statistic as above, exposed for the UI summary. Equal to
   *  jaccardAdjacentMean here; kept distinct for symmetry with future
   *  Spearman-based extensions. */
  picksLag1Persistence: number;
  /** Mean illusion gap (ex-ante − ex-post) across windows, in Sharpe. */
  illusionGapMean: number;
  /** Fraction of windows in which MV beat 1/N on the test. */
  mvBeatsEqWeightFrac: number;
  /** Mean concentratedNull percentile across windows — the headline
   *  "is MV at p ≈ 50 on average?" number. */
  percentileConcentratedMean: number;
  trainDays: number;
  testDays: number;
  stepDays: number;
  nRandom: number;
};

// ── Helpers (lifted from illusion.ts internals to keep both files self-contained) ──

function _realizedSharpe(w: number[], X: number[][], rf: number): number {
  const T = X.length;
  if (T < 2) return 0;
  const N = X[0].length;
  const portRets = new Array<number>(T);
  for (let t = 0; t < T; t++) {
    let r = 0;
    for (let i = 0; i < N; i++) r += w[i] * X[t][i];
    portRets[t] = r;
  }
  const mean = portRets.reduce((a, b) => a + b, 0) / T;
  let varSum = 0;
  for (const r of portRets) varSum += (r - mean) * (r - mean);
  const dailyVar = varSum / Math.max(T - 1, 1);
  const muAnn = mean * 252;
  const sigAnn = Math.sqrt(dailyVar * 252);
  if (sigAnn < 1e-9) return 0;
  return (muAnn - rf) / sigAnn;
}

function _analyticalSharpe(w: number[], muAnn: number[], sigAnn: number[][], rf: number): number {
  const ret = dot(w, muAnn);
  const vol = Math.sqrt(Math.max(dot(w, matVec(sigAnn, w)), 0));
  if (vol < 1e-9) return 0;
  return (ret - rf) / vol;
}

function _gamma(alpha: number, rng: Rng): number {
  if (alpha < 1) return _gamma(alpha + 1, rng) * Math.pow(rng(), 1 / alpha);
  const d = alpha - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x: number;
    let v: number;
    let u1 = 0;
    let u2 = 0;
    while (u1 === 0) u1 = rng();
    while (u2 === 0) u2 = rng();
    do {
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
      u1 = rng();
      u2 = rng();
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function _dirichletUniform(n: number, rng: Rng): number[] {
  const x = new Array<number>(n);
  for (let i = 0; i < n; i++) x[i] = _gamma(1, rng);
  const s = x.reduce((a, b) => a + b, 0);
  return x.map((v) => v / s);
}

function _concentratedSample(n: number, k: number, rng: Rng): number[] {
  const indices = new Array<number>(n);
  for (let i = 0; i < n; i++) indices[i] = i;
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rng() * (n - i));
    const tmp = indices[i];
    indices[i] = indices[j];
    indices[j] = tmp;
  }
  const gammas = new Array<number>(k);
  let s = 0;
  for (let i = 0; i < k; i++) {
    gammas[i] = _gamma(1, rng);
    s += gammas[i];
  }
  const w = new Array<number>(n).fill(0);
  for (let i = 0; i < k; i++) w[indices[i]] = gammas[i] / s;
  return w;
}

function _hhi(w: number[]): number {
  let s = 0;
  for (const wi of w) s += wi * wi;
  return s;
}

function _percentile(sortedAsc: number[], target: number): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  if (target <= sortedAsc[0]) return 0;
  if (target >= sortedAsc[n - 1]) return 1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (sortedAsc[mid] <= target) lo = mid;
    else hi = mid;
  }
  const a = sortedAsc[lo];
  const b = sortedAsc[hi];
  const frac = b > a ? (target - a) / (b - a) : 0;
  return (lo + frac) / (n - 1);
}

function _fitMarkowitz(
  X: number[][],
  rf: number,
): {
  weights: number[];
  muRawAnn: number[];
  sigAnn: number[][];
} {
  const T = X.length;
  const N = X[0].length;
  const lw = ledoitWolf(X);
  const meanLog = new Array<number>(N).fill(0);
  for (const row of X) for (let i = 0; i < N; i++) meanLog[i] += row[i];
  for (let i = 0; i < N; i++) meanLog[i] /= T;
  const meanSimple = jensenCorrectMu(meanLog, lw.sigma);
  const muRawAnn = meanSimple.map((m) => m * 252);
  const sigAnn = lw.sigma.map((row) => row.map((v) => v * 252));
  const js = jorionShrinkMu(muRawAnn, sigAnn, T);
  const macro = applyMacroAnchor(js.mu, rf, T);
  try {
    const fr = buildFrontier(macro.mu, sigAnn, rf, {
      longOnly: true,
      cloudSize: 0,
      frontierSteps: 12,
    });
    return { weights: fr.maxSharpe.weights, muRawAnn, sigAnn };
  } catch {
    return { weights: new Array<number>(N).fill(1 / N), muRawAnn, sigAnn };
  }
}

function _jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

function _pearson(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += x[i];
    sy += y[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const xi = x[i] - mx;
    const yi = y[i] - my;
    num += xi * yi;
    dx += xi * xi;
    dy += yi * yi;
  }
  const denom = Math.sqrt(dx * dy);
  return denom > 1e-12 ? num / denom : 0;
}

/**
 * Run the rolling-window persistence experiment.
 *
 * @param opts.X            Daily log-returns matrix (T × N).
 * @param opts.dates        Date strings aligned with rows of X (length T).
 * @param opts.tickers      Ticker labels aligned with columns of X (length N).
 * @param opts.rf           Annualised risk-free rate.
 * @param opts.trainDays    Training window length (default 504 = 2y).
 * @param opts.testDays     Test window length (default 504 = 2y).
 * @param opts.stepDays     Step between window starts (default 252 = 1y).
 * @param opts.nRandom      Number of null-distribution samples per window
 *                          (default 1000 — lower than single-window because
 *                          we run it per window and the cost compounds).
 * @param opts.seed         RNG seed (default 0xCAFEFEED).
 *
 * Returns `null` if `X.length < trainDays + testDays`.
 */
export function runRollingPersistenceExperiment(opts: {
  X: number[][];
  dates: string[];
  tickers: string[];
  rf: number;
  trainDays?: number;
  testDays?: number;
  stepDays?: number;
  nRandom?: number;
  seed?: number;
}): RollingPersistenceResult | null {
  const trainDays = opts.trainDays ?? 504;
  const testDays = opts.testDays ?? 504;
  const stepDays = opts.stepDays ?? 252;
  const nRandom = opts.nRandom ?? 1000;
  const { X, dates, tickers, rf } = opts;
  const T = X.length;
  if (T < trainDays + testDays) return null;
  const N = X[0]?.length ?? 0;
  if (N < 2) return null;

  const rng = mulberry32(opts.seed ?? 0xcafefeed);
  const windows: WindowSnapshot[] = [];
  for (
    let start = 0;
    start + trainDays + testDays <= T;
    start += stepDays
  ) {
    const trainX = X.slice(start, start + trainDays);
    const testX = X.slice(start + trainDays, start + trainDays + testDays);
    if (trainX.length < 60 || testX.length < 60) continue;

    const fit = _fitMarkowitz(trainX, rf);
    const sharpeExAnte = _analyticalSharpe(fit.weights, fit.muRawAnn, fit.sigAnn, rf);
    const sharpeExPost = _realizedSharpe(fit.weights, testX, rf);
    const wEq = new Array<number>(N).fill(1 / N);
    const sharpeEqualWeight = _realizedSharpe(wEq, testX, rf);

    // Concentrated null with K derived from this window's MV HHI
    const hhi = _hhi(fit.weights);
    let k = Math.round(1 / Math.max(hhi, 1e-6));
    k = Math.max(2, Math.min(Math.floor(N / 2), k));
    const concentratedSharpes: number[] = [];
    const dirichletSharpes: number[] = [];
    for (let s = 0; s < nRandom; s++) {
      concentratedSharpes.push(_realizedSharpe(_concentratedSample(N, k, rng), testX, rf));
      dirichletSharpes.push(_realizedSharpe(_dirichletUniform(N, rng), testX, rf));
    }
    concentratedSharpes.sort((a, b) => a - b);
    dirichletSharpes.sort((a, b) => a - b);

    // Top-K picks for Jaccard
    const indexed = fit.weights
      .map((w, i) => ({ ticker: tickers[i] ?? `A${i}`, w }))
      .sort((a, b) => b.w - a.w)
      .slice(0, k);
    const topKTickers = indexed.map((x) => x.ticker);

    windows.push({
      index: windows.length + 1,
      trainStart: dates[start] ?? "",
      trainEnd: dates[start + trainDays - 1] ?? "",
      testStart: dates[start + trainDays] ?? "",
      testEnd: dates[Math.min(start + trainDays + testDays - 1, T - 1)] ?? "",
      weights: fit.weights.slice(),
      topKTickers,
      effectiveK: k,
      sharpeExAnte,
      sharpeExPost,
      sharpeEqualWeight,
      percentileConcentrated: _percentile(concentratedSharpes, sharpeExPost),
      percentileDirichlet: _percentile(dirichletSharpes, sharpeExPost),
    });
  }

  // Summary statistics over the windows series
  const percentileSeries = windows.map((w) => w.percentileConcentrated);
  const lag0 = percentileSeries.slice(0, -1);
  const lag1 = percentileSeries.slice(1);
  const percentileLag1Autocorr = _pearson(lag0, lag1);

  let jaccardSum = 0;
  let jaccardCount = 0;
  for (let i = 1; i < windows.length; i++) {
    const a = new Set(windows[i - 1].topKTickers);
    const b = new Set(windows[i].topKTickers);
    jaccardSum += _jaccard(a, b);
    jaccardCount++;
  }
  const jaccardAdjacentMean = jaccardCount > 0 ? jaccardSum / jaccardCount : 0;

  const illusionGapMean =
    windows.length > 0
      ? windows.reduce((s, w) => s + (w.sharpeExAnte - w.sharpeExPost), 0) / windows.length
      : 0;
  const mvBeatsEqWeightFrac =
    windows.length > 0
      ? windows.filter((w) => w.sharpeExPost > w.sharpeEqualWeight).length / windows.length
      : 0;
  const percentileConcentratedMean =
    windows.length > 0
      ? percentileSeries.reduce((s, v) => s + v, 0) / windows.length
      : 0;

  return {
    windows,
    tickers: tickers.slice(),
    percentileLag1Autocorr,
    jaccardAdjacentMean,
    picksLag1Persistence: jaccardAdjacentMean,
    illusionGapMean,
    mvBeatsEqWeightFrac,
    percentileConcentratedMean,
    trainDays,
    testDays,
    stepDays,
    nRandom,
  };
}
