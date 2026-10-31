import { Link, Outlet } from "@tanstack/react-router";
import { BrandIcon } from "@reactive-resume/ui/components/brand-icon";
import { LandingBackground } from "@/features/homepage/background";

/** The homepage's desk (grain and window light, without its scroll scenes) with the logomark leading back home. */
export function AuthLayout() {
	return (
		<div className="relative isolate min-h-svh">
			<LandingBackground />

			<div className="xs:px-0 relative mx-auto flex min-h-svh w-full max-w-sm flex-col justify-center gap-y-6 px-4 py-8">
				<Link to="/" className="mb-3 self-center rounded-sm p-1 transition-opacity hover:opacity-80">
					{/* The visible image's alt text, "Reactive Resume", names the link. */}
					<BrandIcon variant="icon" className="size-10 [view-transition-name:auth-brand]" />
				</Link>

				<Outlet />
			</div>
		</div>
	);
}
