---
name: DeutscheLearn
description: A minimal, friendly workshop for practicing German.
colors:
  primary: "#08327d"
  primary-hover: "#052459"
  primary-fg: "#fbfbfb"
  accent: "#558a86"
  accent-subtle: "#e9f0ef"
  gold: "#ffce00"
  error: "#dd0000"
  error-subtle: "#fdecec"
  background: "#fbfbfb"
  surface: "#ffffff"
  surface-raised: "#f4f4f3"
  border: "#d9d9d6"
  text: "#0f0a01"
  muted-text: "#6b6763"
  focus-ring: "#08327d"
typography:
  display:
    fontFamily: "Archivo Variable, Archivo, Helvetica Neue, Arial, sans-serif"
    fontSize: "clamp(40px, 5vw, 56px)"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Archivo Variable, Archivo, Helvetica Neue, Arial, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Archivo Variable, Archivo, Helvetica Neue, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Archivo Variable, Archivo, Helvetica Neue, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.08em"
rounded:
  square: "0px"
  sm: "4px"
  md: "7px"
  lg: "10px"
  pill: "999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-fg}"
    rounded: "{rounded.square}"
    padding: "0 20px"
    height: "58px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.square}"
    padding: "8px"
    height: "46px"
---

# Design System: DeutscheLearn

## Overview

**Creative North Star: “The Language Workshop”**

DeutscheLearn feels like a calm place to work through German: focused, minimal, and friendly. The interface favors clear type, open space, and direct controls over decorative framing. Learning modes read as steps in a working process, with restrained color used to orient learners and mark important states.

The light theme uses a soft near-white canvas and dark ink; the dark theme moves to charcoal surfaces and warm off-white text. Blue and teal provide the main signals, while gold and red are reserved for selected emphasis and errors. The user prefers avoiding card-heavy layouts and excess color. Keep content open and row-based wherever grouping does not need its own container.

**Key Characteristics:**
- Minimal and approachable, with clear hierarchy.
- Open rows and flat surfaces are the default.
- Color identifies action, mode, or state rather than decorating empty space.

## Colors

The palette pairs a deep study blue and quiet teal with warm paper-like neutrals; use gold and red sparingly for emphasis and feedback.

### Primary
- **Deep Study Blue** (`#08327d`): Main action, links, selected controls, and focus indication. In dark mode it lightens for contrast.

### Secondary
- **Quiet Teal** (`#558a86`): A supporting accent for progress and secondary learning-mode signals. Its pale tint marks successful or active feedback.

### Tertiary
- **Signal Gold** (`#ffce00`): A compact highlight for progress and next-step emphasis. Keep it to small, meaningful areas.
- **Clear Error Red** (`#dd0000`): Errors, missing words, and destructive actions; pair it with the pale error surface where needed.

### Neutral
- **Soft Paper** (`#fbfbfb`): Light-theme page background.
- **Clean Surface** (`#ffffff`): Light-theme input and panel surface.
- **Raised Paper** (`#f4f4f3`): Subtle input, selection, and feedback distinction.
- **Quiet Border** (`#d9d9d6`): Separates controls and content without creating heavy boxes.
- **Warm Ink** (`#0f0a01`): Primary text and strong dividers.
- **Muted Ink** (`#6b6763`): Supporting text and metadata.

Dark mode is defined in `frontend/src/styles/base/tokens.css`: charcoal background and surfaces, warm off-white text, lighter blue and teal, and muted dark borders. Keep contrast and semantic role consistent across themes.

**The One Accent at a Time Rule.** Use neutral surfaces as the base; let one strong accent lead a small control group or status at a time.

## Typography

**Display Font:** Archivo Variable (fallbacks: Archivo, Helvetica Neue, Arial, sans-serif)  
**Body Font:** Archivo Variable (fallbacks: Archivo, Helvetica Neue, Arial, sans-serif)  
**Label/Mono Font:** No separate label or monospace family is defined.

**Character:** Archivo keeps the interface direct and readable, with a compact, confident display and a practical body scale. The same family across roles gives the many practice modes a consistent voice.

### Hierarchy
- **Display** (600, `clamp(40px, 5vw, 56px)`, line-height 1.05): Product name and primary landing heading.
- **Title** (600, 24px, line-height 1.2): Mode and section headings.
- **Body** (400, 15px, line-height 1.55): Instructions, exercise text, and supporting content.
- **Label** (600, 12px, line-height 1.3, tracking 0.08em, uppercase when used as a category): Small category labels and metadata headings.
- **Metadata** (400, 13px, line-height 1.4): Secondary details and status copy.

**The Working Text Rule.** Keep instructions and exercise content at the body size or larger; labels are for navigation and metadata, not long explanations.

## Layout

The desktop shell is capped at 1440px with 48px vertical padding and a 12-column grid separated by 24px. Standard content uses an eight-column main area and a four-column sidebar; focused exercises can span the full grid. At 820px and below, the shell narrows to a 640px maximum with 16px side gutters, 32px vertical padding, and a single-column layout. The home and focus screens organize options as vertically stacked rows rather than a tile grid.

Spacing repeats around 8, 12, 16, 24, and 32px. Leave enough room for learners to scan instructions and answer controls without splitting related content into unnecessary cards. Dictation’s video library is a deliberate grid exception because thumbnails and click targets help learners choose a video.

## Elevation & Depth

Depth is mostly flat. Thin borders and subtle surface shifts separate work areas; shadows are reserved for interactive video thumbnails. Avoid adding a card or shadow around every section. When a group needs stronger separation, prefer spacing and a quiet border before adding elevation.

### Shadow Vocabulary
- **Interactive lift** (`0 14px 28px` with a 16% text-color mix): Hover feedback on video thumbnails, clarifying that the media item is actionable.

**The Flat-By-Default Rule.** Keep resting content flat; reserve shadows for clear interaction or a focused task surface.

## Shapes

Most shared controls and panels use square corners with a one-pixel border. Small form controls may use a 4px radius, exercise controls 7px, and media cards 10px. Fully rounded pills are limited to compact counters and progress tracks. Keep rounded cards from becoming the default container shape.

## Components

### Buttons
- **Character:** Direct, high-contrast actions with a clear primary choice.
- **Shape:** Shared buttons are square-cornered; focused exercise controls may use a 7px radius.
- **Primary:** Deep blue fill, light text, 58px minimum height, and 20px horizontal padding.
- **Hover / Focus:** Darker blue hover; visible 2px focus ring with a 2px offset.
- **Quiet navigation:** Back controls remain text-led and transparent rather than becoming another filled button.
- **Answer options:** Outlined at rest, with a restrained raised-surface hover.

### Inputs / Fields
- **Style:** White or theme surface, dark text, 1px border, square corners, 46px minimum height, and compact padding.
- **Focus:** Blue 2px outline with a 2px offset; dictation text entry uses a blue border and soft focus halo.
- **Error / Disabled:** Red border and outline for invalid fields; disabled buttons lower contrast and use the raised surface.

### Navigation
- **Style:** A compact horizontal header with separated start and end groups. A fine rule under the header uses ink, red, and gold as a small brand marker.
- **Responsive:** At 820px and below, header content aligns to the top and can wrap to fit narrower screens.
- **State:** Back navigation is understated; active mode and focus states use color and underline or border changes rather than large filled nav cards.

### Mode Rows
- **Style:** Full-width, open rows with a thin top rule, a narrow left color marker on hover/focus, a large numeral, description, and a right-aligned status or count.
- **Color:** Blue, teal, gold, red, and ink distinguish adjacent modes; keep each row’s treatment localized.
- **State:** Hover/focus adds a subtle tinted surface and shifts the arrow. Keyboard focus also receives the visible blue ring.

### Segmented Control
- **Style:** Square, bordered segments with no extra container rounding. The selected item uses the text color as a solid fill and the page background for its label.
- **State:** Unselected items remain quiet; hover uses a raised surface. Focus uses the shared visible ring.

### Video Library Item
- **Style:** A thumbnail-led media item with a 16:9 image, restrained detail area, and 10px corners. It is the exception to the open-row preference because image previews support selection.
- **State:** Hover gently lifts the item, reveals the play action, and increases thumbnail scale. Keep this treatment inside video browsing.

## Do's and Don'ts

### Do:
- **Do** use open rows, spacing, and thin borders before adding another card container.
- **Do** keep primary actions blue and reserve gold and red for small, meaningful status or feedback cues.
- **Do** preserve clear keyboard focus in both themes.
- **Do** keep the 12-column desktop layout and single-column behavior below 820px when building within the existing shell.
- **Do** keep media cards for thumbnail-based video selection, where the preview helps the learner choose.

### Don't:
- **Don't** use several saturated colors in one small group when one accent and neutrals communicate the state.
- **Don't** wrap every section, option, or paragraph in a card; prefer open space and row separators.
- **Don't** add decorative shadows to resting panels.
- **Don't** use uppercase tracked labels for long instructions or body copy.
