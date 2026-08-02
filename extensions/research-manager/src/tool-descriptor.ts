import { Type } from "typebox";
import type { AnyAgentTool } from "../api.js";

export const RESEARCH_MANAGER_TOOL_DESCRIPTOR = {
  name: "research-manager",
  label: "Research Manager",
  description:
    "Run, resume, inspect, cancel, or diagnose durable evidence-backed research. Certified runs fail closed below 93/100.",
  parameters: Type.Object({
    action: Type.String({
      enum: ["run", "status", "list", "resume", "cancel", "doctor", "acceptance-status"],
    }),
    query: Type.Optional(Type.String({ description: "Research question for action=run." })),
    runId: Type.Optional(Type.String({ description: "Run identifier for status/resume/cancel." })),
    receiptId: Type.Optional(
      Type.String({ description: "Receipt identifier for acceptance-status." }),
    ),
    mode: Type.Optional(Type.String({ enum: ["certified", "best-effort"] })),
    highStakes: Type.Optional(Type.Boolean()),
    maxSources: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
    deadlineMs: Type.Optional(Type.Number({ minimum: 1000 })),
    live: Type.Optional(Type.Boolean({ description: "Run live model probes for doctor." })),
  }),
} satisfies Pick<AnyAgentTool, "name" | "label" | "description" | "parameters">;
