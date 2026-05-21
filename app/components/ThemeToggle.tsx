"use client";

import { useEffect, useState } from "react";

type Theme = "dark" | "light";
type Palette = "default" | "cbsafe";

function _readTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem("theme") as Theme | null;
  return stored === "light" ? "light" : "dark";
}

function _readPalette(): Palette {
  if (typeof window === "undefined") return "default";
  const stored = window.localStorage.getItem("palette") as Palette | null;
  return stored === "cbsafe" ? "cbsafe" : "default";
}

function _applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.dataset.theme = theme;
}

function _applyPalette(palette: Palette) {
  document.documentElement.classList.toggle("cbsafe", palette === "cbsafe");
  document.documentElement.dataset.palette = palette;
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [palette, setPalette] = useState<Palette>("default");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const t = _readTheme();
    const p = _readPalette();
    setTheme(t);
    setPalette(p);
    _applyTheme(t);
    _applyPalette(p);
    setMounted(true);
  }, []);

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    _applyTheme(next);
    window.localStorage.setItem("theme", next);
  }

  function togglePalette() {
    const next: Palette = palette === "cbsafe" ? "default" : "cbsafe";
    setPalette(next);
    _applyPalette(next);
    window.localStorage.setItem("palette", next);
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={togglePalette}
        aria-label={
          mounted
            ? `Paleta atual: ${palette === "cbsafe" ? "daltônico-safe" : "padrão"}. Clique para alternar.`
            : "Alternar paleta"
        }
        title={
          mounted
            ? palette === "cbsafe"
              ? "Paleta segura para daltonismo (azul ↔ amarelo)"
              : "Paleta padrão (verde ↔ vermelho)"
            : "Alternar paleta"
        }
        className="card inline-flex h-9 w-9 items-center justify-center text-strong hover:bg-subtle"
        suppressHydrationWarning
      >
        {mounted && palette === "cbsafe" ? <PaletteAlt /> : <Palette />}
      </button>
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={
          mounted ? `Mudar para tema ${theme === "dark" ? "claro" : "escuro"}` : "Alternar tema"
        }
        className="card inline-flex h-9 w-9 items-center justify-center text-strong hover:bg-subtle"
        suppressHydrationWarning
      >
        {mounted && theme === "dark" ? <SunIcon /> : <MoonIcon />}
      </button>
    </div>
  );
}

function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
function Palette() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
    </svg>
  );
}
function PaletteAlt() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 22C6.477 22 2 17.523 2 12 2 6.477 6.477 2 12 2c5.522 0 10 3.989 10 9.444 0 3.051-2.504 5.556-5.556 5.556h-1.997a1.667 1.667 0 0 0-1.667 1.667c0 .426.16.834.444 1.139.284.305.444.713.444 1.139C13.668 21.852 13.518 22 12 22z" />
    </svg>
  );
}
