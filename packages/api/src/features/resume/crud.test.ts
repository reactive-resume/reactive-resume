import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createRouterClient, ORPCError } from "@orpc/server";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { sampleResumeData } from "@reactive-resume/schema/resume/sample";

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

	it("declares RESUME_PRIMARY_CONFLICT in the generated update contract", async () => {
		type CodeSchema = { properties?: { code?: { const?: string } } };
		const spec = JSON.parse(await readFile(new URL("../../../../../docs/spec.json", import.meta.url), "utf8")) as {
			paths: {
				"/resumes/{id}": {
					put: { responses: { "409": { content: { "application/json": { schema: { oneOf: CodeSchema[] } } } } } };
				};
			};
		};
		const codes = spec.paths["/resumes/{id}"].put.responses["409"].content["application/json"].schema.oneOf
			.map((schema) => schema.properties?.code?.const)
			.filter(Boolean);

		expect(codes).toContain("RESUME_PRIMARY_CONFLICT");
	});

	it.each([false, true])("puts the account holder's name on a new resume (sample data: %s)", async (withSampleData) => {
		const client = createRouterClient(crudRouter, {
			context: {
				locale: "en-US",
				reqHeaders: new Headers(),
				user: { id: "user-id", name: "Sam Taylor", email: "sam@example.test" },
			} as never,
		});

		await client.create({ name: "Outstanding Blue Whale", tags: [], withSampleData });

		expect(mocks.create).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "Outstanding Blue Whale",
				data: expect.objectContaining({ basics: expect.objectContaining({ name: "Sam Taylor" }) }),
			}),
		);
		// A blank resume also starts with the account's email; a sample keeps its own.
		const created = mocks.create.mock.calls.at(-1)?.[0] as { data: { basics: { email: string } } };
		if (!withSampleData) expect(created.data.basics.email).toBe("sam@example.test");
		else expect(created.data.basics.email).toBe(sampleResumeData.basics.email);
	});

	it("leaves a guest's placeholder address off a new resume", async () => {
		const client = createRouterClient(crudRouter, {
			context: {
				locale: "en-US",
				reqHeaders: new Headers(),
				user: { id: "guest-id", name: "Guest", email: "temp-1@reactive-resume.local", isAnonymous: true },
			} as never,
		});

		await client.create({ name: "Untitled", tags: [], withSampleData: false });

		const created = mocks.create.mock.calls.at(-1)?.[0] as { data: { basics: { email: string } } };
		expect(created.data.basics.email).toBe("");
	});

	it("keeps a signed-up account's address even on the guest domain", async () => {
		const client = createRouterClient(crudRouter, {
			context: {
				locale: "en-US",
				reqHeaders: new Headers(),
				user: { id: "user-id", name: "Sam", email: "sam@reactive-resume.local", isAnonymous: false },
			} as never,
		});

		await client.create({ name: "Untitled", tags: [], withSampleData: false });

		const created = mocks.create.mock.calls.at(-1)?.[0] as { data: { basics: { email: string } } };
		expect(created.data.basics.email).toBe("sam@reactive-resume.local");
	});

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
			showInSearchEngines: false,
			hideContactDetails: false,
			isPrimary: false,
			isLocked: false,
			data: defaultResumeData,
			createdAt: new Date(),
			updatedAt: new Date(),
			hasPassword: false,
		});

		await client.update({ id: "resume-id", slug: tooLongSlug });
		expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ id: "resume-id", slug: tooLongSlug }));
	});

	it.each(
		["create", "duplicate", "update"].flatMap((operation) =>
			["", "a".repeat(65), "Invalid Slug@123!"].map((slug) => ({ operation, slug })),
		),
	)("returns INVALID_SLUG for $operation with slug '$slug'", async ({ operation, slug }) => {
		mocks.create.mockRejectedValueOnce(new ORPCError("INVALID_SLUG", { status: 400 }));
		mocks.update.mockRejectedValueOnce(new ORPCError("INVALID_SLUG", { status: 400 }));

		const client = createRouterClient(crudRouter, {
			context: { locale: "en-US", reqHeaders: new Headers(), user: { id: "user-id", name: "Sam" } } as never,
		});

		const result =
			operation === "create"
				? client.create({ name: "Resume", tags: [], slug })
				: operation === "duplicate"
					? client.duplicate({ id: "resume-id", slug })
					: client.update({ id: "resume-id", slug });

		await expect(result).rejects.toMatchObject({ code: "INVALID_SLUG", status: 400 });
	});

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
