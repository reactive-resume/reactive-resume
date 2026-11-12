import type { APIRequestContext } from "@playwright/test";

/**
 * The fictional account the Calm redesign boards draw (Alex Morgan, senior product designer, Lisbon), seeded
 * through the public API like every other fixture. Everything here is invented.
 *
 * The boards are drawn on Saturday 7 November 2026, 09:00 in Lisbon, so every date below is absolute. The server
 * stamps `updatedAt` itself: `times` in the result lists when each row should read as last changed, for the
 * caller to apply to its own disposable database (tooling/calm/seed.mjs does). This file has no imports that need
 * a bundler, so plain Node can load it.
 */

export const personaNow = "2026-11-07T09:00:00.000Z";
export const personaTimezone = "Europe/Lisbon";
/** Not a secret: the persona lives only in disposable local databases. */
export const personaPassword = "Password123!";

export const personaAccounts = {
	/** The full persona. */
	alex: { name: "Alex Morgan", username: "alex", email: "alex@example.com" },
	/** A new account with nothing in it, for the first-run and empty boards. */
	empty: { name: "Alex Morgan", username: "empty", email: "empty@example.com" },
	/** The full persona without an AI connection. */
	noai: { name: "Alex Morgan", username: "noai", email: "noai@example.com" },
} as const;

export type PersonaVariant = keyof typeof personaAccounts;

type Json = Record<string, unknown>;
// oxlint-disable-next-line typescript/no-explicit-any -- API responses are read loosely; the API validates what is sent.
type Loose = any;

/** A row and when it should read as created, last changed and moved to Trash. */
export type PersonaTime = {
	table: "resume" | "cover_letter" | "application" | "application_profile";
	id: string;
	at: string;
	created?: string;
	trashed?: string;
};

export type PersonaSeed = {
	variant: PersonaVariant;
	account: (typeof personaAccounts)[PersonaVariant] & { password: string };
	userId: string;
	aiProviderId: string | null;
	resumes: Record<string, string>;
	letters: Record<string, string>;
	applications: Record<string, string>;
	interviews: Record<string, string>;
	stories: string[];
	facts: string[];
	/** A throwaway offer on Lumen: its saved-item version is the one the server would give a fit check now. */
	versionProbeId: string | null;
	times: PersonaTime[];
};

const day = (date: string, time = "12:00") => `${date}T${time}:00.000Z`;
const paragraphs = (...lines: string[]) => lines.map((line) => `<p>${line}</p>`).join("");
const bullets = (...lines: string[]) => `<ul>${lines.map((line) => `<li><p>${line}</p></li>`).join("")}</ul>`;
const noLink = { url: "", label: "", inlineLink: false };

const summary =
	"Senior product designer with seven years in business software. I work on onboarding and design systems, and I start from what customers say and do rather than from what a team assumes. At Northwind Labs I lead onboarding and the design system; before that I designed checkout and invoicing for retail clients at Harbour Studio. I am most useful where research, interaction design and engineering meet, and I stay with the work after launch.";

const northwind = [
	"Created a design system used by six product teams.",
	"Redesigned onboarding, which lifted activation from 41% to 58%.",
	"Run more than 40 customer interviews a year.",
	"Plan each quarter's design work with the product and engineering leads.",
] as const;
const harbour = [
	"Designed checkout and invoicing for 30 retail clients; completed payments rose 12%.",
	"Tested each release with shop owners before it shipped.",
] as const;
const skills = [
	"Design systems",
	"Interaction design",
	"Product design",
	"Accessibility",
	"User research",
	"Figma",
	"Prototyping",
	"Workshop facilitation",
];

type ResumeContent = {
	headline: string;
	email: string;
	summary: string;
	northwind: readonly string[];
	harbour: readonly string[];
	/** Section ids per page, one column. */
	pages: string[][];
};

/** Fills a new resume's default data with the persona's content. */
function resumeData(base: Loose, content: ResumeContent) {
	const data = structuredClone(base);
	const id = () => crypto.randomUUID();
	data.basics = {
		...data.basics,
		name: "Alex Morgan",
		headline: content.headline,
		email: content.email,
		phone: "+351 912 345 678",
		location: "Lisbon, Portugal",
		website: { url: "https://rxresu.me/alex", label: "rxresu.me/alex" },
	};
	data.summary = { ...data.summary, title: "Summary", content: paragraphs(content.summary) };
	const job = (company: string, position: string, location: string, period: string, lines: readonly string[]) => ({
		id: id(),
		hidden: false,
		company,
		position,
		location,
		period,
		website: noLink,
		roles: [],
		description: bullets(...lines),
	});
	data.sections.experience.items = [
		job("Northwind Labs", "Senior product designer", "Lisbon", "Mar 2022 – Present", content.northwind),
		job("Harbour Studio", "Product designer", "Porto", "Jun 2019 – Feb 2022", content.harbour),
	];
	data.sections.education.items = [
		{
			id: id(),
			hidden: false,
			school: "University of Porto",
			degree: "Master's degree",
			area: "Multimedia design",
			grade: "",
			location: "",
			period: "2017 – 2019",
			website: noLink,
			description: "",
		},
	];
	data.sections.skills.items = skills.map((name) => ({
		id: id(),
		hidden: false,
		icon: "",
		iconColor: "",
		name,
		proficiency: "",
		level: 0,
		keywords: [],
	}));
	data.sections.languages.items = [
		{ id: id(), hidden: false, language: "English", fluency: "Native", level: 0 },
		{ id: id(), hidden: false, language: "Portuguese", fluency: "Professional", level: 0 },
	];
	const placed = new Set(content.pages.flat());
	const rest = [...data.metadata.layout.pages[0].main, ...data.metadata.layout.pages[0].sidebar].filter(
		(section: string) => !placed.has(section),
	);
	data.metadata.layout.pages = content.pages.map((main, index) => ({
		fullWidth: true,
		main: index === content.pages.length - 1 ? [...main, ...rest] : main,
		sidebar: [],
	}));
	data.metadata.page.locale = "en-GB";
	return data;
}

const lumenRequirements = [
	"Five or more years designing business software",
	"Has owned onboarding or activation for a product",
	"Has built or run a design system used by several teams",
	"Runs customer research and brings it to product decisions",
	"Plans work with product and engineering leads",
	"Prototypes and tests before release",
	"Designs to accessibility standards",
	"Works in Figma",
	"Experience in a regulated industry",
	"Has mentored or led other designers",
];

const posting = (company: string, role: string, lines: string[]) =>
	[`${company} is hiring a ${role.toLowerCase()}.`, "", "What you'll need:", ...lines.map((line) => `- ${line}`)].join(
		"\n",
	);

/**
 * Registers one persona account and fills it. `request` must be a fresh context: it leaves signed in, so
 * `request.storageState()` afterwards is that account's session.
 */
export async function seedPersona(
	request: APIRequestContext,
	options: {
		baseURL: string;
		variant?: PersonaVariant;
		/** An OpenAI-compatible endpoint the server may call (the e2e stub); without it no AI connection is made. */
		aiBaseURL?: string;
	},
): Promise<PersonaSeed> {
	const variant = options.variant ?? "alex";
	const account = { ...personaAccounts[variant], password: personaPassword };
	const headers = { origin: options.baseURL, referer: `${options.baseURL}/auth/register` };

	const call = async (method: "get" | "post" | "put" | "patch" | "delete", path: string, data?: unknown) => {
		const url = path.startsWith("/api/") ? path : `/api/openapi${path}`;
		const response = await request[method](url, { headers, ...(data === undefined ? {} : { data }) });
		const body = await response.text();
		if (!response.ok()) throw new Error(`${method.toUpperCase()} ${path} failed with ${response.status()}: ${body}`);
		return (body ? JSON.parse(body) : undefined) as Loose;
	};

	const signUp = await call("post", "/api/auth/sign-up/email", {
		name: account.name,
		email: account.email,
		password: account.password,
		username: account.username,
		displayUsername: account.username,
		callbackURL: "/dashboard",
	});
	await call("patch", "/auth/profile", { locale: "en-GB", timezone: personaTimezone });

	const seed: PersonaSeed = {
		variant,
		account,
		userId: signUp.user.id,
		aiProviderId: null,
		resumes: {},
		letters: {},
		applications: {},
		interviews: {},
		stories: [],
		facts: [],
		versionProbeId: null,
		times: [],
	};
	if (variant === "empty") return seed;

	if (variant === "alex" && options.aiBaseURL) {
		const provider = await call("post", "/ai-providers", {
			label: "Work OpenAI",
			provider: "openai",
			model: "gpt-5-mini",
			baseURL: options.aiBaseURL,
			apiKey: "sk-calm-not-a-real-key",
		});
		// A connection is switched on, and becomes the default, once its test passes.
		await call("post", `/ai-providers/${provider.id}/tests`);
		seed.aiProviderId = provider.id;
	}

	// --- Resumes ---------------------------------------------------------------------------------------------
	const email = account.email;
	const newResume = async (key: string, name: string, tags: string[], slug: string, content: ResumeContent) => {
		const id: string = await call("post", "/resumes", { name, tags, slug, locale: "en-GB", template: "onyx" });
		const { data } = await call("get", `/resumes/${id}`);
		await call("put", `/resumes/${id}`, { data: resumeData(data, content) });
		seed.resumes[key] = id;
		return id;
	};
	const onePage = [["summary", "experience", "education", "skills", "languages"]];

	const productDesigner = await newResume(
		"productDesigner",
		"Product designer",
		["Design", "Product"],
		"product-designer",
		{
			headline: "Senior product designer",
			email,
			summary,
			northwind,
			harbour,
			pages: onePage,
		},
	);
	await call("put", `/resumes/${productDesigner}`, { isPublic: true, isPrimary: true });

	const designLead = await newResume("designLead", "Design lead", ["Design"], "design-lead", {
		headline: "Design lead",
		email,
		summary:
			"Designer with seven years in business software, now leading the design system that six product teams share at Northwind Labs. I plan design work with product and engineering leads and start from what customers say and do.",
		northwind: [northwind[0], northwind[3], northwind[1]],
		harbour: [harbour[0]],
		pages: [
			["summary", "experience", "education"],
			["skills", "languages"],
		],
	});

	const oldDraft = await newResume("oldDraft", "Old draft", [], "old-draft", {
		headline: "Product designer",
		email,
		summary: "Product designer with seven years in business software.",
		northwind: northwind.slice(0, 2),
		harbour: harbour.slice(0, 1),
		pages: onePage,
	});
	const copy = await newResume("productDesignerCopy", "Product designer (copy)", [], "product-copy", {
		headline: "Senior product designer",
		email,
		summary,
		northwind,
		harbour,
		pages: onePage,
	});

	// --- Applications ----------------------------------------------------------------------------------------
	type Stage = "saved" | "applied" | "screening" | "interview" | "offer" | "closed";
	const newApplication = async (key: string, fields: Json, savedOn: string) => {
		const id: string = await call("post", "/applications", { ...fields, status: "saved", stageEnteredAt: savedOn });
		seed.applications[key] = id;
		return id;
	};
	const move = (id: string, status: Stage, on: string, more: Json = {}) =>
		call("put", `/applications/${id}`, { status, stageEnteredAt: on, ...more });
	const interview = async (key: string, applicationId: string, fields: Json) => {
		const before = new Set<string>(
			(await call("get", `/applications/${applicationId}`)).activity.map((entry: Loose) => entry.id),
		);
		const after = await call("post", `/applications/${applicationId}/interviews`, {
			timezone: personaTimezone,
			...fields,
		});
		seed.interviews[key] = after.activity.find((entry: Loose) => !before.has(entry.id)).id;
	};
	const note = (applicationId: string, text: string, date: string) =>
		call("post", `/applications/${applicationId}/notes`, { text, date });

	const lumen = await newApplication(
		"lumen",
		{
			company: "Lumen",
			role: "Senior product designer",
			location: "Lisbon · Hybrid",
			source: "LinkedIn",
			sourceUrl: "https://lumen.example/careers",
			tags: ["Design systems", "Hybrid"],
			notes: [
				"Team of nine designers; Priya leads design systems.",
				"Lisbon office; days a week not confirmed yet.",
				"Ask about the research budget.",
			].join("\n"),
			requirements: lumenRequirements,
			jobDescription: posting("Lumen", "Senior product designer", lumenRequirements),
			contacts: [
				{ name: "Marta Costa", type: "Recruiter", email: "marta.costa@lumen.example" },
				{ name: "Priya Raman", type: "Interviewer", role: "Design lead" },
				{ name: "Tomás Silva", type: "Interviewer", role: "Engineering manager" },
			],
		},
		"2026-10-24",
	);
	const parcel = await newApplication(
		"parcel",
		{
			company: "Parcel & Co.",
			role: "Design systems lead",
			location: "Remote",
			source: "Referral",
			sourceUrl: "https://parcel.example/jobs/design-systems-lead",
			tags: ["Design systems", "Remote"],
			jobDescription: posting("Parcel & Co.", "Design systems lead", lumenRequirements.slice(2, 7)),
			contacts: [{ name: "Rui Almeida", type: "Hiring manager", email: "rui.almeida@parcel.example" }],
		},
		"2026-09-29",
	);
	const orbital = await newApplication(
		"orbital",
		{
			company: "Orbital Health",
			role: "Staff product designer",
			location: "Remote",
			source: "Company site",
			sourceUrl: "https://orbitalhealth.example/careers/staff-product-designer",
			tags: ["Remote"],
			jobDescription: posting("Orbital Health", "Staff product designer", lumenRequirements.slice(0, 5)),
		},
		"2026-10-20",
	);
	const fieldnote = await newApplication(
		"fieldnote",
		{
			company: "Fieldnote",
			role: "Staff designer",
			location: "Porto",
			source: "LinkedIn",
			sourceUrl: "https://fieldnote.example/jobs/staff-designer",
			jobDescription: posting("Fieldnote", "Staff designer", lumenRequirements.slice(1, 6)),
			contacts: [{ name: "Sofia Marques", type: "Recruiter", email: "sofia.marques@fieldnote.example" }],
		},
		"2026-10-26",
	);
	const kiln = await newApplication(
		"kiln",
		{
			company: "Kiln Studio",
			role: "Senior product designer",
			location: "Lisbon · Hybrid",
			source: "Company site",
			sourceUrl: "https://kilnstudio.example/careers",
			tags: ["Hybrid"],
			jobDescription: posting("Kiln Studio", "Senior product designer", [
				"Looks after a design system at scale",
				"Shares research across teams",
				"Tests with real users",
			]),
		},
		"2026-11-05",
	);
	const halden = await newApplication(
		"halden",
		{ company: "Halden", role: "Product designer", location: "Remote", source: "LinkedIn" },
		"2026-10-01",
	);
	const brightwell = await newApplication(
		"brightwell",
		{ company: "Brightwell", role: "Product designer", location: "Remote", source: "LinkedIn" },
		"2026-10-22",
	);

	// --- Documents made for a job ----------------------------------------------------------------------------
	const lumenResume: string = await call("post", "/documents/copy-for-job", {
		resumeId: productDesigner,
		applicationId: lumen,
		name: "Product designer · Lumen",
	});
	seed.resumes.lumen = lumenResume;
	{
		const { data } = await call("get", `/resumes/${lumenResume}`);
		data.summary.content = paragraphs(
			"Senior product designer with seven years in business software. At Northwind Labs I lead onboarding and the design system that six product teams share, and I start from what customers say and do.",
		);
		data.sections.experience.items[0].description = bullets(northwind[1], northwind[0], northwind[2], northwind[3]);
		await call("put", `/resumes/${lumenResume}`, { data });
	}

	const newLetter = async (key: string, fields: Json) => {
		const letter = await call("post", "/cover-letters", {
			template: "onyx",
			greeting: "Dear hiring team,",
			signOff: "Kind regards,",
			...fields,
		});
		seed.letters[key] = letter.id;
		return letter.id as string;
	};
	const lumenLetter = await newLetter("lumen", {
		name: "Lumen · Senior product designer",
		applicationId: lumen,
		resumeId: lumenResume,
		recipientName: "Priya Raman",
		recipientCompany: "Lumen",
		letterDate: "2026-11-02",
		greeting: "Dear Priya,",
		content: paragraphs(
			"I am applying for the senior product designer role at Lumen. Your posting asks for someone to own onboarding and to look after a design system that several teams share. That is the work I do now.",
			"At Northwind Labs I redesigned onboarding, and activation rose from 41% to 58%. Most of that came from listening first: I run more than 40 customer interviews a year, and the new flow follows the order customers described to us. I also created the design system that six product teams use, so I know what it takes to keep one consistent while each team ships at its own pace.",
			"Before that, at Harbour Studio in Porto, I designed checkout and invoicing for 30 retail clients, and completed payments rose 12%. I live in Lisbon, so the hybrid week suits me. I would be glad to walk you through the onboarding work in detail.",
		),
	});
	const kilnLetter = await newLetter("kiln", {
		name: "Kiln Studio · Senior product designer",
		applicationId: kiln,
		resumeId: productDesigner,
		recipientName: "Hiring team",
		recipientCompany: "Kiln Studio",
		letterDate: "2026-11-07",
		content: paragraphs(
			"I am applying for the senior product designer role at Kiln Studio. Your posting asks for someone who can look after a design system at scale, share research across teams and test with real users. That is the work I do now at Northwind Labs, and studio work is where I started.",
			"At Northwind Labs I created the design system that six product teams use, and I redesigned onboarding, which lifted activation from 41% to 58%. Most of that came from listening first: I run more than 40 customer interviews a year, and I plan each quarter's design work with the product and engineering leads, so what customers tell us shapes what gets built.",
			"Before that I spent nearly three years at Harbour Studio in Porto, designing checkout and invoicing for 30 retail clients. Completed payments rose 12%, and I tested each release with shop owners before it shipped. I live in Lisbon, so the hybrid week suits me, and I would be glad to walk you through the onboarding work in detail.",
		),
	});
	// The Kiln letter takes its design from the resume (L2 draws matching on); creating a letter leaves it off.
	await call("put", `/cover-letters/${kilnLetter}`, {
		expectedRevision: (await call("get", `/cover-letters/${kilnLetter}`)).revision,
		designLinked: true,
	});
	const brightwellLetter = await newLetter("brightwell", {
		name: "Brightwell · Product designer",
		applicationId: brightwell,
		resumeId: productDesigner,
		recipientName: "Hiring team",
		recipientCompany: "Brightwell",
		letterDate: "2026-10-27",
		content: paragraphs("I am applying for the product designer role at Brightwell."),
	});

	// --- Stages, interviews, notes ---------------------------------------------------------------------------
	// Moving to Applied with documents linked records them as sent on that day.
	await move(lumen, "applied", "2026-11-02", { resumeId: lumenResume, coverLetterId: lumenLetter });
	await move(lumen, "screening", "2026-11-05");
	await move(lumen, "interview", "2026-11-06");
	await interview("lumenScreening", lumen, {
		kind: "screening",
		at: day("2026-11-05", "11:00"),
		durationMinutes: 30,
		location: "Video call",
		audience: "recruiter",
		participants: [{ name: "Marta Costa", role: "Recruiter" }],
	});
	await interview("lumenTechnical", lumen, {
		kind: "technical",
		at: day("2026-11-10", "10:00"),
		durationMinutes: 60,
		location: "Video call",
		audience: "panel",
		participants: [
			{ name: "Priya Raman", role: "Design lead" },
			{ name: "Tomás Silva", role: "Engineering manager" },
		],
	});
	await note(lumen, "Replied · confirmed Tuesday at 10:00", "2026-11-05");

	await move(parcel, "applied", "2026-10-06", { resumeId: productDesigner });
	await move(parcel, "screening", "2026-10-14");
	await move(parcel, "interview", "2026-10-21");
	await move(parcel, "offer", "2026-11-05");
	await call("post", "/career/offers", {
		applicationId: parcel,
		version: "written",
		currency: "EUR",
		period: "year",
		base: 110_000,
		variable: null,
		variablePercent: 10,
		equity: "Stock options",
		location: "Remote · Lisbon hub 2 days a month",
		officeDays: 0,
		leave: "30 days",
		learning: 2000,
		respondBy: day("2026-11-13", "23:59"),
		startDate: "2027-01-04",
	});

	await move(orbital, "applied", "2026-10-27", { resumeId: productDesigner });
	await move(orbital, "screening", "2026-11-04");
	await interview("orbitalScreening", orbital, {
		kind: "screening",
		at: day("2026-11-09", "15:30"),
		durationMinutes: 30,
		location: "Video call",
		audience: "recruiter",
	});

	await move(fieldnote, "applied", "2026-10-28", {
		resumeId: productDesigner,
		followUpAt: day("2026-11-04", "00:00"),
		followUpDateOnly: true,
		followUpNote: "Send a follow-up",
	});

	await move(halden, "applied", "2026-10-05", { resumeId: productDesigner });
	await move(halden, "closed", "2026-10-19", { closedReason: "not-selected" });

	await move(brightwell, "applied", "2026-10-27", { resumeId: productDesigner, coverLetterId: brightwellLetter });

	// --- Locks and Trash -------------------------------------------------------------------------------------
	await call("post", "/documents/lock", { type: "resume", id: lumenResume, isLocked: true });
	await call("post", "/documents/lock", { type: "letter", id: lumenLetter, isLocked: true });
	await call("post", "/documents/trash", { type: "resume", id: oldDraft });
	await call("post", "/documents/trash", { type: "resume", id: copy });
	await call("post", "/documents/trash", { type: "letter", id: brightwellLetter });
	await call("post", `/applications/${brightwell}/trash`);

	// --- Career ----------------------------------------------------------------------------------------------
	await call("put", "/career/profile", {
		targetRoles: ["Senior product designer", "Lead product designer", "Design systems lead"],
		locations: ["Lisbon", "Remote"],
		priorities: "Design systems and onboarding work, a team that talks to customers, room to mentor.",
		minBase: { amount: 95_000, currency: "EUR", period: "year" },
		maxOfficeDays: 2,
		noticeWeeks: 8,
		memoryMode: "ask",
	});

	// Twelve facts, all quoted from the Product designer resume.
	const facts: Array<[text: string, category: string, quote: string]> = [
		["Redesigned onboarding at Northwind Labs. Activation rose from 41% to 58%.", "accomplishment", northwind[1]],
		["Built a design system that six product teams use.", "accomplishment", northwind[0]],
		["Runs more than 40 customer interviews a year at Northwind Labs.", "experience", northwind[2]],
		[
			"Designed checkout and invoicing for 30 retail clients at Harbour Studio. Completed payments rose 12%.",
			"accomplishment",
			harbour[0],
		],
		["Senior product designer at Northwind Labs in Lisbon since March 2022.", "experience", "Northwind Labs"],
		["Product designer at Harbour Studio in Porto, June 2019 to February 2022.", "experience", "Harbour Studio"],
		["Accessibility", "skill", "Accessibility"],
		["Studied at the University of Porto, 2017 to 2019.", "experience", "University of Porto"],
		["Design systems", "skill", "Design systems"],
		["User research", "skill", "User research"],
		["Prototyping", "skill", "Prototyping"],
		["Interaction design", "skill", "Interaction design"],
	];
	for (const [text, category, quote] of facts)
		seed.facts.push(
			(await call("post", "/career/facts", { text, category, source: { kind: "resume", id: productDesigner, quote } }))
				.id,
		);
	const factId = (text: string) => seed.facts[facts.findIndex((fact) => fact[0] === text)] as string;
	// Two facts forgotten since (C2 "2 · gone for good"); only their count and when stay. The caller dates them.
	for (const quote of ["Workshop facilitation", "Product design"]) {
		const { id } = await call("post", "/career/facts", {
			text: quote,
			category: "skill",
			source: { kind: "resume", id: productDesigner, quote },
		});
		await call("delete", `/career/facts/${id}`);
	}
	// One fact is kept but not used in coaching.
	await call("patch", `/career/facts/${factId("Studied at the University of Porto, 2017 to 2019.")}`, {
		status: "excluded",
	});

	const stories = [
		{
			title: "A design system six teams use",
			situation: "Six product teams at Northwind Labs each drew their own buttons, forms and tables.",
			task: "Give them one system without slowing any team down.",
			action:
				"I audited what every team had shipped, built the shared parts with two engineers, and moved one team at a time, starting with the team that had the most to gain.",
			result: "All six teams use it, and new screens ship without a design review of the basics.",
			factIds: [factId("Built a design system that six product teams use.")],
			tags: ["Design systems", "Leadership"],
		},
		{
			title: "Onboarding that lifted activation",
			situation: "Four in ten new accounts at Northwind Labs finished setting up.",
			task: "Find where people stopped and why.",
			action:
				"I interviewed customers who had given up, rebuilt the flow in the order they described their own work, and tested it with five of them before release.",
			result: "Activation rose from 41% to 58%.",
			factIds: [factId("Redesigned onboarding at Northwind Labs. Activation rose from 41% to 58%.")],
			tags: ["Onboarding", "Research"],
		},
		{
			title: "Testing checkout with shop owners",
			situation: "Harbour Studio's retail clients lost payments at checkout.",
			task: "Redesign checkout and invoicing for 30 shops with different needs.",
			action: "I sat with shop owners while they took real orders and tested each release with them before it shipped.",
			result: "Completed payments rose 12%.",
			factIds: [
				factId("Designed checkout and invoicing for 30 retail clients at Harbour Studio. Completed payments rose 12%."),
			],
			tags: ["Research"],
		},
	];
	for (const story of stories) seed.stories.push((await call("post", "/career/stories", story)).id);

	await call("put", "/application-profile", {
		expectedRevision: null,
		data: {
			givenName: "Alex",
			familyName: "Morgan",
			email,
			phone: "+351 912 345 678",
			links: [
				{ label: "Portfolio", url: "https://alex.example.com" },
				{ label: "Public resume", url: "https://rxresu.me/alex" },
			],
			address: { city: "Lisbon", countryCode: "PT" },
			workAuthorization: [{ countryCode: "PT", authorized: "yes", needsSponsorship: "no" }],
			requestedSalary: { amount: 105_000, currency: "EUR", period: "year" },
			references: [
				{
					name: "Inês Duarte",
					relationship: "Former manager",
					company: "Harbour Studio",
					email: "ines.duarte@example.com",
					phone: "+351 912 000 111",
				},
			],
		},
	});

	// A briefing a day before the Lumen interview; Fieldnote's follow-up reminder was made with its follow-up date.
	// Role discovery needs a web search provider, which the persona doesn't have: the caller adds that schedule.
	if (seed.aiProviderId)
		await call("post", "/career/schedules", {
			kind: "prepare",
			applicationId: lumen,
			interviewId: seed.interviews.lumenTechnical,
			lead: "24h",
			nextRunAt: day("2026-11-09", "10:00"),
			timezone: personaTimezone,
			locale: "en-GB",
			aiProviderId: seed.aiProviderId,
		});

	// S5's two keys; the caller sets their dates. The key itself is shown once and not kept.
	if (variant === "alex") {
		await call("post", "/auth/api-keys", { name: "Claude Desktop", expiresIn: 85 * 86_400, access: "read" });
		await call("post", "/auth/api-keys", { name: "Portfolio site", expiresIn: null, access: "full" });
	}

	// Last, so nothing after it changes what the coach would read for Lumen.
	seed.versionProbeId = (
		await call("post", "/career/offers", {
			applicationId: lumen,
			version: "verbal",
			currency: "EUR",
			period: "year",
			base: null,
			variable: null,
		})
	).id;

	seed.times = [
		{ table: "resume", id: productDesigner, at: day("2026-11-07", "08:44"), created: day("2026-09-14", "10:00") },
		{
			table: "resume",
			id: designLead,
			at: day("2026-11-03", "17:10"),
			created: day("2026-10-12", "09:00"),
		},
		{ table: "resume", id: lumenResume, at: day("2026-11-02", "16:40"), created: day("2026-10-30", "11:00") },
		{ table: "cover_letter", id: lumenLetter, at: day("2026-11-02", "16:55"), created: day("2026-10-31", "10:00") },
		{
			table: "cover_letter",
			id: kilnLetter,
			at: day("2026-11-06", "18:30"),
			created: day("2026-11-05", "14:00"),
		},
		{
			table: "resume",
			id: oldDraft,
			at: day("2026-10-30", "12:00"),
			created: day("2026-08-02", "12:00"),
			trashed: day("2026-11-07", "08:50"),
		},
		{
			table: "cover_letter",
			id: brightwellLetter,
			at: day("2026-10-27", "12:00"),
			created: day("2026-10-26", "12:00"),
			trashed: day("2026-11-03", "09:30"),
		},
		{
			table: "resume",
			id: copy,
			at: day("2026-10-12", "12:00"),
			created: day("2026-10-12", "11:00"),
			trashed: day("2026-10-21", "15:00"),
		},
		{ table: "application", id: fieldnote, at: day("2026-10-28", "10:15"), created: day("2026-10-26", "12:00") },
		{ table: "application", id: orbital, at: day("2026-11-04", "14:00"), created: day("2026-10-20", "12:00") },
		{ table: "application", id: lumen, at: day("2026-11-06", "17:20"), created: day("2026-10-24", "12:00") },
		{ table: "application", id: parcel, at: day("2026-11-07", "07:00"), created: day("2026-09-29", "12:00") },
		{ table: "application", id: kiln, at: day("2026-11-05", "14:05"), created: day("2026-11-05", "12:00") },
		{ table: "application", id: halden, at: day("2026-10-19", "12:00"), created: day("2026-10-01", "12:00") },
		{
			table: "application",
			id: brightwell,
			at: day("2026-10-27", "12:00"),
			created: day("2026-10-22", "12:00"),
			trashed: day("2026-11-03", "09:30"),
		},
		{ table: "application_profile", id: seed.userId, at: day("2026-11-02", "18:20") },
	];
	return seed;
}
