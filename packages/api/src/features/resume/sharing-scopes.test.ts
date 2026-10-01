import type { RequestPermission } from "../../context";
import { expect, it, vi } from "vitest";
import { createProcedureClient } from "@orpc/server";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";

const fixture = vi.hoisted(() => ({ resume: {} as Record<string, unknown> }));
vi.mock("@reactive-resume/auth/config", () => ({ auth: {}, verifyOAuthToken: vi.fn() }));
vi.mock("@reactive-resume/db/client", () => ({
	db: {
		select: () => ({
			from: () => ({
				// This fixture uses its current slug; the redirect subquery has no rows.
				where: () => [],
				innerJoin: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [fixture.resume] }) }) }),
			}),
		}),
	},
}));
const { sharingRouter } = await import("./sharing");

it.each(["write", "read"] as RequestPermission[])(
	"requires read permission for private resumes through the public route: %s",
	async (permission) => {
		fixture.resume = {
			id: "resume",
			userId: "owner",
			name: "Private",
			slug: "resume",
			tags: [],
			data: structuredClone(defaultResumeData),
			isPublic: false,
			isLocked: false,
			showDownloadButtons: true,
			hasPassword: false,
			passwordHash: null,
		};
		const get = createProcedureClient(sharingRouter.getBySlug, {
			context: {
				locale: "en-US",
				reqHeaders: new Headers(),
				authentication: {
					user: {
						id: "owner",
						name: "Owner",
						email: "owner@example.test",
						emailVerified: true,
						createdAt: new Date(),
						updatedAt: new Date(),
					},
					method: "apiKey",
					permissions: [permission],
				},
			},
		});
		if (permission === "read")
			await expect(get({ username: "owner", slug: "resume" })).resolves.toMatchObject({ id: "resume" });
		else await expect(get({ username: "owner", slug: "resume" })).rejects.toMatchObject({ code: "NOT_FOUND" });
	},
);
