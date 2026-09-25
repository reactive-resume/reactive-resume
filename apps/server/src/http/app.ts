import type { Http2Bindings, HttpBindings } from "@hono/node-server";
import type { Context } from "hono";
import { isIP } from "node:net";
import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono } from "hono";
import { prepareStagedBody, withStagedBody } from "@reactive-resume/api/features/storage/transport";
import { handleMcp } from "../mcp/handler";
import { handleOpenApi } from "../openapi/handler";
import {
	handleMcpServerCard,
	handleOAuthAuthorizationServer,
	handleOAuthProtectedResource,
	handleOpenIdConfiguration,
	handleWellKnownFallback,
} from "../openapi/metadata";
import { handleRpc } from "../rpc/handler";
import { handleSchemaJson } from "../static/schema";
import { handleLlms, handleRobots, handleSitemap } from "../static/seo";
import { handleUpload } from "../static/uploads";
import { handleWebApp, serveWebDistStatic } from "../static/web";
import { handleAuth, handleOAuth } from "./auth";
import { handleHealth } from "./health";
import { handlePublicResumePdf } from "./public-resume-pdf";
import { handleResumePdfDownload } from "./resume-pdf";

type ServerEnvironment = { Bindings: HttpBindings | Http2Bindings };

const getTrustedClient = (context: Context<ServerEnvironment>): string => {
	try {
		const address = getConnInfo(context).remote.address?.trim();
		return address && isIP(address) ? address : "unknown";
	} catch {
		return "unknown";
	}
};

type AppOptions = {
	serveStatic?: boolean;
	trustedClient?: (request: Request) => string;
};

export function createApp(options: AppOptions = {}) {
	const app = new Hono<ServerEnvironment>();
	const client = (c: Context<ServerEnvironment>) => options.trustedClient?.(c.req.raw) ?? getTrustedClient(c);

	app.use("/auth/*", async (c, next) => {
		await next();
		c.header("Content-Security-Policy", "frame-ancestors 'none'");
		c.header("X-Frame-Options", "DENY");
		c.header("Referrer-Policy", "no-referrer");
		c.header("Cache-Control", "no-store");
	});

	app.post("/api/storage/stage", (c) => prepareStagedBody(c.req.raw));
	app.all("/api/rpc", (c) => withStagedBody(c.req.raw, (request) => handleRpc(request, client(c))));
	app.all("/api/rpc/*", (c) => withStagedBody(c.req.raw, (request) => handleRpc(request, client(c))));
	app.all("/api/openapi", (c) => handleOpenApi(c.req.raw, client(c)));
	app.all("/api/openapi/*", (c) => handleOpenApi(c.req.raw, client(c)));
	app.get("/api/auth/oauth", (c) => handleOAuth(c.req.raw));
	app.all("/api/auth/*", (c) => handleAuth(c.req.raw));
	app.get("/api/health", () => handleHealth());
	app.get("/api/resumes/:username/:slug/pdf", (c) =>
		handlePublicResumePdf(c.req.raw, c.req.param("username"), c.req.param("slug"), client(c)),
	);
	app.get("/api/resumes/:id/pdf", (c) => handleResumePdfDownload(c.req.raw, c.req.param("id")));
	app.get("/api/uploads/*", (c) => handleUpload(c.req.raw));
	app.get("/uploads/*", (c) => handleUpload(c.req.raw));
	app.get("/schema.json", () => handleSchemaJson());
	app.all("/mcp", (c) => handleMcp(c.req.raw));
	app.all("/mcp/*", (c) => handleMcp(c.req.raw));

	app.get("/.well-known/mcp/server-card.json", () => handleMcpServerCard());
	app.get("/.well-known/oauth-authorization-server", (c) => handleOAuthAuthorizationServer(c.req.raw));
	app.get("/.well-known/oauth-authorization-server/*", (c) => handleOAuthAuthorizationServer(c.req.raw));
	app.get("/.well-known/openid-configuration", (c) => handleOpenIdConfiguration(c.req.raw));
	app.get("/.well-known/oauth-protected-resource", () => handleOAuthProtectedResource());
	app.get("/.well-known/oauth-protected-resource/*", () => handleOAuthProtectedResource());
	app.all("/.well-known/*", () => handleWellKnownFallback());

	app.on(["GET", "HEAD"], "/robots.txt", (c) => handleRobots({ head: c.req.method === "HEAD" }));
	app.on(["GET", "HEAD"], "/sitemap.xml", (c) => handleSitemap({ head: c.req.method === "HEAD" }));
	app.on(["GET", "HEAD"], "/llms.txt", (c) => handleLlms({ head: c.req.method === "HEAD" }));

	// Must precede the static middleware: serveStatic resolves "/" to dist/index.html and would
	// return it verbatim, skipping the OpenGraph/Twitter/canonical/JSON-LD injection in handleWebApp.
	app.on(["GET", "HEAD"], "/", (c) => handleWebApp(c.req.raw));
	if (options.serveStatic !== false) app.use("/*", serveWebDistStatic);
	app.on(["GET", "HEAD"], "/*", (c) => handleWebApp(c.req.raw));

	return app;
}
