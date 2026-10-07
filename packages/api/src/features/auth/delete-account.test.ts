import { expect, it, vi } from "vitest";
import { createProcedureClient } from "@orpc/server";

const deleteAccount = vi.hoisted(() => vi.fn());
vi.mock("@reactive-resume/auth/config", () => ({ auth: { api: {} } }));
vi.mock("./service", () => ({ authService: { deleteAccount } }));
const { authRouter } = await import("./router");

it.each(["apiKey", "bearer", "session"] as const)(
	"requires a browser session to delete an account: %s",
	async (method) => {
		deleteAccount.mockReset().mockResolvedValue(undefined);
		const remove = createProcedureClient(authRouter.deleteAccount, {
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
					method,
					permissions: ["read", "write", "delete"],
				},
			},
		});

		if (method === "session") {
			await expect(remove({})).resolves.toBeUndefined();
			expect(deleteAccount).toHaveBeenCalledWith({ userId: "owner" });
		} else {
			await expect(remove({})).rejects.toMatchObject({
				code: "FORBIDDEN",
				message: "Account deletion must be performed in your browser settings.",
			});
			expect(deleteAccount).not.toHaveBeenCalled();
		}
	},
);
