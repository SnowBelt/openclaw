import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type { CuratorReviewRunner } from "../curator-dispatch.js";
import { createCuratorReviewController } from "./controller.js";
import { createJsonCuratorProposalRepository } from "./json-repository.js";
import { createSimpleCompletionCuratorModelAdapter } from "./model-adapter.js";

export function createRuntimeCuratorReviewRunner(params: {
  stateDir: string;
  getConfig: () => OpenClawConfig;
}): CuratorReviewRunner {
  const repository = createJsonCuratorProposalRepository({ stateDir: params.stateDir });
  const controller = createCuratorReviewController({
    repository,
    model: createSimpleCompletionCuratorModelAdapter({ getConfig: params.getConfig }),
  });
  return async ({ proposalId }) => await controller.review(proposalId);
}
