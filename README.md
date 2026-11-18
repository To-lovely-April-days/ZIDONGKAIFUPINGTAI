# HTLAB 自动开釜工作站（Electron）

自动开釜平台上位机软件。界面 + 3D 仿真已可完整运行；设备通讯与动作在协议确定后集成（见 `docs/功能设计.md` 第 6 节）。

## 快速开始（VS Code）

1. 安装 [Node.js 22 LTS](https://nodejs.org/)（Windows 选 64 位安装包，安装时勾选加入 PATH）和 [VS Code](https://code.visualstudio.com/)
2. 拉取代码并安装依赖：
   ```bash
   git clone https://github.com/To-lovely-April-days/ZIDONGKAIFUPINGTAI.git
   cd ZIDONGKAIFUPINGTAI
   npm install
   ```
   国内网络下载 Electron 较慢时，先设置镜像再安装：
   - Windows PowerShell：`$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"`
   - macOS / Linux：`export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`
3. 用 VS Code 打开文件夹，按 **F5**，选择“Electron: 全部（主进程 + 界面）”即可启动并调试：
   - 主进程（`electron/`）断点在 VS Code 中生效
   - 界面（`ui/js/`）断点同样在 VS Code 中生效；也可以在应用里按 `Ctrl+Shift+I` 打开开发者工具
4. 不调试时直接在终端运行 `npm start`；常用操作也可从“终端 → 运行任务”中选择（启动 / 冒烟测试 / 打包）

> `npm install` 会自动把 three.js 复制到 `ui/vendor/three`（仓库中已包含一份，离线可用）。

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm start` | 启动桌面应用 |
| `npm run dev` | 启动并打开开发者工具 |
| F5（VS Code） | 启动并调试主进程 + 界面 |
| `npm run smoke` | 冒烟测试：启动 → 截图 → 检查控制台错误后退出（加 `SMOKE_RUN=1` 会额外跑一遍完整仿真任务） |
| `npm run dist:mac` | 打包 macOS（.dmg） |
| `npm run dist:win` | 打包 Windows（.exe 安装包，建议在 Windows 上执行） |
| `npm run dist:linux` | 打包 Linux（AppImage / .deb，建议在 Linux 上执行） |

打包产物在 `dist/`。未配置代码签名时可加 `CSC_IDENTITY_AUTO_DISCOVERY=false` 跳过签名。

## 目录

```
electron/
├─ main.js            主进程：窗口、app:// 协议加载 ui、IPC、冒烟测试
├─ preload.js         向界面暴露 window.hal（窗口控制、设备网关）
└─ device/
   ├─ index.js        设备网关统一接口（connect / test / status / command / 事件）
   └─ sim.js          仿真驱动；实机驱动在协议确定后加在这里
ui/                   界面（首页 / 设备布局 / 工艺配方 / 运行监控 / 数据记录 / 系统设置）
scripts/vendor-three.js   把 three.js 复制到 ui/vendor
build/icon.png        应用图标（打包时自动生成各平台格式）
docs/功能设计.md       功能设计说明
```

`ui/` 也可以直接用浏览器打开（`ui/index.html`），此时没有设备网关，其余功能相同。

## 待集成（协议与动作确定后）

1. `electron/device/` 中实现实机驱动：PLC（Modbus TCP / S7 / OPC UA）、机械臂控制器（TCP）
2. 流程引擎从 `ui/js/engine.js` 迁到主进程，按段下发指令、以设备反馈刷新状态
3. 数据层由 localStorage 换为 SQLite（`better-sqlite3`）
4. Windows / Linux 安装包签名与自动更新
