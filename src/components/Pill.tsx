import { Text, useTheme } from '@reactive/silk-native';
import type { JSX } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

type PillProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
  onPressIn?: () => void;
  testID: string;
};

/** 32px pill in a 44px hit target. Quote, sort, and interval use it. */
export function Pill({ label, selected, onPress, onPressIn, testID }: PillProps): JSX.Element {
  const { theme } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      onPressIn={onPressIn}
      style={styles.hit}
    >
      <View
        style={[
          styles.pill,
          { borderRadius: theme.semantic.radius.full },
          selected ?
            { backgroundColor: theme.semantic.color.tones.neutral.subtleActive }
          : null,
        ]}
      >
        <Text role="label" tone={selected ? 'primary' : 'secondary'}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: {
    height: 44,
    justifyContent: 'center',
  },
  pill: {
    height: 32,
    minWidth: 44,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
