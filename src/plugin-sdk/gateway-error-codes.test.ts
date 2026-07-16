import { describe, expect, it } from "vitest";
import {
  ErrorCodes as canonicalErrorCodes,
  errorShape as canonicalErrorShape,
} from "../../packages/gateway-protocol/src/schema/error-codes.js";
import { ErrorCodes, errorShape } from "./gateway-error-codes.js";

describe("plugin SDK gateway error codes", () => {
  it("stays in sync with the canonical protocol contract", () => {
    expect(ErrorCodes).toEqual(canonicalErrorCodes);
  });

  it("builds the same error payload as the canonical helper", () => {
    const options = { details: { field: "sessionKey" }, retryable: true, retryAfterMs: 250 };
    expect(errorShape(ErrorCodes.INVALID_REQUEST, "invalid request", options)).toEqual(
      canonicalErrorShape(canonicalErrorCodes.INVALID_REQUEST, "invalid request", options),
    );
  });
});
