# Lyra shell integration for zsh.
# Emits OSC 133 lifecycle markers, OSC 7 cwd updates, and Lyra OSC prompt markers.

if [[ -n "${LYRA_SHELL_INTEGRATION_DISABLED:-}" || -n "${__LYRA_ZSH_INTEGRATION:-}" ]]; then
  return 0 2>/dev/null || exit 0
fi

__LYRA_ZSH_INTEGRATION=1
__lyra_zsh_command_running=0

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
  local host="${HOST:-localhost}"
  __lyra_osc "7;file://${host}$(__lyra_url_escape "$PWD")"
  __lyra_osc "633;Cwd;$(__lyra_url_escape "$PWD")"
}

__lyra_emit_command_id() {
  if [[ -n "${LYRA_NEXT_COMMAND_ID:-}" ]]; then
    __lyra_osc "633;CommandId;$(__lyra_url_escape "$LYRA_NEXT_COMMAND_ID")"
  fi
}

__lyra_preexec() {
  local command="$1"
  __lyra_osc '133;B'
  __lyra_emit_command_id
  __lyra_osc "133;C;command=$(__lyra_url_escape "$command")"
  if [[ -n "${LYRA_NEXT_COMMAND_ID:-}" ]]; then
    __lyra_osc "633;CommandStart;commandId=$(__lyra_url_escape "$LYRA_NEXT_COMMAND_ID");command=$(__lyra_url_escape "$command")"
    unset LYRA_NEXT_COMMAND_ID
  fi
  __lyra_zsh_command_running=1
}

__lyra_precmd() {
  local exit_code="$?"
  if [[ "${__lyra_zsh_command_running}" == "1" ]]; then
    __lyra_osc "133;D;${exit_code}"
    __lyra_osc "633;CommandEnd;exitCode=${exit_code}"
    __lyra_zsh_command_running=0
  fi
  __lyra_emit_cwd
  __lyra_osc '133;A'
  __lyra_osc '633;LyraPrompt'
  return "$exit_code"
}

autoload -Uz add-zsh-hook
add-zsh-hook preexec __lyra_preexec
add-zsh-hook precmd __lyra_precmd
