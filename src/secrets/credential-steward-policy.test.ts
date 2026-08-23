import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  evaluateCredentialStewardExposure,
  type CredentialStewardDecision,
} from "./credential-steward-policy.js";

type CredentialStewardFixture = {
  name: string;
  value?: unknown;
  valueParts?: string[];
  labels?: string[];
  expected: CredentialStewardDecision;
  rawMustNotContain?: string[];
};

const fixtures = JSON.parse(
  readFileSync("test/fixtures/credential-steward-redaction-cases.json", "utf8"),
) as CredentialStewardFixture[];

describe("Credential Steward redaction policy", () => {
  it.each(fixtures)("classifies and redacts $name", (fixture) => {
    const decision = evaluateCredentialStewardExposure({
      value: fixture.valueParts?.join("") ?? fixture.value,
      labels: fixture.labels,
    });

    expect(decision).toEqual(fixture.expected);
    for (const rawValue of fixture.rawMustNotContain ?? []) {
      expect(JSON.stringify(decision)).not.toContain(rawValue);
    }
  });

  it("fails closed without recursing forever on cyclic credential input", () => {
    const credential: Record<string, unknown> = { token: "raw-cycle-token-123456" };
    credential.self = credential;

    const decision = evaluateCredentialStewardExposure({ value: credential });

    expect(decision).toMatchObject({
      exposureKind: "credential_material",
      blocked: true,
      credentialClassesInvolved: ["token"],
    });
    expect(JSON.stringify(decision)).not.toContain("raw-cycle-token-123456");
  });
});
