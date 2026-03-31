import type { WorkbenchTab } from "../shell/types";

export const resolveTabSubtitle = (tab: WorkbenchTab): string => {
  if (tab.subtitle !== undefined && tab.subtitle.length > 0) {
    return tab.subtitle;
  }

  if (tab.type === "editor") return "Code Buffer";
  if (tab.type === "browser") return "Browser Context";
  return "Plugin Runtime";
};

export const editorDemoText = `async function submitOrder(payload: OrderPayload) {
  const response = await api.post('/checkout', payload)

  if (response.ok === false) {
    throw new Error('checkout failed')
  }

  return response.data
}

// TODO:
// 1. map backend error codes to user-facing messages
// 2. retry on 502/503
// 3. attach correlation_id for tracing`;
