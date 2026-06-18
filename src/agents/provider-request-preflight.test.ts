// Provider request preflight tests cover redacted Control Director blocking
// reports for provider-incompatible final tool payloads.
import { describe, expect, it } from "vitest";
import { FailoverError } from "./failover-error.js";
import {
  buildProviderRequestPreflightAudit,
  buildProviderRequestRejectionAudit,
  createProviderRequestPreflightError,
  createProviderRequestRejectionError,
  formatControlDirectorProviderRequestBlockedReport,
  isProviderSchemaOrToolPayloadRejection,
  normalizeProviderRequestSchemaDiagnostics,
} from "./provider-request-preflight.js";

describe("provider request preflight diagnostics", () => {
  it("builds a Control Director blocked report for provider schema diagnostics", () => {
    const diagnostics = normalizeProviderRequestSchemaDiagnostics({
      providerDiagnostics: [
        {
          toolName: "bad_tool",
          toolIndex: 0,
          violations: ["anyOf is not supported by this provider"],
        },
      ],
    });
    const audit = buildProviderRequestPreflightAudit({
      now: 100,
      runId: "run-1",
      provider: "openai",
      model: "gpt-5.5",
      tools: [{ name: "bad_tool" }] as never,
      diagnostics,
    });

    expect(audit).toMatchObject({
      runId: "run-1",
      provider: "openai",
      model: "gpt-5.5",
      status: "blocked_preflight",
      diagnosticCount: 1,
      missingCondition: "provider-compatible final tool schema payload",
      rewriteAction: "blocked_provider_request",
    });
    expect(formatControlDirectorProviderRequestBlockedReport(audit)).toContain("Status: blocked");
    expect(formatControlDirectorProviderRequestBlockedReport(audit)).toContain(
      "Root cause: bad_tool failed provider schema diagnostics",
    );
  });

  it("redacts provider rejection evidence before storing diagnostics", () => {
    const error = new FailoverError(
      "LLM request failed: provider rejected the request schema or tool payload.",
      {
        reason: "format",
        provider: "openai",
        model: "gpt-5.5",
        status: 400,
        rawError:
          '400 bad request: tool schema invalid api_key="sk-secretsecretsecret" Authorization: Bearer ghp_secretsecretsecret',
      },
    );

    const audit = buildProviderRequestRejectionAudit({
      now: 101,
      runId: "run-2",
      provider: "openai",
      model: "gpt-5.5",
      tools: [{ name: "bad_tool" }] as never,
      error,
    });

    expect(audit).toMatchObject({
      status: "provider_rejected",
      httpStatus: 400,
      providerErrorHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      providerErrorPreview: expect.stringContaining("[redacted]"),
    });
    expect(audit?.providerErrorPreview).not.toContain("sk-secretsecretsecret");
    expect(audit?.providerErrorPreview).not.toContain("ghp_secretsecretsecret");
  });

  it("wraps Control Director preflight failures as actionable blocked errors", () => {
    const audit = buildProviderRequestPreflightAudit({
      now: 100,
      provider: "openai",
      model: "gpt-5.5",
      tools: [{ name: "bad_tool" }] as never,
      diagnostics: [
        {
          toolName: "bad_tool",
          source: "provider",
          violations: ["bad schema"],
        },
      ],
    });

    const error = createProviderRequestPreflightError(audit, { controlDirector: true });

    expect(error.message).toContain("Status: blocked");
    expect(error.message).toContain("Verified state:");
    expect(error.message).toContain("Missing evidence/condition:");
    expect(error.message).not.toContain("LLM request failed");
  });

  it("detects common provider schema rejection messages", () => {
    expect(
      isProviderSchemaOrToolPayloadRejection(
        "LLM request failed: provider rejected the request schema or tool payload.",
      ),
    ).toBe(true);
    expect(isProviderSchemaOrToolPayloadRejection("400 invalid tool JSON schema", 400)).toBe(true);
    expect(isProviderSchemaOrToolPayloadRejection("429 rate limit", 429)).toBe(false);
  });

  it("keeps non-Control-Director preflight failures generic", () => {
    const audit = buildProviderRequestPreflightAudit({
      now: 100,
      provider: "openai",
      model: "gpt-5.5",
      tools: [{ name: "bad_tool" }] as never,
      diagnostics: [
        {
          toolName: "bad_tool",
          source: "provider",
          violations: ["bad schema"],
        },
      ],
    });

    expect(createProviderRequestPreflightError(audit).message).toContain(
      "Provider request preflight blocked",
    );
    expect(createProviderRequestRejectionError(audit, new Error("bad")).message).toContain(
      "Provider request preflight blocked",
    );
  });
});
