//! JPEG 解码（baseline / extended / progressive），逐字节对齐 JS 侧 jpeg-js。
//!
//! jpeg-js 是 notmasteryet 的 JS 移植版，IDCT 用整数定点运算，因此这里的
//! 定点步骤、取整方向、上采样取点公式都按原实现一比一复刻，输出才能与 JS
//! 完全一致（黄金样本按 SHA-256 对比）。色度上采样是最近邻，不是 fancy。

pub struct Image {
    pub width: usize,
    pub height: usize,
    pub data: Vec<u8>,
}

const DCT_ZIGZAG: [usize; 64] = [
    0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20,
    13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59,
    52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
];

const DCT_COS1: i32 = 4017;
const DCT_SIN1: i32 = 799;
const DCT_COS3: i32 = 3406;
const DCT_SIN3: i32 = 2276;
const DCT_COS6: i32 = 1567;
const DCT_SIN6: i32 = 3784;
const DCT_SQRT2: i32 = 5793;
const DCT_SQRT1D2: i32 = 2896;

#[derive(Clone, Default)]
struct Huff {
    mincode: [i32; 17],
    maxcode: [i32; 17],
    valptr: [usize; 17],
    values: Vec<u8>,
}

impl Huff {
    fn build(lengths: &[u8; 16], values: &[u8]) -> Huff {
        let mut h = Huff::default();
        let mut code: i32 = 0;
        let mut k: usize = 0;
        for len in 1..=16usize {
            let n = lengths[len - 1] as usize;
            if n > 0 {
                h.valptr[len] = k;
                h.mincode[len] = code;
                for _ in 0..n {
                    code += 1;
                    k += 1;
                }
                h.maxcode[len] = code - 1;
            } else {
                h.maxcode[len] = -1;
            }
            if code > (1 << len) {
                // 码长分配非法
                h.maxcode[len] = -1;
            }
            code <<= 1;
        }
        h.values = values.to_vec();
        h
    }
}

struct Component {
    id: usize,
    h: usize,
    v: usize,
    qidx: usize,
    quant: [i32; 64],
    blocks_per_line: usize,
    blocks_per_column: usize,
    blocks: Vec<Vec<[i32; 64]>>,
    pred: i32,
    dc_tbl: usize,
    ac_tbl: usize,
}

struct Frame {
    progressive: bool,
    precision: u8,
    scan_lines: usize,
    samples_per_line: usize,
    max_h: usize,
    max_v: usize,
    mcus_per_line: usize,
    mcus_per_column: usize,
    components: Vec<Component>,
}

struct Scan<'a> {
    data: &'a [u8],
    offset: usize,
    bits_data: u8,
    bits_count: u32,
}

impl<'a> Scan<'a> {
    fn read_bit(&mut self) -> Result<u32, String> {
        if self.bits_count > 0 {
            self.bits_count -= 1;
            return Ok(((self.bits_data as u32) >> self.bits_count) & 1);
        }
        if self.offset >= self.data.len() {
            return Err("JPEG 数据提前结束".into());
        }
        self.bits_data = self.data[self.offset];
        self.offset += 1;
        if self.bits_data == 0xFF {
            if self.offset >= self.data.len() {
                return Err("JPEG 数据提前结束".into());
            }
            let next = self.data[self.offset];
            self.offset += 1;
            if next != 0 {
                return Err(format!("unexpected marker: {:04x}", ((self.bits_data as u16) << 8) | next as u16));
            }
        }
        self.bits_count = 7;
        Ok((self.bits_data as u32) >> 7)
    }

    fn decode_huff(&mut self, t: &Huff) -> Result<u8, String> {
        if t.values.is_empty() {
            return Err("缺少霍夫曼表".into());
        }
        let mut code: i32 = 0;
        for len in 1..=16usize {
            let bit = self.read_bit()? as i32;
            code = (code << 1) | bit;
            if t.maxcode[len] >= 0 && code <= t.maxcode[len] {
                let idx = t.valptr[len] + (code - t.mincode[len]) as usize;
                return t.values.get(idx).copied().ok_or_else(|| "霍夫曼序列越界".to_string());
            }
        }
        Err("无效的霍夫曼序列".into())
    }

    fn receive(&mut self, len: u32) -> Result<i32, String> {
        let mut n = 0i32;
        for _ in 0..len {
            n = (n << 1) | self.read_bit()? as i32;
        }
        Ok(n)
    }

    fn receive_extend(&mut self, len: u32) -> Result<i32, String> {
        if len == 0 {
            return Ok(0);
        }
        let n = self.receive(len)?;
        if n >= 1 << (len - 1) {
            Ok(n)
        } else {
            Ok(n + (-1i32 << len) + 1)
        }
    }
}

#[derive(Default)]
struct ProgressState {
    eobrun: i32,
    successive_ac_state: u8,
    successive_ac_next_value: i32,
}

fn decode_baseline(scan: &mut Scan, comp: &mut Component, zz: &mut [i32; 64], tables: &[Huff], _st: &mut ProgressState, _ss: usize, _se: usize, _ap: u8, _successive: bool) -> Result<(), String> {
    let dc = comp.dc_tbl;
    let ac = comp.ac_tbl + 4;
    let t = scan.decode_huff(&tables[dc])? as u32;
    let diff = if t == 0 { 0 } else { scan.receive_extend(t)? };
    comp.pred = comp.pred.wrapping_add(diff);
    zz[0] = comp.pred;
    let mut k = 1usize;
    while k < 64 {
        let rs = scan.decode_huff(&tables[ac])? as u32;
        let s = (rs & 15) as u32;
        let r = (rs >> 4) as usize;
        if s == 0 {
            if r < 15 {
                break;
            }
            k += 16;
            continue;
        }
        k += r;
        if k >= 64 {
            break;
        }
        let z = DCT_ZIGZAG[k];
        zz[z] = scan.receive_extend(s)?;
        k += 1;
    }
    Ok(())
}

fn decode_dc_first(scan: &mut Scan, comp: &mut Component, zz: &mut [i32; 64], tables: &[Huff], _st: &mut ProgressState, _ss: usize, _se: usize, ap: u8, _successive: bool) -> Result<(), String> {
    let dc = comp.dc_tbl;
    let t = scan.decode_huff(&tables[dc])? as u32;
    let diff = if t == 0 { 0 } else { scan.receive_extend(t)? << ap };
    comp.pred = comp.pred.wrapping_add(diff);
    zz[0] = comp.pred;
    Ok(())
}

fn decode_dc_successive(scan: &mut Scan, _comp: &mut Component, zz: &mut [i32; 64], _tables: &[Huff], _st: &mut ProgressState, _ss: usize, _se: usize, ap: u8, _successive: bool) -> Result<(), String> {
    zz[0] |= (scan.read_bit()? as i32) << ap;
    Ok(())
}

fn decode_ac_first(scan: &mut Scan, comp: &mut Component, zz: &mut [i32; 64], tables: &[Huff], st: &mut ProgressState, ss: usize, se: usize, ap: u8, _successive: bool) -> Result<(), String> {
    if st.eobrun > 0 {
        st.eobrun -= 1;
        return Ok(());
    }
    let ac = comp.ac_tbl + 4;
    let mut k = ss;
    while k <= se {
        let rs = scan.decode_huff(&tables[ac])? as u32;
        let s = rs & 15;
        let r = rs >> 4;
        if s == 0 {
            if r < 15 {
                st.eobrun = scan.receive(r)? + (1 << r) - 1;
                break;
            }
            k += 16;
            continue;
        }
        k += r as usize;
        if k > 63 {
            break;
        }
        let z = DCT_ZIGZAG[k];
        zz[z] = scan.receive_extend(s)? << ap;
        k += 1;
    }
    Ok(())
}

fn decode_ac_successive(scan: &mut Scan, comp: &mut Component, zz: &mut [i32; 64], tables: &[Huff], st: &mut ProgressState, ss: usize, se: usize, ap: u8, _successive: bool) -> Result<(), String> {
    let ac = comp.ac_tbl + 4;
    let mut k = ss;
    let mut r: i32 = 0;
    while k <= se {
        let z = DCT_ZIGZAG[k];
        let direction = if zz[z] < 0 { -1 } else { 1 };
        match st.successive_ac_state {
            0 => {
                let rs = scan.decode_huff(&tables[ac])? as u32;
                let s = rs & 15;
                let rr = rs >> 4;
                r = rr as i32;
                if s == 0 {
                    if rr < 15 {
                        st.eobrun = scan.receive(rr)? + (1 << rr);
                        st.successive_ac_state = 4;
                    } else {
                        r = 16;
                        st.successive_ac_state = 1;
                    }
                } else {
                    if s != 1 {
                        return Err("invalid ACn encoding".into());
                    }
                    st.successive_ac_next_value = scan.receive_extend(s)?;
                    st.successive_ac_state = if rr != 0 { 2 } else { 3 };
                }
                // jpeg-js 这里 continue 跳过 k++：同一个系数位继续按新状态处理
                continue;
            }
            1 | 2 => {
                if zz[z] != 0 {
                    zz[z] += ((scan.read_bit()? as i32) << ap) * direction;
                } else {
                    r -= 1;
                    if r == 0 {
                        st.successive_ac_state = if st.successive_ac_state == 2 { 3 } else { 0 };
                    }
                }
            }
            3 => {
                if zz[z] != 0 {
                    zz[z] += ((scan.read_bit()? as i32) << ap) * direction;
                } else {
                    zz[z] = st.successive_ac_next_value << ap;
                    st.successive_ac_state = 0;
                }
            }
            _ => {
                if zz[z] != 0 {
                    zz[z] += ((scan.read_bit()? as i32) << ap) * direction;
                }
            }
        }
        k += 1;
    }
    if st.successive_ac_state == 4 {
        st.eobrun -= 1;
        if st.eobrun == 0 {
            st.successive_ac_state = 0;
        }
    }
    Ok(())
}

type DecodeFn = fn(
    &mut Scan, &mut Component, &mut [i32; 64], &[Huff], &mut ProgressState,
    usize, usize, u8, bool,
) -> Result<(), String>;

#[allow(clippy::too_many_arguments)]
fn decode_scan(
    data: &[u8],
    offset: usize,
    frame: &mut Frame,
    comp_ids: &[usize],
    reset_interval: usize,
    ss: usize,
    se: usize,
    successive_prev: u8,
    al: u8,
    tables: &[Huff],
) -> Result<usize, String> {
    let start = offset;
    let mut scan = Scan { data, offset, bits_data: 0, bits_count: 0 };
    let mut st = ProgressState::default();
    let decode_fn: DecodeFn = if frame.progressive {
        if ss == 0 {
            if successive_prev == 0 { decode_dc_first } else { decode_dc_successive }
        } else if successive_prev == 0 {
            decode_ac_first
        } else {
            decode_ac_successive
        }
    } else {
        decode_baseline
    };
    // 位移量是 Al（低 nibble 的数值），Ah 只决定用首扫还是精修函数
    let ap = al;

    let single = comp_ids.len() == 1;
    let mcu_expected = if single {
        frame.components[comp_ids[0]].blocks_per_line * frame.components[comp_ids[0]].blocks_per_column
    } else {
        frame.mcus_per_line * frame.mcus_per_column
    };
    let reset = if reset_interval == 0 { mcu_expected } else { reset_interval };
    let mut mcu = 0usize;

    while mcu < mcu_expected {
        for &ci in comp_ids {
            frame.components[ci].pred = 0;
        }
        st.eobrun = 0;

        if single {
            let ci = comp_ids[0];
            let bpl = frame.components[ci].blocks_per_line;
            for _ in 0..reset {
                let br = mcu / bpl;
                let bc = mcu % bpl;
                if br < frame.components[ci].blocks.len() && bc < frame.components[ci].blocks[br].len() {
                    let mut zz = frame.components[ci].blocks[br][bc];
                    decode_fn(&mut scan, &mut frame.components[ci], &mut zz, tables, &mut st, ss, se, ap, false)?;
                    frame.components[ci].blocks[br][bc] = zz;
                }
                mcu += 1;
            }
        } else {
            let mpl = frame.mcus_per_line;
            for _ in 0..reset {
                for &ci in comp_ids {
                    let (h, v) = (frame.components[ci].h, frame.components[ci].v);
                    let mcu_row = mcu / mpl;
                    let mcu_col = mcu % mpl;
                    for row in 0..v {
                        for col in 0..h {
                            let br = mcu_row * v + row;
                            let bc = mcu_col * h + col;
                            if br < frame.components[ci].blocks.len() && bc < frame.components[ci].blocks[br].len() {
                                let mut zz = frame.components[ci].blocks[br][bc];
                                decode_fn(&mut scan, &mut frame.components[ci], &mut zz, tables, &mut st, ss, se, ap, false)?;
                                frame.components[ci].blocks[br][bc] = zz;
                            }
                        }
                    }
                }
                mcu += 1;
                if mcu == mcu_expected {
                    break;
                }
            }
        }

        if mcu == mcu_expected {
            let mut o = scan.offset;
            while o < data.len().saturating_sub(2) {
                if data[o] == 0xFF && data[o + 1] != 0x00 {
                    break;
                }
                o += 1;
            }
            scan.offset = o;
        }

        scan.bits_count = 0;
        if scan.offset + 1 >= data.len() {
            return Err("JPEG 在扫描数据后缺少标记".into());
        }
        let marker = ((data[scan.offset] as u16) << 8) | data[scan.offset + 1] as u16;
        if marker < 0xFF00 {
            return Err("marker was not found".into());
        }
        if (0xFFD0..=0xFFD7).contains(&marker) {
            scan.offset += 2;
        } else {
            break;
        }
    }
    let end = scan.offset;
    Ok(end - start)
}

fn quantize_and_inverse(zz: &[i32; 64], qt: &[i32; 64], out: &mut [u8; 64]) {
    let mut p = [0i32; 64];
    for i in 0..64 {
        p[i] = zz[i].wrapping_mul(qt[i]);
    }

    for i in 0..8usize {
        let row = 8 * i;
        if p[1 + row] == 0 && p[2 + row] == 0 && p[3 + row] == 0 && p[4 + row] == 0
            && p[5 + row] == 0 && p[6 + row] == 0 && p[7 + row] == 0
        {
            let t = (DCT_SQRT2.wrapping_mul(p[row]) + 512) >> 10;
            for j in 0..8 {
                p[row + j] = t;
            }
            continue;
        }

        let mut v0 = (DCT_SQRT2.wrapping_mul(p[row]) + 128) >> 8;
        let mut v1 = (DCT_SQRT2.wrapping_mul(p[4 + row]) + 128) >> 8;
        let mut v2 = p[2 + row];
        let mut v3 = p[6 + row];
        let mut v4 = (DCT_SQRT1D2.wrapping_mul(p[1 + row] - p[7 + row]) + 128) >> 8;
        let mut v7 = (DCT_SQRT1D2.wrapping_mul(p[1 + row] + p[7 + row]) + 128) >> 8;
        let mut v5 = p[3 + row] << 4;
        let mut v6 = p[5 + row] << 4;

        let t = (v0 - v1 + 1) >> 1;
        v0 = (v0 + v1 + 1) >> 1;
        v1 = t;
        let t = (v2.wrapping_mul(DCT_SIN6) + v3.wrapping_mul(DCT_COS6) + 128) >> 8;
        v2 = (v2.wrapping_mul(DCT_COS6) - v3.wrapping_mul(DCT_SIN6) + 128) >> 8;
        v3 = t;
        let t = (v4 - v6 + 1) >> 1;
        v4 = (v4 + v6 + 1) >> 1;
        v6 = t;
        let t = (v7 + v5 + 1) >> 1;
        v5 = (v7 - v5 + 1) >> 1;
        v7 = t;

        let t = (v0 - v3 + 1) >> 1;
        v0 = (v0 + v3 + 1) >> 1;
        v3 = t;
        let t = (v1 - v2 + 1) >> 1;
        v1 = (v1 + v2 + 1) >> 1;
        v2 = t;
        let t = (v4.wrapping_mul(DCT_SIN3) + v7.wrapping_mul(DCT_COS3) + 2048) >> 12;
        v4 = (v4.wrapping_mul(DCT_COS3) - v7.wrapping_mul(DCT_SIN3) + 2048) >> 12;
        v7 = t;
        let t = (v5.wrapping_mul(DCT_SIN1) + v6.wrapping_mul(DCT_COS1) + 2048) >> 12;
        v5 = (v5.wrapping_mul(DCT_COS1) - v6.wrapping_mul(DCT_SIN1) + 2048) >> 12;
        v6 = t;

        p[row] = v0 + v7;
        p[7 + row] = v0 - v7;
        p[1 + row] = v1 + v6;
        p[6 + row] = v1 - v6;
        p[2 + row] = v2 + v5;
        p[5 + row] = v2 - v5;
        p[3 + row] = v3 + v4;
        p[4 + row] = v3 - v4;
    }

    for i in 0..8usize {
        let col = i;
        if p[8 + col] == 0 && p[16 + col] == 0 && p[24 + col] == 0 && p[32 + col] == 0
            && p[40 + col] == 0 && p[48 + col] == 0 && p[56 + col] == 0
        {
            let t = (DCT_SQRT2.wrapping_mul(p[col]) + 8192) >> 14;
            for j in 0..8 {
                p[j * 8 + col] = t;
            }
            continue;
        }

        let mut v0 = (DCT_SQRT2.wrapping_mul(p[col]) + 2048) >> 12;
        let mut v1 = (DCT_SQRT2.wrapping_mul(p[32 + col]) + 2048) >> 12;
        let mut v2 = p[16 + col];
        let mut v3 = p[48 + col];
        let mut v4 = (DCT_SQRT1D2.wrapping_mul(p[8 + col] - p[56 + col]) + 2048) >> 12;
        let mut v7 = (DCT_SQRT1D2.wrapping_mul(p[8 + col] + p[56 + col]) + 2048) >> 12;
        let mut v5 = p[24 + col];
        let mut v6 = p[40 + col];

        let t = (v0 - v1 + 1) >> 1;
        v0 = (v0 + v1 + 1) >> 1;
        v1 = t;
        let t = (v2.wrapping_mul(DCT_SIN6) + v3.wrapping_mul(DCT_COS6) + 2048) >> 12;
        v2 = (v2.wrapping_mul(DCT_COS6) - v3.wrapping_mul(DCT_SIN6) + 2048) >> 12;
        v3 = t;
        let t = (v4 - v6 + 1) >> 1;
        v4 = (v4 + v6 + 1) >> 1;
        v6 = t;
        let t = (v7 + v5 + 1) >> 1;
        v5 = (v7 - v5 + 1) >> 1;
        v7 = t;

        let t = (v0 - v3 + 1) >> 1;
        v0 = (v0 + v3 + 1) >> 1;
        v3 = t;
        let t = (v1 - v2 + 1) >> 1;
        v1 = (v1 + v2 + 1) >> 1;
        v2 = t;
        let t = (v4.wrapping_mul(DCT_SIN3) + v7.wrapping_mul(DCT_COS3) + 2048) >> 12;
        v4 = (v4.wrapping_mul(DCT_COS3) - v7.wrapping_mul(DCT_SIN3) + 2048) >> 12;
        v7 = t;
        let t = (v5.wrapping_mul(DCT_SIN1) + v6.wrapping_mul(DCT_COS1) + 2048) >> 12;
        v5 = (v5.wrapping_mul(DCT_COS1) - v6.wrapping_mul(DCT_SIN1) + 2048) >> 12;
        v6 = t;

        p[col] = v0 + v7;
        p[56 + col] = v0 - v7;
        p[8 + col] = v1 + v6;
        p[48 + col] = v1 - v6;
        p[16 + col] = v2 + v5;
        p[40 + col] = v2 - v5;
        p[24 + col] = v3 + v4;
        p[32 + col] = v3 - v4;
    }

    for i in 0..64 {
        let sample = 128 + ((p[i] + 8) >> 4);
        out[i] = if sample < 0 { 0 } else if sample > 0xFF { 0xFF } else { sample as u8 };
    }
}

fn build_component_data(frame: &Frame, ci: usize) -> Vec<Vec<u8>> {
    let comp = &frame.components[ci];
    let bpl = comp.blocks_per_line;
    let bpc = comp.blocks_per_column;
    let spl = bpl << 3;
    let mut lines: Vec<Vec<u8>> = vec![vec![0u8; spl]; bpc * 8];
    let mut out = [0u8; 64];
    for block_row in 0..bpc {
        let scan_line = block_row << 3;
        for block_col in 0..bpl {
            quantize_and_inverse(&comp.blocks[block_row][block_col], &comp.quant, &mut out);
            let sample = block_col << 3;
            for j in 0..8 {
                let line = &mut lines[scan_line + j];
                for i in 0..8 {
                    line[sample + i] = out[j * 8 + i];
                }
            }
        }
    }
    lines
}

fn clamp8(a: f64) -> f64 {
    if a < 0.0 { 0.0 } else if a > 255.0 { 255.0 } else { a }
}

fn get_data(frame: &Frame, lines: &[Vec<Vec<u8>>], width: usize, height: usize) -> Vec<u8> {
    let ncomp = lines.len();
    let scale_x = frame.samples_per_line as f64 / width as f64;
    let scale_y = frame.scan_lines as f64 / height as f64;
    let mut data = vec![0u8; width * height * ncomp];

    let comp_scale_x: Vec<f64> = (0..ncomp)
        .map(|i| frame.components[i].h as f64 / frame.max_h as f64)
        .collect();
    let comp_scale_y: Vec<f64> = (0..ncomp)
        .map(|i| frame.components[i].v as f64 / frame.max_v as f64)
        .collect();

    let sample = |ci: usize, x: usize, y: usize| -> u8 {
        let ly = (y as f64 * comp_scale_y[ci] * scale_y) as usize;
        let lx = (x as f64 * comp_scale_x[ci] * scale_x) as usize;
        lines[ci][ly][lx]
    };

    let mut off = 0usize;
    match ncomp {
        1 => {
            for y in 0..height {
                for x in 0..width {
                    data[off] = sample(0, x, y);
                    off += 1;
                }
            }
        }
        2 => {
            for y in 0..height {
                for x in 0..width {
                    data[off] = sample(0, x, y);
                    data[off + 1] = sample(1, x, y);
                    off += 2;
                }
            }
        }
        3 => {
            for y in 0..height {
                for x in 0..width {
                    let yy = sample(0, x, y) as f64;
                    let cb = sample(1, x, y) as f64;
                    let cr = sample(2, x, y) as f64;
                    let r = clamp8(yy + 1.402 * (cr - 128.0)) as u8;
                    let g = clamp8(yy - 0.3441363 * (cb - 128.0) - 0.71413636 * (cr - 128.0)) as u8;
                    let b = clamp8(yy + 1.772 * (cb - 128.0)) as u8;
                    data[off] = r;
                    data[off + 1] = g;
                    data[off + 2] = b;
                    off += 3;
                }
            }
        }
        4 => {
            for y in 0..height {
                for x in 0..width {
                    let yy = sample(0, x, y) as f64;
                    let cb = sample(1, x, y) as f64;
                    let cr = sample(2, x, y) as f64;
                    let k = sample(3, x, y) as f64;
                    let c = 255.0 - clamp8(yy + 1.402 * (cr - 128.0));
                    let m = 255.0 - clamp8(yy - 0.3441363 * (cb - 128.0) - 0.71413636 * (cr - 128.0));
                    let ye = 255.0 - clamp8(yy + 1.772 * (cb - 128.0));
                    data[off] = (255.0 - c) as u8;
                    data[off + 1] = (255.0 - m) as u8;
                    data[off + 2] = (255.0 - ye) as u8;
                    data[off + 3] = (255.0 - k) as u8;
                    off += 4;
                }
            }
        }
        _ => {}
    }
    data
}

fn read_u16(data: &[u8], off: usize) -> Result<u16, String> {
    if off + 1 >= data.len() {
        return Err("JPEG 截断".into());
    }
    Ok(((data[off] as u16) << 8) | data[off + 1] as u16)
}

fn prepare_components(frame: &mut Frame) {
    let mut max_h = 1usize;
    let mut max_v = 1usize;
    for c in &frame.components {
        max_h = max_h.max(c.h);
        max_v = max_v.max(c.v);
    }
    let mcus_per_line = (frame.samples_per_line + 8 * max_h - 1) / (8 * max_h);
    let mcus_per_column = (frame.scan_lines + 8 * max_v - 1) / (8 * max_v);
    let s8 = (frame.samples_per_line + 7) / 8;
    let l8 = (frame.scan_lines + 7) / 8;
    for c in &mut frame.components {
        let blocks_per_line = (s8 * c.h + max_h - 1) / max_h;
        let blocks_per_column = (l8 * c.v + max_v - 1) / max_v;
        let row_blocks = mcus_per_line * c.h;
        let col_blocks = mcus_per_column * c.v;
        c.blocks = vec![vec![[0i32; 64]; row_blocks]; col_blocks];
        c.blocks_per_line = blocks_per_line;
        c.blocks_per_column = blocks_per_column;
    }
    frame.max_h = max_h;
    frame.max_v = max_v;
    frame.mcus_per_line = mcus_per_line;
    frame.mcus_per_column = mcus_per_column;
}

pub fn decode(data: &[u8]) -> Result<Image, String> {
    if data.len() < 4 || data[0] != 0xFF || data[1] != 0xD8 {
        return Err("SOI not found".into());
    }
    let mut offset = 2usize;
    let mut quant: [Option<[i32; 64]>; 4] = [None; 4];
    let mut dc_tables: Vec<Huff> = vec![Huff::default(); 4];
    let mut ac_tables: Vec<Huff> = vec![Huff::default(); 4];
    let mut frame: Option<Frame> = None;
    let mut reset_interval = 0usize;
    let mut adobe_transform: Option<u8> = None;
    let mut adobe_seen = false;

    loop {
        let marker = read_u16(data, offset)?;
        offset += 2;
        if marker == 0xFFD9 {
            break;
        }
        match marker {
            0xFF00 => continue,
            0xFFFE | 0xFFE0..=0xFFEF => {
                let len = read_u16(data, offset)? as usize;
                if marker == 0xFFEE && len >= 14 {
                    let p = offset + 2;
                    if data[p] == 0x41 && data[p + 1] == 0x64 && data[p + 2] == 0x6F && data[p + 3] == 0x62 && data[p + 4] == 0x65 && data[p + 5] == 0 {
                        adobe_seen = true;
                        adobe_transform = Some(data[p + 11]);
                    }
                }
                offset += len;
            }
            0xFFDB => {
                let len = read_u16(data, offset)? as usize;
                let end = offset + len;
                let mut p = offset + 2;
                while p < end {
                    let spec = data[p];
                    p += 1;
                    let mut table = [0i32; 64];
                    if (spec >> 4) == 0 {
                        for j in 0..64 {
                            table[DCT_ZIGZAG[j]] = data[p] as i32;
                            p += 1;
                        }
                    } else if (spec >> 4) == 1 {
                        for j in 0..64 {
                            table[DCT_ZIGZAG[j]] = read_u16(data, p)? as i32;
                            p += 2;
                        }
                    } else {
                        return Err("DQT: invalid table spec".into());
                    }
                    quant[(spec & 15) as usize] = Some(table);
                }
                offset = end;
            }
            0xFFC0 | 0xFFC1 | 0xFFC2 => {
                let len = read_u16(data, offset)?;
                let mut p = offset + 2;
                if p + 6 > data.len() {
                    return Err("JPEG 帧头截断".into());
                }
                let progressive = marker == 0xFFC2;
                let precision = data[p];
                let scan_lines = read_u16(data, p + 1)? as usize;
                let samples_per_line = read_u16(data, p + 3)? as usize;
                let count = data[p + 5] as usize;
                p += 6;
                let mut components = Vec::with_capacity(count);
                for _ in 0..count {
                    if p + 3 > data.len() {
                        return Err("JPEG 分量表截断".into());
                    }
                    let cid = data[p] as usize;
                    let h = (data[p + 1] >> 4) as usize;
                    let v = (data[p + 1] & 15) as usize;
                    let qidx = data[p + 2] as usize;
                    if h == 0 || v == 0 {
                        return Err("Invalid sampling factor, expected values above 0".into());
                    }
                    if qidx > 3 {
                        return Err("量化表编号异常".into());
                    }
                    components.push(Component {
                        id: cid, h, v, qidx, quant: [0; 64],
                        blocks_per_line: 0, blocks_per_column: 0, blocks: Vec::new(),
                        pred: 0, dc_tbl: 0, ac_tbl: 0,
                    });
                    p += 3;
                }
                let mut f = Frame {
                    progressive, precision, scan_lines, samples_per_line,
                    max_h: 1, max_v: 1, mcus_per_line: 0, mcus_per_column: 0,
                    components,
                };
                prepare_components(&mut f);
                frame = Some(f);
                offset += len as usize;
            }
            0xFFC4 => {
                let len = read_u16(data, offset)? as usize;
                let mut p = offset + 2;
                let end = offset + len;
                while p < end {
                    let spec = data[p];
                    p += 1;
                    let mut lengths = [0u8; 16];
                    let mut sum = 0usize;
                    for j in 0..16 {
                        lengths[j] = data[p];
                        sum += data[p] as usize;
                        p += 1;
                    }
                    let mut values = vec![0u8; sum];
                    for j in 0..sum {
                        values[j] = data[p];
                        p += 1;
                    }
                    let table = Huff::build(&lengths, &values);
                    if (spec >> 4) == 0 {
                        dc_tables[(spec & 15) as usize] = table;
                    } else {
                        ac_tables[(spec & 15) as usize] = table;
                    }
                }
                offset = end;
            }
            0xFFDD => {
                offset += 2;
                reset_interval = read_u16(data, offset)? as usize;
                offset += 2;
            }
            0xFFDC => {
                offset += 4;
            }
            0xFFDA => {
                let len = read_u16(data, offset)? as usize;
                let f = frame.as_mut().ok_or_else(|| "SOS 早于 SOF".to_string())?;
                let mut p = offset + 2;
                let selectors = data[p] as usize;
                p += 1;
                let mut ids = Vec::with_capacity(selectors);
                for _ in 0..selectors {
                    let cid = data[p] as usize;
                    let spec = data[p + 1];
                    p += 2;
                    let idx = f.components.iter().position(|c| c.id == cid).ok_or_else(|| format!("SOS 引用了不存在的分量 {}", cid))?;
                    f.components[idx].dc_tbl = (spec >> 4) as usize;
                    f.components[idx].ac_tbl = (spec & 15) as usize;
                    ids.push(idx);
                }
                let ss = data[p] as usize;
                let se = data[p + 1] as usize;
                let approx = data[p + 2];
                let successive_prev = approx >> 4;
                let al = approx & 15;
                let scan_start = p + 3;
                let processed = decode_scan(
                    data, scan_start, f, &ids, reset_interval, ss, se, successive_prev, al,
                    &{
                        let mut t = dc_tables.clone();
                        t.extend(ac_tables.clone());
                        t
                    },
                )?;
                offset = scan_start + processed;
            }
            0xFFFF => {
                offset -= 1;
            }
            _ => {
                return Err(format!("unknown JPEG marker {:x}", marker));
            }
        }
    }

    let mut f = frame.ok_or_else(|| "JPEG 没有帧信息".to_string())?;
    for c in &mut f.components {
        let table = quant[c.qidx].ok_or_else(|| "缺少量化表".to_string())?;
        c.quant = table;
    }

    let lines: Vec<Vec<Vec<u8>>> = (0..f.components.len()).map(|i| build_component_data(&f, i)).collect();
    let width = f.samples_per_line;
    let height = f.scan_lines;
    let raw = get_data(&f, &lines, width, height);

    let n = f.components.len();
    let mut rgba = vec![255u8; width * height * 4];
    match n {
        1 => {
            for i in 0..width * height {
                let y = raw[i];
                rgba[i * 4] = y;
                rgba[i * 4 + 1] = y;
                rgba[i * 4 + 2] = y;
            }
        }
        3 => {
            for i in 0..width * height {
                rgba[i * 4] = raw[i * 3];
                rgba[i * 4 + 1] = raw[i * 3 + 1];
                rgba[i * 4 + 2] = raw[i * 3 + 2];
            }
        }
        4 => {
            for i in 0..width * height {
                let c = raw[i * 4] as f64;
                let m = raw[i * 4 + 1] as f64;
                let y = raw[i * 4 + 2] as f64;
                let k = raw[i * 4 + 3] as f64;
                let r = 255.0 - clamp8(c * (1.0 - k / 255.0) + k) as u8 as f64;
                let g = 255.0 - clamp8(m * (1.0 - k / 255.0) + k) as u8 as f64;
                let b = 255.0 - clamp8(y * (1.0 - k / 255.0) + k) as u8 as f64;
                rgba[i * 4] = r as u8;
                rgba[i * 4 + 1] = g as u8;
                rgba[i * 4 + 2] = b as u8;
            }
            if !adobe_seen && adobe_transform.is_none() {
                return Err("Unsupported color mode (4 components)".into());
            }
        }
        _ => return Err("Unsupported color mode".into()),
    }

    Ok(Image { width, height, data: rgba })
}
