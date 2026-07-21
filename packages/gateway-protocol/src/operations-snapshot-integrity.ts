import type { OperationsSnapshotV2Result } from "./schema/types.js";

const OPERATIONS_COLLECTION_NAMES = [
  "agents",
  "tasks",
  "workflows",
  "cronJobs",
  "skills",
  "plugins",
  "tools",
  "models",
  "processes",
  "findings",
  "activityRollups",
  "incidentHistory",
] as const satisfies ReadonlyArray<keyof OperationsSnapshotV2Result["collections"]>;

const OPERATIONS_SUMMARY_COLLECTION_NAMES = [
  "agents",
  "tasks",
  "workflows",
  "cronJobs",
  "skills",
  "plugins",
  "tools",
  "models",
  "findings",
] as const satisfies ReadonlyArray<keyof OperationsSnapshotV2Result["summary"]>;

type OperationsCollectionName = (typeof OPERATIONS_COLLECTION_NAMES)[number];
type OperationsSummaryCollectionName = (typeof OPERATIONS_SUMMARY_COLLECTION_NAMES)[number];

type OperationsSnapshotIntegrityInput = {
  collections: Record<
    OperationsCollectionName,
    { total: number; shown: number; truncated: boolean }
  >;
  summary: Record<OperationsSummaryCollectionName, number> & {
    actionableFindings: number;
    historicalFindings: number;
    needsUserFindings: number;
    handlingFindings: number;
    watchingFindings: number;
    criticalFindings: number;
  };
  findings: ReadonlyArray<{
    disposition: "needs_user" | "handling" | "watching" | "historical";
    severity: string;
  }>;
} & {
  [Name in OperationsCollectionName]: ReadonlyArray<unknown>;
};

function invalidSnapshot(message: string): never {
  throw new Error(`invalid Operations Room snapshot: ${message}`);
}

/**
 * Enforces relationships that JSON Schema cannot express. Keep this at both
 * producer and consumer boundaries so contradictory counts never render as
 * authoritative operational truth.
 */
export function assertOperationsSnapshotV2Integrity(
  snapshot: OperationsSnapshotIntegrityInput,
): void {
  for (const name of OPERATIONS_COLLECTION_NAMES) {
    const count = snapshot.collections[name];
    const rows = snapshot[name];
    if (count.shown !== rows.length) {
      invalidSnapshot(`${name}.shown is ${count.shown}, but ${rows.length} rows were provided`);
    }
    if (count.shown > count.total) {
      invalidSnapshot(`${name}.shown exceeds ${name}.total`);
    }
    if (count.truncated !== count.shown < count.total) {
      invalidSnapshot(`${name}.truncated does not match shown and total`);
    }
  }

  for (const name of OPERATIONS_SUMMARY_COLLECTION_NAMES) {
    if (snapshot.summary[name] !== snapshot.collections[name].total) {
      invalidSnapshot(`summary.${name} does not match collections.${name}.total`);
    }
  }

  const summary = snapshot.summary;
  if (summary.actionableFindings + summary.historicalFindings !== summary.findings) {
    invalidSnapshot("actionable and historical finding counts do not equal total findings");
  }
  if (
    summary.needsUserFindings + summary.handlingFindings + summary.watchingFindings !==
    summary.actionableFindings
  ) {
    invalidSnapshot("current finding lane counts do not equal actionable findings");
  }
  if (summary.criticalFindings > summary.actionableFindings) {
    invalidSnapshot("critical findings exceed actionable findings");
  }

  const visibleFindingCounts = {
    needs_user: 0,
    handling: 0,
    watching: 0,
    historical: 0,
    critical: 0,
  };
  for (const finding of snapshot.findings) {
    visibleFindingCounts[finding.disposition] += 1;
    if (finding.disposition !== "historical" && finding.severity === "critical") {
      visibleFindingCounts.critical += 1;
    }
  }
  const expectedFindingCounts = {
    needs_user: summary.needsUserFindings,
    handling: summary.handlingFindings,
    watching: summary.watchingFindings,
    historical: summary.historicalFindings,
    critical: summary.criticalFindings,
  };
  const findingsAreComplete = !snapshot.collections.findings.truncated;
  for (const name of Object.keys(expectedFindingCounts) as Array<
    keyof typeof expectedFindingCounts
  >) {
    const visible = visibleFindingCounts[name];
    const expected = expectedFindingCounts[name];
    if (findingsAreComplete ? visible !== expected : visible > expected) {
      invalidSnapshot(`visible ${name} finding count conflicts with summary`);
    }
  }
}
