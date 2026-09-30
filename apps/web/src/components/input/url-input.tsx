import type { Website } from "@reactive-resume/schema/resume/data";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
	InputGroupText,
} from "@reactive-resume/ui/components/input-group";
import { Label } from "@reactive-resume/ui/components/label";
import { Popover, PopoverContent, PopoverTrigger } from "@reactive-resume/ui/components/popover";
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
		<InputGroup>
			<InputGroupAddon align="inline-start">
				<InputGroupText>{prefix}</InputGroupText>
			</InputGroupAddon>

			<InputGroupInput
				value={urlValue}
				className={cn(props.className, "ps-0!")}
				onChange={handleUrlChange}
				{...props}
			/>

			{!hideLabelButton && (
				<InputGroupAddon align="inline-end">
					<Popover>
						<PopoverTrigger
							render={
								<InputGroupButton
									size="icon-sm"
									title={t({
										comment: "Tooltip for action button that opens URL label editor",
										message: "Add a label to the URL",
									})}
								>
									<Icon name="sell" size={16} />
								</InputGroupButton>
							}
						/>

						<PopoverContent className="pt-3">
							{/** oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- for stopPropagation */}
							<div role="presentation" className="grid gap-2" onMouseDown={(e) => e.stopPropagation()}>
								<Label htmlFor="url-label">
									<Trans comment="Short field label for custom display text associated with a URL">Label</Trans>
								</Label>
								<Input id="url-label" name="url-label" value={value.label} onChange={handleLabelChange} />
							</div>
						</PopoverContent>
					</Popover>
				</InputGroupAddon>
			)}
		</InputGroup>
	);
}
