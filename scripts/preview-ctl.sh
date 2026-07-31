#!/usr/bin/env bash
# Personal Ops · 本地验收页常驻服务（vite preview → docs/）
# 固定地址：http://127.0.0.1:4173/ops/
# 用法：
#   ./scripts/preview-ctl.sh start|stop|status|restart
#   ./scripts/preview-ctl.sh install   # 登录自启（每台电脑执行一次）
#   ./scripts/preview-ctl.sh uninstall
#   ./scripts/preview-ctl.sh rebuild   # 重新 build 后热重启预览
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.personalops.preview"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
RUNTIME_DIR="${PERSONAL_OPS_RUNTIME:-$HOME/.agent/obsidian-vault/personal-ops}"
LOG_DIR="${PERSONAL_OPS_LOG_DIR:-$HOME/Library/Logs/obsidian-vault}"
LOG_OUT="$LOG_DIR/ops-preview.log"
LOG_ERR="$LOG_DIR/ops-preview.err.log"
PID_FILE="$RUNTIME_DIR/ops-preview.pid"
PORT="${OPS_PREVIEW_PORT:-4173}"
HOST="${OPS_PREVIEW_HOST:-127.0.0.1}"
BASE_PATH="${OPS_PREVIEW_BASE:-/ops/}"
URL="http://${HOST}:${PORT}${BASE_PATH}"

mkdir -p "$RUNTIME_DIR" "$LOG_DIR"

resolve_node() {
  if [[ -n "${PERSONAL_OPS_NODE:-}" && -x "$PERSONAL_OPS_NODE" ]]; then
    echo "$PERSONAL_OPS_NODE"
    return
  fi
  local candidates=(
    "$(command -v node 2>/dev/null || true)"
    "$HOME/node/bin/node"
    "/usr/local/bin/node"
    "/opt/homebrew/bin/node"
    "$HOME/.nvm/versions/node/*/bin/node"
  )
  local c
  for c in "${candidates[@]}"; do
    # shellcheck disable=SC2086
    for p in $c; do
      if [[ -n "$p" && -x "$p" ]]; then
        echo "$p"
        return
      fi
    done
  done
  return 1
}

resolve_npm() {
  local node_bin="$1"
  local npm_bin
  npm_bin="$(dirname "$node_bin")/npm"
  if [[ -x "$npm_bin" ]]; then
    echo "$npm_bin"
    return
  fi
  command -v npm
}

resolve_vite() {
  local vite_js="$ROOT/node_modules/vite/bin/vite.js"
  if [[ -f "$vite_js" ]]; then
    echo "$vite_js"
    return
  fi
  return 1
}

ensure_deps() {
  if [[ ! -d "$ROOT/node_modules" ]] || ! resolve_vite >/dev/null 2>&1; then
    echo "[ops-preview] 安装或修复项目依赖…"
    local npm_bin
    npm_bin="$(resolve_npm "$NODE_BIN")"
    (cd "$ROOT" && "$npm_bin" install --silent)
  fi
}

ensure_docs() {
  if [[ -f "$ROOT/docs/index.html" ]]; then
    return 0
  fi
  echo "[ops-preview] 未找到 docs/ 构建产物，正在 npm run build…"
  local npm_bin
  npm_bin="$(resolve_npm "$NODE_BIN")"
  (cd "$ROOT" && "$npm_bin" run build)
}

is_listening() {
  curl -fsS --max-time 1 -o /dev/null -w '' "$URL" >/dev/null 2>&1
}

cmd_status() {
  if is_listening; then
    echo "online  $URL"
    if [[ -f "$PID_FILE" ]]; then
      echo "pid     $(cat "$PID_FILE" 2>/dev/null || echo '?')"
    fi
    if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
      echo "service launchd installed · $LABEL"
    fi
    return 0
  fi
  echo "offline  $URL"
  if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
    echo "service launchd installed but not healthy — 试: $0 restart"
  fi
  return 1
}

cmd_stop() {
  if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
    launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
  fi
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      sleep 0.4
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$PID_FILE"
  fi
  # 兜底：按端口清掉残留（含临时 npm run preview）
  if command -v lsof >/dev/null 2>&1; then
    local pids
    pids="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "$pids" ]]; then
      # shellcheck disable=SC2086
      kill $pids 2>/dev/null || true
      sleep 0.3
      # shellcheck disable=SC2086
      kill -9 $pids 2>/dev/null || true
    fi
  fi
  echo "[ops-preview] stopped"
}

start_preview_process() {
  local vite_js
  vite_js="$(resolve_vite)"
  nohup "$NODE_BIN" "$vite_js" preview \
    --host "$HOST" \
    --port "$PORT" \
    --strictPort \
    >>"$LOG_OUT" 2>>"$LOG_ERR" &
  echo $! >"$PID_FILE"
}

wait_online() {
  local i
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    is_listening && return 0
    sleep 0.4
  done
  return 1
}

cmd_start() {
  if is_listening; then
    echo "[ops-preview] 已在运行 · $URL"
    return 0
  fi
  NODE_BIN="$(resolve_node)" || {
    echo "[ops-preview] 未找到 Node.js。请先安装 Node 20+，或设置 PERSONAL_OPS_NODE=/path/to/node" >&2
    exit 1
  }
  ensure_deps
  ensure_docs
  # 优先走 launchd（若已安装）
  if [[ -f "$PLIST" ]]; then
    launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || \
      launchctl kickstart -k "gui/$(id -u)/$LABEL" 2>/dev/null || true
    if wait_online; then
      echo "[ops-preview] started via launchd · $URL"
      return 0
    fi
  fi
  start_preview_process
  if wait_online; then
    echo "[ops-preview] started · $URL"
    echo "[ops-preview] log · $LOG_OUT"
    return 0
  fi
  echo "[ops-preview] 启动超时，请查看日志: $LOG_ERR" >&2
  exit 1
}

cmd_rebuild() {
  NODE_BIN="$(resolve_node)" || {
    echo "[ops-preview] 未找到 Node.js" >&2
    exit 1
  }
  ensure_deps
  local npm_bin
  npm_bin="$(resolve_npm "$NODE_BIN")"
  echo "[ops-preview] 正在重新构建 docs/ …"
  (cd "$ROOT" && "$npm_bin" run build)
  cmd_stop
  cmd_start
}

cmd_install() {
  NODE_BIN="$(resolve_node)" || {
    echo "[ops-preview] 未找到 Node.js，无法安装开机自启" >&2
    exit 1
  }
  ensure_deps
  ensure_docs
  local node_dir vite_js
  node_dir="$(dirname "$NODE_BIN")"
  vite_js="$(resolve_vite)"
  mkdir -p "$(dirname "$PLIST")"
  # 先清掉端口上的临时进程，避免 bootstrap 失败
  if command -v lsof >/dev/null 2>&1; then
    local pids
    pids="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "$pids" ]]; then
      # shellcheck disable=SC2086
      kill $pids 2>/dev/null || true
      sleep 0.4
    fi
  fi
  cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${vite_js}</string>
    <string>preview</string>
    <string>--host</string>
    <string>${HOST}</string>
    <string>--port</string>
    <string>${PORT}</string>
    <string>--strictPort</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${ROOT}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_OUT}</string>
  <key>StandardErrorPath</key>
  <string>${LOG_ERR}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${node_dir}:${HOME}/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    <key>HOME</key>
    <string>${HOME}</string>
    <key>OPS_PREVIEW_PORT</key>
    <string>${PORT}</string>
    <key>OPS_PREVIEW_HOST</key>
    <string>${HOST}</string>
  </dict>
</dict>
</plist>
EOF
  launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  launchctl enable "gui/$(id -u)/$LABEL" 2>/dev/null || true
  echo "[ops-preview] 已安装登录自启 · $PLIST"
  echo "[ops-preview] 固定地址 · $URL"
  echo "[ops-preview] 换电脑后：git pull 本仓库，再执行一次 ./scripts/preview-ctl.sh install"
  if wait_online; then
    echo "[ops-preview] online · $URL"
  else
    cmd_start || true
  fi
  cmd_status || true
}

cmd_uninstall() {
  launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  cmd_stop
  echo "[ops-preview] 已卸载开机自启"
}

usage() {
  cat <<EOF
Personal Ops 本地验收页常驻服务

  $0 start       一键启动（已装自启则走 launchd）
  $0 stop        停止
  $0 restart     重启
  $0 status      是否在线
  $0 rebuild     重新 build docs/ 并重启预览
  $0 install     登录 Mac 后自动启动（每台电脑一次）
  $0 uninstall   取消自启

固定地址: $URL
项目目录: $ROOT
日志: $LOG_OUT
EOF
}

cmd="${1:-}"
case "$cmd" in
  start) cmd_start ;;
  stop) cmd_stop ;;
  restart) cmd_stop; cmd_start ;;
  status) cmd_status ;;
  rebuild) cmd_rebuild ;;
  install) cmd_install ;;
  uninstall) cmd_uninstall ;;
  -h|--help|help|"") usage ;;
  *) echo "未知命令: $cmd" >&2; usage; exit 2 ;;
esac
