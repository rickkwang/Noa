// Central icon mapping. The app uses Phosphor Icons (thin, rounded — Claude.ai-like),
// re-exported under the names the codebase already used (formerly lucide-react), so
// call sites stay unchanged. To swap an icon's shape, change its mapping here only.
import {
  Warning,
  TextAlignLeft,
  ArrowsDownUp,
  TextB,
  Book as PhBook,
  CalendarBlank,
  Check as PhCheck,
  CheckCircle,
  CheckSquare as PhCheckSquare,
  CaretDown,
  CaretLeft,
  CaretRight,
  CaretUpDown,
  CaretUp,
  Circle as PhCircle,
  Clock as PhClock,
  Code as PhCode,
  Columns as PhColumns,
  Copy as PhCopy,
  Database as PhDatabase,
  DiceFive,
  DownloadSimple,
  PencilSimple,
  ArrowSquareOut,
  Eye as PhEye,
  FileZip,
  FileText as PhFileText,
  Funnel,
  Folder as PhFolder,
  FolderOpen as PhFolderOpen,
  FolderPlus as PhFolderPlus,
  GitBranch as PhGitBranch,
  Tag as PhTag,
  HardDrives,
  ClockCounterClockwise,
  Info as PhInfo,
  TextItalic,
  List as PhList,
  CircleNotch,
  ArrowsOut,
  Graph,
  Palette as PhPalette,
  SidebarSimple,
  PenNib,
  Plus as PhPlus,
  PlusSquare as PhPlusSquare,
  ArrowsClockwise,
  ArrowCounterClockwise,
  MagnifyingGlass,
  Gear,
  SlidersHorizontal as PhSlidersHorizontal,
  NotePencil,
  Trash,
  LinkBreak,
  UploadSimple,
  X as PhX,
  MagnifyingGlassPlus,
  MagnifyingGlassMinus,
} from '@phosphor-icons/react';
import type { Icon, IconProps } from '@phosphor-icons/react';

// Wrap so icons default to lucide's 24px size and a thin "regular" weight,
// while still accepting size/className/color/strokeWidth/etc. per call site.
function icon(Cmp: Icon) {
  return function WrappedIcon(props: IconProps) {
    return <Cmp size={24} weight="regular" {...props} />;
  };
}

export const AlertTriangle = icon(Warning);
export const AlignLeft = icon(TextAlignLeft);
export const ArrowUpDown = icon(ArrowsDownUp);
export const Bold = icon(TextB);
export const Book = icon(PhBook);
export const Calendar = icon(CalendarBlank);
export const Check = icon(PhCheck);
export const CheckCircle2 = icon(CheckCircle);
export const CheckSquare = icon(PhCheckSquare);
export const ChevronDown = icon(CaretDown);
export const ChevronLeft = icon(CaretLeft);
export const ChevronRight = icon(CaretRight);
export const ChevronsDownUp = icon(CaretUpDown);
export const ChevronsUpDown = icon(CaretUpDown);
export const ChevronUp = icon(CaretUp);
export const Circle = icon(PhCircle);
export const Clock = icon(PhClock);
export const Code = icon(PhCode);
export const Columns = icon(PhColumns);
export const Copy = icon(PhCopy);
export const Database = icon(PhDatabase);
export const Dices = icon(DiceFive);
export const Download = icon(DownloadSimple);
export const Edit2 = icon(PencilSimple);
export const ExternalLink = icon(ArrowSquareOut);
export const Eye = icon(PhEye);
export const FileArchive = icon(FileZip);
export const FileText = icon(PhFileText);
export const Filter = icon(Funnel);
export const Folder = icon(PhFolder);
export const FolderOpen = icon(PhFolderOpen);
export const FolderPlus = icon(PhFolderPlus);
export const GitBranch = icon(PhGitBranch);
export const Tag = icon(PhTag);
export const HardDrive = icon(HardDrives);
export const History = icon(ClockCounterClockwise);
export const Info = icon(PhInfo);
export const Italic = icon(TextItalic);
export const List = icon(PhList);
export const Loader2 = icon(CircleNotch);
export const Maximize2 = icon(ArrowsOut);
export const Network = icon(Graph);
export const Palette = icon(PhPalette);
export const PanelLeft = icon(SidebarSimple);
export const PanelRight = icon(SidebarSimple);
export const PenTool = icon(PenNib);
export const Plus = icon(PhPlus);
export const PlusSquare = icon(PhPlusSquare);
export const RefreshCcw = icon(ArrowsClockwise);
export const RotateCcw = icon(ArrowCounterClockwise);
export const Search = icon(MagnifyingGlass);
export const Settings = icon(Gear);
export const SlidersHorizontal = icon(PhSlidersHorizontal);
export const SquarePen = icon(NotePencil);
export const Trash2 = icon(Trash);
export const Unlink = icon(LinkBreak);
export const Upload = icon(UploadSimple);
export const X = icon(PhX);
export const ZoomIn = icon(MagnifyingGlassPlus);
export const ZoomOut = icon(MagnifyingGlassMinus);
