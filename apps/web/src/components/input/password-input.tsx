import { t } from "@lingui/core/macro";
import { useToggle } from "usehooks-ts";
import { Icon } from "@reactive-resume/ui/components/icon";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
} from "@reactive-resume/ui/components/input-group";

type PasswordInputProps = Omit<React.ComponentProps<"input">, "type">;

/** A password field with its show/hide button inside, so it lines up with the fields above it. */
export function PasswordInput(props: PasswordInputProps) {
	const [visible, toggleVisible] = useToggle(false);

	return (
		<InputGroup>
			<InputGroupInput {...props} type={visible ? "text" : "password"} />
			<InputGroupAddon align="inline-end">
				<InputGroupButton
					size="icon-xs"
					onClick={toggleVisible}
					aria-pressed={visible}
					aria-label={
						visible
							? t({
									comment: "Accessible label for button that hides a visible password",
									message: "Hide password",
								})
							: t({
									comment: "Accessible label for button that reveals a masked password",
									message: "Show password",
								})
					}
				>
					<Icon name={visible ? "eye" : "eye-slash"} size={18} />
				</InputGroupButton>
			</InputGroupAddon>
		</InputGroup>
	);
}
