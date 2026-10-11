import { defineConfig } from "vite-plus";

export default defineConfig({
  // Formatting has no existing repository baseline. Use vp fmt explicitly.
  check: { fmt: false },
  fmt: {
    ignorePatterns: ["**/convex/_generated/**", "**/routeTree.gen.ts"],
  },
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
});
