import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { ORPCError } from "@orpc/client";
import { env } from "@reactive-resume/env/server";

const CIPHER = "aes-256-gcm";
const CREDENTIAL_VERSION = "v1";
const IV_BYTES = 12;
const SALT_BYTES = 16;

type StoredCredentialFields = {
	encryptedApiKey: string;
	apiKeySalt: string;
	apiKeyHash: string;
	apiKeyPreview: string;
};

function getEncryptionSecret() {
	return env.ENCRYPTION_SECRET?.trim() ?? "";
}

function getEncryptionKey() {
	const secret = getEncryptionSecret();
	if (!secret) throw new Error("AI_CREDENTIAL_ENCRYPTION_UNAVAILABLE");

	return createHash("sha256").update(secret).digest();
}

function encode(value: Buffer) {
	return value.toString("base64url");
}

function decode(value: string) {
	return Buffer.from(value, "base64url");
}

function makePreview(apiKey: string) {
	const trimmed = apiKey.trim();
	if (trimmed.length <= 8) return "••••";

	return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

function fingerprintCredential(apiKey: string, salt: string) {
	return createHash("sha256").update(salt).update(":").update(apiKey).digest("hex");
}

export function encryptCredential(apiKey: string): StoredCredentialFields {
	const iv = randomBytes(IV_BYTES);
	const salt = encode(randomBytes(SALT_BYTES));
	const cipher = createCipheriv(CIPHER, getEncryptionKey(), iv);

	const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
	const authTag = cipher.getAuthTag();
	const payload = [CREDENTIAL_VERSION, encode(iv), encode(authTag), encode(ciphertext)].join(".");

	return {
		encryptedApiKey: payload,
		apiKeySalt: salt,
		apiKeyHash: fingerprintCredential(apiKey, salt),
		apiKeyPreview: makePreview(apiKey),
	};
}

export function decryptCredential(payload: string) {
	const [version, encodedIv, encodedAuthTag, encodedCiphertext] = payload.split(".");
	if (version !== CREDENTIAL_VERSION || !encodedIv || !encodedAuthTag || encodedCiphertext === undefined) {
		throw new Error("INVALID_ENCRYPTED_CREDENTIAL");
	}

	const key = getEncryptionKey();
	try {
		const decipher = createDecipheriv(CIPHER, key, decode(encodedIv));
		decipher.setAuthTag(decode(encodedAuthTag));
		return Buffer.concat([decipher.update(decode(encodedCiphertext)), decipher.final()]).toString("utf8");
	} catch {
		throw new ORPCError("AI_CREDENTIAL_DECRYPTION_FAILED", {
			status: 412,
			message: "The saved provider key can't be decrypted. Enter the key again in Settings → AI & developer.",
		});
	}
}

function isCredentialEncryptionConfigured() {
	return !!getEncryptionSecret();
}

export function assertCredentialEncryptionConfigured() {
	if (!isCredentialEncryptionConfigured()) throw new Error("AI_CREDENTIAL_ENCRYPTION_UNAVAILABLE");
}

// Personal keys need ENCRYPTION_SECRET; server AI uses environment credentials. Redis is optional: replies survive a reload
// and Stop reaches a run on another server; without it, both work within one server.
export function assertAgentEnvironment() {
	if (!isCredentialEncryptionConfigured() && !env.AI_PROVIDER) throw new Error("AGENT_ENVIRONMENT_UNAVAILABLE");
}
