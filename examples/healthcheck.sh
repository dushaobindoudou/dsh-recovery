#!/usr/bin/env bash
# A dsh health check for cron / launchd / CI.
#
# dsh-recovery exits 1 when any profile is unhealthy, so the exit code is
# the whole contract. Run it before you start work; if it fails, run
# `dsh-recovery fix` (every fix is reversible via `restore`).
#
# Cron example (weekdays at 09:00):
#   0 9 * * 1-5  $HOME/.local/bin/healthcheck.sh >> $HOME/.dsh-doctor.log 2>&1

set -u

command -v dsh-recovery >/dev/null 2>&1 || {
  echo "$(date -Is) dsh-recovery not on PATH" >&2
  exit 2
}

echo "$(date -Is) checking..."
if dsh-recovery status; then
  echo "$(date -Is) healthy"
  exit 0
fi

echo "$(date -Is) UNHEALTHY - run 'dsh-recovery fix' to repair, 'restore' to undo" >&2
exit 1
