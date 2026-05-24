#!/usr/bin/env bash
set -euo pipefail

# Agent-friendly wrapper for the Linux-native jcode mobile simulator.
# It gives debug/tester workflows a stable socket, state directory, and command set
# for spawning, driving, inspecting, capturing, and cleaning up simulator runs.

state_dir="${JCODE_MOBILE_TESTER_DIR:-${TMPDIR:-/tmp}/jcode-mobile-tester-${USER:-user}}"
socket="$state_dir/mobile-sim.sock"

usage() {
  cat <<'EOF'
Usage: scripts/mobile_simulator_tester.sh <command> [args]

Commands:
  start [scenario]          Start simulator on a stable tester socket
  status                    Print simulator status JSON
  state                     Print full app state JSON
  tree                      Print semantic UI tree JSON
  scene [output]            Print or write Rust visual scene JSON
  preview                   Open live wgpu visual scene preview window
  preview-mesh [output]     Print or write wgpu triangle mesh JSON
  render [output]           Print or write deterministic text render
  screenshot [output]       Print or write screenshot snapshot JSON
  screenshot-svg [output]   Print or write deterministic SVG screenshot
  tap <node_id>             Tap semantic node
  tap-at <x> <y>            Tap by coordinates
  type <node_id> <text>     Type text into semantic input/composer
  key <key> [node_id]       Send keypress, default node_id=chat.draft
  wait [sim args...]        Forward to jcode-mobile-sim wait
  assert-screen <screen>    Assert current screen
  assert-text <text>        Assert text exists in state
  assert-node <args...>     Forward to jcode-mobile-sim assert-node
  assert-hit <x> <y> <id>   Assert coordinate hit target
  log [limit]               Print transition/effect log
  shutdown                  Stop simulator
  cleanup                   Stop simulator and remove tester state dir
  smoke [message]           Run a pairing-ready end-to-end smoke through this wrapper
  socket                    Print tester socket path
EOF
}

sim() {
  cargo run -q -p jcode-mobile-sim -- "$@"
}

ensure_dir() {
  mkdir -p "$state_dir"
}

cmd="${1:-help}"
if [[ $# -gt 0 ]]; then
  shift
fi

case "$cmd" in
  help|-h|--help)
    usage
    ;;
  socket)
    ensure_dir
    printf '%s\n' "$socket"
    ;;
  start)
    ensure_dir
    scenario="${1:-pairing_ready}"
    sim start --socket "$socket" --scenario "$scenario"
    ;;
  status)
    sim status --socket "$socket"
    ;;
  state)
    sim state --socket "$socket"
    ;;
  tree)
    sim tree --socket "$socket"
    ;;
  scene)
    if [[ $# -gt 0 ]]; then
      sim scene --socket "$socket" --output "$1"
    else
      sim scene --socket "$socket"
    fi
    ;;
  preview)
    sim preview --socket "$socket"
    ;;
  preview-mesh)
    if [[ $# -gt 0 ]]; then
      sim preview-mesh --socket "$socket" --output "$1"
    else
      sim preview-mesh --socket "$socket"
    fi
    ;;
  render)
    if [[ $# -gt 0 ]]; then
      sim render --socket "$socket" --output "$1"
    else
      sim render --socket "$socket"
    fi
    ;;
  screenshot)
    if [[ $# -gt 0 ]]; then
      sim screenshot --socket "$socket" --output "$1"
    else
      sim screenshot --socket "$socket"
    fi
    ;;
  screenshot-svg)
    if [[ $# -gt 0 ]]; then
      sim screenshot --socket "$socket" --format svg --output "$1"
    else
      sim screenshot --socket "$socket" --format svg
    fi
    ;;
  tap)
    sim tap --socket "$socket" "$@"
    ;;
  tap-at)
    sim tap-at --socket "$socket" "$@"
    ;;
  type)
    node_id="${1:?node_id required}"
    shift
    text="${1:?text required}"
    sim type-text --socket "$socket" "$node_id" "$text"
    ;;
  key)
    key="${1:?key required}"
    node_id="${2:-chat.draft}"
    sim keypress --socket "$socket" "$key" --node-id "$node_id"
    ;;
  wait)
    sim wait --socket "$socket" "$@"
    ;;
  assert-screen)
    sim assert-screen --socket "$socket" "$@"
    ;;
  assert-text)
    sim assert-text --socket "$socket" "$@"
    ;;
  assert-node)
    sim assert-node --socket "$socket" "$@"
    ;;
  assert-hit)
    sim assert-hit --socket "$socket" "$@"
    ;;
  log)
    if [[ $# -gt 0 ]]; then
      sim log --socket "$socket" --limit "$1"
    else
      sim log --socket "$socket"
    fi
    ;;
  shutdown)
    sim shutdown --socket "$socket" >/dev/null 2>&1 || true
    ;;
  cleanup)
    sim shutdown --socket "$socket" >/dev/null 2>&1 || true
    rm -rf "$state_dir"
    ;;
  smoke)
    message="${1:-hello mobile tester}"
    "$0" cleanup >/dev/null 2>&1 || true
    "$0" start pairing_ready >/dev/null
    "$0" assert-screen onboarding >/dev/null
    "$0" assert-node pair.submit --enabled true --role button >/dev/null
    "$0" tap pair.submit >/dev/null
    "$0" wait --screen chat --contains "Connected to simulated jcode server." >/dev/null
    "$0" type chat.draft "$message" >/dev/null
    "$0" key Enter chat.draft >/dev/null
    "$0" wait --contains "Simulated response to: $message" >/dev/null
    "$0" render >/dev/null
    "$0" screenshot >/dev/null
    "$0" log 10 >/dev/null
    echo "[mobile-tester] ok socket=$socket"
    ;;
  *)
    echo "Unknown command: $cmd" >&2
    usage >&2
    exit 2
    ;;
esac
