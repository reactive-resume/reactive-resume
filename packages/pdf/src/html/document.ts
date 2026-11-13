import type { WebPageMessages } from "./messages";
import type { ResumeWebPage } from "./web-page";
import { resolveFontSource } from "@reactive-resume/fonts/sources";
import { isRTL } from "@reactive-resume/utils/locale";
import { escapeHtml, getInitials } from "@reactive-resume/utils/string";

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
	/** Absent in the editor's preview, which nothing indexes or shares. */
	head?: WebPageHead | undefined;
	messages: WebPageMessages;
	/** Whose resume it is, for the bar that stays in view; taken from the data the page draws, so already redacted. */
	owner?: { name: string; headline?: string | undefined; location?: string | undefined } | undefined;
	/** The PDF's address, when the owner allows downloads. */
	downloadUrl?: string | undefined;
	/** The editable Word file, only when the owner explicitly allows it. */
	wordDownloadUrl?: string | undefined;
	/** Where the footer credit links; absent when the owner turned it off. */
	creditUrl?: string | undefined;
	/** The operator's font mirror, for the interface fonts; the sheet's own faces come with `page`. */
	fontMirrorUrl?: string | undefined;
	/** The owner's own stylesheet, applied after the page's styles so it can override them. */
	css?: string | undefined;
};

/** The owner's stylesheet, kept inside its `<style>` element: no `</style>` can close it early. */
const ownerStylesheet = (css: string | undefined) => (css ? `\n${css.replaceAll("</", "<\\/")}\n` : "");

// The interface fonts, from the catalog the resume fonts come from, so a font mirror serves them too.
const FIGTREE = "https://fonts.gstatic.com/s/figtree/v9/_Xmz-HUzqDCFdgfMsYiV_F7wfS-Bs_";
const FONT_FILES = {
	ui400: ['"Figtree Variable"', 400, `${FIGTREE}d_QF5ewkEU4HTy.ttf`],
	ui500: ['"Figtree Variable"', 500, `${FIGTREE}dNQF5ewkEU4HTy.ttf`],
	ui600: ['"Figtree Variable"', 600, `${FIGTREE}ehR15ewkEU4HTy.ttf`],
	display: [
		'"Instrument Serif"',
		400,
		"https://fonts.gstatic.com/s/instrumentserif/v5/jizBRFtNs2ka5fXjeivQ4LroWlx-2zIZj1bIkNo.ttf",
	],
	mono: [
		'"Geist Mono Variable"',
		500,
		"https://fonts.gstatic.com/s/geistmono/v4/or3yQ6H-1_WfwkMZI_qYPLs1a-t7PU0AbeEPKJ5T7ihaO_CS.ttf",
	],
} as const;

const fontFaces = (fonts: readonly (keyof typeof FONT_FILES)[], fontMirrorUrl: string | undefined) =>
	fonts
		.map((font) => {
			const [family, weight, source] = FONT_FILES[font];
			return `@font-face{font-family:${family};font-weight:${weight};font-style:normal;font-display:swap;src:url("${resolveFontSource(source, fontMirrorUrl)}")}`;
		})
		.join("");

/**
 * The Calm colours, shapes and fonts of the app (`packages/ui/src/styles/globals.css`), written out because these
 * pages load no stylesheet. Dark follows the visitor's system setting.
 */
const TOKENS_CSS = `
:root{--bg:oklch(0.975 0.005 95);--surface:oklch(0.995 0.002 95);--raised:oklch(1 0 0);--sunken:oklch(0.952 0.006 95);--desk:var(--sunken);--line:oklch(0.9 0.006 95);--line-2:oklch(0.82 0.008 95);--control-border:#888680;--ink:oklch(0.22 0.01 95);--ink-2:oklch(0.42 0.01 95);--ink-3:oklch(0.53 0.01 95);--accent:oklch(0.5 0.1 150);--accent-hover:oklch(0.44 0.1 150);--on-accent:oklch(0.99 0.01 150);--accent-soft:oklch(0.94 0.035 150);--accent-text:oklch(0.42 0.1 150);--danger:oklch(0.53 0.17 27);--danger-soft:oklch(0.95 0.03 27);--danger-text:oklch(0.48 0.17 27);--hover:oklch(0.22 0.01 95/0.05);--shadow-2:0 1px 2px oklch(0.2 0.01 95/0.06),0 10px 28px -8px oklch(0.2 0.01 95/0.18);--shadow-page:0 1px 2px oklch(0.2 0.01 95/0.08),0 12px 36px -12px oklch(0.2 0.01 95/0.25);--font-ui:"Figtree Variable",system-ui,-apple-system,"Segoe UI",sans-serif;--font-display:"Instrument Serif",Georgia,serif;--font-mono:"Geist Mono Variable",ui-monospace,monospace}
@media (prefers-color-scheme:dark){:root{--bg:oklch(0.17 0.006 95);--surface:oklch(0.2 0.006 95);--raised:oklch(0.235 0.007 95);--sunken:oklch(0.145 0.006 95);--desk:var(--raised);--line:oklch(0.29 0.007 95);--line-2:oklch(0.4 0.008 95);--control-border:#73726c;--ink:oklch(0.95 0.005 95);--ink-2:oklch(0.79 0.008 95);--ink-3:oklch(0.67 0.008 95);--accent:oklch(0.74 0.12 150);--accent-hover:oklch(0.8 0.12 150);--on-accent:oklch(0.18 0.03 150);--accent-soft:oklch(0.3 0.05 150);--accent-text:oklch(0.82 0.11 150);--danger:oklch(0.62 0.17 27);--danger-soft:oklch(0.3 0.06 27);--danger-text:oklch(0.8 0.11 27);--hover:oklch(1 0 0/0.06);--shadow-2:0 1px 2px oklch(0 0 0/0.4),0 12px 32px -8px oklch(0 0 0/0.55);--shadow-page:0 1px 2px oklch(0 0 0/0.4),0 12px 36px -12px oklch(0 0 0/0.6)}}
html{-webkit-text-size-adjust:100%}
.rr-btn{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px;height:36px;padding:0 14px;border-radius:10px;font:500 14px/20px var(--font-ui);white-space:nowrap;color:var(--ink-2)}
.rr-btn svg{width:18px;height:18px;flex:none}
.rr-btn:hover{background:var(--hover)}
.rr-btn.rr-primary{background:var(--accent);color:var(--on-accent)}
.rr-btn.rr-primary:hover{background:var(--accent-hover)}
.rr-btn.rr-secondary{background:var(--surface);color:var(--ink);box-shadow:inset 0 0 0 1px var(--line-2)}
.rr-btn.rr-secondary:hover{background:var(--sunken)}
.rr-btn.rr-sm{height:28px;padding:0 10px;border-radius:8px;font:500 13px/18px var(--font-ui)}
.rr-btn.rr-lg{height:44px;padding:0 18px;border-radius:12px;font:500 15px/20px var(--font-ui)}
.rr-btn:focus-visible,.rr-credit a:focus-visible,.rr-download-options a:focus-visible,.eye:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
`;

/**
 * The page around the sheet: a bar that says whose resume it is and holds the actions, the sheet on the desk (the
 * paper stays white at night), and the credit in the corner. Below 1280px, where the corner is under the paper, the
 * credit follows the sheet; phones pin the actions to the bottom edge, so the page leaves room for them.
 */
const SHELL_CSS = `
body{margin:0;background:var(--desk);font-family:var(--font-ui)}
.rr-bar{position:sticky;top:0;z-index:10;box-sizing:border-box;height:64px;display:flex;align-items:center;gap:8px;padding:0 20px;background:var(--bg);border-bottom:1px solid var(--line);color:var(--ink)}
.rr-av{width:32px;height:32px;flex:none;display:inline-flex;align-items:center;justify-content:center;border-radius:8px;background:var(--accent-soft);color:var(--accent-text);font:600 12px/16px var(--font-ui)}
.rr-who{display:flex;flex-direction:column;min-width:0;padding:0 4px}
.rr-who strong,.rr-who span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rr-who strong{font:600 15px/20px var(--font-ui)}
.rr-who span{font:400 12px/16px var(--font-ui);color:var(--ink-3)}
.rr-actions{display:flex;align-items:center;gap:8px;margin-inline-start:auto}
.rr-download{position:relative}
.rr-download summary{list-style:none}
.rr-download summary::-webkit-details-marker{display:none}
.rr-download summary svg:last-child{width:16px;height:16px}
.rr-download-options{position:absolute;top:calc(100% + 6px);inset-inline-end:0;display:grid;min-width:180px;padding:4px;background:var(--raised);border-radius:12px;box-shadow:var(--shadow-2),0 0 0 1px var(--line)}
.rr-download-options a{all:unset;box-sizing:border-box;cursor:pointer;display:flex;align-items:center;height:36px;padding:0 10px;border-radius:8px;font:400 14px/20px var(--font-ui);color:var(--ink);white-space:nowrap}
.rr-download-options a:hover{background:var(--hover)}
.rr.rr-desk{box-sizing:border-box;min-height:calc(100vh - 64px);padding:40px 16px 64px;background:var(--desk);color:#111}
.rr-page{border-radius:2px;box-shadow:var(--shadow-page)}
.rr-credit{display:flex;flex-direction:column;align-items:center;gap:10px;padding:0 16px 40px}
.rr-credit>a:first-child{display:flex;align-items:flex-start;gap:8px;border-radius:6px;color:var(--ink-2);text-decoration:none;font:500 12px/16px var(--font-ui)}
.rr-credit>a:first-child:hover{color:var(--ink)}
.rr-credit>a:first-child svg{width:18px;height:18px;flex:none;margin-top:-1px}
.rr-toast{position:fixed;left:50%;bottom:24px;z-index:20;transform:translateX(-50%);background:var(--ink);color:var(--bg);font:500 14px/20px var(--font-ui);padding:10px 16px;border-radius:12px;opacity:0;transition:opacity .2s;pointer-events:none}
.rr-toast[data-on]{opacity:1}
@media (min-width:1280px){.rr-credit{position:fixed;inset-inline-start:20px;bottom:20px;align-items:flex-start;max-width:200px;padding:0}}
@media (max-width:640px){
.rr-bar{height:56px;padding:0 16px}
.rr-bar:not(:has(.rr-av)){display:contents}
.rr.rr-desk{min-height:0;padding:0}
.rr-page{border-radius:0;box-shadow:none}
.rr-credit{padding:24px 16px 96px}
.rr-actions{position:fixed;left:0;right:0;bottom:0;z-index:10;margin:0;padding:12px 16px calc(12px + env(safe-area-inset-bottom));background:var(--bg);border-top:1px solid var(--line)}
.rr-actions>.rr-btn,.rr-download,.rr-download summary{flex:1}
.rr-actions .rr-btn{height:48px;font-size:16px}
.rr-actions>.rr-btn:not(.rr-primary){background:var(--surface);color:var(--ink);box-shadow:inset 0 0 0 1px var(--line-2)}
.rr-download summary{width:100%}
.rr-download-options{top:auto;bottom:calc(100% + 8px);inset-inline:0;min-width:0}
.rr-toast{bottom:88px}
}
@media print{body{background:#fff}.rr.rr-desk{min-height:0;padding:0;background:none}.rr-page{box-shadow:none}.rr-bar,.rr-credit,.rr-toast{display:none}}
`;

/** The password form and the page for a resume that isn't shared: one column in the middle of the window. */
const MESSAGE_CSS = `
:root{color-scheme:light}
@media (prefers-color-scheme:dark){:root{color-scheme:dark}}
body{margin:0;min-height:100vh;min-height:100dvh;display:flex;flex-direction:column;background:var(--bg);color:var(--ink);font:400 15px/24px var(--font-ui)}
main{flex:1;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;padding:min(176px,19.56vh) 20px 40px}
h1,p{margin:0}
h1{font:400 28px/34px var(--font-display)}
form{width:100%;max-width:400px;display:flex;flex-direction:column;gap:20px}
.tile{width:48px;height:48px;display:flex;align-items:center;justify-content:center;border-radius:12px;background:var(--sunken);color:var(--ink-2)}
.tile svg{width:24px;height:24px}
.intro,.field{display:flex;flex-direction:column}
.intro{gap:8px}
.intro p{color:var(--ink-2)}
.field{gap:6px}
label{font:500 13px/18px var(--font-ui);color:var(--ink-2)}
.control{position:relative;display:flex}
input{box-sizing:border-box;width:100%;height:44px;padding:0 12px;padding-inline-end:40px;border:0;border-radius:10px;outline:0;background:var(--raised);box-shadow:inset 0 0 0 1px var(--control-border);color:var(--ink);font:400 14px/20px var(--font-ui)}
input[type=password]{letter-spacing:.2em}
input:focus{box-shadow:inset 0 0 0 1px var(--accent),0 0 0 3px var(--accent-soft)}
input[aria-invalid]{box-shadow:inset 0 0 0 1px var(--danger),0 0 0 3px var(--danger-soft)}
.eye{all:unset;box-sizing:border-box;cursor:pointer;position:absolute;inset-inline-end:6px;top:8px;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:8px;color:var(--ink-3)}
.eye[hidden]{display:none}
.eye:hover{background:var(--hover)}
.eye svg{width:16px;height:16px}
.eye svg+svg,.eye[aria-pressed=true] svg{display:none}
.eye[aria-pressed=true] svg+svg{display:block}
.error{display:flex;align-items:flex-start;gap:4px;font:400 12px/16px var(--font-ui);color:var(--danger-text)}
.error svg{width:14px;height:14px;flex:none;margin-top:1px}
.password-credit{padding:20px;font:500 12px/16px var(--font-ui)}
.password-credit a{display:inline-flex;align-items:center;gap:8px;color:var(--ink-2);text-decoration:none;border-radius:6px}
.password-credit svg{width:18px;height:18px}
.password-credit a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.address{text-align:center;overflow-wrap:anywhere;font:500 12px/18px var(--font-mono);color:var(--ink-3)}
main.state{justify-content:center;padding:40px 20px;text-align:center}
.state>div{display:flex;flex-direction:column;align-items:center;gap:8px;max-width:400px}
.state>div>svg{width:32px;height:32px;color:var(--ink-3)}
.state h1{padding-top:4px;font:400 22px/28px var(--font-display)}
.state p{font:400 14px/20px var(--font-ui);color:var(--ink-2)}
.state .rr-btn{margin-top:10px}
@media (max-width:640px){input{font-size:16px}}
`;

/**
 * The page's one script: Share opens the system share sheet (and says "Share") or copies the link. Its text is
 * fixed, so the server's policy can allow it by hash.
 */
export const WEB_PAGE_SCRIPT = `(()=>{const d=document,t=d.querySelector(".rr-toast"),b=d.querySelector("[data-share]");const toast=()=>{if(!t)return;t.setAttribute("data-on","");setTimeout(()=>t.removeAttribute("data-on"),1600)};if(b&&navigator.share&&b.lastChild)b.lastChild.textContent=b.dataset.share;b?.addEventListener("click",async()=>{const url=location.href;if(navigator.share){try{await navigator.share({title:d.title,url})}catch{}return}try{await navigator.clipboard.writeText(url);toast()}catch{}})})();`;

/** The password page's one script: the eye that shows what was typed. Without it the button stays hidden. */
export const PASSWORD_PAGE_SCRIPT = `(()=>{const b=document.querySelector("[data-eye]"),i=document.getElementById("password");if(!b||!i)return;b.hidden=false;b.addEventListener("click",()=>{const shown=i.type==="password";i.type=shown?"text":"password";b.setAttribute("aria-pressed",String(shown));b.setAttribute("aria-label",shown?b.dataset.hide:b.dataset.show)})})();`;

/** Phosphor's regular icons, as the app draws them. */
const ICON = {
	link: "M 240 88.23 a 54.43 54.43 0 0 1 -16 37 L 189.25 160 a 54.27 54.27 0 0 1 -38.63 16 h -.05 A 54.63 54.63 0 0 1 96 119.84 a 8 8 0 0 1 16 .45 A 38.62 38.62 0 0 0 150.58 160 h 0 a 38.39 38.39 0 0 0 27.31 -11.31 l 34.75 -34.75 a 38.63 38.63 0 0 0 -54.63 -54.63 l -11 11 A 8 8 0 0 1 135.7 59 l 11 -11 A 54.65 54.65 0 0 1 224 48 54.86 54.86 0 0 1 240 88.23 Z M 109 185.66 l -11 11 A 38.41 38.41 0 0 1 70.6 208 h 0 a 38.63 38.63 0 0 1 -27.29 -65.94 L 78 107.31 A 38.63 38.63 0 0 1 144 135.71 a 8 8 0 0 0 16 .45 A 54.86 54.86 0 0 0 144 96 a 54.65 54.65 0 0 0 -77.27 0 L 32 130.75 A 54.62 54.62 0 0 0 70.56 224 h 0 a 54.28 54.28 0 0 0 38.64 -16 l 11 -11 A 8 8 0 0 0 109 185.66 Z",
	downloadSimple:
		"M 224 144 v 64 a 8 8 0 0 1 -8 8 H 40 a 8 8 0 0 1 -8 -8 V 144 a 8 8 0 0 1 16 0 v 56 H 208 V 144 a 8 8 0 0 1 16 0 Z m -101.66 5.66 a 8 8 0 0 0 11.32 0 l 40 -40 a 8 8 0 0 0 -11.32 -11.32 L 136 124.69 V 32 a 8 8 0 0 0 -16 0 v 92.69 L 93.66 98.34 a 8 8 0 0 0 -11.32 11.32 Z",
	lockSimple:
		"M 208 80 H 176 V 56 a 48 48 0 0 0 -96 0 V 80 H 48 A 16 16 0 0 0 32 96 V 208 a 16 16 0 0 0 16 16 H 208 a 16 16 0 0 0 16 -16 V 96 A 16 16 0 0 0 208 80 Z M 96 56 a 32 32 0 0 1 64 0 V 80 H 96 Z M 208 208 H 48 V 96 H 208 V 208 Z",
	eye: "M 247.31 124.76 c -.35 -.79 -8.82 -19.58 -27.65 -38.41 C 194.57 61.26 162.88 48 128 48 S 61.43 61.26 36.34 86.35 C 17.51 105.18 9 124 8.69 124.76 a 8 8 0 0 0 0 6.5 c .35 .79 8.82 19.57 27.65 38.4 C 61.43 194.74 93.12 208 128 208 s 66.57 -13.26 91.66 -38.34 c 18.83 -18.83 27.3 -37.61 27.65 -38.4 A 8 8 0 0 0 247.31 124.76 Z M 128 192 c -30.78 0 -57.67 -11.19 -79.93 -33.25 A 133.47 133.47 0 0 1 25 128 133.33 133.33 0 0 1 48.07 97.25 C 70.33 75.19 97.22 64 128 64 s 57.67 11.19 79.93 33.25 A 133.46 133.46 0 0 1 231.05 128 C 223.84 141.46 192.43 192 128 192 Z m 0 -112 a 48 48 0 1 0 48 48 A 48.05 48.05 0 0 0 128 80 Z m 0 80 a 32 32 0 1 1 32 -32 A 32 32 0 0 1 128 160 Z",
	eyeSlash:
		"M 53.92 34.62 A 8 8 0 1 0 42.08 45.38 L 61.32 66.55 C 25 88.84 9.38 123.2 8.69 124.76 a 8 8 0 0 0 0 6.5 c .35 .79 8.82 19.57 27.65 38.4 C 61.43 194.74 93.12 208 128 208 a 127.11 127.11 0 0 0 52.07 -10.83 l 22 24.21 a 8 8 0 1 0 11.84 -10.76 Z m 47.33 75.84 41.67 45.85 a 32 32 0 0 1 -41.67 -45.85 Z M 128 192 c -30.78 0 -57.67 -11.19 -79.93 -33.25 A 133.16 133.16 0 0 1 25 128 c 4.69 -8.79 19.66 -33.39 47.35 -49.38 l 18 19.75 a 48 48 0 0 0 63.66 70 l 14.73 16.2 A 112 112 0 0 1 128 192 Z m 6 -95.43 a 8 8 0 0 1 3 -15.72 48.16 48.16 0 0 1 38.77 42.64 8 8 0 0 1 -7.22 8.71 6.39 6.39 0 0 1 -.75 0 8 8 0 0 1 -8 -7.26 A 32.09 32.09 0 0 0 134 96.57 Z m 113.28 34.69 c -.42 .94 -10.55 23.37 -33.36 43.8 a 8 8 0 1 1 -10.67 -11.92 A 132.77 132.77 0 0 0 231.05 128 a 133.15 133.15 0 0 0 -23.12 -30.77 C 185.67 75.19 158.78 64 128 64 a 118.37 118.37 0 0 0 -19.36 1.57 A 8 8 0 1 1 106 49.79 134 134 0 0 1 128 48 c 34.88 0 66.57 13.26 91.66 38.35 18.83 18.83 27.3 37.62 27.65 38.41 A 8 8 0 0 1 247.31 131.26 Z",
	linkBreak:
		"M 198.63 57.37 a 32 32 0 0 0 -45.19 -.06 L 141.79 69.52 a 8 8 0 0 1 -11.58 -11 l 11.72 -12.29 a 1.59 1.59 0 0 1 .13 -.13 48 48 0 0 1 67.88 67.88 1.59 1.59 0 0 1 -.13 .13 l -12.29 11.72 a 8 8 0 0 1 -11 -11.58 l 12.21 -11.65 A 32 32 0 0 0 198.63 57.37 Z M 114.21 186.48 l -11.65 12.21 a 32 32 0 0 1 -45.25 -45.25 l 12.21 -11.65 a 8 8 0 0 0 -11 -11.58 L 46.19 141.93 a 1.59 1.59 0 0 0 -.13 .13 48 48 0 0 0 67.88 67.88 1.59 1.59 0 0 0 .13 -.13 l 11.72 -12.29 a 8 8 0 1 0 -11.58 -11 Z M 216 152 H 192 a 8 8 0 0 0 0 16 h 24 a 8 8 0 0 0 0 -16 Z M 40 104 H 64 a 8 8 0 0 0 0 -16 H 40 a 8 8 0 0 0 0 16 Z m 120 80 a 8 8 0 0 0 -8 8 v 24 a 8 8 0 0 0 16 0 V 192 A 8 8 0 0 0 160 184 Z M 96 72 a 8 8 0 0 0 8 -8 V 40 a 8 8 0 0 0 -16 0 V 64 A 8 8 0 0 0 96 72 Z",
	warningCircle:
		"M 128 24 A 104 104 0 1 0 232 128 104.11 104.11 0 0 0 128 24 Z m 0 192 a 88 88 0 1 1 88 -88 A 88.1 88.1 0 0 1 128 216 Z m -8 -80 V 80 a 8 8 0 0 1 16 0 v 56 a 8 8 0 0 1 -16 0 Z m 20 36 a 12 12 0 1 1 -12 -12 A 12 12 0 0 1 140 172 Z",
	caretDown:
		"M 213.66 101.66 l -80 80 a 8 8 0 0 1 -11.32 0 l -80 -80 A 8 8 0 0 1 53.66 90.34 L 128 164.69 l 74.34 -74.35 a 8 8 0 0 1 11.32 11.32 Z",
};

const icon = (path: string) =>
	`<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" focusable="false"><path d="${path}"/></svg>`;

/** The Reactive Resume mark, drawn in the credit's colour. */
const LOGO =
	'<svg viewBox="0 0 256 256" aria-hidden="true" focusable="false"><path fill="currentColor" fill-rule="evenodd" d="M173.611 166.311L132.877 219.804H173.524L193.973 191.813L213.183 219.804H256L215.673 165.707L215.15 165.046L207.461 155.332L195.329 140.004L195.258 139.915L193.813 138.089L193.923 138.001L176.286 112.861H134.061L173.611 166.311ZM199.89 133.554L214.959 112.861H254.619L219.874 158.8L199.89 133.554Z"/><path fill="currentColor" fill-rule="evenodd" d="M0 36.1959V174.314H39.0678V137.614H60.3938L60.4323 137.671C60.8436 137.653 61.2517 137.634 61.6567 137.614C75.0665 136.968 85.1471 135.549 96.385 131.385C96.7596 131.246 97.1355 131.104 97.5128 130.959L97.4591 130.881C105.816 126.86 112.331 121.344 117.006 114.331C122.005 106.702 124.504 97.6915 124.504 87.2997C124.504 76.7764 122.005 67.7 117.006 60.0706C112.007 52.3097 104.904 46.3903 95.6964 42.3125C86.62 38.2347 75.7679 36.1959 63.1399 36.1959H0ZM102.156 137.725L64.8705 144.175L85.4361 174.314H127.266L102.156 137.725ZM39.0678 107.426H60.7721C68.9277 107.426 74.9786 105.65 78.9248 102.098C83.0026 98.5465 85.0415 93.6137 85.0415 87.2997C85.0415 80.8542 83.0026 75.8556 78.9248 72.304C74.9786 68.7523 68.9277 66.9765 60.7721 66.9765H39.0678V107.426Z"/></svg>';

/** OpenGraph and Twitter card tags, for the web pages and the app's own pages. Every value must already be HTML-escaped. */
export function socialMetaTags(tags: {
	type: string;
	title: string;
	description: string;
	url: string;
	image?: string | undefined;
}) {
	return [
		`<meta property="og:type" content="${tags.type}">`,
		`<meta property="og:site_name" content="Reactive Resume">`,
		`<meta property="og:title" content="${tags.title}">`,
		`<meta property="og:description" content="${tags.description}">`,
		`<meta property="og:url" content="${tags.url}">`,
		tags.image ? `<meta property="og:image" content="${tags.image}">` : "",
		`<meta name="twitter:card" content="${tags.image ? "summary_large_image" : "summary"}">`,
		`<meta name="twitter:title" content="${tags.title}">`,
		`<meta name="twitter:description" content="${tags.description}">`,
		tags.image ? `<meta name="twitter:image" content="${tags.image}">` : "",
	].join("");
}

/** Structured data for search engines, safe inside a `<script>`. */
export const jsonLdScript = (data: unknown) =>
	`<script type="application/ld+json">${JSON.stringify(data).replaceAll("<", "\\u003c")}</script>`;

const metaTags = (head: WebPageHead | undefined) => {
	if (!head) return "";
	const title = escapeHtml(head.title);
	const description = escapeHtml(head.description);
	const url = escapeHtml(head.canonicalUrl);
	return [
		`<title>${title}</title>`,
		`<meta name="description" content="${description}">`,
		`<link rel="canonical" href="${url}">`,
		head.indexable ? "" : `<meta name="robots" content="noindex, follow">`,
		socialMetaTags({
			type: "profile",
			title,
			description,
			url,
			image: head.imageUrl ? escapeHtml(head.imageUrl) : undefined,
		}),
		head.structuredData ? jsonLdScript(head.structuredData) : "",
	].join("");
};

const shell = (lang: string, head: string, css: string, body: string) =>
	`<!doctype html><html lang="${escapeHtml(lang)}" dir="${isRTL(lang) ? "rtl" : "ltr"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" href="/favicon.svg" type="image/svg+xml">${head}<style>${css}</style></head><body>${body}</body></html>`;

/** A resume's whole web page, ready to send. */
export function renderWebPageDocument({
	page,
	head,
	messages,
	owner,
	downloadUrl,
	wordDownloadUrl,
	creditUrl,
	fontMirrorUrl,
	css,
}: WebPageDocumentOptions): string {
	const pdf = downloadUrl
		? `<a href="${escapeHtml(downloadUrl)}" download>${escapeHtml(messages.downloadPdf)}</a>`
		: "";
	const download = wordDownloadUrl
		? `<details class="rr-download"><summary class="rr-btn rr-primary">${icon(ICON.downloadSimple)}${escapeHtml(messages.download)}${icon(ICON.caretDown)}</summary><div class="rr-download-options">${pdf}<a href="${escapeHtml(wordDownloadUrl)}" download>${escapeHtml(messages.downloadWord)}</a></div></details>`
		: downloadUrl
			? `<a class="rr-btn rr-primary" href="${escapeHtml(downloadUrl)}" download>${icon(ICON.downloadSimple)}${escapeHtml(messages.downloadPdf)}</a>`
			: "";
	const about = [owner?.headline, owner?.location].filter(Boolean).join(" · ");
	// The sheet's name is the page's heading, so the bar repeats it as plain text.
	const who = owner?.name
		? `<span class="rr-av" aria-hidden="true">${escapeHtml(getInitials(owner.name))}</span><div class="rr-who"><strong>${escapeHtml(owner.name)}</strong>${about ? `<span>${escapeHtml(about)}</span>` : ""}</div>`
		: "";
	const body = [
		`<header class="rr-bar" data-design="ebar">${who}<div class="rr-actions"><button type="button" class="rr-btn" data-share="${escapeHtml(messages.share)}">${icon(ICON.link)}${escapeHtml(messages.copyLink)}</button>${download}</div></header>`,
		`<main id="main-content" class="rr rr-desk" data-design="canvas">${page.html}</main>`,
		creditUrl
			? `<footer class="rr-credit"><a href="${escapeHtml(creditUrl)}">${LOGO}${escapeHtml(messages.credit)}</a><a class="rr-btn rr-secondary rr-sm" href="${escapeHtml(new URL("/auth/register", creditUrl).href)}">${escapeHtml(messages.buildResume)}</a></footer>`
			: "",
		`<div class="rr-toast" role="status" aria-live="polite">${escapeHtml(messages.linkCopied)}</div>`,
		`<script>${WEB_PAGE_SCRIPT}</script>`,
	].join("");
	return shell(
		page.lang,
		metaTags(head),
		`${fontFaces(["ui400", "ui500", "ui600"], fontMirrorUrl)}${TOKENS_CSS}${SHELL_CSS}${page.css}${ownerStylesheet(css)}`,
		body,
	);
}

/** The page a password-protected resume shows until the visitor unlocks it. Nothing about the owner shows. */
export function renderPasswordDocument(options: {
	lang: string;
	/** App origin for the credit; absent when credit is hidden. */
	creditUrl?: string | undefined;
	messages: WebPageMessages;
	wrongPassword: boolean;
	/** The page's address without its scheme, so the visitor can check the link. */
	address?: string | undefined;
	fontMirrorUrl?: string | undefined;
}): string {
	const { messages } = options;
	const error = options.wrongPassword
		? `<p class="error" id="error">${icon(ICON.warningCircle)}<span>${escapeHtml(messages.wrongPassword)}</span></p>`
		: "";
	const eye = `<button type="button" class="eye" data-eye hidden aria-pressed="false" aria-label="${escapeHtml(messages.showPassword)}" data-show="${escapeHtml(messages.showPassword)}" data-hide="${escapeHtml(messages.hidePassword)}">${icon(ICON.eye)}${icon(ICON.eyeSlash)}</button>`;
	const address = options.address ? `<p class="address">${escapeHtml(options.address)}</p>` : "";
	const credit = options.creditUrl
		? `<footer class="password-credit"><a href="${escapeHtml(options.creditUrl)}">${LOGO}${escapeHtml(messages.credit)}</a></footer>`
		: "";
	const body = `<main><form method="post"><span class="tile">${icon(ICON.lockSimple)}</span><div class="intro"><h1>${escapeHtml(messages.passwordTitle)}</h1><p>${escapeHtml(messages.passwordHint)}</p></div><div class="field"><label for="password">${escapeHtml(messages.password)}</label><div class="control"><input id="password" name="password" type="password" autocomplete="current-password" minlength="6" maxlength="64" required autofocus${options.wrongPassword ? ' aria-invalid="true" aria-describedby="error"' : ""}>${eye}</div>${error}</div><button type="submit" class="rr-btn rr-primary rr-lg">${escapeHtml(messages.unlock)}</button>${address}</form></main>${credit}<script>${PASSWORD_PAGE_SCRIPT}</script>`;
	return shell(
		options.lang,
		`<title>${escapeHtml(messages.passwordTitle)}</title><meta name="robots" content="noindex, nofollow">`,
		`${fontFaces(["ui400", "ui500", "display", "mono"], options.fontMirrorUrl)}${TOKENS_CSS}${MESSAGE_CSS}`,
		body,
	);
}

/**
 * Off, unknown or trashed resumes read the same, with nothing about the owner. A link to the app's home (`homeUrl`)
 * gives a visitor who guessed the address somewhere to go.
 */
export function renderUnavailableDocument(options: {
	lang: string;
	messages: WebPageMessages;
	homeUrl: string;
	/** Set when the viewer owns the unpublished resume: they're told so and sent to its Share panel. */
	shareUrl?: string | undefined;
	fontMirrorUrl?: string | undefined;
}): string {
	const { messages, shareUrl } = options;
	const hint = shareUrl ? messages.ownerUnavailableHint : messages.unavailableHint;
	const action = shareUrl
		? `<a class="rr-btn rr-primary" href="${escapeHtml(shareUrl)}">${escapeHtml(messages.ownerPublish)}</a>`
		: `<a class="rr-btn rr-secondary" href="${escapeHtml(options.homeUrl)}">${escapeHtml(messages.home)}</a>`;
	return shell(
		options.lang,
		`<title>${escapeHtml(messages.unavailableTitle)}</title><meta name="robots" content="noindex, nofollow">`,
		`${fontFaces(["ui400", "ui500", "display"], options.fontMirrorUrl)}${TOKENS_CSS}${MESSAGE_CSS}`,
		`<main class="state"><div>${icon(shareUrl ? ICON.eyeSlash : ICON.linkBreak)}<h1>${escapeHtml(messages.unavailableTitle)}</h1><p>${escapeHtml(hint)}</p>${action}</div></main>`,
	);
}
