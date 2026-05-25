"use client";

import { withBase } from "@/lib/links";

import { ThemeToggle } from "./ThemeToggle";

const ITEMS = [
  { href: "/", label: "Visão geral" },
  { href: "/markowitz/", label: "Markowitz" },
  { href: "/ingenuo/", label: "Ingênuo (1/N)" },
  { href: "/kahneman/", label: "Kahneman" },
  { href: "/black-litterman/", label: "Black-Litterman" },
  { href: "/paridade/", label: "Paridade de Risco" },
  { href: "/triagem/", label: "Triagem" },
  { href: "/setores/", label: "Setores" },
  { href: "/correlacoes/", label: "Correlações" },
  { href: "/mclean/", label: "McLean (2011)" },
  { href: "/working-paper/", label: "Working Paper" },
  { href: "/finops/", label: "FinOps" },
  { href: "/metodologia/", label: "Metodologia" },
];

export function Nav() {
  return (
    <nav className="mx-auto max-w-7xl px-4 py-3 sm:px-6 sm:py-4">
      {/* Top row: brand + theme toggle, always horizontal */}
      <div className="flex items-center justify-between">
        <a href={withBase("/")} className="flex items-center gap-2 text-strong">
          <Logo />
          <span className="text-base font-semibold tracking-tight text-strong whitespace-nowrap">
            Applied Finance
          </span>
        </a>
        <ThemeToggle />
      </div>
      {/* Links: horizontally-scrolling pills on mobile (single row, swipeable);
          centered wrap on lg+. Keeps mobile nav to ≤ 40px tall regardless of
          item count, so the sticky header never eats the viewport. */}
      <ul
        className="mt-2 flex flex-row items-center gap-1 overflow-x-auto whitespace-nowrap scrollbar-none lg:mt-3 lg:flex-wrap lg:justify-center lg:gap-x-6 lg:gap-y-1 lg:overflow-visible"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {ITEMS.map((i) => (
          <li key={i.href} className="shrink-0 lg:shrink">
            <a
              href={withBase(i.href)}
              className="block rounded-md px-3 py-1.5 text-xs text-body hover:bg-[color:var(--bg-subtle)] hover:text-strong sm:text-sm lg:px-0 lg:py-1.5 lg:text-[13px] lg:font-medium lg:hover:bg-transparent lg:hover:text-strong lg:hover:underline lg:underline-offset-4"
            >
              {i.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Logo() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect width="64" height="64" rx="14" fill="#0a0f1e" />
      <path
        d="M 12 46 L 24 28 L 34 38 L 52 18"
        fill="none"
        stroke="#60a5fa"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="46" r="3" fill="#60a5fa" />
      <circle cx="24" cy="28" r="3" fill="#60a5fa" />
      <circle cx="34" cy="38" r="3" fill="#60a5fa" />
      <circle cx="52" cy="18" r="4" fill="#34d399" />
    </svg>
  );
}
