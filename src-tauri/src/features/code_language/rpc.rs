use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;

use serde_json::Value;

pub fn write_rpc(writer: &mut impl Write, value: &Value) -> std::io::Result<()> {
    let body = serde_json::to_vec(value)?;
    write!(writer, "Content-Length: {}\r\n\r\n", body.len())?;
    writer.write_all(&body)?;
    writer.flush()
}

pub fn read_rpc(reader: &mut BufReader<impl Read>) -> std::io::Result<Value> {
    let mut content_length = None;
    loop {
        let mut line = String::new();
        let size = reader.read_line(&mut line)?;
        if size == 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                "lsp stream closed",
            ));
        }
        let trimmed = line.trim_end();
        if trimmed.is_empty() {
            break;
        }
        if let Some(value) = trimmed.strip_prefix("Content-Length:") {
            content_length =
                Some(value.trim().parse::<usize>().map_err(|error| {
                    std::io::Error::new(std::io::ErrorKind::InvalidData, error)
                })?);
        }
    }
    let length = content_length.ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidData, "missing Content-Length")
    })?;
    let mut body = vec![0_u8; length];
    reader.read_exact(&mut body)?;
    serde_json::from_slice(&body)
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))
}

pub fn file_uri(path: &Path) -> String {
    let display = path.display().to_string().replace('\\', "/");
    if display.starts_with('/') {
        format!("file://{display}")
    } else {
        format!("file:///{display}")
    }
}
