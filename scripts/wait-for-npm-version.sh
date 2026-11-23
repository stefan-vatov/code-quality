#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "usage: wait-for-npm-version.sh <package> <version> [timeout-seconds] [interval-seconds]" >&2
  exit 2
fi

package="$1"
version="$2"
timeout_seconds="${3:-1200}"
interval_seconds="${4:-15}"
deadline=$((SECONDS + timeout_seconds))

while true; do
  if served="$(npm view "$package@$version" version 2>/dev/null)" && [ "$served" = "$version" ]; then
    echo "$package@$version is available on npm."
    exit 0
  fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "$package@$version was not available on npm after ${timeout_seconds}s." >&2
    exit 1
  fi
  echo "Waiting for npm to serve $package@$version..."
  sleep "$interval_seconds"
done
