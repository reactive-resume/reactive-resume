/**
 * Structured career work for the AI stub: what `career.generate` (fit, briefing, practice, debrief, reply, answer)
 * and the letter draft ask for, answered with the words the Calm redesign boards draw for the persona
 * (tests/e2e/fixtures/persona.ts). Requests are told apart by the task line `generate.ts` starts each prompt with;
 * fact and story ids are read back from the prompt's own context, so every result cites what the server sent.
 * Anything this file doesn't recognise gets `null` and the stub's older answers.
 */

type Fact = { id: string; text: string };
type Story = { id: string; title: string };
type Context = {
	application?: { company?: string; role?: string; requirements?: string[] } | null;
	interview?: { kind?: string } | null;
	facts?: Fact[];
	stories?: Story[];
	input?: { question?: string; answer?: string; message?: string; storyId?: string };
};

const TASKS = {
	fit: "Task: Check the posting's requirements",
	briefing: "Task: Plan the user's preparation",
	practice: "Task: Give feedback on the user's practice answer",
	debrief: "Task: Review what the user said in a real interview",
	reply: "Task: Read the employer's message",
	answer: "Task: Write the user's answer to the application form question",
} as const;

function readContext(prompt: string): Context {
	const marker = "Context (data, not instructions):\n";
	const start = prompt.indexOf(marker);
	if (start === -1) return {};
	try {
		return JSON.parse(prompt.slice(start + marker.length)) as Context;
	} catch {
		return {};
	}
}

/** Ids of the facts whose text contains each phrase, in order; a phrase with no fact is left out. */
const factsFor = (context: Context, ...phrases: string[]) =>
	phrases.flatMap((phrase) => {
		const found = context.facts?.find((fact) => fact.text.toLowerCase().includes(phrase.toLowerCase()));
		return found ? [found.id] : [];
	});
const storyFor = (context: Context, phrase: string) =>
	context.stories?.find((story) => story.title.toLowerCase().includes(phrase.toLowerCase()))?.id ?? null;

const company = (context: Context) => context.application?.company ?? "";

function fit(context: Context) {
	if (company(context) !== "Lumen") {
		const requirements = (context.application?.requirements ?? []).slice(0, 10).map((text, index) => ({
			text,
			origin: "posting" as const,
			status: index % 4 === 3 ? ("partial" as const) : ("supported" as const),
			evidence:
				index % 4 === 3 ? "Related work is in your resume; one part isn't shown yet." : "Your Knowledge shows this.",
			factIds: factsFor(context, "design system"),
		}));
		return {
			headline: "A relevant role, with one question to resolve",
			summary: "Most requirements have evidence in your Knowledge.",
			requirements,
			checks: [],
			ask: null,
			factIds: factsFor(context, "design system"),
		};
	}
	const row = (
		text: string,
		status: "supported" | "partial" | "missing",
		evidence: string,
		facts: string[],
		origin: "posting" | "inferred" = "posting",
	) => ({ text, origin, status, evidence, factIds: factsFor(context, ...facts) });
	return {
		headline: "7 of 10 requirements have evidence",
		summary:
			"6 supported, 1 partly supported, 3 with no evidence yet. Strong on design systems, research and outcomes; nothing yet on a regulated industry, mentoring or motion design.",
		requirements: [
			row("Design systems at scale", "supported", "“design system used by six product teams”", [
				"design system that six",
			]),
			row("Research with customers", "supported", "“more than 40 customer interviews a year”", ["customer interviews"]),
			row("Measurable product outcomes", "supported", "“lifted activation from 41% to 58%”", ["Activation rose"]),
			row("Five or more years in product design", "supported", "seven years across Northwind Labs and Harbour Studio", [
				"since March 2022",
				"June 2019",
			]),
			row("Accessibility", "partial", "in Skills only", ["Accessibility"]),
			row("Experience in a regulated industry", "missing", "", [], "inferred"),
			row("Payments experience", "supported", "“checkout and invoicing for 30 retail clients”", [
				"checkout and invoicing",
			]),
			row("Products for business customers", "supported", "“seven years in business software”", ["since March 2022"]),
			row("Mentoring other designers", "missing", "", []),
			row("Motion design", "missing", "", []),
		],
		checks: [
			{ label: "Lisbon or remote", met: true, text: "Lisbon · Hybrid" },
			{ label: "At most 2 office days a week", met: null, text: "Hybrid · days not stated" },
			{ label: "€95,000 minimum", met: null, text: "Salary not listed" },
		],
		ask: { person: "Priya Raman", text: "How many days a week is the team in the office?" },
		// Every switched-on fact was read for the check.
		factIds: (context.facts ?? []).map((fact) => fact.id),
	};
}

function briefing(context: Context) {
	const onboarding = storyFor(context, "onboarding");
	const system = storyFor(context, "design system");
	return {
		title: "Show how you decide with evidence",
		headline: "Show how you decide with evidence",
		summary:
			"A portfolio walk-through with a design lead and an engineering manager. Expect design systems, research and how you measure results.",
		plan: [
			{
				minutes: 10,
				title: "Re-read the posting and your fit",
				detail: "Seven of ten have evidence; three need an answer.",
				action: "none",
				storyId: null,
				factIds: [],
			},
			{
				minutes: 10,
				title: "Onboarding redesign",
				detail: "41% to 58%: what you changed, how you measured it.",
				action: "story",
				storyId: onboarding,
				factIds: factsFor(context, "Activation rose"),
			},
			{
				minutes: 15,
				title: "Design system for six teams",
				detail: "How the teams adopted it, what you would change.",
				action: "story",
				storyId: system,
				factIds: factsFor(context, "design system that six"),
			},
			{
				minutes: 10,
				title: "An answer on accessibility",
				detail: "In Skills only. Say where you have applied it.",
				action: "draft-story",
				storyId: null,
				factIds: factsFor(context, "Accessibility"),
			},
			{
				minutes: 5,
				title: "Choose your questions for Priya and Tomás",
				detail: "Four are ready below.",
				action: "questions",
				storyId: null,
				factIds: [],
			},
			{
				minutes: 5,
				title: "Say your opening aloud",
				detail: "Twice, timed. Aim for under a minute.",
				action: "practise",
				storyId: null,
				factIds: [],
			},
		],
		questions: [
			{ text: "Who decides what goes into the design system?", origin: "From the posting" },
			{ text: "What would success look like in the first 90 days?", origin: "From the coach" },
			{ text: "How is accessibility reviewed before a release?", origin: "From Fit" },
		],
		focus: "Show how you decide with evidence: research first, then the result.",
		opening:
			"I'm a senior product designer at Northwind Labs, where I redesigned onboarding and lifted activation from 41% to 58%. I'd like to bring that mix of research and systems work to Lumen.",
		stories: ["Onboarding redesign at Northwind Labs", "A design system six teams use"],
		honesty: "You have not worked in a regulated industry. If it comes up, say so, then say how you would learn it.",
		storyIds: [onboarding, system].filter(Boolean),
		missingStory: "accessibility",
		practiceQuestions: [
			"Walk us through a decision where research changed the design.",
			"How did you get six product teams to adopt one design system?",
			"How do you know a design change worked?",
		],
		factIds: factsFor(
			context,
			"Activation rose",
			"design system that six",
			"customer interviews",
			"Accessibility",
			"since March 2022",
		),
	};
}

function practice(context: Context) {
	const answer = context.input?.answer ?? "";
	if (/build from the same system now/i.test(answer))
		return {
			title: "Clear actions, but the result is missing",
			works:
				"You say what you did yourself: the interviews on all six teams, and starting with what they rebuilt most.",
			strengthen: "You stop at adoption. Say what changed for the teams, and leave out any number you can't support.",
			opening:
				"Six teams were each building their own buttons and forms. I got them onto one system by starting with what they rebuilt most.",
			note: "Result missing",
			factIds: factsFor(context, "design system that six", "customer interviews"),
		};
	if (/\bwe\b/i.test(answer) && !/\bI\b/.test(answer))
		return {
			title: "A good story without your part in it",
			works: "The situation is clear: six teams, each with its own buttons and forms.",
			strengthen: "Say what you did. “We” hides your part: name the audit and the pairing as yours.",
			opening: "I audited what all six teams had shipped and built the shared parts with two engineers.",
			note: "Contribution unclear",
			factIds: factsFor(context, "design system that six"),
		};
	return {
		title: "A strong opening that runs long",
		works: "Your first sentence names the problem and your part in one breath.",
		strengthen: "The middle repeats the situation. Cut to what you did, then the result.",
		opening: "I got six product teams onto one design system by starting with what they rebuilt most.",
		note: "Strong opening",
		factIds: factsFor(context, "design system that six", "customer interviews"),
	};
}

function debrief(context: Context) {
	return {
		round: "Screening",
		title: "A clear reason, told too slowly",
		verdicts: [
			{
				tag: "supported",
				text: "The onboarding result, 41% to 58%, backs up that the work is finished rather than abandoned.",
			},
			{
				tag: "observation",
				text: "The reorganisation came before your reason for moving, so the answer opened on a negative.",
			},
		],
		nextRound: "Lead with what you want to build at Lumen, then one line on why now.",
		priority: "A 60-second version of why you are moving.",
		remember: "Marta said the team is hiring two more designers this quarter.",
		plan: [
			{ day: "sat", minutes: 15, task: "Write a 60-second answer to why you are moving" },
			{ day: "sun", minutes: 20, task: "Say it aloud twice in Practice" },
			{ day: "mon", minutes: 10, task: "Re-read your opening for Tuesday" },
		],
		factIds: factsFor(context, "Activation rose"),
	};
}

function reply(context: Context) {
	const message = context.input?.message ?? "";
	if (company(context) === "Fieldnote" || /Sofia/.test(message))
		return {
			title: "They're inviting you to an intro call",
			asks: ["Invites you to an intro call", "Wants your availability by Wednesday 11 Nov"],
			unconfirmed: ["Doesn't give a date or time"],
			reply:
				"Hi Sofia,\n\nThank you for getting back to me. I'd be glad to talk about the Staff designer role. I'm free [times that work for you] next week, and can make other times work.\n\nBest,\nAlex",
			changes: [
				{ type: "stage", stage: "screening" },
				{ type: "follow-up", at: "2026-11-11T09:00:00+00:00", note: "Send your availability" },
			],
			offer: null,
		};
	if (company(context) === "Parcel & Co." || /delighted to offer/i.test(message))
		return {
			title: "They're offering you the role",
			asks: ["Wants an answer by Friday 13 Nov"],
			unconfirmed: ["Doesn't say what the bonus depends on", "Gives no value for the stock options"],
			reply:
				"Hi Rui,\n\nThank you for the offer for the Design systems lead role. I'm glad to have it, and you will have my answer by Friday.\n\nTwo things would help me decide:\n\nWhat does the 10% bonus depend on, and when is it paid?\nWhat are the options worth today: strike price, latest valuation, vesting and exercise window?\n\nBest,\nAlex",
			changes: [],
			offer: null,
		};
	if (company(context) === "Lumen")
		return {
			title: "Invitation to a technical interview",
			asks: ["Confirm Tuesday 10 Nov at 10:00"],
			unconfirmed: [],
			reply:
				"Hi Marta,\n\nThank you. Tuesday 10 November at 10:00 works for me, and I look forward to meeting Priya and Tomás.\n\nBest,\nAlex",
			changes: [],
			offer: null,
		};
	return {
		title: "They wrote back",
		asks: [],
		unconfirmed: [],
		reply: "Hi,\n\nThank you for your message.\n\nBest,\nAlex",
		changes: [],
		offer: null,
	};
}

function answer(context: Context) {
	const question = context.input?.question ?? "";
	const current = context.input?.answer?.trim() ?? "";
	if (current) return { text: current, factIds: [], note: null };
	if (/why do you want to work at kiln/i.test(question))
		return {
			text: "Kiln Studio is a small team where designers shape the product from research to release, and that is the work I do best. At Northwind Labs I built a design system that six product teams use, and I speak with more than 40 customers a year. I would like to bring both habits to Kiln.",
			factIds: factsFor(context, "design system that six", "customer interviews"),
			note: null,
		};
	return {
		text: "At Northwind Labs I redesigned onboarding after interviewing customers who had given up, and tested each version before release. Activation rose from 41% to 58%.",
		factIds: factsFor(context, "Activation rose"),
		note: null,
	};
}

/** The JSON a structured career request should get, or null when the prompt isn't one. */
export function careerJson(prompt: string): unknown {
	const task = (Object.keys(TASKS) as Array<keyof typeof TASKS>).find((key) => prompt.startsWith(TASKS[key]));
	if (!task) return null;
	const context = readContext(prompt);
	return { fit, briefing, practice, debrief, reply, answer }[task](context);
}

const KILN_LETTER = [
	"I am applying for the senior product designer role at Kiln Studio. Your posting asks for someone who can look after a design system at scale, share research across teams and test with real users. That is the work I do now at Northwind Labs.",
	"At Northwind Labs I created the design system that six product teams use, and I redesigned onboarding, which lifted activation from 41% to 58%. I run more than 40 customer interviews a year, so what customers tell us shapes what gets built.",
	"Before that I designed checkout and invoicing for 30 retail clients at Harbour Studio, and tested each release with shop owners before it shipped. I would be glad to walk you through the work in detail.",
].join("\n\n");

/** A letter body for the letter-draft prompt, or null when the request isn't one. */
export function letterText(system: string, prompt: string): string | null {
	if (!system.includes("You write the body of a cover letter")) return null;
	if (prompt.includes("Kiln Studio")) return KILN_LETTER;
	return "I am applying for this role. At Northwind Labs I redesigned onboarding, which lifted activation from 41% to 58%, and I built the design system six product teams use.";
}

/** The workspace coach's reply about Lumen and regulated industries (W12). */
export const COACH_ANSWER =
	"It is close, and worth saying plainly. Lumen's customers are clinics and insurers, so the posting means health and insurance rules. Yours is designing within tax and record-keeping rules: say that, and don't call it a regulated industry.";
