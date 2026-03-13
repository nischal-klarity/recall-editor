import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import RecallEditorV2 from '../recall-drawer-v2.jsx'
import RecallEditorV3 from '../recall-v3.jsx'

function App() {
  const [version, setVersion] = useState('v2')
  const [showModal, setShowModal] = useState(false)
  const pendingVersion = version === 'v2' ? 'v3' : 'v2'

  return (
    <>
      {/* Version badge — fixed bottom-right */}
      <button
        onClick={() => setShowModal(true)}
        style={{
          position: 'fixed',
          bottom: 16,
          right: 16,
          zIndex: 1000,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 14px',
          fontSize: 12,
          fontWeight: 600,
          borderRadius: 20,
          cursor: 'pointer',
          border: '1px solid #e5e7eb',
          background: 'white',
          color: '#374151',
          boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
          transition: 'all 0.15s ease',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.12)'; e.currentTarget.style.borderColor = '#7c3aed'; }}
        onMouseLeave={(e) => { e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'; e.currentTarget.style.borderColor = '#e5e7eb'; }}
      >
        <span style={{
          display: 'inline-block',
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: version === 'v2' ? '#7c3aed' : '#16a34a',
        }} />
        {version.toUpperCase()}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="7 10 12 15 17 10" />
        </svg>
      </button>

      {/* Modal */}
      {showModal && (
        <div
          onClick={() => setShowModal(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 2000,
            background: 'rgba(0,0,0,0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backdropFilter: 'blur(2px)',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'white',
              borderRadius: 16,
              padding: '28px 32px',
              width: 420,
              boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
              animation: 'modalIn 0.15s ease-out',
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a1a', marginBottom: 4 }}>
              Switch Version
            </div>
            <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 20, lineHeight: 1.5 }}>
              Choose the editor architecture to use.
            </div>

            {/* V2 option */}
            <div
              onClick={() => { setVersion('v2'); setShowModal(false); }}
              style={{
                padding: '14px 16px',
                borderRadius: 10,
                border: version === 'v2' ? '2px solid #7c3aed' : '1px solid #e5e7eb',
                background: version === 'v2' ? '#faf5ff' : 'white',
                cursor: 'pointer',
                marginBottom: 10,
                transition: 'all 0.1s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '2px 8px',
                  borderRadius: 4,
                  background: version === 'v2' ? '#7c3aed' : '#e5e7eb',
                  color: version === 'v2' ? 'white' : '#6b7280',
                }}>V2</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a' }}>
                  Recall Editor
                </span>
                {version === 'v2' && (
                  <span style={{ fontSize: 10, color: '#7c3aed', fontWeight: 500, marginLeft: 'auto' }}>Active</span>
                )}
              </div>
              <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.5, paddingLeft: 1 }}>
                Custom RecallTask nodes with inline suggestions (redlines), change history with persona attribution, and coach simulation.
              </div>
            </div>

            {/* V3 option */}
            <div
              onClick={() => { setVersion('v3'); setShowModal(false); }}
              style={{
                padding: '14px 16px',
                borderRadius: 10,
                border: version === 'v3' ? '2px solid #16a34a' : '1px solid #e5e7eb',
                background: version === 'v3' ? '#f0fdf4' : 'white',
                cursor: 'pointer',
                transition: 'all 0.1s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '2px 8px',
                  borderRadius: 4,
                  background: version === 'v3' ? '#16a34a' : '#e5e7eb',
                  color: version === 'v3' ? 'white' : '#6b7280',
                }}>V3</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a' }}>
                  Markdown Checklist
                </span>
                {version === 'v3' && (
                  <span style={{ fontSize: 10, color: '#16a34a', fontWeight: 500, marginLeft: 'auto' }}>Active</span>
                )}
              </div>
              <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.5, paddingLeft: 1 }}>
                Markdown-first storage with collapsible &lt;details&gt; blocks, nested subtasks (3+ levels), and round-trip GFM fidelity.
              </div>
            </div>

            <button
              onClick={() => setShowModal(false)}
              style={{
                marginTop: 16,
                width: '100%',
                padding: '8px 0',
                fontSize: 12,
                fontWeight: 500,
                color: '#9ca3af',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Render active version */}
      <div style={{ display: version === 'v2' ? 'block' : 'none' }}>
        <RecallEditorV2 />
      </div>
      <div style={{ display: version === 'v3' ? 'block' : 'none' }}>
        <RecallEditorV3 />
      </div>
    </>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
