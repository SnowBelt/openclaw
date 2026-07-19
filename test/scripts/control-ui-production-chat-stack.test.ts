import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function source(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("Control UI production Chat stack", () => {
  it("boots exactly one module entry and routes production Chat through ui/views/chat", () => {
    const html = source("ui/index.html");
    const main = source("ui/src/main.ts");
    const appRender = source("ui/src/ui/app-render.ts");

    expect(html.match(/<script\s+type="module"\s+src="\/src\/main\.ts"><\/script>/g)).toHaveLength(
      1,
    );
    expect(main).toContain('import "./ui/app.ts";');
    expect(main).not.toMatch(/app-routes|pages\/chat/);
    expect(appRender).toContain('import { renderChat } from "./views/chat.ts";');
    expect(appRender).not.toMatch(/pages\/chat\/chat-view/);
  });
});
