<#
  Builds Koi Paper into .\dist\KoiPaper
    1. the pond (web\, Vite + React)  - needs Node.js 20+; -SkipWeb reuses the existing web\dist
    2. the Windows shell (app\, .NET 9 + WebView2)

  .\build.ps1                  # framework-dependent (needs the .NET 9 Desktop Runtime)
  .\build.ps1 -SelfContained   # bundles .NET too, for PCs without it
#>
param([switch]$SkipWeb, [switch]$SelfContained)
# Native tools report failure through $LASTEXITCODE (checked below); their stderr
# warnings (npm's in particular) must not abort the build.
$root = $PSScriptRoot
$out = Join-Path $root "dist\KoiPaper"

if (-not $SkipWeb) {
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        throw "Node.js is required to build web\ (https://nodejs.org). Or run with -SkipWeb to reuse web\dist."
    }
    Push-Location (Join-Path $root "web")
    try {
        npm install --no-fund --no-audit
        if ($LASTEXITCODE) { throw "npm install failed" }
        npm run build
        if ($LASTEXITCODE) { throw "npm run build failed" }
    }
    finally { Pop-Location }
}

# The published exe can't be overwritten while it runs.
$running = Get-Process KoiPaper -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($out) }
if ($running) {
    "Stopping the running Koi Paper from $out"
    $running | Stop-Process
    Start-Sleep -Seconds 1
}

$selfContainedArg = if ($SelfContained) { "true" } else { "false" }
dotnet publish (Join-Path $root "app\KoiPaper.csproj") -c Release -r win-x64 --self-contained $selfContainedArg -o $out
if ($LASTEXITCODE) { throw "dotnet publish failed" }
"Built: $out\KoiPaper.exe"
