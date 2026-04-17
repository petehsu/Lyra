#!/usr/bin/env python3

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from email import policy
from email.parser import BytesParser
from pathlib import Path
from typing import Dict, List, Set, Tuple

from pip._vendor.packaging.markers import default_environment
from pip._vendor.packaging.requirements import Requirement
from pip._vendor.packaging.specifiers import SpecifierSet
from pip._vendor.packaging.utils import canonicalize_name
from pip._vendor.packaging.version import Version


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dest", required=True)
    parser.add_argument("--platform", required=True)
    parser.add_argument("--python-version", required=True)
    parser.add_argument("--python-full-version", required=True)
    parser.add_argument("--sys-platform", required=True)
    parser.add_argument("--os-name", required=True)
    parser.add_argument("--platform-system", required=True)
    parser.add_argument("--platform-machine", required=True)
    parser.add_argument("--root", action="append", required=True)
    return parser.parse_args()


def build_marker_environment(args: argparse.Namespace) -> Dict[str, str]:
    env = default_environment()
    env.update(
        {
            "python_version": args.python_version,
            "python_full_version": args.python_full_version,
            "implementation_name": "cpython",
            "implementation_version": args.python_full_version,
            "os_name": args.os_name,
            "sys_platform": args.sys_platform,
            "platform_system": args.platform_system,
            "platform_machine": args.platform_machine,
            "platform_python_implementation": "CPython",
            "extra": "",
        }
    )
    return env


def run_pip_download(requirement: str, args: argparse.Namespace, dest: Path) -> Path:
    command = [
        sys.executable,
        "-m",
        "pip",
        "download",
        "--disable-pip-version-check",
        "--only-binary=:all:",
        "--no-deps",
        "--dest",
        str(dest),
        "--platform",
        args.platform,
        "--python-version",
        args.python_version,
        "--implementation",
        "cp",
        "--abi",
        "cp312",
        "--abi",
        "abi3",
        "--abi",
        "none",
        requirement,
    ]
    subprocess.run(command, check=True)
    files = [entry for entry in dest.iterdir() if entry.is_file()]
    if len(files) != 1:
        raise RuntimeError(f"expected exactly one downloaded wheel for {requirement}, got {len(files)}")
    return files[0]


def read_wheel_metadata(wheel_path: Path) -> Tuple[str, Version, List[str]]:
    with zipfile.ZipFile(wheel_path) as archive:
        metadata_name = next(
            (
                name
                for name in archive.namelist()
                if name.endswith(".dist-info/METADATA")
            ),
            None,
        )
        if metadata_name is None:
            raise RuntimeError(f"missing METADATA in {wheel_path}")
        payload = archive.read(metadata_name)
    message = BytesParser(policy=policy.default).parsebytes(payload)
    name = message["Name"]
    version = message["Version"]
    if not isinstance(name, str) or not isinstance(version, str):
      raise RuntimeError(f"invalid wheel metadata for {wheel_path}")
    requirements = message.get_all("Requires-Dist") or []
    return name, Version(version), [str(value) for value in requirements]


def should_include(requirement: Requirement, marker_env: Dict[str, str]) -> bool:
    if requirement.marker is None:
        return True
    return bool(requirement.marker.evaluate(marker_env))


def main() -> None:
    args = parse_args()
    marker_env = build_marker_environment(args)
    destination = Path(args.dest)
    destination.mkdir(parents=True, exist_ok=True)

    queue: List[str] = []
    queued_names: Set[str] = set()
    resolved_versions: Dict[str, Version] = {}
    downloaded_files: Dict[str, Path] = {}
    constraints: Dict[str, List[Requirement]] = {}

    def enqueue_requirement(requirement_text: str) -> None:
        requirement = Requirement(requirement_text)
        if not should_include(requirement, marker_env):
            return
        canonical_name = canonicalize_name(requirement.name)
        constraint_list = constraints.setdefault(canonical_name, [])
        constraint_list.append(requirement)
        if canonical_name not in queued_names:
            queue.append(canonical_name)
            queued_names.add(canonical_name)

    for root_requirement in args.root:
        enqueue_requirement(root_requirement)

    while queue:
        canonical_name = queue.pop(0)
        queued_names.discard(canonical_name)
        current_constraints = constraints.get(canonical_name, [])
        if not current_constraints:
            continue
        specifiers = [str(requirement.specifier) for requirement in current_constraints if str(requirement.specifier)]
        combined_specifier = ",".join(
            part
            for part in specifiers
            if part
        )
        requirement_text = canonical_name if not combined_specifier else f"{canonical_name}{combined_specifier}"
        current_version = resolved_versions.get(canonical_name)
        if current_version is not None:
            combined = SpecifierSet(combined_specifier)
            if current_version in combined:
                continue

        with tempfile.TemporaryDirectory(prefix="lyra-browser-use-wheel-") as temp_dir:
            wheel_path = run_pip_download(requirement_text, args, Path(temp_dir))
            project_name, version, dependency_requirements = read_wheel_metadata(wheel_path)
            project_key = canonicalize_name(project_name)
            previous_file = downloaded_files.get(project_key)
            if previous_file is not None and previous_file.exists():
                previous_file.unlink()
            target_path = destination / wheel_path.name
            shutil.copy2(wheel_path, target_path)
            downloaded_files[project_key] = target_path
            resolved_versions[project_key] = version
            for dependency in dependency_requirements:
                enqueue_requirement(dependency)


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        raise SystemExit(error.returncode)
