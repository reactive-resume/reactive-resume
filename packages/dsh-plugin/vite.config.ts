import { defineConfig } from "vite-plus";

export default defineConfig({
	pack: {
		entry: ["src/index.ts"],
		outDir: "dist",
		format: ["esm"],
		dts: true,
		clean: true,
		outExtensions: () => ({ js: ".js" }),
	},
});
