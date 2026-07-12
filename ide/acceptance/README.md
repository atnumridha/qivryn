# Native Agent acceptance

This directory tracks observable tests for the packaged Qivryn Agent IDE. Unit
and patch tests do not replace these scenarios because the native Agent pane and
Agents Window are Code - OSS workbench surfaces.

1. Build the current macOS package with `npm run ide:package:mac`.
2. Run `npm run ide:acceptance:audit` before testing to confirm the packaged
   extension version matches the source extension.
3. Execute every scenario in `electron-agent-scenarios.json` against the
   packaged application.
4. Save screenshots or recordings below `ide/acceptance/artifacts/`, set the
   scenario status to `passed`, and record the relative evidence path.
5. Run `npm run ide:acceptance:audit` again. The command fails until the package
   is current and every scenario has passed with evidence.

Do not mark a scenario as passed from browser previews or extension unit tests.
