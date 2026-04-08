import React, { useState } from 'react';
import { AppSettings, UserTemplate } from '../../../types';
import SettingSection from '../SettingSection';
import SettingItem from '../SettingItem';

interface EditorSettingsProps {
  settings: AppSettings;
  updateSettings: (updater: (prev: AppSettings) => AppSettings) => void;
  editorViewMode: 'edit' | 'preview' | 'split';
  setEditorViewMode: (mode: 'edit' | 'preview' | 'split') => void;
}

const Toggle = ({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) => (
  <button
    onClick={() => onChange(!value)}
    className={`w-12 h-6 border-2 border-[#2D2D2D] relative transition-colors ${value ? 'bg-[#B89B5E]' : 'bg-[#EAE8E0]'}`}
  >
    <div className={`absolute top-0.5 w-4 h-4 bg-[#EAE8E0] border-2 border-[#2D2D2D] transition-transform ${value ? 'translate-x-6' : 'translate-x-0.5'}`} />
  </button>
);

export default function EditorSettings({ settings, updateSettings, editorViewMode, setEditorViewMode }: EditorSettingsProps) {
  const userTemplates = settings.templates?.userTemplates ?? [];

  // Editing state: null = not editing, 'new' = creating, string = editing existing id
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editContent, setEditContent] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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
        <SettingItem label="Default View Mode" description="Choose how the editor opens by default.">
          <div className="flex space-x-2">
            {(['edit', 'split', 'preview'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setEditorViewMode(mode)}
                className={`px-3 py-1.5 font-bold border-2 border-[#2D2D2D] text-sm capitalize transition-all ${
                  editorViewMode === mode
                    ? 'bg-[#B89B5E] text-white shadow-[inset_2px_2px_0px_0px_rgba(0,0,0,0.2)]'
                    : 'bg-[#EAE8E0] text-[#2D2D2D]'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </SettingItem>
      </SettingSection>

      <SettingSection title="Daily Notes" description="Configure automatic daily note creation.">
        <SettingItem label="Date Format" description="Format for the daily note title. Uses YYYY MM DD HH mm tokens.">
          <input
            type="text"
            value={settings.dailyNotes.dateFormat}
            onChange={(e) => updateSettings(s => ({ ...s, dailyNotes: { ...s.dailyNotes, dateFormat: e.target.value } }))}
            placeholder="YYYY-MM-DD"
            className="bg-[#EAE8E0] border-2 border-[#2D2D2D] px-3 py-1.5 text-sm w-40 shadow-[inset_2px_2px_0px_0px_rgba(0,0,0,0.05)] outline-none focus:border-[#B89B5E]"
          />
        </SettingItem>
        <SettingItem label="Template" description="Content pre-filled in each new daily note. Supports {{date}}, {{title}}, {{time}}, {{week}}, {{weeknum}}.">
          <textarea
            value={settings.dailyNotes.template}
            onChange={(e) => updateSettings(s => ({ ...s, dailyNotes: { ...s.dailyNotes, template: e.target.value } }))}
            placeholder={"# {{date}}\n\n## Notes\n\n"}
            rows={5}
            className="bg-[#EAE8E0] border-2 border-[#2D2D2D] px-3 py-2 text-sm w-full font-redaction shadow-[inset_2px_2px_0px_0px_rgba(0,0,0,0.05)] outline-none focus:border-[#B89B5E] resize-none"
          />
        </SettingItem>
      </SettingSection>

      <SettingSection title="Custom Templates" description="Create reusable note templates. Supports {{date}}, {{title}}, {{time}}, {{week}}, {{weeknum}}.">
        <div className="space-y-2">
          {userTemplates.map(t => (
            <div key={t.id} className="border border-[#2D2D2D] p-3 flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold truncate">{t.name}</div>
                {t.content && (
                  <div className="text-xs text-[#2D2D2D]/50 truncate mt-0.5">{t.content.slice(0, 60)}{t.content.length > 60 ? '…' : ''}</div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => openEdit(t)}
                  className="border border-[#2D2D2D] px-2 py-1 text-xs active:opacity-70"
                >
                  Edit
                </button>
                {confirmDeleteId === t.id ? (
                  <button
                    onClick={() => deleteTemplate(t.id)}
                    className="border border-red-600 text-red-600 px-2 py-1 text-xs active:opacity-70"
                  >
                    Confirm?
                  </button>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(t.id)}
                    className="border border-[#2D2D2D] px-2 py-1 text-xs active:opacity-70"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}

          {editingId !== null && (
            <div className="border-2 border-[#2D2D2D] p-3 space-y-3 mt-2">
              <div>
                <div className="text-xs font-bold mb-1">Name</div>
                <input
                  type="text"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  maxLength={60}
                  placeholder="Template name"
                  className="bg-[#EAE8E0] border-2 border-[#2D2D2D] px-3 py-1.5 text-sm w-full outline-none focus:border-[#B89B5E]"
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
                  className="bg-[#EAE8E0] border-2 border-[#2D2D2D] px-3 py-2 text-sm w-full font-redaction outline-none focus:border-[#B89B5E] resize-none"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={saveTemplate}
                  className="border-2 border-[#2D2D2D] bg-[#2D2D2D] text-[#EAE8E0] px-3 py-1 text-xs font-bold active:opacity-70"
                >
                  Save
                </button>
                <button
                  onClick={cancelEdit}
                  className="border-2 border-[#2D2D2D] px-3 py-1 text-xs font-bold active:opacity-70"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {editingId === null && (
            <button
              onClick={openNew}
              className="border border-[#2D2D2D] px-3 py-1.5 text-xs font-bold w-full text-left active:opacity-70 hover:bg-[#DCD9CE] mt-1"
            >
              + New Template
            </button>
          )}
        </div>
      </SettingSection>

      <SettingSection title="Search" description="Control how notes are searched.">
        <SettingItem label="Fuzzy Search" description="Match approximate spellings and partial words. Disable for exact-only matching.">
          <Toggle
            value={settings.search.fuzzySearch}
            onChange={(v) => updateSettings(s => ({ ...s, search: { ...s.search, fuzzySearch: v } }))}
          />
        </SettingItem>
        <SettingItem label="Case Sensitive" description="Match uppercase and lowercase characters exactly.">
          <Toggle
            value={settings.search.caseSensitive}
            onChange={(v) => updateSettings(s => ({ ...s, search: { ...s.search, caseSensitive: v } }))}
          />
        </SettingItem>
      </SettingSection>

      <SettingSection title="Core Plugins" description="Enable or disable optional features.">
        <SettingItem label="Graph View" description="Show the knowledge graph button in the toolbar.">
          <Toggle
            value={settings.corePlugins.graphView}
            onChange={(v) => updateSettings(s => ({ ...s, corePlugins: { ...s.corePlugins, graphView: v } }))}
          />
        </SettingItem>
        <SettingItem label="Daily Notes" description="Show the daily note button in the toolbar.">
          <Toggle
            value={settings.corePlugins.dailyNotes}
            onChange={(v) => updateSettings(s => ({ ...s, corePlugins: { ...s.corePlugins, dailyNotes: v } }))}
          />
        </SettingItem>
      </SettingSection>
    </div>
  );
}
