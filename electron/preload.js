/* ==========================================================================
 * preload：在隔离环境中向界面暴露受控接口 window.hal
 * 界面不能直接访问 Node / 文件系统 / 网络，只能调用这里列出的方法。
 * ========================================================================== */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hal', {
  platform: process.platform,
  info: () => ipcRenderer.invoke('app:info'),
  win: {
    minimize: () => ipcRenderer.send('win:minimize'),
    toggleMaximize: () => ipcRenderer.send('win:toggleMaximize'),
    close: () => ipcRenderer.send('win:close'),
    isMaximized: () => ipcRenderer.invoke('win:isMaximized'),
    onMaximized: cb => ipcRenderer.on('win:maximized', (_e, v) => cb(v)),
  },
  // 设备网关（主进程实现）。当前为仿真驱动，接入实机后接口保持不变。
  device: {
    status: () => ipcRenderer.invoke('device:status'),
    connect: cfg => ipcRenderer.invoke('device:connect', cfg),
    disconnect: () => ipcRenderer.invoke('device:disconnect'),
    test: cfg => ipcRenderer.invoke('device:test', cfg),
    command: (name, args) => ipcRenderer.invoke('device:command', name, args),
    onEvent: cb => ipcRenderer.on('device:event', (_e, ev) => cb(ev)),
  },
});
