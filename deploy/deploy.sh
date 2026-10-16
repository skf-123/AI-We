#!/usr/bin/env bash
# ============================================================
#  麦穗 · 代码理解助手 —— 部署 / 更新
#
#  跑几次：**每次更新代码跑一次**（拉代码 → 装依赖 → 构建 → 重启）
#  前提：机器已经跑过 deploy/install-server.sh，且 /opt/ai-web/.env 已就位
#
#  用法（服务器上，root）：bash /opt/ai-web/deploy/deploy.sh
# ============================================================
set -euo pipefail

APP_DIR=/opt/ai-web
APP_USER=aiweb
BRANCH=main

die() { echo "❌ $*" >&2; exit 1; }
step() { echo; echo "===== $* ====="; }

[ "$(id -u)" -eq 0 ] || die "请用 root 跑（sudo bash deploy/deploy.sh）"
[ -d "$APP_DIR/.git" ] || die "$APP_DIR 不是仓库，先跑 deploy/install-server.sh"

# 密钥文件不在仓库里，所以每次都要先确认它还在
[ -f "$APP_DIR/.env" ] || die "缺少 $APP_DIR/.env（密钥文件，不进仓库，要 scp 单独传）"

cd "$APP_DIR"

# ------------------------------------------------------------
step "1/4 拉最新代码"
# ------------------------------------------------------------
# 服务器上不写代码，所以直接对齐远程分支；.env 是未跟踪文件，不会被 reset 动到
git fetch --all --prune
git reset --hard "origin/$BRANCH"
git --no-pager log --oneline -1

# ------------------------------------------------------------
step "2/4 装依赖"
# ------------------------------------------------------------
# 为什么是「删干净再装」，而不是直接 npm install（更不能是 npm ci）：
#
# ① 锁文件是在 Windows 上生成的，原生包条目按 win32 解析。带着它装，npm 不会
#    去取 Linux 的原生二进制 —— 实测装完 node_modules/@rolldown/ 下只有
#    pluginutils，缺 binding-linux-x64-gnu，构建第一步 nuxt prepare 就失败。
# ② 那把锁文件删掉、让 npm 按 Linux 重新解析呢？会撞上另一个坑：arborist 解析
#    Nuxt 的 peer 依赖图时崩溃（TypeError: Cannot read properties of null
#    (reading 'edgesOut')）。
#
# 所以两件事必须一起做：删掉 node_modules 与锁文件，并用 --legacy-peer-deps
# 跳过 peer 解析。这样既绕开崩的那一处，又能按本机平台把原生包装齐。
# 2026-10-16 实测：全套原生包就位，构建 12.6 秒通过。
rm -rf node_modules package-lock.json
npm install --legacy-peer-deps

# ------------------------------------------------------------
step "3/4 构建"
# ------------------------------------------------------------
# 构建峰值内存实测 1080~1316 MB（4 GiB 的机器够用，2 GiB 会很紧张）。
# 产物 .output/ 是自包含的：语料与向量在构建期就被打进 chunks，
# 所以部署不需要另外传语料、也不需要联网下载内容。
npm run build

# ------------------------------------------------------------
step "4/4 交给 systemd"
# ------------------------------------------------------------
# 构建是 root 跑的，产物要交给服务用户才读得到
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
chmod 600 "$APP_DIR/.env"

systemctl restart ai-web
sleep 2
systemctl --no-pager --lines=0 --full status ai-web

echo
echo "✅ 部署完成。看日志：journalctl -u ai-web -f"
echo "   冒烟测试：curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/"
