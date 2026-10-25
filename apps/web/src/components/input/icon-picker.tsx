import { t } from "@lingui/core/macro";
import { lazyRouteComponent } from "@tanstack/react-router";
import { Suspense, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@reactive-resume/ui/components/popover";
import { cn } from "@reactive-resume/utils/style";

// The icon list, its search index and the virtual grid load when the picker is about to open.
const IconPickerGrid = lazyRouteComponent(() => import("./icon-picker-grid"), "IconPickerGrid");
const preloadGrid = () => void IconPickerGrid.preload?.();

type IconPickerProps = Omit<React.ComponentProps<typeof Button>, "value" | "onChange"> & {
	value: string;
	onChange: (icon: string) => void;
	popoverProps?: React.ComponentProps<typeof Popover>;
};

export function IconPicker({ value, onChange, popoverProps, ...props }: IconPickerProps) {
	const [search, setSearch] = useState("");

	return (
		<Popover {...popoverProps}>
			<PopoverTrigger
				render={
					<Button
						size="icon"
						variant="secondary"
						aria-label={t`Pick an icon`}
						onPointerEnter={preloadGrid}
						onFocus={preloadGrid}
						{...props}
					>
						<i className={cn("ph size-4 text-base", `ph-${value}`)} />
					</Button>
				}
			/>

			<PopoverContent align="start" className="h-[326px] w-[290px] gap-0 p-0">
				<Suspense>
					<IconPickerGrid search={search} onSearchChange={setSearch} onChange={onChange} />
				</Suspense>
			</PopoverContent>
		</Popover>
	);
}
