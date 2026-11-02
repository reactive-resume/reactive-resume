import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { JsonPatchError, Operation } from "fast-json-patch";
import jsonpatch from "fast-json-patch";
import z from "zod";
import { parseResumeDataForWrite } from "@reactive-resume/schema/resume/write";

/**
 * A Zod schema that models JSON Patch (RFC 6902) operations as a discriminated union on `op`.
 * This ensures required fields (`value` for add/replace/test, `from` for move/copy) are
 * validated at the request boundary rather than failing later at the `fast-json-patch` layer.
 */
export const jsonPatchOperationSchema = z.discriminatedUnion("op", [
	z.object({ op: z.literal("add"), path: z.string(), value: z.unknown() }),
	z.object({ op: z.literal("remove"), path: z.string() }),
	z.object({ op: z.literal("replace"), path: z.string(), value: z.unknown() }),
	z.object({ op: z.literal("move"), path: z.string(), from: z.string() }),
	z.object({ op: z.literal("copy"), path: z.string(), from: z.string() }),
	z.object({ op: z.literal("test"), path: z.string(), value: z.unknown() }),
]);

export type JsonPatchOperation = z.infer<typeof jsonPatchOperationSchema>;

/**
 * A structured error thrown when a JSON Patch operation fails.
 * Contains only the relevant details -- never the full document tree.
 */
export class ResumePatchError extends Error {
	/** The error code from `fast-json-patch`, e.g. `TEST_OPERATION_FAILED`. */
	code: string;
	/** The zero-based index of the failing operation in the operations array. */
	index: number;
	/** The operation object that caused the failure. */
	operation: Operation;

	constructor(code: string, message: string, index: number, operation: Operation) {
		super(message);
		this.name = "ResumePatchError";
		this.code = code;
		this.index = index;
		this.operation = operation;
	}
}

/**
 * The failure named by its operation and path, e.g. "The replace operation at /basics/nope failed: …". Named by op and
 * path rather than index: fast-json-patch reports index 0 for some failures, whichever operation it was.
 */
export function describeResumePatchError(error: ResumePatchError): string {
	const { op, path } = error.operation;
	return `The ${op} operation at ${path} failed: ${error.message}`;
}

/**
 * Human-readable messages for each `fast-json-patch` error code.
 * These are returned to the API consumer instead of the raw library output.
 */
const patchErrorMessages: Record<string, string> = {
	SEQUENCE_NOT_AN_ARRAY: "Patch sequence must be an array.",
	OPERATION_NOT_AN_OBJECT: "Operation is not an object.",
	OPERATION_OP_INVALID: "Operation `op` property is not one of the operations defined in RFC 6902.",
	OPERATION_PATH_INVALID: "Operation `path` property is not a valid JSON Pointer string.",
	OPERATION_FROM_REQUIRED: "Operation `from` property is required for `move` and `copy` operations.",
	OPERATION_VALUE_REQUIRED: "Operation `value` property is required for `add`, `replace`, and `test` operations.",
	OPERATION_VALUE_CANNOT_CONTAIN_UNDEFINED:
		"Operation `value` contains an `undefined` value, which is not valid in JSON.",
	OPERATION_PATH_CANNOT_ADD: "Cannot perform an `add` operation at the desired path.",
	OPERATION_PATH_UNRESOLVABLE: "Cannot perform the operation at a path that does not exist.",
	OPERATION_FROM_UNRESOLVABLE: "Cannot perform the operation from a path that does not exist.",
	OPERATION_PATH_ILLEGAL_ARRAY_INDEX: "Array index in path must be an unsigned base-10 integer.",
	OPERATION_VALUE_OUT_OF_BOUNDS: "The specified array index is greater than the number of elements in the array.",
	TEST_OPERATION_FAILED: "Test operation failed -- the value at the given path did not match the expected value.",
};

// Only `copy` makes a resume larger than the request carrying the patch. Copying a section into itself a few dozen
// times would otherwise build gigabytes in memory, so copies stop once the document would pass this size.
const MAX_PATCHED_DOCUMENT_CHARS = 10_000_000;

function resolvePointer(document: unknown, pointer: string): unknown {
	try {
		return jsonpatch.getValueByPointer(document, pointer);
	} catch {
		return undefined;
	}
}

/**
 * Checks whether an error is a `JsonPatchError` from `fast-json-patch`.
 * The library doesn't export the class directly, so we duck-type it.
 */
function isJsonPatchError(error: unknown): error is JsonPatchError {
	return error instanceof Error && "index" in error && "operation" in error;
}

/**
 * Converts a `JsonPatchError` into a clean `ResumePatchError` that omits the document tree.
 */
function toResumePatchError(error: JsonPatchError): ResumePatchError {
	const code = error.name;
	const message = patchErrorMessages[code] ?? error.message;
	const index = error.index ?? 0;
	const operation = error.operation as Operation;

	return new ResumePatchError(code, message, index, operation);
}

/**
 * Applies an array of JSON Patch (RFC 6902) operations to a `ResumeData` object.
 *
 * This function validates the operations before applying them, then validates the
 * resulting document against the published write constraints, rejecting invalid
 * values rather than replacing them with read-time defaults.
 *
 * The original `data` object is not mutated; a deep clone is created internally.
 *
 * @see https://docs.rxresu.me/guides/using-the-patch-api - for usage examples and API details.
 * @see https://datatracker.ietf.org/doc/html/rfc6902 - JSON Patch specification.
 *
 * @param data - The current resume data to patch.
 * @param operations - An array of JSON Patch operations to apply.
 * @returns The patched and validated `ResumeData` object.
 * @throws {ResumePatchError} If the operations are structurally invalid or target non-existent paths.
 * @throws {ResumePatchError} If a `test` operation does not match.
 * @throws {Error} If the patched document does not conform to the `ResumeData` schema.
 */
export function applyResumePatches(data: ResumeData, operations: Operation[]): ResumeData {
	// Validate the operations' shape; each is checked against the document as it's applied. (Validating against the
	// document up front would apply the whole patch to a copy, before any size check.)
	const validationError = jsonpatch.validate(operations);
	if (validationError) throw toResumePatchError(validationError);

	// Apply operations one by one; applyOperation throws on invalid paths and `test` failures.
	let patched: ResumeData = jsonpatch.deepClone(data);
	let size = JSON.stringify(data).length;

	for (const [index, operation] of operations.entries()) {
		try {
			if (operation.op === "copy") {
				// An unresolvable `from` is left to applyOperation, which reports it as OPERATION_FROM_UNRESOLVABLE.
				const copied = resolvePointer(patched, operation.from);
				if (copied !== undefined) size += JSON.stringify(copied).length;
				if (size > MAX_PATCHED_DOCUMENT_CHARS) {
					throw new ResumePatchError(
						"PATCH_TOO_LARGE",
						"The patch copies more content than a resume can hold.",
						index,
						operation,
					);
				}
			}
			patched = jsonpatch.applyOperation(patched, operation, true, true, true, index).newDocument;
		} catch (error: unknown) {
			if (error instanceof ResumePatchError) throw error;
			if (isJsonPatchError(error)) throw toResumePatchError(error);
			throw error;
		}
	}

	try {
		return parseResumeDataForWrite(patched);
	} catch (error) {
		throw new Error(`Patch produced invalid resume data: ${error instanceof Error ? error.message : String(error)}`, {
			cause: error,
		});
	}
}
