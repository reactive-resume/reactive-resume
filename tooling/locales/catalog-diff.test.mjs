import { expect, test } from "vite-plus/test";
import { compare, mismatch } from "./catalog-diff.mjs";

test.each([
	["Hello {name}", "Hallo {name}", ""],
	["Hello {name}", "Hallo {nom}", "missing {name}, extra {nom}"],
	["Hello {name}", "Hallo '{name}'", "missing {name}"],
	["{0, plural, one {item} other {items}}", "{0, plural, one {Element} other {Elemente}}", ""],
	["{0, plural, one {“{1}” once} other {“{2}” # times}}", "{0, plural, other {「{2}」が#回}}", ""],
	[
		"{0, plural, one {“{1}” once} other {“{2}” # times}}",
		"{0, plural, one {„{2}“} other {„{2}“ #-mal}}",
		"missing {1}",
	],
	[
		"{0, plural, one {# day} other {# days}}",
		"{count, plural, one {# Tag} other {# Tage}}",
		"missing {0, plural}, extra {count, plural}",
	],
	["by <0>Amruth</0>", "von Amruth", "missing <0>, missing </0>"],
	["{0, plural, one {{1} item} other {# items}}", "{0, plural, one {Element} other {{1} # Elemente}}", "missing {1}"],
	["{0, plural, one {# item} other {# items}}", "{0, plural, one {ein Element} other {Elemente}}", "missing #"],
	[
		"{0, select, mine {{1} is yours} other {{1} is shared}}",
		"{0, select, mine {{1} gehört dir} other {Geteilt}}",
		"missing {1}",
	],
	["{0, select, mine {Yours} other {Shared}}", "{0, select, mine {Deins}}", "missing other form in {0, select}"],
	[
		"{0, plural, one {{1} once} other {{2} # times}}",
		"{0, plural, =1 {{1} jednom} one {{2} # put} other {{2} # puta}}",
		"",
	],
	[
		"{0, plural, one {Item} other {{1} items}}",
		"{0, plural, one {Element}}",
		"missing {1}, missing other form in {0, plural}",
	],
	[
		"{name}: {0, plural, one {# file} other {# files}}",
		"{0, plural, one {{name}: # Datei} other {# Dateien}}",
		"missing {name}",
	],
	[
		"{0, plural, one {{1} once} other {# times}} {2, plural, one {day} other {# days}}",
		"{0, plural, one {einmal} other {# Mal}} {2, plural, one {{1} Tag} other {# Tage}}",
		"missing {1}",
	],
])("%s → %s", (source, translation, problem) => {
	expect(mismatch(source, translation)).toBe(problem);
});

test("a deleted catalog loses every translation it had", () => {
	const base = { a: { message: "Save", translation: "Speichern" }, b: { message: "Open", translation: "" } };
	expect(compare(base, undefined)).toMatchObject({ lost: ['"Save" was "Speichern" (catalog deleted)'], removed: 2 });
});
