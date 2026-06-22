# Anna Controlled Assistant Security Policy

## Non-Negotiable Rules

1. Anna cannot directly control the computer.
2. Anna can only call tools registered in `@anna/tool-registry`.
3. Every tool must define `inputSchema`, `riskLevel`, `description`, and `handler`.
4. Every tool call must pass through `@anna/policy-engine`.
5. Medium and high risk actions require approval in the first production profile.
6. Critical risk actions are disabled.
7. Automatic payment, automatic ordering, file deletion, sending email, keychain reads, sudo commands, CAPTCHA bypass, login bypass, and fraud-control bypass are prohibited.
8. Mac control is limited to user-created Shortcuts listed in `ANNA_ALLOWED_SHORTCUTS`.
9. All task, policy, approval, and tool execution events must be written to `audit_logs`.
10. API keys and secrets must live in `.env` or platform secret storage, never in source code.

## Risk Levels

- `low`: read-only or preparatory action with bounded input.
- `medium`: interaction that may change page state, reveal page content, or type user-provided text.
- `high`: local Mac action, account-affecting action, or action that could affect user workflows.
- `critical`: prohibited action. The policy engine denies it even if a tool is registered.

## Browser Automation Boundary

The first browser backend is Playwright. Tools accept URLs and selectors only. There is no arbitrary JavaScript execution tool, no credential extraction, and no CAPTCHA bypass.

## Mac Automation Boundary

The first Mac backend uses the `shortcuts` CLI only. The backend cannot freely move the mouse, press arbitrary keys, read Keychain, or run shell commands supplied by the model.

## Anna Manifest Boundary

When this backend is exposed through an Anna App, `manifest.json` must declare only the Host APIs actually used by the frontend. The Anna guide recommends `anna-app validate --strict` because it checks that frontend Host API usage matches `ui.host_api`. This matters for this project: the Anna UI should call a bundled Executa or controlled backend endpoint, never a hidden desktop-control path.

## Matrix Command Boundary

The local `/matrix` page is allowed only as a development control panel. It must expose fixed command IDs and fixed argument lists. It must not accept arbitrary shell text, must not run with `shell: true`, and must not add commands for sudo, file deletion, payment, final booking, email sending, keychain access, browser password reads, login bypass, or CAPTCHA bypass.

## Payment and Shopping Boundary

The backend may assist with search, comparison, and form preparation. It must not place orders, confirm purchases, save cards, capture payments, or submit final checkout actions.
