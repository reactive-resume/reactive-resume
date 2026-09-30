import type { ApplicationExportOptions } from "../csv";
import type { Application } from "../types";
import { t } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { useId, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Input } from "@reactive-resume/ui/components/input";
import { Label } from "@reactive-resume/ui/components/label";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@reactive-resume/ui/components/sheet";
import { downloadWithAnchor } from "@reactive-resume/utils/file";
import { exportApplicationsCsv, selectApplicationsForExport } from "../csv";
import { Combobox } from "@/components/ui/combobox";

type ExportApplicationsSheetProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	applications: Application[];
	filtered: Application[];
};

export function ExportApplicationsSheet({ open, onOpenChange, applications, filtered }: ExportApplicationsSheetProps) {
	const id = useId();
	const [scope, setScope] = useState<ApplicationExportOptions["scope"]>("filtered");
	const [from, setFrom] = useState("");
	const [to, setTo] = useState("");
	const validRange = !from || !to || from <= to;
	const selected = selectApplicationsForExport(applications, filtered, { scope, from, to });

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="right" className="w-full gap-0 data-[side=right]:sm:max-w-lg">
				<SheetHeader>
					<SheetTitle>
						<Trans>Export applications</Trans>
					</SheetTitle>
					<SheetDescription>
						<Trans>Download application details, contacts, notes, and timeline history as CSV.</Trans>
					</SheetDescription>
				</SheetHeader>
				<form
					className="flex min-h-0 flex-1 flex-col"
					onSubmit={(event) => {
						event.preventDefault();
						if (!validRange || selected.length === 0) return;
						const blob = new Blob([exportApplicationsCsv(selected)], { type: "text/csv;charset=utf-8" });
						downloadWithAnchor(blob, `applications-${new Date().toISOString().slice(0, 10)}.csv`);
						onOpenChange(false);
					}}
				>
					<div className="-mt-1 flex flex-1 flex-col gap-4 overflow-y-auto px-4 pt-1 pb-4">
						<div className="space-y-1.5">
							<Label htmlFor={`${id}-scope`}>
								<Trans>Applications to export</Trans>
							</Label>
							<Combobox
								id={`${id}-scope`}
								className="w-full"
								value={scope}
								onValueChange={(value) => value && setScope(value)}
								options={[
									{ value: "filtered", label: t`Current filters` },
									{ value: "all", label: t`All applications (including closed)` },
								]}
							/>
						</div>
						<div className="grid grid-cols-2 items-end gap-3">
							<div className="space-y-1.5">
								<Label htmlFor={`${id}-from`}>
									<Trans>Application date from</Trans>
								</Label>
								<Input
									id={`${id}-from`}
									type="date"
									value={from}
									max={to || undefined}
									onChange={(event) => setFrom(event.target.value)}
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor={`${id}-to`}>
									<Trans>Application date to</Trans>
								</Label>
								<Input
									id={`${id}-to`}
									type="date"
									value={to}
									min={from || undefined}
									onChange={(event) => setTo(event.target.value)}
								/>
							</div>
						</div>
						{!validRange && (
							<p role="alert" className="text-sm text-danger-text">
								<Trans>Start date must be on or before end date.</Trans>
							</p>
						)}
						<p className="text-sm text-ink-3">
							<Plural value={selected.length} one="# application to export" other="# applications to export" />
						</p>
					</div>
					<SheetFooter className="flex-row justify-end gap-2">
						<Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
							<Trans>Cancel</Trans>
						</Button>
						<Button type="submit" disabled={!validRange || selected.length === 0}>
							<Trans>Download CSV</Trans>
						</Button>
					</SheetFooter>
				</form>
			</SheetContent>
		</Sheet>
	);
}
