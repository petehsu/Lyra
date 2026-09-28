import type { WebContents } from "electron";

// Presentation belongs to the person watching, never to page evidence. Use the
// same boundary for screenshots, input validation and pixel progress sampling.
const pending = new WeakMap<WebContents, Promise<unknown>>();
export const captureCleanPage = async (contents: WebContents) => {
  const previous = pending.get(contents) ?? Promise.resolve();
  const capture = previous
    .catch(() => {})
    .then(async () => {
      const key = await contents.insertCSS(
        "#__lyra_agent_page_cursor__,[data-lyra-agent-overlay]{visibility:hidden!important}",
        { cssOrigin: "user" },
      );
      try {
        await contents.executeJavaScript(
          "new Promise(resolve=>{const t=setTimeout(resolve,100);requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(t);resolve()}))})",
          false,
        );
        return await contents.capturePage();
      } finally {
        if (!contents.isDestroyed())
          await contents.removeInsertedCSS(key).catch(() => {});
      }
    });
  pending.set(contents, capture);
  try {
    return await capture;
  } finally {
    if (pending.get(contents) === capture) pending.delete(contents);
  }
};
