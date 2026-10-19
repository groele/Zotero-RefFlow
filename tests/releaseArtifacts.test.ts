import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import {createReleaseArtifacts,validateReleaseConfig} from '../scripts/release-artifacts.mjs';
const details=JSON.parse(fs.readFileSync('package.json','utf8'));
const manifest={version:details.version,applications:{zotero:{id:details.config.addonID,update_url:details.config.updateURL,strict_min_version:'10.0.6',strict_max_version:'11.*'}}};
const template=()=>({addons:{[details.config.addonID]:{updates:[{version:details.version,update_link:details.config.downloadURL,applications:{zotero:{strict_min_version:'10.0.6',strict_max_version:'11.*'}}}]}}});
test('release metadata pairs the exact package bytes with the update checksum',()=>{
 const bytes=Buffer.from('package fixture'),result=createReleaseArtifacts(details,bytes,template(),manifest);const hash=createHash('sha256').update(bytes).digest('hex');assert.equal(result.update.addons[details.config.addonID].updates[0].update_hash,'sha256:'+hash);assert.equal(result.verification.sha256,hash);assert.equal(result.verification.bytes,bytes.length);
});
test('release paths reject an upstream or unrelated repository',()=>{
 const wrong=structuredClone(details);wrong.config.updateURL='https://raw.githubusercontent.com/MuiseDestiny/zotero-reference/master/update.json';assert.throws(()=>validateReleaseConfig(wrong),/Update\/download URL/);
});
test('package and update manifest version drift fail the release gate',()=>{
 const wrong=structuredClone(manifest);wrong.version='0.0.0';assert.throws(()=>createReleaseArtifacts(details,Buffer.from('x'),template(),wrong),/disagree/);const update=template();update.addons[details.config.addonID].updates[0].version='0.0.0';assert.throws(()=>createReleaseArtifacts(details,Buffer.from('x'),update,manifest),/version or path/);
});
test('RefFlow release notes use the configured semantic release tag',()=>{
 const update=createReleaseArtifacts(details,Buffer.from('x'),template(),manifest).update;assert.ok(details.config.releaseTag===`refflow-v${details.version}`||(details.version.endsWith('.0.0')&&details.config.releaseTag===`V${details.version.split('.')[0]}`));assert.equal(update.addons[details.config.addonID].updates[0].update_info_url,`https://github.com/groele/Zotero-RefFlow/releases/tag/${details.config.releaseTag}`);
});
test('release gate rejects a tag that disagrees with the version',()=>{
 const wrong=structuredClone(details);wrong.config.releaseTag='V11';assert.throws(()=>validateReleaseConfig(wrong),/tag and version/);
});
test('release gate rejects the legacy identity and a reverted Zotero 11 ceiling',()=>{
 const legacy=structuredClone(details);legacy.config.addonID='refnexus@polygon.org';assert.throws(()=>validateReleaseConfig(legacy),/identity mismatch/);
 const incompatible=structuredClone(manifest);incompatible.applications.zotero.strict_max_version='10.*';assert.throws(()=>createReleaseArtifacts(details,Buffer.from('x'),template(),incompatible),/compatibility/);
});
