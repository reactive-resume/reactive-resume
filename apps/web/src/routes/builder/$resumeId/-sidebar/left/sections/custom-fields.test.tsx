// @vitest-environment happy-dom

import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { ComponentProps, ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { BasicsSectionBuilder } from "./basics";

const state = vi.hoisted(() => ({ data: {} as ResumeData, update: vi.fn() }));

type CustomField = ResumeData["basics"]["customFields"][number];

let capturedOnReorder: ((fields: CustomField[]) => void) | undefined;
let capturedValues: CustomField[] | undefined;

vi.mock("motion/react", async (importOriginal) => {
	const actual = await importOriginal<typeof import("motion/react")>();
	return {
		...actual,
		Reorder: {
			...actual.Reorder,
			Group: ({
				onReorder,
				values,
				children,
				className,
			}: ComponentProps<typeof actual.Reorder.Group> & { onReorder?: (fields: CustomField[]) => void }) => {
				capturedOnReorder = onReorder;
				capturedValues = values as CustomField[];
				return (
					<div data-testid="reorder-group" className={className}>
						{children}
					</div>
				);
			},
			Item: ({ children, className }: ComponentProps<typeof actual.Reorder.Item>) => (
				<div className={className}>{children}</div>
			),
		},
	};
});

vi.mock("@/features/resume/builder/draft", () => ({
	useCurrentBuilderResumeSelector: (selector: (resume: { data: ResumeData }) => unknown) => selector(state),
	useUpdateResumeData: () => state.update,
}));

vi.mock("../shared/section-base", () => ({
	SectionBase: ({ children }: { children: ReactNode }) => children,
}));

beforeAll(() => {
	i18n.loadAndActivate({ locale: "en", messages: {} });
});

beforeEach(() => {
	state.data = structuredClone(defaultResumeData);
	state.data.basics.customFields = [
		{ id: "field-1", icon: "acorn", text: "First Item", link: "https://first.com" },
		{ id: "field-2", icon: "github-logo", text: "Second Item", link: "https://second.com" },
	];
	state.update.mockReset();
	state.update.mockImplementation((update: (draft: ResumeData) => void) => update(state.data));
	capturedOnReorder = undefined;
	capturedValues = undefined;
});

function renderSection(children: ReactNode) {
	return render(
		<QueryClientProvider client={new QueryClient()}>
			<I18nProvider i18n={i18n}>{children}</I18nProvider>
		</QueryClientProvider>,
	);
}

describe("CustomFieldsSection reordering and content preservation", () => {
	it("renders custom fields with their initial text", () => {
		renderSection(<BasicsSectionBuilder />);
		const inputs = screen.getAllByRole("textbox");
		const customFieldInputs = inputs.filter(
			(input) =>
				(input as HTMLInputElement).value === "First Item" || (input as HTMLInputElement).value === "Second Item",
		);
		expect(customFieldInputs).toHaveLength(2);
	});

	it("preserves edited content when reordering custom fields", () => {
		renderSection(<BasicsSectionBuilder />);

		const inputs = screen.getAllByRole("textbox");
		const firstInput = inputs.find((input) => (input as HTMLInputElement).value === "First Item") as HTMLInputElement;
		expect(firstInput).toBeDefined();

		act(() => {
			fireEvent.change(firstInput, { target: { value: "New Edited Text" } });
		});

		expect(state.data.basics.customFields[0].text).toBe("New Edited Text");
		expect(capturedValues?.[0].text).toBe("New Edited Text");

		// Reorder: move second item to first
		act(() => {
			if (capturedValues && capturedOnReorder) {
				capturedOnReorder([capturedValues[1], capturedValues[0]]);
			}
		});

		expect(state.data.basics.customFields[0].id).toBe("field-2");
		expect(state.data.basics.customFields[0].text).toBe("Second Item");
		expect(state.data.basics.customFields[1].id).toBe("field-1");
		expect(state.data.basics.customFields[1].text).toBe("New Edited Text");
	});

	it("preserves newly added custom field content when reordering", () => {
		renderSection(<BasicsSectionBuilder />);

		const addButton = screen.getByRole("button", { name: "Add a custom field" });
		act(() => {
			fireEvent.click(addButton);
		});

		expect(state.data.basics.customFields).toHaveLength(3);
		const newFieldId = state.data.basics.customFields[2].id;

		const inputs = screen.getAllByRole("textbox");
		const emptyInput = inputs.find(
			(input) =>
				(input as HTMLInputElement).value === "" && (input as HTMLInputElement).name === "customFields[2].text",
		) as HTMLInputElement;

		act(() => {
			fireEvent.change(emptyInput, { target: { value: "Brand New Field" } });
		});

		expect(state.data.basics.customFields[2].text).toBe("Brand New Field");
		expect(capturedValues?.[2].text).toBe("Brand New Field");

		// Reorder newly added field to index 0
		act(() => {
			if (capturedValues && capturedOnReorder) {
				capturedOnReorder([capturedValues[2], capturedValues[0], capturedValues[1]]);
			}
		});

		expect(state.data.basics.customFields[0].id).toBe(newFieldId);
		expect(state.data.basics.customFields[0].text).toBe("Brand New Field");
		expect(state.data.basics.customFields[1].id).toBe("field-1");
		expect(state.data.basics.customFields[2].id).toBe("field-2");
	});

	it("removes a custom field properly", () => {
		renderSection(<BasicsSectionBuilder />);

		const removeButtons = screen.getAllByRole("button", { name: "Remove custom field" });
		expect(removeButtons).toHaveLength(2);

		act(() => {
			fireEvent.click(removeButtons[0]);
		});

		expect(state.data.basics.customFields).toHaveLength(1);
		expect(state.data.basics.customFields[0].id).toBe("field-2");
	});
});
