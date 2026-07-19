import { describe, expect, it } from "vitest";
import {
  resolveAgentIdByOperationalRole,
  resolveJudgeAgentId,
  resolveProgramManagerAgentId,
  resolveProgramManagerRoute,
} from "./agent-scope-config.js";

describe("agent operational role routing", () => {
  it("routes Program Manager and Judge by role instead of display name", () => {
    const cfg = {
      agents: {
        list: [
          { id: "main", role: "control_director" as const, name: "Todd" },
          { id: "pm", role: "program_manager" as const, name: "Anything" },
          { id: "proof", role: "judge" as const, name: "Not Judge" },
        ],
      },
    };

    expect(resolveAgentIdByOperationalRole(cfg, "control_director")).toBe("main");
    expect(resolveProgramManagerAgentId(cfg, "main")).toBe("pm");
    expect(resolveProgramManagerRoute(cfg, "main")).toEqual({
      agentId: "pm",
      source: "dedicated",
    });
    expect(resolveJudgeAgentId(cfg)).toBe("proof");
  });

  it("falls back to the owner for execution but never invents a Judge", () => {
    const cfg = { agents: { list: [{ id: "main", role: "control_director" as const }] } };

    expect(resolveProgramManagerAgentId(cfg, "main")).toBe("main");
    expect(resolveProgramManagerRoute(cfg, "main")).toEqual({
      agentId: "main",
      source: "owner_fallback",
    });
    expect(resolveJudgeAgentId(cfg)).toBeUndefined();
  });
});
