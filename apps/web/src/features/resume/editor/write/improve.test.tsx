// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { RichTextEditor } from "./rich-text-editor-field";

const fixture = vi.hoisted(() => ({
	requests: [] as unknown[],
	result: {} as { text: string; why: string; addsFacts: boolean; aiOperationIds?: string[]; aiUsage?: unknown },
}));
vi.mock("@reactive-resume/ui/hooks/use-breakpoint", () => ({ useBreakpoint: () => "desktop" }));
vi.mock("@reactive-resume/ui/hooks/use-keyboard-inset", () => ({ useKeyboardInset: () => 0 }));
vi.mock("@/hooks/use-confirm", () => ({ usePrompt: () => vi.fn() }));
vi.mock("@/features/assistant/provider-setup", () => ({ SetUpAi: () => null }));
vi.mock("@/features/settings/integrations/hooks/use-has-usable-ai-provider", () => ({
	useHasUsableAiProvider: () => ({
		hasUsableProvider: true,
		usableProviders: [{ id: "current-provider", label: "Current AI", model: "main", fastModel: "fast" }],
	}),
}));
vi.mock("@/libs/orpc/client", () => ({ orpc: { ai: { improve: { mutationOptions: () => ({}) } } } }));
vi.mock("@tanstack/react-query", async (importOriginal) => {
	const original = await importOriginal<typeof import("@tanstack/react-query")>();
	const { useState } = await import("react");
	return {
		...original,
		useMutation: () => {
			const [data, setData] = useState<typeof fixture.result | null>(null);
			return {
				data,
				error: null,
				isPending: false,
				mutate: (input: unknown) => {
					fixture.requests.push(input);
					setData(fixture.result);
				},
				reset: () => setData(null),
			};
		},
	};
});

beforeEach(() => {
	i18n.load("en", {});
	i18n.activate("en");
	fixture.requests = [];
	fixture.result = {
		text: "Reviewed replacement",
		why: "Clearer",
		addsFacts: false,
		aiOperationIds: ["reviewed-improve"],
		aiUsage: { requests: 2, models: [{ label: "Original AI", provider: "openai-compatible", model: "actual-fast" }] },
	};
});

async function review() {
	const onChange = vi.fn();
	render(
		<I18nProvider i18n={i18n}>
			<RichTextEditor
				label="Summary"
				value={'<p data-resume-whitespace="preserve">Original line</p>'}
				onChange={onChange}
			/>
		</I18nProvider>,
	);
	const editor = await screen.findByRole("textbox", { name: "Summary" });
	await act(async () => editor.focus());
	fireEvent.click(screen.getByRole("button", { name: "Improve" }));
	fireEvent.click(screen.getByRole("button", { name: "Stronger verb" }));
	expect(onChange).not.toHaveBeenCalled();
	expect(fixture.requests).toEqual([expect.objectContaining({ includeProvenance: true, line: "Original line" })]);
	return onChange;
}

it.each([false, true])("Replace carries only reviewed sources, including identical wording=%s", async (sameWords) => {
	if (sameWords) fixture.result.text = "Original line";
	const onChange = await review();
	expect(screen.getByText("AI request attempts: 2")).toBeVisible();
	expect(screen.getByText("Original AI · openai-compatible · actual-fast")).toBeVisible();
	fireEvent.click(screen.getByRole("button", { name: "Replace" }));
	expect(onChange).toHaveBeenCalledExactlyOnceWith(
		'<p data-resume-whitespace="preserve">' + fixture.result.text + "</p>",
		{
			newStep: true,
			aiOperationIds: ["reviewed-improve"],
		},
	);
	expect(fixture.requests).toHaveLength(1);
});

it("Keep mine adds no document sources", async () => {
	const onChange = await review();
	fireEvent.click(screen.getByRole("button", { name: "Keep mine" }));
	expect(onChange).not.toHaveBeenCalled();
	expect(fixture.requests).toHaveLength(1);
});

it("older source-less response can be accepted without repeating generation", async () => {
	fixture.result = { text: "Older suggestion", why: "Clearer", addsFacts: false };
	const onChange = await review();
	expect(screen.getByText("AI request history unavailable for this result.")).toBeVisible();
	fireEvent.click(screen.getByRole("button", { name: "Replace" }));
	expect(onChange).toHaveBeenCalledExactlyOnceWith('<p data-resume-whitespace="preserve">Older suggestion</p>', {
		newStep: true,
		aiOperationIds: undefined,
	});
	expect(fixture.requests).toHaveLength(1);
});

it.each([false, true])("editor Undo and Redo carry the accepted source change (same wording=%s)", async (sameWords) => {
	if (sameWords) fixture.result.text = "Original line";
	const onChange = await review();
	fireEvent.click(screen.getByRole("button", { name: "Replace" }));
	const editor = screen.getByRole("textbox", { name: "Summary" });
	fireEvent.keyDown(editor, { key: "z", code: "KeyZ", ctrlKey: true });
	expect(onChange).toHaveBeenLastCalledWith('<p data-resume-whitespace="preserve">Original line</p>', {
		newStep: true,
		removedAiOperationIds: ["reviewed-improve"],
	});
	fireEvent.keyDown(editor, { key: "z", code: "KeyZ", ctrlKey: true, shiftKey: true });
	expect(onChange).toHaveBeenLastCalledWith('<p data-resume-whitespace="preserve">' + fixture.result.text + "</p>", {
		newStep: true,
		aiOperationIds: ["reviewed-improve"],
	});
	expect(fixture.requests).toHaveLength(1);
});
