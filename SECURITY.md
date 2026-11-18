# Security policy

OrgClearance runs inside Salesforce with the permissions of whoever uses it, so security reports are taken seriously.

## Reporting a vulnerability

Please **don't open a public issue**. Report it privately through GitHub:
**Security → Report a vulnerability** on this repository.

Include what you found, how to reproduce it, and what an attacker could do with it. You'll get an answer within 7 days.

## Supported versions

Only the latest version on `main` gets fixes.

## How the extension is built to be safe

- **Read-only.** It only sends `GET` requests to Salesforce. Nothing in the code writes, updates or deletes data or metadata.
- **No server, no analytics.** It talks only to the Salesforce org you're using. The extension's Content Security Policy limits network access to `*.salesforce.com`, `*.force.com` and `*.salesforce-setup.com`, and every request is checked against that allowlist before a session id or token is attached.
- **Credentials stay in the service worker.** The panel, workspace and settings pages never see a session id or OAuth token. Pages on the web can't message the extension (no `externally_connectable`).
- **OAuth without secrets.** Authorization code flow with PKCE and a state check. No client secret, no refresh token. The access token lives in `chrome.storage.session` and is cleared when the browser closes. The instance URL Salesforce returns must be a Salesforce domain.
- **No remote code.** All scripts ship with the extension. Org data is always rendered as text, never as HTML.
- **Validated input.** Object, field and record names are checked before they go into a query; user search terms are escaped.
- **Safe exports.** CSV cells that would run as spreadsheet formulas are neutralized. Exported HTML documentation escapes all org data and loads Mermaid from a pinned version with Subresource Integrity.
