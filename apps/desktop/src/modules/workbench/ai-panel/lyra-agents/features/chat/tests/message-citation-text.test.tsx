import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { AgentTranscriptCitation } from "../../../../../../../shared/agent";
import { MessageCitationText } from "../MessageCitationText";

const citation = (id: string, preview: string): AgentTranscriptCitation => ({
  id,
  messageId: `message-${id}`,
  role: "assistant",
  blockId: null,
  startOffset: null,
  endOffset: null,
  excerptKind: "selection",
  preview,
  quotedText: preview,
  truncated: false,
  sourceCreatedAt: null
});

describe("MessageCitationText", () => {
  it("stacks citation-only content so the bubble sizes to the longest chip", () => {
    const first = citation("first", "First reference");
    const second = citation("second", "Second reference");
    const { container } = render(
      <MessageCitationText
        text={`⟦cite:${first.id}⟧ ⟦cite:${second.id}⟧`}
        transcriptCitations={[first, second]}
        pageCitations={[]}
      />
    );

    const group = container.querySelector(".lyra-agents-inline-resource-group");
    expect(group).not.toBeNull();
    expect(group?.querySelectorAll(":scope > .lyra-agents-inline-resource")).toHaveLength(2);
    expect(group?.textContent).toBe("First referenceSecond reference");
  });

  it("keeps citations inline when the message also contains prose", () => {
    const reference = citation("inline", "Inline reference");
    const { container } = render(
      <MessageCitationText
        text={`Review ⟦cite:${reference.id}⟧ please`}
        transcriptCitations={[reference]}
        pageCitations={[]}
      />
    );

    expect(container.querySelector(".lyra-agents-inline-resource-group")).toBeNull();
    expect(container.textContent).toBe("Review Inline reference please");
  });
});
