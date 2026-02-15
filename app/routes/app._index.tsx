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
  ColorPicker,
  IndexTable,
  EmptyState,
  Modal,
  Select,
  Checkbox,
  Divider,
  Tabs,
  Badge,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getSettings, updateSettings } from "../models/settings.server";
import db from "../db.server";
import { useState, useEffect, useMemo } from "react";

// --- Helpers ---
function hexToHsb(hex: string) {
  hex = hex.replace(/^#/, '');
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  let r = parseInt(hex.substring(0, 2), 16) / 255;
  let g = parseInt(hex.substring(2, 4), 16) / 255;
  let b = parseInt(hex.substring(4, 6), 16) / 255;
  if (isNaN(r) || isNaN(g) || isNaN(b)) return { hue: 0, saturation: 0, brightness: 0 };
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

// --- Backend ---
export const loader = async ({ request }: any) => {
  const { session, admin } = await authenticate.admin(request);
  const settings = await getSettings(session.shop);
  const recentSales = await db.recentSale.findMany({
    where: { shop: session.shop },
    orderBy: { occurredAt: 'desc' },
    take: 10
  });

  let locations = [];
  try {
    const response = await admin.graphql(`query { locations(first: 10) { nodes { id name } } }`);
    const data = await response.json();
    if (data.data?.locations?.nodes) {
        locations = data.data.locations.nodes.map((loc: any) => ({
          label: loc.name,
          value: loc.name
        }));
    }
  } catch (e) { console.error("Location fetch failed (scope missing?)", e); }

  return json({ settings, recentSales, locations });
};

export const action = async ({ request }: any) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  
  if (formData.get("action") === "create_manual_sale") {
    // ... Create Sale Logic ...
    const productName = formData.get("productName");
    const customerName = formData.get("customerName");
    const city = formData.get("city");
    const rawProductId = formData.get("productId");
    const productId = rawProductId ? String(rawProductId).replace("gid://shopify/Product/", "") : null;
    const productHandle = formData.get("productHandle");

    await db.recentSale.create({
      data: {
        shop: session.shop,
        productName: String(productName),
        customerName: String(customerName),
        city: String(city),
        country: "Manual",
        productId,
        productHandle: String(productHandle),
        occurredAt: new Date(),
      }
    });
    
    // Update Metafield for Extension
    const shopResponse = await admin.graphql(`query { shop { id } }`);
    const shopJson = await shopResponse.json();
    const shopId = shopJson.data.shop.id;

    const recentSales = await db.recentSale.findMany({
      where: { shop: session.shop },
      orderBy: { occurredAt: 'desc' },
      take: 50
    });

    const salesJson = recentSales.map(s => ({
      name: s.customerName,
      location: s.city || "Nearby",
      product: s.productName,
      productId: s.productId,
      handle: s.productHandle,
      time: s.occurredAt.toISOString()
    }));

    await admin.graphql(
      `#graphql
      mutation SetMetafield($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) { userErrors { field message } }
      }`,
      { variables: { metafields: [{ key: "recent_sales", namespace: "future_trust", ownerId: shopId, type: "json", value: JSON.stringify(salesJson) }] } }
    );

    return json({ status: "created" });
  }

  // --- SAVE SETTINGS ---
  const data = {
    urgencyEnabled: formData.get("urgencyEnabled") === "true",
    urgencyThreshold: parseInt(formData.get("urgencyThreshold")),
    urgencyText: formData.get("urgencyText"),
    urgencyTextColor: formData.get("urgencyTextColor"),
    urgencyBgColor: formData.get("urgencyBgColor"),
    socialEnabled: formData.get("socialEnabled") === "true",
    socialDelay: parseInt(formData.get("socialDelay")),
    socialDuration: parseInt(formData.get("socialDuration")),
    crossSellEnabled: formData.get("crossSellEnabled") === "true",
    showVerified: formData.get("showVerified") === "true",
    desktopPosition: formData.get("desktopPosition"),
    mobilePosition: formData.get("mobilePosition"),
    hideMobile: formData.get("hideMobile") === "true",
  };

  await updateSettings(session.shop, data);
  
  const shopResponse = await admin.graphql(`query { shop { id } }`);
  const shopJson = await shopResponse.json();
  const shopId = shopJson.data.shop.id;
  
  await admin.graphql(
    `#graphql
    mutation SetSettings($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) { userErrors { field message } }
    }`,
    { variables: { metafields: [{ key: "settings", namespace: "future_trust", ownerId: shopId, type: "json", value: JSON.stringify(data) }] } }
  );

  return json({ status: "saved", settings: data });
};

// --- Main Component ---
export default function Index() {
  const { settings: initialSettings, recentSales, locations } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  // Form State
  const [formState, setFormState] = useState(initialSettings);
  const [cleanState, setCleanState] = useState(initialSettings);
  
  // Colors
  const [textColorHsb, setTextColorHsb] = useState(hexToHsb(initialSettings.urgencyTextColor));
  const [bgColorHsb, setBgColorHsb] = useState(hexToHsb(initialSettings.urgencyBgColor));

  // Modals & Tabs
  const [modalActive, setModalActive] = useState(false);
  const [manualCustomer, setManualCustomer] = useState("Alice");
  const [manualLocation, setManualLocation] = useState(locations[0]?.value || "New York");
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [selectedTab, setSelectedTab] = useState(0);

  // --- DIRTY STATE LOGIC ---
  const isDirty = useMemo(() => {
    return JSON.stringify(formState) !== JSON.stringify(cleanState);
  }, [formState, cleanState]);

  // --- SAVE BAR LOGIC (Safe Method for App Bridge v4) ---
  useEffect(() => {
    if (isDirty) {
      shopify.saveBar.show('my-save-bar');
    } else {
      shopify.saveBar.hide('my-save-bar');
    }
  }, [isDirty, shopify]);

  // Handle Save Action (Triggered by Save Bar)
  const handleSave = () => {
    fetcher.submit(
      { ...formState },
      { method: "POST" }
    );
  };

  const handleDiscard = () => {
    setFormState(cleanState);
    setTextColorHsb(hexToHsb(cleanState.urgencyTextColor));
    setBgColorHsb(hexToHsb(cleanState.urgencyBgColor));
    shopify.saveBar.hide('my-save-bar');
  };

  // Optimistic UI Update & Bar Handling
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.status === "saved") {
      setCleanState(fetcher.data.settings);
      shopify.saveBar.hide('my-save-bar');
      shopify.toast.show("Settings saved");
    }
  }, [fetcher.state, fetcher.data, shopify]);

  // Helper: Update Colors
  const updateColor = (key: string, hsb: any) => {
    const hex = hsbToHex(hsb);
    if (key === 'urgencyTextColor') setTextColorHsb(hsb);
    if (key === 'urgencyBgColor') setBgColorHsb(hsb);
    setFormState(prev => ({ ...prev, [key]: hex }));
  };

  // Helper: Create Sale
  const handleCreateSale = () => {
    if (!selectedProduct) return shopify.toast.show("Select a product first");
    
    fetcher.submit({ 
        action: "create_manual_sale",
        productName: selectedProduct.title,
        productId: selectedProduct.id,
        productHandle: selectedProduct.handle || "",
        customerName: manualCustomer,
        city: manualLocation
    }, { method: "POST" });
    
    setModalActive(false);
    setSelectedProduct(null);
    shopify.toast.show("Sale created");
  };

  const selectProduct = async () => {
    const selected = await shopify.resourcePicker({ type: 'product', multiple: false });
    if (selected?.[0]) setSelectedProduct(selected[0]);
  };

  return (
    <Page>
      <TitleBar title="FutureTrust">
        {/* Safe: We use imperative calls in useEffect, but declare the button here for v4 compatibility */}
        <button variant="primary" onClick={handleSave} disabled={!isDirty}>Save</button>
        <button onClick={handleDiscard} disabled={!isDirty}>Discard</button>
      </TitleBar>
      
      <BlockStack gap="500">
        <Card padding="0">
            <Tabs 
                tabs={[
                    { id: 'widgets', content: 'Widgets & Appearance' },
                    { id: 'data', content: 'Data & Sales' },
                ]} 
                selected={selectedTab} 
                onSelect={setSelectedTab} 
                fitted 
            />
        </Card>

        {selectedTab === 0 && (
          <Layout>
            <Layout.AnnotatedSection
              title="Recent Sales Popup"
              description="Show real or manual sales to build social proof."
            >
              <Card>
                <BlockStack gap="500">
                  <InlineGrid columns="1fr auto" alignItems="center">
                    <Text as="h3" variant="headingSm">Enable Popup</Text>
                    <Button 
                      pressed={formState.socialEnabled} 
                      onClick={() => setFormState(s => ({...s, socialEnabled: !s.socialEnabled}))}
                      role="switch"
                    >
                      {formState.socialEnabled ? "On" : "Off"}
                    </Button>
                  </InlineGrid>

                  <Divider />

                  <Text as="h4" variant="headingXs">Behavior</Text>
                  <Checkbox
                    label="Enable AI Cross-Sells"
                    helpText="Shows 'Bought With' popups for complementary products."
                    checked={formState.crossSellEnabled}
                    onChange={(v) => setFormState(s => ({...s, crossSellEnabled: v}))}
                  />
                  <Checkbox
                    label="Hide on Mobile Devices"
                    checked={formState.hideMobile}
                    onChange={(v) => setFormState(s => ({...s, hideMobile: v}))}
                  />

                  <Text as="h4" variant="headingXs">Positioning</Text>
                  <InlineGrid columns={2} gap="400">
                    <Select
                      label="Desktop"
                      options={[
                        {label: 'Bottom Left', value: 'bottom_left'},
                        {label: 'Bottom Right', value: 'bottom_right'},
                        {label: 'Top Left', value: 'top_left'},
                        {label: 'Top Right', value: 'top_right'},
                      ]}
                      value={formState.desktopPosition}
                      onChange={(v) => setFormState(s => ({...s, desktopPosition: v}))}
                    />
                    <Select
                      label="Mobile"
                      options={[
                        {label: 'Top (Recommended)', value: 'top'},
                        {label: 'Bottom', value: 'bottom'},
                      ]}
                      value={formState.mobilePosition}
                      onChange={(v) => setFormState(s => ({...s, mobilePosition: v}))}
                    />
                  </InlineGrid>

                  <Text as="h4" variant="headingXs">Design</Text>
                  <Checkbox
                    label="Show 'Verified' Badge"
                    checked={formState.showVerified}
                    onChange={(v) => setFormState(s => ({...s, showVerified: v}))}
                  />
                  
                  <InlineGrid columns={2} gap="400">
                     <BlockStack gap="200">
                        <TextField 
                            label="Text Color" 
                            value={formState.urgencyTextColor} 
                            onChange={(v) => updateColor('urgencyTextColor', hexToHsb(v))} 
                            autoComplete="off"
                            prefix={<div style={{width: 16, height: 16, borderRadius: 2, background: formState.urgencyTextColor}} />}
                        />
                        <ColorPicker onChange={(h) => updateColor('urgencyTextColor', h)} color={textColorHsb} allowAlpha={false} />
                     </BlockStack>
                     <BlockStack gap="200">
                        <TextField 
                            label="Background Color" 
                            value={formState.urgencyBgColor} 
                            onChange={(v) => updateColor('urgencyBgColor', hexToHsb(v))} 
                            autoComplete="off"
                            prefix={<div style={{width: 16, height: 16, borderRadius: 2, background: formState.urgencyBgColor, border: '1px solid #ccc'}} />}
                        />
                        <ColorPicker onChange={(h) => updateColor('urgencyBgColor', h)} color={bgColorHsb} allowAlpha={false} />
                     </BlockStack>
                  </InlineGrid>
                </BlockStack>
              </Card>
            </Layout.AnnotatedSection>

            <Layout.AnnotatedSection
              title="Inventory Urgency"
              description="Create scarcity by showing low stock alerts."
            >
              <Card>
                <BlockStack gap="400">
                    <InlineGrid columns="1fr auto" alignItems="center">
                        <Text as="h3" variant="headingSm">Enable Widget</Text>
                        <Button 
                            pressed={formState.urgencyEnabled} 
                            onClick={() => setFormState(s => ({...s, urgencyEnabled: !s.urgencyEnabled}))}
                            role="switch"
                        >
                            {formState.urgencyEnabled ? "On" : "Off"}
                        </Button>
                    </InlineGrid>
                    <RangeSlider
                        label="Threshold"
                        value={formState.urgencyThreshold}
                        onChange={(v) => setFormState(s => ({...s, urgencyThreshold: v}))}
                        min={1}
                        max={50}
                        suffix="units"
                    />
                    <TextField
                        label="Message Template"
                        value={formState.urgencyText}
                        onChange={(v) => setFormState(s => ({...s, urgencyText: v}))}
                        autoComplete="off"
                        helpText="Use {{ quantity }} for the actual stock level."
                    />
                </BlockStack>
              </Card>
            </Layout.AnnotatedSection>
          </Layout>
        )}

        {selectedTab === 1 && (
          <Layout>
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <InlineGrid columns="1fr auto" alignItems="center">
                    <Text as="h3" variant="headingSm">Sales History</Text>
                    <Button variant="primary" onClick={() => setModalActive(true)}>+ Create Manual Sale</Button>
                  </InlineGrid>
                  
                  {recentSales.length > 0 ? (
                    <IndexTable
                      resourceName={{ singular: 'sale', plural: 'sales' }}
                      itemCount={recentSales.length}
                      headings={[
                        { title: 'Customer' },
                        { title: 'Product' },
                        { title: 'Location' },
                        { title: 'Date' },
                      ]}
                      selectable={false}
                    >
                      {recentSales.map((sale, i) => (
                        <IndexTable.Row id={sale.id} key={sale.id} position={i}>
                          <IndexTable.Cell>{sale.customerName}</IndexTable.Cell>
                          <IndexTable.Cell>
                            <InlineGrid columns="auto 1fr" gap="200" alignItems="center">
                                {sale.productHandle && <Badge tone="info">Linked</Badge>}
                                <Text as="span" variant="bodyMd">{sale.productName}</Text>
                            </InlineGrid>
                          </IndexTable.Cell>
                          <IndexTable.Cell>{sale.city}</IndexTable.Cell>
                          <IndexTable.Cell>{new Date(sale.occurredAt).toLocaleString()}</IndexTable.Cell>
                        </IndexTable.Row>
                      ))}
                    </IndexTable>
                  ) : (
                    <EmptyState
                      heading="No sales yet"
                      image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                    >
                      <p>Real orders will appear here automatically. You can also create manual social proof.</p>
                    </EmptyState>
                  )}
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>
        )}

        <Modal
          open={modalActive}
          onClose={() => setModalActive(false)}
          title="Create Manual Sale"
          primaryAction={{ content: 'Create', onAction: handleCreateSale }}
          secondaryActions={[{ content: 'Cancel', onAction: () => setModalActive(false) }]}
        >
          <Modal.Section>
            <BlockStack gap="400">
                <Box>
                    <Text as="p" variant="bodyMd" tone="subdued">Select Product</Text>
                    <Box paddingBlockStart="200">
                        <InlineGrid columns="1fr auto" gap="200" alignItems="center">
                            <TextField 
                                label="Product" labelHidden 
                                value={selectedProduct ? selectedProduct.title : ""} 
                                placeholder="No product selected" disabled autoComplete="off"
                            />
                            <Button onClick={selectProduct}>Browse</Button>
                        </InlineGrid>
                    </Box>
                </Box>
                <TextField label="Customer Name" value={manualCustomer} onChange={setManualCustomer} autoComplete="off" />
                <Select label="Store Location" options={locations} value={manualLocation} onChange={setManualLocation} />
            </BlockStack>
          </Modal.Section>
        </Modal>
      </BlockStack>
    </Page>
  );
}
