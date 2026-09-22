const SQLITE_EXTENSIONS = new Set(["sqlite", "sqlite3", "db", "db3"]);

export const sqliteExtension = (filePath: string): string => {
  const slash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  const name = slash >= 0 ? filePath.slice(slash + 1) : filePath;
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
};

export const isSqliteDocumentPath = (filePath: string): boolean =>
  SQLITE_EXTENSIONS.has(sqliteExtension(filePath));

export const sqliteTitleFromPath = (filePath: string): string => {
  const slash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  const name = slash >= 0 ? filePath.slice(slash + 1) : filePath;
  return name.length > 0 ? name : filePath;
};
