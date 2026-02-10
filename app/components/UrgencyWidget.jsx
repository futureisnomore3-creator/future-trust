import React from 'react';
import { Text, Box, Card, InlineStack } from '@shopify/polaris';

/**
 * UrgencyWidget Component
 * Logic: Displays an urgency message if inventory is below a threshold.
 */
export const UrgencyWidget = ({ inventoryCount, threshold = 10 }) => {
  if (inventoryCount > threshold) return null;

  const message = inventoryCount === 0 
    ? "🚫 Currently out of stock!" 
    : `🔥 Only ${inventoryCount} left in stock - order soon!`;

  return (
    <Box paddingBlockStart="200" paddingBlockEnd="200">
      <Card background="bg-surface-critical-subdued">
        <InlineStack align="center" gap="200">
          <Text variant="bodyMd" fontWeight="bold" tone="critical">
            {message}
          </Text>
        </InlineStack>
      </Card>
    </Box>
  );
};
