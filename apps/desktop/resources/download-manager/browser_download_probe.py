#!/usr/bin/env python3
import argparse
import json
import os
import platform
import shutil
import sqlite3
import tempfile
import time
import urllib.parse
from pathlib import Path


CHROMIUM_BROWSERS = (
    ("Chrome", {
        "darwin": ("Library/Application Support/Google/Chrome",),
        "linux": (".config/google-chrome", ".config/google-chrome-beta"),
        "windows": ("Google/Chrome/User Data",),
    }),
    ("Edge", {
        "darwin": ("Library/Application Support/Microsoft Edge",),
        "linux": (".config/microsoft-edge", ".config/microsoft-edge-beta"),
        "windows": ("Microsoft/Edge/User Data",),
    }),
    ("Brave", {
        "darwin": ("Library/Application Support/BraveSoftware/Brave-Browser",),
        "linux": (".config/BraveSoftware/Brave-Browser",),
        "windows": ("BraveSoftware/Brave-Browser/User Data",),
    }),
    ("Chromium", {
        "darwin": ("Library/Application Support/Chromium",),
        "linux": (".config/chromium",),
        "windows": ("Chromium/User Data",),
    }),
)


def system_key():
    name = platform.system().lower()
    if name == "darwin":
        return "darwin"
    if name == "windows":
        return "windows"
    return "linux"


def windows_local_app_data(home):
    return Path(os.environ.get("LOCALAPPDATA", str(home / "AppData/Local")))


def windows_roaming_app_data(home):
    return Path(os.environ.get("APPDATA", str(home / "AppData/Roaming")))


def browser_root(home, relative_path):
    if system_key() == "windows":
        return windows_local_app_data(home) / relative_path
    return home / relative_path


def firefox_root(home):
    key = system_key()
    if key == "darwin":
        return home / "Library/Application Support/Firefox/Profiles"
    if key == "windows":
        return windows_roaming_app_data(home) / "Mozilla/Firefox/Profiles"
    return home / ".mozilla/firefox"


def safe_copy_sqlite(source):
    if not source.exists():
        return None
    fd, target = tempfile.mkstemp(prefix="lyra-browser-downloads-", suffix=".sqlite")
    os.close(fd)
    try:
        shutil.copy2(source, target)
        return target
    except Exception:
        try:
            os.remove(target)
        except OSError:
            pass
        return None


def table_columns(connection, table_name):
    try:
        rows = connection.execute(f"PRAGMA table_info({table_name})").fetchall()
    except sqlite3.Error:
        return set()
    return {str(row[1]) for row in rows}


def table_exists(connection, table_name):
    try:
        row = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
            (table_name,),
        ).fetchone()
        return row is not None
    except sqlite3.Error:
        return False


def chromium_profiles(root):
    if not root.exists():
        return []
    profiles = []
    for child in root.iterdir():
        if not child.is_dir():
            continue
        if (child / "History").exists():
            profiles.append(child)
    profiles.sort(key=lambda item: (item.name != "Default", item.name))
    return profiles


def chromium_download_url(connection, download_id):
    if not table_exists(connection, "downloads_url_chains"):
        return None
    try:
        row = connection.execute(
            """
            SELECT url
            FROM downloads_url_chains
            WHERE id=?
            ORDER BY chain_index DESC
            LIMIT 1
            """,
            (download_id,),
        ).fetchone()
    except sqlite3.Error:
        return None
    return row[0] if row is not None and isinstance(row[0], str) else None


def existing_path(*candidates):
    for candidate in candidates:
        if candidate is None or len(str(candidate)) == 0:
            continue
        path = Path(candidate).expanduser()
        if path.exists():
            return str(path)
    return None


def chromium_partial_path(target_path, current_path):
    target = Path(target_path).expanduser() if target_path else None
    current = Path(current_path).expanduser() if current_path else None
    candidates = []
    if current is not None:
        candidates.append(current)
    if target is not None:
        candidates.extend((
            Path(str(target) + ".crdownload"),
            Path(str(target) + ".download"),
            target,
        ))
    return existing_path(*candidates)


def normalize_url(value):
    if not isinstance(value, str):
        return None
    value = value.strip()
    if not value:
        return None
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme.lower() not in ("http", "https", "ftp", "ftps"):
        return None
    return value


def chrome_time_to_iso(value):
    try:
        timestamp = (int(value) / 1000000) - 11644473600
        if timestamp <= 0:
            return None
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(timestamp))
    except Exception:
        return None


def scan_chromium_profile(browser_name, profile_path, limit):
    history_path = profile_path / "History"
    copied_path = safe_copy_sqlite(history_path)
    if copied_path is None:
        return []
    connection = None
    try:
        connection = sqlite3.connect(copied_path)
        connection.row_factory = sqlite3.Row
        columns = table_columns(connection, "downloads")
        if "id" not in columns:
            return []
        wanted_columns = [
            "id",
            "target_path",
            "current_path",
            "tab_url",
            "referrer",
            "mime_type",
            "received_bytes",
            "total_bytes",
            "state",
            "start_time",
        ]
        select_columns = [name for name in wanted_columns if name in columns]
        rows = connection.execute(
            f"""
            SELECT {", ".join(select_columns)}
            FROM downloads
            ORDER BY {("start_time" if "start_time" in columns else "id")} DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        candidates = []
        for row in rows:
            row_map = dict(row)
            url = normalize_url(chromium_download_url(connection, row_map.get("id")))
            if url is None:
                url = normalize_url(row_map.get("tab_url"))
            if url is None:
                continue
            target_path = row_map.get("target_path")
            current_path = row_map.get("current_path")
            partial_path = chromium_partial_path(target_path, current_path)
            received_bytes = int(row_map.get("received_bytes") or 0)
            total_bytes = int(row_map.get("total_bytes") or 0)
            state = int(row_map.get("state") or 0)
            if state == 1 and (total_bytes <= 0 or received_bytes >= total_bytes):
                continue
            candidates.append({
                "browser": browser_name,
                "profile": profile_path.name,
                "url": url,
                "finalPath": str(Path(target_path).expanduser()) if target_path else None,
                "partialFilePath": partial_path,
                "referrer": row_map.get("referrer") or None,
                "mimeType": row_map.get("mime_type") or None,
                "receivedBytes": received_bytes,
                "totalBytes": total_bytes,
                "state": "in-progress" if state == 0 else "interrupted",
                "startedAt": chrome_time_to_iso(row_map.get("start_time")),
            })
        return candidates
    except sqlite3.Error:
        return []
    finally:
        if connection is not None:
            try:
                connection.close()
            except Exception:
                pass
        try:
            os.remove(copied_path)
        except OSError:
            pass


def file_url_to_path(value):
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme != "file":
        return None
    path = urllib.parse.unquote(parsed.path)
    if system_key() == "windows" and path.startswith("/") and len(path) > 2 and path[2] == ":":
        path = path[1:]
    return path


def scan_firefox_profile(profile_path, limit):
    copied_path = safe_copy_sqlite(profile_path / "places.sqlite")
    if copied_path is None:
        return []
    connection = None
    try:
        connection = sqlite3.connect(copied_path)
        connection.row_factory = sqlite3.Row
        if not all(table_exists(connection, table) for table in ("moz_places", "moz_annos", "moz_anno_attributes")):
            return []
        rows = connection.execute(
            """
            SELECT
              p.url AS url,
              n.name AS name,
              a.content AS content,
              a.dateAdded AS date_added
            FROM moz_places p
            JOIN moz_annos a ON a.place_id = p.id
            JOIN moz_anno_attributes n ON n.id = a.anno_attribute_id
            WHERE n.name IN ('downloads/destinationFileURI', 'downloads/destinationFileName')
            ORDER BY a.dateAdded DESC
            LIMIT ?
            """,
            (limit * 2,),
        ).fetchall()
        grouped = {}
        for row in rows:
            url = normalize_url(row["url"])
            if url is None:
                continue
            entry = grouped.setdefault(url, {
                "browser": "Firefox",
                "profile": profile_path.name,
                "url": url,
                "startedAt": chrome_time_to_iso(row["date_added"]),
            })
            if row["name"] == "downloads/destinationFileURI":
                final_path = file_url_to_path(row["content"])
                if final_path:
                    entry["finalPath"] = final_path
                    entry["partialFilePath"] = existing_path(final_path + ".part", final_path)
            elif row["name"] == "downloads/destinationFileName" and "finalPath" not in entry:
                entry["fileName"] = row["content"]
        return [
            entry for entry in grouped.values()
            if entry.get("partialFilePath") is not None
        ][:limit]
    except sqlite3.Error:
        return []
    finally:
        if connection is not None:
            try:
                connection.close()
            except Exception:
                pass
        try:
            os.remove(copied_path)
        except OSError:
            pass


def scan(limit, home):
    candidates = []
    key = system_key()
    for browser_name, roots_by_system in CHROMIUM_BROWSERS:
        for relative_path in roots_by_system.get(key, ()):
            root = browser_root(home, relative_path)
            for profile in chromium_profiles(root):
                candidates.extend(scan_chromium_profile(browser_name, profile, limit))
                if len(candidates) >= limit:
                    break
    firefox_profiles_root = firefox_root(home)
    if firefox_profiles_root.exists():
        for profile in sorted(firefox_profiles_root.iterdir(), key=lambda item: item.name):
            if profile.is_dir():
                candidates.extend(scan_firefox_profile(profile, limit))
    deduped = []
    seen = set()
    for candidate in candidates:
        key = (candidate.get("url"), candidate.get("partialFilePath"), candidate.get("finalPath"))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(candidate)
        if len(deduped) >= limit:
            break
    return deduped


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=24)
    parser.add_argument("--home")
    args = parser.parse_args()
    home = Path(args.home).expanduser() if args.home else Path.home()
    limit = max(1, min(100, args.limit))
    print(json.dumps({
        "ok": True,
        "candidates": scan(limit, home),
    }, ensure_ascii=True))


if __name__ == "__main__":
    main()
