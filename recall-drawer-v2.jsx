/**
 * Recall Editor
 *
 * Single Tiptap editor. Tasks are collapsible block nodes with
 * editable content. Sections are just headings. No metadata drawer.
 * Suggestions (redlines) are inline marks at any granularity.
 * Change history tracks every edit with persona attribution.
 */

import React, { useState, useEffect, useRef } from "react";
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

// ─── Suggestion Marks ───────────────────────────────────────────

const SuggestionInsert = Mark.create({
  name: "suggestionInsert",
  inclusive: false,
  addAttributes() {
    return {
      author: { default: "coach" },
      id: { default: null },
    };
  },
  parseHTML() { return [{ tag: "span[data-suggestion-insert]" }]; },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes({ "data-suggestion-insert": "", class: "suggestion-insert" }, HTMLAttributes), 0];
  },
});

const SuggestionDelete = Mark.create({
  name: "suggestionDelete",
  inclusive: false,
  addAttributes() {
    return {
      author: { default: "coach" },
      id: { default: null },
    };
  },
  parseHTML() { return [{ tag: "span[data-suggestion-delete]" }]; },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes({ "data-suggestion-delete": "", class: "suggestion-delete" }, HTMLAttributes), 0];
  },
});

const SuggestionClickHandler = Extension.create({
  name: "suggestionClickHandler",
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey("suggestionClickHandler"),
        props: {
          handleClick(view, pos) {
            const marks = view.state.doc.resolve(pos).marks();
            const mark = marks.find((m) => m.type.name === "suggestionInsert" || m.type.name === "suggestionDelete");
            if (mark) {
              editor.storage.recallTask?.onSuggestionClick?.({
                id: mark.attrs.id,
                markType: mark.type.name === "suggestionInsert" ? "insert" : "delete",
                coords: view.coordsAtPos(pos),
              });
              return false;
            }
            editor.storage.recallTask?.onSuggestionClick?.(null);
            return false;
          },
        },
      }),
    ];
  },
});

function acceptSuggestion(editor, id) {
  let tr = editor.state.tr;
  const removals = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    node.marks.forEach((m) => {
      if (m.attrs.id !== id) return;
      if (m.type.name === "suggestionInsert") tr.removeMark(pos, pos + node.nodeSize, m.type);
      else if (m.type.name === "suggestionDelete") removals.push({ from: pos, to: pos + node.nodeSize });
    });
  });
  removals.sort((a, b) => b.from - a.from).forEach(({ from, to }) => tr.delete(from, to));
  tr.setMeta("persona", "user");
  tr.setMeta("changeDescription", `Accepted suggestion`);
  editor.view.dispatch(tr);
}

function rejectSuggestion(editor, id) {
  let tr = editor.state.tr;
  const removals = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    node.marks.forEach((m) => {
      if (m.attrs.id !== id) return;
      if (m.type.name === "suggestionInsert") removals.push({ from: pos, to: pos + node.nodeSize });
      else if (m.type.name === "suggestionDelete") tr.removeMark(pos, pos + node.nodeSize, m.type);
    });
  });
  removals.sort((a, b) => b.from - a.from).forEach(({ from, to }) => tr.delete(from, to));
  tr.setMeta("persona", "user");
  tr.setMeta("changeDescription", `Rejected suggestion`);
  editor.view.dispatch(tr);
}

function bulkSuggestionAction(editor, action) {
  const ids = new Set();
  editor.state.doc.descendants((node) => {
    if (!node.isText) return;
    node.marks.forEach((m) => {
      if (m.type.name === "suggestionInsert" || m.type.name === "suggestionDelete") ids.add(m.attrs.id);
    });
  });
  ids.forEach((id) => (action === "accept" ? acceptSuggestion : rejectSuggestion)(editor, id));
}

function coachInsertText(editor, pos, text) {
  const id = "sug_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
  const mark = editor.state.schema.marks.suggestionInsert.create({ id, author: "coach" });
  const tr = editor.state.tr.insert(pos, editor.state.schema.text(text, [mark]));
  tr.setMeta("persona", "coach");
  tr.setMeta("changeDescription", `Suggested adding "${text.slice(0, 40)}${text.length > 40 ? "…" : ""}"`);
  editor.view.dispatch(tr);
  return id;
}

function coachDeleteRange(editor, from, to) {
  const id = "sug_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
  const text = editor.state.doc.textBetween(from, to);
  const tr = editor.state.tr.addMark(from, to, editor.state.schema.marks.suggestionDelete.create({ id, author: "coach" }));
  tr.setMeta("persona", "coach");
  tr.setMeta("changeDescription", `Suggested removing "${text.slice(0, 40)}${text.length > 40 ? "…" : ""}"`);
  editor.view.dispatch(tr);
  return id;
}

// ─── Change History Plugin ──────────────────────────────────────
// Coalesces consecutive same-persona edits within a time window
// into a single entry, similar to Google Docs version history.

const changeHistoryKey = new PluginKey("changeHistory");
const COALESCE_WINDOW_MS = 3000; // 3 seconds

const ChangeHistoryPlugin = Extension.create({
  name: "changeHistory",

  addProseMirrorPlugins() {
    const editor = this.editor;

    return [
      new Plugin({
        key: changeHistoryKey,
        state: {
          init() {
            return { entries: [], pending: null };
          },
          apply(tr, state) {
            if (!tr.docChanged) return state;

            const persona = tr.getMeta("persona") || "user";
            const description = tr.getMeta("changeDescription");
            const now = Date.now();

            // Explicit descriptions (coach suggestions, task creation, etc.)
            // always get their own entry — no coalescing
            if (description) {
              const entries = finalizePending(state, editor);
              const entry = {
                id: now + "_" + Math.random().toString(36).slice(2, 6),
                persona,
                description,
                timestamp: new Date(),
              };
              const newEntries = [...entries, entry].slice(-100);
              editor.storage.changeHistory = newEntries;
              editor.storage.recallTask?.onHistoryChange?.(newEntries);
              return { entries: newEntries, pending: null };
            }

            // Implicit edits (typing) — coalesce with pending if same persona and within window
            const pending = state.pending;
            if (
              pending &&
              pending.persona === persona &&
              now - pending.lastTime < COALESCE_WINDOW_MS
            ) {
              // Merge into pending
              const { addedText, removedText } = extractChangedText(tr);
              const newPending = {
                ...pending,
                addedText: pending.addedText + addedText,
                removedText: pending.removedText + removedText,
                lastTime: now,
              };

              // Schedule a flush (will be superseded if another edit comes quickly)
              scheduleFlush(editor, newPending);

              return { entries: state.entries, pending: newPending };
            }

            // Different persona or window expired — finalize previous, start new pending
            const entries = finalizePending(state, editor);
            const { addedText, removedText } = extractChangedText(tr);
            const newPending = {
              id: now + "_" + Math.random().toString(36).slice(2, 6),
              persona,
              addedText,
              removedText,
              startTime: now,
              lastTime: now,
              timestamp: new Date(),
            };

            scheduleFlush(editor, newPending);

            return { entries, pending: newPending };
          },
        },
      }),
    ];
  },
});

function extractChangedText(tr) {
  const oldDoc = tr.before;
  const newDoc = tr.doc;
  let addedText = "";
  let removedText = "";

  tr.steps.forEach((step) => {
    const map = step.getMap();
    map.forEach((oldStart, oldEnd, newStart, newEnd) => {
      if (oldEnd > oldStart) {
        try { removedText += oldDoc.textBetween(oldStart, Math.min(oldEnd, oldDoc.content.size), ""); } catch(e) {}
      }
      if (newEnd > newStart) {
        try { addedText += newDoc.textBetween(newStart, Math.min(newEnd, newDoc.content.size), ""); } catch(e) {}
      }
    });
  });

  return { addedText, removedText };
}

function pendingToEntry(pending) {
  const { addedText, removedText } = pending;
  let desc;
  if (addedText && removedText) {
    desc = `Edited: "${(removedText + addedText).slice(0, 60)}${(removedText + addedText).length > 60 ? "…" : ""}"`;
  } else if (addedText) {
    desc = `Typed "${addedText.slice(0, 60)}${addedText.length > 60 ? "…" : ""}"`;
  } else if (removedText) {
    desc = `Deleted "${removedText.slice(0, 60)}${removedText.length > 60 ? "…" : ""}"`;
  } else {
    desc = "Edited document";
  }
  return {
    id: pending.id,
    persona: pending.persona,
    description: desc,
    timestamp: pending.timestamp,
  };
}

function finalizePending(state, editor) {
  if (!state.pending) return state.entries;
  const entry = pendingToEntry(state.pending);
  const newEntries = [...state.entries, entry].slice(-100);
  editor.storage.changeHistory = newEntries;
  editor.storage.recallTask?.onHistoryChange?.(newEntries);
  return newEntries;
}

let flushTimer = null;
function scheduleFlush(editor, pending) {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    // When the timer fires, finalize the pending entry
    const pluginState = changeHistoryKey.getState(editor.state);
    if (pluginState && pluginState.pending && pluginState.pending.id === pending.id) {
      const entry = pendingToEntry(pluginState.pending);
      const newEntries = [...pluginState.entries, entry].slice(-100);
      editor.storage.changeHistory = newEntries;
      editor.storage.recallTask?.onHistoryChange?.(newEntries);
      // We can't mutate plugin state from outside, but the React side is updated.
      // Next transaction will see the pending is stale and handle it.
    }
  }, COALESCE_WINDOW_MS);
}

// ─── RecallTask Node ────────────────────────────────────────────

const RecallTask = Node.create({
  name: "recallTask",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      id: { default: null },
      title: { default: "Untitled" },
      done: { default: false },
      expanded: { default: false, rendered: false },
    };
  },

  parseHTML() { return [{ tag: "div[data-recall-task]" }]; },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({ "data-recall-task": "" }, HTMLAttributes), 0];
  },
  addNodeView() { return ReactNodeViewRenderer(RecallTaskView); },
});

// ─── Slash Commands ─────────────────────────────────────────────

const SlashCommands = Extension.create({
  name: "slashCommands",
  addProseMirrorPlugins() {
    const editorRef = this.editor;
    return [
      new Plugin({
        key: new PluginKey("slashCommands"),
        props: {
          handleTextInput(view, from, to, text) {
            const { state } = view;
            const $from = state.doc.resolve(from);
            const lineBefore = state.doc.textBetween($from.start(), from, "");
            const fullLine = lineBefore + text;

            if (fullLine === "/task") {
              setTimeout(() => {
                insertNewTask(editorRef);
                const $cur = editorRef.state.doc.resolve(editorRef.state.selection.from);
                editorRef.view.dispatch(editorRef.state.tr.delete($cur.start($cur.depth), $cur.end($cur.depth)));
              }, 0);
              return false;
            }
            if (fullLine === "/subtask") {
              setTimeout(() => insertSubtask(editorRef), 0);
              return false;
            }
            return false;
          },
        },
      }),
    ];
  },
});

function insertNewTask(editor) {
  const id = "task_" + Date.now();
  const { state } = editor;
  const pos = state.selection.$from.after(1);
  const taskNode = state.schema.nodes.recallTask.create(
    { id, title: "New task", expanded: true },
    [state.schema.nodes.paragraph.create()]
  );
  const tr = state.tr.insert(pos, taskNode);
  tr.setMeta("persona", "user");
  tr.setMeta("changeDescription", "Created new task");
  editor.view.dispatch(tr);
}

function insertSubtask(editor) {
  const { state } = editor;
  const { schema } = state;
  const $from = state.doc.resolve(state.selection.from);
  let inside = false;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === "recallTask") { inside = true; break; }
  }
  if (!inside) return;

  const $cur = state.doc.resolve(state.selection.from);
  editor.view.dispatch(state.tr.delete($cur.start($cur.depth), $cur.end($cur.depth)));

  setTimeout(() => {
    const { state: s } = editor;
    const $ins = s.doc.resolve(s.selection.from);
    const parent = $ins.parent;
    const newItem = schema.nodes.taskItem.create({ checked: false }, [schema.nodes.paragraph.create()]);
    const newList = schema.nodes.taskList.create(null, [newItem]);

    let tr;
    if (parent.type.name === "paragraph" && parent.content.size === 0) {
      tr = s.tr.replaceWith($ins.before($ins.depth), $ins.after($ins.depth), newList);
    } else {
      tr = s.tr.insert($ins.after($ins.depth), newList);
    }
    tr.setMeta("persona", "user");
    tr.setMeta("changeDescription", "Added sub-task");
    editor.view.dispatch(tr);
    setTimeout(() => editor.commands.focus(), 10);
  }, 0);
}

// ─── Expand/Collapse helpers ────────────────────────────────────

function expandAll(editor) {
  const tr = editor.state.tr;
  let changed = false;
  editor.state.doc.descendants((n, p) => {
    if (n.type.name === "recallTask" && !n.attrs.expanded) {
      tr.setNodeMarkup(p, null, { ...n.attrs, expanded: true });
      changed = true;
    }
  });
  if (changed) editor.view.dispatch(tr);
}

function collapseAll(editor) {
  const tr = editor.state.tr;
  let changed = false;
  editor.state.doc.descendants((n, p) => {
    if (n.type.name === "recallTask" && n.attrs.expanded) {
      tr.setNodeMarkup(p, null, { ...n.attrs, expanded: false });
      changed = true;
    }
  });
  if (changed) editor.view.dispatch(tr);
}

// ─── Node View ──────────────────────────────────────────────────

function RecallTaskView({ node, getPos, editor }) {
  const { title, done, expanded } = node.attrs;

  const toggleDone = (e) => {
    e.stopPropagation();
    const pos = getPos();
    const tr = editor.state.tr.setNodeMarkup(pos, null, { ...node.attrs, done: !done });
    tr.setMeta("persona", "user");
    tr.setMeta("changeDescription", `Marked "${title}" as ${done ? "not done" : "done"}`);
    editor.view.dispatch(tr);
  };

  const handleClick = () => {
    const pos = getPos();
    const currentNode = editor.state.doc.nodeAt(pos);
    if (currentNode) {
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(pos, null, { ...currentNode.attrs, expanded: !expanded })
      );
    }
  };

  return (
    <NodeViewWrapper>
      <div
        style={{
          borderRadius: 8,
          border: expanded ? "1px solid #d1d5db" : "1px solid transparent",
          marginBottom: 2,
          background: expanded ? "#f9fafb" : "transparent",
          transition: "all 0.15s ease",
        }}
      >
        <div
          onClick={handleClick}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "7px 10px", cursor: "pointer",
            opacity: done ? 0.5 : 1, userSelect: "none",
          }}
        >
          <input
            type="checkbox" checked={done}
            onChange={toggleDone}
            onClick={(e) => e.stopPropagation()}
            style={{ width: 16, height: 16, flexShrink: 0 }}
          />
          <span style={{
            fontSize: 10, color: "#9ca3af",
            transition: "transform 0.15s ease",
            transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
            flexShrink: 0,
          }}>▶</span>
          <span style={{
            flex: 1,
            textDecoration: done ? "line-through" : "none",
            color: "#1a1a1a", fontWeight: 500, fontSize: 14,
          }}>{title}</span>
        </div>

        <div style={{
          display: expanded ? "block" : "none",
          padding: "6px 10px 12px 37px",
          borderTop: expanded ? "1px solid #f0f0f0" : "none",
        }}>
          <NodeViewContent className="recall-task-content" />
        </div>
      </div>
    </NodeViewWrapper>
  );
}

// ─── Suggestion Tooltip ─────────────────────────────────────────

function SuggestionTooltip({ suggestion, editor, onDismiss }) {
  if (!suggestion) return null;
  const { id, markType, coords } = suggestion;
  return (
    <div style={{
      position: "fixed", left: coords.left, top: coords.top - 40, zIndex: 100,
      display: "flex", gap: 4, background: "white",
      border: "1px solid #e5e7eb", borderRadius: 6,
      padding: "4px 6px", boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
      fontSize: 11, fontWeight: 600,
    }}>
      <span style={{ padding: "2px 6px", color: "#6b7280", alignSelf: "center" }}>
        {markType === "insert" ? "Addition" : "Removal"}
      </span>
      <button onClick={() => { acceptSuggestion(editor, id); onDismiss(); }}
        style={{ padding: "3px 10px", background: "#16a34a", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}>
        Accept
      </button>
      <button onClick={() => { rejectSuggestion(editor, id); onDismiss(); }}
        style={{ padding: "3px 10px", background: "#dc2626", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}>
        Reject
      </button>
    </div>
  );
}

// ─── Change History Panel ───────────────────────────────────────

function ChangeHistoryPanel({ history, isOpen, onToggle }) {
  if (!isOpen) return null;

  const formatTime = (date) => {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  const reversed = [...history].reverse();

  return (
    <div style={{
      width: 320, borderLeft: "1px solid #e5e7eb",
      display: "flex", flexDirection: "column", height: "100vh",
    }}>
      <div style={{
        padding: "12px 16px", borderBottom: "1px solid #e5e7eb",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Change History</span>
        <button onClick={onToggle} style={{
          background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#9ca3af",
        }}>×</button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
        {reversed.length === 0 && (
          <div style={{ padding: "20px 16px", color: "#9ca3af", fontSize: 12, textAlign: "center" }}>
            No changes yet. Start editing to see history.
          </div>
        )}
        {reversed.map((entry) => (
          <div key={entry.id} style={{
            padding: "8px 16px",
            borderBottom: "1px solid #f9fafb",
            fontSize: 12,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
              <span style={{
                display: "inline-block",
                width: 6, height: 6, borderRadius: "50%",
                background: entry.persona === "coach" ? "#7c3aed" : "#3b82f6",
                flexShrink: 0,
              }} />
              <span style={{
                fontWeight: 600,
                color: entry.persona === "coach" ? "#7c3aed" : "#3b82f6",
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.03em",
              }}>
                {entry.persona === "coach" ? "Coach" : "You"}
              </span>
              <span style={{ color: "#c4b5fd", fontSize: 10, marginLeft: "auto" }}>
                {formatTime(entry.timestamp)}
              </span>
            </div>
            <div style={{ color: "#4b5563", lineHeight: 1.4, paddingLeft: 12 }}>
              {entry.description}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Suggestions Review Panel ────────────────────────────────────

function collectSuggestions(editor) {
  if (!editor) return [];

  const suggestions = new Map(); // id → { id, type, text, context, taskTitle, pos }

  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    node.marks.forEach((mark) => {
      if (mark.type.name !== "suggestionInsert" && mark.type.name !== "suggestionDelete") return;

      const id = mark.attrs.id;
      const existing = suggestions.get(id);

      // Find containing recallTask
      let taskTitle = null;
      const $pos = editor.state.doc.resolve(pos);
      for (let d = $pos.depth; d > 0; d--) {
        if ($pos.node(d).type.name === "recallTask") {
          taskTitle = $pos.node(d).attrs.title;
          break;
        }
      }

      // Get surrounding context (±30 chars around the suggestion)
      const docSize = editor.state.doc.content.size;
      const contextStart = Math.max(0, pos - 30);
      const contextEnd = Math.min(docSize, pos + node.nodeSize + 30);
      let before = "", after = "";
      try { before = editor.state.doc.textBetween(contextStart, pos, ""); } catch(e) {}
      try { after = editor.state.doc.textBetween(pos + node.nodeSize, contextEnd, ""); } catch(e) {}

      if (existing) {
        // Merge text for same suggestion ID (e.g., split across text nodes)
        existing.text += node.text;
      } else {
        suggestions.set(id, {
          id,
          type: mark.type.name === "suggestionInsert" ? "insert" : "delete",
          text: node.text,
          contextBefore: before,
          contextAfter: after,
          taskTitle,
          pos,
          author: mark.attrs.author,
        });
      }
    });
  });

  return Array.from(suggestions.values());
}

function expandTasksWithSuggestions(editor) {
  const tr = editor.state.tr;
  let changed = false;

  // Find positions of all suggestions
  const suggestionPositions = new Set();
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    node.marks.forEach((m) => {
      if (m.type.name === "suggestionInsert" || m.type.name === "suggestionDelete") {
        suggestionPositions.add(pos);
      }
    });
  });

  // Expand tasks containing those positions
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "recallTask") return;
    if (node.attrs.expanded) return;

    const taskEnd = pos + node.nodeSize;
    for (const sugPos of suggestionPositions) {
      if (sugPos >= pos && sugPos < taskEnd) {
        tr.setNodeMarkup(pos, null, { ...node.attrs, expanded: true });
        changed = true;
        break;
      }
    }
  });

  if (changed) editor.view.dispatch(tr);
}

function scrollToSuggestion(editor, pos) {
  // Focus the editor at the suggestion position
  editor.commands.focus();
  editor.commands.setTextSelection(pos);

  // Scroll the DOM element into view
  setTimeout(() => {
    const domPos = editor.view.domAtPos(pos);
    if (domPos && domPos.node) {
      const el = domPos.node.nodeType === 3 ? domPos.node.parentElement : domPos.node;
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, 50);
}

function SuggestionsReviewPanel({ editor, isOpen, onClose, onAccept, onReject }) {
  if (!isOpen || !editor) return null;

  const suggestions = collectSuggestions(editor);

  if (suggestions.length === 0) {
    return (
      <div style={{
        width: 340, borderLeft: "1px solid #e5e7eb",
        display: "flex", flexDirection: "column", height: "100vh",
      }}>
        <div style={{
          padding: "12px 16px", borderBottom: "1px solid #e5e7eb",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Review Suggestions</span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#9ca3af" }}>×</button>
        </div>
        <div style={{ padding: "40px 16px", color: "#9ca3af", fontSize: 13, textAlign: "center" }}>
          No pending suggestions.
        </div>
      </div>
    );
  }

  return (
    <div style={{
      width: 340, borderLeft: "1px solid #e5e7eb",
      display: "flex", flexDirection: "column", height: "100vh",
    }}>
      <div style={{
        padding: "12px 16px", borderBottom: "1px solid #e5e7eb",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>
            Review Suggestions ({suggestions.length})
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#9ca3af" }}>×</button>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => { bulkSuggestionAction(editor, "accept"); }} style={{
            flex: 1, padding: "5px 0", fontSize: 11, fontWeight: 600, borderRadius: 4, cursor: "pointer",
            border: "1px solid #bbf7d0", background: "#f0fdf4", color: "#16a34a",
          }}>Accept All</button>
          <button onClick={() => { bulkSuggestionAction(editor, "reject"); }} style={{
            flex: 1, padding: "5px 0", fontSize: 11, fontWeight: 600, borderRadius: 4, cursor: "pointer",
            border: "1px solid #fecaca", background: "#fef2f2", color: "#dc2626",
          }}>Reject All</button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {suggestions.map((sug) => (
          <div
            key={sug.id}
            onClick={() => scrollToSuggestion(editor, sug.pos)}
            style={{
              padding: "12px 16px",
              borderBottom: "1px solid #f3f4f6",
              cursor: "pointer",
              transition: "background 0.1s",
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = "#fafafa"}
            onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
          >
            {/* Task name */}
            {sug.taskTitle && (
              <div style={{ fontSize: 10, fontWeight: 600, color: "#9ca3af", marginBottom: 4, letterSpacing: "0.03em" }}>
                {sug.taskTitle}
              </div>
            )}

            {/* Context with highlighted change */}
            <div style={{ fontSize: 13, lineHeight: 1.5, color: "#4b5563", marginBottom: 8 }}>
              <span style={{ color: "#9ca3af" }}>
                {sug.contextBefore ? "…" + sug.contextBefore : ""}
              </span>
              <span
                style={sug.type === "insert"
                  ? { background: "#dcfce7", borderBottom: "2px solid #16a34a", padding: "1px 2px" }
                  : { background: "#fee2e2", textDecoration: "line-through", textDecorationColor: "#dc2626", color: "#991b1b", padding: "1px 2px" }
                }
              >
                {sug.text}
              </span>
              <span style={{ color: "#9ca3af" }}>
                {sug.contextAfter ? sug.contextAfter + "…" : ""}
              </span>
            </div>

            {/* Type label + actions */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{
                fontSize: 10, fontWeight: 600, textTransform: "uppercase",
                color: sug.type === "insert" ? "#16a34a" : "#dc2626",
                letterSpacing: "0.03em",
              }}>
                {sug.type === "insert" ? "Addition" : "Removal"}
              </span>
              <span style={{ fontSize: 10, color: "#c4b5fd" }}>
                by {sug.author === "coach" ? "Coach" : "You"}
              </span>
              <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                <button
                  onClick={(e) => { e.stopPropagation(); acceptSuggestion(editor, sug.id); }}
                  style={{
                    padding: "2px 8px", fontSize: 10, fontWeight: 600,
                    background: "#f0fdf4", color: "#16a34a",
                    border: "1px solid #bbf7d0", borderRadius: 3, cursor: "pointer",
                  }}
                >Accept</button>
                <button
                  onClick={(e) => { e.stopPropagation(); rejectSuggestion(editor, sug.id); }}
                  style={{
                    padding: "2px 8px", fontSize: 10, fontWeight: 600,
                    background: "#fef2f2", color: "#dc2626",
                    border: "1px solid #fecaca", borderRadius: 3, cursor: "pointer",
                  }}
                >Reject</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Add Task Button ────────────────────────────────────────────

function AddTaskButton({ editor }) {
  if (!editor) return null;
  return (
    <div style={{ maxWidth: 640, marginTop: 8 }}>
      <button
        onClick={() => insertNewTask(editor)}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "6px 12px", background: "none",
          border: "1px dashed #d1d5db", borderRadius: 6,
          color: "#9ca3af", fontSize: 13, cursor: "pointer",
          width: "100%", justifyContent: "center",
          transition: "all 0.15s ease",
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

// ─── Simulate Coach ─────────────────────────────────────────────

function simulateCoachSuggestions(editor) {
  let firstTaskPos = null;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "recallTask" && firstTaskPos === null) firstTaskPos = pos;
  });
  if (firstTaskPos === null) return;

  const taskNode = editor.state.doc.nodeAt(firstTaskPos);
  if (taskNode && !taskNode.attrs.expanded) {
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(firstTaskPos, null, { ...taskNode.attrs, expanded: true })
    );
  }

  // Suggest replacing "15% cap" with "12% cap"
  let targetFrom = null, targetTo = null;
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || targetFrom !== null) return;
    const idx = node.text.indexOf("15% cap");
    if (idx !== -1) { targetFrom = pos + idx; targetTo = pos + idx + 7; }
  });

  if (targetFrom !== null) {
    const delId = coachDeleteRange(editor, targetFrom, targetTo);
    setTimeout(() => {
      let insertPos = null;
      editor.state.doc.descendants((node, pos) => {
        if (!node.isText || insertPos !== null) return;
        node.marks.forEach((m) => {
          if (m.type.name === "suggestionDelete" && m.attrs.id === delId) insertPos = pos + node.nodeSize;
        });
      });
      if (insertPos !== null) coachInsertText(editor, insertPos, "12% cap");
    }, 50);
  }

  // Suggest a new sub-task
  setTimeout(() => {
    let taskListEnd = null;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "taskList" && taskListEnd === null) taskListEnd = pos + node.nodeSize;
    });
    if (taskListEnd !== null) {
      const sugId = "sug_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
      const mark = editor.state.schema.marks.suggestionInsert.create({ id: sugId, author: "coach" });
      const sugText = editor.state.schema.text("Review Alex's email re: competitor pricing", [mark]);
      const newItem = editor.state.schema.nodes.taskItem.create({ checked: false }, [
        editor.state.schema.nodes.paragraph.create(null, [sugText]),
      ]);
      const tr = editor.state.tr.insert(taskListEnd - 1, newItem);
      tr.setMeta("persona", "coach");
      tr.setMeta("changeDescription", 'Suggested new sub-task: "Review Alex\'s email re: competitor pricing"');
      editor.view.dispatch(tr);
    }
  }, 100);
}

// ─── Main Component ─────────────────────────────────────────────

export default function RecallEditor() {
  const [activeSuggestion, setActiveSuggestion] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [changeLog, setChangeLog] = useState([]);

  const editor = useEditor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      RecallTask,
      SlashCommands,
      SuggestionInsert,
      SuggestionDelete,
      SuggestionClickHandler,
      ChangeHistoryPlugin,
    ],
    content: {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "TODAY" }] },
        {
          type: "recallTask",
          attrs: { id: "1", title: "Confirm volume discount cap with Alex", done: false },
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Alex mentioned the 15% cap might be too aggressive for mid-market deals. Need to validate against last quarter's margins before the SOW goes out." }] },
            { type: "taskList", content: [
              { type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "Pull Q4 margin data from dashboard" }] }] },
              { type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "Check Slack thread with finance team" }] }] },
              { type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "Schedule 15-min sync with Alex" }] }] },
            ]},
          ],
        },
        {
          type: "recallTask",
          attrs: { id: "2", title: "Send updated SOW to Sarah by Friday", done: false },
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Sarah flagged a pricing discrepancy in Section 3. Revised version needs her sign-off before the compliance review." }] },
            { type: "taskList", content: [
              { type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "Fix volume discount cap" }] }] },
              { type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "Run compliance checklist" }] }] },
              { type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "Get finance sign-off" }] }] },
            ]},
          ],
        },

        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "THIS WEEK" }] },
        {
          type: "recallTask",
          attrs: { id: "3", title: "Revisit escalation playbook", done: false },
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Current playbook is from 2024. Need to update with new SLA tiers and routing rules from the Q1 reorg." }] },
          ],
        },
        {
          type: "recallTask",
          attrs: { id: "4", title: "Prep slides for Thursday QBR", done: false },
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Focus on pipeline velocity metrics. Pull data from the new dashboard Alex set up." }] },
          ],
        },

        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "THIS MONTH" }] },
        {
          type: "recallTask",
          attrs: { id: "5", title: "Evaluate new CRM migration timeline", done: false },
          content: [
            { type: "paragraph", content: [{ type: "text", text: "IT wants to push to Q3 but sales ops needs the custom fields before the mid-market push." }] },
          ],
        },

        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "NOTES" }] },
        { type: "paragraph", content: [{ type: "text", text: "I think we're overcomplicating the pricing tiers. The original 3-tier structure worked for 80% of deals." }] },
      ],
    },
    onCreate({ editor }) {
      editor.storage.recallTask = {
        onSuggestionClick: (s) => setActiveSuggestion(s),
        onHistoryChange: (log) => setChangeLog([...log]),
      };
    },
  });

  // Count suggestions
  let suggestionCount = 0;
  if (editor) {
    const ids = new Set();
    editor.state.doc.descendants((node) => {
      if (!node.isText) return;
      node.marks.forEach((m) => {
        if (m.type.name === "suggestionInsert" || m.type.name === "suggestionDelete") ids.add(m.attrs.id);
      });
    });
    suggestionCount = ids.size;
  }

  // Count expanded tasks
  let expandedCount = 0;
  let totalTasks = 0;
  if (editor) {
    editor.state.doc.descendants((n) => {
      if (n.type.name === "recallTask") {
        totalTasks++;
        if (n.attrs.expanded) expandedCount++;
      }
    });
  }

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <div style={{ flex: 1, padding: "24px 32px", overflowY: "auto" }}>
        {/* Toolbar */}
        <div style={{
          display: "flex", alignItems: "center", gap: 6, marginBottom: 16,
          paddingBottom: 12, borderBottom: "1px solid #f3f4f6", flexWrap: "wrap",
        }}>
          {/* Expand All */}
          <button onClick={() => editor && expandAll(editor)} style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "5px 12px", fontSize: 12, fontWeight: 500, borderRadius: 6, cursor: "pointer",
            border: "1px solid #e5e7eb", background: "white", color: "#374151",
            transition: "all 0.15s ease",
          }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#f9fafb"; e.currentTarget.style.borderColor = "#d1d5db"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "white"; e.currentTarget.style.borderColor = "#e5e7eb"; }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="7 13 12 18 17 13" /><polyline points="7 6 12 11 17 6" />
            </svg>
            Expand All
          </button>

          {/* Collapse All */}
          <button onClick={() => editor && collapseAll(editor)} style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "5px 12px", fontSize: 12, fontWeight: 500, borderRadius: 6, cursor: "pointer",
            border: "1px solid #e5e7eb", background: "white", color: "#374151",
            transition: "all 0.15s ease",
          }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#f9fafb"; e.currentTarget.style.borderColor = "#d1d5db"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "white"; e.currentTarget.style.borderColor = "#e5e7eb"; }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="17 11 12 6 7 11" /><polyline points="17 18 12 13 7 18" />
            </svg>
            Collapse All
          </button>

          <div style={{ width: 1, height: 20, background: "#e5e7eb", margin: "0 4px" }} />

          {/* Suggestions review */}
          {suggestionCount > 0 && (
            <button
              onClick={() => {
                setReviewOpen(true);
                setHistoryOpen(false);
                expandTasksWithSuggestions(editor);
              }}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "5px 12px", fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: "pointer",
                border: reviewOpen ? "1.5px solid #92400e" : "1px solid #fde68a",
                background: reviewOpen ? "#fef3c7" : "#fffbeb",
                color: "#92400e",
                transition: "all 0.15s ease",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" /><line x1="9" y1="15" x2="15" y2="15" />
              </svg>
              {suggestionCount} pending — Review
            </button>
          )}

          {/* History toggle */}
          <button onClick={() => { setHistoryOpen(!historyOpen); if (!historyOpen) setReviewOpen(false); }} style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "5px 12px", fontSize: 12, fontWeight: 500, borderRadius: 6, cursor: "pointer",
            border: historyOpen ? "1.5px solid #7c3aed" : "1px solid #e5e7eb",
            background: historyOpen ? "#f5f3ff" : "white",
            color: historyOpen ? "#7c3aed" : "#374151",
            transition: "all 0.15s ease",
          }}
            onMouseEnter={(e) => { if (!historyOpen) { e.currentTarget.style.background = "#f9fafb"; e.currentTarget.style.borderColor = "#d1d5db"; } }}
            onMouseLeave={(e) => { if (!historyOpen) { e.currentTarget.style.background = "white"; e.currentTarget.style.borderColor = "#e5e7eb"; } }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
            History{changeLog.length > 0 ? ` (${changeLog.length})` : ""}
          </button>

          <div style={{ flex: 1 }} />

          {/* Simulate Coach — special demo treatment */}
          <button onClick={() => editor && simulateCoachSuggestions(editor)} style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "5px 12px", fontSize: 11, fontWeight: 500, borderRadius: 6, cursor: "pointer",
            border: "1.5px dashed #d6b4fc", background: "linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%)",
            color: "#7c3aed", letterSpacing: "0.01em",
            transition: "all 0.15s ease",
          }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#a78bfa"; e.currentTarget.style.background = "linear-gradient(135deg, #f3e8ff 0%, #ede9fe 100%)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#d6b4fc"; e.currentTarget.style.background = "linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%)"; }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
            Simulate Coach
            <span style={{ fontSize: 9, opacity: 0.6, fontWeight: 400 }}>(demo)</span>
          </button>
        </div>

        <EditorContent editor={editor} style={{ maxWidth: 640 }} />
        <AddTaskButton editor={editor} />
      </div>

      <SuggestionTooltip suggestion={activeSuggestion} editor={editor} onDismiss={() => setActiveSuggestion(null)} />

      <SuggestionsReviewPanel
        editor={editor}
        isOpen={reviewOpen}
        onClose={() => setReviewOpen(false)}
      />

      <ChangeHistoryPanel history={changeLog} isOpen={historyOpen && !reviewOpen} onToggle={() => setHistoryOpen(false)} />
    </div>
  );
}
