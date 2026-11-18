/* ==========================================================================
 * 仿真驱动
 * 现阶段界面自身负责动作仿真（ui/js/engine.js），这里只模拟“连接 / 测试 / 指令应答”，
 * 用来打通 界面 → preload → 主进程 → 驱动 的调用链路。
 * 实机驱动需实现同样的方法：connect / disconnect / test / snapshot / command。
 * ========================================================================== */
const { EventEmitter } = require('events');

const delay = ms => new Promise(r => setTimeout(r, ms));

class SimDriver extends EventEmitter {
  constructor() { super(); this.mode = 'sim'; this.online = false; this.lastCmd = null; }

  async connect(cfg) {
    await delay(120);
    this.online = true;
    this.emit('event', { type: 'link', online: true, mode: 'sim' });
    return { ok: true, mode: 'sim', message: `仿真连接：PLC ${cfg?.plcIp || '-'} / 机械臂 ${cfg?.armIp || '-'}` };
  }

  async disconnect() { this.online = false; this.emit('event', { type: 'link', online: false, mode: 'sim' }); }

  async test(cfg) {
    const t0 = Date.now(); await delay(300 + Math.random() * 200);
    return { ok: true, mode: 'sim', plc: { host: cfg?.plcIp, latencyMs: Date.now() - t0 }, arm: { host: cfg?.armIp, latencyMs: Date.now() - t0 }, message: '仿真驱动应答正常（未接入实机网络）' };
  }

  snapshot() { return { online: this.online, lastCmd: this.lastCmd }; }

  async command(name, args) {
    this.lastCmd = { name, args, at: Date.now() };
    await delay(20);
    return { ok: true, message: `仿真执行 ${name}` };
  }
}

module.exports = { SimDriver };
