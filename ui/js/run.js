/* ==========================================================================
 * run.js — 运行监控页：时间轴、模块状态、右侧面板、日志、启停控制、新建任务
 * ========================================================================== */
const $ = id => document.getElementById(id);
const fmtS = v => v < 60 ? v.toFixed(1) + 's' : Math.floor(v / 60) + 'm' + String(Math.round(v % 60)).padStart(2, '0') + 's';
const fmtT = v => `${String(Math.floor(v / 60)).padStart(2, '0')}:${(v % 60).toFixed(1).padStart(4, '0')}`;
let needReset = false;

/* ---------- timeline ---------- */
function buildList() {
  for (const k of ['A', 'B']) {
    $('list' + k).innerHTML = T[k].steps.map(s =>
      `<li class="tl pending" id="st-${s.id}"><i class="nd"></i><div class="tr1"><span class="idx">${s.id}</span><span class="nm">${esc(s.name)}</span><span class="tm"></span></div><ul class="subs">${s.subs.map(x => `<li>${esc(x)}</li>`).join('')}</ul></li>`).join('');
  }
  window._tlCur = null;
}
window.onEngineReset = buildList;
window.onJobChanged = () => {
  $('jobId').textContent = JOB ? JOB.batch : '未创建任务';
  $('jobMeta').textContent = JOB ? `样品 ${JOB.sample} · ${JOB.recipe} · 目标釜 ${JOB.reactor}` : '点击"新建任务"选择配方并录入样品信息';
  $('tbTitle').textContent = `HTLAB 自动开釜工作站` + (JOB ? ` - 批次 ${JOB.batch} · 反应釜 ${JOB.reactor}` : '');
  $('log').innerHTML = '';
};

/* ---------- log ---------- */
const LVN = { ok: '完成', info: '信息', warn: '警告', err: '报警', '': '信息' };
window.uiLog = (msg, cls) => {
  const tb = $('log'), tr = document.createElement('tr'); tr.className = cls;
  tr.innerHTML = `<td class="t">${new Date().toTimeString().slice(0, 8)}</td><td class="l"><i></i><span>${LVN[cls]}</span></td><td>${esc(msg.replace(/^[▶✔■]\s*/, ''))}</td>`;
  tb.appendChild(tr); while (tb.children.length > 300) tb.firstChild.remove();
  const w = $('logwrap'); w.scrollTop = w.scrollHeight;
  $('alarmCnt').textContent = alarms ? `报警 ${alarms}` : '无报警';
};

/* ---------- panels ---------- */
function setTxt(id, txt, cls) { const e = $(id); if (!e) return; e.textContent = txt; e.className = cls || ''; }
$('joints').innerHTML = [1, 2, 3, 4, 5, 6].map(i => `<div class="jr"><span>J${i}</span><div class="jt"><em id="jb${i}"></em></div><b id="j${i}">0.0°</b></div>`).join('');
function activeMods() {
  const s = new Set();
  for (const k of ['A', 'B']) for (const st of T[k].steps) if (st.status === 'run' || st.status === 'err') st.mods.forEach(m => s.add(m));
  return s;
}
function modStatus(m) {
  let any = false, all = true, err = false;
  for (const k of ['A', 'B']) for (const st of T[k].steps) if (st.mods[0] === m) { any = true; if (st.status !== 'done') all = false; if (st.status === 'err') err = true; }
  return err ? ['err', '报警'] : any && all ? ['done', '完成'] : ['', '空闲'];
}

function renderRun() {
  const a = S.arm;
  jointAngles().forEach((v, i) => {
    $('j' + (i + 1)).textContent = v.toFixed(1) + '°';
    const f = Math.max(-1, Math.min(1, v / 180)) * 50, e = $('jb' + (i + 1));
    e.style.left = (f >= 0 ? 50 : 50 + f) + '%'; e.style.width = Math.abs(f) + '%';
  });
  const g = gripWorld();
  setTxt('aTcp', `${(g.x * 100).toFixed(0)}, ${(g.z * 100).toFixed(0)}, ${(g.y * 100).toFixed(0)}`);
  setTxt('aGrip', a.grip > .9 ? '闭合' : a.grip < .1 ? '张开' : '动作中', a.grip > .9 ? 'warn' : 'ok');
  setTxt('aLoad', a.holding ? (0.18 + 0.32 * S.bottle.liquid).toFixed(2) + ' kg' : '0.00 kg', a.holding ? 'acc' : '');
  setTxt('aTilt', a.holding ? (-a.bAng).toFixed(0) + '°' : '--');
  const cp = S.cap, b = S.bottle;
  setTxt('cJaw', cp.jaw > .9 ? '夹紧' : cp.jaw < .1 ? '松开' : '动作中', cp.jaw > .9 ? 'warn' : 'ok');
  setTxt('cFin', cp.finger > .9 ? '夹紧' : '张开', cp.finger > .9 ? 'warn' : 'ok');
  setTxt('cRot', cp.rot.toFixed(0) + '°');
  setTxt('cZ', (cp.z * 1.6).toFixed(1) + ' mm');
  const rotating = b.cap === 'head' && cp.z < 20 && running;
  setTxt('cTq', rotating ? (1.6 + Math.random() * .3).toFixed(2) + ' N·m' : '0.00 N·m', rotating ? 'acc' : '');
  setTxt('cCap', b.cap === 'bottle' ? '在瓶上' : b.cap === 'none' ? '无' : '已取下', b.cap === 'head' ? 'ok' : '');
  const pl = S.plug, air = JOB ? JOB.params.plugAir : .35;
  setTxt('pJaw', pl.jaw > .9 ? '夹紧' : pl.jaw < .1 ? '松开' : '动作中', pl.jaw > .9 ? 'warn' : 'ok');
  setTxt('pZ', ((130 - pl.z) * 1.6).toFixed(1) + ' mm');
  setTxt('pAir', (pl.bead * air).toFixed(2) + ' MPa', pl.bead > .5 ? 'acc' : '');
  setTxt('pPlug', b.plug === 'bottle' ? '在瓶上' : b.plug === 'none' ? '无' : '已拔出', b.plug === 'needle' ? 'ok' : '');

  const r = S.rx;
  $('gVal').textContent = r.p.toFixed(3);
  $('mPtr').style.left = Math.min(1, r.p / 3) * 100 + '%';
  const ms = $('mState'); ms.className = 'mst ' + (r.p < P_SAFE ? 'ok' : r.p < 1 ? 'warn' : ''); ms.textContent = r.p < P_SAFE ? '安全' : r.p < 1 ? '偏高' : '高压';
  $('lockSq').className = 'sq ' + (r.locked ? 'off' : 'on');
  setTxt('rT', r.t.toFixed(1) + ' ℃');
  setTxt('rLock', r.locked ? '锁定' : '已解除', r.locked ? 'err' : 'ok');
  $('safeTxt').textContent = P_SAFE.toFixed(3) + ' MPa';
  setTxt('rVent', r.vent > .5 ? '开启' : '关闭', r.vent > .5 ? 'acc' : '');
  setTxt('rClamp', r.clamp > .9 ? '松开' : r.clamp < .1 ? '锁紧' : '动作中', r.clamp > .9 ? 'ok' : 'warn');
  setTxt('rLid', r.slide > .9 ? '已移开' : r.lift > .05 ? '提升' : '闭合', r.slide > .9 ? 'ok' : '');
  setTxt('rLvl', (r.level * 100).toFixed(0) + ' %');
  $('simBox').style.display = DB.settings.simulate ? '' : 'none';

  const act = activeMods();
  for (const m of ['arm', 'cap', 'plug', 'rx']) {
    $('card-' + m).classList.toggle('active', act.has(m));
    $('pl-' + m).classList.toggle('on', act.has(m));
    const [cls, txt] = modStatus(m), p = $('pill-' + m);
    p.className = 'pill ' + (act.has(m) && cls !== 'err' ? 'run' : cls); p.textContent = act.has(m) && cls !== 'err' ? '运行中' : txt;
  }

  let done = 0, total = 0;
  for (const kk of ['A', 'B']) for (const st of T[kk].steps) {
    total++; if (st.status === 'done') done++;
    const li = $('st-' + st.id); if (!li) continue;
    li.className = 'tl ' + st.status;
    const tm = li.querySelector('.tm');
    tm.title = st.t0 != null ? '开始于 T+' + fmtT(st.t0) : '';
    tm.textContent = st.status === 'done' ? fmtS(st.t1 - st.t0) : st.status === 'run' ? `进行中 · ${fmtS(elapsed - st.t0)}` : st.status === 'err' ? '联锁报警' : `约 ${fmtS(st.est)}`;
    if (st.status === 'run' && kk === 'A' && window._tlCur !== st.id && isView('run')) { window._tlCur = st.id; li.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    if (st.status === 'run' || st.status === 'err') {
      const tr = T[kk], cur = tr.steps[tr.i] === st ? tr.seg : -1;
      li.querySelectorAll('.subs li').forEach((e, n) => e.className = n < cur ? 'ok' : n === cur ? (st.status === 'err' ? 'bad' : 'cur') : '');
    }
  }
  $('progBar').style.width = (done / total * 100) + '%';
  $('progTxt').textContent = `${done} / ${total} 步 · ${fmtT(elapsed)}`;
  $('progPct').textContent = Math.round(done / total * 100);
  const cur = tr => tr.done ? '已完成' : (tr.steps.find(s => s.status === 'run' || s.status === 'err') || {}).name || (elapsed > 0 ? '等待中' : '待启动');
  $('lineA').textContent = cur(T.A); $('lineB').textContent = cur(T.B);

  const [jc, jt] = sysState();
  const js = $('jobSt'); js.className = 'job-st ' + jc; js.textContent = jt;
  const remOf = tr => tr.steps.reduce((a, st) => a + (st.status === 'done' ? 0 : st.status === 'run' ? st.est * (1 - st.prog) : st.est), 0);
  $('tlEl').textContent = fmtT(elapsed);
  $('tlRem').textContent = finished ? '00:00.0' : fmtT(Math.max(remOf(T.A), remOf(T.B)));
  $('tlCnt').textContent = `${done} / ${total}`;
  $('tlBar').style.width = (done / total * 100) + '%';
  $('btnAbort').disabled = !(JOB && elapsed > 0 && !finished);
}

// global system state used by header, run view and home
function sysState() {
  return estop ? ['err', '急停'] : alarmActive() ? ['err', '报警'] : needReset ? ['warn', '待复位'] : finished ? ['ok', '已完成'] : running ? ['run', '执行中']
    : Manual.busy() ? ['run', '手动动作'] : !JOB ? ['', '待机'] : elapsed > 0 ? ['warn', '已暂停'] : ['', '待启动'];
}
function renderChrome() {
  const [jc, jt] = sysState(), r = S.rx;
  const cs = $('chipState'); cs.className = 'chip ' + jc; cs.innerHTML = '系统 <b>' + jt + '</b>';
  const cl = $('chipLock'); cl.className = 'chip ' + (r.locked ? 'err' : 'ok'); cl.innerHTML = '开釜联锁 <b>' + (r.locked ? '锁定' : '解除') + '</b>';
  const cpp = $('chipP'); cpp.className = 'chip ' + (r.p < P_SAFE ? 'ok' : 'warn'); cpp.innerHTML = '釜压 <b>' + r.p.toFixed(r.p < .1 ? 3 : 2) + ' MPa</b>';
  $('btnStart').disabled = running || estop;
  $('btnPause').disabled = !running;
  $('btnStep').disabled = running || estop || finished || !JOB;
  $('simLabel').innerHTML = (DB.settings.simulate ? '仿真模式' : '自动模式') + `<small>${JOB ? esc(JOB.batch) : '无任务'}</small>`;
  $('clock').textContent = new Date().toLocaleString('zh-CN', { hour12: false });
}

/* ---------- controls ---------- */
$('btnStart').onclick = () => { if (needReset) { toast('急停已解除，请先按"复位"'); return; } startRun(); };
$('btnPause').onclick = () => { running = false; log('流程暂停', 'warn'); };
$('btnStep').onclick = () => { if (needReset) { toast('请先复位'); return; } stepMode = true; startRun(); };
$('btnReset').onclick = () => {
  const go = () => {
    if (estop) toggleEstop();
    needReset = false;
    abortJob();
    if (JOB && (finished || elapsed > 0)) JOB = null;
    S = initState(JOB ? JOB.params : null); resetEngine(); elapsed = 0; finished = false; running = false;
    Manual.q = []; Manual.cur = null;
    onJobChanged(); log('系统复位', 'warn');
  };
  if (JOB && elapsed > 0 && !finished) Modal.confirm('复位系统', `当前任务 <b>${esc(JOB.batch)}</b> 尚未完成，复位将中止任务并保存为"中止"记录。确定继续？`, go, '中止并复位');
  else go();
};
$('btnAbort').onclick = () => Modal.confirm('中止任务', `确定中止任务 <b>${esc(JOB.batch)}</b>？已执行的动作会保存到数据记录。`, () => { abortJob(); JOB = null; onJobChanged(); }, '中止任务');
$('btnNewJob').onclick = () => openNewJob();
$('speed').value = String(DB.settings.speed); $('speed').onchange = e => { speed = DB.settings.speed = +e.target.value; Store.save(); };
function toggleEstop() {
  estop = !estop;
  $('btnEstop').classList.toggle('on', estop);
  document.querySelectorAll('.estop-banner').forEach(e => e.classList.toggle('on', estop));
  if (estop) { running = false; raiseAlarm('SYS-001', '急停按下，所有轴已停止'); }
  else { needReset = DB.settings.estopNeedReset; log('急停已解除' + (needReset ? '，请按"复位"后继续' : ''), 'warn'); }
}
$('btnEstop').onclick = toggleEstop;
$('btnTryOpen').onclick = () => {
  if (S.rx.p >= P_SAFE) interlockAlarm();
  else if (S.rx.locked) toast('釜压已低于上限，可在"设备布局"中手动松开卡箍', true);
  else toast('联锁已解除', true);
};
$('inP0').value = DB.settings.simP0; $('inFault').checked = DB.settings.simFault;
$('inP0').onchange = () => { DB.settings.simP0 = Math.max(0, Math.min(3, +$('inP0').value || 0)); Store.save(); if (!autoActive()) S.rx.p = DB.settings.simP0; };
$('inFault').onchange = () => { DB.settings.simFault = $('inFault').checked; Store.save(); };
document.addEventListener('keydown', e => {
  if (e.code === 'Space' && isView('run') && !/INPUT|SELECT|TEXTAREA|BUTTON/.test(e.target.tagName) && !Modal.isOpen()) { e.preventDefault(); running ? $('btnPause').click() : $('btnStart').click(); }
});

/* ---------- new job dialog ---------- */
function openNewJob(presetRecipe) {
  if (autoActive()) { toast('当前任务执行中，请先完成或中止'); return; }
  const bn = nextBatchNo();
  Modal.open({
    title: '新建任务', okText: '创建并进入监控',
    body: `<div class="form">
      <label><span>批次号</span><input id="nj-batch" value="${bn.no}"></label>
      <label><span>样品编号 <em class="req">*</em></span><input id="nj-sample" placeholder="例如 SMP-QC-017"></label>
      <label><span>工艺配方</span><select id="nj-recipe">${DB.recipes.map(r => `<option value="${r.id}" ${r.id === presetRecipe ? 'selected' : ''}>${esc(recipeLabel(r))}</option>`).join('')}</select></label>
      <label><span>目标反应釜</span><select id="nj-rx"><option>${DB.settings.reactor}</option></select></label>
      <label><span>操作员</span><input value="${esc(curUser().name)}" disabled></label>
      <label class="full"><span>备注</span><input id="nj-remark" placeholder="选填"></label>
      <div class="full hint2" id="nj-sum"></div>
    </div>`,
    onMount() {
      const upd = () => { const r = DB.recipes.find(x => x.id === $('nj-recipe').value), st = buildSteps(r.params), est = Math.max(st.A.reduce((a, s) => a + estOf(s), 0), st.B.reduce((a, s) => a + estOf(s), 0));
        $('nj-sum').textContent = `工序：${[r.params.doCap && '开盖', r.params.doPlug && '开塞', '开釜', '投料'].filter(Boolean).join(' → ')} · 共 ${st.A.length + st.B.length} 步 · 预计 ${fmtS(est)}（1× 速度）`; };
      $('nj-recipe').onchange = upd; upd(); setTimeout(() => $('nj-sample').focus(), 50);
    },
    onOk() {
      const sample = $('nj-sample').value.trim(), batch = $('nj-batch').value.trim();
      if (!sample) { $('nj-sample').classList.add('bad'); $('nj-sample').focus(); return false; }
      if (!batch) { $('nj-batch').classList.add('bad'); return false; }
      if (batch === bn.no) bn.commit();
      newJob({ batch, sample, recipeId: $('nj-recipe').value, reactor: $('nj-rx').value, remark: $('nj-remark').value.trim() });
      log(`创建任务 ${batch} · 样品 ${sample}`, 'info');
      showView('run');
      return true;
    }
  });
}
