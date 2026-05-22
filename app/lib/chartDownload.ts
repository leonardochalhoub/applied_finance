/**
 * Download a Recharts SVG as a high-resolution PNG that respects the
 * current theme (dark/light mode). Inlines the current document's CSS
 * variables into the cloned SVG so `var(--accent)` etc. resolve standalone.
 */

const CSS_VARS = [
  "--bg-base",
  "--bg-elevated",
  "--bg-subtle",
  "--border",
  "--border-strong",
  "--strong",
  "--body",
  "--muted",
  "--accent",
  "--gain",
  "--loss",
];

const SVG_NS = "http://www.w3.org/2000/svg";

function rootStyleBlock(): { css: string; bg: string } {
  const cs = getComputedStyle(document.documentElement);
  const lines = CSS_VARS.map((v) => `${v}: ${cs.getPropertyValue(v).trim()};`).join("\n");
  const bg = cs.getPropertyValue("--bg-elevated").trim() || "#0a0a0a";
  return {
    css: `svg{${lines}}text{font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;}`,
    bg,
  };
}

export async function downloadSvgChart(
  container: HTMLElement | null,
  filename: string,
  format: "png" | "svg" = "png",
): Promise<void> {
  if (!container) throw new Error("container missing");
  const svg = container.querySelector<SVGSVGElement>("svg");
  if (!svg) throw new Error("no svg inside container");

  const { css, bg } = rootStyleBlock();
  const rect = svg.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) throw new Error("chart has zero size");

  const clone = svg.cloneNode(true) as SVGSVGElement;
  if (!clone.getAttribute("xmlns")) clone.setAttribute("xmlns", SVG_NS);
  clone.setAttribute("width", String(rect.width));
  clone.setAttribute("height", String(rect.height));

  const style = document.createElementNS(SVG_NS, "style");
  style.textContent = css;
  clone.insertBefore(style, clone.firstChild);

  const svgStr = new XMLSerializer().serializeToString(clone);

  if (format === "svg") {
    const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    triggerDownload(blob, filename.replace(/\.[^/.]+$/, ".svg"));
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const img = new Image();
    const svgBlob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    img.onload = () => {
      try {
        const scale = 2;
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(rect.width * scale);
        canvas.height = Math.round(rect.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          URL.revokeObjectURL(url);
          reject(new Error("canvas 2d ctx unavailable"));
          return;
        }
        ctx.scale(scale, scale);
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, rect.width, rect.height);
        ctx.drawImage(img, 0, 0, rect.width, rect.height);
        URL.revokeObjectURL(url);
        canvas.toBlob((b) => {
          if (!b) {
            reject(new Error("toBlob failed"));
            return;
          }
          triggerDownload(b, filename.replace(/\.[^/.]+$/, ".png"));
          resolve();
        }, "image/png");
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("svg image load failed"));
    };
    img.src = url;
  });
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
