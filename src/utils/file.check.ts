// A reviewer downloads a whole section at once, so the filenames have to sort and not collide:
// node --import tsx --test <this file>
import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewerPdfName } from "./file";

test("the roll number leads, so a folder of downloads sorts like the college's list", () => {
	assert.equal(reviewerPdfName("23071A0501", "Rahul Kumar"), "23071A0501-RAHUL-KUMAR.pdf");
	assert.equal(reviewerPdfName("23071A0510", "A"), "23071A0510-A.pdf");
});

test("a missing roll number or name still gives a usable file", () => {
	assert.equal(reviewerPdfName(null, "Rahul Kumar"), "RAHUL-KUMAR.pdf");
	assert.equal(reviewerPdfName("23071A0501", null), "23071A0501.pdf");
	assert.equal(reviewerPdfName("  ", ""), "RESUME.pdf");
});

test("punctuation a name carries never reaches the filesystem", () => {
	assert.equal(reviewerPdfName("23071A0501", "D'Souza, Mary-Jane"), "23071A0501-DSOUZA-MARY-JANE.pdf");
	assert.equal(reviewerPdfName("23/071/A", "Ravi"), "23071A-RAVI.pdf");
	assert.equal(reviewerPdfName(null, "Ramesh   Babu"), "RAMESH-BABU.pdf");
});
