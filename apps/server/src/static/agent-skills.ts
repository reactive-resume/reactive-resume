import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const SCHEMA_URL = "https://schemas.agentskills.io/discovery/0.2.0/schema.json";
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const cacheControl = "public, max-age=3600";

type AgentSkill = { name: string; description: string; archive: Buffer; digest: string };

function resolveSkillsRoot() {
	const candidates = [
		// Bundled layout: apps/server/dist/*.mjs -> apps/server/dist/agent-skills (emitted by tsdown.config.ts)
		fileURLToPath(new URL("./agent-skills", import.meta.url)),
		// Source layout: apps/server/src/static/agent-skills.ts -> plugins/reactive-resume/skills
		fileURLToPath(new URL("../../../../plugins/reactive-resume/skills", import.meta.url)),
	];

	return candidates.find((candidate) => existsSync(candidate));
}

function listFiles(root: string, prefix = ""): string[] {
	return readdirSync(join(root, prefix), { withFileTypes: true })
		.toSorted((a, b) => a.name.localeCompare(b.name))
		.flatMap((entry) => {
			const path = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) return listFiles(root, path);
			return entry.isFile() ? [path] : [];
		});
}

function tarHeader(path: string, size: number) {
	const header = Buffer.alloc(512);
	const field = (value: string, offset: number, length: number) => header.write(value, offset, length, "utf8");
	const octal = (value: number, offset: number, length: number) =>
		field(`${value.toString(8).padStart(length - 1, "0")}\0`, offset, length);

	if (Buffer.byteLength(path) > 100) throw new Error(`Agent skill path is too long for a tar header: ${path}`);
	field(path, 0, 100);
	octal(0o644, 100, 8);
	octal(0, 108, 8);
	octal(0, 116, 8);
	octal(size, 124, 12);
	// A fixed modification time keeps the archive, and so its published digest, stable across builds.
	octal(0, 136, 12);
	field("        ", 148, 8);
	field("0", 156, 1);
	field("ustar\0", 257, 6);
	field("00", 263, 2);

	const checksum = header.reduce((sum, byte) => sum + byte, 0);
	field(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8);
	return header;
}

/** A gzipped ustar archive with the skill's files at its root, as the discovery RFC requires. */
function buildArchive(directory: string) {
	const blocks = listFiles(directory).flatMap((path) => {
		const content = readFileSync(join(directory, path));
		const padding = Buffer.alloc((512 - (content.length % 512)) % 512);
		return [tarHeader(path, content.length), content, padding];
	});

	return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]), { level: 9 });
}

function readFrontmatterField(markdown: string, key: string) {
	const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown)?.[1] ?? "";
	const line = frontmatter.split(/\r?\n/).find((entry) => entry.startsWith(`${key}:`));
	return line?.slice(key.length + 1).trim();
}

let skills: AgentSkill[] | undefined;

export function loadAgentSkills(root = resolveSkillsRoot()): AgentSkill[] {
	if (!root) return [];

	return readdirSync(root, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, "SKILL.md")))
		.toSorted((a, b) => a.name.localeCompare(b.name))
		.flatMap((entry) => {
			const directory = join(root, entry.name);
			const markdown = readFileSync(join(directory, "SKILL.md"), "utf8");
			const name = readFrontmatterField(markdown, "name");
			const description = readFrontmatterField(markdown, "description");
			if (!name || name !== entry.name || !SKILL_NAME.test(name) || !description) return [];

			const archive = buildArchive(directory);
			const digest = `sha256:${createHash("sha256").update(archive).digest("hex")}`;
			return [{ name, description, archive, digest }];
		});
}

function getAgentSkills() {
	skills ??= loadAgentSkills();
	return skills;
}

export function handleAgentSkillsIndex() {
	const index = {
		$schema: SCHEMA_URL,
		skills: getAgentSkills().map(({ name, description, digest }) => ({
			name,
			type: "archive",
			description,
			url: `/.well-known/agent-skills/${name}.tar.gz`,
			digest,
		})),
	};

	return new Response(JSON.stringify(index), {
		headers: { "Content-Type": "application/json", "Cache-Control": cacheControl },
	});
}

export function handleAgentSkillArchive(filename: string) {
	const skill = getAgentSkills().find(({ name }) => `${name}.tar.gz` === filename);
	if (!skill) return new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });

	return new Response(new Uint8Array(skill.archive), {
		headers: {
			"Content-Type": "application/gzip",
			"Content-Length": String(skill.archive.length),
			"Cache-Control": cacheControl,
		},
	});
}
