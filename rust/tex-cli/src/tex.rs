// SPDX-License-Identifier: MIT
// Copyright (c) 2026 MacroCN
//
// .tex 容器读写 + 移动端物化，逐字节对齐 src/tex.js 的非直通路径：
//   parse -> 取首个 mip -> 解 LZ4 / DXT / RGBA8 / R8 / RG88 -> 裁到逻辑尺寸
//   -> 面积平均降采样 -> 写 TEXB0004（RGBA8888、单 mip、LZ4）-> 自校验
//
// 直通图（imageFormat >= 0，载荷是 PNG/JPEG）仍留给 JS，因为要完整的图片解码器。

use crate::dxt;
use crate::lz4;

pub const TEX_RGBA8888: i32 = 0;
pub const TEX_DXT5: i32 = 4;
pub const TEX_DXT3: i32 = 6;
pub const TEX_DXT1: i32 = 7;
pub const TEX_RG88: i32 = 8;
pub const TEX_R8: i32 = 9;
pub const FLAG_IS_GIF: i32 = 4;
pub const FLAG_IS_VIDEO: i32 = 32;
pub const FREE_IMAGE_UNKNOWN: i32 = -1;
pub const FREE_IMAGE_PNG: i32 = 13;
pub const FREE_IMAGE_JPEG: i32 = 2;

#[derive(Debug)]
pub struct Mip {
    pub width: usize,
    pub height: usize,
    pub lz4: i32,
    pub decompressed: usize,
    pub start: usize,
    pub len: usize,
}

#[derive(Debug)]
pub struct Tex {
    pub format: i32,
    pub flags: i32,
    pub texture_w: i32,
    pub texture_h: i32,
    pub image_w: i32,
    pub image_h: i32,
    pub unk: u32,
    pub magic: String,
    pub image_format: i32,
    pub video_mp4: i32,
    pub images: Vec<Vec<Mip>>,
    pub frames_start: usize,
    pub size: usize,
}

fn read_nstring(buf: &[u8], off: usize) -> Result<(String, usize), String> {
    match buf[off..].iter().position(|&b| b == 0) {
        Some(i) => {
            let s = String::from_utf8_lossy(&buf[off..off + i]).to_string();
            Ok((s, off + i + 1))
        }
        None => Err("NString 缺少终止符".into()),
    }
}

fn i32_at(buf: &[u8], off: usize) -> Result<i32, String> {
    if off + 4 > buf.len() {
        return Err("TEX 数据截断".into());
    }
    Ok(i32::from_le_bytes([buf[off], buf[off + 1], buf[off + 2], buf[off + 3]]))
}

pub fn parse(buf: &[u8]) -> Result<Tex, String> {
    if buf.len() < 32 {
        return Err("文件太小，不是 TEX".into());
    }
    let (m1, o1) = read_nstring(buf, 0)?;
    if m1 != "TEXV0005" {
        return Err(format!("不是 TEX 文件（magic1={}）", m1));
    }
    let (m2, mut off) = read_nstring(buf, o1)?;
    if m2 != "TEXI0001" {
        return Err(format!("不是 TEX 文件（magic2={}）", m2));
    }

    let format = i32_at(buf, off)?;
    let flags = i32_at(buf, off + 4)?;
    let texture_w = i32_at(buf, off + 8)?;
    let texture_h = i32_at(buf, off + 12)?;
    let image_w = i32_at(buf, off + 16)?;
    let image_h = i32_at(buf, off + 20)?;
    if off + 28 > buf.len() {
        return Err("TEX 头部截断".into());
    }
    let unk = u32::from_le_bytes([buf[off + 24], buf[off + 25], buf[off + 26], buf[off + 27]]);
    off += 28;
    if texture_w <= 0 || texture_h <= 0 || image_w <= 0 || image_h <= 0 {
        return Err("TEX 头部尺寸非法".into());
    }

    let (cm, mut off2) = read_nstring(buf, off)?;
    off = off2;
    if !matches!(cm.as_str(), "TEXB0001" | "TEXB0002" | "TEXB0003" | "TEXB0004") {
        return Err(format!("未知的图片容器: {}", cm));
    }
    let image_count = i32_at(buf, off)?;
    off += 4;
    if image_count < 0 || image_count > 4096 {
        return Err(format!("图片数异常: {}", image_count));
    }
    let mut image_format = FREE_IMAGE_UNKNOWN;
    let mut video_mp4 = 0;
    if cm == "TEXB0003" {
        image_format = i32_at(buf, off)?;
        off += 4;
    } else if cm == "TEXB0004" {
        image_format = i32_at(buf, off)?;
        video_mp4 = i32_at(buf, off + 4)?;
        off += 8;
        if image_format == FREE_IMAGE_UNKNOWN && video_mp4 == 1 {
            image_format = 35; // FREE_IMAGE.MP4
        }
    }

    let mip_v4 = cm == "TEXB0004" && image_format == 35;
    let mut images: Vec<Vec<Mip>> = Vec::new();
    for _ in 0..image_count {
        let mip_count = i32_at(buf, off)?;
        off += 4;
        if mip_count < 0 || mip_count > 64 {
            return Err(format!("mip 数异常: {}", mip_count));
        }
        let mut mips = Vec::new();
        for _ in 0..mip_count {
            if mip_v4 {
                off += 8;
                let (_cj, next) = read_nstring(buf, off)?;
                off = next + 4;
            }
            let width = i32_at(buf, off)?;
            let height = i32_at(buf, off + 4)?;
            off += 8;
            let mut lz4_flag = 0;
            let mut decompressed = 0usize;
            if cm != "TEXB0001" {
                lz4_flag = i32_at(buf, off)?;
                let d = i32_at(buf, off + 4)?;
                off += 8;
                if lz4_flag != 0 && lz4_flag != 1 {
                    return Err(format!("mip 的 lz4 标志异常: {}", lz4_flag));
                }
                if d < 0 {
                    return Err(format!("mip 的解压长度异常: {}", d));
                }
                decompressed = d as usize;
            }
            let byte_count = i32_at(buf, off)?;
            off += 4;
            if byte_count < 0 || off + byte_count as usize > buf.len() {
                return Err("mip 载荷越界".into());
            }
            if width <= 0 || height <= 0 {
                return Err("mip 尺寸非法".into());
            }
            mips.push(Mip {
                width: width as usize,
                height: height as usize,
                lz4: lz4_flag,
                decompressed,
                start: off,
                len: byte_count as usize,
            });
            off += byte_count as usize;
        }
        images.push(mips);
    }

    Ok(Tex {
        format, flags, texture_w, texture_h, image_w, image_h, unk,
        magic: cm, image_format, video_mp4, images, frames_start: off, size: buf.len(),
    })
}

/// RGBA8 载荷直接取用（不足直接报错）
fn decode_raw_rgba(payload: &[u8], w: usize, h: usize) -> Result<Vec<u8>, String> {
    let need = w * h * 4;
    if payload.len() < need {
        return Err(format!("RGBA 载荷不足: {} < {}", payload.len(), need));
    }
    Ok(payload[..need].to_vec())
}

fn decode_raw_r8(payload: &[u8], w: usize, h: usize) -> Result<Vec<u8>, String> {
    let need = w * h;
    if payload.len() < need {
        return Err(format!("R8 载荷不足: {} < {}", payload.len(), need));
    }
    let mut out = vec![0u8; need * 4];
    for i in 0..need {
        let v = payload[i];
        out[i * 4] = v;
        out[i * 4 + 1] = v;
        out[i * 4 + 2] = v;
        out[i * 4 + 3] = 255;
    }
    Ok(out)
}

fn decode_raw_rg88(payload: &[u8], w: usize, h: usize) -> Result<Vec<u8>, String> {
    let need = w * h;
    if payload.len() < need * 2 {
        return Err(format!("RG88 载荷不足: {} < {}", payload.len(), need * 2));
    }
    let mut out = vec![0u8; need * 4];
    for i in 0..need {
        out[i * 4] = payload[i * 2];
        out[i * 4 + 1] = payload[i * 2 + 1];
        out[i * 4 + 2] = 0;
        out[i * 4 + 3] = 255;
    }
    Ok(out)
}

fn decode_mip(buf: &[u8], mip: &Mip, format: i32) -> Result<Vec<u8>, String> {
    let raw = &buf[mip.start..mip.start + mip.len];
    let payload: Vec<u8> = if mip.lz4 == 1 {
        if mip.decompressed == 0 {
            return Err("LZ4 载荷缺少解压长度".into());
        }
        lz4::decompress(raw, mip.decompressed)?
    } else {
        raw.to_vec()
    };

    let pixels = match format {
        TEX_DXT1 => {
            let need = dxt::Format::Dxt1.payload_size(mip.width, mip.height);
            if payload.len() != need {
                return Err(format!("DXT 载荷长度不符: {} != {}", payload.len(), need));
            }
            dxt::decode(&payload, dxt::Format::Dxt1, mip.width, mip.height)?
        }
        TEX_DXT3 | TEX_DXT5 => {
            let f = if format == TEX_DXT3 { dxt::Format::Dxt3 } else { dxt::Format::Dxt5 };
            let need = f.payload_size(mip.width, mip.height);
            if payload.len() != need {
                return Err(format!("DXT 载荷长度不符: {} != {}", payload.len(), need));
            }
            dxt::decode(&payload, f, mip.width, mip.height)?
        }
        TEX_RGBA8888 => decode_raw_rgba(&payload, mip.width, mip.height)?,
        TEX_R8 => decode_raw_r8(&payload, mip.width, mip.height)?,
        TEX_RG88 => decode_raw_rg88(&payload, mip.width, mip.height)?,
        other => return Err(format!("不支持的源格式: {}", other)),
    };

    Ok(pixels)
}

fn crop(pixels: Vec<u8>, src_w: usize, src_h: usize, dst_w: usize, dst_h: usize) -> Result<Vec<u8>, String> {
    if src_w == dst_w && src_h == dst_h {
        return Ok(pixels);
    }
    if src_w < dst_w || src_h < dst_h {
        return Err(format!("裁剪尺寸大于原图: {}x{} -> {}x{}", src_w, src_h, dst_w, dst_h));
    }
    let mut out = vec![0u8; dst_w * dst_h * 4];
    for y in 0..dst_h {
        let src_start = y * src_w * 4;
        let dst_start = y * dst_w * 4;
        out[dst_start..dst_start + dst_w * 4].copy_from_slice(&pixels[src_start..src_start + dst_w * 4]);
    }
    Ok(out)
}

pub fn resize_area_average(pixels: &[u8], src_w: usize, src_h: usize, dst_w: usize, dst_h: usize) -> Result<Vec<u8>, String> {
    if src_w == dst_w && src_h == dst_h {
        return Ok(pixels.to_vec());
    }
    if dst_w == 0 || dst_h == 0 || dst_w > src_w || dst_h > src_h {
        return Err("降采样尺寸非法".into());
    }
    let mut out = vec![0u8; dst_w * dst_h * 4];
    let mut x_map = vec![0usize; dst_w + 1];
    for x in 0..=dst_w {
        x_map[x] = (x * src_w) / dst_w;
    }
    for y in 0..dst_h {
        let top = (y * src_h) / dst_h;
        let bottom = std::cmp::max(top + 1, ((y + 1) * src_h) / dst_h);
        for x in 0..dst_w {
            let left = x_map[x];
            let right = std::cmp::max(left + 1, x_map[x + 1]);
            let count = ((right - left) * (bottom - top)) as u64;
            let di = (y * dst_w + x) * 4;
            let (mut r, mut g, mut b, mut a) = (0u64, 0u64, 0u64, 0u64);
            for sy in top..bottom {
                let mut si = (sy * src_w + left) * 4;
                for _ in left..right {
                    r += pixels[si] as u64;
                    g += pixels[si + 1] as u64;
                    b += pixels[si + 2] as u64;
                    a += pixels[si + 3] as u64;
                    si += 4;
                }
            }
            out[di] = ((r + count / 2) / count) as u8;
            out[di + 1] = ((g + count / 2) / count) as u8;
            out[di + 2] = ((b + count / 2) / count) as u8;
            out[di + 3] = ((a + count / 2) / count) as u8;
        }
    }
    Ok(out)
}

fn target_size(w: usize, h: usize, scale: f64) -> (usize, usize) {
    let s = if scale > 0.0 && scale < 1.0 { scale } else { 1.0 };
    (
        std::cmp::max(1, (w as f64 * s).floor() as usize),
        std::cmp::max(1, (h as f64 * s).floor() as usize),
    )
}

fn write_nstring(out: &mut Vec<u8>, s: &str) {
    out.extend_from_slice(s.as_bytes());
    out.push(0);
}

fn put_i32(out: &mut Vec<u8>, v: i32) {
    out.extend_from_slice(&v.to_le_bytes());
}

fn put_u32(out: &mut Vec<u8>, v: u32) {
    out.extend_from_slice(&v.to_le_bytes());
}

pub struct ConvertOpts {
    pub scale: f64,
    pub frames_tail: bool,
}

pub struct Converted {
    pub bytes: Vec<u8>,
    pub width: usize,
    pub height: usize,
    pub downsampled: bool,
    pub frames_tail_len: usize,
    /// 已经在本进程内做过移动端可读性自校验（JS 侧不必再回读产物重解析）
    pub verified: bool,
}

pub fn convert(buf: &[u8], opts: &ConvertOpts) -> Result<Converted, String> {
    let tex = parse(buf)?;
    // 直通图（PNG / JPEG / GIF 帧都是 PNG/JPEG 载荷）按载荷 magic 解码，
    // 认不出的图种（BMP 等）交给 JS 侧
    let passthrough = tex.image_format >= 0;
    if tex.images.is_empty() {
        return Err("没有可写入的图像".into());
    }
    let animated = (tex.flags & FLAG_IS_GIF) != 0;
    let frames_start = tex.frames_start;
    let frames_tail = if opts.frames_tail && frames_start < buf.len() { buf[frames_start..].to_vec() } else { Vec::new() };

    let mut images: Vec<(usize, usize, Vec<u8>)> = Vec::new();
    let mut downsampled = false;
    for mips in &tex.images {
        let mip = mips.first().ok_or("帧没有 mip")?;
        let logical_w = tex.image_w as usize;
        let logical_h = tex.image_h as usize;
        let mut pixels = if passthrough {
            let raw = &buf[mip.start..mip.start + mip.len];
            let owned;
            let payload: &[u8] = if mip.lz4 == 1 {
                if mip.decompressed == 0 {
                    return Err("直通图载荷被 LZ4 压缩但缺少解压长度".into());
                }
                owned = crate::lz4::decompress(raw, mip.decompressed)?;
                &owned
            } else {
                raw
            };
            let (w, h, data) = if payload.len() >= 8 && payload[..4] == [0x89, 0x50, 0x4E, 0x47] {
                let p = crate::png::decode(payload, 512 * 1024 * 1024)?;
                (p.width, p.height, p.data)
            } else if payload.len() >= 3 && payload[0] == 0xFF && payload[1] == 0xD8 {
                let j = crate::jpeg::decode(payload)?;
                (j.width, j.height, j.data)
            } else {
                return Err("passthrough-unsupported（未知图种）".into());
            };
            if w != mip.width || h != mip.height {
                return Err(format!(
                    "直通图尺寸 {}x{} 与 TEX 记录 {}x{} 不符",
                    w, h, mip.width, mip.height
                ));
            }
            data
        } else {
            decode_mip(buf, mip, tex.format)?
        };
        let mut eff_w = mip.width;
        let mut eff_h = mip.height;
        if logical_w <= eff_w && logical_h <= eff_h && (logical_w != eff_w || logical_h != eff_h) {
            pixels = crop(pixels, eff_w, eff_h, logical_w, logical_h)?;
            eff_w = logical_w;
            eff_h = logical_h;
        }
        let (want_w, want_h) = target_size(eff_w, eff_h, opts.scale);
        if want_w != eff_w || want_h != eff_h {
            pixels = resize_area_average(&pixels, eff_w, eff_h, want_w, want_h)?;
            downsampled = true;
        }
        if pixels.len() != want_w * want_h * 4 {
            return Err("像素长度与尺寸不符".into());
        }
        images.push((want_w, want_h, pixels));
    }

    let flags = tex.flags & !FLAG_IS_VIDEO;
    let first_w = images[0].0;
    let first_h = images[0].1;

    let mut out: Vec<u8> = Vec::new();
    write_nstring(&mut out, "TEXV0005");
    write_nstring(&mut out, "TEXI0001");
    put_i32(&mut out, TEX_RGBA8888);
    put_i32(&mut out, flags);
    put_i32(&mut out, first_w as i32);
    put_i32(&mut out, first_h as i32);
    put_i32(&mut out, first_w as i32);
    put_i32(&mut out, first_h as i32);
    put_u32(&mut out, tex.unk);
    write_nstring(&mut out, "TEXB0004");
    put_i32(&mut out, images.len() as i32);
    put_i32(&mut out, FREE_IMAGE_UNKNOWN);
    put_i32(&mut out, 0);

    for (w, h, pixels) in &images {
        put_i32(&mut out, 1);
        let compressed = lz4::compress(pixels);
        let use_lz4 = compressed.len() + 16 < pixels.len();
        let payload: &[u8] = if use_lz4 { &compressed } else { pixels };
        put_i32(&mut out, *w as i32);
        put_i32(&mut out, *h as i32);
        put_i32(&mut out, if use_lz4 { 1 } else { 0 });
        put_i32(&mut out, pixels.len() as i32);
        put_i32(&mut out, payload.len() as i32);
        out.extend_from_slice(payload);
    }
    if !frames_tail.is_empty() {
        out.extend_from_slice(&frames_tail);
    }

    // 自校验：重新解析自己，确认移动端读得到
    let check = parse(&out)?;
    if check.format != TEX_RGBA8888 || check.magic != "TEXB0004" || check.image_format != FREE_IMAGE_UNKNOWN {
        return Err("输出容器自校验失败".into());
    }
    for mips in &check.images {
        if mips.len() != 1 {
            return Err("输出 mip 数不为 1".into());
        }
        let mip = &mips[0];
        let need = mip.width * mip.height * 4;
        if mip.lz4 == 1 && mip.decompressed != need {
            return Err(format!("输出解压长度不符: {} != {}", mip.decompressed, need));
        }
        if mip.lz4 == 0 && mip.len != need {
            return Err(format!("输出未压缩长度不符: {} != {}", mip.len, need));
        }
    }
    if animated && frames_tail.is_empty() && frames_start < buf.len() {
        return Err("动图帧表缺失".into());
    }
    if !frames_tail.is_empty() {
        let produced_tail = &out[check.frames_start..];
        if produced_tail != frames_tail.as_slice() {
            return Err("输出尾帧表与输入不一致".into());
        }
    }

    Ok(Converted {
        width: first_w,
        height: first_h,
        downsampled,
        bytes: out,
        frames_tail_len: frames_tail.len(),
        verified: true,
    })
}
