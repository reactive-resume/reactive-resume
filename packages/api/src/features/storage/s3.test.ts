import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

vi.mock("@reactive-resume/env/server", () => ({
	env: {
		STORAGE_BACKEND: "s3",
		S3_ACCESS_KEY_ID: "test-access-key",
		S3_SECRET_ACCESS_KEY: "test-secret-key",
		S3_BUCKET: "test-bucket",
		S3_REGION: "us-east-1",
	},
}));

const { getStorageService } = await import("./service");
afterEach(() => vi.restoreAllMocks());

describe("S3 storage migration prerequisites", () => {
	it("bounds a streamed object even when its advertised length is wrong", async () => {
		const cancel = vi.fn();
		vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command) => {
			if (!(command instanceof GetObjectCommand)) throw new Error("Unexpected command");
			return {
				ContentLength: 0,
				Body: {
					transformToWebStream: () =>
						new ReadableStream<Uint8Array>(
							{
								pull(controller) {
									controller.enqueue(new Uint8Array([1, 2, 3, 4]));
								},
								cancel,
							},
							{ highWaterMark: 0 },
						),
					transformToByteArray: async () => new Uint8Array([1, 2, 3, 4]),
				},
			};
		});
		await expect(getStorageService().read("uploads/owner/pictures/file.pdf", { maxBytes: 3 })).rejects.toThrow(
			"byte limit",
		);
		expect(cancel).toHaveBeenCalledOnce();
	});
	it("lists every page so all guest upload references can be migrated", async () => {
		const firstPage = Array.from({ length: 1_000 }, (_, i) => ({ Key: `uploads/guest/pictures/${i}.png` }));
		const send = vi.spyOn(S3Client.prototype, "send");
		send.mockImplementation(async (command) => {
			if (!(command instanceof ListObjectsV2Command)) throw new Error("Unexpected command");
			return command.input.ContinuationToken === "next"
				? { Contents: [{ Key: "uploads/guest/pictures/last.png" }], IsTruncated: false }
				: { Contents: firstPage, IsTruncated: true, NextContinuationToken: "next" };
		});

		const keys = await getStorageService().list("uploads/guest/");
		expect(keys).toHaveLength(1_001);
		expect(keys.at(-1)).toBe("uploads/guest/pictures/last.png");
	});

	it("does not delete uncopied objects that only share a copied filename prefix", async () => {
		const deleted: string[] = [];
		vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command) => {
			if (command instanceof ListObjectsV2Command)
				return {
					Contents: [{ Key: "uploads/guest/pictures/a.png" }, { Key: "uploads/guest/pictures/a.png-uncopied" }],
				};
			if (command instanceof DeleteObjectCommand) {
				deleted.push(command.input.Key ?? "");
				return {};
			}
			throw new Error("Unexpected command");
		});

		await getStorageService().delete("uploads/guest/pictures/a.png");
		expect(deleted).toEqual(["uploads/guest/pictures/a.png"]);
	});
});
