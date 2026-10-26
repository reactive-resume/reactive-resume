import z from "zod";
import { protectedProcedure } from "../../context";
import { accountRateLimit } from "../../middleware/rate-limit";
import { customDomainService } from "./service";

const route = { tags: ["Custom Domain"] };
const errors = {
	PRECONDITION_FAILED: { status: 412, message: "Custom domains aren't set up on this server." },
};

const status = z.object({
	hostname: z.string().describe("The domain, as DNS knows it (lowercase ASCII)."),
	target: z.string().describe("The host the domain's CNAME record points at."),
	txtName: z.string().describe("Where the TXT record that proves ownership goes."),
	txtValue: z.string().describe("The TXT record's value."),
	verified: z.boolean().describe("Whether DNS proved ownership and the domain opens the primary resume."),
	lastCheckedAt: z.date().nullable().describe("When DNS was last checked."),
});

export const customDomainRouter = {
	get: protectedProcedure
		.route({
			...route,
			method: "GET",
			path: "/custom-domain",
			operationId: "getCustomDomain",
			summary: "Get the custom domain",
			description:
				"Returns the account's custom domain, the DNS records that connect it, and whether it's verified. A verified domain opens the account's primary resume. Null when none is set. Requires authentication.",
		})
		.input(z.object({}).optional())
		.errors(errors)
		.output(status.nullable())
		.handler(({ context }) => customDomainService.get(context.user.id)),

	set: protectedProcedure
		.route({
			...route,
			method: "PUT",
			path: "/custom-domain",
			operationId: "setCustomDomain",
			summary: "Set the custom domain",
			description:
				"Sets the account's custom domain, replacing any previous one, and returns the DNS records to add: a TXT record that proves ownership, and a CNAME (or, for a root domain, addresses) pointing at this server. Requires authentication.",
		})
		.input(z.object({ hostname: z.string().max(260).describe("A domain such as resume.example.com.") }))
		.use(accountRateLimit)
		.errors({ ...errors, INVALID_DOMAIN: { status: 400, message: "Enter a domain such as resume.example.com." } })
		.output(status)
		.handler(({ context, input }) => customDomainService.set(context.user.id, input.hostname)),

	verify: protectedProcedure
		.route({
			...route,
			method: "POST",
			path: "/custom-domain/verify",
			operationId: "verifyCustomDomain",
			summary: "Check the custom domain's DNS",
			description:
				"Checks the custom domain's DNS records now. When they're right, the domain is verified and opens the primary resume, moving it from any other account that had it. Requires authentication.",
		})
		.input(z.object({}).optional())
		.use(accountRateLimit)
		.errors(errors)
		.output(status)
		.handler(({ context }) => customDomainService.verify(context.user.id)),

	remove: protectedProcedure
		.route({
			...route,
			method: "DELETE",
			path: "/custom-domain",
			operationId: "removeCustomDomain",
			summary: "Remove the custom domain",
			description: "Removes the account's custom domain; it stops opening the primary resume. Requires authentication.",
		})
		.input(z.object({}).optional())
		.errors(errors)
		.output(z.void())
		.handler(({ context }) => customDomainService.remove(context.user.id)),
};
