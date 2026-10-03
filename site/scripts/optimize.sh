#!/bin/sh
# Crops raw editor captures to the room and writes WebP files for the site.
# Requires ffmpeg and cwebp. Usage: sh site/scripts/optimize.sh
set -e
cd "$(dirname "$0")/.."
mkdir -p img
tmp="$(mktemp -t roomshift).png"
for f in captures/*.png; do
  name="$(basename "$f" .png)"
  case "$name" in
    *app) cwebp -quiet -q 82 -resize 2400 0 "$f" -o "img/$name.webp"; continue ;;
    *top*) crop="crop=1900:1490:280:200" ;;
    *) crop="crop=1920:1460:300:400" ;;
  esac
  ffmpeg -loglevel error -y -i "$f" -vf "$crop" "$tmp"
  cwebp -quiet -q 80 "$tmp" -o "img/$name.webp"
done
rm -f "$tmp"
