// composer 核心 hook：管理文本、附件、Think effort、提交错误，并暴露
// 提交/取消/附件增删/effort 切换动作。
//
// `isSending` 直接派生自父组件下传的 `turnStatus === "running"`，不本地维护，
// 避免与 message-stream 形成双数据源。
//
// 附件流程：
//   open({ directory:false, multiple:false }) → sourcePath
//   → saveAgentAttachment({ sourcePath, displayName=basename }) → savedPath
//   → push chip（status saving → saved/error）
// 提交时收集 status === "saved" 的附件，映射为 `{ path, displayName, kind }`
// 随消息一起发送；status === "saving" 的附件会阻止提交并提示用户等待。

import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";

import {
  cancelAgentTurn,
  saveAgentAttachment,
  sendAgentMessage,
  setAgentThinking,
} from "../agent-session-commands";
import type { AgentMessageAttachment } from "../agent-session-commands";
import type { AgentAttachmentKindLiteral } from "../agent-stream-types";
import { toCommandError } from "../../../shared/commands/command-error";
import type { ComposerAttachment, ComposerEffort } from "./composer-types";
import type { TurnStatus } from "../message-stream/message-stream-types";

interface UseAgentComposerArgs {
  projectId: number;
  sessionId: number;
  turnStatus: TurnStatus;
  currentEffort?: ComposerEffort;
  onMessageSent?: (message: string) => void;
}

export interface UseAgentComposerResult {
  text: string;
  setText: (value: string) => void;
  attachments: ComposerAttachment[];
  effort: ComposerEffort;
  submitError: string | null;
  /** 派生自 turnStatus，供组件切换发送/取消按钮。 */
  isSending: boolean;
  /** 提交当前文本；空文本（trim 后）不发。 */
  handleSubmit: () => Promise<void>;
  /** 取消当前 turn。 */
  handleCancel: () => Promise<void>;
  /** 打开文件选择器并落盘附件。 */
  handleAddAttachment: () => Promise<void>;
  /** 移除指定 id 的附件草稿。 */
  handleRemoveAttachment: (id: string) => void;
  /** 切换 Think effort；null 表示关闭。 */
  handleSetEffort: (effort: ComposerEffort) => Promise<void>;
}

/** 生成简单的本地唯一 id（避免引入 uuid 依赖）。 */
function createLocalId(): string {
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 从源路径提取 basename 作为展示名。 */
function basenameOf(sourcePath: string): string {
  const normalized = sourcePath.replace(/\\/g, "/");
  const segments = normalized.split("/");
  return segments[segments.length - 1] || sourcePath;
}

/**
 * 根据扩展名推断附件种类（与后端 `analyze_attachment` 的前端镜像，仅用于 chip 图标）。
 * 后端 `saveAgentAttachment` 返回权威 kind，落盘成功后用后端值覆盖。
 */
function inferKind(displayName: string): AgentAttachmentKindLiteral {
  const lower = displayName.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(lower)) {
    return "image";
  }
  if (/\.pdf$/.test(lower)) {
    return "pdf";
  }
  if (/\.(docx?|rtf|odt)$/.test(lower)) {
    return "word";
  }
  if (
    /\.(txt|md|markdown|json|ya?ml|csv|tsv|log|rs|ts|tsx|js|jsx|py|go|java|c|cpp|h|sh|sql)$/.test(
      lower,
    )
  ) {
    return "text";
  }
  return "generic";
}

export function useAgentComposer({
  projectId,
  sessionId,
  turnStatus,
  currentEffort,
  onMessageSent,
}: UseAgentComposerArgs): UseAgentComposerResult {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [effort, setEffort] = useState<ComposerEffort>(currentEffort ?? null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isSending = turnStatus === "running";

  useEffect(() => {
    setEffort(currentEffort ?? null);
  }, [currentEffort]);

  const handleSubmit = useCallback(async () => {
    const message = text.trim();
    if (message === "") {
      return;
    }
    // 附件仍在落盘时阻止提交，避免发出不完整附件集。
    if (attachments.some((attachment) => attachment.status === "saving")) {
      setSubmitError("附件正在上传，请稍候");
      return;
    }
    const payloadAttachments: AgentMessageAttachment[] = attachments
      .filter((attachment) => attachment.status === "saved")
      .map((attachment) => ({
        path: attachment.savedPath,
        displayName: attachment.displayName,
        kind: attachment.kind,
      }));
    setSubmitError(null);
    try {
      await sendAgentMessage({
        projectId,
        sessionId,
        message,
        attachments: payloadAttachments,
      });
      setText("");
      setAttachments([]);
      onMessageSent?.(message);
    } catch (error) {
      setSubmitError(toCommandError(error).message);
    }
  }, [text, attachments, projectId, sessionId, onMessageSent]);

  const handleCancel = useCallback(async () => {
    setSubmitError(null);
    try {
      await cancelAgentTurn({ projectId, sessionId });
    } catch (error) {
      setSubmitError(toCommandError(error).message);
    }
  }, [projectId, sessionId]);

  const handleAddAttachment = useCallback(async () => {
    const sourcePath = await open({
      directory: false,
      multiple: false,
      title: "选择附件",
    });
    if (typeof sourcePath !== "string") {
      return;
    }
    const displayName = basenameOf(sourcePath);
    const id = createLocalId();
    const draft: ComposerAttachment = {
      id,
      displayName,
      kind: inferKind(displayName),
      savedPath: sourcePath,
      status: "saving",
    };
    setAttachments((current) => [...current, draft]);
    try {
      const result = await saveAgentAttachment({
        projectId,
        sessionId,
        sourcePath,
        displayName,
      });
      setAttachments((current) =>
        current.map((attachment) =>
          attachment.id === id
            ? {
                ...attachment,
                status: "saved",
                savedPath: result.path,
                displayName: result.displayName,
                kind: result.kind,
              }
            : attachment,
        ),
      );
    } catch (error) {
      setAttachments((current) =>
        current.map((attachment) =>
          attachment.id === id
            ? {
                ...attachment,
                status: "error",
                error: toCommandError(error).message,
              }
            : attachment,
        ),
      );
    }
  }, [projectId, sessionId]);

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments((current) =>
      current.filter((attachment) => attachment.id !== id),
    );
  }, []);

  const handleSetEffort = useCallback(
    async (nextEffort: ComposerEffort) => {
      const previous = effort;
      setEffort(nextEffort);
      setSubmitError(null);
      try {
        await setAgentThinking({
          projectId,
          sessionId,
          effort: nextEffort ?? undefined,
        });
      } catch (error) {
        setEffort(previous);
        setSubmitError(toCommandError(error).message);
      }
    },
    [effort, projectId, sessionId],
  );

  return {
    text,
    setText,
    attachments,
    effort,
    submitError,
    isSending,
    handleSubmit,
    handleCancel,
    handleAddAttachment,
    handleRemoveAttachment,
    handleSetEffort,
  };
}
