import { defineConfig } from "tsup";

export default defineConfig({
  entry: { hub: "src/index.ts" },
  format: ["esm"],
  platform: "node",
  target: "node20",
  outExtension: () => ({ js: ".mjs" }),
  bundle: true,
  noExternal: [/.*/],
  splitting: false,
  clean: true,
  minify: false,
  banner: {
    js: [
      "#!/usr/bin/env node",
      "import { createRequire as __hubCreateRequire } from 'node:module';",
      "const require = __hubCreateRequire(import.meta.url);",
    ].join("\n"),
  },
});
