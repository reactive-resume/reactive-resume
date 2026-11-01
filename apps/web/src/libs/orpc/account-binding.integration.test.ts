// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";

/**
 * Real transport + real HTTP regression for account-bound writes. Runs only when RX106_BINDING_APP_URL points at a
 * disposable server; every account is synthetic and deleted afterwards.
 */
const appUrl = process.env.RX106_BINDING_APP_URL;

describe.skipIf(!appUrl)("account binding over the real transport", () => {
	const tag = `rx106bind${Date.now().toString(36)}`;
	const realFetch = globalThis.fetch.bind(globalThis);
	const alicePayload = {
		targetRoles: ["Alice private role"],
		priorities: "Alice private priorities",
		memoryMode: "ask",
	};
	const bobPayload = {
		targetRoles: ["Bob role"],
		priorities: "Bob priorities",
		memoryMode: "ask",
	};
	const requests: Array<{ url: string; headers: Headers }> = [];
	let alice = { id: "", cookie: "" };
	let bob = { id: "", cookie: "" };

	const cookieFrom = (response: Response) =>
		(response.headers.getSetCookie?.() ?? []).map((cookie) => cookie.split(";")[0]).join("; ");

	const signUp = async (label: string) => {
		const email = `${tag}-${label}@example.test`;
		const username = `${tag}_${label}`.slice(0, 64);
		const response = await realFetch(`${appUrl}/api/auth/sign-up/email`, {
			method: "POST",
			headers: { origin: appUrl ?? "", referer: `${appUrl}/auth/register`, "content-type": "application/json" },
			body: JSON.stringify({
				name: `Fictional ${label}`,
				email,
				password: "Password123!",
				username,
				displayUsername: username,
				callbackURL: "/dashboard",
			}),
		});
		expect(response.ok, await response.text()).toBe(true);
		const cookie = cookieFrom(response);
		const session = await realFetch(`${appUrl}/api/auth/get-session`, { headers: { cookie } }).then((r) => r.json());
		return { id: session.user.id as string, cookie };
	};

	const profile = async (cookie: string) =>
		realFetch(`${appUrl}/api/openapi/career/profile`, { headers: { cookie } }).then((r) => r.json());

	beforeAll(async () => {
		vi.stubGlobal("window", { location: { origin: appUrl } });
		alice = await signUp("alice");
		bob = await signUp("bob");
		expect(alice.id).not.toBe(bob.id);
		const initial = await profile(alice.cookie);
		const seeded = await realFetch(`${appUrl}/api/openapi/career/profile`, {
			method: "PUT",
			headers: { cookie: alice.cookie, "content-type": "application/json" },
			body: JSON.stringify({ ...initial, ...alicePayload }),
		});
		expect(seeded.ok).toBe(true);
		expect((await profile(bob.cookie)).targetRoles).toEqual([]);
	}, 60_000);

	afterAll(async () => {
		vi.unstubAllGlobals();
		// Delete each synthetic account through the real endpoint so no test dependency on the database driver is needed.
		for (const account of [alice, bob].filter((entry) => entry.id)) {
			const response = await realFetch(`${appUrl}/api/rpc/auth/deleteAccount`, {
				method: "POST",
				headers: { origin: appUrl ?? "", cookie: account.cookie, "content-type": "application/json" },
				body: JSON.stringify({ json: {} }),
			});
			if (!response.ok) console.warn("[account-binding] synthetic account cleanup failed", response.status);
		}
	});

	const installTransport = (cookie: string) => {
		vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
			const request = new Request(input, init);
			request.headers.set("cookie", cookie);
			requests.push({ url: request.url, headers: new Headers(request.headers) });
			return realFetch(request);
		});
	};

	it("refuses a single call bound to another account", async () => {
		const { setAccountScope } = await import("@/libs/auth/account-scope");
		const { client } = await import("./client");
		setAccountScope(bob.id);
		installTransport(bob.cookie);
		await expect(
			client.career.saveProfile(alicePayload as never, { context: { accountId: alice.id } }),
		).rejects.toMatchObject({ status: 409 });
		expect((await profile(bob.cookie)).targetRoles).toEqual([]);
		const sent = requests.at(-1);
		expect(sent?.headers.get("x-account-id")).toBe(alice.id);
		expect(sent?.headers.get("x-orpc-batch")).toBeNull();
	});

	it("refuses an unbound call made while the page still belongs to the previous account", async () => {
		const { setAccountScope } = await import("@/libs/auth/account-scope");
		const { client } = await import("./client");
		installTransport(bob.cookie);
		setAccountScope(alice.id);
		// No explicit context: the transport captures the page's stale account when the call starts.
		await expect(client.career.saveProfile(alicePayload as never)).rejects.toMatchObject({ status: 409 });
		expect((await profile(bob.cookie)).targetRoles).toEqual([]);
	});

	it.each([
		{ first: "bound", why: "bound call first" },
		{ first: "unbound", why: "unbound call first" },
	])("never lets a mixed batch write one account's profile into another ($why)", async ({ first }) => {
		const { setAccountScope } = await import("@/libs/auth/account-scope");
		const { client } = await import("./client");
		requests.length = 0;
		setAccountScope(bob.id);
		installTransport(bob.cookie);
		const bound = () => client.career.saveProfile(alicePayload as never, { context: { accountId: alice.id } });
		const unbound = () =>
			client.career.saveFact({
				applicationId: null,
				text: `Bob fact ${first}`,
				category: "accomplishment",
				source: { kind: "manual", id: first, quote: first },
			} as never);
		const boundFirst = first === "bound";
		const settled = await Promise.allSettled(boundFirst ? [bound(), unbound()] : [unbound(), bound()]);
		const boundResult = settled[boundFirst ? 0 : 1];
		const unboundResult = settled[boundFirst ? 1 : 0];
		expect(unboundResult?.status).toBe("fulfilled");
		expect(boundResult?.status).toBe("rejected");
		expect((boundResult as PromiseRejectedResult).reason).toMatchObject({ status: 409 });
		expect((await profile(bob.cookie)).targetRoles).toEqual([]);
		const boundRequest = requests.find((request) => request.headers.get("x-account-id") === alice.id);
		expect(boundRequest?.headers.get("x-orpc-batch")).toBeNull();
		expect(boundRequest?.url).not.toContain("__batch__");
	});

	it("evaluates every batch item against its own binding, not the envelope", async () => {
		const item = (accountId: string | null, payload: Record<string, unknown>) => ({
			url: `${appUrl}/api/rpc/career/saveProfile`,
			headers: {
				"content-type": "application/json",
				...(accountId ? { "x-account-id": accountId } : {}),
			},
			body: { json: payload },
		});
		const runBatch = async (envelope: string | null, items: ReturnType<typeof item>[]) => {
			const response = await realFetch(`${appUrl}/api/rpc/__batch__`, {
				method: "POST",
				headers: {
					origin: appUrl ?? "",
					"content-type": "application/json",
					"x-orpc-batch": "streaming",
					cookie: bob.cookie,
					...(envelope ? { "x-account-id": envelope } : {}),
				},
				body: JSON.stringify(items),
			});
			const text = await response.text();
			const statuses = [...text.matchAll(/data: (\{.*\})/g)]
				.map((match) => JSON.parse(match[1] as string) as { index: number; status: number })
				.sort((left, right) => left.index - right.index)
				.map((entry) => entry.status);
			return { status: response.status, statuses, text };
		};
		const baseline = async () => {
			const response = await realFetch(`${appUrl}/api/openapi/career/profile`, {
				method: "PUT",
				headers: { cookie: bob.cookie, "content-type": "application/json" },
				body: JSON.stringify({ ...bobPayload, priorities: "baseline" }),
			});
			expect(response.ok).toBe(true);
		};

		const bobWrite = { ...bobPayload, priorities: "batch-bob" };
		const aliceWrite = { ...alicePayload, priorities: "batch-alice" };
		const cases = [
			{
				name: "envelope bob, alice then bob",
				envelope: bob.id,
				items: [item(alice.id, aliceWrite), item(bob.id, bobWrite)],
				statuses: [409, 200],
				stored: "batch-bob",
			},
			{
				name: "envelope bob, bob then alice",
				envelope: bob.id,
				items: [item(bob.id, bobWrite), item(alice.id, aliceWrite)],
				statuses: [200, 409],
				stored: "batch-bob",
			},
			{
				name: "envelope alice, bob item",
				envelope: alice.id,
				items: [item(bob.id, bobWrite)],
				statuses: [409],
				stored: "baseline",
			},
			{
				name: "no envelope, stale alice item",
				envelope: null,
				items: [item(alice.id, aliceWrite)],
				statuses: [409],
				stored: "baseline",
			},
			{
				name: "no envelope, two bob items",
				envelope: null,
				items: [item(bob.id, bobWrite), item(bob.id, bobWrite)],
				statuses: [200, 200],
				stored: "batch-bob",
			},
			{
				name: "no envelope, headerless item",
				envelope: null,
				items: [item(null, bobWrite)],
				statuses: [200],
				stored: "batch-bob",
			},
		];
		for (const entry of cases) {
			await baseline();
			const result = await runBatch(entry.envelope, entry.items);
			expect(result.status, entry.name).toBe(207);
			expect(result.statuses, entry.name).toEqual(entry.statuses);
			expect((await profile(bob.cookie)).priorities, entry.name).toBe(entry.stored);
			expect((await profile(alice.cookie)).targetRoles, entry.name).toEqual(["Alice private role"]);
		}
	}, 60_000);

	it("reads item bindings case-insensitively in streaming and buffered batches", async () => {
		type Mode = "streaming" | "buffered";
		const item = (
			accountId: string | null,
			payload: Record<string, unknown>,
			headerName = "x-account-id",
			extraHeaders: Record<string, string> = {},
		) => ({
			url: `${appUrl}/api/rpc/career/saveProfile`,
			headers: {
				"content-type": "application/json",
				...(accountId ? { [headerName]: accountId } : {}),
				...extraHeaders,
			},
			body: { json: payload },
		});
		const runBatch = async (mode: Mode, envelope: string | null, items: ReturnType<typeof item>[]) => {
			const response = await realFetch(`${appUrl}/api/rpc/__batch__`, {
				method: "POST",
				headers: {
					origin: appUrl ?? "",
					"content-type": "application/json",
					"x-orpc-batch": mode,
					cookie: bob.cookie,
					...(envelope ? { "x-account-id": envelope } : {}),
				},
				body: JSON.stringify(items),
			});
			if (mode === "buffered") {
				const body = (await response.json()) as Array<{ index: number; status?: number }>;
				const statuses = body.sort((left, right) => left.index - right.index).map((entry) => entry.status ?? 207);
				return { status: response.status, statuses };
			}
			const text = await response.text();
			const statuses = [...text.matchAll(/data: (\{.*\})/g)]
				.map((match) => JSON.parse(match[1] as string) as { index: number; status: number })
				.sort((left, right) => left.index - right.index)
				.map((entry) => entry.status);
			return { status: response.status, statuses };
		};
		const baseline = async () => {
			const response = await realFetch(`${appUrl}/api/openapi/career/profile`, {
				method: "PUT",
				headers: { cookie: bob.cookie, "content-type": "application/json" },
				body: JSON.stringify({ ...bobPayload, priorities: "baseline" }),
			});
			expect(response.ok).toBe(true);
		};

		const bobWrite = { ...bobPayload, priorities: "case-bob" };
		const aliceWrite = { ...alicePayload, priorities: "case-alice" };
		const cases: Array<{
			name: string;
			mode: Mode;
			envelope: string | null;
			items: ReturnType<typeof item>[];
			statuses: number[];
			stored: string;
		}> = [];
		for (const mode of ["streaming", "buffered"] as const) {
			cases.push(
				{
					name: `${mode}: uppercase stale item`,
					mode,
					envelope: bob.id,
					items: [item(alice.id, aliceWrite, "X-Account-Id")],
					statuses: [409],
					stored: "baseline",
				},
				{
					name: `${mode}: mixed-case stale item`,
					mode,
					envelope: bob.id,
					items: [item(alice.id, aliceWrite, "X-Account-ID")],
					statuses: [409],
					stored: "baseline",
				},
				{
					name: `${mode}: uppercase matching item`,
					mode,
					envelope: bob.id,
					items: [item(bob.id, bobWrite, "X-Account-Id")],
					statuses: [200],
					stored: "case-bob",
				},
				{
					name: `${mode}: conflicting envelope and mixed-case item`,
					mode,
					envelope: alice.id,
					items: [item(bob.id, bobWrite, "X-Account-ID")],
					statuses: [409],
					stored: "baseline",
				},
				{
					name: `${mode}: headerless legacy item`,
					mode,
					envelope: null,
					items: [item(null, bobWrite)],
					statuses: [200],
					stored: "case-bob",
				},
			);
		}
		for (const entry of cases) {
			await baseline();
			const result = await runBatch(entry.mode, entry.envelope, entry.items);
			expect(result.status, entry.name).toBe(207);
			expect(result.statuses, entry.name).toEqual(entry.statuses);
			expect((await profile(bob.cookie)).priorities, entry.name).toBe(entry.stored);
			expect((await profile(alice.cookie)).priorities, entry.name).toBe("Alice private priorities");
		}
	}, 60_000);

	it("keeps authentication envelope-bound when an item carries its own cookie or bearer", async () => {
		const item = (payload: Record<string, unknown>, extraHeaders: Record<string, string>) => ({
			url: `${appUrl}/api/rpc/career/saveProfile`,
			headers: { "content-type": "application/json", "x-account-id": bob.id, ...extraHeaders },
			body: { json: payload },
		});
		const runBatch = async (items: ReturnType<typeof item>[]) => {
			const response = await realFetch(`${appUrl}/api/rpc/__batch__`, {
				method: "POST",
				headers: {
					origin: appUrl ?? "",
					"content-type": "application/json",
					"x-orpc-batch": "streaming",
					cookie: bob.cookie,
					"x-account-id": bob.id,
				},
				body: JSON.stringify(items),
			});
			const text = await response.text();
			const statuses = [...text.matchAll(/data: (\{.*\})/g)]
				.map((match) => JSON.parse(match[1] as string) as { index: number; status: number })
				.sort((left, right) => left.index - right.index)
				.map((entry) => entry.status);
			return { status: response.status, statuses };
		};
		const baseline = async () => {
			const response = await realFetch(`${appUrl}/api/openapi/career/profile`, {
				method: "PUT",
				headers: { cookie: bob.cookie, "content-type": "application/json" },
				body: JSON.stringify({ ...bobPayload, priorities: "baseline" }),
			});
			expect(response.ok).toBe(true);
		};

		await baseline();
		const withCookie = await runBatch([item({ ...bobPayload, priorities: "item-cookie" }, { cookie: alice.cookie })]);
		expect(withCookie.statuses).toEqual([200]);
		expect((await profile(bob.cookie)).priorities).toBe("item-cookie");
		expect((await profile(alice.cookie)).priorities).toBe("Alice private priorities");

		await baseline();
		const withBearer = await runBatch([
			item({ ...bobPayload, priorities: "item-bearer" }, { authorization: "Bearer garbage" }),
		]);
		expect(withBearer.statuses).toEqual([200]);
		expect((await profile(bob.cookie)).priorities).toBe("item-bearer");
		expect((await profile(alice.cookie)).priorities).toBe("Alice private priorities");
	}, 60_000);

	it("allows a call bound to the signed-in account", async () => {
		const { setAccountScope } = await import("@/libs/auth/account-scope");
		const { client } = await import("./client");
		setAccountScope(bob.id);
		installTransport(bob.cookie);
		await client.career.saveProfile(bobPayload as never, { context: { accountId: bob.id } });
		expect(await profile(bob.cookie)).toMatchObject({ targetRoles: ["Bob role"] });
	});

	it("keeps headerless legacy clients working", async () => {
		const { setAccountScope } = await import("@/libs/auth/account-scope");
		const { client } = await import("./client");
		requests.length = 0;
		setAccountScope(null);
		installTransport(bob.cookie);
		await client.career.saveProfile(alicePayload as never);
		expect((await profile(bob.cookie)).targetRoles).toEqual(["Alice private role"]);
		expect(requests.at(-1)?.headers.get("x-account-id")).toBeNull();
	});
});
