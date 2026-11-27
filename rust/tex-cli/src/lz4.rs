// SPDX-License-Identifier: MIT
// Copyright (c) 2026 MacroCN
//
// LZ4 raw block 编解码，逐字节对齐 src/lz4.js（包括哈希策略与匹配延伸规则，
// 保证压缩输出可直接与 JS 版本互相替换）。

const HASH_BITS: u32 = 16;
const HASH_SIZE: usize = 1 << HASH_BITS;

#[inline]
fn read32(buf: &[u8], i: usize) -> u32 {
    u32::from_le_bytes([buf[i], buf[i + 1], buf[i + 2], buf[i + 3]])
}

#[inline]
fn hash32(v: u32) -> usize {
    // JS: Math.imul(v, 2654435761) >>> 16
    (v.wrapping_mul(2_654_435_761) >> (32 - HASH_BITS)) as usize
}

pub fn compress(src: &[u8]) -> Vec<u8> {
    let n = src.len();
    if n == 0 {
        return Vec::new();
    }
    let cap = n + n.div_ceil(255) + 16;
    let mut out: Vec<u8> = Vec::with_capacity(cap);
    let mut table = vec![-1i64; HASH_SIZE];

    let mut anchor = 0usize;
    let mut i = 0usize;
    if n > 12 {
        let match_limit = n - 12;
        while i < match_limit {
            let seq = read32(src, i);
            let h = hash32(seq);
            let cand = table[h];
            table[h] = i as i64;

            let cand_ok = cand >= 0 && (i as i64 - cand) <= 0xffff && (i as i64 - cand) > 0;
            if cand_ok && read32(src, cand as usize) == seq {
                let cand = cand as usize;
                let mut match_len = 4usize;
                while i + match_len < n - 5 && src[cand + match_len] == src[i + match_len] {
                    match_len += 1;
                }

                let literals = i - anchor;
                let token_pos = out.len();
                out.push(0);

                if literals >= 15 {
                    out[token_pos] = 0xf0;
                    write_len(&mut out, literals - 15);
                } else {
                    out[token_pos] = (literals as u8) << 4;
                }
                out.extend_from_slice(&src[anchor..i]);

                let offset = i - cand;
                out.push((offset & 0xff) as u8);
                out.push(((offset >> 8) & 0xff) as u8);

                let match_code = match_len - 4;
                if match_code >= 15 {
                    out[token_pos] |= 0x0f;
                    write_len(&mut out, match_code - 15);
                } else {
                    out[token_pos] |= match_code as u8;
                }

                i += match_len;
                anchor = i;
                if i >= 2 {
                    table[hash32(read32(src, i - 2))] = (i - 2) as i64;
                }
            } else {
                i += 1;
            }
        }
    }

    let tail = n - anchor;
    let token_pos = out.len();
    out.push(0);
    if tail >= 15 {
        out[token_pos] = 0xf0;
        write_len(&mut out, tail - 15);
    } else {
        out[token_pos] = (tail as u8) << 4;
    }
    out.extend_from_slice(&src[anchor..n]);
    out
}

fn write_len(out: &mut Vec<u8>, mut len: usize) {
    while len >= 255 {
        out.push(255);
        len -= 255;
    }
    out.push(len as u8);
}

pub fn decompress(src: &[u8], expected: usize) -> Result<Vec<u8>, String> {
    let mut out = vec![0u8; expected];
    let mut ip = 0usize;
    let mut op = 0usize;

    loop {
        if ip >= src.len() {
            return Err("LZ4 数据在 token 处截断".into());
        }
        let token = src[ip];
        ip += 1;

        let mut literals = (token >> 4) as usize;
        if literals == 15 {
            loop {
                if ip >= src.len() {
                    return Err("LZ4 字面量长度截断".into());
                }
                let b = src[ip];
                ip += 1;
                literals += b as usize;
                if b != 255 {
                    break;
                }
            }
        }
        if ip + literals > src.len() {
            return Err("LZ4 字面量越界".into());
        }
        if op + literals > expected {
            return Err("LZ4 输出超出预期长度".into());
        }
        out[op..op + literals].copy_from_slice(&src[ip..ip + literals]);
        ip += literals;
        op += literals;

        if ip >= src.len() {
            break;
        }

        if ip + 2 > src.len() {
            return Err("LZ4 offset 截断".into());
        }
        let offset = src[ip] as usize | (src[ip + 1] as usize) << 8;
        ip += 2;
        if offset == 0 || offset > op {
            return Err(format!("LZ4 offset 非法: {}", offset));
        }

        let mut match_len = (token & 0x0f) as usize;
        if match_len == 15 {
            loop {
                if ip >= src.len() {
                    return Err("LZ4 匹配长度截断".into());
                }
                let b = src[ip];
                ip += 1;
                match_len += b as usize;
                if b != 255 {
                    break;
                }
            }
        }
        match_len += 4;
        if op + match_len > expected {
            return Err("LZ4 匹配输出超出预期长度".into());
        }

        // 允许重叠复制（offset 可以小于 matchLen），逐字节拷贝与 JS 一致
        let from = op - offset;
        for k in 0..match_len {
            out[op + k] = out[from + k];
        }
        op += match_len;
    }

    if op != expected {
        return Err(format!("LZ4 解压长度不符: {} != {}", op, expected));
    }
    Ok(out)
}
