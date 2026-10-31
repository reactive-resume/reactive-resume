import { oauthProviderAuthServerMetadata, oauthProviderOpenIdConfigMetadata } from "@better-auth/oauth-provider";
import { auth } from "@reactive-resume/auth/config";
import { env } from "@reactive-resume/env/server";
import { buildMcpServerCard } from "@reactive-resume/mcp/server-card";
import { appVersion } from "../app-version";

const DOCS_URL = "https://docs.rxresu.me";

export const handleOAuthAuthorizationServer = oauthProviderAuthServerMetadata(auth);
export const handleOpenIdConfiguration = oauthProviderOpenIdConfigMetadata(auth);

function appUrl() {
	return env.APP_URL.replace(/\/+$/, "");
}

function authorizationServer() {
	return `${appUrl()}/api/auth`;
}

export function handleOpenAiAppsChallenge() {
	if (!env.OPENAI_APPS_CHALLENGE_TOKEN) return new Response("Not Found", { status: 404 });
	return new Response(env.OPENAI_APPS_CHALLENGE_TOKEN, {
		headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
	});
}

/** Nothing else is published under /.well-known, and a 404 says so; a 200 body would be parsed as the document asked for. */
export function handleWellKnownFallback() {
	return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

/**
 * Agentic Resource Discovery catalog (https://agenticresourcediscovery.org/spec/), so agent registries can find the MCP
 * server by what it does. Served at /.well-known/ard.json and at the spec's earlier path, /.well-known/ai-catalog.json,
 * which Lighthouse's agentic browsing audit reads; `specVersion` and `host` belong to that earlier format.
 */
export function handleAgentCatalog() {
	const baseUrl = appUrl();
	const catalog = {
		specVersion: "1.0",
		host: { displayName: "Reactive Resume", documentationUrl: DOCS_URL, logoUrl: `${baseUrl}/pwa-512x512.png` },
		entries: [
			{
				identifier: `urn:air:${new URL(baseUrl).hostname}:mcp:reactive-resume`,
				displayName: "Reactive Resume MCP server",
				type: "application/mcp-server-card+json",
				url: `${baseUrl}/.well-known/mcp/server-card.json`,
				description:
					"Reads and edits the user's resumes, cover letters and job applications in Reactive Resume, a free and open-source resume builder.",
				tags: ["resume", "cover letter", "job applications", "careers"],
				representativeQueries: [
					"update my resume with my new job",
					"tailor my resume to this job description",
					"write a cover letter for this application",
					"track the jobs I have applied to",
				],
			},
		],
	};

	return Response.json(catalog, {
		headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
	});
}

export function handleMcpServerCard() {
	const card = buildMcpServerCard(appVersion);

	return Response.json(
		{
			...card,
			url: `${appUrl()}/mcp`,
			authentication: { ...card.authentication, type: "oauth2", authorization_server: authorizationServer() },
		},
		{
			headers: {
				"Content-Type": "application/json",
				"Cache-Control": "public, max-age=60, stale-while-revalidate=120",
			},
		},
	);
}

export function handleOAuthProtectedResource() {
	const metadata = {
		resource: env.APP_URL,
		bearer_methods_supported: ["header"],
		authorization_servers: [authorizationServer()],
	};

	return Response.json(metadata, {
		headers: {
			"Content-Type": "application/json",
			"Cache-Control": "public, max-age=15, stale-while-revalidate=15, stale-if-error=86400",
		},
	});
}

/** integrations.sh discovery document (v3): every agent-facing surface of this instance and how it authenticates. */
function buildIntegrations() {
	const baseUrl = appUrl();
	const basis = { via: "declared", source: `${baseUrl}/.well-known/integrations.json` } as const;
	const apiKey = {
		id: "api-key",
		mechanics: { source: "http", in: "header", headerName: "x-api-key" },
	} as const;

	return {
		version: 3,
		summary:
			"Reactive Resume is a free and open-source resume builder. Agents can read and edit a user's resumes, cover letters and job applications through the REST API or the MCP server.",
		credentials: {
			"api-key": {
				type: "api_key",
				label: "Reactive Resume API key",
				generateUrl: `${baseUrl}/dashboard/settings/ai`,
				setup: [
					"Open **Settings → AI & developer**, select **New key** in the **API keys** section, name it, choose when it expires, then copy it.",
					"The key is shown only once and acts as you: anyone holding it can read and edit your documents. Revoke it from the same table when you no longer need it.",
					"Send it in the `x-api-key` header.",
				].join("\n\n"),
			},
			oauth: {
				type: "oauth2",
				label: "Reactive Resume OAuth",
				setup: [
					`OAuth authorization-code flow with dynamic client registration (RFC 7591). Clients discover the authorization server from \`${baseUrl}/.well-known/oauth-protected-resource\` (issuer \`${authorizationServer()}\`).`,
					`Send \`resource=${baseUrl}\` on authorization, token exchange and refresh requests (RFC 8707). Authorization without a resource is refused with invalid_target.`,
					"The user signs in to a permanent Reactive Resume account and approves the client on the consent screen; guest accounts cannot connect apps. Send the resulting access token as `Authorization: Bearer <token>`.",
				].join("\n\n"),
			},
		},
		surfaces: [
			{
				type: "http",
				slug: "reactive-resume-api",
				name: "Reactive Resume REST API",
				docs: `${DOCS_URL}/guides/using-the-api`,
				basis,
				spec: `${baseUrl}/openapi.json`,
				url: `${baseUrl}/api/openapi`,
				auth: {
					status: "required",
					entries: [
						{ use: [apiKey], basis },
						{
							use: [
								{
									id: "oauth",
									mechanics: { source: "http", in: "header", headerName: "Authorization", scheme: "Bearer" },
								},
							],
							basis,
						},
					],
				},
			},
			{
				type: "mcp",
				slug: "reactive-resume-mcp",
				name: "Reactive Resume MCP server",
				docs: `${DOCS_URL}/guides/using-the-mcp-server`,
				basis,
				url: `${baseUrl}/mcp`,
				transports: ["streamable-http"],
				auth: {
					status: "required",
					entries: [
						{ use: [{ id: "oauth", mechanics: { source: "well-known" } }], basis },
						{ use: [apiKey], basis },
					],
				},
			},
		],
	};
}

export function handleIntegrations() {
	return Response.json(buildIntegrations(), {
		headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
	});
}

/** RFC 9727 API catalog: the REST API and MCP server, each with its description and documentation. */
export function handleApiCatalog() {
	const baseUrl = appUrl();
	const linkset = {
		linkset: [
			{
				anchor: `${baseUrl}/api/openapi`,
				"service-desc": [{ href: `${baseUrl}/openapi.json`, type: "application/vnd.oai.openapi+json" }],
				"service-doc": [{ href: `${DOCS_URL}/guides/using-the-api`, type: "text/html" }],
				status: [{ href: `${baseUrl}/api/health`, type: "application/json" }],
			},
			{
				anchor: `${baseUrl}/mcp`,
				"service-desc": [{ href: `${baseUrl}/.well-known/mcp/server-card.json`, type: "application/json" }],
				"service-doc": [{ href: `${DOCS_URL}/guides/using-the-mcp-server`, type: "text/html" }],
			},
		],
	};

	return new Response(JSON.stringify(linkset), {
		headers: {
			"Content-Type": 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
			"Cache-Control": "public, max-age=3600",
			Link: `<${baseUrl}/.well-known/api-catalog>; rel="api-catalog"`,
		},
	});
}
