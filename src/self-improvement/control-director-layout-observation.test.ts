import { describe, expect, it } from "vitest";
import type { ControlDirectorLayoutObservationReportParams } from "../../packages/gateway-protocol/src/index.js";
import { validateControlDirectorLayoutObservation } from "./control-director-layout-observation.js";

function observation(
  overrides: Partial<ControlDirectorLayoutObservationReportParams> = {},
): ControlDirectorLayoutObservationReportParams {
  return {
    schemaVersion: 1,
    sessionKey: "agent:director:dashboard:layout",
    observationId: "layout-1",
    observedAt: 1,
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
    reason: "transcript_composer_overlap",
    ...overrides,
  };
}

describe("Control Director layout observation", () => {
  it("accepts a measured transcript and composer overlap", () => {
    const result = validateControlDirectorLayoutObservation(
      observation({
        transcript: {
          visible: true,
          rect: { top: 80, right: 1200, bottom: 650, left: 200, width: 1000, height: 570 },
        },
      }),
    );
    expect(result).toMatchObject({ reason: "transcript_composer_overlap" });
    expect(result?.observed).toContain("transcriptBottom=650");
  });

  it("rejects a reason that is not supported by its bounded measurements", () => {
    expect(validateControlDirectorLayoutObservation(observation())).toBeUndefined();
  });

  it("accepts only obstructing PCC or Truth and Completion content as an obstruction", () => {
    expect(
      validateControlDirectorLayoutObservation(
        observation({ reason: "pcc_projection_in_chat", pccProjectionPresent: true }),
      ),
    ).toBeDefined();
    expect(
      validateControlDirectorLayoutObservation(
        observation({
          reason: "truth_completion_in_chat",
          truthCompletionPresent: true,
          truthCompletionObstructing: true,
        }),
      ),
    ).toBeDefined();
    expect(
      validateControlDirectorLayoutObservation(
        observation({
          reason: "truth_completion_in_chat",
          truthCompletionPresent: true,
          truthCompletionObstructing: false,
        }),
      ),
    ).toBeUndefined();
  });
});
