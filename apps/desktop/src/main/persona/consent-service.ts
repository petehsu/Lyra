import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Persona consent gate + computed persona cache.
 *
 * Storage layout:
 *   ~/.lyra/modules/persona/
 *     ├── consent.json          — { osintEnabled, grantedAt }
 *     └── computed_persona.json — cached ComputedPersona (avoid re-scan every turn)
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

const PERSONA_DIR = join(homedir(), ".lyra", "modules", "persona");
const CONSENT_PATH = join(PERSONA_DIR, "consent.json");
const CACHED_PERSONA_PATH = join(PERSONA_DIR, "computed_persona.json");

function ensureDir(): void {
  if (!existsSync(PERSONA_DIR)) {
    mkdirSync(PERSONA_DIR, { recursive: true });
  }
}

export function readConsent(): PersonaConsent {
  if (!existsSync(CONSENT_PATH)) {
    return { osintEnabled: false, grantedAt: null };
  }
  try {
    const raw = readFileSync(CONSENT_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<PersonaConsent>;
    return {
      osintEnabled: parsed.osintEnabled ?? false,
      grantedAt: parsed.grantedAt ?? null,
    };
  } catch {
    return { osintEnabled: false, grantedAt: null };
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
  writeFileSync(CONSENT_PATH, JSON.stringify(next, null, 2), "utf-8");
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
  writeFileSync(CACHED_PERSONA_PATH, json, "utf-8");
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