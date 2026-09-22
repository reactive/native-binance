import { Button, Text } from '@reactive/silk-native';
import type { JSX } from 'react';
import { StyleSheet, View } from 'react-native';

export function LoadError({
  what,
  onRetry,
}: {
  what: string;
  onRetry: () => void;
}): JSX.Element {
  return (
    <View style={styles.block}>
      <Text testID="load-error">Couldn’t load {what}.</Text>
      <Button testID="load-retry" onPress={onRetry} style={styles.retry}>
        Try again
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    paddingHorizontal: 12,
    paddingTop: 12,
    gap: 12,
    alignItems: 'flex-start',
  },
  retry: {
    minHeight: 44,
  },
});
