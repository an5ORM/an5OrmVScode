# Extension verification

Run `npm test` after installing development dependencies. The suite builds TypeScript
and covers grammar/snippets, MCP protocol, schema readers, profile persistence,
SecretStorage boundaries, connection probes and command planning.

The Chromium webview regression runs when `/usr/bin/google-chrome` is available.
Set `AN5_TEST_CHROME` to another Chromium executable to enable it on other systems.
It checks form editing without exposing saved secrets, HTML injection through names,
busy state and the narrow layout. Without Chromium, this test explicitly skips.

For the real Extension Host smoke test, launch VS Code with this checkout as
`--extensionDevelopmentPath` and `test/extension-host.test.js` as `--extensionTestsPath`.
Use an isolated user data/extensions directory and a disposable trusted workspace:
this test opens the manager and creates a default ORM config in that workspace.
Do not point it at a working project. The test checks activation, Activity Bar,
webview creation, configuration defaults and MCP command availability.

This review passed with VS Code 1.140.0 on Linux under Xvfb. SQLite was tested
through the installed adapter in an isolated Node process. Real external databases,
Windows/macOS, remote workspaces and Marketplace installation are not covered by
these new UI tests.
