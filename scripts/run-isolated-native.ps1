param(
  [string]$ScriptPath = "$PSScriptRoot/native-final.js",
  [string]$OutputPath = "$PSScriptRoot/../tests/native-final.json",
  [string]$XpiPath = "$PSScriptRoot/../build/zotero-refflow.xpi",
  [string]$ZoteroPath = 'C:\Program Files\Zotero\zotero.exe',
  [switch]$WithoutPlugin,
  [switch]$SeedLegacyPreferences,
  [switch]$SkipOnline,
  [switch]$WithFaultServer,
  [switch]$Wait,
  [switch]$CloseWhenDone
)
$ErrorActionPreference='Stop'
if ($WithFaultServer -and -not $Wait) { throw '-WithFaultServer requires -Wait so the task-owned server can be stopped after validation' }
$testRoot=Join-Path ([IO.Path]::GetTempPath()) ('refflow-z10-release-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N').Substring(0,6))
$profile=Join-Path $testRoot 'profile'
$data=Join-Path $testRoot 'data'
$nativeTemp=Join-Path $testRoot 'tmp'
$driver=Join-Path $testRoot 'native-test-driver'
New-Item -ItemType Directory -Path $profile,$data,$nativeTemp,$driver,(Join-Path $profile 'extensions') -Force | Out-Null
if (-not $WithoutPlugin) { Copy-Item -LiteralPath ([IO.Path]::GetFullPath($XpiPath)) -Destination (Join-Path $profile 'extensions/refflow@groele.github.io.xpi') }
$config=@{script=[IO.Path]::GetFullPath($ScriptPath);output=[IO.Path]::GetFullPath($OutputPath);fixtures=[IO.Path]::GetFullPath("$PSScriptRoot/../tests/native-fixtures");workspace=[IO.Path]::GetFullPath("$PSScriptRoot/..");profile=$profile;withoutPlugin=[bool]$WithoutPlugin;skipOnline=[bool]$SkipOnline;startupProbe=($ScriptPath -like '*native-startup-control.js');closeWhenDone=[bool]$CloseWhenDone} | ConvertTo-Json -Compress
$driverManifest=Get-Content -LiteralPath "$PSScriptRoot/../build/addon/manifest.json" -Raw | ConvertFrom-Json
$driverManifest.name='RefFlow isolated native test driver'
$driverManifest.version='1.0.0'
$driverManifest.applications.zotero.id='refflow-native-test@example.org'
$manifest=$driverManifest | ConvertTo-Json -Depth 6
New-Item -ItemType Directory -Path (Join-Path $driver 'chrome/content/icons') -Force | Out-Null
Copy-Item -LiteralPath "$PSScriptRoot/../addon/chrome/content/icons/favicon.png","$PSScriptRoot/../addon/chrome/content/icons/favicon@0.5x.png" -Destination (Join-Path $driver 'chrome/content/icons')
Set-Content -LiteralPath (Join-Path $driver 'manifest.json') -Value $manifest -Encoding utf8NoBOM
$bootstrap=@"
const cfg = $config;
function install() {} function uninstall() {} function shutdown() {} function onMainWindowLoad() {} function onMainWindowUnload() {}
function startup() { run().catch(async error=>{await Zotero.File.putContentsAsync(cfg.output,JSON.stringify({fatal:String(error),stack:error?.stack,errors:Zotero.getErrors?.(true)},null,2));}); }
async function run() {
  await Zotero.initializationPromise;
  await Zotero.uiReadyPromise;
  for(let i=0;!cfg.withoutPlugin&&!cfg.startupProbe&&i<300;i++){if(Zotero.ZoteroRefFlow?.views?.referenceTasks)break;await Zotero.Promise.delay(100);}
  if(!/refflow-z10-release-/.test(Zotero.DataDirectory.dir))throw new Error('Isolated release profile required');
  const win=Zotero.getMainWindow();
  for(let i=0;i<300&&(!win.ZoteroPane?.itemsView||!win.ZoteroPane?.collectionsView?.itemTreeView);i++)await Zotero.Promise.delay(100);
  const code=await Zotero.File.getContentsAsync(cfg.script);
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  await new AsyncFunction('Zotero','window','cfg',code)(Zotero,Zotero.getMainWindow(),cfg);
  if(cfg.closeWhenDone){await Zotero.ZoteroRefFlow?.views?.storage?.flush();Services.startup.quit(Ci.nsIAppStartup.eForceQuit);}
}
"@
Set-Content -LiteralPath (Join-Path $driver 'bootstrap.js') -Value $bootstrap -Encoding utf8NoBOM
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($driver,(Join-Path $profile 'extensions/refflow-native-test@example.org.xpi'))
$prefs=@"
user_pref("extensions.zotero.dataDir", $(ConvertTo-Json $data -Compress));
user_pref("extensions.zotero.useDataDir", true);
user_pref("extensions.autoDisableScopes", 0);
user_pref("extensions.enabledScopes", 15);
user_pref("extensions.update.enabled", false);
user_pref("extensions.update.autoUpdateDefault", false);
user_pref("extensions.zoteroWinWordIntegration.skipInstallation", true);
user_pref("extensions.zoteroOpenOfficeIntegration.skipInstallation", true);
user_pref("extensions.zotero.sync.autoSync", false);
"@
if ($SeedLegacyPreferences) {
  $prefs += @'

user_pref("extensions.zotero.refnexus.showTipAfterMillisecond", 345);
user_pref("extensions.zotero.refnexus.sortBy", "Title");
user_pref("extensions.zotero.refflow.sortBy", "Original");
'@
}
Set-Content -LiteralPath (Join-Path $profile 'user.js') -Value $prefs -Encoding utf8NoBOM
$ownedFaultServer=$null
$process=$null
$faultServerMutex=$null
$ownsFaultServerMutex=$false
try {
  if ($WithFaultServer) {
    $faultServerMutex=[Threading.Mutex]::new($false,'RefFlowNativeFaultServer18796')
    try { $ownsFaultServerMutex=$faultServerMutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $ownsFaultServerMutex=$true }
    if (-not $ownsFaultServerMutex) { throw 'RefFlow fault-server suite is already running. Run -WithFaultServer suites sequentially to preserve server ownership.' }
    $faultServerReady=$false
    try { $health=Invoke-RestMethod -Uri 'http://127.0.0.1:18796/health' -TimeoutSec 1; if ($health.service -ne 'refflow-native-fault-server') { throw 'Port 18796 is occupied by another service' }; $faultServerReady=$true } catch {
      if ($_.Exception.Message -like '*occupied by another service*') { throw }
    }
    if (-not $faultServerReady) {
      $pythonExecutable=(Get-Command python -ErrorAction Stop).Source
      $ownedFaultServer=Start-Process -FilePath $pythonExecutable -WindowStyle Hidden -WorkingDirectory $PSScriptRoot -ArgumentList @('-u', ('"'+(Join-Path $PSScriptRoot 'native-http-server.py')+'"')) -RedirectStandardOutput (Join-Path $testRoot 'http-server.log') -RedirectStandardError (Join-Path $testRoot 'http-server-errors.log') -PassThru
      for ($attempt=0;$attempt -lt 10;$attempt++) {
        try { $health=Invoke-RestMethod -Uri 'http://127.0.0.1:18796/health' -TimeoutSec 1; if ($health.service -eq 'refflow-native-fault-server') { $faultServerReady=$true; break } } catch { }
        if ($ownedFaultServer.HasExited) { break }
        Start-Sleep -Milliseconds 100
      }
      if (-not $faultServerReady) { throw 'RefFlow fault server did not become ready; inspect http-server-errors.log in the isolated test root' }
    }
  }
  if ($Wait) { Set-Content -LiteralPath ([IO.Path]::GetFullPath($OutputPath)) -Value '{"pending":true}' -Encoding utf8NoBOM }
  $process=Start-Process -FilePath $ZoteroPath -WindowStyle Hidden -Environment @{TEMP=$nativeTemp;TMP=$nativeTemp} -ArgumentList @('-no-remote','-purgecaches','-profile',('"'+$profile+'"')) -PassThru
  @{profile=$profile;processID=$process.Id;output=[IO.Path]::GetFullPath($OutputPath);driver=$driver} | ConvertTo-Json
  if ($Wait) {
  $waitDeadline=(Get-Date).AddMinutes(4)
  while ((Get-Date) -lt $waitDeadline) {
    Start-Sleep -Milliseconds 500
    # The host atomically replaces its report. Permit delete/rename while the
    # poller reads, otherwise Windows can reject the host's temporary-file move.
    $resultReader=$null
    $resultStream=$null
    try {
      $resultStream=[IO.File]::Open([IO.Path]::GetFullPath($OutputPath),[IO.FileMode]::Open,[IO.FileAccess]::Read,([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
      $resultReader=[IO.StreamReader]::new($resultStream)
      $result=$resultReader.ReadToEnd() | ConvertFrom-Json
    } catch { continue }
    finally { if ($resultReader) { $resultReader.Dispose() } elseif ($resultStream) { $resultStream.Dispose() } }
    if ($result.fatal) { Write-Error $result.fatal; exit 1 }
    if ($result.finished) { $result | Select-Object version,passed,failed,finished | ConvertTo-Json; if ($result.failed -gt 0) { exit 1 }; exit 0 }
  }
  Write-Error 'Native tests did not finish within four minutes; inspect the isolated profile and partial report.'
  exit 1
  }
} finally {
  if ($ownedFaultServer -and -not $ownedFaultServer.HasExited) { Stop-Process -Id $ownedFaultServer.Id -ErrorAction SilentlyContinue }
  if ($CloseWhenDone -and $process -and -not $process.HasExited -and -not $process.WaitForExit(5000)) { Stop-Process -Id $process.Id -ErrorAction SilentlyContinue }
  if ($CloseWhenDone) {
    # The Windows launcher can exit after handing the profile to a child. Only
    # clean processes whose command line names this exact generated profile.
    try {
      $profileArgument='(?i)-profile\s+"?'+[regex]::Escape($profile)+'"?(?:\s|$)'
      Get-CimInstance Win32_Process -Filter "Name='zotero.exe'" -ErrorAction Stop |
        Where-Object { $_.CommandLine -and $_.CommandLine -match $profileArgument } |
        ForEach-Object {
          $ownedProcess=Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
          if ($ownedProcess -and -not $ownedProcess.HasExited -and -not $ownedProcess.WaitForExit(5000)) { Stop-Process -Id $ownedProcess.Id -ErrorAction SilentlyContinue }
        }
    } catch { Write-Warning "Unable to inspect remaining isolated-profile processes: $($_.Exception.Message)" }
  }
  if ($faultServerMutex) { if ($ownsFaultServerMutex) { $faultServerMutex.ReleaseMutex() }; $faultServerMutex.Dispose() }
}
