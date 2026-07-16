import type { Static } from "typebox";
import { describe, expectTypeOf, it } from "vitest";
import { SessionsPatchParamsSchema } from "./schema/sessions.js";
import type { SessionsPatchParams } from "./sessions-patch-types.js";

describe("narrow session patch type", () => {
  it("stays aligned with the canonical runtime schema", () => {
    expectTypeOf<SessionsPatchParams>().toEqualTypeOf<Static<typeof SessionsPatchParamsSchema>>();
  });
});
