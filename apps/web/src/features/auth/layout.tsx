import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Link, Outlet } from "@tanstack/react-router";
import { BrandIcon } from "@reactive-resume/ui/components/brand-icon";

const paper = "absolute h-[614px] w-[434px] overflow-hidden rounded-paper bg-paper shadow-page";

/**
 * Every sign-in page is the same left half: the logo where the app sidebar has it, one 380px column, one title size.
 * From 1280 the second half shows what the product makes.
 */
export function AuthLayout() {
	return (
		<div className="flex min-h-svh bg-bg">
			<div className="relative flex min-w-0 flex-1 flex-col items-center justify-center py-15">
				<Link
					to="/"
					className="absolute start-5 top-4 flex h-9 items-center gap-2.5 rounded-md px-2 text-[15px] leading-5 font-semibold [view-transition-name:auth-brand]"
				>
					<BrandIcon variant="icon" alt="" className="size-6 shrink-0" />
					Reactive Resume
				</Link>

				<div className="flex w-full max-w-[412px] flex-col px-4">
					<Outlet />
				</div>
			</div>

			<aside className="hidden min-w-0 flex-1 flex-col items-center justify-center border-s border-line bg-sunken xl:flex">
				<div role="img" aria-label={t`Two resumes made with Reactive Resume`} className="relative h-[684px] w-[584px]">
					<div data-design="paper" className={`${paper} start-0 top-0 -rotate-2 rtl:rotate-2`}>
						<img src="/templates/thumb/ditto.webp" alt="" className="size-full object-cover" />
					</div>
					<div data-design="paper" className={`${paper} end-0 bottom-0`}>
						<img src="/templates/thumb/onyx.webp" alt="" className="size-full object-cover" />
					</div>
				</div>
				<p className="mt-9 text-center t-root-title">
					<Trans>Your resume and your job search, in one place.</Trans>
				</p>
				<p className="pt-1.5 text-center text-ink-3 t-small">
					<Trans>Free and open source. Your data stays yours.</Trans>
				</p>
			</aside>
		</div>
	);
}
