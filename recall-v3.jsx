/**
 * Recall Editor V3
 *
 * Markdown-first TipTap editor with collapsible checklists and subtasks.
 * All content stored as GFM Markdown. TipTap is the interactive editing layer.
 * Features:
 * - TaskList + TaskItem with nested subtasks (3+ levels)
 * - Custom DetailsBlock node (<details>/<summary>) for collapsible sections
 *   with checkbox support for marking tasks done
 * - Round-trip Markdown fidelity via tiptap-markdown
 */

import React, { useState } from "react";
import {
  useEditor,
  EditorContent,
  ReactNodeViewRenderer,
  NodeViewWrapper,
  NodeViewContent,
} from "@tiptap/react";
import { Node, mergeAttributes, Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Markdown } from "tiptap-markdown";

// ─── Sample Markdown Content ────────────────────────────────────

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

// ─── DetailsBlock Node ──────────────────────────────────────────
// Single node: parses <details>, stores summary as attribute,
// body content is block+ via NodeViewContent.

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
    return [
      {
        tag: "details",
        getAttrs(dom) {
          const summaryEl = dom.querySelector("summary");
          return {
            summary: summaryEl ? summaryEl.textContent : "Untitled",
            open: dom.hasAttribute("open"),
          };
        },
        // Skip the <summary> element when parsing content — it's stored as an attribute
        contentElement(node) {
          // Create a wrapper div with everything except the summary
          const wrapper = document.createElement("div");
          Array.from(node.childNodes).forEach((child) => {
            if (child.nodeName !== "SUMMARY") {
              wrapper.appendChild(child.cloneNode(true));
            }
          });
          return wrapper;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    // For tiptap-markdown serialization, render as <details><summary>...</summary>content</details>
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

// ─── DetailsBlock React View ────────────────────────────────────

function DetailsBlockView({ node, getPos, editor }) {
  const { summary, open, done } = node.attrs;

  const toggleOpen = () => {
    const pos = getPos();
    const currentNode = editor.state.doc.nodeAt(pos);
    if (currentNode) {
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(pos, null, {
          ...currentNode.attrs,
          open: !open,
        })
      );
    }
  };

  const toggleDone = (e) => {
    e.stopPropagation();
    const pos = getPos();
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(pos, null, {
        ...node.attrs,
        done: !done,
      })
    );
  };

  return (
    <NodeViewWrapper>
      <div
        style={{
          borderRadius: 8,
          border: open ? "1px solid #d1d5db" : "1px solid transparent",
          marginBottom: 2,
          background: open ? "#f9fafb" : "transparent",
          transition: "all 0.15s ease",
        }}
      >
        {/* Header row: checkbox + disclosure + summary */}
        <div
          onClick={toggleOpen}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "7px 10px",
            cursor: "pointer",
            opacity: done ? 0.5 : 1,
            userSelect: "none",
          }}
        >
          <input
            type="checkbox"
            checked={done}
            onChange={toggleDone}
            onClick={(e) => e.stopPropagation()}
            style={{ width: 16, height: 16, flexShrink: 0 }}
          />
          <span
            style={{
              fontSize: 10,
              color: "#9ca3af",
              transition: "transform 0.15s ease",
              transform: open ? "rotate(90deg)" : "rotate(0deg)",
              flexShrink: 0,
            }}
          >
            ▶
          </span>
          <span
            style={{
              flex: 1,
              textDecoration: done ? "line-through" : "none",
              color: "#1a1a1a",
              fontWeight: 500,
              fontSize: 14,
            }}
          >
            {summary}
          </span>
        </div>

        {/* Collapsible body content */}
        <div
          style={{
            display: open ? "block" : "none",
            padding: "6px 10px 12px 37px",
            borderTop: open ? "1px solid #f0f0f0" : "none",
          }}
        >
          <NodeViewContent className="details-body-content" />
        </div>
      </div>
    </NodeViewWrapper>
  );
}

// ─── Expand/Collapse helpers ────────────────────────────────────

function expandAll(editor) {
  const tr = editor.state.tr;
  let changed = false;
  editor.state.doc.descendants((n, p) => {
    if (n.type.name === "detailsBlock" && !n.attrs.open) {
      tr.setNodeMarkup(p, null, { ...n.attrs, open: true });
      changed = true;
    }
  });
  if (changed) editor.view.dispatch(tr);
}

function collapseAll(editor) {
  const tr = editor.state.tr;
  let changed = false;
  editor.state.doc.descendants((n, p) => {
    if (n.type.name === "detailsBlock" && n.attrs.open) {
      tr.setNodeMarkup(p, null, { ...n.attrs, open: false });
      changed = true;
    }
  });
  if (changed) editor.view.dispatch(tr);
}

// ─── Markdown Panel ─────────────────────────────────────────────

function MarkdownPanel({ markdown, isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div
      style={{
        width: 400,
        borderLeft: "1px solid #e5e7eb",
        display: "flex",
        flexDirection: "column",
        height: "100vh",
      }}
    >
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid #e5e7eb",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>
          Markdown Source
        </span>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 16,
            color: "#9ca3af",
          }}
        >
          x
        </button>
      </div>
      <pre
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "12px 16px",
          fontSize: 12,
          lineHeight: 1.6,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          color: "#374151",
          background: "#fafafa",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          margin: 0,
        }}
      >
        {markdown}
      </pre>
    </div>
  );
}

// ─── Main V3 Component ──────────────────────────────────────────

export default function RecallEditorV3() {
  const [markdownOpen, setMarkdownOpen] = useState(false);
  const [currentMarkdown, setCurrentMarkdown] = useState(SAMPLE_MARKDOWN);

  const editor = useEditor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      DetailsBlock,
      Markdown.configure({
        html: true,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: SAMPLE_MARKDOWN,
    onUpdate({ editor }) {
      const md = editor.storage.markdown.getMarkdown();
      setCurrentMarkdown(md);
    },
  });

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div style={{ flex: 1, padding: "24px 32px", overflowY: "auto" }}>
        {/* Toolbar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginBottom: 16,
            paddingBottom: 12,
            borderBottom: "1px solid #f3f4f6",
            flexWrap: "wrap",
          }}
        >
          {/* Expand All */}
          <button
            onClick={() => editor && expandAll(editor)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 12px",
              fontSize: 12,
              fontWeight: 500,
              borderRadius: 6,
              cursor: "pointer",
              border: "1px solid #e5e7eb",
              background: "white",
              color: "#374151",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#f9fafb";
              e.currentTarget.style.borderColor = "#d1d5db";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "white";
              e.currentTarget.style.borderColor = "#e5e7eb";
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="7 13 12 18 17 13" /><polyline points="7 6 12 11 17 6" />
            </svg>
            Expand All
          </button>

          {/* Collapse All */}
          <button
            onClick={() => editor && collapseAll(editor)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 12px",
              fontSize: 12,
              fontWeight: 500,
              borderRadius: 6,
              cursor: "pointer",
              border: "1px solid #e5e7eb",
              background: "white",
              color: "#374151",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#f9fafb";
              e.currentTarget.style.borderColor = "#d1d5db";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "white";
              e.currentTarget.style.borderColor = "#e5e7eb";
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="17 11 12 6 7 11" /><polyline points="17 18 12 13 7 18" />
            </svg>
            Collapse All
          </button>

          <div style={{ width: 1, height: 20, background: "#e5e7eb", margin: "0 4px" }} />

          {/* Markdown source toggle */}
          <button
            onClick={() => {
              if (!markdownOpen && editor) {
                setCurrentMarkdown(editor.storage.markdown.getMarkdown());
              }
              setMarkdownOpen(!markdownOpen);
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 12px",
              fontSize: 12,
              fontWeight: 500,
              borderRadius: 6,
              cursor: "pointer",
              border: markdownOpen ? "1.5px solid #7c3aed" : "1px solid #e5e7eb",
              background: markdownOpen ? "#f5f3ff" : "white",
              color: markdownOpen ? "#7c3aed" : "#374151",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
              if (!markdownOpen) {
                e.currentTarget.style.background = "#f9fafb";
                e.currentTarget.style.borderColor = "#d1d5db";
              }
            }}
            onMouseLeave={(e) => {
              if (!markdownOpen) {
                e.currentTarget.style.background = "white";
                e.currentTarget.style.borderColor = "#e5e7eb";
              }
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
              <polyline points="13 2 13 9 20 9" />
            </svg>
            Markdown
          </button>
        </div>

        <EditorContent editor={editor} style={{ maxWidth: 640 }} />
      </div>

      <MarkdownPanel
        markdown={currentMarkdown}
        isOpen={markdownOpen}
        onClose={() => setMarkdownOpen(false)}
      />
    </div>
  );
}
