#!/bin/sh
# 安装 / 更新 Phrontis GNOME 扩展（本地开发用；不经过 extensions.gnome.org）
#
#   ./install.sh          → 复制到 ~/.local/share/gnome-shell/extensions/<uuid>/ 并启用
#
# ★ Wayland 会话下新装扩展必须重新登录才会加载（GNOME 不会热加载新扩展）；
#   X11 可以用 Alt+F2 → r 重载。脚本会尝试 enable，失败不算错误。

set -e
HERE=$(cd "$(dirname "$0")" && pwd)
UUID=$(sed -n 's/.*"uuid"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$HERE/metadata.json")
if [ -z "$UUID" ]; then
    echo "无法从 metadata.json 读取 uuid" >&2
    exit 1
fi

DEST="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"
mkdir -p "$DEST"
cp "$HERE/metadata.json" "$HERE/extension.js" "$HERE/stylesheet.css" "$DEST/"
if [ -d "$HERE/schemas" ]; then
    mkdir -p "$DEST/schemas"
    cp "$HERE"/schemas/*.xml "$DEST/schemas/"
    glib-compile-schemas "$DEST/schemas"
fi

echo "已安装到: $DEST"
if gnome-extensions enable "$UUID" 2>/dev/null; then
    echo "已启用: $UUID"
else
    # Shell 还没扫描到这个新扩展（Wayland 常见）：写进 enabled-extensions，
    # 下次登录自动加载 —— 比让用户登录后再手动 enable 少一步。
    CUR=$(gsettings get org.gnome.shell enabled-extensions 2>/dev/null || echo "[]")
    case "$CUR" in
        *"$UUID"*) ;;
        "[]") gsettings set org.gnome.shell enabled-extensions "['$UUID']" ;;
        *) gsettings set org.gnome.shell enabled-extensions "$(printf '%s' "$CUR" | sed "s/]$/, '$UUID']/")" ;;
    esac
    echo "尚未生效：已登记到 enabled-extensions。请重新登录（Wayland）或 Alt+F2 → r（X11）。"
fi
