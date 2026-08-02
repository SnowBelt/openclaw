import { afterEach, describe, expect, it } from "vitest";
import { listPccPresence, resetPccPresenceForTest, updatePccPresence } from "./presence.js";

afterEach(() => resetPccPresenceForTest());

describe("PCC team presence", () => {
  it("deduplicates an operator device and caps the private team at six", () => {
    updatePccPresence("device-1", {
      displayName: "Matthew",
      status: "online",
      surface: "overview",
    });
    updatePccPresence("device-1", {
      displayName: "Matthew",
      status: "online",
      surface: "project",
      projectId: "project-a",
      editing: true,
    });
    for (let index = 2; index <= 6; index += 1) {
      updatePccPresence(`device-${index}`, {
        displayName: `Operator ${index}`,
        status: "online",
        surface: "projects",
      });
    }

    const presence = listPccPresence();
    expect(presence).toHaveLength(6);
    expect(presence.filter((entry) => entry.displayName === "Matthew")).toHaveLength(1);
    expect(presence).toContainEqual(
      expect.objectContaining({ displayName: "Matthew", projectId: "project-a", editing: true }),
    );

    updatePccPresence("device-7", {
      displayName: "Operator 7",
      status: "online",
      surface: "projects",
    });
    expect(listPccPresence()).toHaveLength(6);
  });

  it("never exposes the device identity used for deduplication", () => {
    updatePccPresence("secret-device-id", {
      displayName: "Operator",
      status: "away",
      surface: "activity",
    });

    expect(JSON.stringify(listPccPresence())).not.toContain("secret-device-id");
  });
});
