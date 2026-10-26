import { useLocalSearchParams, useRouter } from "expo-router";
import { openBrowserAsync } from "expo-web-browser";
import { useEffect } from "react";
import { getServer } from "@/auth/session";

/**
 * Public resumes are web pages now. Phones that still open these links in the app (an older cached
 * apple-app-site-association) get the web page in the in-app browser. Remove once those caches have expired.
 */
export default function PublicResumeScreen() {
	const router = useRouter();
	const { username = "", slug = "" } = useLocalSearchParams<{ username: string; slug: string }>();

	useEffect(() => {
		const url = `${getServer()}/${encodeURIComponent(username)}/${encodeURIComponent(slug)}`;
		void openBrowserAsync(url).finally(() => (router.canGoBack() ? router.back() : router.replace("/")));
	}, [router, slug, username]);

	return null;
}
