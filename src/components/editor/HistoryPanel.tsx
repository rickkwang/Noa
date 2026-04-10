import React, { useEffect, useRef, useState, useCallback } from 'react';
import { X, RotateCcw, Clock } from 'lucide-react';
import { NoteSnapshot } from '../../types';
import { storage } from '../../lib/storage';

interface HistoryPanelProps {
  noteId: string;
  isDark: boolean;
  onRestore: (snapshot: NoteSnapshot) => Promise<void>;
  onClose: () => void;
}

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(isoString).toLocaleDateString();
}

export function HistoryPanel({ noteId, isDark, onRestore, onClose }: HistoryPanelProps) {
  const [snapshots, setSnapshots] = useState<NoteSnapshot[]>([]);
  const [selected, setSelected] = useState<NoteSnapshot | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    setSelected(null);
    setLoadError(null);
    storage.getSnapshots(noteId)
      .then(snaps => { if (mountedRef.current) setSnapshots(snaps); })
      .catch(() => { if (mountedRef.current) setLoadError('Failed to load history.'); });
  }, [noteId]);

  const handleRestore = useCallback(async () => {
    if (!selected) return;
    if (mountedRef.current) setRestoring(true);
    try {
      await onRestore(selected);
      // onRestore closes the panel (unmounts this component), so guard all
      // subsequent state updates with mountedRef.
      if (mountedRef.current) {
        const updated = await storage.getSnapshots(noteId);
        if (mountedRef.current) {
          setSnapshots(updated);
          setSelected(null);
        }
      }
    } finally {
      if (mountedRef.current) setRestoring(false);
    }
  }, [selected, onRestore, noteId]);

  const bg = isDark ? '#1E1E1C' : '#EAE8E0';
  const border = isDark ? 'rgba(240,237,230,0.1)' : 'rgba(45,45,45,0.15)';
  const textPrimary = isDark ? '#F0EDE6' : '#2D2D2D';
  const textMuted = isDark ? 'rgba(240,237,230,0.45)' : 'rgba(45,45,45,0.55)';
  const accent = isDark ? '#D97757' : '#B89B5E';
  const hoverBg = isDark ? 'rgba(240,237,230,0.05)' : 'rgba(45,45,45,0.05)';
  const selectedBg = isDark ? 'rgba(217,119,87,0.12)' : 'rgba(184,155,94,0.1)';

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: '280px',
        background: bg,
        borderLeft: `1px solid ${border}`,
        display: 'flex',
        flexDirection: 'column',
        zIndex: 30,
        fontFamily: 'inherit',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.625rem 0.75rem',
        borderBottom: `1px solid ${border}`,
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: textPrimary }}>
          <Clock size={13} />
          <span style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            Version History
          </span>
        </div>
        <button
          onClick={onClose}
          style={{ color: textMuted, cursor: 'pointer', background: 'none', border: 'none', padding: '2px', lineHeight: 1 }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Snapshot list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loadError ? (
          <div style={{ padding: '1rem', fontSize: '0.75rem', color: accent }}>{loadError}</div>
        ) : snapshots.length === 0 ? (
          <div style={{ padding: '1.5rem 1rem', fontSize: '0.75rem', color: textMuted, textAlign: 'center' }}>
            No history yet.<br />
            Snapshots are saved 30s after each edit.
          </div>
        ) : (
          snapshots.map((snap) => {
            const isSelected = selected?.savedAt === snap.savedAt;
            return (
              <div
                key={snap.savedAt}
                onClick={() => setSelected(isSelected ? null : snap)}
                style={{
                  padding: '0.6rem 0.75rem',
                  cursor: 'pointer',
                  borderBottom: `1px solid ${border}`,
                  background: isSelected ? selectedBg : 'transparent',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = hoverBg; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = isSelected ? selectedBg : 'transparent'; }}
              >
                <div style={{ fontSize: '0.72rem', fontWeight: 600, color: isSelected ? accent : textPrimary, marginBottom: '0.2rem' }}>
                  {formatRelativeTime(snap.savedAt)}
                </div>
                <div style={{ fontSize: '0.65rem', color: textMuted }}>
                  {new Date(snap.savedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>
                <div style={{
                  fontSize: '0.65rem',
                  color: textMuted,
                  marginTop: '0.25rem',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {snap.content.slice(0, 80).replace(/\n/g, ' ') || '(empty)'}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Preview & restore footer */}
      {selected && (
        <div style={{
          borderTop: `1px solid ${border}`,
          padding: '0.625rem 0.75rem',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
        }}>
          <div style={{
            fontSize: '0.65rem',
            color: textMuted,
            maxHeight: '80px',
            overflowY: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            lineHeight: 1.5,
          }}>
            {selected.content.slice(0, 300)}{selected.content.length > 300 ? '…' : ''}
          </div>
          <button
            onClick={handleRestore}
            disabled={restoring}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.35rem',
              padding: '0.4rem 0.75rem',
              background: accent,
              color: isDark ? '#1E1E1C' : '#fff',
              border: 'none',
              borderRadius: '3px',
              fontSize: '0.72rem',
              fontWeight: 700,
              cursor: restoring ? 'not-allowed' : 'pointer',
              opacity: restoring ? 0.6 : 1,
              width: '100%',
            }}
          >
            <RotateCcw size={12} />
            {restoring ? 'Restoring…' : 'Restore this version'}
          </button>
          <div style={{ fontSize: '0.62rem', color: textMuted, textAlign: 'center' }}>
            Current version will be saved before restoring
          </div>
        </div>
      )}
    </div>
  );
}
