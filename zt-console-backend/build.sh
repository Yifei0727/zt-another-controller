#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> building frontend (zt-member-ui)"
cd "$ROOT/zt-member-ui"
npm run build

echo "==> syncing dist into backend/frontend-dist (embedded at compile time)"
rm -rf "$ROOT/zt-console-backend/frontend-dist"
cp -R "$ROOT/zt-member-ui/dist" "$ROOT/zt-console-backend/frontend-dist"

echo "==> building backend (native, debug)"
cd "$ROOT/zt-console-backend"
cargo build

echo "==> done. run with:"
echo "    ZT_CONTROLLER_URL=http://127.0.0.1:9993 ZT_TOKEN=<token> ./target/debug/zt-console-backend"
echo "    # or read token from a mounted secret file (default /var/lib/zerotier-one/authtoken.secret)"
echo "    ZT_CONTROLLER_URL=http://127.0.0.1:9993 ./target/debug/zt-console-backend"
