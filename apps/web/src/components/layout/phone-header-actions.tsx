import type { ReactNode } from "react";
import { useLingui } from "@lingui/react/macro";
import { Link, useRouteContext } from "@tanstack/react-router";
import { Avatar, AvatarFallback, AvatarImage } from "@reactive-resume/ui/components/avatar";
import { Icon } from "@reactive-resume/ui/components/icon";
import { getInitials } from "@reactive-resume/utils/string";
import { cn } from "@reactive-resume/utils/style";
import { useCommandPaletteStore } from "@/features/command-palette/store";

type PhoneHeaderActionsProps = {
	className?: string;
	/** Page action between search and account, preserving visual and keyboard order. */
	children?: ReactNode;
	/** The shell's own copy, shown only while the page hasn't placed one in its header. */
	fallback?: boolean;
};

/**
 * Phones have no sidebar, so search and the account sit at the end of each page's header (board M1). Place this last
 * in the header's actions; it shows under 640px only. A page that hasn't placed it gets the shell's copy above its
 * content instead.
 */
export function PhoneHeaderActions({ className, fallback = false, children }: PhoneHeaderActionsProps) {
	const { t } = useLingui();
	const { session } = useRouteContext({ strict: false });
	const openPalette = useCommandPaletteStore((state) => state.setOpen);

	return (
		<div
			data-phone-header-actions={fallback ? "fallback" : "page"}
			className={cn("-me-2.5 flex items-center sm:hidden", className)}
		>
			<button
				type="button"
				aria-label={t`Search or jump to…`}
				onClick={() => openPalette(true)}
				className="grid size-11 place-items-center rounded-md text-ink-2 transition-colors active:bg-press"
			>
				<Icon name="magnifying-glass" size={24} />
			</button>
			{children}
			<Link
				to="/dashboard/settings"
				aria-label={t`Settings`}
				className="grid size-11 place-items-center rounded-md transition-colors active:bg-press"
			>
				<Avatar className="after:hidden">
					<AvatarImage src={session?.user.image ?? undefined} alt="" />
					<AvatarFallback className="bg-accent-soft text-accent-text">
						{getInitials(session?.user.name ?? "")}
					</AvatarFallback>
				</Avatar>
			</Link>
		</div>
	);
}
