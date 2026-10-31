import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import * as schema from "@reactive-resume/db/schema";

const mocks = vi.hoisted(() => {
	const updateWhere = vi.fn((_where?: unknown) => Promise.resolve([]));
	const updateSet = vi.fn((_values: Record<string, unknown>) => ({
		where: updateWhere,
	}));
	const update = vi.fn((_table: unknown) => ({
		set: updateSet,
	}));
	const deleteWhere = vi.fn((_where?: unknown) => Promise.resolve([]));
	const deleteFn = vi.fn((_table: unknown) => ({
		where: deleteWhere,
	}));
	const select = vi.fn(() => ({
		from: (table: unknown) => {
			const rows =
				table === schema.user
					? [{ id: "fixture-owner" }]
					: table === schema.application
						? [{ id: "guest-application", status: "saved", laneId: null, activity: [] }]
						: [];
			return { where: () => Object.assign(Promise.resolve(rows), { for: () => Promise.resolve(rows) }) };
		},
	}));
	const insert = vi.fn(() => ({ values: () => ({ onConflictDoNothing: () => Promise.resolve() }) }));
	const tx = { select, insert, update, delete: deleteFn };
	const transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));
	return { update, updateSet, updateWhere, delete: deleteFn, deleteWhere, transaction, tx };
});

vi.mock("better-auth", async (importOriginal) => ({
	...(await importOriginal<typeof import("better-auth")>()),
	betterAuth: () => ({ $context: Promise.resolve({}), api: {} }),
}));
vi.mock("@reactive-resume/db/client", () => ({
	db: { transaction: mocks.transaction },
}));
vi.mock("@reactive-resume/email/transport", () => ({ sendEmail: vi.fn() }));
vi.mock("@reactive-resume/env/server", () => ({
	env: { APP_URL: "https://resume.example", AUTH_SECRET: "link-test" },
}));

const { linkAnonymousAccount, setAccountLinkHook } = await import("./config");

beforeEach(() => {
	mocks.update.mockClear();
	mocks.updateSet.mockClear();
	mocks.updateWhere.mockClear();
	mocks.delete.mockClear();
	mocks.deleteWhere.mockClear();
	mocks.transaction.mockClear();
	setAccountLinkHook();
});

describe("linkAnonymousAccount", () => {
	it("copies before commit and cleans up only after commit", async () => {
		const events: string[] = [];
		setAccountLinkHook(async () => {
			expect(mocks.updateWhere).toHaveBeenCalled();
			events.push("copy");
			return async () => {
				events.push("cleanup");
			};
		});
		mocks.transaction.mockImplementationOnce(async (cb) => {
			const result = await cb(mocks.tx);
			events.push("commit");
			return result;
		});

		await linkAnonymousAccount({ fromUserId: "guest-123", toUserId: "user-456" });
		expect(events).toEqual(["copy", "commit", "cleanup"]);
	});

	it("preserves originals when the database transition fails", async () => {
		const cleanup = vi.fn();
		setAccountLinkHook(async () => cleanup);
		mocks.transaction.mockRejectedValueOnce(new Error("Database unavailable"));

		await expect(linkAnonymousAccount({ fromUserId: "guest-123", toUserId: "user-456" })).rejects.toThrow(
			"Database unavailable",
		);
		expect(cleanup).not.toHaveBeenCalled();
	});

	it("does not reject a committed link when its cleanup fails", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		setAccountLinkHook(async () => async () => {
			throw new Error("Cleanup unavailable");
		});

		await expect(linkAnonymousAccount({ fromUserId: "guest-123", toUserId: "user-456" })).resolves.toBeUndefined();
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});

	it("updates document ownership, rewrites upload URLs in DB, and executes registered hooks", async () => {
		const hook = vi.fn().mockResolvedValue(undefined);
		setAccountLinkHook(hook);

		await linkAnonymousAccount({
			fromUserId: "guest-123",
			toUserId: "user-456",
		});

		expect(mocks.transaction).toHaveBeenCalledOnce();

		// Check resume update includes data rewrite
		const resumeUpdateCall = mocks.update.mock.calls.find((call) => call[0] === schema.resume);
		expect(resumeUpdateCall).toBeDefined();
		const resumeSetArg = mocks.updateSet.mock.calls.find(
			(_, idx) => mocks.update.mock.calls[idx]?.[0] === schema.resume,
		)?.[0];
		expect(resumeSetArg).toMatchObject({ userId: "user-456" });
		expect(resumeSetArg).toHaveProperty("data");

		// Check resumeVersion update includes data rewrite
		const resumeVersionUpdateCall = mocks.update.mock.calls.find((call) => call[0] === schema.resumeVersion);
		expect(resumeVersionUpdateCall).toBeDefined();
		const resumeVersionSetArg = mocks.updateSet.mock.calls.find(
			(_, idx) => mocks.update.mock.calls[idx]?.[0] === schema.resumeVersion,
		)?.[0];
		expect(resumeVersionSetArg).toMatchObject({ userId: "user-456" });
		expect(resumeVersionSetArg).toHaveProperty("data");

		// Check application update includes resumeFileUrl and coverLetterUrl rewrites
		const appUpdateCall = mocks.update.mock.calls.find((call) => call[0] === schema.application);
		expect(appUpdateCall).toBeDefined();
		const appSetArg = mocks.updateSet.mock.calls.find(
			(_, idx) => mocks.update.mock.calls[idx]?.[0] === schema.application,
		)?.[0];
		expect(appSetArg).toMatchObject({ userId: "user-456" });
		expect(appSetArg).toHaveProperty("resumeFileUrl");
		expect(appSetArg).toHaveProperty("coverLetterUrl");

		// Check coverLetter update includes style rewrite
		const coverLetterUpdateCall = mocks.update.mock.calls.find((call) => call[0] === schema.coverLetter);
		expect(coverLetterUpdateCall).toBeDefined();
		const coverLetterSetArg = mocks.updateSet.mock.calls.find(
			(_, idx) => mocks.update.mock.calls[idx]?.[0] === schema.coverLetter,
		)?.[0];
		expect(coverLetterSetArg).toMatchObject({ userId: "user-456" });
		expect(coverLetterSetArg).toHaveProperty("style");

		// Check coverLetterVersion update includes data rewrite
		const coverLetterVersionUpdateCall = mocks.update.mock.calls.find((call) => call[0] === schema.coverLetterVersion);
		expect(coverLetterVersionUpdateCall).toBeDefined();
		const coverLetterVersionSetArg = mocks.updateSet.mock.calls.find(
			(_, idx) => mocks.update.mock.calls[idx]?.[0] === schema.coverLetterVersion,
		)?.[0];
		expect(coverLetterVersionSetArg).toMatchObject({ userId: "user-456" });
		expect(coverLetterVersionSetArg).toHaveProperty("data");

		// Check resumeSlugRedirect deduplication and update
		const redirectDeleteCall = mocks.delete.mock.calls.find((call) => call[0] === schema.resumeSlugRedirect);
		expect(redirectDeleteCall).toBeDefined();

		const redirectUpdateCall = mocks.update.mock.calls.find((call) => call[0] === schema.resumeSlugRedirect);
		expect(redirectUpdateCall).toBeDefined();
		const redirectSetArg = mocks.updateSet.mock.calls.find(
			(_, idx) => mocks.update.mock.calls[idx]?.[0] === schema.resumeSlugRedirect,
		)?.[0];
		expect(redirectSetArg).toMatchObject({ userId: "user-456" });

		// Check hook execution
		expect(hook).toHaveBeenCalledWith({
			fromUserId: "guest-123",
			toUserId: "user-456",
			excludedStoragePrefixes: [],
		});
	});

	it("does nothing when fromUserId equals toUserId", async () => {
		const hook = vi.fn().mockResolvedValue(undefined);
		setAccountLinkHook(hook);

		await linkAnonymousAccount({ fromUserId: "user-1", toUserId: "user-1" });

		expect(mocks.transaction).not.toHaveBeenCalled();
		expect(hook).not.toHaveBeenCalled();
	});
});
