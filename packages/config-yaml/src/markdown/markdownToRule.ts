import * as YAML from "yaml";
import {
  PackageIdentifier,
  packageIdentifierToDisplayName,
} from "../browser.js";
import { RuleObject } from "../schemas/index.js";

export interface RuleFrontmatter {
  globs?: RuleObject["globs"];
  regex?: RuleObject["regex"];
  name?: RuleObject["name"];
  description?: RuleObject["description"];
  alwaysApply?: RuleObject["alwaysApply"];
  invokable?: RuleObject["invokable"];
  environments?: RuleObject["environments"];
  disabledEnvironments?: RuleObject["disabledEnvironments"];
  disabled_environments?: RuleObject["disabledEnvironments"];
  scopedTo?: RuleObject["scopedTo"];
  scoped_to?: RuleObject["scopedTo"];
  isRequired?: RuleObject["isRequired"];
  is_required?: RuleObject["isRequired"];
}

/**
 * Parses markdown content with YAML frontmatter
 */
export function parseMarkdownRule(content: string): {
  frontmatter: RuleFrontmatter;
  markdown: string;
} {
  // Normalize line endings to \n
  const normalizedContent = content.replace(/\r\n/g, "\n");
  const openingDelimiter = normalizedContent.match(
    /^\uFEFF?(?:[\t ]*\n)*---[\t ]*\n/,
  );
  if (!openingDelimiter) {
    return { frontmatter: {}, markdown: normalizedContent };
  }

  const contentAfterOpening = normalizedContent.slice(
    openingDelimiter[0].length,
  );
  const closingDelimiter = /^---[\t ]*$/m.exec(contentAfterOpening);
  if (!closingDelimiter) {
    return { frontmatter: {}, markdown: normalizedContent };
  }

  const frontmatterStr = contentAfterOpening.slice(0, closingDelimiter.index);
  const markdownContent = contentAfterOpening.slice(
    closingDelimiter.index + closingDelimiter[0].length,
  );

  try {
    const frontmatter = YAML.parse(frontmatterStr) || {};
    return { frontmatter, markdown: markdownContent.trim() };
  } catch {
    // Third-party Markdown may begin with a horizontal rule. Treat malformed
    // frontmatter as ordinary Markdown without polluting CLI startup output.
    return { frontmatter: {}, markdown: normalizedContent };
  }
}

export function getRuleName(
  frontmatter: RuleFrontmatter,
  id: PackageIdentifier,
): string {
  if (frontmatter.name) {
    return frontmatter.name;
  }

  const displayName = packageIdentifierToDisplayName(id);

  // If it's a file identifier, extract the last two parts of the file path
  if (id.uriType === "file") {
    // Handle both forward slashes and backslashes, get the last two segments
    const segments = displayName.split(/[/\\]/);
    const lastTwoParts = segments.slice(-2);
    return lastTwoParts.filter(Boolean).join("/");
  }

  // Otherwise return the display name as-is (for slug identifiers)
  return displayName;
}

function getGlobPattern(globs: RuleFrontmatter["globs"], relativeDir?: string) {
  if (relativeDir === undefined) {
    return globs;
  }
  if (relativeDir.includes(".qivryn")) {
    return globs;
  }
  if (!relativeDir.endsWith("/")) {
    relativeDir = relativeDir.concat("/");
  }
  const prependDirAndApplyGlobstar = (glob: string) => {
    if (glob.startsWith("**")) {
      return relativeDir.concat(glob);
    }
    return relativeDir.concat("**/", glob);
  };
  if (!globs) {
    return relativeDir.concat("**/*");
  }
  if (Array.isArray(globs)) {
    return globs.map(prependDirAndApplyGlobstar);
  }
  return prependDirAndApplyGlobstar(globs);
}

export function markdownToRule(
  rule: string,
  id: PackageIdentifier,
  relativePathForGlobs?: string,
): RuleObject {
  const { frontmatter, markdown } = parseMarkdownRule(rule);

  return {
    name: getRuleName(frontmatter, id),
    rule: markdown,
    globs: getGlobPattern(frontmatter.globs, relativePathForGlobs),
    regex: frontmatter.regex,
    description: frontmatter.description,
    alwaysApply: frontmatter.alwaysApply,
    invokable: frontmatter.invokable,
    environments: frontmatter.environments,
    disabledEnvironments:
      frontmatter.disabledEnvironments ?? frontmatter.disabled_environments,
    scopedTo: frontmatter.scopedTo ?? frontmatter.scoped_to,
    isRequired: frontmatter.isRequired ?? frontmatter.is_required,
    sourceFile: id.uriType === "file" ? id.fileUri : undefined,
  };
}
