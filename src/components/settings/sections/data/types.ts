import { ConflictSummary, DataTransferMessage } from '../../../../hooks/useDataTransfer';

export interface ConfirmState {
  message: string;
  inputLabel?: string;
  inputValue?: string;
  onConfirm: (inputValue?: string) => void;
  conflictSummary?: ConflictSummary;
  onStrategyChange?: (strategy: 'overwrite' | 'merge' | 'skip') => void;
}

export type SetMessage = (message: DataTransferMessage | null) => void;
