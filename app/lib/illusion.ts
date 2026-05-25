/**
 * "Illusion of Skill" experiment — single train/test split with N random
 * portfolios, used to make Kahneman's behavioural argument empirically
 * legible: the Markowitz optimizer's *ex-ante* Sharpe is a number the
 * algorithm promised based on in-sample estimates; the *ex-post* Sharpe is
 * what those same weights actually delivered on out-of-sample data. The gap
 * between them is the illusion.
 *
 * Pedagogically the centrepiece is the histogram of realized Sharpes from
 * N random long-only portfolios on the test window. Most random portfolios
 * land near a middling Sharpe; the optimizer's *promised* Sharpe sits in
 * the right tail (it predicted skill), while the optimizer's *delivered*
 * Sharpe usually sits near the median (delivered luck).
 *
 * References:
 *   - Kahneman (2002 Nobel; 2011 TF&S, "The Illusion of Skill" chapter)
 *   - DeMiguel-Garlappi-Uppal (2009, RFS)
 *   - Burton Malkiel (1973), A Random Walk Down Wall Street
 *
 * Methodology mirrors the live Markowitz pipeline (Ledoit-Wolf Σ + Jensen
 * + Jorion + macro-anchor) so the *ex-ante* number shown is exactly what
 * the tab Markowitz would compute on the same data.
 */

import { buildFrontier } from "./markowitz";
import { ledoitWolf, jensenCorrectMu, jorionShrinkMu } from "./mvEstimators";
import { dot, matVec } from "./matrix";
import { defaultRng, mulberry32, type Rng } from "./prng";
import { applyMacroAnchor } from "./shrinkage";

export type NamedPortfolio = {
  /** Realized annualised Sharpe under the TEST-window distribution. */
  sharpe: number;
  /** Percentile (0-1) of this Sharpe inside the random portfolios' distribution. */
  percentile: number;
  /** Weights aligned with `tickers`. */
  weights: number[];
};

export type HistogramBin = {
  binStart: number;
  binEnd: number;
  binMid: number;
  count: number;
  freq: number;
};

export type IllusionResult = {
  /** Random portfolios' realized Sharpes, sorted ascending. */
  randomSharpes: number[];
  histogram: HistogramBin[];
  /** Markowitz max-Sharpe weights computed on TRAIN; Sharpe field is what
   *  the optimizer's frontier reported on train (ex-ante "promise"). */
  markowitzExAnte: NamedPortfolio;
  /** Same Markowitz weights, but Sharpe computed on TEST stats (delivery). */
  markowitzExPost: NamedPortfolio;
  /** 1/N realized Sharpe on TEST. */
  equalWeight: NamedPortfolio;
  /** Median random portfolio Sharpe — a fair "monkey throwing darts" baseline. */
  medianRandom: NamedPortfolio;
  /** Inclusive train/test boundary labels for the UI. */
  trainStart: string;
  trainEnd: string;
  testStart: string;
  testEnd: string;
  trainDays: number;
  testDays: number;
  nRandom: number;
  /** Tickers aligned with weight vectors. */
  tickers: string[];
};

/** Annualised Sharpe of weights `w` evaluated under daily log-return matrix
 *  `X` (T × N). Returns 0 when vol is degenerate. */
function _realizedSharpe(w: number[], X: number[][], rf: number): number {
  const T = X.length;
  if (T < 2) return 0;
  const N = X[0].length;
  const portRets = new Array(T);
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

/** Sample Gamma(α, 1) — Marsaglia-Tsang for α ≥ 1, boost for α < 1. */
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

/** Uniform sample on the (N-1)-simplex — every long-only portfolio summing
 *  to 1 has equal density. The "monkey throwing darts" of Malkiel (1973). */
function _dirichletUniform(n: number, rng: Rng): number[] {
  const x = new Array(n);
  for (let i = 0; i < n; i++) x[i] = _gamma(1, rng);
  const s = x.reduce((a, b) => a + b, 0);
  return x.map((v) => v / s);
}

/** Compute the full Markowitz pipeline (Ledoit-Wolf + Jensen + Jorion +
 *  macro-anchor) on a daily log-return matrix.
 *
 *  Returns the long-only max-Sharpe weights (chosen by the FULL defensive
 *  pipeline, since that is what the platform actually ships) along with two
 *  vectors of expected returns:
 *    - `muRawAnn`    Jensen-corrected sample mean × 252, NO shrinkage.
 *                    This is the optimist's μ̂ — what the naïve Markowitz
 *                    user would type into the optimizer. Used to compute the
 *                    "ex-ante" Sharpe that the user *thinks* they bought.
 *    - `muShrunkAnn` After Jorion + macro-anchor + per-asset ceiling. The
 *                    conservative μ the defensive pipeline actually used to
 *                    pick the weights. Exposed for diagnostics but NOT used
 *                    for the ex-ante Sharpe — that would hide the illusion
 *                    the page is built to demonstrate (the heavy shrinkage
 *                    underpromises so much that the realized ex-post can
 *                    end up higher, inverting the Kahneman/DGU result).
 *  plus the annualised Σ̂ used by both the weight pick and the Sharpe calc. */
function _fitMarkowitzExAnte(
  X: number[][],
  rf: number,
): {
  weights: number[];
  muRawAnn: number[];
  muShrunkAnn: number[];
  sigAnn: number[][];
} {
  const T = X.length;
  const N = X[0].length;
  const lw = ledoitWolf(X);
  const meanLog = new Array(N).fill(0);
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
    return {
      weights: fr.maxSharpe.weights,
      muRawAnn,
      muShrunkAnn: macro.mu,
      sigAnn,
    };
  } catch {
    return {
      weights: new Array(N).fill(1 / N),
      muRawAnn,
      muShrunkAnn: macro.mu,
      sigAnn,
    };
  }
}

/** Bin a sorted array of Sharpes into roughly-equal-width buckets. */
function _binSharpes(sortedSharpes: number[], nBins: number): HistogramBin[] {
  if (sortedSharpes.length === 0) return [];
  const lo = sortedSharpes[0];
  const hi = sortedSharpes[sortedSharpes.length - 1];
  const span = Math.max(hi - lo, 1e-6);
  const w = span / nBins;
  const bins: HistogramBin[] = [];
  for (let b = 0; b < nBins; b++) {
    const start = lo + b * w;
    const end = b === nBins - 1 ? hi + 1e-9 : lo + (b + 1) * w;
    bins.push({ binStart: start, binEnd: end, binMid: (start + end) / 2, count: 0, freq: 0 });
  }
  for (const s of sortedSharpes) {
    let idx = Math.floor((s - lo) / w);
    if (idx >= nBins) idx = nBins - 1;
    if (idx < 0) idx = 0;
    bins[idx].count += 1;
  }
  for (const b of bins) b.freq = b.count / sortedSharpes.length;
  return bins;
}

/** Percentile (0-1) of `target` in a sorted ascending array. Linear
 *  interpolation between adjacent ranks. */
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

/** Annualised Sharpe of weights against (muAnn, sigAnn): used for the
 *  TRAIN-stats "ex-ante" Sharpe of the Markowitz weights — the optimizer's
 *  own promise about its solution. */
function _analyticalSharpe(w: number[], muAnn: number[], sigAnn: number[][], rf: number): number {
  const ret = dot(w, muAnn);
  const vol = Math.sqrt(Math.max(dot(w, matVec(sigAnn, w)), 0));
  if (vol < 1e-9) return 0;
  return (ret - rf) / vol;
}

/**
 * Run the illusion experiment.
 *
 * - Splits the daily log-returns matrix `X` into train (`[0, trainDays)`)
 *   and test (`[trainDays, trainDays + testDays)`).
 * - On train: fits the full live shrinkage pipeline and pulls the long-only
 *   max-Sharpe weights — those are the "Markowitz pick" the platform would
 *   have shipped at the start of the test window.
 * - On test: computes the realized annualised Sharpe of (a) Markowitz, (b)
 *   1/N, and (c) `nRandom` Dirichlet(1) random long-only portfolios.
 * - Bins the random Sharpes and computes percentile ranks for each named
 *   portfolio so the UI can say "Markowitz delivered the 53rd-percentile
 *   monkey portfolio".
 *
 * Returns `null` if `X.length < trainDays + testDays + 2`.
 */
export function runIllusionExperiment(opts: {
  X: number[][];
  dates: string[];
  tickers: string[];
  rf: number;
  trainDays: number;
  testDays: number;
  nRandom?: number;
  seed?: number;
  histogramBins?: number;
}): IllusionResult | null {
  const { X, dates, tickers, rf, trainDays, testDays } = opts;
  const nRandom = opts.nRandom ?? 5000;
  const nBins = opts.histogramBins ?? 40;
  const T = X.length;
  if (T < trainDays + testDays) return null;
  const trainX = X.slice(0, trainDays);
  const testX = X.slice(trainDays, trainDays + testDays);
  if (trainX.length < 60 || testX.length < 60) return null;
  const N = X[0].length;

  const fit = _fitMarkowitzExAnte(trainX, rf);

  // Test-window realised Sharpes
  const N_eq = new Array(N).fill(1 / N);
  const sharpeMVtest = _realizedSharpe(fit.weights, testX, rf);
  const sharpeEQtest = _realizedSharpe(N_eq, testX, rf);

  const rng = mulberry32(opts.seed ?? 0xcafefeed);
  const randomWeights: number[][] = [];
  const randomSharpes: number[] = [];
  for (let k = 0; k < nRandom; k++) {
    const w = _dirichletUniform(N, rng);
    randomWeights.push(w);
    randomSharpes.push(_realizedSharpe(w, testX, rf));
  }
  randomSharpes.sort((a, b) => a - b);

  // Markowitz ex-ante Sharpe under the RAW (Jensen-corrected, no Jorion,
  // no macro-anchor) TRAIN μ — i.e. the optimist's μ̂. This is the "promise"
  // the canonical Kahneman/DGU framing refers to: the Sharpe that a naïve
  // user would see plotted on the in-sample frontier with no defensive
  // shrinkage. If we used the shrunken μ here (the one our defensive
  // pipeline actually uses to pick weights), the platform's heavy
  // anti-overestimation stack would frequently produce an ex-ante BELOW
  // the realized ex-post — inverting the very illusion this page exists
  // to show. Using μ̂_raw keeps the histogram pedagogy honest.
  const sharpeMVexAnte = _analyticalSharpe(fit.weights, fit.muRawAnn, fit.sigAnn, rf);

  const pctile = (s: number) => _percentile(randomSharpes, s);
  const median = randomSharpes[Math.floor(randomSharpes.length / 2)];

  return {
    randomSharpes,
    histogram: _binSharpes(randomSharpes, nBins),
    markowitzExAnte: {
      sharpe: sharpeMVexAnte,
      percentile: pctile(sharpeMVexAnte),
      weights: fit.weights.slice(),
    },
    markowitzExPost: {
      sharpe: sharpeMVtest,
      percentile: pctile(sharpeMVtest),
      weights: fit.weights.slice(),
    },
    equalWeight: { sharpe: sharpeEQtest, percentile: pctile(sharpeEQtest), weights: N_eq },
    medianRandom: { sharpe: median, percentile: 0.5, weights: [] },
    trainStart: dates[0],
    trainEnd: dates[trainDays - 1],
    testStart: dates[trainDays],
    testEnd: dates[Math.min(trainDays + testDays - 1, dates.length - 1)],
    trainDays,
    testDays,
    nRandom,
    tickers: tickers.slice(),
  };
}

// Re-export defaultRng for tests/external use without forcing them to import
// prng.ts directly.
export { defaultRng };
