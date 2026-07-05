export const targetFile =
  "src/vs/workbench/contrib/welcomeOnboarding/browser/onboardingVariationA.ts";

const marker = "Qivryn products can intentionally omit a default chat agent";

const assertImport =
  "import { assertDefined } from '../../../../base/common/types.js';";

const defaultAgentAnchor = `assertDefined(product.defaultChatAgent, 'Onboarding requires a default chat agent product configuration.');
const defaultChat = product.defaultChatAgent;`;

const optionalDefaultAgent = `// Qivryn products can intentionally omit a default chat agent. The onboarding service
// remains registered for the shared workbench contract, but becomes inert without one.
const defaultChat = product.defaultChatAgent!;`;

const showAnchor = `\tshow(): void {
\t\tif (this.overlay) {`;

const guardedShow = `\tshow(): void {
\t\tif (!product.defaultChatAgent) {
\t\t\tthis._onDidDismiss.fire();
\t\t\treturn;
\t\t}

\t\tif (this.overlay) {`;

function replaceOnce(source, anchor, replacement, label) {
  const index = source.indexOf(anchor);
  if (index < 0) {
    throw new Error(`Pinned Code - OSS anchor not found for ${label}`);
  }
  if (source.indexOf(anchor, index + anchor.length) >= 0) {
    throw new Error(`Pinned Code - OSS anchor is ambiguous for ${label}`);
  }
  return `${source.slice(0, index)}${replacement}${source.slice(index + anchor.length)}`;
}

export function applyOptionalChatOnboarding(source) {
  if (source.includes(marker)) return source;

  return replaceOnce(
    replaceOnce(
      replaceOnce(
        source,
        assertImport,
        "",
        "unused onboarding assertion import",
      ),
      defaultAgentAnchor,
      optionalDefaultAgent,
      "optional default chat agent",
    ),
    showAnchor,
    guardedShow,
    "default chat agent onboarding guard",
  );
}
