import {
  PencilSquareIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import type { InstalledLocalPlugin } from "core/protocol/coreWebview";
import { FormEvent, useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  SkillSummary,
  useSkillsCatalog,
} from "../../../components/skills/SkillSelect";
import { IdeMessengerContext } from "../../../context/IdeMessenger";
import { CONFIG_ROUTES } from "../../../util/navigation";

interface SkillDraft {
  name: string;
  description: string;
  content: string;
  scope: "workspace" | "global";
  sourceFile?: string;
}

const EMPTY_DRAFT: SkillDraft = {
  name: "",
  description: "",
  content: "",
  scope: "workspace",
};

function draftForSkill(skill: SkillSummary): SkillDraft {
  return {
    name: skill.name,
    description: skill.description,
    content: skill.content,
    scope: skill.scope ?? "workspace",
    sourceFile: skill.sourceFile,
  };
}

function contributionSummary(plugin: InstalledLocalPlugin): string {
  return Object.entries(plugin.contributions)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${count} ${kind}`)
    .join(" · ");
}

export function ExtensionsSection() {
  const ideMessenger = useContext(IdeMessengerContext);
  const navigate = useNavigate();
  const { skills, errors, loading, refresh } = useSkillsCatalog();
  const [draft, setDraft] = useState<SkillDraft>();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [plugins, setPlugins] = useState<InstalledLocalPlugin[]>([]);
  const [pluginsLoading, setPluginsLoading] = useState(true);
  const [pluginSourcePath, setPluginSourcePath] = useState("");
  const [pluginOperation, setPluginOperation] = useState<string>();
  const [pluginError, setPluginError] = useState<string>();

  const loadPlugins = async () => {
    setPluginsLoading(true);
    const response = await ideMessenger.request(
      "extensions/plugins",
      undefined,
    );
    setPluginsLoading(false);
    if (response.status === "error") {
      setPluginError(response.error);
      return;
    }
    setPlugins(response.content);
  };

  useEffect(() => {
    void loadPlugins();
  }, []);

  const installPlugin = async (event: FormEvent) => {
    event.preventDefault();
    const sourcePath = pluginSourcePath.trim();
    if (!sourcePath) return;
    setPluginOperation("install");
    setPluginError(undefined);
    const response = await ideMessenger.request("extensions/pluginInstall", {
      sourcePath,
    });
    setPluginOperation(undefined);
    if (response.status === "error") {
      setPluginError(response.error);
      return;
    }
    setPluginSourcePath("");
    await Promise.all([loadPlugins(), refresh()]);
  };

  const setPluginEnabled = async (
    plugin: InstalledLocalPlugin,
    enabled: boolean,
  ) => {
    setPluginOperation(plugin.id);
    setPluginError(undefined);
    const response = await ideMessenger.request("extensions/pluginSetEnabled", {
      id: plugin.id,
      enabled,
    });
    setPluginOperation(undefined);
    if (response.status === "error") {
      setPluginError(response.error);
      return;
    }
    setPlugins((current) =>
      current.map((candidate) =>
        candidate.id === plugin.id ? response.content : candidate,
      ),
    );
    await refresh();
  };

  const uninstallPlugin = async (plugin: InstalledLocalPlugin) => {
    setPluginOperation(plugin.id);
    setPluginError(undefined);
    const response = await ideMessenger.request("extensions/pluginUninstall", {
      id: plugin.id,
    });
    setPluginOperation(undefined);
    if (response.status === "error") {
      setPluginError(response.error);
      return;
    }
    setPlugins((current) =>
      current.filter((candidate) => candidate.id !== plugin.id),
    );
    await refresh();
  };

  const saveSkill = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    setSaving(true);
    setSaveError(undefined);
    const response = await ideMessenger.request("extensions/skillSave", draft);
    setSaving(false);
    if (response.status === "error") {
      setSaveError(response.error);
      return;
    }
    setDraft(undefined);
    await refresh();
  };

  return (
    <div className="min-w-0">
      <section aria-labelledby="local-plugins-heading" className="mb-6">
        <div className="mb-2">
          <h2 id="local-plugins-heading" className="mb-1 mt-0 text-base">
            Local plugins
          </h2>
          <p className="text-description m-0 text-xs">
            Import a trusted local plugin directory containing
            <code className="mx-1">.codex-plugin/plugin.json</code>. Qivryn
            copies it into managed storage; importing the same plugin again
            updates it.
          </p>
        </div>
        <form onSubmit={installPlugin} className="mb-2 flex gap-2">
          <input
            aria-label="Local plugin directory"
            value={pluginSourcePath}
            onChange={(event) => setPluginSourcePath(event.target.value)}
            placeholder="/path/to/plugin"
            className="border-input bg-editor min-w-0 flex-1 rounded-md border px-3 py-2 text-xs outline-none"
          />
          <button
            type="submit"
            disabled={!pluginSourcePath.trim() || Boolean(pluginOperation)}
            className="bg-button text-button-foreground cursor-pointer rounded-md border-none px-3 py-2 text-xs disabled:opacity-50"
          >
            {pluginOperation === "install" ? "Importing…" : "Import or update"}
          </button>
        </form>
        {pluginError && (
          <div
            role="alert"
            className="border-warning bg-warning/10 text-warning mb-2 rounded border p-2 text-xs"
          >
            {pluginError}
          </div>
        )}
        <div className="space-y-1">
          {plugins.map((plugin) => (
            <article
              key={plugin.id}
              className="border-input bg-input min-w-0 rounded border p-2"
            >
              <div className="flex min-w-0 items-center gap-2">
                <div className="min-w-0 flex-1">
                  <strong className="block truncate text-xs">
                    {plugin.displayName}
                  </strong>
                  <span className="text-description-muted text-2xs">
                    {plugin.developerName ?? "Local plugin"} · v{plugin.version}
                  </span>
                </div>
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    aria-label={`Enable ${plugin.displayName}`}
                    checked={plugin.enabled}
                    disabled={pluginOperation === plugin.id}
                    onChange={(event) =>
                      void setPluginEnabled(plugin, event.target.checked)
                    }
                  />
                  Enabled
                </label>
                <button
                  type="button"
                  aria-label={`Uninstall ${plugin.displayName}`}
                  disabled={pluginOperation === plugin.id}
                  onClick={() => void uninstallPlugin(plugin)}
                  className="hover:bg-list-hover flex h-6 w-6 cursor-pointer items-center justify-center rounded border-none bg-transparent disabled:opacity-50"
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                </button>
              </div>
              {plugin.description && (
                <p className="text-description text-2xs my-1 break-words">
                  {plugin.description}
                </p>
              )}
              <div
                className="text-description-muted text-2xs truncate"
                title={plugin.sourcePath}
              >
                {contributionSummary(plugin) || "No recognized contributions"}
                {" · imported from "}
                {plugin.sourcePath}
              </div>
            </article>
          ))}
          {!pluginsLoading && plugins.length === 0 && (
            <div className="text-description-muted p-3 text-center text-xs">
              No local plugins installed.
            </div>
          )}
          {pluginsLoading && plugins.length === 0 && (
            <div className="text-description-muted p-3 text-center text-xs">
              Loading plugins…
            </div>
          )}
        </div>
      </section>

      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <h2 className="mb-1 mt-0 text-base">Skills</h2>
          <p className="text-description m-0 text-xs">
            Discover, create, edit, and use portable agent skills. Rules, MCP
            servers, tools, and agent runs remain available in their dedicated
            workspaces below.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDraft({ ...EMPTY_DRAFT })}
          className="bg-button text-button-foreground flex flex-shrink-0 cursor-pointer items-center gap-1 rounded-md border-none px-2.5 py-1.5 text-xs"
        >
          <PlusIcon className="h-3.5 w-3.5" /> New skill
        </button>
      </div>
      <div className="mb-3 grid grid-cols-2 gap-2 min-[700px]:grid-cols-3">
        <button
          onClick={() => navigate(CONFIG_ROUTES.RULES)}
          className="border-input bg-input rounded border p-2 text-left text-xs"
        >
          Rules
        </button>
        <button
          onClick={() => navigate(CONFIG_ROUTES.TOOLS)}
          className="border-input bg-input rounded border p-2 text-left text-xs"
        >
          MCP & tools
        </button>
        <div className="border-input bg-input rounded border p-2 text-xs">
          {skills.length} discovered skills
        </div>
      </div>
      {[...errors, ...(saveError ? [saveError] : [])].map((error) => (
        <div
          key={error}
          role="alert"
          className="border-warning bg-warning/10 text-warning mb-2 rounded border p-2 text-xs"
        >
          {error}
        </div>
      ))}
      <div className="space-y-1">
        {skills.map((skill) => (
          <article
            key={`${skill.name}:${skill.path}`}
            className="border-input bg-input group min-w-0 rounded border p-2"
          >
            <div className="flex min-w-0 items-center gap-2">
              <strong className="min-w-0 flex-1 truncate text-xs">
                {skill.name}
              </strong>
              <span className="text-description-muted text-2xs">
                {skill.provenance ?? "Workspace"}
              </span>
              {!skill.readOnly && (
                <button
                  type="button"
                  aria-label={`Edit ${skill.name}`}
                  onClick={() => setDraft(draftForSkill(skill))}
                  className="hover:bg-list-hover flex h-6 w-6 cursor-pointer items-center justify-center rounded border-none bg-transparent opacity-70 group-hover:opacity-100"
                >
                  <PencilSquareIcon className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <p className="text-description text-2xs my-1 break-words">
              {skill.description}
            </p>
            <div
              className="text-description-muted text-2xs truncate"
              title={skill.path}
            >
              {skill.path} · {skill.files.length} resources
              {skill.readOnly ? " · read-only" : ""}
            </div>
          </article>
        ))}
        {!loading && skills.length === 0 && errors.length === 0 && (
          <div className="text-description-muted p-4 text-center text-xs">
            No global or workspace skills discovered.
          </div>
        )}
        {loading && skills.length === 0 && (
          <div className="text-description-muted p-4 text-center text-xs">
            Discovering skills…
          </div>
        )}
      </div>

      {draft && (
        <form
          aria-label={draft.sourceFile ? "Edit skill" : "Create skill"}
          onSubmit={saveSkill}
          className="border-input bg-background fixed left-1/2 top-16 z-[70] box-border w-[min(720px,calc(100vw-32px))] -translate-x-1/2 rounded-xl border p-4 shadow-2xl"
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h3 className="m-0 text-base">
                {draft.sourceFile ? "Edit skill" : "Create skill"}
              </h3>
              <p className="text-description mb-0 mt-1 text-xs">
                Skills are Markdown instructions available to chat, agents,
                subagents, and CLI.
              </p>
            </div>
            <button
              type="button"
              aria-label="Close skill editor"
              onClick={() => setDraft(undefined)}
              className="hover:bg-list-hover flex h-7 w-7 items-center justify-center rounded border-none bg-transparent"
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 gap-2 min-[560px]:grid-cols-[1fr_180px]">
            <input
              aria-label="Skill name"
              value={draft.name}
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value })
              }
              placeholder="Skill name"
              className="border-input bg-editor rounded-md border px-3 py-2 text-xs outline-none"
            />
            <select
              aria-label="Skill scope"
              disabled={Boolean(draft.sourceFile)}
              value={draft.scope}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  scope: event.target.value as SkillDraft["scope"],
                })
              }
              className="border-input bg-editor rounded-md border px-3 py-2 text-xs"
            >
              <option value="workspace">This workspace</option>
              <option value="global">All workspaces</option>
            </select>
          </div>
          <input
            aria-label="Skill description"
            value={draft.description}
            onChange={(event) =>
              setDraft({ ...draft, description: event.target.value })
            }
            placeholder="When should agents use this skill?"
            className="border-input bg-editor mt-2 box-border w-full rounded-md border px-3 py-2 text-xs outline-none"
          />
          <textarea
            aria-label="Skill instructions"
            value={draft.content}
            onChange={(event) =>
              setDraft({ ...draft, content: event.target.value })
            }
            placeholder="# Instructions\n\nDescribe the workflow, constraints, and expected output."
            rows={14}
            className="border-input bg-editor mt-2 box-border w-full resize-y rounded-md border p-3 font-mono text-xs outline-none"
          />
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDraft(undefined)}
              className="border-input bg-input hover:bg-list-hover cursor-pointer rounded-md border px-4 py-2 text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                saving ||
                !draft.name.trim() ||
                !draft.description.trim() ||
                !draft.content.trim()
              }
              className="bg-primary text-primary-foreground cursor-pointer rounded-md border-none px-4 py-2 text-xs font-medium disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save skill"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
