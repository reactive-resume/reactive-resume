import { beforeEach, expect, it, vi } from "vite-plus/test";
import { createRouterClient } from "@orpc/server";
import { answerRouter } from "./answer-router";

const service = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn(), reuse: vi.fn(), delete: vi.fn() }));
vi.mock("./answers", () => ({ reviewedAnswers: service }));
const user = {
	id: "owner",
	name: "Synthetic Owner",
	email: "owner@example.test",
	emailVerified: true,
	createdAt: new Date(),
	updatedAt: new Date(),
};
const client = (permissions: ("read" | "write" | "delete")[]) =>
	createRouterClient(answerRouter, {
		context: { locale: "en-US", reqHeaders: new Headers(), authentication: { user, method: "apiKey", permissions } },
	});
beforeEach(() => {
	vi.clearAllMocks();
	service.list.mockResolvedValue([]);
});
it("requires authentication and delegates reads with the credential owner", async () => {
	const anonymous = createRouterClient(answerRouter, {
		context: { locale: "en-US", reqHeaders: new Headers(), authentication: null },
	});
	await expect(anonymous.list({ applicationId: "app" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	await expect(client(["read"]).list({ applicationId: "app" })).resolves.toEqual([]);
	expect(service.list).toHaveBeenCalledWith("owner", "app");
});
it("rejects delegated read-only writes and requires delete permission separately", async () => {
	await expect(
		client(["read"]).save({
			applicationId: "app",
			question: "Why?",
			answer: "My answer",
			source: "manual",
			scope: "employer",
			factIds: [],
			storyIds: [],
			expectedEvidence: [],
			reviewed: true,
			noEmployerWording: false,
		}),
	).rejects.toMatchObject({ code: "FORBIDDEN" });
	await expect(
		client(["read"]).reuse({
			id: "answer",
			applicationId: "app",
			answer: "Reviewed answer",
			expectedRevision: 1,
			reviewed: true,
		}),
	).rejects.toMatchObject({ code: "FORBIDDEN" });
	await expect(client(["write"]).delete({ id: "answer", expectedRevision: 1 })).rejects.toMatchObject({
		code: "FORBIDDEN",
	});
	expect(service.save).not.toHaveBeenCalled();
	expect(service.reuse).not.toHaveBeenCalled();
	expect(service.delete).not.toHaveBeenCalled();
});
