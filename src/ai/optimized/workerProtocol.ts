import { OptimizedBudget, PlayerObservation, SearchDecision } from './contracts';

export interface SearchWorkerRequest {
  readonly id: number;
  readonly observation: PlayerObservation;
  readonly budget: Partial<OptimizedBudget>;
}
export type SearchWorkerResponse =
  | { readonly id: number; readonly decision: SearchDecision }
  | { readonly id: number; readonly error: string };

export interface SearchWorkerPort {
  postMessage(request: SearchWorkerRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<SearchWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
}
