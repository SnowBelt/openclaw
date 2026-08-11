// Shared, cycle-free Control Director service-level and quality thresholds.
export const CONTROL_DIRECTOR_OUTPUT_QUALITY_MINIMUM = 93 as const;

export const CONTROL_DIRECTOR_UX_SLOS = {
  ackMs: 500,
  firstActivityMs: 2_000,
  activityHeartbeatMs: 15_000,
  cancelAckMs: 1_000,
  warmSubstantiveResponseMs: 8_000,
  coldSubstantiveResponseMs: 25_000,
  recentRecallTopK: 3,
  outputQualityMinimum: CONTROL_DIRECTOR_OUTPUT_QUALITY_MINIMUM,
} as const;
