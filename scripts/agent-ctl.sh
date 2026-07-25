#!/usr/bin/env bash
# Personal Ops · 本机 token-agent 跨环境控制
# 用法（在任意 Mac 上，仓库路径可变）：
#   ./scripts/agent-ctl.sh start|stop|status|restart
#   ./scripts/agent-ctl.sh install   # 登录自启（每台电脑执行一次）
#   ./scripts/agent-ctl.sh uninstall
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.personalops.token-agent"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
RUNTIME_DIR="${PERSONAL_OPS_RUNTIME:-$HOME/.agent/obsidian-vault/personal-ops}"
LOG_DIR="${PERSONAL_OPS_LOG_DIR:-$HOME/Library/Logs/obsidian-vault}"
LOG_OUT="$LOG_DIR/token-agent.log"
LOG_ERR="$LOG_DIR/token-agent.err.log"
PID_FILE="$RUNTIME_DIR/token-agent.pid"
PORT="${TOKEN_AGENT_PORT:-3847}"
HOST="${TOKEN_AGENT_HOST:-127.0.0.1}"

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

ensure_deps() {
  local tokscale_bin="$ROOT/node_modules/.bin/tokscale"
  if [[ ! -d "$ROOT/node_modules" ]] || \
    [[ ! -x "$tokscale_bin" ]] || \
    ! "$tokscale_bin" --version >/dev/null 2>&1; then
    echo "[personal-ops] 安装或修复项目依赖…"
    local npm_bin
    npm_bin="$(resolve_npm "$NODE_BIN")"
    (cd "$ROOT" && "$npm_bin" install --include=optional --silent)
  fi
}

is_listening() {
  curl -fsS --max-time 1 "http://${HOST}:${PORT}/api/health" >/dev/null 2>&1
}

cmd_status() {
  if is_listening; then
    echo "online  http://${HOST}:${PORT}  (health ok)"
    if [[ -f "$PID_FILE" ]]; then
      echo "pid     $(cat "$PID_FILE" 2>/dev/null || echo '?')"
    fi
    if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
      echo "service launchd installed · $LABEL"
    fi
    return 0
  fi
  echo "offline  http://${HOST}:${PORT}"
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
  # 兜底：按端口清掉残留
  if command -v lsof >/dev/null 2>&1; then
    local pids
    pids="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "$pids" ]]; then
      # shellcheck disable=SC2086
      kill $pids 2>/dev/null || true
    fi
  fi
  echo "[personal-ops] agent stopped"
}

cmd_start() {
  if is_listening; then
    echo "[personal-ops] 已在运行 · http://${HOST}:${PORT}"
    return 0
  fi
  NODE_BIN="$(resolve_node)" || {
    echo "[personal-ops] 未找到 Node.js。请先安装 Node 20+，或设置 PERSONAL_OPS_NODE=/path/to/node" >&2
    exit 1
  }
  ensure_deps
  # 优先走 launchd（若已安装）
  if [[ -f "$PLIST" ]]; then
    launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || \
      launchctl kickstart -k "gui/$(id -u)/$LABEL" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      is_listening && { echo "[personal-ops] started via launchd · http://${HOST}:${PORT}"; return 0; }
      sleep 0.5
    done
  fi
  # 前台友好的后台启动（无 launchd 时）
  nohup "$NODE_BIN" "$ROOT/scripts/token-agent.mjs" \
    >>"$LOG_OUT" 2>>"$LOG_ERR" &
  echo $! >"$PID_FILE"
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    is_listening && {
      echo "[personal-ops] started · http://${HOST}:${PORT}"
      echo "[personal-ops] log · $LOG_OUT"
      return 0
    }
    sleep 0.5
  done
  echo "[personal-ops] 启动超时，请查看日志: $LOG_ERR" >&2
  exit 1
}

cmd_install() {
  NODE_BIN="$(resolve_node)" || {
    echo "[personal-ops] 未找到 Node.js，无法安装开机自启" >&2
    exit 1
  }
  ensure_deps
  local node_dir
  node_dir="$(dirname "$NODE_BIN")"
  mkdir -p "$(dirname "$PLIST")"
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
    <string>${ROOT}/scripts/token-agent.mjs</string>
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
    <string>${node_dir}:${HOME}/.local/bin:${HOME}/.kimi-code/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    <key>HOME</key>
    <string>${HOME}</string>
    <key>TOKEN_AGENT_PORT</key>
    <string>${PORT}</string>
    <key>TOKEN_AGENT_HOST</key>
    <string>${HOST}</string>
  </dict>
</dict>
</plist>
EOF
  launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  launchctl enable "gui/$(id -u)/$LABEL" 2>/dev/null || true
  echo "[personal-ops] 已安装登录自启 · $PLIST"
  echo "[personal-ops] 换电脑后：git pull 本仓库，再执行一次 ./scripts/agent-ctl.sh install"
  cmd_start || true
  cmd_status || true
}

cmd_uninstall() {
  launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  cmd_stop
  echo "[personal-ops] 已卸载开机自启"
}

usage() {
  cat <<EOF
Personal Ops token-agent 控制（跨个人/公司电脑复用）

  $0 start       一键启动（已装自启则走 launchd）
  $0 stop        停止
  $0 restart     重启
  $0 status      是否在线
  $0 install     登录 Mac 后自动启动（每台电脑一次）
  $0 uninstall   取消自启

项目目录（自动探测）: $ROOT
日志目录: $RUNTIME_DIR
EOF
}

cmd="${1:-}"
case "$cmd" in
  start) cmd_start ;;
  stop) cmd_stop ;;
  restart) cmd_stop; cmd_start ;;
  status) cmd_status ;;
  install) cmd_install ;;
  uninstall) cmd_uninstall ;;
  -h|--help|help|"") usage ;;
  *) echo "未知命令: $cmd" >&2; usage; exit 2 ;;
esac
