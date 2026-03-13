# V2 → V3: Architecture Changes

## What changed

**V2** used a custom `RecallTask` ProseMirror node (`atom: false`, `content: "block+"`) with a bespoke suggestion system (inline `suggestionInsert`/`suggestionDelete` marks), a change history plugin with persona-attributed coalescing, and a coach simulation flow. All state lived in TipTap's JSON doc model. The task title was a node attribute; sub-tasks used TipTap's `TaskList`/`TaskItem`. There was no serialization layer — the doc was the source of truth.

**V3** is **markdown-first**. The source of truth is GFM Markdown. TipTap is the interactive editing layer only — `tiptap-markdown` handles round-trip serialization. Tasks are `<details>/<summary>` HTML blocks (valid GFM), which render as collapsible sections with checkboxes. Sub-tasks are nested `- [ ]` / `- [x]` task lists (3+ levels deep).

## Key differences

| Concern | V2 | V3 |
|---|---|---|
| **Storage format** | TipTap JSON doc | GFM Markdown |
| **Task node** | Custom `RecallTask` (ProseMirror node) | `<details>/<summary>` (standard HTML in GFM) |
| **Collapse mechanism** | `expanded` attr + `display: none` CSS | Same pattern, but on `<details>` node with `open` attr |
| **Task checkbox** | Custom attr `done` on RecallTask node | `done` attr on DetailsBlock node |
| **Sub-tasks** | `TaskList`/`TaskItem` inside RecallTask | Same, but nested via GFM `- [ ]` indentation |
| **AI provenance** | Custom inline marks (`suggestionInsert`/`suggestionDelete`) with accept/reject flow | **Italic text** — AI-authored content is `*italic*` in markdown, visually distinct, no accept/reject workflow |
| **Serialization** | None (JSON doc is truth) | `tiptap-markdown` — `editor.storage.markdown.getMarkdown()` |
| **Portability** | Locked to TipTap | Markdown renders in GitHub, Notion, any GFM tool |

## What was removed

- **Suggestion marks** (`suggestionInsert`, `suggestionDelete`) — replaced by italic provenance
- **Accept/reject flow** — no inline redlines; AI content is simply italic
- **Suggestion review panel** — not needed without redlines
- **Change history plugin** — removed (could be re-added if needed)
- **Panel view mode** — already removed in late V2

## What was added

- **`tiptap-markdown`** — serialization layer for round-trip GFM fidelity
- **Markdown source panel** — live view of the serialized markdown as you edit
- **Italic = AI provenance** — italic text (`*...*`) denotes AI-authored content. Normal text is user-authored. This is the simplest possible provenance signal that survives markdown round-trips.
- **`/task` slash command** and **`+ Add task` button** — same UX as V2, creates new `<details>` blocks

## Why italic for provenance

Considered alternatives:
- **Color** — doesn't survive markdown serialization. Would require custom marks or HTML attributes, breaking portability.
- **Custom marks** (V2 approach) — powerful but complex. Requires accept/reject UI, review panels, bulk actions. Adds significant UX surface area.
- **Bold** — too visually heavy, and bold has semantic meaning (emphasis) that conflicts.
- **Italic** — markdown-native (`*text*`), visually distinct but not intrusive, round-trips perfectly, renders correctly in every GFM tool. A reader can immediately tell what the AI wrote vs. what the user wrote. No workflow overhead.

## Provenance convention

```
User writes:  Alex mentioned the 15% cap might be too aggressive.
AI adds:      *Based on Q4 data, 12% preserves margin while staying competitive.*
```

In the editor, AI text appears in italic. In raw markdown, it's wrapped in `*...*`. Any downstream system that renders GFM will preserve this distinction.
