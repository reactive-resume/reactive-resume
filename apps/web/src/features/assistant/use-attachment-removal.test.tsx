// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { invalidateAccountScope, setAccountScope } from "@/libs/auth/account-scope";

const mocks = vi.hoisted(() => ({ remove: vi.fn(), error: vi.fn() }));
vi.mock("@/libs/orpc/client", () => ({ client: { agent: { attachments: { delete: mocks.remove } } } }));
vi.mock("@/libs/error-message", () => ({ toastError: mocks.error }));

import { useAttachmentRemoval } from "./use-attachment-removal";

function deferred() {
	let resolve = () => {};
	let reject = (_error: Error) => {};
	const promise = new Promise<void>((done, failed) => {
		resolve = done;
		reject = failed;
	});
	return { promise, resolve, reject };
}

beforeEach(() => {
	vi.clearAllMocks();
	setAccountScope("alice");
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
});
afterEach(() => {
	cleanup();
	invalidateAccountScope();
});

it("waits for deletion, refuses duplicate removal, and keeps a failed file available for retry", async () => {
	const request = deferred();
	mocks.remove.mockReturnValueOnce(request.promise).mockResolvedValueOnce(undefined);
	const removed = vi.fn();
	const { result } = renderHook(() => useAttachmentRemoval("thread-1", removed));
	let removing: Promise<void> = Promise.resolve();
	act(() => {
		removing = result.current.remove("file-1");
		void result.current.remove("file-1");
	});
	expect(result.current.isPending).toBe(true);
	expect(mocks.remove).toHaveBeenCalledExactlyOnceWith({ id: "file-1" }, { context: { accountId: "alice" } });
	expect(removed).not.toHaveBeenCalled();
	await act(async () => {
		request.reject(new Error("Storage unavailable"));
		await removing;
	});
	expect(removed).not.toHaveBeenCalled();
	expect(mocks.error).toHaveBeenCalledOnce();
	expect(result.current.isPending).toBe(false);
	await act(async () => result.current.remove("file-1"));
	expect(removed).toHaveBeenCalledExactlyOnceWith("file-1");
});

it.each(
	["draft", "account", "reauthentication", "unmount"].flatMap((change) =>
		["success", "failure"].map((outcome) => ({ change, outcome })),
	),
)("a late deletion $outcome cannot affect the composer after $change changes", async ({ change, outcome }) => {
	const request = deferred();
	mocks.remove.mockReturnValueOnce(request.promise);
	const removed = vi.fn();
	const view = renderHook(({ scope }) => useAttachmentRemoval(scope, removed), {
		initialProps: { scope: "thread-1" },
	});
	let removing: Promise<void> = Promise.resolve();
	const staleRemove = view.result.current.remove;
	act(() => {
		removing = staleRemove("file-1");
	});
	if (change === "draft") view.rerender({ scope: "thread-2" });
	else if (change === "account") setAccountScope("bob");
	else if (change === "reauthentication") {
		invalidateAccountScope();
		setAccountScope("alice");
	} else view.unmount();
	await act(async () => {
		if (outcome === "failure") request.reject(new Error("Storage unavailable"));
		else request.resolve();
		await removing;
		await staleRemove("file-2");
	});
	expect(removed).not.toHaveBeenCalled();
	expect(mocks.error).not.toHaveBeenCalled();
	expect(mocks.remove).toHaveBeenCalledOnce();
});
