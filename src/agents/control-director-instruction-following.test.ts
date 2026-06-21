import { describe, expect, it } from "vitest";
import {
  applyControlDirectorLivenessWatchdog,
  applyControlDirectorTruthGate,
  decideControlDirectorContinuation,
} from "./control-director-contract.ts";

describe("Control Director instruction-following torture proof", () => {
  it("preserves the original user request in recovery instead of generic continue wording", () => {
    const originalRequest =
      "Give me a working public link to play Todd Stanski World on my MacBook from a different network.";
    const decision = decideControlDirectorContinuation({
      agentId: "main",
      incomplete: true,
      classification: "empty",
      continuationCount: 0,
      missionId: "control-director:public-link-proof",
      requestBody: originalRequest,
      canQueueContinuation: true,
    });

    expect(decision).toMatchObject({
      status: "queue",
      shouldQueue: true,
      nextContinuationCount: 1,
    });
    expect(decision.prompt).toContain(`Original request summary: ${originalRequest}`);
    expect(decision.prompt).toContain("Original request hash:");
    expect(decision.prompt).toContain("Continue from the current state.");
    expect(decision.prompt).not.toContain("Original request summary: Continue");
    expect(decision.prompt).not.toContain("Original request summary: Try again");
  });

  it("delivers a specific blocker for stuck recovery aborts without exposing fallback boilerplate", () => {
    const guarded = applyControlDirectorLivenessWatchdog({
      agentId: "main",
      payloads: [] as Array<{ text: string }>,
      classification: "empty",
      continuationCount: 0,
      missionId: "control-director:empty-output-proof",
      requestBody: "Investigate the Control Director issue and fix it.",
      canQueueContinuation: true,
      agentRunFailure: {
        kind: "stuck_recovery_abort",
        provider: "ollama",
        model: "openclaw-control-gemma4-31b-q8:latest",
        abortReason: "stuck_recovery",
      },
    });

    const text = guarded.payloads[0]?.text;
    expect(text).toContain("Control Director stopped before finishing the requested work.");
    expect(text).toContain("Original request: Investigate the Control Director issue and fix it.");
    expect(text).toContain("diagnostic stuck-session recovery aborted it");
    expect(text).toContain("Provider/model: ollama/openclaw-control-gemma4-31b-q8:latest.");
    expect(text).toContain("Missing condition: A healthy configured fallback model");
    expect(text).toContain("Status: blocked");
    expect(text).not.toContain("Control Director could not produce a usable final answer");
    expect(text).not.toContain("Control Director liveness watchdog");
    expect(text).not.toContain("Recovery queued: yes");
    expect(text).not.toContain("Classification: empty");
    expect(text).not.toContain("Status: continuing");
  });

  it("blocks public-link success claims without reachability command evidence", () => {
    const guarded = applyControlDirectorTruthGate({
      agentId: "main",
      payloads: [
        {
          text: [
            "The ngrok public link works from your MacBook: https://example.ngrok-free.app",
            "Verified state: I have not checked the URL.",
            "Next build gap: run curl reachability proof first.",
            "Completion Grade: 8/10",
            "Criticality: 10/10",
            "Status: blocked",
          ].join("\n"),
        },
      ],
    });

    expect(guarded.changed).toBe(true);
    expect(guarded.audit?.claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          claimType: "public_link",
          requiredEvidenceType: "command",
          matchStatus: "missing",
        }),
      ]),
    );
    expect(guarded.payloads[0]?.text).toContain("command evidence with exit code 0");
  });

  it("allows public-link success claims only with matching reachability command evidence", () => {
    const text = [
      "The public link works from your MacBook: https://example.ngrok-free.app",
      "Verified evidence: curl -I https://example.ngrok-free.app exited 0.",
      "Next build gap: none.",
      "Completion Grade: 10/10",
      "Criticality: 10/10",
      "Status: blocked",
    ].join("\n");
    const guarded = applyControlDirectorTruthGate({
      agentId: "main",
      payloads: [{ text }],
      evidence: [
        {
          type: "command",
          id: "curl-public-link",
          source: "curl -I https://example.ngrok-free.app",
          summary: "Public URL reachability check exited 0 for MacBook-accessible link.",
          status: "passed",
          exitCode: 0,
        },
      ],
    });

    expect(guarded.changed).toBe(false);
    expect(guarded.audit?.status).toBe("passed");
  });

  it("does not rewrite normal agents that mention Control Director-like status text", () => {
    const payloads = [
      {
        text: [
          "Control Director status example:",
          "Remote proof passed on GitHub Actions.",
          "Status: complete",
        ].join("\n"),
      },
    ];

    expect(applyControlDirectorTruthGate({ agentId: "builder", payloads })).toEqual({
      payloads,
      changed: false,
    });
    expect(
      applyControlDirectorLivenessWatchdog({
        agentId: "builder",
        payloads,
        classification: "empty",
        canQueueContinuation: true,
      }),
    ).toMatchObject({ payloads, changed: false });
  });
});
