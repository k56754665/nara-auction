export interface Session { token: string; roomCode: string; playerId: string }
export interface RoomExit { roomCode: string; reason: 'hostClosed' | 'left' }
export interface PlayerView {
  id: string; seat: number; nickname: string; connected: boolean; ready: boolean;
  isBot: boolean;
  funds: number; deliveries: number;
  priceSubmitted: boolean; bidSubmitted: boolean; eligible: boolean | null;
}
export type Phase = 'lobby' | 'catalog' | 'announcement' | 'price' | 'firstBid' | 'rebid' | 'reviewChoice' | 'reviewAnswer' | 'result' | 'finished';
export interface ProductSource {
  productId: string; supplier: string; contractNumber: string; contractLine: string;
  contractStart: string; contractEnd: string; delivery: string; vat: string; checkedAt: string;
  retainedAfterRefreshFailure: boolean; sourceUrl: string; imageSourceUrl: string; imageSha256: string;
}
export interface ContentInfo {
  priceBasis: 'registeredContractPrice' | 'sample'; referenceDate: string | null;
  bankVersion?: string; poolSize: number; catalogUrl?: string; retainedCount?: number;
}
export interface TriviaCard {
  id: string; title: string; text: string; followup: string; period: string; caution: string;
  sources: { title: string; publisher: string; url: string; publishedOn: string | null }[];
}
export interface CatalogItem { id: string; name: string; unit: string; unitPrice: number; specs: string; description: string;
  category?: string; imageUrl?: string; imageAlt?: string; source?: ProductSource; revealNote?: string }
export interface Choice { id: string; label: string; productId?: string; specification?: string; unit?: string; delivery?: string; imageUrl?: string }
export interface TenderView { id: string; itemId?: string; agency: string; name: string; unit: string; quantity: number; budget: number; specs: string; question: string; choices: Choice[];
  imageUrl?: string; imageAlt?: string; source?: ProductSource }
export type ReviewResult = 'pending' | 'passed' | 'failed' | 'declined' | 'notReached';
export interface ResultRow {
  playerId: string; guess: number | null; error: number | null; eligible: boolean;
  firstBid: number | null; finalBid: number | null; review: ReviewResult;
  delta: number; funds: number; deliveries: number;
}
export interface RoundResult {
  round: number; name: string; winnerId: string | null; contract: number | null;
  cost: number; fee: number; reason: string; rows: ResultRow[]; correctLabel: string; revealNote?: string; trivia?: TriviaCard;
}
export interface Standing { playerId: string; rank: number; eligible: boolean; winner: boolean; funds: number; deliveries: number }
export interface RoomView {
  code: string; hostId: string; phase: Phase; phaseId: string; deadline: number | null;
  players: PlayerView[]; serverNow: number;
  roundNumber: number; totalRounds: number; catalog: CatalogItem[]; contentInfo: ContentInfo;
  tender: TenderView | null; unitPrice: number | null; cost: number | null; fee: number | null;
  lowestBid: number | null; bids: { playerId: string; amount: number }[]; lotteryOrder: string[];
  activeId: string | null; result: RoundResult | null; history: RoundResult[]; standings: Standing[];
  me: { priceSubmitted: boolean; guess: number | null; eligible: boolean | null;
    bidSubmitted: boolean; firstBid: number | null; finalBid: number | null; acknowledged: boolean };
  rules: { initialFunds: number; bidStep: number; tolerancePercent: number; failurePercent: number };
}
export type Action = { kind: 'continue' } | { kind: 'price'; amount: number | null }
  | { kind: 'bid'; amount: number | null } | { kind: 'rebid'; amount: number | null }
  | { kind: 'challenge'; accept: boolean } | { kind: 'answer'; choiceId: string };
export type Command =
  | { type: 'create'; nickname: string }
  | { type: 'join'; nickname: string; code: string }
  | { type: 'resume'; token: string; code: string }
  | { type: 'ready'; ready: boolean }
  | { type: 'start' }
  | { type: 'closeRoom'; roomCode: string }
  | { type: 'leave'; roomCode: string }
  | { type: 'submit'; requestId: string; phaseId: string; action: Action };
export type Reply = { ok: true; session?: Session } | { ok: false; error: string; code?: 'SESSION_NOT_FOUND' | 'TRANSPORT' };
export interface ClientEvents { command: (command: Command, ack: (reply: Reply) => void) => void }
export interface ServerEvents { state: (state: RoomView) => void; replaced: () => void; roomExited: (event: RoomExit) => void; nicknameSuggested: (nickname: string) => void }
