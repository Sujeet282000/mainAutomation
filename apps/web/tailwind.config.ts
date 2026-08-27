import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./features/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--bg) / <alpha-value>)",
        elevated: "rgb(var(--bg-elevated) / <alpha-value>)",
        muted: "rgb(var(--bg-muted) / <alpha-value>)",
        ink: "rgb(var(--ink) / <alpha-value>)",
        "ink-muted": "rgb(var(--ink-muted) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        teal: "rgb(var(--teal) / <alpha-value>)",
        "teal-fg": "rgb(var(--teal-fg) / <alpha-value>)",
        "teal-soft": "rgb(var(--teal-soft) / <alpha-value>)",
        ok: "rgb(var(--ok) / <alpha-value>)",
        warn: "rgb(var(--warn) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
        info: "rgb(var(--info) / <alpha-value>)"
      },
      boxShadow: {
        card: "var(--shadow)"
      },
      borderRadius: {
        av: "var(--radius)"
      }
    }
  },
  plugins: []
};

export default config;
