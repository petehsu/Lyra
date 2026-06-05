param(
  [string]$HelperPath = "target\release\lyra-performance-helper.exe",
  [string]$InstallDir = "$env:ProgramFiles\Lyra",
  [string]$ListenAddress = "127.0.0.1:37691"
)

$ErrorActionPreference = "Stop"
$serviceName = "LyraPerformanceHelper"
$installPath = Join-Path $InstallDir "lyra-performance-helper.exe"

if (-not (Test-Path $HelperPath)) {
  throw "helper binary not found: $HelperPath. Build it with: cargo build --release -p lyra-performance-core --bin lyra-performance-helper"
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item -Force $HelperPath $installPath

$existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($existing) {
  Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
  sc.exe delete $serviceName | Out-Null
}

$binaryPath = "`"$installPath`" --serve-tcp $ListenAddress"
New-Service `
  -Name $serviceName `
  -BinaryPathName $binaryPath `
  -DisplayName "Lyra Performance Scheduling Helper" `
  -Description "Privileged Lyra helper for RSS/CPU sampling and OS-level resource scheduling." `
  -StartupType Automatic | Out-Null

[Environment]::SetEnvironmentVariable("LYRA_PERFORMANCE_HELPER_TCP", $ListenAddress, "Machine")
Start-Service -Name $serviceName

Write-Host "installed $serviceName"
Write-Host "tcp: $ListenAddress"
