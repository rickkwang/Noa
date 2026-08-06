import React, { useEffect, useRef, useState } from 'react';
import { formatDate } from '../../../lib/templates';
import { AppSettings, UserTemplate } from '../../../types';
import SettingItem from '../SettingItem';
import SettingSection from '../SettingSection';
import SettingsToggle from '../SettingsToggle';

interface EditorSettingsProps {
  settings: AppSettings;
  updateSettings: (updater: (prev: AppSettings) => AppSettings) => void;
  editorViewMode: 'edit' | 'preview' | 'split';
  setEditorViewMode: (mode: 'edit' | 'preview' | 'split') => void;
}

export default function EditorSettings({ settings, updateSettings, editorViewMode, setEditorViewMode }: EditorSettingsProps) {
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
      <SettingSection title="General" description="Configure your writing experience.">
        <SettingItem label="View Mode" description="Switch the current editor view. Restored when Noa opens.">
          <div className="flex space-x-2" role="group" aria-label="Editor view mode">
            {(['edit', 'split', 'preview'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setEditorViewMode(mode)}
                aria-pressed={editorViewMode === mode}
                className={`px-3 py-1.5 font-bold border border-[#2D2D2B] rounded-[3px] text-sm capitalize transition-colors ${
                  editorViewMode === mode
                    ? 'bg-[#CC7D5E] text-white shadow-[inset_2px_2px_0px_0px_rgba(0,0,0,0.2)]'
                    : 'bg-[#F9F9F7] text-[#2D2D2B] hover:bg-[#EFEAE3]'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </SettingItem>
      </SettingSection>

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
              className="bg-[#F9F9F7] border border-[#2D2D2B] rounded-[3px] px-3 py-1.5 text-sm w-40 shadow-[inset_2px_2px_0px_0px_rgba(0,0,0,0.05)] outline-none focus:border-[#CC7D5E]"
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
            className="bg-[#F9F9F7] border border-[#2D2D2B] rounded-[3px] px-3 py-2 text-sm w-full font-redaction shadow-[inset_2px_2px_0px_0px_rgba(0,0,0,0.05)] outline-none focus:border-[#CC7D5E] resize-none"
          />
        </SettingItem>
      </SettingSection>

      <SettingSection title="Custom Templates" description="Create reusable note templates. Supports {{date}}, {{title}}, {{time}}, {{week}}, {{weeknum}}.">
        <div className="space-y-2">
          {userTemplates.map(t => (
            <div key={t.id} className="border border-[#2D2D2B] rounded p-3 flex items-center justify-between gap-3">
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
              className="border border-[#2D2D2B] rounded p-3 space-y-3 mt-2"
              onKeyDown={(e) => { if (e.key === 'Escape') cancelEdit(); }}
            >
              <div>
                <div className="text-xs font-bold mb-1">Name</div>
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
                <div className="text-xs font-bold mb-1">Content</div>
                <textarea
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  rows={7}
                  placeholder={"# {{title}}\n\n{{date}}\n\n"}
                  aria-label="Template content"
                  className="bg-[#F9F9F7] border border-[#2D2D2B] rounded-[3px] px-3 py-2 text-sm w-full font-redaction outline-none focus:border-[#CC7D5E] resize-none"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={saveTemplate}
                  disabled={!editName.trim()}
                  className="border border-[#2D2D2B] bg-[#2D2D2B] text-[#F9F9F7] rounded-[3px] px-3 py-1 text-xs font-bold active:opacity-70 disabled:opacity-50 disabled:pointer-events-none"
                >
                  Save
                </button>
                <button
                  onClick={cancelEdit}
                  className="border border-[#2D2D2B] rounded-[3px] px-3 py-1 text-xs font-bold active:opacity-70"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {editingId === null && (
            <button
              onClick={openNew}
              className="border border-[#2D2D2B] rounded-[3px] px-3 py-1.5 text-xs font-bold w-full text-left active:opacity-70 hover:bg-[#EFEAE3] mt-1"
            >
              + New Template
            </button>
          )}
        </div>
      </SettingSection>

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
    </div>
  );
}
