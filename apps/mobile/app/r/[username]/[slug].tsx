import { useLocalSearchParams, useRouter } from "expo-router";
import { openBrowserAsync } from "expo-web-browser";
import { useEffect } from "react";
import { Linking } from "react-native";
import { publicResumeUrl } from "@reactive-resume/resume/sharing";
import { getServer } from "@/auth/session";

/**
 * Public resumes are web pages now. Phones that still open these links in the app (an older cached
 * apple-app-site-association) get the web page in the in-app browser. Remove once those caches have expired.
 */
export default function PublicResumeScreen() {
	const router = useRouter();
	const { username = "", slug = "" } = useLocalSearchParams<{ username: string; slug: string }>();

	useEffect(() => {
		const url = publicResumeUrl(getServer(), { username, slug });
		// Without an in-app browser, the system browser opens it.
		void openBrowserAsync(url)
			.catch(() => Linking.openURL(url))
			.catch(() => undefined)
			.finally(() => (router.canGoBack() ? router.back() : router.replace("/")));
	}, [router, slug, username]);

	return null;
}
