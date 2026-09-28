import { describe, expect, it } from "vitest";
import { deploymentEnvironment } from "./deployment";

describe("deployment environment", () => {
	it("preserves Docker defaults and explicit settings", () => {
		expect(
			deploymentEnvironment({ APP_URL: "https://resume.example", DATABASE_URL: "postgresql://db/app" }),
		).toMatchObject({
			APP_URL: "https://resume.example",
			DATABASE_URL: "postgresql://db/app",
			STORAGE_BACKEND: "local",
			DEPLOYMENT_NAMESPACE: "default",
		});
		expect(
			deploymentEnvironment({ S3_ACCESS_KEY_ID: "id", S3_SECRET_ACCESS_KEY: "secret", S3_BUCKET: "bucket" })
				.STORAGE_BACKEND,
		).toBe("s3");
	});
	it("uses stable production origin and isolates preview namespaces", () => {
		const base = {
			VERCEL: "1",
			VERCEL_PROJECT_PRODUCTION_URL: "resume.vercel.app",
			VERCEL_URL: "preview.vercel.app",
			KV_URL: "rediss://redis",
		};
		expect(deploymentEnvironment({ ...base, VERCEL_ENV: "production" })).toMatchObject({
			APP_URL: "https://resume.vercel.app",
			STORAGE_BACKEND: "blob",
			REDIS_URL: "rediss://redis",
			DEPLOYMENT_NAMESPACE: "production",
		});
		expect(deploymentEnvironment({ ...base, VERCEL_ENV: "preview" })).toMatchObject({
			APP_URL: "https://preview.vercel.app",
			DEPLOYMENT_NAMESPACE: "preview.vercel.app",
		});
		expect(
			deploymentEnvironment({ ...base, APP_URL: "https://custom.example", REDIS_URL: "rediss://explicit" }),
		).toMatchObject({ APP_URL: "https://custom.example", REDIS_URL: "rediss://explicit" });
	});
});
