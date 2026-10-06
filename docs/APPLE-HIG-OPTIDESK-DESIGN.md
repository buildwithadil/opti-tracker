# OptiDesk Apple HIG Design Constitution

This document is the product UI source of truth. OptiDesk is a calm, native-quality utility for running an optical shop. Every screen should help an owner complete a real-world task quickly: sell glasses, add a customer, collect money, or understand what happened.

## Product principles

- **Purpose:** Every screen has one dominant job and one visually dominant action.
- **Agency:** The owner always knows what will happen next and can recover from mistakes without losing work.
- **Responsibility:** Financial and customer data are presented with precise totals, dates, and confirmation states.
- **Familiarity:** Use platform patterns—tab navigation, grouped lists, sheets, disclosure, and direct manipulation—before inventing new ones.
- **Flexibility:** Support both quick touch use and keyboard/mouse use without creating separate mental models.
- **Simplicity:** Prefer one continuous flow, progressive disclosure, and short copy over wizard steps and explanatory chrome.
- **Craft:** Spacing, type, focus states, loading, errors, and empty states are designed as carefully as the default state.
- **Delight:** Small, quiet transitions and confident feedback make routine work feel good without distracting from it.

## Color system

OptiDesk is almost monochromatic. Color is a signal, never decoration.

| Token | Value | Use |
| --- | --- | --- |
| `paper` | `#F5F5F7` | App canvas and quiet grouping |
| `panel` | `#FFFFFF` | Solid content surfaces and documents |
| `ink` | `#1D1D1F` | Primary text and controls |
| `muted` | `#6E6E73` | Supporting text and metadata |
| `subtle` | `#8E8E93` | Placeholder and tertiary information |
| `line` | `#D2D2D7` | Hairline separators and restrained borders |
| `accent` | `#7A1F2B` | Brand, primary action, selected state, links |
| `accent-pressed` | `#651923` | Pressed and active primary state |
| `accent-tint` | `#F7ECEF` | Selected controls and light emphasis |

There are no gradients, neon colors, colorful metric panels, colored navigation backgrounds, or green success buttons. Errors may use the accent family plus clear copy and iconography. Success is communicated by a completed state, confirmation copy, and updated values—not a green surface.

## Typography

Use the system stack: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", sans-serif`.

- Page titles: 28–34px, semibold, tight tracking, one line where possible.
- Section headings: 17–20px, semibold.
- Body: 15–16px, regular, 1.45–1.6 line height.
- Metadata and labels: 13–14px, regular or medium.
- Money and totals: tabular numerals, semibold; use size and placement instead of a colored card.
- Never use all caps, marketing language, excessive letter spacing, or bold text for every label.

Hierarchy must survive in grayscale. Backgrounds, borders, and shadows may support hierarchy but never carry it alone.

## Spacing

Use a 4px base rhythm: `4, 8, 12, 16, 20, 24, 32, 40, 48`.

- Touch targets are at least 44px high and 44px wide when icon-only.
- Page content uses 16px horizontal padding on small screens, 24px at tablet widths, and 40px on wide desktop.
- Sections are separated by 32px on mobile and 40px on desktop.
- List rows are 64–72px minimum; dense transaction rows may be 56px when the text remains comfortable.
- Use whitespace and separators before adding a container.

## Radius, borders, and shadows

- Small controls: 8–10px radius.
- Sheets and major floating controls: 16–20px radius.
- Avoid defaulting to pills. A capsule shape is reserved for compact segmented controls or a clearly floating action.
- Borders use `#D2D2D7` at one pixel. Prefer a single separator over a full box.
- Content surfaces have no shadow. Floating material uses a soft, low-opacity shadow only to establish elevation.
- Do not stack rounded cards inside rounded cards.

## Liquid Glass

Liquid Glass is a functional floating material, not the page theme. Use it only for:

- the mobile bottom navigation,
- the floating New Sale control,
- toolbars and contextual controls,
- sheets and transient controls.

The content layer stays solid white or `paper`. Never place long-form content, every input, every row, or every page background inside glass. Glass uses subtle translucency, `backdrop-filter: blur(20px) saturate(120%)`, a restrained border, and safe-area padding. It must remain legible when blur is unavailable.

## Navigation

Top-level navigation is exactly **Home, Sales, Customers, More**. New Sale is an action, never a tab. On mobile, use a four-item bottom bar and a floating New Sale control above it. Selected navigation is mostly monochrome with restrained maroon emphasis; never fill the whole tab in maroon.

On desktop, adapt the same information architecture into a lightweight 240px sidebar. The sidebar is a navigation rail, not a dashboard panel. Keep the brand and account controls quiet, and place New Sale as the single primary action.

## Sheets

Use a sheet for add customer, add prescription, contextual selection, short edits, and lightweight settings. A sheet has one clear title, an obvious dismiss action, preserved form state, safe-area support, and one primary action. Never nest sheets. Avoid confirmation dialogs unless leaving would lose meaningful work.

On small screens sheets rise from the bottom; on wider screens they become a focused centered surface with a sensible max width. The underlying page remains recognizable and the trigger regains focus when the sheet closes.

## Forms

Every field follows `Label → Field → optional supporting information`. Labels are short and human. Supporting text appears only when the constraint cannot be understood from the control. Prefill sensible values, keep the initial view short, and reveal uncommon fields with disclosure.

Required customer creation is only **Name** and **Mobile number**. Sale item entry starts with **Category, Description, Quantity, Price**, with quantity defaulting to `1`. Prescription starts with Right eye and Left eye, then reveals optional SPH, CYL, AXIS, ADD, and PD fields.

## Buttons and controls

- One dominant filled maroon action per screen.
- Secondary actions are neutral bordered controls.
- Tertiary actions are text links or quiet icon buttons.
- Do not create three equal filled actions or turn every action into a capsule.
- Payment methods use a quiet selection control; selected state is maroon tint, a small border, and a checkmark.
- Icon-only controls have an accessible name and a visible focus state.

## Lists and records

Prefer flat grouped lists, typography, whitespace, and separators. A row should answer one question and provide one obvious next action.

- Customers: name and mobile only; tap opens the profile.
- Sales: customer, date, amount, status.
- Outstanding: customer, amount due, Collect.
- Payments: amount, method, date, customer.
- Use disclosure or a sheet for secondary details instead of putting every field in the row.

Cards are allowed only when a solid boundary improves comprehension, such as a document summary or a focused form. “Card” is never the default name for a section.

## Home

Home answers “What do I need to know right now?” Show Today’s sales, Today’s collected, Outstanding, and Recent activity as a typographic summary with separators. Do not create a KPI-card dashboard or a giant Quick actions card. New Sale, Receive Payment, and Add customer appear at the point where the owner needs them.

## Empty, loading, error, and success states

- Empty states are short: “No sales yet”, “No outstanding balances”, “No matching customers”. Add one useful action when the next step is obvious.
- Loading states preserve layout and use a quiet spinner or skeleton; never flash a full-page dashboard.
- Errors state what failed, keep the user’s input, and provide one retry or recovery action. Avoid blame and technical jargon.
- Success states confirm the result with the important number and the next useful actions. Use no confetti and no large green panel.

## Responsive layouts

Design and review these layouts as first-class states: 390×844, 412×915, 768×1024, 1024×768, and 1440×900. The 390×844 layout is the primary reference. Desktop is a composition change with a lightweight sidebar and wider reading measure, not a stretched mobile screen.

On mobile, keep the main task in one continuous screen, reserve bottom safe-area space, and avoid horizontal scrolling except for genuinely compact tabs. On desktop, constrain text and form measures, use columns only when they shorten scanning, and keep primary actions within easy reach.

## Accessibility

Maintain semantic headings, labels, landmarks, keyboard access, visible focus, 44px minimum touch targets, screen-reader names, readable contrast, reduced-motion support, and safe-area padding. Tabs implement tab semantics and arrow-key movement. Dialogs restore focus to their trigger. Never communicate state by color alone.

## Interaction and motion

Interactions use 120–250ms transitions with opacity, transform, scale, or blur. Avoid bounce, overshoot, confetti, and large page transitions. Respect `prefers-reduced-motion`. Pressed states should be immediate and subtle. A completed action should update the relevant list or balance without making the owner hunt for the result.

## Content and microcopy

Use short, direct, human copy:

- “Add a customer” rather than “Add a customer to start managing contact details.”
- “No sales yet” rather than “Your completed sales will appear here.”
- “Customer” rather than “Customer contact information”.
- “Receive payment” rather than “Record a new payment transaction”.

Use sentence case. Keep action labels in the verb-first form. Do not explain a control immediately beside a clear label. Use ₹ and local date/time formatting consistently.

## Data and trust

The redesign changes presentation and task flow only. Preserve API contracts, payment calculations, invoice calculations, prescription rules, authentication, CSRF, Origin protection, sessions, rate limiting, audit behavior, migrations, and schema. When the current API cannot support an intended interaction, surface that gap rather than inventing backend behavior.
