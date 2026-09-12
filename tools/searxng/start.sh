#!/usr/bin/env bash
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
DATA="${LYRA_SEARXNG_HOME:-$HOME/.lyra/searxng}"
PORT="${LYRA_SEARXNG_PORT:-8888}"
SRC="${LYRA_SEARXNG_SRC:-}"
MISE="${HOME}/.local/bin/mise"
PID_FILE="$DATA/searxng.pid"
LOG_FILE="$DATA/searxng.log"
SECRET_FILE="$DATA/secret"
SETTINGS="$REPO/tools/searxng/settings.yml"

mkdir -p "$DATA/cache"
# SearXNG engine tokens live in SQLite under tempfile.gettempdir().
# Keep that off /tmp: a full tmpfs makes Google CSE crash and the whole
# general category return empty.
export TMPDIR="$DATA/cache"
export TMP="$DATA/cache"
export TEMP="$DATA/cache"

if [[ -z "$SRC" ]]; then
  if [[ -d "$REPO/參考/searxng/searx" ]]; then
    SRC="$REPO/參考/searxng"
  else
    SRC="$DATA/src"
    if [[ ! -d "$SRC/searx" ]]; then
      git clone --depth 1 https://github.com/searxng/searxng.git "$SRC"
    fi
  fi
fi

if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "SearXNG already running (pid $(cat "$PID_FILE")) on 127.0.0.1:$PORT"
  exit 0
fi
rm -f "$PID_FILE"

if [[ -x "$MISE" ]]; then
  PY="$("$MISE" exec python@3.12 -- python -c 'import sys; print(sys.executable)')"
else
  PY="${LYRA_SEARXNG_PYTHON:-python3}"
fi

if [[ ! -x "$DATA/.venv/bin/python" ]]; then
  "$PY" -m venv "$DATA/.venv"
fi

if ! "$DATA/.venv/bin/python" -c "import flask, msgspec, lxml, yaml" 2>/dev/null; then
  "$DATA/.venv/bin/pip" install -q -U pip wheel
  "$DATA/.venv/bin/pip" install -q -r "$SRC/requirements.txt"
fi

if [[ ! -f "$SECRET_FILE" ]]; then
  "$DATA/.venv/bin/python" -c 'import secrets; print(secrets.token_hex(32))' >"$SECRET_FILE"
fi

export SEARXNG_SETTINGS_PATH="$SETTINGS"
export SEARXNG_SECRET
SEARXNG_SECRET="$(cat "$SECRET_FILE")"
export SEARXNG_PORT="$PORT"
export PYTHONPATH="$SRC${PYTHONPATH:+:$PYTHONPATH}"

setsid "$DATA/.venv/bin/python" -m searx.webapp >>"$LOG_FILE" 2>&1 </dev/null &
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
