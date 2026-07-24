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
