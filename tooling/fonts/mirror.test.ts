import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { planMirror, prepareMirror } from "./mirror";

afterEach(() => vi.unstubAllGlobals());

it("includes multilingual and symbol fallbacks and every weight without duplicate downloads", () => {
	const plan = planMirror(["Source Sans 3", "Source Sans 3"], ["zh-CN", "ar-SA"]);
	expect(plan.families).toEqual(
		expect.arrayContaining([
			"Noto Sans SC",
			"Noto Sans Arabic",
			"Noto Sans Symbols",
			"Noto Sans Symbols 2",
			"Noto Emoji",
		]),
	);
	expect(new Set(plan.files.map((file) => file.path)).size).toBe(plan.files.length);
	expect(() => planMirror(["Typo font"], [])).toThrow("Unknown font");
	expect(planMirror(["Arial"], []).families).toContain("Arimo");
	expect(planMirror(["Arial"], []).families).not.toContain("Arial");
});

it("publishes a checksummed manifest only after fonts and original notices are written", async () => {
	const directory = await mkdtemp(join(tmpdir(), "font-mirror-"));
	const plan = {
		families: ["Source Sans 3"],
		files: [{ source: "https://fonts.gstatic.com/s/test/a.ttf", path: "fonts.gstatic.com/s/test/a.ttf" }],
	};
	let broken = false;
	vi.stubGlobal("fetch", (source: string) =>
		Promise.resolve(
			new Response(
				source.includes("OFL.txt")
					? "Original copyright and license"
					: broken
						? "<html>Unavailable</html>"
						: new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
			),
		),
	);
	try {
		const manifest = await prepareMirror(plan, directory);
		expect(manifest.files[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
		expect(await readFile(join(directory, "licenses/Source Sans 3.txt"), "utf8")).toBe(
			"Original copyright and license",
		);
		expect(JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"))).toEqual(manifest);
		broken = true;
		await expect(prepareMirror(plan, join(directory, "broken"))).rejects.toThrow("mirror is incomplete");
		await expect(stat(join(directory, "broken/manifest.json"))).rejects.toMatchObject({ code: "ENOENT" });
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
