import type { AppHref, BuilderPane } from "../routes";
import { routes } from "../routes";
import { DEFAULT_SERVER } from "@/auth/session";

export type DeepLink =
	| { kind: "callback" }
	| { kind: "root" }
	| { kind: "target"; server: string | null; href: AppHref };

// Matches the server's public-resume exclusions.
const reserved = new Set([
	"api",
	"mcp",
	".well-known",
	"uploads",
	"auth",
	"dashboard",
	"builder",
	"agent",
	"templates",
	"ats-checker",
]);
const nativeReserved = new Set([
	"documents",
	"applications",
	"career",
	"settings",
	"server",
	"sign-in",
	"new",
	"search",
	"dev",
	"letter",
	"r",
]);
const panes = new Set<string>(["write", "page", "design", "check", "share"]);

/** Only known screens, with decoded segments checked before WHATWG URL can erase traversal. */
export function parseDeepLink(input: string, currentServer: string): DeepLink | null {
	if (input.length > 8192) return null;
	let path: string;
	let server: string | null = null;
	let native = false;
	if (/^me\.rxresu:/i.test(input)) {
		native = true;
		path = `/${input.slice("me.rxresu:".length).replace(/^\/+/, "")}`;
	} else if (input.startsWith("/") && !input.startsWith("//")) {
		native = true;
		path = input;
	} else {
		const match = /^https:\/\/([^/?#]+)([^?#]*)(.*)$/i.exec(input);
		if (!match) return null;
		path = `${match[2] || "/"}${match[3]}`;
		try {
			const url = new URL(input);
			if (url.username || url.password || !url.hostname) return null;
			server = url.origin;
		} catch {
			return null;
		}
	}

	const pathname = path.split(/[?#]/, 1)[0];
	// AuthSession owns this response. Never inspect its query, authenticate, or remap it as a public resume.
	if (pathname === "/auth/native-callback")
		return server === null || server === DEFAULT_SERVER ? { kind: "callback" } : null;
	if (server !== null && server !== DEFAULT_SERVER && server !== currentServer) return null;
	if (!pathname || /[\s\\]/.test(input)) return null;
	if (native && pathname === "/") return { kind: "root" };
	let segments: string[];
	try {
		segments = pathname.replace(/\/$/, "").slice(1).split("/").map(decodeURIComponent);
	} catch {
		return null;
	}
	if (
		segments.some(
			(part) =>
				!part ||
				part === "." ||
				part === ".." ||
				/[/\\%?#\s]/.test(part) ||
				Array.from(part).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127),
		)
	)
		return null;
	const [first, second, third, fourth, fifth] = segments;
	if (!first || !second) return null;
	const target = (href: AppHref): DeepLink => ({ kind: "target", server, href });

	if (__DEV__ && native && pathname === "/builder/preview-sample/page") {
		for (const pair of path.split("#", 1)[0]?.split("?", 2)[1]?.split("&") ?? []) {
			const separator = pair.indexOf("=");
			if (separator < 0) continue;
			const key = pair.slice(0, separator);
			if (key !== "parity" && key !== "smoke") continue;
			let origin: string;
			try {
				origin = decodeURIComponent(pair.slice(separator + 1).replaceAll("+", " "));
			} catch {
				return target(routes.builder("preview-sample", "page"));
			}
			const match = origin.match(/^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/?$/);
			if (match && Number(match[1]) <= 65535)
				return target(
					`${routes.builder("preview-sample", "page")}?${key}=${encodeURIComponent(origin.replace(/\/$/, ""))}` as AppHref,
				);
		}
	}

	if (first === "builder") {
		// Web editor mode is a query parameter. Never forward arbitrary queries (e.g. assistant auto-send prompts).
		let mode: BuilderPane = "write";
		for (const pair of path.split("#", 1)[0]?.split("?", 2)[1]?.split("&") ?? []) {
			const [key, value] = pair.split("=", 2);
			if (key === "mode" && value && panes.has(value)) mode = value as BuilderPane;
		}
		if (second === "letter" && third && segments.length === 3)
			return target(routes.letter(third, mode === "design" ? "design" : "write"));
		if (segments.length === 2) return target(routes.builder(second, mode));
		if (segments.length === 3) {
			if (third && panes.has(third)) return target(routes.builder(second, third as BuilderPane));
			if (third === "export") return target(routes.export(second));
			if (third === "history") return target(routes.history(second));
			if (third === "assistant") return target(routes.assistant(second));
		}
		if (segments.length === 5 && third === "entry" && fourth && fifth)
			return target(routes.entry(second, fourth, fifth));
		return null;
	}
	if (native && first === "r" && third && segments.length === 3) return target(routes.publicResume(second, third));
	if (
		segments.length === 2 &&
		!reserved.has(first.toLowerCase()) &&
		!(native && nativeReserved.has(first.toLowerCase()))
	)
		return target(routes.publicResume(first, second));
	return null;
}
