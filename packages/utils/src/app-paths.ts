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

/** Whether `pathname` is in one of the signed-in app's sections. */
export const isAppSectionPath = (pathname: string) =>
	APP_SECTIONS.some((section) => pathname === `/${section}` || pathname.startsWith(`/${section}/`));
