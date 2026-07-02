import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { registerConfigYamlSchema } from "./registerConfigYamlSchema";

const { update, get, getExtension } = vi.hoisted(() => ({
  update: vi.fn(),
  get: vi.fn(),
  getExtension: vi.fn(),
}));

vi.mock("vscode", () => ({
  ConfigurationTarget: { Global: 1 },
  Uri: {
    joinPath: vi.fn(() => ({
      toString: () => "file:///extension/config-yaml-schema.json",
    })),
  },
  extensions: { getExtension },
  workspace: {
    getConfiguration: vi.fn(() => ({ get, update })),
  },
}));

const context = {
  extension: { extensionUri: {} },
} as vscode.ExtensionContext;

describe("registerConfigYamlSchema", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockReturnValue({ "file:///old-schema.json": ["old/**/*.yaml"] });
  });

  it("does nothing when the optional YAML extension is unavailable", async () => {
    getExtension.mockReturnValue(undefined);

    await expect(registerConfigYamlSchema(context)).resolves.toBe(false);
    expect(vscode.workspace.getConfiguration).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("registers the schema when the YAML extension is available", async () => {
    getExtension.mockReturnValue({ id: "redhat.vscode-yaml" });
    update.mockResolvedValue(undefined);

    await expect(registerConfigYamlSchema(context)).resolves.toBe(true);
    expect(update).toHaveBeenCalledWith(
      "schemas",
      {
        "file:///old-schema.json": ["old/**/*.yaml"],
        "file:///extension/config-yaml-schema.json": [".continue/**/*.yaml"],
      },
      vscode.ConfigurationTarget.Global,
    );
  });

  it("treats schema update failure as a non-fatal optional feature", async () => {
    getExtension.mockReturnValue({ id: "redhat.vscode-yaml" });
    update.mockRejectedValue(new Error("configuration unavailable"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(registerConfigYamlSchema(context)).resolves.toBe(false);
    expect(warn).toHaveBeenCalledOnce();

    warn.mockRestore();
  });
});
