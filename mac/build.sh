#!/bin/bash
# Builds "Koi Paper.app" for this Mac, for personal, local use (ad-hoc signed,
# never notarized or distributed).
#
#   bash mac/build.sh               build the pond (web/) and the app
#   SKIP_WEB=1 bash mac/build.sh    reuse the web/dist that's already there
#
# Needs the Xcode Command Line Tools (xcode-select --install) for swiftc. When
# the Mac has no Node.js, a copy is downloaded from nodejs.org into .cache/
# (checksum-verified, nothing installed system-wide).
set -euo pipefail

MAC_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$MAC_DIR/.." && pwd)"
WEB_DIST="$ROOT/web/dist"
APP="$ROOT/dist-mac/Koi Paper.app"
NODE_VERSION="v24.21.0"

use_node() {
  command -v npm >/dev/null 2>&1 && return
  local arch name cache
  arch="$(uname -m)"
  [ "$arch" = "x86_64" ] && arch="x64"
  name="node-$NODE_VERSION-darwin-$arch"
  cache="$ROOT/.cache"
  if [ ! -x "$cache/$name/bin/npm" ]; then
    echo "==> No Node.js on this Mac: fetching $name from nodejs.org into .cache/"
    mkdir -p "$cache"
    curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/$name.tar.gz" -o "$cache/$name.tar.gz"
    curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" -o "$cache/SHASUMS256.txt"
    (cd "$cache" && grep " $name.tar.gz\$" SHASUMS256.txt | shasum -a 256 -c -)
    tar -xzf "$cache/$name.tar.gz" -C "$cache"
  fi
  export PATH="$cache/$name/bin:$PATH"
}

if [ "${SKIP_WEB:-0}" != "1" ]; then
  use_node
  echo "==> Building the pond (web/)"
  (cd "$ROOT/web" && npm ci --no-fund --no-audit && npm run build)
fi
if [ ! -f "$WEB_DIST/index.html" ]; then
  echo "web/dist is missing: run without SKIP_WEB=1 to build it." >&2
  exit 1
fi
if ! xcrun --find swiftc >/dev/null 2>&1; then
  echo "swiftc not found. Install the Xcode Command Line Tools: xcode-select --install" >&2
  exit 1
fi

echo "==> Compiling the app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
xcrun swiftc -O -swift-version 5 -parse-as-library \
  -sdk "$(xcrun --show-sdk-path --sdk macosx)" \
  -target "$(uname -m)-apple-macos13.0" \
  -framework AppKit -framework WebKit -framework ServiceManagement \
  "$MAC_DIR"/Sources/*.swift \
  -o "$APP/Contents/MacOS/KoiPaper"

echo "==> Assembling Koi Paper.app"
cp "$MAC_DIR/Info.plist" "$APP/Contents/Info.plist"
cp -R "$WEB_DIST" "$APP/Contents/Resources/wwwroot"
cp "$ROOT/web/LICENSE" "$APP/Contents/Resources/LICENSE-nagomi.txt"

ICONSET="$(mktemp -d)/AppIcon.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$MAC_DIR/AppIcon.png" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  sips -z $((size * 2)) $((size * 2)) "$MAC_DIR/AppIcon.png" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

# Ad-hoc signature: enough for an app built and run on this Mac.
codesign --force --deep --sign - "$APP"

echo "==> Built: $APP"
echo "    Open it with:  open \"$APP\""
