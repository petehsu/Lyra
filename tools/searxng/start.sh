#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DATA="${LYRA_SEARXNG_HOME:-$HOME/.lyra/searxng}"
PORT="${LYRA_SEARXNG_PORT:-8888}"
SRC="${LYRA_SEARXNG_SRC:-}"
MISE="${HOME}/.local/bin/mise"
PID_FILE="$DATA/searxng.pid"
LOG_FILE="$DATA/searxng.log"
SECRET_FILE="$DATA/secret"
SETTINGS="${LYRA_SEARXNG_SETTINGS:-$SCRIPT_DIR/settings.yml}"

mkdir -p "$DATA/cache"
# SearXNG engine tokens live in SQLite under tempfile.gettempdir().
# Keep that off /tmp: a full tmpfs makes Google CSE crash and the whole
# general category return empty.
export TMPDIR="$DATA/cache"
export TMP="$DATA/cache"
export TEMP="$DATA/cache"

if [[ ! -f "$SETTINGS" ]]; then
  echo "SearXNG settings missing: $SETTINGS" >&2
  exit 1
fi

if [[ -z "$SRC" ]]; then
  if [[ -n "${LYRA_SEARXNG_REPO:-}" && -d "$LYRA_SEARXNG_REPO/參考/searxng/searx" ]]; then
    SRC="$LYRA_SEARXNG_REPO/參考/searxng"
  elif [[ -d "$SCRIPT_DIR/../../參考/searxng/searx" ]]; then
    SRC="$(cd "$SCRIPT_DIR/../.." && pwd)/參考/searxng"
  else
    SRC="$DATA/src"
    if [[ ! -d "$SRC/searx" ]]; then
      git clone --depth 1 https://github.com/searxng/searxng.git "$SRC"
    fi
  fi
fi

# HTTP is the source of truth. A leftover pid file must not block startup.
if command -v curl >/dev/null 2>&1 \
  && curl -fsS --max-time 2 "http://127.0.0.1:${PORT}/search?q=lyra&format=json" >/dev/null 2>&1; then
  echo "SearXNG already running on 127.0.0.1:$PORT"
  exit 0
fi
rm -f "$PID_FILE"

if [[ -x "$MISE" ]]; then
  PY="$("$MISE" exec python@3.12 -- python -c 'import sys; print(sys.executable)')"
else
  PY="${LYRA_SEARXNG_PYTHON:-python3}"
fi

if [[ -x "$DATA/.venv/bin/python" ]]; then
  VENV_PY="$DATA/.venv/bin/python"
elif [[ -x "$DATA/.venv/Scripts/python.exe" ]]; then
  VENV_PY="$DATA/.venv/Scripts/python.exe"
else
  "$PY" -m venv "$DATA/.venv"
  if [[ -x "$DATA/.venv/bin/python" ]]; then
    VENV_PY="$DATA/.venv/bin/python"
  else
    VENV_PY="$DATA/.venv/Scripts/python.exe"
  fi
fi

if ! "$VENV_PY" -c "import flask, msgspec, lxml, yaml" 2>/dev/null; then
  "$VENV_PY" -m pip install -q -U pip wheel
  "$VENV_PY" -m pip install -q -r "$SRC/requirements.txt"
fi

if [[ ! -f "$SECRET_FILE" ]]; then
  "$VENV_PY" -c 'import secrets; print(secrets.token_hex(32))' >"$SECRET_FILE"
fi

export SEARXNG_SETTINGS_PATH="$SETTINGS"
export SEARXNG_SECRET
SEARXNG_SECRET="$(cat "$SECRET_FILE")"
export SEARXNG_PORT="$PORT"
export PYTHONPATH="$SRC${PYTHONPATH:+:$PYTHONPATH}"

# Desktop owns this process: exec so the Electron child pid is Python.
if [[ "${LYRA_SEARXNG_FOREGROUND:-}" == "1" ]]; then
  echo $$ >"$PID_FILE"
  exec "$VENV_PY" -m searx.webapp
fi

if command -v setsid >/dev/null 2>&1; then
  setsid "$VENV_PY" -m searx.webapp >>"$LOG_FILE" 2>&1 </dev/null &
else
  "$VENV_PY" -m searx.webapp >>"$LOG_FILE" 2>&1 </dev/null &
fi
echo $! >"$PID_FILE"

for _ in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:${PORT}/search?q=lyra&format=json" >/dev/null; then
    echo "SearXNG ready at http://127.0.0.1:${PORT}/search"
    exit 0
  fi
  sleep 1
done

echo "SearXNG did not become ready. See $LOG_FILE" >&2
exit 1
