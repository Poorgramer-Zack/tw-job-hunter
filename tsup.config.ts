import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/server.ts"],
    format: ["esm"],
    platform: "node",
    target: "node20",
    outDir: "dist",
    clean: true,
    splitting: false,
    minify: true, // dist 不需人讀，壓縮可大幅縮小 commit 進 git 的檔案
    noExternal: [/^(?!(?:kerberos|playwright)$).*/],
    external: ["kerberos", "playwright"],
    banner: {
      js: `#!/usr/bin/env node
import { createRequire as __twCreateRequire } from "node:module";
const require = __twCreateRequire(import.meta.url);`,
    },
  },
  {
    entry: ["src/opencode-plugin.ts", "src/pi-extension.ts"],
    format: ["esm"],
    platform: "node",
    target: "node20",
    outDir: "dist",
    clean: false,
    splitting: false,
    minify: true,
  },
]);
