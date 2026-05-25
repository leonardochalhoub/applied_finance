import "./globals.css";
import "katex/dist/katex.min.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Footer } from "@/components/Footer";
import { Nav } from "@/components/Nav";
import { withBase } from "@/lib/links";

export const metadata: Metadata = {
  title: "Applied Finance — Análise do Mercado Acionário Brasileiro",
  description:
    "Plataforma aberta e gratuita de análise do mercado acionário brasileiro. KPIs, comparação setorial, correlações, Markowitz e visão IBOV.",
  // Absolute URLs on GH Pages must include the base path (/applied_finance) —
  // Next.js does NOT auto-prefix paths inside the `icons` metadata block the
  // way it does <Link href>. Wrap with `withBase` so prod and dev both work.
  icons: {
    icon: [{ url: withBase("/icon.svg"), type: "image/svg+xml" }],
    apple: withBase("/apple-touch-icon.svg"),
  },
};

const THEME_BOOTSTRAP = `
(function () {
  try {
    var t = localStorage.getItem('theme');
    if (t !== 'light' && t !== 'dark') t = 'dark';
    document.documentElement.classList.toggle('dark', t === 'dark');
    document.documentElement.dataset.theme = t;
    var p = localStorage.getItem('palette');
    if (p !== 'cbsafe') p = 'default';
    document.documentElement.classList.toggle('cbsafe', p === 'cbsafe');
    document.documentElement.dataset.palette = p;
  } catch (e) {
    document.documentElement.classList.add('dark');
  }
})();
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>
        <header className="sticky-header relative">
          <Nav />
        </header>
        <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
