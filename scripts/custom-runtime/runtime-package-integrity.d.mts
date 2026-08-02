export function hashBuildArtifactTree(rootDir: string): string;
export function hashRuntimeClosure(rootDir: string, relativePaths: string[]): string;
export function listRuntimeClosurePaths(rootDir: string): string[];
export function verifyRuntimePackage(params: {
  releaseRoot: string;
  expectedRoot?: string;
}): string[];
