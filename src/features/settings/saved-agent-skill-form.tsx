import { useCallback, useMemo, useState, type FormEvent } from "react";
import { Check, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useI18n } from "../../shared/i18n/i18n";
import { getCommandErrorMessage, toCommandError } from "../../shared/commands/command-error";
import {
  listAgentSkills,
  saveSavedAgentSkill,
  type AgentSkillRecord,
  type AgentSkillScope,
  type SavedAgentSkillPath,
  type SavedAgentSkillRecord,
} from "./settings-commands";
import { formatAgentTypeLabel, getAgentLogoSrc } from "../agents/agent-visuals";

interface SavedAgentSkillFormProps {
  skill?: SavedAgentSkillRecord;
  mode: "create" | "edit";
  onCancel: () => void;
  onSaved: (skill: SavedAgentSkillRecord) => void;
  projectId: number;
}

export function SavedAgentSkillForm({
  skill,
  mode,
  onCancel,
  onSaved,
  projectId,
}: SavedAgentSkillFormProps) {
  const { messages, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [scope, setScope] = useState<AgentSkillScope>(skill?.scope ?? "global");
  const [skillName, setSkillName] = useState(skill?.name ?? "");
  const [selectedPaths, setSelectedPaths] = useState<SavedAgentSkillPath[]>(
    skill?.skillPaths ?? [],
  );
  const [availableSkills, setAvailableSkills] = useState<AgentSkillRecord[]>(
    [],
  );
  const [skillsLoadState, setSkillsLoadState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const loadSkills = useCallback(
    async (targetScope: AgentSkillScope) => {
      setSkillsLoadState("loading");
      try {
        const result = await listAgentSkills({
          projectId: targetScope === "project" ? projectId : null,
        });
        setAvailableSkills(result.skills);
        setSkillsLoadState("ready");
      } catch {
        setSkillsLoadState("error");
      }
    },
    [projectId],
  );

  const handleScopeChange = useCallback((newScope: AgentSkillScope) => {
    setScope(newScope);
    setSkillName("");
    setSelectedPaths([]);
    setNameError(null);
  }, []);

  const normalizedSkills = useMemo(() => {
    const skillMap = new Map<string, AgentSkillRecord[]>();
    for (const skill of availableSkills) {
      const existing = skillMap.get(skill.name) ?? [];
      existing.push(skill);
      skillMap.set(skill.name, existing);
    }
    return skillMap;
  }, [availableSkills]);

  const availableSkillNames = Array.from(normalizedSkills.keys()).sort();

  const selectedSkillPaths = useMemo(() => {
    if (!skillName) return [];
    return normalizedSkills.get(skillName) ?? [];
  }, [skillName, normalizedSkills]);

  const pathSelectionMap = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const path of selectedPaths) {
      map.set(`${path.agentType}:${path.path}`, true);
    }
    return map;
  }, [selectedPaths]);

  const allPathsSelected =
    selectedSkillPaths.length > 0 &&
    selectedSkillPaths.every((path) =>
      pathSelectionMap.get(`${path.agentType}:${path.path}`),
    );

  const handleSelectSkillName = (name: string) => {
    setSkillName(name);
    setSearchValue("");
    setOpen(false);
    const paths = normalizedSkills.get(name) ?? [];
    const newSelectedPaths = paths.map((p) => ({
      agentType: p.agentType,
      path: p.path,
    }));
    setSelectedPaths(newSelectedPaths);
    setNameError(null);
  };

  const togglePath = (path: AgentSkillRecord) => {
    const key = `${path.agentType}:${path.path}`;
    if (pathSelectionMap.get(key)) {
      setSelectedPaths((prev) =>
        prev.filter(
          (p) => !(p.agentType === path.agentType && p.path === path.path),
        ),
      );
    } else {
      setSelectedPaths((prev) => [
        ...prev,
        { agentType: path.agentType, path: path.path },
      ]);
    }
  };

  const toggleAllPaths = () => {
    if (allPathsSelected) {
      setSelectedPaths([]);
    } else {
      setSelectedPaths(
        selectedSkillPaths.map((p) => ({
          agentType: p.agentType,
          path: p.path,
        })),
      );
    }
  };

  function validateName(name: string): string | null {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      return messages.settings.skillNameRequired;
    }
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextNameError = validateName(skillName);
    setNameError(nextNameError);
    if (nextNameError) {
      return;
    }

    setIsSaving(true);
    setStatusMessage(null);

    try {
      const saved = await saveSavedAgentSkill({
        id: skill?.id,
        name: skillName.trim(),
        scope,
        projectId: scope === "project" ? projectId : null,
        skillPaths: selectedPaths,
      });
      onSaved(saved);
    } catch (error: unknown) {
      const err = toCommandError(error);
      if (err.code === "duplicate_name") {
        setNameError(messages.settings.skillNameDuplicate);
      } else {
        setStatusMessage(getCommandErrorMessage(error, t));
      }
    } finally {
      setIsSaving(false);
    }
  }

  const dialogTitle =
    mode === "create"
      ? messages.settings.newSkill
      : messages.settings.editSkill;

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
              htmlFor="skill-scope"
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
                const nextScope = value as AgentSkillScope;
                handleScopeChange(nextScope);
                void loadSkills(nextScope);
              }}
            >
              <SelectTrigger
                id="skill-scope"
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
              htmlFor="skill-name"
              className="text-xs text-muted-foreground"
            >
              {messages.settings.name}
            </Label>
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={open}
                  className="w-full justify-between"
                  id="skill-name"
                  onClick={() => {
                    if (skillsLoadState === "idle") {
                      void loadSkills(scope);
                    }
                  }}
                >
                  {skillName || messages.settings.selectSkillName}
                  <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[400px] p-0">
                <Command shouldFilter={false}>
                  <CommandInput
                    placeholder={messages.settings.searchSkillName}
                    value={searchValue}
                    onValueChange={setSearchValue}
                  />
                  <CommandList>
                    {skillsLoadState === "loading" ? (
                      <CommandEmpty>
                        {messages.settings.loadingSkills}
                      </CommandEmpty>
                    ) : skillsLoadState === "error" ? (
                      <CommandEmpty>
                        {messages.settings.skillLoadFailed}
                      </CommandEmpty>
                    ) : (
                      <>
                        <CommandEmpty>
                          {messages.settings.noMatches}
                        </CommandEmpty>
                        <CommandGroup>
                          {availableSkillNames
                            .filter((name) =>
                              name
                                .toLowerCase()
                                .includes(searchValue.toLowerCase()),
                            )
                            .map((name) => (
                              <CommandItem
                                key={name}
                                value={name}
                                onSelect={handleSelectSkillName}
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-4 w-4",
                                    skillName === name
                                      ? "opacity-100"
                                      : "opacity-0",
                                  )}
                                />
                                {name}
                              </CommandItem>
                            ))}
                        </CommandGroup>
                      </>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {nameError ? (
              <span role="alert" className="text-xs text-destructive">
                {nameError}
              </span>
            ) : null}
          </div>

          {selectedSkillPaths.length > 0 ? (
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">
                  {messages.settings.skillPaths}
                </Label>
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={toggleAllPaths}
                  className="h-auto px-2 py-1 text-xs"
                >
                  {allPathsSelected ? "Deselect All" : "Select All"}
                </Button>
              </div>
              <div className="max-h-48 overflow-auto rounded border border-border p-2">
                {selectedSkillPaths.map((path, index) => {
                  const key = `${path.agentType}:${path.path}`;
                  const isSelected = pathSelectionMap.get(key) ?? false;
                  return (
                    <div key={index} className="flex items-center gap-2 py-1.5">
                      <Checkbox
                        id={`path-${index}`}
                        checked={isSelected}
                        onCheckedChange={() => togglePath(path)}
                      />
                      <img
                        alt={formatAgentTypeLabel(path.agentType)}
                        className="block size-4"
                        src={getAgentLogoSrc(path.agentType)}
                      />
                      <label
                        htmlFor={`path-${index}`}
                        className="text-sm text-muted-foreground cursor-pointer flex-1 truncate"
                      >
                        {path.path}
                      </label>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        {statusMessage ? (
          <p
            className="issue-dialog__status"
            role="status"
            aria-label={messages.settings.status}
          >
            {statusMessage}
          </p>
        ) : null}

        <div className="issue-dialog__footer issue-dialog__footer--end">
          <button
            className="issues-button issues-button--primary"
            type="submit"
            disabled={isSaving || selectedPaths.length === 0}
          >
            {isSaving ? messages.settings.saving : messages.settings.save}
          </button>
        </div>
      </form>
    </div>
  );
}
