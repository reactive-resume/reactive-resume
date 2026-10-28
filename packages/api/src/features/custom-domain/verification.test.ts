import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

type Row = {
	userId: string;
	hostname: string;
	verificationToken: string;
	verifiedAt: Date | null;
	lastCheckedAt: Date | null;
	failingSince: Date | null;
};
type Predicate = (row: Row) => boolean;
const mocks = vi.hoisted(() => ({ row: null as Row | null, txt: vi.fn(), update: vi.fn() }));
vi.mock("node:dns/promises", () => ({
	resolveTxt: mocks.txt,
	resolveCname: async () => ["domains.example.test"],
	resolve4: async () => [],
	resolve6: async () => [],
}));
vi.mock("@reactive-resume/env/server", () => ({
	env: {
		APP_URL: "https://resume.example.test",
		CUSTOM_DOMAIN_TARGET: "domains.example.test",
		CUSTOM_DOMAIN_PROVIDER_SECRET: "test",
	},
}));
vi.mock("../resume/access-policy", () => ({ ownerIsNotBanned: vi.fn() }));
vi.mock("@reactive-resume/db/schema", () => ({
	customDomain: Object.fromEntries(
		["userId", "hostname", "verificationToken", "verifiedAt", "lastCheckedAt", "failingSince"].map((key) => [key, key]),
	),
}));
vi.mock("drizzle-orm", () => ({
	and:
		(...conditions: Predicate[]) =>
		(row: Row) =>
			conditions.every((condition) => condition(row)),
	eq: (key: keyof Row, value: unknown) => (row: Row) => row[key] === value,
	ne: (key: keyof Row, value: unknown) => (row: Row) => row[key] !== value,
}));
vi.mock("@reactive-resume/db/client", () => {
	const db = {
		select: () => ({
			from: () => ({
				where: (matches: Predicate) => {
					const rows = () => (mocks.row && matches(mocks.row) ? [{ ...mocks.row }] : []);
					return Object.assign(Promise.resolve(rows()), { for: async () => rows() });
				},
			}),
		}),
		update: () => ({
			set: (values: Partial<Row>) => ({
				where: (matches: Predicate) => {
					mocks.update(values);
					if (mocks.row && matches(mocks.row)) mocks.row = { ...mocks.row, ...values };
					return Object.assign(Promise.resolve(), { returning: async () => [mocks.row] });
				},
			}),
		}),
	};
	return { db: { ...db, transaction: (run: (tx: typeof db) => unknown) => run(db) } };
});

import { customDomainService } from "./service";

beforeEach(() => {
	mocks.row = {
		userId: "owner",
		hostname: "cv.example.test",
		verificationToken: "proof",
		verifiedAt: new Date(),
		lastCheckedAt: null,
		failingSince: null,
	};
	mocks.update.mockClear();
	mocks.txt.mockReset();
});

describe("DNS proof commits", () => {
	it.each(["hostname", "verificationToken"] as const)(
		"does not verify a changed %s after DNS resolves",
		async (key) => {
			mocks.txt.mockImplementation(async () => {
				if (mocks.row) mocks.row = { ...mocks.row, [key]: "changed", verifiedAt: null };
				return [["rx-verify=proof"]];
			});
			await expect(customDomainService.verify("owner")).rejects.toMatchObject({ code: "CONFLICT" });
			expect(mocks.update).not.toHaveBeenCalled();
		},
	);
	it.each([2, 8])("manual failures respect the grace period after %s days", async (days) => {
		if (!mocks.row) throw new Error("Missing fixture");
		mocks.row.failingSince = new Date(Date.now() - days * 86_400_000);
		mocks.txt.mockResolvedValue([]);
		expect((await customDomainService.verify("owner")).verified).toBe(days <= 7);
	});
});
