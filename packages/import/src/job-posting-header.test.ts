import { describe, expect, it } from "vite-plus/test";
import { readPastedPostingHeader } from "./job-posting";

describe("readPastedPostingHeader", () => {
	it("reads role, company and a parenthesised location from the first line, and a salary line", () => {
		const text = [
			"Director of Engineering, Payments Platform — Northwind Labs (Berlin, hybrid)",
			"",
			"About the role",
			"Salary: €165,000 – €190,000",
		].join("\n");
		expect(readPastedPostingHeader(text)).toEqual({
			role: "Director of Engineering, Payments Platform",
			company: "Northwind Labs",
			location: "Berlin, hybrid",
			salary: "€165,000 – €190,000",
		});
	});

	it("accepts 'at' and a labelled location", () => {
		expect(readPastedPostingHeader("Staff Designer at Fictional Co\nLocation: Remote (EU)")).toEqual({
			role: "Staff Designer",
			company: "Fictional Co",
			location: "Remote (EU)",
			salary: "",
		});
	});

	it("returns null when the first line isn't a header", () => {
		expect(readPastedPostingHeader("We are hiring a product manager to lead our growth team.")).toBeNull();
		expect(readPastedPostingHeader("")).toBeNull();
	});
});
