import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createFirstPartyAppModule,
  type FirstPartySurfaceProps
} from "@lyra/first-party-app-kit";

import { resolveMessages } from "./l10n/resolve";
import { parseCredentialsSnapshot } from "./parse";
import { CredentialsEmbeddedChrome } from "./surface";
import type { CredentialsSnapshot, CredentialSession, StoredCredential } from "./types";

const COMMANDS = {
  read: "lyra.core.credentials.read",
  deleteCredential: "lyra.core.credentials.delete",
  copyCredential: "lyra.core.credentials.copy",
  fillCredential: "lyra.core.credentials.fill",
  clearSite: "lyra.core.credentials.clear-site",
  navigate: "lyra.core.navigate"
} as const;
const CREDENTIALS_CHANGED_EVENT = "lyra.core.credentials-changed";

export { parseCredentialsSnapshot } from "./parse";
export type { CredentialsSnapshot } from "./types";

const normalize = (value: string): string => value.trim().toLocaleLowerCase();

const sessionSearchText = (session: CredentialSession): string =>
  normalize([
    session.hostname,
    session.origin,
    session.title,
    session.address,
    session.accountHint,
    session.authMethod.label,
    session.authMethod.providerDomain,
    session.notes
  ].filter(Boolean).join(" "));

const credentialSearchText = (credential: StoredCredential): string =>
  normalize([
    credential.hostname,
    credential.origin,
    credential.username,
    credential.usernameLabel,
    credential.authMethod.label,
    credential.authMethod.providerDomain
  ].filter(Boolean).join(" "));

const CredentialsSurface = ({
  host,
  presentation
}: FirstPartySurfaceProps) => {
  const labels = useMemo(
    () => resolveMessages(presentation.locale),
    [presentation.locale]
  );
  const [snapshot, setSnapshot] = useState<CredentialsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<ReadonlySet<string>>(() => new Set());

  const refresh = useCallback(async () => {
    try {
      setSnapshot(parseCredentialsSnapshot(await host.executeCommand(COMMANDS.read, {})));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [host]);

  useEffect(() => {
    void refresh();
    try {
      const subscription = host.subscribeEvent(CREDENTIALS_CHANGED_EVENT, async () => refresh());
      return () => subscription.dispose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return undefined;
    }
  }, [host, refresh]);

  const sessions = snapshot?.sessions ?? [];
  const credentials = snapshot?.credentials ?? [];
  const filteredSessions = useMemo(() => {
    const text = normalize(query);
    if (text.length === 0) return sessions;
    return sessions.filter((session) => sessionSearchText(session).includes(text));
  }, [query, sessions]);
  const filteredReviewSessions = useMemo(() => {
    const reviewSessions = sessions.filter((session) => session.authMethodSource !== "manual");
    const text = normalize(query);
    if (text.length === 0) return reviewSessions;
    return reviewSessions.filter((session) => sessionSearchText(session).includes(text));
  }, [query, sessions]);
  const filteredCredentials = useMemo(() => {
    const text = normalize(query);
    if (text.length === 0) return credentials;
    return credentials.filter((credential) => credentialSearchText(credential).includes(text));
  }, [credentials, query]);

  const toggleSection = useCallback((key: string) => {
    setCollapsedSections((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const run = useCallback(async (key: string, work: () => Promise<unknown>) => {
    setBusyKey(key);
    try {
      await work();
      await refresh();
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyKey(null);
    }
  }, [refresh]);

  return (
    <CredentialsEmbeddedChrome
      labels={labels}
      locale={presentation.locale}
      sessions={filteredSessions}
      reviewSessions={filteredReviewSessions}
      credentials={filteredCredentials}
      query={query}
      error={error}
      busyKey={busyKey}
      collapsedSections={collapsedSections}
      onQueryChange={setQuery}
      onToggleSection={toggleSection}
      onOpenSite={(url, title) => {
        void host.executeCommand(COMMANDS.navigate, {
          address: url,
          ...(title === undefined ? {} : { title })
        });
      }}
      onLogoutSite={(session) => {
        void run(`session:${session.id}`, () => host.executeCommand(COMMANDS.clearSite, {
          sessionId: session.id
        }));
      }}
      onFillCredential={(credential) => {
        void run(`credential:${credential.id}`, () => host.executeCommand(COMMANDS.fillCredential, {
          credentialId: credential.id,
          reason: "user-fill"
        }));
      }}
      onCopyCredential={(credential) => {
        void host.executeCommand(COMMANDS.copyCredential, {
          credentialId: credential.id,
          reason: "user-copy"
        }).catch((cause: unknown) => {
          setError(cause instanceof Error ? cause.message : String(cause));
        });
      }}
      onDeleteCredential={(credential) => {
        void run(`credential:${credential.id}`, () => host.executeCommand(COMMANDS.deleteCredential, {
          credentialId: credential.id
        }));
      }}
    />
  );
};

export const lyraAppModule = createFirstPartyAppModule({
  componentId: "lyra.credentials",
  version: __LYRA_APP_VERSION__,
  contributions: {
    commands: [
      { id: "lyra.credentials.refresh", title: "Refresh logins" }
    ],
    settings: [
      { id: "lyra.credentials.settings", title: "Logins", route: "/credentials" }
    ],
    status: [
      { id: "lyra.credentials.status", title: "Logins" }
    ]
  },
  commandHandlers: {
    "lyra.credentials.refresh": (host) => host.executeCommand(COMMANDS.read, {})
  },
  surfaces: {
    "login-manager": {
      title: "Logins",
      description: "Review locally encrypted captured sign-in data.",
      component: CredentialsSurface
    }
  }
});
export default lyraAppModule;
