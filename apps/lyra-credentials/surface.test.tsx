import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { enUS } from "./src/l10n/en-US.ts";
import { CredentialsEmbeddedChrome } from "./src/surface.tsx";

test("embedded chrome keeps the Core Logins class tree and copy", () => {
  const html = renderToStaticMarkup(createElement(CredentialsEmbeddedChrome, {
    labels: enUS,
    locale: "en-US",
    sessions: [],
    reviewSessions: [],
    credentials: [],
    query: "",
    error: null,
    busyKey: null,
    collapsedSections: new Set(),
    onQueryChange: () => undefined,
    onToggleSection: () => undefined,
    onOpenSite: () => undefined,
    onLogoutSite: () => undefined,
    onFillCredential: () => undefined,
    onCopyCredential: () => undefined,
    onDeleteCredential: () => undefined
  }));
  assert.match(html, /lyra-login-manager lyra-login-manager-embedded/u);
  assert.match(html, /lyra-login-manager-embedded-list/u);
  assert.match(html, /lyra-app-search-field lyra-login-manager-search/u);
  assert.match(html, /Search sites, accounts, methods, or notes/u);
  assert.match(html, /Sessions/u);
  assert.match(html, /Review/u);
  assert.match(html, /Passwords/u);
  assert.equal(html.includes("Reveal"), false);
  assert.equal(html.includes("Saved credentials"), false);
});
