import type {
  WorkbenchObservedTabDescriptor,
  WorkbenchTabsListRequest,
  WorkbenchTabsListResult
} from "../../shared/workbench-observation";
import { ResultCache } from "./result-cache";

export class WorkbenchObservationTabRegistry {
  private readonly cache = new ResultCache<WorkbenchTabsListResult>(500);

  public constructor(
    private readonly load: (request?: WorkbenchTabsListRequest) => Promise<WorkbenchTabsListResult>
  ) {}

  async list(request?: WorkbenchTabsListRequest): Promise<WorkbenchTabsListResult> {
    const cacheKey = JSON.stringify(request ?? {});
    const cached = this.cache.read(cacheKey);
    if (cached !== null) {
      return cached;
    }
    const loaded = await this.load(request);
    this.cache.write(cacheKey, loaded);
    return loaded;
  }

  async get(tabId: string): Promise<WorkbenchObservedTabDescriptor | null> {
    const listed = await this.list({ includeUnsupported: true });
    return listed.tabs.find((tab) => tab.tabId === tabId) ?? null;
  }

  clear(): void {
    this.cache.clear();
  }
}
