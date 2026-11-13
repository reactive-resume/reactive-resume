import type { Website } from "@reactive-resume/schema/resume/data";
import { t } from "@lingui/core/macro";
import { Icon } from "@reactive-resume/ui/components/icon";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	InputGroupText,
} from "@reactive-resume/ui/components/input-group";
import { cn } from "@reactive-resume/utils/style";

const DEFAULT_PREFIX = "https://";
const HTTP_PREFIX = /^https?:\/\//i;

function stripPrefix(url: string) {
	return url.replace(HTTP_PREFIX, "");
}

function ensurePrefix(url: string, prefix: string) {
	if (url === "") return "";
	return HTTP_PREFIX.test(url) ? url : prefix + url;
}

type Props<TValue extends Website = Website> = Omit<React.ComponentProps<"input">, "value" | "onChange"> & {
	value: TValue;
	onChange: (value: TValue) => void;
	hideLabelButton?: boolean;
};

export function URLInput<TValue extends Website>({ value, onChange, hideLabelButton, ...props }: Props<TValue>) {
	const prefix = value.url.match(HTTP_PREFIX)?.[0] ?? DEFAULT_PREFIX;
	const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		onChange({
			...value,
			url: ensurePrefix(e.target.value, prefix),
		});
	};

	const handleLabelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		onChange({ ...value, label: e.target.value });
	};

	const urlValue = stripPrefix(value.url);

	return (
		<div
			className="grid min-w-0 grid-cols-[minmax(0,1fr)_112px] gap-2"
			style={hideLabelButton ? { gridTemplateColumns: "minmax(0,1fr)" } : undefined}
		>
			<InputGroup dir="ltr">
				<InputGroupAddon align="inline-start">
					<InputGroupText>{prefix}</InputGroupText>
				</InputGroupAddon>
				<InputGroupInput
					dir="ltr"
					aria-label={t`Web address`}
					value={urlValue}
					onChange={handleUrlChange}
					{...props}
					className={cn(props.className, "ps-0!")}
				/>
			</InputGroup>
			{!hideLabelButton && (
				<InputGroup>
					<InputGroupAddon align="inline-start">
						<Icon name="tag" size={18} />
					</InputGroupAddon>
					<InputGroupInput
						aria-label={t`Link label`}
						dir="auto"
						placeholder={t`Label`}
						value={value.label}
						onChange={handleLabelChange}
					/>
				</InputGroup>
			)}
		</div>
	);
}
