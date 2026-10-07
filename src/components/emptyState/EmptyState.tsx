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

// A few lines per stretch of the day; the day of the year picks one, so the
// greeting holds still for the day and changes tomorrow.
const GREETINGS: { from: number; lines: readonly string[] }[] = [
  { from: 0, lines: ['Still up?', 'The quiet hours.', 'The world’s asleep. You aren’t.'] },
  { from: 5, lines: ['Up with the birds.', 'Early light, empty page.', 'Before the day gets loud.'] },
  { from: 8, lines: ['Good morning.', 'Morning. Coffee first?', 'A fresh page for the day.'] },
  { from: 12, lines: ['Good afternoon.', 'The afternoon is yours.', 'Halfway through the day.'] },
  { from: 17, lines: ['Good evening.', 'The light’s going gold.', 'Evening. Set something down.'] },
  { from: 21, lines: ['Late, but not too late.', 'Night owl hours.', 'One more thought before bed?'] },
];
const WEEKEND: Record<number, string> = { 0: 'Sunday, unhurried.', 6: 'A slow Saturday.' };

function greetingFor(now: Date, hour: number): string {
  const day = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86_400_000);
  const slot = [...GREETINGS].reverse().find((g) => hour >= g.from) ?? GREETINGS[0];
  const pool = WEEKEND[now.getDay()] && hour >= 8 && hour < 17 ? [...slot.lines, WEEKEND[now.getDay()]] : slot.lines;
  return pool[day % pool.length];
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
  const now = new Date();
  const date = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const Scene = scene === 'desk' ? DeskScene : IslandScene;

  return (
    <div className="noa-empty-state flex-1 flex flex-col items-center justify-center select-none">
      <div className={`noa-empty-scene nsc-${scene} nsc-ph-${phase}`}>
        <svg viewBox="0 0 150 96" shapeRendering="crispEdges" aria-hidden="true">
          <Scene key={scene} tier={tier} phase={phase} />
        </svg>
      </div>

      <div className="noa-empty-copy">
        <p className="noa-empty-greeting">{greetingFor(now, hour)}</p>
        <p className="noa-empty-meta">
          {date}
          {noteCount > 0 && <> <span aria-hidden="true">·</span> {noteCount.toLocaleString('en-US')} {noteCount === 1 ? 'note' : 'notes'}</>}
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
