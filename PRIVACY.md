# Privacy policy

_Last updated: 2026-11-18_

OrgClearance is a browser extension for Salesforce admins. It has no server and collects no data.

## What it accesses

- **Your Salesforce session.** To call the Salesforce API as you, it reads the session cookie of the Salesforce org you're using, or uses an OAuth sign-in if you set one up. It can only see what your Salesforce user can see.
- **Salesforce data and metadata** needed to answer your question: users, permissions, sharing, layouts, field history, debug logs and similar. It's read in your browser, shown to you, and not kept.

## What it stores, on your computer only

- The last 8 people you looked up in each org (name, username, profile), to show them as shortcuts. You can clear them in **Settings → Your data**.
- How each org connects (browser session or OAuth) and the OAuth Consumer Key you entered.
- An OAuth access token, only until you close the browser.

## What it shares

Nothing. No data is sent to the developer or any third party. There are no analytics, ads or tracking. Files you download (CSV, HTML, Markdown) stay where you save them.

The only exception is optional and in a file you open yourself: the exported HTML documentation loads the Mermaid diagram library from cdn.jsdelivr.net to draw the diagram. No org data is sent with that request.

## Contact

Questions: open an issue on the GitHub repository.
