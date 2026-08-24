#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="${HOME}/.cargo/bin:/usr/local/cargo/bin:${PATH}"

cd "$ROOT"
pnpm install
pnpm --dir ui dev
