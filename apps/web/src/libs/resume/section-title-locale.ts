import type { SectionTitleResolver } from "@reactive-resume/pdf/section-title";
import { setupI18n } from "@lingui/core";
import { createSectionTitleResolver } from "./section-title";
import { getLocaleMessages, resolveLocale } from "@/libs/locale";

const resolverCache = new Map<string, Promise<SectionTitleResolver>>();

export const createSectionTitleResolverForLocale = (localeParam: string) => {
	const requestedLocale = resolveLocale(localeParam);
	const cachedResolver = resolverCache.get(requestedLocale);

	if (cachedResolver) return cachedResolver;

	const resolver = getLocaleMessages(requestedLocale).then(({ locale, messages }) => {
		const i18n = setupI18n({ locale });
		i18n.loadAndActivate({ locale, messages });

		return createSectionTitleResolver(i18n);
	});

	resolverCache.set(requestedLocale, resolver);

	return resolver;
};
