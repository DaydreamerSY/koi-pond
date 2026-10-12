<#
  Packs what the Mac needs into dist\KoiPaper-mac.zip: the macOS app sources
  (mac\), the pond (web\ sources plus the prebuilt web\dist), and the README.
  Copy the zip to the Mac, unzip it, and run:  bash mac/build.sh
#>
$root = $PSScriptRoot
if (-not (Test-Path (Join-Path $root "web\dist\index.html"))) {
    throw "web\dist is missing: run .\build.ps1 first."
}
$out = Join-Path $root "dist\KoiPaper-mac.zip"
New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null
if (Test-Path $out) { Remove-Item $out }

Push-Location $root
try {
    # bsdtar writes a zip with forward-slash paths that macOS unzips cleanly.
    tar.exe -a -c -f $out --exclude "web/node_modules" --exclude "web/.git" README.md mac web
    if ($LASTEXITCODE) { throw "tar failed" }
}
finally { Pop-Location }
"Packed: $out ({0:N1} MB)" -f ((Get-Item $out).Length / 1MB)
