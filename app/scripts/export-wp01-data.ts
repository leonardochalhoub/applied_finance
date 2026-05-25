/**
 * WP01 v2 — canonical numbers exporter.
 *
 * Runs the LIVE TypeScript pipelines used by the website
 * (lib/markowitz, lib/illusion, lib/persistence, lib/blacklitterman,
 * lib/riskparity, lib/backtest) against the current data in
 * `app/public/data/` and dumps results to:
 *
 *   articles/data/numbers.json   — flat scalar map for paper text
 *   articles/data/markowitz.json — frontier + cloud + tangency for the canonical chart
 *   articles/data/kahneman.json  — both nulls + named portfolio Sharpes + histograms
 *   articles/data/persistence.json — rolling-window snapshots
 *   articles/data/ingenuo.json   — walk-forward backtest series
 *   articles/data/bl.json        — implied Π vs μ̂ + weight comparisons
 *   articles/data/paridade.json  — ERC vs alternatives + per-ticker RC
 *
 * Run with:
 *   cd app && npx tsx scripts/export-wp01-data.ts
 *
 * Output is consumed by `articles/figures/make_figures.py` which produces
 * the matplotlib PDFs and the `articles/numbers.tex` mapping into LaTeX
 * \newcommand definitions. Paper reads numbers.tex at compile time so
 * every figure in the paper uses the exact same data as the website.
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { walkForwardBacktest } from "../lib/backtest.js";
import { blackLitterman, impliedReturns } from "../lib/blacklitterman.js";
import { runIllusionExperiment } from "../lib/illusion.js";
import { buildFrontier, evaluatePortfolio } from "../lib/markowitz.js";
import {
  jensenCorrectMu,
  jorionShrinkMu,
  ledoitWolf,
} from "../lib/mvEstimators.js";
import { runRollingPersistenceExperiment } from "../lib/persistence.js";
import {
  equalRiskContribution,
  inverseVolatilityWeights,
  riskContributions,
} from "../lib/riskparity.js";
import { applyMacroAnchor } from "../lib/shrinkage.js";
import { buildCoterminalReturns, tightenUniverseForHistory } from "../lib/universe.js";

import type {
  CdiArtifact,
  IbovArtifact,
  PricesArtifact,
} from "../lib/data.js";

const DATA_ROOT = path.join(process.cwd(), "public", "data");
const OUT_ROOT = path.join(process.cwd(), "..", "articles", "data");

async function loadArtifact<T>(name: string): Promise<T> {
  const buf = await readFile(path.join(DATA_ROOT, `${name}.json`), "utf-8");
  return JSON.parse(buf) as T;
}

async function writeJSON(name: string, data: unknown): Promise<void> {
  await mkdir(OUT_ROOT, { recursive: true });
  await writeFile(
    path.join(OUT_ROOT, `${name}.json`),
    JSON.stringify(data, null, 2),
    "utf-8",
  );
}

function fmtPctAA(x: number, dp = 2): string {
  return `${(x * 100).toFixed(dp).replace(".", ",")}\\%`;
}

function fmtNum(x: number, dp = 3): string {
  return x.toFixed(dp).replace(".", ",");
}

async function main(): Promise<void> {
  console.log("─── WP01 v2 data export ───");
  const [prices, ibov, cdi] = await Promise.all([
    loadArtifact<PricesArtifact>("prices_normalized"),
    loadArtifact<IbovArtifact>("ibov_overview"),
    loadArtifact<CdiArtifact>("cdi"),
  ]);
  const rf = cdi.global_mean_annual ?? 0.13;
  const ERP = 0.06;
  console.log(
    `Universe: ${Object.keys(prices.series).length} tickers, ${prices.dates.length} dates ${prices.dates[0]}→${prices.dates[prices.dates.length - 1]}`,
  );
  console.log(`IBOV members: ${ibov.members.length}, rf = ${(rf * 100).toFixed(2)}% a.a.`);

  const NUMBERS: Record<string, string> = {
    UniverseSize: String(Object.keys(prices.series).length),
    UniverseDates: `${prices.dates[0]}--${prices.dates[prices.dates.length - 1]}`,
    UniverseLastDate: prices.dates[prices.dates.length - 1],
    UniverseNTradingDays: String(prices.dates.length),
    IBOVMembers: String(ibov.members.length),
    Rf: fmtPctAA(rf, 2),
    ERP: fmtPctAA(ERP, 0),
    Ceiling: fmtPctAA(rf + 3 * ERP, 1),
  };

  // ── Markowitz top-30 IBOV, 5y window (the WP01 v1 spec) ───────────────
  console.log("[Markowitz] top-30 IBOV, 5y window...");
  const top30 = ibov.members
    .filter((m) => prices.series[m.ticker])
    .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
    .slice(0, 30);
  const required5y = 5 * 252;
  const tight30 = tightenUniverseForHistory(
    prices,
    top30.map((m) => m.ticker),
    top30.map((m) => m.weight ?? 0),
    required5y,
  );
  const built30 = buildCoterminalReturns(prices, tight30.tickers, tight30.startIdx, null);
  if (!built30) throw new Error("buildCoterminalReturns top30 returned null");
  const window5y = built30.X.length > required5y ? built30.X.slice(-required5y) : built30.X;
  const window5yDates = built30.dates.slice(-window5y.length);
  const N30 = window5y[0].length;
  const T30 = window5y.length;
  const lw30 = ledoitWolf(window5y);
  const meanLog30 = new Array<number>(N30).fill(0);
  for (const row of window5y) for (let i = 0; i < N30; i++) meanLog30[i] += row[i];
  for (let i = 0; i < N30; i++) meanLog30[i] /= T30;
  const muSimple30 = jensenCorrectMu(meanLog30, lw30.sigma);
  const muRawAnn30 = muSimple30.map((m) => m * 252);
  const sigAnn30 = lw30.sigma.map((row) => row.map((v) => v * 252));
  const js30 = jorionShrinkMu(muRawAnn30, sigAnn30, T30);
  const macro30 = applyMacroAnchor(js30.mu, rf, T30);
  const frontier30 = buildFrontier(macro30.mu, sigAnn30, rf, {
    longOnly: true,
    cloudSize: 1000,
    frontierSteps: 60,
  });
  const sortedByW30 = tight30.tickers
    .map((t, i) => ({ ticker: t, w: frontier30.maxSharpe.weights[i], muS: macro30.mu[i], muR: muRawAnn30[i], sig: Math.sqrt(sigAnn30[i][i]) }))
    .sort((a, b) => b.w - a.w);

  NUMBERS.MVUniverseN = String(N30);
  NUMBERS.MVPeriodStart = window5yDates[0];
  NUMBERS.MVPeriodEnd = window5yDates[window5yDates.length - 1];
  NUMBERS.MVTangencyRet = fmtPctAA(frontier30.maxSharpe.ret, 2);
  NUMBERS.MVTangencyVol = fmtPctAA(frontier30.maxSharpe.vol, 2);
  NUMBERS.MVTangencySharpe = fmtNum(frontier30.maxSharpe.sharpe, 3);
  NUMBERS.MVMinVarRet = fmtPctAA(frontier30.minVariance.ret, 2);
  NUMBERS.MVMinVarVol = fmtPctAA(frontier30.minVariance.vol, 2);
  NUMBERS.MVMinVarSharpe = fmtNum(frontier30.minVariance.sharpe, 3);
  NUMBERS.MVJorionPsi = fmtNum(js30.psi, 3);
  NUMBERS.MVMacroAlpha = fmtNum(macro30.alpha, 3);
  NUMBERS.MVMuRawMin = fmtPctAA(Math.min(...muRawAnn30), 2);
  NUMBERS.MVMuRawMax = fmtPctAA(Math.max(...muRawAnn30), 2);
  NUMBERS.MVMuRawMedian = fmtPctAA(median(muRawAnn30), 2);
  NUMBERS.MVMuShrunkMin = fmtPctAA(Math.min(...macro30.mu), 2);
  NUMBERS.MVMuShrunkMax = fmtPctAA(Math.max(...macro30.mu), 2);
  NUMBERS.MVMuShrunkMedian = fmtPctAA(median(macro30.mu), 2);
  const diag30 = sigAnn30.map((row, i) => Math.sqrt(row[i]));
  NUMBERS.MVSigmaMin = fmtPctAA(Math.min(...diag30), 1);
  NUMBERS.MVSigmaMax = fmtPctAA(Math.max(...diag30), 1);
  NUMBERS.MVSigmaMedian = fmtPctAA(median(diag30), 1);
  // Top-5 picks. LaTeX \newcommand names cannot contain digits, so we
  // index by word (One..Five) instead of "1..5".
  const RANKS = ["One", "Two", "Three", "Four", "Five"];
  for (let i = 0; i < Math.min(RANKS.length, sortedByW30.length); i++) {
    const k = RANKS[i];
    const r = sortedByW30[i];
    NUMBERS[`MVTop${k}Ticker`] = r.ticker.replace(".SA", "");
    NUMBERS[`MVTop${k}Weight`] = fmtPctAA(r.w, 1);
    NUMBERS[`MVTop${k}MuShrunk`] = fmtPctAA(r.muS, 1);
    NUMBERS[`MVTop${k}MuRaw`] = fmtPctAA(r.muR, 1);
  }
  NUMBERS.MVTopFiveSumWeights = fmtPctAA(
    sortedByW30.slice(0, 5).reduce((s, r) => s + r.w, 0),
    1,
  );
  await writeJSON("markowitz", {
    tickers: tight30.tickers,
    N: N30,
    T: T30,
    rf,
    periodStart: window5yDates[0],
    periodEnd: window5yDates[window5yDates.length - 1],
    frontier: frontier30.frontier,
    cloud: frontier30.cloud,
    maxSharpe: frontier30.maxSharpe,
    minVariance: frontier30.minVariance,
    muRaw: muRawAnn30,
    muShrunk: macro30.mu,
    sigmaDiag: diag30,
    psi: js30.psi,
    alpha: macro30.alpha,
  });

  // ── Walk-forward Markowitz vs 1/N (Ingenuo / DGU) ─────────────────────
  console.log("[Ingenuo] walk-forward 3y/1q...");
  const top30Tickers = tight30.tickers;
  const ingX = built30.X;
  const ingDates = built30.dates;
  const ingResult = walkForwardBacktest({
    X: ingX,
    dates: ingDates,
    rf,
    trainDays: 3 * 252,
    testDays: 63,
    tickers: top30Tickers,
  });
  if (!ingResult) throw new Error("walkForwardBacktest returned null");
  NUMBERS.IngenuoPeriods = String(ingResult.periods);
  NUMBERS.IngenuoTrainDays = String(ingResult.trainDays);
  NUMBERS.IngenuoTestDays = String(ingResult.testDays);
  NUMBERS.IngenuoPeriodStart = ingResult.series[0]?.date ?? "—";
  NUMBERS.IngenuoPeriodEnd = ingResult.series[ingResult.series.length - 1]?.date ?? "—";
  const lastSeries = ingResult.series[ingResult.series.length - 1];
  NUMBERS.IngenuoMVCumReturn = fmtPctAA(lastSeries?.markowitz ?? 0, 2);
  NUMBERS.IngenuoEQCumReturn = fmtPctAA(lastSeries?.equalWeight ?? 0, 2);
  NUMBERS.IngenuoMVRetAnn = fmtPctAA(ingResult.markowitz.retAnn, 2);
  NUMBERS.IngenuoEQRetAnn = fmtPctAA(ingResult.equalWeight.retAnn, 2);
  NUMBERS.IngenuoMVVolAnn = fmtPctAA(ingResult.markowitz.volAnn, 2);
  NUMBERS.IngenuoEQVolAnn = fmtPctAA(ingResult.equalWeight.volAnn, 2);
  NUMBERS.IngenuoMVSharpe = fmtNum(ingResult.markowitz.sharpe, 3);
  NUMBERS.IngenuoEQSharpe = fmtNum(ingResult.equalWeight.sharpe, 3);
  const ingWinFrac =
    ingResult.series.filter((p) => p.markowitzPeriodReturn > p.equalWeightPeriodReturn).length /
    Math.max(ingResult.series.length, 1);
  NUMBERS.IngenuoMVWinRate = `${(ingWinFrac * 100).toFixed(0)}\\%`;
  NUMBERS.IngenuoMVTurnover = fmtNum(ingResult.markowitz.turnoverAnn, 2);
  NUMBERS.IngenuoSharpeGap = fmtNum(ingResult.markowitz.sharpe - ingResult.equalWeight.sharpe, 3);
  await writeJSON("ingenuo", {
    series: ingResult.series,
    summary: {
      markowitz: ingResult.markowitz,
      equalWeight: ingResult.equalWeight,
    },
    trainDays: ingResult.trainDays,
    testDays: ingResult.testDays,
  });

  // ── Kahneman: dual-null single-window experiment ──────────────────────
  console.log("[Kahneman] dual-null 2y/2y, M=5000...");
  const khResult = runIllusionExperiment({
    X: ingX,
    dates: ingDates,
    tickers: top30Tickers,
    rf,
    trainDays: 2 * 252,
    testDays: 2 * 252,
    nRandom: 5000,
  });
  if (!khResult) throw new Error("runIllusionExperiment returned null");
  NUMBERS.KhTrainStart = khResult.trainStart;
  NUMBERS.KhTrainEnd = khResult.trainEnd;
  NUMBERS.KhTestStart = khResult.testStart;
  NUMBERS.KhTestEnd = khResult.testEnd;
  NUMBERS.KhMVExAnte = fmtNum(khResult.markowitzExAnte.sharpe, 3);
  NUMBERS.KhMVExPost = fmtNum(khResult.markowitzExPost.sharpe, 3);
  NUMBERS.KhEqualWeight = fmtNum(khResult.equalWeight.sharpe, 3);
  NUMBERS.KhMedianDirichlet = fmtNum(khResult.medianRandom.sharpe, 3);
  NUMBERS.KhIllusion = fmtNum(
    khResult.markowitzExAnte.sharpe - khResult.markowitzExPost.sharpe,
    3,
  );
  NUMBERS.KhSupportMin = fmtNum(khResult.randomSharpes[0], 3);
  NUMBERS.KhSupportMax = fmtNum(khResult.randomSharpes[khResult.randomSharpes.length - 1], 3);
  NUMBERS.KhDirichletExPostPct = `${(khResult.dirichletNull.markowitzExPostPercentile * 100).toFixed(0)}`;
  NUMBERS.KhConcentratedExPostPct = `${(khResult.concentratedNull.markowitzExPostPercentile * 100).toFixed(0)}`;
  NUMBERS.KhConcentrationK = String(khResult.concentrationK);
  NUMBERS.KhConcentratedMedian = fmtNum(khResult.concentratedNull.median, 3);
  NUMBERS.KhConcentratedSupportMin = fmtNum(
    khResult.concentratedNull.sharpes[0],
    3,
  );
  NUMBERS.KhConcentratedSupportMax = fmtNum(
    khResult.concentratedNull.sharpes[khResult.concentratedNull.sharpes.length - 1],
    3,
  );
  await writeJSON("kahneman", {
    markowitzExAnte: khResult.markowitzExAnte,
    markowitzExPost: khResult.markowitzExPost,
    equalWeight: khResult.equalWeight,
    medianRandom: khResult.medianRandom,
    trainStart: khResult.trainStart,
    trainEnd: khResult.trainEnd,
    testStart: khResult.testStart,
    testEnd: khResult.testEnd,
    nRandom: khResult.nRandom,
    dirichletNull: khResult.dirichletNull,
    concentratedNull: khResult.concentratedNull,
    concentrationK: khResult.concentrationK,
    tickers: khResult.tickers,
  });

  // ── Persistence (rolling Kahneman test) ───────────────────────────────
  console.log("[Persistence] rolling 2y/2y, non-overlap...");
  const persistenceResult = runRollingPersistenceExperiment({
    X: ingX,
    dates: ingDates,
    tickers: top30Tickers,
    rf,
    trainDays: 2 * 252,
    testDays: 2 * 252,
    stepDays: 2 * 252,
    nRandom: 1000,
  });
  if (!persistenceResult) {
    console.warn("Persistence returned null (insufficient windows); writing empty");
    NUMBERS.PersistenceNWindows = "0";
    NUMBERS.PersistenceAutoCorr = "n/a";
    NUMBERS.PersistenceAutoCorrSE = "n/a";
    NUMBERS.PersistenceAutoCorrCILow = "n/a";
    NUMBERS.PersistenceAutoCorrCIHigh = "n/a";
    NUMBERS.PersistenceJaccard = "n/a";
    NUMBERS.PersistenceMeanPercentile = "n/a";
    await writeJSON("persistence", { windows: [], note: "insufficient coterminal history for ≥2 non-overlapping windows" });
  } else {
    const n = persistenceResult.windows.length;
    const rho = persistenceResult.percentileLag1Autocorr;
    // Bartlett (1946) SE for ρ̂_1 under the white-noise null: 1/sqrt(n).
    // 95% CI via Fisher z-transform truncated to [-1, 1].
    const se = 1 / Math.sqrt(n);
    const ciLow = Math.max(-1, rho - 1.96 * se);
    const ciHigh = Math.min(1, rho + 1.96 * se);
    NUMBERS.PersistenceNWindows = String(n);
    NUMBERS.PersistenceAutoCorr = fmtNum(rho, 3);
    NUMBERS.PersistenceAutoCorrSE = fmtNum(se, 3);
    NUMBERS.PersistenceAutoCorrCILow = fmtNum(ciLow, 3);
    NUMBERS.PersistenceAutoCorrCIHigh = fmtNum(ciHigh, 3);
    NUMBERS.PersistenceJaccard = fmtNum(persistenceResult.jaccardAdjacentMean, 3);
    NUMBERS.PersistenceMeanPercentile = `${(persistenceResult.percentileConcentratedMean * 100).toFixed(0)}`;
    NUMBERS.PersistenceIllusionGapMean = fmtNum(persistenceResult.illusionGapMean, 3);
    NUMBERS.PersistenceMVBeatsEQFrac = `${(persistenceResult.mvBeatsEqWeightFrac * 100).toFixed(0)}\\%`;
    const first = persistenceResult.windows[0];
    const last = persistenceResult.windows[persistenceResult.windows.length - 1];
    NUMBERS.PersistenceTrainStart = first.trainStart;
    NUMBERS.PersistenceTrainEnd = first.trainEnd;
    NUMBERS.PersistenceTestStart = last.testStart;
    NUMBERS.PersistenceTestEnd = last.testEnd;
    await writeJSON("persistence", persistenceResult);
  }

  // ── Black-Litterman top-15 ────────────────────────────────────────────
  console.log("[Black-Litterman] top-15 IBOV, δ=2.5, τ=0.05...");
  const top15 = ibov.members
    .filter((m) => prices.series[m.ticker])
    .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
    .slice(0, 15);
  const tight15 = tightenUniverseForHistory(
    prices,
    top15.map((m) => m.ticker),
    top15.map((m) => m.weight ?? 0),
    required5y,
  );
  const wMktSum = tight15.weights.reduce((s, w) => s + w, 0);
  const wMkt15 = wMktSum > 0 ? tight15.weights.map((w) => w / wMktSum) : new Array<number>(tight15.tickers.length).fill(1 / tight15.tickers.length);
  const built15 = buildCoterminalReturns(prices, tight15.tickers, tight15.startIdx, null);
  if (!built15) throw new Error("buildCoterminalReturns top15 returned null");
  const win15 = built15.X.length > required5y ? built15.X.slice(-required5y) : built15.X;
  const T15 = win15.length;
  const N15 = win15[0].length;
  const lw15 = ledoitWolf(win15);
  const sigAnn15 = lw15.sigma.map((row) => row.map((v) => v * 252));
  const meanLog15 = new Array<number>(N15).fill(0);
  for (const row of win15) for (let i = 0; i < N15; i++) meanLog15[i] += row[i];
  for (let i = 0; i < N15; i++) meanLog15[i] /= T15;
  const muSimple15 = jensenCorrectMu(meanLog15, lw15.sigma);
  const muRawAnn15 = muSimple15.map((m) => m * 252);
  const js15 = jorionShrinkMu(muRawAnn15, sigAnn15, T15);
  const macro15 = applyMacroAnchor(js15.mu, rf, T15);
  const piVec = impliedReturns(sigAnn15, wMkt15, 2.5);
  const blOut = blackLitterman({
    sigma: sigAnn15,
    wMkt: wMkt15,
    delta: 2.5,
    tau: 0.05,
  });
  const mvFr15 = buildFrontier(macro15.mu, sigAnn15, rf, { longOnly: true, cloudSize: 0, frontierSteps: 12 });
  const blFr15 = buildFrontier(blOut.muBL, blOut.sigmaBL, rf, { longOnly: true, cloudSize: 0, frontierSteps: 12 });
  const wMv15 = mvFr15.maxSharpe.weights;
  const wBl15 = blFr15.maxSharpe.weights;
  const l1Mv = wMv15.reduce((s, w, i) => s + Math.abs(w - wMkt15[i]), 0) / 2;
  const l1Bl = wBl15.reduce((s, w, i) => s + Math.abs(w - wMkt15[i]), 0) / 2;
  NUMBERS.BLUniverseN = String(N15);
  NUMBERS.BLDelta = "2,5";
  NUMBERS.BLTau = "0,05";
  NUMBERS.BLPiMin = fmtPctAA(Math.min(...piVec), 2);
  NUMBERS.BLPiMax = fmtPctAA(Math.max(...piVec), 2);
  NUMBERS.BLMuMin = fmtPctAA(Math.min(...macro15.mu), 2);
  NUMBERS.BLMuMax = fmtPctAA(Math.max(...macro15.mu), 2);
  // `BLL1*` would collide with LaTeX (digit inside \newcommand name); use word form.
  NUMBERS.BLLOneMv = fmtPctAA(l1Mv, 1);
  NUMBERS.BLLOneBl = fmtPctAA(l1Bl, 1);
  NUMBERS.BLMvZeros = String(wMv15.filter((w) => w < 0.005).length);
  NUMBERS.BLBlZeros = String(wBl15.filter((w) => w < 0.005).length);
  await writeJSON("bl", {
    tickers: tight15.tickers,
    wMkt: wMkt15,
    pi: piVec,
    muShrunk: macro15.mu,
    muRaw: muRawAnn15,
    wMv: wMv15,
    wBl: wBl15,
    delta: 2.5,
    tau: 0.05,
    l1Mv,
    l1Bl,
  });

  // ── Paridade de Risco top-15 ──────────────────────────────────────────
  console.log("[Paridade] ERC, inv-vol, 1/N, MV...");
  const wErc = equalRiskContribution(sigAnn15, undefined, { tol: 1e-9, maxSweeps: 500 });
  const wInv = inverseVolatilityWeights(sigAnn15);
  const wEq15 = new Array<number>(N15).fill(1 / N15);
  const rcErc = riskContributions(wErc, sigAnn15);
  const rcInv = riskContributions(wInv, sigAnn15);
  const rcEq = riskContributions(wEq15, sigAnn15);
  const rcMv = riskContributions(wMv15, sigAnn15);
  function hhi(arr: number[]): number {
    let s = 0;
    for (const x of arr) s += x * x;
    return s;
  }
  const strategies = [
    { name: "ERC", w: wErc, vol: rcErc.vol, hhi: hhi(rcErc.rc), maxRC: Math.max(...rcErc.rc), minRC: Math.min(...rcErc.rc), rc: rcErc.rc, ret: evaluatePortfolio(wErc, macro15.mu, sigAnn15, rf).ret, sharpe: evaluatePortfolio(wErc, macro15.mu, sigAnn15, rf).sharpe },
    { name: "InvVol", w: wInv, vol: rcInv.vol, hhi: hhi(rcInv.rc), maxRC: Math.max(...rcInv.rc), minRC: Math.min(...rcInv.rc), rc: rcInv.rc, ret: evaluatePortfolio(wInv, macro15.mu, sigAnn15, rf).ret, sharpe: evaluatePortfolio(wInv, macro15.mu, sigAnn15, rf).sharpe },
    { name: "EqualWeight", w: wEq15, vol: rcEq.vol, hhi: hhi(rcEq.rc), maxRC: Math.max(...rcEq.rc), minRC: Math.min(...rcEq.rc), rc: rcEq.rc, ret: evaluatePortfolio(wEq15, macro15.mu, sigAnn15, rf).ret, sharpe: evaluatePortfolio(wEq15, macro15.mu, sigAnn15, rf).sharpe },
    { name: "Markowitz", w: wMv15, vol: rcMv.vol, hhi: hhi(rcMv.rc), maxRC: Math.max(...rcMv.rc), minRC: Math.min(...rcMv.rc), rc: rcMv.rc, ret: evaluatePortfolio(wMv15, macro15.mu, sigAnn15, rf).ret, sharpe: evaluatePortfolio(wMv15, macro15.mu, sigAnn15, rf).sharpe },
  ];
  for (const s of strategies) {
    const k = s.name;
    NUMBERS[`Pa${k}Vol`] = fmtPctAA(s.vol, 2);
    NUMBERS[`Pa${k}HHI`] = fmtNum(s.hhi, 4);
    NUMBERS[`Pa${k}MaxRC`] = fmtPctAA(s.maxRC, 1);
    NUMBERS[`Pa${k}MinRC`] = fmtPctAA(s.minRC, 1);
    NUMBERS[`Pa${k}Sharpe`] = fmtNum(s.sharpe, 3);
  }
  NUMBERS.PaERCFloor = fmtNum(1 / N15, 4);
  await writeJSON("paridade", {
    tickers: tight15.tickers,
    strategies,
  });

  // ── Write numbers.tex (LaTeX command definitions) ─────────────────────
  console.log("[numbers.tex] writing LaTeX command definitions...");
  const lines = [
    "% AUTO-GENERATED by app/scripts/export-wp01-data.ts — do NOT edit by hand.",
    "% Re-run via:  cd app && npx tsx scripts/export-wp01-data.ts",
    "%",
    `% Source data: ${prices.dates[0]} → ${prices.dates[prices.dates.length - 1]}`,
    `% Universe:    ${Object.keys(prices.series).length} tickers, IBOV ${ibov.members.length} members`,
    `% rf:          ${(rf * 100).toFixed(2)}\\% a.a.`,
    "%",
  ];
  for (const [k, v] of Object.entries(NUMBERS)) {
    lines.push(`\\newcommand{\\${k}}{${v}}`);
  }
  await writeFile(
    path.join(process.cwd(), "..", "articles", "numbers.tex"),
    lines.join("\n") + "\n",
    "utf-8",
  );

  await writeJSON("numbers", NUMBERS);
  console.log(`\n✓ Exported ${Object.keys(NUMBERS).length} numbers + 6 dataset JSONs`);
  console.log(`  ${OUT_ROOT}/`);
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
