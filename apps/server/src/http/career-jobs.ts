import { timingSafeEqual } from "node:crypto";
import { runCareerJobs } from "@reactive-resume/api/features/career/jobs";
import { reportStorageCleanupSummary, runStorageCleanup } from "@reactive-resume/api/features/storage/cleanup";
import { env } from "@reactive-resume/env/server";

export async function handleCareerJobs(request: Request): Promise<Response> {
	const headers = { "Cache-Control": "no-store" };
	if (!env.CRON_SECRET) return new Response(null, { status: 404, headers });
	const supplied = Buffer.from(request.headers.get("authorization") ?? "");
	const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`);
	if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
		return new Response(null, { status: 401, headers });
	// The deployment's one-minute cron also drains durable post-delete storage cleanup. A cleanup failure must not
	// hide or repeat the career tick that already ran.
	const [career] = await Promise.all([
		runCareerJobs(),
		runStorageCleanup({ limit: 200 })
			.then(reportStorageCleanupSummary)
			.catch(() => console.error("[storage-cleanup] Scheduled work failed. Pending jobs will retry on a later tick.")),
	]);
	return Response.json(career, { headers });
}
