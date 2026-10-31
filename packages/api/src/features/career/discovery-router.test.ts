import { beforeEach, expect, it, vi } from "vite-plus/test";
import { createRouterClient } from "@orpc/server";
import { careerRouter } from "./router";

const service = vi.hoisted(() => ({ suggest: vi.fn(), track: vi.fn(), dismiss: vi.fn() }));
vi.mock("./role-suggestions", () => ({ suggestTargetRoles: service.suggest }));
vi.mock("./jobs", () => ({ careerJobs: { dismissOpportunity: service.dismiss } }));
vi.mock("./service", () => ({ careerService: { trackOpportunity: service.track } }));
vi.mock("../../middleware/rate-limit", async () => {
	const { os } = await import("@orpc/server");
	return {
		aiRequestRateLimit: os.middleware(({ next }) => next()),
		aiVoiceRateLimit: os.middleware(({ next }) => next()),
	};
});
const user = {
	id: "owner",
	name: "Synthetic Owner",
	email: "owner@example.test",
	emailVerified: true,
	createdAt: new Date(),
	updatedAt: new Date(),
};
const client = (permissions: ("read" | "write" | "delete")[]) =>
	createRouterClient(careerRouter, {
		context: { locale: "en-US", reqHeaders: new Headers(), authentication: { user, method: "apiKey", permissions } },
	});
beforeEach(() => vi.clearAllMocks());
it("requires write for provider disclosure and track, delete for dismiss", async () => {
	const input = { providerId: "connection", recipientVersion: "a".repeat(64), resumeId: null, includeKnowledge: true };
	await expect(client(["read"]).suggestTargetRoles(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
	await expect(client(["read"]).trackOpportunity({ id: "role" })).rejects.toMatchObject({ code: "FORBIDDEN" });
	await expect(client(["write"]).dismissOpportunity({ id: "role" })).rejects.toMatchObject({ code: "FORBIDDEN" });
	expect(service.suggest).not.toHaveBeenCalled();
	expect(service.track).not.toHaveBeenCalled();
	expect(service.dismiss).not.toHaveBeenCalled();
	service.suggest.mockResolvedValue({ suggestions: [] });
	await expect(client(["write"]).suggestTargetRoles(input)).resolves.toEqual({ suggestions: [] });
	expect(service.suggest).toHaveBeenCalledWith("owner", { ...input, locale: "en-US" }, undefined);
});
