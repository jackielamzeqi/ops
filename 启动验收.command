#!/bin/bash
# 双击即可启动本地验收页（固定地址 http://127.0.0.1:4173/ops/）
cd "$(dirname "$0")" || exit 1
chmod +x scripts/preview-ctl.sh 2>/dev/null || true
./scripts/preview-ctl.sh start
echo
echo "验收地址：http://127.0.0.1:4173/ops/"
echo "若希望开机自动启动：双击「安装验收自启.command」（每台电脑只需一次）"
echo "更新构建产物后刷新：终端执行 npm run preview:rebuild"
echo
open "http://127.0.0.1:4173/ops/" 2>/dev/null || true
read -r -p "按回车关闭…" _
