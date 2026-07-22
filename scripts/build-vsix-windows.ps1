param(
    [string]$Target = "",
    [switch]$PreRelease,
    [switch]$SkipInstalls,
    [switch]$SkipGuiBuild
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Invoke-External {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FilePath $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
    }
}

function Resolve-Target {
    param([string]$RequestedTarget)

    if ($RequestedTarget) {
        return $RequestedTarget
    }

    switch ($env:PROCESSOR_ARCHITECTURE) {
        "ARM64" { return "win32-arm64" }
        default { return "win32-x64" }
    }
}

if ([Environment]::OSVersion.Platform -ne "Win32NT") {
    throw "This script is for Windows. Use scripts/build-vsix-macos.sh on macOS."
}

$Target = Resolve-Target -RequestedTarget $Target
$validTargets = @("win32-x64", "win32-arm64")
if ($validTargets -notcontains $Target) {
    throw "Unsupported Windows VSIX target: $Target"
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "node is required but was not found on PATH."
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm is required but was not found on PATH."
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

if (-not $SkipGuiBuild) {
    Invoke-External -FilePath "npm" -Arguments @("--prefix", (Join-Path $repoRoot "gui"), "run", "build")
}

$extensionRoot = Join-Path $repoRoot "extensions/vscode"
Push-Location $extensionRoot
try {
    $oldSkipInstalls = $env:SKIP_INSTALLS
    if ($SkipInstalls) {
        $env:SKIP_INSTALLS = "true"
    }

    Invoke-External -FilePath "node" -Arguments @("scripts/prepackage.js", "--target", $Target)

    $packageArgs = @("scripts/package.js", "--target", $Target)
    if ($PreRelease) {
        $packageArgs += "--pre-release"
    }
    Invoke-External -FilePath "node" -Arguments $packageArgs

    $version = (& node -p "require('./package.json').version").Trim()
    $vsixPath = Join-Path $extensionRoot "build/qivryn-$version.vsix"
}
finally {
    if ($null -eq $oldSkipInstalls) {
        Remove-Item Env:\SKIP_INSTALLS -ErrorAction SilentlyContinue
    }
    else {
        $env:SKIP_INSTALLS = $oldSkipInstalls
    }
    Pop-Location
}

Write-Host "VSIX created: $vsixPath"
