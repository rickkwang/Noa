import React, { useEffect, useRef, useState } from 'react';
import { formatDate } from '../../../lib/templates';
import { AppSettings, UserTemplate } from '../../../types';
import SegmentedControl from '../SegmentedControl';
import SettingItem from '../SettingItem';
import SettingSection from '../SettingSection';
import SettingsToggle from '../SettingsToggle';

interface WritingSettingsProps {
  // One file, two tabs — the same arrangement DataSettings uses for Workspace
  // and Data. 'general' renders the app-wide writing behaviour (editor view,
  // search), 'notes' the note-authoring settings (daily notes, templates).
  // They share this component because they share the same settings object and
  // the same update path; splitting the file would duplicate both.
  group: 'general' | 'notes';
  settings: AppSettings;
  updateSettings: (updater: (prev: AppSettings) => AppSettings) => void;
  editorViewMode: 'edit' | 'preview' | 'split';
  setEditorViewMode: (mode: 'edit' | 'preview' | 'split') => void;
}

const VIEW_MODE_OPTIONS = [
  { value: 'edit', label: 'Edit' },
  { value: 'split', label: 'Split' },
  { value: 'preview', label: 'Preview' },
] as const;

export default function WritingSettings({ group, settings, updateSettings, editorViewMode, setEditorViewMode }: WritingSettingsProps) {
  const userTemplates = settings.templates?.userTemplates ?? [];

  // Editing state: null = not editing, 'new' = creating, string = editing existing id
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editContent, setEditContent] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const editFormRef = useRef<HTMLDivElement>(null);

  // The edit form renders at the bottom of the list regardless of which item
  // was clicked — bring it into view so "Edit" doesn't look like a no-op.
  useEffect(() => {
    if (editingId !== null) editFormRef.current?.scrollIntoView({ block: 'nearest' });
  }, [editingId]);

  const openNew = () => {
    setEditingId('new');
    setEditName('');
    setEditContent('');
  };

  const openEdit = (t: UserTemplate) => {
    setEditingId(t.id);
    setEditName(t.name);
    setEditContent(t.content);
  };

  const cancelEdit = () => setEditingId(null);

  const saveTemplate = () => {
    const name = editName.trim();
    if (!name) return;
    if (editingId === 'new') {
      const newTemplate: UserTemplate = {
        id: `tpl-${Date.now()}`,
        name,
        content: editContent,
        createdAt: new Date().toISOString(),
      };
      updateSettings(s => ({
        ...s,
        templates: { userTemplates: [...(s.templates?.userTemplates ?? []), newTemplate] },
      }));
    } else {
      updateSettings(s => ({
        ...s,
        templates: {
          userTemplates: (s.templates?.userTemplates ?? []).map(t =>
            t.id === editingId ? { ...t, name, content: editContent } : t
          ),
        },
      }));
    }
    setEditingId(null);
  };

  const deleteTemplate = (id: string) => {
    updateSettings(s => ({
      ...s,
      templates: {
        userTemplates: (s.templates?.userTemplates ?? []).filter(t => t.id !== id),
      },
    }));
    setConfirmDeleteId(null);
  };

  return (
    <div className="space-y-8">
      {group === 'general' && (
        <SettingSection title="Editor" description="How the editor behaves while you write.">
          <SettingItem label="View Mode" description="The view the editor opens in. Restored when Noa opens.">
            <SegmentedControl
              ariaLabel="Editor view mode"
              value={editorViewMode}
              options={VIEW_MODE_OPTIONS}
              onChange={setEditorViewMode}
            />
          </SettingItem>
        </SettingSection>
      )}

      {group === 'notes' && (<>
        <SettingSection title="Daily Notes" description="Configure automatic daily note creation.">
          <SettingItem label="Enable Daily Notes" description="Show the daily note button in the toolbar.">
            <SettingsToggle
              checked={settings.corePlugins.dailyNotes}
              label="Enable Daily Notes"
              onChange={(v) => updateSettings(s => ({ ...s, corePlugins: { ...s.corePlugins, dailyNotes: v } }))}
            />
          </SettingItem>
          <SettingItem label="Date Format" description="Format for the daily note title. Uses YYYY MM DD HH mm tokens.">
            <div className="space-y-1">
              <input
                type="text"
                value={settings.dailyNotes.dateFormat}
                onChange={(e) => updateSettings(s => ({ ...s, dailyNotes: { ...s.dailyNotes, dateFormat: e.target.value } }))}
                placeholder="YYYY-MM-DD"
                aria-label="Daily note date format"
                className="bg-[#F9F9F7] border border-[#2D2D2B] rounded-[3px] px-3 py-1.5 text-sm w-40 outline-none focus:border-[#CC7D5E]"
              />
              {settings.dailyNotes.dateFormat.trim() && (
                <p className="text-xs text-[#2D2D2B]/60">Today: {formatDate(settings.dailyNotes.dateFormat)}</p>
            )}
          </div>
        </SettingItem>
        <SettingItem label="Template" description="Content pre-filled in each new daily note. Supports {{date}}, {{title}}, {{time}}, {{week}}, {{weeknum}}.">
          <textarea
            value={settings.dailyNotes.template}
            onChange={(e) => updateSettings(s => ({ ...s, dailyNotes: { ...s.dailyNotes, template: e.target.value } }))}
            placeholder={"# {{date}}\n\n## Notes\n\n"}
            rows={5}
            aria-label="Daily note template"
            className="bg-[#F9F9F7] border border-[#2D2D2B] rounded-[3px] px-3 py-2 text-sm w-full font-redaction outline-none focus:border-[#CC7D5E] resize-none"
          />
        </SettingItem>
      </SettingSection>

      <SettingSection title="Custom Templates" description="Create reusable note templates. Supports {{date}}, {{title}}, {{time}}, {{week}}, {{weeknum}}.">
        <div className="space-y-2">
          {userTemplates.map(t => (
            <div key={t.id} className="border border-[var(--divider-subtle)] rounded p-3 flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{t.name}</div>
                {t.content && (
                  <div className="text-xs text-[#2D2D2B]/50 truncate mt-0.5">{t.content.slice(0, 60)}{t.content.length > 60 ? '…' : ''}</div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => openEdit(t)}
                  className="border border-[#2D2D2B] rounded-[3px] px-2 py-1 text-xs active:opacity-70"
                >
                  Edit
                </button>
                {confirmDeleteId === t.id ? (
                  <button
                    onClick={() => deleteTemplate(t.id)}
                    className="border border-[#C24444] text-[#C24444] rounded-[3px] px-2 py-1 text-xs active:opacity-70"
                  >
                    Confirm?
                  </button>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(t.id)}
                    className="border border-[#2D2D2B] rounded-[3px] px-2 py-1 text-xs active:opacity-70"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}

          {editingId !== null && (
            <div
              ref={editFormRef}
              className={`space-y-3 ${userTemplates.length > 0 ? 'border-t border-[var(--divider-subtle)] pt-4 mt-4' : ''}`}
              onKeyDown={(e) => { if (e.key === 'Escape') cancelEdit(); }}
            >
              <div>
                <div className="text-xs font-medium text-[#2D2D2B]/70 mb-1.5">Name</div>
                <input
                  type="text"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  maxLength={60}
                  placeholder="Template name"
                  aria-label="Template name"
                  className="bg-[#F9F9F7] border border-[#2D2D2B] rounded-[3px] px-3 py-1.5 text-sm w-full outline-none focus:border-[#CC7D5E]"
                  autoFocus
                />
              </div>
              <div>
                <div className="text-xs font-medium text-[#2D2D2B]/70 mb-1.5">Content</div>
                <textarea
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  rows={7}
                  placeholder={"# {{title}}\n\n{{date}}\n\n"}
                  aria-label="Template content"
                  className="bg-[#F9F9F7] border border-[#2D2D2B] rounded-[3px] px-3 py-2 text-sm w-full font-redaction outline-none focus:border-[#CC7D5E] resize-none"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={cancelEdit}
                  className="rounded-[3px] px-3 py-1.5 text-xs font-medium text-[#2D2D2B]/70 transition-colors hover:bg-[#EFEAE3] hover:text-[#2D2D2B] active:opacity-70"
                >
                  Cancel
                </button>
                <button
                  onClick={saveTemplate}
                  disabled={!editName.trim()}
                  className="border border-[#2D2D2B] bg-[#2D2D2B] text-[#F9F9F7] rounded-[3px] px-3 py-1.5 text-xs font-medium transition-opacity active:opacity-70 disabled:opacity-40 disabled:pointer-events-none"
                >
                  Save
                </button>
              </div>
            </div>
          )}

          {editingId === null && (
            // Dashed and centred: this adds a row to the list rather than
            // acting on it, and a solid full-width outline read as a second
            // box drawn inside the card. With no templates yet it is also the
            // empty state — one block that explains and invites, instead of a
            // caption stranded above a separate button.
            <button
              onClick={openNew}
              className={`w-full rounded border border-dashed border-[var(--border-strong)] px-3 text-xs font-medium text-[#2D2D2B]/70 transition-colors hover:bg-[#EFEAE3] hover:text-[#2D2D2B] active:opacity-70 ${
                userTemplates.length === 0 ? 'flex flex-col items-center gap-1 py-6' : 'py-2'
              }`}
            >
              <span>+ New Template</span>
              {userTemplates.length === 0 && (
                <span className="text-[11px] font-normal text-[#2D2D2B]/50">
                  A reusable starting point for new notes
                </span>
              )}
            </button>
          )}
        </div>
      </SettingSection>
      </>)}

      {group === 'general' && (
        <SettingSection title="Search" description="Control how notes are searched.">
          <SettingItem label="Fuzzy Search" description="Match approximate spellings and partial words. Disable for exact-only matching.">
            <SettingsToggle
              checked={settings.search.fuzzySearch}
              label="Fuzzy Search"
              onChange={(v) => updateSettings(s => ({ ...s, search: { ...s.search, fuzzySearch: v } }))}
            />
          </SettingItem>
          <SettingItem label="Case Sensitive" description="Match uppercase and lowercase characters exactly.">
            <SettingsToggle
              checked={settings.search.caseSensitive}
              label="Case Sensitive"
              onChange={(v) => updateSettings(s => ({ ...s, search: { ...s.search, caseSensitive: v } }))}
            />
          </SettingItem>
        </SettingSection>
      )}
    </div>
  );
}
