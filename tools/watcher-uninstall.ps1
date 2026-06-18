# Removes the watcher durability task(s) and stops the daemon + watcher processes.
schtasks /Delete /TN "JSuiteWatcherMonitor" /F 2>$null
schtasks /Delete /TN "JSuiteWatcherDaemon" /F 2>$null
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*watcher-daemon*' -or $_.CommandLine -like '*reply-watcher*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Output ("stopped " + $_.ProcessId) }
Write-Output "watcher durability removed"
