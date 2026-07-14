use std::time::Duration;

use serde::Deserialize;

use super::version::strip_version_prefix;

pub const DEFAULT_GITHUB_OWNER: &str = "kafka0102";
pub const DEFAULT_GITHUB_REPO: &str = "redwhisk";
pub const DEFAULT_GITHUB_API_BASE: &str = "https://api.github.com";

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
    api_base: String,
    owner: String,
    repo: String,
    user_agent: String,
}

impl Default for GitHubLatestReleaseSource {
    fn default() -> Self {
        Self::new(
            DEFAULT_GITHUB_API_BASE,
            DEFAULT_GITHUB_OWNER,
            DEFAULT_GITHUB_REPO,
        )
    }
}

impl GitHubLatestReleaseSource {
    pub fn new(api_base: impl Into<String>, owner: impl Into<String>, repo: impl Into<String>) -> Self {
        Self {
            api_base: api_base.into().trim_end_matches('/').to_string(),
            owner: owner.into(),
            repo: repo.into(),
            user_agent: "RedWhisk-App-Update-Check".to_string(),
        }
    }

    fn latest_url(&self) -> String {
        format!(
            "{}/repos/{}/{}/releases/latest",
            self.api_base, self.owner, self.repo
        )
    }
}

impl LatestReleaseSource for GitHubLatestReleaseSource {
    fn fetch_latest(&self) -> Result<Option<LatestRelease>, LatestReleaseFetchError> {
        let response = ureq::get(&self.latest_url())
            .set("User-Agent", &self.user_agent)
            .set("Accept", "application/vnd.github+json")
            .timeout(HTTP_TIMEOUT)
            .call();

        match response {
            Ok(response) => {
                let body = response
                    .into_string()
                    .map_err(|_| LatestReleaseFetchError::InvalidResponse)?;
                parse_latest_release_json(&body).map(Some)
            }
            Err(ureq::Error::Status(404, _)) => Ok(None),
            Err(ureq::Error::Status(_, _)) => Err(LatestReleaseFetchError::Network),
            Err(_) => Err(LatestReleaseFetchError::Network),
        }
    }
}

/// 解析 GitHub `/releases/latest` JSON body。
pub fn parse_latest_release_json(body: &str) -> Result<LatestRelease, LatestReleaseFetchError> {
    let parsed: GitHubLatestReleaseBody =
        serde_json::from_str(body).map_err(|_| LatestReleaseFetchError::InvalidResponse)?;
    let tag = parsed.tag_name.trim();
    if tag.is_empty() {
        return Err(LatestReleaseFetchError::InvalidResponse);
    }
    let html_url = parsed.html_url.trim();
    if html_url.is_empty() {
        return Err(LatestReleaseFetchError::InvalidResponse);
    }
    Ok(LatestRelease {
        version: strip_version_prefix(tag).to_string(),
        release_url: html_url.to_string(),
    })
}

#[derive(Debug, Deserialize)]
struct GitHubLatestReleaseBody {
    tag_name: String,
    html_url: String,
}

#[cfg(test)]
mod tests {
    use super::{
        parse_latest_release_json, strip_version_prefix, LatestRelease, LatestReleaseFetchError,
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
    fn parses_github_latest_json_and_strips_v_prefix() {
        let json = r#"{
            "tag_name": "v0.1.0",
            "html_url": "https://github.com/kafka0102/redwhisk/releases/tag/v0.1.0",
            "draft": false
        }"#;
        let release = parse_latest_release_json(json).expect("parse");
        assert_eq!(release.version, "0.1.0");
        assert_eq!(
            release.release_url,
            "https://github.com/kafka0102/redwhisk/releases/tag/v0.1.0"
        );
    }

    #[test]
    fn rejects_empty_tag_or_url() {
        assert!(matches!(
            parse_latest_release_json(r#"{"tag_name":"","html_url":"https://x"}"#),
            Err(LatestReleaseFetchError::InvalidResponse)
        ));
        assert!(matches!(
            parse_latest_release_json(r#"{"tag_name":"v1.0.0","html_url":"  "}"#),
            Err(LatestReleaseFetchError::InvalidResponse)
        ));
    }

    #[test]
    fn rejects_invalid_json() {
        assert!(matches!(
            parse_latest_release_json("not-json"),
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
