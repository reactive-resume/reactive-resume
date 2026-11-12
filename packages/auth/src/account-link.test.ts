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

	it("moves the guest's Knowledge facts, stories, career profile and workspace data with the documents", async () => {
		await linkAnonymousAccount({ fromUserId: "guest-123", toUserId: "user-456" });
		const moved = (table: unknown) =>
			mocks.update.mock.calls.some(
				(call, index) => call[0] === table && mocks.updateSet.mock.calls[index]?.[0]?.userId === "user-456",
			);
		expect(moved(schema.careerFact)).toBe(true);
		expect(moved(schema.careerStory)).toBe(true);
		expect(moved(schema.careerProfile)).toBe(true);
		expect(moved(schema.careerWorkspace)).toBe(true);
		expect(moved(schema.careerArtifact)).toBe(true);
		expect(moved(schema.careerTranscript)).toBe(true);
	});

	it("does nothing when fromUserId equals toUserId", async () => {
		const hook = vi.fn().mockResolvedValue(undefined);
		setAccountLinkHook(hook);

		await linkAnonymousAccount({ fromUserId: "user-1", toUserId: "user-1" });

		expect(mocks.transaction).not.toHaveBeenCalled();
		expect(hook).not.toHaveBeenCalled();
	});
});
