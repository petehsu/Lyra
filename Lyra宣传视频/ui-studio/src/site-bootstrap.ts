import { installPromoDesktopApi } from "./runtime/browser-desktop-api";

const SITE_TAB_ID = "lyra-site-tab";
const workspaceState = {
  schemaVersion: 1,
  tabs: [{
    id: SITE_TAB_ID,
    title: "Lyra — Desktop Agent",
    pageKind: "page",
    inputValue: "https://lyra.ltd",
    displayAddress: "https://lyra.ltd",
    faviconUrl: "/lyra-mark.svg"
  }],
  activeTabId: SITE_TAB_ID,
  splitGroupTabIds: [],
  focusedSplitTabId: null
};

window.localStorage.setItem(
  "lyra.promo.ui-studio.state.workspace-tabs",
  JSON.stringify(workspaceState)
);

installPromoDesktopApi();

void import("./site-main");
