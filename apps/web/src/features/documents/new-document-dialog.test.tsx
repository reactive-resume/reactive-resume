// @vitest-environment happy-dom

import type { Application } from "@/features/applications/types";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Dialog } from "@reactive-resume/ui/components/dialog";
import { NewDocumentDialog } from "./new-document-dialog";
import { applicationsListQueryKey } from "@/features/applications/queries";
import { orpc } from "@/libs/orpc/client";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));

function mountDialog(context: "documents" | "letters" | "applications" | "career") {
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={queryClient}>
				<Dialog open>
					<NewDocumentDialog data={{ context }} />
				</Dialog>
			</QueryClientProvider>
		</I18nProvider>,
	);
}

it("explains a missing source resume and offers import or creation when copying directly from an application", () => {
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	const queryClient = new QueryClient({
		defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } },
	});
	queryClient.setQueryData(orpc.documents.list.queryKey({ input: { trashed: false } }), []);
	queryClient.setQueryData(orpc.aiProviders.list.queryKey(), []);
	queryClient.setQueryData(applicationsListQueryKey(), [
		{ id: "application-1", company: "ABOUT YOU", role: "", status: "saved" } as Application,
	]);

	render(
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={queryClient}>
				<Dialog open>
					<NewDocumentDialog data={{ step: "copy", applicationId: "application-1" }} />
				</Dialog>
			</QueryClientProvider>
		</I18nProvider>,
	);

	expect(screen.getByText(/You don't have a resume to copy yet/)).toBeVisible();
	expect(screen.getByRole("button", { name: "Create and open" })).toBeDisabled();
	fireEvent.click(screen.getByRole("button", { name: "Import or create a resume" }));
	expect(screen.getByRole("heading", { name: "New" })).toBeVisible();
	expect(screen.getByRole("button", { name: /^Import a resume/ })).toBeEnabled();
	expect(screen.getByRole("button", { name: /^Start blank/ })).toBeEnabled();

	fireEvent.click(screen.getByRole("button", { name: /^Copy a resume for a job/ }));
	expect(screen.getByRole("button", { name: "ABOUT YOU" })).toHaveAttribute("aria-pressed", "true");
});

it("leads the Letters tab with a new letter", () => {
	mountDialog("letters");
	const letter = screen.getByRole("button", { name: /^New cover letter/ });
	expect(letter).toHaveAccessibleName(/Start a letter for a job/);
	expect(screen.queryByRole("button", { name: "New cover letter instead" })).toBeNull();
});

it("routes Save a job from New through Applications' own dialog", () => {
	navigate.mockClear();
	mountDialog("career");
	const save = screen.getByRole("button", { name: /^Save a job/ });
	expect(save).toHaveAccessibleName(/Paste a job link/);
	fireEvent.click(save);
	expect(navigate).toHaveBeenCalledWith({ to: "/dashboard/applications", search: { create: true } });
});
