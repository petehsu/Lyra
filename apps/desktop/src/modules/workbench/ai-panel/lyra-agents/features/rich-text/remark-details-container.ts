/**
 * Remark plugin: parse `:::details` container directives.
 *
 * streamdown has no built-in container directive support. This plugin
 * scans the mdast for the `:::details Summary` / `:::` fence pattern and
 * converts the block into two raw-HTML mdast nodes (opening + closing tags)
 * with the inner content left as normal mdast children so inner markdown
 * (bold, code, links, lists) is still parsed by streamdown's pipeline.
 *
 * Syntax (matches the previous markdown-it-container behavior):
 *   :::details Summary text
 *   **inner** markdown content
 *   :::
 *
 * If no summary text follows `details`, defaults to "Details".
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- mdast types are not a direct dep; the node shapes are stable per micromark spec. */

const FENCE_OPEN = /^:::details\b[ \t]*(.*)$/;
const FENCE_CLOSE = /^:::[ \t]*$/;

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/**
 * Extract the joined text value of an mdast paragraph node.
 */
const paragraphText = (node: any): string =>
  (node.children ?? [])
    .map((child: any) => (child.type === "text" ? child.value : ""))
    .join("");

/**
 * Split a paragraph into individual lines by splitting on "\n" in text nodes.
 * remark-parse stores hard breaks as separate `break` nodes, but for our
 * fence detection we only need the text content split by newlines.
 */
const paragraphLines = (node: any): string[] => paragraphText(node).split("\n");

/**
 * Build an mdast raw-HTML node.
 */
const htmlNode = (value: string): any => ({ type: "html", value });

export function remarkDetailsContainer(): (tree: any) => void {
  return (tree: any): void => {
    if (!Array.isArray(tree.children)) return;

    const result: any[] = [];
    let i = 0;

    while (i < tree.children.length) {
      const node = tree.children[i];

      if (node.type !== "paragraph") {
        result.push(node);
        i++;
        continue;
      }

      const lines = paragraphLines(node);
      const openMatch = FENCE_OPEN.exec((lines[0] ?? "").trim());

      if (openMatch === null) {
        result.push(node);
        i++;
        continue;
      }

      // --- Found an opening fence. Collect inner content until closing fence. ---

      const summaryRaw = (openMatch[1] ?? "").trim();
      const summary = summaryRaw.length > 0 ? summaryRaw : "Details";
      const innerNodes: any[] = [];

      // Lines after the fence-open line in the SAME paragraph are inner content.
      const remainingLines = lines.slice(1);
      const closeInSamePara = consumeLines(remainingLines, innerNodes);

      if (closeInSamePara !== null) {
        // Close fence found within the opening paragraph.
        result.push(htmlNode(`<details class="lyra-markdown-details"><summary>${escapeHtml(summary)}</summary>\n`));
        result.push(...innerNodes);
        result.push(htmlNode(`\n</details>`));
        i++;
        continue;
      }

      // No close in same paragraph — scan subsequent sibling nodes.
      let k = i + 1;
      let closed = false;
      for (; k < tree.children.length; k++) {
        const sibling = tree.children[k];
        if (sibling.type === "paragraph") {
          const sibLines = paragraphLines(sibling);
          const closeIdx = consumeLinesReturnCloseIdx(sibLines, innerNodes);
          if (closeIdx !== null) {
            // Close fence found. If there are remaining lines after it,
            // emit them as a new paragraph.
            const after = sibLines.slice(closeIdx + 1).join("\n").trim();
            result.push(htmlNode(`<details class="lyra-markdown-details"><summary>${escapeHtml(summary)}</summary>\n`));
            result.push(...innerNodes);
            result.push(htmlNode(`\n</details>`));
            if (after.length > 0) {
              result.push({ type: "paragraph", children: [{ type: "text", value: after }] });
            }
            i = k + 1;
            closed = true;
            break;
          }
          // No close in this paragraph — add it as inner content (re-wrap as paragraph).
          innerNodes.push(sibling);
        } else {
          // Non-paragraph node (code, list, heading, etc.) inside details.
          innerNodes.push(sibling);
        }
      }

      if (!closed) {
        // No closing fence found — emit the original paragraph unchanged.
        result.push(node);
        i++;
      }
    }

    tree.children = result;
  };
}

/**
 * Consume lines into innerNodes. Returns true if a close fence was found
 * (remaining lines are content before the fence). Returns null if no close
 * fence was found (all lines are content).
 *
 * Lines before the close fence are joined into a text node (if non-empty).
 */
function consumeLines(lines: string[], innerNodes: any[]): boolean {
  const content: string[] = [];
  for (const line of lines) {
    const trimmed = (line ?? "").trim();
    if (FENCE_CLOSE.exec(trimmed) !== null) {
      // Close fence found — emit accumulated content as a paragraph.
      const text = content.join("\n").trim();
      if (text.length > 0) {
        innerNodes.push({ type: "paragraph", children: [{ type: "text", value: text }] });
      }
      return true;
    }
    content.push(line ?? "");
  }
  // No close fence — all lines are content.
  const text = content.join("\n").trim();
  if (text.length > 0) {
    innerNodes.push({ type: "paragraph", children: [{ type: "text", value: text }] });
  }
  return false;
}

/**
 * Same as consumeLines but returns the index of the close fence line,
 * or null if not found. Lines before the close are emitted as content.
 */
function consumeLinesReturnCloseIdx(lines: string[], innerNodes: any[]): number | null {
  const content: string[] = [];
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx] ?? "";
    if (FENCE_CLOSE.exec(line.trim()) !== null) {
      const text = content.join("\n").trim();
      if (text.length > 0) {
        innerNodes.push({ type: "paragraph", children: [{ type: "text", value: text }] });
      }
      return idx;
    }
    content.push(line);
  }
  // No close fence — all lines are content.
  const text = content.join("\n").trim();
  if (text.length > 0) {
    innerNodes.push({ type: "paragraph", children: [{ type: "text", value: text }] });
  }
  return null;
}