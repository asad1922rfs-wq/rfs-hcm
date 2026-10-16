# RFS HCM sync agent

Runs on an always-on Windows PC in the office. The ZKTeco machine (MB460 Plus) pushes attendance to it over
the local network using ZKTeco's ADMS protocol. The agent stores every punch locally (`data/agent.db`) and
forwards it to RFS HCM over HTTPS.

- **No inbound internet access is needed.** The machine talks only to this PC on the LAN; the agent makes outbound HTTPS calls.
- **Nothing is lost when the internet drops.** Punches wait in the local database and are sent when the connection returns.
- **Duplicates are harmless.** Re-sent records are ignored both here and on the server.
- **No biometric templates.** Only attendance records (user ID, time, state) are requested and stored.

## Install

Requirements: Node.js 24+.

1. In RFS HCM go to **Administration → Biometric devices → Create sync agent**. Save the shown JSON as `agent/config.json`.
2. In an **Administrator** PowerShell, from the project folder, run:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\agent\install-windows.ps1
   ```
   This opens port 8081 for the local subnet only, and starts the agent at boot.
3. On the MB460: **Menu → Comm → Cloud Server Settings**
   | Setting | Value |
   |---|---|
   | Server Mode | ADMS |
   | Enable Domain Name | Off |
   | Server Address | this PC's IP (printed by the installer) |
   | Server Port | 8081 |
   | Enable Proxy Server | Off |
   | HTTPS | **Off** (traffic stays on the office LAN; the agent uses HTTPS to the server) |
4. Within about a minute the machine shows as **Online** in RFS HCM. On first connection it uploads its stored attendance history.

Give this PC a fixed IP address (a DHCP reservation on the router). If its address changes, the machine can no longer reach it.

## Operate

- Logs: `data/agent.log`. Every raw device request is also logged in `data/adms-raw.log` for troubleshooting.
- Run manually (for testing): `cd agent && node src/main.ts`
- To restrict the agent to your machine, set `"allowedSerials": ["<serial number>"]` in `config.json`.
- Revoke a lost or replaced agent from the Biometric devices page. Its secret stops working immediately.
