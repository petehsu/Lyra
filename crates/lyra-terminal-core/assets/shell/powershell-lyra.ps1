# Lyra shell integration for PowerShell.
# Emits OSC 133 lifecycle markers, OSC 7 cwd updates, and Lyra OSC prompt markers.

if ($env:LYRA_SHELL_INTEGRATION_DISABLED -or $script:__LYRA_POWERSHELL_INTEGRATION) {
  return
}

$script:__LYRA_POWERSHELL_INTEGRATION = $true
$script:__lyra_command_running = $false
$script:__lyra_original_prompt = $null

try {
  $existingPrompt = Get-Command prompt -CommandType Function -ErrorAction SilentlyContinue
  if ($null -ne $existingPrompt) {
    $script:__lyra_original_prompt = $existingPrompt.ScriptBlock
  }
} catch {
  $script:__lyra_original_prompt = $null
}

function global:__lyra_osc {
  param([Parameter(Mandatory = $true)][string]$Payload)
  [Console]::Write("$([char]27)]$Payload$([char]7)")
}

function global:__lyra_url_escape {
  param([AllowNull()][string]$Value)
  if ($null -eq $Value) {
    return ""
  }
  return [System.Uri]::EscapeDataString($Value).Replace("%2F", "/").Replace("%5C", "/")
}

function global:__lyra_file_uri_path {
  param([AllowNull()][string]$Path)
  if ([string]::IsNullOrWhiteSpace($Path)) {
    return "/"
  }
  $normalized = $Path.Replace("\", "/")
  if ($normalized -match "^[A-Za-z]:/") {
    $normalized = "/" + $normalized
  }
  return (__lyra_url_escape $normalized)
}

function global:__lyra_emit_cwd {
  $hostName = $env:COMPUTERNAME
  if ([string]::IsNullOrWhiteSpace($hostName)) {
    $hostName = "localhost"
  }
  $cwd = (Get-Location).Path
  __lyra_osc "7;file://$hostName$(__lyra_file_uri_path $cwd)"
  __lyra_osc "633;Cwd;$(__lyra_url_escape $cwd)"
}

function global:__lyra_emit_command_start {
  param([AllowNull()][string]$CommandLine)
  if ([string]::IsNullOrWhiteSpace($CommandLine)) {
    return
  }
  __lyra_osc "133;B"
  if (-not [string]::IsNullOrWhiteSpace($env:LYRA_NEXT_COMMAND_ID)) {
    __lyra_osc "633;CommandId;$(__lyra_url_escape $env:LYRA_NEXT_COMMAND_ID)"
  }
  __lyra_osc "133;C;command=$(__lyra_url_escape $CommandLine)"
  if (-not [string]::IsNullOrWhiteSpace($env:LYRA_NEXT_COMMAND_ID)) {
    __lyra_osc "633;CommandStart;commandId=$(__lyra_url_escape $env:LYRA_NEXT_COMMAND_ID);command=$(__lyra_url_escape $CommandLine)"
    Remove-Item Env:\LYRA_NEXT_COMMAND_ID -ErrorAction SilentlyContinue
  }
  $script:__lyra_command_running = $true
}

function global:__lyra_command_exit_code {
  if ($? -eq $false) {
    if ($global:LASTEXITCODE -is [int]) {
      return $global:LASTEXITCODE
    }
    return 1
  }
  if ($global:LASTEXITCODE -is [int] -and $global:LASTEXITCODE -ne 0) {
    return $global:LASTEXITCODE
  }
  return 0
}

function global:prompt {
  $exitCode = __lyra_command_exit_code
  if ($script:__lyra_command_running) {
    __lyra_osc "133;D;$exitCode"
    __lyra_osc "633;CommandEnd;exitCode=$exitCode"
    $script:__lyra_command_running = $false
  }
  __lyra_emit_cwd
  __lyra_osc "133;A"
  __lyra_osc "633;LyraPrompt"
  if ($null -ne $script:__lyra_original_prompt) {
    & $script:__lyra_original_prompt
  } else {
    "PS $($executionContext.SessionState.Path.CurrentLocation)> "
  }
}

try {
  if ((Get-Command Set-PSReadLineKeyHandler -ErrorAction SilentlyContinue) -and
      [type]::GetType("Microsoft.PowerShell.PSConsoleReadLine", $false)) {
    Set-PSReadLineKeyHandler -Key Enter -ScriptBlock {
      $line = ""
      $cursor = 0
      [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$line, [ref]$cursor)
      __lyra_emit_command_start $line
      [Microsoft.PowerShell.PSConsoleReadLine]::AcceptLine()
    }
  }
} catch {
  # PSReadLine is optional. Prompt/cwd markers still work without command-start hooks.
}
