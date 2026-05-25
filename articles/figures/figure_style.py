"""Applied Finance — editorial style for matplotlib.

Adapted from Mirante dos Dados' magazine-grade visual system (OWID /
Economist / Financial Times inspired). Hierarchical palette: ONE series
saturated as focus, others contextual gray. Wong fallback (color-blind
safe) when all series are equal in weight.
"""
import matplotlib as mpl
import matplotlib.pyplot as plt

PALETTE = {
    "principal":     "#0057A8",   # azul Applied Finance saturado — foco
    "contexto":      "#BABABA",   # cinza médio — séries de comparação
    "contexto_dark": "#7A7A7A",
    "destaque":      "#C0392B",   # vermelho-tijolo — alerta/anotação/limite
    "secundario":    "#1F8A6B",   # verde-floresta — segunda cor saturada
    "terciario":     "#E67E22",   # laranja — terceira cor (cuidado, baixa freq)
    "neutro":        "#3D3D3D",
    "neutro_soft":   "#555555",
    "rule":          "#E5E5E5",
    "rule_dark":     "#CCCCCC",
    "bg":            "#FFFFFF",
}

WONG = ["#0173B2", "#DE8F05", "#029E73", "#D55E00",
        "#CC78BC", "#CA9161", "#56B4E9", "#F0E442"]

# Proporção áurea — figuras respiram
GOLDEN_FIGSIZE        = (10.0, 6.18)
GOLDEN_FIGSIZE_TALL   = (7.5, 9.0)
GOLDEN_FIGSIZE_SQUARE = (7.5, 7.5)
GOLDEN_FIGSIZE_WIDE   = (12.0, 6.0)


def apply_style():
    plt.rcParams.update({
        "font.family":      "sans-serif",
        "font.sans-serif":  ["Lato", "Inter", "Source Sans Pro",
                             "Helvetica Neue", "DejaVu Sans"],
        "font.size":        10,

        "axes.titlesize":     12,
        "axes.titleweight":   "bold",
        "axes.titlelocation": "left",
        "axes.titlepad":      14,
        "axes.titlecolor":    PALETTE["neutro"],

        "axes.labelsize":   10,
        "axes.labelcolor":  PALETTE["neutro"],
        "axes.labelpad":    8,

        "axes.facecolor":     PALETTE["bg"],
        "axes.edgecolor":     PALETTE["neutro"],
        "axes.linewidth":     0.7,
        "axes.spines.top":    False,
        "axes.spines.right":  False,

        "axes.grid":          True,
        "axes.grid.axis":     "y",
        "axes.axisbelow":     True,
        "grid.color":         PALETTE["rule"],
        "grid.linewidth":     0.6,
        "grid.linestyle":     "-",
        "grid.alpha":         1.0,

        "xtick.direction":   "out",
        "ytick.direction":   "out",
        "xtick.color":       PALETTE["neutro"],
        "ytick.color":       PALETTE["neutro"],
        "xtick.labelsize":   9,
        "ytick.labelsize":   9,
        "xtick.major.width": 0.7,
        "ytick.major.width": 0,
        "xtick.major.size":  4,
        "ytick.major.size":  0,
        "xtick.major.pad":   5,
        "ytick.major.pad":   5,

        "legend.frameon":         False,
        "legend.fontsize":        9,
        "legend.title_fontsize":  9.5,

        "figure.facecolor":   PALETTE["bg"],
        "figure.dpi":         200,
        "savefig.dpi":        300,
        "savefig.bbox":       "tight",
        "savefig.pad_inches": 0.2,
        "savefig.facecolor":  PALETTE["bg"],

        "lines.linewidth":  2.0,
        "lines.markersize": 6,
        "patch.linewidth":  0,
        "patch.edgecolor":  "white",

        "axes.prop_cycle": mpl.cycler(color=WONG),
    })


def editorial_title(ax, title, subtitle=None, source=None):
    """OWID-style title positioned above axes, with optional subtitle + source."""
    ax.set_title("")  # disable matplotlib's title; we draw text manually
    fig = ax.figure
    fig.suptitle(title, x=0.02, y=0.985, ha="left", fontsize=14,
                 fontweight="bold", color=PALETTE["neutro"])
    if subtitle:
        fig.text(0.02, 0.945, subtitle, ha="left", fontsize=10.5,
                 color=PALETTE["neutro_soft"], style="italic")
    if source:
        fig.text(0.02, 0.005, source, ha="left", fontsize=8,
                 color=PALETTE["neutro_soft"])
