import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["variant", "&:where(.dark, .dark *)"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        sector: {
          financeiro: "#0EA5E9",
          materiais: "#A16207",
          consumo_n_ciclico: "#16A34A",
          consumo_ciclico: "#F59E0B",
          petroleo: "#1F2937",
          utilidade: "#7C3AED",
          industriais: "#475569",
          saude: "#EC4899",
          comunicacoes: "#0891B2",
          ti: "#6366F1",
        },
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "monospace"],
      },
      borderRadius: {
        lg: "0.5rem",
        md: "0.375rem",
        sm: "0.25rem",
      },
    },
  },
  plugins: [],
};

export default config;
