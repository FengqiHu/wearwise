import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        boutique: {
          50: "#f8f5ee",
          100: "#f1e9dd",
          200: "#e5d7c2",
          300: "#d7bd9a",
          400: "#c59f72",
          500: "#b38555",
          600: "#956c43",
          700: "#755335",
          800: "#573d28",
          900: "#36261b"
        },
        // Design system colors
        cream: "#f7f4ed",
        chalk: "#fcfbf8",
        pebble: "#e2dfd6",
        charcoal: "#1c1c1c",
        dim: "#5f5f5d"
      },
      fontFamily: {
        display: ['"Cormorant Garamond"', "serif"],
        sans: ['"DM Sans"', '"Manrope"', "ui-sans-serif", "system-ui", "sans-serif"]
      },
      boxShadow: {
        soft: "0 22px 40px -28px rgba(41, 27, 12, 0.45)",
        insetWarm: "inset 0 0 0 1px rgba(149, 108, 67, 0.22)",
        "btn-dark":
          "rgba(255,255,255,0.2) 0px 0.5px 0px 0px inset, rgba(0,0,0,0.2) 0px 0px 0px 0.5px inset, rgba(0,0,0,0.05) 0px 1px 2px 0px",
        "focus-warm": "rgba(0,0,0,0.1) 0px 4px 12px"
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" }
        },
        "typing-dot": {
          "0%, 80%, 100%": { transform: "scale(0.72)", opacity: "0.35" },
          "40%": { transform: "scale(1)", opacity: "1" }
        },
        "garment-cycle": {
          "0%, 20%": {
            transform: "translate(var(--start-x), var(--start-y)) scale(0.92) rotate(var(--start-r))",
            opacity: "0.7"
          },
          "45%, 70%": {
            transform: "translate(var(--target-x), var(--target-y)) scale(1.02) rotate(0deg)",
            opacity: "1"
          },
          "100%": {
            transform: "translate(var(--start-x), var(--start-y)) scale(0.92) rotate(var(--start-r))",
            opacity: "0.7"
          }
        },
        "model-pulse": {
          "0%, 100%": { transform: "scale(1)", opacity: "0.85" },
          "50%": { transform: "scale(1.03)", opacity: "1" }
        }
      },
      animation: {
        "fade-up": "fade-up 0.6s ease-out both",
        "typing-dot": "typing-dot 1.1s infinite ease-in-out",
        "garment-cycle": "garment-cycle 7.5s ease-in-out infinite",
        "model-pulse": "model-pulse 3.2s ease-in-out infinite"
      }
    }
  },
  plugins: []
} satisfies Config;
