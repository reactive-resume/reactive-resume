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
import { invalidateAccountScope } from "@/libs/auth/account-scope";

const mocks = vi.hoisted(() => ({
	removeFile: vi.fn(),
	uploadFile: vi.fn(),
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
			uploadFile: { mutationOptions: () => ({ mutationFn: mocks.uploadFile }) },
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
	vi.unstubAllGlobals();
});

function renderPhoto(url = "/api/uploads/owner/pictures/shared.jpeg", fit: "cover" | "contain" = "cover") {
	vi.useFakeTimers();
	i18n.load("en", {});
	i18n.activate("en");
	mocks.toast.mockReturnValue("photo-toast");
	const data = structuredClone(defaultResumeData);
	data.picture.url = url;
	data.picture.fit = fit;
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
				<PictureSettings locked={false} />
			</I18nProvider>
		</QueryClientProvider>,
	);
	if (url) fireEvent.click(screen.getByRole("button", { name: "Edit" }));
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
		expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
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
		expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
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

it("rejects unreadable photo bytes before opening the crop dialog", async () => {
	const { client } = renderPhoto();
	vi.stubGlobal(
		"Image",
		class {
			src = "";
			decode = async () => {
				throw new Error("unreadable");
			};
		},
	);
	const input = document.querySelector<HTMLInputElement>('input[type="file"]');
	if (!input) throw new Error("Missing photo input");
	await act(async () => {
		fireEvent.change(input, { target: { files: [new File(["not an image"], "bad.png", { type: "image/png" })] } });
	});
	expect(screen.queryByRole("dialog", { name: "Crop photo" })).toBeNull();
	expect(mocks.toast).toHaveBeenCalledWith(
		expect.objectContaining({
			type: "error",
			description: "This file isn't a readable image. Choose a PNG, JPEG, WebP or GIF photo.",
		}),
	);
	vi.unstubAllGlobals();
	client.clear();
});

it("opens the file picker directly from Add before showing photo settings", () => {
	const { client } = renderPhoto("");
	const input = screen.getByLabelText("Upload photo");
	const choose = vi.spyOn(input, "click");
	fireEvent.click(screen.getByRole("button", { name: "Add" }));
	expect(choose).toHaveBeenCalledTimes(1);
	expect(screen.queryByRole("textbox", { name: "URL" })).toBeNull();
	client.clear();
});

it.each(["current", "resume", "locked", "account"])(
	"an upload only updates its current owner URL (%s)",
	async (scenario) => {
		let finish: (value: { url: string }) => void = () => {};
		mocks.uploadFile.mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		vi.stubGlobal(
			"Image",
			class {
				src = "";
				decode = async () => {};
			},
		);
		const { initial, client } = renderPhoto("/api/uploads/owner/pictures/shared.jpeg", "contain");
		const input = screen.getByLabelText("Upload photo");
		await act(async () => {
			fireEvent.change(input, { target: { files: [new File(["fictional"], "photo.png", { type: "image/png" })] } });
		});
		expect(mocks.uploadFile).toHaveBeenCalledTimes(1);
		act(() => {
			if (scenario === "resume") cleanup();
			if (scenario === "resume")
				useResumeStore.getState().initialize({ ...initial, id: "other", data: structuredClone(initial.data) });
			if (scenario === "locked")
				useResumeStore.getState().patchResume((resume) => {
					resume.isLocked = true;
				});
			if (scenario === "account") {
				invalidateAccountScope();
				useResumeStore.getState().initialize({ ...initial, data: structuredClone(initial.data) });
			}
			if (scenario === "current")
				useResumeStore.getState().updateResumeData((draft) => {
					draft.picture.size = 144;
				});
		});
		const before = useResumeStore.getState().resume;
		await act(async () => {
			finish({ url: "/api/uploads/owner/pictures/new.png" });
		});
		if (scenario === "current")
			expect(useResumeStore.getState().resume?.data.picture).toMatchObject({
				url: "/api/uploads/owner/pictures/new.png",
				size: 144,
			});
		else expect(useResumeStore.getState().resume).toBe(before);
		expect(mocks.toast).toHaveBeenCalledTimes(1);
		if (scenario !== "resume") expect(mocks.closeToast).toHaveBeenCalledWith("photo-toast");
		client.clear();
	},
);

it.each(["before", "during"])("clears the file selection when ownership changes %s decode", async (when) => {
	let finish = () => {};
	vi.stubGlobal(
		"Image",
		class {
			src = "";
			decode = () =>
				new Promise<void>((resolve) => {
					finish = resolve;
				});
		},
	);
	const { client } = renderPhoto("");
	const input = screen.getByLabelText("Upload photo") as HTMLInputElement;
	Object.defineProperty(input, "value", { value: "photo.png", writable: true });
	const lock = () =>
		useResumeStore.getState().patchResume((resume) => {
			resume.isLocked = true;
		});
	if (when === "before") act(lock);
	act(() => {
		fireEvent.change(input, { target: { files: [new File(["fictional"], "photo.png", { type: "image/png" })] } });
	});
	if (when === "during") act(lock);
	await act(async () => {
		finish();
	});
	expect(input.value).toBe("");
	expect(mocks.uploadFile).not.toHaveBeenCalled();
	expect(screen.queryByRole("dialog", { name: "Crop photo" })).toBeNull();
	client.clear();
});
