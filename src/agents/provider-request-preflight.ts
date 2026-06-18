/**
 * Redacted provider request preflight diagnostics.
 */
import { createHash } from "node:crypto";
import type { SessionControlDirectorProviderRequestAuditEntry } from "../config/sessions/types.js";
import { formatErrorMessage } from "../infra/errors.js";
import type { ProviderToolSchemaDiagnostic } from "../plugins/types.js";
import { describeFailoverError } from "./failover-error.js";
import type { AgentTool } from "./runtime/index.js";
import type { RuntimeToolSchemaDiagnostic } from "./tool-schema-projection.js";

export type ProviderRequestSchemaDiagnosticSource = "runtime" | "provider";

export type ProviderRequestSchemaDiagnostic = {
  toolName: string;
  toolIndex?: number;
  source: ProviderRequestSchemaDiagnosticSource;
  violations: string[];
};

export class ProviderRequestPreflightError extends Error {
  readonly audit: SessionControlDirectorProviderRequestAuditEntry;

  constructor(message: string, audit: SessionControlDirectorProviderRequestAuditEntry) {
    super(message);
    this.name = "ProviderRequestPreflightError";
    this.audit = audit;
  }
}

export class ControlDirectorProviderRequestBlockedError extends Error {
  readonly audit: SessionControlDirectorProviderRequestAuditEntry;

  constructor(
    message: string,
    audit: SessionControlDirectorProviderRequestAuditEntry,
    cause?: unknown,
  ) {
    super(message, cause instanceof Error ? { cause } : undefined);
    this.name = "ControlDirectorProviderRequestBlockedError";
    this.audit = audit;
  }
}

const MAX_AUDIT_TOOLS = 50;
const MAX_AUDIT_DIAGNOSTICS = 20;
const MAX_AUDIT_VIOLATIONS = 8;
const MAX_PROVIDER_ERROR_PREVIEW_CHARS = 320;
const TOKEN_RE =
  /\b(?:sk|pk|ghp|gho|ghu|ghs|github_pat|xox[baprs]?|ya29)-[A-Za-z0-9_./+=-]{12,}\b/g;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9_./+=-]{12,}/gi;
const KEY_VALUE_SECRET_RE =
  /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password)\s*[:=]\s*["']?[^"',\s}]+/gi;

export function normalizeProviderRequestSchemaDiagnostics(params: {
  runtimeDiagnostics?: readonly RuntimeToolSchemaDiagnostic[];
  providerDiagnostics?: readonly ProviderToolSchemaDiagnostic[];
}): ProviderRequestSchemaDiagnostic[] {
  return [
    ...(params.runtimeDiagnostics ?? []).map((diagnostic) =>
      normalizeProviderRequestSchemaDiagnostic(diagnostic, "runtime"),
    ),
    ...(params.providerDiagnostics ?? []).map((diagnostic) =>
      normalizeProviderRequestSchemaDiagnostic(diagnostic, "provider"),
    ),
  ].filter((diagnostic) => diagnostic.violations.length > 0);
}

function normalizeProviderRequestSchemaDiagnostic(
  diagnostic: RuntimeToolSchemaDiagnostic | ProviderToolSchemaDiagnostic,
  source: ProviderRequestSchemaDiagnosticSource,
): ProviderRequestSchemaDiagnostic {
  return {
    toolName: sanitizeShortText(diagnostic.toolName || "unknown-tool", 120),
    ...(typeof diagnostic.toolIndex === "number" ? { toolIndex: diagnostic.toolIndex } : {}),
    source,
    violations: diagnostic.violations.map((violation) => sanitizeShortText(violation, 240)),
  };
}

export function buildProviderRequestPreflightAudit(params: {
  runId?: string;
  provider: string;
  model: string;
  tools: readonly Pick<AgentTool, "name">[];
  diagnostics: readonly ProviderRequestSchemaDiagnostic[];
  now?: number;
}): SessionControlDirectorProviderRequestAuditEntry {
  return {
    ts: params.now ?? Date.now(),
    ...(params.runId ? { runId: params.runId } : {}),
    provider: sanitizeShortText(params.provider, 80),
    model: sanitizeShortText(params.model, 160),
    status: "blocked_preflight",
    diagnosticCount: params.diagnostics.length,
    toolNames: params.tools
      .map((tool) => sanitizeShortText(tool.name, 120))
      .slice(0, MAX_AUDIT_TOOLS),
    diagnostics: toAuditDiagnostics(params.diagnostics),
    missingCondition: "provider-compatible final tool schema payload",
    rewriteAction: "blocked_provider_request",
  };
}

export function buildProviderRequestRejectionAudit(params: {
  runId?: string;
  provider: string;
  model: string;
  tools: readonly Pick<AgentTool, "name">[];
  error: unknown;
  now?: number;
}): SessionControlDirectorProviderRequestAuditEntry | undefined {
  const description = describeFailoverError(params.error);
  const raw = description.rawError ?? description.message ?? formatErrorMessage(params.error);
  if (!isProviderSchemaOrToolPayloadRejection(raw, description.status)) {
    return undefined;
  }
  const preview = redactProviderErrorPreview(raw);
  return {
    ts: params.now ?? Date.now(),
    ...(params.runId ? { runId: params.runId } : {}),
    provider: sanitizeShortText(params.provider, 80),
    model: sanitizeShortText(params.model, 160),
    status: "provider_rejected",
    ...(typeof description.status === "number" ? { httpStatus: description.status } : {}),
    providerErrorHash: hashText(raw),
    providerErrorPreview: preview,
    diagnosticCount: 0,
    toolNames: params.tools
      .map((tool) => sanitizeShortText(tool.name, 120))
      .slice(0, MAX_AUDIT_TOOLS),
    diagnostics: [],
    missingCondition:
      "provider accepted request payload with provider-compatible schema and tool definitions",
    rewriteAction: "blocked_provider_request",
  };
}

export function createProviderRequestPreflightError(
  audit: SessionControlDirectorProviderRequestAuditEntry,
  opts?: { controlDirector?: boolean },
): Error {
  const message = opts?.controlDirector
    ? formatControlDirectorProviderRequestBlockedReport(audit)
    : formatGenericProviderRequestBlockedMessage(audit);
  return opts?.controlDirector
    ? new ControlDirectorProviderRequestBlockedError(message, audit)
    : new ProviderRequestPreflightError(message, audit);
}

export function createProviderRequestRejectionError(
  audit: SessionControlDirectorProviderRequestAuditEntry,
  cause: unknown,
  opts?: { controlDirector?: boolean },
): Error {
  const message = opts?.controlDirector
    ? formatControlDirectorProviderRequestBlockedReport(audit)
    : formatGenericProviderRequestBlockedMessage(audit);
  return opts?.controlDirector
    ? new ControlDirectorProviderRequestBlockedError(message, audit, cause)
    : new Error(message, cause instanceof Error ? { cause } : undefined);
}

export function isProviderSchemaOrToolPayloadRejection(raw: string, status?: number): boolean {
  const lower = raw.toLowerCase();
  if (!lower) {
    return false;
  }
  if (
    lower.includes("provider rejected the request schema") ||
    lower.includes("request schema or tool payload")
  ) {
    return true;
  }
  const hasSchemaOrTool =
    lower.includes("schema") ||
    lower.includes("tool") ||
    lower.includes("function") ||
    lower.includes("json_schema");
  const hasRejectSignal =
    lower.includes("invalid") ||
    lower.includes("rejected") ||
    lower.includes("unsupported") ||
    lower.includes("cannot be used") ||
    lower.includes("not permitted") ||
    lower.includes("bad request");
  return (status === 400 || status === 422) && hasSchemaOrTool && hasRejectSignal;
}

export function formatControlDirectorProviderRequestBlockedReport(
  audit: SessionControlDirectorProviderRequestAuditEntry,
): string {
  const rootCause =
    audit.status === "blocked_preflight"
      ? formatDiagnosticRootCause(audit)
      : `Provider rejected the request before model output was available. Redacted provider error hash: ${audit.providerErrorHash ?? "unavailable"}.`;
  return [
    "Status: blocked",
    `Verified state: Control Director did not send or deliver an unsupported provider request. Provider=${audit.provider}; model=${audit.model}.`,
    `Root cause: ${rootCause}`,
    `Missing evidence/condition: ${audit.missingCondition}.`,
    "Next build gap: fix or quarantine the incompatible tool schema/request payload, rerun the exact Control Director request, and verify provider acceptance before retrying completion.",
    "Completion Grade: 8/10",
    "Criticality: 10/10",
  ].join("\n");
}

function formatGenericProviderRequestBlockedMessage(
  audit: SessionControlDirectorProviderRequestAuditEntry,
): string {
  return `Provider request preflight blocked ${audit.diagnosticCount} incompatible tool schema ${audit.diagnosticCount === 1 ? "diagnostic" : "diagnostics"} before sending ${audit.provider}/${audit.model}.`;
}

function formatDiagnosticRootCause(audit: SessionControlDirectorProviderRequestAuditEntry): string {
  const first = audit.diagnostics[0];
  if (!first) {
    return "Provider-compatible tool schema preflight reported an incompatible final request payload.";
  }
  const violation = first.violations[0] ?? "provider schema violation";
  const remaining = audit.diagnosticCount - 1;
  return `${first.toolName} failed ${first.source} schema diagnostics: ${violation}${remaining > 0 ? `; +${remaining} more tool diagnostics` : ""}.`;
}

function toAuditDiagnostics(diagnostics: readonly ProviderRequestSchemaDiagnostic[]) {
  return diagnostics.slice(0, MAX_AUDIT_DIAGNOSTICS).map((diagnostic) => {
    const entry = {
      toolName: diagnostic.toolName,
      source: diagnostic.source,
      violations: diagnostic.violations.slice(0, MAX_AUDIT_VIOLATIONS),
      violationCount: diagnostic.violations.length,
    };
    if (typeof diagnostic.toolIndex === "number") {
      Object.assign(entry, { toolIndex: diagnostic.toolIndex });
    }
    return entry;
  });
}

function redactProviderErrorPreview(raw: string): string {
  const redacted = raw
    .replace(TOKEN_RE, "[redacted-token]")
    .replace(BEARER_RE, "Bearer [redacted-token]")
    .replace(KEY_VALUE_SECRET_RE, "$1=[redacted]");
  return sanitizeShortText(redacted, MAX_PROVIDER_ERROR_PREVIEW_CHARS);
}

function hashText(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function sanitizeShortText(value: unknown, maxLength: number): string {
  const normalized = replaceControlCharacters(stringifyDiagnosticValue(value))
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function stringifyDiagnosticValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return Object.prototype.toString.call(value);
  }
}

function replaceControlCharacters(value: string): string {
  let result = "";
  for (const char of value) {
    const code = char.charCodeAt(0);
    result += code < 0x20 || code === 0x7f ? " " : char;
  }
  return result;
}
