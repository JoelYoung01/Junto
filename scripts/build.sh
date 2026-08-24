#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="${HOME}/.cargo/bin:/usr/local/cargo/bin:${PATH}"

echo "Installing UI dependencies (pnpm)..."
cd "$ROOT"
pnpm install

echo "Building UI..."
pnpm --dir ui build

echo "Building desktop app..."
cargo build -p junto-desktop --release

echo "Done. Binary: target/release/junto-desktop"
