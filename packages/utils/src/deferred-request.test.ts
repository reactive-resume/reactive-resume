import { expect, it } from "vite-plus/test";
import { prepareRequest } from "./deferred-request";

it("waits for preparation, then sends synchronously exactly once", async () => {
	let release!: () => void;
	const body = new Promise<void>((resolve) => {
		release = resolve;
	});
	let sent = 0;
	let ready = false;
	const pending = prepareRequest(async (defer) => {
		await body;
		return (
			await defer(() => {
				sent++;
				return Promise.resolve(new Response("saved"));
			})
		).text();
	});
	void pending.then(() => {
		ready = true;
	});
	await Promise.resolve();
	expect(ready).toBe(false);
	expect(sent).toBe(0);
	release();
	const request = await pending;
	expect(sent).toBe(0);
	const result = request.send();
	expect(sent).toBe(1);
	expect(request.send()).toBe(result);
	request.cancel();
	expect(await result).toBe("saved");
	expect(sent).toBe(1);
});

it("Undo cancels the request without starting an erasure", async () => {
	let sent = false;
	const request = await prepareRequest((defer) =>
		defer(() => {
			sent = true;
			return Promise.resolve(new Response());
		}),
	);
	request.cancel();
	request.cancel();
	await expect(request.send()).rejects.toMatchObject({ name: "AbortError" });
	expect(sent).toBe(false);
});

it("propagates preparation and synchronous transport failures without leaving readiness pending", async () => {
	await expect(
		prepareRequest(async () => {
			throw new Error("Unauthorized");
		}),
	).rejects.toThrow("Unauthorized");
	await expect(prepareRequest(async () => "no request")).rejects.toThrow("Request was not prepared");
	const request = await prepareRequest((defer) =>
		defer(() => {
			throw new Error("Transport unavailable");
		}),
	);
	await expect(request.send()).rejects.toThrow("Transport unavailable");
});

it("allows an existing transport to retry after its first authenticated send", async () => {
	let sent = 0;
	const request = await prepareRequest(async (defer) => {
		const first = await defer(() => {
			sent++;
			return Promise.resolve(new Response(null, { status: 401 }));
		});
		if (first.status !== 401) return first.status;
		return (
			await defer(() => {
				sent++;
				return Promise.resolve(new Response(null, { status: 200 }));
			})
		).status;
	});
	expect(sent).toBe(0);
	const result = request.send();
	expect(sent).toBe(1);
	expect(await result).toBe(200);
	expect(sent).toBe(2);
	await request.send();
	expect(sent).toBe(2);
});

it("cannot dispatch a held request after its preparation callback rejects", async () => {
	let sent = 0;
	const error = new Error("Preparation failed after defer");
	let fail!: (error: Error) => void;
	const failed = new Promise<never>((_resolve, reject) => {
		fail = reject;
	});
	const request = await prepareRequest(async (defer) => {
		void defer(() => {
			sent++;
			return Promise.resolve(new Response());
		});
		return failed;
	});
	fail(error);
	await failed.catch(() => {});
	await new Promise<void>((resolve) => setImmediate(resolve));
	await expect(request.send()).rejects.toBe(error);
	expect(sent).toBe(0);
});
