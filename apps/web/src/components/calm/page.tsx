import type { ComponentProps, ReactNode } from "react";
import { cn } from "@reactive-resume/utils/style";

/** Calm page frame (`.page`): 40px side margins from 1024, 32 from 640, 16 on phones; 28px above the header. */
export function Page({ className, ...props }: ComponentProps<"div">) {
	return (
		<div
			data-design="page"
			className={cn("flex min-h-0 flex-1 flex-col px-4 pt-4 sm:px-8 sm:pt-7 lg:px-10", className)}
			{...props}
		/>
	);
}

/** Calm reading width (`.mw`): a dashboard page's content stops at `--content-max`. Tables and boards may pass `max-w-none`. */
export function PageBody({ className, ...props }: ComponentProps<"div">) {
	return <div data-design="mw" className={cn("w-full max-w-(--content-max) pb-12", className)} {...props} />;
}

type RootHeaderProps = Omit<ComponentProps<"header">, "title"> & {
	title: ReactNode;
	/** One quiet line under the title: counts, never instructions. */
	subtitle?: ReactNode;
	/** The page's one accent button, and anything quieter beside it. */
	actions?: ReactNode;
};

/** Calm root header (`.rh`): the 34px serif title of a root page (Today, Documents, Applications, Career). No crumb. */
export function RootHeader({ title, subtitle, actions, className, ...props }: RootHeaderProps) {
	return (
		<>
			<header
				data-design="rh"
				className={cn("flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-2", className)}
				{...props}
			>
				<h1 className="t-root-title">{title}</h1>
				{actions && <div className="flex items-center gap-2">{actions}</div>}
			</header>
			{subtitle && <p className="pt-0.5 text-sm text-ink-3">{subtitle}</p>}
		</>
	);
}

type PageHeaderProps = Omit<ComponentProps<"header">, "title"> & {
	/** A `Crumb` naming the places above this page. */
	crumb?: ReactNode;
	title: ReactNode;
	/** One line of facts under the title ("Senior product designer · Lisbon · Hybrid"). */
	subtitle?: ReactNode;
	actions?: ReactNode;
};

/** Calm page header: path crumb, a 28px serif title with its actions, then one quiet line. For pages below a root. */
export function PageHeader({ crumb, title, subtitle, actions, className, ...props }: PageHeaderProps) {
	return (
		<header className={cn("flex flex-col", className)} {...props}>
			{crumb}
			<div className="flex flex-wrap items-center gap-2">
				<h1 className="min-w-0 flex-1 t-page-title">{title}</h1>
				{actions}
			</div>
			{subtitle && <p className="flex flex-wrap items-center gap-1.5 pt-1 text-sm text-ink-3">{subtitle}</p>}
		</header>
	);
}

type ColumnsProps = ComponentProps<"div"> & {
	/** The 360px column. It follows the main column when the window is narrower than 1280. */
	aside: ReactNode;
};

/** Calm two-column page (`.cols`): main plus a 360px aside, 48px apart; one column under 1280. */
export function Columns({ aside, children, className, ...props }: ColumnsProps) {
	return (
		<div className={cn("grid items-start gap-12 xl:grid-cols-[minmax(0,1fr)_360px]", className)} {...props}>
			<div>{children}</div>
			<aside>{aside}</aside>
		</div>
	);
}
