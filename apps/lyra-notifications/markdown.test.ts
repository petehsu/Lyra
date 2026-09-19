import assert from "node:assert/strict";
import test from "node:test";

import { parseInline, tokenizeMarkdown } from "./src/markdown.tsx";

test("renders the official seed marks without treating javascript as a link", () => {
  const blocks = tokenizeMarkdown(`You can receive **official notices** while using Lyra.

- Markdown lists and emphasis
- Links open in the [workspace](https://lyra.ltd)
- Images use \`https://\` URLs

See [nope](javascript:alert(1)).`);

  assert.equal(blocks[0]?.type, "p");
  assert.equal(blocks[1]?.type, "ul");
  assert.equal(blocks[2]?.type, "p");
  if (blocks[0]?.type !== "p" || blocks[1]?.type !== "ul" || blocks[2]?.type !== "p") {
    throw new Error("unexpected block shape");
  }
  assert.equal(blocks[0].children[1]?.type, "strong");
  assert.equal(blocks[1].items.length, 3);
  const link = blocks[1].items[1]?.find((node) => node.type === "link");
  assert.equal(link?.type, "link");
  if (link?.type === "link") {
    assert.equal(link.href, "https://lyra.ltd");
  }
  const unsafe = blocks[2].children.find((node) => node.type === "link");
  assert.equal(unsafe?.type, "link");
  if (unsafe?.type === "link") {
    assert.equal(unsafe.href, "javascript:alert(1)");
  }
});

test("keeps fenced code intact", () => {
  const [block] = tokenizeMarkdown("```\nconst a = 1;\n```");
  assert.equal(block?.type, "pre");
  if (block?.type === "pre") {
    assert.equal(block.value, "const a = 1;");
  }
  assert.deepEqual(parseInline("`https://`"), [{ type: "code", value: "https://" }]);
});
