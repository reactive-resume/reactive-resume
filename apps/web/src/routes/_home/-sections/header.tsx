import { t } from "@lingui/core/macro";
import { ArrowRightIcon, TranslateIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useMotionValueEvent, useScroll } from "motion/react";
import { useState } from "react";
import { BrandIcon } from "@reactive-resume/ui/components/brand-icon";
import { Button } from "@reactive-resume/ui/components/button";
import { GithubStarsButton } from "@/components/input/github-stars-button";
import { LocaleCombobox } from "@/features/locale/combobox";
import { ThemeToggleButton } from "@/features/theme/toggle-button";

export function Header() {
	const [hidden, setHidden] = useState(false);
	const { scrollY } = useScroll();

	useMotionValueEvent(scrollY, "change", (current) => {
		setHidden(current > 32 && current > (scrollY.getPrevious() ?? 0));
	});

	return (
		<header
			data-hidden={hidden}
			className="fade-in animation-duration-300 fixed inset-x-0 top-0 z-50 animate-in border-transparent border-b bg-background/80 backdrop-blur-lg ease-out-strong [transition:translate_250ms_var(--ease-out-strong)] data-[hidden=true]:-translate-y-full"
		>
			<nav aria-label={t`Main navigation`} className="container mx-auto flex items-center gap-x-4 p-3 lg:px-12">
				<Link to="/" className="transition-opacity hover:opacity-80" aria-label={t`Reactive Resume - Go to homepage`}>
					<BrandIcon className="size-10" />
				</Link>

				<div className="ml-auto flex items-center gap-x-2">
					<LocaleCombobox
						render={
							<Button size="icon" variant="ghost" aria-label={t`Change language`}>
								<TranslateIcon />
							</Button>
						}
					/>

					<ThemeToggleButton />

					<div className="hidden items-center gap-x-4 sm:flex">
						<GithubStarsButton />

						<Button
							size="icon"
							nativeButton={false}
							aria-label={t`Go to dashboard`}
							render={
								<Link to="/dashboard">
									<ArrowRightIcon aria-hidden="true" />
								</Link>
							}
						/>
					</div>
				</div>
			</nav>
		</header>
	);
}
