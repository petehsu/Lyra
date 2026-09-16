import { describe, expect, test } from "vitest";

import type { TerminalDockTab } from "../../../../terminal-dock/types";
import {
  buildTerminalTabPageCitation,
  readTerminalCitationOutput
} from "../terminal-tab-citation";

const terminalTab = (id: string): TerminalDockTab => ({
  id,
  title: "build",
  orientation: "horizontal",
  paneIds: ["pane-1"],
  activePaneId: "pane-1",
  placement: "dock"
});

describe("terminal-tab-citation", () => {
  test("keeps a compact tab-id trail without dumping output", () => {
    const citation = buildTerminalTabPageCitation(terminalTab("term-1"));
    expect(citation.pageUrl).toBe("lyra://terminal/term-1");
    expect(citation.quotedText).toContain("lyra://terminal/term-1");
    expect(citation.quotedText).toContain("build");
    expect(citation.sourceKind).toBe("terminal-tab");
    expect(citation.truncated).toBe(false);
  });

  test("includes short latest output when it fits", () => {
    const citation = buildTerminalTabPageCitation(terminalTab("term-1"), [], {
      text: "$ ls\nREADME.md",
      omitted: false
    });
    expect(citation.quotedText).toContain("$ ls");
    expect(citation.truncated).toBe(false);
  });

  test("omits long output and marks truncated so the agent can look it up", () => {
    const citation = buildTerminalTabPageCitation(terminalTab("term-1"), [], {
      text: "x".repeat(600),
      omitted: true
    });
    expect(citation.quotedText).not.toContain("xxx");
    expect(citation.quotedText).toContain("lyra://terminal/term-1");
    expect(citation.truncated).toBe(true);
  });

  test("readTerminalCitationOutput omits buffers larger than the tail window", async () => {
    const output = await readTerminalCitationOutput(async (request) => {
      if (request.cursor === String(Number.MAX_SAFE_INTEGER)) {
        return { cursor: "8000", output: "", truncated: true };
      }
      return { cursor: "8000", output: "latest", truncated: true };
    }, "session-1");
    expect(output).toEqual({ omitted: true });
  });

  test("readTerminalCitationOutput includes a short full buffer", async () => {
    const output = await readTerminalCitationOutput(async (request) => {
      if (request.cursor === String(Number.MAX_SAFE_INTEGER)) {
        return { cursor: "12", output: "", truncated: false };
      }
      return { cursor: "12", output: "$ ls\nREADME.md", truncated: false };
    }, "session-1");
    expect(output).toEqual({ text: "$ ls\nREADME.md", omitted: false });
  });
});
