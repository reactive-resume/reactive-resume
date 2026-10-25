import { env } from "@reactive-resume/env/server";
import { templateSchema } from "@reactive-resume/schema/templates";
import { getLocaleAlternates } from "@reactive-resume/utils/locale";

const DOCS_URL = "https://docs.rxresu.me";
export const CONTEXT7_ASK_URL = "https://context7.com/api/v2/ask?siteKey=ask_b3fd9335a63f1b21b1a814ac";
export const CONTEXT7_ASK_DESCRIPTION = `This site has a search endpoint: ${CONTEXT7_ASK_URL}&query=<URL-encoded question>. It returns documentation that answers the question, with a source link for each part. No API key is needed. If nothing matches, it says so.`;

function appUrl() {
	return env.APP_URL.replace(/\/+$/, "");
}

function textResponse(body: string) {
	return new Response(body, {
		headers: { "Content-Type": "text/plain; charset=UTF-8" },
	});
}

export function handleRobots() {
	const baseUrl = appUrl();
	const body = [
		"User-agent: *",
		"Allow: /",
		"Disallow: /api/rpc",
		"Disallow: /api/auth",
		"Disallow: /mcp",
		"Disallow: /.well-known",
		// Discovery documents meant for agents and API directories.
		"Allow: /.well-known/integrations.json",
		"Allow: /.well-known/api-catalog",
		"Allow: /.well-known/mcp/server-card.json",
		"Allow: /.well-known/agent-skills/",
		"",
		`Sitemap: ${baseUrl}/sitemap.xml`,
		`Sitemap: ${DOCS_URL}/sitemap.xml`,
		"",
	].join("\n");

	return textResponse(body);
}

// The indexable pages; everything else is the signed-in app or a public resume, both served noindex.
const sitemapPaths = ["/", "/ats-checker", "/resume-templates"];

const escapeXml = (value: string) =>
	value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export function handleSitemap() {
	const baseUrl = appUrl();
	const urls = sitemapPaths.flatMap((path) => {
		const pageUrl = `${baseUrl}${path}`;
		const languages = getLocaleAlternates(pageUrl);
		const alternates = languages.map(
			({ hreflang, href }) => `    <xhtml:link rel="alternate" hreflang="${hreflang}" href="${escapeXml(href)}"/>`,
		);
		// x-default shares the English URL; each canonical URL appears once with the same alternate set.
		return [...new Set(languages.map(({ href }) => href))].map((href) =>
			["  <url>", `    <loc>${escapeXml(href)}</loc>`, ...alternates, "  </url>"].join("\n"),
		);
	});
	const body = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
		...urls,
		"</urlset>",
		"",
	].join("\n");

	return new Response(body, {
		headers: { "Content-Type": "application/xml; charset=UTF-8" },
	});
}

export function handleLlms() {
	const baseUrl = appUrl();
	const body = [
		"# Reactive Resume",
		"",
		`> Reactive Resume is a free and open-source resume builder. Write a resume in an editor beside a live page, pick one of ${templateSchema.options.length} templates, check that applicant tracking systems can read it, tailor it to a job posting, and share it at a public link or download it. No ads, no tracking, no paid tier; it is funded by donations and released under the MIT License.`,
		"",
		"## Search",
		"",
		CONTEXT7_ASK_DESCRIPTION,
		"",
		"## Product",
		"",
		`- [Homepage](${baseUrl}/): what Reactive Resume does, with answers to common questions.`,
		`- [Resume templates](${baseUrl}/resume-templates): browse all ${templateSchema.options.length} free templates, compare layouts and download sample PDFs.`,
		`- [ATS checker](${baseUrl}/ats-checker): a free tool that shows the text applicant tracking systems extract from a resume PDF and what to fix. It runs in the browser; the file is never uploaded.`,
		`- [Get started](${baseUrl}/dashboard): create an account and a first resume.`,
		"",
		"## Facts",
		"",
		"- Price: free, every feature. Optional donations through GitHub Sponsors and Open Collective.",
		"- Export: PDF, Word (DOCX), Markdown and JSON.",
		"- Import: PDF, LinkedIn data export, JSON Resume, Reactive Resume JSON; Word files with an AI provider.",
		"- Sharing: private by default; a public link or a password-protected link, changeable at any time.",
		"- AI: optional, with the user's own API key (OpenAI, Anthropic, Google Gemini, OpenRouter, Ollama and others). Nothing is sent to an AI service without one.",
		"- Also includes: cover letters, a job application tracker, version history, passkeys and two-factor authentication.",
		"- Languages: the interface is translated into more than 50 languages by volunteers on Crowdin.",
		"- Self-hosting: a Docker image, with PostgreSQL and local or S3-compatible storage.",
		"",
		"## Documentation",
		"",
		`- [Documentation](${DOCS_URL}): guides for using and self-hosting Reactive Resume.`,
		`- [Documentation llms.txt](${DOCS_URL}/llms.txt)`,
		`- [Self-hosting with Docker](${DOCS_URL}/self-hosting/docker)`,
		`- [API reference](${DOCS_URL}/api-reference)`,
		`- [OpenAPI specification](${baseUrl}/openapi.json)`,
		`- [Resume JSON schema](${baseUrl}/schema.json)`,
		`- [MCP server guide](${DOCS_URL}/guides/using-the-mcp-server): connect any MCP client to ${baseUrl}/mcp with OAuth or an API key.`,
		`- [Agent skills](${DOCS_URL}/guides/using-agent-skills): eight job-search skills, also listed at ${baseUrl}/.well-known/agent-skills/index.json.`,
		`- [Integrations](${baseUrl}/.well-known/integrations.json): every API and MCP surface with its authentication.`,
		"",
		"## Community",
		"",
		"- [Source code on GitHub](https://github.com/reactive-resume/reactive-resume)",
		"- [Discord](https://discord.gg/aSyA5ZSxpb)",
		"- [Subreddit](https://www.reddit.com/r/reactiveresume)",
		"- [Translations on Crowdin](https://crowdin.com/project/reactive-resume)",
		"",
	].join("\n");

	return textResponse(body);
}
