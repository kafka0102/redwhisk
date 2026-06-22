import { useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Clock3,
  Hash,
  Link2,
  Paperclip,
  Plus,
  Trash2,
} from "lucide-react";

import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Textarea,
} from "@/components/ui";
import { cn } from "@/lib/utils";

type PrototypeMode = "create" | "edit" | "readonly";

const PROTOTYPE_MODES: Array<{
  id: PrototypeMode;
  label: string;
  description: string;
}> = [
  {
    id: "create",
    label: "New issue",
    description: "创建页，整页覆盖当前内容区。",
  },
  {
    id: "edit",
    label: "Edit issue",
    description: "编辑页，顶部增加危险操作按钮。",
  },
  {
    id: "readonly",
    label: "Read-only",
    description: "非 Backlog 场景的只读查看页。",
  },
];

const EDITABLE_LABELS = [
  { name: "ux", tone: "neutral" },
  { name: "settings", tone: "neutral" },
  { name: "issue-flow", tone: "neutral" },
] as const;

const READ_ONLY_ATTACHMENTS = [
  "issue-form-notes.md",
  "edit-flow-reference.png",
] as const;

export function IssuePagePrototypeSection() {
  const [mode, setMode] = useState<PrototypeMode>("create");

  return (
    <section className="grid gap-6 pb-12">
      <div>
        <h2 className="m-0 text-[22px] font-semibold leading-[1.2]">
          Issue prototype
        </h2>
        <p className="mt-1.5 text-[13px] leading-[1.45] text-muted-foreground">
          静态确认页。用于预览 issue 表单从弹窗切换为整页后的布局方向。
        </p>
      </div>

      <Card>
        <CardContent className="grid gap-3">
          <h3 className="text-[13px] font-semibold leading-[1.32]">
            当前原型覆盖范围
          </h3>
          <ul className="m-0 list-disc pl-5 text-[13px] leading-[1.45] text-muted-foreground">
            <li>创建、编辑、只读查看三种页面态已经拆开。</li>
            <li>内容区采用整页覆盖，不再使用 dialog overlay。</li>
            <li>“In Progress / Review / 待办”页面暂未纳入本轮原型。</li>
          </ul>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        {PROTOTYPE_MODES.map((option) => {
          const isActive = option.id === mode;

          return (
            <Button
              key={option.id}
              variant={isActive ? "secondary" : "outline"}
              aria-pressed={isActive}
              onClick={() => setMode(option.id)}
            >
              {option.label}
            </Button>
          );
        })}
        <span className="text-[12px] leading-[1.4] text-muted-foreground">
          {PROTOTYPE_MODES.find((option) => option.id === mode)?.description}
        </span>
      </div>

      <div className="overflow-auto rounded-[var(--radius-card)] border bg-[var(--color-surface-muted)]">
        <div className="min-w-[900px] bg-[var(--color-app)]">
          <PrototypeSurface mode={mode} />
        </div>
      </div>
    </section>
  );
}

function PrototypeSurface({ mode }: { mode: PrototypeMode }) {
  const isEditable = mode === "create" || mode === "edit";

  return (
    <div className="min-h-[760px] bg-[var(--color-app)] text-[13px] text-[var(--color-text)]">
      <header className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="mx-auto flex min-h-14 items-center justify-between gap-4 px-[5%] py-3">
          <div className="min-w-0">
            <h3 className="m-0 text-[16px] font-semibold leading-[1.25]">
              {mode === "create"
                ? "New issue"
                : mode === "edit"
                  ? "Edit issue"
                  : "Issue detail"}
            </h3>
            <p className="mt-1 text-[12px] leading-[1.4] text-[var(--color-text-muted)]">
              {mode === "readonly"
                ? "Read-only page outside backlog lanes."
                : "Full-page issue form replacing the current work surface."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {mode === "readonly" ? (
              <>
                <Button variant="ghost">
                  <ArrowLeft />
                  Back to board
                </Button>
                <Badge variant="outline" className="rounded-[3px] px-2.5">
                  In progress
                </Badge>
              </>
            ) : (
              <>
                <Button variant="secondary">Cancel</Button>
                <Button>Submit</Button>
                {mode === "edit" ? (
                  <Button variant="destructive">
                    <Trash2 />
                    Delete
                  </Button>
                ) : null}
              </>
            )}
          </div>
        </div>
      </header>

      <main className="px-[5%] py-8">
        <div className="mx-auto min-w-[900px]">
          {isEditable ? (
            <EditablePrototype mode={mode} />
          ) : (
            <ReadOnlyPrototype />
          )}
        </div>
      </main>
    </div>
  );
}

function EditablePrototype({ mode }: { mode: "create" | "edit" }) {
  const titleValue =
    mode === "edit" ? "Refactor issue form flow into page switch" : "";
  const descriptionValue =
    mode === "edit"
      ? "Move create/edit entry points away from dialog overlay.\nSplit editable and read-only pages, but keep labels and attachments reusable."
      : "";

  return (
    <div className="grid gap-6">
      <Input
        aria-label="Issue title prototype"
        className="h-11 rounded-[3px] border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 text-[16px] font-semibold shadow-none"
        placeholder="Issue title"
        value={titleValue}
        readOnly
      />

      <Textarea
        aria-label="Issue description prototype"
        className="min-h-[176px] rounded-[3px] border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2.5 text-[13px] leading-[1.55] shadow-none"
        placeholder="Describe the task"
        value={descriptionValue}
        readOnly
        rows={8}
      />

      <section className="grid gap-4 rounded-[5px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="grid gap-1">
            <p className="m-0 text-[12px] leading-[1.35] text-[var(--color-text-muted)]">
              Labels
            </p>
            <div className="flex flex-wrap gap-2">
              {EDITABLE_LABELS.map((label) => (
                <LabelChip key={label.name} tone={label.tone}>
                  {label.name}
                </LabelChip>
              ))}
              <button
                type="button"
                className="inline-flex size-6 items-center justify-center rounded-[3px] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]"
                aria-label="Add label"
              >
                <Plus size={14} strokeWidth={1.9} />
              </button>
            </div>
          </div>
          <div className="grid justify-items-end gap-1">
            <p className="m-0 text-[12px] leading-[1.35] text-[var(--color-text-muted)]">
              Attachments
            </p>
            <button
              type="button"
              className="inline-flex size-9 items-center justify-center rounded-[3px] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text-muted)]"
              aria-label="Upload attachment"
            >
              <Plus size={16} strokeWidth={1.9} />
            </button>
          </div>
        </div>

        <div className="grid gap-2">
          <p className="m-0 text-[12px] leading-[1.35] text-[var(--color-text-muted)]">
            Existing attachments
          </p>
          <div className="grid gap-2">
            <AttachmentRow
              name="issue-form-split-spec.md"
              meta="Markdown note"
            />
            <AttachmentRow
              name="page-transition-reference.png"
              meta="Image reference"
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function ReadOnlyPrototype() {
  return (
    <div className="grid gap-6">
      <section className="grid gap-3 border-b border-[var(--color-border)] pb-6">
        <p className="m-0 text-[22px] font-semibold leading-[1.2]">
          Refactor issue form flow into page switch
        </p>
        <p className="m-0 max-w-[72ch] whitespace-pre-wrap text-[13px] leading-[1.6] text-[var(--color-text-muted)]">
          Replace the independent issue dialog with a dedicated page that takes
          over the current activity surface. Keep create and edit modes
          interactive, then split read-only viewing into a separate layout for
          non-backlog pages.
        </p>
      </section>

      <section className="grid gap-5 rounded-[5px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <div className="grid grid-cols-2 gap-x-10 gap-y-4">
          <ReadOnlyMeta
            icon={<Hash size={14} strokeWidth={1.9} />}
            label="Issue"
            value="#184"
          />
          <ReadOnlyMeta
            icon={<Clock3 size={14} strokeWidth={1.9} />}
            label="Created"
            value="2026-06-22 14:18"
          />
          <ReadOnlyMeta
            icon={<Link2 size={14} strokeWidth={1.9} />}
            label="Linked session"
            value="#77"
            isInteractive
          />
          <ReadOnlyMeta
            icon={<Paperclip size={14} strokeWidth={1.9} />}
            label="Attachments"
            value={`${READ_ONLY_ATTACHMENTS.length} files`}
          />
        </div>

        <div className="grid gap-2">
          <p className="m-0 text-[12px] leading-[1.35] text-[var(--color-text-muted)]">
            Labels
          </p>
          <div className="flex flex-wrap gap-2">
            <LabelChip tone="neutral">ux</LabelChip>
            <LabelChip tone="neutral">issue-flow</LabelChip>
            <LabelChip tone="accent">review</LabelChip>
          </div>
        </div>

        <div className="grid gap-2">
          <p className="m-0 text-[12px] leading-[1.35] text-[var(--color-text-muted)]">
            Attachment list
          </p>
          <div className="grid gap-2">
            {READ_ONLY_ATTACHMENTS.map((attachment) => (
              <AttachmentRow
                key={attachment}
                name={attachment}
                meta="Read-only item"
              />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function ReadOnlyMeta({
  icon,
  label,
  value,
  isInteractive = false,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  isInteractive?: boolean;
}) {
  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-1.5 text-[12px] leading-[1.35] text-[var(--color-text-muted)]">
        <span aria-hidden="true">{icon}</span>
        <span>{label}</span>
      </div>
      {isInteractive ? (
        <button
          type="button"
          className="w-fit rounded-[3px] text-left text-[13px] font-medium leading-[1.45] text-[var(--color-text)] underline-offset-4 hover:underline"
        >
          {value}
        </button>
      ) : (
        <p className="m-0 text-[13px] font-medium leading-[1.45] text-[var(--color-text)]">
          {value}
        </p>
      )}
    </div>
  );
}

function AttachmentRow({ name, meta }: { name: string; meta: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-[3px] border border-[var(--color-border)] bg-[var(--color-surface-panel)] px-3 py-2">
      <div className="min-w-0">
        <p className="m-0 truncate text-[13px] font-medium leading-[1.45] text-[var(--color-text)]">
          {name}
        </p>
        <p className="mt-0.5 text-[12px] leading-[1.35] text-[var(--color-text-muted)]">
          {meta}
        </p>
      </div>
      <Button variant="ghost" size="sm">
        Open
      </Button>
    </div>
  );
}

function LabelChip({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "neutral" | "accent";
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-[3px] border px-2 py-0 text-[12px] font-medium",
        tone === "accent"
          ? "border-[var(--color-border-strong)] bg-[var(--color-accent-muted)] text-[var(--color-text)]"
          : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)]",
      )}
    >
      {children}
    </Badge>
  );
}
