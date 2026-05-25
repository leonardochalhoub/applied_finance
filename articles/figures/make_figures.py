"""Generate all matplotlib figures for WP01 v2.

Reads canonical data from ../data/*.json (produced by
app/scripts/export-wp01-data.ts) and writes 7 PDF figures alongside
this file.

Usage:
    cd articles/figures && python make_figures.py
"""
from __future__ import annotations

import json
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
from figure_style import (
    GOLDEN_FIGSIZE,
    GOLDEN_FIGSIZE_WIDE,
    PALETTE,
    apply_style,
    editorial_title,
)

HERE = Path(__file__).resolve().parent
DATA = HERE.parent / "data"
SOURCE = "Fonte: Applied Finance (Yahoo Finance · BCB SGS 12 · IBOV B3), 2026."


def load(name: str):
    with open(DATA / f"{name}.json") as f:
        return json.load(f)


apply_style()


# ────────────────────────────────────────────────────────────────────────
# Figure 1 — Markowitz canonical efficient frontier
# ────────────────────────────────────────────────────────────────────────
def fig_markowitz_frontier():
    mv = load("markowitz")
    rf = float(mv["rf"])
    fr = mv["frontier"]
    cloud = mv["cloud"]
    ms = mv["maxSharpe"]
    mvar = mv["minVariance"]
    tickers = mv["tickers"]
    mu_shrunk = mv["muShrunk"]
    sigma_diag = mv["sigmaDiag"]

    fig, ax = plt.subplots(figsize=GOLDEN_FIGSIZE)

    # 1. Random portfolio cloud — gray context, low alpha
    cx = [p["vol"] for p in cloud]
    cy = [p["ret"] for p in cloud]
    ax.scatter(cx, cy, s=8, color=PALETTE["contexto"], alpha=0.45,
               edgecolors="none", zorder=2,
               label=f"Carteiras long-only aleatórias ({len(cloud)} sorteios)")

    # 2. Frontier curve — saturated principal
    fx = [p["vol"] for p in fr]
    fy = [p["ret"] for p in fr]
    ax.plot(fx, fy, color=PALETTE["principal"], lw=2.5, zorder=4,
            label="Fronteira eficiente (long-only)")

    # 3. Per-asset dots labeled — for context
    for i, _t in enumerate(tickers):
        ax.scatter(sigma_diag[i], mu_shrunk[i], s=24,
                   color=PALETTE["secundario"], alpha=0.8,
                   edgecolors="white", linewidths=0.6, zorder=5)
    # Label only the top-5 picks of the tangency
    top5_idx = sorted(range(len(tickers)),
                      key=lambda i: -ms["weights"][i])[:5]
    for i in top5_idx:
        ax.annotate(tickers[i].replace(".SA", ""),
                    xy=(sigma_diag[i], mu_shrunk[i]),
                    xytext=(6, -2), textcoords="offset points",
                    fontsize=8, color=PALETTE["neutro"], zorder=6)

    # 4. Minimum-variance point — star
    ax.scatter([mvar["vol"]], [mvar["ret"]], s=160, marker="*",
               color=PALETTE["neutro"], edgecolors="white", linewidths=1.0,
               zorder=7, label="Mínima variância")

    # 5. Tangency / max-Sharpe point — large gold star
    ax.scatter([ms["vol"]], [ms["ret"]], s=240, marker="*",
               color=PALETTE["destaque"], edgecolors="white", linewidths=1.2,
               zorder=8, label="Tangência (máx. Sharpe)")

    # 6. CAL (capital allocation line) — from (0, rf) through tangency
    x_max = max(max(fx), max(cx), ms["vol"]) * 1.15
    slope = (ms["ret"] - rf) / ms["vol"]
    cal_x = np.linspace(0, x_max, 50)
    cal_y = rf + slope * cal_x
    ax.plot(cal_x, cal_y, color=PALETTE["destaque"], lw=1.6, ls="--",
            alpha=0.85, zorder=6,
            label=f"CAL · Sharpe = {ms['sharpe']:.2f}")

    # 7. rf marker on Y-axis
    ax.axhline(y=rf, color=PALETTE["contexto_dark"], lw=0.8, ls=":",
               zorder=1)
    ax.annotate(f"$r_f$ = {rf*100:.2f}%", xy=(0, rf), xytext=(4, 6),
                textcoords="offset points", fontsize=9,
                color=PALETTE["neutro_soft"], zorder=9)

    # Axes
    ax.set_xlim(left=0, right=x_max)
    ax.set_ylim(bottom=min(0, min(fy), min(cy)) - 0.02,
                top=max(max(fy), ms["ret"]) + 0.06)
    ax.set_xlabel("Volatilidade anualizada $\\sigma$")
    ax.set_ylabel("Retorno esperado anualizado $E[r]$")
    ax.xaxis.set_major_formatter(plt.FuncFormatter(lambda x, _: f"{x*100:.0f}%"))
    ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda y, _: f"{y*100:.0f}%"))
    # Legend at bottom-right
    ax.legend(loc="lower right", fontsize=9)

    editorial_title(ax,
        title="Fronteira eficiente de Markowitz · top-30 IBOV",
        subtitle=f"Janela {mv['periodStart']} → {mv['periodEnd']} ({mv['T']} dias úteis); pipeline Ledoit-Wolf + Jorion + macro-anchor.",
        source=SOURCE)
    fig.subplots_adjust(top=0.88, bottom=0.10)
    fig.savefig(HERE / "fig01_markowitz_frontier.pdf")
    plt.close(fig)
    print("  ✓ fig01_markowitz_frontier.pdf")


# ────────────────────────────────────────────────────────────────────────
# Figure 2 — Walk-forward Markowitz vs 1/N wealth curve
# ────────────────────────────────────────────────────────────────────────
def fig_ingenuo_wealth():
    ing = load("ingenuo")
    series = ing["series"]
    dates = [p["date"] for p in series]
    mv = [1 + p["markowitz"] for p in series]
    eq = [1 + p["equalWeight"] for p in series]

    fig, ax = plt.subplots(figsize=GOLDEN_FIGSIZE)
    x = np.arange(len(dates))
    ax.plot(x, mv, color=PALETTE["principal"], lw=2.5,
            label=f"Markowitz · Sharpe = {ing['summary']['markowitz']['sharpe']:.2f}")
    ax.plot(x, eq, color=PALETTE["destaque"], lw=2.0, ls="--",
            label=f"1/N · Sharpe = {ing['summary']['equalWeight']['sharpe']:.2f}")
    ax.axhline(1.0, color=PALETTE["contexto_dark"], lw=0.8, ls=":", zorder=1)

    # X-axis ticks: every 2nd period
    tick_idx = [*range(0, len(dates), 2), len(dates) - 1]
    tick_idx = sorted(set(tick_idx))
    ax.set_xticks(tick_idx)
    ax.set_xticklabels([dates[i][:7] for i in tick_idx], rotation=30, ha="right")

    ax.set_ylabel("Riqueza acumulada (base R\\$ 1{,}00)")
    ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda y, _: f"{y:.2f}"))
    ax.legend(loc="upper left")

    editorial_title(ax,
        title="Walk-forward 3 anos treino / 1 trimestre teste · Markowitz vs 1/N",
        subtitle=f"{ing['trainDays']}d treino, {ing['testDays']}d teste, {len(series)} rebalanceamentos.",
        source=SOURCE)
    fig.subplots_adjust(top=0.88, bottom=0.13)
    fig.savefig(HERE / "fig02_ingenuo_wealth.pdf")
    plt.close(fig)
    print("  ✓ fig02_ingenuo_wealth.pdf")


# ────────────────────────────────────────────────────────────────────────
# Figure 3 — Per-period scatter Markowitz vs 1/N
# ────────────────────────────────────────────────────────────────────────
def fig_ingenuo_scatter():
    ing = load("ingenuo")
    series = ing["series"]
    eq_p = [100 * p["equalWeightPeriodReturn"] for p in series]
    mv_p = [100 * p["markowitzPeriodReturn"] for p in series]
    wins = [p["markowitzPeriodReturn"] > p["equalWeightPeriodReturn"] for p in series]

    fig, ax = plt.subplots(figsize=GOLDEN_FIGSIZE)
    span = max(max(map(abs, eq_p)), max(map(abs, mv_p))) * 1.15

    # 45° diagonal
    diag = np.linspace(-span, span, 50)
    ax.plot(diag, diag, color=PALETTE["contexto_dark"], lw=1.0, ls="--",
            zorder=1)
    ax.axhline(0, color=PALETTE["contexto"], lw=0.5, zorder=0)
    ax.axvline(0, color=PALETTE["contexto"], lw=0.5, zorder=0)

    win_x = [eq_p[i] for i, w in enumerate(wins) if w]
    win_y = [mv_p[i] for i, w in enumerate(wins) if w]
    lose_x = [eq_p[i] for i, w in enumerate(wins) if not w]
    lose_y = [mv_p[i] for i, w in enumerate(wins) if not w]

    ax.scatter(win_x, win_y, s=80, color=PALETTE["secundario"], alpha=0.85,
               edgecolors="white", linewidths=0.8, zorder=4,
               label=f"Markowitz venceu (n={sum(wins)})")
    ax.scatter(lose_x, lose_y, s=80, color=PALETTE["destaque"], alpha=0.85,
               edgecolors="white", linewidths=0.8, zorder=4,
               label=f"1/N venceu (n={len(wins) - sum(wins)})")

    ax.set_xlim(-span, span)
    ax.set_ylim(-span, span)
    ax.set_aspect("equal")
    ax.set_xlabel("Retorno 1/N por período (\\%)")
    ax.set_ylabel("Retorno Markowitz por período (\\%)")
    ax.legend(loc="upper left")

    editorial_title(ax,
        title="Retornos por rebalanceamento · pontos acima da diagonal = Markowitz venceu",
        subtitle="Cada ponto = um trimestre de teste; diagonal = empate.",
        source=SOURCE)
    fig.subplots_adjust(top=0.88, bottom=0.10)
    fig.savefig(HERE / "fig03_ingenuo_scatter.pdf")
    plt.close(fig)
    print("  ✓ fig03_ingenuo_scatter.pdf")


# ────────────────────────────────────────────────────────────────────────
# Figure 4 — Kahneman dual-null histograms (Dirichlet vs Concentrated K)
# ────────────────────────────────────────────────────────────────────────
def fig_kahneman_histograms():
    kh = load("kahneman")
    dn = kh["dirichletNull"]
    cn = kh["concentratedNull"]
    k = kh["concentrationK"]
    ex_ante = float(kh["markowitzExAnte"]["sharpe"])
    ex_post = float(kh["markowitzExPost"]["sharpe"])
    eq = float(kh["equalWeight"]["sharpe"])
    median_dir = float(dn["median"])
    median_con = float(cn["median"])

    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(10, 8), sharex=True)

    def hist_panel(ax, hist, title, median_val, label):
        edges = [b["binStart"] for b in hist] + [hist[-1]["binEnd"]]
        counts = [b["count"] for b in hist]
        ax.stairs(counts, edges, fill=True, color=PALETTE["contexto"],
                  alpha=0.55, edgecolor="white", linewidth=0.4, zorder=2)
        # Reference area shading = support
        ax.axvspan(edges[0], edges[-1], facecolor=PALETTE["rule"],
                   alpha=0.35, zorder=1)
        # 4 reference lines
        ax.axvline(median_val, color=PALETTE["contexto_dark"], lw=1.2,
                   ls="dotted", zorder=3,
                   label=f"mediana sorteio = {median_val:.2f}")
        ax.axvline(eq, color=PALETTE["secundario"], lw=2.0, ls="--",
                   zorder=4, label=f"1/N = {eq:.2f}")
        ax.axvline(ex_post, color=PALETTE["principal"], lw=3.0, zorder=6,
                   label=f"Markowitz ex-post = {ex_post:.2f}")
        ax.axvline(ex_ante, color=PALETTE["destaque"], lw=2.5, ls="--",
                   zorder=5, label=f"Markowitz ex-ante = {ex_ante:.2f}")
        ax.set_ylabel("nº de carteiras")
        ax.set_title(title, loc="left", fontsize=11, fontweight="bold",
                     color=PALETTE["neutro"], pad=8)
        ax.legend(loc="upper right", fontsize=8)

    hist_panel(ax1, dn["histogram"],
               "(a) Null Dirichlet(1) · carteiras DIVERSIFICADAS sobre 30 ativos",
               median_dir, "Dirichlet")
    hist_panel(ax2, cn["histogram"],
               f"(b) Null Kahneman-friendly · carteiras CONCENTRADAS em K={k} ativos sorteados",
               median_con, "Concentrated")
    ax2.set_xlabel("Sharpe realizada (janela de teste)")

    editorial_title(ax1,
        title="Ilusão de skill · Markowitz vs dois nulls aleatórios",
        subtitle=f"5.000 carteiras sorteadas em cada null; treino {kh['trainStart']}-{kh['trainEnd']}, teste {kh['testStart']}-{kh['testEnd']}.",
        source=SOURCE)
    fig.subplots_adjust(top=0.90, bottom=0.08, hspace=0.32)
    fig.savefig(HERE / "fig04_kahneman_histograms.pdf")
    plt.close(fig)
    print("  ✓ fig04_kahneman_histograms.pdf")


# ────────────────────────────────────────────────────────────────────────
# Figure 5 — Kahneman rolling persistence
# ────────────────────────────────────────────────────────────────────────
def fig_persistence():
    p = load("persistence")
    windows = p.get("windows", [])
    if not windows:
        # Stub figure when insufficient history
        fig, ax = plt.subplots(figsize=GOLDEN_FIGSIZE)
        ax.text(0.5, 0.5,
                "Histórico coterminal insuficiente para ≥ 2 janelas\nnão-sobrepostas com 2y treino + 2y teste.\n\nÉ uma limitação da cobertura Yahoo do top-30 IBOV\n(13 constituintes ausentes; ver Seção 6).",
                ha="center", va="center", fontsize=11,
                color=PALETTE["neutro_soft"], transform=ax.transAxes)
        ax.set_xticks([])
        ax.set_yticks([])
        for sp in ax.spines.values():
            sp.set_visible(False)
        editorial_title(ax,
            title="Teste de persistência (Kahneman 1984) · janelas rolantes",
            subtitle="(figura indisponível com dados atuais)",
            source=SOURCE)
        fig.savefig(HERE / "fig05_persistence.pdf")
        plt.close(fig)
        print("  ✓ fig05_persistence.pdf (stub)")
        return

    labels = [w["testStart"][:7] for w in windows]
    pcts = [100 * w["percentileConcentrated"] for w in windows]

    fig, ax = plt.subplots(figsize=GOLDEN_FIGSIZE_WIDE)
    x = np.arange(len(windows))
    ax.axhline(50, color=PALETTE["neutro"], lw=1.0, ls="--", zorder=1,
               label="50º = mediana (Kahneman: sem skill)")
    ax.plot(x, pcts, color=PALETTE["principal"], lw=2.5,
            marker="o", markersize=7, zorder=4,
            label="Percentil Markowitz · null concentrada")

    # Annotate each window
    for xi, yi in zip(x, pcts, strict=True):
        ax.annotate(f"{yi:.0f}º", xy=(xi, yi), xytext=(0, 10),
                    textcoords="offset points", ha="center",
                    fontsize=8.5, color=PALETTE["neutro"])

    ax.set_xticks(x)
    ax.set_xticklabels(labels, rotation=30, ha="right")
    ax.set_ylim(0, 100)
    ax.set_ylabel("Percentil da Sharpe ex-post (null concentrada)")
    ax.set_xlabel("Início da janela de teste")
    ax.legend(loc="lower left")

    autocorr = p.get("percentileLag1Autocorr", 0.0)
    jaccard = p.get("jaccardAdjacentMean", 0.0)
    verdict = (
        "≈ 0 → SEM persistência (Kahneman vindicado)"
        if abs(autocorr) < 0.20
        else ("Persistência positiva" if autocorr > 0 else "Anti-persistência")
    )
    editorial_title(ax,
        title=f"Persistência de Markowitz em {len(windows)} janelas rolantes não-sobrepostas",
        subtitle=f"Autocorrelação lag-1 = {autocorr:+.3f}  ·  Jaccard médio dos picks = {jaccard:.2f}  ·  Veredito: {verdict}",
        source=SOURCE)
    fig.subplots_adjust(top=0.88, bottom=0.16)
    fig.savefig(HERE / "fig05_persistence.pdf")
    plt.close(fig)
    print("  ✓ fig05_persistence.pdf")


# ────────────────────────────────────────────────────────────────────────
# Figure 6 — Black-Litterman: Π vs μ̂ + weights comparison
# ────────────────────────────────────────────────────────────────────────
def fig_bl_weights():
    bl = load("bl")
    tickers = [t.replace(".SA", "") for t in bl["tickers"]]
    pi = [100 * x for x in bl["pi"]]
    mu = [100 * x for x in bl["muShrunk"]]
    w_mkt = [100 * x for x in bl["wMkt"]]
    w_mv = [100 * x for x in bl["wMv"]]
    w_bl = [100 * x for x in bl["wBl"]]

    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(10, 9), sharex=True)
    x = np.arange(len(tickers))
    w = 0.4
    # Top: Π (gray) vs μ̂_shrunk (saturated)
    ax1.bar(x - w/2, pi, width=w, color=PALETTE["contexto"],
            label="$\\Pi$ implícito (CAPM-equilíbrio)")
    ax1.bar(x + w/2, mu, width=w, color=PALETTE["principal"],
            label="$\\hat\\mu$ amostral encolhido")
    ax1.set_ylabel("Retorno esperado anualizado (\\%)")
    ax1.legend(loc="upper right")
    ax1.set_title("(a) Retornos implícitos pelo equilíbrio ($\\Pi$) vs amostral shrunken ($\\hat\\mu$)",
                  loc="left", fontsize=11, fontweight="bold",
                  color=PALETTE["neutro"], pad=8)

    # Bottom: 3-way weights comparison
    bar_w = 0.27
    ax2.bar(x - bar_w, w_mkt, width=bar_w, color=PALETTE["contexto"],
            label="Mercado (IBOV)")
    ax2.bar(x, w_mv, width=bar_w, color=PALETTE["destaque"],
            label=f"Markowitz puro ($L^1/2 = {bl['l1Mv']*100:.0f}\\%$)")
    ax2.bar(x + bar_w, w_bl, width=bar_w, color=PALETTE["principal"],
            label=f"Black-Litterman ($L^1/2 = {bl['l1Bl']*100:.0f}\\%$)")
    ax2.set_ylabel("Peso na carteira (\\%)")
    ax2.set_title("(b) Comparação de pesos: Mercado vs Markowitz vs Black-Litterman (sem views)",
                  loc="left", fontsize=11, fontweight="bold",
                  color=PALETTE["neutro"], pad=8)
    ax2.legend(loc="upper right")
    ax2.set_xticks(x)
    ax2.set_xticklabels(tickers, rotation=45, ha="right", fontsize=8.5)

    editorial_title(ax1,
        title="Black-Litterman · ancoragem ao equilíbrio CAPM",
        subtitle="Universo top-15 IBOV; $\\delta=2{,}5$; $\\tau=0{,}05$; sem views.",
        source=SOURCE)
    fig.subplots_adjust(top=0.91, bottom=0.10, hspace=0.40)
    fig.savefig(HERE / "fig06_bl_weights.pdf")
    plt.close(fig)
    print("  ✓ fig06_bl_weights.pdf")


# ────────────────────────────────────────────────────────────────────────
# Figure 7 — Paridade de Risco: risk contributions per strategy
# ────────────────────────────────────────────────────────────────────────
def fig_paridade_rc():
    pa = load("paridade")
    tickers = [t.replace(".SA", "") for t in pa["tickers"]]
    strats = {s["name"]: s for s in pa["strategies"]}
    n = len(tickers)
    target_rc = 100 / n

    fig, ax = plt.subplots(figsize=GOLDEN_FIGSIZE_WIDE)
    x = np.arange(n)
    w = 0.21
    ax.bar(x - 1.5*w, [100*r for r in strats["ERC"]["rc"]], width=w,
           color=PALETTE["principal"],
           label=f"ERC ($\\sigma$ = {strats['ERC']['vol']*100:.1f}\\%; HHI = {strats['ERC']['hhi']:.3f})")
    ax.bar(x - 0.5*w, [100*r for r in strats["InvVol"]["rc"]], width=w,
           color=PALETTE["secundario"],
           label=f"Inv-vol ($\\sigma$ = {strats['InvVol']['vol']*100:.1f}\\%; HHI = {strats['InvVol']['hhi']:.3f})")
    ax.bar(x + 0.5*w, [100*r for r in strats["EqualWeight"]["rc"]], width=w,
           color=PALETTE["contexto_dark"],
           label=f"1/N ($\\sigma$ = {strats['EqualWeight']['vol']*100:.1f}\\%; HHI = {strats['EqualWeight']['hhi']:.3f})")
    ax.bar(x + 1.5*w, [100*r for r in strats["Markowitz"]["rc"]], width=w,
           color=PALETTE["destaque"],
           label=f"Markowitz ($\\sigma$ = {strats['Markowitz']['vol']*100:.1f}\\%; HHI = {strats['Markowitz']['hhi']:.3f})")

    # Horizontal reference line at 1/N target
    ax.axhline(target_rc, color=PALETTE["neutro"], lw=1.0, ls="--",
               zorder=1,
               label=f"Meta ERC = 1/N = {target_rc:.1f}\\%")

    ax.set_xticks(x)
    ax.set_xticklabels(tickers, rotation=45, ha="right", fontsize=8.5)
    ax.set_ylabel("Contribuição de risco RC$_i$ (\\% da variância)")
    ax.legend(loc="upper left", fontsize=8.5)

    editorial_title(ax,
        title="Contribuição de risco por ativo · ERC vs Inv-vol vs 1/N vs Markowitz",
        subtitle="Linha tracejada = meta ERC (1/N). Markowitz concentra risco em PETR4 e PETR3.",
        source=SOURCE)
    fig.subplots_adjust(top=0.88, bottom=0.17)
    fig.savefig(HERE / "fig07_paridade_rc.pdf")
    plt.close(fig)
    print("  ✓ fig07_paridade_rc.pdf")


# ────────────────────────────────────────────────────────────────────────
def main():
    print("─── WP01 v2 figures ───")
    fig_markowitz_frontier()
    fig_ingenuo_wealth()
    fig_ingenuo_scatter()
    fig_kahneman_histograms()
    fig_persistence()
    fig_bl_weights()
    fig_paridade_rc()
    print("Done.")


if __name__ == "__main__":
    main()
