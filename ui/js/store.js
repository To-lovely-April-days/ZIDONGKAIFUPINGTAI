/* ==========================================================================
 * store.js — 本地数据层
 * 负责：配方、运行记录、报警记录、系统设置、用户、示教点 的持久化。
 * 目前保存在浏览器 localStorage；接入正式后端时只需替换 Store.load / Store.save
 * 为 HTTP / IPC 调用，其余模块通过 DB 对象读写，不需要改动。
 * ========================================================================== */
const STORE_KEY = 'htlab.ars.v1';

const DEFAULT_RECIPE_PARAMS = {
  doCap: true,          // 工序：开盖
  doPlug: true,         // 工序：开塞
  capTurns: 3,          // 开盖旋转圈数
  capTorque: 2.0,       // 开盖扭矩上限 N·m
  capRise: 14,          // 旋拧过程上升量 mm（螺纹导程补偿）
  plugAir: 0.35,        // 拔塞充气压力 MPa
  plugDepth: 18,        // 针头刺入深度 mm
  ventTarget: 0.008,    // 泄压目标压力 MPa
  ventTimeout: 30,      // 泄压超时 s
  pourAngle: 110,       // 倾倒角度 °
  pourTime: 2.8,        // 倾倒时间 s
  fillVolume: 250,      // 投料体积 mL
};

function defaultDB() {
  const now = Date.now();
  return {
    version: 1,
    settings: {
      safeP: 0.05,            // 开釜安全压力上限 MPa（系统级，配方不可覆盖）
      estopNeedReset: true,   // 急停解除后必须复位
      confirmOpen: true,      // 开釜前二次确认
      plcIp: '192.168.1.10', plcPort: 502, plcProto: 'Modbus TCP',
      armIp: '192.168.1.20', armPort: 30003,
      pollMs: 100,
      simulate: true,         // 仿真模式（未连接实机）
      simP0: 2.4,             // 仿真初始釜压
      simFault: false,        // 仿真泄压阀故障
      speed: 1,
      reactor: 'R-01',
      user: 'admin',
    },
    recipes: [
      { id: 'rcp-std', name: '标准开釜投料', version: '1.2', desc: '旋盖瓶 + 胶塞，单瓶直投', updated: now - 86400e3 * 3, params: { ...DEFAULT_RECIPE_PARAMS } },
      { id: 'rcp-noplug', name: '无塞瓶直投', version: '1.0', desc: '仅旋盖，无胶塞的样品瓶', updated: now - 86400e3 * 9, params: { ...DEFAULT_RECIPE_PARAMS, doPlug: false, pourTime: 2.2, fillVolume: 200 } },
      { id: 'rcp-slow', name: '慢速倾倒（高黏度）', version: '0.9', desc: '倾角减小、延长倾倒时间', updated: now - 86400e3 * 15, params: { ...DEFAULT_RECIPE_PARAMS, pourAngle: 95, pourTime: 6, capTurns: 4 } },
    ],
    users: [
      { id: 'admin', name: 'Administrator', role: '管理员', enabled: true },
      { id: 'eng01', name: '张工', role: '工程师', enabled: true },
      { id: 'op01', name: '操作员 01', role: '操作员', enabled: true },
    ],
    // 示教点补偿（mm），叠加到工位名义坐标上
    teach: { tray: { dx: 0, dz: 0 }, cap: { dx: 0, dz: 0 }, plug: { dx: 0, dz: 0 }, rx: { dx: 0, dz: 0 } },
    records: demoRecords(now),
    alarms: [
      { id: 'al-demo1', time: now - 86400e3 * 2 + 3600e3, code: 'RX-101', level: 'err', msg: '开釜联锁：釜压 1.32 MPa ≥ 0.05 MPa，禁止开釜', batch: 'B-20261116-02', ack: true, demo: true },
      { id: 'al-demo2', time: now - 86400e3 * 5, code: 'SYS-001', level: 'err', msg: '急停按下，所有轴已停止', batch: 'B-20261113-01', ack: true, demo: true },
    ],
    seq: {},
  };
}

// 少量演示记录，便于查看"数据记录"页面效果（标记 demo:true，可在设置中清除）
function demoRecords(now) {
  const mk = (dayAgo, n, recipe, result, dur, p0, alarms) => {
    const start = now - dayAgo * 86400e3 - 3600e3 * (2 + n);
    const d = new Date(start), ds = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const pressure = []; for (let t = 0; t <= dur; t += 1) pressure.push([t, t < 3 ? p0 : Math.max(0.008, p0 * Math.pow(0.008 / p0, Math.min(1, (t - 3) / 7)) * (result === '报警' ? 1 : 1))]);
    if (result === '报警') pressure.forEach(p => { if (p[0] > 3) p[1] = Math.max(p0 * 0.55, p[1]); });
    return {
      id: 'rec-demo-' + dayAgo + '-' + n, demo: true, batch: `B-${ds}-0${n}`, sample: `SMP-QC-0${10 + dayAgo}`, recipe: recipe, reactor: 'R-01',
      operator: n % 2 ? '张工' : '操作员 01', start, end: start + dur * 1000, duration: dur, result, alarms, p0, pEnd: pressure.at(-1)[1],
      steps: [], events: [], pressure,
    };
  };
  return [
    mk(1, 1, '标准开釜投料 v1.2', '完成', 47.8, 2.35, 0),
    mk(1, 2, '标准开釜投料 v1.2', '完成', 48.3, 2.12, 0),
    mk(2, 1, '无塞瓶直投 v1.0', '完成', 36.9, 1.84, 0),
    mk(2, 2, '标准开釜投料 v1.2', '报警', 15.2, 2.40, 1),
    mk(4, 1, '慢速倾倒（高黏度） v0.9', '完成', 55.6, 2.61, 0),
    mk(5, 1, '标准开釜投料 v1.2', '中止', 22.4, 2.05, 1),
  ];
}

const Store = {
  load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const db = JSON.parse(raw), def = defaultDB();
        db.settings = { ...def.settings, ...db.settings };
        db.teach = { ...def.teach, ...db.teach };
        db.recipes.forEach(r => r.params = { ...DEFAULT_RECIPE_PARAMS, ...r.params });
        return db;
      }
    } catch (e) { console.warn('store load failed', e); }
    return defaultDB();
  },
  save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(DB)); } catch (e) { console.warn('store save failed', e); } },
  reset() { try { localStorage.removeItem(STORE_KEY); } catch (e) {} DB = defaultDB(); Store.save(); },
};

let DB = Store.load();

// ---- helpers ----
const uid = p => p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const curUser = () => DB.users.find(u => u.id === DB.settings.user) || DB.users[0];
const canEdit = () => curUser().role !== '操作员';
const canAdmin = () => curUser().role === '管理员';
const recipeLabel = r => `${r.name} v${r.version}`;
function nextBatchNo() {
  const d = new Date(), ds = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const n = (DB.seq[ds] || 0) + 1;
  return { no: `B-${ds}-${String(n).padStart(2, '0')}`, commit: () => { DB.seq[ds] = n; Store.save(); } };
}
const fmtDate = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${d.toTimeString().slice(0, 8)}`; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
