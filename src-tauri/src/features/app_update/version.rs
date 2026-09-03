/// 去掉可选的 `v` / `V` 前缀。
pub fn strip_version_prefix(raw: &str) -> &str {
    let trimmed = raw.trim();
    trimmed
        .strip_prefix('v')
        .or_else(|| trimmed.strip_prefix('V'))
        .unwrap_or(trimmed)
}

/// 比较两个版本字符串（可带 `v` 前缀）。
///
/// 返回 `Some(Ordering)`；任一侧无法解析时返回 `None`（调用方视为无更新）。
pub fn compare_versions(left: &str, right: &str) -> Option<std::cmp::Ordering> {
    let left = parse_semver(strip_version_prefix(left))?;
    let right = parse_semver(strip_version_prefix(right))?;
    Some(left.cmp(&right))
}

/// `candidate` 是否严格大于 `current`。
pub fn is_newer_version(candidate: &str, current: &str) -> bool {
    matches!(
        compare_versions(candidate, current),
        Some(std::cmp::Ordering::Greater)
    )
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SemVerParts {
    major: u64,
    minor: u64,
    patch: u64,
    /// None = 正式版；Some = pre-release 标识（不含前导 `-`）。
    pre: Option<String>,
}

impl PartialOrd for SemVerParts {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for SemVerParts {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.major
            .cmp(&other.major)
            .then(self.minor.cmp(&other.minor))
            .then(self.patch.cmp(&other.patch))
            .then_with(|| match (&self.pre, &other.pre) {
                (None, None) => std::cmp::Ordering::Equal,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (Some(_), None) => std::cmp::Ordering::Less,
                (Some(left), Some(right)) => compare_prerelease(left, right),
            })
    }
}

fn parse_semver(raw: &str) -> Option<SemVerParts> {
    if raw.is_empty() {
        return None;
    }

    let (core, pre) = match raw.split_once('-') {
        Some((core, pre)) if !pre.is_empty() => (core, Some(pre.to_string())),
        Some(_) => return None,
        None => {
            // 允许 build metadata：1.0.0+build → 忽略 + 之后
            let core = raw.split_once('+').map(|(c, _)| c).unwrap_or(raw);
            (core, None)
        }
    };

    let core = core.split_once('+').map(|(c, _)| c).unwrap_or(core);
    let mut parts = core.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next()?.parse().ok()?;
    if parts.next().is_some() {
        return None;
    }

    Some(SemVerParts {
        major,
        minor,
        patch,
        pre,
    })
}

fn compare_prerelease(left: &str, right: &str) -> std::cmp::Ordering {
    let left_parts: Vec<&str> = left.split('.').collect();
    let right_parts: Vec<&str> = right.split('.').collect();
    let max_len = left_parts.len().max(right_parts.len());

    for index in 0..max_len {
        match (left_parts.get(index), right_parts.get(index)) {
            (None, Some(_)) => return std::cmp::Ordering::Less,
            (Some(_), None) => return std::cmp::Ordering::Greater,
            (Some(l), Some(r)) => {
                let ordering = match (l.parse::<u64>(), r.parse::<u64>()) {
                    (Ok(ln), Ok(rn)) => ln.cmp(&rn),
                    (Ok(_), Err(_)) => std::cmp::Ordering::Less,
                    (Err(_), Ok(_)) => std::cmp::Ordering::Greater,
                    (Err(_), Err(_)) => (*l).cmp(*r),
                };
                if ordering != std::cmp::Ordering::Equal {
                    return ordering;
                }
            }
            (None, None) => unreachable!(),
        }
    }

    std::cmp::Ordering::Equal
}

#[cfg(test)]
mod tests {
    use super::{compare_versions, is_newer_version, strip_version_prefix};
    use std::cmp::Ordering;

    #[test]
    fn strips_v_prefix() {
        assert_eq!(strip_version_prefix("v0.1.0"), "0.1.0");
        assert_eq!(strip_version_prefix("V1.2.3"), "1.2.3");
        assert_eq!(strip_version_prefix("0.0.3"), "0.0.3");
    }

    #[test]
    fn compares_numeric_versions() {
        assert_eq!(compare_versions("0.0.3", "0.0.4"), Some(Ordering::Less));
        assert_eq!(compare_versions("v0.0.4", "0.0.3"), Some(Ordering::Greater));
        assert_eq!(compare_versions("1.0.0", "v1.0.0"), Some(Ordering::Equal));
        assert!(is_newer_version("0.0.4", "0.0.3"));
        assert!(!is_newer_version("0.0.3", "0.0.3"));
        assert!(!is_newer_version("0.0.2", "0.0.3"));
    }

    #[test]
    fn prerelease_is_less_than_release() {
        assert_eq!(
            compare_versions("1.0.0-rc.1", "1.0.0"),
            Some(Ordering::Less)
        );
        assert!(is_newer_version("1.0.0", "1.0.0-rc.1"));
        assert!(is_newer_version("1.0.0-rc.2", "1.0.0-rc.1"));
    }

    #[test]
    fn local_newer_is_not_update() {
        assert!(!is_newer_version("0.0.3", "0.1.0"));
    }

    #[test]
    fn invalid_versions_yield_none() {
        assert_eq!(compare_versions("not-a-version", "0.0.1"), None);
        assert_eq!(compare_versions("0.0.1", ""), None);
        assert!(!is_newer_version("bad", "0.0.1"));
    }
}
