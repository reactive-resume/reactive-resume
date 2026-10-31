import { usePathname, useRouter } from "expo-router";
import { useCallback } from "react";
import { routes } from "@/routes";

/** The applications views keep their own route; Save job opens in place there and pushes the list from a workspace. */
const applicationViews = new Set<string>([
	routes.applications("list"),
	routes.applications("board"),
	routes.applications("calendar"),
	routes.applications("insights"),
]);

/** New follows the section: Applications opens Save job, Career leads its New sheet with it, Documents keeps New document. */
export function useNewAction() {
	const router = useRouter();
	const pathname = usePathname();

	return useCallback(() => {
		if (pathname.startsWith("/applications")) {
			if (applicationViews.has(pathname)) router.setParams({ create: "1" });
			else router.push(routes.newJob());
			return;
		}
		router.push(routes.new(pathname.startsWith("/career") ? "career" : "documents"));
	}, [pathname, router]);
}
