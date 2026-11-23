/*
 * 本地 GLSL 编译校验器（开发工具，不进打包链路）
 *
 * 用无头 Edge 的 WebGL2 上下文，按 WE 移动端的方式预处理后再编译着色器：
 *   - #version 300 es + precision mediump float;
 *   - varying → in/out（按阶段），attribute → in，gl_FragColor → out
 *   - 引擎注入的宏：#define varying / saturate / texSample2D / texSample2DLod / CAST1..4 / mul
 *   - #include "x.h" 用 WE 客户端 assets/shaders 里的真实头文件解析
 *   - 引擎自带的同名 uniform（g_Texture0/1..、g_ModelViewProjectionMatrix…）按需注入
 *
 * 用法：
 *   node tools/glslc.js <file.frag|file.vert> [...]
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HEADER_DIR = path.join(__dirname, '..', '.cache', 'dump', 'weshaders');

const ENGINE_MACROS = [
  '#define saturate(x) clamp(x, 0.0, 1.0)',
  '#define texSample2D texture',
  '#define texSample2DLod textureLod',
  '#define CAST1(x) (x)',
  '#define CAST2(x) vec2(x)',
  '#define CAST3(x) vec3(x)',
  '#define CAST4(x) vec4(x)',
  '#define mul(x, y) ((y) * (x))',
  '#define frac(x) fract(x)',
];

const ENGINE_MACROS_ES1 = [
  '#define saturate(x) clamp(x, 0.0, 1.0)',
  '#define CAST1(x) (x)',
  '#define CAST2(x) vec2(x)',
  '#define CAST3(x) vec3(x)',
  '#define CAST4(x) vec4(x)',
  '#define mul(x, y) ((y) * (x))',
  '#define frac(x) fract(x)',
  '#define texSample2D texture2D',
  '#define texSample2DLod texture2DLod',
];

/** 材质/scene 里的 combo 值，引擎会按 pass 的 combos 注入成宏（默认值取材质声明里的 default） */const DEFAULT_COMBO_DEFINES = {
  AUDIOSAMPLES: 32,
  BARSTYLE: 0,
  BGTRANSPARENT: 1,
  BLENDMODE: 0,
  VERTICAL: 0,
  HDR: 0,
};
let extraDefines = {};

const ENGINE_UNIFORMS = {
  float: ['g_Time', 'g_Frametime', 'g_TotalTime', 'g_EffectTime', 'g_Brightness', 'g_UserAlpha'],
  vec2: ['g_Texture0Resolution', 'g_Texture1Resolution', 'g_Texture2Resolution', 'g_Texture3Resolution',
    'g_ScreenResolution', 'g_AudioSpectrum32Left', 'g_AudioSpectrum32Right'],
  vec3: ['g_LightAmbientColor'],
  vec4: ['g_PointerState', 'g_Color', 'g_Texture0Translation', 'g_Texture0Rotation'],
  mat4: ['g_ModelViewProjectionMatrix', 'g_ModelMatrix', 'g_ViewProjectionMatrix', 'g_EffectModelMatrix'],
  sampler2D: ['g_Texture0', 'g_Texture1', 'g_Texture2', 'g_Texture3'],
};

/** 引擎注入的 uniform 声明（只在着色器没自己声明时补，避免重定义） */
function injectedUniforms(source) {
  const out = [];
  for (const [type, names] of Object.entries(ENGINE_UNIFORMS)) {
    for (const name of names) {
      if (new RegExp(`\\b${name}\\b`).test(source) && !new RegExp(`uniform[^;]*\\b${name}\\b`).test(source)) {
        out.push(`uniform ${type} ${name};`);
      }
    }
  }
  return out;
}

/** 用真实引擎头文件解析 #include */
function resolveIncludes(source, depth = 0) {
  if (depth > 8) return source;
  return source.replace(/^[ \t]*#include[ \t]+"([^"]+)"[ \t]*$/gm, (m, name) => {
    const p = path.join(HEADER_DIR, name);
    if (!fs.existsSync(p)) return `// missing include ${name}`;
    return resolveIncludes(fs.readFileSync(p, 'utf8'), depth + 1);
  });
}

function preprocess(source, stage, es1) {
  let s = resolveIncludes(source);
  const usesFragColor = /\bgl_FragColor\b/.test(s);
  if (es1) {
    // ES 1.00 模式：varying / attribute / texture2D / gl_FragColor 原样保留
    s = s.replace(/\btexture\(/g, 'texture2D(');
  } else {
    s = s.replace(/\bvarying\b/g, stage === 'frag' ? 'in' : 'out');
    s = s.replace(/\battribute\b/g, 'in');
    s = s.replace(/\btexture2D\b/g, 'texture');
    s = s.replace(/\bgl_FragColor\b/g, 'mpkg_fragColor');
  }
  const head = es1 ? ['precision mediump float;'] : ['#version 300 es', 'precision mediump float;'];
  head.push(...(es1 ? ENGINE_MACROS_ES1 : ENGINE_MACROS));
  const defined = { ...DEFAULT_COMBO_DEFINES, ...extraDefines };
  // 材质 combo 在 #if 里用到的宏，引擎按 pass 的 combos 注入；这里没给值的一律当 0
  for (const m of s.matchAll(/^[ \t]*#[ \t]*(?:if|elif)[ \t]+(.+)$/gm)) {
    for (const name of m[1].matchAll(/\b[A-Z_][A-Z0-9_]*\b/g)) {
      if (!(name[0] in defined)) defined[name[0]] = 0;
    }
  }
  for (const [k, v] of Object.entries(defined)) head.push(`#define ${k} ${v}`);
  head.push(...injectedUniforms(s));
  if (!es1 && stage === 'frag' && usesFragColor) head.push('out vec4 mpkg_fragColor;');
  return `${head.join('\n')}\n${s}`;
}

const VERT_PASSTHROUGH = `#version 300 es
precision mediump float;
uniform mat4 g_ModelViewProjectionMatrix;
in vec3 a_Position;
in vec2 a_TexCoord;
out vec2 v_TexCoord;
void main() {
  v_TexCoord = a_TexCoord;
  gl_Position = g_ModelViewProjectionMatrix * vec4(a_Position, 1.0);
}`;

const VERT_PASSTHROUGH_ES1 = `precision mediump float;
uniform mat4 g_ModelViewProjectionMatrix;
attribute vec3 a_Position;
attribute vec2 a_TexCoord;
varying vec2 v_TexCoord;
void main() {
  v_TexCoord = a_TexCoord;
  gl_Position = g_ModelViewProjectionMatrix * vec4(a_Position, 1.0);
}`;

function htmlFor(items, es1) {
  return `<!doctype html><meta charset="utf-8"><pre id="out"></pre><script>
var items = ${JSON.stringify(items)};
var out = [];
var c = document.createElement('canvas');
var gl = c.getContext(${es1 ? "'webgl' || c.getContext('experimental-webgl')" : "'webgl2'"});
if (!gl) { out.push({ name: 'GET_WEBGL', ok: false, log: 'no webgl context' }); }
else {
  items.forEach(function (it) {
    var sh = gl.createShader(it.stage === 'frag' ? gl.FRAGMENT_SHADER : gl.VERTEX_SHADER);
    gl.shaderSource(sh, it.src);
    gl.compileShader(sh);
    var ok = gl.getShaderParameter(sh, gl.COMPILE_STATUS);
    var log = gl.getShaderInfoLog(sh) || '';
    out.push({ name: it.name, ok: !!ok, log: log });
  });
}
document.getElementById('out').textContent = 'JSON:' + JSON.stringify(out, null, 2);
</script>`;
}

function main() {
  const argv = process.argv.slice(2);
  const files = [];
  let es1 = false;
  for (const a of argv) {
    if (a.startsWith('--define=')) {
      const [k, v] = a.slice('--define='.length).split('=');
      extraDefines[k] = v;
    } else if (a === '--es1') {
      es1 = true;
    } else if (a.startsWith('--')) {
      continue;
    } else {
      files.push(a);
    }
  }
  if (!files.length) {
    console.error('用法: node tools/glslc.js [--es1] [--define=K=V] <file.frag|file.vert> [...]');
    process.exit(2);
  }
  const items = [];
  for (const f of files) {
    const stage = f.toLowerCase().endsWith('.vert') ? 'vert' : 'frag';
    const prepared = preprocess(fs.readFileSync(f, 'utf8'), stage, es1);
    if (process.env.GLSLC_EMIT) {
      fs.writeFileSync(`${process.env.GLSLC_EMIT}.${stage}`, prepared, 'utf8');
    }
    items.push({ name: path.basename(f), stage, src: prepared });
  }
  if (items.some((i) => i.stage === 'frag')) {
    items.unshift({ name: '(passthrough).vert', stage: 'vert', src: es1 ? VERT_PASSTHROUGH_ES1 : VERT_PASSTHROUGH });
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wempkg-glslc-'));
  const file = path.join(dir, 'check.html');
  fs.writeFileSync(file, htmlFor(items, es1), 'utf8');
  const raw = execFileSync(EDGE, [
    '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader',
    `--user-data-dir=${path.join(dir, 'profile')}`,
    '--dump-dom', `file:///${file.replace(/\\/g, '/')}`,
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000 });
  const m = raw.match(/JSON:(\[[\s\S]*?\])<\/pre>/);
  if (!m) {
    console.error('无法解析编译结果，原始输出片段:\n', raw.slice(0, 400));
    process.exit(1);
  }
  const results = JSON.parse(m[1]);
  let failed = 0;
  for (const r of results) {
    if (r.name === '(passthrough).vert') continue;
    const first = r.log.split('\n').filter(Boolean).slice(0, 3).join('\n    ');
    console.log(`${r.ok ? '✔' : '✘'} ${r.name}${r.ok ? '' : `\n    ${first}`}`);
    if (!r.ok) failed++;
  }
  process.exit(failed ? 1 : 0);
}

if (require.main === module) main();

module.exports = { preprocess, resolveIncludes, ENGINE_MACROS, ENGINE_MACROS_ES1, DEFAULT_COMBO_DEFINES };
