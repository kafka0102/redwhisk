/**
 * 构造 github.com 提交页 URL（仅公共 github.com，不含 GHE）。
 */
export function buildGithubCommitUrl(
  owner: string,
  repo: string,
  commitHash: string,
): string {
  const safeOwner = owner.trim();
  const safeRepo = repo.trim().replace(/\.git$/i, "");
  const safeHash = commitHash.trim();
  return `https://github.com/${safeOwner}/${safeRepo}/commit/${safeHash}`;
}
