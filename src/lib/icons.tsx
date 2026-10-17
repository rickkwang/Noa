// Central icon mapping: Tabler Icons re-exported under the legacy lucide-react
// names so call sites are unchanged. To swap a shape, change its mapping here only.
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
  IconLayoutList,
  IconLayoutSidebar,
  IconLayoutSidebarRight,
  IconLink,
  IconList,
  IconLoader2,
  IconMoon,
  IconNetwork,
  IconNotebook,
  IconPalette,
  IconPencil,
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
export const Clock = icon(IconClock);
export const Copy = icon(IconCopy);
export const Database = icon(IconDatabase);
export const Dices = icon(IconDice5);
export const Download = icon(IconDownload);
export const Edit2 = icon(IconPencil);
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
export const LayoutList = icon(IconLayoutList);
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
