import { expect, it, vi } from "vite-plus/test";
import { createRouterClient } from "@orpc/server";
const packets = vi.hoisted(() => ({ review: vi.fn(), export: vi.fn() }));
vi.mock("./packet", () => ({ applicationPackets: packets }));
import { packetRouter } from "./packet-router";
const user = {
	id: "owner",
	name: "Maya",
	email: "maya@example.test",
	emailVerified: true,
	createdAt: new Date(0),
	updatedAt: new Date(0),
};
const client = (permissions: ("read" | "write" | "delete")[], method: "session" | "apiKey" | "bearer" = "session") =>
	createRouterClient(packetRouter, {
		context: { locale: "en-US", reqHeaders: new Headers(), authentication: { user, method, permissions } },
	});
const selection = {
	applicationId: "app",
	targetUrl: "https://jobs.lever.co/fictional/job",
	includeContact: false,
	answerIds: [],
	letterWords: null,
};
it.each(["session", "apiKey", "bearer"] as const)(
	"requires read and write scopes for private packet export through %s",
	async (method) => {
		for (const permissions of [["read"], ["write"]] as const) {
			await expect(client([...permissions], method).review(selection)).rejects.toMatchObject({ code: "FORBIDDEN" });
			await expect(
				client([...permissions], method).export({ selection, fingerprint: "a".repeat(64), reviewed: true }),
			).rejects.toMatchObject({ code: "FORBIDDEN" });
		}
		expect(packets.review).not.toHaveBeenCalled();
		expect(packets.export).not.toHaveBeenCalled();
	},
);
it("rejects absent approval, caller ownership and URL credentials before reading sources", async () => {
	for (const input of [
		{ selection, fingerprint: "a".repeat(64), reviewed: false },
		{ selection, fingerprint: "a".repeat(64), reviewed: true, userId: "victim" },
		{
			selection: { ...selection, targetUrl: "https://private:secret@jobs.lever.co/x/y" },
			fingerprint: "a".repeat(64),
			reviewed: true,
		},
	])
		await expect(client(["read", "write"]).export(input as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
	expect(packets.export).not.toHaveBeenCalled();
});
