import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, it } from "vite-plus/test";
import { generatePresentLabels, generateSectionTitleCatalog } from "./section-titles";

it("keeps PDF headings and the printed 'Present' synchronized with the source Lingui catalogs", async () => {
	const catalogs = fileURLToPath(new URL("../../apps/web/locales/", import.meta.url));
	const committed = async (path: string) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
	const titles = await generateSectionTitleCatalog(catalogs);
	const present = await generatePresentLabels(catalogs);
	expect(
		await committed("../../packages/pdf/src/section-title-catalog.json"),
		"Run pnpm pdf:translations after updating translations.",
	).toEqual(titles);
	expect(
		await committed("../../packages/schema/src/resume/present-labels.json"),
		"Run pnpm pdf:translations after updating translations.",
	).toEqual(present);
	expect(titles["es-ES"]?.Experience).toBe("Experiencia");
	expect(present["en-US"]).toBe("Present");
});
