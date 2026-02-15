import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, admin } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const order = payload as any;
  
  // Basic validation
  if (!order || !order.id) {
    return new Response();
  }

  // Extract relevant info
  const customerName = order.customer?.first_name || order.shipping_address?.first_name || "Someone";
  const city = order.shipping_address?.city || order.billing_address?.city || "Nearby";
  const country = order.shipping_address?.country_code || order.billing_address?.country_code;
  
  // Get product details from the first line item
  const lineItem = order.line_items?.[0];
  const productName = lineItem?.title || "Popular Item";
  
  // Clean up Product ID (remove gid:// if present, though webhooks usually send numbers)
  // Ensure we store it in a consistent format for matching
  const rawProductId = lineItem?.product_id;
  const productId = rawProductId ? String(rawProductId).replace("gid://shopify/Product/", "") : null;
  const productHandle = lineItem?.handle || null;

  // 1. Save to DB
  try {
    await db.recentSale.create({
        data: {
        shop,
        productName,
        customerName,
        city,
        country,
        productId,
        productHandle,
        // Webhooks don't always send the image URL in the line item summary, 
        // we rely on the frontend to fetch it or use a placeholder if needed.
        occurredAt: new Date(order.created_at || new Date()),
        }
    });
    console.log(`Saved sale for product: ${productName} (ID: ${productId})`);
  } catch (error) {
    console.error("Error saving sale to DB:", error);
  }

  // 2. Update Metafield for Extension
  const recentSales = await db.recentSale.findMany({
    where: { shop },
    orderBy: { occurredAt: 'desc' },
    take: 50 // Increased limit to allow for filtering
  });

  const salesJson = recentSales.map(s => ({
    name: s.customerName,
    location: s.city || "Nearby",
    product: s.productName,
    productId: s.productId, // Key for filtering
    handle: s.productHandle,
    time: s.occurredAt.toISOString()
  }));

  if (admin) {
    try {
        const shopData = await admin.graphql(
            `#graphql
            query getShopId {
                shop {
                id
                }
            }`
        );
        const shopJson = await shopData.json();
        const shopId = shopJson.data.shop.id;

        await admin.graphql(
            `#graphql
            mutation CreateAppData($metafields: [MetafieldsSetInput!]!) {
                metafieldsSet(metafields: $metafields) {
                userErrors {
                    field
                    message
                }
                }
            }`,
            {
            variables: {
                metafields: [
                {
                    key: "recent_sales",
                    namespace: "future_trust",
                    ownerId: shopId,
                    type: "json",
                    value: JSON.stringify(salesJson),
                }
                ]
            },
            },
        );
        console.log("Updated recent_sales metafield with product details");
    } catch (error) {
        console.error("Failed to update metafields:", error);
    }
  }

  return new Response();
};
