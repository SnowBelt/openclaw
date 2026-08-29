export type WorkspaceState = {
  baseSha: string;
  diff: Buffer;
  trackedBytes: number;
  overlaySha256: string;
  workspaceDigest: string;
  includedUntrackedPaths: string[];
  excludedPaths: string[];
  untrackedContents: Map<string, Buffer>;
  untrackedModes: Map<string, number>;
};
