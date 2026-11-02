import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { RPCHandler } from "@orpc/server/fetch";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { savedItemDataSchema } from "@reactive-resume/schema/career";

const fixture = vi.hoisted(() => ({ db: undefined as ReturnType<typeof drizzle> | undefined }));
vi.mock("@reactive-resume/db/client", () => ({
	get db() {
		return fixture.db;
	},
}));
vi.mock("@reactive-resume/auth/config", () => ({
	auth: { $context: Promise.resolve({ secretConfig: { key: "synthetic-review-key" } }) },
	isCustomOAuthProviderEnabled: () => false,
}));
vi.mock("../resume/events", () => ({ publishResumeUpdated: vi.fn() }));

const databaseUrl = process.env.INTEGRATIONS_TEST_DATABASE_URL ?? process.env.COVER_LETTER_TEST_DATABASE_URL;

type LinkClient = {
	applications: {
		create: (input: Record<string, unknown>) => Promise<string>;
		update: (input: Record<string, unknown>) => Promise<unknown>;
		import: (input: Record<string, unknown>) => Promise<unknown>;
		bulkUpdate: (input: Record<string, unknown>) => Promise<unknown>;
		deleteTimelineEntry: (input: Record<string, unknown>) => Promise<unknown>;
	};
	coverLetters: {
		create: (input: Record<string, unknown>) => Promise<{ id: string; revision: number; content: string }>;
		update: (input: Record<string, unknown>) => Promise<unknown>;
		getById: (input: Record<string, unknown>) => Promise<{ id: string; revision: number }>;
		duplicate: (input: Record<string, unknown>) => Promise<{ id: string; sourceApplicationId: string | null }>;
	};
	documents: {
		linkApplication: (input: Record<string, unknown>) => Promise<unknown>;
		setLocked: (input: Record<string, unknown>) => Promise<unknown>;
	};
	career: {
		applyReply: (input: Record<string, unknown>) => Promise<unknown>;
		submitApplication: (input: Record<string, unknown>) => Promise<unknown>;
	};
};

// Real RPC transport → validation/router/service → migrated PostgreSQL, in an isolated schema.
describe.skipIf(!databaseUrl)("application and document letter-link reconciliation", () => {
	let admin: Pool;
	let pool: Pool;
	let api: LinkClient;
	let bob: LinkClient;
	const schemaName = `link_reconciliation_${randomUUID().replaceAll("-", "")}`;

	beforeAll(async () => {
		admin = new Pool({ connectionString: databaseUrl });
		await admin.query(`CREATE SCHEMA ${schemaName}`);
		pool = new Pool({
			connectionString: databaseUrl,
			max: 8,
			application_name: schemaName,
			options: `-c search_path=${schemaName} -c statement_timeout=8000 -c lock_timeout=5000`,
		});
		fixture.db = drizzle({ client: pool });
		const root = new URL("../../../../../migrations/", import.meta.url);
		for (const entry of (await readdir(root, { withFileTypes: true }))
			.filter((item) => item.isDirectory() && /^\d+_/.test(item.name))
			.sort((left, right) => left.name.localeCompare(right.name)))
			await pool.query(
				(await readFile(new URL(`${entry.name}/migration.sql`, root), "utf8")).replaceAll('"public".', ""),
			);
		const { crudRouter } = await import("../applications/crud");
		const { documentsRouter } = await import("./router");
		const { coverLettersRouter } = await import("../cover-letters/router");
		const { careerRouter } = await import("../career/router");
		const handler = new RPCHandler({
			career: careerRouter,
			applications: crudRouter,
			documents: documentsRouter,
			coverLetters: coverLettersRouter,
		});
		const client = (id: string) =>
			createORPCClient(
				new RPCLink({
					url: "http://localhost:3000/api/rpc",
					fetch: async (request: Request, init?: RequestInit) => {
						const req = request instanceof Request ? request : new Request(request, init);
						const user = {
							id,
							name: id,
							email: `${id}@example.test`,
							emailVerified: true,
							createdAt: new Date(),
							updatedAt: new Date(),
						};
						const result = await handler.handle(req, {
							prefix: "/api/rpc",
							context: {
								locale: "en-US",
								reqHeaders: req.headers,
								authentication: { user, method: "session", permissions: ["read", "write", "delete"] },
							},
						});
						if (!result.matched) throw new Error(`HTTP route did not match: ${req.url}`);
						return result.response;
					},
				}),
			) as unknown as LinkClient;
		api = client("alice");
		bob = client("bob");
	}, 30_000);

	afterAll(async () => {
		await pool?.end();
		await admin?.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
		await admin?.end();
	});

	beforeEach(async () => {
		await pool.query('TRUNCATE "user" CASCADE');
		for (const id of ["alice", "bob"])
			await pool.query('INSERT INTO "user" (id,name,email,username,display_username) VALUES ($1,$1,$2,$1,$1)', [
				id,
				`${id}@example.test`,
			]);
	});

	const letter = () => api.coverLetters.create({ name: "Review letter" });
	const job = (extra: Record<string, unknown> = {}) =>
		api.applications.create({ company: "Fictional", role: "Engineer", ...extra });
	async function state() {
		return {
			applications: (await pool.query("SELECT * FROM application ORDER BY id")).rows,
			letters: (await pool.query("SELECT * FROM cover_letter ORDER BY id")).rows,
			versions: (await pool.query("SELECT * FROM cover_letter_version ORDER BY id")).rows,
		};
	}
	async function coherent() {
		const snapshot = await state();
		for (const application of snapshot.applications.filter((row) => row.cover_letter_id))
			expect(snapshot.letters.find((row) => row.id === application.cover_letter_id)?.source_application_id).toBe(
				application.id,
			);
		for (const row of snapshot.letters.filter((item) => item.source_application_id))
			expect(
				snapshot.applications.find((application) => application.id === row.source_application_id)?.cover_letter_id,
			).toBe(row.id);
		return snapshot;
	}

	const refused = async (
		action: () => Promise<unknown>,
		code = "BAD_REQUEST",
		reason: string | null = "SUBMITTED_DOCUMENT_LOCKED",
	) => {
		const before = await state();
		const result = await Promise.allSettled([action()]);
		expect(result[0]?.status).toBe("rejected");
		if (result[0]?.status === "rejected")
			expect(result[0].reason).toMatchObject({ code, ...(reason ? { data: { reason } } : {}) });
		expect(await state()).toEqual(before);
	};

	const reply = async (applicationId: string, stage: "screening" | "interview" | "offer" | "closed") => {
		const { careerService } = await import("../career/service");
		const context = await careerService.context({ userId: "alice", applicationId });
		const item = await careerService.saveSavedItem({
			userId: "alice",
			applicationId,
			interviewId: null,
			title: "Synthetic reply",
			data: savedItemDataSchema.parse({
				kind: "reply",
				message: "Next step",
				title: "Next",
				asks: [],
				unconfirmed: [],
				reply: "",
				changes: [{ type: "stage", stage }],
				offer: null,
			}),
			evidence: { factIds: [], storyIds: [] },
			inputVersion: context.version,
		});
		if (!item) throw new Error("Expected a saved reply.");
		await api.career.applyReply({ id: item.id, changes: [0] });
	};

	it("RPC create/edit/relink/clear/import agree with SQL in both directions", async () => {
		const first = await letter();
		const original = await job({ coverLetterId: first.id });
		await coherent();
		const edited = await job();
		await api.applications.update({ id: edited, coverLetterId: first.id });
		await coherent();
		expect((await state()).applications.find((row) => row.id === original).cover_letter_id).toBeNull();
		await api.applications.update({ id: edited, coverLetterId: null });
		await coherent();
		const imported = await letter();
		await api.applications.import({ items: [{ company: "Import", role: "Role", coverLetterId: imported.id }] });
		await coherent();
	});

	it("foreign and locked create/update/import refuse without changing SQL", async () => {
		const linked = await letter();
		const own = await job();
		const foreignJob = await bob.applications.create({ company: "Bob", role: "Engineer" });
		for (const [who, expected] of [
			[bob, "NOT_FOUND"],
			[api, "DOCUMENT_LOCKED"],
		] as const) {
			if (who === api) await api.documents.setLocked({ type: "letter", id: linked.id, isLocked: true });
			for (const action of [
				() => who.applications.create({ company: "No", role: "No", coverLetterId: linked.id }),
				() => who.applications.update({ id: who === bob ? foreignJob : own, coverLetterId: linked.id }),
				() => who.applications.import({ items: [{ company: "No", role: "No", coverLetterId: linked.id }] }),
			]) {
				const before = await state();
				await expect(action()).rejects.toMatchObject({ code: expected });
				expect(await state()).toEqual(before);
			}
		}
	});

	it("applied create pins content and refuses move/clear/import without changing the receipt", async () => {
		const linked = await letter();
		await api.coverLetters.update({
			id: linked.id,
			expectedRevision: linked.revision,
			content: "<p>Original sent text</p>",
			proposalSafety: "v1",
		});
		const applied = await job({ coverLetterId: linked.id, status: "applied" });
		const before = await state();
		const receipt = before.applications.find((row) => row.id === applied).sent_cover_letter_version_id;
		expect(receipt).toEqual(expect.any(String));
		const version = async () =>
			(await pool.query("SELECT data FROM cover_letter_version WHERE id=$1", [receipt])).rows[0].data;
		expect((await version()).content).toBe("<p>Original sent text</p>");
		const other = await job();
		for (const action of [
			() => api.applications.update({ id: applied, coverLetterId: null }),
			() => api.applications.update({ id: other, coverLetterId: linked.id }),
			() => job({ coverLetterId: linked.id }),
			() => api.applications.import({ items: [{ company: "Bad", role: "Bad", coverLetterId: linked.id }] }),
			() => api.documents.linkApplication({ type: "letter", id: linked.id, applicationId: null }),
		])
			await expect(action()).rejects.toMatchObject({
				code: "BAD_REQUEST",
				data: { reason: "SUBMITTED_DOCUMENT_LOCKED" },
			});
		await coherent();
		const latest = await api.coverLetters.getById({ id: linked.id });
		await api.coverLetters.update({
			id: linked.id,
			expectedRevision: latest.revision,
			content: "<p>Later draft</p>",
			proposalSafety: "v1",
		});
		expect((await version()).content).toBe("<p>Original sent text</p>");
	});

	it("application replacement clears the old letter and leaves the new one coherent", async () => {
		const first = await letter();
		const second = await letter();
		const linked = await job({ coverLetterId: first.id });
		await api.applications.update({ id: linked, coverLetterId: second.id });
		await coherent();
	});

	it("R3 document-side replacement detaches the replaced letter too", async () => {
		const replaced = await letter();
		const replacement = await letter();
		const linked = await job();
		await api.documents.linkApplication({ type: "letter", id: replaced.id, applicationId: linked });
		await coherent();
		await api.documents.linkApplication({ type: "letter", id: replacement.id, applicationId: linked });
		await coherent();
		const snapshot = await state();
		expect(snapshot.letters.find((row) => row.id === replaced.id)?.source_application_id).toBeNull();
	});

	it("R2 legacy multiple links converge when the same letter moves", async () => {
		const shared = await letter();
		const first = await job({ coverLetterId: shared.id });
		const second = await job();
		const third = await job();
		await pool.query("UPDATE application SET cover_letter_id=$1 WHERE id=$2", [shared.id, second]);
		await api.applications.update({ id: third, coverLetterId: shared.id });
		await coherent();
		const snapshot = await state();
		expect(snapshot.applications.filter((row) => row.cover_letter_id === shared.id)).toHaveLength(1);
		expect(snapshot.applications.find((row) => row.id === first)?.cover_letter_id).toBeNull();
		expect(snapshot.applications.find((row) => row.id === second)?.cover_letter_id).toBeNull();
	});

	it("R1 clearing a legacy duplicate does not detach the canonical job", async () => {
		const shared = await letter();
		const canonical = await job();
		const stale = await job();
		await api.documents.linkApplication({ type: "letter", id: shared.id, applicationId: canonical });
		await coherent();
		await pool.query("UPDATE application SET cover_letter_id=$1 WHERE id=$2", [shared.id, stale]);
		await api.applications.update({ id: stale, coverLetterId: null });
		await coherent();
		const snapshot = await state();
		expect(snapshot.applications.find((row) => row.id === canonical)?.cover_letter_id).toBe(shared.id);
		expect(snapshot.letters.find((row) => row.id === shared.id)?.source_application_id).toBe(canonical);
	});

	it.each(["create", "update", "import"])(
		"R2 legacy submitted one-way link refuses %s stealing the sent letter",
		async (mode) => {
			const shared = await letter();
			const applied = await job({ coverLetterId: shared.id, status: "applied" });
			const other = await job();
			// Actual main allowed application-side one-way links; reproduce that persisted shape with its receipt.
			await pool.query("UPDATE cover_letter SET source_application_id=NULL WHERE id=$1", [shared.id]);
			const before = await state();
			const action =
				mode === "create"
					? () => job({ coverLetterId: shared.id })
					: mode === "update"
						? () => api.applications.update({ id: other, coverLetterId: shared.id })
						: () => api.applications.import({ items: [{ company: "Legacy", role: "Role", coverLetterId: shared.id }] });
			await expect(action()).rejects.toMatchObject({
				code: "BAD_REQUEST",
				data: { reason: "SUBMITTED_DOCUMENT_LOCKED" },
			});
			expect(await state()).toEqual(before);
			expect(before.applications.find((row) => row.id === applied)?.sent_cover_letter_version_id).toEqual(
				expect.any(String),
			);
		},
	);

	it("late document-side link at Applied links but invents no sent version; existing receipts stay immutable", async () => {
		const applied = await job({ status: "applied" });
		const late = await letter();
		await api.documents.linkApplication({ type: "letter", id: late.id, applicationId: applied });
		await coherent();
		const linked = (await state()).applications.find((row) => row.id === applied);
		expect(linked?.cover_letter_id).toBe(late.id);
		// A late link was not sent, so no sent receipt is invented.
		expect(linked?.sent_cover_letter_version_id).toBeNull();

		const sent = await letter();
		await api.coverLetters.update({
			id: sent.id,
			expectedRevision: sent.revision,
			content: "<p>Immutable sent text</p>",
			proposalSafety: "v1",
		});
		const submitted = await job({ coverLetterId: sent.id, status: "applied" });
		const another = await letter();
		const before = await state();
		const receipt = before.applications.find((row) => row.id === submitted)?.sent_cover_letter_version_id;
		await expect(
			api.documents.linkApplication({ type: "letter", id: another.id, applicationId: submitted }),
		).rejects.toMatchObject({ code: "BAD_REQUEST", data: { reason: "SUBMITTED_DOCUMENT_LOCKED" } });
		expect(await state()).toEqual(before);
		expect(
			(await pool.query("SELECT data FROM cover_letter_version WHERE id=$1", [receipt])).rows[0].data.content,
		).toBe("<p>Immutable sent text</p>");
	});

	async function barrier(run: () => Promise<unknown>[]) {
		const connection = await pool.connect();
		await connection.query("BEGIN");
		await connection.query('SELECT id FROM "user" WHERE id=$1 FOR NO KEY UPDATE', ["alice"]);
		const pending = run();
		try {
			await vi.waitFor(
				async () => {
					const waiting = await admin.query(
						"SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",
						[schemaName],
					);
					expect(waiting.rows[0].n).toBeGreaterThanOrEqual(2);
				},
				{ timeout: 2500 },
			);
		} finally {
			await connection.query("COMMIT");
			connection.release();
		}
		return Promise.allSettled(pending);
	}

	it("PG barrier concurrent create/create serializes without deadlock", async () => {
		const shared = await letter();
		const results = await barrier(() => [job({ coverLetterId: shared.id }), job({ coverLetterId: shared.id })]);
		expect(results.every((result) => result.status === "fulfilled")).toBe(true);
		await coherent();
		expect((await state()).applications.filter((row) => row.cover_letter_id === shared.id)).toHaveLength(1);
	});

	it("PG barrier application update versus documents.linkApplication preserves both directions", async () => {
		const shared = await letter();
		const first = await job();
		const second = await job();
		const results = await barrier(() => [
			api.applications.update({ id: first, coverLetterId: shared.id }),
			api.documents.linkApplication({ type: "letter", id: shared.id, applicationId: second }),
		]);
		expect(results.some((result) => result.status === "fulfilled")).toBe(true);
		await coherent();
	});

	it("PG barrier update versus coverLetters.update preserves CAS, sent snapshot and lock order", async () => {
		const shared = await letter();
		const linked = await job();
		const results = await barrier(() => [
			api.applications.update({ id: linked, coverLetterId: shared.id, status: "applied" }),
			api.coverLetters.update({
				id: shared.id,
				expectedRevision: shared.revision,
				content: "<p>Concurrent draft</p>",
				proposalSafety: "v1",
			}),
		]);
		expect(results[0]?.status).toBe("fulfilled");
		if (results[1]?.status === "rejected") expect(results[1].reason).toMatchObject({ code: "CONFLICT" });
		await coherent();
		expect((await state()).applications[0]?.sent_cover_letter_version_id).toEqual(expect.any(String));
	});

	it("document and letter routers reject foreign targets without changing SQL", async () => {
		const shared = await letter();
		const foreign = await bob.applications.create({ company: "Bob", role: "Engineer" });
		const before = await state();
		for (const action of [
			() => api.documents.linkApplication({ type: "letter", id: shared.id, applicationId: foreign }),
			() => api.coverLetters.update({ id: shared.id, expectedRevision: shared.revision, applicationId: foreign }),
		]) {
			await expect(action()).rejects.toMatchObject({ code: "NOT_FOUND" });
			expect(await state()).toEqual(before);
		}
	});

	it("I01 equal-ID application update repairs a legacy null reverse", async () => {
		const shared = await letter();
		const linked = await job({ coverLetterId: shared.id });
		await pool.query("UPDATE cover_letter SET source_application_id=NULL WHERE id=$1", [shared.id]);
		await api.applications.update({ id: linked, coverLetterId: shared.id });
		await coherent();
		expect((await state()).letters.find((row) => row.id === shared.id)?.source_application_id).toBe(linked);
	});

	it.each(["application", "document", "letter"] as const)(
		"I02 equal-source %s relink inventories all unsent aliases",
		async (mode) => {
			const shared = await letter();
			const linked = await job({ coverLetterId: shared.id });
			const alias = await job();
			await pool.query("UPDATE application SET cover_letter_id=$1 WHERE id=$2", [shared.id, alias]);
			if (mode === "application") await api.applications.update({ id: linked, coverLetterId: shared.id });
			else if (mode === "document")
				await api.documents.linkApplication({ type: "letter", id: shared.id, applicationId: linked });
			else {
				const current = await api.coverLetters.getById({ id: shared.id });
				await api.coverLetters.update({
					id: shared.id,
					expectedRevision: current.revision,
					applicationId: linked,
				});
			}
			await coherent();
			expect((await state()).applications.filter((row) => row.cover_letter_id === shared.id)).toHaveLength(1);
		},
	);

	it("I03 equal-ID application update refuses a submitted legacy alias", async () => {
		const shared = await letter();
		const linked = await job({ coverLetterId: shared.id });
		const alias = await job();
		await pool.query("UPDATE application SET cover_letter_id=$1 WHERE id=$2", [shared.id, alias]);
		await api.applications.update({ id: alias, status: "applied" });
		await refused(() => api.applications.update({ id: linked, coverLetterId: shared.id }));
	});

	it.each(["application", "document", "letter", "create"] as const)(
		"I04/A01 %s replacement refuses a locked displaced letter atomically",
		async (mode) => {
			const displaced = await letter();
			const replacement = await letter();
			const linked = await job({ coverLetterId: displaced.id });
			await api.documents.setLocked({ type: "letter", id: displaced.id, isLocked: true });
			await refused(
				() =>
					mode === "application"
						? api.applications.update({ id: linked, coverLetterId: replacement.id })
						: mode === "document"
							? api.documents.linkApplication({ type: "letter", id: replacement.id, applicationId: linked })
							: mode === "create"
								? api.coverLetters.create({ name: "New", applicationId: linked })
								: api.coverLetters.update({
										id: replacement.id,
										expectedRevision: replacement.revision,
										applicationId: linked,
									}),
				"DOCUMENT_LOCKED",
				null,
			);
		},
	);

	it("I05/A02 duplicating a linked letter never creates a second reverse owner", async () => {
		const shared = await letter();
		const linked = await job({ coverLetterId: shared.id });
		const copy = await api.coverLetters.duplicate({ id: shared.id });
		expect(copy.sourceApplicationId).toBeNull();
		await coherent();
		expect((await state()).applications.find((row) => row.id === linked)?.cover_letter_id).toBe(shared.id);
	});

	it("I06 relink converges reverse aliases left by old document replacement", async () => {
		const displaced = await letter();
		const replacement = await letter();
		const stale = await letter();
		const linked = await job({ coverLetterId: displaced.id });
		await pool.query("UPDATE cover_letter SET source_application_id=$1 WHERE id=$2", [linked, stale.id]);
		await api.documents.linkApplication({ type: "letter", id: replacement.id, applicationId: linked });
		await coherent();
		const letters = (await state()).letters;
		expect(letters.find((row) => row.id === displaced.id)?.source_application_id).toBeNull();
		expect(letters.find((row) => row.id === stale.id)?.source_application_id).toBeNull();
		expect((await state()).applications.find((row) => row.id === linked)?.cover_letter_id).toBe(replacement.id);
	});

	it("I07 late Applied link then equal-ID save does not invent a sent receipt", async () => {
		const linked = await job({ status: "applied" });
		const late = await letter();
		await api.documents.linkApplication({ type: "letter", id: late.id, applicationId: linked });
		expect((await state()).applications.find((row) => row.id === linked)?.sent_cover_letter_version_id).toBeNull();
		const current = await api.coverLetters.getById({ id: late.id });
		await api.coverLetters.update({
			id: late.id,
			expectedRevision: current.revision,
			content: "<p>Written after application sent</p>",
		});
		await api.applications.update({ id: linked, coverLetterId: late.id });
		expect((await state()).applications.find((row) => row.id === linked)?.sent_cover_letter_version_id).toBeNull();
		await coherent();
	});

	it("I08 late Applied link then stage advance does not invent a sent receipt", async () => {
		const linked = await job({ status: "applied" });
		const late = await letter();
		await api.documents.linkApplication({ type: "letter", id: late.id, applicationId: linked });
		await api.applications.update({ id: linked, status: "screening" });
		expect((await state()).applications.find((row) => row.id === linked)?.sent_cover_letter_version_id).toBeNull();
		await coherent();
	});

	it("I08b late Applied link then bulk stage advance does not invent a sent receipt", async () => {
		const linked = await job({ status: "applied" });
		const late = await letter();
		await api.documents.linkApplication({ type: "letter", id: late.id, applicationId: linked });
		await api.applications.bulkUpdate({ ids: [linked], status: "screening" });
		expect((await state()).applications.find((row) => row.id === linked)?.sent_cover_letter_version_id).toBeNull();
		await coherent();
	});

	it("I09/A03 clearing a legacy duplicate leaves the canonical row, letters and versions unchanged", async () => {
		const shared = await letter();
		const canonical = await job({ coverLetterId: shared.id });
		const stale = await job();
		await pool.query("UPDATE application SET cover_letter_id=$1 WHERE id=$2", [shared.id, stale]);
		const before = await state();
		await api.applications.update({ id: stale, coverLetterId: null });
		const after = await coherent();
		expect(after.applications.find((row) => row.id === canonical)).toEqual(
			before.applications.find((row) => row.id === canonical),
		);
		expect(after.letters).toEqual(before.letters);
		expect(after.versions).toEqual(before.versions);
	});

	it("I09b clearing the canonical owner detaches its reverse aliases", async () => {
		const shared = await letter();
		const canonical = await job({ coverLetterId: shared.id });
		const stale = await letter();
		await pool.query("UPDATE cover_letter SET source_application_id=$1 WHERE id=$2", [canonical, stale.id]);
		await api.applications.update({ id: canonical, coverLetterId: null });
		await coherent();
		const snapshot = await state();
		expect(snapshot.applications.find((row) => row.id === canonical)?.cover_letter_id).toBeNull();
		expect(snapshot.letters.find((row) => row.id === shared.id)?.source_application_id).toBeNull();
		expect(snapshot.letters.find((row) => row.id === stale.id)?.source_application_id).toBeNull();
	});

	it("I12 document unlink clears every legacy application alias and reverse alias", async () => {
		const shared = await letter();
		const canonical = await job({ coverLetterId: shared.id });
		const alias = await job();
		const reverse = await letter();
		await pool.query("UPDATE application SET cover_letter_id=$1 WHERE id=$2", [shared.id, alias]);
		await pool.query("UPDATE cover_letter SET source_application_id=$1 WHERE id=$2", [canonical, reverse.id]);
		await api.documents.linkApplication({ type: "letter", id: shared.id, applicationId: null });
		await coherent();
		expect((await state()).applications.every((row) => row.cover_letter_id === null)).toBe(true);
		expect((await state()).letters.find((row) => row.id === shared.id)?.source_application_id).toBeNull();
		expect((await state()).letters.find((row) => row.id === reverse.id)?.source_application_id).toBeNull();
	});

	it("I11 old-client content/link calls without proposalSafety stay usable and CAS is enforced", async () => {
		const shared = await letter();
		const linked = await job();
		await api.coverLetters.update({
			id: shared.id,
			expectedRevision: shared.revision,
			content: "<p>Old client</p>",
			applicationId: linked,
		});
		await refused(
			() => api.coverLetters.update({ id: shared.id, expectedRevision: shared.revision, content: "Stale" }),
			"CONFLICT",
			null,
		);
		await coherent();
	});

	it.each(["application", "document", "letter", "unlink", "submitted"] as const)(
		"F1 stale reverse %s preserves a separate canonical letter and its versions",
		async (mode) => {
			const canonical = await letter();
			const stale = await letter();
			const linked = await job();
			const other = await job();
			await api.documents.linkApplication({ type: "letter", id: canonical.id, applicationId: linked });
			await pool.query("UPDATE cover_letter SET source_application_id=$1 WHERE id=$2", [linked, stale.id]);
			if (mode === "submitted") await api.applications.update({ id: linked, status: "applied" });
			const before = await state();
			if (mode === "application") await api.applications.update({ id: other, coverLetterId: stale.id });
			else if (mode === "document" || mode === "submitted")
				await api.documents.linkApplication({ type: "letter", id: stale.id, applicationId: other });
			else {
				const fresh = await api.coverLetters.getById({ id: stale.id });
				await api.coverLetters.update({
					id: stale.id,
					expectedRevision: fresh.revision,
					applicationId: mode === "unlink" ? null : other,
				});
			}
			const after = await coherent();
			expect(after.applications.find((row) => row.id === linked)).toEqual(
				before.applications.find((row) => row.id === linked),
			);
			expect(after.letters.find((row) => row.id === canonical.id)).toEqual(
				before.letters.find((row) => row.id === canonical.id),
			);
			expect(after.versions.filter((row) => row.cover_letter_id === canonical.id)).toEqual(
				before.versions.filter((row) => row.cover_letter_id === canonical.id),
			);
		},
	);

	it("F2 moving an incoming letter reconciles reverse aliases of every cleared application alias", async () => {
		const shared = await letter();
		const stale = await letter();
		const canonical = await job();
		const alias = await job();
		const target = await job();
		await api.documents.linkApplication({ type: "letter", id: shared.id, applicationId: canonical });
		await pool.query("UPDATE application SET cover_letter_id=$1 WHERE id=$2", [shared.id, alias]);
		await pool.query("UPDATE cover_letter SET source_application_id=$1 WHERE id=$2", [alias, stale.id]);
		await api.documents.linkApplication({ type: "letter", id: shared.id, applicationId: target });
		await coherent();
		expect((await state()).applications.find((row) => row.id === target)?.cover_letter_id).toBe(shared.id);
		expect((await state()).letters.find((row) => row.id === stale.id)?.source_application_id).toBeNull();
	});

	it.each(["document", "letter", "create"] as const)(
		"F3 %s refuses a locked displaced letter whose reverse is null, atomically",
		async (mode) => {
			const displaced = await letter();
			const replacement = await letter();
			const linked = await job();
			await api.documents.linkApplication({ type: "letter", id: displaced.id, applicationId: linked });
			await pool.query("UPDATE cover_letter SET source_application_id=NULL WHERE id=$1", [displaced.id]);
			await api.documents.setLocked({ type: "letter", id: displaced.id, isLocked: true });
			await refused(
				() =>
					mode === "document"
						? api.documents.linkApplication({ type: "letter", id: replacement.id, applicationId: linked })
						: mode === "create"
							? api.coverLetters.create({ name: "New", applicationId: linked })
							: api.coverLetters.update({
									id: replacement.id,
									expectedRevision: replacement.revision,
									applicationId: linked,
								}),
				"DOCUMENT_LOCKED",
				null,
			);
		},
	);

	it.each(["single", "bulk", "career"] as const)(
		"J06 closed/reopen %s does not invent a late-linked sent receipt",
		async (mode) => {
			const linked = await job({ status: "applied" });
			const late = await letter();
			await api.documents.linkApplication({ type: "letter", id: late.id, applicationId: linked });
			const fresh = await api.coverLetters.getById({ id: late.id });
			await api.coverLetters.update({
				id: late.id,
				expectedRevision: fresh.revision,
				content: "<p>AFTER ORIGINAL SUBMISSION</p>",
			});
			await api.applications.update({ id: linked, status: "closed", closedReason: "not-selected" });
			if (mode === "single") await api.applications.update({ id: linked, status: "screening" });
			else if (mode === "bulk") await api.applications.bulkUpdate({ ids: [linked], status: "screening" });
			else await reply(linked, "screening");
			const snapshot = await coherent();
			expect(snapshot.applications.find((row) => row.id === linked)?.sent_cover_letter_version_id).toBeNull();
			expect(snapshot.versions.filter((row) => row.kind === "sent")).toHaveLength(0);
		},
	);

	it.each(["single", "bulk", "explicit"] as const)(
		"J02 first Saved submission via %s snapshots the actual content immutably",
		async (mode) => {
			const shared = await letter();
			const linked = await job({ coverLetterId: shared.id });
			const fresh = await api.coverLetters.getById({ id: shared.id });
			await api.coverLetters.update({
				id: shared.id,
				expectedRevision: fresh.revision,
				content: "<p>REAL SUBMISSION TEXT</p>",
			});
			if (mode === "single") await api.applications.update({ id: linked, status: "applied" });
			else if (mode === "bulk") await api.applications.bulkUpdate({ ids: [linked], status: "applied" });
			else
				await api.career.submitApplication({
					applicationId: linked,
					answers: [],
					expectedAnswers: [],
					expectedDocuments: { resumeId: null, coverLetterId: shared.id },
				});
			const submitted = await coherent();
			const receipt = submitted.applications.find((row) => row.id === linked)?.sent_cover_letter_version_id;
			expect(receipt).toEqual(expect.any(String));
			const version = submitted.versions.find((row) => row.id === receipt);
			expect(version?.kind).toBe("sent");
			expect((version?.data as { content?: string } | undefined)?.content).toBe("<p>REAL SUBMISSION TEXT</p>");
			const latest = await api.coverLetters.getById({ id: shared.id });
			await api.coverLetters.update({
				id: shared.id,
				expectedRevision: latest.revision,
				content: "<p>Later draft</p>",
			});
			expect((await state()).versions.find((row) => row.id === receipt)).toEqual(version);
			const replacement = await letter();
			await refused(() => api.applications.update({ id: linked, coverLetterId: replacement.id }));
		},
	);

	it.each(["null-reverse", "stale-forward-alias"] as const)(
		"K01 application clear inventories reverse aliases for %s",
		async (shape) => {
			const shared = await letter();
			const stale = await letter();
			const canonical = await job();
			const other = await job();
			await api.documents.linkApplication({ type: "letter", id: shared.id, applicationId: canonical });
			const target = shape === "null-reverse" ? canonical : other;
			if (shape === "null-reverse")
				await pool.query("UPDATE cover_letter SET source_application_id=NULL WHERE id=$1", [shared.id]);
			else await pool.query("UPDATE application SET cover_letter_id=$1 WHERE id=$2", [shared.id, other]);
			await pool.query("UPDATE cover_letter SET source_application_id=$1 WHERE id=$2", [target, stale.id]);
			const before = await state();
			await api.applications.update({ id: target, coverLetterId: null });
			const after = await coherent();
			expect(after.letters.find((row) => row.id === stale.id)?.source_application_id).toBeNull();
			if (shape === "stale-forward-alias") {
				expect(after.applications.find((row) => row.id === canonical)).toEqual(
					before.applications.find((row) => row.id === canonical),
				);
				expect(after.letters.find((row) => row.id === shared.id)).toEqual(
					before.letters.find((row) => row.id === shared.id),
				);
				expect(after.versions).toEqual(before.versions);
			}
		},
	);

	it.each(["null-reverse", "stale-forward-alias"] as const)(
		"K02 clear %s refuses a locked reverse alias before any write",
		async (shape) => {
			const shared = await letter();
			const stale = await letter();
			const canonical = await job();
			const other = await job();
			await api.documents.linkApplication({ type: "letter", id: shared.id, applicationId: canonical });
			const target = shape === "null-reverse" ? canonical : other;
			if (shape === "null-reverse")
				await pool.query("UPDATE cover_letter SET source_application_id=NULL WHERE id=$1", [shared.id]);
			else await pool.query("UPDATE application SET cover_letter_id=$1 WHERE id=$2", [shared.id, other]);
			await pool.query("UPDATE cover_letter SET source_application_id=$1 WHERE id=$2", [target, stale.id]);
			await api.documents.setLocked({ type: "letter", id: stale.id, isLocked: true });
			await refused(() => api.applications.update({ id: target, coverLetterId: null }), "DOCUMENT_LOCKED", null);
		},
	);

	it.each(["single", "bulk", "career"] as const)(
		"K03 deleted historical Applied then %s reopen keeps the lifetime receipt null",
		async (mode) => {
			const linked = await job({ status: "applied" });
			const late = await letter();
			await api.documents.linkApplication({ type: "letter", id: late.id, applicationId: linked });
			const fresh = await api.coverLetters.getById({ id: late.id });
			await api.coverLetters.update({
				id: late.id,
				expectedRevision: fresh.revision,
				content: "<p>AFTER ORIGINAL SUBMISSION</p>",
			});
			await api.applications.update({ id: linked, status: "closed", closedReason: "not-selected" });
			const closed = (await state()).applications.find((row) => row.id === linked);
			for (const entry of (closed?.activity ?? []).filter(
				(entry: { type?: string; stage?: string }) =>
					entry.type === "stage" &&
					entry.stage !== undefined &&
					["applied", "screening", "interview", "offer"].includes(entry.stage),
			))
				await api.applications.deleteTimelineEntry({ id: linked, entryId: entry.id });
			const before = await state();
			expect(before.applications.find((row) => row.id === linked)?.sent_cover_letter_version_id).toBeNull();
			expect(before.versions.filter((row) => row.kind === "sent")).toHaveLength(0);
			if (mode === "single") await api.applications.update({ id: linked, status: "screening" });
			else if (mode === "bulk") await api.applications.bulkUpdate({ ids: [linked], status: "screening" });
			else await reply(linked, "screening");
			const after = await coherent();
			expect(after.applications.find((row) => row.id === linked)?.sent_cover_letter_version_id).toBeNull();
			expect(after.versions.filter((row) => row.kind === "sent")).toHaveLength(0);
		},
	);

	it.each(["application", "document", "letter", "document-unlink", "letter-unlink"] as const)(
		"K04 stale Z %s preserves submitted and locked canonical A/X",
		async (mode) => {
			const canonical = await letter();
			const stale = await letter();
			const linked = await job();
			const other = await job();
			await api.documents.linkApplication({ type: "letter", id: canonical.id, applicationId: linked });
			await api.applications.update({ id: linked, status: "applied" });
			await api.documents.setLocked({ type: "letter", id: canonical.id, isLocked: true });
			await pool.query("UPDATE cover_letter SET source_application_id=$1 WHERE id=$2", [linked, stale.id]);
			const before = await state();
			if (mode === "application") await api.applications.update({ id: other, coverLetterId: stale.id });
			else if (mode === "document" || mode === "document-unlink")
				await api.documents.linkApplication({
					type: "letter",
					id: stale.id,
					applicationId: mode === "document" ? other : null,
				});
			else {
				const fresh = await api.coverLetters.getById({ id: stale.id });
				await api.coverLetters.update({
					id: stale.id,
					expectedRevision: fresh.revision,
					applicationId: mode === "letter" ? other : null,
				});
			}
			const after = await coherent();
			expect(after.applications.find((row) => row.id === linked)).toEqual(
				before.applications.find((row) => row.id === linked),
			);
			expect(after.letters.find((row) => row.id === canonical.id)).toEqual(
				before.letters.find((row) => row.id === canonical.id),
			);
			expect(after.versions.filter((row) => row.cover_letter_id === canonical.id)).toEqual(
				before.versions.filter((row) => row.cover_letter_id === canonical.id),
			);
		},
	);

	it.each(["real-owner", "submitted-owner", "locked-alias", "ambiguous-owners"] as const)(
		"K05 complete detach with reverse alias %s reconciles or refuses atomically",
		async (shape) => {
			const shared = await letter();
			const stale = await letter();
			const canonical = await job();
			const alias = await job();
			const target = await job();
			const owner = await job();
			const secondOwner = await job();
			await api.documents.linkApplication({ type: "letter", id: shared.id, applicationId: canonical });
			await api.documents.linkApplication({ type: "letter", id: stale.id, applicationId: owner });
			if (shape === "submitted-owner") await api.applications.update({ id: owner, status: "applied" });
			if (shape === "locked-alias") await api.documents.setLocked({ type: "letter", id: stale.id, isLocked: true });
			await pool.query("UPDATE application SET cover_letter_id=$1 WHERE id=$2", [shared.id, alias]);
			await pool.query("UPDATE cover_letter SET source_application_id=$1 WHERE id=$2", [alias, stale.id]);
			if (shape === "ambiguous-owners")
				await pool.query("UPDATE application SET cover_letter_id=$1 WHERE id=$2", [stale.id, secondOwner]);
			const before = await state();
			const result = await Promise.allSettled([
				api.documents.linkApplication({ type: "letter", id: shared.id, applicationId: target }),
			]);
			const after = await state();
			if (shape === "locked-alias" || shape === "ambiguous-owners") {
				expect(result[0]?.status).toBe("rejected");
				if (result[0]?.status === "rejected")
					expect(result[0].reason).toMatchObject({
						code: shape === "locked-alias" ? "DOCUMENT_LOCKED" : "CONFLICT",
					});
				expect(after).toEqual(before);
			} else {
				expect(result[0]?.status).toBe("fulfilled");
				expect(after.letters.find((row) => row.id === stale.id)?.source_application_id).toBe(owner);
				expect(after.applications.find((row) => row.id === owner)).toEqual(
					before.applications.find((row) => row.id === owner),
				);
				expect(after.versions).toEqual(before.versions);
				await coherent();
			}
		},
	);

	it("K07 explicit Mark Applied after Applied→Saved snapshots the actual late draft", async () => {
		const linked = await job({ status: "applied" });
		const late = await letter();
		await api.documents.linkApplication({ type: "letter", id: late.id, applicationId: linked });
		const fresh = await api.coverLetters.getById({ id: late.id });
		await api.coverLetters.update({
			id: late.id,
			expectedRevision: fresh.revision,
			content: "<p>AFTER ORIGINAL SUBMISSION</p>",
		});
		await api.applications.update({ id: linked, status: "saved" });
		await api.career.submitApplication({
			applicationId: linked,
			answers: [],
			expectedAnswers: [],
			expectedDocuments: { resumeId: null, coverLetterId: late.id },
		});
		const snapshot = await state();
		const receipt = snapshot.applications.find((row) => row.id === linked)?.sent_cover_letter_version_id;
		expect(receipt).toEqual(expect.any(String));
		expect((snapshot.versions.find((row) => row.id === receipt)?.data as { content?: string })?.content).toBe(
			"<p>AFTER ORIGINAL SUBMISSION</p>",
		);
	});

	it.each(["unsent-alias", "submitted-alias"] as const)(
		"K08 clearing canonical A reconciles remaining %s X owner",
		async (shape) => {
			const shared = await letter();
			const canonical = await job();
			const alias = await job();
			await api.documents.linkApplication({ type: "letter", id: shared.id, applicationId: canonical });
			await pool.query("UPDATE application SET cover_letter_id=$1 WHERE id=$2", [shared.id, alias]);
			if (shape === "submitted-alias") await api.applications.update({ id: alias, status: "applied" });
			const before = await state();
			const result = await Promise.allSettled([api.applications.update({ id: canonical, coverLetterId: null })]);
			const after = await state();
			if (result[0]?.status === "rejected") {
				expect(result[0].reason.code).toMatch(/CONFLICT|BAD_REQUEST/);
				expect(after).toEqual(before);
			} else {
				expect(after.applications.find((row) => row.id === canonical)?.cover_letter_id).toBeNull();
				await coherent();
			}
			expect(after.versions).toEqual(before.versions);
		},
	);

	it("M02 backfills a Closed application whose only remaining submission evidence is its sent letter", async () => {
		const sent = await letter();
		const id = await job({ status: "applied", coverLetterId: sent.id });
		await api.applications.update({ id, status: "closed", closedReason: "not-selected" });
		const closed = (await state()).applications.find((row) => row.id === id);
		for (const entry of closed.activity.filter(
			(entry: { type: string; stage?: string }) => entry.type === "stage" && entry.stage === "applied",
		))
			await api.applications.deleteTimelineEntry({ id, entryId: entry.id });
		// Emulate an account upgrading from before submitted_at existed; its real sent version remains.
		await pool.query("UPDATE application SET submitted_at=NULL WHERE id=$1", [id]);
		const before = await state();
		expect(before.applications.find((row) => row.id === id)?.sent_cover_letter_version_id).toBeTruthy();
		const migration = await readFile(
			new URL("../../../../../migrations/20261101220239_great_omega_red/migration.sql", import.meta.url),
			"utf8",
		);
		await pool.query(migration.slice(migration.indexOf("UPDATE")));
		const after = await state();
		expect(after.applications.find((row) => row.id === id)?.submitted_at).toBeInstanceOf(Date);
		expect(after.letters).toEqual(before.letters);
		expect(after.versions).toEqual(before.versions);
	});

	it("M01 submitted_at backfill uses sound lifetime evidence and leaves default Saved dates null", async () => {
		await pool.query(
			`INSERT INTO application (id,user_id,company,role,status,applied_at,activity) VALUES
			 ('legacy-applied','alice','A','R','applied','2025-01-01T00:00:00Z','[{"id":"s1","type":"stage","stage":"applied","at":"2025-01-02T00:00:00Z"}]'),
			 ('legacy-closed','alice','B','R','closed','2025-01-01T00:00:00Z','[{"id":"s2","type":"stage","stage":"applied","at":"2025-02-01T00:00:00Z"},{"id":"s3","type":"stage","stage":"closed","at":"2025-03-01T00:00:00Z"}]'),
			 ('legacy-saved','alice','C','R','saved','2025-01-01T00:00:00Z','[]'),
			 ('legacy-closed-before-apply','alice','D','R','closed','2025-01-01T00:00:00Z','[{"id":"s4","type":"stage","stage":"closed","at":"2025-03-01T00:00:00Z"}]')`,
		);
		const migration = await readFile(
			new URL("../../../../../migrations/20261101220239_great_omega_red/migration.sql", import.meta.url),
			"utf8",
		);
		await pool.query(migration.slice(migration.indexOf("UPDATE")));
		const rows = (await pool.query("SELECT id, submitted_at FROM application WHERE id LIKE 'legacy-%' ORDER BY id"))
			.rows as { id: string; submitted_at: Date | null }[];
		const byId = Object.fromEntries(rows.map((row) => [row.id, row.submitted_at]));
		expect(byId["legacy-applied"]).toEqual(new Date("2025-01-02T00:00:00Z"));
		expect(byId["legacy-closed"]).toEqual(new Date("2025-02-01T00:00:00Z"));
		expect(byId["legacy-saved"]).toBeNull();
		expect(byId["legacy-closed-before-apply"]).toBeNull();
	});
});
