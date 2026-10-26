import type { WebPageMessages } from "./messages";
import type { ResumeWebPage } from "./web-page";
import { isRTL } from "@reactive-resume/utils/locale";
import { escapeAttribute, escapeHtml } from "./to-html";

export { localeFromAcceptLanguage, webPageMessages } from "./messages";
export type { WebPageMessages } from "./messages";

export type WebPageHead = {
	title: string;
	description: string;
	/** The page's one address; search engines are pointed here. */
	canonicalUrl: string;
	indexable: boolean;
	imageUrl?: string | undefined;
	structuredData?: Record<string, unknown> | undefined;
};

export type WebPageDocumentOptions = {
	page: ResumeWebPage;
	head: WebPageHead;
	messages: WebPageMessages;
	/** The PDF's address, when the owner allows downloads. */
	downloadUrl?: string | undefined;
	/** Where the Show contact details button asks; absent when the owner turned the button off. */
	contactUrl?: string | undefined;
	/** Where the footer credit links; absent when the owner turned it off. */
	creditUrl?: string | undefined;
};

/**
 * The desk around the sheet, the floating actions and the footer. Phones pin the actions to the bottom edge, so the
 * page leaves room for them.
 */
const SHELL_CSS = `
html{-webkit-text-size-adjust:100%}
body{margin:0;background:#ececef;color:#111;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
.rr.rr-desk{padding:40px 16px 112px}
.rr-page{box-shadow:0 1px 2px rgb(0 0 0/.06),0 8px 32px rgb(0 0 0/.08)}
.rr-reveal{all:unset;cursor:pointer;text-decoration:underline;text-underline-offset:2px}
.rr-reveal:focus-visible,.rr-actions a:focus-visible,.rr-actions button:focus-visible{outline:2px solid #2563eb;outline-offset:2px}
.rr-revealed{display:inline-flex;flex-wrap:wrap;gap:4px 12px}
.rr-credit{display:block;text-align:center;font-size:13px;color:#6b6b73;margin:24px 0 0;text-decoration:none}
.rr-credit:hover{color:#111;text-decoration:underline}
.rr-actions{position:fixed;right:24px;bottom:24px;display:flex;gap:8px;z-index:10}
.rr-actions a,.rr-actions button{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:8px;height:40px;padding:0 16px;border-radius:999px;font:500 14px/1 system-ui,-apple-system,"Segoe UI",sans-serif;background:#fff;color:#111;box-shadow:0 1px 2px rgb(0 0 0/.08),0 4px 16px rgb(0 0 0/.12)}
.rr-actions .rr-primary{background:#111;color:#fff}
.rr-toast{position:fixed;left:50%;bottom:88px;transform:translateX(-50%);background:#111;color:#fff;font:500 14px system-ui,sans-serif;padding:10px 16px;border-radius:8px;opacity:0;transition:opacity .2s;pointer-events:none}
.rr-toast[data-on]{opacity:1}
@media (max-width:640px){
.rr.rr-desk{padding:0 0 96px}
.rr-page{box-shadow:none}
.rr-actions{left:0;right:0;bottom:0;padding:12px 16px calc(12px + env(safe-area-inset-bottom));background:rgb(255 255 255/.92);backdrop-filter:blur(12px);box-shadow:0 -1px 0 rgb(0 0 0/.08)}
.rr-actions a,.rr-actions button{flex:1;justify-content:center;height:48px;font-size:16px;box-shadow:none;border:1px solid rgb(0 0 0/.12)}
.rr-actions .rr-primary{border-color:#111}
}
@media print{body{background:#fff}.rr.rr-desk{padding:0}.rr-page{box-shadow:none}.rr-actions,.rr-credit,.rr-toast{display:none}}
`;

const MESSAGE_CSS = `
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#ececef;color:#111;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px;box-sizing:border-box}
main{max-width:380px;text-align:center;display:grid;gap:12px}
h1{font-size:24px;line-height:1.25;margin:0;font-weight:600}
p{margin:0;color:#4b4b52;font-size:15px;line-height:1.5}
form{display:grid;gap:12px;margin-top:12px;text-align:start}
label{font-size:14px;font-weight:500}
input{font:inherit;height:44px;padding:0 12px;border:1px solid #c9c9d0;border-radius:8px;background:#fff}
input:focus{outline:2px solid #2563eb;outline-offset:1px}
button{font:inherit;font-weight:600;height:44px;border:0;border-radius:8px;background:#111;color:#fff;cursor:pointer}
.error{color:#b42318;font-size:14px}
`;

/**
 * The page's one script: Share opens the system share sheet or copies the link, and Show contact details fetches the
 * hidden details into place. Its text is fixed, so the server's policy can allow it by hash.
 */
const SCRIPT = `(()=>{const d=document,t=d.querySelector(".rr-toast");const toast=()=>{if(!t)return;t.setAttribute("data-on","");setTimeout(()=>t.removeAttribute("data-on"),1600)};d.querySelector("[data-share]")?.addEventListener("click",async()=>{const url=location.href;if(navigator.share){try{await navigator.share({title:d.title,url})}catch{}return}try{await navigator.clipboard.writeText(url);toast()}catch{}});d.querySelectorAll("[data-reveal]").forEach(b=>b.addEventListener("click",async()=>{b.setAttribute("aria-busy","true");try{const r=await fetch(b.getAttribute("data-reveal"),{credentials:"include"});if(!r.ok)throw 0;const c=await r.json();const s=d.createElement("span");s.className="rr-revealed";const add=(text,href)=>{if(!text)return;const e=d.createElement(href?"a":"span");e.textContent=text;if(href)e.href=href;s.append(e)};add(c.email,c.email&&"mailto:"+c.email);add(c.phone,c.phone&&"tel:"+c.phone.replace(/[^+\\d]/g,""));add(c.location);for(const f of c.customFields||[])add(f.text,/^https?:\\/\\//i.test(f.link)?f.link:"");b.replaceWith(s)}catch{b.removeAttribute("aria-busy")}}))})();`;

/** The Show contact details button, placed where the header lists contact details (or after the header). */
function withContactButton(html: string, contactUrl: string, label: string): string {
	const button = `<button type="button" class="rr-reveal" data-reveal="${escapeAttribute(contactUrl)}">${escapeHtml(label)}</button>`;
	const header = html.indexOf('data-region="header"');
	if (header < 0) return html.replace(/(<div[^>]*class="[^"]*rr-page[^"]*"[^>]*>)/, `$1${button}`);
	// The header region's own closing tag: count nesting from its opening tag.
	const open = html.lastIndexOf("<", header);
	const tag = /^<([a-z0-9]+)/.exec(html.slice(open))?.[1] ?? "div";
	let depth = 0;
	const pattern = new RegExp(`<(/?)${tag}\\b[^>]*>`, "g");
	pattern.lastIndex = open;
	for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
		depth += match[1] ? -1 : 1;
		if (depth === 0) return `${html.slice(0, match.index)}${button}${html.slice(match.index)}`;
	}
	return html;
}

const metaTags = (head: WebPageHead) => {
	const title = escapeAttribute(head.title);
	const description = escapeAttribute(head.description);
	const url = escapeAttribute(head.canonicalUrl);
	const image = head.imageUrl ? escapeAttribute(head.imageUrl) : undefined;
	return [
		`<title>${escapeHtml(head.title)}</title>`,
		`<meta name="description" content="${description}">`,
		`<link rel="canonical" href="${url}">`,
		head.indexable ? "" : `<meta name="robots" content="noindex, follow">`,
		`<meta property="og:type" content="profile">`,
		`<meta property="og:site_name" content="Reactive Resume">`,
		`<meta property="og:title" content="${title}">`,
		`<meta property="og:description" content="${description}">`,
		`<meta property="og:url" content="${url}">`,
		image ? `<meta property="og:image" content="${image}">` : "",
		`<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">`,
		`<meta name="twitter:title" content="${title}">`,
		`<meta name="twitter:description" content="${description}">`,
		image ? `<meta name="twitter:image" content="${image}">` : "",
		head.structuredData
			? `<script type="application/ld+json">${JSON.stringify(head.structuredData).replaceAll("<", "\\u003c")}</script>`
			: "",
	].join("");
};

const shell = (lang: string, dir: string, head: string, css: string, body: string) =>
	`<!doctype html><html lang="${escapeAttribute(lang)}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" href="/favicon.svg" type="image/svg+xml">${head}<style>${css}</style></head><body>${body}</body></html>`;

/** A resume's whole web page, ready to send. */
export function renderWebPageDocument({
	page,
	head,
	messages,
	downloadUrl,
	contactUrl,
	creditUrl,
}: WebPageDocumentOptions): string {
	const sheet = contactUrl ? withContactButton(page.html, contactUrl, messages.showContactDetails) : page.html;
	const download = downloadUrl
		? `<a class="rr-primary" href="${escapeAttribute(downloadUrl)}" download>${escapeHtml(messages.downloadPdf)}</a>`
		: "";
	const body = [
		`<main id="main-content" class="rr rr-desk">${sheet}`,
		creditUrl ? `<a class="rr-credit" href="${escapeAttribute(creditUrl)}">${escapeHtml(messages.credit)}</a>` : "",
		"</main>",
		`<div class="rr-actions">${download}<button type="button" data-share>${escapeHtml(messages.share)}</button></div>`,
		`<div class="rr-toast" role="status" aria-live="polite">${escapeHtml(messages.linkCopied)}</div>`,
		`<script>${SCRIPT}</script>`,
	].join("");
	return shell(page.lang, page.dir, metaTags(head), `${SHELL_CSS}${page.css}`, body);
}

/** The page a password-protected resume shows until the visitor unlocks it. */
export function renderPasswordDocument(options: {
	lang: string;
	dir: "ltr" | "rtl";
	messages: WebPageMessages;
	wrongPassword: boolean;
}): string {
	const { messages } = options;
	const error = options.wrongPassword ? `<p class="error" id="error">${escapeHtml(messages.wrongPassword)}</p>` : "";
	const body = `<main><h1>${escapeHtml(messages.passwordTitle)}</h1><p>${escapeHtml(messages.passwordHint)}</p><form method="post"><label for="password">${escapeHtml(messages.password)}</label><input id="password" name="password" type="password" autocomplete="current-password" minlength="6" maxlength="64" required autofocus${options.wrongPassword ? ' aria-invalid="true" aria-describedby="error"' : ""}>${error}<button type="submit">${escapeHtml(messages.unlock)}</button></form></main>`;
	return shell(
		options.lang,
		options.dir,
		`<title>${escapeHtml(messages.passwordTitle)}</title><meta name="robots" content="noindex, nofollow">`,
		MESSAGE_CSS,
		body,
	);
}

/** Off, unknown or trashed resumes read the same, with nothing about the owner. */
export function renderUnavailableDocument(options: { lang: string; messages: WebPageMessages }): string {
	const { messages } = options;
	return shell(
		options.lang,
		isRTL(options.lang as Parameters<typeof isRTL>[0]) ? "rtl" : "ltr",
		`<title>${escapeHtml(messages.unavailableTitle)}</title><meta name="robots" content="noindex, nofollow">`,
		MESSAGE_CSS,
		`<main><h1>${escapeHtml(messages.unavailableTitle)}</h1><p>${escapeHtml(messages.unavailableHint)}</p></main>`,
	);
}
