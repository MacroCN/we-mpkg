'use strict';
/**
 * 桌面 GLSL → 移动端 GLSL ES 的兼容改写：把落在 float 上下文里的整数字面量补成 ".0"。
 *
 * 为什么需要：移动端 GLSL ES 没有隐式 int→float，桌面版写 `1` 的地方在手机上编译不过，
 * 编译失败的材质会回退成基础贴图，画面就是一块白。一个 pass 的 vert 与 frag 都必须过。
 *
 * 规则集移植自 ReZe20/repkg-Re 的 ShaderCompatPatcher.cs（逐字面对照过 WE 自己的移动导出）。
 * 刻意不动：注释、预处理行、数组下标、构造器/显式转换实参、int 上下文、写在注释里的 COMBO JSON。
 * 判不准就留原样 —— 少改不会更错，多改会把现在正常的着色器弄白。
 */

const GENERIC = new Set([
  'min', 'max', 'clamp', 'mix', 'step', 'smoothstep', 'pow', 'mod', 'reflect', 'refract',
  'faceforward', 'distance', 'length', 'dot', 'cross', 'normalize',
]);
const LOD_THIRD = new Set(['texSample2DLod', 'texture2DLod', 'textureLod']);
const CONSTRUCTORS = new Set([
  'vec2', 'vec3', 'vec4', 'bvec2', 'bvec3', 'bvec4', 'ivec2', 'ivec3', 'ivec4',
  'uvec2', 'uvec3', 'uvec4', 'mat2', 'mat3', 'mat4', 'CAST1', 'CAST2', 'CAST3', 'CAST4',
  'int', 'uint', 'bool', 'float',
]);
const INT_TYPES = new Set(['int', 'bool', 'ivec2', 'ivec3', 'ivec4', 'uvec2', 'uvec3', 'uvec4']);
const DECL_TYPES = [
  'float', 'int', 'bool', 'ivec2', 'ivec3', 'ivec4', 'uvec2', 'uvec3', 'uvec4',
  'mat2', 'mat3', 'mat4', 'vec2', 'vec3', 'vec4', 'sampler2D', 'sampler3D', 'samplerCube',
];
const FLOAT_CALL_PREFIXES = [
  'vec', 'mat', 'min', 'max', 'clamp', 'mix', 'abs', 'sign', 'floor', 'ceil', 'fract', 'round',
  'trunc', 'pow', 'sqrt', 'inversesqrt', 'normalize', 'distance', 'length', 'dot', 'cross',
  'reflect', 'refract', 'log2', 'log', 'exp2', 'exp', 'sin', 'cos', 'tan', 'asin', 'acos',
  'atan', 'mod', 'step', 'smoothstep', 'texture2D', 'texture3D', 'textureCube', 'texture',
  'texSample2D', 'CAST',
];

const isDigit = (c) => c >= '0' && c <= '9';
const isWordChar = (c) => isDigit(c) || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
const isIdentifierStart = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';

function isShaderPath(name) {
  return /\.(frag|vert)$/i.test(name || '');
}

function isFloatType(t) {
  return t === 'float' || t === 'vec2' || t === 'vec3' || t === 'vec4'
    || t === 'mat2' || t === 'mat3' || t === 'mat4';
}
const isIntType = (t) => !!t && INT_TYPES.has(t);
const isDeclType = (w) => DECL_TYPES.includes(w);

function buildTables(source) {
  const types = new Map();
  const funcs = new Map();
  for (const raw of source.split('\n')) {
    const line = stripComment(raw).replace(/\r+$/, '');
    if (line.length === 0 || line[0] === '#') continue;

    const decl = tryMatchDeclaration(line);
    if (decl) {
      for (const n of decl.names) if (!types.has(n)) types.set(n, decl.type);
    }
    const fn = tryMatchFunction(line);
    if (fn) {
      funcs.set(fn.name, { returnType: fn.returnType, parameters: fn.parameters });
      fn.paramNames.forEach((p, i) => {
        const t = i < fn.parameters.length ? fn.parameters[i] : '';
        if (t && !types.has(p)) types.set(p, t);
      });
    }
  }
  return { types, funcs };
}

function stripComment(line) {
  const i = line.indexOf('//');
  return i < 0 ? line : line.slice(0, i);
}

function patch(source) {
  const tables = buildTables(source);
  const out = [];
  let linesChanged = 0;
  let literalsChanged = 0;
  for (const line of source.split('\n')) {
    const r = rewriteLine(line, tables);
    if (r.hits > 0) { linesChanged++; literalsChanged += r.hits; }
    out.push(r.result);
  }
  return { text: out.join('\n'), linesChanged, literalsChanged };
}

function rewriteLine(line, tables) {
  if (!line) return { result: line, hits: 0 };
  const head = line.replace(/^\s+/, '');
  if (head.startsWith('//') || head.startsWith('#')) return { result: line, hits: 0 };

  const cut = line.indexOf('//');
  const code = cut < 0 ? line : line.slice(0, cut);
  const tail = cut < 0 ? '' : line.slice(cut);
  let out = '';
  let hits = 0;

  let i = 0;
  while (i < code.length) {
    if (!isDigit(code[i]) || (i > 0 && (isWordChar(code[i - 1]) || code[i - 1] === '.'))) {
      out += code[i];
      i++;
      continue;
    }
    let j = i;
    while (j < code.length && isDigit(code[j])) j++;
    let isFloat = false;
    if (j < code.length && code[j] === '.') {
      isFloat = true;
      j++;
      while (j < code.length && isDigit(code[j])) j++;
    }
    if (!isFloat && j < code.length && (code[j] === 'e' || code[j] === 'E')) {
      let k = j + 1;
      if (k < code.length && (code[k] === '+' || code[k] === '-')) k++;
      if (k < code.length && isDigit(code[k])) {
        isFloat = true;
        j = k;
        while (j < code.length && isDigit(code[j])) j++;
      }
    }
    // 带类型后缀或粘连标识符的（`10u`、`2x`）不是要动的裸整数
    if (j < code.length && isWordChar(code[j])) {
      out += code.slice(i, j);
      i = j;
      continue;
    }
    if (isFloat) {
      out += code.slice(i, j);
      i = j;
      continue;
    }
    const reason = classify(code.slice(0, i), code.slice(j), tables);
    if (reason) {
      out += code.slice(i, j) + '.0';
      hits++;
    } else {
      out += code.slice(i, j);
    }
    i = j;
  }
  return { result: hits > 0 ? out + tail : line, hits };
}

function classify(beforeRaw, afterRaw, tables) {
  const b = beforeRaw.replace(/\s+$/, '');
  const a = afterRaw.replace(/^\s+/, '');
  if (b.length > 0 && b[b.length - 1] === ':') return null; // JSON "key": 之后

  const enc = findEnclosing(beforeRaw);
  if (enc.bracket) return null;
  if (CONSTRUCTORS.has(enc.owner)) return null;
  if (containsForIntInit(beforeRaw)) return null;

  const owner = enc.owner;
  if (owner) {
    if (GENERIC.has(owner)) {
      let span = beforeRaw.slice(enc.openAt + 1) + afterRaw;
      const close = span.indexOf(')');
      const args = splitTop(close < 0 ? span : span.slice(0, close));
      for (const arg of args) if (mentionsFloat(arg, tables)) return '泛型内置实参';
      return null;
    }
    if (LOD_THIRD.has(owner) && enc.argIndex === 2) return 'LOD float 形参';
    const sig = tables.funcs.get(owner);
    if (sig) {
      const t = enc.argIndex < sig.parameters.length ? sig.parameters[enc.argIndex] : '';
      return isFloatType(t) ? '自定义函数 float 形参' : null;
    }
  }

  const declType = tryMatchDeclarationInit(beforeRaw);
  if (declType) return isFloatType(declType) ? 'float 声明初值' : null;

  const assigned = tryAssignmentTarget(b);
  if (assigned) {
    const t = tables.types.get(assigned);
    if (!t) return null;
    return isFloatType(t) ? 'float 赋值' : null;
  }

  const leftOp = endsWithArithOp(b);
  const rightOp = startsWithArithOp(a);
  if (!leftOp && !rightOp) return null;
  if (leftOp) {
    const left = lastOperand(trimTrailingArithOp(b));
    if (left && mentionsFloat(left, tables)) return '算术混型';
  }
  if (rightOp) {
    const right = firstOperand(trimLeadingArithOp(a));
    if (right && mentionsFloat(right, tables)) return '算术混型';
  }
  return null;
}

function mentionsFloat(expr, tables) {
  const e = (expr || '').trim();
  if (!e) return false;
  for (let i = 0; i + 1 < e.length; i++) if (e[i] === '.' && isDigit(e[i + 1])) return true;
  for (let i = 0; i < e.length; i++) {
    if (!isIdentifierStart(e[i])) continue;
    let j = i;
    while (j < e.length && isWordChar(e[j])) j++;
    const name = e.slice(i, j);
    i = j - 1;
    const t = tables.types.get(name);
    if (t && isFloatType(t)) return true;
    const sig = tables.funcs.get(name);
    if (sig && isFloatType(sig.returnType)) return true;
    if (isFloatCallName(name)) return true;
  }
  return false;
}

function isFloatCallName(name) {
  return FLOAT_CALL_PREFIXES.some((p) => name.startsWith(p));
}

/** 反向找"最内层未闭合括号"，遇到已闭合的 (...) 整组跳过 */
function findEnclosing(beforeRaw) {
  let comma = 0;
  let i = beforeRaw.length - 1;
  while (i >= 0) {
    const c = beforeRaw[i];
    if (c === ')' || c === ']') {
      let depth = 0;
      let k = i;
      for (; k >= 0; k--) {
        const cc = beforeRaw[k];
        if (cc === ')' || cc === ']') depth++;
        else if (cc === '(' || cc === '[') { depth--; if (depth === 0) break; }
      }
      i = k - 1;
      continue;
    }
    if (c === '(' || c === '[') {
      return {
        owner: trailingIdentifier(beforeRaw.slice(0, i)),
        argIndex: comma,
        bracket: c === '[',
        openAt: i,
      };
    }
    if (c === ',') comma++;
    i--;
  }
  return { owner: '', argIndex: comma, bracket: false, openAt: -1 };
}

function trailingIdentifier(s) {
  let end = s.length;
  while (end > 0 && /\s/.test(s[end - 1])) end--;
  let start = end;
  while (start > 0 && isWordChar(s[start - 1])) start--;
  return end > start ? s.slice(start, end) : '';
}

function lastOperand(t) {
  let end = t.length;
  while (end > 0 && /\s/.test(t[end - 1])) end--;
  for (;;) {
    let k = end;
    while (k > 0 && isWordChar(t[k - 1])) k--;
    if (k > 0 && t[k - 1] === '.' && k < end) {
      end = k - 1;
      while (end > 0 && /\s/.test(t[end - 1])) end--;
      continue;
    }
    break;
  }
  if (end > 0 && t[end - 1] === ')') {
    let depth = 0;
    let k = end - 1;
    for (; k >= 0; k--) {
      if (t[k] === ')') depth++;
      else if (t[k] === '(') { depth--; if (depth === 0) break; }
    }
    return k > 0 ? trailingIdentifier(t.slice(0, k)) : '';
  }
  let e2 = end;
  while (e2 > 0 && isWordChar(t[e2 - 1])) e2--;
  return e2 < end ? t.slice(e2, end) : '';
}

function firstOperand(t) {
  let i = 0;
  while (i < t.length && /\s/.test(t[i])) i++;
  const s = i;
  while (i < t.length && isWordChar(t[i])) i++;
  return i > s ? t.slice(s, i) : '';
}

function splitTop(s) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts;
}

function containsForIntInit(beforeRaw) {
  for (let i = 0; i + 3 <= beforeRaw.length; i++) {
    if (beforeRaw[i] !== 'f' || !startsWith(beforeRaw, i, 'for')) continue;
    if (i > 0 && isWordChar(beforeRaw[i - 1])) continue;
    let j = i + 3;
    while (j < beforeRaw.length && /\s/.test(beforeRaw[j])) j++;
    if (j >= beforeRaw.length || beforeRaw[j] !== '(') continue;
    j++;
    while (j < beforeRaw.length && /\s/.test(beforeRaw[j])) j++;
    if (startsWith(beforeRaw, j, 'int') && !isWordChar(at(beforeRaw, j + 3))) return true;
  }
  return false;
}

function tryMatchDeclaration(line) {
  let i = 0;
  while (i < line.length) {
    if (!isIdentifierStart(line[i]) || (i > 0 && isWordChar(line[i - 1]))) { i++; continue; }
    let j = i;
    while (j < line.length && isWordChar(line[j])) j++;
    const word = line.slice(i, j);
    if (!isDeclType(word)) { i = j; continue; }
    let k = j;
    while (k < line.length && /\s/.test(line[k])) k++;
    if (k >= line.length || !isIdentifierStart(line[k])) return null;
    const names = [];
    let p = k;
    while (p < line.length) {
      if (isIdentifierStart(line[p])) {
        const s = p;
        while (p < line.length && isWordChar(line[p])) p++;
        names.push(line.slice(s, p));
        continue;
      }
      if (line[p] === '[') { while (p < line.length && line[p] !== ']') p++; p++; continue; }
      if (line[p] === ';' || line[p] === ')') break;
      if (line[p] !== '=' && line[p] !== ',') break;
      p++;
    }
    return names.length ? { type: word, names } : null;
  }
  return null;
}

function tryMatchFunction(line) {
  const s = line.replace(/\s+$/, '');
  let i = 0;
  while (i < s.length && isWordChar(s[i])) i++;
  if (i === 0) return null;
  const ret = s.slice(0, i);
  if (ret !== 'void' && !isFloatType(ret) && !isIntType(ret)) return null;
  let p = i;
  while (p < s.length && /\s/.test(s[p])) p++;
  const nameStart = p;
  while (p < s.length && isWordChar(s[p])) p++;
  if (p === nameStart) return null;
  while (p < s.length && /\s/.test(s[p])) p++;
  if (p >= s.length || s[p] !== '(') return null;
  const close = s.lastIndexOf(')');
  if (close <= p) return null;
  const after = s.slice(close + 1).trim();
  if (after.length > 0 && after !== '{') return null;

  const parameters = [];
  const paramNames = [];
  for (const raw of s.slice(p + 1, close).split(',')) {
    const param = raw.trim();
    if (!param) continue;
    let type = null;
    let pname = null;
    let k = 0;
    while (k < param.length) {
      if (isIdentifierStart(param[k])) {
        const st = k;
        while (k < param.length && isWordChar(param[k])) k++;
        const word = param.slice(st, k);
        if (isDeclType(word)) { type = word; pname = null; }
        else if (!['in', 'out', 'const', 'uniform', 'inout'].includes(word)) pname = word;
        continue;
      }
      if (param[k] === '[') { while (k < param.length && param[k] !== ']') k++; k++; continue; }
      k++;
    }
    if (pname == null) continue;
    parameters.push(type || '');
    paramNames.push(pname);
  }
  return {
    name: s.slice(nameStart, p).trim(),
    returnType: ret === 'void' ? '' : ret,
    parameters,
    paramNames,
  };
}

function tryMatchDeclarationInit(beforeRaw) {
  const b = beforeRaw.replace(/\s+$/, '');
  if (!b || b[b.length - 1] !== '=') return null;
  let left = b.slice(0, b.length - 1).replace(/\s+$/, '');
  if (left.length > 0 && left[left.length - 1] === ']') {
    let k = left.length - 1;
    let depth = 0;
    for (; k >= 0; k--) {
      if (left[k] === ']') depth++;
      else if (left[k] === '[') { depth--; if (depth === 0) break; }
    }
    if (k < 0) return null;
    left = left.slice(0, k).replace(/\s+$/, '');
  }
  const nameEnd = left.length;
  let nameStart = nameEnd;
  while (nameStart > 0 && isWordChar(left[nameStart - 1])) nameStart--;
  if (nameStart === nameEnd) return null;
  const before = left.slice(0, nameStart).replace(/\s+$/, '');
  const typeEnd = before.length;
  let typeStart = typeEnd;
  while (typeStart > 0 && isWordChar(before[typeStart - 1])) typeStart--;
  if (typeStart === typeEnd) return null;
  const type = before.slice(typeStart, typeEnd);
  return isDeclType(type) || type === 'in' || type === 'out' ? type : null;
}

function tryAssignmentTarget(b) {
  if (!b || b[b.length - 1] !== '=') return null;
  if (b.length >= 2 && '!=<>'.includes(b[b.length - 2])) return null;
  let left = b.slice(0, b.length - 1).replace(/\s+$/, '');
  if (left.length > 0 && left[left.length - 1] === ']') {
    let k = left.length - 1;
    let depth = 0;
    for (; k >= 0; k--) {
      if (left[k] === ']') depth++;
      else if (left[k] === '[') { depth--; if (depth === 0) break; }
    }
    if (k < 0) return null;
    left = left.slice(0, k).replace(/\s+$/, '');
  }
  const end = left.length;
  let start = end;
  while (start > 0 && isWordChar(left[start - 1])) start--;
  if (start === end || isDigit(left[start])) return null;
  return left.slice(start, end);
}

function endsWithArithOp(b) {
  if (!b) return false;
  if (b.length >= 2) {
    const op = b.slice(-2);
    if (['<=', '>=', '==', '!='].includes(op)) return true;
  }
  return '+-*/<>'.includes(b[b.length - 1]);
}

function startsWithArithOp(a) {
  if (!a) return false;
  if (a.length >= 2) {
    const op = a.slice(0, 2);
    if (['<=', '>=', '==', '!='].includes(op)) return true;
  }
  return '+-*/<>'.includes(a[0]);
}

function trimTrailingArithOp(b) {
  if (b.length >= 2) {
    const op = b.slice(-2);
    if (['<=', '>=', '==', '!='].includes(op)) return b.slice(0, -2);
  }
  if (b.length >= 1 && '+-*/<>'.includes(b[b.length - 1])) return b.slice(0, -1);
  return b;
}

function trimLeadingArithOp(a) {
  if (a.length >= 2) {
    const op = a.slice(0, 2);
    if (['<=', '>=', '==', '!='].includes(op)) return a.slice(2);
  }
  if (a.length >= 1 && '+-*/<>'.includes(a[0])) return a.slice(1);
  return a;
}

function startsWith(s, index, value) {
  if (index < 0 || index + value.length > s.length) return false;
  return s.slice(index, index + value.length) === value;
}

function at(s, index) {
  return index >= 0 && index < s.length ? s[index] : '\0';
}

/**
 * 批量改写目录里的 .vert/.frag
 */
function patchDir(dir, opts = {}) {
  const onLog = opts.onLog || (() => {});
  const fs = require('fs');
  const path = require('path');
  const stats = { total: 0, rewritten: 0, literals: 0 };
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, ent.name);
      if (ent.isDirectory()) { walk(abs); continue; }
      if (!isShaderPath(ent.name)) continue;
      stats.total++;
      const src = fs.readFileSync(abs, 'utf8');
      const r = patch(src);
      if (r.literalsChanged > 0) {
        fs.writeFileSync(abs, r.text);
        stats.rewritten++;
        stats.literals += r.literalsChanged;
        onLog(`  [着色器] ${path.relative(dir, abs).split(path.sep).join('/')}: ${r.linesChanged} 行 / ${r.literalsChanged} 处补 .0`);
      }
    }
  };
  walk(dir);
  return stats;
}

module.exports = { patch, patchDir, isShaderPath };
