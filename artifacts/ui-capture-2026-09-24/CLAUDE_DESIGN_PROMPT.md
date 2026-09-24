# Claude Design prompt

You are redesigning Reactive Resume from first principles. Your goal is to create a coherent design system and rethink the entire application flow so that creating, improving, managing, and sharing a resume feels simple and natural.

Start with the [screenshot atlas](README.md). Read its descriptions and inspect its linked screenshots. Treat the current UI as evidence of product capabilities and user tasks, not as a design reference. Assume no design system or component library exists. You have complete creative freedom to replace the visual language, navigation, information architecture, screen boundaries, and interaction patterns. Preserve useful capabilities, but challenge every step a user must take.

Make decisions from the end user's point of view. Prioritize a clean, comfortable interface; clear hierarchy; minimal cognitive load; predictable behavior; excellent interaction design; and smooth, purposeful animation. Use progressive disclosure where it simplifies complex workflows. Design for accessibility, keyboard use, reduced motion, and desktop, tablet, and mobile.

Work in this order:

1. **Rethink the product flow.** Identify the main user goals and map the simplest path through each: creating or importing a resume, editing content, choosing a template, previewing/exporting/sharing, checking ATS readability, writing cover letters, tracking applications, using AI assistance, and managing settings. Propose a new information architecture and explain the few consequential decisions and tradeoffs. Identify capabilities or steps that should be combined, moved, or removed.
2. **Build the foundation.** Create one opinionated visual direction and a reviewable design system: typography, color, spacing, layout, surfaces, iconography, light and dark modes, responsive rules, accessibility standards, and motion principles. Build a component library covering navigation, forms, rich-text editing, cards, tables, dialogs, menus, feedback states, document previews, and other patterns the new flows require. Show component variants and interaction states, including empty, loading, error, and success states. Make this a usable design artifact or prototype, not only a written specification.
3. **Build screens one at a time.** First give me the proposed screen order. For each screen, create a reviewable design showing its purpose, primary action, desktop and mobile layouts (tablet where behavior differs), important interactions, transitions, and relevant states. Briefly explain how it improves the user's task and how it uses the new system. Then stop and wait for my approval or revisions before starting the next screen. Carry approved decisions forward consistently.

Do not reproduce the existing UI merely because it appears in the screenshots. Do not add decoration or animation without a user benefit. Choose a clear direction rather than presenting a collection of unrelated concepts. If the screenshot atlas is inaccessible, ask me for the files before drawing conclusions about current functionality.

Begin with the user-goal map, proposed information architecture, and your design direction. Then develop the design system and component library for review before building the first screen.
