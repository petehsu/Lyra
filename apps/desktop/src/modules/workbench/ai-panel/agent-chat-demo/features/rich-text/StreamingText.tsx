import { useStreamText } from "../../hooks/useStreamText";
import { RichText } from "./RichText";

/**
 * Renders text with a streaming (typewriter) effect.
 * Once streaming completes, renders the full rich markdown.
 * During streaming, renders plain text with a blinking cursor.
 */
export function StreamingText({
  content,
  streaming,
}: {
  content: string;
  streaming: boolean;
}) {
  const { text, done } = useStreamText(content, {
    speed: 3,
    interval: 25,
    enabled: streaming,
  });

  // Once done or not streaming, render full rich markdown
  if (done || !streaming) {
    return <RichText content={content} />;
  }

  // While streaming, render plain text + cursor
  return (
    <div className="streaming-text">
      <span>{text}</span>
      <span className="streaming-cursor" />
    </div>
  );
}
