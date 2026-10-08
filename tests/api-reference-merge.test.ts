import "./setup";
import { test, describe } from "node:test";
import assert from "node:assert";
import API from "../src/modules/api";

describe("API reference provider ordering", () => {
  test("does not enrich a reference with a conflicting DOI even when titles match", async () => {
    const api=new API({refText2Info:(text:string)=>({title:text}),identifiers2URL:()=>undefined} as any);
    (api.requests as any).get=async()=>({message:{DOI:"10.1000/source",title:["Source"],reference:[{DOI:"10.1000/expected","article-title":"Identical scientific title",author:"Author",year:"2024"}]}});
    (api.openAlex as any).getWorkByDOI=async()=>({work:{title:"Source"},referencedWorks:["W1"]});
    (api.openAlex as any).hydrateBatch=async()=>[{doi:"10.1000/wrong",title:"Identical scientific title",authors:["Author"],year:"2024",isOA:true,oaUrl:"https://example.org/wrong.pdf"}];
    const result=await api.getDOIInfoByCrossref("10.1000/source");
    assert.equal(result?.references?.[0].identifiers?.DOI,"10.1000/expected");
    assert.equal(result?.references?.[0].oaUrl,undefined);
  });
  test("enriches matching OpenAlex entries without appending unmatched records", async () => {
    const api = new API({
      refText2Info: (text: string) => ({ title: text }),
      identifiers2URL: (identifiers: any) => identifiers?.DOI ? `https://doi.org/${identifiers.DOI}` : undefined
    } as any);
    (api.requests as any).get = async () => ({
      message: {
        DOI: "10.1000/source",
        title: ["Source paper"],
        "reference-count": 2,
        reference: [
          { DOI: "10.1000/ref-a", "article-title": "Primary A", author: "Author A", year: "2020" },
          { DOI: "10.1000/ref-b", "article-title": "Primary B", author: "Author B", year: "2021" }
        ]
      }
    });
    (api.openAlex as any).getWorkByDOI = async () => ({
      work: { title: "Source paper" },
      referencedWorks: ["oa-a", "oa-b", "oa-extra"]
    });
    (api.openAlex as any).hydrateBatch = async () => [
      { openalexId: "oa-a", doi: "10.1000/ref-a", title: "Primary A", authors: ["Author A"], year: "2020", isOA: true, oaUrl: "https://example.org/a.pdf" },
      { openalexId: "oa-b", doi: "10.1000/ref-b", title: "Primary B", authors: ["Author B"], year: "2021", isOA: false },
      { openalexId: "oa-extra", doi: "10.1000/unlisted", title: "Unlisted OpenAlex work", authors: [], year: "2019", isOA: false }
    ];
    (api.retractionChecker as any).checkLocal = () => ({ isRetracted: false });
    let semanticScholarCalls = 0;
    (api as any).getDOIReferencesBySemanticScholar = async () => { semanticScholarCalls++; return []; };

    const result = await api.getDOIInfoByCrossref("10.1000/source");

    assert.deepStrictEqual(result?.references?.map(ref => ref.identifiers?.DOI), ["10.1000/ref-a", "10.1000/ref-b"]);
    assert.equal(result?.references?.length, 2);
    assert.ok(result?.references?.[0].sources?.includes("OpenAlex"));
    assert.equal(result?.references?.[0].oaUrl, "https://example.org/a.pdf");
    assert.equal(semanticScholarCalls, 0);
  });
});
