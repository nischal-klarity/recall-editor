/**
 * Recall Editor V3
 *
 * Markdown-first TipTap editor with collapsible checklists and subtasks.
 * All content stored as GFM Markdown. TipTap is the interactive editing layer.
 * Includes six provenance modes for comparing how AI-authored content is displayed.
 */

import React, { useState } from "react";
import {
  useEditor,
  EditorContent,
  ReactNodeViewRenderer,
  NodeViewWrapper,
  NodeViewContent,
} from "@tiptap/react";
import { Node, Mark, mergeAttributes, Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Markdown } from "tiptap-markdown";

// ─── Sample Markdown ────────────────────────────────────────────

const SAMPLE_MARKDOWN = `### TODAY

<details>
<summary>Confirm volume discount cap with Alex</summary>

Alex mentioned the 15% cap might be too aggressive for mid-market deals. Need to validate against last quarter's margins before the SOW goes out.

- [ ] Pull Q4 margin data from dashboard
- [x] Check Slack thread with finance team
- [ ] Schedule 15-min sync with Alex
  - [ ] Prep talking points
  - [ ] Pull competitor pricing data

</details>

<details>
<summary>Send updated SOW to Sarah by Friday</summary>

Sarah flagged a pricing discrepancy in Section 3. Revised version needs her sign-off before the compliance review.

- [ ] Fix volume discount cap
- [x] Run compliance checklist
- [ ] Get finance sign-off
  - [ ] Draft email to CFO
  - [x] Confirm budget codes

</details>

### THIS WEEK

<details>
<summary>Revisit escalation playbook</summary>

Current playbook is from 2024. Need to update with new SLA tiers and routing rules from the Q1 reorg.

- [ ] Review current SLA tiers
- [ ] Map new routing rules
- [ ] Get sign-off from ops lead

</details>

<details>
<summary>Prep slides for Thursday QBR</summary>

Focus on pipeline velocity metrics. Pull data from the new dashboard Alex set up.

- [ ] Export pipeline data
- [ ] Build velocity charts
- [ ] Add deal highlights section

</details>

### THIS MONTH

<details>
<summary>Evaluate new CRM migration timeline</summary>

IT wants to push to Q3 but sales ops needs the custom fields before the mid-market push.

- [ ] Get updated timeline from IT
- [ ] Map required custom fields
- [ ] Draft migration risk assessment

</details>

### NOTES

I think we're overcomplicating the pricing tiers. The original 3-tier structure worked for 80% of deals.
`;

// ─── Provenance Modes ───────────────────────────────────────────

const PROVENANCE_MODES = [
  { id: "blockquote", label: "Blockquote", short: ">" },
  { id: "muted", label: "Muted Color", short: "Aa" },
  { id: "prefix", label: "Prefix ✦", short: "✦" },
  { id: "italic", label: "Italic", short: "I" },
  { id: "hybrid", label: "Muted + ✦", short: "✦Aa" },
  { id: "border", label: "Left Border", short: "▎" },
];

// ─── Custom Mark: AI Muted ──────────────────────────────────────
// Used by "muted" and "hybrid" modes. Renders gray text.

const AiMuted = Mark.create({
  name: "aiMuted",
  parseHTML() {
    return [{ tag: "span.ai-muted" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "ai-muted" }), 0];
  },
});

// ─── Custom Node: AI Border Block ───────────────────────────────
// Used by "border" mode. Wraps content with a thin left border.

const AiBorderBlock = Node.create({
  name: "aiBorderBlock",
  group: "block",
  content: "block+",
  defining: true,

  parseHTML() {
    return [{ tag: "div.ai-border-block" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { class: "ai-border-block" }), 0];
  },
});

// ─── DetailsBlock Node ──────────────────────────────────────────

const DetailsBlock = Node.create({
  name: "detailsBlock",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      summary: { default: "Untitled" },
      open: { default: false, rendered: false },
      done: { default: false, rendered: false },
    };
  },

  parseHTML() {
    return [{
      tag: "details",
      getAttrs(dom) {
        const summaryEl = dom.querySelector("summary");
        return {
          summary: summaryEl ? summaryEl.textContent : "Untitled",
          open: dom.hasAttribute("open"),
        };
      },
      contentElement(node) {
        const wrapper = document.createElement("div");
        Array.from(node.childNodes).forEach((child) => {
          if (child.nodeName !== "SUMMARY") wrapper.appendChild(child.cloneNode(true));
        });
        return wrapper;
      },
    }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "details",
      mergeAttributes(HTMLAttributes, node.attrs.open ? { open: "open" } : {}),
      ["summary", {}, node.attrs.summary],
      ["div", { "data-details-body": "" }, 0],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DetailsBlockView);
  },
});

// ─── DetailsBlock View ──────────────────────────────────────────

function DetailsBlockView({ node, getPos, editor }) {
  const { summary, open, done } = node.attrs;

  const toggleOpen = () => {
    const pos = getPos();
    const currentNode = editor.state.doc.nodeAt(pos);
    if (currentNode) {
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(pos, null, { ...currentNode.attrs, open: !open })
      );
    }
  };

  const toggleDone = (e) => {
    e.stopPropagation();
    const pos = getPos();
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(pos, null, { ...node.attrs, done: !done })
    );
  };

  return (
    <NodeViewWrapper>
      <div style={{
        borderRadius: 8,
        border: open ? "1px solid #d1d5db" : "1px solid transparent",
        marginBottom: 2,
        background: open ? "#f9fafb" : "transparent",
        transition: "all 0.15s ease",
      }}>
        <div onClick={toggleOpen} style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "7px 10px", cursor: "pointer",
          opacity: done ? 0.5 : 1, userSelect: "none",
        }}>
          <input type="checkbox" checked={done} onChange={toggleDone}
            onClick={(e) => e.stopPropagation()}
            style={{ width: 16, height: 16, flexShrink: 0 }} />
          <span style={{
            fontSize: 10, color: "#9ca3af",
            transition: "transform 0.15s ease",
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            flexShrink: 0,
          }}>▶</span>
          <span style={{
            flex: 1, textDecoration: done ? "line-through" : "none",
            color: "#1a1a1a", fontWeight: 500, fontSize: 14,
          }}>{summary}</span>
        </div>
        <div style={{
          display: open ? "block" : "none",
          padding: "6px 10px 12px 37px",
          borderTop: open ? "1px solid #f0f0f0" : "none",
        }}>
          <NodeViewContent className="details-body-content" />
        </div>
      </div>
    </NodeViewWrapper>
  );
}

// ─── Insert helpers ─────────────────────────────────────────────

function insertNewTask(editor, title = "New task") {
  const { state } = editor;
  const pos = state.selection.$from.after(1);
  const taskNode = state.schema.nodes.detailsBlock.create(
    { summary: title, open: true, done: false },
    [state.schema.nodes.paragraph.create()]
  );
  editor.view.dispatch(state.tr.insert(pos, taskNode));
  setTimeout(() => editor.commands.focus(), 10);
}

// ─── Slash Commands ─────────────────────────────────────────────

const SlashCommandsV3 = Extension.create({
  name: "slashCommandsV3",
  addProseMirrorPlugins() {
    const editorRef = this.editor;
    return [
      new Plugin({
        key: new PluginKey("slashCommandsV3"),
        props: {
          handleTextInput(view, from, to, text) {
            const { state } = view;
            const $from = state.doc.resolve(from);
            const lineBefore = state.doc.textBetween($from.start(), from, "");
            if (lineBefore + text === "/task") {
              setTimeout(() => {
                const { state: s } = editorRef;
                const $cur = s.doc.resolve(s.selection.from);
                editorRef.view.dispatch(s.tr.delete($cur.start($cur.depth), $cur.end($cur.depth)));
                setTimeout(() => insertNewTask(editorRef), 0);
              }, 0);
              return false;
            }
            return false;
          },
        },
      }),
    ];
  },
});

// ─── Simulate AI (per provenance mode) ──────────────────────────

const AI_PARAGRAPH = "Based on Q4 data, the 12% cap preserves margin while staying competitive. Recommend confirming with finance before the Friday SOW deadline.";
const AI_SUBTASK = "Review Alex's email re: competitor pricing";

function findFirstTaskInsertPos(editor) {
  // Expand and find insertion point inside first detailsBlock
  let firstTaskPos = null;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "detailsBlock" && firstTaskPos === null) firstTaskPos = pos;
  });
  if (firstTaskPos === null) return null;

  const taskNode = editor.state.doc.nodeAt(firstTaskPos);
  if (taskNode && !taskNode.attrs.open) {
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(firstTaskPos, null, { ...taskNode.attrs, open: true })
    );
  }
  return firstTaskPos;
}

function findParaEnd(editor) {
  let insertPos = null;
  editor.state.doc.descendants((node, pos) => {
    if (insertPos !== null) return false;
    const $pos = editor.state.doc.resolve(pos);
    for (let d = $pos.depth; d > 0; d--) {
      if ($pos.node(d).type.name === "detailsBlock") {
        if (node.type.name === "paragraph" && node.content.size > 0) {
          insertPos = pos + node.nodeSize;
          return false;
        }
      }
    }
  });
  return insertPos;
}

function findTaskListEnd(editor) {
  let end = null;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "taskList" && end === null) end = pos + node.nodeSize;
  });
  return end;
}

function simulateAI(editor, mode) {
  if (findFirstTaskInsertPos(editor) === null) return;

  const { schema } = editor.state;

  setTimeout(() => {
    const paraEnd = findParaEnd(editor);
    if (!paraEnd) return;

    let paraNode;

    if (mode === "blockquote") {
      const textNode = schema.text(AI_PARAGRAPH);
      const p = schema.nodes.paragraph.create(null, [textNode]);
      paraNode = schema.nodes.blockquote.create(null, [p]);
    } else if (mode === "muted") {
      const mark = schema.marks.aiMuted.create();
      const textNode = schema.text(AI_PARAGRAPH, [mark]);
      paraNode = schema.nodes.paragraph.create(null, [textNode]);
    } else if (mode === "prefix") {
      const textNode = schema.text("✦ " + AI_PARAGRAPH);
      paraNode = schema.nodes.paragraph.create(null, [textNode]);
    } else if (mode === "italic") {
      const mark = schema.marks.italic.create();
      const textNode = schema.text(AI_PARAGRAPH, [mark]);
      paraNode = schema.nodes.paragraph.create(null, [textNode]);
    } else if (mode === "hybrid") {
      const mark = schema.marks.aiMuted.create();
      const textNode = schema.text("✦ " + AI_PARAGRAPH, [mark]);
      paraNode = schema.nodes.paragraph.create(null, [textNode]);
    } else if (mode === "border") {
      const textNode = schema.text(AI_PARAGRAPH);
      const p = schema.nodes.paragraph.create(null, [textNode]);
      paraNode = schema.nodes.aiBorderBlock.create(null, [p]);
    }

    if (paraNode) {
      editor.view.dispatch(editor.state.tr.insert(paraEnd, paraNode));
    }
  }, 50);

  // Subtask
  setTimeout(() => {
    const taskListEnd = findTaskListEnd(editor);
    if (!taskListEnd) return;

    const { schema: s } = editor.state;
    let textNode;

    if (mode === "muted" || mode === "hybrid") {
      const mark = s.marks.aiMuted.create();
      const prefix = mode === "hybrid" ? "✦ " : "";
      textNode = s.text(prefix + AI_SUBTASK, [mark]);
    } else if (mode === "italic") {
      textNode = s.text(AI_SUBTASK, [s.marks.italic.create()]);
    } else if (mode === "prefix") {
      textNode = s.text("✦ " + AI_SUBTASK);
    } else if (mode === "blockquote" || mode === "border") {
      // For block-level modes, subtasks just get a prefix token since blockquote/border don't work inline
      textNode = s.text("✦ " + AI_SUBTASK);
    } else {
      textNode = s.text(AI_SUBTASK);
    }

    const newItem = s.nodes.taskItem.create(
      { checked: false },
      [s.nodes.paragraph.create(null, [textNode])]
    );
    editor.view.dispatch(editor.state.tr.insert(taskListEnd - 1, newItem));
  }, 100);
}

// ─── Add Task Button ────────────────────────────────────────────

function AddTaskButton({ editor }) {
  if (!editor) return null;
  return (
    <div style={{ maxWidth: 640, marginTop: 8 }}>
      <button onClick={() => insertNewTask(editor)} style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "6px 12px", background: "none",
        border: "1px dashed #d1d5db", borderRadius: 6,
        color: "#9ca3af", fontSize: 13, cursor: "pointer",
        width: "100%", justifyContent: "center", transition: "all 0.15s ease",
      }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#7c3aed"; e.currentTarget.style.color = "#7c3aed"; e.currentTarget.style.background = "#faf5ff"; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#d1d5db"; e.currentTarget.style.color = "#9ca3af"; e.currentTarget.style.background = "none"; }}
      >
        <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
        <span>Add task</span>
        <span style={{ fontSize: 11, color: "#c4b5fd", marginLeft: 4 }}>or type /task</span>
      </button>
    </div>
  );
}

// ─── Expand/Collapse ────────────────────────────────────────────

function expandAll(editor) {
  const tr = editor.state.tr;
  let changed = false;
  editor.state.doc.descendants((n, p) => {
    if (n.type.name === "detailsBlock" && !n.attrs.open) {
      tr.setNodeMarkup(p, null, { ...n.attrs, open: true }); changed = true;
    }
  });
  if (changed) editor.view.dispatch(tr);
}

function collapseAll(editor) {
  const tr = editor.state.tr;
  let changed = false;
  editor.state.doc.descendants((n, p) => {
    if (n.type.name === "detailsBlock" && n.attrs.open) {
      tr.setNodeMarkup(p, null, { ...n.attrs, open: false }); changed = true;
    }
  });
  if (changed) editor.view.dispatch(tr);
}

// ─── Markdown Panel ─────────────────────────────────────────────

function MarkdownPanel({ markdown, isOpen, onClose }) {
  if (!isOpen) return null;
  return (
    <div style={{ width: 400, borderLeft: "1px solid #e5e7eb", display: "flex", flexDirection: "column", height: "100vh" }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Markdown Source</span>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#9ca3af" }}>x</button>
      </div>
      <pre style={{ flex: 1, overflowY: "auto", padding: "12px 16px", fontSize: 12, lineHeight: 1.6, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: "#374151", background: "#fafafa", whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0 }}>
        {markdown}
      </pre>
    </div>
  );
}

// ─── Toolbar Button ─────────────────────────────────────────────

function ToolbarBtn({ children, onClick, active, style: extraStyle }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button onClick={onClick} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        padding: "5px 12px", fontSize: 12, fontWeight: 500, borderRadius: 6, cursor: "pointer",
        border: active ? "1.5px solid #7c3aed" : "1px solid #e5e7eb",
        background: active ? "#f5f3ff" : hovered ? "#f9fafb" : "white",
        color: active ? "#7c3aed" : "#374151",
        transition: "all 0.15s ease",
        ...extraStyle,
      }}>
      {children}
    </button>
  );
}

// ─── Main Component ─────────────────────────────────────────────

export default function RecallEditorV3() {
  const [markdownOpen, setMarkdownOpen] = useState(false);
  const [currentMarkdown, setCurrentMarkdown] = useState(SAMPLE_MARKDOWN);
  const [provenanceMode, setProvenanceMode] = useState("muted");

  const editor = useEditor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      DetailsBlock,
      AiMuted,
      AiBorderBlock,
      SlashCommandsV3,
      Markdown.configure({ html: true, transformPastedText: true, transformCopiedText: true }),
    ],
    content: SAMPLE_MARKDOWN,
    onUpdate({ editor }) {
      setCurrentMarkdown(editor.storage.markdown.getMarkdown());
    },
  });

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <div style={{ flex: 1, padding: "24px 32px", overflowY: "auto" }}>

        {/* Top toolbar */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid #f3f4f6", flexWrap: "wrap" }}>
          <ToolbarBtn onClick={() => editor && expandAll(editor)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="7 13 12 18 17 13" /><polyline points="7 6 12 11 17 6" />
            </svg>
            Expand All
          </ToolbarBtn>
          <ToolbarBtn onClick={() => editor && collapseAll(editor)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="17 11 12 6 7 11" /><polyline points="17 18 12 13 7 18" />
            </svg>
            Collapse All
          </ToolbarBtn>

          <div style={{ width: 1, height: 20, background: "#e5e7eb", margin: "0 4px" }} />

          <ToolbarBtn active={markdownOpen} onClick={() => { if (!markdownOpen && editor) setCurrentMarkdown(editor.storage.markdown.getMarkdown()); setMarkdownOpen(!markdownOpen); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
              <polyline points="13 2 13 9 20 9" />
            </svg>
            Markdown
          </ToolbarBtn>
        </div>

        {/* Provenance mode picker + Simulate AI */}
        <div style={{
          display: "flex", alignItems: "center", gap: 6, marginBottom: 16,
          paddingBottom: 12, borderBottom: "1px solid #f3f4f6", flexWrap: "wrap",
        }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#9ca3af", marginRight: 2 }}>PROVENANCE:</span>
          {PROVENANCE_MODES.map((m) => (
            <button key={m.id} onClick={() => setProvenanceMode(m.id)} style={{
              padding: "3px 10px", fontSize: 11, fontWeight: 600, borderRadius: 4, cursor: "pointer",
              border: provenanceMode === m.id ? "1.5px solid #7c3aed" : "1px solid #e5e7eb",
              background: provenanceMode === m.id ? "#f5f3ff" : "white",
              color: provenanceMode === m.id ? "#7c3aed" : "#6b7280",
              transition: "all 0.1s ease",
            }}>
              <span style={{ marginRight: 4, opacity: 0.7 }}>{m.short}</span>
              {m.label}
            </button>
          ))}

          <div style={{ width: 1, height: 20, background: "#e5e7eb", margin: "0 4px" }} />

          {/* Simulate AI */}
          <button onClick={() => editor && simulateAI(editor, provenanceMode)} style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "5px 12px", fontSize: 11, fontWeight: 500, borderRadius: 6, cursor: "pointer",
            border: "1.5px dashed #d6b4fc",
            background: "linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%)",
            color: "#7c3aed", transition: "all 0.15s ease",
          }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#a78bfa"; e.currentTarget.style.background = "linear-gradient(135deg, #f3e8ff 0%, #ede9fe 100%)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#d6b4fc"; e.currentTarget.style.background = "linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%)"; }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
            Simulate AI
            <span style={{ fontSize: 9, opacity: 0.6, fontWeight: 400 }}>(demo)</span>
          </button>

          {/* Mode description */}
          <span style={{ fontSize: 11, color: "#9ca3af", marginLeft: 4 }}>
            {provenanceMode === "blockquote" && "AI content in > blockquote"}
            {provenanceMode === "muted" && "AI content in muted gray"}
            {provenanceMode === "prefix" && "AI content prefixed with ✦"}
            {provenanceMode === "italic" && "AI content in *italic*"}
            {provenanceMode === "hybrid" && "Muted gray + ✦ prefix"}
            {provenanceMode === "border" && "AI content with thin left border"}
          </span>
        </div>

        <EditorContent editor={editor} style={{ maxWidth: 640 }} />
        <AddTaskButton editor={editor} />
      </div>

      <MarkdownPanel markdown={currentMarkdown} isOpen={markdownOpen} onClose={() => setMarkdownOpen(false)} />
    </div>
  );
}
