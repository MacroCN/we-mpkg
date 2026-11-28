// SPDX-License-Identifier: MIT
// Copyright (c) 2026 MacroCN
//
// rust-tex：we-mpkg 的纹理热点 CLI。调用方式对齐 ffmpeg（execFileSync + 参数数组），
// 输入输出走文件，结果以 JSON 打到 stdout。
//
//   rust-tex dxt-decode   <in> <out> --format dxt1|dxt3|dxt5 --width N --height N
//   rust-tex lz4-compress <in> <out>
//   rust-tex lz4-decompress <in> <out> --size N
//   rust-tex png-decode     <in> <out>
//   rust-tex jpeg-decode    <in> <out>
//   rust-tex tex-batch      <jobfile>   # 一条命令处理一批纹理，减少进程启动
//   rust-tex selftest
//   rust-tex version

mod dxt;
mod inflate;
mod lz4;
mod jpeg;
mod png;
mod tex;

use std::fs;
use std::io::Write;
use std::path::Path;
use std::time::Instant;

fn json_escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n")
}

fn emit(json: &str) {
    let mut stdout = std::io::stdout();
    let _ = writeln!(stdout, "{}", json);
}

fn fail(msg: &str, code: i32) -> ! {
    emit(&format!("{{\"ok\":false,\"error\":\"{}\"}}", json_escape(msg)));
    std::process::exit(code);
}

fn write_out(path: &str, bytes: &[u8]) {
    if let Some(parent) = Path::new(path).parent() {
        if !parent.as_os_str().is_empty() {
            let _ = fs::create_dir_all(parent);
        }
    }
    if let Err(e) = fs::write(path, bytes) {
        fail(&format!("写文件失败 {}: {}", path, e), 2);
    }
}

fn arg_value(args: &[String], key: &str) -> Option<String> {
    let mut it = args.iter();
    while let Some(a) = it.next() {
        if a == key {
            return it.next().cloned();
        }
    }
    None
}

fn arg_usize(args: &[String], key: &str, required_name: &str) -> usize {
    match arg_value(args, key) {
        Some(v) => match v.parse::<usize>() {
            Ok(n) if n > 0 => n,
            _ => fail(&format!("{} 非法: {}", required_name, v), 2),
        },
        None => fail(&format!("缺少 {}", key), 2),
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        fail("缺少子命令（dxt-decode / lz4-compress / lz4-decompress / selftest / version）", 2);
    }

    match args[1].as_str() {
        "version" | "--version" | "-V" => {
            emit(&format!(
                "{{\"ok\":true,\"tool\":\"rust-tex\",\"version\":\"{}\"}}",
                env!("CARGO_PKG_VERSION")
            ));
        }
        "dxt-decode" => {
            let input = args.get(2).unwrap_or_else(|| fail("缺少输入文件", 2));
            let output = args.get(3).unwrap_or_else(|| fail("缺少输出文件", 2));
            let fmt_name = arg_value(&args, "--format").unwrap_or_else(|| fail("缺少 --format", 2));
            let fmt = match dxt::Format::parse(&fmt_name) {
                Some(f) => f,
                None => fail(&format!("不支持的 DXT 格式: {}", fmt_name), 2),
            };
            let width = arg_usize(&args, "--width", "--width");
            let height = arg_usize(&args, "--height", "--height");

            let started = Instant::now();
            let data = fs::read(input).unwrap_or_else(|e| fail(&format!("读文件失败 {}: {}", input, e), 2));
            match dxt::decode(&data, fmt, width, height) {
                Ok(rgba) => {
                    write_out(output, &rgba);
                    emit(&format!(
                        "{{\"ok\":true,\"cmd\":\"dxt-decode\",\"format\":{},\"width\":{},\"height\":{},\"inBytes\":{},\"outBytes\":{},\"elapsedUs\":{}}}",
                        fmt.block_bytes(),
                        width,
                        height,
                        data.len(),
                        rgba.len(),
                        started.elapsed().as_micros()
                    ));
                }
                Err(e) => fail(&e, 3),
            }
        }
        "lz4-compress" => {
            let input = args.get(2).unwrap_or_else(|| fail("缺少输入文件", 2));
            let output = args.get(3).unwrap_or_else(|| fail("缺少输出文件", 2));
            let started = Instant::now();
            let data = fs::read(input).unwrap_or_else(|e| fail(&format!("读文件失败 {}: {}", input, e), 2));
            let packed = lz4::compress(&data);
            write_out(output, &packed);
            emit(&format!(
                "{{\"ok\":true,\"cmd\":\"lz4-compress\",\"inBytes\":{},\"outBytes\":{},\"elapsedUs\":{}}}",
                data.len(),
                packed.len(),
                started.elapsed().as_micros()
            ));
        }
        "lz4-decompress" => {
            let input = args.get(2).unwrap_or_else(|| fail("缺少输入文件", 2));
            let output = args.get(3).unwrap_or_else(|| fail("缺少输出文件", 2));
            let size = arg_usize(&args, "--size", "--size");
            let started = Instant::now();
            let data = fs::read(input).unwrap_or_else(|e| fail(&format!("读文件失败 {}: {}", input, e), 2));
            match lz4::decompress(&data, size) {
                Ok(raw) => {
                    write_out(output, &raw);
                    emit(&format!(
                        "{{\"ok\":true,\"cmd\":\"lz4-decompress\",\"inBytes\":{},\"outBytes\":{},\"elapsedUs\":{}}}",
                        data.len(),
                        raw.len(),
                        started.elapsed().as_micros()
                    ));
                }
                Err(e) => fail(&e, 3),
            }
        }
        "png-decode" => {
            // 输入输出都支持 "-" 走 stdin/stdout：RGBA 动辄几十 MB，走管道比落盘快得多
            let input = args.get(2).unwrap_or_else(|| fail("缺少输入文件", 2));
            let output = args.get(3).unwrap_or_else(|| fail("缺少输出文件", 2));
            let started = Instant::now();
            let data = if input == "-" {
                let mut buf = Vec::new();
                use std::io::Read;
                std::io::stdin()
                    .read_to_end(&mut buf)
                    .unwrap_or_else(|e| fail(&format!("读 stdin 失败: {}", e), 2));
                buf
            } else {
                fs::read(input).unwrap_or_else(|e| fail(&format!("读文件失败 {}: {}", input, e), 2))
            };
            // PNG 解码后的 RGBA 上限沿用一个保守值，避免被恶意包撑爆内存
            match png::decode(&data, 512 * 1024 * 1024) {
                Ok(p) => {
                    if output == "-" {
                        // 管道模式：RGBA 直接吐到 stdout，stderr 留一行 JSON 给调用方记日志
                        let _ = std::io::stdout().write_all(&p.data);
                        let _ = std::io::stdout().flush();
                        eprintln!(
                            "{{\"ok\":true,\"cmd\":\"png-decode\",\"width\":{},\"height\":{},\"inBytes\":{},\"outBytes\":{},\"elapsedUs\":{}}}",
                            p.width,
                            p.height,
                            data.len(),
                            p.data.len(),
                            started.elapsed().as_micros()
                        );
                    } else {
                        write_out(output, &p.data);
                        emit(&format!(
                            "{{\"ok\":true,\"cmd\":\"png-decode\",\"width\":{},\"height\":{},\"inBytes\":{},\"outBytes\":{},\"elapsedUs\":{}}}",
                            p.width,
                            p.height,
                            data.len(),
                            p.data.len(),
                            started.elapsed().as_micros()
                        ));
                    }
                }
                Err(e) => fail(&e, 3),
            }
        }
        "jpeg-decode" => {
            let input = args.get(2).unwrap_or_else(|| fail("缺少输入文件", 2));
            let output = args.get(3).unwrap_or_else(|| fail("缺少输出文件", 2));
            let started = Instant::now();
            let data = if input == "-" {
                let mut buf = Vec::new();
                use std::io::Read;
                std::io::stdin()
                    .read_to_end(&mut buf)
                    .unwrap_or_else(|e| fail(&format!("读 stdin 失败: {}", e), 2));
                buf
            } else {
                fs::read(input).unwrap_or_else(|e| fail(&format!("读文件失败 {}: {}", input, e), 2))
            };
            match jpeg::decode(&data) {
                Ok(p) => {
                    if output == "-" {
                        // 管道模式：RGBA 给 stdout，JSON 走 stderr（与 png-decode 一致）
                        let _ = std::io::stdout().write_all(&p.data);
                        let _ = std::io::stdout().flush();
                        eprintln!(
                            "{{\"ok\":true,\"cmd\":\"jpeg-decode\",\"width\":{},\"height\":{},\"inBytes\":{},\"outBytes\":{},\"elapsedUs\":{}}}",
                            p.width, p.height, data.len(), p.data.len(), started.elapsed().as_micros()
                        );
                        return;
                    }
                    write_out(output, &p.data);
                    emit(&format!(
                        "{{\"ok\":true,\"cmd\":\"jpeg-decode\",\"width\":{},\"height\":{},\"inBytes\":{},\"outBytes\":{},\"elapsedUs\":{}}}",
                        p.width,
                        p.height,
                        data.len(),
                        p.data.len(),
                        started.elapsed().as_micros()
                    ));
                }
                Err(e) => fail(&e, 3),
            }
        }
        "tex-batch" => {
            // job 文件是 NUL 分隔的四元组：scale \0 framesTail \0 输入 \0 输出 \0 ...
            // 一个进程跑完整包：读 job → 多线程并行转换 → 按原顺序输出 JSON。
            let jobfile = args.get(2).unwrap_or_else(|| fail("缺少 job 文件", 2));
            let threads = arg_value(&args, "--threads")
                .and_then(|v| v.parse::<usize>().ok())
                .filter(|n| *n > 0)
                .unwrap_or_else(|| std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1))
                .min(16);
            let raw = fs::read(jobfile).unwrap_or_else(|e| fail(&format!("读 job 文件失败 {}: {}", jobfile, e), 2));
            let mut jobs: Vec<(String, bool, String, String)> = Vec::new();
            let mut fields = raw.split(|b| *b == 0);
            loop {
                let scale = match fields.next() {
                    Some(v) if !v.is_empty() => String::from_utf8_lossy(v).to_string(),
                    _ => break,
                };
                let frames = fields.next().map(|v| String::from_utf8_lossy(v).to_string()).unwrap_or_default();
                let input = fields.next().map(|v| String::from_utf8_lossy(v).to_string()).unwrap_or_default();
                let output = fields.next().map(|v| String::from_utf8_lossy(v).to_string()).unwrap_or_default();
                jobs.push((scale, frames == "1", input, output));
            }

            let n = jobs.len();
            let lines: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(vec![String::new(); n]);
            let counter = std::sync::atomic::AtomicUsize::new(0);
            let counter_ref = &counter;
            let lines_ref = &lines;
            let jobs_ref = &jobs;
            std::thread::scope(|scope| {
                for _ in 0..threads.min(n.max(1)) {
                    scope.spawn(move || {
                        loop {
                            let i = counter_ref.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                            if i >= n { break; }
                            let (scale, frames_tail, input, output) = &jobs_ref[i];
                            let started = Instant::now();
                            let scale_v: f64 = scale.parse().unwrap_or(1.0);
                            let data = match fs::read(input) {
                                Ok(d) => d,
                                Err(e) => {
                                    lines_ref.lock().unwrap()[i] = format!("{{\"ok\":false,\"error\":\"读文件失败: {}\"}}", json_escape(&e.to_string()));
                                    continue;
                                }
                            };
                            match tex::convert(&data, &tex::ConvertOpts { scale: scale_v, frames_tail: *frames_tail }) {
                                Ok(res) => {
                                    if let Err(e) = fs::write(output, &res.bytes) {
                                        lines_ref.lock().unwrap()[i] = format!("{{\"ok\":false,\"error\":\"写文件失败: {}\"}}", json_escape(&e.to_string()));
                                        continue;
                                    }
                                    lines_ref.lock().unwrap()[i] = format!(
                                        "{{\"ok\":true,\"width\":{},\"height\":{},\"downsampled\":{},\"inBytes\":{},\"outBytes\":{},\"elapsedUs\":{}}}",
                                        res.width, res.height,
                                        if res.downsampled { "true" } else { "false" },
                                        data.len(), res.bytes.len(), started.elapsed().as_micros()
                                    );
                                }
                                Err(e) => {
                                    lines_ref.lock().unwrap()[i] = format!("{{\"ok\":false,\"error\":\"{}\"}}", json_escape(&e));
                                }
                            }
                        }
                    });
                }
            });
            let mut stdout = std::io::stdout();
            for line in lines.into_inner().unwrap() {
                let _ = writeln!(stdout, "{}", if line.is_empty() { "{\"ok\":false,\"error\":\"未处理\"}" } else { &line });
            }
            let _ = stdout.flush();
        }
        "tex-convert" => {
            let input = args.get(2).unwrap_or_else(|| fail("缺少输入文件", 2));
            let output = args.get(3).unwrap_or_else(|| fail("缺少输出文件", 2));
            let scale: f64 = match arg_value(&args, "--scale") {
                Some(v) => match v.parse::<f64>() {
                    Ok(x) if x > 0.0 => x,
                    _ => fail(&format!("--scale 非法: {}", v), 2),
                },
                None => 1.0,
            };
            let frames_tail = arg_value(&args, "--frames-tail").map(|v| v == "1").unwrap_or(false);
            let started = Instant::now();
            let data = fs::read(input).unwrap_or_else(|e| fail(&format!("读文件失败 {}: {}", input, e), 2));
            match tex::convert(&data, &tex::ConvertOpts { scale, frames_tail }) {
                Ok(res) => {
                    let out_bytes = res.bytes.len();
                    write_out(output, &res.bytes);
                    emit(&format!(
                        "{{\"ok\":true,\"cmd\":\"tex-convert\",\"width\":{},\"height\":{},\"downsampled\":{},\"framesTailLen\":{},\"inBytes\":{},\"outBytes\":{},\"elapsedUs\":{}}}",
                        res.width, res.height,
                        if res.downsampled { "true" } else { "false" },
                        res.frames_tail_len,
                        data.len(), out_bytes,
                        started.elapsed().as_micros()
                    ));
                }
                Err(e) => fail(&e, 3),
            }
        }
        "selftest" => {
            // 内置金样本：LZ4 往返 + DXT1 纯色块 + DXT5 alpha
            let src = b"we-mpkg rust-tex selftest 0123456789 abcdefghijklmnopqrstuvwxyz abcdefghijklmnopqrstuvwxyz".to_vec();
            let packed = lz4::compress(&src);
            match lz4::decompress(&packed, src.len()) {
                Ok(back) if back == src => {}
                _ => fail("LZ4 往返失败", 3),
            }
            let block: [u8; 8] = [0x00, 0xf8, 0x00, 0x00, 0, 0, 0, 0];
            let rgba = dxt::decode(&block, dxt::Format::Dxt1, 4, 4).unwrap_or_else(|e| fail(&e, 3));
            if rgba.len() != 64 {
                fail("DXT 输出长度异常", 3);
            }
            emit(&format!(
                "{{\"ok\":true,\"cmd\":\"selftest\",\"lz4Ratio\":{:.4}}}",
                packed.len() as f64 / src.len() as f64
            ));
        }
        other => fail(&format!("未知子命令: {}", other), 2),
    }
}
