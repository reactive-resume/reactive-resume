// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const knowledgeLookup = vi.hoisted(() => ({ pending: false }));
vi.mock("@/libs/orpc/client", () => {
	const endpoint = (name: string) => ({
		queryKey: () => [name],
		queryOptions: () => ({
			queryKey: [name],
			queryFn: () => (knowledgeLookup.pending ? new Promise(() => {}) : Promise.resolve([])),
		}),
	});
	return { orpc: { career: { facts: endpoint("facts"), stories: endpoint("stories") } } };
});
vi.mock("@/features/settings/integrations/hooks/use-has-usable-ai-provider", () => ({
	useHasUsableAiProvider: () => ({
		usableProviders: [{ id: "p1", label: "OpenAI" }],
		isUnavailable: false,
	}),
}));

const { AiDisclosure } = await import("./disclosure");

const application = {
	id: "app",
	company: "Harbor",
	role: "Engineer",
	jobDescription: "Build reliable services.",
	requirements: [],
	notes: "Maya is the recruiter.",
	contacts: [],
	resumeId: "resume",
	coverLetterId: null,
};

afterEach(() => {
	cleanup();
	knowledgeLookup.pending = false;
});

it("names only the parts this application actually has, before the request is sent", async () => {
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	const queryClient = new QueryClient();
	render(
		<QueryClientProvider client={queryClient}>
			<I18nProvider i18n={i18n}>
				<AiDisclosure task="fit" application={application} />
			</I18nProvider>
		</QueryClientProvider>,
	);
	const line = screen.getByText(/^Sends /);
	expect(line.textContent).toContain("this posting");
	expect(line.textContent).toContain("your notes");
	expect(line.textContent).toContain("the resume for this job");
	expect(line.textContent).toContain("OpenAI");
	expect(line.textContent).not.toContain("cover letter");
	expect(line.textContent).not.toContain("interview");
	// The optional Knowledge lookup is conservative while unresolved, then drops out when it resolves empty.
	await waitFor(() => expect(screen.getByText(/^Sends /).textContent).not.toContain("Knowledge"));
});

it("names the interview details Debrief sends, while Fit does not", () => {
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	const queryClient = new QueryClient();
	const view = (task: "debrief" | "fit") => (
		<QueryClientProvider client={queryClient}>
			<I18nProvider i18n={i18n}>
				<AiDisclosure task={task} application={application} interview />
			</I18nProvider>
		</QueryClientProvider>
	);
	const { rerender } = render(view("debrief"));
	expect(screen.getByText(/^Sends /).textContent).toContain("the interview details");
	rerender(view("fit"));
	expect(screen.getByText(/^Sends /).textContent).not.toContain("the interview details");
});

it("keeps Knowledge in the notice while its presence lookup is unresolved", () => {
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	knowledgeLookup.pending = true;
	const queryClient = new QueryClient();
	render(
		<QueryClientProvider client={queryClient}>
			<I18nProvider i18n={i18n}>
				<AiDisclosure task="fit" application={application} />
			</I18nProvider>
		</QueryClientProvider>,
	);
	expect(screen.getByText(/^Sends /).textContent).toContain("Knowledge that's switched on");
});
