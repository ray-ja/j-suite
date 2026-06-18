# ---------- WATCHER DURABILITY — installer (no admin required) ----------
# Stopgap hardening for the crew-reply watcher (the real fix is the Haiku front-line on prod).
# Two layers:
#   1) watcher-daemon.js  — supervises reply-watcher (instant restart on watcher crash). Launched now,
#                           detached, so it survives this shell. Supervises ONLY the watcher, never the
#                           sync-server (Ray's call: the server stays non-durable to surface crashes).
#   2) JSuiteWatcherMonitor scheduled task — runs watcher-monitor.js every 5 min: if the heartbeat is
#                           stale >5m it RELAUNCHES the daemon (self-heal, covers daemon death + reboot
#                           after logon) AND alerts Ray on the private Cap thread.
# Re-run anytime. Uninstall: tools/watcher-uninstall.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node).Source

# 1) launch the supervisor daemon now (detached)
if (-not (Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*watcher-daemon*' })) {
  Start-Process -FilePath $node -ArgumentList "tools/watcher-daemon.js" -WorkingDirectory $root -WindowStyle Hidden
  Write-Output "started watcher-daemon (detached)"
} else { Write-Output "watcher-daemon already running" }

# 2) monitor task every 5 min (per-user; no admin). Self-heals the daemon + alerts if stale.
$mon = "`"$node`" `"$root\tools\watcher-monitor.js`""
schtasks /Create /TN "JSuiteWatcherMonitor" /TR $mon /SC MINUTE /MO 5 /F | Out-Null
Write-Output "registered JSuiteWatcherMonitor (every 5 min)"

# 3) OPTIONAL, needs an ELEVATED shell: a logon task that starts the daemon instantly on boot/logon
#    (without it, the 5-min monitor still relaunches the daemon within <=5 min of logon).
$dae = "`"$node`" `"$root\tools\watcher-daemon.js`""
try { schtasks /Create /TN "JSuiteWatcherDaemon" /TR $dae /SC ONLOGON /F 2>$null | Out-Null; Write-Output "registered JSuiteWatcherDaemon (AtLogOn)" }
catch { Write-Output "skipped JSuiteWatcherDaemon (needs an elevated shell; monitor covers reboot within 5 min)" }

Write-Output "DONE. Verify: schtasks /Query /TN JSuiteWatcherMonitor ; Get-Content tools\.watcher-heartbeat.json"
