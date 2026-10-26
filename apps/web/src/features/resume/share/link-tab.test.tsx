// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LinkTab } from "./link-tab";

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
	usePatchResume: () => vi.fn(),
}));

vi.mock("@/libs/auth/client", () => ({
	authClient: {
		useSession: () => ({ data: { user: { username: "testuser" } } }),
	},
}));

vi.mock("@/hooks/use-confirm", () => ({
	useConfirm: () => vi.fn(),
}));

vi.mock("@reactive-resume/ui/components/toast", () => ({
	toast: { add: vi.fn() },
}));

vi.mock("@/libs/orpc/client", () => ({
	orpc: {
		resume: {
			update: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
			checkSlug: { queryOptions: () => ({ queryKey: ["checkSlug"], queryFn: () => ({ status: "available" }) }) },
			setPassword: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
			removePassword: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
			statistics: {
				getById: { queryOptions: () => ({ queryKey: ["stats"], queryFn: () => null }) },
				getDailyById: { queryOptions: () => ({ queryKey: ["daily"], queryFn: () => [] }) },
			},
		},
	},
}));

describe("LinkTab address input", () => {
	beforeEach(() => {
		i18n.load("en", {});
		i18n.activate("en");
		currentResumeMock.mockReturnValue(currentResume);
	});

	it("does not restrict the slug input via maxLength so pasted text can be validated", () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});

		render(
			<QueryClientProvider client={queryClient}>
				<I18nProvider i18n={i18n}>
					<LinkTab />
				</I18nProvider>
			</QueryClientProvider>,
		);

		const input = screen.getByLabelText("Address") as HTMLInputElement;
		expect(input).toBeDefined();
		expect(input.hasAttribute("maxLength")).toBe(false);
		expect(input.value).toBe("test-slug");
	});

	it("does not treat an existing legacy slug longer than 64 characters as invalid when unchanged", () => {
		const longSlug = "legacy-long-slug-legacy-long-slug-legacy-long-slug-legacy-long-slug-more";
		currentResumeMock.mockReturnValue({
			id: "r1",
			slug: longSlug,
			isPublic: true,
			isLocked: false,
			hasPassword: false,
		});

		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});

		render(
			<QueryClientProvider client={queryClient}>
				<I18nProvider i18n={i18n}>
					<LinkTab />
				</I18nProvider>
			</QueryClientProvider>,
		);

		const input = screen.getByLabelText("Address") as HTMLInputElement;
		expect(input.getAttribute("aria-invalid")).toBe("false");
		expect(screen.getByText(new RegExp(`Live at .*${longSlug}`))).toBeDefined();
	});

	it("marks the slug as invalid when edited to an invalid format", () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});

		render(
			<QueryClientProvider client={queryClient}>
				<I18nProvider i18n={i18n}>
					<LinkTab />
				</I18nProvider>
			</QueryClientProvider>,
		);

		const input = screen.getByLabelText("Address") as HTMLInputElement;
		fireEvent.change(input, { target: { value: "invalid_slug!" } });

		expect(input.getAttribute("aria-invalid")).toBe("true");
		expect(screen.getByText("Use lowercase letters, numbers and single dashes.")).toBeDefined();
	});

	it("shows length error message when edited slug exceeds 64 characters", () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});

		render(
			<QueryClientProvider client={queryClient}>
				<I18nProvider i18n={i18n}>
					<LinkTab />
				</I18nProvider>
			</QueryClientProvider>,
		);

		const input = screen.getByLabelText("Address") as HTMLInputElement;
		fireEvent.change(input, { target: { value: "a".repeat(65) } });

		expect(input.getAttribute("aria-invalid")).toBe("true");
		expect(screen.getByText("Use at most 64 characters.")).toBeDefined();
	});
});
