import type { IconName } from "@reactive-resume/ui/components/icon";
import { t } from "@lingui/core/macro";

/** The project's own pages, under Settings on desktop and as rows on the phone's Settings root. */
export const getProjectLinks = (): { href: string; label: string; icon: IconName }[] => [
	{ href: "https://docs.rxresu.me", label: t`Docs`, icon: "book-open" },
	{ href: "https://github.com/reactive-resume/reactive-resume", label: t`Source`, icon: "code" },
	{ href: "https://github.com/reactive-resume/reactive-resume/issues", label: t`Report a bug`, icon: "bug" },
	{ href: "https://opencollective.com/reactive-resume/donate", label: t`Donate`, icon: "hand-heart" },
];
