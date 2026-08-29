import { definePluginEntry } from "./api.js";
import { registerRingerCli } from "./src/cli.js";
import { resolveRingerConfig } from "./src/config.js";
import { RingerController } from "./src/controller.js";
import { registerRingerGatewayMethods } from "./src/gateway.js";
import { collectRingerSecurityFindings } from "./src/security.js";

export default definePluginEntry({
  id: "ringer",
  name: "Local AI Assist",
  description:
    "Proof-gated local agent swarms controlled by Codex through an exact-pinned Ringer adapter.",
  register(api) {
    const config = resolveRingerConfig(api.pluginConfig, api.config);
    const controller = new RingerController(config, api.config);
    registerRingerGatewayMethods(api, controller);
    api.registerCli(
      ({ program }) => {
        registerRingerCli(program, config, api.config);
      },
      {
        commands: ["ringer"],
        descriptors: [
          {
            name: "ringer",
            description: "Operate proof-gated Local AI Assist swarms",
            hasSubcommands: true,
          },
        ],
      },
    );
    let maintenanceTimer: NodeJS.Timeout | undefined;
    api.registerService({
      id: "ringer-supervisor",
      start: async () => {
        if (!config.enabled) {
          return;
        }
        await controller.initialize();
        maintenanceTimer = setInterval(() => {
          void controller
            .reconcileRuns()
            .then(() => controller.pruneRetention())
            .catch((error: unknown) =>
              api.logger.error(`Local AI Assist maintenance failed: ${String(error)}`),
            );
        }, 60_000);
        maintenanceTimer.unref();
      },
      stop: async () => {
        if (maintenanceTimer) {
          clearInterval(maintenanceTimer);
          maintenanceTimer = undefined;
        }
        if (!config.enabled) {
          return;
        }
        await controller.reconcileRuns({ startup: true });
      },
    });
    api.registerSecurityAuditCollector(collectRingerSecurityFindings);
  },
});
