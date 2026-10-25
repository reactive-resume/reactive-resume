import type { careerScheduleInputSchema } from "@reactive-resume/schema/career";
import type z from "zod";
import { ORPCError } from "@orpc/client";
import { and, asc, desc, eq, inArray, isNull, lte, notInArray, or, sql } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import * as tables from "@reactive-resume/db/schema";
import { sendCareerNotification } from "@reactive-resume/email/transport";
import { env } from "@reactive-resume/env/server";
import { generateId } from "@reactive-resume/utils/string";
import { STALE_AGENT_RUN_TTL_MS } from "../agent/runs";
import { aiProvidersService } from "../ai-providers/service";
import { readOpenPosting, searchJobPostings } from "../applications/posting";
import { lockUser } from "../documents/ownership";
import { documentsService } from "../documents/service";
import { webAccessService } from "../web-access/credentials";
import { searchScope } from "../web-access/regions";
import { generateCareer } from "./generate";
import { matchPosting } from "./matching";
import { noticeText } from "./notices";
import { isCareerSchedulingEnabled } from "./runner";
import { canonicalOpportunityUrl, nextCareerRun, parseListingTitle, plainSnippet, prepareRunAt } from "./scheduling";
import { careerService, requireCareerApplication } from "./service";

const CAREER_URL = "/dashboard/career";
const workspaceUrl = (applicationId: string | null, tab?: string) =>
	applicationId ? `/dashboard/applications/${encodeURIComponent(applicationId)}${tab ? `/${tab}` : ""}` : CAREER_URL;

function assertRunner() {
	if (!isCareerSchedulingEnabled())
		throw new ORPCError("PRECONDITION_FAILED", {
			message: "Schedules aren't available on this server. Ask the server administrator to set CRON_SECRET.",
		});
}

// Enough for a discovery search per field plus briefings and follow-ups for a busy search.
const MAX_SCHEDULES_PER_USER = 100;
const READ_NOTIFICATION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
// Due jobs inspected per claim; owners that are busy or locked are skipped, not waited on.
const CLAIM_CANDIDATES = 20;

export const careerJobs = {
	list: (userId: string) =>
		db
			.select()
			.from(tables.careerSchedule)
			.where(eq(tables.careerSchedule.userId, userId))
			.orderBy(desc(tables.careerSchedule.createdAt)),
	save: async (userId: string, input: z.infer<typeof careerScheduleInputSchema> & { id?: string | undefined }) => {
		if (input.enabled) assertRunner();
		const application = await requireCareerApplication({ userId, ...input });
		// A briefing's run time follows its interview, so rescheduling the interview and saving again moves it.
		const interview = application?.activity.find(
			(entry) => entry.type === "interview" && entry.id === input.interviewId,
		);
		if (input.kind === "prepare" && interview?.type === "interview")
			input.nextRunAt = prepareRunAt(new Date(interview.at), input.lead ?? "24h", input.timezone);
		if (input.kind === "discovery" && !input.query)
			throw new ORPCError("BAD_REQUEST", { message: "Enter a job search query." });
		if (input.kind !== "discovery" && !input.applicationId)
			throw new ORPCError("BAD_REQUEST", { message: "Choose an application." });
		if (input.kind === "prepare" && !input.interviewId)
			throw new ORPCError("BAD_REQUEST", { message: "Choose an interview round." });
		if (input.kind === "prepare" && input.enabled) {
			if (!input.aiProviderId)
				throw new ORPCError("BAD_REQUEST", { message: "Choose a tested AI provider for scheduled preparation." });
			await aiProvidersService.getRunnableById({ userId, id: input.aiProviderId });
		} else if (input.aiProviderId) {
			// Any other schedule may name a connection too; it still has to be one of the account's own.
			const [provider] = await db
				.select({ id: tables.aiProvider.id })
				.from(tables.aiProvider)
				.where(and(eq(tables.aiProvider.id, input.aiProviderId), eq(tables.aiProvider.userId, userId)));
			if (!provider)
				throw new ORPCError("NOT_FOUND", { message: "That AI provider no longer exists. Choose another provider." });
		}
		if (input.email) {
			const [owner] = await db
				.select({ verified: tables.user.emailVerified })
				.from(tables.user)
				.where(eq(tables.user.id, userId));
			if (!owner?.verified || !env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS || !env.SMTP_FROM)
				throw new ORPCError("PRECONDITION_FAILED", {
					message:
						"Email reminders need a verified email address and email delivery on this server. Verify your email, or turn off email reminders.",
				});
		}
		const { id, ...values } = input;
		let keepQueuedAt: Date | null = null;
		return db.transaction(async (tx) => {
			if (id) {
				const [owned] = await tx
					.select()
					.from(tables.careerSchedule)
					.where(and(eq(tables.careerSchedule.id, id), eq(tables.careerSchedule.userId, userId)))
					.for("update");
				if (!owned) throw new ORPCError("NOT_FOUND");
				const ran = owned.lastQueuedAt && input.nextRunAt <= owned.lastQueuedAt ? owned.lastQueuedAt : null;
				// A briefing's time comes from its interview: one that already ran for that time stays done when switched
				// back on. Other schedules need a new time.
				if (input.kind === "prepare") keepQueuedAt = ran;
				else if (input.enabled && ran)
					throw new ORPCError("BAD_REQUEST", {
						message: "Choose a new run time when rescheduling completed or canceled work.",
					});
				await tx
					.update(tables.careerJob)
					.set({ status: "canceled", lease: null, leaseUntil: null })
					.where(and(eq(tables.careerJob.scheduleId, id), sql`${tables.careerJob.status} in ('queued', 'running')`));
			}
			if (!id) {
				// Serialize this user's creates so the cap holds under concurrent requests.
				await lockUser(tx, userId);
				const [count] = await tx
					.select({ total: sql<number>`count(*)::int` })
					.from(tables.careerSchedule)
					.where(eq(tables.careerSchedule.userId, userId));
				if ((count?.total ?? 0) >= MAX_SCHEDULES_PER_USER)
					throw new ORPCError("BAD_REQUEST", {
						message: `You can keep up to ${MAX_SCHEDULES_PER_USER} schedules. Delete one you no longer need first.`,
					});
			}
			const [row] = id
				? await tx
						.update(tables.careerSchedule)
						.set({ ...values, lastQueuedAt: keepQueuedAt })
						.where(and(eq(tables.careerSchedule.id, id), eq(tables.careerSchedule.userId, userId)))
						.returning()
				: await tx
						.insert(tables.careerSchedule)
						.values({ userId, ...values })
						.returning();
			if (!row) throw new ORPCError("NOT_FOUND");
			return row;
		});
	},
	delete: async (userId: string, id: string) => {
		await db
			.delete(tables.careerSchedule)
			.where(and(eq(tables.careerSchedule.id, id), eq(tables.careerSchedule.userId, userId)));
	},
	notifications: async (userId: string) => {
		const rows = await db
			.select()
			.from(tables.careerNotification)
			.where(eq(tables.careerNotification.userId, userId))
			.orderBy(desc(tables.careerNotification.createdAt));
		return rows.map((row) => ({ ...row, ...noticeText(row.notice) }));
	},
	markRead: async (userId: string, id: string) => {
		await db
			.update(tables.careerNotification)
			.set({ readAt: new Date() })
			.where(and(eq(tables.careerNotification.id, id), eq(tables.careerNotification.userId, userId)));
	},
	/** Each role with the preferences its posting matches and what it leaves out; the posting text stays here. */
	opportunities: async (userId: string) => {
		const [rows, profile] = await Promise.all([
			db
				.select()
				.from(tables.careerOpportunity)
				.where(and(eq(tables.careerOpportunity.userId, userId), isNull(tables.careerOpportunity.dismissedAt)))
				.orderBy(desc(tables.careerOpportunity.lastSeenAt)),
			careerService.profile(userId),
		]);
		return rows.map(({ description, ...row }) => ({ ...row, ...matchPosting({ ...row, description }, profile) }));
	},
	dismissOpportunity: async (userId: string, id: string) => {
		await db
			.update(tables.careerOpportunity)
			.set({ dismissedAt: new Date() })
			.where(and(eq(tables.careerOpportunity.id, id), eq(tables.careerOpportunity.userId, userId)));
	},
};

type Posting = Awaited<ReturnType<typeof readOpenPosting>>;

/**
 * A discovery search's hits, each read once: by the built-in reader, then by the web connection (which renders
 * script-built pages). Only one open role's posting is kept as a role; anything else is remembered as not one, so it is
 * never read again. Untracked roles are rechecked weekly so saved descriptions do not remain stale forever.
 */
async function discover(userId: string, query: string) {
	const [connection, scope] = await Promise.all([webAccessService.resolve(userId), searchScope(userId)]);
	const signal = AbortSignal.timeout(90_000);
	// A background run has no request locale, so the place is named in English.
	const hits = await searchJobPostings(query, { userId, connection, signal, ...scope });
	const found = new Map<string, (typeof hits)[number]>();
	for (const hit of hits) {
		const url = canonicalOpportunityUrl(hit.url);
		if (url && !found.has(url)) found.set(url, hit);
	}
	const known = found.size
		? await db
				.select({
					url: tables.careerOpportunity.url,
					updatedAt: tables.careerOpportunity.updatedAt,
					dismissedAt: tables.careerOpportunity.dismissedAt,
					trackedApplicationId: tables.careerOpportunity.trackedApplicationId,
				})
				.from(tables.careerOpportunity)
				.where(
					and(eq(tables.careerOpportunity.userId, userId), inArray(tables.careerOpportunity.url, [...found.keys()])),
				)
		: [];
	const seen = new Map(known.map((row) => [row.url, row]));
	return Promise.all(
		[...found].map(async ([url, hit]) => {
			const prior = seen.get(url);
			if (
				prior &&
				(prior.dismissedAt || prior.trackedApplicationId || prior.updatedAt.getTime() > Date.now() - 7 * 86_400_000)
			)
				return { url, hit, posting: undefined, existing: true };
			// A failed read is undefined: skipped this run and tried again on the next, never taken for "not a posting".
			const read = (via: typeof connection) =>
				readOpenPosting(url, { userId, connection: via, signal }).catch((): Posting | undefined => undefined);
			const builtin = await read(null);
			const posting = builtin || !connection ? builtin : await read(connection);
			return { url, hit, posting, existing: Boolean(prior) };
		}),
	);
}

async function enqueue() {
	await db.transaction(async (tx) => {
		const due = await tx
			.select()
			.from(tables.careerSchedule)
			.where(
				and(
					eq(tables.careerSchedule.enabled, true),
					lte(tables.careerSchedule.nextRunAt, new Date()),
					or(
						isNull(tables.careerSchedule.lastQueuedAt),
						sql`${tables.careerSchedule.nextRunAt} > ${tables.careerSchedule.lastQueuedAt}`,
					),
				),
			)
			.orderBy(asc(tables.careerSchedule.nextRunAt))
			.limit(20)
			.for("update", { skipLocked: true });
		for (const schedule of due) {
			// A schedule switched back on for a time that already ran gets a fresh job; finished ones stay as history.
			await tx
				.delete(tables.careerJob)
				.where(
					and(
						eq(tables.careerJob.scheduleId, schedule.id),
						eq(tables.careerJob.dueAt, schedule.nextRunAt),
						sql`${tables.careerJob.status} in ('completed', 'canceled', 'failed')`,
					),
				);
			await tx
				.insert(tables.careerJob)
				.values({ userId: schedule.userId, scheduleId: schedule.id, dueAt: schedule.nextRunAt })
				.onConflictDoNothing();
			// Coalesce missed ticks into one job, rather than charging for an outage's backlog, keeping the wall time.
			let nextRunAt = schedule.nextRunAt;
			if (schedule.intervalDays)
				for (let i = 0; i < 400 && nextRunAt <= new Date(); i++)
					nextRunAt = nextCareerRun(nextRunAt, schedule.intervalDays, schedule.timezone);
			await tx
				.update(tables.careerSchedule)
				.set({ lastQueuedAt: schedule.nextRunAt, nextRunAt })
				.where(eq(tables.careerSchedule.id, schedule.id));
		}
	});
}

/**
 * Claims the oldest due job whose owner has no other job running and hasn't been served this tick, so one account's
 * backlog can't hold up everyone else's schedules. Jobs of banned accounts are canceled.
 */
function claim(servedUsers: ReadonlySet<string>) {
	return db.transaction(async (tx) => {
		const now = new Date();
		const candidates = await tx
			.select()
			.from(tables.careerJob)
			.where(
				and(
					lte(tables.careerJob.dueAt, now),
					sql`${tables.careerJob.attempts} < 3`,
					or(
						and(
							eq(tables.careerJob.status, "queued"),
							or(isNull(tables.careerJob.leaseUntil), lte(tables.careerJob.leaseUntil, now)),
						),
						and(eq(tables.careerJob.status, "running"), lte(tables.careerJob.leaseUntil, now)),
					),
					servedUsers.size ? notInArray(tables.careerJob.userId, [...servedUsers]) : undefined,
					sql`not exists (select 1 from career_job as running_job where running_job.user_id = ${tables.careerJob.userId} and running_job.status = 'running' and running_job.id <> ${tables.careerJob.id} and running_job.lease_until > ${now})`,
				),
			)
			.orderBy(asc(tables.careerJob.dueAt))
			.limit(CLAIM_CANDIDATES)
			.for("update", { skipLocked: true });
		for (const job of candidates) {
			// Publication takes the user mutex before its job lock; never wait for that mutex in reverse order.
			const [owner] = await tx
				.select({ id: tables.user.id, banned: tables.user.banned, banExpires: tables.user.banExpires })
				.from(tables.user)
				.where(eq(tables.user.id, job.userId))
				.for("no key update", { skipLocked: true });
			if (!owner) continue;
			if (owner.banned && (!owner.banExpires || owner.banExpires > now)) {
				await tx
					.update(tables.careerJob)
					.set({ status: "canceled", lease: null, leaseUntil: null })
					.where(eq(tables.careerJob.id, job.id));
				continue;
			}
			// Checked again under the owner's lock: another worker may have claimed this owner's job since the select.
			const [running] = await tx
				.select({ id: tables.careerJob.id })
				.from(tables.careerJob)
				.where(
					and(
						eq(tables.careerJob.userId, job.userId),
						eq(tables.careerJob.status, "running"),
						sql`${tables.careerJob.id} <> ${job.id}`,
						sql`${tables.careerJob.leaseUntil} > ${now}`,
					),
				)
				.limit(1);
			if (running) continue;
			const [claimed] = await tx
				.update(tables.careerJob)
				.set({
					status: "running",
					attempts: job.attempts + 1,
					lease: generateId(),
					leaseUntil: new Date(Date.now() + STALE_AGENT_RUN_TTL_MS + 60_000),
				})
				.where(eq(tables.careerJob.id, job.id))
				.returning();
			if (claimed) return claimed;
		}
		return null;
	});
}

async function execute(job: typeof tables.careerJob.$inferSelect) {
	const [schedule] = await db
		.select()
		.from(tables.careerSchedule)
		.where(
			and(
				eq(tables.careerSchedule.id, job.scheduleId),
				eq(tables.careerSchedule.userId, job.userId),
				eq(tables.careerSchedule.enabled, true),
			),
		);
	if (!schedule || !job.lease) {
		await db
			.update(tables.careerJob)
			.set({ status: "canceled", lease: null, leaseUntil: null })
			.where(and(eq(tables.careerJob.id, job.id), eq(tables.careerJob.status, "running")));
		return;
	}
	const application = await requireCareerApplication({
		userId: job.userId,
		applicationId: schedule.applicationId,
		interviewId: schedule.interviewId,
	});
	const results = schedule.kind === "discovery" ? await discover(job.userId, schedule.query) : [];
	if (schedule.kind === "prepare") {
		if (!application || !schedule.interviewId) throw new Error("Preparation application unavailable.");
		const [saved] = await db
			.select({ id: tables.careerArtifact.id })
			.from(tables.careerArtifact)
			.where(eq(tables.careerArtifact.jobId, job.id));
		if (!saved)
			await generateCareer({
				userId: job.userId,
				applicationId: application.id,
				locale: schedule.locale,
				task: { task: "briefing", interviewId: schedule.interviewId },
				...(schedule.aiProviderId ? { providerId: schedule.aiProviderId } : {}),
				jobId: job.id,
				jobLease: job.lease,
				signal: AbortSignal.timeout(120_000),
			});
	}
	await db.transaction(async (tx) => {
		// Interview edits/deletion lock the application before touching its jobs.
		if (schedule.applicationId) {
			const [owned] = await tx
				.select({ id: tables.application.id })
				.from(tables.application)
				.where(and(eq(tables.application.id, schedule.applicationId), eq(tables.application.userId, job.userId)))
				.for("update");
			if (!owned) return;
		}
		const [current] = await tx
			.select()
			.from(tables.careerJob)
			.where(
				and(
					eq(tables.careerJob.id, job.id),
					eq(tables.careerJob.lease, job.lease ?? ""),
					eq(tables.careerJob.status, "running"),
				),
			)
			.for("update");
		if (!current || !current.leaseUntil || current.leaseUntil < new Date()) return;
		let changed = 0;
		for (const { url, hit, posting, existing } of results) {
			// Seen before, or unreadable this run.
			if (posting === undefined) {
				await tx
					.update(tables.careerOpportunity)
					.set({ lastSeenAt: new Date(), updatedAt: sql`${tables.careerOpportunity.updatedAt}` })
					.where(and(eq(tables.careerOpportunity.userId, job.userId), eq(tables.careerOpportunity.url, url)));
				continue;
			}
			// Titles keep their separators ("Role - Company | Board") for parsing; only markup goes.
			const title = parseListingTitle(
				hit.title
					.replace(/[*_`#\\]+/g, "")
					.replace(/\s+/g, " ")
					.trim(),
			);
			const values = {
				userId: job.userId,
				url,
				role: (posting?.page?.role || title.role).slice(0, 200),
				company: (posting?.page?.company || posting?.company || title.company).slice(0, 200),
				location: (posting?.page?.location ?? "").slice(0, 200),
				snippet: plainSnippet(hit.description || posting?.text || ""),
				description: posting?.text ?? "",
				// Not a posting: kept out of New roles, and never read again.
				...(posting ? {} : { dismissedAt: new Date() }),
			};
			const [inserted] = await tx
				.insert(tables.careerOpportunity)
				.values(values)
				.onConflictDoUpdate({
					target: [tables.careerOpportunity.userId, tables.careerOpportunity.url],
					set: {
						role: values.role,
						company: values.company,
						location: values.location,
						snippet: values.snippet,
						description: values.description,
						lastSeenAt: new Date(),
						...(posting ? {} : { dismissedAt: new Date() }),
					},
					setWhere: sql`${tables.careerOpportunity.dismissedAt} is null and ${tables.careerOpportunity.trackedApplicationId} is null`,
				})
				.returning();
			if (inserted && posting && !existing) changed++;
		}
		// New roles all wait in one list, so the newest "new roles" notice replaces older unread ones.
		if (schedule.kind === "discovery" && changed)
			await tx
				.update(tables.careerNotification)
				.set({ readAt: new Date() })
				.where(
					and(
						eq(tables.careerNotification.userId, job.userId),
						sql`${tables.careerNotification.notice}->>'type' = 'opportunities'`,
						isNull(tables.careerNotification.readAt),
					),
				);
		if (schedule.kind !== "discovery" || changed)
			await tx
				.insert(tables.careerNotification)
				.values({
					userId: job.userId,
					applicationId: schedule.applicationId,
					key: job.id,
					notice:
						schedule.kind === "discovery"
							? { type: "opportunities", count: changed, query: schedule.query }
							: {
									type: schedule.kind === "prepare" ? "briefing" : "followup",
									company: application?.company ?? "",
									role: application?.role ?? "",
								},
					url: workspaceUrl(schedule.applicationId, schedule.kind === "prepare" ? "prepare" : undefined),
				})
				.onConflictDoNothing();
		await tx
			.update(tables.careerJob)
			.set({ status: "completed", lease: null, leaseUntil: null, error: null })
			.where(eq(tables.careerJob.id, job.id));
	});
}

async function sendPendingEmail() {
	// Claim independently of job completion so a crash before SMTP can recover on the next tick.
	for (let i = 0; i < 2; i++) {
		const notification = await db.transaction(async (tx) => {
			const [row] = await tx
				.select({ notification: tables.careerNotification })
				.from(tables.careerNotification)
				.innerJoin(tables.careerJob, eq(tables.careerNotification.key, tables.careerJob.id))
				.innerJoin(tables.careerSchedule, eq(tables.careerJob.scheduleId, tables.careerSchedule.id))
				.where(
					and(
						eq(tables.careerJob.status, "completed"),
						eq(tables.careerSchedule.email, true),
						eq(tables.careerSchedule.enabled, true),
						isNull(tables.careerNotification.emailedAt),
						or(
							isNull(tables.careerNotification.emailAttemptedAt),
							lte(tables.careerNotification.emailAttemptedAt, new Date(Date.now() - 10 * 60_000)),
						),
						sql`not exists (select 1 from career_notification failed where failed.key = 'email-failed:' || ${tables.careerNotification.key} and failed.user_id = ${tables.careerNotification.userId})`,
					),
				)
				.orderBy(asc(tables.careerNotification.createdAt))
				.limit(1)
				.for("update", { skipLocked: true, of: tables.careerNotification });
			if (!row) return null;
			await tx
				.update(tables.careerNotification)
				.set({ emailAttemptedAt: new Date() })
				.where(eq(tables.careerNotification.id, row.notification.id));
			return row.notification;
		});
		if (!notification) break;
		const [owner] = await db
			.select({
				email: tables.user.email,
				verified: tables.user.emailVerified,
				banned: tables.user.banned,
				banExpires: tables.user.banExpires,
			})
			.from(tables.user)
			.where(eq(tables.user.id, notification.userId));
		const banned = owner?.banned && (!owner.banExpires || owner.banExpires > new Date());
		if (notification && owner?.verified && !banned) {
			try {
				const sent = await sendCareerNotification({
					to: owner.email,
					subject: noticeText(notification.notice).title,
					text: "You have a career update in Reactive Resume.",
					url: new URL(notification.url ?? CAREER_URL, env.APP_URL).toString(),
					key: notification.key,
				});
				if (!sent) throw new Error("SMTP unavailable");
				await db
					.update(tables.careerNotification)
					.set({ emailedAt: new Date() })
					.where(eq(tables.careerNotification.id, notification.id));
			} catch {
				await db
					.insert(tables.careerNotification)
					.values({
						userId: notification.userId,
						key: `email-failed:${notification.key}`,
						notice: { type: "email-failed" },
						url: CAREER_URL,
					})
					.onConflictDoNothing();
			}
		}
	}
}

/** One bounded scheduler tick. No work continues after this promise resolves. */
export async function runCareerJobs() {
	const exhausted = await db
		.update(tables.careerJob)
		.set({
			status: "failed",
			lease: null,
			leaseUntil: null,
			error: "The worker stopped repeatedly; review this schedule.",
		})
		.where(
			and(
				eq(tables.careerJob.status, "running"),
				sql`${tables.careerJob.attempts} >= 3`,
				lte(tables.careerJob.leaseUntil, new Date()),
			),
		)
		.returning();
	for (const job of exhausted)
		await db
			.insert(tables.careerNotification)
			.values({
				userId: job.userId,
				key: `failed:${job.id}`,
				notice: { type: "schedule-failed", reason: "stopped" },
				url: `${CAREER_URL}?schedule=${encodeURIComponent(job.scheduleId)}`,
			})
			.onConflictDoNothing();
	await enqueue();
	let processed = 0;
	const servedUsers = new Set<string>();
	for (let i = 0; i < 2; i++) {
		const job = await claim(servedUsers);
		if (!job) break;
		servedUsers.add(job.userId);
		try {
			await execute(job);
		} catch {
			const [failed] = await db
				.update(tables.careerJob)
				.set({
					status: job.attempts >= 3 ? "failed" : "queued",
					lease: null,
					leaseUntil: new Date(Date.now() + 300_000),
					error: "This schedule failed. Check the selected provider and application, then review the schedule.",
				})
				.where(
					and(
						eq(tables.careerJob.id, job.id),
						eq(tables.careerJob.lease, job.lease ?? ""),
						eq(tables.careerJob.status, "running"),
					),
				)
				.returning();
			if (failed?.status === "failed")
				await db
					.insert(tables.careerNotification)
					.values({
						userId: job.userId,
						key: `failed:${job.id}`,
						notice: { type: "schedule-failed", reason: "failed" },
						url: `${CAREER_URL}?schedule=${encodeURIComponent(job.scheduleId)}`,
					})
					.onConflictDoNothing();
		}
		processed++;
	}
	await sendPendingEmail();
	// The scheduler tick is the one periodic job every platform runs; Trash expiry rides on it.
	await documentsService
		.purgeExpiredTrash()
		.catch((error: unknown) => console.error("[documents] Expired Trash purge failed", error));
	// Released usernames are reserved for 30 days; older rows no longer matter.
	await db
		.delete(tables.releasedUsername)
		.where(lte(tables.releasedUsername.releasedAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)))
		.catch((error: unknown) => console.error("[auth] Released username cleanup failed", error));
	// Read notifications go after 90 days, so the list every dashboard page loads stops growing. Unread ones stay.
	await db
		.delete(tables.careerNotification)
		.where(lte(tables.careerNotification.readAt, new Date(Date.now() - READ_NOTIFICATION_TTL_MS)))
		.catch((error: unknown) => console.error("[career] Read notification cleanup failed", error));
	return { processed };
}
