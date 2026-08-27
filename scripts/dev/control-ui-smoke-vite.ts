import { join } from "node:path";

// Keep chat smoke dependency prebundling deterministic across fresh CI caches.
// Without this allowlist, Vite can serve a transient 504 while discovering
// Lit's directive modules and produce a false browser failure.
export const controlUiChatSmokeOptimizeDeps = [
  "dompurify",
  "highlight.js/lib/core",
  "highlight.js/lib/languages/bash",
  "highlight.js/lib/languages/cpp",
  "highlight.js/lib/languages/css",
  "highlight.js/lib/languages/diff",
  "highlight.js/lib/languages/go",
  "highlight.js/lib/languages/java",
  "highlight.js/lib/languages/javascript",
  "highlight.js/lib/languages/json",
  "highlight.js/lib/languages/markdown",
  "highlight.js/lib/languages/python",
  "highlight.js/lib/languages/rust",
  "highlight.js/lib/languages/typescript",
  "highlight.js/lib/languages/xml",
  "highlight.js/lib/languages/yaml",
  "ipaddr.js",
  "json5",
  "lit",
  "lit/decorators.js",
  "lit/directives/guard.js",
  "lit/directives/if-defined.js",
  "lit/directives/keyed.js",
  "lit/directives/ref.js",
  "lit/directives/repeat.js",
  "lit/directives/unsafe-html.js",
  "lit/directives/until.js",
  "markdown-it",
  "markdown-it-task-lists",
  "zod",
] as const;

export function controlUiSmokeViteResolve(root = process.cwd()) {
  return {
    alias: [
      {
        find: "./openclaw-root.js",
        replacement: join(root, "scripts/dev/browser-stubs/openclaw-root.ts"),
      },
      {
        find: "../infra/openclaw-root.js",
        replacement: join(root, "scripts/dev/browser-stubs/openclaw-root.ts"),
      },
      {
        find: "../../infra/openclaw-root.js",
        replacement: join(root, "scripts/dev/browser-stubs/openclaw-root.ts"),
      },
      {
        find: "../../../infra/openclaw-root.js",
        replacement: join(root, "scripts/dev/browser-stubs/openclaw-root.ts"),
      },
      {
        find: "./private-qa-cli.js",
        replacement: join(root, "scripts/dev/browser-stubs/private-qa-cli.ts"),
      },
      {
        find: "../config/paths.js",
        replacement: join(root, "scripts/dev/browser-stubs/config-paths.ts"),
      },
      {
        find: "../../config/paths.js",
        replacement: join(root, "scripts/dev/browser-stubs/config-paths.ts"),
      },
      {
        find: "../../../config/paths.js",
        replacement: join(root, "scripts/dev/browser-stubs/config-paths.ts"),
      },
      {
        find: /^@openclaw\/normalization-core\/(.+)$/,
        replacement: join(root, "packages/normalization-core/src/$1.ts"),
      },
      {
        find: "@openclaw/normalization-core",
        replacement: join(root, "packages/normalization-core/src/index.ts"),
      },
      {
        find: /^@openclaw\/media-core\/(.+)$/,
        replacement: join(root, "packages/media-core/src/$1.ts"),
      },
      {
        find: "@openclaw/media-core",
        replacement: join(root, "packages/media-core/src/index.ts"),
      },
      {
        find: /^@openclaw\/net-policy\/(.+)$/,
        replacement: join(root, "packages/net-policy/src/$1.ts"),
      },
      {
        find: "@openclaw/net-policy",
        replacement: join(root, "packages/net-policy/src/index.ts"),
      },
    ],
  };
}
