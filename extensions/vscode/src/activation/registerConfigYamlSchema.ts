import * as vscode from "vscode";

const YAML_EXTENSION_ID = "redhat.vscode-yaml";

export async function registerConfigYamlSchema(
  context: vscode.ExtensionContext,
): Promise<boolean> {
  // `yaml.schemas` is contributed by Red Hat's optional YAML extension. VS
  // Code rejects attempts to update settings that have no registered owner.
  if (!vscode.extensions.getExtension(YAML_EXTENSION_ID)) {
    return false;
  }

  const yamlMatcher = ".qivryn/**/*.yaml";
  const yamlConfig = vscode.workspace.getConfiguration("yaml");
  const yamlSchemas = yamlConfig.get<object>("schemas", {});
  const schemaUri = vscode.Uri.joinPath(
    context.extension.extensionUri,
    "config-yaml-schema.json",
  ).toString();

  try {
    await yamlConfig.update(
      "schemas",
      {
        ...yamlSchemas,
        [schemaUri]: [yamlMatcher],
      },
      vscode.ConfigurationTarget.Global,
    );
    return true;
  } catch (error) {
    // Schema completion is an optional enhancement and must never make
    // Qivryn activation look or behave like a failure.
    console.warn("Qivryn config.yaml schema registration was skipped", error);
    return false;
  }
}
