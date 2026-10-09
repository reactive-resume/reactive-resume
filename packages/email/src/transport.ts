import type { SendMailOptions, Transporter } from "nodemailer";
import type { ReactElement } from "react";
import { createHash } from "node:crypto";
import nodemailer from "nodemailer";
import { render } from "react-email";
import { env } from "@reactive-resume/env/server";

type SendEmailOptions = { to: string; subject: string; react: ReactElement };

let cachedTransport: Transporter | undefined;

const getTransport = () => {
	const { SMTP_HOST: host, SMTP_USER: user, SMTP_PASS: pass, SMTP_FROM: from } = env;
	if (!host || !user || !pass || !from) return;

	cachedTransport ??= nodemailer.createTransport({
		host,
		port: env.SMTP_PORT,
		secure: env.SMTP_SECURE,
		auth: { user, pass },
		connectionTimeout: 10_000,
		greetingTimeout: 10_000,
		socketTimeout: 10_000,
	});

	return cachedTransport;
};

export const sendEmail = async ({ to, subject, react }: SendEmailOptions) => {
	const transport = getTransport();
	if (!transport && process.env.NODE_ENV === "production") {
		console.info("SMTP not configured; skipping email send.", { to, subject });
		return;
	}
	const payload: SendMailOptions = {
		to,
		from: env.SMTP_FROM,
		subject,
		html: await render(react),
		text: await render(react, { plainText: true }),
	};

	if (!transport) {
		console.info("SMTP not configured; skipping email send.", {
			to: payload.to,
			subject: payload.subject,
			text: payload.text,
			html: payload.html,
		});
		return;
	}

	try {
		await transport.sendMail(payload);
	} catch {
		// SMTP errors can contain credentials or authentication links.
		console.error("There was an error sending mail.");
	}
};

type SendCareerNotificationOptions = { to: string; subject: string; text: string; url: string; key: string };

/** Owner-only notifications: missing SMTP never logs personal career content. */
export async function sendCareerNotification({
	to,
	subject,
	text,
	url,
	key,
}: SendCareerNotificationOptions): Promise<boolean> {
	const transport = getTransport();
	if (!transport) return false;
	const link = new URL(url, env.APP_URL);
	if (link.origin !== new URL(env.APP_URL).origin)
		throw new Error("Career notification links must point to this application.");
	try {
		await transport.sendMail({
			to,
			from: env.SMTP_FROM,
			subject,
			text: `${text}\n\n${link.toString()}`,
			messageId: `<career-${createHash("sha256").update(key).digest("hex")}@reactive-resume.local>`,
		});
		return true;
	} catch {
		// SMTP errors can contain recipient addresses, credentials or message fragments.
		throw new Error("Career notification email could not be delivered.");
	}
}
