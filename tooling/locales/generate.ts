import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { AUTH_EMAIL_SOURCE_MESSAGES } from "@reactive-resume/email/templates/auth-messages";
import { WEB_PAGE_SOURCE_MESSAGES } from "@reactive-resume/pdf/web-page-messages";
import { generateMessageCatalog, generatePresentLabels, generateSectionTitleCatalog } from "./section-titles";

const catalogs = fileURLToPath(new URL("../../apps/web/locales/", import.meta.url));

const titles = await generateSectionTitleCatalog(catalogs);
const titlesOutput = new URL("../../packages/pdf/src/section-title-catalog.json", import.meta.url);
await writeFile(titlesOutput, `${JSON.stringify(titles, null, "\t")}\n`);
console.log(`Updated PDF section titles for ${Object.keys(titles).length} locales.`);

const presentLabels = await generatePresentLabels(catalogs);
const presentOutput = new URL("../../packages/schema/src/resume/present-labels.json", import.meta.url);
await writeFile(presentOutput, `${JSON.stringify(presentLabels, null, "\t")}\n`);
console.log(`Updated "Present" for ${Object.keys(presentLabels).length} locales.`);

// The words a downloaded file is named with ("Lebenslauf", "Anschreiben"), in the document's language.
const fileNameWords = await generateMessageCatalog(catalogs, ["Resume", "Cover letter"]);
const fileNameOutput = new URL("../../packages/utils/src/file-name-words.json", import.meta.url);
await writeFile(fileNameOutput, `${JSON.stringify(fileNameWords, null, "\t")}\n`);
console.log(`Updated file name words for ${Object.keys(fileNameWords).length} locales.`);

const webPage = await generateMessageCatalog(catalogs, WEB_PAGE_SOURCE_MESSAGES);
// English needs no catalog: the page falls back to its source strings.
delete webPage["en-US"];
const webPageOutput = new URL("../../packages/pdf/src/html/web-page-catalog.json", import.meta.url);
await writeFile(webPageOutput, `${JSON.stringify(webPage, null, "\t")}\n`);
console.log(`Updated the web page's interface text for ${Object.keys(webPage).length} locales.`);

const authEmails = await generateMessageCatalog(catalogs, AUTH_EMAIL_SOURCE_MESSAGES);
// English needs no catalog: the emails fall back to their source strings.
delete authEmails["en-US"];
const authEmailsOutput = new URL("../../packages/email/src/templates/auth-catalog.json", import.meta.url);
await writeFile(authEmailsOutput, `${JSON.stringify(authEmails, null, "\t")}\n`);
console.log(`Updated the account emails' text for ${Object.keys(authEmails).length} locales.`);
