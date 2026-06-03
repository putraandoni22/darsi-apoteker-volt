#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_PORT="${SERVER_PORT:-${VOLT_API_PORT:-${PORT:-1337}}}"
UI_PORT="${UI_PORT:-${NEXT_PORT:-3000}}"
BACKEND_URL="http://localhost:${SERVER_PORT}"
BACKEND_LOG="/tmp/darsi-backend.log"
UI_LOG="/tmp/darsi-ui.log"
AUTO_KILL_PORT_CONFLICTS="${DARSI_AUTO_KILL_PORT_CONFLICTS:-1}"
PORT_RELEASE_TIMEOUT_SECONDS="${PORT_RELEASE_TIMEOUT_SECONDS:-10}"

check_port() {
  (echo >/dev/tcp/127.0.0.1/"$1") >/dev/null 2>&1
}

get_port_pids() {
  local port="$1"

  if command -v ss >/dev/null 2>&1; then
    ss -ltnp "sport = :${port}" 2>/dev/null \
      | sed -nE 's/.*pid=([0-9]+).*/\1/p' \
      | sort -u
    return 0
  fi

  if command -v fuser >/dev/null 2>&1; then
    fuser -n tcp "$port" 2>/dev/null \
      | tr ' ' '\n' \
      | sed '/^$/d' \
      | sort -u
  fi
}

get_pid_command() {
  local pid="$1"
  tr '\0' ' ' <"/proc/${pid}/cmdline" 2>/dev/null || true
}

get_pid_cwd() {
  local pid="$1"
  readlink -f "/proc/${pid}/cwd" 2>/dev/null || true
}

is_darsi_process() {
  local pid="$1"
  local cmdline
  local cwd

  cmdline="$(get_pid_command "$pid")"
  cwd="$(get_pid_cwd "$pid")"
  [[ "$cmdline" == *"$SCRIPT_DIR"* || "$cmdline" == *"darsi-apoteker-volt"* || "$cwd" == "$SCRIPT_DIR"* ]]
}

stop_pid_gracefully() {
  local pid="$1"

  if ! kill -0 "$pid" >/dev/null 2>&1; then
    return 0
  fi

  kill "$pid" >/dev/null 2>&1 || true

  for _ in {1..10}; do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.2
  done

  kill -9 "$pid" >/dev/null 2>&1 || true
}

wait_until_port_free() {
  local port="$1"
  local timeout="${2:-10}"

  for ((i = 0; i < timeout * 5; i++)); do
    if ! check_port "$port"; then
      return 0
    fi
    sleep 0.2
  done

  return 1
}

resolve_port_conflict() {
  local port="$1"
  local label="$2"
  local pids

  pids="$(get_port_pids "$port")"
  if [[ -z "$pids" ]]; then
    return 0
  fi

  echo "Port ${port} is already in use (${label})."

  while read -r pid; do
    [[ -z "$pid" ]] && continue

    if ! kill -0 "$pid" >/dev/null 2>&1; then
      continue
    fi

    local cmdline
    cmdline="$(get_pid_command "$pid")"

    if [[ "$AUTO_KILL_PORT_CONFLICTS" == "1" ]] && is_darsi_process "$pid"; then
      echo "Stopping stale DARSI process on port ${port}: PID ${pid}"
      stop_pid_gracefully "$pid"
      continue
    fi

    echo "Port ${port} is used by PID ${pid}."
    if [[ -n "$cmdline" ]]; then
      echo "Command: ${cmdline}"
    fi
    echo "Stop the process manually or set different ports before running DARSI."
    echo "If this is a stale DARSI process, set DARSI_AUTO_KILL_PORT_CONFLICTS=1."
    return 1
  done <<<"$pids"

  if ! wait_until_port_free "$port" "$PORT_RELEASE_TIMEOUT_SECONDS"; then
    echo "Port ${port} is still busy after cleanup attempt."
    return 1
  fi

  return 0
}

cleanup() {
  if [[ -n "${UI_PID:-}" ]]; then
    stop_pid_gracefully "$UI_PID"
  fi

  if [[ -n "${SERVER_PID:-}" ]]; then
    stop_pid_gracefully "$SERVER_PID"
  fi
}

trap cleanup EXIT INT TERM

echo "========================================"
echo "DARSI Apoteker Launcher"
echo "========================================"
echo "Backend: ${BACKEND_URL}"
echo "Backend API: ${BACKEND_URL}/api/chat"
echo "UI: http://localhost:${UI_PORT}"
echo ""

if [[ "$SERVER_PORT" == "$UI_PORT" ]]; then
  echo "SERVER_PORT and UI_PORT cannot be the same value (${SERVER_PORT})."
  exit 1
fi

if ! resolve_port_conflict "$SERVER_PORT" "backend"; then
  exit 1
fi

if ! resolve_port_conflict "$UI_PORT" "ui"; then
  exit 1
fi

echo "[1/2] Starting backend..."
(
  cd "$SCRIPT_DIR"
  exec env PORT="$SERVER_PORT" VOLT_API_PORT="$SERVER_PORT" OLLAMA_MODEL_ID="MedAIBase/MedGemma1.5:4b" OLLAMA_BASE_URL="http://localhost:11434" npm run dev >"$BACKEND_LOG" 2>&1
) &
SERVER_PID=$!

sleep 3

if ! check_port "$SERVER_PORT"; then
  echo "Backend failed to start. Last log lines:"
  tail -20 "$BACKEND_LOG" || true
  exit 1
fi

echo "[2/2] Starting UI..."
(
  cd "$SCRIPT_DIR/ui"
  exec env NEXT_PUBLIC_VOLTAGENT_URL="$BACKEND_URL" npm run dev -- --port "$UI_PORT" >"$UI_LOG" 2>&1
) &
UI_PID=$!

sleep 3

if ! check_port "$UI_PORT"; then
  echo "UI failed to start. Last log lines:"
  tail -20 "$UI_LOG" || true
  exit 1
fi

echo ""
echo "DARSI Apoteker is running."
echo "UI: http://localhost:${UI_PORT}"
echo "Backend: ${BACKEND_URL}"
echo ""
echo "Logs:"
echo "  Backend: tail -f ${BACKEND_LOG}"
echo "  UI:      tail -f ${UI_LOG}"
echo ""
echo "Press Ctrl+C to stop both processes."

set +e
wait -n "$SERVER_PID" "$UI_PID"
EXIT_CODE=$?
set -e

echo ""
echo "A child process exited with code ${EXIT_CODE}."
echo "Stopping remaining services so PM2 can restart cleanly..."

cleanup
wait "$SERVER_PID" 2>/dev/null || true
wait "$UI_PID" 2>/dev/null || true

exit "$EXIT_CODE"
