import type { ContactEntities } from "../types";
import { describe, expect, it } from "vite-plus/test";
import { hasProfessionalLink } from "./contact";

const contact = (urls: string[], emails: string[] = ["maya@mayabennett.example.com"]) =>
	({ emails, phones: [], textUrls: urls, annotationUrls: [] }) as unknown as ContactEntities;

describe("hasProfessionalLink", () => {
	it("counts known profiles and personal sites", () => {
		expect(hasProfessionalLink(contact(["https://linkedin.com/in/maya"]))).toBe(true);
		expect(hasProfessionalLink(contact(["https://example.com/portfolio"]))).toBe(true);
		expect(hasProfessionalLink(contact(["HTTPS://portfolio.example.com"]))).toBe(true);
		expect(hasProfessionalLink(contact(["morgan.design"]))).toBe(true);
	});

	it("doesn't count the email's own domain or mail links", () => {
		expect(hasProfessionalLink(contact(["mayabennett.example.com"]))).toBe(false);
		expect(hasProfessionalLink(contact(["mailto:maya@mayabennett.example.com"]))).toBe(false);
		expect(hasProfessionalLink(contact([]))).toBe(false);
	});
});
