import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { FileManagerFavorite } from "../../shared/file-manager";
import type { AgentHostCapabilityHandlers } from "./host-payload";
import { normalizePayload, readStringField } from "./host-payload";

type FavoritesFilePayload = {
  readonly favorites?: readonly FileManagerFavorite[];
};

const favoritesFilePath = (storageRoot: string): string =>
  join(storageRoot, "favorites.json");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && Array.isArray(value) === false;

const readFavorites = async (storageRoot: string): Promise<readonly FileManagerFavorite[]> => {
  try {
    const raw = await readFile(favoritesFilePath(storageRoot), "utf8");
    const parsed = JSON.parse(raw) as FavoritesFilePayload;
    return Array.isArray(parsed.favorites)
      ? parsed.favorites.filter((item): item is FileManagerFavorite =>
          isRecord(item)
          && typeof item.id === "string"
          && typeof item.title === "string"
          && typeof item.path === "string"
        )
      : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
};

const writeFavorites = async (
  storageRoot: string,
  favorites: readonly FileManagerFavorite[]
): Promise<readonly FileManagerFavorite[]> => {
  const filePath = favoritesFilePath(storageRoot);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify({ favorites }, null, 2)}\n`, "utf8");
  return favorites;
};

export const createFavoritesToolHost = ({
  storageRoot
}: {
  readonly storageRoot: string;
}): { readonly handlers: AgentHostCapabilityHandlers } => ({
  handlers: {
    "workbench.listFavorites": async () => {
      const favorites = await readFavorites(storageRoot);
      return {
        ok: true,
        count: favorites.length,
        favorites
      };
    },
    "workbench.removeFavorite": async (payload) => {
      const request = normalizePayload(payload);
      const id = readStringField(request, "id");
      const favorites = await readFavorites(storageRoot);
      const nextFavorites = favorites.filter((favorite) => favorite.id !== id);
      await writeFavorites(storageRoot, nextFavorites);
      return {
        ok: true,
        removed: nextFavorites.length !== favorites.length,
        id,
        count: nextFavorites.length,
        favorites: nextFavorites
      };
    }
  }
});
