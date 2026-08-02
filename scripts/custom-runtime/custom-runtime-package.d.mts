export function assertCandidateLineage(params: {
  sourceRoot: string;
  sourceSha: string;
  activeSha: string;
}): void;

export function assembleManagedRuntimePackage(params: {
  sourceRoot: string;
  releasesDir: string;
  sourceSha: string;
  activeSha: string;
  releaseId: string;
  deploy?: (params: { sourceRoot: string; stagingRoot: string }) => void;
  seal?: boolean;
}): {
  releaseRoot: string;
  releaseId: string;
  artifactHash: string;
  runtimeClosureHash: string;
  runtimeClosurePaths: string[];
};
