import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import path from 'node:path';

/** The derivative's repository is the authority for every public release URL. */
export function validateReleaseConfig(details) {
  const base='https://raw.githubusercontent.com/groele/Zotero-RefFlow/main/';
  if(details.config.addonID!=='refflow@groele.github.io'||details.name!=='zotero-refflow'||details.config.addonName!=='Zotero RefFlow'||details.config.addonRef!=='refflow'||details.config.addonInstance!=='ZoteroRefFlow')throw new Error('RefFlow plugin identity mismatch');
  if(details.config.updateURL!==base+'update.json'||details.config.downloadURL!==base+'zotero-refflow.xpi')throw new Error('Update/download URL must point to groele/Zotero-RefFlow');
  if(details.homepage!=='https://github.com/groele/Zotero-RefFlow'||details.repository.url!=='git+https://github.com/groele/Zotero-RefFlow.git')throw new Error('Derivative repository metadata mismatch');
  if(!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(details.version))throw new Error('Invalid release version');
  if(details.config.releaseTag!==`v${details.version}` && details.config.releaseTag!==`refflow-v${details.version}` && !(details.version.endsWith('.0.0') && details.config.releaseTag===`V${details.version.split('.')[0]}`))throw new Error('Release tag and version disagree');
}

export function createReleaseArtifacts(details,xpi,template,manifest) {
  validateReleaseConfig(details);
  if(manifest.version!==details.version||manifest.applications.zotero.id!==details.config.addonID||manifest.applications.zotero.update_url!==details.config.updateURL)throw new Error('Built manifest and package metadata disagree');
  if(manifest.applications.zotero.strict_min_version!=='10.0.6'||manifest.applications.zotero.strict_max_version!=='11.*')throw new Error('RefFlow compatibility must be 10.0.6 through 11.*');
  const sha256=createHash('sha256').update(xpi).digest('hex');
  const update=structuredClone(template);
  const entries=update.addons?.[details.config.addonID]?.updates;
  if(entries?.length!==1||entries[0].version!==details.version||entries[0].update_link!==details.config.downloadURL)throw new Error('Update manifest version or path mismatch');
  // The update feed is public release metadata. Keep the raw-main package URL
  // for build-time validation, then advertise the immutable tagged asset.
  const releaseDownloadURL=`https://github.com/groele/Zotero-RefFlow/releases/download/${details.config.releaseTag}/${details.name}.xpi`;
  entries[0].update_link=releaseDownloadURL;
  entries[0].update_hash=`sha256:${sha256}`;
  entries[0].update_info_url=details.config.releaseNotesURL;
  if(JSON.stringify(entries[0].applications.zotero)!==JSON.stringify({strict_min_version:manifest.applications.zotero.strict_min_version,strict_max_version:manifest.applications.zotero.strict_max_version}))throw new Error('Update compatibility mismatch');
  return {update,verification:{version:details.version,addonID:details.config.addonID,bytes:xpi.length,sha256,updateURL:details.config.updateURL,downloadURL:releaseDownloadURL}};
}

export function atomicWrite(filename,data) {
  const temporary=filename+'.tmp';writeFileSync(temporary,data);renameSync(temporary,filename);
}

export function prepareRelease(details,buildDir,publish) {
  const xpi=readFileSync(path.join(buildDir,`${details.name}.xpi`));
  const template=JSON.parse(readFileSync(path.join(buildDir,'update.json'),'utf8'));
  const manifest=JSON.parse(readFileSync(path.join(buildDir,'addon/manifest.json'),'utf8'));
  const artifacts=createReleaseArtifacts(details,xpi,template,manifest);
  atomicWrite(path.join(buildDir,'update.json'),JSON.stringify(artifacts.update,null,2)+'\n');
  atomicWrite(path.join(buildDir,'verification.json'),JSON.stringify(artifacts.verification,null,2)+'\n');
  if(publish){
    // Promote the package first and advertise it only after successful packing.
    atomicWrite(`${details.name}.xpi`,xpi);
    atomicWrite('update.json',JSON.stringify(artifacts.update,null,2)+'\n');
  }
}
