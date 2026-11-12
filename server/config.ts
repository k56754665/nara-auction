export const RULES = { initialFunds: 30_000_000, bidStep: 100_000, tolerancePercent: 10, failurePercent: 5 };
export const DURATIONS = {
  catalog: 15 * 60_000, announcement: 10_000, price: 30_000, firstBid: 30_000,
  rebid: 15_000, reviewChoice: 10_000, reviewAnswer: 20_000, result: 15_000,
};
export type Durations = typeof DURATIONS;
export const BOT_CONFIG = { actionDelayMs: 900, priceErrorPercent: 14, rebidChance: 0.65, challengeChance: 0.8, correctChoiceChance: 0.75 };
