// SPDX-License-Identifier: MIT
// Copyright (c) 2026 MacroCN
//
// 自带的 DEFLATE 解压（RFC 1951）。直通纹理里最常见的是 PNG，PNG 的 IDAT 就是
// zlib 流；为了不给安卓交叉编译引入第三方 crate，这里实现最小可用的 inflate：
// stored / 固定码表 / 动态码表三种块，够 PNG 用，输出与 zlib 逐字节一致。

const MAX_BITS: usize = 15;

struct Bits<'a> {
    data: &'a [u8],
    pos: usize,
    buf: u32,
    cnt: u32,
}

impl<'a> Bits<'a> {
    fn new(data: &'a [u8]) -> Self {
        Bits { data, pos: 0, buf: 0, cnt: 0 }
    }

    /// 取 n 位（LSB 优先）
    fn take(&mut self, n: u32) -> Result<u32, String> {
        if n == 0 {
            return Ok(0);
        }
        while self.cnt < n {
            if self.pos >= self.data.len() {
                return Err("inflate: 数据提前结束".into());
            }
            self.buf |= (self.data[self.pos] as u32) << self.cnt;
            self.pos += 1;
            self.cnt += 8;
        }
        let v = self.buf & ((1u32 << n) - 1);
        self.buf >>= n;
        self.cnt -= n;
        Ok(v)
    }

    fn align_byte(&mut self) {
        let drop_bits = self.cnt % 8;
        self.buf >>= drop_bits;
        self.cnt -= drop_bits;
    }

    /// 字节对齐后按字节读（stored 块用）
    fn read_bytes(&mut self, n: usize) -> Result<&'a [u8], String> {
        self.align_byte();
        // 未消费的整字节先退回
        let back = (self.cnt / 8) as usize;
        let start = self.pos - back;
        if start + n > self.data.len() {
            return Err("inflate: stored 块越界".into());
        }
        self.buf = 0;
        self.cnt = 0;
        self.pos = start + n;
        Ok(&self.data[start..start + n])
    }
}

struct Huff {
    count: [u16; MAX_BITS + 1],
    symbol: Vec<u16>,
}

impl Huff {
    fn new(lengths: &[u8]) -> Result<Self, String> {
        let mut count = [0u16; MAX_BITS + 1];
        for &l in lengths {
            if l as usize > MAX_BITS {
                return Err("inflate: 码长超限".into());
            }
            count[l as usize] += 1;
        }
        if count[0] as usize == lengths.len() {
            // 全零：空码表（distance 可以没有）
            return Ok(Huff { count, symbol: Vec::new() });
        }
        let mut offs = [0u16; MAX_BITS + 2];
        for len in 1..=MAX_BITS {
            offs[len + 1] = offs[len] + count[len];
        }
        let mut symbol = vec![0u16; lengths.len()];
        for (sym, &l) in lengths.iter().enumerate() {
            if l != 0 {
                symbol[offs[l as usize] as usize] = sym as u16;
                offs[l as usize] += 1;
            }
        }
        Ok(Huff { count, symbol })
    }

    fn decode(&self, bits: &mut Bits) -> Result<u16, String> {
        let mut code: u32 = 0;
        let mut first: u32 = 0;
        let mut index: u32 = 0;
        for len in 1..=MAX_BITS {
            code |= bits.take(1)?;
            let count = self.count[len] as u32;
            if code < first + count {
                let idx = (index + (code - first)) as usize;
                return self
                    .symbol
                    .get(idx)
                    .copied()
                    .ok_or_else(|| "inflate: 码表索引越界".to_string());
            }
            index += count;
            first = (first + count) << 1;
            code <<= 1;
        }
        Err("inflate: 非法 Huffman 码".into())
    }
}

const LEN_BASE: [u16; 29] = [
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115,
    131, 163, 195, 227, 258,
];
const LEN_EXTRA: [u8; 29] = [
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DIST_BASE: [u16; 30] = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537,
    2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA: [u8; 30] = [
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12,
    13, 13,
];

fn fixed_trees() -> (Huff, Huff) {
    let mut lit = [0u8; 288];
    for (i, l) in lit.iter_mut().enumerate() {
        *l = if i < 144 {
            8
        } else if i < 256 {
            9
        } else if i < 280 {
            7
        } else {
            8
        };
    }
    let dist = [5u8; 30];
    (Huff::new(&lit).unwrap(), Huff::new(&dist).unwrap())
}

fn build_dynamic(bits: &mut Bits) -> Result<(Huff, Huff), String> {
    let hlit = bits.take(5)? as usize + 257;
    let hdist = bits.take(5)? as usize + 1;
    let hclen = bits.take(4)? as usize + 4;
    if hlit > 286 || hdist > 30 {
        return Err("inflate: 动态块码表数量非法".into());
    }
    const ORDER: [usize; 19] = [
        16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
    ];
    let mut cl_len = [0u8; 19];
    for i in 0..hclen {
        cl_len[ORDER[i]] = bits.take(3)? as u8;
    }
    let cl = Huff::new(&cl_len)?;

    let mut lengths = vec![0u8; hlit + hdist];
    let mut i = 0;
    while i < lengths.len() {
        let sym = cl.decode(bits)?;
        match sym {
            0..=15 => {
                lengths[i] = sym as u8;
                i += 1;
            }
            16 => {
                if i == 0 {
                    return Err("inflate: 重复码出现在开头".into());
                }
                let prev = lengths[i - 1];
                let repeat = bits.take(2)? as usize + 3;
                for _ in 0..repeat {
                    if i >= lengths.len() {
                        return Err("inflate: 重复码越界".into());
                    }
                    lengths[i] = prev;
                    i += 1;
                }
            }
            17 | 18 => {
                let repeat = if sym == 17 {
                    bits.take(3)? as usize + 3
                } else {
                    bits.take(7)? as usize + 11
                };
                for _ in 0..repeat {
                    if i >= lengths.len() {
                        return Err("inflate: 零重复越界".into());
                    }
                    lengths[i] = 0;
                    i += 1;
                }
            }
            _ => return Err("inflate: 码长符号非法".into()),
        }
    }
    let lit = Huff::new(&lengths[..hlit])?;
    let dist = Huff::new(&lengths[hlit..])?;
    Ok((lit, dist))
}

fn copy_match(out: &mut Vec<u8>, dist: usize, len: usize, max_out: usize) -> Result<(), String> {
    if dist == 0 || dist > out.len() {
        return Err("inflate: 回溯距离非法".into());
    }
    if out.len() + len > max_out {
        return Err("inflate: 输出超过上限".into());
    }
    let start = out.len() - dist;
    for k in 0..len {
        let b = out[start + k];
        out.push(b);
    }
    Ok(())
}

fn inflate_block(
    bits: &mut Bits,
    lit: &Huff,
    dist: &Huff,
    out: &mut Vec<u8>,
    max_out: usize,
) -> Result<(), String> {
    loop {
        let sym = lit.decode(bits)?;
        match sym {
            0..=255 => {
                if out.len() >= max_out {
                    return Err("inflate: 输出超过上限".into());
                }
                out.push(sym as u8);
            }
            256 => return Ok(()),
            257..=285 => {
                let idx = (sym - 257) as usize;
                let len = LEN_BASE[idx] as usize + bits.take(LEN_EXTRA[idx] as u32)? as usize;
                let dsym = dist.decode(bits)? as usize;
                if dsym >= 30 {
                    return Err("inflate: 距离码非法".into());
                }
                let d = DIST_BASE[dsym] as usize + bits.take(DIST_EXTRA[dsym] as u32)? as usize;
                copy_match(out, d, len, max_out)?;
            }
            _ => return Err("inflate: 长度码非法".into()),
        }
    }
}

/// 解压裸 DEFLATE 数据（不带 zlib 头），max_out 为输出上限。
pub fn inflate(data: &[u8], max_out: usize) -> Result<Vec<u8>, String> {
    let mut bits = Bits::new(data);
    let mut out: Vec<u8> = Vec::new();
    loop {
        let last = bits.take(1)?;
        let btype = bits.take(2)?;
        match btype {
            0 => {
                let n = bits.read_bytes(2)?;
                let len = u16::from_le_bytes([n[0], n[1]]) as usize;
                let m = bits.read_bytes(2)?;
                let nlen = u16::from_le_bytes([m[0], m[1]]) as usize;
                if (len ^ 0xffff) != nlen {
                    return Err("inflate: stored 块长度校验失败".into());
                }
                let chunk = bits.read_bytes(len)?;
                if out.len() + chunk.len() > max_out {
                    return Err("inflate: 输出超过上限".into());
                }
                out.extend_from_slice(chunk);
            }
            1 => {
                let (lit, dist) = fixed_trees();
                inflate_block(&mut bits, &lit, &dist, &mut out, max_out)?;
            }
            2 => {
                let (lit, dist) = build_dynamic(&mut bits)?;
                inflate_block(&mut bits, &lit, &dist, &mut out, max_out)?;
            }
            _ => return Err("inflate: 块类型非法".into()),
        }
        if last == 1 {
            return Ok(out);
        }
    }
}

/// 解压 zlib 包装（2 字节头 + deflate + adler32），忽略校验和（与 JS 侧一致：zlib 会校验，
/// 但这里只关心像素；校验失败由上层长度/尺寸检查兜住）。
pub fn zlib_inflate(data: &[u8], max_out: usize) -> Result<Vec<u8>, String> {
    if data.len() < 2 {
        return Err("inflate: zlib 头缺失".into());
    }
    let cmf = data[0];
    let flg = data[1];
    if (cmf & 0x0f) != 8 {
        return Err("inflate: 不是 deflate 压缩".into());
    }
    if ((cmf as u16) * 256 + flg as u16) % 31 != 0 {
        return Err("inflate: zlib 头校验失败".into());
    }
    if flg & 0x20 != 0 {
        return Err("inflate: 不支持预置字典".into());
    }
    let start = if flg & 0x20 != 0 { 6 } else { 2 };
    inflate(&data[start..], max_out)
}
