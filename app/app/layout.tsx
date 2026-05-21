import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { ThemeToggle } from "@/components/ThemeToggle";

export const metadata: Metadata = {
  title: "Mercado BR — Análise do Mercado Acionário Brasileiro",
  description:
    "Plataforma aberta e gratuita de análise do mercado acionário brasileiro. KPIs, comparação setorial, correlações e visão IBOV.",
};

const THEME_BOOTSTRAP = `
(function () {
  try {
    var t = localStorage.getItem('theme');
    if (t !== 'light' && t !== 'dark') t = 'dark';
    document.documentElement.classList.toggle('dark', t === 'dark');
    document.documentElement.dataset.theme = t;
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
      <body className="bg-base text-strong">
        <header className="border-b border-border">
          <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <a href="/" className="font-mono text-sm font-semibold">
              mercado_br
            </a>
            <div className="flex items-center gap-6">
              <ul className="flex items-center gap-6 text-sm">
                <li><a href="/" className="hover:underline">Visão geral</a></li>
                <li><a href="/setores/" className="hover:underline">Setores</a></li>
                <li><a href="/correlacoes/" className="hover:underline">Correlações</a></li>
                <li><a href="/metodologia/" className="hover:underline">Metodologia</a></li>
              </ul>
              <ThemeToggle />
            </div>
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
        <footer className="mx-auto mt-16 max-w-6xl border-t border-border px-6 py-6 text-xs text-muted">
          <p>
            Dados via{" "}
            <code className="font-mono">yfr_py</code> · Lakehouse no Databricks
            Free · Estático no GitHub Pages · MIT
          </p>
        </footer>
      </body>
    </html>
  );
}
