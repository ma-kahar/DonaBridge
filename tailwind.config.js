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
          dark: "#111B21",
          panel: "#202C33",
          border: "#2A3942",
        },
      },
    },
  },
  plugins: [],
};
