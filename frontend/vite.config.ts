import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: {
    // ethers v6 in browser needs global
    global: "globalThis",
  },
});
