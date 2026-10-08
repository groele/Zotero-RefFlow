import Requests from "./requests";
import CitationVerifier from "./verifier";

export interface RetractionCheckResult {
  isRetracted:boolean;
  /** False means no authoritative check was performed, not a clean bill of health. */
  checked?:boolean;
  reason?:string;
  updatedDate?:string;
}

export default class RetractionChecker {
  constructor(private requests:Requests=new Requests()) {}

  public checkLocal(_doi?:string,item?:Zotero.Item):RetractionCheckResult {
    const retractions=(Zotero as any).Retractions;
    if(item && retractions?.isRetracted) {
      try {
        const retracted=Boolean(retractions.isRetracted(item));
        return {isRetracted:retracted,checked:true,reason:retracted?"Zotero local retraction warning":undefined};
      }catch{}
    }
    return {isRetracted:false,checked:false};
  }

  async checkDOI(doi?:string,checkRemote=false):Promise<RetractionCheckResult> {
    const clean=CitationVerifier.normalizeDOI(doi);
    if(!clean || !checkRemote)return {isRetracted:false,checked:false};
    const path=clean.split("/").map(encodeURIComponent).join("/");
    const data=await this.requests.get(`https://api.crossref.org/works/${path}`);
    if(!data?.message)return {isRetracted:false,checked:false};
    const relation=data.message.relation||{};
    const notices=relation["is-retracted-by"]||relation["is-withdrawn-by"];
    if(Array.isArray(notices) && notices.length) {
      const notice=notices[0]?.id||notices[0]?.["id-value"];
      return {isRetracted:true,checked:true,reason:`Crossref retraction relation${notice?`: ${notice}`:""}`};
    }
    const updates=data.message["updated-by"];
    const retraction=Array.isArray(updates)?updates.find(update=>["retraction","withdrawal"].includes(update?.type)):undefined;
    if(retraction) return {isRetracted:true,checked:true,reason:`Crossref ${retraction.source||"publisher"} retraction: ${retraction.DOI||"notice unavailable"}`,updatedDate:retraction.updated?.["date-time"]};
    // `update-to` describes the article a notice updates. The notice itself must
    // not be mislabeled as the retracted article solely because of this field.
    return {isRetracted:false,checked:true};
  }
}
