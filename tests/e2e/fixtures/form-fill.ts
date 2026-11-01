import type { FormFillPlan } from "@reactive-resume/utils/form-fill";
import { FORM_FILL_SCRIPT } from "@reactive-resume/utils/form-fill";

/** Capture the asynchronous desktop script result on controlled browser pages. */
export function formFillInvocation(plan: FormFillPlan, requestId: string) {
	return `${FORM_FILL_SCRIPT}\nRRFormFill(${JSON.stringify(plan)}).then(report=>globalThis.receipt={requestId:${JSON.stringify(requestId)},report}).catch(error=>globalThis.receipt={requestId:${JSON.stringify(requestId)},error:String(error)});`;
}
