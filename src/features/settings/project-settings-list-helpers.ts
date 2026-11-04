import type {
  AgentProfileRecord,
  ProjectLabelRecord,
  SavedAgentSkillRecord,
} from "./settings-commands";

export function removeProfile(
  currentProfiles: AgentProfileRecord[],
  profileId: number,
): AgentProfileRecord[] {
  return currentProfiles.filter((profile) => profile.id !== profileId);
}

export function mergeLabel(
  currentLabels: ProjectLabelRecord[],
  savedLabel: ProjectLabelRecord,
): ProjectLabelRecord[] {
  const remaining = removeLabel(currentLabels, savedLabel.id);
  return [...remaining, savedLabel].sort(compareLabelsByScopeAndRecency);
}

export function compareLabelsByScopeAndRecency(
  left: ProjectLabelRecord,
  right: ProjectLabelRecord,
): number {
  if (left.scope !== right.scope) {
    return left.scope === "project" ? -1 : 1;
  }

  return right.id - left.id;
}

export function removeLabel(
  currentLabels: ProjectLabelRecord[],
  labelId: number,
): ProjectLabelRecord[] {
  return currentLabels.filter((label) => label.id !== labelId);
}

export function mergeSkill(
  currentSkills: SavedAgentSkillRecord[],
  savedSkill: SavedAgentSkillRecord,
): SavedAgentSkillRecord[] {
  const remaining = removeSkill(currentSkills, savedSkill.id);
  return [...remaining, savedSkill].sort((left, right) => left.id - right.id);
}

export function removeSkill(
  currentSkills: SavedAgentSkillRecord[],
  skillId: number,
): SavedAgentSkillRecord[] {
  return currentSkills.filter((skill) => skill.id !== skillId);
}
