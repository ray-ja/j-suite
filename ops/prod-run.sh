#!/usr/bin/env bash
# ---------- PROD OPS WRAPPER (dev→prod SSH bridge) ----------
# Invoked ONLY via the forced-command SSH key: authorized_keys has
#   command="/home/rzy/j-suite/ops/prod-run.sh",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding <pubkey>
# The client's requested op arrives in $SSH_ORIGINAL_COMMAND. ALLOWLIST ONLY — never arbitrary shell.
# Every op echoes its plan + appends to the log. Lives in the repo so deploy.sh keeps it current.
set -uo pipefail

REPO_DIR="$HOME/j-suite"
DEPLOY="$HOME/deploy.sh"
LOG="$HOME/j-suite-ops.log"
# RESTART_CMD: privileged restart for the standalone `restart` op. CONFIRM with Ray; must match the
# NOPASSWD sudoers rule. (deploy.sh does its OWN restart, so `deploy` doesn't use this.)
RESTART_CMD="sudo systemctl restart jsuite"
SERVER_LOG="$HOME/j-suite-server.log"

req="${SSH_ORIGINAL_COMMAND:-$*}"
# shellcheck disable=SC2086
set -- $req
cmd="${1:-}"; arg="${2:-}"
log(){ printf '%s [%s %s] %s\n' "$(date -Is)" "$cmd" "$arg" "$*" >> "$LOG"; }

case "$cmd" in
  deploy)
    [ -n "$arg" ] || { echo "usage: deploy <commit>"; exit 2; }
    echo "PLAN: verify origin/main == $arg, then run $DEPLOY"; log "requested deploy $arg"
    git -C "$REPO_DIR" fetch origin -q || { echo "ERROR: git fetch failed"; log "fetch failed"; exit 1; }
    actual="$(git -C "$REPO_DIR" rev-parse --short origin/main)"
    if [ "$actual" != "$arg" ]; then echo "REFUSE: origin/main is $actual, not requested $arg"; log "refused $actual != $arg"; exit 1; fi
    echo "deploying $arg…"; log "deploying $arg"
    bash "$DEPLOY"; rc=$?
    head="$(git -C "$REPO_DIR" rev-parse --short HEAD)"
    echo "deploy exit=$rc; HEAD=$head"; log "deploy exit=$rc HEAD=$head"; exit "$rc"
    ;;
  restart)
    echo "PLAN: $RESTART_CMD"; log "restart"; $RESTART_CMD; rc=$?; echo "restart exit=$rc"; log "restart exit=$rc"; exit "$rc"
    ;;
  read_log)
    case "$arg" in
      ops) f="$LOG" ;;
      server) f="$SERVER_LOG" ;;
      *) echo "REFUSE: unknown log '$arg' (allowed: ops | server)"; exit 1 ;;
    esac
    if [ -f "$f" ]; then tail -n 120 "$f"; else echo "(no log at $f)"; fi; exit 0
    ;;
  snapshot_data)
    src="$REPO_DIR/data.json"; dst="$REPO_DIR/business-app-backup-$(date +%Y%m%d-%H%M%S).json"
    [ -f "$src" ] || { echo "ERROR: no $src"; exit 1; }
    cp "$src" "$dst"; echo "snapshot: $dst"; log "snapshot $dst"; exit 0
    ;;
  *)
    echo "REFUSE: '$cmd' not allowed. Allowed: deploy <commit> | restart | read_log <ops|server> | snapshot_data"
    log "refused: $req"; exit 1
    ;;
esac
