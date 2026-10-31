import { beforeEach, expect, it, vi } from "vite-plus/test";
import { createProcedureClient } from "@orpc/server";
const service = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), delete: vi.fn() }));
vi.mock("./service", () => ({ applicationProfileService: service }));
import { applicationProfileRouter } from "./router";

const user = {
	id: "owner",
	name: "Owner",
	email: "owner@example.test",
	emailVerified: true,
	createdAt: new Date(0),
	updatedAt: new Date(0),
};
const context = (
	permissions: Array<"read" | "write" | "delete">,
	method: "apiKey" | "bearer" | "session" = "bearer",
) => ({ locale: "en-US" as const, reqHeaders: new Headers(), authentication: { user, permissions, method } });
beforeEach(() => {
	vi.clearAllMocks();
	service.get.mockResolvedValue(null);
	service.delete.mockResolvedValue(undefined);
});
it.each(["apiKey", "bearer", "session"] as const)("scopes %s reads to the authenticated owner", async (method) => {
	const get = createProcedureClient(applicationProfileRouter.get, { context: context(["read"], method) });
	expect(await get()).toBeNull();
	expect(service.get).toHaveBeenCalledExactlyOnceWith("owner");
});
it("rejects anonymous reads, read-only writes and write-only deletion", async () => {
	await expect(
		createProcedureClient(applicationProfileRouter.get, {
			context: { locale: "en-US", reqHeaders: new Headers(), authentication: null },
		})(),
	).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	await expect(
		createProcedureClient(applicationProfileRouter.save, { context: context(["read"]) })({
			data: {},
			expectedRevision: null,
		} as never),
	).rejects.toMatchObject({ code: "FORBIDDEN" });
	await expect(
		createProcedureClient(applicationProfileRouter.delete, { context: context(["write"]) })({ expectedRevision: "r" }),
	).rejects.toMatchObject({ code: "FORBIDDEN" });
	expect(service.get).not.toHaveBeenCalled();
	expect(service.save).not.toHaveBeenCalled();
	expect(service.delete).not.toHaveBeenCalled();
});
it("rejects caller-supplied ownership and self-identification instead of silently stripping them", async () => {
	const save = createProcedureClient(applicationProfileRouter.save, { context: context(["write"]) });
	for (const input of [
		{ data: {}, expectedRevision: null, userId: "victim" },
		{ data: { selfIdentification: { disability: "no" } }, expectedRevision: null },
	]) {
		await expect(save(input as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
	}
	expect(service.save).not.toHaveBeenCalled();
});
