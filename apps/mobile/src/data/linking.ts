import * as WebBrowser from "expo-web-browser";
import { appScheme } from "@/auth/oauth";
import { getServer, restoreSession, signIn, getAccountScope } from "@/auth/session";

export type DeepLink =
	| { kind: "callback" }
	| { kind: "root" }
	| { kind: "target"; server: string | null; href: string; public: boolean };
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
/** Decode before URL normalization, so traversal and private query parameters never become navigation. */
export function parseDeepLink(input: string, currentServer: string): DeepLink | null {
	if (input.length > 8192 || /[\s\\]/.test(input)) return null;
	const scheme = `${appScheme()}:`;
	let path: string;
	let server: string | null = null;
	if (input.startsWith(scheme)) path = `/${input.slice(scheme.length).replace(/^\/+/, "")}`;
	else if (input.startsWith("/") && !input.startsWith("//")) path = input;
	else {
		const match = /^https:\/\/([^/?#]+)([^?#]*)(.*)$/i.exec(input);
		if (!match) return null;
		try {
			const url = new URL(input);
			if (url.username || url.password) return null;
			server = url.origin;
		} catch {
			return null;
		}
		path = `${match[2] || "/"}${match[3]}`;
	}
	const pathname = path.split(/[?#]/, 1)[0];
	if (pathname === "/auth/native-callback")
		return server === null || server === "https://rxresu.me" ? { kind: "callback" } : null;
	if (server && ![currentServer, "https://rxresu.me", "https://rx.cv"].includes(server)) return null;
	if (pathname === "/") return { kind: "root" };
	let parts: string[];
	try {
		parts = (pathname ?? "").replace(/\/$/, "").slice(1).split("/").map(decodeURIComponent);
	} catch {
		return null;
	}
	if (
		parts.some(
			(part) =>
				!part ||
				part === "." ||
				part === ".." ||
				/[/\\%?#\s]/.test(part) ||
				Array.from(part).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127),
		)
	)
		return null;
	const [first, second, third] = parts;
	const target = (href: string, isPublic = false): DeepLink => ({
		kind: "target",
		server: server === "https://rx.cv" ? "https://rxresu.me" : server,
		href,
		public: isPublic,
	});
	if (first === "ats-checker" && parts.length === 1) return target("/ats-checker", true);
	if (first === "builder" && second === "letter" && third && parts.length === 3)
		return target(`/letter/${encodeURIComponent(third)}`);
	if (first === "builder" && second && parts.length <= 3) {
		const pane = third ?? new URLSearchParams(path.split("?")[1]?.split("#")[0]).get("mode") ?? "write";
		const suffix: Record<string, string> = {
			write: "",
			edit: "",
			page: "/preview",
			design: "/design",
			check: "/check",
			share: "/share",
			export: "/download",
			history: "/versions",
			assistant: "/assistant",
		};
		if (!(pane in suffix)) return null;
		return target(`/builder/${encodeURIComponent(second)}${suffix[pane]}`);
	}
	if ((first === "applications" || first === "letter") && second && parts.length === 2)
		return target(`/${first}/${encodeURIComponent(second)}`);
	if (first === "r" && second && third && parts.length === 3)
		return target(`/r/${encodeURIComponent(second)}/${encodeURIComponent(third)}`, true);
	if (first && second && parts.length === 2 && !reserved.has(first.toLowerCase()))
		return target(`/r/${encodeURIComponent(first)}/${encodeURIComponent(second)}`, true);
	return null;
}
export type LinkPresenter = (request: {
	server: string;
	currentServer: string;
	reason: "sign-in" | "switch-server";
}) => Promise<boolean>;
let presenter: LinkPresenter | undefined;
export function setLinkPresenter(next?: LinkPresenter) {
	presenter = next;
}
let queue: Promise<unknown> = Promise.resolve();
/** Wire from app/+native-intent.tsx. Auth callbacks bypass the serial queue. */
export function redirectSystemPath({
	path,
	initial,
}: {
	path: string;
	initial: boolean;
}): Promise<string | null> | string {
	const immediate = parseDeepLink(path, getServer());
	if (immediate?.kind === "callback") return path;
	if (immediate?.kind === "root") return "/";
	const result = queue
		.then(async () => {
			const fallback = initial ? "/" : null;
			await restoreSession();
			const currentServer = getServer();
			const link = parseDeepLink(path, currentServer);
			if (!link || link.kind !== "target") {
				if (/^https:\/\//i.test(path)) await WebBrowser.openBrowserAsync(path).catch(() => {});
				return fallback;
			}
			const server = link.server ?? currentServer;
			if (link.public && server === currentServer) return link.href;
			if (server === currentServer && getAccountScope()) return link.href;
			if (
				!(await presenter?.({ server, currentServer, reason: server === currentServer ? "sign-in" : "switch-server" }))
			)
				return fallback;
			return (await signIn(server)) ? link.href : fallback;
		})
		.catch(() => (initial ? "/" : null));
	queue = result;
	return result;
}
