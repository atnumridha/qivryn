import { ChevronDownIcon, SparklesIcon } from "@heroicons/react/24/outline";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from "../ui";

const SKILL_CACHE_KEY = "continue.skills.catalog.v2";

export interface SkillSummary {
  name: string;
  description: string;
  path: string;
  sourceFile?: string;
  provenance?: string;
  readOnly?: boolean;
  scope?: "workspace" | "global";
  content: string;
  files: string[];
}

function readCachedSkills(): SkillSummary[] {
  try {
    const value = window.localStorage.getItem(SKILL_CACHE_KEY);
    return value ? (JSON.parse(value) as SkillSummary[]) : [];
  } catch {
    return [];
  }
}

function cacheableSkill(skill: SkillSummary): SkillSummary {
  // The dropdown needs metadata only. Avoid localStorage quota failures and do
  // not persist instruction bodies from private skills in the webview.
  return { ...skill, content: "", files: [] };
}

export function useSkillsCatalog() {
  const ideMessenger = useContext(IdeMessengerContext);
  const [skills, setSkills] = useState<SkillSummary[]>(readCachedSkills);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    const response = await ideMessenger.request("extensions/skills", undefined);
    setLoading(false);
    if (response.status === "error") {
      setErrors([response.error]);
      return;
    }
    const next = response.content.skills;
    setSkills(next);
    setErrors(response.content.errors.map((error) => error.message));
    try {
      window.localStorage.setItem(
        SKILL_CACHE_KEY,
        JSON.stringify(next.map(cacheableSkill)),
      );
    } catch {
      // Storage can be disabled in hardened webviews; the live catalog remains usable.
    }
  }, [ideMessenger]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { skills, loading, errors, refresh };
}

export function SkillSelect({
  value,
  onChange,
  className = "",
  compact = false,
}: {
  value?: string;
  onChange: (skill: SkillSummary | undefined) => void;
  className?: string;
  compact?: boolean;
}) {
  const { skills, loading, errors } = useSkillsCatalog();
  const sortedSkills = useMemo(
    () => [...skills].sort((a, b) => a.name.localeCompare(b.name)),
    [skills],
  );
  const selected = sortedSkills.find((skill) => skill.name === value);

  return (
    <Listbox
      value={selected ?? null}
      by="name"
      onChange={(skill: SkillSummary | null) => onChange(skill ?? undefined)}
    >
      <div
        className={`relative flex min-w-0 flex-shrink-0 items-center ${className}`}
        title="Use a discovered skill"
      >
        <ListboxButton
          aria-label="Select skill"
          className={`text-description hover:text-foreground h-[20px] min-w-0 gap-1 border-none bg-transparent px-1 ${compact ? "w-6 justify-center" : "max-w-44"}`}
        >
          <SparklesIcon className="h-3 w-3 flex-shrink-0" />
          {!compact && (
            <span className="min-w-0 truncate">
              {selected?.name ?? "Skills"}
            </span>
          )}
          {!compact && (
            <ChevronDownIcon className="h-2.5 w-2.5 flex-shrink-0" />
          )}
        </ListboxButton>
        <ListboxOptions className="no-scrollbar max-h-80 w-[min(320px,calc(100vw-24px))] min-w-56 overflow-y-auto py-1">
          <div className="border-input text-description sticky top-0 z-10 flex items-center justify-between border-b bg-inherit px-2 py-1.5 text-xs font-medium">
            <span>Skills</span>
            <span className="text-description-muted text-[10px]">
              {loading ? "Refreshing…" : `${sortedSkills.length} available`}
            </span>
          </div>
          <ListboxOption value={null} className="gap-2 py-1.5">
            <span className="text-description">No skill</span>
          </ListboxOption>
          {sortedSkills.map((skill) => (
            <ListboxOption
              key={`${skill.name}:${skill.path}`}
              value={skill}
              className="block min-w-0 py-1.5"
            >
              <div className="min-w-0">
                <div className="truncate text-xs font-medium">{skill.name}</div>
                <div className="text-description-muted mt-0.5 flex min-w-0 gap-1 text-[10px]">
                  <span className="flex-shrink-0">
                    {skill.provenance ?? "Workspace"}
                  </span>
                  <span className="truncate">· {skill.description}</span>
                </div>
              </div>
            </ListboxOption>
          ))}
          {!loading && sortedSkills.length === 0 && (
            <div className="text-description-muted px-3 py-4 text-center text-xs">
              {errors[0] ?? "No skills were discovered"}
            </div>
          )}
        </ListboxOptions>
      </div>
    </Listbox>
  );
}
