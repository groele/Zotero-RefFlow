import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const read=(name:string)=>fs.readFileSync(path.join(process.cwd(),name),"utf8");
const details=JSON.parse(read("package.json"));

test("maintainer metadata preserves the upstream attribution and license",()=>{
  assert.equal(details.author,"groele");
  assert.equal(details.license,"AGPL-3.0-or-later");
  assert.ok(details.contributors.some((entry:any)=>entry.name.includes("Polygon")&&entry.url==='https://github.com/MuiseDestiny'));
  assert.match(details.description,/derived from Zotero Reference \/ Ethereal Reference/);
});
test("project and automatic update URLs all resolve to the derivative repository",()=>{
  assert.equal(details.homepage,"https://github.com/groele/Zotero-diy/tree/main/RefNexus-Zotero10");
  assert.equal(details.config.updateURL,"https://raw.githubusercontent.com/groele/Zotero-diy/main/RefNexus-Zotero10/update.json");
  assert.equal(details.config.downloadURL,"https://raw.githubusercontent.com/groele/Zotero-diy/main/RefNexus-Zotero10/zotero-refnexus.xpi");
  assert.equal(details.config.issuesURL,"https://github.com/groele/Zotero-diy/issues");
  assert.equal(details.config.addonID,"refnexus@polygon.org");
});
test("Zotero 10 manifest uses the JSON update URL token",()=>{
  const manifest=JSON.parse(read("addon/manifest.json"));
  assert.equal(manifest.applications.zotero.update_url,"__updateURL__");
  assert.equal(manifest.applications.zotero.strict_min_version,"10.0.0");
  assert.equal(manifest.applications.zotero.strict_max_version,"10.*");
  const template=JSON.parse(read("update-template.json"));
  assert.equal(template.addons["__addonID__"].updates[0].update_link,"__downloadURL__");
});
test("native settings expose maintainer, source attribution and feedback links in each locale",()=>{
  const prefs=read("addon/chrome/content/preferences.xhtml");
  for(const token of ["__homepage__","__issuesURL__","__upstreamURL__","about-maintainer","about-origin"])assert.ok(prefs.includes(token));
  for(const lang of ["zh-CN","en-US","it-IT"]){
    const locale=read(`addon/locale/${lang}/preferences.ftl`);
    assert.match(locale,/about-maintainer = .*groele/);
    assert.match(locale,/about-origin = .*Zotero Reference \/ Ethereal Reference/);
  }
});
