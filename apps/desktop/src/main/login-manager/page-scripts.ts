import type { LoginManagerCredential } from "../../shared/desktop-bridge";

const CONSOLE_BRIDGE_PREFIX = "__LYRA_LOGIN_MANAGER__:";

export type LoginCapturePayload = {
  readonly type: "credential-submit";
  readonly url: string;
  readonly title?: string;
  readonly username: string;
  readonly password: string;
};

type FillRequestPayload = {
  readonly type: "fill-request";
  readonly credentialId: string;
};

export type LoginBridgePayload = LoginCapturePayload | FillRequestPayload;

export const buildObserverScript = (
  suggestions: readonly Pick<LoginManagerCredential, "id" | "username">[]
): string => {
  const prefix = JSON.stringify(CONSOLE_BRIDGE_PREFIX);
  const suggestionJson = JSON.stringify(suggestions);
  return `
(() => {
  const prefix = ${prefix};
  const suggestions = ${suggestionJson};
  const state = window.__lyraLoginManager ?? { installed: false };
  window.__lyraLoginManager = state;

  const visible = (input) => {
    if (!(input instanceof HTMLInputElement)) return false;
    if (input.type === "hidden" || input.disabled || input.readOnly) return false;
    const style = window.getComputedStyle(input);
    const rect = input.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };

  const findLoginForm = () => {
    const password = Array.from(document.querySelectorAll("input[type='password']")).find(visible);
    if (!password) return null;
    const form = password.form ?? password.closest("form") ?? document;
    const username = Array.from(form.querySelectorAll("input")).find((input) => {
      if (!visible(input) || input === password) return false;
      const type = (input.getAttribute("type") || "text").toLowerCase();
      const autocomplete = (input.getAttribute("autocomplete") || "").toLowerCase();
      const name = ((input.name || "") + " " + (input.id || "") + " " + (input.placeholder || "")).toLowerCase();
      return autocomplete.includes("username")
        || autocomplete.includes("email")
        || type === "email"
        || type === "text"
        || name.includes("user")
        || name.includes("email")
        || name.includes("account");
    });
    return { form, username, password };
  };

  const send = (payload) => {
    try {
      console.info(prefix + JSON.stringify(payload));
    } catch (_error) {
      // no-op
    }
  };

  const capture = () => {
    const login = findLoginForm();
    if (!login || !login.password.value) return;
    const username = login.username instanceof HTMLInputElement ? login.username.value : "";
    if (!username.trim()) return;
    send({
      type: "credential-submit",
      url: window.location.href,
      title: document.title,
      username,
      password: login.password.value
    });
  };

  if (!state.installed) {
    state.installed = true;
    document.addEventListener("submit", (event) => {
      const login = findLoginForm();
      if (!login) return;
      const target = event.target;
      if (target === login.form || (target instanceof Node && login.form instanceof Element && login.form.contains(target))) {
        capture();
      }
    }, true);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        setTimeout(capture, 0);
      }
    }, true);
    document.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest("button,input[type='submit'],input[type='button']");
      if (button) {
        setTimeout(capture, 0);
      }
    }, true);
  }

  const existing = document.getElementById("lyra-login-fill-suggestion");
  if (existing) existing.remove();
  const login = findLoginForm();
  if (login && suggestions.length > 0) {
    const root = document.createElement("div");
    root.id = "lyra-login-fill-suggestion";
    root.style.cssText = [
      "position:fixed",
      "right:14px",
      "bottom:14px",
      "z-index:2147483647",
      "display:flex",
      "gap:6px",
      "align-items:center",
      "padding:8px 10px",
      "border:1px solid rgba(120,120,130,.35)",
      "border-radius:8px",
      "background:Canvas",
      "color:CanvasText",
      "font:12px system-ui,-apple-system,BlinkMacSystemFont,sans-serif",
      "box-shadow:0 10px 26px rgba(0,0,0,.18)"
    ].join(";");
    const label = document.createElement("span");
    label.textContent = suggestions[0].username;
    label.style.cssText = "max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Fill with Lyra";
    button.style.cssText = "border:0;border-radius:6px;padding:5px 8px;background:Highlight;color:HighlightText;font:inherit;cursor:pointer;";
    button.addEventListener("click", () => {
      send({ type: "fill-request", credentialId: suggestions[0].id });
    });
    root.append(label, button);
    document.documentElement.append(root);
  }
})()
`;
};

export const buildFillScript = (username: string, password: string): string => `
(() => {
  const usernameValue = ${JSON.stringify(username)};
  const passwordValue = ${JSON.stringify(password)};
  const visible = (input) => {
    if (!(input instanceof HTMLInputElement)) return false;
    if (input.type === "hidden" || input.disabled || input.readOnly) return false;
    const style = window.getComputedStyle(input);
    const rect = input.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };
  const passwordInput = Array.from(document.querySelectorAll("input[type='password']")).find(visible);
  if (!passwordInput) return { filled: false, reason: "password_field_missing" };
  const form = passwordInput.form ?? passwordInput.closest("form") ?? document;
  const usernameInput = Array.from(form.querySelectorAll("input")).find((input) => {
    if (!visible(input) || input === passwordInput) return false;
    const type = (input.getAttribute("type") || "text").toLowerCase();
    const autocomplete = (input.getAttribute("autocomplete") || "").toLowerCase();
    const name = \`\${input.name || ""} \${input.id || ""} \${input.placeholder || ""}\`.toLowerCase();
    return autocomplete.includes("username")
      || autocomplete.includes("email")
      || type === "email"
      || type === "text"
      || name.includes("user")
      || name.includes("email")
      || name.includes("account");
  });
  const setValue = (input, value) => {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor && descriptor.set) {
      descriptor.set.call(input, value);
    } else {
      input.value = value;
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  if (usernameInput instanceof HTMLInputElement) {
    setValue(usernameInput, usernameValue);
  }
  setValue(passwordInput, passwordValue);
  passwordInput.focus();
  return {
    filled: true,
    usernameField: usernameInput instanceof HTMLInputElement,
    passwordField: true
  };
})()
`;

export const parseBridgePayload = (message: string): LoginBridgePayload | null => {
  if (message.startsWith(CONSOLE_BRIDGE_PREFIX) === false) {
    return null;
  }
  try {
    const parsed = JSON.parse(message.slice(CONSOLE_BRIDGE_PREFIX.length)) as Partial<LoginBridgePayload>;
    if (
      parsed.type === "credential-submit"
      && typeof parsed.url === "string"
      && typeof parsed.username === "string"
      && typeof parsed.password === "string"
    ) {
      return parsed as LoginCapturePayload;
    }
    if (parsed.type === "fill-request" && typeof parsed.credentialId === "string") {
      return parsed as FillRequestPayload;
    }
  } catch (_error) {
    return null;
  }
  return null;
};
