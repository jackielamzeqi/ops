#!/bin/bash
# 每台 Mac 执行一次：登录后自动启动 token-agent，换电脑无需改代码
cd "$(dirname "$0")" || exit 1
chmod +x scripts/agent-ctl.sh 2>/dev/null || true
./scripts/agent-ctl.sh install
echo
echo "之后登录这台电脑会自动监测；网页端无需再手动 npm run agent。"
echo "卸载：终端执行 ./scripts/agent-ctl.sh uninstall"
echo
read -r -p "按回车关闭…" _
