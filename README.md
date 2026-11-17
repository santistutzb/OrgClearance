# OrgClearance

_Access diagnosis and org tools for Salesforce admins._

Chrome extension (Manifest V3, no build step) that answers, from any Salesforce record page:
**can this user see this record or field, and what grants or blocks it?**

Read-only. No server, no analytics: it talks to Salesforce from your browser using the session you already have open.

## Install for testing

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder (no build step).
3. On a Salesforce record, click the **OrgClearance icon** (bottom right) or press `Alt+Shift+A`.
4. Click the extension icon or press `Alt+Shift+W` for the **workspace** (org-wide tools).

Development: `npm install`, then `npm run check` (type check + tests). Node 20+.

## Two places

- **Record panel** (on Salesforce pages): Explain, Fields, Compare, History.
- **Workspace** (full page, pick any org you're logged into or set up with OAuth): User, Audit, Docs, Orgs.
- **Settings**: how each org connects (browser session or OAuth), and shortcuts.

Every action shows how many API calls it used and the org's daily API usage. Describe calls are cached for 10 minutes.

## Connecting to Salesforce

By default the extension reuses your Salesforce browser session (the `sid` cookie). Orgs with API Access Control,
or that only allow approved apps, reject that. For those, switch the org to **OAuth** in Settings:

1. Create an External Client App (or Connected App) in the org with OAuth enabled.
2. Callback URL: the one shown in Settings (`https://<extension-id>.chromiumapp.org/oauth2`).
3. Scope: `api` only. Turn on **Require PKCE**, turn off **Require Secret for Web Server Flow**.
4. Paste the Consumer Key in Settings and click **Test connection**.

Authorization code flow with PKCE, no client secret. The access token is kept in `chrome.storage.session`
(cleared when the browser closes) and no refresh token is requested. An expired token triggers a new login and one retry.

## Look and feel

- Icon: a shield with a check (access granted, clearance) and a magnifier (inspect, audit, compare). Source in `icons/icon.svg`; a simplified `icon-small.svg` is used for 16 and 32 px.
- Colors: petrol blue `#0E4D5C` for the brand, signal yellow `#F2B33D` only as an accent, green/red/amber only for verdicts. Deliberately different from Salesforce blue so it's clear what belongs to the extension.
- Type: Atkinson Hyperlegible (Braille Institute), bundled in `fonts/` under the SIL Open Font License (`fonts/OFL-LICENSE.txt`). Falls back to the system font if a page blocks it.
- The result card ("pass") is the one bold element: plain-language answer first, details in collapsible rows.

## Function reference

| Where | Function | Question it answers | Output |
|---|---|---|---|
| Panel | Explain | Can this user see this record or field, and why? | Verdict, reasons, who grants each permission |
| Panel | Fields | What can this user do with each field of this object? | Table per field, filterable |
| Panel | Compare | Why does one user see it and the other doesn't? | Side-by-side and the source that makes the difference |
| Panel | History | What happened to this record and who did it? | Timeline; debug log scan for flows/triggers/validations |
| Workspace | User | What can this user do in the whole org? | System permissions, object access, groups, queues, role; CSV |
| Workspace | Audit | Where is access too broad, unused or about to expire? | 7 compliance checks; CSV |
| Workspace | Docs | How is this object built and what runs on save? | HTML / Markdown with Setup links and clickable diagram |
| Workspace | Orgs | What's different between these two orgs? | Differences by section; Markdown report |
| Settings | Connection | How does the extension connect to each org? | Browser session or OAuth; connection test |

## Features

### Record panel

**Explain** (one user, this record, optional field)
- Object permissions: read, create, edit, delete, View All, Modify All, and which profile, permission set or group grants each.
- Field-level security, with the component inside a permission set group that grants it.
- Muting: flags when a group includes a permission but mutes it, or when the group is outdated and needs recalculation.
- Expired permission set assignments are ignored and listed.
- Record access: Salesforce's verdict (`UserRecordAccess`) plus **why**:
  - owns the record
  - org-wide default (internal or external, depending on the user)
  - share rows that reach the user directly or through groups: sharing rules, manual shares, teams, territories, implicit sharing, Apex sharing reasons
  - role above the owner's role
  - View All Data / Modify All Data / View All / Modify All bypass
- If access is granted but nothing checked explains it, it says so instead of inventing a reason.

**Fields**: every field on the object with the user's access (Edit / Read / None / Always) and where it comes from. Filter by name and access level.

**Compare**: two users side by side on the same record and field, the differences, and the permission sources only one of them has ("Ana gets it from Group A, which Bob doesn't have").

**History**: what happened to the record and who did it:
- Created / last modified, field history (tracked fields only), tasks, calls, events and emails, newest first.
- **Scan recent debug logs**: reads the 20 latest logs and, for the ones that mention this record, lists the flows, triggers and validation rules that ran, plus failures and errors.

### Workspace

**User**: everything a user can do in the org: sensitive and other system permissions, object access on every object (CRUD, View All, Modify All), groups, queues, role, and which profile/permission set grants each. CSV export. Reachable from the panel's Explain result.

**Audit**. Each check exports to CSV:
- Active users with Modify All Data, View All Data, Manage Users, Author Apex or Customize Application, and where each comes from.
- Profiles and permission sets with Modify All / View All on specific objects, with their active user count.
- Custom permission sets with no active users and not in any group.
- Profiles with no active users (flags which are custom and deletable).
- Possible duplicate permission sets (identical object permissions; field and system permissions not compared).
- Assignments expiring in the next 30 days.
- Active internal users who haven't logged in for 90+ days.

**Docs**: documentation for any object, as HTML or Markdown. Every field, record type, trigger, flow, validation rule and workflow rule links to its page in Salesforce Setup (flows open in Flow Builder), and the boxes in the HTML diagram are clickable:
- Data dictionary: type, required, unique, external ID, help text, picklist values, formulas.
- Record types, Apex triggers and their events, record-triggered flows, validation rules, legacy workflow rules.
- A Mermaid diagram of the save order of execution with the automations this object actually has (renders in the HTML file, GitHub, Notion and others).

**Orgs**: compare the selected org with another one you're logged into or have set up with OAuth (e.g. sandbox vs production):
- For the chosen object: fields (type, required, formula, picklist values, help text), record types, validation rules, page layout names, field permissions per profile/permission set.
- Org-wide: object permissions, flows (existence, type, active), Apex classes and triggers (code differences via checksum).
- Markdown report to attach to a deploy ticket.

## Structure

| File | What it does |
|---|---|
| `manifest.json` | Permissions: `cookies`, `storage`, `identity` (OAuth) and Salesforce domains. Shortcuts. |
| `ui.js` | Shared UI kit: design tokens, icons, components, user picker with recent users, API usage line. |
| `icons/`, `fonts/` | Extension icon (SVG + PNG sizes) and bundled typeface. |
| `content.js` | Record panel in a Shadow DOM. |
| `workspace.html/js` | Workspace page. |
| `options.html/js` | Settings: auth mode per org, OAuth setup. |
| `background.js` | Service worker. The only place that holds credentials and calls the API. Pages never see a session id or token. Workspace requests can only target orgs the user is logged into or has configured. |
| `src/resolve.js` | Picks the org and credentials (cookie or OAuth) for each request. |
| `src/auth.js` | Per-org auth settings and OAuth (PKCE). |
| `src/user.js` | User overview. |
| `src/session.js` | Finds browser sessions (`sid` cookies on API domains). |
| `src/api.js` | REST client (GET only): pagination, describe cache, call counter, chunked `IN` queries. |
| `src/access.js` | Explain, Fields and Compare logic. |
| `src/audit.js` | Audit checks. |
| `src/docs.js` | Object documentation: collection, Markdown, HTML, Mermaid. |
| `src/orgdiff.js` | Org snapshots, diff and report. |
| `src/timeline.js` | Record timeline and debug log parsing. |

## Status: not yet tested against a real org

The logic passes 42 tests against simulated data, 2 UI tests render every tab with all sections expanded and fail on broken text, the code type-checks clean, and the panel, workspace and settings were smoke-tested in a simulated DOM,
but **it hasn't run against Salesforce yet**. Validate in a Developer Org first. Things to watch:

- `session.js` finding the cookie on your domain type (sandbox, Developer Edition, Enhanced Domains).
- Share table field names: standard objects use `<Object>Id` / `<Object>AccessLevel` (Account, Opportunity, Case, Lead, Contact). Other standard objects may differ; failures show as a note.
- Reading share tables, `EntityDefinition` and other users' records needs admin-level access ("View All Data" or "View Setup").
- OAuth: the External Client App setup (callback URL, PKCE, no secret) is the most likely thing to need adjusting.
- Fields queried that may not exist in every org or edition: `PermissionSetAssignment.ExpirationDate`, `FlowDefinitionView.TriggerObjectOrEventId`, `ApexClass.BodyCrc`, history `DataType`. Each failure shows up as an error in its own section only.
- Audit aggregate queries (`GROUP BY`) can fail in orgs with more than 2,000 permission sets.
- Org comparison needs both orgs logged in within the same Chrome profile.

## Known limitations / next steps

- [ ] Org comparison doesn't compare flow or layout contents (needs the Metadata API).
- [ ] Debug logs only exist while a trace flag is active; the timeline can't show flows that ran without one.
- [ ] Duplicate detection ignores field and system permissions.
- [ ] Role hierarchy only checks "above the owner"; shares granted to subordinates' groups aren't traced.
- [ ] Custom objects: can't read whether "Grant Access Using Hierarchies" is on, so the hierarchy reason is conditional.
- [ ] Record visibility on screen: page layouts, record types, Dynamic Forms.
- [ ] Lightning only (`/lightning/r/...`). No Classic or console app support.
- [ ] Setup links assume Lightning and My Domain hosts; flow links need `FlowDefinitionView.ActiveVersionId` (falls back to the Flows list).
- [ ] Full TypeScript conversion (today: JSDoc + `tsc --checkJs`, no build step).
- [ ] Naming: Salesforce's trademark guidelines don't allow its marks ("Salesforce", "force", "Cloud"...) inside a product name; "for Salesforce" may only appear as a less prominent description.

## License

[MIT](LICENSE). The bundled Atkinson Hyperlegible font is licensed separately under the SIL Open Font License ([`fonts/OFL-LICENSE.txt`](fonts/OFL-LICENSE.txt)).
