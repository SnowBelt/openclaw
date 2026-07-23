import { describe, expect, it } from "vitest";
import {
  detectControlDirectorLayoutObstruction,
  type ControlDirectorChatLayoutSnapshot,
} from "./layout-health.js";

function snapshot(
  overrides: Partial<ControlDirectorChatLayoutSnapshot> = {},
): ControlDirectorChatLayoutSnapshot {
  return {
    viewport: { width: 1280, height: 800 },
    transcript: {
      visible: true,
      rect: { top: 80, right: 1200, bottom: 600, left: 200, width: 1000, height: 520 },
    },
    composer: {
      visible: true,
      rect: { top: 600, right: 1200, bottom: 780, left: 200, width: 1000, height: 180 },
    },
    truthCompletionPresent: false,
    pccProjectionPresent: false,
    ...overrides,
  };
}

describe("Control Director Chat layout health", () => {
  it("passes a visible non-overlapping desktop or mobile layout", () => {
    expect(detectControlDirectorLayoutObstruction(snapshot())).toBeUndefined();
    expect(
      detectControlDirectorLayoutObstruction(
        snapshot({
          viewport: { width: 390, height: 844 },
          transcript: {
            visible: true,
            rect: { top: 48, right: 390, bottom: 620, left: 0, width: 390, height: 572 },
          },
          composer: {
            visible: true,
            rect: { top: 620, right: 390, bottom: 844, left: 0, width: 390, height: 224 },
          },
        }),
      ),
    ).toBeUndefined();
    expect(
      detectControlDirectorLayoutObstruction(
        snapshot({
          truthCompletionPresent: true,
          truthCompletionObstructing: false,
        }),
      ),
    ).toBeUndefined();
  });

  it("detects overlap, hidden content, viewport escape, and static PCC diagnostics", () => {
    expect(
      detectControlDirectorLayoutObstruction(
        snapshot({
          transcript: {
            visible: true,
            rect: { top: 80, right: 1200, bottom: 650, left: 200, width: 1000, height: 570 },
          },
        }),
      ),
    ).toBe("transcript_composer_overlap");
    expect(
      detectControlDirectorLayoutObstruction(snapshot({ transcript: { visible: false } })),
    ).toBe("transcript_hidden");
    expect(
      detectControlDirectorLayoutObstruction(
        snapshot({
          composer: {
            visible: true,
            rect: { top: 700, right: 1200, bottom: 900, left: 200, width: 1000, height: 200 },
          },
        }),
      ),
    ).toBe("composer_outside_viewport");
    expect(detectControlDirectorLayoutObstruction(snapshot({ pccProjectionPresent: true }))).toBe(
      "pcc_projection_in_chat",
    );
    expect(
      detectControlDirectorLayoutObstruction(
        snapshot({
          truthCompletionPresent: true,
          truthCompletionObstructing: true,
        }),
      ),
    ).toBe("truth_completion_in_chat");
  });
});
