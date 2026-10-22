// Central icon mapping: Tabler Icons (plus a few hand-drawn glyphs) exported under the
// legacy lucide-react names so call sites are unchanged. To swap a shape, change its mapping here only.
import {
  IconAdjustmentsHorizontal,
  IconAlertTriangle,
  IconAlignLeft,
  IconArrowBackUp,
  IconArrowLeft,
  IconArrowRight,
  IconArrowsDiagonal,
  IconArrowsDiagonalMinimize2,
  IconArrowsDownUp,
  IconBook,
  IconBrush,
  IconCalendar,
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
  IconCircleArrowUp,
  IconCircleCheck,
  IconClock,
  IconCopy,
  IconDatabase,
  IconDeviceDesktop,
  IconDice5,
  IconDots,
  IconDownload,
  IconExternalLink,
  IconEye,
  IconFileText,
  IconFileZip,
  IconFilter,
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconInfoCircle,
  IconLayoutSidebar,
  IconLayoutSidebarRight,
  IconLink,
  IconList,
  IconLoader2,
  IconMoon,
  IconNetwork,
  IconNotebook,
  IconPalette,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSelector,
  IconServer,
  IconSettings,
  IconSquareCheck,
  IconSquarePlus,
  IconSun,
  IconTag,
  IconTrash,
  IconUnlink,
  IconUpload,
  IconUsers,
  IconX,
} from '@tabler/icons-react';
import type { Icon, IconProps } from '@tabler/icons-react';
import type { ReactNode } from 'react';

// Default to 24px with a 1.5 stroke; call sites that need a heavier glyph pass their own stroke.
function icon(Cmp: Icon) {
  return function WrappedIcon(props: IconProps) {
    return <Cmp size={24} stroke={1.5} {...props} />;
  };
}

export const AlertTriangle = icon(IconAlertTriangle);
export const AlignLeft = icon(IconAlignLeft);
export const ArrowUpDown = icon(IconArrowsDownUp);
export const ArrowLeft = icon(IconArrowLeft);
export const ArrowRight = icon(IconArrowRight);
export const BookOpen = icon(IconBook);
export const Calendar = icon(IconCalendar);
export const Check = icon(IconCheck);
export const CheckCircle2 = icon(IconCircleCheck);
export const CheckSquare = icon(IconSquareCheck);
export const ChevronDown = icon(IconChevronDown);
export const ChevronLeft = icon(IconChevronLeft);
export const ChevronRight = icon(IconChevronRight);
export const ChevronsUpDown = icon(IconSelector);
// Inward twin of ChevronsUpDown ("collapse all folders"), drawn by hand because
// Tabler has no such glyph: same 256 grid, 16-unit stroke (1.5 at 24px), carets flipped.
export function ChevronsDownUp({ size = 24, className, style }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 256 256"
      fill="none"
      stroke="currentColor"
      strokeWidth={16}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <polyline points="80 32 128 80 176 32" />
      <polyline points="80 224 128 176 176 224" />
    </svg>
  );
}
export const ChevronUp = icon(IconChevronUp);
export const CircleArrowUp = icon(IconCircleArrowUp);
// Hand-drawn titlebar/editor action glyphs, on Tabler's 24 grid and 4–20 extent
// so they match the wrapped icons beside them at the same size and stroke.
function glyph(paths: ReactNode) {
  return function Glyph({ size = 24, stroke = 1.5, className, style }: IconProps) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        style={style}
        aria-hidden="true"
      >
        {paths}
      </svg>
    );
  };
}
// Tabler's calendar without the "1".
export const CalendarPlain = glyph(<><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M4 11h16M8 3v4M16 3v4" /></>);
// Headings as an indented bullet list; filled dots, since stroked ones vanish at 16px.
export const Outline = glyph(<>
  <path d="M8.5 6H20M12.5 12H20M12.5 18H20" />
  <g fill="currentColor" stroke="none"><circle cx="4.75" cy="6" r="1.1" /><circle cx="8.75" cy="12" r="1.1" /><circle cx="8.75" cy="18" r="1.1" /></g>
</>);
// Tabler's pencil without the ferrule; its base runs on into a writing line.
export const Edit2 = glyph(<path d="M4 20h4L18.5 9.5a2.83 2.83 0 0 0-4-4L4 16v4M13 20h7" />);
export const Clock = icon(IconClock);
export const Copy = icon(IconCopy);
export const Database = icon(IconDatabase);
export const Dices = icon(IconDice5);
export const Download = icon(IconDownload);
export const ExternalLink = icon(IconExternalLink);
export const Eye = icon(IconEye);
export const FileArchive = icon(IconFileZip);
export const FileText = icon(IconFileText);
export const Filter = icon(IconFilter);
export const Folder = icon(IconFolder);
export const FolderOpen = icon(IconFolderOpen);
export const FolderPlus = icon(IconFolderPlus);
export const Tag = icon(IconTag);
export const HardDrive = icon(IconServer);
export const Info = icon(IconInfoCircle);
export const List = icon(IconList);
export const Loader2 = icon(IconLoader2);
export const Maximize2 = icon(IconArrowsDiagonal);
export const Minimize2 = icon(IconArrowsDiagonalMinimize2);
export const Monitor = icon(IconDeviceDesktop);
export const Moon = icon(IconMoon);
export const MoreHorizontal = icon(IconDots);
export const Network = icon(IconNetwork);
export const Palette = icon(IconPalette);
export const PanelLeft = icon(IconLayoutSidebar);
export const PanelRight = icon(IconLayoutSidebarRight);
export const PenTool = icon(IconBrush);
export const Plus = icon(IconPlus);
export const PlusSquare = icon(IconSquarePlus);
export const RefreshCcw = icon(IconRefresh);
export const RotateCcw = icon(IconArrowBackUp);
export const Search = icon(IconSearch);
export const Settings = icon(IconSettings);
export const SlidersHorizontal = icon(IconAdjustmentsHorizontal);
export const Sun = icon(IconSun);
export const SquarePen = icon(IconNotebook);
export const Trash2 = icon(IconTrash);
export const Link = icon(IconLink);
export const Unlink = icon(IconUnlink);
export const Upload = icon(IconUpload);
export const Users = icon(IconUsers);
export const X = icon(IconX);
