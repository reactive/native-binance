import { Entity, RestEndpoint } from '@data-client/rest';

import { tokenInfoUrl } from './binanceSite';
import { SITE } from './binanceSitePaths';
import { binanceGetInit, keepLastRead } from './hosts';

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

const BINANCE_HOST = 'www.binance.com';

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

function kindsOf(tags: readonly string[]): string[] {
  const labels: string[] = [];
  const present = new Set(tags);
  for (const [tag, label] of LEADING) {
    if (!present.has(tag)) continue;
    labels.push(label);
    if (labels.length === KIND_LIMIT) return labels;
  }
  const seen = new Set<string>();
  for (const tag of tags) {
    if (LEADING_TAGS.has(tag) || seen.has(tag)) continue;
    seen.add(tag);
    const label = FOLLOWING.get(tag);
    if (!label) continue;
    labels.push(label);
    if (labels.length === KIND_LIMIT) break;
  }
  return labels;
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
    return kindsOf(tagList(this.tags));
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

/** Academy and research links for one code. Other token-info keys stay on the stored record. */
export class AssetProfile extends Entity {
  alias = '';
  al: string | null = null;
  rsu: string | null = null;

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
}

type AssetEnvelope = { success?: unknown; data?: unknown };

export const getAssets = new RestEndpoint({
  urlPrefix: SITE,
  path: '/bapi/asset/v2/public/asset/asset/get-all-asset',
  schema: { data: [Asset] },
  getRequestInit: binanceGetInit,
  errorPolicy: keepLastRead,
  dataExpiryLength: HOUR,
  process(value: unknown) {
    if (!value || typeof value !== 'object') throw new Error('Invalid asset list');
    const body = value as AssetEnvelope;
    if (body.success !== true || !Array.isArray(body.data)) throw new Error('Invalid asset list');
    return { data: body.data };
  },
});

export const getAssetProfile = new RestEndpoint({
  path: '/bapi/apex/v1/friendly/apex/marketing/web/token-info',
  searchParams: {} as { symbol: string },
  schema: { data: AssetProfile },
  getRequestInit: binanceGetInit,
  errorPolicy: keepLastRead,
  dataExpiryLength: HOUR,
  /** Native calls www.binance.com. `yarn web` uses the dev proxy. Release web does not call this. */
  url(params: { symbol?: string } = {}) {
    return tokenInfoUrl(String(params.symbol ?? ''));
  },
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
