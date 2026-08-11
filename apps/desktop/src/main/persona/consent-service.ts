import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Persona consent gate + computed persona cache.
 *
 * Storage layout:
 *   ~/.lyra/data/persona/
 *     ├── consent.v1.json          — schema v1 consent record
 *     └── computed-persona.v1.json — cached ComputedPersona
 *
 * IPC channels (registered in agent-ipc-router.ts):
 *   lyra:persona/consent/read   → PersonaConsent
 *   lyra:persona/consent/write  → PersonaConsent
 *   lyra:persona/refresh        → triggers rescan (returns void, scan is async)
 *   lyra:persona/status         → PersonaStatus
 */

export type PersonaConsent = {
  osintEnabled: boolean;
  grantedAt: string | null;
};

export type PersonaStatus = {
  consent: PersonaConsent;
  hasCachedPersona: boolean;
  cachedAt: string | null;
};

const PERSONA_SCHEMA_VERSION = 1 as const;
const PERSONA_DIR = join(homedir(), ".lyra", "data", "persona");
const CONSENT_PATH = join(PERSONA_DIR, "consent.v1.json");
const CACHED_PERSONA_PATH = join(PERSONA_DIR, "computed-persona.v1.json");

type PersistedPersonaConsentV1 = PersonaConsent & {
  readonly schemaVersion: typeof PERSONA_SCHEMA_VERSION;
};

function ensureDir(): void {
  if (!existsSync(PERSONA_DIR)) {
    mkdirSync(PERSONA_DIR, { recursive: true });
  }
}

export function readConsent(): PersonaConsent {
  if (!existsSync(CONSENT_PATH)) {
    return { osintEnabled: true, grantedAt: null };
  }
  try {
    const raw = readFileSync(CONSENT_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<PersistedPersonaConsentV1>;
    if (parsed.schemaVersion !== PERSONA_SCHEMA_VERSION) {
      return { osintEnabled: true, grantedAt: null };
    }
    return {
      osintEnabled: parsed.osintEnabled ?? false,
      grantedAt: parsed.grantedAt ?? null,
    };
  } catch {
    return { osintEnabled: true, grantedAt: null };
  }
}

export function writeConsent(consent: PersonaConsent): PersonaConsent {
  ensureDir();
  const next: PersonaConsent = {
    osintEnabled: consent.osintEnabled,
    grantedAt: consent.osintEnabled
      ? consent.grantedAt ?? new Date().toISOString()
      : null,
  };
  writeAtomically(
    CONSENT_PATH,
    JSON.stringify({ schemaVersion: PERSONA_SCHEMA_VERSION, ...next }, null, 2)
  );
  return next;
}

export function readCachedPersona(): string | null {
  if (!existsSync(CACHED_PERSONA_PATH)) return null;
  try {
    return readFileSync(CACHED_PERSONA_PATH, "utf-8");
  } catch {
    return null;
  }
}

export function writeCachedPersona(json: string): void {
  ensureDir();
  writeAtomically(CACHED_PERSONA_PATH, json);
}

function writeAtomically(destination: string, contents: string): void {
  const temporary = `${destination}.${process.pid}.tmp`;
  writeFileSync(temporary, contents, { encoding: "utf-8", mode: 0o600 });
  renameSync(temporary, destination);
}

export function readStatus(): PersonaStatus {
  const consent = readConsent();
  const cached = readCachedPersona();
  return {
    consent,
    hasCachedPersona: cached !== null,
    cachedAt: cached ? new Date().toISOString() : null,
  };
}
