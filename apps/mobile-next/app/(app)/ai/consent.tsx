// S7 · First send to an AI connection (sheet). Importing the presenter here registers it as soon as the route
// tree loads; the root layout should call registerFirstSend() too (lead).
import { registerFirstSend } from "@/features/settings/first-send";
import { FirstSendSheet } from "@/features/settings/FirstSendSheet";

registerFirstSend();

export default FirstSendSheet;
