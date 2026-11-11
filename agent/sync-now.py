"""RFS HCM — manual attendance sync (run from the "Sync Attendance" desktop shortcut).

Pulls attendance from the ZKTeco machine over the office LAN (port 4370), uploads it to RFS HCM in one go, then exits.
Nothing runs between syncs, so the website gets no traffic until someone presses Sync.
Only attendance records are read (no fingerprints). Re-sent punches are ignored by the server, so pressing it twice is safe.

Settings come from agent/config.json: serverUrl, agentId, agentSecret, deviceIp (default 192.168.18.113),
devicePort (4370), deviceClockOffsetMinutes (-2), clockOffsetFrom ("2026-11-05 15:00:00").
"""
import hashlib, hmac, json, pathlib, sys, time, urllib.error, urllib.request
from datetime import datetime, timedelta

HERE = pathlib.Path(__file__).resolve().parent
STATE = HERE / "data" / "manual-sync.json"
BATCH = 4000
RESEND_DAYS = 3  # re-send a few days before the last sync so nothing between syncs is missed


def post(cfg, path, payload):
    body = json.dumps(payload, separators=(",", ":"))
    ts = str(int(time.time() * 1000))
    sig = hmac.new(cfg["agentSecret"].encode(), f"{ts}.{body}".encode(), hashlib.sha256).hexdigest()
    req = urllib.request.Request(
        cfg["serverUrl"].rstrip("/") + path, data=body.encode(), method="POST",
        headers={"Content-Type": "application/json", "User-Agent": "rfs-hcm-manual-sync/1", "x-rfs-agent": cfg["agentId"], "x-rfs-timestamp": ts, "x-rfs-signature": sig},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            return json.loads(res.read() or b"{}")
    except urllib.error.HTTPError as e:
        raise SystemExit(f"Website refused the upload ({e.code}). {'Check agentId/agentSecret in agent/config.json.' if e.code == 401 else e.read()[:200]!r}")


def main():
    cfg = json.loads((HERE / "config.json").read_text(encoding="utf-8"))
    offset = int(cfg.get("deviceClockOffsetMinutes", -2))
    offset_from = datetime.strptime(cfg.get("clockOffsetFrom", "2026-11-05 15:00:00"), "%Y-%m-%d %H:%M:%S")
    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    since = datetime.strptime(state["lastPunch"], "%Y-%m-%d %H:%M:%S") - timedelta(days=RESEND_DAYS) if state.get("lastPunch") else None

    from zk import ZK
    ip = cfg.get("deviceIp", "192.168.18.113")
    print(f"Connecting to the attendance machine at {ip} ...")
    conn = ZK(ip, port=int(cfg.get("devicePort", 4370)), timeout=90, ommit_ping=True).connect()
    try:
        serial = conn.get_serialnumber()
        records = conn.get_attendance()
    finally:
        conn.disconnect()
    print(f"Machine {serial}: {len(records)} records stored.")

    punches, latest = [], None
    for r in records:
        t = r.timestamp
        if since and t < since:
            continue
        if t >= offset_from:
            t = t + timedelta(minutes=offset)  # the machine clock runs ahead; same correction as the website
        latest = t if latest is None or t > latest else latest
        punches.append({"serial": serial, "pin": str(r.user_id), "local": t.strftime("%Y-%m-%d %H:%M:%S"), "state": str(r.punch), "verify": str(r.status)})

    inserted = 0
    for i in range(0, len(punches), BATCH):
        res = post(cfg, "/api/v1/agent/punches", {"punches": punches[i:i + BATCH]})
        inserted += int(res.get("inserted", 0))
    # One health report so the device shows when it was last synced; it also refreshes recent attendance on the website.
    post(cfg, "/api/v1/agent/heartbeat", {"version": "manual-sync-1", "outbox": 0, "devices": [{"serial": serial, "lastSeenAt": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.000Z")}], "results": []})

    if latest:
        STATE.parent.mkdir(exist_ok=True)
        STATE.write_text(json.dumps({"lastPunch": latest.strftime("%Y-%m-%d %H:%M:%S"), "syncedAt": datetime.now().isoformat(timespec="seconds")}))
    print(f"Sent {len(punches)} records, {inserted} new. Done.")


if __name__ == "__main__":
    try:
        main()
    except SystemExit as e:
        print("SYNC FAILED:", e)
        sys.exit(1)
    except Exception as e:  # network/machine errors: show a clear message, never a silent window
        print("SYNC FAILED:", type(e).__name__, e)
        print("Check that this PC is on the office network and the machine is switched on.")
        sys.exit(1)
