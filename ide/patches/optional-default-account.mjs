export const targetFile =
  "src/vs/workbench/services/accounts/browser/defaultAccount.ts";

const marker = "Qivryn can run without a product-level default account provider";

const configAnchor =
  "function toDefaultAccountConfig(defaultChatAgent: IDefaultChatAgent): IDefaultAccountConfig {\n\treturn {";

const optionalConfig = `function toDefaultAccountConfig(defaultChatAgent: IDefaultChatAgent | undefined): IDefaultAccountConfig {
\tif (!defaultChatAgent) {
\t\treturn {
\t\t\tpreferredExtensions: [],
\t\t\tauthenticationProvider: {
\t\t\t\tdefault: { id: '', name: '' },
\t\t\t\tenterprise: { id: '', name: '' },
\t\t\t\tenterpriseProviderConfig: '',
\t\t\t\tenterpriseProviderUriSetting: '',
\t\t\t\tscopes: [[]],
\t\t\t},
\t\t\ttokenEntitlementUrl: '',
\t\t\tentitlementUrl: '',
\t\t\tmcpRegistryDataUrl: '',
\t\t\tmanagedSettingsUrl: '',
\t\t};
\t}

\treturn {`;

const serviceConstructorAnchor = `\t\tsuper();
\t\tthis.defaultAccountConfig = toDefaultAccountConfig(productService.defaultChatAgent);
\t}`;

const optionalServiceConstructor = `\t\tsuper();
\t\tthis.defaultAccountConfig = toDefaultAccountConfig(productService.defaultChatAgent);
\t\t// Qivryn can run without a product-level default account provider.
\t\tif (!productService.defaultChatAgent) {
\t\t\tthis.initBarrier.open();
\t\t}
\t}`;

const contributionAnchor = `\t) {
\t\tsuper();
\t\tconst defaultAccountProvider = this._register(instantiationService.createInstance(DefaultAccountProvider, toDefaultAccountConfig(productService.defaultChatAgent)));`;

const optionalContribution = `\t) {
\t\tsuper();
\t\tif (!productService.defaultChatAgent) {
\t\t\treturn;
\t\t}
\t\tconst defaultAccountProvider = this._register(instantiationService.createInstance(DefaultAccountProvider, toDefaultAccountConfig(productService.defaultChatAgent)));`;

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

export function applyOptionalDefaultAccount(source) {
  if (source.includes(marker)) return source;

  return replaceOnce(
    replaceOnce(
      replaceOnce(
        source,
        configAnchor,
        optionalConfig,
        "optional default account configuration",
      ),
      serviceConstructorAnchor,
      optionalServiceConstructor,
      "default account service startup",
    ),
    contributionAnchor,
    optionalContribution,
    "default account provider contribution",
  );
}
