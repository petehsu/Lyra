import assert from 'node:assert/strict';
import { resolve } from 'node:path';

export async function checkRichText({ page, scenario, output, results }) {
  await scenario(1, 'rich');
  await page.waitForFunction(() => document.querySelector('code span[style]'));
  const themes = {};
  for (const tone of ['light', 'dark']) {
    await page.evaluate(tone => window.audit.theme(tone), tone);
    themes[tone] = await page.evaluate(() => {
      const code = document.querySelector('.lyra-markdown-code-block');
      const table = document.querySelector('table');
      const wrap = table.parentElement;
      const token = code.querySelector('code span[style]');
      const keyword = [...code.querySelectorAll('code span[style]')].find(span => span.textContent === 'interface');
      const borderLayers = [];
      for (let node = table; node && node !== table.closest('.lyra-markdown-table-block').parentElement; node = node.parentElement) {
        if (parseFloat(getComputedStyle(node).borderTopWidth) > 0) borderLayers.push(node.className);
      }
      return {
        codeBackground: getComputedStyle(code).backgroundColor,
        tokenColor: getComputedStyle(keyword ?? token).color,
        headerBackground: getComputedStyle(table.querySelector('th')).backgroundColor,
        tableText: getComputedStyle(table.querySelector('td')).color,
        borderColor: getComputedStyle(wrap).borderColor,
        borderLayers, alignment: getComputedStyle(table.querySelector('th:last-child')).textAlign,
      };
    });
    assert.equal(themes[tone].borderLayers.length, 1, 'table must have only one enclosing border');
    assert.equal(themes[tone].alignment, 'right');
    await page.locator('.audit-chat').screenshot({ path: resolve(output, `markdown-${tone}.png`) });
  }
  assert.equal(themes.light.codeBackground, 'rgb(245, 245, 245)');
  assert.equal(themes.dark.codeBackground, 'rgb(34, 34, 34)');
  for (const property of ['tokenColor', 'headerBackground', 'tableText', 'borderColor']) {
    assert.notEqual(themes.light[property], themes.dark[property], `${property} must follow the theme`);
  }
  results.richTextThemes = themes;
  results.assertions.push('code, table and controls follow light/dark theme; table has a single frame');
  await page.evaluate(() => window.audit.theme('light'));

  await page.locator('.lyra-markdown-code-actions button').nth(2).click();
  await page.waitForFunction(() => document.querySelector('[contenteditable] [data-citation-id]'));
  const codeCitation = await page.evaluate(() => window.audit.citation());
  assert.equal(codeCitation.messageId, 'message-0');
  assert.equal(codeCitation.blockId, 'block-0');
  assert.equal(codeCitation.quotedText, (await page.evaluate(() => window.audit.source())).split('```typescript\n')[1].split('```')[0].trim());
  await page.locator('[contenteditable] [data-citation-id]').first().click();
  await page.waitForFunction(() => window.audit.citationTarget()?.messageId === 'message-0');
  assert.equal((await page.evaluate(() => window.audit.citationTarget())).blockId, 'block-0');
  assert.equal(await page.locator('[contenteditable] [data-citation-id]').count(), 1, 'returning to the source must not reinsert the citation');

  await page.locator('.lyra-markdown-table-actions button').click();
  await page.waitForFunction(() => document.querySelectorAll('[contenteditable] [data-citation-id]').length === 2);
  const tableCitation = await page.evaluate(() => window.audit.citation());
  assert.ok(tableCitation.quotedText.includes('| 前端 | ✅ | Alice | 92% |'));
  assert.ok(tableCitation.quotedText.includes('| 后端 | 🔧 | Bob | 78% |'));
  assert.ok(!tableCitation.quotedText.includes('interface User'));
  results.assertions.push('code/table quote enters the existing composer and its chip returns to the source message');

  // Many columns force horizontal overflow; a long word alone may wrap normally.
  await scenario(1, 'code', true);
  await page.evaluate(() => {
    const row = cells => `| ${cells.join(' | ')} |`;
    window.audit.replace([
      row(Array.from({ length: 20 }, (_, i) => `Column ${i + 1}`)),
      row(Array(20).fill('---')),
      row(Array(20).fill('Value')),
    ].join('\n'));
  });
  await page.waitForFunction(() => document.querySelectorAll('th').length === 20);
  await page.evaluate(() => window.audit.finish());
  const overflow = await page.evaluate(() => {
    const wrap = document.querySelector('.lyra-agents-md-table-wrap');
    const chat = document.querySelector('.lyra-agents-chat-scroll');
    const before = wrap.scrollLeft;
    wrap.scrollLeft = 200;
    return { scrolls: wrap.scrollLeft > before, pageOverflow: chat.scrollWidth - chat.clientWidth };
  });
  assert.ok(overflow.scrolls, 'wide table must scroll inside its own frame');
  assert.ok(overflow.pageOverflow < 2, 'wide table must not widen the chat viewport');
  results.assertions.push('wide tables scroll inside their frame without expanding the chat');
}
