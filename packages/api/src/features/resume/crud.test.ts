import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createRouterClient } from "@orpc/server";
import { ORPCError } from "@orpc/server";
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

describe("resume write route validation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.create.mockResolvedValue("resume-id");
		mocks.getById.mockResolvedValue({
			id: "resume-id",
			name: "Original",
			tags: [],
			data: defaultResumeData,
		});
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

	it.each([false, true])("puts the account holder's name on a new resume (sample data: %s)", async (withSampleData) => {
		const client = createRouterClient(crudRouter, {
			context: { locale: "en-US", reqHeaders: new Headers(), user: { id: "user-id", name: "Sam Taylor" } } as never,
		});

		await client.create({ name: "Outstanding Blue Whale", tags: [], withSampleData });

		expect(mocks.create).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "Outstanding Blue Whale",
				data: expect.objectContaining({ basics: expect.objectContaining({ name: "Sam Taylor" }) }),
			}),
		);
	});

	it.each(["create", "duplicate"] as const)(
		"rejects slug longer than 64 characters on %s before calling persistence",
		async (operation) => {
			const client = createRouterClient(crudRouter, {
				context: { locale: "en-US", reqHeaders: new Headers(), user: { id: "user-id", name: "Sam" } } as never,
			});
			const tooLongSlug = "a".repeat(65);

			const result =
				operation === "create"
					? client.create({ name: "Resume", tags: [], slug: tooLongSlug })
					: client.duplicate({ id: "resume-id", slug: tooLongSlug });

			const error = await result.catch((caught: unknown) => caught);

			expect(error).toMatchObject({ code: "BAD_REQUEST", status: 400 });
			expect(error).toHaveProperty("cause.issues.0.path", ["slug"]);
			expect(mocks.create).not.toHaveBeenCalled();
		},
	);

	it("allows overlong slug on update to reach the service for change-sensitive check", async () => {
		const client = createRouterClient(crudRouter, {
			context: { locale: "en-US", reqHeaders: new Headers(), user: { id: "user-id", name: "Sam" } } as never,
		});
		const tooLongSlug = "a".repeat(65);
		mocks.update.mockResolvedValueOnce({
			id: "resume-id",
			name: "Resume",
			slug: tooLongSlug,
			tags: [],
			isPublic: false,
			showDownloadButtons: true,
			isLocked: false,
			data: defaultResumeData,
			createdAt: new Date(),
			updatedAt: new Date(),
			hasPassword: false,
		});

		await client.update({ id: "resume-id", slug: tooLongSlug });
		expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ id: "resume-id", slug: tooLongSlug }));
	});

	it.each(["create", "duplicate", "update"] as const)(
		"propagates INVALID_SLUG when service rejects %s with invalid slug",
		async (operation) => {
			mocks.create.mockRejectedValueOnce(new ORPCError("INVALID_SLUG", { status: 400 }));
			mocks.update.mockRejectedValueOnce(new ORPCError("INVALID_SLUG", { status: 400 }));

			const client = createRouterClient(crudRouter, {
				context: { locale: "en-US", reqHeaders: new Headers(), user: { id: "user-id", name: "Sam" } } as never,
			});

			const result =
				operation === "create"
					? client.create({ name: "Resume", tags: [], slug: "Invalid Slug@123!" })
					: operation === "duplicate"
						? client.duplicate({ id: "resume-id", slug: "Invalid Slug@123!" })
						: client.update({ id: "resume-id", slug: "Invalid Slug@123!" });

			await expect(result).rejects.toMatchObject({ code: "INVALID_SLUG", status: 400 });
		},
	);

	it("propagates NOT_FOUND when duplicating a non-existent resume", async () => {
		mocks.getById.mockRejectedValueOnce(new ORPCError("NOT_FOUND", { status: 404 }));

		const client = createRouterClient(crudRouter, {
			context: { locale: "en-US", reqHeaders: new Headers(), user: { id: "user-id", name: "Sam" } } as never,
		});

		await expect(client.duplicate({ id: "missing-id" })).rejects.toMatchObject({
			code: "NOT_FOUND",
			status: 404,
		});
	});
});
