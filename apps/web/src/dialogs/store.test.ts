import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDialogStore } from "./store";

describe("useDialogStore", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		// Reset store state between tests
		useDialogStore.setState({ open: false, activeDialog: null, onBeforeClose: null });
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("openDialog", () => {
		it("opens a dialog and sets activeDialog", () => {
			useDialogStore.getState().openDialog("api-key.create", undefined);

			const state = useDialogStore.getState();
			expect(state.open).toBe(true);
			expect(state.activeDialog?.type).toBe("api-key.create");
		});

		it("clears any existing onBeforeClose handler", () => {
			useDialogStore.setState({ onBeforeClose: () => true });
			useDialogStore.getState().openDialog("resume.create", undefined);

			expect(useDialogStore.getState().onBeforeClose).toBeNull();
		});

		it("preserves dialog data for typed payloads", () => {
			const data = { id: "r1", name: "My Resume", slug: "my-resume", tags: [] };
			useDialogStore.getState().openDialog("resume.update", data);

			const active = useDialogStore.getState().activeDialog;
			expect(active?.type).toBe("resume.update");
			if (active?.type === "resume.update") {
				expect(active.data).toEqual(data);
			}
		});
	});

	describe("closeDialog", () => {
		it("immediately sets open to false", () => {
			useDialogStore.setState({
				open: true,
				activeDialog: { type: "api-key.create", data: undefined },
			});

			useDialogStore.getState().closeDialog();
			expect(useDialogStore.getState().open).toBe(false);
		});

		it("clears activeDialog after 300ms (animation finished)", () => {
			useDialogStore.setState({
				open: true,
				activeDialog: { type: "api-key.create", data: undefined },
			});

			useDialogStore.getState().closeDialog();
			expect(useDialogStore.getState().activeDialog).not.toBeNull();

			vi.advanceTimersByTime(300);
			expect(useDialogStore.getState().activeDialog).toBeNull();
		});

		it.each([false, true])("preserves a replacement dialog and its own closing delay (closing=%s)", (closing) => {
			useDialogStore.getState().openDialog("api-key.create", undefined);
			useDialogStore.getState().closeDialog();
			vi.advanceTimersByTime(100);

			useDialogStore.getState().openDialog("resume.create", undefined);
			const onBeforeClose = () => false;
			useDialogStore.getState().setOnBeforeClose(onBeforeClose);
			if (closing) useDialogStore.getState().closeDialog();
			vi.advanceTimersByTime(200);

			expect(useDialogStore.getState()).toMatchObject({
				open: !closing,
				activeDialog: { type: "resume.create" },
				onBeforeClose,
			});

			if (!closing) useDialogStore.getState().closeDialog();
			vi.advanceTimersByTime(300);
			expect(useDialogStore.getState().activeDialog).toBeNull();
			expect(useDialogStore.getState().onBeforeClose).toBeNull();
		});
	});

	describe("onOpenChange", () => {
		it("opens via set without invoking onBeforeClose", () => {
			const onBefore = vi.fn();
			useDialogStore.setState({ onBeforeClose: onBefore });

			useDialogStore.getState().onOpenChange(true);
			expect(useDialogStore.getState().open).toBe(true);
			expect(onBefore).not.toHaveBeenCalled();
		});

		it("closes immediately when no onBeforeClose handler", () => {
			useDialogStore.setState({ open: true, activeDialog: { type: "api-key.create", data: undefined } });
			useDialogStore.getState().onOpenChange(false);

			expect(useDialogStore.getState().open).toBe(false);
		});

		it("invokes onBeforeClose when closing", async () => {
			const handler = vi.fn().mockResolvedValue(true);
			useDialogStore.setState({
				open: true,
				activeDialog: { type: "api-key.create", data: undefined },
				onBeforeClose: handler,
			});

			useDialogStore.getState().onOpenChange(false);
			await vi.waitFor(() => expect(handler).toHaveBeenCalled());
		});

		it("calls cancel when onBeforeClose returns false", async () => {
			const handler = vi.fn().mockResolvedValue(false);
			const cancel = vi.fn();
			useDialogStore.setState({
				open: true,
				activeDialog: { type: "api-key.create", data: undefined },
				onBeforeClose: handler,
			});

			useDialogStore.getState().onOpenChange(false, { cancel });
			await vi.waitFor(() => expect(cancel).toHaveBeenCalled());
		});
	});

	describe("setOnBeforeClose", () => {
		it("sets and clears the handler", () => {
			const handler = () => true;
			useDialogStore.getState().setOnBeforeClose(handler);
			expect(useDialogStore.getState().onBeforeClose).toBe(handler);

			useDialogStore.getState().setOnBeforeClose(null);
			expect(useDialogStore.getState().onBeforeClose).toBeNull();
		});
	});
});
