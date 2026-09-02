import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  registerSealedCandidate,
  transitionCandidate,
  verifyRegisteredCandidate,
} from "../../scripts/custom-runtime/candidate-registry.mjs";

const roots: string[] = [];
const sourceSha = "a".repeat(40);
const artifactSha256 = "b".repeat(64);
const runtimeClosureSha256 = "c".repeat(64);

function write(filePath: string, value: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, { mode: 0o600 });
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "candidate-registry-"));
  roots.push(root);
  const releaseRoot = path.join(root, "releases", "candidate-r1");
  fs.mkdirSync(releaseRoot, { recursive: true });
  const canonicalReleaseRoot = fs.realpathSync(releaseRoot);
  write(path.join(releaseRoot, ".openclaw-production-sha"), `${sourceSha}\n`);
  write(
    path.join(releaseRoot, ".openclaw-runtime-sealed"),
    `${sourceSha} ${runtimeClosureSha256}\n`,
  );
  write(
    path.join(releaseRoot, "config", "custom-runtime-capabilities.json"),
    '{"schema":"openclaw.custom-runtime-capabilities.v2","version":5}\n',
  );
  write(
    path.join(releaseRoot, "snapshot.json"),
    `${JSON.stringify({
      releaseId: "candidate-r1",
      root: canonicalReleaseRoot,
      artifactHash: artifactSha256,
      runtimeClosureHash: runtimeClosureSha256,
      source: { commit: sourceSha },
    })}\n`,
  );
  return {
    releaseRoot: canonicalReleaseRoot,
    registryPath: path.join(root, "releases", ".candidate-registry.json"),
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("custom runtime candidate registry", () => {
  it("binds a sealed release and enforces ordered evidence transitions", () => {
    const state = fixture();
    const registered = registerSealedCandidate(state);
    expect(registered).toMatchObject({ state: "sealed", sourceSha });
    expect(verifyRegisteredCandidate({ ...state, expectedState: "sealed" })).toMatchObject({
      identitySha256: registered.identitySha256,
    });

    transitionCandidate({
      ...state,
      expectedState: "sealed",
      nextState: "smoked",
      operationId: "smoke-1",
      evidenceSha256: "d".repeat(64),
    });
    transitionCandidate({
      ...state,
      expectedState: "smoked",
      nextState: "staged",
      operationId: "stage-1",
      evidenceSha256: "e".repeat(64),
    });
    expect(verifyRegisteredCandidate({ ...state, expectedState: "staged" })).toMatchObject({
      state: "staged",
      transitions: expect.arrayContaining([expect.objectContaining({ to: "smoked" })]),
    });
  });

  it("rejects identity drift, skipped transitions, and release-id reuse", () => {
    const state = fixture();
    registerSealedCandidate(state);
    expect(() =>
      transitionCandidate({
        ...state,
        expectedState: "sealed",
        nextState: "active",
        operationId: "activation-1",
        evidenceSha256: "f".repeat(64),
      }),
    ).toThrow(/not allowed/);

    write(path.join(state.releaseRoot, "snapshot.json"), "{}\n");
    expect(() => verifyRegisteredCandidate(state)).toThrow(/identity|inconsistent/);
    expect(() => registerSealedCandidate(state)).toThrow(/identity|inconsistent/);
  });

  it("requires self-contained provenance when an envelope is present", () => {
    const state = fixture();
    const external = path.join(path.dirname(state.releaseRoot), "external.bundle");
    write(external, "bundle");
    write(
      path.join(state.releaseRoot, ".openclaw-runtime-provenance.json"),
      `${JSON.stringify({
        schema: "openclaw.custom-runtime-runtime-provenance.v1",
        sourceSha,
        treeSha: sourceSha,
        recordPath: external,
        recordSha256: crypto.createHash("sha256").update("bundle").digest("hex"),
      })}\n`,
    );
    expect(() => registerSealedCandidate(state)).toThrow(/self-contained v2/);
  });
});
