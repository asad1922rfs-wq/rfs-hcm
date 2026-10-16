import { describe, expect, it } from "vitest";
import { parseAttlog, parseInfo } from "../agent/src/adms.ts";
import { punchFromDeviceRecord } from "@/core/attendance/punch-parser";

describe("ADMS ATTLOG parsing", () => {
  it("reads tab-separated push records and skips junk lines", () => {
    const body = "101\t2026-10-16 14:05:33\t0\t15\t0\t0\t0\t255\t0\t0\n\ngarbage\n7\t2026-10-16 23:01:00\t1\t1\t0\t0\n";
    expect(parseAttlog("TTQ524250035", body)).toEqual([
      { serial: "TTQ524250035", pin: "101", local: "2026-10-16 14:05:33", state: "0", verify: "15" },
      { serial: "TTQ524250035", pin: "7", local: "2026-10-16 23:01:00", state: "1", verify: "1" },
    ]);
  });

  it("parses device info key/value lists", () => {
    expect(parseInfo("~DeviceName=MB460 Plus,FWVersion=Ver 8.0.4.2,IPAddress=192.168.1.201")).toEqual({
      DeviceName: "MB460 Plus", FWVersion: "Ver 8.0.4.2", IPAddress: "192.168.1.201",
    });
  });

  it("converts device local time (PKT) to UTC on the server", () => {
    const p = punchFromDeviceRecord({ serial: "SN1", pin: "101", local: "2026-10-16 14:05:33" })!;
    expect(p.punchedAt.toISOString()).toBe("2026-10-16T09:05:33.000Z");
    expect(punchFromDeviceRecord({ serial: "SN1", pin: "101", local: "2026-02-30 14:00:00" })).toBeNull();
  });
});
