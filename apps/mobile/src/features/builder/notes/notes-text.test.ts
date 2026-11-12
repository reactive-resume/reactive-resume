import { notesToText, textToNotes } from "./notes-text";

test("notes keep their lines and characters between HTML and plain text", () => {
	const text = "Ask Priya about the <Lumen> role\n\nSalary & start date\n";
	expect(notesToText(textToNotes(text))).toBe(text);
	expect(notesToText("<p>One<br>two</p><ul><li>three</li></ul>")).toBe("One\ntwo\nthree");
	expect(textToNotes("  ")).toBe("");
});
