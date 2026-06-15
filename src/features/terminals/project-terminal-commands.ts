import { invokeCommand } from "../../shared/commands/command-client";

export interface CreateProjectTerminalInput {
  projectId: number;
}

export interface CreateProjectTerminalResult {
  sessionId: number;
  name: string;
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

export function createProjectTerminal(
  input: CreateProjectTerminalInput,
): Promise<CreateProjectTerminalResult> {
  return invokeCommand<CreateProjectTerminalResult>("create_project_terminal", {
    input,
  });
}

export function readProjectTerminal(
  input: ReadProjectTerminalInput,
): Promise<ReadProjectTerminalResult> {
  return invokeCommand<ReadProjectTerminalResult>("read_project_terminal", {
    input,
  });
}

export function restoreProjectTerminal(
  input: RestoreProjectTerminalInput,
): Promise<RestoreProjectTerminalResult> {
  return invokeCommand<RestoreProjectTerminalResult>("restore_project_terminal", {
    input,
  });
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
