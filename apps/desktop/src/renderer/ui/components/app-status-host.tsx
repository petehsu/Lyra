import {
  useCallback,
  useEffect,
  useState,
  type ReactNode
} from "react";

import { t } from "@workbench/i18n";

import { AppToast, AppToastProvider, AppToastViewport, type AppToastTone } from "./app-toast";

type AppStatusNotice = {
  readonly description?: string;
  readonly id: string;
  readonly title: string;
  readonly tone: AppToastTone;
};

type AppStatusListener = (notice: AppStatusNotice) => void;

const listeners = new Set<AppStatusListener>();
const pending: AppStatusNotice[] = [];

const nextId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `notice-${Date.now()}-${Math.floor(Math.random() * 100_000)}`;

const errorMessage = (error: unknown): string | undefined => {
  if (error === null || error === undefined) {
    return undefined;
  }
  const message = error instanceof Error ? error.message : String(error);
  return message.trim().length === 0 ? undefined : message;
};

export const reportWorkbenchStatus = (
  notice: Omit<AppStatusNotice, "id">
): void => {
  const next = { ...notice, id: nextId() };
  if (listeners.size === 0) {
    pending.push(next);
    return;
  }
  queueMicrotask(() => {
    listeners.forEach((listener) => listener(next));
  });
};

export const reportWorkbenchError = (
  error: unknown,
  title = t("appStatus.operationFailed")
): void => {
  console.warn(`[lyra] ${title}`, error);
  const description = errorMessage(error);
  reportWorkbenchStatus({
    title,
    tone: "error",
    ...(description === undefined ? {} : { description })
  });
};

const subscribe = (listener: AppStatusListener): (() => void) => {
  listeners.add(listener);
  while (pending.length > 0) {
    const notice = pending.shift();
    if (notice !== undefined) {
      listener(notice);
    }
  }
  return () => {
    listeners.delete(listener);
  };
};

export function AppStatusProvider({ children }: { readonly children: ReactNode }) {
  const [notices, setNotices] = useState<readonly AppStatusNotice[]>([]);
  const dismiss = useCallback((id: string) => {
    setNotices((current) => current.filter((notice) => notice.id !== id));
  }, []);

  useEffect(() => subscribe((notice) => {
    setNotices((current) => [...current.slice(-3), notice]);
  }), []);

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      // ponytail: React commit 抛 NotFoundError DOMException（removeChild/insertBefore
      // "not a child"）归 AppErrorBoundary 管。此处转 toast → setNotices →
      // AppStatusProvider 重渲染 → 再次进入损坏子树抛同错 → 无限刷屏。跳过断循环。
      // 代价：漏报罕见非 render 期 NotFoundError。诊断由 boundary componentDidCatch 兜底。
      if (event.error instanceof DOMException && event.error.name === "NotFoundError") {
        return;
      }
      reportWorkbenchError(event.error ?? event.message, t("appStatus.unexpectedErrorTitle"));
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      reportWorkbenchError(event.reason);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  return (
    <AppToastProvider duration={5_000}>
      {children}
      {notices.map((notice) => (
        <AppToast
          key={notice.id}
          open
          tone={notice.tone}
          title={notice.title}
          description={notice.description}
          onOpenChange={(open) => {
            if (!open) {
              dismiss(notice.id);
            }
          }}
        />
      ))}
      <AppToastViewport />
    </AppToastProvider>
  );
}
