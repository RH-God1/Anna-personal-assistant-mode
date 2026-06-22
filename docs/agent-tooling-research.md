# Agent Tooling Research Notes

Checked references:

- Browser Use: https://github.com/browser-use/browser-use
- Stagehand: https://github.com/browserbase/stagehand
- Playwright MCP: https://github.com/microsoft/playwright-mcp
- Anna beginner guide: https://forum.anna.partners/t/from-zero-to-your-first-anna-app-a-hands-on-beginners-guide/117

Takeaways for this project:

1. Browser automation should be exposed as structured tools, not as unrestricted desktop control.
2. Playwright is a good first browser backend because it supports deterministic browser sessions and screenshots.
3. MCP-style browser tools are useful inspiration, but Anna personal assistant mode still needs project-specific policy, approval, audit, and workspace limits.
4. Natural-language browser agent frameworks are powerful, but this phase should avoid autonomous checkout, login bypass, CAPTCHA bypass, and broad computer control.
5. Anna App integration should follow the official `app.json`, `manifest.json`, `bundle/`, `executas/`, `ui.host_api`, and `anna-app validate --strict` workflow.

