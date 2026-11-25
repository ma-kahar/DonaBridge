/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "Noto Sans Bengali", "system-ui", "sans-serif"],
      },
      colors: {
        dona: {
          green: "#25D366",
          dark: "rgb(var(--dona-bg) / <alpha-value>)",
          panel: "rgb(var(--dona-panel) / <alpha-value>)",
          panel2: "rgb(var(--dona-panel2) / <alpha-value>)",
          border: "rgb(var(--dona-border) / <alpha-value>)",
          fg: "rgb(var(--dona-fg) / <alpha-value>)",
          muted: "rgb(var(--dona-muted) / <alpha-value>)",
          faint: "rgb(var(--dona-faint) / <alpha-value>)",
          accent: "rgb(var(--dona-accent) / <alpha-value>)",
          accentHover: "rgb(var(--dona-accent-hover) / <alpha-value>)",
        },
      },
    },
  },
  plugins: [],
};
