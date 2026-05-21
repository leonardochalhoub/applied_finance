import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "Applied Finance — Análise do Mercado Acionário Brasileiro",
  description:
    "Plataforma aberta e gratuita de análise do mercado acionário brasileiro. KPIs, comparação setorial, correlações, Markowitz e visão IBOV.",
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
        <main className="mx-auto max-w-7xl px-6 py-10">{children}</main>
        <footer className="mt-24 border-t border-border">
          <div className="mx-auto flex max-w-7xl flex-col gap-2 px-6 py-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
            <p>
              Dados via <span className="mono">yfr_py</span> · Lakehouse no
              Databricks Free · Estático no GitHub Pages
            </p>
            <p className="mono">
              <a
                className="hover:text-strong"
                href="https://github.com/leonardochalhoub/applied_finance"
              >
                github.com/leonardochalhoub/applied_finance
              </a>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
