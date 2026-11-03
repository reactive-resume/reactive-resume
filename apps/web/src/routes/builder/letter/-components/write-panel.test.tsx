// @vitest-environment happy-dom
import type { LetterDraft } from "@/features/letters/store";
import type { CoverLetter } from "@reactive-resume/schema/cover-letter/data";
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { copyCoverLetterStyle } from "@reactive-resume/resume/cover-letter";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";

const state = vi.hoisted(() => ({
	letter: null as CoverLetter | null,
	draft: { phase: "idle" } as LetterDraft,
	status: "saved" as "saved" | "saving" | "error" | "conflict",
	changing: false,
	sessionId: "session",
	edit: vi.fn(),
	start: vi.fn(),
	changeBody: undefined as
		| ((
				html: string,
				options?: { newStep?: boolean; aiOperationIds?: string[]; removedAiOperationIds?: string[] },
		  ) => void)
		| undefined,
}));

vi.mock("@/features/letters/store", () => ({
	useLetterEditorStore: Object.assign((selector: (value: typeof state) => unknown) => selector(state), {
		getState: () => state,
	}),
	discardLetterDraft: vi.fn(),
	startLetterDraft: state.start,
}));
vi.mock("@/features/applications/queries", () => ({
	applicationsListQueryOptions: () => ({ queryKey: ["applications"], queryFn: async () => [] }),
}));
vi.mock("@/features/applications/lanes", () => ({
	getDisplayLane: () => null,
	getLaneLabel: () => "Saved",
}));
vi.mock("@/features/applications/use-application-lanes", () => ({
	useApplicationLanes: () => ({ lanes: [], mode: "stages" }),
}));
vi.mock("@/features/assistant/provider-setup", () => ({ SetUpAi: () => null }));
vi.mock("@/features/letters/compose", () => ({
	useLetterWords: () => ({
		greeting: () => "Hi",
		teamGreeting: "Hi",
		signOff: "Regards",
	}),
}));
vi.mock("@/features/letters/use-letter-mode", () => ({ useLetterMode: () => ["write", vi.fn()] }));
vi.mock("@/features/resume/editor/design/presets", () => ({
	ACCENTS: [],
	FONT_PAIRINGS: [],
	matchFontPairing: () => null,
	rgbaToHex: () => "#000000",
}));
vi.mock("@/features/resume/editor/write/fields", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/features/resume/editor/write/fields")>()),
	TextField: ({ label, disabled }: { label: ReactNode; disabled?: boolean }) => (
		<label>
			{label}
			<input disabled={disabled} />
		</label>
	),
	validateEmail: () => null,
}));
vi.mock("@/features/resume/editor/write/rich-text-editor", () => ({
	RichTextEditor: ({
		label,
		disabled,
		onChange,
	}: {
		label: ReactNode;
		disabled?: boolean;
		onChange: typeof state.changeBody;
	}) => {
		if (label === "Letter body") state.changeBody = onChange;
		return (
			<label>
				{label}
				<textarea disabled={disabled} />
			</label>
		);
	},
}));
vi.mock("@/features/settings/integrations/ai-provider-load-state", () => ({ AiProviderLoadState: () => null }));
vi.mock("@/features/settings/integrations/hooks/use-has-usable-ai-provider", () => ({
	useHasUsableAiProvider: () => ({ hasUsableProvider: false, usableProviders: [], isUnavailable: true }),
}));
vi.mock("@/dialogs/resume/template/data", () => ({
	templates: new Proxy({}, { get: () => ({ name: "Template" }) }),
}));
vi.mock("@/libs/orpc/client", () => ({
	client: { coverLetters: { update: vi.fn(), getById: vi.fn() } },
	orpc: {
		aiProviders: { list: { queryOptions: () => ({ queryKey: ["providers"], queryFn: async () => [] }) } },
		resume: { list: { queryOptions: () => ({ queryKey: ["resumes"], queryFn: async () => [] }) } },
		documents: { list: { queryOptions: () => ({ queryKey: ["documents"], queryFn: async () => [] }) } },
	},
}));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: vi.fn() } }));

const { LetterWritePanel } = await import("./write-panel");

const letter: CoverLetter = {
	id: "letter",
	name: "Letter",
	recipient: "<p>Hiring team</p>",
	content: "<p>Saved</p>",
	greeting: "Hello,",
	signOff: "Regards,",
	style: copyCoverLetterStyle(defaultResumeData),
	layout: "structured",
	recipientName: "Rowan",
	recipientCompany: "Example",
	letterDate: "2026-10-31",
	sourceResumeId: "resume",
	sourceApplicationId: null,
	senderLinked: false,
	designLinked: true,
	isLocked: false,
	revision: 1,
	createdAt: new Date(),
	updatedAt: new Date(),
};

beforeEach(() => {
	vi.clearAllMocks();
	i18n.loadAndActivate({ locale: "en", messages: {} });
	state.letter = letter;
	state.draft = { phase: "idle" };
	state.status = "saved";
	state.changing = false;
	state.sessionId = "session";
	state.changeBody = undefined;
});

afterEach(cleanup);

function renderPanel() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<I18nProvider i18n={i18n}>
				<LetterWritePanel />
			</I18nProvider>
		</QueryClientProvider>,
	);
}

it("stops accepting typing while the letter changed elsewhere, without hiding the existing fields", () => {
	state.status = "conflict";
	renderPanel();

	expect(screen.getByText(/This letter changed in another tab/)).toBeTruthy();
	expect((screen.getByLabelText("Full name") as HTMLInputElement).closest("fieldset")?.disabled).toBe(true);
	expect((screen.getByLabelText("Email") as HTMLInputElement).closest("fieldset")?.disabled).toBe(true);

	cleanup();
	state.status = "saved";
	renderPanel();
	expect(screen.queryByText(/This letter changed in another tab/)).toBeNull();
	expect((screen.getByLabelText("Full name") as HTMLInputElement).closest("fieldset")?.disabled).toBe(false);
});

it("accepts or revises the displayed earlier draft with its own request sources", () => {
	state.draft = {
		phase: "ready",
		text: "Newest draft",
		aiOperationIds: ["new-operation"],
		versions: [{ text: "Earlier draft", aiOperationIds: ["original-operation"] }],
	};
	renderPanel();
	fireEvent.click(screen.getByLabelText("Previous version"));
	fireEvent.click(screen.getByText("Shorter", { selector: "button" }));
	expect(state.start).toHaveBeenCalledWith("shorter", "Earlier draft", ["original-operation"]);
	fireEvent.click(screen.getByText("Accept", { selector: "button" }));
	expect(state.edit).toHaveBeenCalledWith({ content: "<p>Earlier draft</p>", aiOperationIds: ["original-operation"] });
});

it("shows original requested provider and model beside a saved letter body", () => {
	state.letter = {
		...letter,
		aiOperationIds: ["original-operation"],
		aiUsage: {
			requests: 2,
			models: [
				{
					providerId: "deleted-connection",
					label: "Original connection",
					provider: "openai-compatible",
					model: "original-model",
				},
			],
		},
	};
	renderPanel();
	expect(screen.getByText("AI request attempts: 2")).toBeTruthy();
	expect(screen.getByText("Original connection · openai-compatible · original-model")).toBeTruthy();
});

it("accepted Improve contributes sources without dropping the letter draft's original sources", () => {
	state.letter = { ...letter, aiOperationIds: ["original-operation"] };
	renderPanel();
	expect(state.changeBody).toBeTypeOf("function");
	state.changeBody?.("<p>Reviewed paragraph</p>", { newStep: true, aiOperationIds: ["reviewed-improve"] });
	expect(state.edit).toHaveBeenCalledExactlyOnceWith({
		content: "<p>Reviewed paragraph</p>",
		aiOperationIds: ["original-operation", "reviewed-improve"],
	});
	state.letter = { ...letter, aiOperationIds: ["original-operation", "reviewed-improve", "later-source"] };
	state.edit.mockClear();
	state.changeBody?.("<p>Saved</p>", { newStep: true, removedAiOperationIds: ["reviewed-improve"] });
	expect(state.edit).toHaveBeenCalledExactlyOnceWith({
		content: "<p>Saved</p>",
		aiOperationIds: ["original-operation", "later-source"],
	});
});

it("late Improve edit cannot write into another letter session", () => {
	renderPanel();
	const captured = state.changeBody;
	state.sessionId = "another-session";
	captured?.("<p>Wrong target</p>", { aiOperationIds: ["reviewed-improve"] });
	expect(state.edit).not.toHaveBeenCalled();
});
