// SPDX-License-Identifier: MIT
// Copyright (c) 2026 MacroCN
//
// S3TC 块解码 -> RGBA8。逐字节对齐 src/dxt.js（GPU 解码语义，不做近似）。

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Format {
    Dxt1,
    Dxt2,
    Dxt3,
    Dxt4,
    Dxt5,
}

impl Format {
    pub fn parse(s: &str) -> Option<Format> {
        match s.to_ascii_lowercase().as_str() {
            "dxt1" => Some(Format::Dxt1),
            "dxt2" => Some(Format::Dxt2),
            "dxt3" => Some(Format::Dxt3),
            "dxt4" => Some(Format::Dxt4),
            "dxt5" => Some(Format::Dxt5),
            _ => None,
        }
    }

    pub fn block_bytes(self) -> usize {
        if self == Format::Dxt1 { 8 } else { 16 }
    }

    pub fn payload_size(self, w: usize, h: usize) -> usize {
        w.div_ceil(4) * h.div_ceil(4) * self.block_bytes()
    }
}

fn expand565(c: u16) -> (u8, u8, u8) {
    let r = ((c >> 11) & 0x1f) as u8;
    let g = ((c >> 5) & 0x3f) as u8;
    let b = (c & 0x1f) as u8;
    ((r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2))
}

#[inline]
fn round_div(v: f64) -> u8 {
    let r = v.round();
    if r < 0.0 { 0 } else if r > 255.0 { 255 } else { r as u8 }
}

/// 4 色 / 3 色调色板（DXT1 的 c0 <= c1 就是 3 色 + 透明）
fn color_palette(c0: u16, c1: u16, is_dxt1: bool) -> [[u8; 4]; 4] {
    let (ar, ag, ab) = expand565(c0);
    let (br, bg, bb) = expand565(c1);
    let mut pal = [[0u8; 4]; 4];
    pal[0] = [ar, ag, ab, 255];
    pal[1] = [br, bg, bb, 255];
    if !is_dxt1 || c0 > c1 {
        pal[2] = [
            round_div((2.0 * ar as f64 + br as f64) / 3.0),
            round_div((2.0 * ag as f64 + bg as f64) / 3.0),
            round_div((2.0 * ab as f64 + bb as f64) / 3.0),
            255,
        ];
        pal[3] = [
            round_div((ar as f64 + 2.0 * br as f64) / 3.0),
            round_div((ag as f64 + 2.0 * bg as f64) / 3.0),
            round_div((ab as f64 + 2.0 * bb as f64) / 3.0),
            255,
        ];
    } else {
        pal[2] = [
            round_div((ar as f64 + br as f64) / 2.0),
            round_div((ag as f64 + bg as f64) / 2.0),
            round_div((ab as f64 + bb as f64) / 2.0),
            255,
        ];
        pal[3] = [0, 0, 0, 0];
    }
    pal
}

fn alpha_palette(a0: u8, a1: u8) -> [u8; 8] {
    let mut pal = [0u8; 8];
    pal[0] = a0;
    pal[1] = a1;
    if a0 > a1 {
        for i in 1..=6 {
            pal[i + 1] = round_div(((7 - i) as f64 * a0 as f64 + i as f64 * a1 as f64) / 7.0);
        }
    } else {
        for i in 1..=4 {
            pal[i + 1] = round_div(((5 - i) as f64 * a0 as f64 + i as f64 * a1 as f64) / 5.0);
        }
        pal[6] = 0;
        pal[7] = 255;
    }
    pal
}

/// DXT5 alpha 第 n 个 3bit 索引（行优先），允许跨字节
fn alpha_index_at(alpha8: &[u8], n: usize) -> usize {
    let bit_pos = n * 3;
    let byte = 2 + (bit_pos >> 3);
    if byte >= 8 {
        return 0;
    }
    let shift = bit_pos & 7;
    let v = alpha8[byte] as u32 | (if byte + 1 < 8 { alpha8[byte + 1] as u32 } else { 0 }) << 8;
    ((v >> shift) & 0x7) as usize
}

pub fn decode(buf: &[u8], fmt: Format, width: usize, height: usize) -> Result<Vec<u8>, String> {
    if width == 0 || height == 0 {
        return Err(format!("DXT 尺寸非法: {}x{}", width, height));
    }
    let need = fmt.payload_size(width, height);
    if buf.len() < need {
        return Err(format!("DXT 载荷不足: 需要 {} 字节，实际 {}", need, buf.len()));
    }
    let is_dxt1 = fmt == Format::Dxt1;
    let has_alpha4 = fmt == Format::Dxt2 || fmt == Format::Dxt3;
    let has_alpha8 = fmt == Format::Dxt4 || fmt == Format::Dxt5;

    let bx = width.div_ceil(4);
    let by = height.div_ceil(4);
    let mut out = vec![0u8; width * height * 4];
    let mut off = 0usize;

    for block_y in 0..by {
        for block_x in 0..bx {
            let mut alpha4 = [0u8; 8];
            let mut alpha8 = [0u8; 8];
            if has_alpha4 {
                // DXT3：8 字节共 16 个 4bit alpha，标准 S3TC 连续排布：
                // 像素 (x,y) 是第 4y+x 个 nibble（字节 (4y+x)>>1，低/高 nibble 交替）
                alpha4.copy_from_slice(&buf[off..off + 8]);
                off += 8;
            } else if has_alpha8 {
                alpha8.copy_from_slice(&buf[off..off + 8]);
                off += 8;
            }

            let c0 = buf[off] as u16 | (buf[off + 1] as u16) << 8;
            let c1 = buf[off + 2] as u16 | (buf[off + 3] as u16) << 8;
            let indices = u32::from_le_bytes([buf[off + 4], buf[off + 5], buf[off + 6], buf[off + 7]]);
            off += 8;

            let pal = color_palette(c0, c1, is_dxt1);
            let apal = if has_alpha8 { alpha_palette(alpha8[0], alpha8[1]) } else { [0u8; 8] };

            for y in 0..4 {
                let py = block_y * 4 + y;
                if py >= height {
                    break;
                }
                for x in 0..4 {
                    let px = block_x * 4 + x;
                    if px >= width {
                        continue;
                    }
                    let idx = ((indices >> (2 * (4 * y + x))) & 0x3) as usize;
                    let c = pal[idx];
                    let di = (py * width + px) * 4;
                    out[di] = c[0];
                    out[di + 1] = c[1];
                    out[di + 2] = c[2];

                    let mut alpha = c[3];
                    if has_alpha4 {
                        let n = 4 * y + x;
                        alpha = ((((alpha4[n >> 1] as u16) >> ((n & 1) * 4)) & 0x0f) * 17) as u8;
                    } else if has_alpha8 {
                        alpha = apal[alpha_index_at(&alpha8, 4 * y + x)];
                    }
                    out[di + 3] = alpha;
                }
            }
        }
    }
    Ok(out)
}

pub fn decode_blocks(buf: &[u8], fmt: Format, width: usize, height: usize) -> Result<Vec<u8>, String> {
    decode(buf, fmt, width, height)
}
