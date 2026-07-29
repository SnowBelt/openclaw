// Control UI tests cover tool expansion state behavior.
import { afterEach, describe, expect, it } from "vitest";
import type { MessageGroup } from "../types/chat-types.ts";
import {
  getExpandedToolCards,
  getToolExpansionRenderVersion,
  resetToolExpansionStateForTest,
  setToolCardExpanded,
  syncToolCardExpansionState,
} from "./tool-expansion-state.ts";

afterEach(() => {
  resetToolExpansionStateForTest();
});

function createGroup(message: unknown, key = "assistant-1"): MessageGroup {
  return {
    kind: "group",
    key,
    role: "assistant",
    messages: [{ key, message }],
    timestamp: 1,
    isStreaming: false,
  };
}

describe("tool expansion state", () => {
  it("expands already-visible tool cards when auto-expand turns on", () => {
    const group = createGroup({
      role: "assistant",
      content: [
        {
          type: "toolcall",
          id: "call-1",
          name: "browser.open",
          arguments: { url: "https://example.com" },
        },
      ],
    });

    syncToolCardExpansionState("main", [group], false);
    expect(getExpandedToolCards("main").get("assistant-1:toolcard:0")).toBe(false);
    expect(getToolExpansionRenderVersion("main")).toBe(1);

    syncToolCardExpansionState("main", [group], true);
    expect(getExpandedToolCards("main").get("assistant-1:toolcard:0")).toBe(true);
    expect(getToolExpansionRenderVersion("main")).toBe(2);
  });

  it("skips unchanged synchronization work without invalidating the rendered thread", () => {
    const group = createGroup({
      role: "tool",
      content: [{ type: "text", text: "done" }],
      toolCallId: "call-1",
    });
    const items = [group];

    syncToolCardExpansionState("main", items, false);
    const version = getToolExpansionRenderVersion("main");
    syncToolCardExpansionState("main", items, false);

    expect(getToolExpansionRenderVersion("main")).toBe(version);
    expect(getExpandedToolCards("main").get("toolmsg:assistant-1")).toBe(false);
  });

  it("invalidates the rendered thread only when expansion state changes", () => {
    setToolCardExpanded("main", "toolmsg:assistant-1", true);
    expect(getToolExpansionRenderVersion("main")).toBe(1);

    setToolCardExpanded("main", "toolmsg:assistant-1", true);
    expect(getToolExpansionRenderVersion("main")).toBe(1);

    setToolCardExpanded("main", "toolmsg:assistant-1", false);
    expect(getToolExpansionRenderVersion("main")).toBe(2);
    expect(getExpandedToolCards("main").get("toolmsg:assistant-1")).toBe(false);
  });
});
