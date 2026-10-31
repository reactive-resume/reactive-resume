import { pathToFileURL } from "node:url";
import { serve } from "@hono/node-server";
import { env } from "@reactive-resume/env/server";
import { runStartupChecks } from "./startup/checks";

export async function main() {
	await runStartupChecks();

	// Load and initialize auth only after migrations have created the provider tables.
	const { createApp } = await import("./http/app");
	const { initializeAuth } = await import("@reactive-resume/auth/config");
	await initializeAuth();
	const { startCareerScheduler } = await import("./startup/career-scheduler");
	const { startStorageCleanupScheduler } = await import("./startup/storage-cleanup");

	// Safety net: Node 24 crashes the whole process on an unhandled rejection. One request's
	// stray promise must not take the server down for everyone, so log and keep serving.
	// Registered after startup checks so a broken startup still fails loudly. (Left uncaught
	// exceptions on Node's default crash-and-restart, since process state is unsafe after one.)
	process.on("unhandledRejection", (reason) => {
		console.error("[unhandledRejection]", reason);
	});

	const port =
		process.env.NODE_ENV === "production" ? Number.parseInt(process.env.PORT ?? "3000", 10) : env.SERVER_PORT;

	const app = createApp();

	const server = serve(
		{
			fetch: app.fetch,
			port,
		},
		(info) => {
			console.info(`🚀 Up and running on http://localhost:${info.port}`);
		},
	);
	const careerScheduler = startCareerScheduler();
	const storageCleanupScheduler = startStorageCleanupScheduler();

	let shuttingDown = false;
	const shutdown = () => {
		if (shuttingDown) return;
		shuttingDown = true;
		// Stop accepting HTTP and scheduled work, then drain both before exiting.
		const httpDrain = new Promise<void>((resolve, reject) => {
			server.close((error) => {
				if (error) reject(error);
				else resolve();
			});
		});
		void Promise.allSettled([httpDrain, careerScheduler.stop(), storageCleanupScheduler.stop()]).then((results) => {
			const failed = results.some((result) => result.status === "rejected");
			if (failed) console.error("Failed to drain server work during shutdown.");
			process.exit(failed ? 1 : 0);
		});
	};
	process.once("SIGTERM", shutdown);
	process.once("SIGINT", shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error(error);
		process.exit(1);
	});
}
