import React, { useEffect, useId, useRef, useState } from 'react';

interface MermaidBlockProps {
  code: string;
  isDark: boolean;
}

// Each render call needs a unique element id — mermaid throws if the same id
// is reused across render invocations within the same page session.
let _renderCounter = 0;

export function MermaidBlock({ code, isDark }: MermaidBlockProps) {
  const baseId = useId().replace(/:/g, '');
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const prevThemeRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Use a fresh unique id for every render call to avoid mermaid's
    // "element already exists" error when code or theme changes.
    const renderId = `mermaid-${baseId}-${++_renderCounter}`;

    async function render() {
      try {
        const mermaid = (await import('mermaid')).default;
        const theme = isDark ? 'dark' : 'default';

        // Re-initialize only when theme changes to avoid stale config
        if (prevThemeRef.current !== theme) {
          mermaid.initialize({
            startOnLoad: false,
            theme,
            securityLevel: 'strict',
            fontFamily: 'inherit',
          });
          prevThemeRef.current = theme;
        }

        const { svg: renderedSvg } = await mermaid.render(renderId, code.trim());
        if (!cancelled) {
          setSvg(renderedSvg);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Mermaid render error');
          setSvg(null);
        }
      }
    }

    render();
    return () => { cancelled = true; };
  }, [code, isDark, baseId]);

  if (error) {
    return (
      <div style={{
        border: `1px solid ${isDark ? 'rgba(217,87,87,0.4)' : 'rgba(200,50,50,0.3)'}`,
        borderRadius: '4px',
        padding: '0.75rem',
        margin: '0.5rem 0',
        background: isDark ? 'rgba(217,87,87,0.08)' : 'rgba(200,50,50,0.05)',
      }}>
        <div style={{
          color: isDark ? '#D97757' : '#c83232',
          fontSize: '0.78em',
          fontWeight: 600,
          marginBottom: '0.4rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
        }}>
          <span>⚠ Mermaid syntax error</span>
          <button
            onClick={() => setShowRaw(v => !v)}
            style={{ fontSize: '0.75em', opacity: 0.7, cursor: 'pointer', background: 'none', border: 'none', color: 'inherit' }}
          >
            {showRaw ? 'Hide source' : 'Show source'}
          </button>
        </div>
        <div style={{ fontSize: '0.75em', opacity: 0.7, wordBreak: 'break-word' }}>{error}</div>
        {showRaw && (
          <pre style={{
            marginTop: '0.5rem',
            padding: '0.5rem',
            background: isDark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.05)',
            borderRadius: '3px',
            fontSize: '0.75em',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            {code}
          </pre>
        )}
      </div>
    );
  }

  if (!svg) {
    return (
      <div style={{
        padding: '1rem',
        textAlign: 'center',
        fontSize: '0.8em',
        opacity: 0.4,
      }}>
        Rendering diagram…
      </div>
    );
  }

  return (
    <div
      style={{ margin: '0.75rem 0', textAlign: 'center', overflowX: 'auto' }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
