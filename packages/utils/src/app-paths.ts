/** The signed-in app's sections. On the alias domain (`APP_ALIAS_URL`) they move to `APP_URL`, where sign-in lives. */
export const APP_SECTIONS = ["auth", "dashboard", "builder", "agent"] as const;

/** First path segments the app owns besides its sections: never a username, so never a resume's web page. */
export const RESERVED_SEGMENTS = [
	...APP_SECTIONS,
	"api",
	"mcp",
	".well-known",
	"uploads",
	"templates",
	"ats-checker",
	"resume-templates",
] as const;

/**
 * Addresses people guess for signing in or up. They lead to the real pages unless a shared resume already lives there,
 * so accounts that took one of these names before keep their page.
 */
export const AUTH_PATH_ALIASES: Readonly<Record<string, "/auth/login" | "/auth/register">> = {
	login: "/auth/login",
	signin: "/auth/login",
	"sign-in": "/auth/login",
	register: "/auth/register",
	signup: "/auth/register",
	"sign-up": "/auth/register",
};

/** Pages of the site people guess at by name; like the sign-in aliases, they yield to an account's shared page. */
export const SITE_PATH_ALIASES: Readonly<Record<string, string>> = {
	...AUTH_PATH_ALIASES,
	pricing: "/",
	features: "/",
	home: "/",
};

/** Names that can never be (or would shadow) an account's page, so no new account may take them. */
export const isReservedUsername = (username: string) => {
	const name = username.trim().toLowerCase();
	return (RESERVED_SEGMENTS as readonly string[]).includes(name) || Object.hasOwn(SITE_PATH_ALIASES, name);
};

/** Whether `pathname` is in one of the signed-in app's sections. */
export const isAppSectionPath = (pathname: string) =>
	APP_SECTIONS.some((section) => pathname === `/${section}` || pathname.startsWith(`/${section}/`));

/** Pages of the signed-in app that people type without `/dashboard`. */
const DASHBOARD_PAGES = new Set(["applications", "resumes", "cover-letters", "career", "settings", "trash"]);
/** Other single words that only ever mean an app page. */
const APP_SHORTCUTS: Readonly<Record<string, string>> = {
	documents: "/dashboard",
	letters: "/dashboard/cover-letters",
	login: "/auth/login",
	"sign-in": "/auth/login",
	signin: "/auth/login",
	register: "/auth/register",
	"sign-up": "/auth/register",
	signup: "/auth/register",
};

/**
 * The app page a mistyped address meant: `/applications` is Applications at `/dashboard/applications`, not a username's
 * resume. Only consulted when no shared resume answers the address, so a real username keeps its page.
 */
export function mistypedAppPath(pathname: string): string | null {
	const [first, ...rest] = pathname.split("/").filter(Boolean);
	if (!first) return null;
	const segment = first.toLowerCase();
	if (DASHBOARD_PAGES.has(segment)) return `/dashboard/${[segment, ...rest].join("/")}`;
	return rest.length === 0 ? (APP_SHORTCUTS[segment] ?? null) : null;
}
