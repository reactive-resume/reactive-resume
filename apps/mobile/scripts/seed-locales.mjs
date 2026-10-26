// Copies the web translations of every message the app uses into apps/mobile/locales/*.po, so the app ships in the
// web's 55 languages without new translation work. Run after `lingui extract` (`pnpm --filter mobile lingui:extract`
// does both); only empty translations are filled, so translations made for the app itself are kept.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatter } from "@lingui/format-po";

const mobileDir = fileURLToPath(new URL("../locales/", import.meta.url));
const webDir = fileURLToPath(new URL("../../web/locales/", import.meta.url));
const po = formatter({ lineNumbers: false });

let filled = 0;
for (const file of (await readdir(mobileDir)).filter((name) => name.endsWith(".po"))) {
	const locale = file.slice(0, -3);
	const ctx = { locale, sourceLocale: "en-US", filename: file };
	const mobileSource = await readFile(join(mobileDir, file), "utf8");
	const webSource = await readFile(join(webDir, file), "utf8").catch(() => null);
	if (!webSource) continue;

	const mobile = await po.parse(mobileSource, ctx);
	const web = await po.parse(webSource, ctx);
	let changed = 0;
	for (const [id, message] of Object.entries(mobile)) {
		const translation = web[id]?.translation;
		if (message.translation || !translation) continue;
		message.translation = translation;
		changed++;
	}
	if (changed === 0) continue;
	filled += changed;
	await writeFile(join(mobileDir, file), await po.serialize(mobile, { ...ctx, existing: mobileSource }));
}

console.info(`Seeded ${filled} translations from apps/web/locales.`);
