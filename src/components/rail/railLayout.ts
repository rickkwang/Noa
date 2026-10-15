// Rail width, its inset from the window edge (clear of the editor's scrollbar), and the gap before the text.
// Kept apart from NoteRail so the app shell can reserve the rail's room without pulling the lazy rail chunk in.
export const RAIL_WIDTH = 280;
export const RAIL_RIGHT = 14;
export const NOTE_RAIL_RESERVE_PX = RAIL_WIDTH + RAIL_RIGHT + 12;
