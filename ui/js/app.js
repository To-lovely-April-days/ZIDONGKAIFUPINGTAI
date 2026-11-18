/* ==========================================================================
 * app.js — 弹窗、页面路由、用户切换、状态栏、主循环
 * ========================================================================== */
const Modal = {
  el: null,
  isOpen() { return !!this.el; },
  open({ title, body, okText = '确定', cancelText = '取消', danger = false, onOk, onMount }) {
    this.close();
    const m = document.createElement('div'); m.className = 'modal-mask';
    m.innerHTML = `<div class="modal"><div class="mh"><h3>${title}</h3><button class="mx" aria-label="关闭">×</button></div><div class="mb">${body}</div>
      <div class="mf"><button class="btn-s" data-x>${cancelText}</button><button class="${danger ? 'btn-dp' : 'btn-p'}" data-ok>${okText}</button></div></div>`;
    document.body.appendChild(m); this.el = m;
    const ok = () => { if (!onOk || onOk() !== false) this.close(); };
    m.querySelector('[data-ok]').onclick = ok;
    m.querySelector('[data-x]').onclick = m.querySelector('.mx').onclick = () => this.close();
    m.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') ok(); if (e.key === 'Escape') this.close(); });
    m.addEventListener('input', e => e.target.classList.remove('bad'));
    onMount && onMount(m);
  },
  confirm(title, html, onOk, okText = '确定', danger = false) { this.open({ title, body: `<p class="mtext">${html}</p>`, okText, danger, onOk: () => { onOk(); } }); },
  close() { if (this.el) { this.el.remove(); this.el = null; } },
};

/* ---------- router ---------- */
const VIEWS = { home: Home, devices: Devices, recipes: Recipes, run: null, records: Records, settings: Settings };
let curView = 'run';
const isView = v => curView === v;
function showView(v) {
  if (v === curView) return;
  if (curView === 'recipes' && Recipes.dirty()) { Modal.confirm('放弃修改', '当前配方有未保存的修改，离开将丢失这些修改。', () => { Recipes.draft = null; showView(v); }, '放弃并离开'); return; }
  curView = v;
  document.querySelectorAll('.view').forEach(e => e.classList.toggle('on', e.id === 'view-' + v));
  document.querySelectorAll('.mi[data-view]').forEach(e => e.classList.toggle('on', e.dataset.view === v));
  // 3D 视图在"运行监控"和"设备布局"之间共用一个渲染器
  const host = $('three');
  if (v === 'devices') $('dvScene').prepend(host);
  if (v === 'run') document.querySelector('#view-run .scene-wrap').prepend(host);
  const V = VIEWS[v]; V && V.show && V.show(); V && V.render && V.render();
}
document.querySelectorAll('.mi[data-view]').forEach(e => e.onclick = () => showView(e.dataset.view));
document.querySelectorAll('[data-link]').forEach(e => e.onclick = () => showView(e.dataset.link));

/* ---------- user menu ---------- */
function renderUser() {
  const u = curUser();
  $('userName').textContent = u.name; $('userRole').textContent = u.role + '权限';
}
$('userBox').onclick = e => {
  e.stopPropagation();
  const m = $('userMenu'); if (m.classList.toggle('on')) m.innerHTML = `<div class="um-h">切换用户（演示）</div>` + DB.users.filter(u => u.enabled).map(u => `<div class="um-i ${u.id === DB.settings.user ? 'on' : ''}" data-u="${u.id}"><b>${esc(u.name)}</b><span>${u.role}</span></div>`).join('');
};
$('userMenu').onclick = e => {
  const i = e.target.closest('[data-u]'); if (!i) return;
  DB.settings.user = i.dataset.u; Store.save(); renderUser(); $('userMenu').classList.remove('on');
  log(`切换用户：${curUser().name}（${curUser().role}）`, 'info');
  const V = VIEWS[curView]; V && V.show && V.show();
};
document.addEventListener('click', () => $('userMenu').classList.remove('on'));

function updateStatusbar() {
  const s = DB.settings;
  $('sbPlc').innerHTML = `<i class="dot"></i>PLC ${s.simulate ? '仿真' : '已连接'} ${esc(s.plcIp)}`;
  $('sbArm').innerHTML = `<i class="dot"></i>机械臂控制器 ${s.simulate ? '仿真' : '在线'} ${esc(s.armIp)}`;
}
window.onRecordsChanged = () => { if (isView('records')) Records.render(); };

/* ---------- main loop ---------- */
for (const k in VIEWS) if (VIEWS[k]) VIEWS[k].mount($('view-' + k));
let last = performance.now(), rt = 0, uiT = 0, homeT = 0;
function loop(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now; rt += dt;
  engineTick(dt);
  if (!running) Manual.tick(dt * speed);
  physicsTick(dt);
  if (window.render3D && (isView('run') || isView('devices'))) window.render3D(rt);
  uiT += dt;
  if (uiT > .1) {
    uiT = 0;
    renderChrome();
    if (isView('run')) renderRun();
    else if (isView('devices')) Devices.render();
    else if (isView('home') && rt - homeT > .5) { homeT = rt; Home.render(); }
  }
  requestAnimationFrame(loop);
}

/* ---------- desktop shell (Electron) ---------- */
if (window.hal) {
  document.body.classList.add('desktop', 'os-' + hal.platform);
  document.querySelectorAll('[data-win]').forEach(b => b.onclick = () => ({ min: hal.win.minimize, max: hal.win.toggleMaximize, close: hal.win.close })[b.dataset.win]());
  document.querySelector('.titlebar').ondblclick = e => { if (!e.target.closest('[data-win],.lk')) hal.win.toggleMaximize(); };
  hal.device.connect(DB.settings).then(r => log('设备网关：' + r.message, r.ok ? 'ok' : 'warn'));
  hal.info().then(i => { window.APP_INFO = i; });
}
renderUser(); updateStatusbar(); buildList(); onJobChanged();
renderRun();
log('系统就绪 · ARM-01 / CAP-01 / PLG-01 / RX-01 ' + (DB.settings.simulate ? '仿真连接' : '通讯正常'), 'ok');
showView('home');
requestAnimationFrame(loop);
