import { afterEach, describe, expect, it } from "vite-plus/test";
import { QueryClient } from "@tanstack/react-query";
import { shareListState, shortLinkOpens } from "@reactive-resume/resume/sharing";

type PrimaryRow = { id: string; isPrimary: boolean; isPublic: boolean };

const clients: QueryClient[] = [];
const makeClient = () => {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	clients.push(client);
	return client;
};
afterEach(() => {
	for (const client of clients.splice(0)) client.clear();
});

const derive = (client: QueryClient, key: readonly unknown[], isPrimary: boolean, isPublic: boolean) => {
	const state = client.getQueryState<PrimaryRow[]>(key);
	const listState = shareListState({ isPending: state?.status === "pending", isError: state?.status === "error" });
	const current = state?.data?.find((row) => row.isPrimary);
	return {
		listState,
		opens: shortLinkOpens({ isPrimary, isPublic, listState, otherPrimaryIsPublic: current?.isPublic }),
	};
};

// The real query keeps the last successful data when a background refetch fails. Share must not treat that cached
// other-primary row as current once the lookup reports an error, and a retry that succeeds must restore Copy.
describe("Share short-link Copy across a cached success and a failed refetch", () => {
	it("disables Copy on the error while the cached primary remains, then recovers on retry", async () => {
		const client = makeClient();
		const key = ["resume", "list", "cached-then-failed"];
		let fail = false;
		const queryFn = () =>
			fail
				? Promise.reject(new Error("offline"))
				: Promise.resolve([{ id: "primary", isPrimary: true, isPublic: true }]);

		await client.fetchQuery({ queryKey: key, queryFn });
		expect(derive(client, key, false, false)).toEqual({ listState: "ready", opens: true });

		fail = true;
		await client.refetchQueries({ queryKey: key }).catch(() => undefined);
		const failed = client.getQueryState<PrimaryRow[]>(key);
		expect(failed?.status).toBe("error");
		expect(failed?.data).toEqual([{ id: "primary", isPrimary: true, isPublic: true }]);
		expect(derive(client, key, false, false)).toEqual({ listState: "error", opens: false });

		fail = false;
		await client.refetchQueries({ queryKey: key });
		expect(derive(client, key, false, false)).toEqual({ listState: "ready", opens: true });
	});

	it("keeps the own-primary Copy decision independent of a failed list", async () => {
		const client = makeClient();
		const key = ["resume", "list", "own-primary"];
		await client
			.fetchQuery({ queryKey: key, queryFn: () => Promise.reject(new Error("offline")) })
			.catch(() => undefined);
		expect(client.getQueryState(key)?.status).toBe("error");
		expect(derive(client, key, true, true).opens).toBe(true);
		expect(derive(client, key, true, false).opens).toBe(false);
	});
});
