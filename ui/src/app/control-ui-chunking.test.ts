import { describe, expect, it } from "vitest";
import { controlUiManualChunk } from "../../config/control-ui-chunking.ts";

describe("Control UI build chunking", () => {
  it("groups stable runtime dependencies into bounded chunks", () => {
    expect(controlUiManualChunk("/repo/ui/node_modules/lit/index.js")).toBe("lit-runtime");
    expect(controlUiManualChunk("/repo/ui/node_modules/lit-html/directives/repeat.js")).toBe(
      "lit-runtime",
    );
    expect(controlUiManualChunk("/repo/ui/node_modules/highlight.js/lib/core.js")).toBe(
      "markdown-runtime",
    );
    expect(
      controlUiManualChunk("/tmp/openclaw-pnpm-node-modules/dompurify/dist/purify.es.mjs"),
    ).toBe("markdown-runtime");
    expect(controlUiManualChunk("/tmp/openclaw-pnpm-node-modules/zod/v4/core/schemas.js")).toBe(
      "config-runtime",
    );
    expect(controlUiManualChunk("/tmp/openclaw-pnpm-node-modules/json5/dist/index.js")).toBe(
      "config-runtime",
    );
    expect(controlUiManualChunk("/tmp/openclaw-pnpm-node-modules/@noble/ed25519/index.js")).toBe(
      "gateway-runtime",
    );
    expect(controlUiManualChunk("/repo/ui/src/app/app-host.ts")).toBeUndefined();
  });

  it("normalizes Windows module paths before package matching", () => {
    expect(controlUiManualChunk(String.raw`C:\repo\ui\node_modules\highlight.js\lib\core.js`)).toBe(
      "markdown-runtime",
    );
  });

  it("keeps large dashboard controllers out of the initial chunk", () => {
    expect(controlUiManualChunk("/repo/ui/src/ui/controllers/kalshi-dashboard.ts")).toBe(
      "kalshi-dashboard-runtime",
    );
    expect(controlUiManualChunk("/repo/ui/src/ui/controllers/pcc.ts")).toBe("pcc-runtime");
    expect(controlUiManualChunk("/repo/ui/src/ui/controllers/workboard.ts")).toBe(
      "workboard-runtime",
    );
    expect(controlUiManualChunk("/repo/ui/src/ui/controllers/book-writer-dashboard.ts")).toBe(
      "book-writer-runtime",
    );
  });
});
