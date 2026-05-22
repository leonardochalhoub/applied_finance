"use client";

import { useEffect, useState } from "react";

import { ThemeToggle } from "./ThemeToggle";

const ITEMS = [
  { href: "/", label: "Visão geral" },
  { href: "/portfolio/", label: "Carteira" },
  { href: "/triagem/", label: "Triagem" },
  { href: "/setores/", label: "Setores" },
  { href: "/correlacoes/", label: "Correlações" },
  { href: "/mclean/", label: "McLean" },
  { href: "/metodologia/", label: "Metodologia" },
];

export function Nav() {
  const [open, setOpen] = useState(false);

  // Close drawer on viewport widening
  useEffect(() => {
    function onResize() {
      if (typeof window !== "undefined" && window.innerWidth >= 1024) setOpen(false);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
      <a href="/" className="flex items-center gap-2 text-strong">
        <Logo />
        <span className="text-base font-semibold tracking-tight whitespace-nowrap text-strong">
          Applied Finance
        </span>
        <span className="chip ml-2 hidden md:inline-flex">B3 · pt-BR · MIT</span>
      </a>
      <div className="flex items-center gap-3">
        {/* Desktop / wide tablet links */}
        <ul className="hidden items-center gap-5 xl:gap-6 lg:flex">
          {ITEMS.map((i) => (
            <li key={i.href}>
              <a href={i.href} className="nav-link whitespace-nowrap">
                {i.label}
              </a>
            </li>
          ))}
        </ul>
        <ThemeToggle />
        {/* Mobile hamburger */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Fechar menu" : "Abrir menu"}
          aria-expanded={open}
          className="card inline-flex h-9 w-9 items-center justify-center text-strong lg:hidden"
        >
          {open ? <CloseIcon /> : <MenuIcon />}
        </button>
      </div>

      {/* Mobile stacked drawer */}
      {open ? (
        <div className="absolute inset-x-0 top-full z-40 border-b border-border bg-[color:var(--bg-base)] shadow-xl lg:hidden">
          <ul className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-3">
            {ITEMS.map((i) => (
              <li key={i.href}>
                <a
                  href={i.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-md px-3 py-2.5 text-sm text-body hover:bg-[color:var(--bg-subtle)] hover:text-strong"
                >
                  {i.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </nav>
  );
}

function Logo() {
  // Mirrors public/icon.svg (option-1 — trajectory line + max-Sharpe node)
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

function MenuIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="6" y1="18" x2="18" y2="6" />
    </svg>
  );
}
