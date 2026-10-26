// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AddressField } from "./address-field";

const currentResume = {
	id: "r1",
	slug: "test-slug",
	isPublic: true,
	isLocked: false,
	hasPassword: false,
};
const currentResumeMock = vi.fn(() => currentResume);

vi.mock("@/features/resume/builder/draft", () => ({
	useCurrentResume: () => currentResumeMock(),
}));

vi.mock("@reactive-resume/ui/components/toast", () => ({
	toast: { add: vi.fn() },
}));

vi.mock("@/libs/orpc/client", () => ({
	orpc: {
		resume: {
			checkSlug: {
				queryOptions: ({ input }: { input: { slug: string } }) => ({
					queryKey: ["checkSlug", input.slug],
					queryFn: () => ({ status: "available" }),
				}),
			},
		},
	},
}));

function renderAddress(slug = "test-slug") {
	currentResumeMock.mockReturnValue({ ...currentResume, slug });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={queryClient}>
			<I18nProvider i18n={i18n}>
				<AddressField
					url={`https://test.example/testuser/${slug}`}
					username="testuser"
					update={vi.fn(async () => true)}
				/>
			</I18nProvider>
		</QueryClientProvider>,
	);
	return screen.getByLabelText("Address") as HTMLInputElement;
}

describe("AddressField", () => {
	beforeEach(() => {
		i18n.load("en", {});
		i18n.activate("en");
	});

	it("keeps pasted text visible for validation", () => {
		const input = renderAddress();
		expect(input.hasAttribute("maxLength")).toBe(false);
		expect(input.value).toBe("test-slug");
	});

	it.each(["Legacy_Slug", "a".repeat(70)])("accepts unchanged legacy address %s", (slug) => {
		const input = renderAddress(slug);
		expect(input.getAttribute("aria-invalid")).toBe("false");
		expect(screen.getByRole("status").textContent).toBe(`Live at test.example/testuser/${slug}`);
	});

	it.each([
		["", "Add an address."],
		["invalid_slug!", "Use lowercase letters, numbers and single dashes."],
		["a".repeat(65), "Use at most 64 characters."],
	])("explains invalid edited address %s", (value, message) => {
		const input = renderAddress();
		fireEvent.change(input, { target: { value } });
		expect(input.getAttribute("aria-invalid")).toBe("true");
		expect(screen.getByRole("status").textContent).toBe(message);
	});
});
