import type { Session } from "electron";

export type LoginManagerClearSiteDataResult = {
  readonly cookiesRemoved: number;
  readonly storageCleared: boolean;
};

export const clearSiteData = async (
  origin: string,
  sessions: readonly Session[]
): Promise<LoginManagerClearSiteDataResult> => {
  let cookiesRemoved = 0;
  let storageCleared = false;

  for (const electronSession of sessions) {
    const cookies = await electronSession.cookies.get({ url: origin }).catch(() => []);
    for (const cookie of cookies) {
      await electronSession.cookies.remove(origin, cookie.name)
        .then(() => {
          cookiesRemoved += 1;
        })
        .catch(() => undefined);
    }
    await electronSession.clearStorageData({
      origin,
      storages: [
        "cookies",
        "localstorage",
        "indexdb",
        "cachestorage",
        "serviceworkers",
        "websql"
      ]
    }).then(() => {
      storageCleared = true;
    }).catch(() => undefined);
  }

  return {
    cookiesRemoved,
    storageCleared
  };
};
