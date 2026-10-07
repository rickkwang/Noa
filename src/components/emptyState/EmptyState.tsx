import React, { useEffect, useState } from 'react';
import { useIsDark } from '../../hooks/useIsDark';
import type { AppSettings, EmptyStateScene } from '../../types';
import DeskScene from './DeskScene';
import IslandScene from './IslandScene';
import { tierForCount, type Phase, type Tier } from './sceneParts';
import './emptyState.css';

interface EmptyStateProps {
  scene: EmptyStateScene;
  theme: AppSettings['appearance']['theme'];
  noteCount: number;
  dailyNotesEnabled: boolean;
  onNewNote: () => void;
  onTodayNote: () => void;
  onGoTo: () => void;
}

const CAPTIONS: Record<EmptyStateScene, readonly string[]> = {
  island: [
    'No notes yet. Write the first one and something will grow here.',
    'A sapling. It grows as you write.',
    'The tree has filled out. Someone left a lantern.',
    'Enough notes for a small house.',
    'There’s a swing on the tree now.',
    'The island has a neighbour.',
  ],
  desk: [
    'No notes yet. The notebook on the desk is open.',
    'Someone made coffee.',
    'A few books, and a lamp to read them by.',
    'The plant on the sill is doing well.',
    'Enough notes to fill a shelf.',
    'On a clear day you can see the island from here.',
  ],
};

function phaseForHour(hour: number): Phase {
  if (hour >= 5 && hour < 8) return 'dawn';
  if (hour >= 8 && hour < 17) return 'day';
  if (hour >= 17 && hour < 19.5) return 'dusk';
  return 'night';
}

function greetingForHour(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  if (hour >= 18) return 'Good evening';
  return 'Still up?';
}

/** Local wall-clock hour as a fraction, refreshed each minute so the sky turns while the page sits open. */
function useLocalHour(): number {
  const read = () => { const now = new Date(); return now.getHours() + now.getMinutes() / 60; };
  const [hour, setHour] = useState(read);
  useEffect(() => {
    const timer = window.setInterval(() => setHour(read()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return hour;
}

export default function EmptyState({
  scene, theme, noteCount, dailyNotesEnabled, onNewNote, onTodayNote, onGoTo,
}: EmptyStateProps) {
  const isDark = useIsDark(theme);
  const hour = useLocalHour();
  // Dark theme is always night: the scene re-lights rather than inverting.
  const phase: Phase = isDark ? 'night' : phaseForHour(hour);
  const tier: Tier = tierForCount(noteCount);
  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const Scene = scene === 'desk' ? DeskScene : IslandScene;

  return (
    <div className="noa-empty-state flex-1 flex flex-col items-center justify-center select-none">
      <div className={`noa-empty-scene nsc-${scene} nsc-ph-${phase}`}>
        <svg viewBox="0 0 150 96" shapeRendering="crispEdges" aria-hidden="true">
          <Scene key={scene} tier={tier} phase={phase} />
        </svg>
      </div>

      <div className="noa-empty-copy">
        <p className="noa-empty-greeting">{greetingForHour(hour)}</p>
        <p className="noa-empty-meta">
          {noteCount === 0 ? date : `${date} · ${noteCount.toLocaleString('en-US')} ${noteCount === 1 ? 'note' : 'notes'}`}
        </p>
        <p className="noa-empty-caption">{CAPTIONS[scene][tier]}</p>
      </div>

      <ul className="noa-empty-actions">
        <li><button type="button" onClick={onNewNote}><span>New note</span><kbd>⌘N</kbd></button></li>
        {dailyNotesEnabled && (
          <li><button type="button" onClick={onTodayNote}><span>Today’s note</span><kbd>⌘⇧K</kbd></button></li>
        )}
        <li><button type="button" onClick={onGoTo}><span>Go to…</span><kbd>⌘K</kbd></button></li>
      </ul>
    </div>
  );
}
