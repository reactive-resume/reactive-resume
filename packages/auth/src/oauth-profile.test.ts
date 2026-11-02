import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const dbMock = vi.hoisted(() => {
	const selectQueue: unknown[][] = [];
	const updateWhere = vi.fn();
	const updateSet = vi.fn((_value: unknown) => ({
		where: updateWhere,
	}));
	const where = vi.fn(() => ({
		limit: vi.fn(() => selectQueue.shift() ?? []),
	}));
	const innerJoin = vi.fn(() => ({ where }));
	const from = vi.fn(() => ({ innerJoin, where }));
	const select = vi.fn(() => ({ from }));
	const update = vi.fn(() => ({ set: updateSet }));

	return {
		selectQueue,
		select,
		from,
		innerJoin,
		where,
		update,
		updateSet,
		updateWhere,
	};
});

vi.mock("@reactive-resume/db/client", () => ({
	db: {
		select: dbMock.select,
		update: dbMock.update,
	},
}));

const { allocateUniqueUsername, createGithubProfileMapper, createProfileMapper, isUsernameReserved } =
	await import("./oauth-profile");

beforeEach(() => {
	dbMock.selectQueue.length = 0;
	dbMock.select.mockClear();
	dbMock.from.mockClear();
	dbMock.innerJoin.mockClear();
	dbMock.where.mockClear();
	dbMock.update.mockClear();
	dbMock.updateSet.mockClear();
	dbMock.updateWhere.mockClear();
});

describe("createProfileMapper", () => {
	it("does not reuse a migrated GitHub account when only the login matches", async () => {
		dbMock.selectQueue.push(
			[
				{
					id: "user-1",
					accountId: "legacy-user-id",
					email: "Legacy.User@Example.COM",
					username: "octo-cat",
					displayUsername: "Octo-Cat",
					name: "Legacy User",
					image: "https://example.com/old.png",
				},
			],
			[],
			// Each username check first looks for a recent release, then for an account holding it.
			[],
			[{ id: "user-1" }],
			[],
			[],
		);

		const mapper = createGithubProfileMapper();

		const result = await mapper({
			id: "123456",
			email: "current.github@example.com",
			login: "Octo-Cat",
			name: "Provider Name",
			avatar_url: "https://example.com/new.png",
		});

		expect(dbMock.select).toHaveBeenCalledTimes(6);
		expect(dbMock.update).not.toHaveBeenCalled();
		expect(result).toEqual({
			name: "Provider Name",
			email: "current.github@example.com",
			image: "https://example.com/new.png",
			username: "octo-cat-1",
			displayUsername: "octo-cat-1",
		});
	});

	it("normalizes a matched legacy user email before handing it to Better Auth", async () => {
		dbMock.selectQueue.push([
			{
				id: "user-1",
				email: "Legacy.User@Example.COM",
				username: "legacy.user",
				displayUsername: "legacy.user",
				name: "Legacy User",
				image: "https://example.com/old.png",
			},
		]);

		const mapper = createProfileMapper({
			providerName: "Google",
			getImage: (profile) => profile.picture,
		});

		const result = await mapper({
			email: "legacy.user@example.com",
			name: "Provider Name",
			picture: "https://example.com/new.png",
		});

		expect(dbMock.update).toHaveBeenCalledTimes(1);
		expect(dbMock.updateSet).toHaveBeenCalledWith({ email: "legacy.user@example.com" });
		expect(result).toEqual({
			name: "Legacy User",
			email: "legacy.user@example.com",
			image: "https://example.com/new.png",
			username: "legacy.user",
			displayUsername: "legacy.user",
		});
	});
});

describe("isUsernameReserved", () => {
	it("keeps the app's addresses from new accounts but lets an account that already has one keep it", async () => {
		expect(await isUsernameReserved("Login")).toBe(true);
		expect(await isUsernameReserved("api", "user-2")).toBe(true);

		dbMock.selectQueue.push([{ id: "user-1" }]);
		expect(await isUsernameReserved("login", "user-1")).toBe(false);
		// Only a claimant is looked up: "Login" with no account is turned down at once.
		expect(dbMock.select).toHaveBeenCalledTimes(2);
	});

	it("gives a new account named after a sign-in address a free name instead", async () => {
		const mapper = createProfileMapper({ providerName: "Google" });

		const result = await mapper({ email: "login@example.com", name: "Login Person" });

		// The email lookup, then "login-1" (a release, then an account); "login" itself is turned down without one.
		expect(dbMock.select).toHaveBeenCalledTimes(3);
		expect(result).toMatchObject({ username: "login-1", displayUsername: "login-1" });
	});
});

describe("allocateUniqueUsername", () => {
	it("makes a name of at least three characters from a short email address", async () => {
		await expect(allocateUniqueUsername("a@example.test")).resolves.toBe("user");
		await expect(allocateUniqueUsername("ab@example.test", "x")).resolves.toBe("user");
		await expect(allocateUniqueUsername("ada@example.test", "x")).resolves.toBe("ada");
	});
});
