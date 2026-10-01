/**
 * Chromium and supervised host processes, grouped the way ZCode records them.
 * Guest web pages stay out of the main window total. The dev server is visible
 * but not part of the product total.
 */

export const PROCESS_ROLES = [
  "main",
  "renderer_main",
  "renderer_guest",
  "gpu",
  "host",
  "scheduler",
  "exec",
  "terminal",
  "files",
  "dev",
  "other"
] as const;

export type ProcessRole = (typeof PROCESS_ROLES)[number];

export type ProcessSample = {
  readonly pid: number;
  readonly type: string;
  readonly serviceName?: string;
  readonly cpuPercent: number;
  readonly rssKb: number;
};

export type ProcessRolePids = {
  readonly mainPid: number;
  readonly mainWindowRendererPids: ReadonlySet<number>;
  readonly guestRendererPids: ReadonlySet<number>;
  readonly registered: ReadonlyMap<number, ProcessRole>;
};

export type ProcessRoleAggregate = {
  readonly role: ProcessRole;
  readonly cpuPercent: number;
  readonly rssKbTotal: number;
  readonly processCount: number;
};

const PRODUCT_ROLES = new Set<ProcessRole>([
  "main",
  "renderer_main",
  "renderer_guest",
  "gpu",
  "host",
  "scheduler",
  "exec",
  "terminal",
  "files"
]);

export const classifyProcessRole = (
  sample: Pick<ProcessSample, "pid" | "type" | "serviceName">,
  pids: ProcessRolePids
): ProcessRole => {
  const registered = pids.registered.get(sample.pid);
  if (registered !== undefined) {
    return registered;
  }
  if (sample.pid === pids.mainPid) {
    return "main";
  }
  const type = sample.type.toLowerCase();
  const service = (sample.serviceName ?? "").toLowerCase();
  if (service.includes("electron-vite") || service.includes("esbuild")) {
    return "dev";
  }
  if (service.includes("scheduler")) return "scheduler";
  if (service.includes("terminal")) return "terminal";
  if (service.includes("files")) return "files";
  if (service.includes("exec")) return "exec";
  if (service.includes("agent") || service.includes("lyra-host") || service.includes("shared-process")) {
    return "host";
  }
  if (type === "gpu") return "gpu";
  if (pids.mainWindowRendererPids.has(sample.pid)) return "renderer_main";
  if (pids.guestRendererPids.has(sample.pid)) return "renderer_guest";
  if (type === "tab" || type === "renderer") return "renderer_guest";
  return "other";
};

export const aggregateProcessRoles = (
  processes: readonly ProcessSample[],
  pids: ProcessRolePids
): ProcessRoleAggregate[] => {
  const totals = new Map<ProcessRole, ProcessRoleAggregate>();
  for (const sample of processes) {
    const role = classifyProcessRole(sample, pids);
    const existing = totals.get(role);
    if (existing === undefined) {
      totals.set(role, {
        role,
        cpuPercent: sample.cpuPercent,
        rssKbTotal: sample.rssKb,
        processCount: 1
      });
      continue;
    }
    totals.set(role, {
      role,
      cpuPercent: existing.cpuPercent + sample.cpuPercent,
      rssKbTotal: existing.rssKbTotal + sample.rssKb,
      processCount: existing.processCount + 1
    });
  }
  return PROCESS_ROLES.flatMap((role) => {
    const aggregate = totals.get(role);
    return aggregate === undefined ? [] : [aggregate];
  });
};

export const productRssKb = (aggregates: readonly ProcessRoleAggregate[]): number =>
  aggregates.reduce(
    (sum, aggregate) => sum + (PRODUCT_ROLES.has(aggregate.role) ? aggregate.rssKbTotal : 0),
    0
  );

const registeredRoles = new Map<number, ProcessRole>();
const mainWindowRendererPids = new Set<number>();
const guestRendererPids = new Set<number>();

export const registerProcessRole = (pid: number, role: ProcessRole): void => {
  if (pid > 0) {
    registeredRoles.set(pid, role);
  }
};

export const registerMainWindowRenderer = (pid: number): void => {
  if (pid > 0) {
    mainWindowRendererPids.add(pid);
  }
};

export const registerGuestRenderer = (pid: number): void => {
  if (pid > 0) {
    guestRendererPids.add(pid);
  }
};

export const processRolePids = (mainPid: number): ProcessRolePids => ({
  mainPid,
  mainWindowRendererPids,
  guestRendererPids,
  registered: registeredRoles
});

export const resetProcessRoleRegistryForTests = (): void => {
  registeredRoles.clear();
  mainWindowRendererPids.clear();
  guestRendererPids.clear();
};
