import type { Static } from "typebox";
import { describe, expectTypeOf, it } from "vitest";
import type {
  ConnectParams,
  ErrorShape,
  EventFrame,
  HelloOk,
  RequestFrame,
} from "./frame-types.js";
import {
  ConnectParamsSchema,
  ErrorShapeSchema,
  EventFrameSchema,
  HelloOkSchema,
  RequestFrameSchema,
} from "./schema/frames.js";

describe("narrow gateway frame types", () => {
  it("stay aligned with the canonical runtime schemas", () => {
    expectTypeOf<ConnectParams>().toEqualTypeOf<Static<typeof ConnectParamsSchema>>();
    expectTypeOf<ErrorShape>().toEqualTypeOf<Static<typeof ErrorShapeSchema>>();
    expectTypeOf<EventFrame>().toEqualTypeOf<Static<typeof EventFrameSchema>>();
    expectTypeOf<HelloOk>().toMatchTypeOf<Static<typeof HelloOkSchema>>();
    expectTypeOf<Static<typeof HelloOkSchema>>().toMatchTypeOf<HelloOk>();
    expectTypeOf<RequestFrame>().toEqualTypeOf<Static<typeof RequestFrameSchema>>();
  });
});
