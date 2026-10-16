# Installs the RFS HCM sync agent on this Windows PC. Run in an *Administrator* PowerShell:
#   powershell -ExecutionPolicy Bypass -File .\agent\install-windows.ps1
#
# 1. Opens TCP 8081 in Windows Firewall, only for devices on the local office subnet.
# 2. Registers a scheduled task that starts the agent at boot (even before anyone logs in) and restarts it if it stops.

$ErrorActionPreference = "Stop"
$agentDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node).Source
if (-not (Test-Path (Join-Path $agentDir "config.json"))) { throw "Create agent\config.json first (RFS HCM → Biometric devices → Create sync agent)." }

$config = Get-Content (Join-Path $agentDir "config.json") -Raw | ConvertFrom-Json
$port = if ($config.listenPort) { $config.listenPort } else { 8081 }

# Firewall: allow the device subnet only (e.g. 192.168.18.0/24), not the whole internet.
$ip = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike "vEthernet*" -and $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254*" } | Select-Object -First 1
$subnet = "LocalSubnet"
Get-NetFirewallRule -DisplayName "RFS HCM sync agent (ADMS)" -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName "RFS HCM sync agent (ADMS)" -Direction Inbound -Protocol TCP -LocalPort $port -RemoteAddress $subnet -Action Allow -Profile Any | Out-Null
Write-Host "Firewall: TCP $port open for the local subnet. This PC's address: $($ip.IPAddress)"

# Scheduled task running as SYSTEM at startup, restarting on failure.
$action = New-ScheduledTaskAction -Execute $node -Argument "--disable-warning=ExperimentalWarning src\main.ts" -WorkingDirectory $agentDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName "RFS HCM Sync Agent" -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName "RFS HCM Sync Agent"
Write-Host "Agent installed and started. Logs: $agentDir\data\agent.log"
Write-Host ""
Write-Host "On the MB460: Menu > Comm > Cloud Server Settings"
Write-Host "  Server Mode = ADMS, Enable Domain Name = OFF, Server Address = $($ip.IPAddress), Server Port = $port, Proxy = OFF, HTTPS = OFF"
