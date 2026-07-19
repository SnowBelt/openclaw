import type {
  ControlDirectorLayoutObservationReportParams,
  ControlDirectorLayoutObstructionReason,
} from "../../packages/gateway-protocol/src/index.js";

const LAYOUT_EDGE_TOLERANCE_PX = 1;

type LayoutObservationValidation = {
  reason: ControlDirectorLayoutObstructionReason;
  observed: string;
};

function rounded(value: number | undefined): string {
  return value === undefined ? "missing" : String(Math.round(value));
}

function reasonMatchesObservation(
  observation: ControlDirectorLayoutObservationReportParams,
): boolean {
  switch (observation.reason) {
    case "transcript_hidden":
      return !observation.transcript.visible;
    case "composer_hidden":
      return !observation.composer.visible;
    case "transcript_composer_overlap":
      return Boolean(
        observation.transcript.visible &&
        observation.composer.visible &&
        observation.transcript.rect &&
        observation.composer.rect &&
        observation.transcript.rect.bottom >
          observation.composer.rect.top + LAYOUT_EDGE_TOLERANCE_PX,
      );
    case "composer_outside_viewport":
      return Boolean(
        observation.composer.visible &&
        observation.composer.rect &&
        (observation.composer.rect.top < -LAYOUT_EDGE_TOLERANCE_PX ||
          observation.composer.rect.bottom >
            observation.viewport.height + LAYOUT_EDGE_TOLERANCE_PX),
      );
    case "truth_completion_in_chat":
      return observation.truthCompletionPresent;
    case "pcc_projection_in_chat":
      return observation.pccProjectionPresent;
  }
  return false;
}

/**
 * Re-derive the closed obstruction claim from bounded UI measurements. The
 * Gateway never accepts arbitrary client prose as trusted SIG evidence.
 */
export function validateControlDirectorLayoutObservation(
  observation: ControlDirectorLayoutObservationReportParams,
): LayoutObservationValidation | undefined {
  if (!reasonMatchesObservation(observation)) {
    return undefined;
  }
  return {
    reason: observation.reason,
    observed: [
      `reason=${observation.reason}`,
      `viewport=${observation.viewport.width}x${observation.viewport.height}`,
      `transcriptVisible=${observation.transcript.visible}`,
      `transcriptBottom=${rounded(observation.transcript.rect?.bottom)}`,
      `composerVisible=${observation.composer.visible}`,
      `composerTop=${rounded(observation.composer.rect?.top)}`,
      `composerBottom=${rounded(observation.composer.rect?.bottom)}`,
      `truthCompletionPresent=${observation.truthCompletionPresent}`,
      `pccProjectionPresent=${observation.pccProjectionPresent}`,
    ].join("; "),
  };
}
