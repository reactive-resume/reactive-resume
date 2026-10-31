// @vitest-environment happy-dom
import { describe, expect, it } from "vite-plus/test";
import { captureDocument } from "./content";

// Selection privacy runs in posting-capture-extension.spec.ts: happy-dom has no layout rectangles.
describe("interaction-scoped browser capture", () => {
	it("extracts one structured posting without unrelated DOM, form/session data or a provider request", () => {
		document.body.innerHTML = `<nav>UNRELATED</nav><aside>PRIVATE CHAT</aside><form><input value="PASSWORD"><textarea>SECRET TOKEN</textarea></form><main>ACCOUNT EMAIL</main>`;
		const script = document.createElement("script");
		script.type = "application/ld+json";
		script.textContent = JSON.stringify({
			"@type": "JobPosting",
			title: "Engineer",
			hiringOrganization: { name: "Fictional Co" },
			jobLocation: { address: { addressLocality: "Berlin", addressCountry: "DE" } },
			description: "<p>Build safe tools.</p><script>SESSION</script>",
		});
		document.body.append(script);
		const capture = captureDocument(document, "https://jobs.example.test/role?token=SECRET&utm_source=click");
		expect(capture).toMatchObject({
			role: "Engineer",
			company: "Fictional Co",
			location: "Berlin, DE",
			description: "Build safe tools.",
			url: "https://jobs.example.test/role",
		});
		expect(JSON.stringify(capture)).not.toMatch(/UNRELATED|PRIVATE|PASSWORD|SECRET|SESSION|ACCOUNT/);
	});
	it("does not fall back to the whole page when structured capture is unavailable", () => {
		document.body.innerHTML = "<main>PRIVATE ACCOUNT</main><form>SESSION</form>";
		document.getSelection()?.removeAllRanges();
		expect(captureDocument(document, "https://jobs.example.test/role").description).toBe("");
	});
});

it("rejects distinct same-title jobs while accepting identical SEO records", () => {
	const one = {
		"@type": "JobPosting",
		title: "Engineer",
		hiringOrganization: { name: "Fictional Co" },
		url: "https://jobs.example.test/one",
		description: "Berlin job",
	};
	document.getSelection()?.removeAllRanges();
	document.body.innerHTML = `<script type="application/ld+json">${JSON.stringify([one, { ...one, url: "https://jobs.example.test/two", description: "Paris job" }])}</script><article>Selected role only</article>`;
	expect(captureDocument(document, "https://jobs.example.test/list").description).toBe("");
	document.body.innerHTML = `<script type="application/ld+json">${JSON.stringify([one, { ...one }])}</script>`;
	expect(captureDocument(document, "https://jobs.example.test/one").description).toBe("Berlin job");
});
