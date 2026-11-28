// SPDX-License-Identifier: MIT
// Copyright (c) 2026 MacroCN
//
// PNG 解码（直通纹理路径）。目标不是做一个通用 PNG 库，而是把 JS 侧 decodePng
// 的语义原样搬过来，逐字节对齐：
//   - compression/filter = 0；支持非隔行与 Adam7 隔行（七趟子图）
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
    interlaced: bool,
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
    if data[28] > 1 {
        return Err(format!("PNG interlace 非法: {}", data[28]));
    }
    Ok(Header {
        width,
        height,
        bit_depth: data[24],
        color_type: data[25],
        interlaced: data[28] == 1,
    })
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

    let bpp = std::cmp::max(1, (channels * h.bit_depth as usize + 7) / 8);

    // Adam7 七趟：起点 (ox, oy)、步长 (dx, dy)。非隔行就当成一趟整图。
    const PASSES: [(usize, usize, usize, usize); 7] = [
        (0, 0, 8, 8),
        (4, 0, 8, 8),
        (0, 4, 4, 8),
        (2, 0, 4, 4),
        (0, 2, 2, 4),
        (1, 0, 2, 2),
        (0, 1, 1, 2),
    ];
    let passes: &[(usize, usize, usize, usize)] = if h.interlaced {
        &PASSES
    } else {
        &[(0, 0, 1, 1)]
    };

    // 各趟的行宽/行数，先算出解压后总长度
    let mut plan: Vec<(usize, usize, usize, usize, usize, usize)> = Vec::new(); // (ox,oy,dx,dy,pw,row_bytes)
    let mut need = 0usize;
    for &(ox, oy, dx, dy) in passes {
        let pw = if h.width > ox { (h.width - ox).div_ceil(dx) } else { 0 };
        let ph = if h.height > oy { (h.height - oy).div_ceil(dy) } else { 0 };
        let rb = (pw * channels * h.bit_depth as usize).div_ceil(8);
        if pw == 0 || ph == 0 {
            plan.push((ox, oy, dx, dy, 0, 0));
            continue;
        }
        need += ph * (rb + 1);
        plan.push((ox, oy, dx, dy, pw, rb));
    }
    let raw = inflate::zlib_inflate(&idat, need + 4096)?;
    if raw.len() < need {
        return Err("PNG 解压数据不足".into());
    }

    let read_sample = |buf: &[u8], row_start: usize, idx: usize| -> u8 {
        match h.bit_depth {
            8 => buf[row_start + idx],
            16 => buf[row_start + idx * 2],
            bd => {
                let bit_off = idx * bd as usize;
                let byte = buf[row_start + (bit_off >> 3)];
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
    let mut raw_pos = 0usize;

    for &(ox, oy, dx, dy, pw, rb) in &plan {
        if pw == 0 || rb == 0 {
            continue;
        }
        let ph = (h.height - oy).div_ceil(dy);

        // 逐趟反滤波（上一行是同趟内的上一行，不是整图上一行）
        let mut buf = vec![0u8; rb * ph];
        for y in 0..ph {
            let filter = raw[raw_pos];
            raw_pos += 1;
            let row_start = y * rb;
            let prev_start = row_start as isize - rb as isize;
            if filter == 0 {
                buf[row_start..row_start + rb].copy_from_slice(&raw[raw_pos..raw_pos + rb]);
                raw_pos += rb;
                continue;
            }
            if filter == 2 && y == 0 {
                buf[row_start..row_start + rb].copy_from_slice(&raw[raw_pos..raw_pos + rb]);
                raw_pos += rb;
                continue;
            }
            for x in 0..rb {
                let cur = raw[raw_pos + x] as i16;
                let left = if x >= bpp { buf[row_start + x - bpp] as i16 } else { 0 };
                let up = if y > 0 { buf[prev_start as usize + x] as i16 } else { 0 };
                let up_left = if y > 0 && x >= bpp {
                    buf[prev_start as usize + x - bpp] as i16
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
                buf[row_start + x] = (v & 0xff) as u8;
            }
            raw_pos += rb;
        }

        // 取样 + 扩到 RGBA8，按趟步长散落到整图（与 JS 的 readSample/scale 一致）
        for py in 0..ph {
            let iy = oy + py * dy;
            let row_start = py * rb;
            for px in 0..pw {
                let ix = ox + px * dx;
                let di = (iy * h.width + ix) * 4;
                match h.color_type {
                    6 => {
                        rgba[di] = read_sample(&buf, row_start, px * 4);
                        rgba[di + 1] = read_sample(&buf, row_start, px * 4 + 1);
                        rgba[di + 2] = read_sample(&buf, row_start, px * 4 + 2);
                        rgba[di + 3] = read_sample(&buf, row_start, px * 4 + 3);
                    }
                    2 => {
                        rgba[di] = read_sample(&buf, row_start, px * 3);
                        rgba[di + 1] = read_sample(&buf, row_start, px * 3 + 1);
                        rgba[di + 2] = read_sample(&buf, row_start, px * 3 + 2);
                        rgba[di + 3] = 255;
                    }
                    4 => {
                        let g = read_sample(&buf, row_start, px * 2);
                        rgba[di] = g;
                        rgba[di + 1] = g;
                        rgba[di + 2] = g;
                        rgba[di + 3] = read_sample(&buf, row_start, px * 2 + 1);
                    }
                    0 => {
                        let g = scale(read_sample(&buf, row_start, px));
                        rgba[di] = g;
                        rgba[di + 1] = g;
                        rgba[di + 2] = g;
                        rgba[di + 3] = 255;
                    }
                    _ => {
                        let idx = read_sample(&buf, row_start, px) as usize;
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
    }

    Ok(Png { width: h.width, height: h.height, data: rgba })
}

