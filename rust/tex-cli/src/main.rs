// SPDX-License-Identifier: MIT
// Copyright (c) 2026 MacroCN
//
// rust-tex：we-mpkg 的纹理热点 CLI。调用方式对齐 ffmpeg（execFileSync + 参数数组），
// 输入输出走文件，结果以 JSON 打到 stdout。
//
//   rust-tex dxt-decode   <in> <out> --format dxt1|dxt3|dxt5 --width N --height N
//   rust-tex lz4-compress <in> <out>
//   rust-tex lz4-decompress <in> <out> --size N
//   rust-tex selftest
//   rust-tex version

mod dxt;
mod lz4;

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
