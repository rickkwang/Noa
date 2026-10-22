import { useDesktopUpdater } from '../../hooks/useDesktopUpdater';
import { CircleArrowUp } from '@/src/lib/icons';

/**
 * Sidebar-footer pill shown once the desktop updater has found a new version; absent on the web and when up to date.
 * Settings → App Update stays the full panel (status text, manual check).
 */
export function UpdateButton() {
  const { isDesktop, status, busy, installUpdate } = useDesktopUpdater();
  if (!isDesktop) return null;

  // A failed install leaves the release-page link; the pill stays so the update isn't lost behind Settings.
  const visible =
    status.state === 'available' || status.state === 'downloading' || status.state === 'ready' ||
    status.state === 'downloaded' || (status.state === 'error' && Boolean(status.downloadUrl));
  if (!visible) return null;

  const label =
    status.state === 'downloading' ? (status.progress != null ? `Updating ${status.progress}%` : 'Updating…') :
    status.state === 'ready' ? 'Restart' :
    // macOS installs, then the main process quits the app on its own; a second click would start another download.
    status.state === 'downloaded' ? 'Restarting…' :
    'Update';
  const disabled = busy || status.state === 'downloading' || status.state === 'downloaded';

  return (
    <button
      onClick={() => void installUpdate()}
      disabled={disabled}
      // The main process's 'available' message points at Settings' "Download Update" button, so that state says its own.
      title={status.state === 'available' ? `Noa v${status.version ?? ''} is available` : status.message || 'Update Noa'}
      aria-label={status.version ? `${label} Noa to v${status.version}` : `${label} Noa`}
      className="noa-press mr-1 flex h-6 shrink-0 items-center gap-1 rounded-full pl-1.5 pr-2.5 text-caption font-ui tabular-nums bg-[color-mix(in_srgb,var(--accent-color,#CC7D5E)_12%,transparent)] text-[var(--accent-color,#CC7D5E)] hover:bg-[color-mix(in_srgb,var(--accent-color,#CC7D5E)_20%,transparent)] transition-colors cursor-pointer disabled:cursor-default disabled:hover:bg-[color-mix(in_srgb,var(--accent-color,#CC7D5E)_12%,transparent)]"
    >
      <CircleArrowUp size={14} className={status.state === 'downloading' ? 'animate-pulse' : ''} />
      <span>{label}</span>
    </button>
  );
}
