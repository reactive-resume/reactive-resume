import { expect, it } from "vite-plus/test";
import { mistypedAppPath } from "./app-paths";

it.each([
	["/documents", "/dashboard/documents"],
	["/Documents/", "/dashboard/documents"],
	["/today", "/dashboard"],
	["/letters", "/dashboard/cover-letters"],
	["/trash", "/dashboard/trash"],
	["/settings/developer", "/dashboard/settings/developer"],
	["/signin", "/auth/login"],
])("reads %s as the app page %s", (typed, page) => {
	expect(mistypedAppPath(typed)).toBe(page);
});

it.each(["/", "/alex", "/today/extra", "/alex/resume"])("leaves %s to usernames and the site", (typed) => {
	expect(mistypedAppPath(typed)).toBeNull();
});
