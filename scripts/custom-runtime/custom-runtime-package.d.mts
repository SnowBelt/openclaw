export function assertCandidateLineage(params: {
  sourceRoot: string;
  sourceSha: string;
  activeSha: string;
}): void;

export function resolveDefaultDeployInvocation(params: {
  stagingRoot: string;
  env?: NodeJS.ProcessEnv;
}): {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
};

type DurableSourceProvenance =
  | {
      provenanceRecordPath: string;
      provenanceRuntimeHome?: never;
      sourceRemote?: never;
      sourceRemoteBranch?: never;
    }
  | {
      provenanceRuntimeHome: string;
      provenanceRecordPath?: never;
      sourceRemote?: string;
      sourceRemoteBranch?: string;
    };

export function assembleManagedRuntimePackage(
  params: {
    sourceRoot: string;
    releasesDir: string;
    sourceSha: string;
    activeSha: string;
    releaseId: string;
    runtimeConfigPath?: string;
    deploy?: (params: { sourceRoot: string; stagingRoot: string }) => void;
    seal?: boolean;
    provenanceMigrationPath?: string;
    trustedProvenanceHelperPath?: string;
    candidateRegistryPath?: string;
    storageReservation?: {
      id: string;
      ownerToken: string;
      registryPath: string;
    };
  } & DurableSourceProvenance,
): {
  releaseRoot: string;
  releaseId: string;
  artifactHash: string;
  runtimeClosureHash: string;
  runtimeClosurePaths: string[];
  candidateRegistryPath?: string;
};

export function assertBuildSnapshotPluginClosure(params: {
  sourceRoot: string;
  buildRoot: string;
  runtimeConfigPath?: string;
}): {
  checked: boolean;
  configPath?: string;
  configSha256?: string;
  configuredPluginIds?: string[];
  bundledPluginIds?: string[];
  externalPluginIds?: string[];
};
