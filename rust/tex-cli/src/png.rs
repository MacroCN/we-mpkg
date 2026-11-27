// SPDX-License-Identifier: MIT
// Copyright (c) 2026 MacroCN
//
// PNG 解码（直通纹理路径）。目标不是做一个通用 PNG 库，而是把 JS 侧 decodePng
// 的语义原样搬过来，逐字节对齐：
//   - 只支持非隔行、compression/filter = 0
//   - 支持 colorType 0/2/3/4/6，bitDepth 1/2/4/8/16
//   - 16 位取样高字节；<8 位只有灰度做 255 缩放（调色板索引不缩放）
//   - colorType 0/2 一律 alpha=255（JS 侧没接 tRNS），调色板用 tRNS

use crate::inflate;

pub struct Png {
    pub width: usize,
    pub height: usize,
    pub data: Vec<u8>,
}

fn be32(b: &[u8]) -> u32 {
    ((b[0] as u32) << 24) | ((b[1] as u32) << 16) | ((b[2] as u32) << 8) | b[3] as u32
}

struct Header {
    width: usize,
    height: usize,
    bit_depth: u8,
    color_type: u8,
}

fn parse_header(data: &[u8]) -> Result<Header, String> {
    if data.len() < 33 || data[..8] != [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] {
        return Err("不是 PNG".into());
    }
    if &data[12..16] != b"IHDR" {
        return Err("PNG 缺少 IHDR".into());
    }
    let width = be32(&data[16..20]) as usize;
    let height = be32(&data[20..24]) as usize;
    if width == 0 || height == 0 {
        return Err("PNG 尺寸为 0".into());
    }
    if data[26] != 0 || data[27] != 0 {
        return Err("PNG compression/filter 非 0".into());
    }
    if data[28] != 0 {
        return Err("PNG 隔行扫描未支持".into());
    }
    Ok(Header { width, height, bit_depth: data[24], color_type: data[25] })
}

/// 只读尺寸，给上层做阈值判断（不解压）
pub fn probe_size(data: &[u8]) -> Option<(usize, usize)> {
    parse_header(data).ok().map(|h| (h.width, h.height))
}

pub fn decode(data: &[u8], max_rgba_bytes: usize) -> Result<Png, String> {
    let h = parse_header(data)?;
    let channels: usize = match h.color_type {
        0 => 1,
        2 => 3,
        3 => 1,
        4 => 2,
        6 => 4,
        _ => return Err(format!("PNG colorType 不支持: {}", h.color_type)),
    };
    if !matches!(h.bit_depth, 1 | 2 | 4 | 8 | 16) {
        return Err(format!("PNG bitDepth 不支持: {}", h.bit_depth));
    }
    let rgba_len = h
        .width
        .checked_mul(h.height)
        .and_then(|n| n.checked_mul(4))
        .ok_or_else(|| "PNG 尺寸溢出".to_string())?;
    if rgba_len > max_rgba_bytes {
        return Err(format!("PNG 解码后 {} 字节超过上限", rgba_len));
    }
    let row_bytes = (h.width * channels * h.bit_depth as usize + 7) / 8;

    // 收集 chunk
    let mut idat: Vec<u8> = Vec::new();
    let mut plte: Option<&[u8]> = None;
    let mut trns: Option<&[u8]> = None;
    let mut off = 8usize;
    while off + 8 <= data.len() {
        let len = be32(&data[off..off + 4]) as usize;
        if &data[off + 4..off + 8] == b"IEND" {
            break;
        }
        let start = off + 8;
        let end = match start.checked_add(len) {
            Some(e) if e <= data.len() => e,
            _ => break,
        };
        let body = &data[start..end];
        match &data[off + 4..off + 8] {
            b"PLTE" => plte = Some(body),
            b"tRNS" => trns = Some(body),
            b"IDAT" => idat.extend_from_slice(body),
            _ => {}
        }
        off = end + 4; // 跳过 CRC
    }
    if idat.is_empty() {
        return Err("PNG 缺少 IDAT".into());
    }

    let need = h.height * (row_bytes + 1);
    let raw = inflate::zlib_inflate(&idat, need + 4096)?;
    if raw.len() < need {
        return Err("PNG 解压数据不足".into());
    }

    // 反滤波
    let bpp = std::cmp::max(1, (channels * h.bit_depth as usize + 7) / 8);
    let mut out = vec![0u8; row_bytes * h.height];
    let mut raw_pos = 0usize;
    for y in 0..h.height {
        let filter = raw[raw_pos];
        raw_pos += 1;
        let row_start = y * row_bytes;
        let prev_start = row_start as isize - row_bytes as isize;
        // 常见滤波（None/Up）直接整行搬，省掉逐字节判断
        if filter == 0 {
            out[row_start..row_start + row_bytes].copy_from_slice(&raw[raw_pos..raw_pos + row_bytes]);
            raw_pos += row_bytes;
            continue;
        }
        if filter == 2 && y == 0 {
            out[row_start..row_start + row_bytes].copy_from_slice(&raw[raw_pos..raw_pos + row_bytes]);
            raw_pos += row_bytes;
            continue;
        }
        for x in 0..row_bytes {
            let cur = raw[raw_pos + x] as i16;
            let left = if x >= bpp { out[row_start + x - bpp] as i16 } else { 0 };
            let up = if y > 0 { out[prev_start as usize + x] as i16 } else { 0 };
            let up_left = if y > 0 && x >= bpp {
                out[prev_start as usize + x - bpp] as i16
            } else {
                0
            };
            let v = match filter {
                0 => cur,
                1 => cur + left,
                2 => cur + up,
                3 => cur + ((left + up) >> 1),
                4 => {
                    let p = left + up - up_left;
                    let pa = (p - left).abs();
                    let pb = (p - up).abs();
                    let pc = (p - up_left).abs();
                    let pred = if pa <= pb && pa <= pc {
                        left
                    } else if pb <= pc {
                        up
                    } else {
                        up_left
                    };
                    cur + pred
                }
                _ => return Err(format!("PNG 滤波类型非法: {}", filter)),
            };
            out[row_start + x] = (v & 0xff) as u8;
        }
        raw_pos += row_bytes;
    }

    // 取样 + 扩到 RGBA8（与 JS 的 readSample/scale 完全一致）
    let read_sample = |row_start: usize, idx: usize| -> u8 {
        match h.bit_depth {
            8 => out[row_start + idx],
            16 => out[row_start + idx * 2],
            bd => {
                let bit_off = idx * bd as usize;
                let byte = out[row_start + (bit_off >> 3)];
                let shift = 8 - bd as usize - (bit_off & 7);
                let mask = (1u16 << bd) - 1;
                ((byte as u16 >> shift) & mask) as u8
            }
        }
    };
    let scale = |v: u8| -> u8 {
        if h.bit_depth >= 8 {
            v
        } else {
            let denom = ((1u16 << h.bit_depth) - 1) as f64;
            (v as f64 * 255.0 / denom).round() as u8
        }
    };

    let mut rgba = vec![0u8; rgba_len];
    // 常见格式走紧凑循环：8 位灰度/灰度+alpha/RGB/RGBA 占实际纹理的绝大多数
    match (h.bit_depth, h.color_type) {
        (8, 6) => {
            // RGBA8：反滤波结果就是目标排布，直接搬
            rgba.copy_from_slice(&out);
            return Ok(Png { width: h.width, height: h.height, data: rgba });
        }
        (8, 2) => {
            let mut si = 0usize;
            for px in rgba.chunks_exact_mut(4) {
                px[0] = out[si];
                px[1] = out[si + 1];
                px[2] = out[si + 2];
                px[3] = 255;
                si += 3;
            }
            return Ok(Png { width: h.width, height: h.height, data: rgba });
        }
        (8, 0) => {
            for (i, px) in rgba.chunks_exact_mut(4).enumerate() {
                let g = out[i];
                px[0] = g;
                px[1] = g;
                px[2] = g;
                px[3] = 255;
            }
            return Ok(Png { width: h.width, height: h.height, data: rgba });
        }
        (8, 4) => {
            let mut si = 0usize;
            for px in rgba.chunks_exact_mut(4) {
                let g = out[si];
                px[0] = g;
                px[1] = g;
                px[2] = g;
                px[3] = out[si + 1];
                si += 2;
            }
            return Ok(Png { width: h.width, height: h.height, data: rgba });
        }
        _ => {}
    }
    for y in 0..h.height {
        let row_start = y * row_bytes;
        for x in 0..h.width {
            let di = (y * h.width + x) * 4;
            match h.color_type {
                6 => {
                    rgba[di] = read_sample(row_start, x * 4);
                    rgba[di + 1] = read_sample(row_start, x * 4 + 1);
                    rgba[di + 2] = read_sample(row_start, x * 4 + 2);
                    rgba[di + 3] = read_sample(row_start, x * 4 + 3);
                }
                2 => {
                    rgba[di] = read_sample(row_start, x * 3);
                    rgba[di + 1] = read_sample(row_start, x * 3 + 1);
                    rgba[di + 2] = read_sample(row_start, x * 3 + 2);
                    rgba[di + 3] = 255;
                }
                4 => {
                    let g = read_sample(row_start, x * 2);
                    rgba[di] = g;
                    rgba[di + 1] = g;
                    rgba[di + 2] = g;
                    rgba[di + 3] = read_sample(row_start, x * 2 + 1);
                }
                0 => {
                    let g = scale(read_sample(row_start, x));
                    rgba[di] = g;
                    rgba[di + 1] = g;
                    rgba[di + 2] = g;
                    rgba[di + 3] = 255;
                }
                _ => {
                    let idx = read_sample(row_start, x) as usize;
                    let pal = plte.ok_or_else(|| "PNG 调色板缺失".to_string())?;
                    if idx * 3 + 2 >= pal.len() {
                        return Err("PNG 调色板索引越界".into());
                    }
                    rgba[di] = pal[idx * 3];
                    rgba[di + 1] = pal[idx * 3 + 1];
                    rgba[di + 2] = pal[idx * 3 + 2];
                    rgba[di + 3] = match trns {
                        Some(t) if idx < t.len() => t[idx],
                        _ => 255,
                    };
                }
            }
        }
    }

    Ok(Png { width: h.width, height: h.height, data: rgba })
}
