'use strict';
/**
 * 渲染探针：把改写后的 frag/vert 真的跑一遍，画到离屏画布上再看像素。
 * 用途是回答「这一层在手机上到底会不会变成白块」——编译通过不代表画出来是对的，
 * 这里按 effect 的实际 uniform 值渲染，统计透明/纯白/彩色像素占比。
 *
 * 用法: node tools/render-probe.js <frag> <vert> <sceneItem.json>
 *   sceneItem.json 里给 uniforms（可以直接从 scene.json 的 constantshadervalues 抄）
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const glslc = require('./glslc');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const [fragPath, vertPath, defPath] = process.argv.slice(2);
if (!fragPath || !vertPath) {
  console.error('用法: node tools/render-probe.js <frag> <vert> [defs.json]');
  process.exit(2);
}
const defs = defPath && fs.existsSync(defPath) ? JSON.parse(fs.readFileSync(defPath, 'utf8')) : {};
const defines = defs.defines || {};
const uniforms = defs.uniforms || {};
const size = Number(defs.size) || 256;
const spectrum = defs.spectrum || 'zero'; // zero | test

for (const [k, v] of Object.entries(defines)) {
  process.env.CHECK_DEFINE = '';
  glslc.DEFAULT_COMBO_DEFINES[k] = v; // 让预处理按这组 combo 走
}

const frag = glslc.preprocess(fs.readFileSync(fragPath, 'utf8'), 'frag', false);
const vert = glslc.preprocess(fs.readFileSync(vertPath, 'utf8'), 'vert', false);

const html = `<!doctype html><meta charset="utf-8"><pre id="out"></pre><script>
var FRAG = ${JSON.stringify(frag)};
var VERT = ${JSON.stringify(vert)};
var UNIFORMS = ${JSON.stringify(uniforms)};
var SIZE = ${size};
var SPECTRUM = ${JSON.stringify(spectrum)};
var out = { ok: false, log: '', stats: null };
var c = document.createElement('canvas');
c.width = c.height = SIZE;
var gl = c.getContext('webgl2');
if (!gl) { out.log = 'no webgl2'; }
else {
  function sh(type, src) {
    var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) out.log += 'compile: ' + gl.getShaderInfoLog(s) + '\\n';
    return s;
  }
  var p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.bindAttribLocation(p, 0, 'a_Position');
  gl.bindAttribLocation(p, 1, 'a_TexCoord');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) out.log += 'link: ' + gl.getProgramInfoLog(p) + '\\n';
  gl.useProgram(p);

  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  var q = [-1,-1,0, 0,0,  1,-1,0, 1,0,  -1,1,0, 0,1,  -1,1,0, 0,1,  1,-1,0, 1,0,  1,1,0, 1,1];
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(q), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);

  // 1x1 白色纹理当 framebuffer/底图
  var tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255,255,255,255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  var mvp = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
  var n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (var i = 0; i < n; i++) {
    var info = gl.getActiveUniform(p, i);
    var name = info.name.replace(/\\[0$]/, '');
    var loc = gl.getUniformLocation(p, info.name);
    if (!loc) continue;
    if (info.type === gl.SAMPLER_2D) { gl.uniform1i(loc, 0); continue; }
    if (/g_ModelViewProjectionMatrix/.test(name)) { gl.uniformMatrix4fv(loc, false, mvp); continue; }
    if (/g_Texture0Resolution/.test(name)) { gl.uniform4f(loc, SIZE, SIZE, 1 / SIZE, 1 / SIZE); continue; }
    if (/g_AudioSpectrum/.test(name)) {
      var cnt = info.size || 32, arr = new Float32Array(cnt);
      for (var k = 0; k < cnt; k++) {
        if (SPECTRUM === 'zero') arr[k] = 0;
        else {
          // 造一段「像音乐的」频谱：低频强、高频弱 + 波动
          var f = k / cnt;
          arr[k] = Math.min(1, Math.max(0, (0.35 + 0.5 * Math.sin(f * 6.2 + 1.1)) * (1 - 0.55 * f)));
        }
      }
      gl.uniform1fv(loc, arr);
      continue;
    }
    if (info.type === gl.FLOAT) gl.uniform1f(loc, UNIFORMS[name] != null ? UNIFORMS[name] : 0);
    else if (info.type === gl.FLOAT_VEC3) {
      var v3 = UNIFORMS[name] || [1,1,1];
      gl.uniform3f(loc, v3[0], v3[1], v3[2]);
    } else if (info.type === gl.FLOAT_VEC4) {
      var v4 = UNIFORMS[name] || [1,1,1,1];
      gl.uniform4f(loc, v4[0], v4[1], v4[2], v4[3]);
    } else if (info.type === gl.INT) gl.uniform1i(loc, UNIFORMS[name] || 0);
  }

  gl.viewport(0, 0, SIZE, SIZE);
  gl.clearColor(0, 0, 0, 0);
  gl.disable(gl.BLEND);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  var px = new Uint8Array(SIZE * SIZE * 4);
  gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, px);
  var transparent = 0, white = 0, colored = 0, sumA = 0, sumR = 0, sumG = 0, sumB = 0, solidAll = 0;
  for (var j = 0; j < px.length; j += 4) {
    var a = px[j+3], r = px[j], g = px[j+1], b = px[j+2];
    sumA += a; sumR += r; sumG += g; sumB += b;
    if (a < 16) transparent++;
    else if (r > 230 && g > 230 && b > 230 && a > 230) { white++; solidAll++; }
    else colored++;
  }
  var total = SIZE * SIZE;
  out.stats = {
    total: total,
    transparentPct: +(transparent / total * 100).toFixed(1),
    whitePct: +(white / total * 100).toFixed(1),
    coloredPct: +(colored / total * 100).toFixed(1),
    meanAlpha: +(sumA / total / 255).toFixed(3),
    meanRGB: [ +(sumR/total/255).toFixed(3), +(sumG/total/255).toFixed(3), +(sumB/total/255).toFixed(3) ],
  };
  out.ok = true;
}
document.getElementById('out').textContent = 'JSON:' + JSON.stringify(out);
</script>`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wempkg-probe-'));
const file = path.join(dir, 'probe.html');
fs.writeFileSync(file, html, 'utf8');
let raw = '';
try {
  raw = execFileSync(EDGE, [
    '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader',
    `--user-data-dir=${path.join(dir, 'profile')}`,
    '--dump-dom', `file:///${file.replace(/\\/g, '/')}`,
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000, stdio: ['ignore', 'pipe', 'ignore'] });
} catch (e) {
  raw = (e.stdout || '') + (e.stderr || '');
}
const m = raw.match(/JSON:(\{[\s\S]*?\})<\/pre>/);
if (!m) {
  console.error('无法解析渲染结果，原始片段:\n', raw.slice(0, 500));
  process.exit(1);
}
const res = JSON.parse(m[1]);
console.log(`渲染 ${path.basename(fragPath)} ${spectrum === 'zero' ? '(静音)' : '(有频谱数据)'}`);
if (res.log) console.log('  日志: ' + res.log.trim());
if (res.stats) {
  const s = res.stats;
  console.log(`  透明 ${s.transparentPct}% / 纯白 ${s.whitePct}% / 彩色 ${s.coloredPct}%`);
  console.log(`  meanAlpha ${s.meanAlpha}  meanRGB ${s.meanRGB.join(', ')}`);
}
process.exit(res.ok ? 0 : 1);
