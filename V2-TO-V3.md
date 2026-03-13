# V2 → V3: Architecture Changes

## What changed

**V2** used a custom `RecallTask` ProseMirror node with a bespoke suggestion system (inline `suggestionInsert`/`suggestionDelete` marks), a change history plugin with persona-attributed coalescing, and a coach simulation flow. All state lived in TipTap's JSON doc model.

**V3** is **markdown-first**. The source of truth is GFM Markdown. TipTap is the interactive editing layer only — `tiptap-markdown` handles round-trip serialization. Tasks are `<details>/<summary>` HTML blocks (valid GFM), which render as collapsible sections with checkboxes. Sub-tasks are nested `- [ ]` / `- [x]` task lists (3+ levels deep).

## Key differences

| Concern | V2 | V3 |
|---|---|---|
| **Storage format** | TipTap JSON doc | GFM Markdown |
| **Task node** | Custom `RecallTask` (ProseMirror node) | `<details>/<summary>` (standard HTML in GFM) |
| **Task checkbox** | Custom attr `done` on node | Same, on `<details>` node |
| **Sub-tasks** | `TaskList`/`TaskItem` inside RecallTask | Same, via GFM `- [ ]` indentation |
| **AI provenance** | Custom inline marks with accept/reject flow | Muted gray text with ✦ prefix (`aiMuted` mark) |
| **Serialization** | None (JSON doc is truth) | `tiptap-markdown` round-trip |
| **Portability** | Locked to TipTap | Renders in GitHub, Notion, any GFM tool |

## What was removed

- **Suggestion marks** (`suggestionInsert`, `suggestionDelete`) — replaced by muted color provenance
- **Accept/reject flow** — no inline redlines; AI content is simply muted
- **Suggestion review panel** — not needed without redlines
- **Change history plugin** — removed (could be re-added if needed)
- **Panel view mode** — already removed in late V2

## What was added

- **`tiptap-markdown`** — serialization layer for round-trip GFM fidelity
- **Markdown source panel** — live view of the serialized markdown as you edit
- **`/task` slash command** and **`+ Add task` button** — same UX as V2, creates new `<details>` blocks

## Provenance: Hybrid (Muted Color + ✦ Prefix)

AI-authored content is rendered in **muted gray** (`#9ca3af`) and prefixed with **✦**. User-authored content remains the default text color (`#374151`) with no prefix.

```
User writes:   Alex mentioned the 15% cap might be too aggressive.
AI adds:       ✦ Based on Q4 data, 12% preserves margin.  ← gray + ✦ prefix
```

### Why hybrid

We evaluated six options — blockquote, muted color, prefix token (✦), italic, hybrid (muted + prefix), and thin left border. The hybrid was chosen because it gets the best of both worlds:

- **High coherence** — the muted gray keeps the document reading as one flowing piece. The tone whispers "I didn't write this" without shouting.
- **Scannable** — the ✦ prefix lets you quickly scan for AI contributions without reading every line.
- **Survives export** — the ✦ is plain text, so it persists in raw markdown and external renderers (GitHub, Notion). The muted color is lost on export, but the prefix carries the signal.
- **Revocable** — if the user edits AI text and makes it their own, they can delete the ✦. Provenance is explicitly opt-out.
- **Any granularity** — works at sentence, paragraph, or sub-task level.

### Technical implementation

- **Mark**: `AiMuted` — renders as `<span class="ai-muted">`
- **CSS**: `.ai-muted { color: #9ca3af; }`
- **Prefix**: `✦ ` prepended to AI-authored text (plain text, survives markdown)
- **Simulate AI**: inserts a muted+prefixed paragraph and subtask into the first task to demonstrate
