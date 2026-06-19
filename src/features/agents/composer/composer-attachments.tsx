// 附件 chip 行（纯展示）。
//
// 渲染 composer 内已选附件的草稿 chip：图标 + 展示名 + 移除按钮。
// saving 状态显示 spinner；error 状态显示 danger 边框并带 title。
//
// 规范缺口提示：附件暂不随消息发送，行尾固定文案 + data-pending 标记，
// 让缺口可见，避免用户误以为附件已生效。

import { FileText, Image, LoaderCircle, Paperclip, X } from "lucide-react";
import type { ReactNode } from "react";

import type { AgentAttachmentKindLiteral } from "../agent-stream-types";
import type { ComposerAttachment } from "./composer-types";

interface ComposerAttachmentsProps {
  attachments: ComposerAttachment[];
  onRemove: (id: string) => void;
}

function iconForKind(kind: AgentAttachmentKindLiteral): ReactNode {
  switch (kind) {
    case "image":
      return <Image aria-hidden="true" size={13} strokeWidth={2} />;
    case "pdf":
    case "word":
    case "text":
      return <FileText aria-hidden="true" size={13} strokeWidth={2} />;
    default:
      return <Paperclip aria-hidden="true" size={13} strokeWidth={2} />;
  }
}

export function ComposerAttachments({
  attachments,
  onRemove,
}: ComposerAttachmentsProps) {
  if (attachments.length === 0) {
    return null;
  }
  return (
    <div className="agents-composer__attachments" data-pending="true">
      {attachments.map((attachment) => {
        const isError = attachment.status === "error";
        const isSaving = attachment.status === "saving";
        return (
          <span
            key={attachment.id}
            className={
              isError
                ? "agents-composer__chip agents-composer__chip--error"
                : "agents-composer__chip"
            }
            title={isError ? attachment.error : attachment.savedPath}
            data-status={attachment.status}
          >
            {isSaving ? (
              <LoaderCircle
                aria-hidden="true"
                size={13}
                strokeWidth={2}
                className="agents-composer__chip-spinner"
              />
            ) : (
              iconForKind(attachment.kind)
            )}
            <span className="agents-composer__chip-name">
              {attachment.displayName}
            </span>
            <button
              type="button"
              className="agents-composer__chip-remove"
              aria-label={`移除附件 ${attachment.displayName}`}
              onClick={() => onRemove(attachment.id)}
            >
              <X aria-hidden="true" size={12} strokeWidth={2} />
            </button>
          </span>
        );
      })}
      <span className="agents-composer__attachments-hint">
        附件已保存，暂不随消息发送
      </span>
    </div>
  );
}
