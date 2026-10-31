import { reportStorageCleanupSummary, runStorageCleanup } from "@reactive-resume/api/features/storage/cleanup";

/** Retries durable post-delete storage cleanup. PostgreSQL leases jobs so server instances don't duplicate work. */
export function startStorageCleanupScheduler() {
	let stopped = false;
	let inFlight: Promise<void> | null = null;

	const tick = () => {
		if (stopped || inFlight) return;
		inFlight = Promise.resolve()
			.then(() => runStorageCleanup({ limit: 200 }))
			.then(reportStorageCleanupSummary)
			.then(() => undefined)
			.catch(() => {
				console.error("[storage-cleanup] Scheduled work failed. Pending jobs will retry on a later tick.");
			})
			.finally(() => {
				inFlight = null;
			});
	};

	const interval = setInterval(tick, 60_000);
	interval.unref();
	tick();

	return {
		stop: async () => {
			stopped = true;
			clearInterval(interval);
			await inFlight;
		},
	};
}
