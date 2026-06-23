#!/usr/bin/env bash
# scripts/prepare-universal-ffmpeg.sh
# Downloads arm64 + x64 ffmpeg binaries from ffmpeg-static release b6.1.1
# and lipo-merges them into a fat Universal binary for electron-builder.
# Must run BEFORE electron-builder --mac --arch universal.
# Safe to run on any macOS machine (Apple Silicon or Intel).

set -euo pipefail

if [[ "$(uname)" != "Darwin" ]]; then
  echo "prepare-universal-ffmpeg: not on macOS, skipping"
  exit 0
fi

RELEASE_TAG="b6.1.1"
BASE_URL="https://github.com/eugeneware/ffmpeg-static/releases/download/${RELEASE_TAG}"
TARGET_DIR="node_modules/ffmpeg-static"
FFMPEG_FINAL="${TARGET_DIR}/ffmpeg"
FFMPEG_X64="${TARGET_DIR}/ffmpeg-x64-dl"
FFMPEG_ARM64="${TARGET_DIR}/ffmpeg-arm64-dl"

echo "Preparing universal (fat) ffmpeg binary for macOS Universal build..."

# Check if already fat (idempotent)
if lipo -info "${FFMPEG_FINAL}" 2>/dev/null | grep -q "arm64 x86_64"; then
  echo "ffmpeg is already a fat binary, skipping"
  exit 0
fi

# Always download both architectures from release (Pitfall 5: don't rely on current machine binary)
echo "Downloading ffmpeg-darwin-arm64..."
curl -fL "${BASE_URL}/ffmpeg-darwin-arm64.gz" | gunzip > "${FFMPEG_ARM64}"
chmod +x "${FFMPEG_ARM64}"

echo "Downloading ffmpeg-darwin-x64..."
curl -fL "${BASE_URL}/ffmpeg-darwin-x64.gz" | gunzip > "${FFMPEG_X64}"
chmod +x "${FFMPEG_X64}"

# Merge with lipo
echo "Merging arm64 + x64 into fat binary..."
lipo -create "${FFMPEG_ARM64}" "${FFMPEG_X64}" -output "${FFMPEG_FINAL}"
chmod +x "${FFMPEG_FINAL}"

# Cleanup intermediates
rm -f "${FFMPEG_X64}" "${FFMPEG_ARM64}"

echo "Done: $(lipo -info ${FFMPEG_FINAL})"
# Expected: Architectures in the fat file: node_modules/ffmpeg-static/ffmpeg are: arm64 x86_64
