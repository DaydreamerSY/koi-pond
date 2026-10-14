#!/bin/bash
# Koi Paper: play a pond clip (Settings › Loop clip › Record loop clip) on the
# macOS lock screen.
#
# The lock screen plays Apple's "Aerial" wallpaper videos. This swaps the video
# of one Aerial for the pond clip, so choosing that Aerial in System Settings ›
# Wallpaper puts the pond on the lock screen (and the screen saver, if "Show as
# screen saver" is on). It's an unsupported trick: it needs an administrator
# password, and a macOS update may put Apple's video back (run it again then).
#
#   bash mac/lockscreen-clip.sh list                       # Aerial videos on this Mac, newest first
#   bash mac/lockscreen-clip.sh install CLIP.mp4 [VIDEO]   # VIDEO: a name from `list` (default: the newest)
#   bash mac/lockscreen-clip.sh restore                    # put Apple's videos back
#
# First, in System Settings › Wallpaper, pick an Aerial (Landscape, Cityscape,
# …) and let it download: that one's video gets replaced, and is the newest.
set -euo pipefail

AERIALS="/Library/Application Support/com.apple.idleassetsd/Customer/4KSDR240FPS"
ORIGINAL=".koipaper-original"

aerials_newest_first() {
  # Apple's own videos only, not our backups.
  ls -t "$AERIALS"/*.mov 2>/dev/null || true
}

need_aerials() {
  if [ -z "$(aerials_newest_first)" ]; then
    echo "No Aerial videos found in: $AERIALS" >&2
    echo "Pick an Aerial in System Settings › Wallpaper, wait for it to download, then try again." >&2
    exit 1
  fi
}

refresh() {
  # The wallpaper agent re-reads the video; locking the screen shows it.
  killall WallpaperAgent 2>/dev/null || true
}

case "${1:-}" in
  list)
    need_aerials
    while IFS= read -r video; do
      note=""
      [ -e "$video$ORIGINAL" ] && note="   (pond clip; Apple's video saved)"
      echo "$(basename "$video")   $(stat -f '%Sm' -t '%Y-%m-%d %H:%M' "$video")   $(du -h "$video" | cut -f1)$note"
    done < <(aerials_newest_first)
    ;;

  install)
    clip="${2:-}"
    if [ -z "$clip" ] || [ ! -f "$clip" ]; then
      echo "Usage: bash mac/lockscreen-clip.sh install CLIP.mp4 [VIDEO]" >&2
      exit 1
    fi
    need_aerials
    if [ -n "${3:-}" ]; then
      target="$AERIALS/$(basename "$3")"
      [ -f "$target" ] || { echo "No such Aerial video: $target" >&2; exit 1; }
    else
      target="$(aerials_newest_first | head -n 1)"
    fi
    echo "Replacing: $(basename "$target")"

    # Apple's Aerials are HEVC QuickTime movies; convert the clip the same way
    # (avconvert ships with macOS), at its own size.
    work="$(mktemp -d)"
    trap 'rm -rf "$work"' EXIT
    echo "Converting the clip to HEVC…"
    avconvert --preset PresetHEVCHighestQuality --source "$clip" --output "$work/pond.mov" --replace >/dev/null

    echo "Copying it into place (your administrator password is asked for)…"
    # Keep Apple's video once, the first time only.
    [ -e "$target$ORIGINAL" ] || sudo cp -p "$target" "$target$ORIGINAL"
    # Writing over the existing file keeps its owner and permissions.
    sudo cp "$work/pond.mov" "$target"
    refresh
    echo "Done. Choose that Aerial in System Settings › Wallpaper if it isn't already, then lock the screen (Control-Command-Q)."
    ;;

  restore)
    restored=0
    for saved in "$AERIALS"/*.mov"$ORIGINAL"; do
      [ -e "$saved" ] || continue
      sudo mv "$saved" "${saved%$ORIGINAL}"
      echo "Restored: $(basename "${saved%$ORIGINAL}")"
      restored=1
    done
    [ "$restored" = 1 ] && refresh || echo "Nothing to restore."
    ;;

  *)
    sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
