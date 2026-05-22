import katex from "katex";

/** Server-side KaTeX renderer. Produces inline HTML at build time — no client
 *  JS, no FOUC, no extra request. Used for the McLean equation and any other
 *  math we surface (Markowitz, Sharpe formulae, etc.).
 *
 *  Caller is expected to import `katex/dist/katex.min.css` in the parent
 *  layout (or page) so the glyphs render with proper fonts/spacing. */
export function BlockMath({ tex, ariaLabel }: { tex: string; ariaLabel?: string }) {
  const html = katex.renderToString(tex, {
    displayMode: true,
    throwOnError: false,
    output: "html",
    strict: "ignore",
  });
  return (
    <div
      className="katex-display-container my-2 overflow-x-auto"
      role="math"
      aria-label={ariaLabel ?? tex}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function InlineMath({ tex, ariaLabel }: { tex: string; ariaLabel?: string }) {
  const html = katex.renderToString(tex, {
    displayMode: false,
    throwOnError: false,
    output: "html",
    strict: "ignore",
  });
  return (
    <span
      className="katex-inline"
      role="math"
      aria-label={ariaLabel ?? tex}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
