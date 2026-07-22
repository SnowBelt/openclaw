// Vitest UI package config tests validate UI package test project settings.
import { describe, expect, it } from "vitest";
import uiConfig from "../ui/vitest.config.ts";
import uiNodeConfig from "../ui/vitest.node.config.ts";

function requireTestConfig<T extends { test?: unknown }>(config: T): NonNullable<T["test"]> {
  if (!config.test) {
    throw new Error("expected ui package vitest test config");
  }
  return config.test as NonNullable<T["test"]>;
}

describe("ui package vitest config", () => {
  it("keeps native file watching out of browser dependency optimization", () => {
    const testConfig = requireTestConfig(uiConfig);
    const browserProject = testConfig.projects.at(-1);

    expect(browserProject?.optimizeDeps?.exclude).toContain("fsevents");
    expect(browserProject?.plugins).toContainEqual(
      expect.objectContaining({ name: "openclaw-browser-external-node-modules" }),
    );
  });

  it("runs file-backed layout tests in the node-driven project", () => {
    const testConfig = requireTestConfig(uiConfig);
    const nodeProjectTestConfig = requireTestConfig(testConfig.projects[1]);
    const browserProjectTestConfig = requireTestConfig(testConfig.projects[2]);
    const fileBackedLayoutTests = [
      "src/ui/chat/chat-responsive.browser.test.ts",
      "src/ui/form-controls.browser.test.ts",
      "src/ui/views/sessions.browser.test.ts",
    ];

    expect(nodeProjectTestConfig.include).toEqual(expect.arrayContaining(fileBackedLayoutTests));
    expect(browserProjectTestConfig.exclude).toEqual(expect.arrayContaining(fileBackedLayoutTests));
  });

  it("keeps the standalone ui package on thread workers without isolation", () => {
    const testConfig = requireTestConfig(uiConfig);

    expect(testConfig.pool).toBe("threads");
    expect(testConfig.isolate).toBe(false);
    expect(testConfig.projects).toHaveLength(3);

    for (const project of testConfig.projects) {
      const projectTestConfig = requireTestConfig(project);
      expect(projectTestConfig.pool).toBe("threads");
      expect(projectTestConfig.isolate).toBe(false);
      expect(projectTestConfig.runner).toBeUndefined();
    }
  });

  it("keeps the standalone ui node config on thread workers without isolation", () => {
    const testConfig = requireTestConfig(uiNodeConfig);

    expect(testConfig.pool).toBe("threads");
    expect(testConfig.isolate).toBe(false);
    expect(testConfig.runner).toBeUndefined();
  });
});
