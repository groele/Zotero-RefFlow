import { test, describe } from "node:test";
import assert from "node:assert";
import { extractReferencesFromLines } from "../src/modules/referenceExtractor";

describe("Reference text extraction", () => {
  test("Harvard surname particles and hanging author continuations do not split entries",()=>{
    const refs=extractReferencesFromLines([{text:'References',page:1,y:700,x:40},{text:'van der Waals, J. A long author list,',page:1,y:680,x:40},{text:'Brown, A., and Smith, B. (2024). First reference title.',page:1,y:660,x:55},{text:'de Vries, A. (2023). Second reference title.',page:1,y:640,x:40}]);
    assert.equal(refs.length,2);assert.ok(refs[0].text.includes('Brown'));assert.ok(refs[1].text.startsWith('de Vries'));
  });
  test("Science References and Notes heading and publication ligatures",()=>{
    const refs=extractReferencesFromLines(['References and Notes','1. Smith, J. A ﬁnite spin-','orbit coupling model. Science, 2024.','2. Brown, A. Another title. Science, 2023.','Acknowledgments','This text must not enter the bibliography.'].map((text,i)=>({text,page:1,y:700-i*20})));
    assert.equal(refs.length,2);assert.ok(refs[0].text.includes('finite spin-orbit'));assert.ok(!refs[1].text.includes('Acknowledgments'));
  });
  test("method reference section is retained without swallowing intervening prose",()=>{
    const refs=extractReferencesFromLines(['References','1. Smith, J. Main reference. Nature, 2024.','Methods','Several paragraphs of methods prose.','References','2. Brown, A. Methods reference. Nature, 2023.','Author contributions','This attribution must not enter the last reference.'].map((text,i)=>({text,page:1,y:700-i*20})));
    assert.equal(refs.length,2);assert.ok(!refs[0].text.includes('paragraphs'));assert.ok(!refs[1].text.includes('attribution'));
  });
  test("repeated page margins do not contaminate citations",()=>{
    const refs=extractReferencesFromLines([{text:'References',page:1,y:700},{text:'1. Smith, J. First reference. Journal, 2024.',page:1,y:680},{text:'Journal | Volume 20 | 2024',page:1,y:20,margin:true},{text:'Journal | Volume 20 | 2024',page:2,y:780,margin:true},{text:'2. Brown, A. Second reference. Journal, 2023.',page:2,y:680}]);
    assert.equal(refs.length,2);assert.ok(refs.every(ref=>!ref.text.includes('Volume 20')));
  });
  test("recognizes author initials and numbered bibliography headings",()=>{
    const refs=extractReferencesFromLines([
      {page:1,y:720,text:'6. References'},
      {page:1,y:700,text:'Smith, J., Doe, A. (2024). First citation title.'},
      {page:1,y:680,text:'Journal A, 10, 100-120.'},
      {page:1,y:640,text:'Brown, A. B. (2023). Second citation title.'},
      {page:1,y:620,text:'2023. Journal B continuation.'},
      {page:1,y:600,text:'12'}
    ]);
    assert.equal(refs.length,2);assert.ok(refs[1].text.includes('continuation'));assert.ok(!refs[1].text.endsWith('12'));
  });
  test("rejects three numbered instructions without bibliographic evidence",()=>{
    const refs=extractReferencesFromLines(['1. Heat the sample for two minutes.','2. Cool the sample and measure current.','3. Record the observations and repeat steps.'].map((text,i)=>({text,page:1,y:700-i*30})));
    assert.deepEqual(refs,[]);
  });
  test("recognizes a coherent no-heading bibliography without merging subsequent sections",()=>{
    const refs=extractReferencesFromLines(['[1] Smith, J. First title. Journal, 2024.','[2] Lee, K. Second title. Journal, 2023.','[3] Doe, A. Third title. Journal, 2022.'].map((text,i)=>({text,page:1,y:700-i*30})));
    assert.equal(refs.length,3);
  });
  test("extracts numbered bibliography entries and joins wrapped lines", () => {
    const refs = extractReferencesFromLines([
      { page: 1, y: 800, text: "Introduction" },
      { page: 7, y: 720, text: "References" },
      { page: 7, y: 700, text: "[1] Author A. A stable reference extraction method. Journal, 2024." },
      { page: 7, y: 684, text: "https://doi.org/10.1234/example" },
      { page: 7, y: 660, text: "[2] Author B. A second reference. Another Journal, 2023." },
    ]);

    assert.equal(refs.length, 2);
    assert.equal(refs[0].number, 1);
    assert.match(refs[0].text, /stable reference extraction method.*doi\.org/);
    assert.equal(refs[1].number, 2);
  });

  test("recognizes Chinese references and the first numeric item", () => {
    const refs = extractReferencesFromLines([
      { page: 2, y: 420, text: "参考文献" },
      { page: 2, y: 400, text: "［1］张三. 一种稳定的参考文献提取方法[J]. 2024." },
    ]);
    assert.equal(refs.length, 1);
    assert.equal(refs[0].number, 1);
  });

  test("does not interpret a short numbered body as a bibliography", () => {
    const refs = extractReferencesFromLines([
      { page: 1, y: 700, text: "1. First short point" },
      { page: 1, y: 680, text: "2. Second short point" },
    ]);
    assert.deepEqual(refs, []);
  });
});
