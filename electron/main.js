/* ==========================================================================
 * Electron 主进程
 *  - 用自定义协议 app:// 加载 ui/（支持 ES module、离线、无 file:// 跨域问题）
 *  - 无边框窗口，标题栏由界面自绘；窗口控制通过 IPC
 *  - 设备网关（device/）在主进程中运行，界面通过 preload 暴露的 window.hal 调用
 *  - --smoke：启动后截图并输出控制台错误，用于自动化冒烟测试
 * ========================================================================== */
const { app, BrowserWindow, ipcMain, protocol, net, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { DeviceGateway } = require('./device');

const UI_ROOT = path.join(__dirname, '..', 'ui');
const isMac = process.platform === 'darwin';
const SMOKE = process.argv.includes('--smoke');
const DEV = process.argv.includes('--dev');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

if (!SMOKE && !app.requestSingleInstanceLock()) app.quit();

let win = null;
const gateway = new DeviceGateway();

function createWindow() {
  win = new BrowserWindow({
    width: 1600, height: 960, minWidth: 1280, minHeight: 800,
    show: false,
    backgroundColor: '#ffffff',
    title: 'HTLAB 自动开釜工作站',
    frame: isMac,                                   // Windows / Linux：无边框，使用界面自绘标题栏
    titleBarStyle: isMac ? 'hiddenInset' : undefined, // macOS：保留红绿灯，内容延伸到标题栏
    trafficLightPosition: { x: 12, y: 8 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.loadURL('app://ui/index.html');
  win.once('ready-to-show', () => { if (!SMOKE) { win.show(); if (DEV) win.webContents.openDevTools({ mode: 'detach' }); } });
  const sendMax = () => win && win.webContents.send('win:maximized', win.isMaximized());
  win.on('maximize', sendMax); win.on('unmaximize', sendMax);
  // 外部链接用系统浏览器打开，禁止在应用内跳转到其他站点
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) e.preventDefault(); });
  // 开发者工具 / 重新加载快捷键（Windows / Linux 无应用菜单，这里单独处理）
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const mod = input.control || input.meta;
    if (input.key === 'F12' || (mod && input.shift && input.key.toLowerCase() === 'i')) { win.webContents.toggleDevTools(); e.preventDefault(); }
    if (mod && !input.shift && input.key.toLowerCase() === 'r' && !isMac) { win.webContents.reload(); e.preventDefault(); }
  });
  gateway.on('event', ev => win && !win.isDestroyed() && win.webContents.send('device:event', ev));
  if (SMOKE) runSmoke(win);
}

function runSmoke(w) {
  const errors = [];
  w.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); });
  w.webContents.on('did-fail-load', (_e, code, desc) => errors.push(`did-fail-load ${code} ${desc}`));
  w.webContents.once('did-finish-load', () => setTimeout(async () => {
    const out = process.env.SMOKE_OUT || path.join(app.getPath('temp'), 'htlab-ars-smoke.png');
    const probe = await w.webContents.executeJavaScript(`({ view: typeof curView !== 'undefined' ? curView : null, three: !!window.render3D, hal: !!window.hal, recipes: typeof DB !== 'undefined' ? DB.recipes.length : -1 })`).catch(e => ({ error: String(e) }));
    // SMOKE_RUN=1：额外跑一遍完整仿真任务（4× 速度），验证流程引擎与记录保存
    if (process.env.SMOKE_RUN) {
      probe.run = await w.webContents.executeJavaScript(`(async () => {
        const n0 = DB.records.length;
        newJob({ batch: 'SMOKE-' + Date.now(), sample: 'SMOKE', recipeId: DB.recipes[0].id, reactor: DB.settings.reactor, remark: 'smoke test' });
        showView('run'); speed = 4; startRun();
        const t0 = Date.now();
        while (!finished && !alarmActive() && Date.now() - t0 < 60000) await new Promise(r => setTimeout(r, 200));
        const rec = DB.records[0], ok = finished && DB.records.length === n0 + 1 && rec.result === '完成';
        DB.records = DB.records.filter(r => r.sample !== 'SMOKE'); Store.save();
        return { ok, steps: rec && rec.steps.length, points: rec && rec.pressure.length };
      })()`).catch(e => ({ ok: false, error: String(e) }));
      if (!probe.run.ok) errors.push('smoke run failed');
    }
    const img = await w.webContents.capturePage();
    fs.writeFileSync(out, img.toPNG());
    console.log(JSON.stringify({ ok: errors.length === 0 && probe.three, probe, errors, screenshot: out }));
    app.exit(errors.length === 0 && probe.three ? 0 : 1);
  }, Number(process.env.SMOKE_WAIT || 4000)));
}

/* ---------- IPC: window ---------- */
ipcMain.on('win:minimize', () => win && win.minimize());
ipcMain.on('win:toggleMaximize', () => win && (win.isMaximized() ? win.unmaximize() : win.maximize()));
ipcMain.on('win:close', () => win && win.close());
ipcMain.handle('win:isMaximized', () => !!(win && win.isMaximized()));

/* ---------- IPC: app ---------- */
ipcMain.handle('app:info', () => ({
  version: app.getVersion(), platform: process.platform, arch: process.arch,
  electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node,
  userData: app.getPath('userData'),
}));

/* ---------- IPC: device gateway（协议确定后在 device/ 中实现实机驱动） ---------- */
ipcMain.handle('device:status', () => gateway.status());
ipcMain.handle('device:connect', (_e, cfg) => gateway.connect(cfg));
ipcMain.handle('device:disconnect', () => gateway.disconnect());
ipcMain.handle('device:test', (_e, cfg) => gateway.test(cfg));
ipcMain.handle('device:command', (_e, name, args) => gateway.command(name, args));

/* ---------- app lifecycle ---------- */
app.whenReady().then(() => {
  protocol.handle('app', req => {
    const { host, pathname } = new URL(req.url);
    if (host !== 'ui') return new Response('Not found', { status: 404 });
    const file = path.normalize(path.join(UI_ROOT, decodeURIComponent(pathname)));
    if (!file.startsWith(UI_ROOT)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  if (isMac) {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' }, { role: 'editMenu' },
      { label: '视图', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
      { role: 'windowMenu' },
    ]));
  } else Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => { gateway.disconnect(); if (!isMac || SMOKE) app.quit(); });
