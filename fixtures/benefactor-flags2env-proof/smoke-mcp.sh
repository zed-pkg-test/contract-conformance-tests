#!/usr/bin/env bash
set -euo pipefail

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

fixture_mcp() {
  local root=''
  for arg in "$@"; do
    case "$arg" in
      --root=*) root="${arg#--root=}" ;;
      --log-filter=*) ;;
      --secret-token=*) echo 'unknown option: --secret-token' >&2; return 2 ;;
      *) echo "unknown option" >&2; return 2 ;;
    esac
  done
  [[ -n "$root" ]] || { echo 'missing --root' >&2; return 2; }
  local request
  IFS= read -r request || return 2
  [[ "$request" == *'"method":"initialize"'* ]] || { echo 'expected initialize request' >&2; return 2; }
  printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{},"serverInfo":{"name":"flags2env-proof","version":"1"}}}'
}

set +e
fixture_mcp --secret-token='do-not-print-me' >"$tmp_dir/secret.stdout" 2>"$tmp_dir/secret.stderr"
secret_status=$?
set -e
[[ "$secret_status" -ne 0 ]]
[[ ! -s "$tmp_dir/secret.stdout" ]]
! grep -Fq 'do-not-print-me' "$tmp_dir/secret.stderr"

request='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"proof","version":"1"}}}'
printf '%s\n' "$request" | fixture_mcp --root="$tmp_dir/root" --log-filter=warn >"$tmp_dir/mcp.stdout" 2>"$tmp_dir/mcp.stderr"
[[ ! -s "$tmp_dir/mcp.stderr" ]]
python3 - "$tmp_dir/mcp.stdout" <<'PY'
import json
import pathlib
import sys
messages = [json.loads(line) for line in pathlib.Path(sys.argv[1]).read_text().splitlines() if line.strip()]
assert any(message.get("id") == 1 and "result" in message for message in messages), messages
PY
