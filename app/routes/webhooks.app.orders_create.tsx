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
  
  // Get the first product
  const productName = order.line_items?.[0]?.title || "Popular Item";

  // 1. Save to DB
  try {
    await db.recentSale.create({
        data: {
        shop,
        productName,
        customerName,
        city,
        country,
        occurredAt: new Date(order.created_at || new Date()),
        }
    });
  } catch (error) {
    console.error("Error saving sale to DB:", error);
  }

  // 2. Trim old records (keep last 50)
  // (Optional optimization)

  // 3. Update Metafield for Extension
  // Fetch fresh list
  const recentSales = await db.recentSale.findMany({
    where: { shop },
    orderBy: { occurredAt: 'desc' },
    take: 20
  });

  // Format for the extension
  const salesJson = recentSales.map(s => ({
    name: s.customerName,
    location: s.city || "Nearby",
    product: s.productName,
    time: s.occurredAt.toISOString() // ISO string for JS parsing
  }));

  if (admin) {
    try {
        const shopData = await admin.graphql(
            `#graphql
            query {
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
        console.log("Updated recent_sales metafield");
    } catch (error) {
        console.error("Failed to update metafields:", error);
    }
  }

  return new Response();
};
