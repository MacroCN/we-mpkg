/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 MacroCN
 * 本文件的规则集移植自 ReZe20/repkg-Re（MIT）的 ShaderCompatPatcher.cs，版权归原作者；
 * 见 THIRD-PARTY-NOTICES.md 与 licenses/repkg-Re-MIT.txt。
 */
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

// ---------------------------------------------------------------------------
// 结构性补丁：字面量补点解决不了的那几类固定毛病
//
// 这几条都来自实测会白屏的材质，规则本身是「先认结构、再动字符串」：
// 认不出结构就原样返回，绝不会因为规则不匹配而把正常的着色器改坏。
// ---------------------------------------------------------------------------

/**
 * 注释 / 字符串掩码：把注释和字符串内容换成空格（保留换行），
 * 只用来判断「这段代码在不在真正的代码区」，不参与输出。
 */
function maskNonCode(source) {
  const out = source.split('');
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    if (c === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n' && source[i] !== '\r') { out[i] = ' '; i++; }
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      out[i] = ' '; out[i + 1] = ' '; i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] !== '\n' && source[i] !== '\r') out[i] = ' ';
        i++;
      }
      if (i < n) { out[i] = ' '; out[i + 1] = ' '; i += 2; }
      continue;
    }
    if (c === '"') {
      out[i] = ' '; i++;
      while (i < n) {
        if (source[i] === '\\' && i + 1 < n) { out[i] = ' '; out[i + 1] = ' '; i += 2; continue; }
        if (source[i] === '"') { out[i] = ' '; i++; break; }
        if (source[i] !== '\n' && source[i] !== '\r') out[i] = ' ';
        i++;
      }
      continue;
    }
    i++;
  }
  return out.join('');
}

/** 只在代码区做正则替换（注释/字符串里的同名内容不动） */
function replaceInCode(source, regex, replacement) {
  const mask = maskNonCode(source);
  const hits = [];
  regex.lastIndex = 0;
  let m;
  while ((m = regex.exec(mask)) !== null) {
    hits.push({ start: m.index, text: m[0] });
    if (m[0].length === 0) regex.lastIndex++;
  }
  if (!hits.length) return { text: source, count: 0 };
  let out = source;
  // 从后往前替换，避免前面的替换改变后面的下标
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i];
    if (out.slice(h.start, h.start + h.text.length) !== h.text) continue; // 掩码与原文不一致（极少见），跳过
    out = out.slice(0, h.start) + h.text.replace(regex, replacement) + out.slice(h.start + h.text.length);
  }
  return { text: out, count: hits.length };
}

/**
 * effects/xray 材质：桌面版靠 g_PointerState 把「鼠标位置」换算成 UV 缩放，
 * 手机端没有这个 uniform，UV 会整体偏移（表现为画面错位/糊）。
 * 结构对不上就不动。
 */
function rewriteXray(source) {
  if (!source.includes('v_PointerUV') || !source.includes('v_PointerScale')) return { text: source, count: 0 };
  if (source.includes('uniform vec4 g_PointerState;')) return { text: source, count: 0 };
  let out = source;
  let count = 0;
  const marker = 'varying float v_PointerScale;';
  if (out.includes(marker)) {
    out = out.replace(marker, `${marker}\nuniform vec4 g_PointerState;`);
    count++;
  } else {
    return { text: source, count: 0 };
  }
  if (out.includes('unprojectedUVs += 0.5;') && !out.includes('g_PointerState.y')) {
    out = out.replace(
      'unprojectedUVs += 0.5;',
      'unprojectedUVs *= CAST2(1.0 / max(0.00001, g_PointerState.y));\nunprojectedUVs += 0.5;',
    );
    count++;
  }
  return { text: out, count };
}

/**
 * 音频频谱的「打包下标」写法：`g_AudioSpectrum64L[i / 4][i % 4]`。
 * 移动端把它当两个维度索引会编译失败，官方导出改成 `g_AudioSpectrum64L[int(i)]`。
 */
const PACKED_SPECTRUM = /(g_AudioSpectrum64(?:Left|Right))\[([A-Za-z_][A-Za-z0-9_]*)\s*\/\s*4\]\[\2\s*%\s*4\]/g;
function rewritePackedAudioSpectrum(source) {
  const r = replaceInCode(source, PACKED_SPECTRUM, (match, name, index) => `${name}[int(${index})]`);
  return { text: r.text, count: r.count };
}

/**
 * 少数老材质用 vec4 装颜色又只返回 xyz，移动端严格类型下编译不过。
 * 只有签名完全吻合时才改。
 */
function rewriteVec3ColorAccumulator(source) {
  if (!source.includes('vec3 drawSence(') || !source.includes('return col;')) return { text: source, count: 0 };
  let out = source;
  let count = 0;
  const pairs = [
    ['vec4 col = vec4(0.,0.,0.,0.);', 'vec3 col = vec3(0.,0.,0.);'],
    ['col = vec4(mix(u_userNewColor, col, step(0., sence)), 1.);', 'col = mix(u_userNewColor, col, step(0., sence));'],
  ];
  for (const [from, to] of pairs) {
    if (out.includes(from)) { out = out.split(from).join(to); count++; }
  }
  return { text: out, count };
}

/**
 * `#include "common_blur.h"` 的材质：本地声明了 `g_Texture0` 又让 include 再声明一次，
 * 移动端编译器报重定义。这里把本地声明换成注释占位，再在 include 前补一份声明，
 * 让声明位置固定下来（与官方导出的处理一致）。
 */
const HIDDEN_TEXTURE_DECL = 'uniform sampler2D g_Texture0; // {"hidden":true}';
const HIDDEN_TEXTURE_MARK = ' // {"hidden":true}';
const COMMON_BLUR_INCLUDE = '#include "common_blur.h"';
function rewriteCommonBlurInclude(source) {
  if (!source.includes(COMMON_BLUR_INCLUDE) || !source.includes(HIDDEN_TEXTURE_DECL)) {
    return { text: source, count: 0 };
  }
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  let out = source.replace(HIDDEN_TEXTURE_DECL, HIDDEN_TEXTURE_MARK);
  if (!out.includes('uniform sampler2D g_Texture0;')) {
    out = out.replace(COMMON_BLUR_INCLUDE, `uniform sampler2D g_Texture0;${newline}${COMMON_BLUR_INCLUDE}`);
  }
  return { text: out, count: 1 };
}

/**
 * `sample` 在某些 GLSL ES 版本里是保留字，同名变量直接编译失败，官方导出改成 `_sample`。
 * 只改代码区，注释和字符串里的原样保留。
 */
const SAMPLE_KEYWORD = /\bsample\b/g;
function rewriteSampleKeyword(source) {
  const r = replaceInCode(source, SAMPLE_KEYWORD, '_sample');
  return { text: r.text, count: r.count };
}

/**
 * 完整改写：字面量补点 + 结构性补丁。
 * @param {string} source
 * @param {{relPath?:string}} [opts]
 */
function rewriteAll(source, opts = {}) {
  const base = patch(source);
  let text = base.text;
  let structural = 0;
  const rel = String(opts.relPath || '').replace(/\\/g, '/').toLowerCase();

  // xray 只对 effects/xray 生效，别把通用 shader 的 UV 也改了
  if (rel.endsWith('effects/xray.vert') || rel.endsWith('effects/xray.frag')) {
    const r = rewriteXray(text);
    text = r.text; structural += r.count;
  }
  for (const fn of [rewritePackedAudioSpectrum, rewriteVec3ColorAccumulator, rewriteCommonBlurInclude, rewriteSampleKeyword]) {
    const r = fn(text);
    text = r.text;
    structural += r.count;
  }
  return {
    text,
    linesChanged: base.linesChanged,
    literalsChanged: base.literalsChanged,
    structural,
  };
}

/**
 * 批量改写目录里的 .vert/.frag
 * @param {{onLog?:Function, checkpoint?:object}} opts checkpoint 为 convertplan.Checkpoint
 */
function patchDir(dir, opts = {}) {
  const onLog = opts.onLog || (() => {});
  const fs = require('fs');
  const path = require('path');
  const { sha256Buffer } = require('./convertplan');
  const checkpoint = opts.checkpoint || null;
  const stats = { total: 0, rewritten: 0, literals: 0, structural: 0, failed: 0, resumed: 0 };
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, ent.name);
      if (ent.isDirectory()) { walk(abs); continue; }
      if (!isShaderPath(ent.name)) continue;
      stats.total++;
      const rel = path.relative(dir, abs).split(path.sep).join('/');
      try {
        const src = fs.readFileSync(abs, 'utf8');
        const shaIn = checkpoint ? sha256Buffer(Buffer.from(src, 'utf8')) : null;
        if (checkpoint && checkpoint.isResolved(rel, shaIn)) { stats.resumed++; continue; }
        const r = rewriteAll(src, { relPath: rel });
        if (r.text !== src) {
          fs.writeFileSync(abs, r.text);
          if (checkpoint) checkpoint.record(rel, shaIn, sha256Buffer(Buffer.from(r.text, 'utf8')), 'shader');
          stats.rewritten++;
          stats.literals += r.literalsChanged;
          stats.structural += r.structural;
          onLog(`  [着色器] ${rel}: ${r.linesChanged} 行 / ${r.literalsChanged} 处补 .0${r.structural ? `，${r.structural} 处结构性修正` : ''}`);
        } else if (checkpoint) {
          checkpoint.record(rel, shaIn, shaIn, 'shader');
        }
      } catch (e) {
        stats.failed++;
        onLog(`  [着色器] ${rel}: 改写失败，保留原文件（${e.message}）`);
      }
    }
  };
  walk(dir);
  return stats;
}

module.exports = { patch, patchDir, isShaderPath, rewriteAll, maskNonCode, rewriteXray, rewritePackedAudioSpectrum, rewriteVec3ColorAccumulator, rewriteCommonBlurInclude, rewriteSampleKeyword };
