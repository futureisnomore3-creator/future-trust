import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Button,
  Text,
  BlockStack,
  Box,
  Divider,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { MONTHLY_PLAN } from "../constants";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing } = await authenticate.admin(request);
  
  try {
    const billingCheck = await billing.check({
      plans: [MONTHLY_PLAN],
      isTest: true,
    });

    return json({ hasActivePayment: billingCheck.hasActivePayment });
  } catch (error) {
    console.error("Billing check failed:", error);
    return json({ hasActivePayment: false });
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get("action");

  // Ensure APP_URL doesn't have trailing slash
  const appUrl = process.env.SHOPIFY_APP_URL?.replace(/\/$/, "");

  if (action === "subscribe") {
    return await billing.request({
      plan: MONTHLY_PLAN,
      isTest: true,
      returnUrl: `${appUrl}/app`,
    });
  }
  
  if (action === "cancel") {
     const subscription = await billing.check({
        plans: [MONTHLY_PLAN],
        isTest: true,
     });
     
     if (subscription.appSubscriptions?.[0]) {
         const subscriptionId = subscription.appSubscriptions[0].id;
         await billing.cancel({
             subscriptionId,
             isTest: true,
             prorate: true,
         });
     }
  }

  return json({ success: true });
};

export default function BillingPage() {
  const { hasActivePayment } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  return (
    <Page title="Billing & Subscription">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Current Plan</Text>
              
              <Box paddingBlockEnd="200">
                <Text as="p" variant="bodyLg">
                  {hasActivePayment ? "✅ Active Pro Subscription" : "❌ Free Plan (Limited)"}
                </Text>
              </Box>

              <Divider />

              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">{MONTHLY_PLAN}</Text>
                <Text as="p">$9.99 / month</Text>
                <Text as="p" tone="subdued">
                  Includes unlimited widgets, real-time order syncing, and priority support.
                </Text>
              </BlockStack>

              <Box paddingBlockStart="400">
                {hasActivePayment ? (
                  <Button 
                    variant="primary" 
                    tone="critical" 
                    onClick={() => fetcher.submit({ action: "cancel" }, { method: "POST" })}
                    loading={fetcher.state === "submitting"}
                  >
                    Cancel Subscription
                  </Button>
                ) : (
                  <Button 
                    variant="primary" 
                    onClick={() => fetcher.submit({ action: "subscribe" }, { method: "POST" })}
                    loading={fetcher.state === "submitting"}
                  >
                    Upgrade to Pro
                  </Button>
                )}
              </Box>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
