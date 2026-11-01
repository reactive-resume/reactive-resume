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

/** Names that can never be (or would shadow) an account's page, so no new account may take them. */
export const isReservedUsername = (username: string) => {
	const name = username.trim().toLowerCase();
	return (RESERVED_SEGMENTS as readonly string[]).includes(name) || Object.hasOwn(AUTH_PATH_ALIASES, name);
};

/** Whether `pathname` is in one of the signed-in app's sections. */
export const isAppSectionPath = (pathname: string) =>
	APP_SECTIONS.some((section) => pathname === `/${section}` || pathname.startsWith(`/${section}/`));
