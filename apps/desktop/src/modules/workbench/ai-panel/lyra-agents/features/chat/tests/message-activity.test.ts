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

  test("renders dynamic indicators while thinking", () => {
    const streamingMarkup = renderToStaticMarkup(
      messageActivityIndicator(emptyAgentMessage(), "streaming_model")
    );
    const thoughtToolMarkup = renderToStaticMarkup(
      messageActivityIndicator({
        id: "agent-thinking",
        author: "agent",
        blocks: [{
          type: "tools",
          id: "tools-1",
          group: {
            id: "group-1",
            status: "running",
            label: "Thinking",
            currentCallId: "thought-1",
            calls: [{
              id: "thought-1",
              kind: "thought",
              title: "Thinking",
              status: "running"
            }]
          }
        }]
      }, null)
    );
    expect(streamingMarkup).toContain("lyra-agents-braille-spinner");
    expect(thoughtToolMarkup).toContain("lyra-agents-braille-spinner");
  });

  test("resolves connecting placeholder as activity host while turn is running", () => {
    const messages: ChatMessage[] = [emptyAgentMessage()];
    expect(resolveAgentActivityHostMessageId(messages, true)).toBe("agent-1");
  });
});
