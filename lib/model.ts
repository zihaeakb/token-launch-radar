// The token radar's model (radar-2): one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds the
// pre-token protocols below the watchlist floor with the most TVL: the early rows the radar exists to
// find. A protocol is pre-token when its record carries no token (no market cap, no CoinGecko id, no
// symbol); the live-token protocols are kept apart and shown as the market's own values, never mixed
// into the ranked board.
//
// Implied value follows only from the snapshot's own figures, and never from a hand-written list of
// names: the same function scores every row.
//
//   multiple   = the protocol's category multiple: the median market-cap-to-TVL ratio of the
//                  snapshot's own tokenized protocols in that category, shrunk toward the global
//                  median (k = 10) so thin categories do not swing on one outlier, clamped to
//                  [0.02, 2.00]. A category with no tokenized protocol takes the global median.
//                  k = 10 means a category needs about ten tokenized peers before its own median
//                  outweighs the global median: one expensive peer still lifts its category, but
//                  it cannot set the whole category's multiple on its own.
//   base       = tvl_usd x multiple
//   growth     = clamp(change_7d, -60, 120) per cent
//   growthMult = 1 + (growth / 100) x 0.5
//   maturity   = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age_days unknown: 365)
//   implied    = max(1, round(base x growthMult x maturity))
//
// A category multiple is a claim about the category, not the protocol: two protocols in one category
// with the same TVL, growth and age get the same implied value. The dashboard states the multiples
// and the formula, so a reader can check every number on the board.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  shrink_k: number;
  multiple_floor: number;
  multiple_cap: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  shrink_k: 10,
  multiple_floor: 0.02,
  multiple_cap: 2.0,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One category's multiple, as the dashboard's method table shows it. */
export interface CategoryMultiple {
  category: string;
  n: number;
  median: number;
  multiple: number;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  global_multiple: number;
  multiples: CategoryMultiple[];
  watchlist_slugs: string[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** The median of a sorted copy; 0 when the list is empty. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all: no market cap (a zero cap is no cap — the
 *  token, if the record names one, does not trade), no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return (p.mcap_usd === null || p.mcap_usd === 0) && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/**
 * The category multiples, from the snapshot's own tokenized protocols: each category's median
 * market-cap-to-TVL ratio, shrunk toward the global median with k = shrink_k, then clamped. A
 * category with no tokenized protocol is absent from the table and takes the global median.
 * k = 10 (see MODEL): a single tokenized peer must not set its whole category. Risk Curators has
 * exactly one peer, at 2.97x; with k = 10 that peer lifts the category to 0.46x instead of 0.67x.
 */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): { multiples: CategoryMultiple[]; globalMultiple: number } {
  const byCat = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (isPreToken(p)) continue;
    // A zero market cap is not a market value: those tokens do not trade, and a 0 ratio
    // would drag every median down. Only a positive cap counts as a tokenized peer.
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const c = p.category ?? 'Uncategorized';
    const arr = byCat.get(c) ?? [];
    arr.push(p.mcap_usd / p.tvl_usd);
    byCat.set(c, arr);
  }
  const all = [...byCat.values()].flat();
  const globalMedian = median(all);
  const globalMultiple = round4(clamp(globalMedian, model.multiple_floor, model.multiple_cap));
  const multiples: CategoryMultiple[] = [...byCat.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([category, vals]) => {
      const med = median(vals);
      const blended = (vals.length * med + model.shrink_k * globalMedian) / (vals.length + model.shrink_k);
      return { category, n: vals.length, median: round4(med), multiple: round4(clamp(blended, model.multiple_floor, model.multiple_cap)) };
    });
  return { multiples, globalMultiple };
}

/** The multiple one category takes: its table row, or the global median when it has none. */
export function multipleFor(category: string | null, multiples: CategoryMultiple[], globalMultiple: number): number {
  const c = category ?? 'Uncategorized';
  const row = multiples.find((m) => m.category === c);
  return row === undefined ? globalMultiple : row.multiple;
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  multiples: CategoryMultiple[],
  globalMultiple: number,
  model: ModelConstants = MODEL,
): { implied: number; multiple: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const multiple = multipleFor(protocol.category, multiples, globalMultiple);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = clamp(rawGrowth, model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (clamp(ageForModel, 0, model.maturity_days) / model.maturity_days) * model.maturity_range;
  const base = protocol.tvl_usd * multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  return { implied, multiple, growthPct, growthMult, maturityMult, age };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const { multiples, globalMultiple } = categoryMultiples(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a
  // replacement for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, multiples, globalMultiple, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: s.multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** One category's farm action: [keywords in the lowercased category, the action, the weekly action]. */
const ACTIONS: Array<[string[], (name: string, capital: number, chain: string) => string, (name: string, chain: string) => string]> = [
  [['lend', 'cdp', 'collateral'], (n, c, ch) => `Supply $${c} of USDC to ${n} on ${ch} and keep the position open`, (n) => `repay a small amount and re-supply it on ${n}`],
  [['dex', 'leveraged farm'], (n, c, ch) => `Provide $${c} of liquidity to ${n}'s main pool on ${ch} and keep the position open`, (n) => `swap a small amount through ${n}'s pool`],
  [['yield aggregator', 'yield'], (n, c, ch) => `Deposit $${c} of USDC into ${n}'s highest-TVL vault on ${ch} and keep the shares`, (n) => `claim the vault's yield and re-deposit it on ${n}`],
  [['bridge', 'cross chain'], (n, c, ch) => `Bridge $${c} of USDC to ${ch} through ${n} and use the bridged funds in its app`, (n) => `bridge a small amount through ${n} again`],
  [['liquid staking', 'restak', 'staking pool'], (n, c, ch) => `Stake $${c} of the chain's staking asset through ${n} on ${ch} and keep the receipt token`, (n) => `restake the staking rewards through ${n}`],
  [['perpetual', 'derivative', 'options'], (n, c, ch) => `Deposit $${c} of USDC as margin on ${n} and open one small hedged position`, (n) => `close and reopen one small position on ${n}`],
  [['prediction'], (n, c) => `Fund $${c} and place one market position on ${n}`, (n) => `settle one position and open another on ${n}`],
  [['risk curator', 'curator', 'allocator', 'vault'], (n, c, ch) => `Deposit $${c} into a ${n} vault on ${ch} and keep the shares`, (n) => `review the vault's allocation and top it up on ${n}`],
  [['stablecoin', 'stable'], (n, c, ch) => `Mint or deposit $${c} of the stable asset through ${n} on ${ch} and hold it`, (n) => `mint a small amount more through ${n}`],
  [['rwa'], (n, c, ch) => `Mint $${c} of the protocol's yield-bearing asset on ${ch} through ${n} and hold it`, (n) => `claim the asset's yield and hold it on ${n}`],
  [['insurance'], (n, c, ch) => `Buy $${c} of cover from ${n} on ${ch} and keep the policy active`, (n) => `renew or extend the cover on ${n}`],
  [['basis trad'], (n, c, ch) => `Deposit $${c} of USDC into ${n}'s basis vault on ${ch} and keep the position open`, (n) => `claim the vault's funding yield on ${n}`],
  [['payment'], (n, c, ch) => `Move $${c} through ${n} on ${ch} for a real payment and keep the receipt`, (n) => `make one more payment through ${n}`],
  [['chain'], (n, c, ch) => `Bridge $${c} of USDC onto ${n} (${ch}) and use it in one of its apps`, (n) => `use the funds in another ${n} app`],
  [['launchpad'], (n, c, ch) => `Stake $${c} of USDC in ${n}'s launch pool on ${ch} and join one sale`, (n) => `join the next sale on ${n}`],
  [['privacy'], (n, c, ch) => `Deposit $${c} of USDC into ${n}'s shielded pool on ${ch} and keep it there`, (n) => `make one shielded transfer through ${n}`],
  [['nft'], (n, c, ch) => `Buy or list one item worth about $${c} on ${n} on ${ch}`, (n) => `list or trade one more item on ${n}`],
  [['governance'], (n, c, ch) => `Deposit $${c} into ${n}'s rewards pool on ${ch} and vote on one proposal`, (n) => `vote on the next proposal on ${n}`],
  [['cedefi'], (n, c, ch) => `Deposit $${c} of USDC into ${n} on ${ch} and keep the position open`, (n) => `top up the position on ${n}`],
];

/** The category's farm action and weekly action, from the table above or the generic fallback. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): { action: string; weekly: string } {
  const c = (p.category ?? '').toLowerCase();
  for (const [keys, makeAction, makeWeekly] of ACTIONS) {
    if (keys.some((k) => c.includes(k))) return { action: makeAction(p.name, capital, chain), weekly: makeWeekly(p.name, chain) };
  }
  return {
    action: `Deposit $${capital} of USDC into ${p.name} on ${chain} and keep the position open`,
    weekly: `make one more qualifying action on ${p.name}`,
  };
}

/** The gas token a chain settles fees in, for the farm plan's cost lines. Only chains the plan is
 *  sure about are listed; anything else falls back to a neutral phrase rather than a guess. */
const GAS_TOKEN: Record<string, string> = {
  Ethereum: 'ETH',
  Base: 'ETH',
  Arbitrum: 'ETH',
  Optimism: 'ETH',
  Ink: 'ETH',
  Scroll: 'ETH',
  Unichain: 'ETH',
  Polygon: 'POL',
  Avalanche: 'AVAX',
  Solana: 'SOL',
  Tron: 'TRX',
  BSC: 'BNB',
  Binance: 'BNB',
  Berachain: 'BERA',
  Sonic: 'S',
  'Hyperliquid L1': 'HYPE',
  Sui: 'SUI',
  Aptos: 'APT',
  Stellar: 'XLM',
};

/** Whether a chain's gas is dear: Ethereum mainnet costs dollars a transaction, most others cost cents. */
function dearGas(chain: string): boolean {
  return chain === 'Ethereum';
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names,
 * and every step names the protocol or its chain, so two protocols' plans read as written for them.
 * No step promises a token or an airdrop: the plan farms the protocol as it is, and the claim step
 * says to claim only from the protocol's own published link.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const secondChain = p.chains.length > 1 ? p.chains[1]! : null;
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const { action, weekly } = actionFor(p, capital, chain);
  const token = GAS_TOKEN[chain];
  const gasPhrase = token === undefined ? `a little of ${chain}'s gas token` : `a little ${token}`;
  const setupGas = dearGas(chain) ? 'about $8 of gas' : 'under $1 of gas';
  const weeklyGas = dearGas(chain) ? 'about $2 of gas a week' : 'under $1 of gas a week';
  const vaultish = /(vault|curator|allocator|yield)/i.test(p.category ?? '');
  const claimWhere = vaultish
    ? `open the vault's own rewards tab for ${p.name} on ${chain}`
    : `open ${p.name}'s own points or rewards page`;
  return [
    {
      text: `Set up a fresh wallet on ${chain} with ${gasPhrase}, holding only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: `${gasPhrase}, ${setupGas} for the first transaction`,
      time: '5 minutes',
    },
    {
      text: `${action}.`,
      cost: `$${capital} of capital and ${setupGas}`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as ${weekly}${secondChain === null ? '' : `, or repeat the position on ${secondChain}`} — weekly activity is what a snapshot counts.`,
      cost: weeklyGas,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw from ${p.name}, ${claimWhere} and claim only from the link it publishes; never pay anyone to claim for you.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Log the ${p.name} position on ${chain}: the wallet, the $${capital} deposit, the dates and every transaction hash, so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { multiples, globalMultiple } = categoryMultiples(snapshot, model);
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    global_multiple: globalMultiple,
    multiples,
    watchlist_slugs: snapshot.watchlist,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
