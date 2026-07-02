# Qivryn VS Code Extension

This is the Qivryn VS Code Extension. Its primary jobs are

1. Implement the IDE side of the Qivryn IDE protocol, allowing a Qivryn server to interact natively in an IDE. This happens in `src/qivrynIdeClient.ts`.
2. Open the Qivryn React app in a side panel. The React app's source code lives in the `gui` directory. The panel is opened by the `qivryn.openQivrynGUI` command, as defined in `src/commands.ts`.

# How to run the extension

See [Environment Setup](../../CONTRIBUTING.md#environment-setup)

# How to run and debug tests

After following the setup in [Environment Setup](../../CONTRIBUTING.md#environment-setup) you can run the `Extension (VSCode)` launch configuration in VS Code.
