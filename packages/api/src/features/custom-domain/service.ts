import { randomBytes } from "node:crypto";
import { resolve4, resolve6, resolveCname, resolveTxt } from "node:dns/promises";
import { isIP } from "node:net";
import { ORPCError } from "@orpc/server";
import { and, eq, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";
import { env } from "@reactive-resume/env/server";
import { ownerIsNotBanned } from "../resume/access-policy";

const TXT_PREFIX = "_rx-verify";
const DAY_MS = 24 * 60 * 60 * 1000;
// A verified domain whose DNS stops pointing here keeps working this long, in case the owner is mid-change.
const GRACE_MS = 7 * DAY_MS;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export const isCustomDomainsEnabled = () => Boolean(env.CUSTOM_DOMAIN_TARGET && env.CUSTOM_DOMAIN_PROVIDER_SECRET);

let hosts: ReadonlySet<string> | undefined;
/** The app's own hostnames (APP_URL, APP_ALIAS_URL, the CNAME target): none of them, or anything under them, is a custom domain. */
export const ownHosts = (): ReadonlySet<string> =>
	(hosts ??= new Set(
		[env.APP_URL, env.APP_ALIAS_URL, env.CUSTOM_DOMAIN_TARGET && `https://${env.CUSTOM_DOMAIN_TARGET}`]
			.filter((value): value is string => Boolean(value))
			.map((value) => new URL(value).hostname),
	));

/**
 * A typed domain as the host DNS knows: lowercase ASCII, no scheme, path, port or trailing dot. `null` when it can't be
 * a public domain (an IP address, a single label, the app's own hosts).
 */
export function normalizeHostname(input: string): string | null {
	const value = input.trim();
	let ascii: string;
	try {
		// The URL parser lowercases, converts to punycode and drops the port, path, query and fragment.
		ascii = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`).hostname.replace(/\.$/, "");
	} catch {
		return null;
	}
	if (!ascii || ascii.length > 253 || isIP(ascii)) return null;
	const labels = ascii.split(".");
	if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) return null;
	if (!/^[a-z][a-z0-9-]*$/.test(labels.at(-1) ?? "")) return null;
	for (const own of ownHosts()) if (ascii === own || ascii.endsWith(`.${own}`)) return null;
	return ascii;
}

const lookup = <T>(query: Promise<T[]>) => query.catch(() => [] as T[]);

const txtValue = (token: string) => `rx-verify=${token}`;

export type DnsRecord = { type: "A" | "AAAA" | "CNAME" | "TXT"; name: string; value: string };

/**
 * What to add where the domain's DNS is managed: a TXT record proving ownership, and a CNAME to the target. A root
 * domain can't have a CNAME, so it gets A and AAAA records with the target's addresses instead.
 */
async function connectionRecords(hostname: string, token: string): Promise<DnsRecord[]> {
	const target = env.CUSTOM_DOMAIN_TARGET ?? "";
	const proof: DnsRecord = { type: "TXT", name: `${TXT_PREFIX}.${hostname}`, value: txtValue(token) };
	// ponytail: two labels is a root domain; one under a two-part suffix (example.co.uk) gets the CNAME, and the
	// client's note explains the addresses. A public-suffix list would tell them apart.
	if (hostname.split(".").length === 2) {
		const [v4, v6] = await Promise.all([lookup(resolve4(target)), lookup(resolve6(target))]);
		const addresses = [
			...v4.map((value): DnsRecord => ({ type: "A", name: hostname, value })),
			...v6.map((value): DnsRecord => ({ type: "AAAA", name: hostname, value })),
		];
		if (addresses.length > 0) return [...addresses, proof];
	}
	return [{ type: "CNAME", name: hostname, value: target }, proof];
}

async function toStatus(domain: typeof schema.customDomain.$inferSelect) {
	return {
		hostname: domain.hostname,
		target: env.CUSTOM_DOMAIN_TARGET ?? "",
		txtName: `${TXT_PREFIX}.${domain.hostname}`,
		txtValue: txtValue(domain.verificationToken),
		records: await connectionRecords(domain.hostname, domain.verificationToken),
		verified: domain.verifiedAt !== null,
		lastCheckedAt: domain.lastCheckedAt,
	};
}

const assertEnabled = () => {
	if (!isCustomDomainsEnabled())
		throw new ORPCError("PRECONDITION_FAILED", {
			status: 412,
			message: "Custom domains aren't set up on this server.",
		});
};

/** Whether DNS proves `token`'s account owns `hostname` and points it at this server. */
async function dnsPointsHere(hostname: string, token: string): Promise<boolean> {
	const target = env.CUSTOM_DOMAIN_TARGET;
	if (!target) return false;
	const txt = (await lookup(resolveTxt(`${TXT_PREFIX}.${hostname}`))).map((parts) => parts.join(""));
	if (!txt.includes(txtValue(token))) return false;

	const cnames = (await lookup(resolveCname(hostname))).map((name) => name.toLowerCase().replace(/\.$/, ""));
	if (cnames.includes(target)) return true;
	// A root domain can't have a CNAME: its addresses must be the target's.
	const [own4, own6, target4, target6] = await Promise.all([
		lookup(resolve4(hostname)),
		lookup(resolve6(hostname)),
		lookup(resolve4(target)),
		lookup(resolve6(target)),
	]);
	const targets = new Set([...target4, ...target6]);
	const addresses = [...own4, ...own6];
	return addresses.length > 0 && addresses.every((address) => targets.has(address));
}

export const customDomainService = {
	get: async (userId: string) => {
		assertEnabled();
		const [domain] = await db.select().from(schema.customDomain).where(eq(schema.customDomain.userId, userId));
		return domain ? toStatus(domain) : null;
	},

	/** Claims a domain for the account, replacing its previous one. It works once `verify` sees the DNS records. */
	set: async (userId: string, input: string) => {
		assertEnabled();
		const hostname = normalizeHostname(input);
		if (!hostname)
			throw new ORPCError("INVALID_DOMAIN", { status: 400, message: "Enter a domain such as resume.example.com." });

		const [existing] = await db.select().from(schema.customDomain).where(eq(schema.customDomain.userId, userId));
		if (existing?.hostname === hostname) return toStatus(existing);

		const values = {
			hostname,
			verificationToken: randomBytes(16).toString("hex"),
			verifiedAt: null,
			lastCheckedAt: null,
			failingSince: null,
		};
		const [domain] = await db
			.insert(schema.customDomain)
			.values({ userId, ...values })
			.onConflictDoUpdate({ target: schema.customDomain.userId, set: values })
			.returning();
		if (!domain) throw new ORPCError("INTERNAL_SERVER_ERROR");
		return toStatus(domain);
	},

	/** Checks DNS now. Proof moves the domain from any other account that had it, since DNS shows who owns it today. */
	verify: async (userId: string) => {
		assertEnabled();
		const [domain] = await db.select().from(schema.customDomain).where(eq(schema.customDomain.userId, userId));
		if (!domain) throw new ORPCError("NOT_FOUND");

		const valid = await dnsPointsHere(domain.hostname, domain.verificationToken);
		const now = new Date();
		const updated = await db.transaction(async (tx) => {
			if (valid)
				await tx
					.update(schema.customDomain)
					.set({ verifiedAt: null })
					.where(and(eq(schema.customDomain.hostname, domain.hostname), ne(schema.customDomain.userId, userId)));
			const [row] = await tx
				.update(schema.customDomain)
				.set(
					valid
						? { verifiedAt: domain.verifiedAt ?? now, lastCheckedAt: now, failingSince: null }
						: { lastCheckedAt: now, failingSince: domain.failingSince ?? now },
				)
				.where(eq(schema.customDomain.userId, userId))
				.returning();
			return row;
		});
		if (!updated) throw new ORPCError("NOT_FOUND");
		return toStatus(updated);
	},

	remove: async (userId: string) => {
		assertEnabled();
		await db.delete(schema.customDomain).where(eq(schema.customDomain.userId, userId));
	},
};

/**
 * The resume owner's verified custom domain, as a column of a query on `resume`: where its primary resume lives for
 * search engines. Null when custom domains are off.
 */
export const verifiedDomainColumn = () =>
	isCustomDomainsEnabled()
		? sql<
				string | null
			>`(select ${schema.customDomain.hostname} from ${schema.customDomain} where ${schema.customDomain.userId} = ${schema.resume.userId} and ${schema.customDomain.verifiedAt} is not null)`
		: sql<string | null>`null`;

/** The username whose primary resume a verified custom domain opens: `null` for an unknown host. */
export async function customDomainUsername(hostname: string): Promise<string | null> {
	if (!isCustomDomainsEnabled()) return null;
	const [owner] = await db
		.select({ username: schema.user.username })
		.from(schema.customDomain)
		.innerJoin(schema.user, eq(schema.customDomain.userId, schema.user.id))
		.where(
			and(
				eq(schema.customDomain.hostname, hostname.toLowerCase()),
				isNotNull(schema.customDomain.verifiedAt),
				ownerIsNotBanned(),
			),
		);
	return owner?.username ?? null;
}

/**
 * Traefik's HTTP provider configuration: one router per verified domain, each asking the certificate resolver for its
 * own certificate. Domains not checked for a day are checked again in the background; one failing for a week loses its
 * verification, which takes its router away.
 */
export async function traefikConfiguration(options: { service: string; entryPoint: string; certResolver: string }) {
	const domains = await db
		.select({ userId: schema.customDomain.userId, hostname: schema.customDomain.hostname })
		.from(schema.customDomain)
		.where(isNotNull(schema.customDomain.verifiedAt));

	void recheckStaleDomains().catch((error: unknown) => console.warn("Custom domain re-check failed", error));

	const routers = Object.fromEntries(
		domains.map(({ userId, hostname }) => [
			`custom-domain-${userId}`,
			{
				rule: `Host(\`${hostname}\`)`,
				entryPoints: [options.entryPoint],
				service: options.service,
				tls: { certResolver: options.certResolver },
			},
		]),
	);
	// Traefik rejects an empty map ("routers cannot be a standalone element"), but accepts an empty document.
	return domains.length > 0 ? { http: { routers } } : {};
}

let rechecking = false;

async function recheckStaleDomains() {
	if (rechecking) return;
	rechecking = true;
	try {
		const stale = await db
			.select()
			.from(schema.customDomain)
			.where(
				and(
					isNotNull(schema.customDomain.verifiedAt),
					or(
						isNull(schema.customDomain.lastCheckedAt),
						lt(schema.customDomain.lastCheckedAt, new Date(Date.now() - DAY_MS)),
					),
				),
			)
			.limit(20);
		for (const domain of stale) {
			const now = new Date();
			if (await dnsPointsHere(domain.hostname, domain.verificationToken)) {
				await db
					.update(schema.customDomain)
					.set({ lastCheckedAt: now, failingSince: null })
					.where(eq(schema.customDomain.userId, domain.userId));
				continue;
			}
			const failingSince = domain.failingSince ?? now;
			await db
				.update(schema.customDomain)
				.set({
					lastCheckedAt: now,
					failingSince,
					...(now.getTime() - failingSince.getTime() > GRACE_MS ? { verifiedAt: null } : {}),
				})
				.where(eq(schema.customDomain.userId, domain.userId));
		}
	} finally {
		rechecking = false;
	}
}
