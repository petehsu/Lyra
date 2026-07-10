import { describe, expect, it } from "vitest";

import type { ChatMessage } from "../../../core/types";
import {
  buildFullMessageCitation,
  citationQuoteForMessage,
  parseTextWithCitationMarkers,
  parseTranscriptCitationsFromMetadata,
  hasComposerContent,
  inlineContentMarkersToDisplayText,
  parseRenderedCitationSegments,
  segmentsToCitations,
  segmentsToOmaMentions,
  segmentsToPlainText,
  truncateQuotedText
} from "../message-citation";

const sampleMessage = (body: string, author: "user" | "agent" = "agent"): ChatMessage => ({
  id: "message-1",
  author,
  time: "12:00",
  blocks: [{ type: "text", id: "text-0", body }]
});

describe("truncateQuotedText", () => {
  it("marks long quotes as truncated", () => {
    const longText = "x".repeat(600);
    const result = truncateQuotedText(longText);
    expect(result.truncated).toBe(true);
    expect(result.quotedText.length).toBe(480);
    expect(result.preview.endsWith("…")).toBe(true);
  });
});

describe("buildFullMessageCitation", () => {
  it("captures the full message body", () => {
    const citation = buildFullMessageCitation(sampleMessage("Hello transcript cite"));
    expect(citation.messageId).toBe("message-1");
    expect(citation.role).toBe("assistant");
    expect(citation.excerptKind).toBe("full_message");
    expect(citation.quotedText).toBe("Hello transcript cite");
    expect(citation.truncated).toBe(false);
  });

  it("uses user role and bubble-like preview for user messages", () => {
    const citation = buildFullMessageCitation(sampleMessage("User cited text", "user"));
    expect(citation.role).toBe("user");
    expect(citation.preview).toBe("User cited text");
  });

  it("falls back to an image label when the cited message has no text", () => {
    const message: ChatMessage = {
      id: "message-image",
      author: "user",
      blocks: [{
        type: "image",
        id: "image-0",
        image: {
          id: "img-1",
          mediaType: "image/png",
          data: "abc",
          label: "Screenshot.png"
        }
      }]
    };
    const quote = citationQuoteForMessage(message);
    expect(quote.preview).toBe("Screenshot.png");
    expect(buildFullMessageCitation(message).role).toBe("user");
  });
});

describe("sent message citation rendering", () => {
  it("parses transcript citations from message metadata", () => {
    const citations = parseTranscriptCitationsFromMetadata({
      transcriptCitations: [{
        id: "cite-1",
        messageId: "message-0",
        role: "assistant",
        excerptKind: "selection",
        preview: "Quoted text",
        quotedText: "Quoted text",
        truncated: false
      }]
    });
    expect(citations).toHaveLength(1);
    expect(citations[0]?.id).toBe("cite-1");
  });

  it("replaces inline cite markers with citation segments", () => {
    const citation = buildFullMessageCitation(sampleMessage("Target", "user"));
    const segments = parseTextWithCitationMarkers(
      `Please review ⟦cite:${citation.id}⟧`,
      [citation]
    );
    expect(segments).toEqual([
      { type: "text", value: "Please review " },
      { type: "citation", citation }
    ]);
  });
});

describe("composer segments", () => {
  it("serializes inline cite markers for runtime text", () => {
    const citation = buildFullMessageCitation(sampleMessage("Quoted", "user"));
    const text = segmentsToPlainText([
      { type: "text", value: "Explain " },
      { type: "citation", citation },
      { type: "text", value: " please" }
    ]);
    expect(text).toBe(`Explain ⟦cite:${citation.id}⟧ please`);
    expect(segmentsToCitations([
      { type: "text", value: "x" },
      { type: "citation", citation }
    ])).toEqual([citation]);
  });

  it("keeps Oma Agent mentions structured while serializing their stable marker", () => {
    const mention = {
      mentionId: "oma-reviewer-1",
      sessionAgentId: "session-reviewer",
      agentId: "did:lyra:agent:builtin:reviewer",
      name: "Lyra Reviewer",
      shortName: "Reviewer",
      role: "Release reviewer"
    } as const;
    const segments = [
      { type: "text", value: "Please " },
      { type: "agentMention", mention },
      { type: "text", value: " inspect the release." }
    ] as const;
    expect(segmentsToPlainText(segments)).toBe(
      "Please ⟦oma-agent:oma-reviewer-1⟧ inspect the release."
    );
    expect(segmentsToOmaMentions(segments)).toEqual([mention]);
    expect(parseRenderedCitationSegments(
      "Please ⟦oma-agent:oma-reviewer-1⟧ inspect the release.",
      [],
      [],
      [],
      [],
      [mention]
    )).toEqual([
      { type: "text", value: "Please " },
      { type: "agentMention", mention },
      { type: "text", value: " inspect the release." }
    ]);
  });

  it("renders orphan image markers as placeholder chips instead of raw marker text", () => {
    const segments = parseRenderedCitationSegments(
      "⟦image:dropped-image-orphan⟧",
      [],
      [],
      []
    );
    expect(segments).toEqual([{
      type: "image",
      image: {
        id: "dropped-image-orphan",
        mediaType: "image/png",
        data: "",
        label: null,
        source: null
      }
    }]);
  });

  it("serializes inline image markers at their sentence positions", () => {
    const image = { id: "img-1", mediaType: "image/png", data: "abc" };
    const segments = [
      { type: "text", value: "Look at " },
      { type: "image", image },
      { type: "text", value: " please review" }
    ] as const;
    expect(hasComposerContent(segments)).toBe(true);
    expect(segmentsToPlainText(segments)).toBe("Look at ⟦image:img-1⟧ please review");
  });

  it("collapses inline markers to stable display text for plain titles", () => {
    const citation = buildFullMessageCitation(sampleMessage("Quoted", "user"));
    expect(inlineContentMarkersToDisplayText(`Use ⟦cite:${citation.id}⟧`, [citation]))
      .toBe("Use Quoted");
    const fallback = inlineContentMarkersToDisplayText("⟦page-cite:missing⟧ ⟦future-ref:abc⟧");
    expect(fallback).not.toContain("⟦");
    expect(fallback.length).toBeGreaterThan(0);
  });
});
