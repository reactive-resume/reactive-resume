import { describe, expect, it } from "vite-plus/test";
import { matchJobDescription } from "./match";
import { tokenize } from "./tokenize";

describe("tokenize", () => {
	it("keeps technical surface forms intact", () => {
		expect(tokenize("c++ and c# with .net")).toEqual(["c++", "and", "c#", "with", ".net"]);
		expect(tokenize("node.js, ci/cd, back-end")).toEqual(["node.js", "ci/cd", "back-end"]);
	});

	it("does not glue a sentence-ending full stop onto the next word", () => {
		expect(tokenize("shipped react. built node services")).toEqual(["shipped", "react", "built", "node", "services"]);
	});
});

describe("matchJobDescription", () => {
	it("matches a posting's abbreviation against the resume's spelled-out form", () => {
		const report = matchJobDescription({
			jobDescription: "Requirements\n- Strong K8s experience\n- Solid JS fundamentals",
			resumeText: "Ran Kubernetes clusters and wrote JavaScript services.",
		});

		expect(report.missingTerms).not.toContain("kubernetes");
		expect(report.missingTerms).not.toContain("javascript");
	});

	it("ignores the boilerplate every posting shares", () => {
		const report = matchJobDescription({
			jobDescription: "We are an equal opportunity employer offering a competitive salary and benefits package.",
			resumeText: "Engineer.",
		});

		expect(report.terms).toEqual([]);
		expect(report.weightedCoverage).toBe(0);
	});

	it("flags a term the resume repeats far past what the posting asks for", () => {
		const report = matchJobDescription({
			jobDescription: "Requirements\n- Kubernetes experience",
			resumeText: "kubernetes ".repeat(12),
		});

		expect(report.stuffedTerms).toContain("kubernetes");
	});

	it("does not accuse a specialist of stuffing their own field", () => {
		// A game developer writes "Unity" in every role; the posting writes it once. That is a
		// resume doing its job, not someone gaming a search.
		const resumeText = [
			"Senior Game Developer at Cascade Studios, building gameplay systems in Unity for console and PC.",
			"Led the Unity migration for two shipped titles and mentored four engineers through it.",
			"Built custom Unity editor tooling that cut level iteration time by forty percent.",
			"Earlier: Unity gameplay programmer on a mobile title with two million installs.",
			"Wrote the studio's internal Unity style guide and ran its onboarding sessions.",
		].join(" ");

		const report = matchJobDescription({
			jobDescription: "Requirements\n- Strong Unity experience",
			resumeText,
		});

		expect(report.missingTerms).not.toContain("unity");
		expect(report.stuffedTerms).toEqual([]);
	});

	it("drops recruiting filler from a phrase rather than reporting it as its own gap", () => {
		const report = matchJobDescription({
			jobDescription: "Requirements\n- Deep C# knowledge and strong C++ expertise",
			resumeText: "Shipped systems in C# and C++.",
		});

		expect(report.terms.map((term) => term.term)).not.toContain("c# knowledge");
		expect(report.missingTerms).toEqual([]);
	});
});

describe("matchJobDescription on a senior posting (J2-04)", () => {
	const northwind = [
		"Director of Engineering, Payments Platform — Northwind Labs (Berlin, hybrid)",
		"",
		"About the role",
		"Northwind Labs is hiring a Director of Engineering to lead our Payments Platform group (5 teams, ~45 engineers). You will own reliability, PCI DSS compliance and the roadmap for card acquiring and payouts across 14 European markets.",
		"",
		"What you'll do",
		"- Lead and grow engineering managers and staff engineers across five teams",
		"- Own availability (99.99%) and incident response for payment rails",
		"- Partner with Product and Risk on a multi-year platform strategy",
		"- Drive hiring, career frameworks and performance calibration",
		"",
		"What we're looking for",
		"- 12+ years in software engineering, 5+ years managing managers",
		"- Experience with payments, fintech or regulated environments (PCI DSS, PSD2)",
		"- Track record of scaling distributed systems (Kafka, Kubernetes, Go or Java)",
		"- Excellent stakeholder communication in English; German is a plus",
		"",
		"Salary: €165,000 – €190,000 + equity",
	].join("\n");

	const parcel = [
		"Head of Engineering — Parcel & Co. (Lisbon)",
		"",
		"Parcel & Co. is hiring a Head of Engineering to report to the CEO and own technical direction for our logistics marketplace.",
		"",
		"Requirements",
		"- 10+ years building products, 3+ years leading engineering teams",
		"- Background in marketplace or logistics systems, with carrier integrations",
		"- Make build-vs-buy decisions and improve deployment frequency across multiple teams",
		"- Coach managers through changes; DORA metrics experience is nice-to-have",
		"- Python and AWS, event-driven architecture; Portuguese is a plus",
		"",
		"What we offer",
		"- 25 days holiday",
		"- Relocation support to Lisbon",
		"- Learning budget",
		"- Next steps: two interviews",
	].join("\n");

	const termsOf = (jobDescription: string, extra: { company?: string; location?: string } = {}) =>
		matchJobDescription({ jobDescription, resumeText: "Engineering leader.", ...extra }).terms.map((term) => term.term);

	it("leaves out the employer, place, pay, perks and plain numbers", () => {
		const terms = termsOf(northwind, { company: "Northwind Labs", location: "Berlin (hybrid)" });

		for (const noise of ["northwind", "northwind labs", "labs", "berlin", "hybrid", "equity", "salary"])
			expect(terms).not.toContain(noise);
		expect(terms.filter((term) => /(?:^|\s)[~€$]?\d[\d.,]*(?:\+|%|k|m)?(?:\s|$)/.test(term))).toEqual([]);
		expect(terms).not.toContain("five");
	});

	it("leaves out single generic verbs and adjectives but keeps real skills", () => {
		const terms = termsOf(northwind, { company: "Northwind Labs", location: "Berlin (hybrid)" });

		for (const noise of ["drive", "grow", "partner", "lead", "multi-year", "frameworks", "rails"])
			expect(terms).not.toContain(noise);
		for (const skill of ["kafka", "kubernetes", "go", "java", "pci-dss", "psd2", "fintech"])
			expect(terms).toContain(skill);
	});

	it("finds the employer and place in a pasted posting with no application", () => {
		const terms = termsOf(parcel);

		for (const noise of ["parcel", "parcel co", "lisbon", "relocation", "days holiday", "holiday", "ceo", "next"])
			expect(terms).not.toContain(noise);
		for (const noise of ["changes", "background", "multiple", "nice-to-have", "coach", "head", "improve deployment"])
			expect(terms).not.toContain(noise);
		for (const skill of ["python", "aws", "event-driven", "carrier integrations", "dora metrics", "logistics"])
			expect(terms).toContain(skill);
	});

	it("counts only the remaining terms", () => {
		const report = matchJobDescription({ jobDescription: parcel, resumeText: "Python and AWS." });

		expect(report.totalTerms).toBe(report.terms.length);
		expect(report.matchedCount + report.missingTerms.length).toBe(report.totalTerms);
	});
});

describe("matchJobDescription keeps concrete skills while dropping noise", () => {
	const termsOf = (jobDescription: string, extra: { company?: string; location?: string } = {}) =>
		matchJobDescription({ jobDescription, resumeText: "Engineer.", ...extra }).terms.map((term) => term.term);

	it("reads a list of tools after a title's dash as skills, not the employer", () => {
		const terms = termsOf(
			"Senior Product Designer — Figma, Sketch, SQL\nRequirements\n- Strong Figma and SQL skills\n- Docker for prototypes",
		);

		for (const skill of ["figma", "sketch", "sql", "docker", "product designer"]) expect(terms).toContain(skill);
	});

	it("keeps a tool that opens a sentence", () => {
		const terms = termsOf(
			"About the role\nDocker builds and SQL tuning are a daily part of this job.\nYou will write SQL every day and maintain Docker images.",
		);

		expect(terms).toContain("docker");
		expect(terms).toContain("sql");
	});

	it("reads an everyday-word skill that opens a bullet as the skill when it stands as an item", () => {
		const terms = termsOf(
			"Requirements\n- Go and Kubernetes in production\n- Experience with Spark\n- Next steps: a call",
		);

		expect(terms).toContain("go");
		expect(terms).toContain("kubernetes");
		expect(terms).not.toContain("next");
	});

	it("keeps multi-word skills that contain a generic word, without leaving fragments", () => {
		const terms = termsOf(
			"Requirements\n- Big data and hybrid cloud experience\n- Partner management\n- Technical lead experience",
		);

		for (const skill of ["big data", "hybrid cloud", "partner management", "technical lead"])
			expect(terms).toContain(skill);
		for (const fragment of ["big", "hybrid", "partner", "lead", "data", "cloud", "management", "technical"])
			expect(terms).not.toContain(fragment);
	});

	it("hides the employer as a whole name, not word by word", () => {
		const terms = termsOf("Requirements\n- Data modeling for Data Systems clients\n- SQL", {
			company: "Data Systems",
		});

		expect(terms).toContain("data modeling");
		for (const noise of ["data systems", "systems", "systems clients"]) expect(terms).not.toContain(noise);
	});

	it.each([
		["an em dash", "Staff Engineer — Observability", "observability"],
		["a hyphen", "Backend Engineer - Payments", "payments"],
		["a bar", "Product Manager | Checkout", "checkout"],
	])("reads a title's one-word tail after %s as the field, not the employer", (_name, title, skill) => {
		const field = skill.charAt(0).toUpperCase() + skill.slice(1);
		const terms = termsOf(`${title}\nRequirements\n- ${field} tooling in production\n- ${field} systems at scale`);

		expect(terms.some((term) => term.split(" ").includes(skill))).toBe(true);
	});

	it.each([
		[
			"the posting names it as hiring",
			"Senior Engineer — Fieldnote\nFieldnote is hiring a senior engineer.",
			"fieldnote",
		],
		["it carries a company suffix", "Senior Designer — Acme Corp\nRequirements\n- Figma prototyping", "acme corp"],
		["the title says at", "Data Engineer at Fieldnote\nRequirements\n- dbt and SQL", "fieldnote"],
	])("still leaves out a title's tail when %s", (_name, posting, employer) => {
		const terms = termsOf(`${posting}\n- Python`);

		expect(terms.filter((term) => term.includes(employer))).toEqual([]);
	});

	it.each([
		["help desk", "Requirements\n- 3+ years of help desk experience\n- Help desk ticketing in ServiceNow", "desk"],
		[
			"early childhood",
			"Requirements\n- Degree in early childhood education\n- Early childhood certification",
			"childhood",
		],
		[
			"quarterly business",
			"Requirements\n- Run quarterly business reviews\n- Quarterly business reviews and renewals",
			null,
		],
		["building codes", "Requirements\n- Knowledge of building codes\n- Building codes compliance", null],
	])("keeps %s whole when the posting repeats it", (phrase, posting, fragment) => {
		const terms = termsOf(posting);

		expect(terms).toContain(phrase);
		if (fragment) expect(terms).not.toContain(fragment);
	});

	it("drops a verb with its object, leaving no fragment behind", () => {
		const terms = termsOf("Requirements\n- Help desk experience\n- Drive hiring across the org\n- Python");

		for (const noise of ["desk", "drive hiring", "hiring"]) expect(terms).not.toContain(noise);
		expect(terms).toContain("python");
	});

	it.each([
		"Experience managing Workday",
		"Hands-on experience running Datadog",
		"Help scale Temporal",
		"Strong background building Pulumi",
		"Experience with modern Dagster",
		"Senior PagerDuty experience",
	])("keeps a named tool after a generic word: %s", (line) => {
		const tool = (line.split(" ").find((word, index) => index > 0 && /[A-Z]/.test(word)) ?? "").toLowerCase();
		const terms = termsOf(`Requirements\n- ${line}\n- Communication`);

		expect(terms.some((term) => term.split(/[\s-]/).includes(tool))).toBe(true);
	});

	it("doesn't take a capital at a line start or in a Title Case heading as naming the word", () => {
		const offer = termsOf(
			"Requirements\n- Help desk experience\n- Python\n\nWhat we offer\n- Desk budget for your home office",
		);
		const heading = termsOf("Senior Engineer at Fieldnote\nRequirements\n- Python and SQL");

		expect(offer).not.toContain("desk");
		expect(heading).not.toContain("engineer");
	});

	it("reads a title's tail as the employer when the posting says the job is at it", () => {
		const terms = termsOf("Staff Engineer — Fieldnote\nAt Fieldnote, we build tools for field teams.\n- Python");

		expect(terms.filter((term) => term.includes("fieldnote"))).toEqual([]);
	});

	it("doesn't read a team the posting asks you to join as the employer", () => {
		const terms = termsOf(
			"Senior Engineer — Search\nYou will join Search, a team of eight.\n- Search relevance tuning\n- Search ranking",
		);

		expect(terms.some((term) => term.split(" ").includes("search"))).toBe(true);
	});

	it("leaves out the company and city of a two-part details line", () => {
		const terms = termsOf("Fieldnote · Lisbon\nRequirements\n- Python and SQL");

		for (const noise of ["fieldnote", "lisbon"]) expect(terms).not.toContain(noise);
		expect(terms).toContain("python");
	});
});

it("a Help Desk term never suppresses the distinct named tool Zendesk", () => {
	const report = matchJobDescription({
		jobDescription: "Manage our Help Desk team of six\nExperience with Zendesk",
		resumeText: "Zendesk",
	});
	expect(report.matchedTerms).toContain("zendesk");
});
