---
target: whole admin panel
total_score: 20
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 4
target_identity: "file:/home/thaituan_uit/Recognition/frontend/src/views/adminView.ts"
target_fingerprint: "sha256:7c6e6ed9d18c016d264804af2fbb9da4b102dd0b4d9b8247cb1ebd31b86205bc"
target_path: /home/thaituan_uit/Recognition/frontend/src/views/adminView.ts
timestamp: 2026-11-08T16-45-45Z
slug: frontend-src-views-adminview-ts
closed: true
---
Method: dual-agent (A: /root/design_review · B: /root/detector_review)

Whole admin panel: Vocabulary, Reading (General and Goethe), imports, Dictation moderation, and token entry. Operate mode. **20/40 — Acceptable, with significant workflow weaknesses.**

This is a source-based critique. Chromium launched after escalation, but A's initial application screenshot was blank and its cause was not established. B verified browser launch only. Rendered desktop/mobile/dark appearance and contrast remain unverified. No application code was changed.

**Design specificity and overall impression**

The implementation supports DeutscheLearn's calm, flat design language: open lists, thin rules, restrained color, and familiar form controls. German articles, proficiency levels, and Goethe-specific exercise shapes make the authoring model product-specific. The biggest opportunity is reliable editing and review; a visual redesign would not resolve the primary issues.

The deterministic detector returned **0 findings** over the two admin views and admin CSS. It used source regex matching and cannot certify the dynamically constructed UI. No false positives were returned, and no browser overlay was injected. Manual evidence identifies problems outside that scan's coverage.

**Design health**

Scores use 0–4, where 4 is excellent.

| Heuristic | Score | Main evidence |
|---|---:|---|
| Visibility of system status | 2 | Dirty/saved messages exist; editor saves lack a pending state. |
| Match with the real world | 3 | German articles and exam structures fit the task; focus-entry terminology needs explanation. |
| User control and freedom | 1 | Switching records, sections, or starting new content can discard drafts. |
| Consistency and standards | 3 | Shared controls are consistent; import dialog behavior is incomplete. |
| Error prevention | 1 | New passages default to published; save actions remain available during requests. |
| Recognition rather than recall | 2 | Labels help, but publication state and import format guidance are missing from the workflow. |
| Flexibility and efficiency | 2 | Imports and Ctrl/Cmd+Enter exist; search rebuilds its own input. |
| Aesthetic and minimalist design | 3 | Flat layout fits the design system; long authoring forms need stronger task focus. |
| Error recovery | 1 | Reading has field validation, but vocabulary errors and passage-load failures offer weaker recovery. |
| Help and documentation | 2 | Goethe descriptions help; import templates are not available in the dialog. |
| **Total** | **20/40** | **Acceptable** |

**What's working**

- Vocabulary and Reading share a recognizable list-and-editor structure, reducing relearning between content types.
- Article selection, level/part constraints, and exam-specific descriptions support the actual teaching material.
- Dictation moderation uses direct hide/restore actions, textual visibility state, report counts, loading feedback, and retry controls. This is the clearest bounded workflow in the panel.

**Priority issues**

1. **[P1] Unsaved work has no dependable protection.** Editors keep edits in controls while record/section/new-item navigation replaces those controls. “Unsaved changes” warns without protecting. Preserve drafts and guard navigation with Save / Discard / Stay; preserve context after saving. Sources: adminWorkspace at adminView.ts:134, word list at :221, passage list at :445. Suggested command: `$impeccable harden`.

2. **[P1] Search rebuilds the input being used.** Vocabulary input calls loadWords(), which rerenders the list controls and fetches the full word collection. Reading search directly replaces its controls on input. This destroys the active input node and interrupts continuous typing. Keep the search control mounted, filter only the results, and retain focus, selection, and scroll. Sources: adminView.ts:253 and :489. Suggested command: `$impeccable harden`.

3. **[P1] Creating a passage silently means publishing it.** emptyPassage() initializes status to published, while the action says “Create passage.” Publication status is carried through payloads without a visible status control. Existing drafts likewise lack an explicit publishing path. Show status, default to a draft, and distinguish Save draft from Publish. Sources: adminView.ts:1616, :769, :795. Suggested command: `$impeccable clarify` with workflow implementation.

4. **[P1] Reading review is unreliable across formats and screen sizes.** The preview disappears at <=1180px without a replacement. Its source-choice branch checks only Goethe + Teil 2, although exercise shape depends on proficiency level; A2/B1/B2 Teil 2 can therefore use the wrong preview branch. Below 820px the list precedes the editor without a bounded mobile selection workflow. Use the shared shape resolver and provide an Editor / Preview switch plus an explicit list-to-editor transition. Sources: adminView.ts:1549, admin.css:760 and :784. Suggested commands: `$impeccable harden`, then `$impeccable adapt`.

5. **[P2] Imports lack keyboard completion and practical guidance.** The custom dialog sets aria-modal but lacks a linked accessible title, Escape handling, a focus trap, and focus restoration. “Choose a template file” provides no template download or schema example. Use a native dialog or complete its focus behavior, expose supported formats and templates, and preserve a clear completion state. Source: adminView.ts:856. Suggested commands: `$impeccable harden` and `$impeccable clarify`.

**Cognitive load and emotional journey**

Three checklist concerns are single-task focus, working-memory burden when preview disappears, and insufficient progressive disclosure for long question sets. The part-of-speech selector has eight choices; B1 Goethe matching can have eleven answer choices. Those domain choices are legitimate: preserve them, but group context and collapse inactive questions rather than flattening the whole exercise into one editing surface.

The intended journey is calm selection → confident editing → clear completion. The source instead allows uncertainty during navigation and saving. A newly created item immediately rerenders its editor, removing the just-written Saved message. Persistent confirmation and protected drafts would improve the ending of the task.

**Persona red flags**

- **Alex, power user:** Ctrl/Cmd+Enter and import help, but repeated search-input replacement undermines the most frequent list operation. No visible level/topic filters or bulk selection supplement the long lists.
- **Sam, keyboard/screen-reader user:** Import has incomplete modal focus behavior; answer radios repeat “Correct answer” rather than identifying the associated option. Editor status messages need dependable announcements.
- **Jordan, occasional editor:** “Create passage” hides publication consequences, “Focus entries” assumes knowledge, and the import instruction sends them looking for an unspecified template.

**Minor observations**

- Dictation exposes report totals without reasons or a review history; operators must inspect the linked video to judge the report.
- Token entry requires editing a URL, and “Clear token” is technical wording for ending access.
- Compact and icon controls are 32–40px; inspect touch spacing before calling the mobile panel comfortable. This is not a measured accessibility failure.
- After the reliability fixes, prioritize `$impeccable adapt`, clarify publication/import copy, then finish with `$impeccable polish`.

**Questions to consider**

- Should editors ever lose a draft simply by changing the section they are viewing?
- Can publication be a deliberate review step instead of an implicit effect of creating a passage?
- Can preview remain available at every supported authoring width?
