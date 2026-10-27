"use server";

import { requireActor } from "@/server/auth/session";
import { markNotificationsSeen } from "@/server/services/notifications";

export async function markNotificationsSeenAction() {
  await markNotificationsSeen(await requireActor());
}
