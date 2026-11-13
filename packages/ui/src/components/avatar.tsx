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
				"group/avatar relative flex size-8 shrink-0 overflow-hidden rounded-sm select-none data-[size=lg]:size-10 data-[size=lg]:rounded-md data-[size=sm]:size-7",
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
				"aspect-square size-full object-cover transition-opacity duration-quick ease-enter starting:opacity-0",
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
				"flex size-full items-center justify-center bg-accent-soft text-xs leading-4 font-semibold text-accent-text group-data-[size=lg]/avatar:text-sm",
				className,
			)}
			{...props}
		/>
	);
}

export { Avatar, AvatarFallback, AvatarImage };
