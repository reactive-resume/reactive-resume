// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { FileAttachmentField } from "./file-attachment-field";
const toast = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast }));
it("rejects oversized PDFs before handing them to the upload owner, and permits the exact cap", () => {
	i18n.loadAndActivate({ locale: "en", messages: {} });
	const onChange = vi.fn();
	const view = render(<FileAttachmentField value={null} onChange={onChange} attachLabel="Attach PDF" />);
	const input = view.container.querySelector("input");
	if (!input) throw new Error("Missing file input");
	const large = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.pdf", { type: "application/pdf" });
	fireEvent.change(input, { target: { files: [large] } });
	expect(onChange).not.toHaveBeenCalled();
	expect(toast.add).toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
	const exact = new File([new Uint8Array(10 * 1024 * 1024)], "exact.pdf", { type: "application/pdf" });
	fireEvent.change(input, { target: { files: [exact] } });
	expect(onChange).toHaveBeenCalledWith(exact);
	expect(screen.getByRole("button", { name: "Attach PDF" })).toBeTruthy();
});
