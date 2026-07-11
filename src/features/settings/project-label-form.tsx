import { useEffect, useMemo, useState, type FormEvent } from "react";

import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { useI18n } from "../../shared/i18n/i18n";
import { getCommandErrorMessage } from "../../shared/commands/command-error";
import {
  listSavedAgentSkills,
  saveProjectLabel,
  type ProjectLabelRecord,
  type ProjectLabelScope,
  type SavedAgentSkillRecord,
} from "./settings-commands";

const PRESET_COLORS = [
  "#E11D48",
  "#F97316",
  "#F59E0B",
  "#84CC16",
  "#10B981",
  "#06B6D4",
  "#3B82F6",
  "#6366F1",
  "#8B5CF6",
  "#EC4899",
];

const MANAGE_SKILLS_OPTION_VALUE = "__manage-skills__";

interface ProjectLabelFormProps {
  label?: ProjectLabelRecord;
  mode: "create" | "edit";
  onCancel: () => void;
  onOpenSkillsMenu: () => void;
  onSaved: (label: ProjectLabelRecord) => void;
  projectId: number;
}

export function ProjectLabelForm({
  label,
  mode,
  onCancel,
  onOpenSkillsMenu,
  onSaved,
  projectId,
}: ProjectLabelFormProps) {
  const { messages, t } = useI18n();
  const [name, setName] = useState(label?.name ?? "");
  const [scope, setScope] = useState<ProjectLabelScope>(
    label?.scope ?? "global",
  );
  const [color, setColor] = useState(label?.color ?? PRESET_COLORS[0]);
  const [workflowSkill, setWorkflowSkill] = useState(
    label?.workflowSkill ?? "",
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [savedSkills, setSavedSkills] = useState<SavedAgentSkillRecord[]>([]);

  useEffect(() => {
    let mounted = true;
    void Promise.all([
      listSavedAgentSkills({ scope: "project", projectId }),
      listSavedAgentSkills({ scope: "global", projectId: null }),
    ])
      .then(([projectRes, globalRes]) => {
        if (!mounted) return;
        setSavedSkills([...projectRes.skills, ...globalRes.skills]);
      })
      .catch(() => {
        if (!mounted) return;
        setSavedSkills([]);
      });
    return () => {
      mounted = false;
    };
  }, [projectId]);

  const workflowSkillOptions = useMemo(() => {
    const seen = new Set<string>();
    return savedSkills.filter((skill) => {
      if (seen.has(skill.name)) return false;
      seen.add(skill.name);
      return true;
    });
  }, [savedSkills]);

  const workflowSkillSelectItems = useMemo(
    () => [
      { value: "", label: messages.settings.none },
      ...workflowSkillOptions.map((skill) => ({
        value: skill.name,
        label: skill.name,
      })),
      {
        value: MANAGE_SKILLS_OPTION_VALUE,
        label: messages.settings.manageSkills,
      },
    ],
    [
      messages.settings.manageSkills,
      messages.settings.none,
      workflowSkillOptions,
    ],
  );

  function validateName(nextName: string) {
    const trimmed = nextName.trim();
    if (trimmed.length === 0) {
      return messages.settings.labelNameRequired;
    }
    if (trimmed.length > 15) {
      return messages.settings.labelNameTooLong;
    }
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextNameError = validateName(name);
    setNameError(nextNameError);
    if (nextNameError) {
      return;
    }

    setIsSaving(true);
    setStatusMessage(null);

    try {
      const saved = await saveProjectLabel({
        id: label?.id,
        name: name.trim(),
        scope,
        projectId: scope === "project" ? projectId : null,
        color,
        workflowSkill: workflowSkill.trim().length > 0 ? workflowSkill : null,
      });
      onSaved(saved);
    } catch (error: unknown) {
      setStatusMessage(getCommandErrorMessage(error, t));
    } finally {
      setIsSaving(false);
    }
  }

  const dialogTitle =
    mode === "create"
      ? messages.settings.newLabel
      : messages.settings.editLabel;

  function handleWorkflowSkillChange(value: string) {
    if (value === MANAGE_SKILLS_OPTION_VALUE) {
      onOpenSkillsMenu();
      onCancel();
      return;
    }

    setWorkflowSkill(value);
  }

  return (
    <div
      className="issue-dialog-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <form
        className="issue-dialog"
        aria-label={dialogTitle}
        aria-modal="true"
        role="dialog"
        onSubmit={handleSubmit}
      >
        <div className="issue-dialog__header">
          <h3>{dialogTitle}</h3>
          <button
            aria-label={messages.settings.close}
            className="issue-dialog__close"
            type="button"
            onClick={onCancel}
          >
            &times;
          </button>
        </div>

        <div className="agent-dialog__body">
          <div className="grid gap-1.5">
            <Label
              htmlFor="label-name"
              className="text-xs text-muted-foreground"
            >
              {messages.settings.name}
            </Label>
            <Input
              id="label-name"
              aria-label={messages.settings.name}
              autoCapitalize="none"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (nameError !== null) {
                  setNameError(validateName(event.target.value));
                }
              }}
            />
            {nameError ? (
              <span role="alert" className="text-xs text-destructive">
                {nameError}
              </span>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <Label
              htmlFor="label-scope"
              className="text-xs text-muted-foreground"
            >
              {messages.settings.scope}
            </Label>
            <Select
              items={[
                { value: "project", label: messages.settings.projectScope },
                { value: "global", label: messages.settings.globalScope },
              ]}
              value={scope}
              onValueChange={(value) => {
                setScope(value as ProjectLabelScope);
              }}
            >
              <SelectTrigger
                id="label-scope"
                aria-label={messages.settings.scope}
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="project">
                  {messages.settings.projectScope}
                </SelectItem>
                <SelectItem value="global">
                  {messages.settings.globalScope}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label
              htmlFor="label-color"
              className="text-xs text-muted-foreground"
            >
              {messages.settings.color}
            </Label>
            <input
              id="label-color"
              aria-label={messages.settings.color}
              className="settings-input settings-label-form__color-input"
              type="color"
              value={color}
              onChange={(event) => setColor(event.target.value.toUpperCase())}
            />
            <div
              className="settings-label-form__presets"
              aria-label={messages.settings.colorPresets}
            >
              {PRESET_COLORS.map((presetColor) => (
                <button
                  key={presetColor}
                  type="button"
                  className="settings-label-form__preset"
                  aria-label={presetColor}
                  style={{ backgroundColor: presetColor }}
                  onClick={() => setColor(presetColor)}
                />
              ))}
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label
              htmlFor="label-workflow-skill"
              className="text-xs text-muted-foreground"
            >
              {messages.settings.workflowSkillSingle}
            </Label>
            <Select
              items={workflowSkillSelectItems}
              value={workflowSkill}
              onValueChange={(value) =>
                handleWorkflowSkillChange(value as string)
              }
            >
              <SelectTrigger
                id="label-workflow-skill"
                aria-label={messages.settings.workflowSkillSingle}
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{messages.settings.none}</SelectItem>
                {workflowSkillOptions.map((skill) => (
                  <SelectItem key={skill.name} value={skill.name}>
                    {skill.name}
                  </SelectItem>
                ))}
                <SelectSeparator />
                <SelectItem value={MANAGE_SKILLS_OPTION_VALUE}>
                  {messages.settings.manageSkills}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {statusMessage ? (
          <p
            className="issue-dialog__status"
            role="status"
            aria-label={messages.settings.labelStatus}
          >
            {statusMessage}
          </p>
        ) : null}

        <div className="issue-dialog__footer issue-dialog__footer--end">
          <button
            className="issues-button issues-button--primary"
            type="submit"
            disabled={isSaving}
          >
            {isSaving ? messages.settings.saving : messages.settings.save}
          </button>
        </div>
      </form>
    </div>
  );
}
