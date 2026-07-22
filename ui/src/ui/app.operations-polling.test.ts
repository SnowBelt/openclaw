import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadOperationsRoom: vi.fn(async () => {}),
}));

vi.mock("./controllers/operations.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./controllers/operations.ts")>()),
  loadOperationsRoom: mocks.loadOperationsRoom,
}));

import { OpenClawApp } from "./app.ts";

describe("Operations Room dashboard polling", () => {
  it("quietly refreshes Operations when the dashboard poll fires", async () => {
    const host = { tab: "operations" };

    await OpenClawApp.prototype.refreshActiveDashboardTab.call(host as OpenClawApp);

    expect(mocks.loadOperationsRoom).toHaveBeenCalledWith(host, { quiet: true });
  });
});
