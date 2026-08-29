import type { OpenClawPluginApi } from "../api.js";
import type { RingerController } from "./controller.js";
import type { RingerCancelRequest, RingerPrepareRequest, RingerRunRequest } from "./types.js";

type GatewayContext = Parameters<Parameters<OpenClawPluginApi["registerGatewayMethod"]>[1]>[0];

function errorResponse(respond: GatewayContext["respond"], error: unknown): void {
  respond(false, undefined, {
    code: "internal_error",
    message: error instanceof Error ? error.message : String(error),
  });
}

function requestObject(params: unknown): Record<string, unknown> {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    throw new Error("Request params must be an object.");
  }
  // SAFETY: The object/array guard above establishes a record-like request.
  return params as Record<string, unknown>;
}

export function registerRingerGatewayMethods(
  api: OpenClawPluginApi,
  controller: RingerController,
): void {
  api.registerGatewayMethod(
    "ringer.snapshot",
    async ({ respond }) => {
      try {
        respond(true, await controller.snapshot());
      } catch (error) {
        errorResponse(respond, error);
      }
    },
    { scope: "operator.read" },
  );
  api.registerGatewayMethod(
    "ringer.prepare",
    async ({ params, respond }) => {
      try {
        respond(
          true,
          // SAFETY: The controller validates the signed request fields before mutation.
          await controller.prepare(requestObject(params) as unknown as RingerPrepareRequest),
        );
      } catch (error) {
        errorResponse(respond, error);
      }
    },
    { scope: "operator.approvals" },
  );
  api.registerGatewayMethod(
    "ringer.run",
    async ({ params, respond }) => {
      try {
        // SAFETY: The controller validates the signed request fields before mutation.
        respond(true, await controller.run(requestObject(params) as unknown as RingerRunRequest));
      } catch (error) {
        errorResponse(respond, error);
      }
    },
    { scope: "operator.approvals" },
  );
  api.registerGatewayMethod(
    "ringer.cancel",
    async ({ params, respond }) => {
      try {
        respond(
          true,
          // SAFETY: The controller validates the signed request fields before mutation.
          await controller.cancel(requestObject(params) as unknown as RingerCancelRequest),
        );
      } catch (error) {
        errorResponse(respond, error);
      }
    },
    { scope: "operator.approvals" },
  );
}
