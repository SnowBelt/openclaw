import { describe, expect, it } from "vitest";
import type { PccStatus } from "../../packages/gateway-protocol/src/schema/types.js";
import { resolvePccProjectAction } from "./project-action.js";

const project = (status: PccStatus = "active") => ({ status });

describe("resolvePccProjectAction", () => {
  it("uses one deterministic safety-first action precedence", () => {
    expect(
      resolvePccProjectAction({
        project: project("on_hold"),
        setupReady: false,
        hasBlockedMilestone: true,
      }).primaryActionId,
    ).toBe("resume");
    expect(
      resolvePccProjectAction({
        project: project("complete_with_maintenance"),
        setupReady: false,
      }).primaryActionId,
    ).toBe("no_action_required");
    expect(
      resolvePccProjectAction({
        project: project(),
        setupReady: false,
        permissions: [{ status: "needed", type: "codex_usage" }],
      }).primaryActionId,
    ).toBe("fix_setup");
  });

  it("exposes the exact safety action before allowing work", () => {
    const permission = resolvePccProjectAction({
      project: project(),
      setupReady: true,
      permissions: [{ status: "needed", type: "remote_proof" }],
    });
    expect(permission).toMatchObject({
      primaryActionId: "review_permission",
      primaryLabel: "Review Permission",
      topBlocker: "A Remote Proof permission must be reviewed.",
    });

    expect(
      resolvePccProjectAction({
        project: project(),
        setupReady: true,
        hasBlockedMilestone: true,
        blockerLines: ["Missing tool: emulator"],
      }),
    ).toMatchObject({
      primaryActionId: "review_blocker",
      topBlocker: "Missing tool: emulator",
    });
    expect(
      resolvePccProjectAction({
        project: project(),
        setupReady: true,
        blockerLines: ["Capability preflight is blocked: missing-required-skill."],
      }),
    ).toMatchObject({
      primaryActionId: "review_blocker",
      topBlocker: "Capability preflight is blocked: missing-required-skill.",
    });
    expect(
      resolvePccProjectAction({
        project: project(),
        setupReady: true,
        workLoop: { enabled: true, state: "working" },
      }).primaryActionId,
    ).toBe("pause");
  });

  it("does not hide unfinished work behind a terminal project status", () => {
    expect(
      resolvePccProjectAction({
        project: project("complete_with_maintenance"),
        setupReady: true,
        hasIncompleteMilestone: true,
      }),
    ).toMatchObject({
      primaryActionId: "review_blocker",
      primaryLabel: "Review Incomplete Work",
      statusLabel: "Needs review",
      hideWorkControls: true,
    });

    expect(
      resolvePccProjectAction({
        project: project("complete_with_maintenance"),
        setupReady: true,
        hasIncompleteMilestone: false,
      }).primaryActionId,
    ).toBe("no_action_required");
  });
});
