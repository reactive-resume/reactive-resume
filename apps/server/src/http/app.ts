import type { ReadWebFile } from "../static/web";
import type { Http2Bindings, HttpBindings } from "@hono/node-server";
import type { Context } from "hono";
import { BlockList, isIP } from "node:net";
import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { compress } from "hono/compress";
import { prepareStagedBody, withStagedBody } from "@reactive-resume/api/features/storage/transport";
import { env } from "@reactive-resume/env/server";
import { prepareMcpDiscovery } from "@reactive-resume/mcp";
import { SITE_PATH_ALIASES } from "@reactive-resume/utils/app-paths";
import { handleMcp } from "../mcp/handler";
import { handleOpenApi, handleOpenApiDocument } from "../openapi/handler";
import {
	handleAgentCatalog,
	handleApiCatalog,
	handleIntegrations,
	handleMcpServerCard,
	handleOAuthAuthorizationServer,
	handleOAuthProtectedResource,
	handleOpenIdConfiguration,
	handleOpenAiAppsChallenge,
	handleWellKnownFallback,
} from "../openapi/metadata";
import { handleRpc } from "../rpc/handler";
import { handleAgentSkillArchive, handleAgentSkillsIndex } from "../static/agent-skills";
import { handleResumeCard } from "../static/resume-card";
import { serveResumePage } from "../static/resume-page";
import { handleSchemaJson } from "../static/schema";
import { handleLlms, handlePagesSitemap, handleResumesSitemap, handleRobots, handleSitemap } from "../static/seo";
import { handleUpload } from "../static/uploads";
import { handleWebApp, isProfilePath, isPublicResumePath, serveWebDistStatic } from "../static/web";
import { handleAlias } from "./alias";
import { handleAppleAppSiteAssociation, handleAndroidAssetLinks } from "./app-links";
import { handleAuth, handleOAuth } from "./auth";
import { handleCareerJobs } from "./career-jobs";
import { handleCustomDomain, handleTraefikProvider } from "./custom-domain";
import { handleHealth } from "./health";
import { handlePublicResumePdf } from "./public-resume-pdf";
import { handleResumePdfDownload } from "./resume-pdf";

type ServerEnvironment = { Bindings: HttpBindings | Http2Bindings };

const getTrustedClient = (context: Context<ServerEnvironment>, proxies: BlockList): string => {
	try {
		const address = getConnInfo(context).remote.address?.trim();
		if (!address || !isIP(address)) return "unknown";
		const trusted = (ip: string) => proxies.check(ip, isIP(ip) === 4 ? "ipv4" : "ipv6");
		if (!trusted(address)) return address;
		const forwarded = context.req.header("x-forwarded-for");
		if (!forwarded) return address;
		const chain = forwarded.split(",").map((ip) => ip.trim());
		if (chain.some((ip) => !isIP(ip))) return address;
		let client = address;
		for (const hop of chain.reverse()) {
			if (!trusted(client)) break;
			client = hop;
		}
		return client;
	} catch {
		return "unknown";
	}
};

type AppOptions = {
	serveStatic?: boolean;
	trustedClient?: (request: Request) => string;
	readWebFile?: ReadWebFile;
};

export function createApp(options: AppOptions = {}) {
	prepareMcpDiscovery();
	const app = new Hono<ServerEnvironment>();
	const proxies = new BlockList();
	for (const range of env.TRUSTED_PROXIES) {
		const [address, prefix] = range.split("/");
		if (!address) continue;
		const family = isIP(address) === 4 ? "ipv4" : "ipv6";
		if (prefix === undefined) proxies.addAddress(address, family);
		else proxies.addSubnet(address, Number(prefix), family);
	}
	const client = (c: Context<ServerEnvironment>) => options.trustedClient?.(c.req.raw) ?? getTrustedClient(c, proxies);

	// The alias domain serves the same public pages; only the signed-in app's sections move to APP_URL.
	app.use("*", async (c, next) => handleAlias(c.req.raw) ?? (await next()));
	// A verified custom domain shows its primary resume; other hosts fall through.
	app.use("*", async (c, next) => (await handleCustomDomain(c.req.raw, client(c))) ?? next());

	app.use("/auth/*", async (c, next) => {
		await next();
		// The app shell already carries a full policy that forbids framing; only add one where it's missing.
		if (!c.res.headers.has("Content-Security-Policy")) c.header("Content-Security-Policy", "frame-ancestors 'none'");
		c.header("X-Frame-Options", "DENY");
		c.header("Referrer-Policy", "no-referrer");
		c.header("Cache-Control", "no-store");
	});

	// Caps every body parsed in memory before authentication or validation can reject it. RPC allows a batch of
	// agent attachments (the same 160 MiB ceiling as staged Vercel bodies); auth payloads are small JSON or forms.
	const limitBody = (maxSize: number) =>
		bodyLimit({
			maxSize,
			onError: (c) => {
				c.header("Cache-Control", "no-store");
				return c.json(
					{
						defined: false,
						code: "PAYLOAD_TOO_LARGE",
						status: 413,
						message: "This request is too large. Use a smaller file and try again.",
					},
					413,
				);
			},
		});
	app.use("/api/openapi/*", limitBody(40 * 1024 * 1024));
	// Hono's `/x/*` also matches `/x`, so each wildcard below covers its base path too.
	app.use("/api/rpc/*", limitBody(160 * 1024 * 1024));
	app.use("/api/auth/*", limitBody(1024 * 1024));
	app.use("/api/storage/stage", limitBody(64 * 1024));

	app.post("/api/storage/stage", (c) => prepareStagedBody(c.req.raw));
	app.all("/api/rpc/*", (c) => withStagedBody(c.req.raw, (request) => handleRpc(request, client(c))));
	app.all("/api/openapi/*", (c) => handleOpenApi(c.req.raw, client(c)));
	app.get("/api/auth/oauth", (c) => handleOAuth(c.req.raw));
	app.all("/api/auth/*", (c) => handleAuth(c.req.raw, client(c)));
	app.get("/api/health", () => handleHealth());
	app.get("/api/internal/traefik", (c) => handleTraefikProvider(c.req.raw));
	app.on(["GET", "POST"], "/api/career/run", (c) => handleCareerJobs(c.req.raw));
	app.get("/api/resumes/:username/:slug/pdf", (c) =>
		handlePublicResumePdf(c.req.raw, c.req.param("username"), c.req.param("slug"), client(c)),
	);
	app.get("/api/resumes/:id/pdf", (c) => handleResumePdfDownload(c.req.raw, c.req.param("id")));
	// Outside /api/resumes, which robots.txt keeps crawlers out of: link previews need to fetch these.
	app.get("/cards/:username/:file{.+\\.png}", (c) =>
		handleResumeCard(c.req.raw, c.req.param("username"), c.req.param("file").slice(0, -".png".length)),
	);
	app.get("/api/uploads/*", (c) => handleUpload(c.req.raw));
	app.get("/uploads/*", (c) => handleUpload(c.req.raw));
	app.get("/schema.json", () => handleSchemaJson());
	app.get("/openapi.json", () => handleOpenApiDocument());
	app.all("/mcp/*", (c) => handleMcp(c.req.raw, client(c)));

	app.get("/.well-known/apple-app-site-association", () => handleAppleAppSiteAssociation());
	app.get("/.well-known/assetlinks.json", () => handleAndroidAssetLinks());
	app.get("/.well-known/integrations.json", () => handleIntegrations());
	// Hono answers HEAD by running the GET route and dropping the body, headers kept.
	app.get("/.well-known/api-catalog", () => handleApiCatalog());
	app.get("/.well-known/agent-skills/index.json", () => handleAgentSkillsIndex());
	app.get("/.well-known/agent-skills/:filename", (c) => handleAgentSkillArchive(c.req.param("filename")));
	app.get("/.well-known/mcp/server-card.json", () => handleMcpServerCard());
	app.on("GET", ["/.well-known/ard.json", "/.well-known/ai-catalog.json"], () => handleAgentCatalog());
	app.get("/.well-known/oauth-authorization-server/*", (c) => handleOAuthAuthorizationServer(c.req.raw));
	app.get("/.well-known/openid-configuration", (c) => handleOpenIdConfiguration(c.req.raw));
	app.get("/.well-known/oauth-protected-resource/*", () => handleOAuthProtectedResource());
	app.get("/.well-known/openai-apps-challenge", () => handleOpenAiAppsChallenge());
	app.all("/.well-known/*", () => handleWellKnownFallback());

	app.get("/robots.txt", () => handleRobots());
	app.get("/sitemap.xml", () => handleSitemap());
	app.get("/sitemaps/pages.xml", () => handlePagesSitemap());
	app.get("/sitemaps/:page{resumes-[0-9]+\\.xml}", (c) =>
		handleResumesSitemap(Number(c.req.param("page").slice("resumes-".length, -".xml".length))),
	);
	app.get("/llms.txt", () => handleLlms());

	// Compresses only the web app's files and HTML shells: every route registered above answers before reaching
	// it, so API, MCP, and upload streams are never buffered or re-encoded. Where a CDN serves the static files
	// (Vercel), it also compresses at its edge.
	if (options.serveStatic !== false) app.use("/*", compress());

	// Must precede the static middleware: serveStatic resolves "/" to dist/index.html and would
	// return it verbatim, skipping the OpenGraph/Twitter/canonical/JSON-LD injection in handleWebApp.
	// An instance can show one resume at its root instead of the marketing home; the configuration alone picks it.
	const rootResumeId = env.ROOT_RESUME_ID;
	app.on("GET", ["/", "/index.html"], (c) =>
		rootResumeId
			? serveResumePage(c.req.raw, { id: rootResumeId }, client(c))
			: handleWebApp(c.req.raw, options.readWebFile),
	);
	if (rootResumeId)
		app.post("/", limitBody(16 * 1024), (c) => serveResumePage(c.req.raw, { id: rootResumeId }, client(c)));
	if (options.serveStatic !== false && serveWebDistStatic) app.use("/*", serveWebDistStatic);
	// A resume's web page, rendered here, and its password form; files with the same shape of address were served
	// just above. `/<username>` is the account's primary resume, on every domain the app answers.
	app.on(["GET", "POST"], "/:username/:slug", limitBody(16 * 1024), (c, next) =>
		isPublicResumePath(c.req.path)
			? serveResumePage(c.req.raw, { username: c.req.param("username"), slug: c.req.param("slug") }, client(c))
			: next(),
	);
	app.on(["GET", "POST"], "/:username", limitBody(16 * 1024), async (c, next) => {
		if (!isProfilePath(c.req.path)) return next();
		const page = await serveResumePage(c.req.raw, { username: c.req.param("username"), primary: true }, client(c));
		// `/login`, `/pricing` and the like go to the real page, unless an account of that name shares a page there. Every unavailable page
		// reads the same, so this tells nobody whether such an account exists.
		const username = c.req.param("username").toLowerCase();
		const alias = Object.hasOwn(SITE_PATH_ALIASES, username) ? SITE_PATH_ALIASES[username] : undefined;
		if (alias && page.status === 404 && c.req.method !== "POST") {
			return new Response(null, { status: 302, headers: { Location: `${alias}${new URL(c.req.url).search}` } });
		}
		return page;
	});
	app.get("/*", (c) => handleWebApp(c.req.raw, options.readWebFile));

	return app;
}
