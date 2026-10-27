#!/bin/sh
# Fetches Freedoom 0.13.0 (BSD) and keeps freedoom1.wad.
set -e
cd "$(dirname "$0")"
tmp=$(mktemp -d)
curl -sSL -o "$tmp/fd.zip" https://github.com/freedoom/freedoom/releases/download/v0.13.0/freedoom-0.13.0.zip
unzip -q "$tmp/fd.zip" -d "$tmp"
mkdir -p wad
cp "$tmp/freedoom-0.13.0/freedoom1.wad" wad/
cp "$tmp/freedoom-0.13.0/COPYING.txt" wad/FREEDOOM-COPYING.txt
rm -rf "$tmp"
