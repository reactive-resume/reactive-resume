import { format } from "node:util";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("@reactive-resume/auth/config", () => ({
	auth: {
		api: { getSession: vi.fn().mockResolvedValue(null), verifyApiKey: vi.fn().mockResolvedValue({ valid: false }) },
	},
	verifyOAuthToken: vi.fn().mockRejectedValue(new Error("invalid token")),
	isCustomOAuthProviderEnabled: () => false,
}));
const { handleOpenApi } = await import("./handler");
const { handleRpc } = await import("../rpc/handler");
const { auth } = await import("@reactive-resume/auth/config");
const { db } = await import("@reactive-resume/db/client");
const request = (path: string, init?: RequestInit) =>
	handleOpenApi(new Request(`http://localhost:3000/api/openapi${path}`, init), "127.0.0.1");

beforeEach(() => {
	vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("REST boundary", () => {
	it.each(["REST", "RPC"])(
		"rejects invalid profile language without logging submitted values over %s",
		async (transport) => {
			vi.mocked(auth.api.getSession).mockResolvedValueOnce({
				user: { id: "locale-log-test", role: "user" },
				session: { id: "locale-log-session" },
			} as never);
			vi.spyOn(db, "select").mockImplementationOnce(
				() => ({ from: () => ({ where: () => ({ limit: async () => [{ id: "locale-log-test" }] }) }) }) as never,
			);
			const submitted = "private-locale-value@example.test";
			const response =
				transport === "REST"
					? await request("/auth/profile", {
							method: "PATCH",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ locale: submitted }),
						})
					: await handleRpc(
							new Request("http://localhost:3000/api/rpc/auth/updateProfile", {
								method: "POST",
								headers: { "Content-Type": "application/json" },
								body: JSON.stringify({ json: { locale: submitted } }),
							}),
							"127.0.0.1",
						);
			expect(response.status).toBe(400);
			const body = await response.json();
			expect(transport === "RPC" ? body.json : body).toMatchObject({ code: "BAD_REQUEST" });
			expect(console.error).toHaveBeenCalled();
			expect(
				vi
					.mocked(console.error)
					.mock.calls.map((args) => format(...args))
					.join("\n"),
			).not.toContain(submitted);
		},
	);

	it("serves public configuration without authentication and marks it uncacheable", async () => {
		const response = await request("/flags");
		expect(response.status).toBe(200);
		expect(await response.json()).toHaveProperty("disableSignups");
		expect(response.headers.get("Cache-Control")).toBe("no-store");
	});
	it.each(["/resume/getRoot", "/storage/uploadFile", "/storage/deleteFile", "/missing"])(
		"does not expose internal or unknown routes: %s",
		async (path) => {
			const response = await request(path, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: "{}",
			});
			expect(response.status).toBe(404);
			expect(await response.json()).toMatchObject({ code: "NOT_FOUND", status: 404 });
		},
	);
	it.each([
		"/resumes",
		"/applications",
		"/documents",
		"/ai-providers",
		"/agent/threads",
		"/cover-letters",
		"/resumes/private/exports/json",
		"/cover-letters/private/exports/pdf",
	])("rejects unauthenticated private reads: %s", async (path) => {
		const response = await request(path);
		expect(response.status).toBe(401);
		expect(await response.json()).toMatchObject({ code: "UNAUTHORIZED", status: 401 });
	});
	it("decodes multipart public checks and returns structured errors for invalid PDF content", async () => {
		const form = new FormData();
		form.set("file", new File(["not a PDF"], "resume.pdf", { type: "application/pdf" }));
		const response = await request("/pdf-checks", { method: "POST", body: form });
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			code: "BAD_REQUEST",
			message: "Provide a PDF no larger than 25 MB.",
		});
	});
	it("returns the same JSON error envelope for malformed JSON", async () => {
		const response = await request("/resumes", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "{",
		});
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ code: "BAD_REQUEST", status: 400 });
	});
});
