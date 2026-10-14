param(
  [Parameter(Mandatory=$true)][string]$ProfilePath,
  [string]$ScriptPath = "$PSScriptRoot/native-regression.js",
  [string]$OutputPath = "$PSScriptRoot/../tests/native-results.json",
  [string]$FixtureDirectory = "$PSScriptRoot/../tests/native-fixtures",
  [switch]$Reload
)
$ErrorActionPreference = 'Stop'
$resolvedProfile = [IO.Path]::GetFullPath($ProfilePath)
if ($resolvedProfile -notmatch 'refflow-z10-[^\\]+\\profile$') { throw 'Only an isolated RefFlow test profile is allowed' }
$config = @{ script = [IO.Path]::GetFullPath($ScriptPath); output = [IO.Path]::GetFullPath($OutputPath); fixtures = [IO.Path]::GetFullPath($FixtureDirectory); reload = [bool]$Reload } | ConvertTo-Json -Compress
$run = @"
const cfg = $config;
if (cfg.reload) {
  Services.obs.notifyObservers(null, 'startupcache-invalidate', null);
  const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
  await (await AddonManager.getAddonByID('refflow@groele.github.io')).reload();
  for (let i=0;i<150;i++) {
    if(Zotero.ZoteroRefFlow?.views?.referenceTasks)break;
    await Zotero.Promise.delay(100);
  }
}
try {
  const code = await Zotero.File.getContentsAsync(cfg.script);
  await Object.getPrototypeOf(async function(){}).constructor('Zotero','window','cfg',code)(Zotero,window,cfg);
} catch (error) {
  await Zotero.File.putContentsAsync(cfg.output, JSON.stringify({fatal:String(error),stack:error?.stack}, null, 2));
}
"@
$url = 'zotero://ztoolkit-debug/?app=RefFlowNativeTest&password=refflow-smoke-local-only&run=' + [Uri]::EscapeDataString($run)
Start-Process -FilePath 'C:\Program Files\Zotero\zotero.exe' -WindowStyle Hidden -ArgumentList @('-profile', ('"' + $resolvedProfile + '"'), '-url', ('"' + $url + '"'))
Write-Output "Dispatched isolated Zotero test; output: $($config)"
