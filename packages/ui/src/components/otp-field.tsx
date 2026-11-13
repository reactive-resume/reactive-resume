import { OTPField as OTPFieldPrimitive } from "@base-ui/react/otp-field";
import { inputBaseClassName } from "@reactive-resume/ui/components/input";
import { cn } from "@reactive-resume/utils/style";

type OTPFieldProps = OTPFieldPrimitive.Root.Props & {
	/** Each box's accessible name, e.g. "Digit 2 of 6"; pass a translated string. */
	digitLabel?: (position: number, length: number) => string;
};

function OTPField({ className, length, children, digitLabel, ...props }: OTPFieldProps) {
	return (
		<OTPFieldPrimitive.Root
			data-slot="otp-field"
			length={length}
			className={cn("group flex items-center gap-1.5", className)}
			{...props}
		>
			{children ??
				Array.from({ length }, (_, index) => (
					<OTPFieldInput key={index} {...(digitLabel ? { "aria-label": digitLabel(index + 1, length) } : {})} />
				))}
		</OTPFieldPrimitive.Root>
	);
}

function OTPFieldInput({ className, ...props }: OTPFieldPrimitive.Input.Props) {
	return (
		<OTPFieldPrimitive.Input
			data-slot="otp-field-input"
			className={cn(
				inputBaseClassName,
				"size-10 px-0 text-center font-mono group-aria-invalid:border-danger group-aria-invalid:shadow-[0_0_0_3px_var(--danger-soft)] max-sm:size-11",
				className,
			)}
			{...props}
		/>
	);
}

export { OTPField, OTPFieldInput };
