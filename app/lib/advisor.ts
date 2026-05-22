/**
 * Deterministic portfolio advisor — rule-based "AI" that compares the user
 * portfolio against the Markowitz Max-Sharpe (tangency) portfolio and
 * generates actionable, sourced recommendations in pt-BR.
 *
 * Lives fully client-side, no external API calls, no hallucinations.
 */

import type { PortfolioPoint } from "./markowitz";

export type AdvisorInput = {
  tickers: string[];
  /** User weights, same order as tickers. Should sum to 1 (will be normalized). */
  userWeights: number[];
  /** Max-Sharpe optimal portfolio weights from same μ/Σ universe. */
  optimalWeights: number[];
  /** Risk-free (CDI) annual rate. */
  rf: number;
  /** Annualized expected returns per ticker (μ). */
  mu: number[];
  /** Annualized covariance matrix (Σ). */
  sigma: number[][];
  /** User portfolio summary statistics. */
  userPoint: PortfolioPoint;
  /** Optimal portfolio summary statistics. */
  optimalPoint: PortfolioPoint;
};

export type Recommendation = {
  /** Severity — colors the chip. */
  level: "good" | "warn" | "bad";
  /** Short title. */
  title: string;
  /** Detailed explanation, may include ticker references. */
  detail: string;
  /** Optional ticker for "action chip" link. */
  ticker?: string;
  /** Optional action verb: comprar / vender / reduzir / manter. */
  action?: "comprar" | "vender" | "reduzir" | "manter" | "adicionar";
};

export type AdvisorReport = {
  /** Overall verdict: forte / razoável / fraca. */
  verdict: "forte" | "razoável" | "fraca";
  /** Headline summary sentence. */
  headline: string;
  /** Numeric diagnostics. */
  diagnostics: {
    hhi: number;
    effectiveN: number;
    sharpeRatio: number;
    sharpeOptimal: number;
    sharpeGap: number;
    volRatio: number;
    retGap: number;
  };
  /** Ordered list of recommendations (most-impact first). */
  recommendations: Recommendation[];
};

/**
 * Normalize weights to sum to 1 (preserves negatives if present).
 */
function normalize(w: number[]): number[] {
  const sum = w.reduce((a, b) => a + b, 0);
  if (sum === 0) return w.slice();
  return w.map((x) => x / sum);
}

/**
 * Herfindahl-Hirschman Index = Σ wᵢ² · 10000. For long-only:
 *   - Single asset = 10000
 *   - Equal weight of N = 10000 / N
 * Lower = more diversified.
 */
function hhi(weights: number[]): number {
  return weights.reduce((s, w) => s + w * w, 0) * 10000;
}

/**
 * Effective number of holdings = 1 / Σ wᵢ². Inverse of HHI/10000.
 */
function effectiveN(weights: number[]): number {
  const sum2 = weights.reduce((s, w) => s + w * w, 0);
  return sum2 > 0 ? 1 / sum2 : 0;
}

/**
 * Marginal Sharpe contribution per ticker:
 *   ∂Sharpe / ∂wᵢ at current point — uses analytical gradient.
 * Positive ⇒ increasing wᵢ improves Sharpe; negative ⇒ reduce.
 */
function marginalSharpeContribution(
  weights: number[],
  mu: number[],
  sigma: number[][],
  rf: number,
): number[] {
  const n = weights.length;
  // portfolio return and variance
  let ret = 0;
  for (let i = 0; i < n; i++) ret += weights[i] * mu[i];
  const excess = ret - rf;
  // Σw
  const sigmaW = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) sigmaW[i] += sigma[i][j] * weights[j];
  }
  let variance = 0;
  for (let i = 0; i < n; i++) variance += weights[i] * sigmaW[i];
  const vol = Math.sqrt(Math.max(variance, 1e-12));
  // ∂Sharpe/∂wᵢ = (μᵢ - rf) / σ - (excess / σ³) · (Σw)ᵢ
  return mu.map((m, i) => (m - rf) / vol - (excess / (vol * vol * vol)) * sigmaW[i]);
}

export function analyze(input: AdvisorInput): AdvisorReport {
  const userW = normalize(input.userWeights);
  const optW = normalize(input.optimalWeights);
  const tickers = input.tickers;

  const userHHI = hhi(userW);
  const effN = effectiveN(userW);
  const sharpeUser = input.userPoint.sharpe;
  const sharpeOpt = input.optimalPoint.sharpe;
  const sharpeGap = sharpeOpt - sharpeUser;
  const volRatio = input.optimalPoint.vol > 0 ? input.userPoint.vol / input.optimalPoint.vol : 1;
  const retGap = input.userPoint.ret - input.optimalPoint.ret;

  const recommendations: Recommendation[] = [];

  // ── 1. Overall efficiency gap ─────────────────────────────────────────
  if (sharpeGap > 0.2) {
    recommendations.push({
      level: "warn",
      title: "Sua carteira está abaixo da fronteira eficiente",
      detail: `Sharpe atual ${sharpeUser.toFixed(2)} vs. ótimo Markowitz ${sharpeOpt.toFixed(2)}. ` +
        `Você está deixando ${(sharpeGap * 100).toFixed(0)} pontos-base de eficiência na mesa. ` +
        `Considere rebalancear na direção da carteira de máximo Sharpe (botão acima).`,
    });
  } else if (sharpeGap > 0.05) {
    recommendations.push({
      level: "good",
      title: "Carteira razoavelmente eficiente",
      detail: `Sharpe ${sharpeUser.toFixed(2)} está perto do ótimo (${sharpeOpt.toFixed(2)}). ` +
        `Pequenos ajustes podem extrair mais retorno por unidade de risco.`,
    });
  } else {
    recommendations.push({
      level: "good",
      title: "Carteira já próxima do ótimo",
      detail: `Sharpe ${sharpeUser.toFixed(2)} está dentro do esperado. ` +
        `Foque em disciplina de execução e rebalanceamento periódico.`,
    });
  }

  // ── 2. Concentration / diversification ────────────────────────────────
  if (effN < 3) {
    recommendations.push({
      level: "bad",
      title: "Concentração excessiva",
      detail: `Sua carteira tem efeito equivalente a ${effN.toFixed(1)} ativos (HHI ${userHHI.toFixed(0)}). ` +
        `Diversificação muito baixa amplifica risco idiossincrático. ` +
        `Considere distribuir entre 5+ ativos descorrelacionados.`,
    });
  } else if (effN < 5) {
    recommendations.push({
      level: "warn",
      title: "Diversificação moderada",
      detail: `Equivalente a ${effN.toFixed(1)} ativos efetivos. ` +
        `Ok para teses concentradas, mas aumente a diversificação se busca menor volatilidade.`,
    });
  } else {
    recommendations.push({
      level: "good",
      title: "Boa diversificação",
      detail: `Equivalente a ${effN.toFixed(1)} ativos efetivos — diluição saudável do risco idiossincrático.`,
    });
  }

  // ── 3. Per-ticker actions: vender / reduzir / aumentar / comprar ─────
  // Compare user weight vs optimal weight; gradient gives direction.
  const grad = marginalSharpeContribution(userW, input.mu, input.sigma, input.rf);
  const perTicker = tickers.map((t, i) => ({
    ticker: t,
    userW: userW[i],
    optW: optW[i],
    delta: optW[i] - userW[i],
    grad: grad[i],
  }));

  // Significant overweights (where user has too much vs optimal)
  const overweights = perTicker
    .filter((p) => p.delta < -0.05 && p.userW > 0.1)
    .sort((a, b) => a.delta - b.delta) // most negative first
    .slice(0, 3);

  for (const p of overweights) {
    const symbol = p.ticker.replace(/\.SA$/, "");
    recommendations.push({
      level: "warn",
      title: `Reduzir ${symbol}`,
      detail: `Você tem ${(p.userW * 100).toFixed(1)}% em ${symbol}, ` +
        `mas o ótimo Markowitz sugere apenas ${(p.optW * 100).toFixed(1)}%. ` +
        `Excesso de ${(Math.abs(p.delta) * 100).toFixed(1)} p.p. está custando eficiência. ` +
        `Considere realocar para tickers sub-ponderados.`,
      ticker: p.ticker,
      action: p.optW < 0.01 ? "vender" : "reduzir",
    });
  }

  // Significant underweights / missing tickers (optimal recommends but user doesn't have)
  const underweights = perTicker
    .filter((p) => p.delta > 0.05 && p.optW > 0.1)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 3);

  for (const p of underweights) {
    const symbol = p.ticker.replace(/\.SA$/, "");
    const verb = p.userW < 0.01 ? "adicionar" : "comprar";
    const verbText = p.userW < 0.01
      ? `Adicione ${symbol} à carteira: ótimo sugere ${(p.optW * 100).toFixed(1)}%, atualmente em 0%.`
      : `Aumente ${symbol} de ${(p.userW * 100).toFixed(1)}% para ${(p.optW * 100).toFixed(1)}%.`;
    recommendations.push({
      level: "good",
      title: `${verb === "adicionar" ? "Adicionar" : "Aumentar"} ${symbol}`,
      detail: `${verbText} O sub-investimento de ${(Math.abs(p.delta) * 100).toFixed(1)} p.p. ` +
        `está limitando seu retorno esperado em ${((p.delta * input.mu[tickers.indexOf(p.ticker)]) * 100).toFixed(2)}%.`,
      ticker: p.ticker,
      action: verb,
    });
  }

  // ── 4. Vol vs benchmark ───────────────────────────────────────────────
  if (volRatio > 1.4) {
    recommendations.push({
      level: "warn",
      title: "Volatilidade elevada",
      detail: `Sua vol. (${(input.userPoint.vol * 100).toFixed(1)}%) é ${((volRatio - 1) * 100).toFixed(0)}% ` +
        `maior que a do ótimo (${(input.optimalPoint.vol * 100).toFixed(1)}%) — sem ganho proporcional de retorno. ` +
        `Há ineficiência clara: mesmo risco poderia entregar mais retorno se realocado.`,
    });
  } else if (volRatio < 0.7 && retGap < -0.03) {
    recommendations.push({
      level: "good",
      title: "Perfil conservador detectado",
      detail: `Vol. (${(input.userPoint.vol * 100).toFixed(1)}%) bem menor que a ótima — ` +
        `você prioriza estabilidade. Considere se aceitaria volatilidade um pouco maior para ` +
        `recuperar ${Math.abs(retGap * 100).toFixed(1)} p.p. de retorno esperado anual.`,
    });
  }

  // ── 5. Verdict & headline ─────────────────────────────────────────────
  let verdict: AdvisorReport["verdict"];
  if (sharpeGap < 0.1 && effN >= 4) verdict = "forte";
  else if (sharpeGap < 0.3 && effN >= 3) verdict = "razoável";
  else verdict = "fraca";

  const headlineMap: Record<AdvisorReport["verdict"], string> = {
    forte: "Carteira bem construída e eficiente — pequenos ajustes opcionais.",
    razoável: "Carteira aceitável, mas com espaço claro para melhorar Sharpe ou diversificação.",
    fraca: "Carteira distante do ótimo de Markowitz — rebalanceamento recomendado.",
  };

  return {
    verdict,
    headline: headlineMap[verdict],
    diagnostics: {
      hhi: userHHI,
      effectiveN: effN,
      sharpeRatio: sharpeUser,
      sharpeOptimal: sharpeOpt,
      sharpeGap,
      volRatio,
      retGap,
    },
    recommendations,
  };
}
