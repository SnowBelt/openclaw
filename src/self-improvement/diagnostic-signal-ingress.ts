import crypto from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { redactSensitiveFieldValue } from "../logging/redact.js";
import type { SelfImprovementSignalInput, SelfImprovementSignalRecordResult } from "./signals.js";
import { sanitizeRecommendationText } from "./text.js";

const INGRESS_SCHEMA = "openclaw.self-improvement.diagnostic-ingress.v1";
const DEFAULT_DRAIN_INTERVAL_MS = 30_000;
const MAX_INGRESS_RECORDS = 10_000;
const MAX_TEXT_LENGTH = 640;
const MAX_RECORD_BYTES = 256 * 1024;

type DiagnosticSignalIngressRecord = {
  schema: typeof INGRESS_SCHEMA;
  recordId: string;
  createdAt: number;
  input: SelfImprovementSignalInput;
  payloadSha256: string;
};

type RecordSignal = (params: {
  input: SelfImprovementSignalInput;
  stateDir?: string;
}) => Promise<SelfImprovementSignalRecordResult>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

function sha256(value: unknown): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function redactText(field: string, value: string): string {
  return sanitizeRecommendationText(redactSensitiveFieldValue(field, value), MAX_TEXT_LENGTH);
}

function redactInput(input: SelfImprovementSignalInput): SelfImprovementSignalInput {
  return {
    ...input,
    idempotencyKey: redactText("idempotencyKey", input.idempotencyKey),
    source: {
      component: redactText("source.component", input.source.component),
      ...(input.source.subsystem
        ? { subsystem: redactText("source.subsystem", input.source.subsystem) }
        : {}),
      ...(input.source.version
        ? { version: redactText("source.version", input.source.version) }
        : {}),
      ...(input.source.owner ? { owner: redactText("source.owner", input.source.owner) } : {}),
    },
    summary: redactText("summary", input.summary),
    ...(input.runId ? { runId: redactText("runId", input.runId) } : {}),
    ...(input.taskId ? { taskId: redactText("taskId", input.taskId) } : {}),
    ...(input.traceId ? { traceId: redactText("traceId", input.traceId) } : {}),
    ...(input.errorCode ? { errorCode: redactText("errorCode", input.errorCode) } : {}),
    ...(input.expected ? { expected: redactText("expected", input.expected) } : {}),
    ...(input.observed ? { observed: redactText("observed", input.observed) } : {}),
    ...(input.evidenceRefs
      ? {
          evidenceRefs: input.evidenceRefs
            .slice(0, 20)
            .map((entry) => redactText("evidenceRef", entry)),
        }
      : {}),
  };
}

function ingressDir(stateDir: string): string {
  return path.join(stateDir, "self-improvement", "diagnostic-signal-ingress");
}

export function resolveExternalWorkflowIngressDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.OPENCLAW_EXTERNAL_WORKFLOW_INGRESS_DIR?.trim();
  return configured
    ? path.resolve(configured)
    : path.join(os.homedir(), ".openclaw-custom-runtime", "external-workflow-events");
}

function syncDirectory(directory: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(directory, "r");
    fs.fsyncSync(descriptor);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EINVAL" && code !== "ENOTSUP" && code !== "EPERM" && code !== "EISDIR") {
      throw error;
    }
  } finally {
    if (descriptor !== undefined) {
      fs.closeSync(descriptor);
    }
  }
}

export function stageDiagnosticSignalInput(params: {
  stateDir: string;
  input: SelfImprovementSignalInput;
  now?: number;
}): string {
  const directory = ingressDir(params.stateDir);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const pendingCount = fs
    .readdirSync(directory)
    .filter((entry) => entry.endsWith(".json") && !entry.includes(".quarantine-")).length;
  if (pendingCount >= MAX_INGRESS_RECORDS) {
    throw new Error(`diagnostic signal ingress is full (${MAX_INGRESS_RECORDS} records)`);
  }
  const recordId = `${params.now ?? Date.now()}-${crypto.randomUUID()}`;
  const input = redactInput(params.input);
  const unsigned = {
    schema: INGRESS_SCHEMA as typeof INGRESS_SCHEMA,
    recordId,
    createdAt: params.now ?? Date.now(),
    input,
  };
  const record: DiagnosticSignalIngressRecord = {
    ...unsigned,
    payloadSha256: sha256(unsigned),
  };
  const targetPath = path.join(directory, `${recordId}.json`);
  const tempPath = path.join(directory, `.${recordId}.${process.pid}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(tempPath, "wx", 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(tempPath, targetPath);
    syncDirectory(directory);
    return targetPath;
  } finally {
    if (descriptor !== undefined) {
      fs.closeSync(descriptor);
    }
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // The durable record either exists at targetPath or staging failed visibly.
    }
  }
}

function parseRecord(raw: string): DiagnosticSignalIngressRecord {
  const parsed = JSON.parse(raw) as Partial<DiagnosticSignalIngressRecord>;
  if (
    parsed.schema !== INGRESS_SCHEMA ||
    typeof parsed.recordId !== "string" ||
    typeof parsed.createdAt !== "number" ||
    !parsed.input ||
    typeof parsed.payloadSha256 !== "string"
  ) {
    throw new Error("invalid diagnostic signal ingress record");
  }
  const expected = sha256({
    schema: parsed.schema,
    recordId: parsed.recordId,
    createdAt: parsed.createdAt,
    input: parsed.input,
  });
  if (expected !== parsed.payloadSha256) {
    throw new Error("diagnostic signal ingress hash mismatch");
  }
  return parsed as DiagnosticSignalIngressRecord;
}

export function startDiagnosticSignalIngress(params: {
  stateDir: string;
  recordSignal: RecordSignal;
  intervalMs?: number;
  log?: { error: (message: string) => void };
  externalWorkflowDir?: string;
}): {
  submit: (input: SelfImprovementSignalInput) => void;
  drain: () => Promise<number>;
  stop: () => void;
} {
  const directory = ingressDir(params.stateDir);
  const directories = [
    directory,
    ...(params.externalWorkflowDir ? [params.externalWorkflowDir] : []),
  ];
  let stopped = false;
  let activeDrain: Promise<number> | undefined;

  const runDrain = async (): Promise<number> => {
    let drained = 0;
    for (const sourceDirectory of directories) {
      await fsPromises.mkdir(sourceDirectory, { recursive: true, mode: 0o700 });
      const directoryInfo = await fsPromises.lstat(sourceDirectory);
      if (
        !directoryInfo.isDirectory() ||
        directoryInfo.isSymbolicLink() ||
        (directoryInfo.mode & 0o077) !== 0
      ) {
        params.log?.error(`diagnostic signal ingress directory is not private: ${sourceDirectory}`);
        continue;
      }
      const entries = (await fsPromises.readdir(sourceDirectory))
        .filter((entry) => entry.endsWith(".json") && !entry.includes(".quarantine-"))
        .sort();
      let sourceDrained = 0;
      for (const entry of entries) {
        const filePath = path.join(sourceDirectory, entry);
        let record: DiagnosticSignalIngressRecord;
        try {
          const info = await fsPromises.lstat(filePath);
          if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_RECORD_BYTES) {
            throw new Error("invalid diagnostic signal ingress file");
          }
          record = parseRecord(await fsPromises.readFile(filePath, "utf8"));
        } catch (error) {
          const quarantinePath = `${filePath}.quarantine-${Date.now()}`;
          await fsPromises.rename(filePath, quarantinePath).catch(() => undefined);
          params.log?.error(`diagnostic signal ingress record quarantined: ${String(error)}`);
          continue;
        }
        try {
          await params.recordSignal({ input: record.input, stateDir: params.stateDir });
        } catch (error) {
          params.log?.error(`diagnostic signal ingress delivery failed: ${String(error)}`);
          return drained;
        }
        await fsPromises.unlink(filePath);
        drained += 1;
        sourceDrained += 1;
      }
      if (sourceDrained > 0) {
        syncDirectory(sourceDirectory);
      }
    }
    return drained;
  };

  const drain = (): Promise<number> => {
    if (!activeDrain) {
      activeDrain = runDrain().finally(() => {
        activeDrain = undefined;
      });
    }
    return activeDrain;
  };

  const timer = setInterval(() => {
    if (!stopped) {
      void drain();
    }
  }, params.intervalMs ?? DEFAULT_DRAIN_INTERVAL_MS);
  timer.unref?.();
  void drain();

  return {
    submit: (input) => {
      if (stopped) {
        throw new Error("diagnostic signal ingress is stopped");
      }
      stageDiagnosticSignalInput({ stateDir: params.stateDir, input });
      void drain();
    },
    drain,
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
