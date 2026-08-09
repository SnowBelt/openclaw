import type {
  PccPresenceEntry,
  PccPresenceUpdateParams,
} from "../../packages/gateway-protocol/src/schema/types.js";

const PRESENCE_TTL_MS = 75_000;
const MAX_PRESENCE = 6;

type StoredPresence = PccPresenceEntry & { key: string; sequence: number };
const entries = new Map<string, StoredPresence>();
let updateSequence = 0;

function prune(now = Date.now()): void {
  for (const [key, entry] of entries) {
    if (now - Date.parse(entry.updatedAt) > PRESENCE_TTL_MS) {
      entries.delete(key);
    }
  }
}

export function updatePccPresence(
  key: string,
  input: PccPresenceUpdateParams,
  now = new Date(),
): PccPresenceEntry[] {
  prune(now.getTime());
  const normalizedKey = key.trim();
  if (!normalizedKey) {
    throw new Error("authenticated PCC presence requires a stable connection identity");
  }
  entries.set(normalizedKey, {
    key: normalizedKey,
    sequence: (updateSequence += 1),
    displayName: input.displayName.trim(),
    status: input.status,
    surface: input.surface,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.editing !== undefined ? { editing: input.editing } : {}),
    updatedAt: now.toISOString(),
  });
  if (entries.size > MAX_PRESENCE) {
    const oldest = [...entries.values()].toSorted((a, b) => a.sequence - b.sequence);
    while (entries.size > MAX_PRESENCE) {
      const candidate = oldest.shift();
      if (!candidate) {
        break;
      }
      entries.delete(candidate.key);
    }
  }
  return listPccPresence(now.getTime());
}

export function listPccPresence(now = Date.now()): PccPresenceEntry[] {
  prune(now);
  return [...entries.values()]
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(({ key: _key, sequence: _sequence, ...entry }) => entry);
}

export function resetPccPresenceForTest(): void {
  entries.clear();
  updateSequence = 0;
}
