# Gmail Cleanup CLI

A local, command-line tool for safely inspecting and bulk-cleaning your Gmail
inbox using the official [Gmail API](https://developers.google.com/gmail/api).

It exists because the Gmail web UI only shows/paginates ~100 conversations at
a time, which makes it painful to clean up an inbox with thousands of old
newsletters, notifications, or other clutter. This tool uses the Gmail API's
pagination directly so it can scan and process **thousands or tens of
thousands** of messages, while staying safe by default.

## What this tool does — and doesn't do

- It **counts** and **previews** messages matching any Gmail search query.
- It can move matching messages to **Gmail Trash** in batches.
- It **never permanently deletes** anything. Trashed messages stay in Gmail's
  Trash folder (and are auto-purged by Gmail after 30 days, same as if you'd
  trashed them by hand).
- It **never runs the destructive action automatically**. Running the tool
  with no arguments just prints help.

## Features

- OAuth 2.0 sign-in for your personal Gmail account (no service account).
- Full pagination over `gmail.users.messages.list` — no artificial 100/500
  message ceiling.
- `count` — read-only, reports how many messages match a query.
- `preview` — read-only, reports the count plus a small sample of matching
  senders/subjects (metadata only, no message bodies downloaded).
- `delete` — moves matching messages to Trash, but only after:
  - showing the exact query and total message count,
  - warning about broad/unscoped queries,
  - requiring you to type the exact word `DELETE`.
- `--dry-run` mode for `delete`: does the full scan and reporting, makes zero
  changes.
- Batched processing (`gmail.users.messages.batchModify`) with a progress
  bar, and bounded retry-with-backoff for transient API errors.
- Clear, colored `[INFO]` / `[SUCCESS]` / `[WARNING]` / `[ERROR]` output.

## Requirements

- Node.js **18 or newer** (tested on Node 22). Uses native ESM and
  `node:readline/promises`.
- A personal Google account with Gmail.
- A Google Cloud project with the Gmail API enabled and an OAuth client
  (steps below).

## 1. Create a Google Cloud project

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (or pick an existing one you're happy to use for
   personal tools). See [Creating and managing
   projects](https://cloud.google.com/resource-manager/docs/creating-managing-projects).

## 2. Enable the Gmail API

1. In the Cloud Console, go to **APIs & Services → Library**.
2. Search for **Gmail API** and click **Enable**.
   Docs: [Enable an API](https://support.google.com/googleapi/answer/6158841).

## 3. Configure the OAuth consent screen

1. Go to **APIs & Services → OAuth consent screen**.
2. Choose **External** (unless you have a Google Workspace org) and fill in
   the required fields (app name, support email).
3. Add yourself as a **test user** if the app stays in "Testing" mode — that
   is fine for personal use and avoids needing Google's app review, since
   you'll only ever sign in as yourself.
4. Add the scope `https://www.googleapis.com/auth/gmail.modify` under
   **Scopes** (or add it when consenting during sign-in — Google will prompt
   for it).

Docs: [Configure the OAuth consent
screen](https://developers.google.com/workspace/guides/configure-oauth-consent).

## 4. Create a Desktop OAuth client and download `credentials.json`

1. Go to **APIs & Services → Credentials**.
2. Click **Create Credentials → OAuth client ID**.
3. Application type: **Desktop app**. Give it any name (e.g. "Gmail Cleanup
   CLI").
4. Click **Create**, then **Download JSON** on the resulting client.

Docs: [Create access
credentials](https://developers.google.com/workspace/guides/create-credentials#oauth-client-id).

## 5. Place `credentials.json`

Rename the downloaded file to exactly `credentials.json` and place it at the
**project root** — next to `index.js` and `package.json`:

```
gmail-cleanup/
├── credentials.json   <-- here
├── index.js
├── package.json
└── ...
```

This file identifies your OAuth *client* (not your account). It is listed in
`.gitignore` and must never be committed or shared — see **Security** below.

## 6. Install dependencies

```bash
npm install
```

This installs `googleapis` (official Google API client) and
`@google-cloud/local-auth` (handles the local OAuth redirect flow).

> The `googleapis` package is large, so the **first command you run** may
> take several seconds just to load it — this is normal.

## 7. Authenticate

You don't run a separate "login" command — authentication happens
automatically the first time you run `count`, `preview`, or `delete`:

```bash
node index.js count
```

This opens your default browser to Google's sign-in/consent screen. After
you approve access, the tool saves an OAuth token to `token.json` in the
project root and reuses it on every future run — you won't be prompted again
unless you delete `token.json` or Google revokes access.

`token.json` is also listed in `.gitignore` — see **Security** below.

## Usage

```
node index.js <command> ["<gmail search query>"] [--dry-run]
```

| Command             | Modifies Gmail? | Description                                   |
|----------------------|:---------------:|------------------------------------------------|
| *(no command)*        | No               | Shows help.                                     |
| `count [query]`       | No               | Counts all matching messages.                   |
| `preview [query]`     | No               | Counts + shows a sample of matching messages.   |
| `delete [query]`      | **Yes**          | Moves matching messages to Trash (asks first).  |
| `delete [query] --dry-run` | No         | Reports what *would* happen; makes no changes.  |

The default query for every command is `in:inbox`.

### Count (safe, read-only)

```bash
node index.js count
node index.js count "in:inbox older_than:1y"
npm run count
```

```
Gmail Cleanup
────────────────────────────
Query: in:inbox

Scanning Gmail...
Found 18,426 matching messages.

No emails have been modified.
```

### Preview (safe, read-only)

```bash
node index.js preview
node index.js preview "in:inbox has:attachment"
npm run preview
```

Shows the total count plus a sample of up to 10 matching messages
(sender + subject only — full bodies are never downloaded for this).

### Dry run (safe, zero changes)

```bash
node index.js delete "in:inbox older_than:1y" --dry-run
npm run delete:dry
```

Runs the full scan, shows the query and count, and reports what *would*
happen — but never asks for confirmation and never touches Gmail.

### Delete / Trash (destructive — moves mail to Trash)

```bash
node index.js delete
node index.js delete "in:inbox older_than:1y"
npm run delete
```

You will see the query and total count, a warning, and a prompt. **You must
type the exact word `DELETE`** (not Enter, not "yes") to proceed:

```
Query:
in:inbox

Messages found:
18,426

ACTION:
These messages will be moved to Gmail Trash.

This action will modify your Gmail account.

Type DELETE to continue:
```

Anything else aborts with no changes made. If confirmed, messages are moved
to Trash in batches with a live progress bar, and a summary is printed at
the end (found / processed / moved to Trash / failed).

## Gmail search query examples

Any [Gmail search
operator](https://support.google.com/mail/answer/7190) works, since the
query is passed straight through to the Gmail API's `q` parameter —
this tool never re-implements Gmail's filtering logic itself.

```
in:inbox
in:inbox older_than:1y
in:inbox before:2025/01/01
in:inbox from:example@gmail.com
in:inbox has:attachment
in:inbox category:promotions
in:inbox is:unread older_than:2y
```

## Messages vs. conversations — an important distinction

The Gmail **web UI** displays and counts **conversations (threads)** — a
single thread can bundle many back-and-forth messages together as one row.

The Gmail **API**'s `messages.list` (which this tool uses) operates on
**individual messages**, not threads. If a query matches a thread with 5
messages in it, the API count includes all 5 messages, even though the web
UI would show that as **1** conversation.

This means the numbers this tool reports (e.g. "Found 18,426 matching
messages") can be **higher** than what the Gmail search box shows as a
conversation count for the same query. Both are correct — they're just
counting different units. `count` and `preview` print a reminder of this.

## Batch processing details

- Message IDs are listed via `messages.list` with `maxResults: 500` (Gmail's
  per-page maximum), following `nextPageToken` until Gmail reports no more
  pages — this is how the tool scales to tens of thousands of messages
  without hitting the ~100-result ceiling of the Gmail web UI.
- Trashing is done via `messages.batchModify`, adding the `TRASH` label (and
  removing `INBOX`/`UNREAD`) — the documented, batch-capable equivalent of
  trashing many messages at once. `messages.delete` (permanent deletion) is
  never called.
- Batches default to **50 message IDs per request** (well under Gmail's
  1000-ID batch limit, to stay comfortably under rate limits). Configurable
  via the `GMAIL_BATCH_SIZE` environment variable, e.g.:
  ```bash
  GMAIL_BATCH_SIZE=100 node index.js delete "in:inbox older_than:2y"
  ```
- Batches are processed **sequentially**, not in parallel, to avoid
  triggering Gmail API rate limits.
- If a batch fails, it's retried with exponential backoff (up to 4 attempts)
  for transient errors (HTTP 429 / 5xx). If it still fails, that batch is
  recorded as failed and the tool **moves on** to the remaining batches
  rather than aborting the whole run. The final summary reports exact
  success/failure counts. Re-running the same command is safe — messages
  already moved to Trash no longer match an `in:inbox` query.

## Environment variables

| Variable            | Default | Purpose                                      |
|----------------------|---------|-----------------------------------------------|
| `GMAIL_BATCH_SIZE`    | `50`    | Message IDs per `batchModify` request.        |

No Gmail address, client ID/secret, or token is ever read from environment
variables or hardcoded — they live only in the git-ignored `credentials.json`
and `token.json` files described above.

## Security

- **Never commit `credentials.json` or `token.json`.** Both are listed in
  `.gitignore`.
  - `credentials.json` identifies your OAuth *client* — if leaked, someone
    could impersonate your app when requesting access (they'd still need a
    user to approve consent, but it's still a private identifier you
    shouldn't publish).
  - `token.json` contains a **refresh token for your own Gmail account**. It
    is effectively equivalent to a password for reading and modifying your
    mail via the `gmail.modify` scope. Anyone who obtains this file can act
    on your mailbox until you revoke access.
- The scope requested is `https://www.googleapis.com/auth/gmail.modify` —
  enough to read, label, and trash messages, but **not** the broader
  `https://mail.google.com/` scope, and this tool never calls
  `messages.delete` (permanent deletion).
- OAuth secrets and tokens are never printed to the console or logged.
- `token.json` is written with restrictive file permissions (owner
  read/write only) where the OS supports it.

### Revoking access

If you ever want to revoke this tool's access to your Google account:

1. Go to [Google Account → Security → Third-party apps with account
   access](https://myaccount.google.com/permissions).
2. Find the app you named when creating the OAuth client, and click
   **Remove Access**.
3. Delete the local `token.json` file.

The next run will require signing in again.

## Error handling

The tool tries to surface understandable errors for:

- Missing `credentials.json` (tells you exactly where to put it).
- Invalid/corrupted `credentials.json` or `token.json` (falls back to
  re-authenticating).
- OAuth sign-in cancelled or denied in the browser.
- Expired/invalid tokens (HTTP 401) — tells you to delete `token.json` and
  re-run.
- Gmail API not enabled / scope not granted (HTTP 403).
- Rate limiting (HTTP 429) — retried automatically with backoff, then
  reported if it still fails.
- Network errors (DNS/timeout/connection reset).
- Partial batch failures during `delete` (reported in the final summary,
  doesn't abort the whole run).
- Empty search results (reported plainly, not an error).

## Project structure

```
gmail-cleanup/
├── credentials.json       # Your OAuth client (you provide this; git-ignored)
├── token.json             # Generated after first sign-in (git-ignored)
├── src/
│   ├── auth.js             # OAuth 2.0 flow, token load/save
│   ├── gmail.js             # Gmail API: pagination, sampling, batch trash, retry
│   ├── utils.js             # CLI output helpers, progress bar, confirmation prompt
│   └── commands/
│       ├── count.js
│       ├── preview.js
│       └── delete.js
├── index.js                # CLI entry point / argument parsing / help text
├── package.json
├── .gitignore
└── README.md
```

## Development

```bash
npm install
npm run lint    # node --check on every source file
npm run count    # safe to run anytime
npm run preview  # safe to run anytime
npm run delete:dry  # safe to run anytime — makes no changes
```

`npm run delete` is the only command that can modify your Gmail account, and
only after you type `DELETE` at its prompt.
