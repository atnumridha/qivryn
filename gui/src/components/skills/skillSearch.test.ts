import { describe, expect, it } from "vitest";
import type { SkillSummary } from "./SkillSelect";
import { filterSkillsByQuery } from "./skillSearch";

function skill(
  name: string,
  description = "",
  provenance = "Codex",
): SkillSummary {
  return {
    name,
    description,
    provenance,
    path: `/skills/${name}/SKILL.md`,
    content: "",
    files: [],
  };
}

const catalog = [
  skill("web-design-guidelines", "Review web interface code"),
  skill("ui-ux-pro-max", "Production UI and UX guidance"),
  skill("frontend-design", "Build polished frontend interfaces"),
  skill("design-flow", "Run a complete design workflow"),
];

describe("filterSkillsByQuery", () => {
  it("sorts an empty query alphabetically", () => {
    expect(filterSkillsByQuery(catalog, "").map(({ name }) => name)).toEqual([
      "design-flow",
      "frontend-design",
      "ui-ux-pro-max",
      "web-design-guidelines",
    ]);
  });

  it("matches multi-word keywords against hyphenated names", () => {
    expect(
      filterSkillsByQuery(catalog, "ui ux").map(({ name }) => name),
    ).toEqual(["ui-ux-pro-max"]);
  });

  it("matches name keywords in any order and without separators", () => {
    expect(filterSkillsByQuery(catalog, "max UI")[0]?.name).toBe(
      "ui-ux-pro-max",
    );
    expect(filterSkillsByQuery(catalog, "frontenddesign")[0]?.name).toBe(
      "frontend-design",
    );
  });

  it("falls back to descriptions and returns no unrelated results", () => {
    expect(filterSkillsByQuery(catalog, "polished interface")[0]?.name).toBe(
      "frontend-design",
    );
    expect(filterSkillsByQuery(catalog, "database migration")).toEqual([]);
  });
});
