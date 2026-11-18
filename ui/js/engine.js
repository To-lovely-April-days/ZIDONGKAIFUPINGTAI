/* ==========================================================================
 * engine.js — 设备状态、运动学、工艺流程引擎、任务与记录、手动控制
 *
 * 设备抽象：所有执行机构的状态都放在 S 中（机械臂 / 开盖 / 开塞 / 反应釜）。
 * 仿真模式下由本文件的补间引擎驱动 S；接入实机时，每个 segment 对应一条
 * 下发给 PLC / 机械臂控制器的指令，S 改为由设备反馈刷新即可（见 docs）。
 * ========================================================================== */
const D2R = Math.PI / 180;
const SX = 760, SY = 320, L1 = 320, L2 = 300, TL = 120;   // 机械臂平面参数（px，1px = 1mm）
const BASE = { x: -3.8, z: -0.4 };                          // 机械臂基座（3D 单位 = 100mm）
// 工位名义坐标（与实物台面布局一致：机械臂左、托盘前、开盖/开塞并排在后、开釜右前）
const POS0 = { tray: { x: -1.2, z: 1.2 }, cap: { x: -0.2, z: -1.3 }, plug: { x: 1.2, z: -1.3 }, rx: { x: 3.4, z: 0.8 } };
let POS, P_SAFE;
function applySettings() {
  POS = {}; for (const k in POS0) POS[k] = { x: POS0[k].x + (DB.teach[k]?.dx || 0) / 100, z: POS0[k].z + (DB.teach[k]?.dz || 0) / 100 };
  P_SAFE = DB.settings.safeP;
  speed = DB.settings.speed || 1;
}

/* ---------- state ---------- */
function initState(params) {
  const p = params || DEFAULT_RECIPE_PARAMS;
  return {
    arm: { r: 100, fy: 220, tool: 0, j1: 0, grip: 0, bAng: 0, holding: false },
    bottle: { wx: POS.tray.x, wy: 0.53, wz: POS.tray.z, ry: 0, ang: 0, cap: p.doCap ? 'bottle' : 'none', plug: p.doPlug ? 'bottle' : 'none', liquid: 1 },
    cap: { jaw: 0, z: 110, rot: 0, finger: 0 },
    plug: { jaw: 0, z: 130, bead: 0 },
    rx: { p: DB.settings.simulate ? DB.settings.simP0 : 0.0, t: 82.6, vent: 0, locked: 1, clamp: 0, lift: 0, slide: 0, level: .30 },
    pour: 0
  };
}

/* ---------- kinematics ---------- */
function ik(r, fy) {
  const Fx = SX + r;
  let dx = r, dy = fy - SY, d = Math.hypot(dx, dy);
  d = Math.min(Math.max(d, Math.abs(L1 - L2) + 1), L1 + L2 - 1);
  const a = Math.atan2(dy, dx);
  const b = Math.acos((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d));
  const th1 = a - b;
  const ex = SX + L1 * Math.cos(th1), ey = SY + L1 * Math.sin(th1);
  return { th1, th2: Math.atan2(fy - ey, Fx - ex), ex, ey, Fx };
}
function gripWorld() {
  const a = S.arm, t = a.tool * D2R, j = a.j1 * D2R;
  const rg = (a.r - TL * Math.sin(t)) / 100, py = a.fy + TL * Math.cos(t);
  return { x: BASE.x + rg * Math.cos(j), y: (460 - py) / 100, z: BASE.z - rg * Math.sin(j) };
}
function jointAngles() {
  const a = S.arm, k = ik(a.r, a.fy);
  return [a.j1, -k.th1 / D2R, (k.th2 - k.th1) / D2R, 0, a.tool - k.th2 / D2R + 90, -a.bAng];
}
function attach() {
  const g = gripWorld(), b = S.bottle;
  if (Math.hypot(g.x - b.wx, g.y - b.wy, g.z - b.wz) < 0.25 || autoActive()) { S.arm.holding = true; S.arm.bAng = b.ang; }
}
function detach() {
  if (!S.arm.holding) return;
  const g = gripWorld(), b = S.bottle; b.wx = g.x; b.wy = g.y; b.wz = g.z; b.ry = S.arm.j1; b.ang = S.arm.bAng; S.arm.holding = false;
}
function aim(k) { const p = POS[k], dx = p.x - BASE.x, dz = p.z - BASE.z; return { j1: Math.atan2(-dz, dx) / D2R, rg: Math.hypot(dx, dz) * 100 }; }

/* ---------- tween primitives ---------- */
const ease = k => k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
const lin = k => k;
const mv = (r, y, d, extra = {}) => ({ d, to: Object.assign({ 'arm.r': r, 'arm.fy': y }, extra) });
const gripC = (d = .5) => ({ d, to: { 'arm.grip': 1 }, done: attach });
const gripO = (d = .4) => ({ d, to: { 'arm.grip': 0 }, on: detach });
const act = (d, to, extra = {}) => ({ d, to, ...extra });
function getP(p) { const a = p.split('.'); return a.length > 1 ? S[a[0]][a[1]] : S[a[0]]; }
function setP(p, v) { const a = p.split('.'); if (a.length > 1) S[a[0]][a[1]] = v; else S[a[0]] = v; }
function beginSeg(sg) { sg._t = 0; sg._from = {}; for (const k in (sg.to || {})) sg._from[k] = getP(k); sg.on && sg.on.call(sg); }
// advances one segment; returns progress k (0..1)
function tickSeg(sg, dt) {
  sg._t += dt;
  const k = Math.min(1, sg._t / sg.d), e = (sg.ease || ease)(k);
  for (const key in sg.to) setP(key, sg._from[key] + (sg.to[key] - sg._from[key]) * e);
  sg.tick && sg.tick.call(sg, k);
  return k;
}

/* ---------- process builder (driven by recipe params) ---------- */
const ST_NAME = { cap: '开盖工位', plug: '开塞工位' };
function buildSteps(p) {
  const tr = aim('tray'), rx = aim('rx'), A = [];
  const F = (a, back = 0) => a.rg - TL - back;
  const rxF = rx.rg - 82 * Math.sin(p.pourAngle * D2R) - TL;
  const stations = [p.doCap && 'cap', p.doPlug && 'plug'].filter(Boolean);
  const add = (name, mods, segs, subs) => A.push({ name, mods, segs, subs });

  add('机械臂移动至取样位', ['arm'], [mv(F(tr, 90), 330, 1.8, { 'arm.j1': tr.j1, 'arm.tool': -90 }), mv(F(tr, 90), 407, .8), mv(F(tr), 407, .7)], ['转向取样位', '下降至瓶身高度', '靠近样品瓶']);
  add('夹爪夹取样品瓶', ['arm'], [gripC(.6)], ['夹爪闭合']);

  let prev = null;
  for (const s of stations) {
    const a = aim(s);
    if (!prev) add(`转运至${ST_NAME[s]}`, ['arm'], [mv(F(tr), 290, .8), mv(F(a), 250, 2.0, { 'arm.j1': a.j1 }), mv(F(a), 395, 1)], ['提升', `转向${ST_NAME[s]}`, '下降放置']);
    else {
      const b = aim(prev);
      add(`取瓶转运至${ST_NAME[s]}`, ['arm', s], [mv(F(b), 395, .9), gripC(.5), act(.6, { [prev + '.jaw']: 0 }), mv(F(b), 330, .6), mv(F(a), 330, 1.4, { 'arm.j1': a.j1 }), mv(F(a), 395, .8)],
        ['靠近瓶身', '夹爪闭合', `${ST_NAME[prev]}松开`, '提升', `转向${ST_NAME[s]}`, '下降放置']);
    }
    add(`${ST_NAME[s]}夹紧 · 机械臂释放`, [s, 'arm'], [act(.8, { [s + '.jaw']: 1 }), gripO(.4), mv(F(a, 100), 395, .7), mv(F(a, 100), 270, .7)], ['底部夹紧', '夹爪张开', '后退', '抬升避让']);
    if (s === 'cap') {
      const turns = Math.max(1, p.capTurns);
      add('顶部夹爪下降夹紧瓶盖', ['cap'], [act(1.2, { 'cap.z': 0 }), act(.5, { 'cap.finger': 1 })], ['夹头下降', '夹爪夹紧瓶盖']);
      add('旋转上升 · 拧开瓶盖', ['cap'], [act(turns * 1.0, { 'cap.rot': turns * 360, 'cap.z': p.capRise }, { ease: lin, on: () => { S.bottle.cap = 'head'; } }), act(1.2, { 'cap.z': 110 })], [`旋转上升 ${turns * 360}°`, '提升带走瓶盖']);
    } else {
      add('充气针下降刺入胶塞', ['plug'], [act(1.4, { 'plug.z': 0 })], ['针头下降刺入']);
      add('充气 · 珠子弹出锁定', ['plug'], [act(1.2, { 'plug.bead': 1 })], [`充气至 ${p.plugAir.toFixed(2)} MPa`]);
      add('电机上升 · 拔出胶塞', ['plug'], [act(1.4, { 'plug.z': 130 }, { on: () => { S.bottle.plug = 'needle'; } })], ['电机上升拔塞']);
    }
    prev = s;
  }
  add('等待釜盖开启（联锁）', ['rx'], [{ until: () => T.B.done }], ['等待 B 线开釜完成']);
  if (prev) {
    const b = aim(prev);
    add('取瓶转运至釜口', ['arm'], [mv(F(b), 395, .9), gripC(.5), act(.6, { [prev + '.jaw']: 0 }), mv(F(b), 300, .7), mv(F(b, 80), 240, .8), mv(rxF, 240, 2.0, { 'arm.j1': rx.j1 }), mv(rxF, 330, 1.0)],
      ['靠近瓶身', '夹爪闭合', `${ST_NAME[prev]}松开`, '提升', '后撤', '转向釜口', '下降至投料位']);
  } else add('转运至釜口', ['arm'], [mv(F(tr), 290, .8), mv(rxF, 240, 2.2, { 'arm.j1': rx.j1 }), mv(rxF, 330, 1.0)], ['提升', '转向釜口', '下降至投料位']);
  const fill = Math.min(.95, .30 + p.fillVolume / 1000 * .8);
  add('倾倒投料入釜', ['arm', 'rx'], [act(1.4, { 'arm.bAng': -p.pourAngle }), act(.3, { pour: 1 }), act(p.pourTime, { 'bottle.liquid': 0, 'rx.level': fill }, { ease: lin }), act(.3, { pour: 0 }), act(1, { 'arm.bAng': 0 })],
    [`倾斜 ${p.pourAngle}°`, '开始倾倒', `倾倒 ${p.fillVolume} mL`, '停止倾倒', '回正']);
  add('空瓶放回 · 机械臂回原点', ['arm'], [mv(F(tr), 290, 1.8, { 'arm.j1': tr.j1 }), mv(F(tr), 407, .8), gripO(.4), mv(F(tr, 90), 407, .6), mv(F(tr, 90), 330, .6), mv(100, 220, 1.6, { 'arm.j1': 0, 'arm.tool': 0 })],
    ['转向样品位', '下降放回', '夹爪张开', '后退', '抬升', '回原点']);

  const B = [
    { name: '读取釜内压力 / 温度', mods: ['rx'], segs: [act(1.5, {})], subs: ['读取压力 / 温度'] },
    { name: '开启泄压阀 · 泄压', mods: ['rx'], subs: ['打开泄压阀', `泄压至 ${p.ventTarget} MPa`, '关闭泄压阀'], segs: [
      act(.4, { 'rx.vent': 1 }),
      { d: 7, to: {}, on: function () { this.p0 = S.rx.p; this.t0 = S.rx.t; }, tick: function (k) {
          const target = DB.settings.simulate && DB.settings.simFault ? this.p0 * .55 : p.ventTarget;
          S.rx.p = this.p0 <= target ? this.p0 : this.p0 * Math.pow(target / this.p0, k); S.rx.t = this.t0 - 4 * k; } },
      act(.4, { 'rx.vent': 0 })] },
    { name: `压力联锁校验（< ${P_SAFE} MPa）`, mods: ['rx'], subs: ['联锁校验'], segs: [act(1, {}, { done: () => {
        if (S.rx.p < P_SAFE) { S.rx.locked = 0; log(`联锁校验通过：釜压 ${S.rx.p.toFixed(3)} MPa，允许开釜`, 'ok'); return true; }
        interlockAlarm(); return false; } })] },
    { name: '卡箍松开', mods: ['rx'], segs: [act(1.4, { 'rx.clamp': 1 })], subs: ['卡箍松开'] },
    { name: '釜盖提升并移开', mods: ['rx'], segs: [act(1.2, { 'rx.lift': 1 }), act(1.6, { 'rx.slide': 1 })], subs: ['釜盖提升', '釜盖移开'] },
  ];
  A.forEach((s, i) => s.id = 'A' + (i + 1));
  B.forEach((s, i) => s.id = 'B' + (i + 1));
  return { A, B };
}
const estOf = st => st.segs.reduce((a, g) => a + (g.d || 0), 0);

/* ---------- engine ---------- */
let S, T, JOB = null, REC = null;
let running = false, stepMode = false, speed = 1, elapsed = 0, estop = false, finished = false, alarms = 0;
const autoActive = () => running || (elapsed > 0 && !finished);
const alarmActive = () => T && [...T.A.steps, ...T.B.steps].some(s => s.status === 'err');

function resetEngine(params) {
  const st = buildSteps(params || (JOB ? JOB.params : DEFAULT_RECIPE_PARAMS));
  T = {};
  for (const k of ['A', 'B']) {
    st[k].forEach(s => { s.status = 'pending'; s.prog = 0; s.est = estOf(s); s.t0 = s.t1 = null; });
    T[k] = { steps: st[k], i: 0, seg: -1, done: false };
  }
  window.onEngineReset && onEngineReset();
}
function advance(tr, dt) {
  if (tr.done) return;
  const st = tr.steps[tr.i];
  if (tr.seg < 0) { tr.seg = 0; st.status = 'run'; st.t0 = elapsed; log(`▶ ${st.id} ${st.name}`, 'info'); beginSeg(st.segs[0]); }
  const sg = st.segs[tr.seg];
  let fin;
  if (sg.until) { fin = sg.until(); st.prog = fin ? 1 : .5; }
  else { const k = tickSeg(sg, dt); st.prog = (tr.seg + k) / st.segs.length; fin = k >= 1; }
  if (!fin) return;
  if (sg.done && sg.done() === false) { st.status = 'err'; sg._t = 0; running = false; return; }
  tr.seg++;
  if (tr.seg >= st.segs.length) {
    st.status = 'done'; st.prog = 1; st.t1 = elapsed; log(`✔ ${st.id} ${st.name} 完成`, 'ok');
    tr.i++; tr.seg = -1;
    if (tr.i >= tr.steps.length) tr.done = true;
    if (stepMode) { running = false; stepMode = false; }
  } else beginSeg(st.segs[tr.seg]);
}
function engineTick(dt) {
  if (!running || estop) return;
  const sdt = dt * speed; elapsed += sdt;
  advance(T.A, sdt); advance(T.B, sdt);
  if (REC && elapsed - (REC._lastSample || -1) >= 0.5) { REC._lastSample = elapsed; REC.pressure.push([+elapsed.toFixed(1), +S.rx.p.toFixed(4)]); }
  if (T.A.done && T.B.done && !finished) {
    finished = true; running = false;
    log(`■ 全部流程完成：样品已投入反应釜 ${JOB.reactor}`, 'ok'); toast('流程完成：样品已投入反应釜', true);
    closeRecord('完成');
  }
}

/* ---------- alarms ---------- */
function raiseAlarm(code, msg) {
  alarms++;
  DB.alarms.unshift({ id: uid('al'), time: Date.now(), code, level: 'err', msg, batch: JOB ? JOB.batch : '', ack: false });
  if (DB.alarms.length > 500) DB.alarms.length = 500;
  if (REC) REC.alarms++;
  Store.save();
  log(msg, 'err'); toast(msg);
}
function interlockAlarm() { raiseAlarm('RX-101', `开釜联锁：釜压 ${S.rx.p.toFixed(2)} MPa ≥ ${P_SAFE} MPa，禁止开釜！`); }

/* ---------- jobs & records ---------- */
function newJob({ batch, sample, recipeId, reactor, remark }) {
  const r = DB.recipes.find(x => x.id === recipeId) || DB.recipes[0];
  JOB = { batch, sample, recipeId: r.id, recipe: recipeLabel(r), params: { ...r.params }, reactor, remark, operator: curUser().name };
  S = initState(JOB.params); resetEngine(JOB.params);
  running = false; stepMode = false; elapsed = 0; finished = false; alarms = 0;
  REC = { id: uid('rec'), batch, sample, recipe: JOB.recipe, reactor, operator: JOB.operator, remark, start: null, end: null, duration: 0, result: '进行中', alarms: 0, p0: S.rx.p, pEnd: null, steps: [], events: [], pressure: [] };
  window.onJobChanged && onJobChanged();
}
function startRun() {
  if (!JOB) { window.openNewJob && openNewJob(); return; }
  if (estop) { toast('请先解除急停并复位'); return; }
  if (finished) { toast('当前任务已完成，请新建任务'); window.openNewJob && openNewJob(); return; }
  if (Manual.busy()) { toast('手动动作执行中，请稍候'); return; }
  if (alarmActive()) { T.B.steps.forEach(s => { if (s.status === 'err') s.status = 'run'; }); log('报警确认，重试联锁校验', 'warn'); }
  if (elapsed === 0 && REC && !REC.start) { REC.start = Date.now(); log(`启动任务 ${JOB.batch} · ${JOB.recipe}`, 'info'); }
  running = true;
}
function closeRecord(result) {
  if (!REC || !REC.start) return;
  REC.end = Date.now(); REC.duration = +elapsed.toFixed(1); REC.result = result; REC.pEnd = S.rx.p;
  REC.steps = [...T.A.steps, ...T.B.steps].map(s => ({ id: s.id, name: s.name, t0: s.t0, t1: s.t1, status: s.status }));
  if (!REC.pressure.length || REC.pressure.at(-1)[0] !== +elapsed.toFixed(1)) REC.pressure.push([+elapsed.toFixed(1), +S.rx.p.toFixed(4)]);
  delete REC._lastSample;
  DB.records.unshift(REC); if (DB.records.length > 1000) DB.records.length = 1000;
  Store.save(); REC = null;
  window.onRecordsChanged && onRecordsChanged();
}
function abortJob() {
  if (REC && REC.start && !finished) { closeRecord(alarmActive() || estop ? '报警' : '中止'); log('任务已中止并保存记录', 'warn'); }
  running = false;
}

/* ---------- manual control (设备调试) ---------- */
const Manual = {
  q: [], cur: null,
  busy() { return !!this.cur || this.q.length > 0; },
  run(label, segs, check) {
    if (autoActive()) { toast('自动流程进行中，禁止手动操作'); return false; }
    if (estop) { toast('急停状态下禁止操作'); return false; }
    this.q.push({ label, segs: segs.map(s => ({ ...s })), i: -1, check });
    return true;
  },
  tick(dt) {
    if (estop) return;
    if (!this.cur) {
      const c = this.q.shift(); if (!c) return;
      // 联锁条件在动作真正开始时校验（排队期间状态可能已变化）
      const m = c.check && c.check();
      if (m) { toast(m); log('手动操作被拒绝：' + m, 'warn'); this.q = []; return; }
      this.cur = c; c.i = 0; beginSeg(c.segs[0]); log('手动：' + c.label, 'info');
    }
    const c = this.cur, sg = c.segs[c.i];
    if (tickSeg(sg, dt) >= 1) {
      sg.done && sg.done();
      c.i++;
      if (c.i >= c.segs.length) this.cur = null; else beginSeg(c.segs[c.i]);
    }
  },
};
// physical drift while idle: open vent bleeds pressure
function physicsTick(dt) {
  if (!autoActive() && S.rx.vent > .5 && S.rx.p > 0.005) S.rx.p = Math.max(0.005, S.rx.p * Math.exp(-dt * (DB.settings.simFault ? 0.04 : 0.6)));
}
function manualCmds() {
  const F = (k, back = 0) => aim(k).rg - TL - back;
  const goto = k => [mv(F(k, 90), 300, 1.6, { 'arm.j1': aim(k).j1, 'arm.tool': -90 })];
  return {
    arm: [
      ['回原点', () => Manual.run('机械臂回原点', [mv(100, 220, 1.6, { 'arm.j1': 0, 'arm.tool': 0 })])],
      ['至样品位', () => Manual.run('机械臂移动至样品位上方', goto('tray'))],
      ['至开盖工位', () => Manual.run('机械臂移动至开盖工位', goto('cap'))],
      ['至开塞工位', () => Manual.run('机械臂移动至开塞工位', goto('plug'))],
      ['至釜口', () => Manual.run('机械臂移动至釜口', goto('rx'))],
      ['夹爪闭合', () => Manual.run('夹爪闭合', [gripC(.5)])],
      ['夹爪张开', () => Manual.run('夹爪张开', [gripO(.4)])],
    ],
    cap: [
      ['底部夹紧', () => Manual.run('开盖工位底部夹紧', [act(.8, { 'cap.jaw': 1 })])],
      ['底部松开', () => Manual.run('开盖工位底部松开', [act(.8, { 'cap.jaw': 0 })])],
      ['夹头下降', () => Manual.run('开盖夹头下降', [act(1.2, { 'cap.z': 0 })])],
      ['夹头上升', () => Manual.run('开盖夹头上升', [act(1.2, { 'cap.z': 110 })])],
      ['夹爪夹紧', () => Manual.run('开盖夹爪夹紧', [act(.5, { 'cap.finger': 1 })])],
      ['夹爪松开', () => Manual.run('开盖夹爪松开', [act(.5, { 'cap.finger': 0 })])],
      ['旋转 +360°', () => Manual.run('开盖夹头旋转 360°', [act(1.2, { 'cap.rot': S.cap.rot + 360 }, { ease: lin })])],
    ],
    plug: [
      ['底部夹紧', () => Manual.run('开塞工位底部夹紧', [act(.8, { 'plug.jaw': 1 })])],
      ['底部松开', () => Manual.run('开塞工位底部松开', [act(.8, { 'plug.jaw': 0 })])],
      ['针头下降', () => Manual.run('充气针下降', [act(1.4, { 'plug.z': 0 })])],
      ['针头上升', () => Manual.run('充气针上升', [act(1.4, { 'plug.z': 130 })])],
      ['充气', () => Manual.run('充气针充气', [act(1, { 'plug.bead': 1 })])],
      ['排气', () => Manual.run('充气针排气', [act(1, { 'plug.bead': 0 })])],
    ],
    rx: [
      ['打开泄压阀', () => Manual.run('打开泄压阀', [act(.4, { 'rx.vent': 1 })])],
      ['关闭泄压阀', () => Manual.run('关闭泄压阀', [act(.4, { 'rx.vent': 0 })])],
      ['卡箍松开', () => Manual.run('卡箍松开', [act(1.4, { 'rx.clamp': 1 }, { on: () => { S.rx.locked = 0; } })],
        () => S.rx.p >= P_SAFE ? (interlockAlarm(), `釜压 ${S.rx.p.toFixed(3)} MPa 未低于 ${P_SAFE} MPa，联锁禁止松开卡箍`) : '')],
      ['卡箍锁紧', () => Manual.run('卡箍锁紧', [act(1.4, { 'rx.clamp': 0 }, { done: () => { S.rx.locked = 1; } })], () => S.rx.lift > .05 ? '釜盖未复位，不能锁紧卡箍' : '')],
      ['釜盖提升', () => Manual.run('釜盖提升', [act(1.2, { 'rx.lift': 1 })], () => S.rx.clamp < .95 ? '卡箍未松开，不能提升釜盖' : '')],
      ['釜盖移开', () => Manual.run('釜盖移开', [act(1.6, { 'rx.slide': 1 })], () => S.rx.lift < .95 ? '釜盖未提升到位' : '')],
      ['釜盖复位', () => Manual.run('釜盖复位', [act(1.6, { 'rx.slide': 0 }), act(1.2, { 'rx.lift': 0 })])],
    ],
  };
}
function resetDevices() {
  if (autoActive()) { toast('自动流程进行中，不能复位设备'); return; }
  Manual.q = []; Manual.cur = null;
  S = initState(JOB ? JOB.params : null);
  log('设备状态已复位到初始位置', 'warn');
}

/* ---------- log / toast (UI hooks, implemented in run.js) ---------- */
function log(msg, cls = '') {
  if (REC) REC.events.push([Date.now(), cls, msg.replace(/^[▶✔■]\s*/, '')]);
  window.uiLog && uiLog(msg, cls);
}
let toastTimer;
function toast(msg, ok) { const t = document.getElementById('toast'); t.textContent = msg; t.className = 'show' + (ok ? ' ok' : ''); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.className = '', 3200); }

applySettings();
S = initState();
resetEngine();
