import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import {
	AUTHENTICATE_TOOL,
	SERVER_INSTRUCTIONS,
	WORKSPACE_TOOLS,
	SCOPES,
	SERVICES,
	allowedTool,
	authFilePath,
	authenticateProfile,
	callTool,
	configDirectory,
	createPkce,
	handleMessage,
	listTools,
	loadToken,
	parseRemoteResponse,
	runAuth,
	runStdio,
	saveToken,
	verifyAzatiUser,
} from "../plugins/azati-gws-mcp/server.mjs";

test("package is dependency-free and has no install lifecycle scripts", async () => {
	const pkg = JSON.parse(await readFile("package.json", "utf8"));
	assert.equal(pkg.engines.node, ">=20");
	assert.deepEqual(pkg.author, {
		name: "Uladzislau Hlebovich",
		email: "uladzislau.hlebovich@azati.com",
		url: "https://github.com/glebowicz-azati",
	});
	assert.equal(pkg.name, "azati-gws-mcp");
	assert.equal(pkg.bin["azati-gws-mcp"], "plugins/azati-gws-mcp/server.mjs");
	assert.equal(pkg.license, "MIT");
	const license = await readFile("LICENSE", "utf8");
	assert.match(license, /^MIT License$/m);
	assert.match(license, /Copyright \(c\) 2026 Uladzislau Hlebovich/);
	assert.deepEqual(pkg.dependencies, undefined);
	assert.deepEqual(pkg.devDependencies, undefined);
	for (const name of [
		"preinstall",
		"install",
		"postinstall",
		"prepare",
		"prepublish",
		"prepublishOnly",
	]) {
		assert.equal(pkg.scripts?.[name], undefined);
	}
});

test("marketplace and plugin metadata identify the maintainer", async () => {
	const expectedAuthor = {
		name: "Uladzislau Hlebovich",
		email: "uladzislau.hlebovich@azati.com",
		url: "https://github.com/glebowicz-azati",
	};
	const marketplace = JSON.parse(
		await readFile(".claude-plugin/marketplace.json", "utf8"),
	);
	assert.equal(marketplace.name, "azati-gws");
	assert.equal(marketplace.plugins[0].name, "azati-gws-mcp");
	assert.deepEqual(marketplace.owner, {
		name: expectedAuthor.name,
		email: expectedAuthor.email,
	});
	assert.deepEqual(marketplace.plugins[0].author, expectedAuthor);

	const codexMarketplace = JSON.parse(
		await readFile(".agents/plugins/marketplace.json", "utf8"),
	);
	assert.equal(codexMarketplace.name, "azati-gws");
	assert.equal(codexMarketplace.plugins[0].name, "azati-gws-mcp");
	assert.equal(
		codexMarketplace.plugins[0].source.path,
		"./plugins/azati-gws-mcp",
	);

	for (const path of [
		"plugins/azati-gws-mcp/.claude-plugin/plugin.json",
		"plugins/azati-gws-mcp/.codex-plugin/plugin.json",
	]) {
		const manifest = JSON.parse(await readFile(path, "utf8"));
		assert.equal(manifest.name, "azati-gws-mcp");
		assert.deepEqual(manifest.author, expectedAuthor);
	}

	const codexManifest = JSON.parse(
		await readFile("plugins/azati-gws-mcp/.codex-plugin/plugin.json", "utf8"),
	);
	assert.ok(
		codexManifest.interface.defaultPrompt.includes(
			"Authenticate my Azati Google Workspace.",
		),
	);
	assert.ok(
		codexManifest.interface.defaultPrompt.includes(
			"What's new in my Google Chat?",
		),
	);
});

test("plugin manifests isolate tokens by Claude and Codex home", async () => {
	const claudeServers = JSON.parse(
		await readFile("plugins/azati-gws-mcp/mcp.claude.json", "utf8"),
	).mcpServers;
	assert.deepEqual(Object.keys(claudeServers), ["azati-gws-mcp"]);
	const claude = claudeServers["azati-gws-mcp"];
	assert.deepEqual(claude.env, {
		AZATI_GWS_MCP_HOME: "${CLAUDE_PLUGIN_DATA}",
	});

	const codexServers = JSON.parse(
		await readFile("plugins/azati-gws-mcp/.mcp.json", "utf8"),
	).mcpServers;
	assert.deepEqual(Object.keys(codexServers), ["azati-gws-mcp"]);
	const codex = codexServers["azati-gws-mcp"];
	assert.deepEqual(codex.env, {
		AZATI_GWS_MCP_CLIENT: "codex-plugin",
	});
	assert.deepEqual(codex.env_vars, ["CODEX_HOME"]);
	assert.equal(codex.tool_timeout_sec, 240);
});

test("uses only persistent plugin data for authentication", () => {
	assert.equal(
		authFilePath(
			"darwin",
			{
				AZATI_GWS_MCP_HOME:
					"/Users/alice/.claude-azati/plugins/data/azati-gws-mcp-azati-gws",
			},
			"/Users/alice",
		),
		"/Users/alice/.claude-azati/plugins/data/azati-gws-mcp-azati-gws/auth.json",
	);
	assert.equal(
		authFilePath(
			"linux",
			{
				AZATI_GWS_MCP_HOME: "/explicit/token-directory",
				AZATI_GWS_MCP_CLIENT: "codex-plugin",
				CODEX_HOME: "/ignored/codex-home",
			},
			"/home/alice",
		),
		"/explicit/token-directory/auth.json",
	);
	assert.equal(
		authFilePath(
			"darwin",
			{
				AZATI_GWS_MCP_CLIENT: "codex-plugin",
				CODEX_HOME: "/Users/alice/.codex-azati",
			},
			"/Users/alice",
		),
		"/Users/alice/.codex-azati/plugins/data/azati-gws-mcp-azati-gws/auth.json",
	);
	assert.equal(
		authFilePath(
			"win32",
			{
				AZATI_GWS_MCP_CLIENT: "codex-plugin",
				CODEX_HOME: "C:\\Users\\alice\\.codex-azati",
			},
			"C:\\Users\\alice",
		),
		"C:\\Users\\alice\\.codex-azati\\plugins\\data\\azati-gws-mcp-azati-gws\\auth.json",
	);
	assert.equal(
		authFilePath(
			"linux",
			{ AZATI_GWS_MCP_CLIENT: "codex-plugin" },
			"/home/alice",
		),
		"/home/alice/.codex/plugins/data/azati-gws-mcp-azati-gws/auth.json",
	);
	assert.equal(
		authFilePath(
			"linux",
			{ CLAUDE_CONFIG_DIR: "/home/alice/.claude-azati" },
			"/home/alice",
		),
		"/home/alice/.claude-azati/plugins/data/azati-gws-mcp-azati-gws/auth.json",
	);
	assert.equal(
		configDirectory("linux", {}, "/home/alice"),
		"/home/alice/.local/share/azati-gws-mcp",
	);
	assert.equal(
		configDirectory(
			"linux",
			{ XDG_DATA_HOME: "/home/alice/.data" },
			"/home/alice",
		),
		"/home/alice/.data/azati-gws-mcp",
	);
	assert.equal(
		configDirectory("darwin", {}, "/Users/alice"),
		"/Users/alice/Library/Application Support/azati-gws-mcp",
	);
	assert.equal(
		configDirectory(
			"win32",
			{ LOCALAPPDATA: "C:\\Users\\alice\\AppData\\Local" },
			"C:\\Users\\alice",
		),
		"C:\\Users\\alice\\AppData\\Local\\azati-gws-mcp",
	);
	assert.equal(
		configDirectory(
			"darwin",
			{
				CLAUDE_PLUGIN_DATA: "/Users/alice/.claude-azati/plugins/data/workspace",
			},
			"/Users/alice",
		),
		"/Users/alice/.claude-azati/plugins/data/workspace",
	);
	assert.equal(
		configDirectory(
			"linux",
			{ PLUGIN_DATA: "/home/alice/.codex/plugins/data/workspace" },
			"/home/alice",
		),
		"/home/alice/.codex/plugins/data/workspace",
	);
});

test("saves only the refresh token metadata and loads it back", async () => {
	const directory = await mkdtemp(join(tmpdir(), "azati-mcp-token-"));
	const path = join(directory, "nested", "auth.json");
	const token = {
		refreshToken: "refresh-test-value",
		accessToken: "must-not-be-written",
		email: "alice@azati.com",
		scopes: ["scope-a"],
	};

	await saveToken(token, path);
	assert.deepEqual(await loadToken(path), {
		version: 1,
		refreshToken: "refresh-test-value",
		email: "alice@azati.com",
		scopes: ["scope-a"],
	});
	assert.doesNotMatch(await readFile(path, "utf8"), /must-not-be-written/);

	if (process.platform !== "win32") {
		assert.equal((await stat(path)).mode & 0o777, 0o600);
		assert.equal((await stat(join(directory, "nested"))).mode & 0o777, 0o700);
	}
});

test("rejects malformed and non-Azati saved tokens", async () => {
	const directory = await mkdtemp(join(tmpdir(), "azati-mcp-invalid-"));
	const path = join(directory, "auth.json");
	await saveToken(
		{ refreshToken: "refresh", email: "outsider@example.com", scopes: [] },
		path,
	);
	await assert.rejects(loadToken(path), /invalid format/);
});

test("PKCE challenge is SHA-256 of a high-entropy verifier", () => {
	const { verifier, challenge } = createPkce();
	assert.match(verifier, /^[A-Za-z0-9_-]{64}$/);
	assert.equal(
		challenge,
		createHash("sha256").update(verifier).digest().toString("base64url"),
	);
	assert.notEqual(createPkce().verifier, verifier);
});

test("OAuth scopes enable every currently exposed Workspace feature", () => {
	assert.ok(SCOPES.includes("openid"));
	assert.ok(SCOPES.includes("email"));
	for (const scope of [
		"https://www.googleapis.com/auth/userinfo.profile",
		"https://www.googleapis.com/auth/gmail.modify",
		"https://www.googleapis.com/auth/drive.file",
		"https://www.googleapis.com/auth/calendar.events",
		"https://www.googleapis.com/auth/chat.spaces.readonly",
		"https://www.googleapis.com/auth/chat.memberships.readonly",
		"https://www.googleapis.com/auth/chat.messages.readonly",
		"https://www.googleapis.com/auth/chat.messages.create",
		"https://www.googleapis.com/auth/chat.users.readstate.readonly",
		"https://www.googleapis.com/auth/directory.readonly",
		"https://www.googleapis.com/auth/contacts.readonly",
		"https://www.googleapis.com/auth/documents",
		"https://www.googleapis.com/auth/spreadsheets",
		"https://www.googleapis.com/auth/presentations",
	]) {
		assert.ok(SCOPES.includes(scope), `missing OAuth scope: ${scope}`);
	}
});

test("allowlist covers all 48 current tools across nine services", () => {
	assert.deepEqual(Object.keys(SERVICES).sort(), [
		"calendar",
		"chat",
		"docs",
		"drive",
		"gmail",
		"people",
		"sheets",
		"slides",
		"workspace",
	]);
	const names = Object.values(SERVICES).flatMap((service) => service.tools);
	assert.equal(names.length, 48);
	assert.equal(Object.values(WORKSPACE_TOOLS).flat().length, 48);
	assert.equal(new Set(names).size, 48);
});

test("explicit allowlist accepts read and write tools but rejects unlisted tools", () => {
	assert.equal(
		allowedTool("gmail", {
			name: "search_threads",
			annotations: { readOnlyHint: true },
		}),
		true,
	);
	assert.equal(
		allowedTool("gmail", {
			name: "create_draft",
			annotations: { readOnlyHint: false },
		}),
		true,
	);
	assert.equal(
		allowedTool("chat", {
			name: "send_message",
			annotations: { readOnlyHint: false },
		}),
		true,
	);
	assert.equal(
		allowedTool("calendar", {
			name: "delete_event",
			annotations: { destructiveHint: true },
		}),
		true,
	);
	assert.equal(
		allowedTool("gmail", {
			name: "unknown_future_tool",
			annotations: { readOnlyHint: true },
		}),
		false,
	);
});

test("accepts only a verified Azati Google identity", async () => {
	const originalFetch = globalThis.fetch;
	const calls = [];
	try {
		globalThis.fetch = async (url, options) => {
			calls.push({ url, options });
			return Response.json({
				email: "Alice@Azati.com",
				email_verified: true,
				hd: "azati.com",
			});
		};
		assert.equal(await verifyAzatiUser("access-test"), "alice@azati.com");
		assert.equal(
			calls[0].url,
			"https://openidconnect.googleapis.com/v1/userinfo",
		);
		assert.equal(calls[0].options.headers.authorization, "Bearer access-test");

		for (const user of [
			{ email: "alice@example.com", email_verified: true, hd: "example.com" },
			{ email: "alice@azati.com", email_verified: false, hd: "azati.com" },
			{ email: "alice@azati.com", email_verified: true, hd: "example.com" },
		]) {
			globalThis.fetch = async () => Response.json(user);
			await assert.rejects(
				verifyAzatiUser("access-test"),
				/restricted to a verified @azati\.com account/,
			);
		}
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("profile authentication reuses a valid saved token", async () => {
	let browserFlows = 0;
	const email = await authenticateProfile({
		loadSavedToken: async () => ({
			email: "alice@azati.com",
			refreshToken: "refresh",
			scopes: [],
		}),
		validateAccessToken: async () => "access",
		beginAuthentication: async () => {
			browserFlows += 1;
			return "alice@azati.com";
		},
	});
	assert.equal(email, "alice@azati.com");
	assert.equal(browserFlows, 0);
});

test("profile authentication starts one browser flow for missing or rejected tokens", async () => {
	let missingFlows = 0;
	let releaseMissing;
	const missingFlow = new Promise((resolvePromise) => {
		releaseMissing = resolvePromise;
	});
	const missingOptions = {
		loadSavedToken: async () => null,
		beginAuthentication: async () => {
			missingFlows += 1;
			return missingFlow;
		},
	};
	const first = authenticateProfile(missingOptions);
	const second = authenticateProfile(missingOptions);
	assert.equal(first, second);
	await Promise.resolve();
	assert.equal(missingFlows, 1);
	releaseMissing("alice@azati.com");
	assert.equal(await first, "alice@azati.com");

	let rejectedFlows = 0;
	assert.equal(
		await authenticateProfile({
			loadSavedToken: async () => ({
				email: "alice@azati.com",
				refreshToken: "revoked",
				scopes: [],
			}),
			validateAccessToken: async () => {
				throw new Error("invalid_grant");
			},
			beginAuthentication: async () => {
				rejectedFlows += 1;
				return "alice@azati.com";
			},
		}),
		"alice@azati.com",
	);
	assert.equal(rejectedFlows, 1);
});

test("direct auth mode prints only the verified account result", async () => {
	const previousHome = process.env.AZATI_GWS_MCP_HOME;
	const directory = await mkdtemp(join(tmpdir(), "azati-mcp-auth-command-"));
	const originalFetch = globalThis.fetch;
	let output = "";
	try {
		process.env.AZATI_GWS_MCP_HOME = directory;
		await saveToken(
			{
				refreshToken: "refresh-command",
				email: "alice@azati.com",
				scopes: SCOPES,
			},
			join(directory, "auth.json"),
		);
		globalThis.fetch = async (url) => {
			assert.equal(url, "https://oauth2.googleapis.com/token");
			return Response.json({
				access_token: "access-command",
				expires_in: 3600,
			});
		};
		await runAuth({
			write(chunk) {
				output += chunk;
			},
		});
		assert.equal(output, "Authenticated as alice@azati.com.\n");
	} finally {
		globalThis.fetch = originalFetch;
		if (previousHome === undefined) delete process.env.AZATI_GWS_MCP_HOME;
		else process.env.AZATI_GWS_MCP_HOME = previousHome;
	}
});

test("unknown and Jira tools fail before any remote request", async () => {
	const originalFetch = globalThis.fetch;
	let requests = 0;
	globalThis.fetch = async () => {
		requests += 1;
		throw new Error("unexpected request");
	};
	try {
		await assert.rejects(
			callTool("gmail_unknown_future_tool", {}),
			/Unknown or disallowed tool/,
		);
		await assert.rejects(
			callTool("jira_search", {}),
			/Unknown or disallowed tool/,
		);
		assert.equal(requests, 0);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("parses JSON and SSE MCP responses", () => {
	const json = { jsonrpc: "2.0", id: 7, result: { tools: [] } };
	assert.deepEqual(
		parseRemoteResponse(JSON.stringify(json), "application/json", 7),
		json,
	);

	const sse = [
		": keepalive",
		"",
		"event: message",
		'data: {"jsonrpc":"2.0","id":6,"result":{"ignored":true}}',
		"",
		"event: message",
		'data: {"jsonrpc":"2.0","id":7,',
		'data: "result":{"ok":true}}',
		"",
		"data: [DONE]",
		"",
	].join("\n");
	assert.deepEqual(parseRemoteResponse(sse, "text/event-stream", 7), {
		jsonrpc: "2.0",
		id: 7,
		result: { ok: true },
	});
});

test("handles MCP initialize, ping, and unknown methods", async () => {
	const initialized = await handleMessage({
		jsonrpc: "2.0",
		id: 1,
		method: "initialize",
		params: {},
	});
	assert.equal(initialized.result.serverInfo.name, "azati-gws-mcp");
	assert.equal(initialized.result.serverInfo.version, "0.1.0");
	assert.equal(initialized.result.capabilities.tools.listChanged, false);
	assert.equal(initialized.result.instructions, SERVER_INSTRUCTIONS);
	assert.match(
		initialized.result.instructions.slice(0, 512),
		/user's Azati account/,
	);
	assert.match(initialized.result.instructions.slice(0, 512), /without asking/);

	assert.deepEqual(
		await handleMessage({ jsonrpc: "2.0", id: 2, method: "ping" }),
		{ jsonrpc: "2.0", id: 2, result: {} },
	);
	assert.equal(
		(await handleMessage({ jsonrpc: "2.0", id: 3, method: "resources/list" }))
			.error.code,
		-32601,
	);
});

test("tool discovery is anonymous and exposes authentication plus all 48 tools", async () => {
	const calls = [];
	const tools = await listTools(async (serviceName, authenticated) => {
		calls.push({ serviceName, authenticated });
		return SERVICES[serviceName].tools.map((name) => ({
			name,
			description: `${serviceName} ${name}`,
			inputSchema: { type: "object" },
		}));
	});

	assert.equal(tools.length, 49);
	assert.deepEqual(tools[0], AUTHENTICATE_TOOL);
	assert.equal(tools.filter((tool) => tool.name === "authenticate").length, 1);
	assert.ok(tools.some((tool) => tool.name === "chat_search_conversations"));
	assert.ok(tools.some((tool) => tool.name === "calendar_create_event"));
	assert.deepEqual(
		calls.map((call) => call.serviceName).sort(),
		Object.keys(SERVICES).sort(),
	);
	assert.ok(calls.every((call) => call.authenticated === false));
});

test("authentication tool keeps stdout as JSON-RPC and returns the verified account", async () => {
	const input = [
		JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
		JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
		JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
		JSON.stringify({
			jsonrpc: "2.0",
			id: 3,
			method: "tools/call",
			params: { name: "authenticate", arguments: {} },
		}),
		"",
	].join("\n");
	let output = "";
	let authStarts = 0;
	await runStdio(
		Readable.from([input]),
		{
			write(chunk) {
				output += chunk;
			},
		},
		{
			authenticateUser: async () => {
				authStarts += 1;
				return "alice@azati.com";
			},
			listRemoteTools: async (serviceName) => {
				return SERVICES[serviceName].tools.map((name) => ({
					name,
					inputSchema: { type: "object" },
				}));
			},
		},
	);

	const messages = output.trim().split(/\r?\n/).map(JSON.parse);
	const byId = new Map(
		messages
			.filter((message) => message.id !== undefined)
			.map((message) => [message.id, message]),
	);
	assert.equal(byId.get(1).result.serverInfo.name, "azati-gws-mcp");
	assert.equal(byId.get(2).result.tools.length, 49);
	assert.deepEqual(byId.get(3).result, {
		content: [{ type: "text", text: "Authenticated as alice@azati.com." }],
		structuredContent: { email: "alice@azati.com" },
	});
	assert.equal(authStarts, 1);
	assert.equal(
		messages.some((message) => message.method),
		false,
	);
});

test("authentication tool call remains active until OAuth completes", async () => {
	const input = [
		JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
		JSON.stringify({
			jsonrpc: "2.0",
			id: 2,
			method: "tools/call",
			params: { name: "authenticate", arguments: {} },
		}),
		"",
	].join("\n");
	let output = "";
	let finishAuthentication;
	const authentication = new Promise((resolvePromise) => {
		finishAuthentication = resolvePromise;
	});
	const running = runStdio(
		Readable.from([input]),
		{
			write(chunk) {
				output += chunk;
			},
		},
		{
			authenticateUser: async () => authentication,
		},
	);

	await new Promise((resolvePromise) => setImmediate(resolvePromise));
	const pendingMessages = output
		.trim()
		.split(/\r?\n/)
		.filter(Boolean)
		.map(JSON.parse);
	assert.ok(pendingMessages.some((message) => message.id === 1));
	assert.equal(
		pendingMessages.some((message) => message.id === 2),
		false,
	);

	finishAuthentication("alice@azati.com");
	await running;
	const completed = output.trim().split(/\r?\n/).map(JSON.parse);
	assert.equal(
		completed.find((message) => message.id === 2).result.structuredContent
			.email,
		"alice@azati.com",
	);
});

test("Workspace tools request explicit authentication without opening a browser", async () => {
	const previousHome = process.env.AZATI_GWS_MCP_HOME;
	const directory = await mkdtemp(join(tmpdir(), "azati-mcp-explicit-auth-"));
	const originalFetch = globalThis.fetch;
	let requests = 0;
	try {
		process.env.AZATI_GWS_MCP_HOME = directory;
		globalThis.fetch = async () => {
			requests += 1;
			throw new Error("unexpected request");
		};
		await assert.rejects(
			callTool("chat_search_conversations", {}),
			/approve the authenticate tool/,
		);
		assert.equal(requests, 0);
	} finally {
		globalThis.fetch = originalFetch;
		if (previousHome === undefined) delete process.env.AZATI_GWS_MCP_HOME;
		else process.env.AZATI_GWS_MCP_HOME = previousHome;
	}
});

test("Claude plugin provides a deterministic namespaced auth command", async () => {
	const command = await readFile(
		"plugins/azati-gws-mcp/commands/auth.md",
		"utf8",
	);
	assert.match(command, /disable-model-invocation: true/);
	assert.match(command, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/server\.mjs" auth/);
	assert.doesNotMatch(command, /gcloud/i);
});
