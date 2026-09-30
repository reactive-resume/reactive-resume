import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRouterClient } from "@orpc/server";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";

const mocks = vi.hoisted(() => ({
	create: vi.fn(),
	getById: vi.fn(),
	update: vi.fn(),
	snapshot: vi.fn(),
}));

vi.mock("../../context", async () => {
	const { os } = await vi.importActual<typeof import("@orpc/server")>("@orpc/server");
	return {
		protectedProcedure: os.$context<{
			locale: "en-US";
			reqHeaders: Headers;
			user: { id: string };
		}>(),
	};
});

vi.mock("./service", () => ({
	resumeService: {
		create: mocks.create,
		getById: mocks.getById,
		update: mocks.update,
		versions: { snapshot: mocks.snapshot },
	},
}));

const { crudRouter } = await import("./crud");

const rendererUnsafeData = (): ResumeData =>
	({
		...structuredClone(defaultResumeData),
		customSections: [
			{
				id: "custom-experience",
				type: "experience",
				title: "Experience",
				icon: "",
				columns: 1,
				hidden: false,
				keepTogether: false,
				startOnNewPage: false,
				items: [{ id: "summary-item", hidden: false, content: "<p>Missing company</p>" }],
			},
		],
	}) as unknown as ResumeData;

describe("resume duplicate route", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.create.mockResolvedValue("copy-id");
	});

	it("rejects invalid stored source data before calling the shared create service", async () => {
		mocks.getById.mockResolvedValue({
			id: "resume-id",
			name: "Resume",
			slug: "resume",
			tags: [],
			data: rendererUnsafeData(),
		});
		const client = createRouterClient(crudRouter, {
			context: { locale: "en-US", reqHeaders: new Headers(), user: { id: "user-id" } } as never,
		});

		const error = await client
			.duplicate({ id: "resume-id", name: "Copy", slug: "copy", tags: [] })
			.catch((caught: unknown) => caught);

		expect(error).toMatchObject({ code: "INTERNAL_SERVER_ERROR", status: 500 });
		expect(error).toHaveProperty("cause.issues.0.path", ["customSections", 0, "items", 0, "company"]);
		expect(mocks.create).not.toHaveBeenCalled();
	});
});

describe("resume write route validation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.create.mockResolvedValue("resume-id");
		mocks.update.mockResolvedValue({});
		mocks.snapshot.mockResolvedValue(undefined);
	});

	it.each(["import", "update"] as const)("rejects invalid %s input before calling persistence", async (operation) => {
		const client = createRouterClient(crudRouter, {
			context: { locale: "en-US", reqHeaders: new Headers(), user: { id: "user-id" } } as never,
		});
		const data = structuredClone(defaultResumeData);
		data.metadata.page.marginX = 500;

		const result = operation === "import" ? client.import({ data }) : client.update({ id: "resume-id", data });
		const error = await result.catch((caught: unknown) => caught);

		expect(error).toMatchObject({ code: "BAD_REQUEST", status: 400 });
		expect(error).toHaveProperty("cause.issues.0.path", ["data", "metadata", "page", "marginX"]);
		expect(mocks.create).not.toHaveBeenCalled();
		expect(mocks.update).not.toHaveBeenCalled();
		expect(mocks.snapshot).not.toHaveBeenCalled();
	});
});

describe("resume sharing update route", () => {
	it.each([false, true])(
		"passes showDownloadButtons=%s through the authenticated update procedure",
		async (showDownloadButtons) => {
			const row = {
				id: "resume-id",
				name: "Resume",
				slug: "resume",
				tags: [],
				data: defaultResumeData,
				isPublic: true,
				isLocked: false,
				critiqueEnabled: false,
				hasPassword: false,
				hasCritiquePassword: false,
				showDownloadButtons,
				updatedAt: new Date(),
			};
			mocks.update.mockResolvedValue(row);
			const client = createRouterClient(crudRouter, {
				context: { locale: "en-US", reqHeaders: new Headers(), user: { id: "user-id" } } as never,
			});
			const result = await client.update({ id: "resume-id", showDownloadButtons });
			expect(mocks.update).toHaveBeenCalledWith({ id: "resume-id", userId: "user-id", showDownloadButtons });
			expect(result.showDownloadButtons).toBe(showDownloadButtons);
		},
	);
});
