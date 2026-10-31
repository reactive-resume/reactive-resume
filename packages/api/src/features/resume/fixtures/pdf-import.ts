import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { sampleResumeData } from "@reactive-resume/schema/resume/sample";
import { templateSchema } from "@reactive-resume/schema/templates";
import { generateId } from "@reactive-resume/utils/string";

export const pdfImportCases = templateSchema.options.flatMap((template) => [
	...["2018", "Jan 2020", ""].flatMap((period) =>
		[0, 1, 2].map((index) => ({ template, kind: "date", period, index })),
	),
	...[0, 1].map((index) => ({ template, kind: "wrapped", period: index ? "" : "2020 – 2021", index })),
	{ template, kind: "identity", period: "2020 – 2021", index: 0 },
]);

export function pdfImportSource(c: (typeof pdfImportCases)[number]) {
	const data = structuredClone(defaultResumeData);
	data.picture.hidden = true;
	data.basics = {
		...data.basics,
		name: "Jordan Sample",
		headline: "Product & Platform Lead",
		email: "jordan@example.invalid",
		phone: "+1 (202) 555-0199",
		location: "Singapore",
		website: { url: "https://example.invalid/work", label: "Selected work" },
	};
	data.metadata.layout.pages = [{ fullWidth: true, main: ["experience"], sidebar: [] }];
	const original = sampleResumeData.sections.experience.items[0];
	if (!original) throw new Error("Missing sample role");
	data.sections.experience.items = [0, 1, 2].map((i) => ({
		...original,
		id: generateId(),
		company: ["Orbital Labs", "eBay", "3M"][i] ?? "",
		position: ["Engineer, Platform", "Director, Product", "Staff Engineer"][i] ?? "",
		location: ["HQ", "Berlin, Germany", "Remote"][i] ?? "",
		period: `${2020 - i} – ${2021 - i}`,
		dates: { start: String(2020 - i), end: String(2021 - i), present: false },
		roles: [],
		website: { url: "", label: "", inlineLink: false },
		description: `<ul><li>Built <strong>Important Systems ${i}</strong> for <em>Customers Worldwide</em> With Reliable Tools Across Every Supported Platform And All Supported Devices.</li><li>Completed achievement ${i} with exact wording.</li></ul>`,
	}));
	const role = data.sections.experience.items[c.index];
	if (!role) throw new Error("Missing indexed role");
	if (c.kind !== "identity") {
		role.period = c.period;
		role.dates = {
			start: c.period === "2018" ? "2018" : c.period === "Jan 2020" ? "2020-01" : c.period ? "2020" : null,
			end: c.period.includes("–") ? "2021" : null,
			present: false,
		};
	}
	if (c.kind === "wrapped") {
		role.company = "The Extremely Long Fictional Enterprise Technology Corporation International";
		role.position = "Principal Engineer for Platform Reliability and Developer Experience";
		role.location = "Mountain View, California, United States";
		if (c.index) {
			role.company = "International Institute for Accessible Platforms and Distributed Product Systems";
			role.position = "Senior Director of Engineering for Customer Reliability and Developer Enablement";
			role.location = "São Paulo, State of São Paulo, Federative Republic of Brazil";
		}
	}
	return data;
}

export const pdfExperienceFields = (items: ReturnType<typeof pdfImportSource>["sections"]["experience"]["items"]) =>
	items.map(({ company, position, location, period, description }) => ({
		company,
		position,
		location,
		period,
		description: description.replace(/<\/?(?:strong|em)>/g, ""),
	}));
