export function parseDefaultSkills(rawValue: string): string[] {
  const trimmedValue = rawValue.trim();
  if (trimmedValue.length === 0) {
    return [];
  }

  try {
    const parsedValue = JSON.parse(trimmedValue) as unknown;
    if (!Array.isArray(parsedValue)) {
      return [trimmedValue];
    }

    return dedupeSkills(
      parsedValue
        .filter((skill): skill is string => typeof skill === "string")
        .map((skill) => skill.trim())
        .filter((skill) => skill.length > 0),
    );
  } catch {
    return [trimmedValue];
  }
}

export function serializeDefaultSkills(skills: string[]): string {
  const normalizedSkills = dedupeSkills(
    skills.map((skill) => skill.trim()).filter((skill) => skill.length > 0),
  );
  if (normalizedSkills.length === 0) {
    return "";
  }

  if (normalizedSkills.length === 1) {
    return normalizedSkills[0] ?? "";
  }

  return JSON.stringify(normalizedSkills);
}

export function formatDefaultSkills(rawValue: string): string {
  const skills = parseDefaultSkills(rawValue);
  if (skills.length === 0) {
    return "";
  }

  return skills.join(", ");
}

function dedupeSkills(skills: string[]): string[] {
  return Array.from(new Set(skills));
}
