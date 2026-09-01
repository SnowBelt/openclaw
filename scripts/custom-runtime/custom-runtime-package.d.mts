export function assertCandidateLineage(params: {
  sourceRoot: string;
  sourceSha: string;
  activeSha: string;
}): void;

type DurableSourceProvenance =
  | { provenanceRecordPath: string; provenanceRuntimeHome?: never }
  | { provenanceRuntimeHome: string; provenanceRecordPath?: never };

export function assembleManagedRuntimePackage(
  params: {
    sourceRoot: string;
    releasesDir: string;
    sourceSha: string;
    activeSha: string;
    releaseId: string;
    deploy?: (params: { sourceRoot: string; stagingRoot: string }) => void;
    seal?: boolean;
    provenanceMigrationPath?: string;
  } & DurableSourceProvenance,
): {
  releaseRoot: string;
  releaseId: string;
  artifactHash: string;
  runtimeClosureHash: string;
  runtimeClosurePaths: string[];
};
