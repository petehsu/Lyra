type FilmCursorMessage = { type: "lyra-film-cursor"; active: false } | { type: "lyra-film-cursor"; active: true; x: number; y: number };
export function isFilmCursorMessage(value: unknown): value is FilmCursorMessage {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  if (data.type !== "lyra-film-cursor") return false;
  if (data.active === false) return true;
  return data.active === true && typeof data.x === "number" && Number.isFinite(data.x)
    && typeof data.y === "number" && Number.isFinite(data.y)
    && data.x >= 0 && data.x <= 1 && data.y >= 0 && data.y <= 1;
}
