import { describe, expect, it } from "vitest";
import { pktLocalString, webPunchBlockReason, webPunchDeviceUserId, WEB_PUNCH_MIN_GAP_MS } from "@/core/attendance/web-punch";

const now = new Date("2026-10-27T10:00:00Z");
const remote = { workMode: "REMOTE", status: "ACTIVE" };

describe("webPunchBlockReason", () => {
  it("allows an active remote employee with no punch yet", () => {
    expect(webPunchBlockReason(remote, null, now)).toBeNull();
  });
  it("refuses office employees", () => {
    expect(webPunchBlockReason({ workMode: "OFFICE", status: "ACTIVE" }, null, now)).toMatch(/remote/);
  });
  it("refuses inactive employees", () => {
    expect(webPunchBlockReason({ workMode: "REMOTE", status: "RESIGNED" }, null, now)).toMatch(/not active/);
  });
  it("refuses a punch within 2 minutes of the previous one", () => {
    expect(webPunchBlockReason(remote, new Date(now.getTime() - 60_000), now)).toMatch(/wait/);
    expect(webPunchBlockReason(remote, new Date(now.getTime() - WEB_PUNCH_MIN_GAP_MS + 1), now)).not.toBeNull();
  });
  it("allows a punch 2 minutes or more after the previous one", () => {
    expect(webPunchBlockReason(remote, new Date(now.getTime() - WEB_PUNCH_MIN_GAP_MS), now)).toBeNull();
  });
});

describe("web punch identity", () => {
  it("uses the biometric user ID when set, otherwise a web ID", () => {
    expect(webPunchDeviceUserId({ id: "abc", deviceUserId: "17" })).toBe("17");
    expect(webPunchDeviceUserId({ id: "abc", deviceUserId: null })).toBe("web-abc");
  });
  it("formats Pakistan local time", () => {
    expect(pktLocalString(new Date("2026-10-27T19:30:05Z"))).toBe("2026-10-28 00:30:05");
  });
});
