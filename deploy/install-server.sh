#!/usr/bin/env bash
# ============================================================
#  麦穗 · 代码理解助手 —— 服务器初始化
#
#  适用：全新的 Ubuntu 22.04（阿里云 ECS 香港）
#  跑几次：**只跑一次**。之后每次更新代码用 deploy/deploy.sh
#
#  它做四件事：装 Node / 装 Caddy / 建专用用户 / 放配置并 enable 服务
#  它不做两件事（有意的）：
#    - 不传代码（那是 deploy.sh 的事）
#    - 不碰 .env（密钥单独 scp 上去，权限 600，永远不进仓库）
#
#  前提：这个脚本在**已经克隆好的仓库里**跑，即
#        git clone https://github.com/skf-123/AI-We.git /opt/ai-web
#        cd /opt/ai-web && bash deploy/install-server.sh
#
#  用法（服务器上，root）：bash deploy/install-server.sh
# ============================================================
set -euo pipefail

NODE_MAJOR=22
NODE_MIN=22.22.3          # nuxt 4.6.1 的 engines 要求：^22.22.3 || ^24.15.0 || >=26.0.0
APP_DIR=/opt/ai-web
APP_USER=aiweb

die() { echo "❌ $*" >&2; exit 1; }
step() { echo; echo "===== $* ====="; }

[ "$(id -u)" -eq 0 ] || die "请用 root 跑（sudo bash deploy/install-server.sh）"
[ -f package.json ] && [ -d deploy ] || die "请在仓库根目录里跑：bash deploy/install-server.sh"

export DEBIAN_FRONTEND=noninteractive

# ------------------------------------------------------------
step "1/5 基础工具"
# ------------------------------------------------------------
apt-get update -y
apt-get install -y curl git gnupg ca-certificates \
	debian-keyring debian-archive-keyring apt-transport-https

# ------------------------------------------------------------
step "2/5 Node ${NODE_MAJOR}"
# ------------------------------------------------------------
# 用 NodeSource 的官方源。为什么是 22 而不是更新的 24：
# 本项目所有实测（构建内存、并发、首字延迟）都跑在 Node 22 上，
# 线上保持一致，就少一个「本地没问题线上有问题」的变量。
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -c2- | cut -d. -f1)" != "$NODE_MAJOR" ]; then
	curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
	apt-get install -y nodejs
fi
echo "node $(node -v) / npm $(npm -v)"

# 版本必须真的达标 —— 低一点点 Nuxt 直接拒绝启动，不如在这里就拦住
ver="$(node -v | sed 's/^v//')"
if [ "$(printf '%s\n%s\n' "$ver" "$NODE_MIN" | sort -V | head -1)" != "$NODE_MIN" ]; then
	die "Node $ver 低于 nuxt 要求的 $NODE_MIN，请检查 NodeSource 源是否指向了正确的版本"
fi

# ------------------------------------------------------------
step "3/5 Caddy（官方 apt 源）"
# ------------------------------------------------------------
# 命令取自 Caddy 官方安装文档，一行没改。那两行 chmod o+r 是官方给的：
# apt 以 _apt 用户读 key，读不到就会报 NO_PUBKEY。
if ! command -v caddy >/dev/null 2>&1; then
	curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' |
		gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
	curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
		> /etc/apt/sources.list.d/caddy-stable.list
	chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg \
		/etc/apt/sources.list.d/caddy-stable.list
	apt-get update -y
	apt-get install -y caddy
fi
echo "caddy $(caddy version)"

# ------------------------------------------------------------
step "4/5 专用用户与目录"
# ------------------------------------------------------------
# 公网服务不拿 root 跑。nologin：这个用户只用来跑进程，不给人登录。
if ! id -u "$APP_USER" >/dev/null 2>&1; then
	useradd --system --create-home --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
	echo "已创建用户 $APP_USER"
fi
mkdir -p "$APP_DIR"

# 把当前仓库挪到 /opt/ai-web（如果脚本是在别处克隆的）
if [ "$(pwd -P)" != "$(cd "$APP_DIR" && pwd -P)" ] && [ ! -e "$APP_DIR/package.json" ]; then
	echo "把仓库从 $(pwd -P) 挪到 $APP_DIR"
	shopt -s dotglob
	mv ./* "$APP_DIR"/
	shopt -u dotglob
	cd "$APP_DIR"
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# ------------------------------------------------------------
step "5/5 放配置并 enable 服务"
# ------------------------------------------------------------
install -m 644 deploy/Caddyfile /etc/caddy/Caddyfile
install -m 644 deploy/ai-web.service /etc/systemd/system/ai-web.service
systemctl daemon-reload
systemctl enable ai-web
# Caddy 现在会立刻尝试给域名申证书；如果 DNS 还没解析过来，它会失败并重试，这是正常的。
systemctl reload caddy 2>/dev/null || systemctl restart caddy
systemctl --no-pager --lines=0 status caddy || true

cat <<'EOF'

✅ 初始化完成。接下来还差三步：

  1. 传密钥文件（在**本地**跑，路径按你的实际情况改）：
       scp -i ~/.ssh/ai-web-deploy .env root@<服务器公网IP>:/opt/ai-web/.env

  2. 在服务器上收紧 .env 权限并跑部署：
       chown aiweb:aiweb /opt/ai-web/.env && chmod 600 /opt/ai-web/.env
       bash /opt/ai-web/deploy/deploy.sh

  3. 验收：见 docs/部署说明.md 最后一节那份清单

⚠️ 服务现在还没启动（systemctl enable 了但没 start）——
   缺 .env 就启动，Nuxt 会因为没有 API key 而起不来，日志里看着像部署失败。
EOF
