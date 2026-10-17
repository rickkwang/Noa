import React from 'react';

interface SettingSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  id?: string;
}

// A 15px semibold heading, then the rows straight on the page, no card around them.
export default function SettingSection({ title, description, children, id }: SettingSectionProps) {
  return (
    <section id={id}>
      <div className="mb-4">
        <h2 className="text-[15px] leading-5 font-semibold text-[var(--text-primary,#2D2D2B)]">{title}</h2>
        {description && (
          <p className="text-sm leading-5 text-[var(--settings-text-muted)] mt-1">{description}</p>
        )}
      </div>
      <div>{children}</div>
    </section>
  );
}
