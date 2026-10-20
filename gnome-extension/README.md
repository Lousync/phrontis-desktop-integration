# Phrontis · GNOME Shell 扩展

形态 **A**（顶栏常驻入口 + 弹出面板）与 **B**（快速设置磁贴）的实现。

- 顶栏读数：`今日 N 项 · 打卡 M/K`（N = 未完成待办）
- 弹出面板：待办可勾、打卡可点、「打开 Phrontis」
- 快速设置磁贴：同源读数，点一下唤起应用
- 所有数据走应用的 D-Bus `Core1`，**不读 vault 文件**

## 安装

```bash
./install.sh
```

**Wayland 下必须重新登录**（GNOME 不会热加载新装扩展）；X11 可以 `Alt+F2` → `r`。
登录后确认：

```bash
gnome-extensions info phrontis@lousync.github.io
```

## 开发

- 应用没装、只有 `npm run dev` 在跑时，扩展会自动回退到总线名
  `io.github.lousync.Phrontis.Dev`（先试正式名，失败再试 `.Dev`）。
- 改完 `extension.js` 后重新执行 `./install.sh`，再重载 Shell。
- 打包成可分发 zip：

```bash
gnome-extensions pack . --out-dir=dist
```

## 当前边界

- 番茄钟**只显示状态**，控制（开始/暂停/重置）等应用侧 `PomodoroControl` 落地后再接。
- 待办最多显示 8 条，其余用「还有 N 项…」提示（面板不承担完整日程表）。
- 应用未运行时顶栏显示 `Phrontis`，面板里可一键启动。
