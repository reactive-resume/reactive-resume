// Motion's animation, gesture and layout features: a chunk of their own that routes/__root.tsx loads while the page
// starts, so they stay out of the scripts every page must run first.
export { domMax as default } from "motion/react";
