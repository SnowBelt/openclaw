import { beforeEach, describe, expect, it } from "vitest";
import {
  consumeOperationsActionPreview,
  createOperationsActionPreview,
  resetOperationsActionPreviewsForTests,
} from "./action-guard.js";

describe("Operations Room action guard", () => {
  beforeEach(() => resetOperationsActionPreviewsForTests());

  it("requires an exact, single-use preview", () => {
    const preview = createOperationsActionPreview({
      action: "cron.disable",
      targetId: "nightly",
      now: 1_000,
    });
    expect(
      consumeOperationsActionPreview({
        token: preview.token,
        action: "cron.disable",
        targetId: "nightly",
        now: 2_000,
      }),
    ).toEqual(preview);
    expect(
      consumeOperationsActionPreview({
        token: preview.token,
        action: "cron.disable",
        targetId: "nightly",
        now: 2_001,
      }),
    ).toBeNull();
  });

  it("rejects expired and mismatched previews", () => {
    const expired = createOperationsActionPreview({
      action: "cron.run",
      targetId: "daily",
      now: 1_000,
    });
    expect(
      consumeOperationsActionPreview({
        token: expired.token,
        action: "cron.run",
        targetId: "daily",
        now: 61_001,
      }),
    ).toBeNull();

    const mismatch = createOperationsActionPreview({
      action: "flow.cancel",
      targetId: "flow-1",
      now: 1_000,
    });
    expect(
      consumeOperationsActionPreview({
        token: mismatch.token,
        action: "flow.cancel",
        targetId: "flow-2",
        now: 2_000,
      }),
    ).toBeNull();
  });
});
