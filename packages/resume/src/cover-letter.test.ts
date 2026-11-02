import { describe, expect, it } from "vite-plus/test";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import {
	composeCoverLetter,
	copyCoverLetterStyle,
	coverLetterTextToHtml,
	createCoverLetterResumeData,
	detachEmbeddedLetters,
	greetingName,
} from "./cover-letter";

describe("detachEmbeddedLetters", () => {
	it("takes letters out of the resume and its layout, and returns each one", () => {
		const data = structuredClone(defaultResumeData);
		const letter = createCoverLetterResumeData({
			name: "Letter",
			recipient: "<p>Acme</p>",
			content: "<p>Hello</p>",
			style: copyCoverLetterStyle(data, "letters", "letter-1"),
		}).customSections[0];
		if (!letter) throw new Error("Missing letter section.");
		data.customSections = [
			{ ...letter, items: [...letter.items, { ...letter.items[0], id: "letter-2", hidden: true } as never] },
		];
		data.metadata.layout.pages = [
			{ fullWidth: false, main: ["experience", "letters"], sidebar: ["letters", "skills"] },
		];

		expect(detachEmbeddedLetters(data)).toEqual([
			{ sectionId: "letters", itemId: "letter-1", title: "Letter", recipient: "<p>Acme</p>", content: "<p>Hello</p>" },
			{ sectionId: "letters", itemId: "letter-2", title: "Letter", recipient: "<p>Acme</p>", content: "<p>Hello</p>" },
		]);
		expect(data.customSections).toEqual([]);
		expect(data.metadata.layout.pages).toEqual([{ fullWidth: false, main: ["experience"], sidebar: ["skills"] }]);
	});
});

describe("independent cover letters", () => {
	it("copies sender and style without linking source mutations or retaining private notes", () => {
		const source = structuredClone(defaultResumeData);
		source.basics.name = "Ada Lovelace";
		source.metadata.notes = "Private interview notes";
		const style = copyCoverLetterStyle(source, "old-section", "old-item");
		source.basics.name = "Changed later";
		source.metadata.page.marginX = 40;
		expect(style.basics.name).toBe("Ada Lovelace");
		expect(style.metadata.page.marginX).toBe(defaultResumeData.metadata.page.marginX);
		expect(style.metadata).not.toHaveProperty("notes");
		expect(style.metadata).not.toHaveProperty("layout");
		expect(style).toMatchObject({ sectionId: "old-section", itemId: "old-item" });
	});

	it("escapes generated plain text before inserting paragraph markup", () => {
		expect(coverLetterTextToHtml("  Hello <script>alert('x')</script> & team\nnext\n\nThanks\"  ")).toBe(
			"<p>Hello &lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; team<br />next</p><p>Thanks&quot;</p>",
		);
		expect(coverLetterTextToHtml("  ")).toBe("");
	});

	it("greets a first name, a title with the surname, a team as written, or the hiring team", () => {
		expect(greetingName("Dana Reyes")).toBe("Dana");
		expect(greetingName("  Dana  ")).toBe("Dana");
		expect(greetingName("Dr. Dana Reyes")).toBe("Dr. Reyes");
		expect(greetingName("ms Reyes")).toBe("ms Reyes");
		expect(greetingName("Design team")).toBe("Design team");
		expect(greetingName("Hiring Team")).toBeNull();
		expect(greetingName(" ")).toBeNull();
	});

	const words = {
		greeting: (name: string) => `Dear ${name},`,
		teamGreeting: "Dear hiring team,",
		hiringTeam: "Hiring team",
		signOff: "Kind regards,",
		formatDate: (date: string) => `on ${date}`,
	};

	it.each([
		{
			greeting: "Hallo <Dana>,",
			signOff: "Vielen Dank!",
			expected: "<p>Hallo &lt;Dana&gt;,</p><p>Body</p><p>Vielen Dank!</p>",
		},
		{
			greeting: null,
			signOff: "Kind regards,\nJordan <Reyes>\n+49 555 0100\njordan@example.com",
			expected:
				"<p>Dear hiring team,</p><p>Body</p><p>Kind regards,<br />Jordan &lt;Reyes&gt;<br />+49 555 0100<br />jordan@example.com</p>",
		},
		{ greeting: "", signOff: "", expected: "<p>Body</p>" },
		{ greeting: "  ", signOff: "  ", expected: "<p>Body</p>" },
		{ greeting: null, signOff: null, expected: "<p>Dear hiring team,</p><p>Body</p><p>Kind regards,<br />Jordan</p>" },
	])("respects custom or omitted greeting and sign-off: $greeting / $signOff", ({ greeting, signOff, expected }) => {
		const style = copyCoverLetterStyle(defaultResumeData);
		style.basics.name = "Jordan";
		expect(
			composeCoverLetter(
				{
					layout: "structured",
					recipient: "",
					content: "<p>Body</p>",
					recipientName: "",
					recipientCompany: "",
					letterDate: null,
					style,
					greeting,
					signOff,
				},
				words,
			).content,
		).toBe(expected);
	});

	it("composes structured letters around the body and leaves freeform letters as written", () => {
		const style = copyCoverLetterStyle(defaultResumeData);
		style.basics.name = "Jordan <Reyes>";
		const letter = {
			layout: "structured" as const,
			recipient: "<p>Unused</p>",
			content: "<p>Body</p>",
			recipientName: "Dana Reyes",
			recipientCompany: "Lumen & Co",
			letterDate: "2026-09-28",
			style,
		};
		expect(composeCoverLetter(letter, words)).toEqual({
			recipient: "<p>Dana Reyes<br />Lumen &amp; Co</p><p>on 2026-09-28</p>",
			content: "<p>Dear Dana,</p><p>Body</p><p>Kind regards,<br />Jordan &lt;Reyes&gt;</p>",
		});
		expect(
			composeCoverLetter({ ...letter, recipientName: "", recipientCompany: "", letterDate: null }, words),
		).toMatchObject({ recipient: "", content: expect.stringMatching(/^<p>Dear hiring team,<\/p>/) });
		// "Hiring team" stands in only above a company.
		expect(
			composeCoverLetter({ ...letter, recipientName: "", recipientCompany: "Lumen", letterDate: null }, words)
				.recipient,
		).toBe("<p>Hiring team<br />Lumen</p>");
		expect(composeCoverLetter({ ...letter, layout: "freeform" }, words)).toEqual({
			recipient: "<p>Unused</p>",
			content: "<p>Body</p>",
		});
	});
});
