import { createHash } from "node:crypto";
import type { LyraSensitiveValueRef, LyraSensitiveValueStoreRequest, LyraSensitiveValueStoreResponse } from "../../shared/sensitive-value";

// Shared detection has no site/hostname rules. Context identifies unprefixed
// generated credentials; well-known credential formats also work in page text.
export const CREDENTIAL_PATTERN = String.raw`\b(?:glpat-|github_pat_|gh[pousr]_|sk-(?:proj-|ant-)?|xox[baprs]-)[A-Za-z0-9_-]{16,}|\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}|-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]+?-----END (?:[A-Z]+ )?PRIVATE KEY-----`;

export const sensitiveFieldRuntime = `element => {
  if (!['INPUT','TEXTAREA'].includes(element.tagName)) return undefined;
  const value = element.value || '';
  if (!value || /^[*•]+$/.test(value)) return undefined;
  const identity = [element.type, element.name, element.id, element.getAttribute('aria-label'),
    ...Array.from(element.labels || [], label => label.textContent)].filter(Boolean).join(' ');
  const credential = new RegExp(${JSON.stringify(CREDENTIAL_PATTERN)}).test(value)
    || /password|api.?key|access.?token|auth.?token|client.?secret|private.?key|密码|密钥|令牌/i.test(identity)
      && !/token.?name|key.?name|secret.?name|search|名称|搜索/i.test(identity);
  return credential ? { value, label: 'Browser credential', valueKind: element.type === 'password' ? 'password' : 'token' } : undefined;
}`;

type Store = (request: LyraSensitiveValueStoreRequest) => Promise<LyraSensitiveValueStoreResponse>;
export const createBrowserSensitiveBoundary = (store?: Store) => {
  const saved = new Map<string, Promise<LyraSensitiveValueRef | undefined>>();
  const refs = new Map<string, LyraSensitiveValueRef>();
  const known = new Map<string, string>();
  const remember = (ref: LyraSensitiveValueRef, value: string) => {
    refs.set(ref.id, ref); known.set(value, `[sensitive:${ref.id}]`);
    if (known.size > 256) known.delete(known.keys().next().value!);
    if (refs.size > 256) refs.delete(refs.keys().next().value!);
  };
  const capture = async (value: string, valueKind: "password" | "token" = "token") => {
    const digest = createHash('sha256').update(value).digest('hex');
    let pending = saved.get(digest);
    if (!pending) {
      pending = store?.({ value, owner: "external", valueKind, label: "Browser credential",
        capabilities: ["list_metadata", "use", "fill"] }).then(result => result.ref).catch(() => undefined)
        ?? Promise.resolve(undefined);
      saved.set(digest, pending);
      if (saved.size > 256) saved.delete(saved.keys().next().value!);
    }
    const ref = await pending;
    const marker = ref ? `[sensitive:${ref.id}]` : "[sensitive value withheld; secure storage unavailable]";
    if (ref) refs.set(ref.id, ref);
    known.set(value, marker);
    if (known.size > 256) known.delete(known.keys().next().value!);
    if (refs.size > 256) refs.delete(refs.keys().next().value!);
    return marker;
  };
  const sanitize = async <T>(input: T): Promise<T> => {
    // Capture full field values before redacting the already bounded snippets.
    const replacements = new Map<string, string>();
    const collect = async (value: unknown): Promise<void> => {
      if (!value || typeof value !== "object") return;
      const record = value as Record<string, unknown>;
      const field = record.sensitiveValue as { value?: unknown; valueKind?: unknown } | undefined;
      if (typeof field?.value === "string") {
        const marker = await capture(field.value, field.valueKind === "password" ? "password" : "token");
        replacements.set(field.value, marker);
        if (typeof record.textSnippet === "string" && record.textSnippet.length > 0) replacements.set(record.textSnippet, marker);
      }
      for (const [key, entry] of Object.entries(record)) if (key !== "sensitiveValue") await collect(entry);
    };
    await collect(input);
    const ordered = [...known, ...replacements].sort(([left], [right]) => right.length - left.length);
    const walk = async (value: unknown): Promise<unknown> => {
      if (typeof value === "string") {
        for (const [secret, marker] of ordered) {
          // A one-character password must not rewrite every label and URL.
          value = secret.length < 8 ? value === secret ? marker : value : (value as string).split(secret).join(marker);
        }
        let text = value as string;
        for (const match of text.matchAll(new RegExp(CREDENTIAL_PATTERN, 'g'))) {
          // Never save a truncated token as if it were a usable credential.
          const suffix = text.slice(match.index! + match[0].length);
          const marker = suffix.startsWith('…') || suffix.startsWith('...')
            ? '[sensitive value withheld; truncated source]' : await capture(match[0]);
          text = text.split(match[0]).join(marker);
        }
        return text;
      }
      if (Array.isArray(value)) return Promise.all(value.map(walk));
      if (!value || typeof value !== "object") return value;
      const result: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value)) if (key !== "sensitiveValue") result[key] = await walk(entry);
      return result;
    };
    return await walk(input) as T;
  };
  const references = (value: unknown): LyraSensitiveValueRef[] => {
    const text = JSON.stringify(value);
    return [...refs.values()].filter(ref => text.includes(`[sensitive:${ref.id}]`));
  };
  return { sanitize, references, remember };
};

// Installed by the desktop's credential bridge. Without it, fail closed.
export let browserSensitiveBoundary = createBrowserSensitiveBoundary();
export const configureBrowserSensitiveBoundary = (store: Store): void => {
  browserSensitiveBoundary = createBrowserSensitiveBoundary(store);
};
