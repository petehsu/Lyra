/** Editing is owned by the host, not every formatting/paragraph descendant. */
export const browserEditingHostRuntime = String.raw`(node => {
  if (!node || !(node.isContentEditable || node.matches?.('[contenteditable="true"],[contenteditable=""],[contenteditable="plaintext-only"]'))) return null;
  while (node.parentElement?.isContentEditable) node = node.parentElement;
  return node;
})`;

/** Logical editor text: paragraph boundaries count, CSS paragraph margins do
 * not. A final BR is the caret placeholder Chromium adds to an empty line.
 * This also accepts Range.cloneContents() to measure selection boundaries. */
export const browserEditableTextRuntime = String.raw`(root => {
  const block = node => node.nodeType === 1 && /^(DIV|P|LI|UL|OL|PRE|BLOCKQUOTE|H[1-6])$/.test(node.tagName);
  const placeholderBreak = node => {
    if (node.nodeName !== 'BR') return false;
    // Formatting wrappers can surround Chromium's empty-line caret BR. Only
    // omit it at the end of a whole block, never before following inline text
    // or at the end of a fragment representing a selection prefix.
    while (node.parentNode) {
      if (node.nextSibling) return false;
      node = node.parentNode;
      if (block(node) || node === root) return node.nodeType === 1;
    }
    return false;
  };
  const read = node => {
    if (node.nodeType === 3) return node.data;
    if (node.nodeType !== 1 && node.nodeType !== 11) return '';
    if (node.tagName === 'BR') return '\n';
    if (/^(SCRIPT|STYLE)$/.test(node.tagName || '')) return '';
    let text = '', previousBlock = false, hasPrevious = false;
    const children = Array.from(node.childNodes);
    for (let i = 0; i < children.length; i++) {
      const child = children[i], isBlock = block(child);
      if (child.nodeType === 8) continue;
      if (hasPrevious && (isBlock || previousBlock)
        && (previousBlock || !text.endsWith('\n'))) text += '\n';
      text += placeholderBreak(child) ? '' : read(child);
      previousBlock = isBlock; hasPrevious = true;
    }
    return text;
  };
  return read(root).replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ');
})`;
