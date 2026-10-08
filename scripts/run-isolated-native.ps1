param(
  [string]$ScriptPath = "$PSScriptRoot/native-final.js",
  [string]$OutputPath = "$PSScriptRoot/../tests/native-final.json",
  [string]$XpiPath = "$PSScriptRoot/../build/zotero-refnexus.xpi",
  [switch]$WithoutPlugin,
  [switch]$Wait,
  [switch]$CloseWhenDone
)
$ErrorActionPreference='Stop'
$testRoot=Join-Path ([IO.Path]::GetTempPath()) ('refnexus-z10-release-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N').Substring(0,6))
$profile=Join-Path $testRoot 'profile'
$data=Join-Path $testRoot 'data'
$driver=Join-Path $testRoot 'native-test-driver'
New-Item -ItemType Directory -Path $profile,$data,$driver,(Join-Path $profile 'extensions') -Force | Out-Null
if (-not $WithoutPlugin) { Copy-Item -LiteralPath ([IO.Path]::GetFullPath($XpiPath)) -Destination (Join-Path $profile 'extensions/refnexus@polygon.org.xpi') }
$config=@{script=[IO.Path]::GetFullPath($ScriptPath);output=[IO.Path]::GetFullPath($OutputPath);fixtures=[IO.Path]::GetFullPath("$PSScriptRoot/../tests/native-fixtures");workspace=[IO.Path]::GetFullPath("$PSScriptRoot/..");profile=$profile;withoutPlugin=[bool]$WithoutPlugin;startupProbe=($ScriptPath -like '*native-startup-control.js');closeWhenDone=[bool]$CloseWhenDone} | ConvertTo-Json -Compress
$driverManifest=Get-Content -LiteralPath "$PSScriptRoot/../build/addon/manifest.json" -Raw | ConvertFrom-Json
$driverManifest.name='RefNexus isolated native test driver'
$driverManifest.version='1.0.0'
$driverManifest.applications.zotero.id='refnexus-native-test@example.org'
$manifest=$driverManifest | ConvertTo-Json -Depth 6
New-Item -ItemType Directory -Path (Join-Path $driver 'chrome/content/icons') -Force | Out-Null
Copy-Item -LiteralPath "$PSScriptRoot/../addon/chrome/content/icons/favicon.png","$PSScriptRoot/../addon/chrome/content/icons/favicon@0.5x.png" -Destination (Join-Path $driver 'chrome/content/icons')
Set-Content -LiteralPath (Join-Path $driver 'manifest.json') -Value $manifest -Encoding utf8NoBOM
$bootstrap=@"
const cfg = $config;
function install() {} function uninstall() {} function shutdown() {}
function startup() { run().catch(async error=>{await Zotero.File.putContentsAsync(cfg.output,JSON.stringify({fatal:String(error),stack:error?.stack,errors:Zotero.getErrors?.(true)},null,2));}); }
async function run() {
  await Zotero.initializationPromise;
  await Zotero.uiReadyPromise;
  for(let i=0;!cfg.withoutPlugin&&!cfg.startupProbe&&i<300;i++){if(Zotero.ZoteroRefNexus?.views?.referenceTasks)break;await Zotero.Promise.delay(100);}
  if(!/refnexus-z10-release-/.test(Zotero.DataDirectory.dir))throw new Error('Isolated release profile required');
  const win=Zotero.getMainWindow();
  for(let i=0;i<300&&(!win.ZoteroPane?.itemsView||!win.ZoteroPane?.collectionsView?.itemTreeView);i++)await Zotero.Promise.delay(100);
  const code=await Zotero.File.getContentsAsync(cfg.script);
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  await new AsyncFunction('Zotero','window','cfg',code)(Zotero,Zotero.getMainWindow(),cfg);
  if(cfg.closeWhenDone){await Zotero.ZoteroRefNexus?.views?.storage?.flush();Services.startup.quit(Ci.nsIAppStartup.eForceQuit);}
}
"@
Set-Content -LiteralPath (Join-Path $driver 'bootstrap.js') -Value $bootstrap -Encoding utf8NoBOM
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($driver,(Join-Path $profile 'extensions/refnexus-native-test@example.org.xpi'))
$prefs=@"
user_pref("extensions.zotero.dataDir", $(ConvertTo-Json $data -Compress));
user_pref("extensions.zotero.useDataDir", true);
user_pref("extensions.autoDisableScopes", 0);
user_pref("extensions.enabledScopes", 15);
user_pref("extensions.zoteroWinWordIntegration.skipInstallation", true);
user_pref("extensions.zoteroOpenOfficeIntegration.skipInstallation", true);
user_pref("extensions.zotero.sync.autoSync", false);
"@
Set-Content -LiteralPath (Join-Path $profile 'user.js') -Value $prefs -Encoding utf8NoBOM
if ($Wait) { Set-Content -LiteralPath ([IO.Path]::GetFullPath($OutputPath)) -Value '{"pending":true}' -Encoding utf8NoBOM }
$process=Start-Process -FilePath 'C:\Program Files\Zotero\zotero.exe' -WindowStyle Hidden -ArgumentList @('-no-remote','-purgecaches','-profile',('"'+$profile+'"')) -PassThru
@{profile=$profile;processID=$process.Id;output=[IO.Path]::GetFullPath($OutputPath);driver=$driver} | ConvertTo-Json

if ($Wait) {
  $waitDeadline=(Get-Date).AddMinutes(4)
  while ((Get-Date) -lt $waitDeadline) {
    Start-Sleep -Milliseconds 500
    try { $result=Get-Content -LiteralPath ([IO.Path]::GetFullPath($OutputPath)) -Raw | ConvertFrom-Json } catch { continue }
    if ($result.fatal) { Write-Error $result.fatal; exit 1 }
    if ($result.finished) { $result | Select-Object version,passed,failed,finished | ConvertTo-Json; if ($result.failed -gt 0) { exit 1 }; exit 0 }
  }
  Write-Error 'Native tests did not finish within four minutes; inspect the isolated profile and partial report.'
  exit 1
}
