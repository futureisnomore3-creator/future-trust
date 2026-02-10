import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  Box,
  InlineGrid,
  TextField,
  RangeSlider,
  Banner,
  CalloutCard,
  ColorPicker,
  IndexTable,
  EmptyState,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getSettings, updateSettings } from "../models/settings.server";
import db from "../db.server";
import { useState } from "react";

// Simple Color Helpers
function hexToHsb(hex: string) {
  hex = hex.replace(/^#/, '');
  let r = parseInt(hex.substring(0, 2), 16);
  let g = parseInt(hex.substring(2, 4), 16);
  let b = parseInt(hex.substring(4, 6), 16);
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  const d = max - min;
  s = max === 0 ? 0 : d / max;
  if (max !== min) {
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { hue: h * 360, saturation: s, brightness: max };
}

function hsbToHex(hsb: { hue: number; saturation: number; brightness: number }) {
  const h = hsb.hue / 360;
  const s = hsb.saturation;
  const v = hsb.brightness;
  let r = 0, g = 0, b = 0;
  let i = Math.floor(h * 6);
  let f = h * 6 - i;
  let p = v * (1 - s);
  let q = v * (1 - f * s);
  let t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }
  const toHex = (x: number) => {
    const hex = Math.round(x * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

export const loader = async ({ request }: any) => {
  const { session } = await authenticate.admin(request);
  const settings = await getSettings(session.shop);
  const recentSales = await db.recentSale.findMany({
    where: { shop: session.shop },
    orderBy: { occurredAt: 'desc' },
    take: 10
  });
  return json({ settings, recentSales });
};

// Helper to push metafields
async function pushMetafields(admin: any, shopId: string, key: string, value: string) {
  try {
    const response = await admin.graphql(
      `#graphql
      mutation CreateAppData($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { field message }
        }
      }`,
      {
        variables: {
          metafields: [
            {
              key,
              namespace: "future_trust",
              ownerId: shopId,
              type: "json",
              value,
            }
          ]
        },
      },
    );
    
    if (response.ok) {
        const data = await response.json();
        if (data.data?.metafieldsSet?.userErrors?.length > 0) {
            console.error("Metafield errors:", data.data.metafieldsSet.userErrors);
        }
    } else {
        console.error("Failed to push metafields:", response.statusText);
    }
  } catch (err) {
    console.error("GraphQL execution failed:", err);
  }
}

export const action = async ({ request }: any) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  
  // Fetch Shop ID once
  let shopId;
  try {
      const shopData = await admin.graphql(`#graphql query { shop { id } }`);
      const shopJson = await shopData.json();
      shopId = shopJson.data.shop.id;
  } catch (e) {
      console.error("Failed to fetch Shop ID:", e);
      return json({ status: "error", message: "Could not connect to Shopify API" }, { status: 500 });
  }

  if (formData.get("action") === "simulate_order") {
    // Simulate a webhook payload
    const fakeProduct = ["Cozy Sweater", "Wireless Earbuds", "Gaming Mouse", "Yoga Mat", "Coffee Maker"][Math.floor(Math.random() * 5)];
    const fakeCity = ["Austin", "London", "Tokyo", "Berlin", "New York"][Math.floor(Math.random() * 5)];
    const fakeName = ["Alice", "Bob", "Charlie", "Diana", "Evan"][Math.floor(Math.random() * 5)];

    await db.recentSale.create({
      data: {
        shop: session.shop,
        productName: fakeProduct,
        customerName: fakeName,
        city: fakeCity,
        country: "US",
        occurredAt: new Date(),
      }
    });

    // Manually trigger the metafield update logic
    const recentSales = await db.recentSale.findMany({
      where: { shop: session.shop },
      orderBy: { occurredAt: 'desc' },
      take: 20
    });

    const salesJson = recentSales.map(s => ({
      name: s.customerName,
      location: s.city || "Nearby",
      product: s.productName,
      time: s.occurredAt.toISOString()
    }));

    await pushMetafields(admin, shopId, "recent_sales", JSON.stringify(salesJson));

    return json({ status: "simulated" });
  }

  const data = {
    urgencyEnabled: formData.get("urgencyEnabled") === "true",
    urgencyThreshold: parseInt(formData.get("urgencyThreshold")),
    urgencyText: formData.get("urgencyText"),
    urgencyTextColor: formData.get("urgencyTextColor"),
    urgencyBgColor: formData.get("urgencyBgColor"),
    socialEnabled: formData.get("socialEnabled") === "true",
    socialDelay: parseInt(formData.get("socialDelay")),
    socialDuration: parseInt(formData.get("socialDuration")),
  };

  await updateSettings(session.shop, data);
  await pushMetafields(admin, shopId, "settings", JSON.stringify(data));

  return json({ status: "success" });
};

export default function Index() {
  const { settings, recentSales } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  
  const [urgencyEnabled, setUrgencyEnabled] = useState(settings.urgencyEnabled);
  const [urgencyThreshold, setUrgencyThreshold] = useState(settings.urgencyThreshold);
  const [urgencyText, setUrgencyText] = useState(settings.urgencyText);
  
  const [textColor, setTextColor] = useState(hexToHsb(settings.urgencyTextColor));
  const [bgColor, setBgColor] = useState(hexToHsb(settings.urgencyBgColor));

  const [socialEnabled, setSocialEnabled] = useState(settings.socialEnabled);
  const [socialDelay, setSocialDelay] = useState(settings.socialDelay);
  const [socialDuration, setSocialDuration] = useState(settings.socialDuration);

  const handleSave = () => {
    fetcher.submit(
      {
        urgencyEnabled: String(urgencyEnabled),
        urgencyThreshold: String(urgencyThreshold),
        urgencyText,
        urgencyTextColor: hsbToHex(textColor),
        urgencyBgColor: hsbToHex(bgColor),
        socialEnabled: String(socialEnabled),
        socialDelay: String(socialDelay),
        socialDuration: String(socialDuration),
      },
      { method: "POST" }
    );
    shopify.toast.show("Settings saved");
  };

  const handleSimulateOrder = () => {
    fetcher.submit({ action: "simulate_order" }, { method: "POST" });
    shopify.toast.show("Simulated order created");
  };

  const resourceName = {
    singular: 'sale',
    plural: 'sales',
  };

  const rowMarkup = recentSales.map(
    ({ id, customerName, productName, city, occurredAt }, index) => (
      <IndexTable.Row id={id} key={id} position={index}>
        <IndexTable.Cell>{customerName}</IndexTable.Cell>
        <IndexTable.Cell>{productName}</IndexTable.Cell>
        <IndexTable.Cell>{city}</IndexTable.Cell>
        <IndexTable.Cell>{new Date(occurredAt).toLocaleString()}</IndexTable.Cell>
      </IndexTable.Row>
    ),
  );

  return (
    <Page>
      <TitleBar title="FutureTrust Dashboard">
        <button variant="primary" onClick={handleSave} disabled={fetcher.state !== "idle"}>
          Save Changes
        </button>
      </TitleBar>

      <BlockStack gap="500">
        <CalloutCard
          title="App Embeds are active"
          illustration="https://cdn.shopify.com/s/assets/admin/checkout/settings-customizecart-705f57c725ac05be5a34ec20c05b94298cb8afd10aac7bd9c7ad02030f48cfa0.svg"
          primaryAction={{
            content: 'Open Theme Editor',
            url: `https://${settings.shop}/admin/themes/current/editor?context=apps`,
            target: '_blank'
          }}
        >
          <p>Your widgets are currently visible on your storefront.</p>
        </CalloutCard>

        <Layout>
          <Layout.AnnotatedSection
            title="Inventory Urgency"
            description="Create FOMO by showing low stock alerts on product pages."
          >
            <Card>
              <BlockStack gap="500">
                <InlineGrid columns="1fr auto">
                   <Text as="h3" variant="headingSm">Enable Widget</Text>
                   <Button 
                      pressed={urgencyEnabled} 
                      onClick={() => setUrgencyEnabled(!urgencyEnabled)}
                      role="switch"
                      ariaChecked={urgencyEnabled ? 'true' : 'false'}
                   >
                     {urgencyEnabled ? "On" : "Off"}
                   </Button>
                </InlineGrid>
                
                <RangeSlider
                  label="Low Stock Threshold"
                  value={urgencyThreshold}
                  onChange={setUrgencyThreshold}
                  min={1}
                  max={50}
                  output
                  suffix="units"
                  helpText="Widget appears when inventory drops below this number."
                />

                <TextField
                  label="Message Template"
                  value={urgencyText}
                  onChange={setUrgencyText}
                  autoComplete="off"
                  helpText="Use {{ quantity }} to insert the actual stock level."
                />

                <Text as="p" variant="bodyMd">Text Color</Text>
                <div style={{width: '200px'}}>
                  <ColorPicker onChange={setTextColor} color={textColor} allowAlpha={false} />
                </div>
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection
            title="Recent Sales Notification"
            description="Build trust by showing recent buyer activity in real-time."
          >
             <Card>
              <BlockStack gap="500">
                <InlineGrid columns="1fr auto">
                   <Text as="h3" variant="headingSm">Enable Popup</Text>
                   <Button 
                      pressed={socialEnabled} 
                      onClick={() => setSocialEnabled(!socialEnabled)}
                      role="switch"
                      ariaChecked={socialEnabled ? 'true' : 'false'}
                   >
                     {socialEnabled ? "On" : "Off"}
                   </Button>
                </InlineGrid>

                <InlineGrid columns={2} gap="400">
                  <TextField
                    label="Initial Delay"
                    type="number"
                    value={String(socialDelay)}
                    onChange={(v) => setSocialDelay(parseInt(v))}
                    suffix="seconds"
                    autoComplete="off"
                  />
                  <TextField
                    label="Display Duration"
                    type="number"
                    value={String(socialDuration)}
                    onChange={(v) => setSocialDuration(parseInt(v))}
                    suffix="seconds"
                    autoComplete="off"
                  />
                </InlineGrid>

                <Box paddingBlockStart="400">
                  <BlockStack gap="300">
                    <InlineGrid columns="1fr auto" alignItems="center">
                      <Text as="h3" variant="headingSm">Recent Orders</Text>
                      <Button onClick={handleSimulateOrder} size="slim">Simulate Sale</Button>
                    </InlineGrid>
                    
                    {recentSales.length > 0 ? (
                      <IndexTable
                        resourceName={resourceName}
                        itemCount={recentSales.length}
                        headings={[
                          { title: 'Customer' },
                          { title: 'Product' },
                          { title: 'Location' },
                          { title: 'Date' },
                        ]}
                        selectable={false}
                      >
                        {rowMarkup}
                      </IndexTable>
                    ) : (
                      <EmptyState
                        heading="No sales yet"
                        image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                      >
                        <p>Orders will appear here automatically when syncing is active.</p>
                      </EmptyState>
                    )}
                  </BlockStack>
                </Box>
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>
        </Layout>
      </BlockStack>
    </Page>
  );
}
