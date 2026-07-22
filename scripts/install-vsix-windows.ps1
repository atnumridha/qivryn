param(
    [string]$VsixPath = "",
    [string]$CodeCli = "",
    [switch]$NoForce
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

function Resolve-CodeCli {
    param([string]$RequestedPath)

    if ($RequestedPath) {
        if (-not (Test-Path -LiteralPath $RequestedPath)) {
            throw "VS Code CLI not found: $RequestedPath"
        }
        return (Resolve-Path -LiteralPath $RequestedPath).Path
    }

    foreach ($commandName in @("code.cmd", "code")) {
        $command = Get-Command $commandName -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($command) {
            return $command.Source
        }
    }

    $candidates = @(
        (Join-Path $env:LOCALAPPDATA "Programs/Microsoft VS Code/bin/code.cmd"),
        (Join-Path $env:ProgramFiles "Microsoft VS Code/bin/code.cmd")
    )
    $programFilesX86 = [Environment]::GetEnvironmentVariable("ProgramFiles(x86)")
    if ($programFilesX86) {
        $candidates += Join-Path $programFilesX86 "Microsoft VS Code/bin/code.cmd"
    }
    $candidates += Join-Path $env:LOCALAPPDATA "Programs/Microsoft VS Code Insiders/bin/code-insiders.cmd"

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) {
            return $candidate
        }
    }

    throw "VS Code CLI was not found. Pass -CodeCli C:\path\to\code.cmd."
}

if ([Environment]::OSVersion.Platform -ne "Win32NT") {
    throw "This script is for Windows. Use scripts/install-vsix-macos.sh on macOS."
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$extensionRoot = Join-Path $repoRoot "extensions/vscode"

if (-not $VsixPath) {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw "node is required to infer the default VSIX path. Pass -VsixPath instead."
    }
    Push-Location $extensionRoot
    try {
        $version = (& node -p "require('./package.json').version").Trim()
    }
    finally {
        Pop-Location
    }
    $VsixPath = Join-Path $extensionRoot "build/qivryn-$version.vsix"
}

if (-not (Test-Path -LiteralPath $VsixPath)) {
    throw "VSIX not found: $VsixPath. Run scripts/build-vsix-windows.ps1 first, or pass -VsixPath."
}

$resolvedVsixPath = (Resolve-Path -LiteralPath $VsixPath).Path
$resolvedCodeCli = Resolve-CodeCli -RequestedPath $CodeCli

$installArgs = @("--install-extension", $resolvedVsixPath)
if (-not $NoForce) {
    $installArgs += "--force"
}

Invoke-External -FilePath $resolvedCodeCli -Arguments $installArgs
& $resolvedCodeCli --list-extensions --show-versions | Select-String -Pattern "^qivryn\.qivryn@" | ForEach-Object { $_.Line }

Write-Host "Installed VSIX: $resolvedVsixPath"
