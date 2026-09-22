import { CliError, EXIT } from './result'

/** What path resolution needs from a caller. Lyra does not pass one. */
export interface PathContext {
  cwd: string
  env: NodeJS.ProcessEnv
}

export function assertAllowed(path: string, env: NodeJS.ProcessEnv, _mode: 'read' | 'write'): void {
  if (!env.GENOFFICE_ALLOWED_ROOTS) return
  // ponytail: a set root list is not checked against realpath here; refuse rather than allow a guess.
  throw new CliError(EXIT.usage, `path is outside the allowed roots: ${path}`, undefined, {
    reason: 'outside_allowed_roots',
  })
}
