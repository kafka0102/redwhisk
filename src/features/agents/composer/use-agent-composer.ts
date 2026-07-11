// composer 核心 hook：管理文本、附件、Think effort、提交错误，并暴露
// 提交/取消/附件增删/effort 切换动作。
//
// `isSending` 仍直接派生自父组件下传的 `turnStatus === "running"`，不本地维护，
// 避免与 message-stream 形成双数据源；同时补一个本地 `isSubmitting` 锁住
// “点击发送 → running 事件回流”之间的空窗，防止重复点击重复发送。
//
// 附件流程：
//   open({ directory:false, multiple:false }) → sourcePath
//   → saveAgentAttachment({ sourcePath, displayName=basename }) → savedPath
//   → push chip（status saving → saved/error）
// 提交时收集 status === "saved" 的附件，映射为 `{ path, displayName, kind }`
// 随消息一起发送；`saving` 状态的附件会阻止提交并提示用户等待。

import { useCallback, useEffect, useRef, useState } from "react";
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
import { useI18n } from "../../../shared/i18n/i18n";
import type { ComposerAttachment, ComposerEffort } from "./composer-types";
import type { TurnStatus } from "../message-stream/message-stream-types";

interface UseAgentComposerArgs {
  projectId: number;
  sessionId: number;
  turnStatus: TurnStatus;
  currentEffort?: ComposerEffort;
  isReadOnly?: boolean;
  onBeforeSend?: () => Promise<void>;
  onBeforeSetEffort?: () => Promise<void>;
  onMessageSent?: (message: string) => void;
}

export interface UseAgentComposerResult {
  text: string;
  setText: (value: string) => void;
  attachments: ComposerAttachment[];
  effort: ComposerEffort;
  submitError: string | null;
  cancelToastMessage: string | null;
  /** 派生自 turnStatus，供组件切换发送/取消按钮。 */
  isSending: boolean;
  /** 本地提交进行中：用于点击后立即禁用发送按钮，防止重复提交。 */
  isSubmitting: boolean;
  /** 是否正在请求取消当前 turn（防重复点击，给按钮 loading 态）。 */
  isCancelling: boolean;
  /** 提交当前文本；空文本（trim 后）不发。 */
  handleSubmit: () => Promise<void>;
  /** 取消当前 turn。 */
  handleCancel: () => Promise<void>;
  /** 打开文件选择器并落盘附件。 */
  handleAddAttachment: () => Promise<void>;
  /** 移除指定 id 的附件草稿。 */
  handleRemoveAttachment: (id: string) => void;
  /** 切换 Think effort。 */
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
 * 根据扩展名推断附件种类（与后端 `analyzeAttachment` 的前端镜像，仅用于 chip 图标）。
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
  isReadOnly = false,
  onBeforeSend,
  onBeforeSetEffort,
  onMessageSent,
}: UseAgentComposerArgs): UseAgentComposerResult {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [effort, setEffort] = useState<ComposerEffort>(currentEffort ?? null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelToastMessage, setCancelToastMessage] = useState<string | null>(
    null,
  );
  const cancelToastTimeoutRef = useRef<number | null>(null);
  const submitLockRef = useRef(false);

  const isSending = turnStatus === "running";

  useEffect(
    () => () => {
      if (cancelToastTimeoutRef.current !== null) {
        window.clearTimeout(cancelToastTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    setEffort(currentEffort ?? null);
  }, [currentEffort]);

  const showCancelToast = useCallback((message: string) => {
    setCancelToastMessage(message);
    if (cancelToastTimeoutRef.current !== null) {
      window.clearTimeout(cancelToastTimeoutRef.current);
    }
    cancelToastTimeoutRef.current = window.setTimeout(() => {
      setCancelToastMessage(null);
      cancelToastTimeoutRef.current = null;
    }, 3_000);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (isReadOnly || isSending || submitLockRef.current) {
      return;
    }
    const message = text.trim();
    if (message === "") {
      return;
    }
    // 附件仍在落盘时阻止提交，避免发出不完整附件集。
    if (attachments.some((attachment) => attachment.status === "saving")) {
      setSubmitError(t("agentsFeature.attachmentsUploading"));
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
    submitLockRef.current = true;
    setIsSubmitting(true);
    try {
      await onBeforeSend?.();
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
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  }, [
    isSending,
    isReadOnly,
    text,
    attachments,
    onBeforeSend,
    projectId,
    sessionId,
    onMessageSent,
    t,
  ]);

  const handleCancel = useCallback(async () => {
    if (isCancelling) {
      return;
    }
    setSubmitError(null);
    setIsCancelling(true);
    try {
      await cancelAgentTurn({ projectId, sessionId });
    } catch (error) {
      showCancelToast(toCommandError(error).message);
    } finally {
      setIsCancelling(false);
    }
  }, [isCancelling, projectId, sessionId, showCancelToast]);

  const handleAddAttachment = useCallback(async () => {
    if (isReadOnly) {
      return;
    }
    const sourcePath = await open({
      directory: false,
      multiple: false,
      title: t("agentsFeature.selectAttachmentTitle"),
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
  }, [isReadOnly, projectId, sessionId, t]);

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
        await onBeforeSetEffort?.();
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
    [effort, onBeforeSetEffort, projectId, sessionId],
  );

  return {
    text,
    setText,
    attachments,
    effort,
    submitError,
    cancelToastMessage,
    isSending,
    isSubmitting,
    isCancelling,
    handleSubmit,
    handleCancel,
    handleAddAttachment,
    handleRemoveAttachment,
    handleSetEffort,
  };
}
