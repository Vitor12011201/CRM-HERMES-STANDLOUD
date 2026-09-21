import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1c2328",
        muted: "#667085",
        line: "#e6e8eb",
        canvas: "#f7f8f7",
        brand: "#263f35",
      },
    },
  },
  plugins: [],
};

export default config;
