import { Entity, RestEndpoint } from '@data-client/rest';

import { tokenInfoUrl } from './binanceSite';
import { SITE } from './binanceSitePaths';
import { BinanceGet } from './hosts';

const HOUR = 60 * 60 * 1000;

/** Leading kinds say how to read the rest of the screen, so they come first, in this order. */
const LEADING: readonly (readonly [string, string])[] = [
  ['bStocks', 'Tokenized stock'],
  ['tCommodities', 'Tokenized commodity'],
  ['stablecoin', 'Stablecoin'],
  ['fan_token', 'Fan token'],
];

/** The rest follow Binance's tag order. A tag missing from both tables stays hidden. */
const FOLLOWING = new Map<string, string>([
  ['Layer1_Layer2', 'Layer 1 / Layer 2'],
  ['pos', 'Proof of stake'],
  ['pow', 'Proof of work'],
  ['defi', 'DeFi'],
  ['Meme', 'Meme'],
  ['AI', 'AI'],
  ['Gaming', 'Gaming'],
  ['NFT', 'NFT'],
  ['RWA', 'Real-world assets'],
  ['Payments', 'Payments'],
  ['Infrastructure', 'Infrastructure'],
  ['liquid_staking', 'Liquid staking'],
  ['Metaverse', 'Metaverse'],
]);

const LEADING_TAGS = new Set(LEADING.map(([tag]) => tag));
const KIND_LIMIT = 2;
const PATH_CAP = 5;
const PROFILE_DEADLINE = 10_000;
const ACADEMY = 'https://www.binance.com/en/academy/articles/';

/**
 * Primers for the kinds the header shows. A tag missing here has no row.
 * Slugs are Academy's own; re-check them against the English article sitemap when editing.
 */
const CONCEPTS = new Map<string, { readonly title: string; readonly slug: string }>([
  ['bStocks', { title: 'What are bStocks?', slug: 'what-are-bstocks-a-guide-to-tokenized-stocks-on-binance' }],
  ['tCommodities', { title: 'What are real-world assets?', slug: 'what-are-real-world-assets-rwa-in-defi-and-crypto' }],
  ['stablecoin', { title: 'What is a stablecoin?', slug: 'what-is-a-stablecoin' }],
  ['fan_token', { title: 'What are fan tokens?', slug: 'what-are-binance-fan-tokens' }],
  ['Layer1_Layer2', { title: 'Layer 1 vs layer 2', slug: 'blockchain-layer-1-vs-layer-2-scaling-solutions' }],
  ['pos', { title: 'Proof of stake explained', slug: 'proof-of-stake-explained' }],
  ['pow', { title: 'Proof of work explained', slug: 'proof-of-work-explained' }],
  ['defi', { title: 'A beginner\u2019s guide to DeFi', slug: 'the-complete-beginners-guide-to-decentralized-finance-defi' }],
  ['Meme', { title: 'What are meme coins?', slug: 'what-are-meme-coins' }],
  ['AI', { title: 'Blockchain and AI', slug: 'the-relationship-between-blockchain-and-ai' }],
  ['Gaming', { title: 'What is GameFi?', slug: 'what-is-gamefi-and-how-does-it-work' }],
  ['NFT', { title: 'What is an NFT?', slug: 'what-is-an-nft' }],
  ['RWA', { title: 'What are real-world assets?', slug: 'what-are-real-world-assets-rwa-in-defi-and-crypto' }],
  ['Payments', { title: 'Crypto payments explained', slug: 'crypto-payments-explained' }],
  ['liquid_staking', { title: 'What is liquid staking?', slug: 'what-is-liquid-staking' }],
  ['Metaverse', { title: 'What is the metaverse?', slug: 'what-is-the-metaverse' }],
]);

const SHORTENERS = new Set([
  'bit.ly',
  'tinyurl.com',
  't.co',
  'goo.gl',
  'ow.ly',
  'is.gd',
  'buff.ly',
  'rebrand.ly',
  'cutt.ly',
  't.ly',
  'shorturl.at',
  'linktr.ee',
]);

const BINANCE_HOST = 'www.binance.com';

export type AssetLesson = { readonly title: string; readonly url: string };

export type PathRow = {
  readonly testID: string;
  readonly line1: string;
  readonly line2: string;
  readonly url: string;
};

/**
 * A link opens only when it is a single https URL on www.binance.com.
 * Whitespace is rejected before `new URL`, which would encode it and still parse.
 */
export function binanceHttps(value: unknown): string | undefined {
  if (typeof value !== 'string' || value === '' || /\s/.test(value)) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' || url.host !== BINANCE_HOST) return undefined;
  return value;
}

function tagList(tags: readonly string[] | null): readonly string[] {
  return Array.isArray(tags) ? tags : [];
}

/** Kinds and their primers share this walk, so a row cannot name a kind the header hid. */
function classify(tags: readonly string[]): { kinds: string[]; lessons: AssetLesson[] } {
  const kinds: string[] = [];
  const lessons: AssetLesson[] = [];
  const seenUrl = new Set<string>();
  const take = (tag: string, label: string) => {
    kinds.push(label);
    const concept = CONCEPTS.get(tag);
    if (!concept) return;
    const url = `${ACADEMY}${concept.slug}`;
    if (seenUrl.has(url)) return;
    seenUrl.add(url);
    lessons.push({ title: concept.title, url });
  };
  const present = new Set(tags);
  for (const [tag, label] of LEADING) {
    if (!present.has(tag)) continue;
    take(tag, label);
    if (kinds.length === KIND_LIMIT) return { kinds, lessons };
  }
  const seen = new Set<string>();
  for (const tag of tags) {
    if (LEADING_TAGS.has(tag) || seen.has(tag)) continue;
    seen.add(tag);
    const label = FOLLOWING.get(tag);
    if (!label) continue;
    take(tag, label);
    if (kinds.length === KIND_LIMIT) break;
  }
  return { kinds, lessons };
}

const tagReads = new WeakMap<Asset, { kinds: readonly string[]; lessons: readonly AssetLesson[] }>();

function tagRead(asset: Asset) {
  const cached = tagReads.get(asset);
  if (cached) return cached;
  const next = classify(tagList(asset.tags));
  tagReads.set(asset, next);
  return next;
}

function ipv4(hostname: string): boolean {
  const parts = hostname.split('.');
  if (parts.length !== 4) return false;
  return parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

/** A whitepaper may leave www.binance.com. Anything that fails stays off the screen. */
function externalDoc(value: unknown): { url: string; host: string } | undefined {
  if (typeof value !== 'string' || value === '' || /\s/.test(value)) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:') return undefined;
  if (url.username !== '' || url.password !== '' || url.port !== '') return undefined;
  const hostname = url.hostname;
  if (!hostname.includes('.') || ipv4(hostname) || hostname.startsWith('[') || hostname.includes(':')) {
    return undefined;
  }
  if (hostname === 'binance.com' || hostname.endsWith('.binance.com')) return undefined;
  if (SHORTENERS.has(hostname)) return undefined;
  if (hostname === 'drive.google.com' && url.pathname.startsWith('/drive/folders/')) return undefined;
  return { url: value, host: hostname.startsWith('www.') ? hostname.slice(4) : hostname };
}

function isAbort(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';
}

/**
 * data-client ignores a rejection named AbortError, so the deadline has to
 * surface as an ordinary error or the path would suspend for the session.
 */
function fetchWithDeadline(
  this: InstanceType<typeof RestEndpoint>,
  input: RequestInfo,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROFILE_DEADLINE);
  const parent = init.signal ?? undefined;
  const onParent = () => controller.abort();
  if (parent) {
    if (parent.aborted) controller.abort();
    else parent.addEventListener('abort', onParent);
  }
  const stop = () => {
    clearTimeout(timer);
    parent?.removeEventListener('abort', onParent);
  };
  return RestEndpoint.prototype.fetchResponse
    .call(this, input, { ...init, signal: controller.signal })
    .then(
      response => {
        stop();
        return response;
      },
      (error: unknown) => {
        stop();
        if (isAbort(error)) throw new Error('token-info timed out');
        throw error;
      },
    );
}

/** `""`, `null`, and the asset's own code are not a rename. */
function otherCode(value: string | null, self: string): string | undefined {
  if (typeof value !== 'string' || value === '' || value === self) return undefined;
  return value;
}

export type CautionKind =
  | 'preDelist'
  | 'renamedTo'
  | 'delisted'
  | 'monitoring'
  | 'seed'
  | 'renamedFrom';

/** The one caution that wins, or absent. `link` is set only after the host check. */
export type AssetCaution = {
  readonly kind: CautionKind;
  readonly code: string;
  readonly deadline: Date | undefined;
  readonly link: string | undefined;
};

function deadlineOf(value: Date | null): Date | undefined {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return undefined;
  return value;
}

/** One Binance asset from `get-all-asset`. Raw fields stay as sent; the read shape is getters. */
export class Asset extends Entity {
  assetCode = '';
  assetName = '';
  tags: readonly string[] = [];
  delisted = false;
  preDelist = false;
  /** Milliseconds on the wire. `static schema` restores a `Date` on read. */
  pdTradeDeadline: Date | null = null;
  pdAnnounceUrl: string | null = null;
  oldAssetCode: string | null = null;
  newAssetCode: string | null = null;
  swapAnnounceUrl: string | null = null;

  pk(): string {
    return this.assetCode;
  }

  static key = 'Asset';

  /**
   * `unvisit` calls a field schema as `schema(input)`, without `new`.
   * `Date(ms)` returns the current time as a string. It does not construct a Date.
   * `new Date(null)` is the Unix epoch, so a missing deadline stays null.
   */
  static schema = {
    pdTradeDeadline: (ms: number | null | undefined) =>
      typeof ms === 'number' ? new Date(ms) : null,
  };

  get name(): string {
    if (typeof this.assetName === 'string' && this.assetName !== '') return this.assetName;
    return this.assetCode;
  }

  get kinds(): readonly string[] {
    return tagRead(this).kinds;
  }

  /** At most two primers, in header order, one per distinct article. */
  get lessons(): readonly AssetLesson[] {
    return tagRead(this).lessons;
  }

  get renamedTo(): string | undefined {
    return otherCode(this.newAssetCode, this.assetCode);
  }

  get renamedFrom(): string | undefined {
    return otherCode(this.oldAssetCode, this.assetCode);
  }

  /** First match wins: pre-delist, renamed to, delisted, Monitoring, Seed, renamed from. */
  get caution(): AssetCaution | undefined {
    if (this.preDelist === true) {
      return {
        kind: 'preDelist',
        code: this.assetCode,
        deadline: deadlineOf(this.pdTradeDeadline),
        link: binanceHttps(this.pdAnnounceUrl),
      };
    }
    if (this.renamedTo) {
      return {
        kind: 'renamedTo',
        code: this.renamedTo,
        deadline: undefined,
        link: binanceHttps(this.swapAnnounceUrl),
      };
    }
    if (this.delisted === true) {
      return {
        kind: 'delisted',
        code: this.assetCode,
        deadline: undefined,
        link: binanceHttps(this.pdAnnounceUrl),
      };
    }
    const tags = tagList(this.tags);
    if (tags.includes('Monitoring')) {
      return { kind: 'monitoring', code: this.assetCode, deadline: undefined, link: undefined };
    }
    if (tags.includes('Seed')) {
      return { kind: 'seed', code: this.assetCode, deadline: undefined, link: undefined };
    }
    if (this.renamedFrom) {
      return {
        kind: 'renamedFrom',
        code: this.renamedFrom,
        deadline: undefined,
        link: binanceHttps(this.swapAnnounceUrl),
      };
    }
    return undefined;
  }
}

/** Academy, research, and whitepaper links. Other token-info keys stay on the stored record. */
export class AssetProfile extends Entity {
  alias = '';
  al: string | null = null;
  rsu: string | null = null;
  wpu: string | null = null;

  pk(): string {
    return this.alias;
  }

  static key = 'AssetProfile';

  get academyUrl(): string | undefined {
    return binanceHttps(this.al);
  }

  get researchUrl(): string | undefined {
    return binanceHttps(this.rsu);
  }

  get whitepaperUrl(): string | undefined {
    return externalDoc(this.wpu)?.url;
  }

  get whitepaperHost(): string | undefined {
    return externalDoc(this.wpu)?.host;
  }
}

type Candidate = { keep: number; read: number; row: PathRow };

function candidate(keep: number, read: number, row: PathRow): Candidate {
  return { keep, read, row };
}

/**
 * Reading order is asset, concepts, research, whitepaper.
 * The cap drops concept 2 first, then whitepaper, research, concept 1, and the article last.
 */
export function readingPath(asset: Asset, profile: AssetProfile | null | undefined): PathRow[] {
  const cap = PATH_CAP - (asset.caution ? 1 : 0);
  const name = asset.name;
  const rows: Candidate[] = [];
  if (profile?.academyUrl) {
    rows.push(
      candidate(4, 0, {
        testID: 'asset-academy',
        line1: `What is ${name}?`,
        line2: 'Binance Academy',
        url: profile.academyUrl,
      }),
    );
  }
  const [first, second] = asset.lessons;
  if (first) {
    rows.push(
      candidate(3, 1, {
        testID: 'asset-concept-1',
        line1: first.title,
        line2: 'Binance Academy',
        url: first.url,
      }),
    );
  }
  if (profile?.researchUrl) {
    rows.push(
      candidate(2, 3, {
        testID: 'asset-research',
        line1: `${name} research`,
        line2: 'Binance Research',
        url: profile.researchUrl,
      }),
    );
  }
  const paper = profile?.whitepaperUrl;
  const host = profile?.whitepaperHost;
  if (paper && host) {
    rows.push(
      candidate(1, 4, {
        testID: 'asset-whitepaper',
        line1: `${name} whitepaper`,
        line2: host,
        url: paper,
      }),
    );
  }
  if (second) {
    rows.push(
      candidate(0, 2, {
        testID: 'asset-concept-2',
        line1: second.title,
        line2: 'Binance Academy',
        url: second.url,
      }),
    );
  }
  return rows
    .sort((a, b) => b.keep - a.keep)
    .slice(0, cap)
    .sort((a, b) => a.read - b.read)
    .map(item => item.row);
}

type AssetEnvelope = { success?: unknown; data?: unknown };

export const getAssets = new BinanceGet({
  urlPrefix: SITE,
  path: '/bapi/asset/v2/public/asset/asset/get-all-asset',
  schema: { data: [Asset] },
  dataExpiryLength: HOUR,
  process(value: unknown) {
    if (!value || typeof value !== 'object') throw new Error('Invalid asset list');
    const body = value as AssetEnvelope;
    if (body.success !== true || !Array.isArray(body.data)) throw new Error('Invalid asset list');
    return { data: body.data };
  },
});

export const getAssetProfile = new BinanceGet({
  path: '/bapi/apex/v1/friendly/apex/marketing/web/token-info',
  searchParams: {} as { symbol: string },
  schema: { data: AssetProfile },
  dataExpiryLength: HOUR,
  /** Native calls www.binance.com. `yarn web` uses the dev proxy. Release web does not call this. */
  url(params: { symbol?: string } = {}) {
    return tokenInfoUrl(String(params.symbol ?? ''));
  },
  fetchResponse: fetchWithDeadline,
  process(value: unknown) {
    if (!value || typeof value !== 'object') throw new Error('Invalid token info');
    const body = value as AssetEnvelope;
    if (body.success !== true) throw new Error('Invalid token info');
    if (body.data === null) return { data: null };
    if (typeof body.data !== 'object' || Array.isArray(body.data)) {
      throw new Error('Invalid token info');
    }
    return { data: body.data };
  },
});
