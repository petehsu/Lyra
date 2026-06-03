# Lyra shell integration for bash.
# Emits OSC 133 lifecycle markers, OSC 7 cwd updates, and Lyra OSC prompt markers.

if [[ -n "${LYRA_SHELL_INTEGRATION_DISABLED:-}" || -n "${__LYRA_BASH_INTEGRATION:-}" ]]; then
  return 0 2>/dev/null || exit 0
fi

__LYRA_BASH_INTEGRATION=1
__lyra_bash_command_running=0
__lyra_bash_in_prompt=0

__lyra_osc() {
  printf '\033]%s\007' "$1"
}

__lyra_url_escape() {
  local value="$1"
  value="${value//%/%25}"
  value="${value// /%20}"
  value="${value//#/%23}"
  value="${value//\?/%3F}"
  printf '%s' "$value"
}

__lyra_emit_cwd() {
  local host="${HOSTNAME:-localhost}"
  __lyra_osc "7;file://${host}$(__lyra_url_escape "$PWD")"
  __lyra_osc "633;Cwd;$(__lyra_url_escape "$PWD")"
}

__lyra_preexec() {
  if [[ "${__lyra_bash_in_prompt}" == "1" ]]; then
    return
  fi
  case "${BASH_COMMAND:-}" in
    __lyra_* | trap\ * | PROMPT_COMMAND=* )
      return
      ;;
  esac
  if [[ "${__lyra_bash_command_running}" == "0" ]]; then
    __lyra_osc '133;B'
    if [[ -n "${LYRA_NEXT_COMMAND_ID:-}" ]]; then
      __lyra_osc "633;CommandId;$(__lyra_url_escape "$LYRA_NEXT_COMMAND_ID")"
    fi
    __lyra_osc "133;C;command=$(__lyra_url_escape "${BASH_COMMAND:-}")"
    if [[ -n "${LYRA_NEXT_COMMAND_ID:-}" ]]; then
      __lyra_osc "633;CommandStart;commandId=$(__lyra_url_escape "$LYRA_NEXT_COMMAND_ID");command=$(__lyra_url_escape "${BASH_COMMAND:-}")"
      unset LYRA_NEXT_COMMAND_ID
    fi
    __lyra_bash_command_running=1
  fi
}

__lyra_prompt_command() {
  local status="$?"
  __lyra_bash_in_prompt=1
  if [[ "${__lyra_bash_command_running}" == "1" ]]; then
    __lyra_osc "133;D;${status}"
    __lyra_osc "633;CommandEnd;exitCode=${status}"
    __lyra_bash_command_running=0
  fi
  __lyra_emit_cwd
  __lyra_osc '133;A'
  __lyra_osc '633;LyraPrompt'
  __lyra_bash_in_prompt=0
  return "$status"
}

trap '__lyra_preexec' DEBUG

if [[ -n "${PROMPT_COMMAND:-}" ]]; then
  PROMPT_COMMAND="__lyra_prompt_command;${PROMPT_COMMAND}"
else
  PROMPT_COMMAND="__lyra_prompt_command"
fi
