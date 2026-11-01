// oxlint-disable no-unused-expressions -- these descriptors exist only for Lingui to extract.
import { msg } from "@lingui/core/macro";

// The text the server-rendered web page shows (`packages/pdf/src/html/messages.ts`). It's declared here so Lingui
// extracts it into the app's catalogs for translators; `pnpm pdf:translations` copies the translations to the page.
// Keep both lists in step: the generator fails when one of these is missing from the catalog.
msg`Download PDF`;
msg`Share`;
msg`Link copied`;
msg`Made with Reactive Resume, free and open source`;
msg`This resume is password-protected`;
msg`Enter the password the resume owner shared with you.`;
msg`Password`;
msg`Unlock`;
msg`That password isn't correct. Check it with the resume owner and try again.`;
msg`This resume isn't shared right now.`;
msg`If someone sent you this link, ask them for a new one.`;
msg`Go to Reactive Resume`;
