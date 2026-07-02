<h1 align="center">Qivryn</h1>

<p align="center">Open-source agentic coding assistant for the terminal, VS Code, and JetBrains IDEs.</p>

<div align="center">

<a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="Apache 2.0 license" /></a>
<a href="https://docs.qivryn.ai"><img src="https://img.shields.io/badge/Docs-docs.qivryn.ai-blue" alt="Qivryn documentation" /></a>
<a href="https://github.com/atnumridha/qivryn/releases/tag/qivryn-v1.3.40"><img src="https://img.shields.io/badge/Release-1.3.40-blue" alt="Qivryn 1.3.40 release" /></a>

</div>

<p align="center">
  <img src="media/github-readme.png" alt="Qivryn" />
</p>

Qivryn provides agentic chat, code editing, terminal tools, background agents, and project context through a shared local-first runtime.

## Install

### VS Code

1. Download [`qivryn-1.3.40.vsix`](https://github.com/atnumridha/qivryn/releases/download/qivryn-v1.3.40/qivryn-1.3.40.vsix).
2. In VS Code, run **Extensions: Install from VSIX** from the Command Palette.
3. Select the downloaded file and reload VS Code.

### JetBrains

1. Download [`qivryn-intellij-extension-1.0.68.zip`](https://github.com/atnumridha/qivryn/releases/download/qivryn-v1.3.40/qivryn-intellij-extension-1.0.68.zip).
2. Open **Settings → Plugins**.
3. Select **Install Plugin from Disk**, choose the ZIP, and restart the IDE.

### CLI

Build and link the CLI from this repository:

```bash
git clone https://github.com/atnumridha/qivryn.git
cd qivryn/extensions/cli
npm install
npm run build
npm link
qivryn --help
```

## Documentation

See the [Qivryn documentation](https://docs.qivryn.ai) for configuration, models, tools, rules, and agent workflows.

## Source

- [CLI](extensions/cli)
- [VS Code extension](extensions/vscode)
- [JetBrains plugin](extensions/intellij)
- [Agent runtime](packages/agent-runtime)

## License

Qivryn is licensed under the [Apache License 2.0](LICENSE).
