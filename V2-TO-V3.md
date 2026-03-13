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
| **AI provenance** | Custom inline marks with accept/reject flow | TBD — see options below |
| **Serialization** | None (JSON doc is truth) | `tiptap-markdown` round-trip |
| **Portability** | Locked to TipTap | Renders in GitHub, Notion, any GFM tool |

---

## Provenance: Options Menu

**Problem:** Make it obvious what came from AI and what came from the user, without breaking the document's coherence or readability. The reader should see one flowing document, not a jarring patchwork.

### Option 1: Blockquote (`> text`)

```markdown
Alex mentioned the 15% cap might be too aggressive.

> Based on Q4 data, 12% preserves margin while staying competitive.
> Recommend confirming with finance before the Friday SOW deadline.
```

**Renders as** a left-bordered inset block.

| Dimension | Assessment |
|---|---|
| Markdown-native | Yes — `>` is standard GFM |
| Visual distinction | Strong — clear left border + indentation |
| Readability impact | **Medium-high** — blockquotes read as "quoted from elsewhere," which is close to the right semantics but can feel like the AI is being "cited" rather than contributing inline |
| Coherence | Breaks the flow. A task with 3 user lines, then a blockquote, then 2 more user lines feels segmented rather than collaborative |
| Granularity | Block-level only. Can't mark a single phrase inside a sentence |
| Portability | Excellent — every GFM renderer handles blockquotes |

**Best for:** AI contributions that are clearly separate thoughts (a full recommendation paragraph, a summary). Awkward for inline edits or single sub-tasks.

### Option 2: Muted text color

In the TipTap editor, AI text renders in a lighter color (e.g., `#9ca3af`) while user text is the default `#374151`. Achieved via a custom mark that adds a CSS class.

```
User text:  "Alex mentioned the 15% cap might be too aggressive."
AI text:    "Based on Q4 data, 12% preserves margin." (rendered in gray)
```

| Dimension | Assessment |
|---|---|
| Markdown-native | **No** — color requires `<span style>` or a CSS class in HTML. Degrades to plain text in raw markdown and external renderers |
| Visual distinction | Subtle — difference is present but doesn't jump out |
| Readability impact | **Low** — this is the most "coherent document" option. Text flows naturally, the muted tone whispers "I didn't write this" without shouting |
| Coherence | Excellent — highest coherence of all options |
| Granularity | Any level — word, phrase, sentence, paragraph, sub-task |
| Portability | Poor — provenance signal is lost outside the editor. In GitHub/Notion the text looks identical to user text |

**Best for:** Editor-only workflows where markdown is an internal format. The reading experience is the priority and you don't need provenance to survive export.

### Option 3: Prefix token

A small inline marker before AI-contributed text: `[AI]`, `✦`, or `»`.

```markdown
Alex mentioned the 15% cap might be too aggressive.

✦ Based on Q4 data, 12% preserves margin while staying competitive.

- [ ] Pull Q4 margin data from dashboard
- [ ] ✦ Review Alex's email re: competitor pricing
```

| Dimension | Assessment |
|---|---|
| Markdown-native | Yes — it's just text |
| Visual distinction | Clear — the token acts as a badge. Scannable at a glance |
| Readability impact | **Low-medium** — a single character like `✦` is unobtrusive. A prefix like `[AI]:` is more explicit but noisier |
| Coherence | Good — the document still reads top-to-bottom. The token is a subtle "byline" rather than a structural break |
| Granularity | Line/block level. Putting `✦` mid-sentence is awkward |
| Portability | Excellent — plain text travels everywhere |

**Best for:** When you want a clear, scannable signal that survives all exports. Works especially well for sub-tasks and standalone lines. Less natural for mid-paragraph contributions.

### Option 4: Italic (`*text*`)

```markdown
Alex mentioned the 15% cap might be too aggressive.

*Based on Q4 data, 12% preserves margin while staying competitive.*

- [ ] Pull Q4 margin data from dashboard
- [ ] *Review Alex's email re: competitor pricing*
```

| Dimension | Assessment |
|---|---|
| Markdown-native | Yes — `*text*` |
| Visual distinction | Moderate — italic is visually different but not dramatic |
| Readability impact | **Low** — italic reads as a slightly different "voice," which is semantically appropriate |
| Coherence | Good — italic text flows with the document. Feels like a collaborator's annotation |
| Granularity | Any level — word to paragraph |
| Portability | Excellent — renders correctly everywhere |

**Concern:** Italic has existing semantic meaning (emphasis, titles). Using it for provenance overloads that signal. If the user italicizes a word for emphasis, it becomes ambiguous.

### Option 5: Muted color + prefix token (hybrid)

Combine option 2 and 3. In the editor, AI text is rendered in muted gray *and* prefixed with a small token. In raw markdown, only the prefix survives.

```
In editor:   gray "✦ Based on Q4 data, 12% preserves margin."
In markdown: ✦ Based on Q4 data, 12% preserves margin.
```

| Dimension | Assessment |
|---|---|
| Markdown-native | Partial — prefix is text, color is editor-only |
| Visual distinction | Strong in editor, moderate in markdown |
| Readability impact | **Low** — muted color keeps coherence, token is scannable |
| Coherence | Very good — the text doesn't feel "separate," just softly attributed |
| Portability | Decent — prefix survives, color doesn't |

**Best for:** Having it both ways. The editor experience is polished (muted color), the exported markdown is still legible (prefix token).

### Option 6: Thin left border (CSS-only, like a subtle blockquote)

AI-contributed blocks get a thin left border (`2px solid #d1d5db`) in the editor, but no markdown formatting. A custom mark or wrapper `<div>` adds the styling.

| Dimension | Assessment |
|---|---|
| Markdown-native | No — requires `<div>` or custom mark |
| Visual distinction | Strong but subtle — a thin gray line on the left margin |
| Readability impact | **Very low** — doesn't touch the text at all |
| Coherence | Excellent — text is untouched, the border is a quiet margin signal |
| Portability | Poor — styling lost outside the editor |

---

## Recommendation

The right choice depends on what you value most:

| Priority | Best option |
|---|---|
| Coherent reading experience above all else | **Muted color** (option 2) |
| Must survive markdown export | **Prefix token** (option 3) or **blockquote** (option 1) |
| Both in-editor polish and export survival | **Muted color + prefix** (option 5) |
| Simplest possible implementation | **Italic** (option 4) |
| Cleanest UX, editor-only workflow | **Thin left border** (option 6) |

My lean: **Option 5 (muted color + prefix token)** — the hybrid. In the editor, AI text is visually soft (gray) so the document reads as one coherent piece. The `✦` prefix is small enough to not disrupt flow but gives you a scannable provenance signal that survives export. If the user edits AI text and makes it their own, they can delete the `✦` — provenance is explicitly revocable, which feels right.
