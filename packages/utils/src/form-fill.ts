/** Explicit DOM writes for the desktop active-tab helper. */
export type FormFillPlan = {
	targetUrl: string;
	fields: { selector?: string; question?: string; value: string; source: string }[];
	files: { selector: string; filename: string; base64: string; sha256: string; source: string }[];
};

// The extension injects this exact source into the approved active tab.
export const FORM_FILL_SCRIPT = String.raw`
globalThis.RRFormFill = async function(plan) {
 const results = [];
 const result = (field,status,source,detail) => results.push({field,status,source,detail});
 if (location.href !== plan.targetUrl) throw new Error("Destination changed. Review this exact page again.");
 const visible = el => {
  if (![...el.getClientRects()].some(rect=>rect.width>0&&rect.height>0) || getComputedStyle(el).visibility !== "visible" || el.closest("[hidden],[inert]")) return false;
  if (el.checkVisibility && !el.checkVisibility({opacityProperty:true,visibilityProperty:true})) return false;
  let regions = [...el.getClientRects()].filter(rect=>rect.width>0&&rect.height>0).map(({left,right,top,bottom})=>({left,right,top,bottom}));
  for (let node=el;node;node=node.parentElement) {
   const style=getComputedStyle(node);
   if (style.display==="none" || style.opacity==="0" || style.contentVisibility==="hidden") return false;
   // Filters can hide painted descendants without affecting checkVisibility.
   if (style.filter && style.filter!=="none") return false;
   if ((style.clipPath && style.clipPath!=="none") || (style.clip && style.clip!=="auto")) return false;
   if ([style.maskImage,style.webkitMaskImage,style.getPropertyValue("mask-border-source"),style.getPropertyValue("-webkit-mask-box-image-source")].some(value=>value && value!=="none")) return false;
   if ((style.rotate && style.rotate!=="none") || (style.perspective && style.perspective!=="none")) return false;
   if (style.scale && style.scale!=="none") {
    const axes=style.scale.trim().split(/\s+/).map(Number);
    if (!axes.length || axes.length>3 || axes.some(value=>!Number.isFinite(value)||value<=0) || (axes.length===3 && axes[2]!==1)) return false;
   }
   if (style.transform && style.transform!=="none") {
    try {
     const matrix=new DOMMatrixReadOnly(style.transform);
     if (!matrix.is2D || matrix.b!==0 || matrix.c!==0 || matrix.a<=0 || matrix.d<=0) return false;
    } catch { return false; }
   }
   const paintContained=/\b(?:paint|strict|content)\b/.test(style.contain);
   if (node===el || (!paintContained && style.overflowX==="visible" && style.overflowY==="visible")) continue;
   const box=node.getBoundingClientRect();
   const scaleX=node.offsetWidth?box.width/node.offsetWidth:1, scaleY=node.offsetHeight?box.height/node.offsetHeight:1;
   const left=box.left+node.clientLeft*scaleX, top=box.top+node.clientTop*scaleY;
   const right=left+node.clientWidth*scaleX, bottom=top+node.clientHeight*scaleY;
   regions=regions.map(region=>{
    const next={...region};
    // Scrollable fields can be revealed without being in the viewport; hidden/clip cannot.
    for (const [overflow,start,end,min,max] of [[style.overflowX,"left","right",left,right],[style.overflowY,"top","bottom",top,bottom]]) {
     if (overflow==="visible" && !paintContained) continue;
     if (overflow==="auto" || overflow==="scroll") {
      const horizontal=start==="left", scale=horizontal?scaleX:scaleY;
      const extent=(horizontal?node.scrollWidth:node.scrollHeight)*scale;
      const offset=(horizontal?node.scrollLeft:node.scrollTop)*scale;
      const contentStart=horizontal && style.direction==="rtl"?max-extent-offset:min-offset;
      if (next[end]<=contentStart || next[start]>=contentStart+extent) return null;
      next[start]=min;next[end]=max;
     }
     else {next[start]=Math.max(next[start],min);next[end]=Math.min(next[end],max);}
    }
    return next;
   }).filter(region=>region && region.right>region.left && region.bottom>region.top);
   if (!regions.length) return false;
  }
  return true;
 };
 const handled = new Set();
 const normalize = text => text.normalize("NFKC").replace(/\s+/gu," ").trim().toLocaleLowerCase("en-US");
 const prepared = [];
 for (const file of plan.files) {
  try {
   const bytes = Uint8Array.from(atob(file.base64), char => char.charCodeAt(0));
   const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(x=>x.toString(16).padStart(2,"0")).join("");
   if (hash !== file.sha256) throw new Error("File bytes differ from approved version.");
   prepared.push({file,bytes});
  } catch { result(file.filename,"error",file.source,"Wrong or unavailable file/verification. Attach exact approved download manually."); }
 }
 if (location.href !== plan.targetUrl) throw new Error("Destination changed during file verification. Review again.");
 for (const field of plan.fields) {
  let controls;
  if (field.selector) controls = [...document.querySelectorAll(field.selector)];
  else controls = [...document.querySelectorAll("label")].filter(label=>normalize(label.textContent||"")===normalize(field.question||"")).map(label=>label.control).filter(Boolean);
  controls = [...new Set(controls)].filter(visible);
  if (controls.length !== 1) { result(field.question||field.selector,"manual",field.source,"Missing or ambiguous field; copy answer manually."); continue; }
  const control = controls[0]; handled.add(control);
  if (!control.matches('input[type="text"],input:not([type]),input[type="email"],input[type="tel"],input[type="url"],textarea') || control.disabled || control.readOnly || control.getAttribute("role")==="combobox" || Object.keys(control).some(key=>key.startsWith("__reactProps")||key.startsWith("__reactFiber"))) { result(control.id||field.question||field.selector,"manual",field.source,"Unsupported or framework-controlled field; type manually."); continue; }
  if (control.value) { result(control.id||field.question||field.selector,"skipped",field.source,"Existing value retained; review it yourself."); continue; }
  if (!field.value.trim()) { result(control.id||field.question||field.selector,"manual",field.source,"No reviewed value available."); continue; }
  if (control.maxLength >= 0 && field.value.length > control.maxLength) { result(control.id||field.question||field.selector,"manual",field.source,"Approved answer exceeds the field limit. Shorten and review manually."); continue; }
  control.value = field.value;
  result(control.id||field.question||field.selector,control.value===field.value?"filled":"error",field.source,"DOM value only. Verify on the form. No input/change event sent.");
 }
 for (const {file,bytes} of prepared) {
  const controls = [...document.querySelectorAll(file.selector)].filter(visible);
  if (controls.length !== 1 || !controls[0].matches('input[type="file"]') || controls[0].disabled) { result(file.filename,"error",file.source,"Upload control unavailable/ambiguous; attach approved download manually."); continue; }
  const control = controls[0]; handled.add(control);
  if (Object.keys(control).some(key=>key.startsWith("__reactProps")||key.startsWith("__reactFiber"))) { result(control.id||file.filename,"manual",file.source,"Framework upload control: attach the approved download manually."); continue; }
  if (control.files.length) { result(control.id||file.filename,"skipped",file.source,"Existing attachment retained; verify its identity manually."); continue; }
  try {
   const transfer = new DataTransfer(); transfer.items.add(new File([bytes],file.filename,{type:"application/pdf"})); control.files = transfer.files;
   if (control.files.length !== 1 || control.files[0].size !== bytes.length || control.files[0].name !== file.filename) throw new Error("Rejected file.");
   result(control.id||file.filename,"filled",file.source,"File present in control only. Employer upload acceptance unverified; verify manually.");
  } catch { result(file.filename,"error",file.source,"Browser rejected file transfer. Attach exact approved download manually."); }
 }
 for (const control of document.querySelectorAll('input:not([type="hidden"]),textarea,select,[role="combobox"]')) {
  if (handled.has(control)||!visible(control)||control.matches('input[type="submit"],input[type="button"]')) continue;
  result(control.id||control.name||"unknown","manual","Explicit user answer required","Unresolved/sensitive or unsupported control. No inferred answer.");
 }
 return {targetUrl:plan.targetUrl,results,handoffs:["Complete account, captcha and additional pages manually.","Review every field and attachment; submit yourself. Nothing marked as sent."]};
};
`;
