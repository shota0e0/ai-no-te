import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { createOcrJob, prepareTyped, recordTyped, finalizeTyped } from "../src/processing/typed.mjs";
import { prepareProcessingNotionPreview, formatProcessingNotionPreview, processingNotionPreviewCommand, serializeDevelopmentPageBody, serializeUserPageBody, serializeUserReviewSection } from "../src/notion/processing-preview.mjs";
import { main } from "../src/cli.mjs";
import { loadNotionSchema, resolveProfileConfig, validateNotionProfileSchema, resolveManifestProperties, evaluateUserReview, evaluateAutoReview } from "../src/notion/profiles.mjs";
const hash = b => createHash("sha256").update(b).digest("hex");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
const config = JSON.parse(await readFile(new URL("../config/notion-development.example.json", import.meta.url)));
const userConfig = JSON.parse(await readFile(new URL("../config/notion-user.example.json", import.meta.url)));
config.notion.destinations["development-other"] = {profile:"development",name:"Other Development Notes",dataSourceId:"REPLACE_WITH_OTHER_DEVELOPMENT_ID"};
async function sample(run) {
  const root = await mkdtemp(path.join(os.tmpdir(),"processing-notion-test-"));
  try {
    const input = path.join(root,"page-002.png"), job = path.join(root,"job"), pdf = Buffer.from("%PDF-1.4\n%mock\n%%EOF");
    await writeFile(input,png); await writeFile(path.join(root,"original.pdf"),pdf);
    await writeFile(path.join(root,"metadata.json"),JSON.stringify({schemaVersion:1,status:"complete",source:{filename:"original.pdf",sha256:hash(pdf),pageCount:2},selectedPages:[2],generatedFiles:[{filename:"page-002.png",pageNumber:2,width:1,height:1,sha256:hash(png)}]}));
    const extraction = path.join(root,"extraction.json");
    await writeFile(extraction,JSON.stringify({schemaVersion:1,sourcePage:2,sourceSha256:hash(png),engine:"mock",provider:"mock",model:"unknown",modelVersion:"unknown",timestamp:"2026-01-01T00:00:00Z",blocks:[{id:"t1",type:"text",text:"PRIVATE SYNTHETIC TEXT",confidence:"unknown",bbox:"unknown",position:"top",uncertain:true,description:"text"}]}));
    await createOcrJob({input,extraction,output:job});
    for (const mode of ["clean","interpreted"]) {
      const result = path.join(root,`${mode}.png`);
      await writeFile(result,Buffer.concat([png,Buffer.from(mode)]));
      await prepareTyped({job,mode,attempt:1});
      await recordTyped({job,mode,attempt:1,result,assessment:"pass",note:"Mock visual check",evidence:"mock"});
    }
    await finalizeTyped({job,cleanAttempt:1,interpretedAttempt:1});
    const metadata = await readFile(path.join(job,"processing-metadata.json"));
    const sidecar = {schemaVersion:1,owner_visual_review:"PASS",owner_visual_review_at:"2026-01-02T00:00:00Z",owner_visual_review_note:"Synthetic explicit visual decision only",processingMetadataSha256:hash(metadata),scope:"poc_next_step_only",approved:false,humanDecision:null,publicationApproved:false};
    const reviewFile = path.join(job,"owner-visual-review.json");
    const saveReview = r=>writeFile(reviewFile,JSON.stringify(r));
    await saveReview(sidecar);
    const configFile=path.join(root,"development.local.json");
    await writeFile(configFile,JSON.stringify(config));
    await run({root,job,input,metadata,sidecar,reviewFile,saveReview,configFile,plan:()=>prepareProcessingNotionPreview({job,config})});
  } finally { await rm(root,{recursive:true,force:true}); }
}
test("maps PDF/page, both typed images, OCR and provenance to one pending record",()=>sample(async s=>{
  const p=await s.plan(), m=JSON.parse(s.metadata);
  assert.equal(p.reviewState,"Pending Review"); assert.equal(p.review.state,"PENDING_REVIEW");
  assert.equal(p.approved,false); assert.equal(p.review.humanDecision,null); assert.equal(p.executable,false);
  assert.deepEqual(p.properties.find(v=>v.field==="Original").assets.map(a=>a.filename),["original.pdf","page-002.png"]);
  assert.equal(p.properties.find(v=>v.field==="Original SHA-256").value,m.original.pdfSha256);
  for (const [mode,label] of [["clean","Clean"],["interpreted","Interpreted"]]) assert.equal(p.properties.find(v=>v.field===label).assets[0].sha256,m.outputs[mode].sha256);
  assert.equal(p.bodySections[0].assets[0].sha256,m.ocr.rawSha256);
  assert.deepEqual(p.bodySections[1].value.modes.clean.prompt,m.prompts.clean);
  assert.equal(p.ownerVisualReview.result,"PASS");
  assert.equal(p.properties.find(v=>v.logicalField==="Title").resolution,"unique-property-by-type");
  assert.ok(p.developmentPageBody.children.length>10);
  assert.equal(Object.keys(p).includes("developmentPageBody"),false);
}));
test("preview performs no network or file mutation and omits private content/paths/IDs",()=>sample(async s=>{
  const before=await readdir(s.job), fetchBefore=globalThis.fetch;
  let calls=0;
  globalThis.fetch=()=>{calls++;throw Error("network forbidden");};
  try {
    const p=await s.plan(), text=formatProcessingNotionPreview(p), machine=JSON.stringify(p);
    assert.equal(calls,0); assert.equal(p.networkCalls,0); assert.equal(p.externalWrites,0);
    assert.match(text,/DRY RUN — NO EXTERNAL WRITE/); assert.match(text,/Human Approval: NOT GRANTED/);
    assert.match(text,/OCR: 1 text blocks; 1 need review/);
    for (const output of [text,machine]) {
      assert.ok(!output.includes("PRIVATE SYNTHETIC TEXT")); assert.ok(!output.includes(s.root));
      assert.ok(!output.includes(config.notion.destinations["development-notes"].dataSourceId));
    }
    assert.deepEqual(await readdir(s.job),before);
    assert.deepEqual(await readFile(path.join(s.job,"processing-metadata.json")),s.metadata);
    const user=await prepareProcessingNotionPreview({job:s.job,config:userConfig,profile:"user"});
    assert.equal(user.networkCalls,0); assert.equal(user.externalWrites,0); assert.equal(calls,0);
    assert.deepEqual(await readdir(s.job),before);
    assert.deepEqual(await readFile(path.join(s.job,"processing-metadata.json")),s.metadata);
    assert.equal(user.developmentPageBody,undefined);
  } finally {globalThis.fetch=fetchBefore;}
}));

test("Development serializer emits readable Notion blocks while preview JSON remains sanitized",()=>sample(async s=>{
  const p=await s.plan();
  const body=p.developmentPageBody;
  assert.equal(body.profile,"development");assert.equal(body.format,"notion-blocks");
  const headings=body.children.filter(item=>item.type.startsWith("heading_")).map(item=>item[item.type].rich_text[0].text.content);
  for(const expected of ["Processing Summary","OCR","Normalized Text","Raw OCR","Layout","Provenance","Processing Attempts"]) assert.ok(headings.includes(expected));
  assert.ok(body.children.some(item=>item.type==="code"&&item.code.language==="json"));
  const direct=serializeDevelopmentPageBody;
  assert.equal(typeof direct,"function");
  const machine=JSON.stringify(p);
  assert.ok(!machine.includes("PRIVATE SYNTHETIC TEXT"));
  assert.equal(p.reviewState,"Pending Review");assert.equal(p.approved,false);
}));

test("Development logical Title resolves uniquely by type and preserves canonical property ID",async()=>{
  const manifest=await loadNotionSchema("development");
  const base=Object.fromEntries(manifest.properties.filter(p=>p.name!=="Title").map(p=>[p.name,{id:`id-${p.key}`,type:p.type,...(p.options?{select:{options:p.options.map(name=>({name}))}}:{})}]));
  base["件名"]={id:"canonical-title-id",type:"title",title:{}};
  const resolved=resolveManifestProperties(manifest,{properties:base});
  const title=resolved.find(item=>item.logicalField==="Title");
  assert.equal(title.classification,"READY");assert.equal(title.remoteName,"件名");assert.equal(title.remoteId,"canonical-title-id");
  assert.equal((await validateNotionProfileSchema("development",{properties:base})).valid,true);
  const none=structuredClone(base);delete none["件名"];
  assert.equal(resolveManifestProperties(manifest,{properties:none}).find(item=>item.logicalField==="Title").classification,"TITLE_PROPERTY_MISSING");
  await assert.rejects(validateNotionProfileSchema("development",{properties:none}),/TITLE_PROPERTY_MISSING/);
  const multiple=structuredClone(base);multiple["別名"]={id:"title-2",type:"title",title:{}};
  assert.equal(resolveManifestProperties(manifest,{properties:multiple}).find(item=>item.logicalField==="Title").classification,"TITLE_PROPERTY_AMBIGUOUS");
  await assert.rejects(validateNotionProfileSchema("development",{properties:multiple}),/TITLE_PROPERTY_AMBIGUOUS/);
});
test("owner visual PASS cannot imply Human Approval or publication permission",()=>sample(async s=>{
  for (const change of [{approved:true},{humanDecision:{decision:"approve"}},{publicationApproved:true},{scope:"all_jobs"},{owner_visual_review:"pending"},{owner_visual_review_at:"unknown"}]) {
    await s.saveReview({...s.sidecar,...change});
    await assert.rejects(s.plan(),/approval boundary/);
  }
}));
test("missing or stale review sidecar is refused",()=>sample(async s=>{
  await s.saveReview({...s.sidecar,processingMetadataSha256:"0".repeat(64)});
  await assert.rejects(s.plan(),/does not match/);
  await rm(s.reviewFile);
  await assert.rejects(s.plan(),/PASS record/);
}));
test("modified Original, OCR, typed outputs, prompt or selected evidence is refused",()=>sample(async s=>{
  for (const file of ["original.pdf","page-002.png","ocr-raw.json","ocr-normalized.json","layout.json","clean.png","interpreted.png","clean-001/prompt.txt","clean-001/metadata.json"]) {
    const f=path.join(s.job,file), b=await readFile(f);
    await writeFile(f,Buffer.concat([b,Buffer.from("changed")]));
    await assert.rejects(s.plan());
    await writeFile(f,b);
  }
}));
test("approved processing metadata is rejected even if sidecar hash is rebound",()=>sample(async s=>{
  const m=JSON.parse(s.metadata);m.approved=true;
  const b=Buffer.from(JSON.stringify(m));await writeFile(path.join(s.job,"processing-metadata.json"),b);
  await s.saveReview({...s.sidecar,processingMetadataSha256:hash(b)});
  await assert.rejects(s.plan(),/approval state/);
}));
test("execute is rejected before I/O; existing notion flow refuses processing-job arguments",async()=>{
  await assert.rejects(prepareProcessingNotionPreview({execute:true}),/preview-only/);
  for(const args of [["--execute"],["--execute=true"],["--job","missing","--execute"]]) await assert.rejects(processingNotionPreviewCommand(args),/preview-only/);
  await assert.rejects(main(["notion","--job","missing","--execute"]),/process notion-preview/);
  await assert.rejects(main(["notion","--processing-job=missing"]),/process notion-preview/);
});
test("CLI integration, JSON and destination override stay offline",()=>sample(async s=>{
  let shown;
  const p=await main(["process","notion-preview","--job",s.job,"--profile","development","--config",s.configFile,"--destination","development-other","--json"],{write:v=>{shown=v;}});
  assert.deepEqual(p,shown);assert.equal(p.destination.name,"Other Development Notes");assert.equal(p.destination.source,"This Import Override");
  assert.equal(p.externalWrites,0);assert.equal(p.returnIntent,"clean");
  await assert.rejects(processingNotionPreviewCommand(["--job",s.job,"--job",s.job]),/option/);
  const bad=structuredClone(config);bad.notion.properties={originalFile:"Clean",cleanFile:"Clean"};
  await assert.rejects(prepareProcessingNotionPreview({job:s.job,config:bad}),/schema manifests/);
}));

test("user primary schema has six fields, no diagnostics, and identical source/output hashes",()=>sample(async s=>{
  const dev=await s.plan();
  const user=await prepareProcessingNotionPreview({job:s.job,config:userConfig});
  assert.equal(user.profile,"user");
  assert.deepEqual(user.properties.map(p=>p.field),["Title","Original","Clean","Interpreted","Review state","Return target"]);
  assert.deepEqual(user.bodySections,[]);
  for (const name of ["Original","Clean","Interpreted"]) assert.deepEqual(user.properties.find(p=>p.field===name).assets,dev.properties.find(p=>p.field===name).assets);
  const text=formatProcessingNotionPreview(user);
  for (const forbidden of ["SHA-256","OCR","provider","prompt","metadata","Attempt","PRIVATE SYNTHETIC TEXT",s.root]) assert.ok(!text.includes(forbidden));
  assert.match(text,/Review State: Approved/);assert.match(text,/Use Default \(Clean\)/);assert.equal(user.approved,true);
  assert.equal(user.returnReady,true);assert.equal(user.reason,"RETURN_READY");assert.deepEqual(user.autoReview.reasons,[]);
  assert.equal(dev.bodySections[2].section,"Processing / diagnostics");
  assert.ok(dev.bodySections[2].value.provider);assert.equal(dev.bodySections[2].value.attempts.length,2);
  assert.deepEqual(user.userPageBodyPlan.sections.map(section=>section.heading),["Original","Clean","Interpreted","Review"]);
  assert.equal(user.userPageBodyPlan.developmentDetailsIncluded,false);
}));
test("User serializer emits only comparison and review blocks",()=>{
  const id="11111111-1111-1111-1111-111111111111";
  const body=serializeUserPageBody({uploads:{"original.pdf":id,"page-002.png":id,"clean.png":id,"interpreted.png":id}});
  assert.equal(body.profile,"user");assert.equal(body.children.length,12);
  assert.deepEqual(body.children.filter(item=>item.type.startsWith("heading_")).map(item=>item[item.type].rich_text[0].text.content),["Original","Clean","Interpreted","Review","返す内容","確認状態"]);
  assert.equal(body.children.filter(item=>item.type==="image").length,3);assert.equal(body.children.filter(item=>item.type==="file").length,1);
  const text=JSON.stringify(body);
  for(const forbidden of ["OCR","SHA-256","Layout","Provenance","provider","prompt","failed attempt","Processing Summary"]) assert.ok(!text.includes(forbidden));
  assert.throws(()=>serializeUserPageBody({uploads:{}}),/Four completed/);
});

test("Human Approval and return-target resolution are independent for all valid states",()=>{
  const artifacts={clean:true,interpreted:true};
  for(const reviewState of ["Pending Review","Approved","Needs Review"]) for(const returnTarget of ["Use Default","Clean","Interpreted"]){
    const result=evaluateUserReview({reviewState,returnTarget,defaultReturnMode:"clean",availableArtifacts:artifacts});
    assert.equal(result.approved,reviewState==="Approved");
    assert.equal(result.resolvedReturnTarget,returnTarget==="Interpreted"?"interpreted":"clean");
    assert.equal(result.returnReady,reviewState==="Approved");
    assert.equal(result.reason,reviewState==="Approved"?"RETURN_READY":reviewState==="Needs Review"?"NEEDS_REVIEW":"NOT_APPROVED");
  }
});

test("invalid review values and missing artifacts fail explicitly without fallback",()=>{
  const valid={defaultReturnMode:"clean",availableArtifacts:{clean:true,interpreted:true}};
  const cases=[
    [{...valid,reviewState:undefined,returnTarget:"Use Default"},"REVIEW_STATE_MISSING"],
    [{...valid,reviewState:"Unknown",returnTarget:"Use Default"},"UNKNOWN_REVIEW_STATE"],
    [{...valid,reviewState:"Approved",returnTarget:undefined},"RETURN_TARGET_MISSING"],
    [{...valid,reviewState:"Approved",returnTarget:"Unknown"},"UNKNOWN_RETURN_TARGET"],
    [{...valid,reviewState:["Approved","Pending Review"],returnTarget:"Clean"},"REVIEW_STATE_CONFLICT"],
    [{...valid,reviewState:"Approved",returnTarget:["Clean","Interpreted"]},"RETURN_TARGET_CONFLICT"],
    [{...valid,reviewState:"Approved",returnTarget:"Clean",availableArtifacts:{clean:false,interpreted:true}},"TARGET_ARTIFACT_MISSING"],
    [{...valid,reviewState:"Approved",returnTarget:"Clean",recordConsistent:false},"RECORD_STATE_INCONSISTENT"],
  ];
  for(const [input,detail] of cases){
    const result=evaluateUserReview(input);
    assert.equal(result.returnReady,false);assert.equal(result.reason,"RETURN_NOT_READY");assert.equal(result.detail,detail);
  }
});

test("return-target and Owner Visual Review changes cannot approve",()=>{
  for(const returnTarget of ["Use Default","Clean","Interpreted"]){
    const result=evaluateUserReview({reviewState:"Pending Review",returnTarget,defaultReturnMode:"clean",
      availableArtifacts:{clean:true,interpreted:true},ownerVisualReview:"PASS"});
    assert.equal(result.approved,false);assert.equal(result.returnReady,false);assert.equal(result.reason,"NOT_APPROVED");
  }
});

test("User Review body is derived from property values, not an independent approval state",()=>{
  const id="11111111-1111-1111-1111-111111111111",uploads={"original.pdf":id,"page-002.png":id,"clean.png":id,"interpreted.png":id};
  const body=serializeUserPageBody({uploads,reviewState:"Approved",returnTarget:"Interpreted",defaultReturnMode:"clean"});
  const text=JSON.stringify(body);
  assert.match(text,/現在値: Interpreted/);assert.match(text,/現在値: Approved/);
  assert.ok(!text.includes("現在値: Pending Review"));assert.ok(!text.includes("現在値: Use Default"));
  const review=serializeUserReviewSection({reviewState:"Pending Review",returnTarget:"Clean",defaultReturnMode:"clean",availableArtifacts:{clean:true,interpreted:true}});
  assert.equal(review.children.length,5);assert.equal(review.evaluation.approved,false);assert.equal(review.evaluation.resolvedReturnTarget,"clean");
});

const normalAutoReview=overrides=>evaluateAutoReview({
  ocr:{blocks:[{text:"Readable OCR text"}],expectsText:true,parseFailed:false},
  artifacts:{original:true,clean:true,interpreted:true},conflictingState:false,
  generation:{cleanValid:true,interpretedValid:true,historicalFailedAttempts:0},
  returnTarget:"Use Default",defaultReturnMode:"clean",...overrides,
});

test("normal auto review approves and Use Default resolves to Clean",()=>{
  const result=normalAutoReview();
  assert.equal(result.reviewState,"Approved");assert.equal(result.approved,true);assert.equal(result.returnReady,true);
  assert.equal(result.resolvedReturnTarget,"clean");assert.equal(result.reason,"RETURN_READY");assert.deepEqual(result.reasons,[]);
  assert.deepEqual(result.redFlags,{ocrSuspicious:false,artifactMissing:false,conflictingState:false,generationFailure:false,targetUnresolved:false});
});

test("only clear OCR failures trigger OCR_SUSPICIOUS; unknown confidence does not",()=>{
  for(const ocr of [{blocks:[],expectsText:true},{blocks:[{text:"[unknown]"}],expectsText:true},{blocks:[{text:"�"}],expectsText:true},{blocks:[{text:"ok"}],expectsText:true,parseFailed:true}]){
    const result=normalAutoReview({ocr});assert.equal(result.reviewState,"Needs Review");assert.ok(result.reasons.includes("OCR_SUSPICIOUS"));
  }
  const unknownConfidence=normalAutoReview({ocr:{blocks:[{text:"Readable OCR text",confidence:"unknown",needsReview:true}],expectsText:true,parseFailed:false}});
  assert.equal(unknownConfidence.approved,true);assert.equal(unknownConfidence.redFlags.ocrSuspicious,false);
});

test("missing artifact, conflicting state, final generation failure and unresolved target map to five fixed reasons",()=>{
  const artifact=normalAutoReview({artifacts:{original:false,clean:true,interpreted:true}});
  assert.deepEqual(artifact.reasons,["ARTIFACT_MISSING"]);
  const conflict=normalAutoReview({conflictingState:true});assert.deepEqual(conflict.reasons,["CONFLICTING_STATE"]);
  const generation=normalAutoReview({generation:{cleanValid:false,interpretedValid:true,historicalFailedAttempts:0}});
  assert.deepEqual(generation.reasons,["GENERATION_FAILED"]);
  const target=normalAutoReview({returnTarget:"Unknown"});assert.deepEqual(target.reasons,["TARGET_UNRESOLVED"]);
  for(const result of [artifact,conflict,generation,target]){assert.equal(result.reviewState,"Needs Review");assert.equal(result.approved,false);assert.equal(result.returnReady,false);assert.equal(result.reason,"NEEDS_REVIEW");}
});

test("multiple red flags are retained without a score",()=>{
  const result=normalAutoReview({ocr:{blocks:[],expectsText:true},artifacts:{original:false,clean:false,interpreted:true},
    conflictingState:true,generation:{cleanValid:false,interpretedValid:true},returnTarget:"Unknown"});
  assert.deepEqual(result.reasons,["OCR_SUSPICIOUS","ARTIFACT_MISSING","CONFLICTING_STATE","GENERATION_FAILED","TARGET_UNRESOLVED"]);
  assert.equal(Object.hasOwn(result,"score"),false);assert.equal(Object.hasOwn(result,"quality"),false);
});

test("historical failed attempts do not block valid final outputs",()=>{
  const result=normalAutoReview({generation:{cleanValid:true,interpretedValid:true,historicalFailedAttempts:7}});
  assert.equal(result.approved,true);assert.equal(result.redFlags.generationFailure,false);
});

test("Needs Review remains manually approvable and never becomes return-ready by itself",()=>{
  const artifacts={clean:true,interpreted:true};
  const needs=evaluateUserReview({reviewState:"Needs Review",returnTarget:"Use Default",defaultReturnMode:"clean",availableArtifacts:artifacts});
  assert.equal(needs.approved,false);assert.equal(needs.returnReady,false);assert.equal(needs.reason,"NEEDS_REVIEW");
  const approved=evaluateUserReview({reviewState:"Approved",returnTarget:"Use Default",defaultReturnMode:"clean",availableArtifacts:artifacts});
  assert.equal(approved.approved,true);assert.equal(approved.returnReady,true);assert.equal(approved.reason,"RETURN_READY");
});

test("Needs Review User UX shows only short human-readable reasons",()=>{
  const section=serializeUserReviewSection({reviewState:"Needs Review",returnTarget:"Use Default",defaultReturnMode:"clean",
    availableArtifacts:{clean:true,interpreted:true},reasons:["OCR_SUSPICIOUS","ARTIFACT_MISSING"]});
  const text=JSON.stringify(section);
  assert.match(text,/確認が必要です/);assert.match(text,/OCR結果を確認してください/);assert.match(text,/必要な画像またはOriginalがありません/);
  for(const forbidden of ["confidence","score","provider","prompt","SHA-256","failed attempt"]) assert.ok(!text.includes(forbidden));
});
test("each return choice is independent from approval and retains both modes",()=>sample(async s=>{
  for (const profileConfig of [config,userConfig]) for(const target of ["default","clean","interpreted"]) {
    const p=await prepareProcessingNotionPreview({job:s.job,config:profileConfig,returnTarget:target});
    assert.equal(p.returnIntent,target==="interpreted"?"interpreted":"clean");
    const isUser=profileConfig.notion.profile==="user";
    assert.equal(p.reviewState,isUser?"Approved":"Pending Review");assert.equal(p.review.humanDecision,null);
    assert.equal(p.approved,isUser);assert.equal(p.returnReady,isUser);
    assert.ok(p.properties.find(p=>p.field==="Clean"));assert.ok(p.properties.find(p=>p.field==="Interpreted"));
  }
  await assert.rejects(prepareProcessingNotionPreview({job:s.job,config:userConfig,returnTarget:"approved"}),/Return target/);
}));
test("unknown, mismatched, untagged and cross-profile destinations cannot fall back",async()=>{
  assert.throws(()=>resolveProfileConfig(userConfig,"invalid"),/profile/);
  assert.throws(()=>resolveProfileConfig(config,"user"),/mismatch/);
  assert.throws(()=>resolveProfileConfig(userConfig,"development"),/mismatch/);
  const missing=structuredClone(userConfig);delete missing.notion.profile;
  assert.throws(()=>resolveProfileConfig(missing),/untagged/);
  const cross=structuredClone(userConfig);cross.notion.destinations["user-notes"].profile="development";
  assert.throws(()=>resolveProfileConfig(cross),/cross-profile/);
  assert.throws(()=>resolveProfileConfig(userConfig,"user","development-notes"),/no fallback/);
  const badDefault=structuredClone(userConfig);badDefault.preferences.defaultNotionDestination="development-notes";
  assert.throws(()=>resolveProfileConfig(badDefault),/no fallback/);
  await assert.rejects(processingNotionPreviewCommand(["--job","missing","--profile","../development"]),/profile/);
});
test("CLI defaults to user, accepts explicit profiles, and rejects config mismatch",()=>sample(async s=>{
  const p=await processingNotionPreviewCommand(["--job",s.job,"--json"]);
  assert.equal(p.profile,"user");assert.equal(p.destination.name,"My Notes");
  const override=await processingNotionPreviewCommand(["--job",s.job,"--profile","user","--return-target","interpreted","--json"]);
  assert.equal(override.returnChoice.value,"Interpreted");assert.equal(override.reviewState,"Approved");
  await assert.rejects(processingNotionPreviewCommand(["--job",s.job,"--profile","user","--config",s.configFile]),/mismatch/);
}));
test("public profile configs contain only placeholder destinations, no shared profile fallback",async()=>{
  const ids=[];
  for (const profile of ["user","development"]) {
    const c=JSON.parse(await readFile(new URL(`../config/notion-${profile}.example.json`,import.meta.url)));
    assert.equal(c.notion.profile,profile);assert.equal(c.preferences.defaultReturnMode,"clean");
    assert.equal(c.notion.credentialEnv,`AINOTE_${profile.toUpperCase()}_NOTION_TOKEN`);
    for(const d of Object.values(c.notion.destinations)) {assert.equal(d.profile,profile);assert.match(d.dataSourceId,/^REPLACE_WITH_/);ids.push(d.dataSourceId);}
  }
  assert.equal(new Set(ids).size,ids.length);
});
test("schema manifests are reproducible and local schema validation rejects missing/wrong fields",async()=>{
  for(const profile of ["user","development"]) {
    const manifest=await loadNotionSchema(profile);
    assert.equal(manifest.profile,profile);
    const schema={properties:Object.fromEntries(manifest.properties.map(p=>{
      assert.equal(p.required,true);assert.ok(p.meaning);assert.ok(p.name);assert.ok(p.type);
      return [p.name,{type:p.type,...(p.options?{select:{options:p.options.map(name=>({name}))}}:{})}];}))};
    assert.equal((await validateNotionProfileSchema(profile,schema)).valid,true);
    const wrong=structuredClone(schema);wrong.properties.Original.type="rich_text";
    await assert.rejects(validateNotionProfileSchema(profile,wrong),/Original/);
    const badOptions=structuredClone(schema);badOptions.properties["Review state"].select.options=[];
    await assert.rejects(validateNotionProfileSchema(profile,badOptions),/UNSUPPORTED_MAPPING/);
    delete schema.properties["Return target"];
    await assert.rejects(validateNotionProfileSchema(profile,schema),/Return target/);
  }
});
