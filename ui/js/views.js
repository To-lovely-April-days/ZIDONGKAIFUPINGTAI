/* ==========================================================================
 * views.js — 首页 / 设备布局 / 工艺配方 / 数据记录 / 系统设置
 * ========================================================================== */
const DEVICES = [
  { id: 'arm', code: 'ARM-01', name: '六轴协作机械臂', model: 'HT-CR10 碳纤维协作臂', addr: () => `${DB.settings.armIp}:${DB.settings.armPort}`, fw: 'v3.6.2', color: 'var(--c-arm)' },
  { id: 'cap', code: 'CAP-01', name: '开盖模块', model: '伺服旋拧开盖单元', addr: () => `PLC · DB10`, fw: 'v1.4.0', color: 'var(--c-cap)' },
  { id: 'plug', code: 'PLG-01', name: '开塞模块', model: '充气针拔塞单元', addr: () => `PLC · DB11`, fw: 'v1.2.3', color: 'var(--c-plug)' },
  { id: 'rx', code: 'RX-01', name: '开釜模块', model: '哈夫卡箍开釜 + 泄压联锁', addr: () => `PLC · DB12`, fw: 'v2.0.1', color: 'var(--c-rx)' },
  { id: 'plc', code: 'PLC-01', name: '主控 PLC', model: 'S7-1200 / Modbus TCP 网关', addr: () => `${DB.settings.plcIp}:${DB.settings.plcPort}`, fw: 'v4.5', color: '#6b7280' },
];
const tag = (cls, txt) => `<span class="tag ${cls}">${esc(txt)}</span>`;
const resultTag = r => tag(r === '完成' ? 'ok' : r === '报警' ? 'err' : r === '中止' ? 'warn' : 'run', r);
function devState(id) {
  const busy = Manual.busy() || running;
  const a = activeMods();
  if (estop) return ['err', '急停'];
  if (id === 'plc') return ['ok', DB.settings.simulate ? '仿真在线' : '在线'];
  if (id === 'rx' && alarmActive()) return ['err', '联锁报警'];
  if (a.has(id)) return ['run', '运行中'];
  if (busy && Manual.cur && Manual.cur.label && devOfLabel(Manual.cur.label) === id) return ['run', '手动动作'];
  return ['ok', '就绪'];
}
function devOfLabel(l) { return /机械臂|夹爪(闭合|张开)$/.test(l) && !/开盖/.test(l) ? 'arm' : /开盖/.test(l) ? 'cap' : /开塞|充气针/.test(l) ? 'plug' : 'rx'; }
function devValues(id) {
  const r = S.rx, a = S.arm, g = gripWorld();
  switch (id) {
    case 'arm': return [['TCP X / Z / Y', `${(g.x * 100).toFixed(0)} / ${(g.z * 100).toFixed(0)} / ${(g.y * 100).toFixed(0)} mm`], ['J1 底座', a.j1.toFixed(1) + '°'], ['夹爪', a.grip > .9 ? '闭合' : a.grip < .1 ? '张开' : '动作中'], ['负载', a.holding ? '样品瓶' : '无']];
    case 'cap': return [['底部夹紧', S.cap.jaw > .9 ? '夹紧' : '松开'], ['夹头高度', (S.cap.z * 1.6).toFixed(1) + ' mm'], ['夹爪', S.cap.finger > .9 ? '夹紧' : '张开'], ['旋转角度', S.cap.rot.toFixed(0) + '°']];
    case 'plug': return [['底部夹紧', S.plug.jaw > .9 ? '夹紧' : '松开'], ['针头行程', ((130 - S.plug.z) * 1.6).toFixed(1) + ' mm'], ['充气', S.plug.bead > .5 ? '已充气' : '未充气'], ['胶塞', S.bottle.plug === 'needle' ? '已拔出' : S.bottle.plug === 'none' ? '无' : '在瓶上']];
    case 'rx': return [['釜内压力', r.p.toFixed(3) + ' MPa'], ['釜内温度', r.t.toFixed(1) + ' ℃'], ['泄压阀', r.vent > .5 ? '开启' : '关闭'], ['卡箍', r.clamp > .9 ? '松开' : '锁紧'], ['釜盖', r.slide > .9 ? '已移开' : r.lift > .05 ? '提升' : '闭合'], ['开釜联锁', r.locked ? '锁定' : '已解除']];
    case 'plc': return [['协议', DB.settings.plcProto], ['轮询周期', DB.settings.pollMs + ' ms'], ['通讯状态', DB.settings.simulate ? '仿真' : '已连接'], ['I/O 刷新', '正常']];
  }
}

/* ============================== 首页 ============================== */
const Home = {
  mount(el) {
    el.innerHTML = `<div class="vw home">
      <main class="hmain">
        <div class="hero"><div class="mark"><svg viewBox="0 0 24 24" width="26" height="26"><path d="M8 5.5v13l10.5-6.5z" fill="#fff"/></svg></div>
          <div><h1>自动开釜工作站</h1><div class="sub" id="hmSub"></div></div>
          <div class="hero-act"><button class="btn-s" data-go="run">运行监控</button><button class="btn-p" data-go="newjob">新建任务</button></div></div>
        <div class="section-h">设备状态<span class="rule"></span><a class="lnk" data-go="devices">设备布局</a></div>
        <div class="devlist" id="hmDev"></div>
        <div class="section-h">最近任务<span class="rule"></span><a class="lnk" data-go="records">查看全部</a></div>
        <div class="card3"><table class="tbl"><thead><tr><th>批次号</th><th>样品</th><th>配方</th><th>开始时间</th><th>用时</th><th>结果</th></tr></thead><tbody id="hmRec"></tbody></table></div>
        <div class="section-h">今日统计<span class="rule"></span></div>
        <div class="statrow" id="hmStat"></div>
      </main>
      <aside class="hside">
        <div class="statecard2"><div class="hd">当前任务</div><div class="bd" id="hmJob"></div></div>
        <div class="statecard2"><div class="hd">未确认报警<span id="hmAlN"></span></div><div class="bd" id="hmAl"></div></div>
        <div class="statecard2"><div class="hd">系统信息</div><div class="bd" id="hmSys"></div></div>
      </aside></div>`;
    el.addEventListener('click', e => {
      const g = e.target.closest('[data-go]'); if (g) { g.dataset.go === 'newjob' ? openNewJob() : showView(g.dataset.go); }
      const ack = e.target.closest('[data-ack]'); if (ack) { const a = DB.alarms.find(x => x.id === ack.dataset.ack); if (a) { a.ack = true; Store.save(); this.render(); } }
      const r = e.target.closest('[data-rec]'); if (r) { showView('records'); Records.select(r.dataset.rec); }
    });
  },
  render() {
    const [jc, jt] = sysState();
    $('hmSub').innerHTML = `系统 ${tag(jc || 'mute', jt)} · ${DB.settings.simulate ? '仿真模式' : '实机模式'} · 当前用户 ${esc(curUser().name)}（${curUser().role}）`;
    $('hmDev').innerHTML = DEVICES.map(d => { const [c, t] = devState(d.id), v = devValues(d.id).slice(0, 2);
      return `<div class="dv" data-go="devices"><div class="dv-h"><i class="led ${c}"></i><b>${d.name}</b><span>${d.code}</span></div>
        <div class="dv-st ${c}">${esc(t)}</div>${v.map(([k, x]) => `<div class="dv-kv"><span>${k}</span><b>${esc(x)}</b></div>`).join('')}</div>`; }).join('');
    const recs = DB.records.slice(0, 6);
    $('hmRec').innerHTML = recs.length ? recs.map(r => `<tr data-rec="${r.id}"><td><b>${esc(r.batch)}</b>${r.demo ? ' <span class="demo">示例</span>' : ''}</td><td>${esc(r.sample)}</td><td>${esc(r.recipe)}</td><td>${r.start ? fmtDate(r.start) : '--'}</td><td>${fmtS(r.duration)}</td><td>${resultTag(r.result)}</td></tr>`).join('')
      : `<tr><td colspan="6" class="empty">暂无记录</td></tr>`;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tr = DB.records.filter(r => r.start >= today.getTime()), ok = tr.filter(r => r.result === '完成');
    const al = DB.alarms.filter(a => a.time >= today.getTime());
    const avg = ok.length ? ok.reduce((a, r) => a + r.duration, 0) / ok.length : 0;
    $('hmStat').innerHTML = [['任务数', tr.length], ['完成', ok.length], ['成功率', tr.length ? Math.round(ok.length / tr.length * 100) + '%' : '--'], ['平均用时', ok.length ? fmtS(avg) : '--'], ['报警', al.length]]
      .map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    $('hmJob').innerHTML = JOB ? `<div class="kvrow2"><span>批次</span><b>${esc(JOB.batch)}</b></div><div class="kvrow2"><span>样品</span><b>${esc(JOB.sample)}</b></div><div class="kvrow2"><span>配方</span><b>${esc(JOB.recipe)}</b></div><div class="kvrow2"><span>状态</span><b>${tag(jc || 'mute', jt)}</b></div><div class="kvrow2"><span>已用时</span><b>${fmtT(elapsed)}</b></div><button class="btn-p full" data-go="run">进入运行监控</button>`
      : `<div class="empty2">当前没有任务</div><button class="btn-p full" data-go="newjob">新建任务</button>`;
    const un = DB.alarms.filter(a => !a.ack);
    $('hmAlN').textContent = un.length ? un.length : '';
    $('hmAl').innerHTML = un.length ? un.slice(0, 4).map(a => `<div class="alrow"><i></i><div><b>${esc(a.msg)}</b><span>${fmtDate(a.time)} · ${a.code}</span></div><button class="btn-s sm" data-ack="${a.id}">确认</button></div>`).join('') : `<div class="empty2">无未确认报警</div>`;
    $('hmSys').innerHTML = [['运行模式', DB.settings.simulate ? '仿真' : '实机'], ['主控 PLC', DB.settings.plcIp], ['机械臂控制器', DB.settings.armIp], ['开釜压力上限', P_SAFE + ' MPa'], ['配方数量', DB.recipes.length], ['软件版本', 'v1.0.0']].map(([k, v]) => `<div class="kvrow2"><span>${k}</span><b>${esc(v)}</b></div>`).join('');
  },
};

/* ============================== 设备布局 ============================== */
const Devices = {
  sel: 'arm',
  mount(el) {
    el.innerHTML = `<div class="vw"><div class="vtop"><h2>设备布局<small>Devices · 手动调试</small></h2><span class="sp"></span>
        <span class="note" id="dvNote"></span><button class="btn-s" id="dvReset">全部复位</button></div>
      <div class="vbody">
        <div class="pane dlist"><div class="plist" id="dvList"></div></div>
        <div class="pane dview"><div class="scene-wrap" id="dvScene"><div class="estop-banner"><div>紧急停止</div></div></div>
          <div class="queue" id="dvQueue"></div></div>
        <div class="pane dside"><div class="side-scroll pp" id="dvSide"></div></div>
      </div></div>`;
    $('dvReset').onclick = () => Modal.confirm('设备复位', '所有执行机构将回到初始位置（仿真状态重置）。确定继续？', resetDevices, '复位');
    el.addEventListener('click', e => {
      const it = e.target.closest('[data-dev]'); if (it) { this.sel = it.dataset.dev; this.renderSide(); this.render(); }
      const c = e.target.closest('[data-cmd]'); if (c) { const [d, i] = c.dataset.cmd.split(':'); manualCmds()[d][+i][1](); }
      if (e.target.id === 'tchSave') this.saveTeach();
    });
  },
  show() { this.renderSide(); },
  renderSide() {
    const d = DEVICES.find(x => x.id === this.sel), cmds = manualCmds()[d.id];
    const teach = d.id === 'arm' ? `<section class="ps"><div class="psh"><h4>示教点补偿</h4><span>单位 mm · 范围 ±50</span></div>
      <table class="tbl tight"><thead><tr><th>工位</th><th>ΔX</th><th>ΔZ</th></tr></thead><tbody>
      ${[['tray', '样品位'], ['cap', '开盖工位'], ['plug', '开塞工位'], ['rx', '釜口']].map(([k, n]) => `<tr><td>${n}</td><td><input class="inp xs" data-tk="${k}.dx" type="number" value="${DB.teach[k].dx}" ${canEdit() ? '' : 'disabled'}></td><td><input class="inp xs" data-tk="${k}.dz" type="number" value="${DB.teach[k].dz}" ${canEdit() ? '' : 'disabled'}></td></tr>`).join('')}
      </tbody></table><div class="acts"><span class="note">修改后下一次任务生效</span><button class="btn-p sm" id="tchSave" ${canEdit() ? '' : 'disabled'}>保存示教点</button></div></section>` : '';
    $('dvSide').innerHTML = `<section class="ps"><div class="psh"><h4>${d.name}</h4><span>${d.code}</span></div><div id="dvVals"></div></section>
      ${cmds ? `<section class="ps"><div class="psh"><h4>手动操作</h4><span id="dvMode"></span></div><div class="cmdgrid">${cmds.map((c, i) => `<button class="btn-s" data-cmd="${d.id}:${i}">${c[0]}</button>`).join('')}</div>
        ${d.id === 'rx' ? `<div class="note top">联锁：釜压 ≥ ${P_SAFE} MPa 时禁止松开卡箍；卡箍未松开禁止提升釜盖。</div>` : ''}</section>` : ''}
      ${teach}
      <section class="ps"><div class="psh"><h4>设备信息</h4></div>
        ${[['型号', d.model], ['通讯地址', d.addr()], ['固件版本', d.fw], ['累计运行', (1200 + DEVICES.indexOf(d) * 317) + ' h'], ['累计动作', (18452 + DEVICES.indexOf(d) * 2311).toLocaleString() + ' 次']].map(([k, v]) => `<div class="kvrow2"><span>${k}</span><b>${esc(v)}</b></div>`).join('')}</section>`;
  },
  saveTeach() {
    document.querySelectorAll('[data-tk]').forEach(i => { const [k, f] = i.dataset.tk.split('.'); DB.teach[k][f] = Math.max(-50, Math.min(50, Math.round(+i.value || 0))); });
    Store.save(); applySettings(); if (!autoActive()) resetEngine(); toast('示教点已保存', true); log('示教点补偿已更新', 'info'); this.renderSide();
  },
  render() {
    $('dvList').innerHTML = DEVICES.map(d => { const [c, t] = devState(d.id); return `<div class="pitem ${d.id === this.sel ? 'on' : ''}" data-dev="${d.id}" style="--dc:${d.color}"><i class="bar"></i><div><b>${d.name}</b><span>${d.code}</span></div>${tag(c, t)}</div>`; }).join('');
    const v = $('dvVals'); if (v) v.innerHTML = devValues(this.sel).map(([k, x]) => `<div class="kvrow2"><span>${k}</span><b>${esc(x)}</b></div>`).join('');
    const m = $('dvMode'); if (m) m.textContent = autoActive() ? '自动运行中 · 已锁定' : estop ? '急停' : '可操作';
    document.querySelectorAll('#dvSide [data-cmd]').forEach(b => b.disabled = autoActive() || estop);
    $('dvNote').textContent = autoActive() ? '自动流程运行中，手动操作已锁定' : '手动模式：右侧操作设备，3D 实时联动';
    $('dvQueue').innerHTML = Manual.cur ? `<span class="tag run">执行中</span> ${esc(Manual.cur.label)}${Manual.q.length ? ` · 队列 ${Manual.q.length}` : ''}` : `<span class="tag mute">空闲</span> 无手动动作`;
  },
};

/* ============================== 工艺配方 ============================== */
const PARAM_DEF = [
  ['开盖参数', [['capTurns', '旋转圈数', '圈', 1, 10, 1], ['capTorque', '扭矩上限', 'N·m', .5, 5, .1], ['capRise', '旋拧上升量', 'mm', 5, 30, 1]], 'doCap'],
  ['开塞参数', [['plugAir', '充气压力', 'MPa', .1, .6, .01], ['plugDepth', '刺入深度', 'mm', 5, 30, 1]], 'doPlug'],
  ['开釜参数', [['ventTarget', '泄压目标压力', 'MPa', .001, .04, .001], ['ventTimeout', '泄压超时', 's', 5, 120, 1]]],
  ['投料参数', [['pourAngle', '倾倒角度', '°', 60, 150, 1], ['pourTime', '倾倒时间', 's', 1, 20, .1], ['fillVolume', '投料体积', 'mL', 10, 1000, 10]]],
];
const Recipes = {
  sel: null, draft: null, q: '',
  mount(el) {
    el.innerHTML = `<div class="vw"><div class="vtop"><h2>工艺配方<small>Recipes</small></h2><span class="sp"></span><span class="note" id="rcRole"></span></div>
      <div class="vbody">
        <div class="pane rlist"><div class="ltool"><input class="inp" id="rcQ" placeholder="搜索配方"><button class="btn-p" id="rcNew">新建</button></div><div class="plist" id="rcList"></div></div>
        <div class="pane redit" id="rcEdit"></div>
      </div></div>`;
    $('rcQ').oninput = e => { this.q = e.target.value.trim(); this.renderList(); };
    $('rcNew').onclick = () => this.create();
    el.addEventListener('click', e => { const it = e.target.closest('[data-rcp]'); if (it) this.trySelect(it.dataset.rcp); });
  },
  show() { if (!this.sel || !DB.recipes.find(r => r.id === this.sel)) this.select(DB.recipes[0]?.id); else this.renderList(); $('rcRole').textContent = canEdit() ? '' : '当前为操作员权限，配方只读'; $('rcNew').disabled = !canEdit(); },
  dirty() { const r = DB.recipes.find(x => x.id === this.sel); return this.draft && r && JSON.stringify(this.draft) !== JSON.stringify({ name: r.name, version: r.version, desc: r.desc, params: r.params }); },
  trySelect(id) { if (id === this.sel) return; if (this.dirty()) Modal.confirm('放弃修改', '当前配方有未保存的修改，切换将丢失这些修改。', () => this.select(id), '放弃并切换'); else this.select(id); },
  select(id) { const r = DB.recipes.find(x => x.id === id); this.sel = id; this.draft = r ? JSON.parse(JSON.stringify({ name: r.name, version: r.version, desc: r.desc, params: r.params })) : null; this.renderList(); this.renderEdit(); },
  renderList() {
    const q = this.q.toLowerCase(), list = DB.recipes.filter(r => !q || (r.name + r.desc).toLowerCase().includes(q));
    $('rcList').innerHTML = list.map(r => `<div class="pitem ${r.id === this.sel ? 'on' : ''}" data-rcp="${r.id}"><i class="bar"></i><div><b>${esc(r.name)} <em>v${esc(r.version)}</em></b><span>${esc(r.desc || '—')}</span><span class="dt">更新于 ${fmtDate(r.updated).slice(0, 16)}</span></div></div>`).join('') || `<div class="empty2">没有匹配的配方</div>`;
  },
  renderEdit() {
    const d = this.draft, ro = canEdit() ? '' : 'disabled';
    if (!d) { $('rcEdit').innerHTML = `<div class="empty2">请选择或新建配方</div>`; return; }
    const p = d.params;
    $('rcEdit').innerHTML = `<div class="ehead"><div><h3>${esc(d.name || '未命名配方')} <em>v${esc(d.version)}</em></h3><span id="rcDirty"></span></div><span class="sp"></span>
        <button class="btn-s" id="rcUse">用此配方新建任务</button><button class="btn-s" id="rcCopy" ${ro}>复制</button><button class="btn-d" id="rcDel" ${ro}>删除</button><button class="btn-s" id="rcUndo" ${ro}>放弃修改</button><button class="btn-p" id="rcSave" ${ro}>保存</button></div>
      <div class="ebody"><div class="eform">
        <div class="fsec"><h4>基本信息</h4><div class="form">
          <label><span>配方名称</span><input data-f="name" value="${esc(d.name)}" ${ro}></label>
          <label><span>版本</span><input data-f="version" value="${esc(d.version)}" ${ro}></label>
          <label class="full"><span>说明</span><input data-f="desc" value="${esc(d.desc)}" ${ro}></label></div></div>
        <div class="fsec"><h4>工序</h4><div class="procs">
          <label class="pc ${p.doCap ? 'on' : ''}"><input type="checkbox" data-p="doCap" ${p.doCap ? 'checked' : ''} ${ro}><b>开盖</b><span>旋拧取下瓶盖</span></label>
          <label class="pc ${p.doPlug ? 'on' : ''}"><input type="checkbox" data-p="doPlug" ${p.doPlug ? 'checked' : ''} ${ro}><b>开塞</b><span>充气针拔出胶塞</span></label>
          <label class="pc on fixed"><input type="checkbox" checked disabled><b>开釜</b><span>泄压 · 联锁 · 开盖</span></label>
          <label class="pc on fixed"><input type="checkbox" checked disabled><b>投料</b><span>倾倒入釜 · 回收</span></label></div></div>
        ${PARAM_DEF.map(([title, fields, dep]) => `<div class="fsec ${dep && !p[dep] ? 'off' : ''}"><h4>${title}${dep && !p[dep] ? '<em>（工序未启用）</em>' : ''}</h4><div class="form three">
          ${fields.map(([k, n, u, mn, mx, stp]) => `<label><span>${n} <em>${mn}–${mx} ${u}</em></span><div class="iu"><input type="number" data-p="${k}" value="${p[k]}" min="${mn}" max="${mx}" step="${stp}" ${ro || (dep && !p[dep] ? 'disabled' : '')}><i>${u}</i></div></label>`).join('')}</div></div>`).join('')}
        <div class="verr" id="rcErr"></div>
      </div>
      <div class="eprev"><div class="psh"><h4>流程预览</h4><span id="rcEst"></span></div><ol class="pv" id="rcPrev"></ol></div></div>`;
    const ed = $('rcEdit');
    ed.oninput = e => {
      const t = e.target;
      if (t.dataset.f) d[t.dataset.f] = t.value;
      if (t.dataset.p) { d.params[t.dataset.p] = t.type === 'checkbox' ? t.checked : +t.value; if (t.type === 'checkbox') return this.renderEdit(); }
      this.refresh();
    };
    $('rcSave').onclick = () => this.save();
    $('rcUndo').onclick = () => this.select(this.sel);
    $('rcCopy').onclick = () => this.copy();
    $('rcDel').onclick = () => this.remove();
    $('rcUse').onclick = () => { if (this.dirty()) { toast('请先保存配方'); return; } openNewJob(this.sel); };
    this.refresh();
  },
  validate() {
    const d = this.draft, p = d.params, errs = [];
    if (!d.name.trim()) errs.push('配方名称不能为空');
    if (DB.recipes.some(r => r.id !== this.sel && r.name === d.name.trim() && r.version === d.version.trim())) errs.push('已存在同名同版本的配方');
    for (const [, fields, dep] of PARAM_DEF) if (!dep || p[dep]) for (const [k, n, u, mn, mx] of fields) if (!(p[k] >= mn && p[k] <= mx)) errs.push(`${n} 应在 ${mn}–${mx} ${u} 之间`);
    if (p.ventTarget >= P_SAFE) errs.push(`泄压目标压力必须低于系统开釜上限 ${P_SAFE} MPa`);
    return errs;
  },
  refresh() {
    const errs = this.validate();
    $('rcErr').innerHTML = errs.map(e => `<div>${esc(e)}</div>`).join('');
    $('rcDirty').innerHTML = this.dirty() ? tag('warn', '未保存') : '';
    if (canEdit()) $('rcSave').disabled = !this.dirty() || errs.length > 0;
    document.querySelectorAll('#rcEdit [data-p]').forEach(i => { if (i.type === 'number') { const [, , , mn, mx] = PARAM_DEF.flatMap(x => x[1]).find(f => f[0] === i.dataset.p); i.classList.toggle('bad', !(+i.value >= mn && +i.value <= mx)); } });
    if (errs.length) { $('rcPrev').innerHTML = ''; $('rcEst').textContent = '参数有误'; return; }
    const st = buildSteps(this.draft.params);
    const est = k => st[k].reduce((a, s) => a + estOf(s), 0);
    $('rcEst').textContent = `共 ${st.A.length + st.B.length} 步 · 预计 ${fmtS(Math.max(est('A'), est('B')))}`;
    $('rcPrev').innerHTML = `<li class="grp">A 线 · 机械臂 / 开盖 / 开塞 / 投料</li>` + st.A.map(s => `<li><span>${s.id}</span>${esc(s.name)}<em>${fmtS(estOf(s))}</em></li>`).join('')
      + `<li class="grp">B 线 · 开釜（与 A 线并行）</li>` + st.B.map(s => `<li><span>${s.id}</span>${esc(s.name)}<em>${fmtS(estOf(s))}</em></li>`).join('');
  },
  save() {
    const r = DB.recipes.find(x => x.id === this.sel), d = this.draft;
    Object.assign(r, { name: d.name.trim(), version: d.version.trim(), desc: d.desc.trim(), params: { ...d.params }, updated: Date.now() });
    Store.save(); this.select(r.id); toast('配方已保存', true); log(`配方已保存：${recipeLabel(r)}`, 'info');
  },
  create() {
    const go = () => { const r = { id: uid('rcp'), name: '新配方', version: '1.0', desc: '', updated: Date.now(), params: { ...DEFAULT_RECIPE_PARAMS } }; DB.recipes.unshift(r); Store.save(); this.select(r.id); };
    this.dirty() ? Modal.confirm('放弃修改', '当前配方有未保存的修改。', go, '放弃并新建') : go();
  },
  copy() { const d = this.draft, r = { id: uid('rcp'), name: d.name + ' 副本', version: d.version, desc: d.desc, updated: Date.now(), params: { ...d.params } }; DB.recipes.unshift(r); Store.save(); this.select(r.id); toast('已复制配方', true); },
  remove() {
    if (DB.recipes.length <= 1) { toast('至少保留一个配方'); return; }
    const r = DB.recipes.find(x => x.id === this.sel);
    Modal.confirm('删除配方', `确定删除配方 <b>${esc(recipeLabel(r))}</b>？已产生的运行记录不受影响。`, () => { DB.recipes = DB.recipes.filter(x => x.id !== r.id); Store.save(); this.select(DB.recipes[0].id); }, '删除', true);
  },
};

/* ============================== 数据记录 ============================== */
const Records = {
  tab: 'runs', sel: null, q: '', res: '', range: 'all',
  mount(el) {
    el.innerHTML = `<div class="vw"><div class="vtop"><h2>数据记录<small>Records</small></h2>
        <div class="tabs2"><span data-tab="runs" class="on">运行记录</span><span data-tab="alarms">报警记录</span></div><span class="sp"></span>
        <input class="inp" id="rdQ" placeholder="搜索批次号 / 样品 / 配方" style="width:220px">
        <select class="sel2" id="rdRange"><option value="all">全部时间</option><option value="1">今天</option><option value="7">近 7 天</option><option value="30">近 30 天</option></select>
        <select class="sel2" id="rdRes"><option value="">全部结果</option><option>完成</option><option>中止</option><option>报警</option></select>
        <button class="btn-s" id="rdCsv">导出 CSV</button></div>
      <div class="vbody"><div class="pane rtable"><div class="tscroll" id="rdTable"></div><div class="tfoot" id="rdFoot"></div></div><div class="pane rdetail" id="rdDetail"></div></div></div>`;
    el.querySelector('.tabs2').onclick = e => { const t = e.target.dataset.tab; if (!t) return; this.tab = t; el.querySelectorAll('.tabs2 span').forEach(s => s.classList.toggle('on', s.dataset.tab === t)); $('rdRes').style.display = t === 'runs' ? '' : 'none'; this.render(); };
    $('rdQ').oninput = e => { this.q = e.target.value.trim().toLowerCase(); this.render(); };
    $('rdRes').onchange = e => { this.res = e.target.value; this.render(); };
    $('rdRange').onchange = e => { this.range = e.target.value; this.render(); };
    $('rdCsv').onclick = () => this.csv();
    el.addEventListener('click', e => {
      const r = e.target.closest('[data-rid]'); if (r) this.select(r.dataset.rid);
      const a = e.target.closest('[data-aack]'); if (a) { const x = DB.alarms.find(y => y.id === a.dataset.aack); x.ack = true; Store.save(); this.render(); }
      if (e.target.id === 'rdAckAll') { DB.alarms.forEach(x => x.ack = true); Store.save(); this.render(); }
    });
  },
  show() { this.render(); },
  inRange(t) { if (this.range === 'all') return true; const d = new Date(); d.setHours(0, 0, 0, 0); return t >= d.getTime() - (+this.range - 1) * 86400e3; },
  runs() { return DB.records.filter(r => this.inRange(r.start) && (!this.res || r.result === this.res) && (!this.q || (r.batch + r.sample + r.recipe + (r.operator || '')).toLowerCase().includes(this.q))); },
  alarmsList() { return DB.alarms.filter(a => this.inRange(a.time) && (!this.q || (a.msg + a.code + a.batch).toLowerCase().includes(this.q))); },
  select(id) { this.sel = id; this.tab = 'runs'; document.querySelectorAll('#view-records .tabs2 span').forEach(s => s.classList.toggle('on', s.dataset.tab === 'runs')); this.render(); },
  render() {
    if (this.tab === 'runs') {
      const list = this.runs();
      if (!this.sel || !list.find(r => r.id === this.sel)) this.sel = list[0]?.id || null;
      $('rdTable').innerHTML = `<table class="tbl"><thead><tr><th>批次号</th><th>样品</th><th>配方</th><th>操作员</th><th>开始时间</th><th class="r">用时</th><th class="r">初始釜压</th><th>结果</th><th class="r">报警</th></tr></thead><tbody>
        ${list.map(r => `<tr data-rid="${r.id}" class="${r.id === this.sel ? 'sel' : ''}"><td><b>${esc(r.batch)}</b>${r.demo ? ' <span class="demo">示例</span>' : ''}</td><td>${esc(r.sample)}</td><td>${esc(r.recipe)}</td><td>${esc(r.operator || '')}</td><td>${r.start ? fmtDate(r.start) : '--'}</td><td class="r">${fmtS(r.duration)}</td><td class="r">${(+r.p0).toFixed(2)} MPa</td><td>${resultTag(r.result)}</td><td class="r">${r.alarms || 0}</td></tr>`).join('') || `<tr><td colspan="9" class="empty">没有符合条件的记录</td></tr>`}</tbody></table>`;
      const ok = list.filter(r => r.result === '完成').length;
      $('rdFoot').textContent = `共 ${list.length} 条 · 完成 ${ok} · 成功率 ${list.length ? Math.round(ok / list.length * 100) : 0}%`;
      this.renderDetail(DB.records.find(r => r.id === this.sel));
    } else {
      const list = this.alarmsList();
      $('rdTable').innerHTML = `<table class="tbl"><thead><tr><th>时间</th><th>代码</th><th>内容</th><th>批次</th><th>状态</th><th></th></tr></thead><tbody>
        ${list.map(a => `<tr><td>${fmtDate(a.time)}</td><td>${esc(a.code)}</td><td class="wrap">${esc(a.msg)}${a.demo ? ' <span class="demo">示例</span>' : ''}</td><td>${esc(a.batch || '--')}</td><td>${a.ack ? tag('mute', '已确认') : tag('err', '未确认')}</td><td class="r">${a.ack ? '' : `<button class="btn-s sm" data-aack="${a.id}">确认</button>`}</td></tr>`).join('') || `<tr><td colspan="6" class="empty">没有报警记录</td></tr>`}</tbody></table>`;
      $('rdFoot').innerHTML = `共 ${list.length} 条 · 未确认 ${list.filter(a => !a.ack).length} <button class="btn-s sm" id="rdAckAll">全部确认</button>`;
      $('rdDetail').innerHTML = `<div class="empty2">报警确认后会保留在记录中，可按时间与关键字筛选导出。</div>`;
    }
  },
  renderDetail(r) {
    if (!r) { $('rdDetail').innerHTML = `<div class="empty2">选择一条记录查看详情</div>`; return; }
    const steps = (r.steps || []).filter(s => s.t0 != null);
    const maxT = Math.max(r.duration, 1);
    $('rdDetail').innerHTML = `<div class="side-scroll pp">
      <section class="ps"><div class="psh"><h4>${esc(r.batch)}</h4>${resultTag(r.result)}</div>
        ${[['样品编号', r.sample], ['配方', r.recipe], ['反应釜', r.reactor], ['操作员', r.operator || '--'], ['开始', r.start ? fmtDate(r.start) : '--'], ['结束', r.end ? fmtDate(r.end) : '--'], ['总用时', fmtS(r.duration)], ['初始 / 结束釜压', `${(+r.p0).toFixed(3)} / ${r.pEnd != null ? (+r.pEnd).toFixed(3) : '--'} MPa`], ['报警次数', r.alarms || 0], ['备注', r.remark || '--']].map(([k, v]) => `<div class="kvrow2"><span>${k}</span><b>${esc(v)}</b></div>`).join('')}</section>
      <section class="ps"><div class="psh"><h4>釜压曲线</h4><span>MPa · 安全线 ${P_SAFE}</span></div>${pressureChart(r.pressure || [], maxT)}</section>
      ${steps.length ? `<section class="ps"><div class="psh"><h4>步骤耗时</h4><span>${steps.length} 步</span></div><div class="gantt">${steps.map(s => `<div class="gr"><span>${s.id}</span><div class="gt"><i class="${s.status}" style="left:${s.t0 / maxT * 100}%;width:${Math.max(.6, ((s.t1 ?? r.duration) - s.t0) / maxT * 100)}%"></i></div><em>${s.t1 != null ? fmtS(s.t1 - s.t0) : '--'}</em></div>`).join('')}</div></section>` : ''}
      ${(r.events || []).length ? `<section class="ps logc"><div class="psh"><h4>事件</h4><span>${r.events.length} 条</span></div><div class="logwrap" style="max-height:260px"><table class="lt"><tbody>${r.events.map(([t, c, m]) => `<tr class="${c}"><td class="t">${new Date(t).toTimeString().slice(0, 8)}</td><td class="l"><i></i></td><td>${esc(m)}</td></tr>`).join('')}</tbody></table></div></section>` : ''}
    </div>`;
  },
  csv() {
    const rows = this.tab === 'runs'
      ? [['批次号', '样品', '配方', '反应釜', '操作员', '开始时间', '结束时间', '用时(s)', '初始釜压(MPa)', '结束釜压(MPa)', '结果', '报警数', '备注'],
        ...this.runs().map(r => [r.batch, r.sample, r.recipe, r.reactor, r.operator, r.start ? fmtDate(r.start) : '', r.end ? fmtDate(r.end) : '', r.duration, r.p0, r.pEnd, r.result, r.alarms, r.remark || ''])]
      : [['时间', '代码', '内容', '批次', '状态'], ...this.alarmsList().map(a => [fmtDate(a.time), a.code, a.msg, a.batch, a.ack ? '已确认' : '未确认'])];
    const csv = '﻿' + rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `${this.tab === 'runs' ? '运行记录' : '报警记录'}_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
  },
};
function pressureChart(data, maxT) {
  const W = 320, H = 150, L = 34, R = 8, Tp = 8, B = 22, pw = W - L - R, ph = H - Tp - B;
  const maxP = Math.max(0.1, ...data.map(d => d[1])) * 1.1;
  const x = t => L + t / maxT * pw, y = p => Tp + ph - p / maxP * ph;
  const pts = data.map(d => `${x(d[0]).toFixed(1)},${y(d[1]).toFixed(1)}`).join(' ');
  const ticks = [0, maxP / 2, maxP].map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#eef0f3"/><text x="${L - 6}" y="${y(v) + 3}" text-anchor="end">${v.toFixed(v < 1 ? 2 : 1)}</text>`).join('');
  const xt = [0, .5, 1].map(f => `<text x="${x(maxT * f)}" y="${H - 6}" text-anchor="${f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}">${fmtS(maxT * f)}</text>`).join('');
  return `<svg class="pchart" viewBox="0 0 ${W} ${H}">${ticks}${xt}
    <line x1="${L}" x2="${W - R}" y1="${y(P_SAFE)}" y2="${y(P_SAFE)}" stroke="#16a34a" stroke-dasharray="4 3"/>
    ${data.length ? `<polyline points="${pts}" fill="none" stroke="#1a91d6" stroke-width="1.8" stroke-linejoin="round"/>` : `<text x="${W / 2}" y="${H / 2}" text-anchor="middle">无曲线数据</text>`}</svg>`;
}

/* ============================== 系统设置 ============================== */
const Settings = {
  sec: 'comm',
  mount(el) {
    el.innerHTML = `<div class="vw"><div class="vtop"><h2>系统设置<small>Settings</small></h2><span class="sp"></span><span class="note" id="stRole"></span></div>
      <div class="vbody"><div class="pane snav2" id="stNav"></div><div class="pane sbody2" id="stBody"></div></div></div>`;
    el.addEventListener('click', e => { const n = e.target.closest('[data-sec]'); if (n) { this.sec = n.dataset.sec; this.show(); } });
  },
  show() {
    const secs = [['comm', '通讯连接'], ['safety', '安全联锁'], ['sim', '仿真与调试'], ['users', '用户与权限'], ['data', '数据管理'], ['about', '关于']];
    $('stNav').innerHTML = secs.map(([k, n]) => `<div class="sn2 ${k === this.sec ? 'on' : ''}" data-sec="${k}">${n}</div>`).join('');
    $('stRole').textContent = canAdmin() ? '' : canEdit() ? '工程师权限：用户管理与数据清除不可用' : '操作员权限：设置只读';
    const s = DB.settings, ro = canEdit() ? '' : 'disabled', b = $('stBody');
    const fld = (k, n, type = 'text', extra = '') => `<label><span>${n}</span><input data-s="${k}" type="${type}" value="${esc(s[k])}" ${ro} ${extra}></label>`;
    const sw = (k, n, d) => `<label class="swrow"><div><b>${n}</b><span>${d}</span></div><input type="checkbox" data-s="${k}" ${s[k] ? 'checked' : ''} ${ro}></label>`;
    const save = `<div class="sact"><button class="btn-p" id="stSave" ${ro}>保存设置</button></div>`;
    const html = {
      comm: `<div class="fsec"><h4>主控 PLC</h4><div class="form three">${fld('plcIp', 'IP 地址')}${fld('plcPort', '端口', 'number')}<label><span>协议</span><select data-s="plcProto" ${ro}><option ${s.plcProto === 'Modbus TCP' ? 'selected' : ''}>Modbus TCP</option><option ${s.plcProto === 'S7 (ISO-on-TCP)' ? 'selected' : ''}>S7 (ISO-on-TCP)</option><option ${s.plcProto === 'OPC UA' ? 'selected' : ''}>OPC UA</option></select></label></div></div>
        <div class="fsec"><h4>机械臂控制器</h4><div class="form three">${fld('armIp', 'IP 地址')}${fld('armPort', '端口', 'number')}${fld('pollMs', '状态轮询周期 (ms)', 'number', 'min="20" max="1000"')}</div></div>
        <div class="fsec"><h4>连接测试</h4><div class="ctest"><button class="btn-s" id="stTest">测试连接</button><div id="stTestR" class="note"></div></div></div>${save}`,
      safety: `<div class="fsec"><h4>开釜压力联锁</h4><div class="form three">${fld('safeP', '开釜安全压力上限 (MPa)', 'number', 'step="0.001" min="0.005" max="0.2"')}</div>
          <div class="note top">釜压低于此值时联锁才会解除；配方中的泄压目标必须低于此值。修改后对新任务生效。</div></div>
        <div class="fsec"><h4>操作安全</h4>${sw('estopNeedReset', '急停解除后必须复位', '急停按钮释放后，需要按"复位"确认现场安全才能继续')}${sw('confirmOpen', '开釜前二次确认', '手动松开卡箍时弹出确认（实机模式）')}</div>${save}`,
      sim: `<div class="fsec"><h4>仿真模式</h4>${sw('simulate', '启用仿真模式', '未连接实机时，用 3D 模型模拟全部设备动作与压力变化')}</div>
        <div class="fsec"><h4>仿真参数</h4><div class="form three">${fld('simP0', '初始釜压 (MPa)', 'number', 'step="0.1" min="0" max="3"')}<label><span>默认倍速</span><select data-s="speed" ${ro}>${[.5, 1, 2, 4].map(v => `<option value="${v}" ${s.speed == v ? 'selected' : ''}>${v}×</option>`).join('')}</select></label></div>${sw('simFault', '模拟泄压阀故障', '泄压只能降到初始压力的约 55%，用于演示联锁报警')}</div>${save}`,
      users: `<div class="fsec"><h4>用户</h4><table class="tbl"><thead><tr><th>姓名</th><th>账号</th><th>角色</th><th>状态</th><th></th></tr></thead><tbody>
        ${DB.users.map(u => `<tr><td><b>${esc(u.name)}</b>${u.id === s.user ? ' <span class="demo">当前</span>' : ''}</td><td>${esc(u.id)}</td><td><select class="sel2" data-urole="${u.id}" ${canAdmin() && u.id !== s.user ? '' : 'disabled'}>${['管理员', '工程师', '操作员'].map(r => `<option ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select></td><td>${u.enabled ? tag('ok', '启用') : tag('mute', '停用')}</td>
          <td class="r">${canAdmin() && u.id !== s.user ? `<button class="btn-s sm" data-uen="${u.id}">${u.enabled ? '停用' : '启用'}</button> <button class="btn-d sm" data-udel="${u.id}">删除</button>` : ''}</td></tr>`).join('')}</tbody></table>
        ${canAdmin() ? `<div class="acts"><span></span><button class="btn-p" id="stUAdd">添加用户</button></div>` : ''}</div>
        <div class="fsec"><h4>角色权限</h4><table class="tbl tight"><thead><tr><th>功能</th><th>操作员</th><th>工程师</th><th>管理员</th></tr></thead><tbody>
        ${[['运行任务 / 急停', 1, 1, 1], ['手动调试设备', 1, 1, 1], ['编辑配方 / 示教点', 0, 1, 1], ['修改系统设置', 0, 1, 1], ['用户管理 / 清除数据', 0, 0, 1]].map(([n, ...v]) => `<tr><td>${n}</td>${v.map(x => `<td>${x ? '✓' : '—'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`,
      data: `<div class="fsec"><h4>本地数据</h4>${[['配方', DB.recipes.length + ' 个'], ['运行记录', DB.records.length + ' 条（其中示例 ' + DB.records.filter(r => r.demo).length + ' 条）'], ['报警记录', DB.alarms.length + ' 条'], ['存储位置', '本机（localStorage）']].map(([k, v]) => `<div class="kvrow2"><span>${k}</span><b>${v}</b></div>`).join('')}</div>
        <div class="fsec"><h4>维护</h4><div class="btnrow"><button class="btn-s" id="stDemo" ${canAdmin() ? '' : 'disabled'}>清除示例数据</button><button class="btn-s" id="stExport">导出全部数据（JSON）</button><button class="btn-d" id="stWipe" ${canAdmin() ? '' : 'disabled'}>恢复出厂设置</button></div></div>`,
      about: `<div class="about"><img src="assets/htlab-logo.png" alt="HTLAB"><div><h3>自动开釜工作站</h3><p>Auto Reactor Opening Station · 软件版本 v1.0.0</p><p>霍桐仪器 · HTLAB</p>
        <p class="note" id="abEnv"></p><p class="note">功能模块：机械臂转运、旋拧开盖、充气拔塞、泄压联锁开釜、倾倒投料、配方管理、运行与报警记录。</p></div></div>`,
    }[this.sec];
    b.innerHTML = `<div class="sform">${html}</div>`;
    const st = $('stSave'); if (st) st.onclick = () => this.save();
    const ab = $('abEnv'); if (ab) ab.textContent = window.APP_INFO ? `运行环境：${APP_INFO.platform} ${APP_INFO.arch} · Electron ${APP_INFO.electron} · Chromium ${APP_INFO.chrome}` : '运行环境：浏览器';
    const t = $('stTest'); if (t) t.onclick = async () => {
      $('stTestR').innerHTML = '正在连接…';
      if (window.hal) { const r = await hal.device.test(DB.settings); $('stTestR').innerHTML = `${tag(r.ok ? 'ok' : 'err', r.ok ? (r.mode === 'sim' ? '仿真' : '成功') : '失败')} ${esc(r.message)}${r.plc ? ` · 延迟 ${r.plc.latencyMs} ms` : ''}`; return; }
      setTimeout(() => { $('stTestR').innerHTML = `${tag('warn', '浏览器')} 当前在浏览器中运行，设备网关仅在桌面版可用`; }, 300);
    };
    b.onchange = e => { const u = e.target.dataset.urole; if (u) { DB.users.find(x => x.id === u).role = e.target.value; Store.save(); toast('角色已更新', true); } };
    b.onclick = e => {
      const en = e.target.dataset.uen, del = e.target.dataset.udel;
      if (en) { const u = DB.users.find(x => x.id === en); u.enabled = !u.enabled; Store.save(); this.show(); }
      if (del) Modal.confirm('删除用户', `确定删除用户 <b>${esc(DB.users.find(x => x.id === del).name)}</b>？`, () => { DB.users = DB.users.filter(x => x.id !== del); Store.save(); this.show(); }, '删除', true);
      if (e.target.id === 'stUAdd') this.addUser();
      if (e.target.id === 'stDemo') { DB.records = DB.records.filter(r => !r.demo); DB.alarms = DB.alarms.filter(a => !a.demo); Store.save(); toast('示例数据已清除', true); this.show(); }
      if (e.target.id === 'stExport') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(DB, null, 2)], { type: 'application/json' })); a.download = `htlab-ars-data-${new Date().toISOString().slice(0, 10)}.json`; a.click(); }
      if (e.target.id === 'stWipe') Modal.confirm('恢复出厂设置', '将清除全部配方、记录、报警、用户与设置，且无法撤销。确定继续？', () => { Store.reset(); location.reload(); }, '清除并重启', true);
    };
  },
  save() {
    const s = DB.settings, next = { ...s };
    document.querySelectorAll('#stBody [data-s]').forEach(i => { next[i.dataset.s] = i.type === 'checkbox' ? i.checked : i.type === 'number' || i.dataset.s === 'speed' ? +i.value : i.value.trim(); });
    if (!(next.safeP >= 0.005 && next.safeP <= 0.2)) { toast('开釜安全压力上限应在 0.005–0.2 MPa'); return; }
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(next.plcIp) || !/^\d{1,3}(\.\d{1,3}){3}$/.test(next.armIp)) { toast('IP 地址格式不正确'); return; }
    const bad = DB.recipes.filter(r => r.params.ventTarget >= next.safeP);
    Object.assign(s, next); Store.save(); applySettings();
    if (!autoActive()) { S.rx.p = s.simulate ? s.simP0 : S.rx.p; resetEngine(); }
    $('speed').value = String(s.speed); $('inP0').value = s.simP0; $('inFault').checked = s.simFault;
    toast(bad.length ? `设置已保存；注意 ${bad.length} 个配方的泄压目标不低于新上限` : '设置已保存', !bad.length);
    log('系统设置已更新', 'info'); updateStatusbar(); this.show();
  },
  addUser() {
    Modal.open({ title: '添加用户', okText: '添加', body: `<div class="form"><label><span>姓名</span><input id="nu-name"></label><label><span>账号</span><input id="nu-id"></label><label><span>角色</span><select id="nu-role"><option>操作员</option><option>工程师</option><option>管理员</option></select></label></div>`,
      onOk: () => { const n = $('nu-name').value.trim(), id = $('nu-id').value.trim(); if (!n || !id || DB.users.some(u => u.id === id)) { toast('请填写姓名与唯一账号'); return false; } DB.users.push({ id, name: n, role: $('nu-role').value, enabled: true }); Store.save(); this.show(); return true; } });
  },
};
