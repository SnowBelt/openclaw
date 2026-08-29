// SAFETY-RATCHET: template-aware
// SAFETY-RATCHET: template-aware
import fs from "node:fs/promises";
import path from "node:path";
import type { Command } from "commander";
import {
  addGatewayClientOptions,
  callGatewayFromCli,
  type GatewayRpcOpts,
} from "openclaw/plugin-sdk/gateway-runtime";
import type { OpenClawConfig } from "../api.js";
import { CallerProofVerifier } from "./auth.js";
import { createCallerAuth, sha256File } from "./crypto.js";
import { computePolicyDigest, renderPinnedRingerConfig } from "./pins.js";
import { evaluateQualificationFile } from "./qualification.js";
import type { ResolvedRingerConfig, RingerRunAction } from "./types.js";

type ParentOptions = GatewayRpcOpts & { json?: boolean };

const GATEWAY_TIMEOUT_MS = {
  snapshot: 60_000,
  prepare: 360_000,
  run: 900_000,
  cancel: 120_000,
} as const;

function output(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function parentOptions(command: Command): ParentOptions {
  // SAFETY: Every registered Ringer command is mounted below the parent command.
  return command.parent?.opts() as ParentOptions;
}

function operationOptions(command: Command, defaultTimeoutMs: number): ParentOptions {
  const options = parentOptions(command);
  return command.parent?.getOptionValueSource("timeout") === "default"
    ? { ...options, timeout: String(defaultTimeoutMs) }
    : options;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

async function signedCall(params: {
  method: "ringer.prepare" | "ringer.run" | "ringer.cancel";
  payload: Record<string, unknown>;
  command: Command;
  config: ResolvedRingerConfig;
  appConfig: OpenClawConfig;
}): Promise<unknown> {
  const verifier = new CallerProofVerifier(params.config, params.appConfig);
  const secret = await verifier.resolveSecret();
  const auth = createCallerAuth(params.payload, secret);
  return await callGatewayFromCli(
    params.method,
    operationOptions(
      params.command,
      params.method === "ringer.prepare"
        ? GATEWAY_TIMEOUT_MS.prepare
        : params.method === "ringer.cancel"
          ? GATEWAY_TIMEOUT_MS.cancel
          : GATEWAY_TIMEOUT_MS.run,
    ),
    { ...params.payload, auth },
    // Shared-token CLI sessions intentionally clear requested scopes. The
    // loopback backend client preserves this explicit least-privilege scope
    // while still using the file-backed Gateway credential and caller proof.
    { scopes: ["operator.approvals"], clientName: "gateway-client", mode: "backend" },
  );
}

function registerRunCommand(params: {
  parent: Command;
  action: RingerRunAction;
  config: ResolvedRingerConfig;
  appConfig: OpenClawConfig;
}): void {
  const commandName = params.action.replace("_", "-");
  const command = params.parent
    .command(commandName)
    .description(`${commandName} an exact Local AI Assist manifest`)
    .requiredOption("--manifest <path>", "Absolute adapter manifest path")
    .option("--manifest-sha256 <digest>", "Expected manifest SHA-256 (computed when omitted)")
    .requiredOption("--snapshot <id>", "Prepared snapshot ID")
    .requiredOption("--source-sha <sha>", "Exact immutable snapshot SHA");
  if (params.action === "start") {
    command.option(
      "--qualification",
      "Run one bounded live qualification canary while production routing remains disabled",
      false,
    );
  }
  command.action(async (options, actionCommand: Command) => {
    const manifestPath = await fs.realpath(options.manifest);
    const payload = {
      action: params.action,
      manifestPath,
      expectedManifestSha256: options.manifestSha256 ?? (await sha256File(manifestPath)),
      snapshotId: options.snapshot,
      expectedSourceSha: options.sourceSha,
      ...(params.action === "start" && options.qualification === true
        ? { qualification: true }
        : {}),
    };
    output(
      await signedCall({
        method: "ringer.run",
        payload,
        command: actionCommand,
        config: params.config,
        appConfig: params.appConfig,
      }),
    );
  });
}

export function registerRingerCli(
  program: Command,
  config: ResolvedRingerConfig,
  appConfig: OpenClawConfig,
): void {
  const ringer = program
    .command("ringer")
    .description("Operate proof-gated Local AI Assist swarms")
    .option("--json", "Output JSON", true);
  addGatewayClientOptions(ringer);
  ringer
    .command("snapshot")
    .description("Inspect Local AI Assist health, pins, capacity, and receipts")
    .action(async (_options, command: Command) => {
      output(
        await callGatewayFromCli(
          "ringer.snapshot",
          operationOptions(command, GATEWAY_TIMEOUT_MS.snapshot),
          {},
          {
            scopes: ["operator.read"],
            clientName: "gateway-client",
            mode: "backend",
          },
        ),
      );
    });
  ringer
    .command("config-template")
    .description("Print the exact pinned Ringer TOML template")
    .option("--state-dir <path>", "Adapter state directory", config.stateDir)
    .action((options) => {
      process.stdout.write(renderPinnedRingerConfig({ stateDir: options.stateDir }));
    });
  ringer
    .command("qualification-report")
    .description("Evaluate matched-corpus and live-canary evidence without enabling routing")
    .requiredOption("--input <path>", "Qualification evidence JSON")
    .option("--output <path>", "Write a private digest-pinnable receipt")
    .action(async (options) => {
      const receipt = await evaluateQualificationFile(await fs.realpath(options.input));
      if (options.output) {
        const outputPath = path.resolve(options.output);
        await fs.writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, {
          mode: 0o600,
          flag: "wx",
        });
        await fs.chmod(outputPath, 0o600);
      }
      output(receipt);
    });
  ringer
    .command("policy-digest")
    .description("Print the normalized plugin policy digest without resolving the caller secret")
    .action(() => {
      output({ policySha256: computePolicyDigest(config) });
    });
  ringer
    .command("prepare")
    .description("Create an immutable shadow snapshot without mutating the repository")
    .requiredOption("--repo <path>", "Canonical repository root")
    .requiredOption("--head <sha>", "Expected current repository HEAD")
    .option("--include-untracked <path>", "Explicit untracked file to include", collect, [])
    .action(async (options, command: Command) => {
      const payload = {
        repo: await fs.realpath(options.repo),
        expectedHeadSha: options.head,
        includeUntrackedPaths: options.includeUntracked,
      };
      output(
        await signedCall({
          method: "ringer.prepare",
          payload,
          command,
          config,
          appConfig,
        }),
      );
    });
  for (const action of ["lint", "dry_run", "baseline", "start"] as const) {
    registerRunCommand({ parent: ringer, action, config, appConfig });
  }
  ringer
    .command("cancel")
    .description("Cancel one retained Local AI Assist run and wait for durable cleanup")
    .argument("<run-id>", "Retained adapter run ID")
    .action(async (runId: string, _options, command: Command) => {
      output(
        await signedCall({
          method: "ringer.cancel",
          payload: { runId },
          command,
          config,
          appConfig,
        }),
      );
    });
}
