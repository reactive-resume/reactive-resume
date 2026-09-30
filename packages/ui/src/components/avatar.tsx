import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import { cn } from "@reactive-resume/utils/style";

function Avatar({
	className,
	size = "default",
	...props
}: AvatarPrimitive.Root.Props & {
	size?: "default" | "sm" | "lg";
}) {
	return (
		<AvatarPrimitive.Root
			data-slot="avatar"
			data-size={size}
			className={cn(
				"group/avatar relative flex size-8 shrink-0 rounded-full select-none after:absolute after:inset-0 after:rounded-full after:border after:border-line after:mix-blend-darken data-[size=lg]:size-10 data-[size=sm]:size-7 dark:after:mix-blend-lighten",
				className,
			)}
			{...props}
		/>
	);
}

function AvatarImage({ className, ...props }: AvatarPrimitive.Image.Props) {
	return (
		<AvatarPrimitive.Image
			data-slot="avatar-image"
			className={cn(
				"aspect-square size-full rounded-full object-cover transition-opacity duration-quick ease-enter starting:opacity-0",
				className,
			)}
			{...props}
		/>
	);
}

function AvatarFallback({ className, ...props }: AvatarPrimitive.Fallback.Props) {
	return (
		<AvatarPrimitive.Fallback
			data-slot="avatar-fallback"
			className={cn(
				"flex size-full items-center justify-center rounded-full bg-sunken text-xs font-semibold text-ink-2 group-data-[size=sm]/avatar:text-[11px]",
				className,
			)}
			{...props}
		/>
	);
}

export { Avatar, AvatarFallback, AvatarImage };
