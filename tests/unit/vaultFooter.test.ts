import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const footerPath = fileURLToPath(new URL('../../src/components/sidebar/VaultFooter.tsx', import.meta.url));
const appPath = fileURLToPath(new URL('../../src/App.tsx', import.meta.url));
const tagBrowserPath = fileURLToPath(new URL('../../src/components/sidebar/TagBrowser.tsx', import.meta.url));
const indexCssPath = fileURLToPath(new URL('../../src/index.css', import.meta.url));

describe('sidebar vault footer', () => {
  it('switches vaults by disconnecting first, never by a bare connect()', async () => {
    const app = await readFile(appPath, 'utf8');

    const switchBody = app.slice(
      app.indexOf('const handleSwitchVaultFolder'),
      app.indexOf('const handleConnectVaultFolder')
    );
    expect(switchBody).toContain('await handleDisconnectFolder();');
    expect(switchBody).toContain('await connect();');
    // Order matters: connect() layered on a live vault skips the dirty-edit and
    // pending-structural-op guards and merges into a stale vault cache.
    expect(switchBody.indexOf('await handleDisconnectFolder();'))
      .toBeLessThan(switchBody.indexOf('await connect();'));
  });

  it('keeps the footer busy latch off the onboarding dialog trigger', async () => {
    const app = await readFile(appPath, 'utf8');

    // vaultOnboardingBusy force-shows the onboarding modal; reusing it for the
    // footer's own actions would pop that dialog mid-switch.
    expect(app).toContain('const [vaultActionBusy, setVaultActionBusy] = useState(false);');
    expect(app).toContain('|| vaultOnboardingBusy;');
    expect(app).toContain('busy: vaultActionBusy,');
    // All three vault actions take the latch, or the menu stays clickable
    // through whichever one skipped it.
    expect(app).toContain('void handleConnectVaultFolder();');
    expect(app).toContain('void handleSwitchVaultFolder();');
    expect(app).toContain('void handleDisconnectVaultFolder();');

    const switchBody = app.slice(
      app.indexOf('const handleSwitchVaultFolder'),
      app.indexOf('const handleConnectVaultFolder')
    );
    expect(switchBody).not.toContain('setVaultOnboardingBusy');
  });

  it('confirms before a switch, because a cancelled picker leaves no vault', async () => {
    const footer = await readFile(footerPath, 'utf8');

    expect(footer).toContain('confirmSwitch');
    expect(footer).toContain('onClick={() => setConfirmSwitch(true)}');
    // This prompt is the only consent gate for a disconnect that deletes every
    // vault note and folder from the workspace (useNotes.clearWorkspaceAfterDisconnect),
    // so it has to name that, not just the missing connection.
    expect(footer).toContain('leave the workspace');
    expect(footer).toContain('tabs close');
    expect(footer).toContain('files on');
    expect(footer).toContain('no vault until you reconnect');
    // onSwitchVault fires from exactly one place: the confirmation's Continue.
    expect(footer.match(/run\(onSwitchVault\)/g) ?? []).toHaveLength(1);
  });

  it('keeps its Escape from collapsing the sidebar behind it', async () => {
    const footer = await readFile(footerPath, 'utf8');

    // useSidebarPreview closes the hover preview on Escape from a window
    // listener, which is later in the bubble than this document one.
    const escapeHandler = footer.slice(
      footer.indexOf('const handleEscape'),
      footer.indexOf("document.addEventListener('mousedown'")
    );
    expect(escapeHandler).toContain('e.stopPropagation();');
  });

  it('states workspace and vault as separate rows rather than one conflated label', async () => {
    const footer = await readFile(footerPath, 'utf8');

    // The button label is the workspace — always present — and the vault is a
    // distinct, optional row. Collapsing them hid the workspace whenever a
    // vault was attached, even though most notes may not live in that folder.
    expect(footer).toContain('const label = workspaceName.trim()');
    expect(footer).not.toContain('vaultName ?? workspaceName');
    expect(footer).not.toContain('vaultName || workspaceName');
    expect(footer).toContain('No vault connected');
  });

  it('drops vault actions when the File System Access API is unavailable', async () => {
    const app = await readFile(appPath, 'utf8');

    expect(app).toContain('onConnectVault: canPickVaultFolder');
    expect(app).toContain('onSwitchVault: canPickVaultFolder');
    expect(app).toContain('onDisconnectVault: canPickVaultFolder');
  });

  it('aligns its two icons with the section headers above it', async () => {
    const [footer, tagBrowser] = await Promise.all([
      readFile(footerPath, 'utf8'),
      readFile(tagBrowserPath, 'utf8'),
    ]);

    // Left rail: container pl-1.5 (6px) + button pl-1.5 (6px) = the headers' px-3.
    expect(tagBrowser).toContain('w-full px-3 py-1');
    expect(footer).toContain('border-t pl-1.5 pr-1 py-1');
    expect(footer).toContain('rounded-lg pl-1.5 pr-3.5 py-1');
    // Right rail: pr-1 (4px) + p-1.5 (6px) + half of 14px = the chevrons' 17px.
    expect(footer).toContain('p-1.5 ml-auto shrink-0 rounded-lg');
    expect(footer).toContain('<Settings size={14} />');
  });

  it('uses only dark-mode-remapped text colors', async () => {
    const [footer, indexCss] = await Promise.all([
      readFile(footerPath, 'utf8'),
      readFile(indexCssPath, 'utf8'),
    ]);

    // The dark theme rewrites these classes by exact name, one rule per opacity
    // step. A step with no rule keeps its light value — near-black text on the
    // menu's near-black dark surface. /45 and /55 shipped that way once.
    const stepsIn = (source: string, pattern: RegExp) =>
      new Set([...source.matchAll(pattern)].map((match) => match[1]));

    const remapped = stepsIn(indexCss, /\.text-\\\[\\#2D2D2B\\\]\\\/(\d+)/g);
    const remappedHover = stepsIn(indexCss, /\.hover\\:text-\\\[\\#2D2D2B\\\]\\\/(\d+)/g);
    const used = stepsIn(footer, /(?<!hover:)text-\[#2D2D2B\]\/(\d+)/g);
    const usedHover = stepsIn(footer, /hover:text-\[#2D2D2B\]\/(\d+)/g);

    expect(remapped.size).toBeGreaterThan(0);
    expect([...used].filter((step) => !remapped.has(step))).toEqual([]);
    expect([...usedHover].filter((step) => !remappedHover.has(step))).toEqual([]);
  });
});
