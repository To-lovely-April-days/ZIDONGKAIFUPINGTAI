// 把 three.js 及用到的扩展模块复制到 ui/vendor/three，供离线使用（npm install 后自动执行）
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'node_modules', 'three');
const dst = path.join(root, 'ui', 'vendor', 'three');
const files = [
  ['build/three.module.js', 'three.module.js'],
  ['examples/jsm/controls/OrbitControls.js', 'addons/controls/OrbitControls.js'],
  ['examples/jsm/environments/RoomEnvironment.js', 'addons/environments/RoomEnvironment.js'],
  ['examples/jsm/renderers/CSS2DRenderer.js', 'addons/renderers/CSS2DRenderer.js'],
  ['examples/jsm/geometries/RoundedBoxGeometry.js', 'addons/geometries/RoundedBoxGeometry.js'],
  ['LICENSE', 'LICENSE'],
];
if (!fs.existsSync(src)) { console.warn('[vendor-three] node_modules/three 不存在，跳过'); process.exit(0); }
for (const [from, to] of files) {
  const out = path.join(dst, to);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.copyFileSync(path.join(src, from), out);
}
console.log(`[vendor-three] 已复制 ${files.length} 个文件到 ui/vendor/three`);
