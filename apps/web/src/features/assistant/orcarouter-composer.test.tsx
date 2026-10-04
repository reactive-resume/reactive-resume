// @vitest-environment happy-dom

/**
 * Proves the attachment-driven model selector the assistant shows for OrcaRouter.
 *
 * The selector is exercised through the real `Composer`, with the oRPC client and the combobox
 * substituted. The combobox stand-in renders the exact option list it is handed, so the assertions
 * read the filtered options rather than re-implementing the filter.
 */
import type { AssistantDocument } from "./document";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";

const mocks = vi.hoisted(() => ({
	providers: [] as Record<string, unknown>[],
	catalogCalls: [] as { id: string; entryPoint: string }[],
	update: vi.fn(),
	attach: vi.fn(),
	chat: vi.fn(),
}));

const catalogFor = (input: { id: string; entryPoint: string }) => {
	mocks.catalogCalls.push(input);
	if (input.entryPoint === "assistant_image") {
		return {
			source: "live",
			degradedReason: null,
			fetchedAt: "2026-10-04T00:00:00.000Z",
			models: [
				{
					id: "deepseek/deepseek-v4.1-flash",
					name: "DeepSeek V4.1 Flash",
					contextLength: null,
					inputModalities: ["text", "image"],
					reasoningEfforts: [],
					verifiedFallback: false,
				},
			],
		};
	}
	return {
		source: "live",
		degradedReason: null,
		fetchedAt: "2026-10-04T00:00:00.000Z",
		models: [
			{
				id: "deepseek/deepseek-v4-pro",
				name: "DeepSeek V4 Pro",
				contextLength: null,
				inputModalities: ["text"],
				reasoningEfforts: [],
				verifiedFallback: false,
			},
			{
				id: "deepseek/deepseek-v4.1-flash",
				name: "DeepSeek V4.1 Flash",
				contextLength: null,
				inputModalities: ["text", "image"],
				reasoningEfforts: [],
				verifiedFallback: false,
			},
		],
	};
};

vi.mock("@tanstack/react-query", () => ({
	useQueryClient: () => ({ invalidateQueries: vi.fn() }),
	useQuery: (options: { queryKey: unknown[] }) => {
		if (options.queryKey[0] === "aiProviders") {
			return { data: mocks.providers, isSuccess: true, isPending: false, isError: false, isFetching: false };
		}
		if (options.queryKey[0] === "orcaCatalog") {
			return {
				data: catalogFor(options.queryKey[1] as { id: string; entryPoint: string }),
				isSuccess: true,
				isPending: false,
				isError: false,
				isFetching: false,
			};
		}
		return { data: undefined, isSuccess: false, isPending: false, isError: false, isFetching: false };
	},
}));

vi.mock("@/features/resume/editor/store", () => ({
	useEditorStore: (select: (state: unknown) => unknown) => select({ setAssistantProposals: vi.fn() }),
}));

vi.mock("@/libs/orpc/client", () => ({
	client: {
		agent: { attachments: { create: mocks.attach } },
		aiProviders: { update: mocks.update },
	},
	orpc: {
		agent: { threads: { list: { key: () => ["threads"] } } },
		aiProviders: {
			list: {
				key: () => ["aiProviders", "list"],
				queryOptions: () => ({ queryKey: ["aiProviders", "list"], queryFn: async () => mocks.providers }),
			},
			orcaCatalog: {
				queryOptions: (options: { input: { id: string; entryPoint: string } }) => ({
					queryKey: ["orcaCatalog", options.input],
					queryFn: async () => catalogFor(options.input),
				}),
			},
		},
	},
}));

vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: vi.fn() } }));

// The stand-in renders the exact options it is handed, so a test can read the filtered list.
vi.mock("@/components/ui/combobox", () => ({
	Combobox: ({
		options,
		value,
		onValueChange,
	}: {
		options: { value: string }[];
		value?: string | null;
		onValueChange?: (next: string | null) => void;
	}) => (
		<div data-testid="combobox">
			<span data-testid="combobox-value">{value ?? ""}</span>
			{options.map((option) => (
				<button
					key={option.value}
					type="button"
					data-testid="combobox-option"
					onClick={() => onValueChange?.(option.value)}
				>
					{option.value}
				</button>
			))}
		</div>
	),
}));

vi.mock("./chat", () => ({
	useAssistantChat: mocks.chat,
	fileToBase64: async () => "Zm9v",
	attachmentPart: (file: { id: string; filename: string; mediaType: string }) => ({
		type: "file",
		url: `agent-attachment:${file.id}`,
		filename: file.filename,
		mediaType: file.mediaType,
	}),
	transcriptOf: () => "",
}));

import { Composer } from "./conversation";

const document: AssistantDocument = {
	kind: "resume",
	id: "resume-1",
	name: "Resume",
	locked: false,
	posting: null,
	stateOf: () => "pending",
	accept: () => {},
	locationOf: () => undefined,
};

function renderComposer() {
	return render(
		<I18nProvider i18n={i18n}>
			<Composer
				document={document}
				context={{ document: false, posting: false }}
				onContextChange={() => {}}
				providerLabel="OrcaRouter"
				orcaProviderId="provider-1"
				streaming={false}
				disabled={false}
				threadId="thread-1"
				onSend={() => {}}
				onStop={() => {}}
			/>
		</I18nProvider>,
	);
}

const optionValues = () => screen.getAllByTestId("combobox-option").map((node) => node.textContent);

beforeEach(() => {
	vi.clearAllMocks();
	mocks.catalogCalls.length = 0;
	mocks.providers = [{ id: "provider-1", provider: "orcarouter", model: "deepseek/deepseek-v4-pro" }];
	mocks.attach.mockResolvedValue({ id: "file-1", filename: "photo.png", mediaType: "image/png" });
	mocks.update.mockResolvedValue({ id: "provider-1", model: "deepseek/deepseek-v4.1-flash" });
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
});

afterEach(cleanup);

it("offers the live chat catalog while nothing is attached", async () => {
	renderComposer();

	await waitFor(() => expect(screen.getByTestId("orca-composer-model")).toBeTruthy());
	await waitFor(() => expect(optionValues()).toContain("deepseek/deepseek-v4-pro"));
	expect(optionValues()).toEqual(["deepseek/deepseek-v4-pro", "deepseek/deepseek-v4.1-flash"]);
	expect(mocks.catalogCalls.at(-1)).toEqual({ id: "provider-1", entryPoint: "chat" });
});

it("drops to image-capable models only once an image is attached, and clears the text-only choice", async () => {
	const { container } = renderComposer();
	await waitFor(() => expect(optionValues()).toContain("deepseek/deepseek-v4-pro"));
	// The stored text-only model is currently selected.
	expect(screen.getByTestId("combobox-value").textContent).toBe("deepseek/deepseek-v4-pro");

	const input = container.querySelector('input[type="file"]');
	if (!input) throw new Error("File picker missing");
	fireEvent.change(input, { target: { files: [new File(["foo"], "photo.png", { type: "image/png" })] } });

	await waitFor(() => expect(mocks.catalogCalls.at(-1)).toEqual({ id: "provider-1", entryPoint: "assistant_image" }));
	// Only the model that declares image input remains offered.
	await waitFor(() => expect(optionValues()).toEqual(["deepseek/deepseek-v4.1-flash"]));
	expect(optionValues()).not.toContain("deepseek/deepseek-v4-pro");
	// The text-only selection is cleared rather than silently kept, and the user is told why.
	expect(screen.getByTestId("combobox-value").textContent).toBe("");
	expect(screen.getByTestId("orca-model-invalidated")).toBeTruthy();
});

it("keeps the chat catalog for a non-image attachment", async () => {
	const { container } = renderComposer();
	await waitFor(() => expect(optionValues()).toContain("deepseek/deepseek-v4-pro"));
	mocks.attach.mockResolvedValue({ id: "file-2", filename: "posting.txt", mediaType: "text/plain" });

	const input = container.querySelector('input[type="file"]');
	if (!input) throw new Error("File picker missing");
	fireEvent.change(input, { target: { files: [new File(["foo"], "posting.txt", { type: "text/plain" })] } });

	await waitFor(() => expect(screen.getByText("posting.txt")).toBeTruthy());
	expect(mocks.catalogCalls.at(-1)).toEqual({ id: "provider-1", entryPoint: "chat" });
	expect(optionValues()).toEqual(["deepseek/deepseek-v4-pro", "deepseek/deepseek-v4.1-flash"]);
});

it("persists the chosen model onto the provider", async () => {
	renderComposer();
	await waitFor(() => expect(optionValues()).toContain("deepseek/deepseek-v4.1-flash"));

	fireEvent.click(screen.getByText("deepseek/deepseek-v4.1-flash"));

	expect(mocks.update).toHaveBeenCalledWith({ id: "provider-1", model: "deepseek/deepseek-v4.1-flash" });
	await waitFor(() => expect(screen.getByTestId("combobox-value").textContent).toBe("deepseek/deepseek-v4.1-flash"));
});
