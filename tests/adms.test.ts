import { describe, expect, it } from "vitest";
import { commandLine, handshakeText, parseAttlog, parseInfo } from "@/core/attendance/adms";

describe("direct ADMS helpers", () => {
  it("parses ATTLOG lines and skips junk", () => {
    const body = "101\t2026-11-03 09:02:11\t0\t1\t0\t0\r\nbad line\n122\t2026-11-03 18:05\t1\t15\n";
    expect(parseAttlog("TTQ1", body)).toEqual([
      { serial: "TTQ1", pin: "101", local: "2026-11-03 09:02:11", state: "0", verify: "1" },
      { serial: "TTQ1", pin: "122", local: "2026-11-03 18:05", state: "1", verify: "15" },
    ]);
  });

  it("parses device info", () => {
    expect(parseInfo("~DeviceName=MB460,FWVersion=Ver 8.0.4.2")).toEqual({ DeviceName: "MB460", FWVersion: "Ver 8.0.4.2" });
  });

  it("builds handshake and command lines", () => {
    expect(handshakeText("TTQ1", null, 5)).toContain("ATTLOGStamp=None");
    expect(handshakeText("TTQ1", "9999", 5)).toContain("ATTLOGStamp=9999");
    expect(commandLine(123456, "REBOOT", {})).toBe("C:123456:REBOOT");
    expect(commandLine(7, "RESYNC_ATTLOG", { from: "2026-10-01 00:00:00", to: "2026-11-03 23:59:59" }))
      .toBe("C:7:DATA QUERY ATTLOG StartTime=2026-10-01 00:00:00\tEndTime=2026-11-03 23:59:59");
  });
});
