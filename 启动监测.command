#!/bin/bash
# 双击即可启动本机 Token 监测（个人电脑 / 公司电脑通用）
cd "$(dirname "$0")" || exit 1
chmod +x scripts/agent-ctl.sh 2>/dev/null || true
./scripts/agent-ctl.sh start
echo
echo "网页打开 https://jackielamzeqi.github.io/personal-ops/ 后刷新「AI 助手」即可。"
echo "若希望开机自动启动：双击「安装开机自启.command」（每台电脑只需一次）"
echo
read -r -p "按回车关闭…" _
