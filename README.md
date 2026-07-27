# Azati Google Workspace MCP

Google Workspace access for employees of Azati in Claude and Codex.

**Services:** Gmail, Drive, Calendar, Chat, Contacts, Docs, Sheets, Slides, and
Workspace search.

## Requirements

- Node.js 20 or newer
- An `@azati.com` Google account

## Install

### Claude Code CLI

Add the marketplace and install the plugin:

```sh
claude-az plugin marketplace add glebowicz-azati/azati-gws-mcp
claude-az plugin install azati-gws-mcp@azati-gws
```

Start a new session, then authenticate:

```text
/azati-gws-mcp:auth
```

Complete sign-in with your `@azati.com` account.

### Claude Desktop

1. Open **Customize → Plugins**.
2. Under **Personal plugins**, select **+ → Add marketplace**.
3. Paste `https://github.com/glebowicz-azati/azati-gws-mcp`.
4. Install **Azati Google Workspace**.
5. Start a new chat.
6. Ask: `Authenticate my Azati Google Workspace.`
7. Approve the authentication tool.
8. Complete sign-in with your `@azati.com` account.

### Codex Desktop

1. Open **Plugins** in the sidebar.
2. Select **Create → Add marketplace** in the top-right corner.
3. Paste `https://github.com/glebowicz-azati/azati-gws-mcp`.
4. Open **Personal**.
5. Find and install **Azati Google Workspace**.
6. Start a new task.
7. Type `@` and select **Azati Google Workspace**.
8. Ask: `Authenticate my Azati Google Workspace.`
9. Approve the authentication tool.
10. Complete sign-in with your `@azati.com` account.

### Codex CLI

Add the marketplace and install the plugin:

```sh
codex plugin marketplace add glebowicz-azati/azati-gws-mcp
codex plugin add azati-gws-mcp@azati-gws
```

Start a new Codex session:

```sh
codex
```

Authenticate:

```text
Authenticate my Azati Google Workspace.
```

Approve the authentication tool, complete sign-in with your `@azati.com`
account, then use `/mcp` to check the connection.

### npx fallback

Use this only when the client supports a local stdio MCP server but cannot
install the marketplace. Configure the client to run:

```sh
npx --yes --ignore-scripts --package "github:glebowicz-azati/azati-gws-mcp#main" -- azati-gws-mcp
```

Authenticate from a terminal:

```sh
npx --yes --ignore-scripts --package "github:glebowicz-azati/azati-gws-mcp#main" -- azati-gws-mcp auth
```

`npx` downloads and runs the latest `main` branch. Review repository changes
before each update.

## Update

Updates preserve the plugin's persistent data, including `auth.json`. You do not
need to authenticate again unless Google has rejected or revoked the saved
credential.

### Claude Code CLI

Refresh the marketplace, update the installed plugin, then restart Claude Code
or run `/reload-plugins`:

```sh
claude-az plugin marketplace update azati-gws
claude-az plugin update azati-gws-mcp@azati-gws
```

### Claude Desktop

Open **Customize → Plugins**, refresh the **azati-gws** marketplace, update
**Azati Google Workspace**, then start a new chat.

### Codex CLI

Refresh the marketplace and its installed plugin cache, then restart Codex and
start a new session:

```sh
codex plugin marketplace upgrade azati-gws
```

### Codex Desktop

Open **Plugins → Personal**, refresh the **azati-gws** marketplace, then restart
Codex and start a new task.

### npx fallback

The `#main` configuration tracks the latest commit. Restart the MCP client after
a new version is published. To pin a specific release, replace `#main` with its
Git tag.

## Uninstall

### Claude Code CLI

Remove the plugin and marketplace:

```sh
claude-az plugin uninstall azati-gws-mcp@azati-gws
claude-az plugin marketplace remove azati-gws
```

The uninstall command removes the plugin's persistent data when it is no longer
installed in another scope. Add `--keep-data` to preserve `auth.json` for a
future reinstall.

### Claude Desktop

Open **Customize → Plugins**, uninstall **Azati Google Workspace**, then remove
the **azati-gws** marketplace if you no longer need it.

### Codex CLI

Remove the plugin and marketplace:

```sh
codex plugin remove azati-gws-mcp@azati-gws
codex plugin marketplace remove azati-gws
```

### Codex Desktop

Open **Plugins → Personal**, uninstall **Azati Google Workspace**, then remove
the **azati-gws** marketplace if you no longer need it.

### npx fallback

Remove the MCP server entry from the client configuration.

Removing the Codex plugin or an `npx` configuration does not necessarily remove
the saved Google credential. To sign out completely, delete `auth.json` and
`tools-cache.json` from the applicable directory in
[Authentication storage](#authentication-storage).

## Use

Ask in plain English:

```text
Show my meetings for today.
Find the latest document about Project Apollo.
Draft a reply to the latest email from Alex.
What's new in my Google Chat?
```

The plugin can read, create, update, send, and delete Google Workspace data.
Review every write, send, or delete tool call before approval.

## Authentication storage

Google authentication is stored locally in `auth.json`. The file contains your
Google refresh token. Do not share or commit it.

| Client                      | Default path                                                                     |
| --------------------------- | -------------------------------------------------------------------------------- |
| Claude                      | `${CLAUDE_CONFIG_DIR:-~/.claude}/plugins/data/azati-gws-mcp-azati-gws/auth.json` |
| Codex                       | `${CODEX_HOME:-~/.codex}/plugins/data/azati-gws-mcp-azati-gws/auth.json`         |
| Standalone `npx` on macOS   | `~/Library/Application Support/azati-gws-mcp/auth.json`                          |
| Standalone `npx` on Linux   | `${XDG_DATA_HOME:-~/.local/share}/azati-gws-mcp/auth.json`                       |
| Standalone `npx` on Windows | `%LOCALAPPDATA%\azati-gws-mcp\auth.json`                                         |

Set `AZATI_GWS_MCP_HOME` to override the directory:

```sh
AZATI_GWS_MCP_HOME="/your/private/directory"
```

The resulting path is `$AZATI_GWS_MCP_HOME/auth.json`. Delete that file to sign
out. Claude and Codex use separate files and may require separate sign-ins.

On macOS and Linux, the server creates the authentication directory with
permission `0700` and `auth.json` with permission `0600`.

## Tool metadata cache

The plugin caches Google's MCP tool definitions in memory and in
`tools-cache.json` beside `auth.json`. The persistent cache keeps the complete
allowlisted definitions, including output schemas, for up to 24 hours so a new
plugin process does not need to fetch the same catalog again. It contains tool
metadata only—never Google Workspace messages, email, files, events, or other
user content.

Delete `tools-cache.json` at any time to force a fresh catalog download. Missing,
expired, incompatible, or malformed service entries are fetched again. If a
refresh temporarily fails, the plugin can use the stale metadata for discovery;
actual Workspace operations still go to Google.

## Development

The runtime uses Node.js built-ins. No dependency installation is required.

```sh
npm test
```

## License

[MIT](LICENSE)

## Client documentation

- [Claude Code plugins](https://code.claude.com/docs/en/discover-plugins)
- [Claude Desktop plugins](https://support.claude.com/en/articles/13837440-use-plugins-in-claude)
- [Codex plugins](https://learn.chatgpt.com/docs/plugins)
- [Google Workspace MCP](https://developers.google.com/workspace/guides/configure-mcp-servers)
