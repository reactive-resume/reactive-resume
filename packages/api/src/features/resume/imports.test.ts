import { expect, it, vi } from "vitest";
import { call } from "@orpc/server";
const create = vi.hoisted(() => vi.fn());
vi.mock("./service", () => ({ resumeService: { create } }));
vi.mock("@reactive-resume/auth/config", () => ({
	auth: { api: { getSession: vi.fn().mockResolvedValue({ user: { id: "owner" } }) } },
	verifyOAuthToken: vi.fn(),
}));
vi.mock("@reactive-resume/db/client", () => ({
	db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: "owner", banned: false }] }) }) }) },
}));
const { importResumeFile } = await import("./imports");

it("imports JSON Resume into the authenticated account and rejects invalid files before writing", async () => {
	const context = { locale: "en-US" as const, reqHeaders: new Headers() };
	const id = await call(
		importResumeFile,
		{ file: new File([JSON.stringify({ basics: { name: "Ada Lovelace" } })], "resume.json"), format: "JSON_RESUME" },
		{ context },
	);
	expect(create).toHaveBeenCalledWith(
		expect.objectContaining({
			id,
			userId: "owner",
			name: "Ada Lovelace",
			data: expect.objectContaining({ basics: expect.objectContaining({ name: "Ada Lovelace" }) }),
		}),
	);
	create.mockClear();
	await expect(
		call(importResumeFile, { file: new File(["bad json"], "resume.json"), format: "JSON_RESUME" }, { context }),
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
	expect(create).not.toHaveBeenCalled();
});
