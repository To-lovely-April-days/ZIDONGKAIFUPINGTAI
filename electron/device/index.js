/* ==========================================================================
 * 设备网关（主进程）
 *
 * 职责：与主控 PLC、机械臂控制器通讯，向界面提供统一的设备接口。
 * 当前只有仿真驱动（SimDriver）；通信协议与动作定义确定后，
 * 在 drivers/ 下实现实机驱动（例如 PlcDriver: Modbus TCP / S7 / OPC UA，
 * RobotDriver: 机械臂 TCP 指令），并在 createDriver() 中按配置选择。
 *
 * 统一接口（界面经 window.hal.device 调用）：
 *   connect(cfg)            建立连接          → { ok, mode, message }
 *   disconnect()            断开
 *   test(cfg)               连接测试（不改变当前连接） → { ok, plc, arm, message }
 *   status()                连接状态与最新 I/O 快照
 *   command(name, args)     下发动作指令，完成后返回 → { ok, message }
 *                           例：command('cap.jaw', { close: true })
 *                               command('arm.moveTo', { station: 'cap' })
 *                               command('rx.vent', { open: true })
 * 事件（主进程 → 界面，window.hal.device.onEvent）：
 *   { type: 'state', data }  设备状态刷新（压力、到位信号、关节角…）
 *   { type: 'alarm', code, message }
 *   { type: 'link', online }
 * ========================================================================== */
const { EventEmitter } = require('events');
const { SimDriver } = require('./sim');

function createDriver(cfg = {}) {
  if (cfg.simulate !== false) return new SimDriver();
  // TODO(集成)：协议确定后在此返回实机驱动，例如：
  //   return new PlcDriver({ host: cfg.plcIp, port: cfg.plcPort, proto: cfg.plcProto }, new RobotDriver({ host: cfg.armIp, port: cfg.armPort }));
  return null;
}

class DeviceGateway extends EventEmitter {
  constructor() { super(); this.driver = null; this.cfg = null; }

  async connect(cfg) {
    await this.disconnect();
    const d = createDriver(cfg);
    if (!d) return { ok: false, mode: 'real', message: '实机驱动尚未实现（等待通信协议确定）' };
    d.on('event', ev => this.emit('event', ev));
    const r = await d.connect(cfg);
    if (r.ok) { this.driver = d; this.cfg = cfg; }
    return r;
  }

  async disconnect() {
    if (this.driver) { await this.driver.disconnect(); this.driver.removeAllListeners(); this.driver = null; }
    return { ok: true };
  }

  async test(cfg) {
    const d = createDriver(cfg);
    if (!d) return { ok: false, message: '实机驱动尚未实现（等待通信协议确定）' };
    return d.test(cfg);
  }

  status() {
    return this.driver ? { connected: true, mode: this.driver.mode, ...this.driver.snapshot() } : { connected: false, mode: null };
  }

  async command(name, args = {}) {
    if (!this.driver) return { ok: false, message: '设备未连接' };
    return this.driver.command(name, args);
  }
}

module.exports = { DeviceGateway };
