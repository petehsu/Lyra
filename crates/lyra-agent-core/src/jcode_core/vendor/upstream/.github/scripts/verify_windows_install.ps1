param(
    [Parameter(Mandatory = $true)][string]$ArtifactExePath,
    [Parameter(Mandatory = $true)][string]$Version
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$resolvedArtifact = (Resolve-Path -LiteralPath $ArtifactExePath).Path
$tempRoot = Join-Path $env:RUNNER_TEMP ("jcode-windows-install-verify-" + [guid]::NewGuid().ToString('N'))
$localAppData = Join-Path $tempRoot 'localappdata'
$appData = Join-Path $tempRoot 'appdata'
$userProfile = Join-Path $tempRoot 'userprofile'
$jcodeHome = Join-Path $tempRoot '.jcode'
$installDir = Join-Path $localAppData 'jcode\bin'

New-Item -ItemType Directory -Force -Path $localAppData, $appData, $userProfile, $jcodeHome | Out-Null

$env:LOCALAPPDATA = $localAppData
$env:APPDATA = $appData
$env:USERPROFILE = $userProfile
$env:JCODE_HOME = $jcodeHome

$installScript = Join-Path $repoRoot 'scripts\install.ps1'

& $installScript `
    -InstallDir $installDir `
    -Version $Version `
    -ArtifactExePath $resolvedArtifact `
    -SkipAlacrittySetup `
    -SkipHotkeySetup

$launcherPath = Join-Path $installDir 'jcode.exe'
$versionDir = Join-Path $localAppData ('jcode\builds\versions\' + $Version.TrimStart('v') + '\jcode.exe')
$stablePath = Join-Path $localAppData 'jcode\builds\stable\jcode.exe'

foreach ($path in @($launcherPath, $versionDir, $stablePath)) {
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Expected installed file missing: $path"
    }
}

$versionOutput = & $launcherPath --version
if ($LASTEXITCODE -ne 0) {
    throw "Installed launcher failed to run --version"
}

if ($versionOutput -notmatch 'jcode') {
    throw "Installed launcher returned unexpected version output: $versionOutput"
}

& $installScript `
    -InstallDir $installDir `
    -Version $Version `
    -ArtifactExePath $resolvedArtifact `
    -SkipAlacrittySetup `
    -SkipHotkeySetup

if (-not (Test-Path -LiteralPath $launcherPath)) {
    throw "Launcher missing after reinstall: $launcherPath"
}

Write-Host "Windows install verification passed for $Version" -ForegroundColor Green
