#!/bin/bash
# 每台 Mac 执行一次：登录后自动启动本地验收页（固定 4173）
cd "$(dirname "$0")" || exit 1
chmod +x scripts/preview-ctl.sh 2>/dev/null || true
./scripts/preview-ctl.sh install
echo
echo "之后登录这台电脑会自动提供验收页："
echo "  http://127.0.0.1:4173/ops/"
echo "卸载：终端执行 ./scripts/preview-ctl.sh uninstall"
echo
read -r -p "按回车关闭…" _