# Recall Editor — Technical Spec

## Architecture

Single Tiptap (`@tiptap/react`) editor instance. One ProseMirror document. No metadata drawers. No second editor.

## Document Structure

```
doc
├── heading "TODAY"                          ← StarterKit (h3)
├── recallTask { id, title, done }          ← Custom Node
│   ├── paragraph "context..."              ← StarterKit
│   └── taskList                            ← @tiptap/extension-task-list
│       ├── taskItem { checked } "sub-1"    ← @tiptap/extension-task-item
│       └── taskItem { checked } "sub-2"
├── recallTask { ... }
├── heading "THIS WEEK"
├── recallTask { ... }
├── heading "NOTES"
└── paragraph "free text..."
```

Sections (Today, This Week, This Month, Notes) are headings, not attributes. Moving a task between sections = cut/paste under a different heading.

## Features

### Tasks

| | |
|---|---|
| **What** | Top-level collapsible block that holds editable content |
| **Tiptap component** | Custom `Node` (`recallTask`) with `ReactNodeViewRenderer` |
| **Schema** | `group: "block"`, `content: "block+"`, `defining: true` |
| **Attributes** | `id` (string), `title` (string), `done` (bool), `expanded` (bool, not serialized) |
| **Creation** | `/task` slash command or `+ Add task` button |
| **Rendering** | `NodeViewWrapper` (header row) + `NodeViewContent` (editable body) |

No metadata attributes (due, source, section, status). Everything is captured in text.

### Sub-Tasks

| | |
|---|---|
| **What** | Checkbox items nested inside a task's content |
| **Tiptap component** | `@tiptap/extension-task-list` + `@tiptap/extension-task-item` (built-in) |
| **Creation** | `/subtask` command inside a task, or `[ ] ` input rule |
| **Nesting** | `TaskItem.configure({ nested: true })` — supports indent/outdent via Tab/Shift+Tab |

### Collapse / Expand

| | |
|---|---|
| **What** | Tasks show header-only when collapsed, full content when expanded |
| **Tiptap component** | `expanded` attribute on custom `recallTask` Node |
| **Mechanism** | `NodeViewContent` wrapped in a div with `display: none` when collapsed. Content stays in the ProseMirror doc; only rendering is toggled. |
| **Multi-expand** | Multiple tasks can be open simultaneously. No accordion. |
| **Expand All / Collapse All** | Iterate all `recallTask` nodes, set `expanded` in a single `tr` dispatch |

### View Modes: Inline vs Panel

| | |
|---|---|
| **What** | Two layouts for expanded task content |
| **Tiptap component** | Same `NodeViewContent` — CSS only, no schema change |
| **Inline** | Content renders below header in-place |
| **Panel** | Content div gets `position: fixed; right: 0` — visually appears as a side panel while staying in ProseMirror's DOM tree (so `posFromDOM`, selection, events all work) |

### Suggestions (Track Changes / Redlines)

| | |
|---|---|
| **What** | Inline change proposals at any granularity (word, sentence, paragraph, sub-task) |
| **Tiptap component** | Two custom `Mark` extensions: `suggestionInsert`, `suggestionDelete` |
| **Attributes** | `id` (groups related marks), `author` ("coach" or "user") |
| **Visual** | Insert: green background + green underline. Delete: red background + strikethrough. Styled via CSS classes `.suggestion-insert`, `.suggestion-delete`. |
| **Replace** | Delete mark on old text + insert mark on new text, adjacent in the doc |
| **Accept insert** | Remove mark, keep text (`tr.removeMark`) |
| **Accept delete** | Delete the text (`tr.delete`) |
| **Reject insert** | Delete the text |
| **Reject delete** | Remove mark, keep text |
| **Bulk** | Accept All / Reject All collect all suggestion IDs and process each |

### Suggestion Click Tooltip

| | |
|---|---|
| **What** | Floating Accept/Reject buttons when clicking a suggestion in the editor |
| **Tiptap component** | Custom `Extension` with ProseMirror plugin (`handleClick`) |
| **Mechanism** | Plugin reads marks at click position, gets coords via `view.coordsAtPos`, passes to React state. React renders a `position: fixed` tooltip. |

### Suggestions Review Panel

| | |
|---|---|
| **What** | Side panel listing all pending suggestions with context, for review before bulk accept |
| **Tiptap component** | React component reading the ProseMirror doc (no Tiptap extension) |
| **Content per item** | Task name, surrounding context text (±30 chars), highlighted suggestion text, type label, author, individual Accept/Reject buttons |
| **Auto-expand** | Opening the panel expands only tasks containing suggestions (scans doc for mark positions, finds containing `recallTask` nodes, sets `expanded` in one `tr`) |
| **Navigate** | Clicking a suggestion calls `editor.commands.setTextSelection(pos)` + `scrollIntoView` |

### Slash Commands

| | |
|---|---|
| **What** | `/task` and `/subtask` text commands |
| **Tiptap component** | Custom `Extension` with ProseMirror plugin (`handleTextInput`) |
| **Mechanism** | Plugin checks if current line text matches `/task` or `/subtask`. On match, schedules a `setTimeout` to insert the node and delete the command text. |
| `/task` | Inserts `recallTask` node after current top-level block. Works anywhere. |
| `/subtask` | Inserts `taskList` > `taskItem` at cursor. Only works inside a `recallTask`. |

### Change History

| | |
|---|---|
| **What** | Log of all edits with persona attribution (user vs coach) |
| **Tiptap component** | Custom `Extension` with ProseMirror plugin (plugin state `apply`) |
| **Persona tracking** | `tr.setMeta("persona", "user" \| "coach")` on every explicit action. Untagged = "user". |
| **Descriptions** | Explicit actions set `tr.setMeta("changeDescription", "...")`. Typing auto-generates descriptions from step analysis. |
| **Coalescing** | Consecutive same-persona edits within 3 seconds merge into one entry (e.g., typing "hello world" → one `Typed "hello world"` entry, not 11 entries). Different persona or >3s gap starts a new entry. |
| **Display** | Side panel, reverse chronological. Colored dot per persona (blue = user, purple = coach). |

## Component Map

| Tiptap Primitive | Used For |
|---|---|
| `@tiptap/starter-kit` | Headings, paragraphs, lists, bold, italic, undo/redo |
| `@tiptap/extension-task-list` | Sub-task checkbox lists |
| `@tiptap/extension-task-item` | Individual sub-task checkboxes (with `nested: true`) |
| Custom `Node` | `recallTask` — top-level collapsible task block |
| `ReactNodeViewRenderer` | Renders `recallTask` as React (`NodeViewWrapper` + `NodeViewContent`) |
| Custom `Mark` × 2 | `suggestionInsert`, `suggestionDelete` — inline track changes |
| Custom `Extension` × 3 | Slash commands (handleTextInput), suggestion click handler (handleClick), change history (plugin state apply) |
| ProseMirror `tr.setMeta` | Persona + description metadata on transactions |
| ProseMirror `tr.setNodeMarkup` | Toggle done, toggle expanded, expand/collapse all |
| ProseMirror `tr.addMark` / `tr.removeMark` | Apply/remove suggestion marks |
| CSS `position: fixed` | Panel view mode (visual relocation without breaking DOM hierarchy) |
| CSS `display: none` | Collapsed task content (stays in doc, hidden from view) |
