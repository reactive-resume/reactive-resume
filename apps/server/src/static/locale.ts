import { defaultLocale, isLocale, supportedLocales } from "@reactive-resume/utils/locale";

/** Explicit website preference only. Shared HTML must not vary by Accept-Language. */
export function getPageLocale(request: Request) {
	const requested = new URL(request.url).searchParams.get("locale");
	if (isLocale(requested))
		return { locale: supportedLocales.includes(requested) ? requested : defaultLocale, requested: true };
	const saved = request.headers.get("cookie")?.match(/(?:^|;\s*)locale=([^;]*)/)?.[1];
	if (saved !== undefined)
		return { locale: isLocale(saved) && supportedLocales.includes(saved) ? saved : defaultLocale, requested: false };
	return null;
}
