// SNES Game Creator PCC backfill gives low-reasoning workers exact patch-safe steps.
import type {
  PccMilestone,
  PccSubMilestone,
} from "../../packages/gateway-protocol/src/schema/types.js";

type SnesSubMilestoneSeed = {
  title: string;
  implementationPlan: string;
  acceptanceCriteria: string[];
  proofRequired: string;
};

type SnesMilestoneSeed = {
  milestoneTitle: string;
  steps: SnesSubMilestoneSeed[];
};

export const SNES_GAME_CREATOR_SUB_MILESTONE_BACKFILL: readonly SnesMilestoneSeed[] = [
  {
    milestoneTitle: "Define game concept, scope, and safety rules",
    steps: [
      step(
        "Gather game idea",
        "Capture the requested fantasy, reference games, tone, and player promise in one short brief.",
        "Project brief includes user idea and references.",
      ),
      step(
        "Define genre",
        "Pick one primary genre and one optional secondary influence; reject vague genre blends.",
        "Genre is written as a concrete implementation target.",
      ),
      step(
        "Define target play length",
        "Set the playable demo length, expected first-session length, and production expansion size.",
        "Target length is measurable and scoped.",
      ),
      step(
        "Define controls",
        "List every button, player action, and menu action using SNES controller names.",
        "Control map is complete and playable on a SNES-style controller.",
      ),
      step(
        "Define visual scale",
        "Set tile size, sprite size, HUD size, camera scale, and minimum readability rules.",
        "Visual scale avoids tiny unreadable gameplay.",
      ),
      step(
        "Define ROM/patch safety rules",
        "Write the patch-only delivery contract and banned ROM extensions before implementation.",
        "Rules ban .sfc, .smc, .swc, .fig, and .rom deliverables.",
      ),
      step(
        "List blockers/questions",
        "List unresolved source assets, user approvals, toolchain gaps, and gameplay risks.",
        "Every blocker has an owner or next action.",
      ),
      step(
        "Create project brief",
        "Compile concept, scope, controls, safety rules, and blockers into one handoff-ready brief.",
        "Brief is concise enough for a low-reasoning worker to execute.",
      ),
      step(
        "Get user approval",
        "Stop and request approval for the concept/scope brief before asset or ROM-patch work.",
        "User approval is recorded before build work starts.",
      ),
    ],
  },
  {
    milestoneTitle: "Verify SNES toolchain and emulator smoke path",
    steps: [
      step(
        "List required tools",
        "List assembler/build tools, patch tools, emulator, capture tool, and checksum tool.",
        "Tool list names exact commands or missing blockers.",
      ),
      step(
        "Check assembler/build tools",
        "Run version/help checks for the selected assembler/build toolchain.",
        "Assembler/build command exits 0 or records exact blocker.",
      ),
      step(
        "Check patch tool",
        "Verify patch creation/application tooling without using copyrighted ROM files.",
        "Patch tool command exits 0 or records exact blocker.",
      ),
      step(
        "Check emulator",
        "Verify emulator launch/help path and record the local command for smoke proof.",
        "Emulator command is available or exact blocker is recorded.",
      ),
      step(
        "Check screenshot/video capture",
        "Verify screenshot and optional video capture path for proof artifacts.",
        "Capture path is deterministic enough for proof receipts.",
      ),
      step(
        "Create deterministic preflight command",
        "Create one command that checks the complete SNES toolchain without live guessing.",
        "Preflight command is documented and rerunnable.",
      ),
      step(
        "Run preflight",
        "Run the deterministic preflight command and capture its output.",
        "Preflight exits 0 or fails with a precise blocker.",
      ),
      step(
        "Save proof receipt",
        "Record command, output path, exit code, and next gap in PCC evidence/receipt.",
        "PCC receipt points to the preflight proof.",
      ),
    ],
  },
  {
    milestoneTitle: "Create graphics, sprite, audio, and UI style kit",
    steps: [
      step(
        "Choose art direction",
        "Pick one cohesive visual direction with readability above nostalgia.",
        "Art direction is explicit and user-readable.",
      ),
      step(
        "Define sprite size",
        "Set player/enemy sprite dimensions and collision boxes.",
        "Sprites are large enough for the user's display.",
      ),
      step(
        "Define palette",
        "Choose a palette that fits SNES limits and keeps foreground/background contrast clear.",
        "Palette has documented contrast and hardware constraints.",
      ),
      step(
        "Define HUD scale",
        "Set HUD font/icon scale and safe margins for visible gameplay.",
        "HUD is readable without covering play space.",
      ),
      step(
        "Define animation budget",
        "List required animations and frame counts for MVP and polish phases.",
        "Animation scope is small enough for MVP delivery.",
      ),
      step(
        "Gather/generate rights-safe assets",
        "Use only original, licensed, or generated assets with source notes.",
        "Rights-safe source note exists for each asset.",
      ),
      step(
        "Create contact sheet",
        "Render player, enemies, HUD, tiles, and palette in one review sheet.",
        "Contact sheet shows all key visual assets.",
      ),
      step(
        "Get user approval",
        "Stop for approval before implementing approved assets into the game.",
        "User approval receipt exists.",
      ),
    ],
  },
  {
    milestoneTitle: "Build playable MVP loop",
    steps: [
      step(
        "Implement title/start",
        "Add a title/start flow that reaches gameplay consistently.",
        "Player can start the game from title screen.",
      ),
      step(
        "Implement movement",
        "Implement responsive player movement with readable speed and acceleration.",
        "Movement feels controllable in emulator proof.",
      ),
      step(
        "Implement camera/viewport",
        "Set camera and viewport scale so gameplay is large and easy to read.",
        "Player and objective remain visible during play.",
      ),
      step(
        "Implement collision",
        "Add walls, hazards, and object collision with deterministic behavior.",
        "Collision can be demonstrated in emulator.",
      ),
      step(
        "Add objective",
        "Add one clear objective the player can understand quickly.",
        "Objective is visible and completable.",
      ),
      step(
        "Add hazard/enemy",
        "Add at least one meaningful challenge that supports the objective.",
        "Challenge can fail or pressure the player.",
      ),
      step(
        "Add retry/fail state",
        "Add a fail state and quick retry path.",
        "Player can retry without restarting tooling.",
      ),
      step(
        "Add win state",
        "Add a basic win state for completing the objective.",
        "Win condition is reachable in proof.",
      ),
      step(
        "Run emulator smoke",
        "Run the MVP in emulator through start, movement, challenge, fail/retry, and win.",
        "Smoke proof exits with screenshot or video evidence.",
      ),
      step(
        "Save screenshot/video proof",
        "Save proof artifacts and record them in PCC evidence.",
        "Receipt includes screenshot or video path.",
      ),
    ],
  },
  {
    milestoneTitle: "Add level flow, challenge, and fun pass",
    steps: [
      step(
        "Enlarge/readability pass",
        "Increase visual scale, spacing, contrast, and camera comfort where gameplay feels tiny.",
        "Gameplay is visibly larger and easier to parse.",
      ),
      step(
        "Improve movement feel",
        "Tune speed, acceleration, friction, jump/dodge/action timing, and input forgiveness.",
        "Movement feels more fun in gameplay proof.",
      ),
      step(
        "Add checkpoint/retry",
        "Add checkpoint or fast retry behavior for frictionless replay.",
        "Retry loop is quick and visible.",
      ),
      step(
        "Add collectible/scoring loop",
        "Add a simple reward loop that gives the player a reason to explore or improve.",
        "Score/collectible feedback appears in HUD or result.",
      ),
      step(
        "Add level progression",
        "Add at least one progression beat beyond a flat test room.",
        "Player can move through a start, challenge, and finish flow.",
      ),
      step(
        "Add one memorable moment",
        "Add one distinctive joke, set piece, enemy, animation, or payoff that fits the concept.",
        "Memorable moment is visible in proof.",
      ),
      step(
        "Run gameplay proof",
        "Record gameplay showing readability, fun loop, and progression.",
        "Gameplay proof artifact is saved.",
      ),
      step(
        "Collect feedback",
        "Ask the user what is still too small, boring, slow, or unclear.",
        "Feedback is recorded as PCC notes or backlog items.",
      ),
    ],
  },
  {
    milestoneTitle: "Package patch-only deliverable and receipts",
    steps: [
      step(
        "Build patch package",
        "Create the patch-only package from original project files and generated patch artifacts.",
        "Package contains patch files and no ROM files.",
      ),
      step(
        "Write instructions",
        "Write simple apply/run instructions for the patch package.",
        "Instructions are understandable without repo context.",
      ),
      step(
        "Include checksums",
        "Include checksums for patch files and expected base-file references where lawful.",
        "Checksums are present and reproducible.",
      ),
      step(
        "Include screenshots/proof",
        "Include proof screenshots or video references for the completed build.",
        "Proof artifacts are listed in the package or receipt.",
      ),
      step(
        "Scan for forbidden ROM files",
        "Scan package for .sfc, .smc, .swc, .fig, .rom and other banned ROM payloads.",
        "Forbidden ROM scan passes.",
      ),
      step(
        "Create completion receipt",
        "Record package path, checksums, scan output, and proof artifacts in PCC.",
        "Completion receipt links all required evidence.",
      ),
      step(
        "Mark production-proof complete only after proof passes",
        "Do not mark complete until package, scan, emulator proof, and receipt all pass.",
        "Milestone remains proof-gated until all evidence exists.",
      ),
    ],
  },
  {
    milestoneTitle: "Maintain bug, improvement, and expansion backlog",
    steps: [
      step(
        "Create backlog",
        "Create a backlog with status, priority, owner, and proof requirement for each item.",
        "Backlog exists and is visible in PCC.",
      ),
      step(
        "Classify bugs vs enhancements",
        "Tag every item as bug, improvement, expansion, polish, or question.",
        "Backlog classifications are complete.",
      ),
      step(
        "Add future level ideas",
        "Capture future level/mission ideas without mixing them into current proof scope.",
        "Future ideas are separate from MVP/production proof.",
      ),
      step(
        "Add graphics/audio improvements",
        "Track visual, audio, and UI improvements as optional follow-up work.",
        "Follow-up improvements have acceptance criteria.",
      ),
      step(
        "Define reopen rules",
        "Define what kinds of bugs or additions reopen the project after completion.",
        "Reopen rules are explicit and durable.",
      ),
      step(
        "Preserve old completion receipts",
        "Keep prior receipts visible and do-not-redo notes intact when adding new work.",
        "Historical receipts remain linked to completed work.",
      ),
    ],
  },
] as const;

function step(
  title: string,
  implementationPlan: string,
  acceptanceCriterion: string,
): SnesSubMilestoneSeed {
  return {
    title,
    implementationPlan,
    acceptanceCriteria: [acceptanceCriterion],
    proofRequired: acceptanceCriterion,
  };
}

export function buildSnesGameCreatorSubMilestones(input: {
  projectId: string;
  milestones: readonly Pick<PccMilestone, "id" | "projectId" | "title">[];
  nowIso: string;
}): PccSubMilestone[] {
  const rows: PccSubMilestone[] = [];
  for (const milestoneSeed of SNES_GAME_CREATOR_SUB_MILESTONE_BACKFILL) {
    const milestone = input.milestones.find(
      (candidate) =>
        candidate.projectId === input.projectId && candidate.title === milestoneSeed.milestoneTitle,
    );
    if (!milestone) {
      throw new Error(`missing SNES Game Creator milestone: ${milestoneSeed.milestoneTitle}`);
    }
    milestoneSeed.steps.forEach((seed, index) => {
      rows.push({
        id: `snes-${slug(milestoneSeed.milestoneTitle)}-${String(index + 1).padStart(2, "0")}`,
        projectId: input.projectId,
        milestoneId: milestone.id,
        title: seed.title,
        status: "not_started",
        order: index + 1,
        owner: "local_openclaw_agent",
        percentComplete: 0,
        implementationPlan: seed.implementationPlan,
        acceptanceCriteria: seed.acceptanceCriteria,
        requiredEvidenceIds: [],
        receiptIds: [],
        permissionGrantIds: [],
        createdAt: input.nowIso,
        updatedAt: input.nowIso,
        metadata: {
          pccResponsibility: "local_openclaw_agent",
          pccCostRisk: "low",
          proofRequired: seed.proofRequired,
          canonicalWorkflow: "SNES Studio",
        },
      });
    });
  }
  return rows;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
}
