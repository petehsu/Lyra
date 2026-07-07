#!/usr/bin/env python3
"""Lyra OSINT Bridge — JSON stdin/stdout protocol entry point.

Reads a single JSON command from stdin, runs an OSINT scan, writes a single JSON
result to stdout. Designed to be spawned by the Rust runtime (persona/osint.rs).

Protocol:
  stdin  → {"type": "scan", "seed": "email_or_username", "options": {...}}
  stdout → {"profiles": [...], "correlations": [...], "expanded_usernames": [...], "errors": [...], "scanIncomplete": bool}

All logging goes to stderr; stdout is reserved for the JSON result only.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
from pathlib import Path
from typing import Any

# Ensure the bundle directory is on sys.path so `aliens_eye` resolves.
_BRIDGE_DIR = Path(__file__).resolve().parent
if str(_BRIDGE_DIR) not in sys.path:
    sys.path.insert(0, str(_BRIDGE_DIR))

from aliens_eye.core.analyzer import FeatureExtractor
from aliens_eye.core.config import ScannerConfig
from aliens_eye.core.detector import Detector
from aliens_eye.core.fingerprints import FingerprintStore
from aliens_eye.core.scanner import (
    UsernameScanner,
    filter_sites,
    load_nsfw_sites,
    load_sites_data,
)
from aliens_eye.core.variations import usernames_from_email, usernames_from_name
from aliens_eye.core.expand import candidate_usernames_from_results

logger = logging.getLogger("lyra_osint_bridge")


def _setup_logging(verbose: bool = False) -> None:
    level = logging.DEBUG if verbose else logging.WARNING
    logging.basicConfig(
        stream=sys.stderr,
        level=level,
        format="%(name)s %(levelname)s: %(message)s",
    )


def _check_dependencies() -> list[str]:
    """Return a list of missing dependency names."""
    missing = []
    try:
        import aiohttp  # noqa: F401
    except ImportError:
        missing.append("aiohttp")
    try:
        from selectolax.parser import HTMLParser  # noqa: F401
    except ImportError:
        missing.append("selectolax")
    return missing


def _build_config(options: dict[str, Any]) -> ScannerConfig:
    config = ScannerConfig()
    if "timeout" in options:
        config.timeout = float(options["timeout"])
    if "concurrent" in options:
        config.concurrent = int(options["concurrent"])
    if "no_nsfw" in options and options["no_nsfw"]:
        config.exclude_nsfw = True
    if "proxy" in options:
        config.proxy = options["proxy"]
    if "sites_path" in options and options["sites_path"]:
        config.sites_path = Path(options["sites_path"])
    return config


def _extract_profile_fields(result: dict[str, Any]) -> dict[str, Any]:
    """Flatten the profile signals from a scan result into bridge output."""
    profile = (
        result.get("ai_analysis", {})
        .get("signals", {})
        .get("profile", {})
        or {}
    )
    return {
        "site": result.get("site", ""),
        "url": result.get("url", ""),
        "status": result.get("status", ""),
        "confidence": result.get("confidence", 0),
        "profileName": profile.get("name") or None,
        "profileBio": profile.get("bio") or None,
        "profileAvatar": profile.get("avatar") or None,
    }


def _report_dict(
    seed: str, scan_level: str, all_results: dict[str, list[dict[str, Any]]]
) -> dict[str, Any]:
    """Build a report dict compatible with correlate_report."""
    variations = {}
    for username, results in all_results.items():
        sites = {}
        for r in results:
            sites[r["site"]] = {
                "status": r["status"],
                "url": r["url"],
                "ai_analysis": r.get("ai_analysis", {}),
            }
        variations[username] = {"sites": sites}
    return {"seed": seed, "level": scan_level, "variations": variations}


async def _run_scan(command: dict[str, Any]) -> dict[str, Any]:
    seed = command.get("seed", "").strip()
    if not seed:
        return {
            "profiles": [],
            "correlations": [],
            "expandedUsernames": [],
            "errors": ["Missing 'seed' field in command"],
            "scanIncomplete": True,
        }

    options = command.get("options") or {}
    scan_level = options.get("scan_level", "basic")
    config = _build_config(options)

    # Load sites
    sites_data = load_sites_data(config.sites_path)
    if not sites_data:
        return {
            "profiles": [],
            "correlations": [],
            "expandedUsernames": [],
            "errors": ["Failed to load sites.json"],
            "scanIncomplete": True,
        }

    # Filter NSFW if requested
    exclude = list(config.exclude_sites or [])
    if config.exclude_nsfw:
        exclude.extend(load_nsfw_sites())
    sites_data = filter_sites(sites_data, config.include_sites, exclude or None)

    # Derive seed usernames
    seeds: list[str] = []
    if "@" in seed:
        seeds = usernames_from_email(seed)
    elif " " in seed:
        seeds = usernames_from_name(seed)
    if not seeds:
        seeds = [seed]
    # Dedupe
    seeds = list(dict.fromkeys(s for s in seeds if len(s) >= 2))

    # Initialize scanner components
    detector = Detector()
    if config.use_ml:
        detector.load_model(logger, config.model_path)
    extractor = FeatureExtractor()
    fingerprints = FingerprintStore(config.fingerprints_path, config.max_fingerprints_per_label)
    fingerprints.load(logger)

    scanner = UsernameScanner(
        sites_data=sites_data,
        config=config,
        extractor=extractor,
        detector=detector,
        fingerprints=fingerprints,
        logger=logger,
    )

    errors: list[str] = []
    all_profiles: list[dict[str, Any]] = []
    expanded_usernames: list[str] = []
    combined_results: dict[str, list[dict[str, Any]]] = {}

    try:
        for username in seeds:
            results = await scanner.scan_all_sites(username)
            combined_results[username] = results
            for r in results:
                if r.get("status") in {"Found", "Maybe"}:
                    all_profiles.append(_extract_profile_fields(r))
            # Expand: extract linked usernames from found profiles
            expanded = candidate_usernames_from_results(
                {username: results}, exclude={s.lower() for s in seeds}
            )
            expanded_usernames.extend(expanded)

        # Correlate
        correlations: list[dict[str, Any]] = []
        try:
            from aliens_eye.core.correlate import correlate_report
            report = _report_dict(seed, scan_level, combined_results)
            correlation_result = await correlate_report(report, proxy=config.proxy, timeout=config.timeout)
            correlations = correlation_result.get("clusters", [])
        except Exception as exc:
            errors.append(f"Correlation failed: {exc}")

    except Exception as exc:
        errors.append(f"Scan failed: {exc}")
        return {
            "profiles": all_profiles,
            "correlations": [],
            "expandedUsernames": expanded_usernames,
            "errors": errors,
            "scanIncomplete": True,
        }
    finally:
        try:
            fingerprints.save()
        except Exception:
            pass

    # Dedupe expanded usernames
    expanded_usernames = list(dict.fromkeys(expanded_usernames))

    return {
        "profiles": all_profiles,
        "correlations": correlations,
        "expandedUsernames": expanded_usernames,
        "errors": errors,
        "scanIncomplete": False,
    }


async def _main() -> int:
    _setup_logging(verbose=bool(os.environ.get("LYRA_OSINT_DEBUG")))

    # Check dependencies
    missing = _check_dependencies()
    if missing:
        output = {
            "profiles": [],
            "correlations": [],
            "expandedUsernames": [],
            "errors": [f"Missing Python dependencies: {', '.join(missing)}. Install with: pip install {' '.join(missing)}"],
            "scanIncomplete": True,
        }
        print(json.dumps(output, ensure_ascii=False))
        return 1

    # Read command from stdin
    try:
        line = sys.stdin.readline()
        if not line.strip():
            output = {
                "profiles": [],
                "correlations": [],
                "expandedUsernames": [],
                "errors": ["No input received on stdin"],
                "scanIncomplete": True,
            }
            print(json.dumps(output, ensure_ascii=False))
            return 1
        command = json.loads(line)
    except json.JSONDecodeError as exc:
        output = {
            "profiles": [],
            "correlations": [],
            "expandedUsernames": [],
            "errors": [f"Invalid JSON input: {exc}"],
            "scanIncomplete": True,
        }
        print(json.dumps(output, ensure_ascii=False))
        return 1

    if command.get("type") != "scan":
        output = {
            "profiles": [],
            "correlations": [],
            "expandedUsernames": [],
            "errors": [f"Unknown command type: {command.get('type', 'missing')}"],
            "scanIncomplete": True,
        }
        print(json.dumps(output, ensure_ascii=False))
        return 1

    result = await _run_scan(command)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        exit_code = asyncio.run(_main())
    except KeyboardInterrupt:
        exit_code = 130
    except Exception as exc:
        # Last-resort error: still output JSON so Rust can parse it
        print(json.dumps({
            "profiles": [],
            "correlations": [],
            "expandedUsernames": [],
            "errors": [f"Bridge fatal error: {exc}"],
            "scanIncomplete": True,
        }, ensure_ascii=False))
        exit_code = 1
    sys.exit(exit_code)