import { RouterProvider } from "@tanstack/react-router";
import ReactDOM from "react-dom/client";
import { receivePostingCapture } from "./features/applications/capture";
import { followReducedMotion } from "./libs/motion";
import { getRouter } from "./router";
import "./index.css";

const rootElement = document.getElementById("app");
if (!rootElement) throw new Error("Root element not found");

followReducedMotion();

receivePostingCapture();
const router = await getRouter();

// The router owns the title, description and robots tags from here on (see libs/seo.ts), so the copies in the served
// HTML go; everything else the server wrote into <head> (canonical, hreflang, social cards, structured data) stays.
document.head.querySelectorAll('title, meta[name="description"], meta[name="robots"]').forEach((element) => {
	element.remove();
});

// The server may send the homepage prerendered into #app. React replaces it on its first render, so that render waits
// for the route to load; otherwise the prerendered page would give way to a loading screen before coming back.
if (rootElement.hasChildNodes()) await router.load();

ReactDOM.createRoot(rootElement).render(<RouterProvider router={router} />);
