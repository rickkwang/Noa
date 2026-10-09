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
    // Order matters: connect() on a live vault skips the dirty-edit guards and merges into a stale cache.
    expect(switchBody.indexOf('await handleDisconnectFolder();'))
      .toBeLessThan(switchBody.indexOf('await connect();'));
  });

  it('keeps the footer busy latch off the onboarding dialog trigger', async () => {
    const app = await readFile(appPath, 'utf8');

    // Reusing vaultOnboardingBusy would force-show the onboarding modal mid-switch.
    expect(app).toContain('const [vaultActionBusy, setVaultActionBusy] = useState(false);');
    expect(app).toContain('|| vaultOnboardingBusy;');
    expect(app).toContain('busy: vaultActionBusy,');
    // All three vault actions must take the latch.
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
    // The only consent gate for a disconnect that deletes vault notes, so it must name that.
    expect(footer).toContain('leave the workspace');
    expect(footer).toContain('tabs close');
    expect(footer).toContain('files on');
    expect(footer).toContain('no vault until you reconnect');
    // onSwitchVault fires from exactly one place: the confirmation's Continue.
    expect(footer.match(/run\(onSwitchVault\)/g) ?? []).toHaveLength(1);
  });

  it('keeps its Escape from collapsing the sidebar behind it', async () => {
    const footer = await readFile(footerPath, 'utf8');

    // useSidebarPreview closes on Escape from a later-bubbling window listener.
    const escapeHandler = footer.slice(
      footer.indexOf('const handleEscape'),
      footer.indexOf("document.addEventListener('mousedown'")
    );
    expect(escapeHandler).toContain('e.stopPropagation();');
  });

  it('states workspace and vault as separate rows rather than one conflated label', async () => {
    const footer = await readFile(footerPath, 'utf8');

    // The label is always the workspace; collapsing it into the vault name hid the workspace.
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

  it('carries the Calendar and Tags toggles in the one footer row', async () => {
    const [footer, tagBrowser, calendar, sidebar] = await Promise.all([
      readFile(footerPath, 'utf8'),
      readFile(tagBrowserPath, 'utf8'),
      readFile(fileURLToPath(new URL('../../src/components/CalendarPanel.tsx', import.meta.url)), 'utf8'),
      readFile(fileURLToPath(new URL('../../src/components/Sidebar.tsx', import.meta.url)), 'utf8'),
    ]);

    // One footer row: Sidebar owns the panels' open state and hands the toggles to the footer.
    expect(tagBrowser).not.toContain('aria-expanded');
    expect(calendar).not.toContain('aria-expanded');
    expect(footer).toContain('{actions}');
    expect(footer).toContain('className={footerIconButton()}');
    expect(sidebar).toContain('aria-label="Calendar"');
    expect(sidebar).toContain('aria-label="Tags"');
    expect(sidebar).toContain('className={footerIconButton(isCalendarOpen)}');
    expect(sidebar).toContain('className={footerIconButton(isTagsOpen)}');
    // Open state must swap the class: ThemeInjector's !important /70 class would beat an inline colour.
    expect(footer).toContain("${active ? 'text-[#CC7D5E]' : 'text-[#2D2D2B]/70'}");
    // Footer always has a divider; panels only while mounted, so closed panels don't stack a second line.
    expect(footer).toContain('shrink-0 border-t pl-1.5 pr-1 py-1');
    expect(calendar).toContain("${isBodyMounted ? 'border-t' : ''}");
    expect(tagBrowser).toContain("${isBodyMounted ? 'border-t' : ''}");
    expect(footer).toContain('<Settings size={14} />');
  });

  it('uses only dark-mode-remapped text colors', async () => {
    const [footer, indexCss] = await Promise.all([
      readFile(footerPath, 'utf8'),
      readFile(indexCssPath, 'utf8'),
    ]);

    // Dark theme remaps these classes per opacity step; a step with no rule keeps near-black text on dark.
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
