// @vitest-environment happy-dom
import type { Resume } from "@/features/resume/builder/draft";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { PictureSettings } from "./picture-settings";
import { clearResumeDrafts, useResumeStore } from "@/features/resume/builder/draft";

const mocks = vi.hoisted(() => ({
	removeFile: vi.fn(),
	toast: vi.fn(),
	closeToast: vi.fn(),
	confirm: vi.fn(async () => true),
}));
vi.mock("@tanstack/react-router", () => ({ useParams: () => ({ resumeId: "original" }) }));
vi.mock("@/hooks/use-confirm", () => ({ useConfirm: () => mocks.confirm }));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: mocks.toast, close: mocks.closeToast } }));
vi.mock("@/libs/orpc/client", () => ({
	orpc: {
		storage: {
			uploadFile: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
			deleteFile: { mutationOptions: () => ({ mutationFn: mocks.removeFile }) },
		},
	},
}));

afterEach(() => {
	cleanup();
	clearResumeDrafts();
	localStorage.clear();
	vi.useRealTimers();
	vi.clearAllMocks();
});

function renderPhoto(url = "/api/uploads/owner/pictures/shared.jpeg") {
	vi.useFakeTimers();
	i18n.load("en", {});
	i18n.activate("en");
	mocks.toast.mockReturnValue("photo-toast");
	const data = structuredClone(defaultResumeData);
	data.picture.url = url;
	const initial: Resume = {
		id: "original",
		name: "Original",
		slug: "original",
		tags: [],
		data,
		isLocked: false,
		createdAt: new Date(),
		updatedAt: new Date(),
	};
	useResumeStore.getState().initialize(initial);
	const client = new QueryClient();
	render(
		<QueryClientProvider client={client}>
			<I18nProvider i18n={i18n}>
				<PictureSettings />
			</I18nProvider>
		</QueryClientProvider>,
	);
	return { initial, client };
}

it.each(["/api/uploads/owner/pictures/shared.jpeg", "https://photos.example.test/shared.jpeg"])(
	"removes only this resume's photo reference and offers undo: %s",
	async (url) => {
		const { client } = renderPhoto(url);
		const sharedUpload = new Map([[url, "photo bytes"]]);
		mocks.removeFile.mockImplementation(async () => sharedUpload.delete(url));
		// A preceding edit must survive Undo of the removal.
		act(() =>
			useResumeStore.getState().updateResumeData((draft) => {
				draft.picture.size = 123;
			}),
		);
		await act(async () => fireEvent.click(screen.getByRole("button", { name: "Remove photo" })));
		expect(useResumeStore.getState().resume?.data.picture).toMatchObject({ url: "", size: 123 });
		expect(sharedUpload.get(url)).toBe("photo bytes");
		expect(mocks.removeFile).not.toHaveBeenCalled();
		expect(mocks.confirm).not.toHaveBeenCalled();
		expect(screen.getByRole("button", { name: "Upload photo" })).toBeInTheDocument();
		const action = mocks.toast.mock.lastCall?.[0].actionProps;
		expect(action?.children).toBe("Undo");
		act(() =>
			useResumeStore.getState().updateResumeData((draft) => {
				draft.basics.name = "Later edit";
			}),
		);
		act(() => action.onClick());
		expect(useResumeStore.getState().resume?.data.picture).toMatchObject({ url, size: 123 });
		expect(useResumeStore.getState().resume?.data.basics.name).toBe("Later edit");
		expect(mocks.closeToast).toHaveBeenCalledWith("photo-toast");
		act(() =>
			useResumeStore.getState().updateResumeData((draft) => {
				draft.basics.name = "After restoration";
			}),
		);
		act(() => action.onClick());
		expect(useResumeStore.getState().resume?.data.basics.name).toBe("After restoration");
		expect(screen.getByRole("button", { name: "Remove photo" })).toBeInTheDocument();
		client.clear();
	},
);

it("does not restore a photo into another resume", async () => {
	const { initial, client } = renderPhoto();
	await act(async () => fireEvent.click(screen.getByRole("button", { name: "Remove photo" })));
	const action = mocks.toast.mock.lastCall?.[0].actionProps;
	cleanup();
	useResumeStore.getState().initialize({ ...initial, id: "other", data: structuredClone(defaultResumeData) });
	useResumeStore.getState().updateResumeData((draft) => {
		draft.basics.name = "Other resume edit";
	});
	const before = useResumeStore.getState().resume;
	act(() => action.onClick());
	expect(useResumeStore.getState().resume).toEqual(before);
	client.clear();
});

it.each(["replacement", "locked"])("does not restore over a %s photo state", async (state) => {
	const { client } = renderPhoto();
	await act(async () => fireEvent.click(screen.getByRole("button", { name: "Remove photo" })));
	const action = mocks.toast.mock.lastCall?.[0].actionProps;
	act(() => {
		if (state === "locked")
			useResumeStore.getState().patchResume((resume) => {
				resume.isLocked = true;
			});
		else
			useResumeStore.getState().updateResumeData((draft) => {
				draft.picture.url = "https://photos.example.test/new.jpeg";
			});
	});
	const before = useResumeStore.getState().resume;
	act(() => action.onClick());
	expect(useResumeStore.getState().resume).toEqual(before);
	client.clear();
});

it("does not announce removal when a remote lock prevents editing", async () => {
	const { initial, client } = renderPhoto();
	act(() =>
		useResumeStore.getState().patchResume((resume) => {
			resume.isLocked = true;
		}),
	);
	await act(async () => fireEvent.click(screen.getByRole("button", { name: "Remove photo" })));
	expect(useResumeStore.getState().resume?.data.picture.url).toBe(initial.data.picture.url);
	expect(mocks.toast.mock.calls.some(([value]) => value.description === "Photo removed")).toBe(false);
	client.clear();
});
