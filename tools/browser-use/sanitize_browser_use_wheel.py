#!/usr/bin/env python3
from __future__ import annotations

import base64
import csv
import hashlib
import io
import sys
import zipfile
from pathlib import Path


TELEMETRY_SERVICE_PATH = "browser_use/telemetry/service.py"
NOOP_TELEMETRY_SERVICE = '''import logging

from browser_use.telemetry.views import BaseTelemetryEvent
from browser_use.utils import singleton


logger = logging.getLogger(__name__)


@singleton
class ProductTelemetry:
\t"""Lyra disables browser-use product telemetry at the bundled wheel boundary."""

\tUSER_ID_PATH = ""
\tUNKNOWN_USER_ID = "UNKNOWN"
\t_curr_user_id = UNKNOWN_USER_ID

\tdef __init__(self) -> None:
\t\tself.debug_logging = False
\t\tself._client = None
\t\tlogger.debug("Browser-use product telemetry disabled by Lyra bundle")

\tdef capture(self, event: BaseTelemetryEvent) -> None:
\t\treturn None

\tdef _direct_capture(self, event: BaseTelemetryEvent) -> None:
\t\treturn None

\tdef flush(self) -> None:
\t\treturn None

\t@property
\tdef user_id(self) -> str:
\t\treturn self.UNKNOWN_USER_ID
'''


def _find_dist_info_prefix(names: set[str]) -> str:
    metadata_paths = [
        name for name in names
        if name.endswith(".dist-info/METADATA")
    ]
    if len(metadata_paths) != 1:
        raise ValueError(f"expected exactly one METADATA file, found {len(metadata_paths)}")
    return metadata_paths[0].removesuffix("METADATA")


def _sanitize_metadata(raw: bytes) -> bytes:
    lines = raw.decode("utf-8").splitlines()
    kept = [
        line for line in lines
        if not line.lower().startswith("requires-dist: posthog")
        and not line.lower().startswith("project-url: telemetry,")
    ]
    return ("\n".join(kept) + "\n").encode("utf-8")


def _record_hash(data: bytes) -> str:
    digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).decode("ascii")
    return f"sha256={digest.rstrip('=')}"


def _build_record(entries: dict[str, bytes], record_path: str) -> bytes:
    output = io.StringIO()
    writer = csv.writer(output, lineterminator="\n")
    for name in sorted(entries):
        if name == record_path:
            continue
        data = entries[name]
        writer.writerow([name, _record_hash(data), str(len(data))])
    writer.writerow([record_path, "", ""])
    return output.getvalue().encode("utf-8")


def sanitize_wheel(wheel_path: Path) -> None:
    with zipfile.ZipFile(wheel_path, "r") as source:
        infos = [info for info in source.infolist() if not info.is_dir()]
        info_by_name = {info.filename: info for info in infos}
        entries = {info.filename: source.read(info.filename) for info in infos}

    names = set(entries)
    dist_info_prefix = _find_dist_info_prefix(names)
    metadata_path = f"{dist_info_prefix}METADATA"
    record_path = f"{dist_info_prefix}RECORD"

    if TELEMETRY_SERVICE_PATH not in entries:
        raise ValueError(f"missing {TELEMETRY_SERVICE_PATH}")
    if record_path not in entries:
        raise ValueError(f"missing {record_path}")

    entries[metadata_path] = _sanitize_metadata(entries[metadata_path])
    entries[TELEMETRY_SERVICE_PATH] = NOOP_TELEMETRY_SERVICE.encode("utf-8")

    for name, data in entries.items():
        if name.endswith(".py") or name.endswith("METADATA"):
            if b"posthog" in data.lower():
                raise ValueError(f"blocked telemetry import still present in {name}")

    entries[record_path] = _build_record(entries, record_path)

    temp_path = wheel_path.with_suffix(f"{wheel_path.suffix}.tmp")
    try:
        with zipfile.ZipFile(temp_path, "w", compression=zipfile.ZIP_DEFLATED) as output:
            for info in infos:
                data = entries[info.filename]
                new_info = zipfile.ZipInfo(info.filename, info.date_time)
                new_info.comment = info.comment
                new_info.extra = info.extra
                new_info.internal_attr = info.internal_attr
                new_info.external_attr = info.external_attr
                new_info.compress_type = zipfile.ZIP_DEFLATED
                output.writestr(new_info, data)
        temp_path.replace(wheel_path)
    finally:
        temp_path.unlink(missing_ok=True)


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: sanitize_browser_use_wheel.py <browser_use wheel>", file=sys.stderr)
        return 2
    sanitize_wheel(Path(sys.argv[1]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
