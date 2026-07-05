import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from "react";
import {
  ArrowLeft,
  ChevronDown,
  Eye,
  Link2,
  Paperclip,
  Plus,
  Settings,
  Trash2,
  X,
} from "lucide-react";

import {
  Badge,
  Button,
  Card,
  CardContent,
  ConfirmContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Input,
  Textarea,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { useI18n } from "../../shared/i18n/i18n";

type PrototypeMode = "create" | "edit" | "readonly";
type IssueStatus = "backlog" | "running" | "review" | "completed";

interface PrototypeAttachment {
  id: string;
  name: string;
}

interface PrototypeLabel {
  id: string;
  name: string;
}

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
    description: "编辑页，危险操作移至右侧底部。",
  },
  {
    id: "readonly",
    label: "Read-only",
    description: "非 Backlog 场景的只读查看页。",
  },
];

const AVAILABLE_LABELS: PrototypeLabel[] = [
  { id: "ux", name: "ux" },
  { id: "settings", name: "settings" },
  { id: "issue-flow", name: "issue-flow" },
  { id: "review", name: "review" },
  { id: "bug", name: "bug" },
];

const STATUS_OPTIONS: Array<{ id: IssueStatus; label: string }> = [
  { id: "backlog", label: "Backlog" },
  { id: "running", label: "In progress" },
  { id: "review", label: "Review" },
  { id: "completed", label: "Completed" },
];

const EDIT_ATTACHMENTS: PrototypeAttachment[] = [
  { id: "edit-spec", name: "issue-form-split-spec.md" },
  { id: "edit-reference", name: "page-transition-reference.png" },
];

const READONLY_ATTACHMENTS: PrototypeAttachment[] = [
  { id: "readonly-notes", name: "issue-form-notes.md" },
  { id: "readonly-reference", name: "edit-flow-reference.png" },
];

const EDITABLE_DESCRIPTION =
  "Move create/edit entry points away from dialog overlay.\nSplit editable and read-only pages, but keep labels and attachments reusable.";

const READONLY_DESCRIPTION =
  "Replace the independent issue dialog with a dedicated page that takes over the current activity surface. Keep create and edit modes interactive, then split read-only viewing into a separate layout for non-backlog pages.";

export function IssuePagePrototypeSection() {
  const { messages } = useI18n();
  const [mode, setMode] = useState<PrototypeMode>("create");

  return (
    <section className="grid gap-6 pb-12">
      <div>
        <h2 className="m-0 text-[22px] font-semibold leading-[1.2]">
          {messages.designSystem.issuePrototype}
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
            <li>右侧栏覆盖 labels、附件、状态和删除等操作入口。</li>
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
          <PrototypeSurface key={mode} mode={mode} />
        </div>
      </div>
    </section>
  );
}

function PrototypeSurface({ mode }: { mode: PrototypeMode }) {
  const { messages } = useI18n();
  const isEditable = mode === "create" || mode === "edit";
  const [status, setStatus] = useState<IssueStatus>("running");
  const [labelIds, setLabelIds] = useState<string[]>(() =>
    mode === "readonly" ? ["ux", "issue-flow", "review"] : ["ux", "settings"],
  );
  const [attachments, setAttachments] = useState<PrototypeAttachment[]>(() =>
    mode === "edit"
      ? EDIT_ATTACHMENTS
      : mode === "readonly"
        ? READONLY_ATTACHMENTS
        : [],
  );
  const [previewAttachment, setPreviewAttachment] =
    useState<PrototypeAttachment | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const selectedLabels = AVAILABLE_LABELS.filter((label) =>
    labelIds.includes(label.id),
  );

  function toggleLabel(labelId: string) {
    setLabelIds((currentLabelIds) =>
      currentLabelIds.includes(labelId)
        ? currentLabelIds.filter((id) => id !== labelId)
        : [...currentLabelIds, labelId],
    );
  }

  function addAttachments(files: FileList | null) {
    if (!files?.length) {
      return;
    }

    setAttachments((currentAttachments) => [
      ...currentAttachments,
      ...Array.from(files).map((file, index) => ({
        id: `${Date.now()}-${index}-${file.name}`,
        name: file.name,
      })),
    ]);
  }

  function removeAttachment(attachmentId: string) {
    setAttachments((currentAttachments) =>
      currentAttachments.filter((attachment) => attachment.id !== attachmentId),
    );
  }

  return (
    <div className="min-h-[760px] bg-[var(--color-app)] text-[13px] text-[var(--color-text)]">
      <header className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="mx-auto flex min-h-14 items-center justify-between gap-4 px-[5%] py-3">
          <div className="min-w-0">
            <h3 className="m-0 truncate text-[16px] font-semibold leading-[1.25]">
              {mode === "create"
                ? "New issue"
                : mode === "edit"
                  ? "Edit issue"
                  : "Issue #184"}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            {mode === "readonly" ? (
              <>
                <Button variant="outline">
                  <ArrowLeft />
                  返回
                </Button>
                <StatusMenu status={status} onStatusChange={setStatus} />
              </>
            ) : (
              <>
                <Button variant="secondary">
                  {messages.designSystem.cancel}
                </Button>
                <Button>Submit</Button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="px-[5%] py-8">
        <div className="mx-auto grid max-w-[1280px] grid-cols-[minmax(0,2fr)_minmax(280px,1fr)] gap-8">
          <section className="min-w-0">
            {isEditable ? <EditableMain mode={mode} /> : <ReadOnlyMain />}
          </section>

          <IssueSidebar
            mode={mode}
            labels={selectedLabels}
            labelIds={labelIds}
            attachments={attachments}
            onToggleLabel={toggleLabel}
            onAddAttachments={addAttachments}
            onPreviewAttachment={setPreviewAttachment}
            onRemoveAttachment={removeAttachment}
            onRequestDelete={() => setIsDeleteDialogOpen(true)}
          />
        </div>
      </main>

      <AttachmentPreviewDialog
        attachment={previewAttachment}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setPreviewAttachment(null);
          }
        }}
      />
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <ConfirmContent
          cancelLabel={messages.designSystem.cancel}
          confirmLabel={messages.designSystem.delete}
          confirmVariant="destructive"
          message={messages.issues.deleteConfirmMessage}
          onCancel={() => setIsDeleteDialogOpen(false)}
          onConfirm={() => setIsDeleteDialogOpen(false)}
        />
      </Dialog>
    </div>
  );
}

function EditableMain({ mode }: { mode: "create" | "edit" }) {
  const [title, setTitle] = useState(() =>
    mode === "edit" ? "Refactor issue form flow into page switch" : "",
  );
  const [description, setDescription] = useState(() =>
    mode === "edit" ? EDITABLE_DESCRIPTION : "",
  );

  return (
    <div className="grid gap-4">
      <Input
        aria-label="Issue title"
        className="h-11 rounded-[3px] border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 text-[16px] font-semibold shadow-none"
        placeholder="Issue title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />

      <AutoResizeTextarea
        aria-label="Issue description"
        className="min-h-[176px] rounded-[3px] border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2.5 text-[13px] leading-[1.55] shadow-none"
        placeholder="Describe the task"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        rows={8}
      />
    </div>
  );
}

function AutoResizeTextarea({
  value,
  ...props
}: ComponentProps<typeof Textarea> & {
  value: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [value]);

  return <Textarea ref={textareaRef} value={value} {...props} />;
}

function ReadOnlyMain() {
  return (
    <article className="grid gap-3">
      <h1 className="m-0 text-[22px] font-semibold leading-[1.2]">
        Refactor issue form flow into page switch
      </h1>
      <p className="m-0 max-w-[72ch] whitespace-pre-wrap text-[13px] leading-[1.6] text-[var(--color-text)]">
        {READONLY_DESCRIPTION}
      </p>
    </article>
  );
}

function IssueSidebar({
  mode,
  labels,
  labelIds,
  attachments,
  onToggleLabel,
  onAddAttachments,
  onPreviewAttachment,
  onRemoveAttachment,
  onRequestDelete,
}: {
  mode: PrototypeMode;
  labels: PrototypeLabel[];
  labelIds: string[];
  attachments: PrototypeAttachment[];
  onToggleLabel: (labelId: string) => void;
  onAddAttachments: (files: FileList | null) => void;
  onPreviewAttachment: (attachment: PrototypeAttachment) => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onRequestDelete: () => void;
}) {
  const isEditable = mode === "create" || mode === "edit";
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  return (
    <aside className="flex flex-col border-l border-[var(--color-border)] pl-6">
      {isEditable ? (
        <EditableLabelsSection
          labels={labels}
          labelIds={labelIds}
          onToggleLabel={onToggleLabel}
        />
      ) : (
        <ReadonlySessionSection />
      )}

      {!isEditable ? <Divider /> : null}

      {!isEditable ? (
        <ReadonlyLabelsSection labels={labels} />
      ) : (
        <>
          <Divider />
          <EditableAttachmentSection
            attachments={attachments}
            fileInputRef={fileInputRef}
            onAddAttachments={onAddAttachments}
            onOpenFilePicker={openFilePicker}
            onPreviewAttachment={onPreviewAttachment}
            onRemoveAttachment={onRemoveAttachment}
          />
        </>
      )}

      {!isEditable && attachments.length > 0 ? (
        <>
          <Divider />
          <ReadonlyAttachmentSection
            attachments={attachments}
            onPreviewAttachment={onPreviewAttachment}
          />
        </>
      ) : null}

      {(mode === "edit" || mode === "readonly") && (
        <div>
          <Divider />
          <Button
            variant="destructive"
            className="w-full justify-center"
            onClick={onRequestDelete}
          >
            <Trash2 />
            Delete issue
          </Button>
        </div>
      )}
    </aside>
  );
}

function EditableLabelsSection({
  labels,
  labelIds,
  onToggleLabel,
}: {
  labels: PrototypeLabel[];
  labelIds: string[];
  onToggleLabel: (labelId: string) => void;
}) {
  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <h4 className="m-0 text-[13px] font-semibold leading-[1.32]">Labels</h4>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon-sm" />}
          >
            <Settings />
            <span className="sr-only">Select labels</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {AVAILABLE_LABELS.map((label) => (
              <DropdownMenuCheckboxItem
                key={label.id}
                checked={labelIds.includes(label.id)}
                onCheckedChange={() => onToggleLabel(label.id)}
              >
                {label.name}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <LabelsDisplay labels={labels} />
    </section>
  );
}

function LabelsDisplay({ labels }: { labels: PrototypeLabel[] }) {
  return (
    <section className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {labels.map((label) => (
          <LabelChip
            key={label.id}
            tone={label.id === "review" ? "accent" : "neutral"}
          >
            {label.name}
          </LabelChip>
        ))}
      </div>
    </section>
  );
}

function ReadonlyLabelsSection({ labels }: { labels: PrototypeLabel[] }) {
  return (
    <section className="grid gap-3">
      <h4 className="m-0 text-[13px] font-semibold leading-[1.32]">Labels</h4>
      <LabelsDisplay labels={labels} />
    </section>
  );
}

function EditableAttachmentSection({
  attachments,
  fileInputRef,
  onAddAttachments,
  onOpenFilePicker,
  onPreviewAttachment,
  onRemoveAttachment,
}: {
  attachments: PrototypeAttachment[];
  fileInputRef: RefObject<HTMLInputElement | null>;
  onAddAttachments: (files: FileList | null) => void;
  onOpenFilePicker: () => void;
  onPreviewAttachment: (attachment: PrototypeAttachment) => void;
  onRemoveAttachment: (attachmentId: string) => void;
}) {
  const { messages } = useI18n();

  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <h4 className="m-0 text-[13px] font-semibold leading-[1.32]">附件</h4>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={messages.issues.addAttachment}
          onClick={onOpenFilePicker}
        >
          <Plus />
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            onAddAttachments(event.target.files);
            event.target.value = "";
          }}
        />
      </div>
      {attachments.length > 0 ? (
        <AttachmentList
          attachments={attachments}
          canRemove
          onPreviewAttachment={onPreviewAttachment}
          onRemoveAttachment={onRemoveAttachment}
        />
      ) : null}
    </section>
  );
}

function ReadonlySessionSection() {
  return (
    <section className="grid gap-2">
      <h4 className="m-0 text-[13px] font-semibold leading-[1.32]">Session</h4>
      <button
        type="button"
        className="inline-flex w-fit items-center gap-1.5 rounded-[3px] text-[13px] font-medium leading-[1.45] text-[var(--color-text)] underline-offset-4 hover:underline"
      >
        <Link2 size={14} strokeWidth={1.9} />
        #77
      </button>
    </section>
  );
}

function ReadonlyAttachmentSection({
  attachments,
  onPreviewAttachment,
}: {
  attachments: PrototypeAttachment[];
  onPreviewAttachment: (attachment: PrototypeAttachment) => void;
}) {
  return (
    <section className="grid gap-3">
      <h4 className="m-0 text-[13px] font-semibold leading-[1.32]">附件</h4>
      <AttachmentList
        attachments={attachments}
        onPreviewAttachment={onPreviewAttachment}
      />
    </section>
  );
}

function AttachmentList({
  attachments,
  canRemove = false,
  onPreviewAttachment,
  onRemoveAttachment,
}: {
  attachments: PrototypeAttachment[];
  canRemove?: boolean;
  onPreviewAttachment: (attachment: PrototypeAttachment) => void;
  onRemoveAttachment?: (attachmentId: string) => void;
}) {
  return (
    <div className="grid gap-2">
      {attachments.map((attachment) => (
        <AttachmentRow
          key={attachment.id}
          attachment={attachment}
          canRemove={canRemove}
          onPreviewAttachment={onPreviewAttachment}
          onRemoveAttachment={onRemoveAttachment}
        />
      ))}
    </div>
  );
}

function AttachmentRow({
  attachment,
  canRemove,
  onPreviewAttachment,
  onRemoveAttachment,
}: {
  attachment: PrototypeAttachment;
  canRemove: boolean;
  onPreviewAttachment: (attachment: PrototypeAttachment) => void;
  onRemoveAttachment?: (attachmentId: string) => void;
}) {
  const { messages } = useI18n();
  return (
    <div className="flex items-center justify-between gap-2 rounded-[3px] bg-[var(--color-surface-muted)] px-2.5 py-1.5">
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium leading-[1.45] text-[var(--color-text)]">
        {attachment.name}
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-6 rounded-[3px] bg-transparent hover:bg-[var(--color-accent-muted)]"
          aria-label={`Preview ${attachment.name}`}
          onClick={() => onPreviewAttachment(attachment)}
        >
          <Eye />
        </Button>
        {canRemove ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-6 rounded-[3px] bg-transparent hover:bg-[var(--color-accent-muted)]"
            aria-label={messages.agentsFeature.removeAttachment(
              attachment.name,
            )}
            onClick={() => onRemoveAttachment?.(attachment.id)}
          >
            <X />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function StatusMenu({
  status,
  onStatusChange,
}: {
  status: IssueStatus;
  onStatusChange: (status: IssueStatus) => void;
}) {
  const currentStatus = STATUS_OPTIONS.find((option) => option.id === status);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" />}>
        {currentStatus?.label}
        <ChevronDown />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuRadioGroup
          value={status}
          onValueChange={(nextStatus) =>
            onStatusChange(nextStatus as IssueStatus)
          }
        >
          {STATUS_OPTIONS.filter((option) => option.id !== status).map(
            (option) => (
              <DropdownMenuRadioItem key={option.id} value={option.id}>
                {option.label}
              </DropdownMenuRadioItem>
            ),
          )}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AttachmentPreviewDialog({
  attachment,
  onOpenChange,
}: {
  attachment: PrototypeAttachment | null;
  onOpenChange: (isOpen: boolean) => void;
}) {
  const { messages } = useI18n();
  return (
    <Dialog open={attachment !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-[var(--radius-dialog)]">
        <DialogHeader>
          <DialogTitle>{messages.issues.attachmentPreview}</DialogTitle>
          <DialogDescription>
            {attachment?.name ?? "No attachment selected"}
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-32 place-items-center rounded-[3px] border border-[var(--color-border)] bg-[var(--color-surface-panel)] text-[13px] text-[var(--color-text-muted)]">
          <Paperclip size={18} strokeWidth={1.9} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Divider() {
  return <div className="my-4 h-px bg-[var(--color-border)]" />;
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
