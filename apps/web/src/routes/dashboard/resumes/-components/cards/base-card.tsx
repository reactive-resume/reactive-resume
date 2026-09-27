import { Badge } from "@reactive-resume/ui/components/badge";
import { cn } from "@reactive-resume/utils/style";
import { CometCard } from "@/components/animation/comet-card";

type BaseCardProps = React.ComponentProps<"div"> & {
	title: string;
	description: string;
	tags?: string[];
	className?: string;
	children?: React.ReactNode;
};

export function BaseCard({ title, description, tags, className, children, ...props }: BaseCardProps) {
	return (
		<CometCard>
			<div
				{...props}
				className={cn(
					"relative flex aspect-page size-full overflow-hidden rounded-md bg-popover shadow transition-shadow hover:shadow-xl",
					className,
				)}
			>
				{children}

				<div className="absolute inset-x-0 bottom-0 flex w-full flex-col justify-end gap-y-0.5 bg-background/40 px-4 py-3 backdrop-blur-xs">
					<h3 className="truncate font-medium tracking-tight">{title}</h3>
					<p className="truncate text-xs opacity-80">{description}</p>

					<div className={cn("mt-2 hidden flex-wrap items-center gap-1", tags && tags.length > 0 && "flex")}>
						{tags?.map((tag) => (
							<Badge key={tag} variant="secondary">
								{tag}
							</Badge>
						))}
					</div>
				</div>
			</div>
		</CometCard>
	);
}
