// Single source for the app's surface colours. ThemeInjector publishes these as
// CSS variables; code that needs a literal (Electron window colour, inline SVG)
// reads them here. public/theme-bootstrap.js can't import, so it restates
// primary/secondary and tests/unit/themePalette.test.ts keeps it in sync.
export const THEME_SURFACES = {
  light: {
    primary: '#FCFCFB',
    secondary: '#EFEAE3',
    // Neutral, nudged to 251/251/249 so the sidebar reads as a plane change, not a colour shift.
    sidebar: '#FBFBF9',
    sidebarMaterial: '#FAFAF8',
    // Row highlight; moves with the floor so it stays distinct from it.
    sidebarRaised: '#ECEBE8',
    // Right-column cards and the graph canvas.
    card: '#FFFFFF',
  },
  dark: {
    primary: '#2A2A28',
    secondary: '#222220',
    // Soft lift above the editor plane, keeping the editor's red-blue spread
    // (47/47/45 versus 42/42/40) so it reads as depth, not a colour cast.
    sidebar: '#2F2F2D',
    // Translucent-sidebar tint over the native `menu` material.
    sidebarMaterial: '#383836',
    sidebarRaised: 'rgba(249,249,247,0.08)',
    // A small lift above primary so cards read as raised, not as a different colour.
    card: '#2F2F2D',
  },
} as const;

export type ThemeSurfaces = (typeof THEME_SURFACES)[keyof typeof THEME_SURFACES];

export const themeSurfaces = (isDark: boolean): ThemeSurfaces =>
  isDark ? THEME_SURFACES.dark : THEME_SURFACES.light;
