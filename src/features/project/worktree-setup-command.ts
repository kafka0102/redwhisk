export const WORKTREE_SETUP_COMMAND_INPUT_PROMPT =
  "Enter setup commands after creating the worktree";

export function detectWorktreeSetupCommand(projectPath: string): string | null {
  const lowerPath = projectPath.toLowerCase();
  if (lowerPath.includes("go")) return "go mod download";
  if (lowerPath.includes("rust")) return "cargo fetch";
  if (lowerPath.includes("python") || lowerPath.includes("py")) {
    return "pip install -r requirements.txt";
  }
  if (lowerPath.includes("java")) return "mvn dependency:resolve";

  return null;
}

export function initialWorktreeSetupCommand(
  savedCommand: string,
  projectPath: string,
): string {
  const trimmedSavedCommand = savedCommand.trim();
  return trimmedSavedCommand || detectWorktreeSetupCommand(projectPath) || "";
}
