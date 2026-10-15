import {
  saveAgentDisplayOrder,
  type AgentProfileRecord,
} from "./settings-commands";

// 编辑已有行时保留原显示顺序；新出现的行接在当前 scope 列表最后。
export function placeSavedAgentProfile(
  currentProfiles: readonly AgentProfileRecord[],
  savedProfile: AgentProfileRecord,
): AgentProfileRecord[] {
  const remaining = currentProfiles.filter(
    (profile) => profile.id !== savedProfile.id,
  );
  const existing = currentProfiles.find(
    (profile) => profile.id === savedProfile.id,
  );
  if (existing) {
    return [
      ...remaining,
      { ...savedProfile, displayOrder: existing.displayOrder },
    ];
  }
  const nextOrder =
    remaining.reduce(
      (maxOrder, profile) => Math.max(maxOrder, profile.displayOrder),
      0,
    ) + 1;
  return [...remaining, { ...savedProfile, displayOrder: nextOrder }];
}

export async function persistAgentDisplayOrder(
  projectProfiles: readonly AgentProfileRecord[],
  globalProfiles: readonly AgentProfileRecord[],
  orderedIds: readonly number[],
  onChange: (next: {
    projectProfiles: AgentProfileRecord[];
    globalProfiles: AgentProfileRecord[];
  }) => void,
): Promise<void> {
  const previous = {
    projectProfiles: [...projectProfiles],
    globalProfiles: [...globalProfiles],
  };
  onChange({
    projectProfiles: applyAgentDisplayOrder(projectProfiles, orderedIds),
    globalProfiles: applyAgentDisplayOrder(globalProfiles, orderedIds),
  });
  try {
    await saveAgentDisplayOrder({ profileIds: [...orderedIds] });
  } catch (error) {
    onChange(previous);
    throw error;
  }
}

export function applyAgentDisplayOrder(
  profiles: readonly AgentProfileRecord[],
  orderedIds: readonly number[],
): AgentProfileRecord[] {
  const rank = new Map(orderedIds.map((id, index) => [id, index]));
  return profiles.map((profile) => {
    const nextOrder = rank.get(profile.id);
    return nextOrder === undefined
      ? profile
      : { ...profile, displayOrder: nextOrder };
  });
}
