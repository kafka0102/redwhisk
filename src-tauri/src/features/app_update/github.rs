use std::time::Duration;

use super::version::strip_version_prefix;

pub const DEFAULT_GITHUB_OWNER: &str = "kafka0102";
pub const DEFAULT_GITHUB_REPO: &str = "redwhisk";
/// GitHub 网页端点基址。改用网页而非 REST API：未鉴权 API 按 IP 限流 60 次/小时，
/// 共享/NAT 出口会迅速耗尽并把限流误报成网络错误；网页 releases 端点无此限制。
pub const DEFAULT_GITHUB_WEB_BASE: &str = "https://github.com";

const HTTP_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LatestRelease {
    pub version: String,
    pub release_url: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LatestReleaseFetchError {
    Network,
    InvalidResponse,
}

/// 可注入的 latest release 数据源，生产用 GitHub，测试用 mock。
pub trait LatestReleaseSource {
    fn fetch_latest(&self) -> Result<Option<LatestRelease>, LatestReleaseFetchError>;
}

#[derive(Debug, Clone)]
pub struct GitHubLatestReleaseSource {
    web_base: String,
    owner: String,
    repo: String,
    user_agent: String,
}

impl Default for GitHubLatestReleaseSource {
    fn default() -> Self {
        Self::new(
            DEFAULT_GITHUB_WEB_BASE,
            DEFAULT_GITHUB_OWNER,
            DEFAULT_GITHUB_REPO,
        )
    }
}

impl GitHubLatestReleaseSource {
    pub fn new(
        web_base: impl Into<String>,
        owner: impl Into<String>,
        repo: impl Into<String>,
    ) -> Self {
        Self {
            web_base: web_base.into().trim_end_matches('/').to_string(),
            owner: owner.into(),
            repo: repo.into(),
            user_agent: "RedWhisk-App-Update-Check".to_string(),
        }
    }

    fn latest_url(&self) -> String {
        format!(
            "{}/{}/{}/releases/latest",
            self.web_base, self.owner, self.repo
        )
    }
}

impl LatestReleaseSource for GitHubLatestReleaseSource {
    /// 请求 `/releases/latest`：有发布则 302 重定向到 `/releases/tag/<tag>`，
    /// ureq 自动跟随后从最终 URL 解析 tag；无发布返回 404 视作无更新。
    fn fetch_latest(&self) -> Result<Option<LatestRelease>, LatestReleaseFetchError> {
        let response = ureq::get(&self.latest_url())
            .set("User-Agent", &self.user_agent)
            .timeout(HTTP_TIMEOUT)
            .call();

        match response {
            Ok(response) => parse_release_tag_from_url(response.get_url()).map(Some),
            Err(ureq::Error::Status(404, _)) => Ok(None),
            Err(ureq::Error::Status(_, _)) => Err(LatestReleaseFetchError::Network),
            Err(_) => Err(LatestReleaseFetchError::Network),
        }
    }
}

/// 从 `/releases/latest` 重定向后的最终 URL 解析 tag 与 release 页地址。
///
/// 形如 `https://github.com/{owner}/{repo}/releases/tag/<tag>`，
/// `<tag>` 取标记后的剩余路径（保留 `/` 以兼容含斜杠的 tag），并剥离 query/fragment。
pub fn parse_release_tag_from_url(url: &str) -> Result<LatestRelease, LatestReleaseFetchError> {
    const TAG_MARKER: &str = "/releases/tag/";

    let marker_index = url
        .rfind(TAG_MARKER)
        .ok_or(LatestReleaseFetchError::InvalidResponse)?;
    let after_marker = &url[marker_index + TAG_MARKER.len()..];

    // tag 为标记后到 query/fragment 之前的路径段，去掉尾部斜杠。
    let tag = after_marker
        .split(['?', '#'])
        .next()
        .unwrap_or("")
        .trim_end_matches('/');
    if tag.is_empty() {
        return Err(LatestReleaseFetchError::InvalidResponse);
    }

    // release_url 为不含 query/fragment 的干净 release 页地址。
    let release_url = url
        .split(['?', '#'])
        .next()
        .unwrap_or(url)
        .trim_end_matches('/')
        .to_string();

    Ok(LatestRelease {
        version: strip_version_prefix(tag).to_string(),
        release_url,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        parse_release_tag_from_url, strip_version_prefix, LatestRelease, LatestReleaseFetchError,
        LatestReleaseSource,
    };

    struct MockSource {
        result: Result<Option<LatestRelease>, LatestReleaseFetchError>,
    }

    impl LatestReleaseSource for MockSource {
        fn fetch_latest(&self) -> Result<Option<LatestRelease>, LatestReleaseFetchError> {
            self.result.clone()
        }
    }

    #[test]
    fn parses_tag_from_release_url_and_strips_v_prefix() {
        let release =
            parse_release_tag_from_url("https://github.com/kafka0102/redwhisk/releases/tag/v0.0.5")
                .expect("parse");
        assert_eq!(release.version, "0.0.5");
        assert_eq!(
            release.release_url,
            "https://github.com/kafka0102/redwhisk/releases/tag/v0.0.5",
        );
    }

    #[test]
    fn strips_query_and_fragment_from_release_url() {
        let release = parse_release_tag_from_url(
            "https://github.com/kafka0102/redwhisk/releases/tag/v0.0.5?foo=bar#changelog",
        )
        .expect("parse");
        assert_eq!(release.version, "0.0.5");
        assert_eq!(
            release.release_url,
            "https://github.com/kafka0102/redwhisk/releases/tag/v0.0.5",
        );
    }

    #[test]
    fn preserves_slash_in_tag() {
        let release = parse_release_tag_from_url(
            "https://github.com/kafka0102/redwhisk/releases/tag/release/v1.0",
        )
        .expect("parse");
        assert_eq!(release.version, "release/v1.0");
    }

    #[test]
    fn rejects_url_without_tag_marker() {
        assert!(matches!(
            parse_release_tag_from_url("https://github.com/kafka0102/redwhisk/releases"),
            Err(LatestReleaseFetchError::InvalidResponse)
        ));
    }

    #[test]
    fn rejects_empty_tag_segment() {
        assert!(matches!(
            parse_release_tag_from_url("https://github.com/kafka0102/redwhisk/releases/tag/"),
            Err(LatestReleaseFetchError::InvalidResponse)
        ));
    }

    #[test]
    fn mock_not_found_is_none() {
        let source = MockSource { result: Ok(None) };
        assert_eq!(source.fetch_latest().unwrap(), None);
    }

    #[test]
    fn strips_tag_prefix_for_storage() {
        assert_eq!(strip_version_prefix("v0.0.3"), "0.0.3");
    }
}
