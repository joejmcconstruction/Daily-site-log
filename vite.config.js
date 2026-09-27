import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Build stamp shown in the app (Staff > Hours) so we can tell whether a phone
// is running the latest deploy. Format: YYYY-MM-DD HH:MM, UTC.
const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_STAMP__: JSON.stringify(stamp),
  },
});
