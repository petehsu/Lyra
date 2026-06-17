import { describe, expect, test } from "vitest";
import { AGENT_FOLLOW_ACTIVITY_CONNECTING } from "../../../../../../../shared/agent";
import type { ChatMessage } from "../../../core/types";
import {
  isRecognizedFollowActivity,
  messageActivityIndicator,
  resolveAgentActivityHostMessageId
} from "../Message";
import { renderToStaticMarkup } from "react-dom/server";

const emptyAgentMessage = (): ChatMessage => ({
  id: "agent-1",
  author: "agent",
  blocks: [{ type: "text", id: "text-1", body: "" }]
});

describe("message activity indicators", () => {
  test("recognizes connecting follow activity", () => {
    expect(isRecognizedFollowActivity(AGENT_FOLLOW_ACTIVITY_CONNECTING)).toBe(true);
    expect(isRecognizedFollowActivity("calling_model")).toBe(true);
    expect(isRecognizedFollowActivity("Connecting")).toBe(false);
  });

  test("renders service status dots for connecting and retrying provider", () => {
    const message = emptyAgentMessage();
    const connectingMarkup = renderToStaticMarkup(
      messageActivityIndicator(message, AGENT_FOLLOW_ACTIVITY_CONNECTING)
    );
    const retryMarkup = renderToStaticMarkup(
      messageActivityIndicator(message, "retrying_provider")
    );
    expect(connectingMarkup).toContain("lyra-agents-service-status-dots");
    expect(retryMarkup).toContain("lyra-agents-service-status-dots");
  });

  test("resolves connecting placeholder as activity host while turn is running", () => {
    const messages: ChatMessage[] = [emptyAgentMessage()];
    expect(resolveAgentActivityHostMessageId(messages, true)).toBe("agent-1");
  });
});