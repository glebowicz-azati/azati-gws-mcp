#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { homedir } from "node:os";
import {
	dirname,
	join,
	posix as posixPath,
	win32 as win32Path,
} from "node:path";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

export const GOOGLE_CLIENT_ID =
	"555554458109-9lf76hfl2q2us8auei7ijpqhotqek2sp.apps.googleusercontent.com";
// Google requires this value during token exchange, but Desktop-app clients
// cannot keep it confidential. PKCE protects each authorization code instead.
export const GOOGLE_CLIENT_SECRET = "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";

export const SCOPES = Object.freeze([
	"openid",
	"email",
	"https://www.googleapis.com/auth/userinfo.profile",
	"https://www.googleapis.com/auth/gmail.modify",
	"https://www.googleapis.com/auth/gmail.readonly",
	"https://www.googleapis.com/auth/drive.readonly",
	"https://www.googleapis.com/auth/drive.file",
	"https://www.googleapis.com/auth/calendar.readonly",
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
]);

export const SERVICES = Object.freeze({
	gmail: {
		endpoint: "https://gmailmcp.googleapis.com/mcp/v1",
		tools: [
			"create_draft",
			"list_drafts",
			"get_thread",
			"get_message",
			"search_threads",
			"label_thread",
			"unlabel_thread",
			"apply_sensitive_thread_label",
			"list_labels",
			"label_message",
			"unlabel_message",
			"apply_sensitive_message_label",
			"create_label",
		],
	},
	drive: {
		endpoint: "https://drivemcp.googleapis.com/mcp/v1",
		tools: [
			"copy_file",
			"create_file",
			"download_file_content",
			"get_file_metadata",
			"get_file_permissions",
			"list_recent_files",
			"read_file_content",
			"search_files",
		],
	},
	calendar: {
		endpoint: "https://calendarmcp.googleapis.com/mcp/v1",
		tools: [
			"list_events",
			"get_event",
			"list_calendars",
			"suggest_time",
			"create_event",
			"update_event",
			"delete_event",
			"respond_to_event",
			"search_events",
		],
	},
	chat: {
		endpoint: "https://chatmcp.googleapis.com/mcp/v1",
		tools: [
			"list_messages",
			"search_messages",
			"search_conversations",
			"send_message",
		],
	},
	people: {
		endpoint: "https://people.googleapis.com/mcp/v1",
		tools: ["search_directory_people", "search_contacts", "get_user_profile"],
	},
	docs: {
		endpoint: "https://docsmcp.googleapis.com/mcp/v1",
		tools: ["read_doc", "update_doc"],
	},
	sheets: {
		endpoint: "https://sheetsmcp.googleapis.com/mcp/v1",
		tools: [
			"get_values",
			"get_spreadsheet",
			"update_spreadsheet",
			"update_values",
			"update_formulas",
			"insert_dimension",
		],
	},
	slides: {
		endpoint: "https://slidesmcp.googleapis.com/mcp/v1",
		tools: ["read_presentation", "update_presentation"],
	},
	workspace: {
		endpoint: "https://workspacemcp.googleapis.com/mcp/v1",
		tools: ["search_corpus"],
	},
});

export const WORKSPACE_TOOLS = Object.freeze(
	Object.fromEntries(
		Object.entries(SERVICES).map(([service, definition]) => [
			service,
			Object.freeze([...definition.tools]),
		]),
	),
);

const TOKEN_VERSION = 1;
const TOOLS_CACHE_VERSION = 1;
export const SERVER_VERSION = "0.2.0";
const PROTOCOL_VERSION = "2025-06-18";
export const TOOLS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const TOOLS_CACHE_MAX_BYTES = 5 * 1024 * 1024;
const OAUTH_TIMEOUT_MS = 3 * 60 * 1000;
const CODEX_PLUGIN_DATA_DIRECTORY = "azati-gws-mcp-azati-gws";
const AUTHENTICATION_REQUIRED =
	"Azati Google Workspace authentication is required. Ask the user to approve the authenticate tool; do not use gcloud or another login method.";
export const SERVER_INSTRUCTIONS =
	"When attached, treat unqualified mentions of Gmail or email, Google Drive or files, Calendar or meetings, Google Chat or chats, Contacts or people, Docs, Sheets, Slides, or Google Workspace as requests about the user's Azati account. Use these MCP tools without asking whether the user means public Google product information. Only use web or general knowledge when explicitly asked about public news, product documentation, or Google itself. For \"what's new in Google Chat,\" search the user's recent Azati Chat conversations and messages and summarize them. Always call the requested Workspace tool first. Never call authenticate proactively or merely because a Google Workspace tool will be used. Only if the requested Workspace tool returns \"Azati Google Workspace authentication is required\" should you ask the user to approve authenticate. A successful Workspace tool call means authentication is already valid and must not be mentioned. If the user explicitly asks to authenticate, call authenticate without first provoking an error. Authenticate reuses valid saved credentials and opens Google OAuth only when credentials are missing, rejected, or revoked. Never use gcloud or another login method. Clarify only when missing details could change a write, send, or delete action.";
export const AUTHENTICATE_TOOL = Object.freeze({
	name: "authenticate",
	title: "Authenticate Azati Google Workspace",
	description:
		"Validate or establish access to the user's @azati.com Google Workspace account. Call this only when the user explicitly asks to authenticate, or after a requested Workspace tool returns \"Azati Google Workspace authentication is required\" and the user approves authentication. Never call it proactively or merely because a Workspace tool will be used. It reuses valid saved credentials without opening a browser and opens Google OAuth only when credentials are missing, rejected, or revoked. Never use gcloud.",
	inputSchema: {
		type: "object",
		properties: {},
		additionalProperties: false,
	},
	annotations: {
		readOnlyHint: false,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: true,
	},
});
const sessionIds = new Map();
const remoteProtocolVersions = new Map();
const persistentToolsCaches = new Map();
let nextRemoteId = 1;
let memoryAccessToken = null;
let memoryAccessTokenExpiresAt = 0;
let authenticationPromise = null;

export function configDirectory(
	platform = process.platform,
	env = process.env,
	home = homedir(),
) {
	const path = platform === "win32" ? win32Path : posixPath;
	if (env.AZATI_GWS_MCP_HOME) {
		return env.AZATI_GWS_MCP_HOME;
	}
	if (env.CLAUDE_PLUGIN_DATA) {
		return env.CLAUDE_PLUGIN_DATA;
	}
	if (env.PLUGIN_DATA) {
		return env.PLUGIN_DATA;
	}
	if (env.AZATI_GWS_MCP_CLIENT === "codex-plugin") {
		const codexHome = env.CODEX_HOME || path.join(home, ".codex");
		return path.join(codexHome, "plugins", "data", CODEX_PLUGIN_DATA_DIRECTORY);
	}
	if (env.CLAUDE_CONFIG_DIR) {
		return path.join(
			env.CLAUDE_CONFIG_DIR,
			"plugins",
			"data",
			CODEX_PLUGIN_DATA_DIRECTORY,
		);
	}
	if (env.CODEX_HOME) {
		return path.join(
			env.CODEX_HOME,
			"plugins",
			"data",
			CODEX_PLUGIN_DATA_DIRECTORY,
		);
	}
	if (platform === "win32") {
		return path.join(
			env.LOCALAPPDATA || path.join(home, "AppData", "Local"),
			"azati-gws-mcp",
		);
	}
	if (platform === "darwin") {
		return path.join(home, "Library", "Application Support", "azati-gws-mcp");
	}
	return path.join(
		env.XDG_DATA_HOME || path.join(home, ".local", "share"),
		"azati-gws-mcp",
	);
}

export function authFilePath(
	platform = process.platform,
	env = process.env,
	home = homedir(),
) {
	const path = configDirectory(platform, env, home);
	return platform === "win32"
		? win32Path.join(path, "auth.json")
		: posixPath.join(path, "auth.json");
}

export function toolsCacheFilePath(
	platform = process.platform,
	env = process.env,
	home = homedir(),
) {
	const path = configDirectory(platform, env, home);
	return platform === "win32"
		? win32Path.join(path, "tools-cache.json")
		: posixPath.join(path, "tools-cache.json");
}

function parseSavedToken(contents) {
	const token = JSON.parse(contents);
	if (
		token.version !== TOKEN_VERSION ||
		typeof token.refreshToken !== "string" ||
		!token.email?.toLowerCase().endsWith("@azati.com") ||
		!Array.isArray(token.scopes)
	) {
		throw new Error("The saved Google token has an invalid format.");
	}
	return token;
}

export async function loadToken(path = authFilePath()) {
	try {
		return parseSavedToken(await readFile(path, "utf8"));
	} catch (error) {
		if (error?.code === "ENOENT") return null;
		throw error;
	}
}

export async function saveToken(token, path = authFilePath()) {
	const directory = dirname(path);
	await mkdir(directory, { recursive: true, mode: 0o700 });
	if (process.platform !== "win32") await chmod(directory, 0o700);

	const temporary = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
	const contents = `${JSON.stringify(
		{
			version: TOKEN_VERSION,
			refreshToken: token.refreshToken,
			email: token.email,
			scopes: token.scopes,
		},
		null,
		2,
	)}\n`;
	await writeFile(temporary, contents, {
		encoding: "utf8",
		mode: 0o600,
		flag: "wx",
	});
	await rename(temporary, path);
	if (process.platform !== "win32") await chmod(path, 0o600);
}

function validToolDefinition(tool) {
	return (
		tool !== null &&
		typeof tool === "object" &&
		typeof tool.name === "string" &&
		tool.inputSchema !== null &&
		typeof tool.inputSchema === "object"
	);
}

function parseToolsCache(contents) {
	if (Buffer.byteLength(contents) > TOOLS_CACHE_MAX_BYTES) return null;
	const parsed = JSON.parse(contents);
	if (
		parsed?.version !== TOOLS_CACHE_VERSION ||
		parsed?.pluginVersion !== SERVER_VERSION ||
		parsed?.protocolVersion !== PROTOCOL_VERSION ||
		parsed?.services === null ||
		typeof parsed?.services !== "object"
	) {
		return null;
	}

	const services = {};
	for (const [serviceName, entry] of Object.entries(parsed.services)) {
		if (
			!SERVICES[serviceName] ||
			typeof entry?.fetchedAt !== "string" ||
			!Number.isFinite(Date.parse(entry.fetchedAt)) ||
			!Array.isArray(entry.tools)
		) {
			continue;
		}
		services[serviceName] = {
			fetchedAt: entry.fetchedAt,
			tools: entry.tools
				.filter(validToolDefinition)
				.filter((tool) => allowedTool(serviceName, tool)),
		};
	}

	return {
		version: TOOLS_CACHE_VERSION,
		pluginVersion: SERVER_VERSION,
		protocolVersion: PROTOCOL_VERSION,
		services,
	};
}

export async function loadToolsCache(path = toolsCacheFilePath()) {
	try {
		return parseToolsCache(await readFile(path, "utf8"));
	} catch {
		return null;
	}
}

export async function saveToolsCache(cache, path = toolsCacheFilePath()) {
	const directory = dirname(path);
	await mkdir(directory, { recursive: true, mode: 0o700 });
	if (process.platform !== "win32") await chmod(directory, 0o700);

	const temporary = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
	await writeFile(temporary, `${JSON.stringify(cache, null, 2)}\n`, {
		encoding: "utf8",
		mode: 0o600,
		flag: "wx",
	});
	await rename(temporary, path);
	if (process.platform !== "win32") await chmod(path, 0o600);
}

export function createToolsCache({
	path = toolsCacheFilePath(),
	ttlMs = TOOLS_CACHE_TTL_MS,
	now = () => Date.now(),
	loadCache = loadToolsCache,
	saveCache = saveToolsCache,
} = {}) {
	let statePromise;
	let writePromise = Promise.resolve();

	async function state() {
		if (!statePromise) {
			statePromise = (async () =>
				(await loadCache(path)) || {
					version: TOOLS_CACHE_VERSION,
					pluginVersion: SERVER_VERSION,
					protocolVersion: PROTOCOL_VERSION,
					services: {},
				})();
		}
		return statePromise;
	}

	function persist(cache) {
		const snapshot = {
			...cache,
			services: Object.fromEntries(
				Object.entries(cache.services).map(([serviceName, entry]) => [
					serviceName,
					{ ...entry, tools: [...entry.tools] },
				]),
			),
		};
		writePromise = writePromise
			.catch(() => {})
			.then(() => saveCache(snapshot, path));
		return writePromise;
	}

	return Object.freeze({
		async get(serviceName) {
			const entry = (await state()).services[serviceName];
			if (!entry) return null;
			const age = now() - Date.parse(entry.fetchedAt);
			return {
				tools: entry.tools,
				fresh: age >= 0 && age <= ttlMs,
			};
		},
		async update(updates) {
			const cache = await state();
			const fetchedAt = new Date(now()).toISOString();
			for (const [serviceName, tools] of Object.entries(updates)) {
				if (!SERVICES[serviceName] || !Array.isArray(tools)) continue;
				cache.services[serviceName] = {
					fetchedAt,
					tools: tools
						.filter(validToolDefinition)
						.filter((tool) => allowedTool(serviceName, tool)),
				};
			}
			await persist(cache);
		},
		async invalidate(serviceName) {
			const cache = await state();
			if (!Object.hasOwn(cache.services, serviceName)) return;
			delete cache.services[serviceName];
			await persist(cache);
		},
	});
}

function defaultToolsCache() {
	const path = toolsCacheFilePath();
	let cache = persistentToolsCaches.get(path);
	if (!cache) {
		cache = createToolsCache({ path });
		persistentToolsCaches.set(path, cache);
	}
	return cache;
}

function clientId() {
	if (GOOGLE_CLIENT_ID.startsWith("REPLACE_WITH_")) {
		throw new Error(
			"This build does not yet contain the Azati Google Desktop OAuth client ID.",
		);
	}
	return GOOGLE_CLIENT_ID;
}

function base64url(buffer) {
	return Buffer.from(buffer).toString("base64url");
}

export function createPkce() {
	const verifier = base64url(randomBytes(48));
	return {
		verifier,
		challenge: base64url(createHash("sha256").update(verifier).digest()),
	};
}

async function tokenRequest(parameters) {
	const response = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			...parameters,
			client_secret: GOOGLE_CLIENT_SECRET,
		}),
	});
	const body = await response.json().catch(() => ({}));
	if (!response.ok) {
		const detail = [body.error, body.error_description]
			.filter(Boolean)
			.join(": ");
		throw new Error(
			`Google OAuth failed (${response.status}): ${detail || "unknown error"}`,
		);
	}
	return body;
}

export async function verifyAzatiUser(accessToken) {
	const response = await fetch(
		"https://openidconnect.googleapis.com/v1/userinfo",
		{
			headers: { authorization: `Bearer ${accessToken}` },
		},
	);
	const user = await response.json().catch(() => ({}));
	const email = typeof user.email === "string" ? user.email.toLowerCase() : "";
	if (
		!response.ok ||
		!user.email_verified ||
		!email.endsWith("@azati.com") ||
		(user.hd && user.hd.toLowerCase() !== "azati.com")
	) {
		throw new Error(
			"Authentication is restricted to a verified @azati.com account.",
		);
	}
	return email;
}

export function openBrowser(url, platform = process.platform) {
	const command =
		platform === "darwin"
			? ["open", [url]]
			: platform === "win32"
				? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]]
				: ["xdg-open", [url]];
	const child = spawn(command[0], command[1], {
		detached: true,
		stdio: "ignore",
		windowsHide: true,
	});
	return new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("spawn", () => {
			child.unref();
			resolve();
		});
	});
}

function waitForOAuthCallback(server, expectedState) {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			server.close();
			reject(new Error("Google authentication timed out."));
		}, OAUTH_TIMEOUT_MS);

		server.on("request", (request, response) => {
			const url = new URL(request.url || "/", "http://127.0.0.1");
			if (url.pathname !== "/oauth2/callback") {
				response.writeHead(404).end("Not found");
				return;
			}
			const finish = (status, message, error) => {
				response.writeHead(status, {
					"content-type": "text/plain; charset=utf-8",
				});
				response.end(message);
				clearTimeout(timeout);
				server.close();
				error ? reject(error) : resolve(url.searchParams.get("code"));
			};
			if (url.searchParams.get("state") !== expectedState) {
				finish(
					400,
					"Authentication failed: invalid state.",
					new Error("OAuth state mismatch."),
				);
			} else if (url.searchParams.get("error")) {
				finish(
					400,
					"Authentication was not completed.",
					new Error(
						`Google authentication failed: ${url.searchParams.get("error")}`,
					),
				);
			} else if (!url.searchParams.get("code")) {
				finish(
					400,
					"Authentication failed: missing code.",
					new Error("Missing OAuth code."),
				);
			} else {
				finish(
					200,
					"Azati Google Workspace authentication completed. You can close this tab.",
				);
			}
		});
		server.on("error", reject);
	});
}

export async function authenticate() {
	const state = base64url(randomBytes(32));
	const { verifier, challenge } = createPkce();
	const server = createServer();
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	const redirectUri = `http://127.0.0.1:${address.port}/oauth2/callback`;
	const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
	authorization.search = new URLSearchParams({
		client_id: clientId(),
		redirect_uri: redirectUri,
		response_type: "code",
		scope: SCOPES.join(" "),
		access_type: "offline",
		prompt: "consent",
		code_challenge: challenge,
		code_challenge_method: "S256",
		state,
		hd: "azati.com",
	}).toString();

	try {
		await openBrowser(authorization.toString());
	} catch (error) {
		server.close();
		throw error;
	}
	const code = await waitForOAuthCallback(server, state);
	const tokens = await tokenRequest({
		client_id: clientId(),
		code,
		code_verifier: verifier,
		grant_type: "authorization_code",
		redirect_uri: redirectUri,
	});
	if (!tokens.refresh_token) {
		throw new Error(
			"Google did not return a refresh token; revoke the old grant and try again.",
		);
	}
	const email = await verifyAzatiUser(tokens.access_token);
	const scopes = (tokens.scope || SCOPES.join(" "))
		.split(/\s+/)
		.filter(Boolean);
	await saveToken({ refreshToken: tokens.refresh_token, email, scopes });
	memoryAccessToken = tokens.access_token;
	memoryAccessTokenExpiresAt =
		Date.now() + Number(tokens.expires_in || 3600) * 1000;
	sessionIds.clear();
	remoteProtocolVersions.clear();
	return email;
}

async function accessToken(forceRefresh = false) {
	if (
		!forceRefresh &&
		memoryAccessToken &&
		Date.now() < memoryAccessTokenExpiresAt - 60_000
	) {
		return memoryAccessToken;
	}
	const saved = await loadToken();
	if (!saved) return null;
	const tokens = await tokenRequest({
		client_id: clientId(),
		grant_type: "refresh_token",
		refresh_token: saved.refreshToken,
	});
	memoryAccessToken = tokens.access_token;
	memoryAccessTokenExpiresAt =
		Date.now() + Number(tokens.expires_in || 3600) * 1000;
	return memoryAccessToken;
}

export function authenticateProfile({
	loadSavedToken = loadToken,
	validateAccessToken = accessToken,
	beginAuthentication = authenticate,
} = {}) {
	if (authenticationPromise) return authenticationPromise;
	authenticationPromise = (async () => {
		const saved = await loadSavedToken();
		if (saved) {
			try {
				await validateAccessToken();
				return saved.email;
			} catch {
				// A rejected or revoked refresh token needs a new browser grant.
			}
		}
		return beginAuthentication();
	})().finally(() => {
		authenticationPromise = null;
	});
	return authenticationPromise;
}

export function parseRemoteResponse(text, contentType = "", expectedId) {
	if (!text.trim()) return null;
	if (!contentType.includes("text/event-stream")) return JSON.parse(text);

	const messages = [];
	for (const event of text.split(/\r?\n\r?\n/)) {
		const data = event
			.split(/\r?\n/)
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).trimStart())
			.join("\n");
		if (!data || data === "[DONE]") continue;
		try {
			messages.push(JSON.parse(data));
		} catch {
			// Ignore non-JSON keepalive events.
		}
	}
	return (
		messages.find((message) => message.id === expectedId) || messages[0] || null
	);
}

async function remotePost(
	serviceName,
	payload,
	{ authenticated = true, retry = true } = {},
) {
	const service = SERVICES[serviceName];
	const token = authenticated ? await accessToken() : null;
	if (authenticated && !token) throw new Error(AUTHENTICATION_REQUIRED);
	const connectionKey = `${authenticated ? "authenticated" : "anonymous"}:${serviceName}`;
	const headers = {
		accept: "application/json, text/event-stream",
		"content-type": "application/json",
		"mcp-protocol-version":
			remoteProtocolVersions.get(connectionKey) || PROTOCOL_VERSION,
	};
	if (token) headers.authorization = `Bearer ${token}`;
	const sessionId = sessionIds.get(connectionKey);
	if (sessionId) headers["mcp-session-id"] = sessionId;
	const response = await fetch(service.endpoint, {
		method: "POST",
		headers,
		body: JSON.stringify(payload),
	});
	if (response.status === 401 && authenticated && retry) {
		await accessToken(true);
		return remotePost(serviceName, payload, { authenticated, retry: false });
	}
	if (!response.ok) {
		const detail = (await response.text()).slice(0, 300);
		throw new Error(
			`Google ${serviceName} MCP failed (${response.status}): ${detail}`,
		);
	}
	const newSessionId = response.headers.get("mcp-session-id");
	if (newSessionId) sessionIds.set(connectionKey, newSessionId);
	return parseRemoteResponse(
		await response.text(),
		response.headers.get("content-type") || "",
		payload.id,
	);
}

async function ensureRemoteSession(serviceName, authenticated = true) {
	const connectionKey = `${authenticated ? "authenticated" : "anonymous"}:${serviceName}`;
	if (sessionIds.has(connectionKey)) return;
	const id = nextRemoteId++;
	const initialized = await remotePost(
		serviceName,
		{
			jsonrpc: "2.0",
			id,
			method: "initialize",
				params: {
					protocolVersion: PROTOCOL_VERSION,
					capabilities: {},
					clientInfo: { name: "azati-gws-mcp", version: SERVER_VERSION },
				},
		},
		{ authenticated },
	);
	if (initialized?.error) {
		throw new Error(
			initialized.error.message || "Remote initialization failed.",
		);
	}
	if (typeof initialized?.result?.protocolVersion === "string") {
		remoteProtocolVersions.set(
			connectionKey,
			initialized.result.protocolVersion,
		);
	}
	await remotePost(
		serviceName,
		{
			jsonrpc: "2.0",
			method: "notifications/initialized",
		},
		{ authenticated },
	);
}

async function remoteTools(serviceName, authenticated = true) {
	await ensureRemoteSession(serviceName, authenticated);
	const id = nextRemoteId++;
	const response = await remotePost(
		serviceName,
		{
			jsonrpc: "2.0",
			id,
			method: "tools/list",
			params: {},
		},
		{ authenticated },
	);
	if (response?.error)
		throw new Error(response.error.message || "Remote tools/list failed.");
	return Array.isArray(response?.result?.tools) ? response.result.tools : [];
}

export function allowedTool(serviceName, tool) {
	return SERVICES[serviceName]?.tools.includes(tool.name) === true;
}

export async function listTools(
	listRemoteTools = remoteTools,
	toolsCache = listRemoteTools === remoteTools ? defaultToolsCache() : null,
) {
	const serviceNames = Object.keys(SERVICES);
	const cached = new Map(
		await Promise.all(
			serviceNames.map(async (serviceName) => [
				serviceName,
				toolsCache ? await toolsCache.get(serviceName) : null,
			]),
		),
	);
	const listed = await Promise.allSettled(
		serviceNames.map(async (serviceName) => {
			const cachedService = cached.get(serviceName);
			if (cachedService?.fresh) {
				return { serviceName, tools: cachedService.tools, refreshed: false };
			}
			try {
				const tools = (await listRemoteTools(serviceName, false))
					.filter(validToolDefinition)
					.filter((tool) => allowedTool(serviceName, tool));
				return { serviceName, tools, refreshed: true };
			} catch (error) {
				if (cachedService) {
					return {
						serviceName,
						tools: cachedService.tools,
						refreshed: false,
					};
				}
				throw error;
			}
		}),
	);
	if (toolsCache) {
		const updates = Object.fromEntries(
			listed.flatMap((result) =>
				result.status === "fulfilled" && result.value.refreshed
					? [[result.value.serviceName, result.value.tools]]
					: [],
			),
		);
		if (Object.keys(updates).length > 0) {
			await toolsCache.update(updates).catch(() => {});
		}
	}
	return [
		AUTHENTICATE_TOOL,
		...listed.flatMap((result) =>
			result.status === "fulfilled"
				? result.value.tools.map((tool) => ({
						...tool,
						name: `${result.value.serviceName}_${tool.name}`,
					}))
				: [],
		),
	];
}

function resolveLocalTool(name) {
	for (const [serviceName, service] of Object.entries(SERVICES)) {
		const prefix = `${serviceName}_`;
		if (name.startsWith(prefix)) {
			const remoteName = name.slice(prefix.length);
			if (service.tools.includes(remoteName))
				return { serviceName, remoteName };
		}
	}
	return null;
}

async function requireAuthentication() {
	try {
		if ((await loadToken()) && (await accessToken())) return;
	} catch {
		// A missing, malformed, expired, or revoked grant requires explicit sign-in.
	}
	throw new Error(AUTHENTICATION_REQUIRED);
}

export async function callTool(
	name,
	args = {},
	{
		authenticateUser = authenticateProfile,
		requireAuthenticated = requireAuthentication,
		ensureSession = ensureRemoteSession,
		postRemote = remotePost,
		invalidateTools = (serviceName) =>
			defaultToolsCache().invalidate(serviceName),
	} = {},
) {
	if (name === AUTHENTICATE_TOOL.name) {
		const email = await authenticateUser();
		return {
			content: [{ type: "text", text: `Authenticated as ${email}.` }],
			structuredContent: { email },
		};
	}

	const target = resolveLocalTool(name);
	if (!target) throw new Error(`Unknown or disallowed tool: ${name}`);
	await requireAuthenticated();
	await ensureSession(target.serviceName);

	const id = nextRemoteId++;
	const response = await postRemote(target.serviceName, {
		jsonrpc: "2.0",
		id,
		method: "tools/call",
		params: { name: target.remoteName, arguments: args },
	});
	if (response?.error) {
		const message = response.error.message || `${name} failed.`;
		if (
			response.error.code === -32601 ||
			/\b(?:unknown|removed) tool\b|tool\b.*\bnot found\b/i.test(message)
		) {
			await invalidateTools(target.serviceName).catch(() => {});
		}
		throw new Error(message);
	}
	if (!response || !Object.hasOwn(response, "result")) {
		throw new Error(`Google returned an invalid response for ${name}.`);
	}
	return response.result;
}

export async function handleMessage(message, context = {}) {
	if (!message || message.jsonrpc !== "2.0") return null;
	if (message.method === "notifications/initialized") return null;
	if (message.id === undefined) return null;
	try {
		if (message.method === "initialize") {
			return {
				jsonrpc: "2.0",
				id: message.id,
				result: {
					protocolVersion: PROTOCOL_VERSION,
					capabilities: { tools: { listChanged: false } },
					serverInfo: { name: "azati-gws-mcp", version: SERVER_VERSION },
					instructions: SERVER_INSTRUCTIONS,
				},
			};
		}
		if (message.method === "ping") {
			return { jsonrpc: "2.0", id: message.id, result: {} };
		}
		if (message.method === "tools/list") {
			return {
				jsonrpc: "2.0",
				id: message.id,
				result: { tools: await listTools(context.listRemoteTools) },
			};
		}
		if (message.method === "tools/call") {
			const { name, arguments: args } = message.params || {};
			return {
				jsonrpc: "2.0",
				id: message.id,
				result: await callTool(name, args, {
					authenticateUser: context.authenticateUser,
				}),
			};
		}
		return {
			jsonrpc: "2.0",
			id: message.id,
			error: { code: -32601, message: `Method not found: ${message.method}` },
		};
	} catch (error) {
		return {
			jsonrpc: "2.0",
			id: message.id,
			error: {
				code: -32000,
				message: error instanceof Error ? error.message : String(error),
			},
		};
	}
}

export async function runStdio(
	input = process.stdin,
	output = process.stdout,
	context = {},
) {
	input.setEncoding("utf8");
	let buffer = "";
	const writeProtocolMessage = (message) => {
		output.write(`${JSON.stringify(message)}\n`);
	};
	const processLine = async (line) => {
		if (!line) return;
		let message;
		try {
			message = JSON.parse(line);
		} catch {
			return;
		}
		const response = await handleMessage(message, context);
		if (response) writeProtocolMessage(response);
	};
	for await (const chunk of input) {
		buffer += chunk;
		while (true) {
			const newline = buffer.indexOf("\n");
			if (newline < 0) break;
			const line = buffer.slice(0, newline).trim();
			buffer = buffer.slice(newline + 1);
			await processLine(line);
		}
	}
	await processLine(buffer.trim());
}

export async function runAuth(output = process.stdout) {
	const email = await authenticateProfile();
	output.write(`Authenticated as ${email}.\n`);
}

const isMain =
	process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
	const command = process.argv[2] || "serve";
	const operation =
		command === "serve"
			? runStdio()
			: command === "auth"
				? runAuth()
				: Promise.reject(new Error("Usage: azati-gws-mcp [auth]"));
	operation.catch((error) => {
		process.stderr.write(
			`${error instanceof Error ? error.message : String(error)}\n`,
		);
		process.exitCode = 1;
	});
}
