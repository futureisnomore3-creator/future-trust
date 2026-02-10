import db from "../db.server";

export async function getSettings(shop: string) {
  const settings = await db.settings.findUnique({
    where: { shop },
  });

  if (!settings) {
    return createDefaultSettings(shop);
  }

  return settings;
}

export async function createDefaultSettings(shop: string) {
  return db.settings.create({
    data: {
      shop,
      urgencyEnabled: true,
      urgencyThreshold: 10,
      urgencyText: "🔥 Only {{ quantity }} left in stock!",
      urgencyTextColor: "#D72C0D",
      urgencyBgColor: "#FFF4F2",
      socialEnabled: true,
      socialDelay: 5,
      socialDuration: 5,
    },
  });
}

export async function updateSettings(shop: string, data: any) {
  return db.settings.update({
    where: { shop },
    data: {
      ...data,
      updatedAt: new Date(),
    },
  });
}
