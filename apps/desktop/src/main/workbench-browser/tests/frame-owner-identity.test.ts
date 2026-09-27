import { expect, test } from "vitest";
import { coerceFrameOwnerCandidates, matchFrameOwnerCandidates } from "../view-manager-runtime/normalizers";

const candidate = (index:number,src:string,hidden=false)=>({index,src,name:"",title:"",sourceKind:"iframe",selectorPreview:"iframe",visible:!hidden,hostChain:[],bounds:{x:0,y:index*100,width:hidden?0:300,height:hidden?0:100}});
const child = (id:number,url:string)=>({frameTreeNodeId:id,url,name:"",isDestroyed:()=>false});

test("hidden frame owners keep their place without consuming visible sibling identities",()=>{
  const {candidates}=coerceFrameOwnerCandidates({candidates:[candidate(0,"https://site.test/hidden",true),candidate(1,"https://site.test/visible")]});
  expect(candidates).toHaveLength(2);
  const matched=matchFrameOwnerCandidates({frames:[child(10,"https://site.test/hidden"),child(11,"https://site.test/visible")]} as never,candidates);
  expect(matched.get(10)?.bounds.width).toBe(0);
  expect(matched.get(11)?.src).toBe("https://site.test/visible");
});

test("missing owners cannot steal explicit sibling matches",()=>{
  const {candidates}=coerceFrameOwnerCandidates({candidates:[candidate(1,"https://site.test/visible")]});
  const matched=matchFrameOwnerCandidates({frames:[child(10,"https://site.test/unavailable"),child(11,"https://site.test/visible")]} as never,candidates);
  expect(matched.has(10)).toBe(false);expect(matched.get(11)?.src).toBe("https://site.test/visible");
});
