import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { normalizeSourceHandoffPolicy } from "./policy.mjs";
import {
  CONTROL_DIRECTOR_SOURCE_HANDOFF_POLICY_PATH,
  CONTROL_DIRECTOR_SOURCE_HANDOFF_REPO_ROOT,
  SHA_PATTERN,
} from "./shared.mjs";
import { runSourceHandoff } from "./workflow.mjs";

export function parseSourceHandoffArgs(argv) {
  const args = {
    operation: "preflight",
    expectedSha: "",
    expectedBranch: "",
    destinationApproval: "",
    policyPath: CONTROL_DIRECTOR_SOURCE_HANDOFF_POLICY_PATH,
    receiptPath: "",
    json: false,
    help: false,
  };
  let operationSet = false;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--") {
      continue;
    }
    if (!operationSet && !value.startsWith("-")) {
      args.operation = value;
      operationSet = true;
      continue;
    }
    const next = () => {
      const candidate = argv[++index];
      if (!candidate) {
        throw new Error(`Missing value for ${value}.`);
      }
      return candidate;
    };
    if (value === "--sha") {
      args.expectedSha = next();
    } else if (value === "--branch") {
      args.expectedBranch = next();
    } else if (value === "--approve-destination") {
      args.destinationApproval = next();
    } else if (value === "--policy") {
      args.policyPath = path.resolve(next());
    } else if (value === "--receipt") {
      args.receiptPath = path.resolve(next());
    } else if (value === "--json") {
      args.json = true;
    } else if (value === "--help" || value === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  return args;
}

export function defaultSourceHandoffReceiptPath(sha, operation) {
  const safeSha = SHA_PATTERN.test(sha) ? sha : "unknown";
  return path.join(
    CONTROL_DIRECTOR_SOURCE_HANDOFF_REPO_ROOT,
    ".artifacts",
    "control-director",
    "source-handoff",
    `${safeSha}-${operation}.json`,
  );
}

export function writeSourceHandoffReceipt(filePath, receipt) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  fs.writeFileSync(temporaryPath, `${JSON.stringify(receipt, null, 2)}${os.EOL}`, { mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

export function runSourceHandoffCli(argv = process.argv.slice(2)) {
  const args = parseSourceHandoffArgs(argv);
  if (args.help) {
    console.log(
      "Usage: pnpm control-director:source-handoff -- <preflight|status|finish> --sha <sha> --branch <codex/branch> [--approve-destination <url>] [--receipt <path>] [--json]",
    );
    return 0;
  }
  const policy = normalizeSourceHandoffPolicy(JSON.parse(fs.readFileSync(args.policyPath, "utf8")));
  const receipt = runSourceHandoff({
    operation: args.operation,
    expectedSha: args.expectedSha,
    expectedBranch: args.expectedBranch,
    destinationApproval: args.destinationApproval,
    policy,
  });
  const receiptPath =
    args.receiptPath || defaultSourceHandoffReceiptPath(receipt.source.sha, args.operation);
  writeSourceHandoffReceipt(receiptPath, receipt);
  if (args.json) {
    console.log(JSON.stringify({ ...receipt, receiptPath }, null, 2));
  } else {
    console.log(`source-handoff: ${receipt.state}`);
    console.log(receipt.nextAction);
    console.log(`receipt: ${receiptPath}`);
  }
  return !receipt.passed && receipt.state !== "ready_local" ? 2 : 0;
}
