import React, { useState, useEffect } from 'react';
import { Box, Text, InlineStack, Thumbnail } from '@shopify/polaris';

/**
 * RecentPurchasePopup Component
 * Logic: Slides in a notification showing a recent "simulated" or real purchase.
 */
export const RecentPurchasePopup = ({ cityName, productName, timeAgo }) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Logic: Delay the popup for 3 seconds after page load
    const timer = setTimeout(() => setVisible(true), 3000);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: '20px',
      left: '20px',
      zIndex: 999,
      animation: 'slideIn 0.5s ease-out'
    }}>
      <Box 
        background="bg-surface" 
        padding="300" 
        borderRadius="200" 
        shadow="card"
        borderWidth="100"
        borderColor="border"
      >
        <InlineStack gap="300" align="center">
          <Thumbnail size="small" source="https://cdn.shopify.com/s/files/1/0000/0000/products/sample_50x50.png" alt={productName} />
          <Box>
            <Text variant="bodySm" fontWeight="bold">
              Someone in {cityName} just bought a {productName}!
            </Text>
            <Text variant="bodyXs" tone="subdued">
              {timeAgo} ago
            </Text>
          </Box>
        </InlineStack>
      </Box>
      <style>{`
        @keyframes slideIn {
          from { transform: translateX(-100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
};
