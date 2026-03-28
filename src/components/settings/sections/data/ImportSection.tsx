import React, { RefObject } from 'react';
import { Upload } from 'lucide-react';
import SettingItem from '../../SettingItem';
import SettingSection from '../../SettingSection';

interface ImportSectionProps {
  jsonInputRef: RefObject<HTMLInputElement | null>;
  onImportJsonInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export default function ImportSection({ jsonInputRef, onImportJsonInput }: ImportSectionProps) {
  return (
    <SettingSection title="Import" description="Restore data from backups or other apps.">
      <SettingItem label="Import JSON" description="Restore a complete Noa backup.">
        <button
          onClick={() => jsonInputRef.current?.click()}
          className="flex items-center justify-center space-x-2 bg-[#EAE8E0] text-[#2D2D2D] px-4 py-2 font-bold border-2 border-[#2D2D2D] transition-colors text-sm"
        >
          <Upload size={14} />
          <span>Import JSON</span>
        </button>
        <input
          type="file"
          accept=".json"
          className="hidden"
          ref={jsonInputRef}
          onChange={onImportJsonInput}
        />
      </SettingItem>
    </SettingSection>
  );
}
