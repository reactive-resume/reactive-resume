import type { ApplicationExportOptions } from "../csv";
import type { Application } from "../types";
import { t } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { useId, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { Label } from "@reactive-resume/ui/components/label";
import { RadioGroup, RadioGroupItem } from "@reactive-resume/ui/components/radio-group";
import { downloadWithAnchor } from "@reactive-resume/utils/file";
import { exportApplicationsCsv, selectApplicationsForExport } from "../csv";
import { useApplicationLanes } from "../use-application-lanes";

type ExportApplicationsSheetProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	applications: Application[];
	filtered: Application[];
};

/** Export CSV: which applications, an optional range of application dates, one file. A dialog; the name is kept for its caller. */
export function ExportApplicationsSheet({ open, onOpenChange, applications, filtered }: ExportApplicationsSheetProps) {
	const id = useId();
	const { lanes, mode } = useApplicationLanes();
	const [scope, setScope] = useState<ApplicationExportOptions["scope"]>("filtered");
	const [from, setFrom] = useState("");
	const [to, setTo] = useState("");
	const validRange = !from || !to || from <= to;
	const selected = selectApplicationsForExport(applications, filtered, { scope, from, to });

	const download = () => {
		if (!validRange || selected.length === 0) return;
		const blob = new Blob([exportApplicationsCsv(selected, mode === "lanes" ? lanes : [])], {
			type: "text/csv;charset=utf-8",
		});
		downloadWithAnchor(blob, `applications-${new Date().toISOString().slice(0, 10)}.csv`);
		onOpenChange(false);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent closeLabel={t`Close`}>
				<form
					className="grid gap-[18px]"
					onSubmit={(event) => {
						event.preventDefault();
						download();
					}}
				>
					<DialogHeader className="gap-1.5">
						<DialogTitle>
							<Trans>Export applications</Trans>
						</DialogTitle>
						<DialogDescription>
							<Trans>One CSV file with details, contacts, notes and timeline history.</Trans>
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-1.5">
						<span id={`${id}-scope`} className="text-[13px]/[18px] font-medium text-ink-2">
							<Trans>Applications to export</Trans>
						</span>
						<RadioGroup
							aria-labelledby={`${id}-scope`}
							value={scope}
							onValueChange={(value) => setScope(value as ApplicationExportOptions["scope"])}
							className="gap-0"
						>
							{(
								[
									{ value: "filtered", label: t`What the list shows now`, count: filtered.length },
									{ value: "all", label: t`All applications, including closed`, count: applications.length },
								] as const
							).map((option) => (
								// oxlint-disable-next-line jsx-a11y/label-has-associated-control -- the radio is inside its label
								<label key={option.value} className="flex min-h-8 cursor-pointer items-center gap-2.5 text-sm/5">
									<RadioGroupItem value={option.value} />
									{option.label}
									<span className="ms-auto text-xs/4 text-ink-3">{option.count}</span>
								</label>
							))}
						</RadioGroup>
					</div>
					<div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
						<div className="grid gap-1.5">
							<Label htmlFor={`${id}-from`}>
								<Trans>Applied from</Trans>
							</Label>
							<Input
								id={`${id}-from`}
								type="date"
								value={from}
								max={to || undefined}
								aria-invalid={!validRange || undefined}
								aria-describedby={validRange ? undefined : `${id}-range`}
								onChange={(event) => setFrom(event.target.value)}
							/>
						</div>
						<div className="grid gap-1.5">
							<Label htmlFor={`${id}-to`}>
								<Trans>Applied to</Trans>
							</Label>
							<Input
								id={`${id}-to`}
								type="date"
								value={to}
								min={from || undefined}
								aria-invalid={!validRange || undefined}
								aria-describedby={validRange ? undefined : `${id}-range`}
								onChange={(event) => setTo(event.target.value)}
							/>
						</div>
					</div>
					{!validRange ? (
						<p id={`${id}-range`} role="alert" className="-mt-2 text-[13px]/[18px] text-danger-text">
							<Trans>Start date must be on or before end date.</Trans>
						</p>
					) : (
						// With a date range the file can hold fewer than the option's count: say how many.
						(from || to) && (
							<p role="status" className="-mt-2 text-[13px]/[18px] text-ink-3">
								<Plural value={selected.length} one="# application to export" other="# applications to export" />
							</p>
						)
					)}
					<DialogFooter>
						<Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
							<Trans>Cancel</Trans>
						</Button>
						<Button type="submit" disabled={!validRange || selected.length === 0}>
							<Icon name="download-simple" />
							<Trans>Download CSV</Trans>
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
