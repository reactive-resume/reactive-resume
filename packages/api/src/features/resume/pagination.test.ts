import { expect, it, vi } from "vitest";
import { call } from "@orpc/server";
const list = vi.hoisted(() => vi.fn());
vi.mock("./service", () => ({ resumeService: { list } }));
vi.mock("@reactive-resume/auth/config", () => ({
	auth: { api: { getSession: vi.fn().mockResolvedValue({ user: { id: "owner" } }) } },
	verifyOAuthToken: vi.fn(),
}));
vi.mock("@reactive-resume/db/client", () => ({
	db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: "owner", banned: false }] }) }) }) },
}));
const { crudRouter } = await import("./crud");

it("paginates the owner's filtered list without changing legacy array responses", async () => {
	const rows = ["a", "b", "c"].map((id) => ({
		id,
		name: id,
		slug: id,
		tags: ["engineering"],
		isPublic: false,
		isLocked: false,
		showDownloadButtons: false,
		createdAt: new Date(),
		updatedAt: new Date(),
	}));
	list.mockResolvedValue(rows);
	const resHeaders = new Headers();
	const context = { locale: "en-US" as const, reqHeaders: new Headers(), resHeaders };
	const result = await call(crudRouter.list, { tags: ["engineering"], limit: 1, offset: 1 }, { context });
	expect(result.map((row) => row.id)).toEqual(["b"]);
	expect(resHeaders.get("X-Total-Count")).toBe("3");
	expect(list).toHaveBeenCalledWith({ userId: "owner", tags: ["engineering"], sort: "lastUpdatedAt" });
	expect(await call(crudRouter.list, {}, { context })).toEqual(rows);
	await expect(call(crudRouter.list, { limit: 101 }, { context })).rejects.toMatchObject({ code: "BAD_REQUEST" });
});
