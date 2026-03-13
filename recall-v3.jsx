/**
 * Recall Editor V3
 *
 * Markdown-first TipTap editor with collapsible checklists and subtasks.
 * All content stored as GFM Markdown. TipTap is the interactive editing layer.
 * Features:
 * - TaskList + TaskItem with nested subtasks (3+ levels)
 * - Custom DetailsBlock node (<details>/<summary>) for collapsible sections
 * - Round-trip Markdown fidelity via tiptap-markdown
 */

import React, { useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { Node, mergeAttributes } from "@tiptap/core";
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

// ─── DetailsBlock Nodes ─────────────────────────────────────────
// Three nodes form the collapsible structure:
// detailsBlock > detailsSummary + detailsContent

const DetailsSummary = Node.create({
  name: "detailsSummary",
  content: "inline*",
  defining: true,
  selectable: false,

  parseHTML() {
    return [{ tag: "summary" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "summary",
      mergeAttributes(HTMLAttributes, {
        style: "font-weight:500;font-size:14px;cursor:pointer;color:#1a1a1a;outline:none;",
      }),
      0,
    ];
  },
});

const DetailsContent = Node.create({
  name: "detailsContent",
  content: "block+",
  defining: true,

  parseHTML() {
    return [{ tag: "div[data-details-content]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-details-content": "",
        style: "padding:6px 0 8px 8px;",
      }),
      0,
    ];
  },
});

const DetailsBlock = Node.create({
  name: "detailsBlock",
  group: "block",
  content: "detailsSummary detailsContent",
  defining: true,

  addAttributes() {
    return {
      open: {
        default: false,
        parseHTML: (el) => el.hasAttribute("open"),
        renderHTML: (attrs) => (attrs.open ? { open: "open" } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "details" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "details",
      mergeAttributes(HTMLAttributes, {
        style:
          "border-radius:8px;border:1px solid #e5e7eb;margin-bottom:4px;padding:4px 10px;transition:all 0.15s ease;",
      }),
      0,
    ];
  },
});

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
      DetailsSummary,
      DetailsContent,
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
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="7 13 12 18 17 13" />
              <polyline points="7 6 12 11 17 6" />
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
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="17 11 12 6 7 11" />
              <polyline points="17 18 12 13 7 18" />
            </svg>
            Collapse All
          </button>

          <div
            style={{
              width: 1,
              height: 20,
              background: "#e5e7eb",
              margin: "0 4px",
            }}
          />

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
              border: markdownOpen
                ? "1.5px solid #7c3aed"
                : "1px solid #e5e7eb",
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
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
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
