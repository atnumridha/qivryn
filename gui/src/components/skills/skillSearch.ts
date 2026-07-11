import type { SkillSummary } from "./SkillSelect";

function normalize(value: string | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function skillMatchScore(skill: SkillSummary, query: string): number | null {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) {
    return 0;
  }

  const queryTerms = normalizedQuery.split(/\s+/);
  const normalizedName = normalize(skill.name);
  const nameTerms = normalizedName.split(/\s+/);
  const searchable = normalize(
    [skill.name, skill.description, skill.provenance, skill.path].join(" "),
  );
  const compactQuery = normalizedQuery.replace(/\s/g, "");
  const compactName = normalizedName.replace(/\s/g, "");

  if (
    !queryTerms.every((term) => searchable.includes(term)) &&
    !compactName.includes(compactQuery)
  ) {
    return null;
  }

  if (normalizedName === normalizedQuery || compactName === compactQuery) {
    return 0;
  }
  if (normalizedName.startsWith(normalizedQuery)) {
    return 1;
  }
  if (compactName.startsWith(compactQuery)) {
    return 2;
  }
  if (
    queryTerms.every((term) =>
      nameTerms.some((nameTerm) => nameTerm.startsWith(term)),
    )
  ) {
    return 3;
  }
  if (queryTerms.every((term) => normalizedName.includes(term))) {
    return 4;
  }
  return 5;
}

export function filterSkillsByQuery(
  skills: SkillSummary[],
  query: string,
): SkillSummary[] {
  if (!normalize(query)) {
    return [...skills].sort((a, b) => a.name.localeCompare(b.name));
  }

  return skills
    .map((skill) => ({ skill, score: skillMatchScore(skill, query) }))
    .filter(
      (candidate): candidate is { skill: SkillSummary; score: number } =>
        candidate.score !== null,
    )
    .sort(
      (a, b) =>
        a.score - b.score ||
        a.skill.name.length - b.skill.name.length ||
        a.skill.name.localeCompare(b.skill.name),
    )
    .map(({ skill }) => skill);
}
