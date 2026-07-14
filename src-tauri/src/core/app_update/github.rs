use serde::Deserialize;

use super::version::strip_version_prefix;

pub const DEFAULT_GITHUB_OWNER: &str = "kafka0102";
pub const DEFAULT_GITHUB_REPO: &str = "redwhisk";
pub const DEFAULT_GITHUB_API_BASE: &str = "https://api.github.com";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LatestRelease {
    pub version: String,
    pub release_url: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LatestReleaseFetchError {
    NotFound,
    Network(String),
    InvalidResponse(String),
}

impl std::fmt::Display for LatestReleaseFetchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound => write!(f, "no published release"),
            Self::Network(message) => write!(f, "network error: {message}"),
            Self::InvalidResponse(message) => write!(f, "invalid response: {message}"),
        }
    }
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
            .call();

        match response {
            Ok(response) => {
                let body: GitHubLatestReleaseBody = response
                    .into_json()
                    .map_err(|error| LatestReleaseFetchError::InvalidResponse(error.to_string()))?;
                let tag = body.tag_name.trim();
                if tag.is_empty() {
                    return Err(LatestReleaseFetchError::InvalidResponse(
                        "empty tag_name".to_string(),
                    ));
                }
                let html_url = body.html_url.trim();
                if html_url.is_empty() {
                    return Err(LatestReleaseFetchError::InvalidResponse(
                        "empty html_url".to_string(),
                    ));
                }
                Ok(Some(LatestRelease {
                    version: strip_version_prefix(tag).to_string(),
                    release_url: html_url.to_string(),
                }))
            }
            Err(ureq::Error::Status(404, _)) => Ok(None),
            Err(ureq::Error::Status(code, response)) => {
                let body = response
                    .into_string()
                    .unwrap_or_else(|_| String::new());
                Err(LatestReleaseFetchError::Network(format!(
                    "HTTP {code}: {body}"
                )))
            }
            Err(error) => Err(LatestReleaseFetchError::Network(error.to_string())),
        }
    }
}

#[derive(Debug, Deserialize)]
struct GitHubLatestReleaseBody {
    tag_name: String,
    html_url: String,
}

#[cfg(test)]
mod tests {
    use super::{
        strip_version_prefix, LatestRelease, LatestReleaseFetchError, LatestReleaseSource,
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
    fn mock_not_found_is_none() {
        let source = MockSource { result: Ok(None) };
        assert_eq!(source.fetch_latest().unwrap(), None);
    }

    #[test]
    fn mock_ok_release() {
        let source = MockSource {
            result: Ok(Some(LatestRelease {
                version: "0.1.0".to_string(),
                release_url: "https://example.com/r".to_string(),
            })),
        };
        let release = source.fetch_latest().unwrap().unwrap();
        assert_eq!(release.version, "0.1.0");
    }

    #[test]
    fn strips_tag_prefix_for_storage() {
        assert_eq!(strip_version_prefix("v0.0.3"), "0.0.3");
    }
}
