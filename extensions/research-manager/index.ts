import { definePluginEntry, type AnyAgentTool, type OpenClawPluginApi } from "./api.js";
import { RESEARCH_MANAGER_TOOL_DESCRIPTOR } from "./src/tool-descriptor.js";

type ResearchManagerToolRuntime = Pick<typeof import("./src/tool.js"), "createResearchManagerTool">;

export function createLazyResearchManagerTool(
  params: Parameters<ResearchManagerToolRuntime["createResearchManagerTool"]>[0],
  loadRuntime: () => Promise<ResearchManagerToolRuntime> = () => import("./src/tool.js"),
): AnyAgentTool {
  let toolPromise: Promise<AnyAgentTool> | undefined;
  const loadTool = () => {
    toolPromise ??= loadRuntime().then(
      (runtime) => runtime.createResearchManagerTool(params) as unknown as AnyAgentTool,
    );
    return toolPromise;
  };
  return {
    ...RESEARCH_MANAGER_TOOL_DESCRIPTOR,
    async execute(toolCallId, args, signal, onUpdate) {
      return await (await loadTool()).execute(toolCallId, args, signal, onUpdate);
    },
  };
}

export default definePluginEntry({
  id: "research-manager",
  name: "Research Manager",
  description:
    "Local-first research orchestration with frontier planning, evidence ledgers, and fail-closed certification.",
  register(api: OpenClawPluginApi) {
    api.registerTool((ctx) => createLazyResearchManagerTool({ api, ctx }), {
      optional: true,
      name: "research-manager",
    });
    api.registerCli(
      async ({ program }) => {
        const { registerResearchManagerCli } = await import("./src/cli.js");
        registerResearchManagerCli({ api, program });
      },
      {
        descriptors: [
          {
            name: "research",
            description: "Run and inspect durable evidence-backed research",
            hasSubcommands: true,
          },
        ],
      },
    );
    api.registerService({
      id: "research-manager-recovery",
      async start() {
        const { recoverInterruptedAcceptanceReceipts, recoverInterruptedResearchRuns } =
          await import("./src/durability.js");
        const { getResearchManagerRuntime } = await import("./src/runtime.js");
        const runtime = getResearchManagerRuntime(api);
        await runtime.prepare();
        const [recoveredRunIds, recoveredReceiptIds] = await Promise.all([
          recoverInterruptedResearchRuns(runtime.store),
          recoverInterruptedAcceptanceReceipts(runtime.store),
        ]);
        if (recoveredRunIds.length > 0) {
          api.logger.warn(
            `research-manager: marked ${recoveredRunIds.length} interrupted run(s) resumable`,
          );
        }
        if (recoveredReceiptIds.length > 0) {
          api.logger.warn(
            `research-manager: marked ${recoveredReceiptIds.length} interrupted acceptance receipt(s) resumable`,
          );
        }
      },
    });
  },
});
