// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { confirmOperation, ConfirmDialogProvider, useConfirm } from "./use-confirm";

type HookWrapperProps = {
	children: React.ReactNode;
};

beforeAll(() => {
	i18n.loadAndActivate({ locale: "en", messages: {} });
});

const wrapper = ({ children }: HookWrapperProps) => <ConfirmDialogProvider>{children}</ConfirmDialogProvider>;

describe("useConfirm", () => {
	it("resolves false when the dialog is dismissed", async () => {
		const { result } = renderHook(() => useConfirm(), { wrapper });

		let promise!: Promise<boolean>;
		await act(() => {
			promise = result.current("Heading");
		});

		// Click the cancel button to close.
		const cancelBtn = document.body.querySelector('button[type="button"][data-slot="alert-dialog-cancel"]');
		// Fallback: cancel buttons in shadcn/base-ui dialogs usually carry role="button" + text.
		const buttons = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button"));
		const cancel = buttons.find((b) => /cancel/i.test(b.textContent ?? ""));

		await act(() => {
			((cancelBtn as HTMLButtonElement | null) ?? cancel)?.click();
		});

		await expect(promise).resolves.toBe(false);
	});
});

it("dismisses an operation confirmation when its request is aborted", async () => {
	const { unmount } = renderHook(() => useConfirm(), { wrapper });
	const controller = new AbortController();
	let promise!: Promise<boolean>;
	await act(() => {
		promise = confirmOperation("Share fictional data?", { signal: controller.signal });
	});
	await act(() => controller.abort());
	await expect(promise).resolves.toBe(false);
	unmount();
});
