import type { WorkspaceAppTabOpenRequest } from "../workspace-tabs";

export const RESOURCE_MONITOR_INSTANCE_ID = "resource-monitor";

export const createResourceMonitorAppRequest = (
  title: string
): WorkspaceAppTabOpenRequest => ({
  appId: "resource-monitor",
  appInstanceId: RESOURCE_MONITOR_INSTANCE_ID,
  title,
  iconKey: "resource-monitor-default"
});
