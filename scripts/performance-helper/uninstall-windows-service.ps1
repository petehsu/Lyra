param(
  [string]$InstallDir = "$env:ProgramFiles\Lyra"
)

$ErrorActionPreference = "Stop"
$serviceName = "LyraPerformanceHelper"
$installPath = Join-Path $InstallDir "lyra-performance-helper.exe"

$existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($existing) {
  Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
  sc.exe delete $serviceName | Out-Null
}

[Environment]::SetEnvironmentVariable("LYRA_PERFORMANCE_HELPER_TCP", $null, "Machine")
Remove-Item -Force -ErrorAction SilentlyContinue $installPath

Write-Host "uninstalled $serviceName"
