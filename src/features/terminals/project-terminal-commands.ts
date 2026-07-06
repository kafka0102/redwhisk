import { invokeCommand } from "../../shared/commands/command-client";

export interface ProjectTerminalSummary {
  configId: number;
  sessionId: number;
  name: string;
  workingDir: string;
  launchCommand: string;
}

export interface CreateProjectTerminalInput {
  projectId: number;
}

export type CreateProjectTerminalResult = ProjectTerminalSummary;

export interface CreateTemporaryProjectTerminalInput {
  projectId: number;
  agentSessionId: number;
}

export interface CreateTemporaryProjectTerminalResult {
  sessionId: number;
  name: string;
  workingDir: string;
  launchCommand: string;
}

export interface ListProjectTerminalsInput {
  projectId: number;
}

export interface ListProjectTerminalsResult {
  terminals: ProjectTerminalSummary[];
}

export interface ReadProjectTerminalInput {
  projectId: number;
  sessionId: number;
  maxBytes?: number;
}

export interface ReadProjectTerminalResult {
  sessionId: number;
  snapshot: string;
  isActive: boolean;
}

export interface RestoreProjectTerminalInput {
  projectId: number;
  sessionId: number;
}

export interface RestoreProjectTerminalResult {
  sessionId: number;
  sequence: number;
  chunks: number[][];
  isComplete: boolean;
  isActive: boolean;
}

export interface WriteProjectTerminalInput {
  projectId: number;
  sessionId: number;
  data: string;
}

export interface ResizeProjectTerminalInput {
  projectId: number;
  sessionId: number;
  rows: number;
  cols: number;
}

export interface CloseProjectTerminalInput {
  projectId: number;
  sessionId: number;
}

export interface UpdateProjectTerminalConfigInput {
  projectId: number;
  configId: number;
  name: string;
  workingDir: string;
  launchCommand: string;
}

export interface UpdateProjectTerminalConfigResult {
  terminal: ProjectTerminalSummary;
}

export interface DeleteProjectTerminalConfigInput {
  projectId: number;
  configId: number;
}

export interface DeleteProjectTerminalConfigResult {
  configId: number;
  sessionId: number | null;
}

export function createProjectTerminal(
  input: CreateProjectTerminalInput,
): Promise<CreateProjectTerminalResult> {
  return invokeCommand<CreateProjectTerminalResult>("create_project_terminal", {
    input,
  });
}

export function createTemporaryProjectTerminal(
  input: CreateTemporaryProjectTerminalInput,
): Promise<CreateTemporaryProjectTerminalResult> {
  return invokeCommand<CreateTemporaryProjectTerminalResult>(
    "create_temporary_project_terminal",
    { input },
  );
}

export function readProjectTerminal(
  input: ReadProjectTerminalInput,
): Promise<ReadProjectTerminalResult> {
  return invokeCommand<ReadProjectTerminalResult>("read_project_terminal", {
    input,
  });
}

export function listProjectTerminals(
  input: ListProjectTerminalsInput,
): Promise<ListProjectTerminalsResult> {
  return invokeCommand<ListProjectTerminalsResult>("list_project_terminals", {
    input,
  });
}

export function restoreProjectTerminal(
  input: RestoreProjectTerminalInput,
): Promise<RestoreProjectTerminalResult> {
  return invokeCommand<RestoreProjectTerminalResult>(
    "restore_project_terminal",
    {
      input,
    },
  );
}

export function writeProjectTerminal(
  input: WriteProjectTerminalInput,
): Promise<void> {
  return invokeCommand("write_project_terminal", { input });
}

export function resizeProjectTerminal(
  input: ResizeProjectTerminalInput,
): Promise<void> {
  return invokeCommand("resize_project_terminal", { input });
}

export function closeProjectTerminal(
  input: CloseProjectTerminalInput,
): Promise<void> {
  return invokeCommand("close_project_terminal", { input });
}

export function updateProjectTerminalConfig(
  input: UpdateProjectTerminalConfigInput,
): Promise<UpdateProjectTerminalConfigResult> {
  return invokeCommand<UpdateProjectTerminalConfigResult>(
    "update_project_terminal_config",
    { input },
  );
}

export function deleteProjectTerminalConfig(
  input: DeleteProjectTerminalConfigInput,
): Promise<DeleteProjectTerminalConfigResult> {
  return invokeCommand<DeleteProjectTerminalConfigResult>(
    "delete_project_terminal_config",
    { input },
  );
}

export interface ProjectTerminalShortcutCommandRecord {
  id: number;
  projectId: number;
  command: string;
  sortOrder: number;
}

export interface ListProjectTerminalShortcutCommandsInput {
  projectId: number;
}

export interface ListProjectTerminalShortcutCommandsResult {
  commands: ProjectTerminalShortcutCommandRecord[];
}

export interface SaveProjectTerminalShortcutCommandInput {
  id?: number;
  projectId: number;
  command: string;
  sortOrder: number;
}

export interface DeleteProjectTerminalShortcutCommandInput {
  id: number;
}

export interface ReadProjectTerminalCwdInput {
  projectId: number;
  sessionId: number;
}

export interface ReadProjectTerminalCwdResult {
  sessionId: number;
  cwd: string | null;
}

export function listProjectTerminalShortcutCommands(
  input: ListProjectTerminalShortcutCommandsInput,
): Promise<ListProjectTerminalShortcutCommandsResult> {
  return invokeCommand<ListProjectTerminalShortcutCommandsResult>(
    "list_project_terminal_shortcut_commands",
    { input },
  );
}

export function saveProjectTerminalShortcutCommand(
  input: SaveProjectTerminalShortcutCommandInput,
): Promise<ProjectTerminalShortcutCommandRecord> {
  return invokeCommand<ProjectTerminalShortcutCommandRecord>(
    "save_project_terminal_shortcut_command",
    { input },
  );
}

export function deleteProjectTerminalShortcutCommand(
  input: DeleteProjectTerminalShortcutCommandInput,
): Promise<void> {
  return invokeCommand("delete_project_terminal_shortcut_command", { input });
}

export function readProjectTerminalCwd(
  input: ReadProjectTerminalCwdInput,
): Promise<ReadProjectTerminalCwdResult> {
  return invokeCommand<ReadProjectTerminalCwdResult>(
    "read_project_terminal_cwd",
    { input },
  );
}
