import { Folder, Note } from '../types';
import { extractLinks, extractTags } from './noteUtils';

export const WELCOME_NOTE_ID = 'welcome';

// The first-run tour. Notes link to each other but never back to the Welcome
// note by title: searching "Welcome to Noa" must keep it the only hit.
const GUIDE: { title: string; content: string }[] = [
  {
    title: 'Welcome to Noa',
    content: `Noa is a quiet place to think in writing. There is no account and no server — every note stays on this device, as plain Markdown you can take anywhere.

This folder is a short tour. Read it in order or jump to what you need, then delete it whenever you like.

## Start here

- [ ] Press ⌘ N to create a note, and give it a title
- [ ] Link that note to [[Writing in Noa]] — type two square brackets and start typing a title
- [ ] Press ⌘ ⇧ K to open today's daily note
- [ ] Press ⌘ K and jump to any note by typing part of its name
- [ ] Set up a backup in Settings → Data

Tick these off here, or in the **Tasks** tab of the right panel — it gathers every open task from all your notes.

## The tour

1. [[Writing in Noa]] — Markdown, Live Preview and the editor
2. [[Linking Notes]] — links, backlinks, tags, embeds and the graph
3. [[Daily Notes and Tasks]] — a page for every day, and tasks that find you
4. [[Finding Things]] — search, the command palette and moving around
5. [[Your Data]] — where notes live, backups, and folders on disk
6. [[Keyboard Shortcuts]] — everything on one page

## Finding your way around

- **Sidebar** (left) — folders, notes and tags. Drag notes between folders, or right-click for more. The gear at the bottom opens Settings.
- **Editor** (centre) — the open note. Notes you open line up as tabs along the top.
- **Right panel** — Tasks, Backlinks, Outgoing links, Graph and Properties for the current note. Toggle it with the button at the top right.
- **Calendar and tags** — a small rail beside the editor, toggled from the title bar.

> [!TIP] Make it yours
> **Settings → Appearance** sets light or dark mode, the font and its size. **Settings → General** picks whether notes open in Live Preview or the reading view.`,
  },
  {
    title: 'Writing in Noa',
    content: `Everything in Noa is Markdown. You type plain text; **Live Preview** renders it as you go and shows the raw syntax only on the line your cursor is on. Press \`⌘ E\` for the **reading view**, which hides all syntax.

The title sits above the text — click it to rename the note. Notes save themselves as you type.

## Formatting

| Type this | To get |
|-----------|--------|
| \`**bold**\` or \`⌘ B\` | **bold** |
| \`*italic*\` or \`⌘ I\` | *italic* |
| \`~~strike~~\` | ~~strike~~ |
| \`==highlight==\` | ==highlight== |
| \`[text](https://…)\` | a web link |

Wrap text in backticks for \`inline code\`. Start a line with \`#\`, \`##\` or \`###\` for headings. Notes with headings get an **Outline** button in the note's toolbar that jumps between them.

## The slash menu

Type \`/\` at the start of a line for headings, quotes, tasks, tables, callouts, code blocks and dividers. Keep typing to filter, then press Enter.

## Lists and tasks

- A dash starts a list
  - Tab indents, Shift-Tab outdents
1. Numbers work too

Start a line with \`- [ ]\` — or press \`⌘ ⇧ X\` — to make it a task. Click its box to tick it off, and it becomes \`- [x]\`.

## Quotes and callouts

> A line starting with \`>\` is a quote.

> [!NOTE]
> Callouts are quotes with a label: \`> [!NOTE]\`, \`> [!TIP]\`, \`> [!WARNING]\` and so on.

> [!TIP] Callouts can have a title
> Write it after the label, on the same line.

## Code

\`\`\`js
// Fence code with three backticks, and name the language for highlighting.
function greet(name) {
  return 'Hello, ' + name;
}
\`\`\`

## Tables

| Fruit | Colour |
|-------|--------|
| Apple | Red |
| Lime | Green |

## Maths and diagrams

Inline maths goes between single dollars, like $E = mc^2$. Use double dollars for a block:

$$
\\int_0^1 x^2 \\, dx = \\frac{1}{3}
$$

Mermaid diagrams are drawn from text:

\`\`\`mermaid
flowchart LR
  Idea --> Draft --> Note
  Note --> Link
  Link --> Idea
\`\`\`

## Images

Paste an image or drop it into the editor. It's saved with your notes and shown as \`![[image.png]]\`; add \`|300\` inside the brackets to set its width.

## Properties

Press \`⌘ ;\` to add a property — a status, a date, a source. Properties sit at the top of the note as YAML front matter and show in the **Properties** tab of the right panel.

## When you need room

- \`⌘ ⇧ F\` enters **focus mode**, which hides everything but the text. \`Esc\` leaves it.
- **⋯ → Version History** in the note's toolbar shows earlier versions, saved automatically while you write.
- **⋯ → Export** saves the note as Markdown, HTML or PDF.

Next: [[Linking Notes]]`,
  },
  {
    title: 'Linking Notes',
    content: `A single note is a thought. Linked notes become a way of thinking. #guide

## Links

Type \`[[\` and Noa suggests notes as you type; pick one with Enter. A link like [[Writing in Noa]] opens that note when you click it.

- \`[[Your Data|where notes live]]\` shows your own text: [[Your Data|where notes live]]
- \`[[Keyboard Shortcuts#Navigation]]\` points at a heading inside a note
- A link to a title that doesn't exist yet is fine — it waits under **Outgoing** until you write that note

## Backlinks

Open the **Backlinks** tab in the right panel: it lists every note that links here. You never have to link both ways — Noa notices the other direction for you. **Outgoing** shows the reverse: everything this note links to.

## Embeds

Put \`!\` before a link to show another note — or one section of it — inside this one. Switch to the reading view (\`⌘ E\`) to see this:

![[Keyboard Shortcuts#Editing]]

## Tags

Write \`#\` and a word anywhere, like the #guide tag in this note's first line. Tags appear in the sidebar's tag list; click one to see every note that carries it. Use slashes to nest them, as in \`#project/noa\`.

## The graph

The **Graph** tab draws your notes as dots and links as lines. Click a dot to open that note, filter by name, or hide notes with no links. This tour is already a small cluster — yours will grow from here.

Next: [[Daily Notes and Tasks]]`,
  },
  {
    title: 'Daily Notes and Tasks',
    content: `## Daily notes

Press \`⌘ ⇧ K\` and Noa opens today's note, creating it if needed. Each day gets one page in the **Daily Notes** folder, named by date and started from a template. It's a good home for a journal, a log, or whatever comes up.

Pick any day in the **calendar** beside the editor to open that day's note. Change the date format and template in **Settings → Notes**.

## Tasks

Write \`- [ ]\` in any note and it becomes a task. The **Tasks** tab in the right panel gathers open tasks from every note, so you can write them where they come up and still see them in one place. Ticking one there ticks it in its note too — try it with the list in the Welcome note.

## Templates

Add your own templates in **Settings → Notes → Custom Templates**. Once you have some, \`⌘ N\` asks which one to start from. Placeholders fill themselves in:

| Placeholder | Becomes |
|-------------|---------|
| \`{{date}}\` | today's date |
| \`{{time}}\` | the current time |
| \`{{title}}\` | the note's title |
| \`{{week}}\` | the day of the week |
| \`{{weeknum}}\` | the week number |

Next: [[Finding Things]]`,
  },
  {
    title: 'Finding Things',
    content: `## Search

\`⌘ F\` jumps to the search box at the top of the sidebar. It looks through titles and text as you type, and a few operators narrow it down:

| Search | Finds |
|--------|-------|
| \`"exact phrase"\` | notes with those words together |
| \`tag:idea\` | notes tagged #idea |
| \`in:essays\` | notes in a folder |
| \`after:2026-01-01\` | notes edited after a date |
| \`before:2026-01-01\` | notes edited before a date |

Mix them freely: \`tag:idea in:essays draft\`. Fuzzy and case-sensitive matching are in **Settings → General**.

## Command palette

\`⌘ K\` opens the palette: type part of a note's title to jump to it, or the name of a command to run it. \`⌘ O\` and \`⌘ P\` open it too, as in Obsidian.

## Moving around

- \`⌘ [\` and \`⌘ ]\` go back and forward through the notes you've visited, like a browser.
- Tabs keep recent notes one click away. Close one from its ×.
- The calendar and tag rail beside the editor jumps to a day or a tag.

Next: [[Your Data]]`,
  },
  {
    title: 'Your Data',
    content: `## Where your notes live

Notes are stored **inside this app** (or, on the web, this browser profile) — never on a server. Nobody else can read them, and nothing is lost if you're offline.

> [!WARNING] Keep a backup
> Because nothing lives in the cloud, a lost laptop or cleared browser data takes your notes with it. Set up a backup today; it takes a minute.

## Backups

In **Settings → Data**:

- **Automatic Backup** — choose a folder, and Noa saves a snapshot right away, then again each day you open it. Point it at a synced folder (iCloud Drive, Dropbox) for a copy off this device.
- **Export JSON Backup** — everything in one file: notes, folders and images. Import it to restore.
- **Export Vault** — a ZIP of Markdown files, readable by any other notes app.
- **Export as HTML** — a static site for reading, not for restoring.

## Working with a folder on disk

Already keep Markdown files in a folder, like an Obsidian vault? Connect it in **Settings → Workspace → Vault Folder**. Noa then reads and edits those files in place:

- Changes made elsewhere show up when you come back to Noa, or within a minute.
- While a folder is connected, Noa's own notes (including this tour) are hidden. They come back when you disconnect.
- Deleting a note there deletes the file. There's no undo, so keep your own backup of that folder.

If you'd rather bring a vault in once and leave the folder alone, use **Import Vault Folder** instead. It copies the notes into Noa, keeping their tags and links.

Next: [[Keyboard Shortcuts]]`,
  },
  {
    title: 'Keyboard Shortcuts',
    content: `On Windows and Linux, use Ctrl wherever you see ⌘.

## General

| Shortcut | Action |
|----------|--------|
| \`⌘ N\` | New note |
| \`⌘ K\` | Command palette |
| \`⌘ ⇧ K\` | Today's daily note |
| \`⌘ S\` | Save now (Noa also saves as you type) |
| \`⌘ ⇧ F\` | Focus mode |
| \`Esc\` | Leave focus mode, or clear the search |

## Editing

| Shortcut | Action |
|----------|--------|
| \`⌘ B\` | Bold |
| \`⌘ I\` | Italic |
| \`⌘ ⇧ X\` | Turn the line into a task |
| \`⌘ ;\` | Add a property |
| \`⌘ E\` | Switch between Live Preview and the reading view |
| \`/\` | Slash menu, at the start of a line |
| \`[[\` | Link to a note |

## Navigation

| Shortcut | Action |
|----------|--------|
| \`⌘ F\` | Search notes |
| \`⌘ O\` / \`⌘ P\` | Command palette |
| \`⌘ [\` / \`⌘ ]\` | Back / forward (Alt ← / Alt → on Windows and Linux) |

Back to the start: [[Writing in Noa]] begins the tour.`,
  },
];

export const buildWelcomeNotes = (folderId: string, now = Date.now()): Note[] =>
  GUIDE.map(({ title, content }, index) => {
    // A second apart, Welcome newest, so recency sorting reads as the tour order.
    const at = new Date(now - index * 1000).toISOString();
    return {
      id: index === 0 ? WELCOME_NOTE_ID : crypto.randomUUID(),
      title,
      content,
      createdAt: at,
      updatedAt: at,
      folder: folderId,
      tags: extractTags(content),
      links: extractLinks(content),
      linkRefs: [],
      source: 'noa',
    };
  });

export const createWelcomeFolder = (): Folder => ({
  id: crypto.randomUUID(),
  name: 'Getting Started',
  source: 'noa',
});
