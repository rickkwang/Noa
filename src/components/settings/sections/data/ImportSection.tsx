import React, { RefObject } from 'react';
import SettingItem from '../../SettingItem';
import SettingsButton from '../../SettingsButton';
import SettingSection from '../../SettingSection';
import { Upload } from '@/src/lib/icons';

interface ImportSectionProps {
  jsonInputRef: RefObject<HTMLInputElement | null>;
  onImportJsonInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export default function ImportSection({ jsonInputRef, onImportJsonInput }: ImportSectionProps) {
  return (
    <SettingSection title="Import" description="Restore data from backups or other apps.">
      <SettingItem label="Import JSON" description="Restore a complete Noa backup.">
        <SettingsButton onClick={() => jsonInputRef.current?.click()}>
          <Upload size={14} />
          <span>Import JSON</span>
        </SettingsButton>
        <input
          type="file"
          accept=".json"
          className="hidden"
          ref={jsonInputRef}
          onChange={onImportJsonInput}
        />
      </SettingItem>
      <p className="text-xs text-[#2D2D2B]/60">
        To migrate an Obsidian vault or restore a Vault ZIP, use Import Vault Folder in the Workspace tab.
      </p>
    </SettingSection>
  );
}
