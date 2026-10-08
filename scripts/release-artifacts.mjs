import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import path from 'node:path';

/** The derivative's repository is the authority for every public release URL. */
export function validateReleaseConfig(details) {
  const base='https://raw.githubusercontent.com/groele/Zotero-diy/main/RefNexus-Zotero10/';
  if(details.config.addonID!=='refnexus@polygon.org')throw new Error('Plugin upgrade identity changed');
  if(details.config.updateURL!==base+'update.json'||details.config.downloadURL!==base+'zotero-refnexus.xpi')throw new Error('Update/download URL must point to groele/Zotero-diy/RefNexus-Zotero10');
  if(details.homepage!=='https://github.com/groele/Zotero-diy/tree/main/RefNexus-Zotero10'||details.repository.url!=='git+https://github.com/groele/Zotero-diy.git')throw new Error('Derivative repository metadata mismatch');
  if(!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(details.version))throw new Error('Invalid release version');
}

export function createReleaseArtifacts(details,xpi,template,manifest) {
  validateReleaseConfig(details);
  if(manifest.version!==details.version||manifest.applications.zotero.id!==details.config.addonID||manifest.applications.zotero.update_url!==details.config.updateURL)throw new Error('Built manifest and package metadata disagree');
  const sha256=createHash('sha256').update(xpi).digest('hex');
  const update=structuredClone(template);
  const entries=update.addons?.[details.config.addonID]?.updates;
  if(entries?.length!==1||entries[0].version!==details.version||entries[0].update_link!==details.config.downloadURL)throw new Error('Update manifest version or path mismatch');
  entries[0].update_hash=`sha256:${sha256}`;
  entries[0].update_info_url=`https://github.com/groele/Zotero-diy/releases/tag/refnexus-v${details.version}`;
  if(JSON.stringify(entries[0].applications.zotero)!==JSON.stringify({strict_min_version:manifest.applications.zotero.strict_min_version,strict_max_version:manifest.applications.zotero.strict_max_version}))throw new Error('Update compatibility mismatch');
  return {update,verification:{version:details.version,addonID:details.config.addonID,bytes:xpi.length,sha256,updateURL:details.config.updateURL,downloadURL:details.config.downloadURL}};
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
