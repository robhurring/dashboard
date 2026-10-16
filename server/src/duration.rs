use std::time::Duration;

/// Parses durations like `500ms`, `30s`, `15m`, `1h`, `2d`.
pub fn parse_duration(input: &str) -> Result<Duration, String> {
    let s = input.trim();
    let split = s
        .find(|c: char| !c.is_ascii_digit())
        .ok_or_else(|| format!("duration {input:?} needs a unit (ms, s, m, h, d)"))?;
    let (num, unit) = s.split_at(split);
    let n: u64 = num.parse().map_err(|_| format!("duration {input:?} must start with a whole number"))?;
    let ms = match unit {
        "ms" => n,
        "s" => n * 1_000,
        "m" => n * 60_000,
        "h" => n * 3_600_000,
        "d" => n * 86_400_000,
        _ => return Err(format!("duration {input:?} has unknown unit {unit:?}")),
    };
    if ms == 0 {
        return Err(format!("duration {input:?} must be greater than zero"));
    }
    Ok(Duration::from_millis(ms))
}
