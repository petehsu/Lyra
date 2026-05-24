#!/usr/bin/env bash
set -euo pipefail

# Runs the current Linux-native mobile simulator vertical slice.
# This intentionally requires no MacBook, Xcode, Apple iOS Simulator, or iPhone.

scenario="${1:-pairing_ready}"
message="${2:-hello smoke simulator}"

tmpdir="$(mktemp -d)"
socket="$tmpdir/mobile-sim.sock"

cleanup() {
  cargo run -p jcode-mobile-sim -- shutdown --socket "$socket" >/dev/null 2>&1 || true
  rm -rf "$tmpdir"
}
trap cleanup EXIT

echo "[mobile-smoke] socket: $socket"
echo "[mobile-smoke] scenario: $scenario"
echo "[mobile-smoke] message: $message"

cargo run -p jcode-mobile-sim -- start --socket "$socket" --scenario "$scenario"
cargo run -p jcode-mobile-sim -- status --socket "$socket" >/dev/null
cargo run -p jcode-mobile-sim -- assert-screen --socket "$socket" onboarding >/dev/null
cargo run -p jcode-mobile-sim -- assert-node --socket "$socket" pair.submit --enabled true --role button >/dev/null
cargo run -p jcode-mobile-sim -- assert-no-error --socket "$socket" >/dev/null

cargo run -p jcode-mobile-sim -- tap --socket "$socket" pair.submit >/dev/null
cargo run -p jcode-mobile-sim -- assert-screen --socket "$socket" chat >/dev/null
cargo run -p jcode-mobile-sim -- assert-text --socket "$socket" "Connected to simulated jcode server." >/dev/null

cargo run -p jcode-mobile-sim -- set-field --socket "$socket" draft "$message" >/dev/null
cargo run -p jcode-mobile-sim -- tap --socket "$socket" chat.send >/dev/null
cargo run -p jcode-mobile-sim -- assert-text --socket "$socket" "Simulated response to: $message" >/dev/null
cargo run -p jcode-mobile-sim -- assert-transition --socket "$socket" --type tap_node --contains chat.send >/dev/null
cargo run -p jcode-mobile-sim -- assert-effect --socket "$socket" --type send_message --contains "$message" >/dev/null
cargo run -p jcode-mobile-sim -- assert-no-error --socket "$socket" >/dev/null
cargo run -p jcode-mobile-sim -- log --socket "$socket" --limit 10 >/dev/null

echo "[mobile-smoke] ok"
