#!/bin/bash
# Record QuotePal happy-path demo under heavy-job lock.
# Usage: flock /workspace/.heavy_job.lock bash scripts/record_demo.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PORT="${PORT:-8790}"
OUT_MP4="$ROOT/demo/quotepal_demo.mp4"
FRAMES="$ROOT/demo/build/frames"
BUILD="$ROOT/demo/build"

echo "START $(date) ROOT=$ROOT"
pkill -f "PORT=$PORT.*server/index.js" 2>/dev/null || true
fuser -k "${PORT}/tcp" 2>/dev/null || true
sleep 1

rm -rf "$BUILD"
mkdir -p "$FRAMES" "$ROOT/demo"

PORT="$PORT" PAYPAL_ENV=mock AI_API_KEY= node server/index.js > /tmp/quotepal_server.log 2>&1 &
SRV=$!
cleanup() { kill "$SRV" 2>/dev/null || true; }
trap cleanup EXIT

for i in $(seq 1 100); do
  if curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null; then break; fi
  sleep 0.3
done
curl -sf "http://127.0.0.1:$PORT/api/health" | head -c 200
echo
curl -sf "http://127.0.0.1:$PORT/" -o /dev/null
sleep 1

node demo/record.mjs "http://127.0.0.1:$PORT" "$FRAMES"

# Stitch variable-time JPEG frames into mp4 using timeline.json
python3 - <<'PY'
import json, subprocess, os
from pathlib import Path
root = Path("/workspace/bounty/drafts/quotepal")
tl = json.loads((root / "demo/build/timeline.json").read_text())
frames = tl["frames"]
if len(frames) < 5:
    raise SystemExit(f"too few frames: {len(frames)}")
# Build concat demuxer with durations between frames
lines = []
for i, f in enumerate(frames):
    path = root / "demo/build/frames" / f["file"]
    if i + 1 < len(frames):
        dur = max(0.04, frames[i + 1]["t"] - f["t"])
    else:
        dur = 0.5
    lines.append(f"file '{path}'")
    lines.append(f"duration {dur:.4f}")
lines.append(f"file '{root / 'demo/build/frames' / frames[-1]['file']}'")
lst = root / "demo/build/concat.txt"
lst.write_text("\n".join(lines) + "\n")
out = root / "demo/quotepal_demo.mp4"
# Scale to even 720-wide mobile portrait, H.264
cmd = [
    "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lst),
    "-vf", "scale=720:-2:flags=lanczos,format=yuv420p",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-movflags", "+faststart", "-r", "30",
    str(out),
]
print("ffmpeg", " ".join(cmd[-6:]))
subprocess.check_call(cmd)
print("OUT", out, "bytes", out.stat().st_size)
# duration
subprocess.check_call(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(out)])
PY

DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT_MP4")
echo "DONE duration=${DUR}s file=$OUT_MP4"
# Fail if over 3 minutes
python3 -c "import sys; d=float('$DUR'); sys.exit(0 if d < 180 else 1)"
