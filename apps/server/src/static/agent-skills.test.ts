import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vite-plus/test";
import { handleAgentSkillArchive, handleAgentSkillsIndex, loadAgentSkills } from "./agent-skills";

const skillsRoot = fileURLToPath(new URL("../../../../plugins/reactive-resume/skills", import.meta.url));

function listTarEntries(archive: Buffer) {
	const tar = gunzipSync(archive);
	const entries: string[] = [];
	for (let offset = 0; offset + 512 <= tar.length;) {
		const header = tar.subarray(offset, offset + 512);
		const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/s, "");
		if (!name) break;
		const size = Number.parseInt(header.subarray(124, 136).toString("utf8").replace(/\0.*$/s, ""), 8);
		entries.push(name);
		offset += 512 + Math.ceil(size / 512) * 512;
	}
	return entries;
}

describe("agent skills discovery", () => {
	it("lists every published skill as an archive whose digest matches the served bytes", async () => {
		const response = handleAgentSkillsIndex();
		const index = await response.json();

		expect(response.headers.get("Content-Type")).toBe("application/json");
		expect(index.$schema).toBe("https://schemas.agentskills.io/discovery/0.2.0/schema.json");
		expect(index.skills.map((skill: { name: string }) => skill.name)).toEqual(readdirSync(skillsRoot).toSorted());

		for (const skill of index.skills) {
			expect(skill).toMatchObject({ type: "archive", url: `/.well-known/agent-skills/${skill.name}.tar.gz` });
			expect(skill.description.length).toBeGreaterThan(0);
			const archive = handleAgentSkillArchive(`${skill.name}.tar.gz`);
			expect(archive.headers.get("Content-Type")).toBe("application/gzip");
			const bytes = Buffer.from(await archive.arrayBuffer());
			expect(`sha256:${createHash("sha256").update(bytes).digest("hex")}`).toBe(skill.digest);
		}
	});

	it("places SKILL.md at the archive root with only the skill's own files", () => {
		const skills = loadAgentSkills(skillsRoot);

		expect(skills.length).toBeGreaterThan(0);
		for (const skill of skills) {
			const root = join(skillsRoot, skill.name);
			const files = readdirSync(root, { recursive: true, withFileTypes: true })
				.filter((entry) => entry.isFile())
				.map((entry) => relative(root, join(entry.parentPath, entry.name)).split("\\").join("/"));
			const entries = listTarEntries(skill.archive);
			expect(entries).toContain("SKILL.md");
			expect(entries.toSorted()).toEqual(files.toSorted());
			expect(entries.every((path) => !path.startsWith("/") && !path.includes(".."))).toBe(true);
		}
	});

	it("returns 404 for unknown archives", () => {
		expect(handleAgentSkillArchive("missing.tar.gz").status).toBe(404);
		expect(handleAgentSkillArchive("../SKILL.md").status).toBe(404);
	});
});
