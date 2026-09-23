import { AsyncBoundary, useFetch, useQuery, useSuspense } from '@data-client/react';
import { Badge, Skeleton, Text, useTheme } from '@reactive/silk-native';
import * as Linking from 'expo-linking';
import type { JSX, ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { formatDeadline } from '@/components/formatDeadline';
import { Asset, getAssetProfile, getAssets, type AssetCaution } from '@/resources/Asset';

const GAP = 32;
const HEADER = 56;
const ROW = 48;
const GUTTER = 12;
const NAME_LINE = 21.6;
const CAPTION_LINE = 16.2;
/** Both header lines stay reserved, so an empty caption does not move the name. */
const HEADER_TOP = (HEADER - NAME_LINE - CAPTION_LINE) / 2;

type HeaderState = 'loading' | 'failed' | 'missing' | 'ready';

function sentences(parts: readonly string[]): string {
  return parts.map(part => (part.endsWith('.') ? part : `${part}.`)).join(' ');
}

function cautionView(caution: AssetCaution, now: number): {
  line1: string;
  line2: string | undefined;
  badge: string;
} {
  const announced = caution.link ? 'Binance announcement' : undefined;
  if (caution.kind === 'preDelist') {
    if (!caution.deadline) {
      return { line1: `Binance is delisting ${caution.code}`, line2: announced, badge: 'Delisting' };
    }
    const { when, future } = formatDeadline(caution.deadline, now);
    return {
      line1: future ? `Trading ends ${when}` : `Trading ended ${when}`,
      line2: announced,
      badge: future ? 'Delisting' : 'Delisted',
    };
  }
  if (caution.kind === 'renamedTo') {
    return { line1: `Now trades as ${caution.code}`, line2: announced, badge: 'Renamed' };
  }
  if (caution.kind === 'delisted') {
    return { line1: `Binance delisted ${caution.code}`, line2: announced, badge: 'Delisted' };
  }
  if (caution.kind === 'monitoring') {
    return {
      line1: 'Binance may delist it',
      line2: 'Notably higher volatility and risk',
      badge: 'Monitoring',
    };
  }
  if (caution.kind === 'seed') {
    return {
      line1: 'Newer project',
      line2: 'May have higher volatility and risk',
      badge: 'Seed',
    };
  }
  return { line1: `Renamed from ${caution.code}`, line2: announced, badge: 'Renamed' };
}

function openLink(url: string) {
  Linking.openURL(url).catch(() => {});
}

function A11yGroup({
  children,
  row,
}: {
  children: ReactNode;
  row?: boolean;
}): JSX.Element {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={row ? styles.fill : undefined}
    >
      {children}
    </View>
  );
}

function AssetHeader({
  code,
  state,
  name,
  kinds,
}: {
  code: string;
  state: HeaderState;
  name?: string;
  kinds?: readonly string[];
}): JSX.Element {
  const title = state === 'ready' ? (name ?? code) : code;
  const kindLine = kinds && kinds.length > 0 ? kinds.join(', ') : undefined;
  const line2 =
    state === 'failed' ? 'Couldn’t load asset details'
    : state === 'missing' ? `No asset details for ${code}`
    : kindLine;
  const label = line2 ? `${title}, ${line2}` : title;
  return (
    <View
      testID="asset-header"
      accessible
      accessibilityRole="header"
      accessibilityLabel={label}
      style={styles.header}
    >
      <A11yGroup>
        <Text role="headingSm" numberOfLines={1} testID="asset-name">
          {title}
        </Text>
        <View testID="asset-kinds" style={styles.kinds}>
          {state === 'loading' ?
            <Skeleton testID="asset-kinds-loading" style={styles.kindSkeleton} />
          : line2 ?
            <Text role="caption" tone="secondary" numberOfLines={1}>
              {line2}
            </Text>
          : null}
        </View>
      </A11yGroup>
    </View>
  );
}

function Stack({
  line1,
  line2,
  gap,
}: {
  line1: string;
  line2: string | undefined;
  gap?: boolean;
}): JSX.Element {
  return (
    <View style={[styles.stack, gap ? styles.stackGap : null]}>
      <Text role="label" numberOfLines={1}>
        {line1}
      </Text>
      {line2 ?
        <Text role="caption" tone="secondary" numberOfLines={1}>
          {line2}
        </Text>
      : null}
    </View>
  );
}

function CautionRow({ caution }: { caution: AssetCaution }): JSX.Element {
  const view = cautionView(caution, Date.now());
  const press = caution.link;
  const label = sentences([view.badge, view.line1, ...(view.line2 ? [view.line2] : [])]);
  const body = (
    <A11yGroup row>
      <Stack line1={view.line1} line2={view.line2} gap />
      <Badge size="sm" testID="asset-caution-badge">
        {view.badge}
      </Badge>
    </A11yGroup>
  );
  if (!press) {
    return (
      <View testID="asset-caution" accessible accessibilityLabel={label} style={styles.row}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      testID="asset-caution"
      accessible
      accessibilityRole="link"
      accessibilityLabel={label}
      accessibilityHint="Opens in the browser"
      onPress={() => openLink(press)}
      style={styles.row}
    >
      {body}
    </Pressable>
  );
}

function LinkRow({
  testID,
  line1,
  line2,
  url,
  lined,
}: {
  testID: string;
  line1: string;
  line2: string;
  url: string;
  lined: boolean;
}): JSX.Element {
  const { theme } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessible
      accessibilityRole="link"
      accessibilityLabel={`${line1}, ${line2}`}
      accessibilityHint="Opens in the browser"
      onPress={() => openLink(url)}
      style={[
        styles.row,
        lined ? styles.lined : null,
        lined ? { borderTopColor: theme.semantic.color.borderSubtle } : null,
      ]}
    >
      <A11yGroup row>
        <Stack line1={line1} line2={line2} />
      </A11yGroup>
    </Pressable>
  );
}

function ProfileLinks({ asset }: { asset: Asset }): JSX.Element | null {
  const loaded = useSuspense(getAssetProfile, { symbol: asset.assetCode });
  const profile = loaded.data;
  if (!profile) return null;
  const rows: { testID: string; line1: string; line2: string; url: string }[] = [];
  if (profile.academyUrl) {
    rows.push({
      testID: 'asset-academy',
      line1: `What is ${asset.name}?`,
      line2: 'Binance Academy',
      url: profile.academyUrl,
    });
  }
  if (profile.researchUrl) {
    rows.push({
      testID: 'asset-research',
      line1: `${asset.name} research`,
      line2: 'Binance Research',
      url: profile.researchUrl,
    });
  }
  if (rows.length === 0) return null;
  const caution = asset.caution != null;
  return (
    <>
      {rows.map((row, index) => (
        <LinkRow
          key={row.testID}
          testID={row.testID}
          line1={row.line1}
          line2={row.line2}
          url={row.url}
          lined={index > 0 || caution}
        />
      ))}
    </>
  );
}

function AssetLoaded({
  base,
  fetchProfile,
}: {
  base: string;
  fetchProfile: boolean;
}): JSX.Element {
  useSuspense(getAssets);
  const asset = useQuery(Asset, { assetCode: base });
  if (!asset) return <AssetHeader code={base} state="missing" />;
  return (
    <View>
      <AssetHeader code={base} state="ready" name={asset.name} kinds={asset.kinds} />
      {asset.caution ? <CautionRow caution={asset.caution} /> : null}
      {fetchProfile ?
        <AsyncBoundary fallback={null} errorComponent={() => null}>
          <ProfileLinks asset={asset} />
        </AsyncBoundary>
      : null}
    </View>
  );
}

/** Asset block under the instrument rows. Renders nothing until the caller has a base code. */
export function AssetSection({ base }: { base: string }): JSX.Element {
  const fetchProfile = !(Platform.OS === 'web' && !__DEV__);
  useFetch(getAssetProfile, fetchProfile ? { symbol: base } : null);
  return (
    <View>
      <View testID="asset-gap" style={styles.gap} />
      <AsyncBoundary
        fallback={<AssetHeader code={base} state="loading" />}
        errorComponent={() => <AssetHeader code={base} state="failed" />}
      >
        <AssetLoaded base={base} fetchProfile={fetchProfile} />
      </AsyncBoundary>
    </View>
  );
}

const styles = StyleSheet.create({
  gap: {
    height: GAP,
  },
  header: {
    height: HEADER,
    paddingHorizontal: GUTTER,
    paddingTop: HEADER_TOP,
  },
  kinds: {
    height: CAPTION_LINE,
    justifyContent: 'center',
  },
  kindSkeleton: {
    width: 120,
    height: 12,
  },
  row: {
    height: ROW,
    paddingHorizontal: GUTTER,
    flexDirection: 'row',
    alignItems: 'center',
  },
  fill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  stack: {
    flex: 1,
  },
  stackGap: {
    marginRight: GUTTER,
  },
  lined: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
