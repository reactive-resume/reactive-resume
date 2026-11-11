import type { Scenario } from "../harness";
// Storyboard scenarios owned by screen agent C (see PLAN.md): the builder's Edit, Design and Check screens.
// `prepare` fills in what the storyboard draws and the shared fixture lacks (accent, type, languages, a profile, the
// B9 findings, the B10 link) straight into the open draft, so no undo step or save comes of it.
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { overBackdrop } from "../backdrop";
import { useResumeStore } from "@/data";
import { useBuilderStoryboard } from "@/features/builder/shared/storyboard";

const id = "resume-product";
const doc = `/builder/${id}`;
const base = ["/documents", doc];

async function opened() {
	for (let i = 0; i < 100; i++) {
		const s = useResumeStore.getState();
		if (s.data && s.document?.id === id) return s;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error("The storyboard resume didn't open.");
}

/** The resume as the boards draw it. */
async function patch(extra?: (data: ResumeData) => void, document?: Record<string, unknown>) {
	const s = await opened();
	const data = structuredClone(s.data) as ResumeData;
	data.metadata.design.colors.primary = "rgba(47, 90, 138, 1)";
	data.metadata.typography.heading.fontFamily = "EB Garamond";
	data.metadata.typography.body.fontFamily = "EB Garamond";
	data.metadata.typography.body.fontSize = 10.5;
	data.sections.languages.items = [
		{ id: "lang-en", hidden: false, language: "English", fluency: "Fluent", level: 0 },
		{ id: "lang-pt", hidden: false, language: "Portuguese", fluency: "Native", level: 0 },
	];
	extra?.(data);
	useResumeStore.setState({ data, ...(document && s.document ? { document: { ...s.document, ...document } } : {}) });
}

function addProfile(data: ResumeData) {
	data.sections.profiles.items = [
		{
			id: "profile-linkedin",
			hidden: false,
			icon: "",
			iconColor: "",
			network: "LinkedIn",
			username: "alexmorgan",
			website: { url: "https://linkedin.com/in/alexmorgan", label: "", inlineLink: false },
		},
	];
}

/** The findings the boards' Check shows (B9), which also light the Check warn dot on B1 and B6. */
function addFindings(data: ResumeData) {
	data.basics.website.url = "morgan.design";
	data.metadata.typography.body.lineHeight = 1.1;
}

const reset = () => useBuilderStoryboard.setState({ focus: null, proposal: null });
const prepared = (extra?: (data: ResumeData) => void, document?: Record<string, unknown>) => async () => {
	reset();
	await patch(extra, document);
};

export const scenarios: Record<string, Scenario> = {
	"B1-Overview": { hrefs: base, prepare: prepared(addFindings) },
	"B2-Section": { hrefs: [...base, `${doc}/section/experience`], prepare: prepared() },
	"B3-Entry": {
		hrefs: [...base, `${doc}/section/experience`, `${doc}/section/experience/northwind`],
		prepare: async () => {
			await prepared()();
			useBuilderStoryboard.setState({ focus: "position" });
			// One field edit to undo, as the board's status line shows.
			useResumeStore.setState({ canUndo: true });
		},
	},
	"B4-Improve": {
		hrefs: [
			...base,
			`${doc}/section/experience`,
			`${doc}/section/experience/northwind`,
			`${doc}/section/experience/northwind/description`,
		],
		prepare: async () => {
			await prepared()();
			useBuilderStoryboard.setState({
				proposal: {
					lineIndex: 1,
					action: "verb",
					parts: [
						{ text: "Created and scaled", added: true },
						{ text: " the design system " },
						{ text: "adopted", added: true },
						{ text: " by six product teams, cutting interface defects by a third." },
					],
				},
			});
		},
	},
	"B5-Basics": { hrefs: [...base, `${doc}/basics`], prepare: prepared(addProfile) },
	"B20-NewEntry": {
		hrefs: [...base, `${doc}/section/languages`, `${doc}/section/languages/new`],
		prepare: async () => {
			await prepared()();
			useBuilderStoryboard.setState({ focus: "language" });
		},
	},
	"B21-EntryActions": {
		hrefs: [...base, ...overBackdrop("B21-EntryActions", `${doc}/section/experience/northwind/actions?from=hold`)],
		prepare: prepared(),
	},
	"B6-Design": { hrefs: [...base, `${doc}/design`], prepare: prepared(addFindings) },
	"B7-Template": { hrefs: [...base, `${doc}/design`, `${doc}/design/template`], prepare: prepared() },
	"B8-Layout": { hrefs: [...base, `${doc}/design`, `${doc}/design/layout`], prepare: prepared() },
	"B9-Check": {
		hrefs: [...base, `${doc}/check`],
		prepare: prepared(addFindings),
	},
	"B10-JobMatch": {
		hrefs: [...base, `${doc}/check?view=job`],
		prepare: prepared(undefined, { applicationId: "lumen" }),
	},
};
