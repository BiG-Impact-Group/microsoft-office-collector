import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        oauthCallback: "oauth-callback.html",
        inbox: "inbox.html",
      },
    },
  },
});
