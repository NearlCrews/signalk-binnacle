interface EmptyStateAction {
  label: string;
  run: () => void;
  primary?: boolean;
}

export interface EmptyStateProps {
  title: string;
  message: string;
  action?: EmptyStateAction;
}

// What a saved list shows with no items: a load still in flight, a list the server cannot provide
// (the panel states the cause and its recovery above the list), or a real empty list.
export type SavedListEmpty =
  | { kind: 'loading'; message: string }
  | { kind: 'unavailable'; message: string }
  | ({ kind: 'empty' } & EmptyStateProps);
