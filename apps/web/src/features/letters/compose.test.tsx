import { expect, it } from "vite-plus/test";
import { i18n as app } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { copyCoverLetterStyle } from "@reactive-resume/resume/cover-letter";
import { coverLetterSchema } from "@reactive-resume/schema/cover-letter/data";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { letterPageData, letterWordsQueryOptions, useLetterWords } from "./compose";
import { getLocaleMessages } from "@/libs/locale";

it.each([
	{
		appLocale: "en-US",
		documentLocale: "de-DE",
		greeting: "Sehr geehrte Damen und Herren,",
		signOff: "Mit freundlichen Grüßen",
		date: "28. September 2026",
	},
	{
		appLocale: "de-DE",
		documentLocale: "en-US",
		greeting: "Dear hiring team,",
		signOff: "Kind regards,",
		date: "September 28, 2026",
	},
])(
	"uses document language $documentLocale with app language $appLocale",
	async ({ appLocale, documentLocale, greeting, signOff, date }) => {
		app.loadAndActivate(await getLocaleMessages(appLocale));
		const queryClient = new QueryClient();
		await queryClient.ensureQueryData(letterWordsQueryOptions(documentLocale));
		const style = copyCoverLetterStyle(defaultResumeData);
		style.metadata.page.locale = documentLocale;
		style.basics.name = "Jordan Reyes";
		const letter = coverLetterSchema.parse({
			id: "letter",
			name: "Letter",
			recipient: "",
			content: "<p>Meine Bewerbung.</p>",
			style,
			layout: "structured",
			letterDate: "2026-09-28",
			sourceResumeId: null,
			sourceApplicationId: null,
			senderLinked: false,
			designLinked: false,
			isLocked: false,
			revision: 1,
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		function Page() {
			const words = useLetterWords(letter.style.metadata.page.locale);
			const data = letterPageData(letter, words);
			const section = data.customSections[0];
			if (section?.type !== "cover-letter") throw new Error("Missing letter section.");
			return (
				<div>
					{section.items[0]?.recipient}
					{section.items[0]?.content}
				</div>
			);
		}
		const html = renderToStaticMarkup(
			<QueryClientProvider client={queryClient}>
				<I18nProvider i18n={app}>
					<Page />
				</I18nProvider>
			</QueryClientProvider>,
		);
		expect(html).toContain(greeting);
		expect(html).toContain(signOff);
		expect(html).toContain(date);
		expect(app.locale).toBe(appLocale);
		queryClient.clear();
	},
);
