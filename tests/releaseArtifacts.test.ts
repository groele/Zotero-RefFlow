import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import {createReleaseArtifacts,validateReleaseConfig} from '../scripts/release-artifacts.mjs';
const details=JSON.parse(fs.readFileSync('package.json','utf8'));
const manifest={version:details.version,applications:{zotero:{id:details.config.addonID,update_url:details.config.updateURL,strict_min_version:'10.0.0',strict_max_version:'10.*'}}};
const template=()=>({addons:{[details.config.addonID]:{updates:[{version:details.version,update_link:details.config.downloadURL,applications:{zotero:{strict_min_version:'10.0.0',strict_max_version:'10.*'}}}]}}});
test('release metadata pairs the exact package bytes with the update checksum',()=>{
 const bytes=Buffer.from('package fixture'),result=createReleaseArtifacts(details,bytes,template(),manifest);const hash=createHash('sha256').update(bytes).digest('hex');assert.equal(result.update.addons[details.config.addonID].updates[0].update_hash,'sha256:'+hash);assert.equal(result.verification.sha256,hash);assert.equal(result.verification.bytes,bytes.length);
});
test('release paths reject an upstream or unrelated repository',()=>{
 const wrong=structuredClone(details);wrong.config.updateURL='https://raw.githubusercontent.com/MuiseDestiny/zotero-reference/master/update.json';assert.throws(()=>validateReleaseConfig(wrong),/Update\/download URL/);
});
test('package and update manifest version drift fail the release gate',()=>{
 const wrong=structuredClone(manifest);wrong.version='0.0.0';assert.throws(()=>createReleaseArtifacts(details,Buffer.from('x'),template(),wrong),/disagree/);const update=template();update.addons[details.config.addonID].updates[0].version='0.0.0';assert.throws(()=>createReleaseArtifacts(details,Buffer.from('x'),update,manifest),/version or path/);
});
test('monorepo release notes use a plugin-specific version tag',()=>{
 const update=createReleaseArtifacts(details,Buffer.from('x'),template(),manifest).update;assert.equal(update.addons[details.config.addonID].updates[0].update_info_url,`https://github.com/groele/Zotero-diy/releases/tag/refnexus-v${details.version}`);
});
