export const toHttpDownloadTransportUrl = (url: string): string => {
  const parsed = new URL(url);
  const protocol = parsed.protocol === "webdav:"
    ? "http:"
    : parsed.protocol === "webdavs:"
      ? "https:"
      : null;
  if (protocol !== null) {
    const auth = parsed.username.length === 0
      ? ""
      : `${parsed.username}${parsed.password.length === 0 ? "" : `:${parsed.password}`}@`;
    return `${protocol}//${auth}${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
  }
  return parsed.toString();
};

export const isNativeHttpFamilyDownloadUrl = (url: string): boolean => {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:"
      || protocol === "https:"
      || protocol === "webdav:"
      || protocol === "webdavs:";
  } catch {
    return false;
  }
};
