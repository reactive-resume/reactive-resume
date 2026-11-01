// oxlint-disable no-unused-expressions -- these descriptors exist only for Lingui to extract.
import { msg } from "@lingui/core/macro";

// The account emails' text (`packages/email/src/templates/auth-messages.ts`). It's declared here so Lingui extracts it
// into the app's catalogs for translators; `pnpm pdf:translations` copies the translations to the emails, which go out
// in the account's interface language. Keep both lists in step: the generator fails when one of these is missing from
// the catalog. A translation must keep every {placeholder}, or the email falls back to English.
msg`Reset your password`;
msg({ message: "Reset your {appName} password", comment: "Email preview text. appName: Reactive Resume" });
msg({
	message: "We received a request to reset your {appName} password.",
	comment: "Password reset email. appName: Reactive Resume",
});
msg`Resetting signs you out on every device and removes your passkeys, API keys and connected apps. If this was not you, ignore this message and your password will remain unchanged.`;
msg`Create new password`;
msg`For security, only use links from emails sent by Reactive Resume.`;
msg`Verify your email`;
msg({ message: "Verify your email for {appName}", comment: "Email preview text. appName: Reactive Resume" });
msg({
	message: "Thanks for signing up for {appName}. Verify your email address to continue.",
	comment: "Verification email. appName: Reactive Resume",
});
msg`This confirms the address belongs to you, which keeps your account secure.`;
msg`Verify email`;
msg`If you did not create this account, you can safely ignore this email.`;
msg`Approve your email change`;
msg({
	message: "Approve changing your {appName} email address",
	comment: "Email preview text. appName: Reactive Resume",
});
msg`Approve email change`;
msg({
	message: "Someone asked to change your {appName} email from {previousEmail} to {newEmail}.",
	comment: "Email change approval. appName: Reactive Resume; previousEmail and newEmail are email addresses",
});
msg({
	message: "If you approve, we'll send a link to {newEmail} to finish the change.",
	comment: "Email change approval. newEmail is an email address",
});
msg`Approve change`;
msg`If you did not request this change, ignore this email and change your password. The address on the account will not change without your approval.`;
msg`If the button does not work, copy and paste this link into your browser:`;
msg`By the community, for the community.`;
msg({ message: "A passion project by {author}.", comment: "Email footer. author: Amruth Pillai, linked" });
