import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { catalogFromDatabase, composeHandwritingLayers, desktopInputCommand, importDesktopInput, parseDesktopPages, previewDesktopInput, selectDesktopNote } from "../src/ainote/desktop-input.mjs";
import { createOcrJob, finalizeTyped, prepareTyped, recordTyped } from "../src/processing/typed.mjs";
import { prepareProcessingNotionPreview } from "../src/notion/processing-preview.mjs";
import { planDesktopReturn } from "../src/ainote/desktop-return.mjs";

const rgba = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgAAIAAAUAAWJVMogAAAAASUVORK5CYII=", "base64");
const hash = value => createHash("sha256").update(value).digest("hex");
const detail = (id="n1", layers=["a.png"]) => ({ code: 200, data: { note: { content: { source: "A2", noteId: id, pages: [{ noteId: id, hwSrc: Object.fromEntries(layers.map((name,index)=>[`${index}_hw.png`,name])), src: {}, attachmentSrc: {} }] } } } });

async function fixture(run) {
  const root=await mkdtemp(path.join(os.tmpdir(),"desktop-input-test-")),data=path.join(root,"AINOTE","data","account"),res=path.join(data,"n1","res");
  try {
    await mkdir(res,{recursive:true});
    const db={version:1,list:[{noteId:"n1",noteName:"手書きメモ",type:20,isDel:0,appDel:0,localActionV2:0},{noteId:"n2",noteName:"重複",type:20,isDel:0,appDel:0},{noteId:"n3",noteName:"重複",type:20,isDel:0,appDel:0},{noteId:"../escape",noteName:"不正ID",type:20,isDel:0,appDel:0},{noteId:"deleted",noteName:"削除済み",type:20,isDel:1,appDel:0}]};
    await writeFile(path.join(data,"db.json"),JSON.stringify(db));await writeFile(path.join(data,"dir.json"),JSON.stringify({list:[]}));await writeFile(path.join(res,"a.png"),rgba);await writeFile(path.join(res,"b.png"),rgba);
    await run({root,data,db,res,env:{APPDATA:root},deps:{env:{APPDATA:root},detail:detail()}});
  } finally { await rm(root,{recursive:true,force:true}); }
}

test("Desktop note listing exposes safe aliases and exact selection",()=>fixture(async s=>{
  const catalog=catalogFromDatabase(s.db);assert.equal(catalog.length,3);assert.deepEqual(catalog.map(x=>x.alias),["note-001","note-002","note-003"]);
  assert.equal(selectDesktopNote(catalog,catalog.find(x=>x.title==="手書きメモ").alias).title,"手書きメモ");
  assert.throws(()=>selectDesktopNote(catalog,"重複"),error=>error.code==="AMBIGUOUS_NOTE");
}));

test("page selection is explicit, sorted and bounded",()=>{
  assert.deepEqual(parseDesktopPages("3,1-2,2",3),[1,2,3]);assert.deepEqual(parseDesktopPages("all",2),[1,2]);assert.throws(()=>parseDesktopPages("4",3));
});

test("preview is read-only and reports resource/output plan",()=>fixture(async s=>{
  const output=path.join(s.root,"preview-only"),plan=await previewDesktopInput({note:"手書きメモ",pages:"1",output},s.deps);
  assert.equal(plan.resourceCount,1);assert.equal(plan.sourceMutation,0);assert.equal(plan.ainoteWrites,0);await assert.rejects(readFile(path.join(output,"metadata.json")));
}));

test("explicit import creates a processing-ready immutable local package",()=>fixture(async s=>{
  const before=hash(await readFile(path.join(s.res,"a.png"))),output=path.join(s.root,"job"),result=await importDesktopInput({note:"手書きメモ",pages:"1",output},s.deps);
  assert.equal(result.processingReady,true);assert.equal(result.source.readOnly,true);assert.equal(result.sourceMutation,0);assert.equal(result.ainoteWrites,0);
  assert.deepEqual(result.selectedPages,[1]);assert.equal(result.generatedFiles[0].derivation,"compose-handwriting-layers");assert.equal(result.generatedFiles[0].sha256,hash(await readFile(path.join(output,"page-001.png"))));assert.equal(hash(await readFile(path.join(s.res,"a.png"))),before);
  await assert.rejects(importDesktopInput({note:"手書きメモ",pages:"1",output},s.deps),error=>error.code==="OUTPUT_EXISTS");
}));

test("multiple handwriting layers retain one canvas without crop",()=>{
  const output=composeHandwritingLayers([rgba,rgba]);assert.equal(output.readUInt32BE(16),1);assert.equal(output.readUInt32BE(20),1);assert.equal(output[25],6);
});

test("missing, malformed and ambiguous resources fail closed",()=>fixture(async s=>{
  await assert.rejects(previewDesktopInput({note:"手書きメモ",pages:"1"},{...s.deps,detail:detail("n1",["missing.png"])}),error=>error.code==="PAGE_RESOURCE_MISSING");
  await assert.rejects(previewDesktopInput({note:"手書きメモ",pages:"1"},{...s.deps,detail:{code:200,data:{note:{content:{source:"A2",pages:[{}]}}}}}),error=>error.code==="UNSUPPORTED_PAGE_STRUCTURE");
}));

test("Desktop Input package is accepted by the shared typed processing contract",()=>fixture(async s=>{
  const inputJob=path.join(s.root,"input"),result=await importDesktopInput({note:"手書きメモ",pages:"1",output:inputJob},s.deps),page=path.join(inputJob,result.generatedFiles[0].filename),extraction=path.join(s.root,"ocr.json"),job=path.join(s.root,"processing");
  await writeFile(extraction,JSON.stringify({schemaVersion:1,sourcePage:1,sourceSha256:result.generatedFiles[0].sha256,engine:"mock",provider:"mock",model:"mock",modelVersion:"1",timestamp:"2026-01-01T00:00:00Z",blocks:[{id:"t1",type:"text",text:"sample",confidence:"unknown",bbox:"unknown",position:"top",uncertain:false,description:"text"}]}));
  const prepared=await createOcrJob({input:page,extraction,output:job});assert.equal(prepared.request.original.sourceKind,"ainote-desktop");assert.equal(prepared.request.original.sourceFilename,"original-source.json");assert.equal(prepared.request.original.pageMimeType,"image/png");
  const clean=await prepareTyped({job,mode:"clean",attempt:1});assert.equal(clean.request.original.sourceKind,"ainote-desktop");
}));

test("Desktop Input remains compatible through User Notion planning and Desktop Return",()=>fixture(async s=>{
  const inputJob=path.join(s.root,"input"),imported=await importDesktopInput({note:"手書きメモ",pages:"1",output:inputJob},s.deps),page=path.join(inputJob,imported.generatedFiles[0].filename),extraction=path.join(s.root,"ocr.json"),job=path.join(s.root,"processing"),result=Buffer.concat([rgba,Buffer.from("result")]),resultFile=path.join(s.root,"result.png");
  await writeFile(extraction,JSON.stringify({schemaVersion:1,sourcePage:1,sourceSha256:imported.generatedFiles[0].sha256,engine:"mock",provider:"mock",model:"mock",modelVersion:"1",timestamp:"2026-01-01T00:00:00Z",blocks:[{id:"t1",type:"text",text:"sample",confidence:"unknown",bbox:"unknown",position:"top",uncertain:false,description:"text"}]}));await writeFile(resultFile,result);await createOcrJob({input:page,extraction,output:job});
  for(const mode of ["clean","interpreted"]){await prepareTyped({job,mode,attempt:1});await recordTyped({job,mode,attempt:1,result:resultFile,assessment:"pass",note:"mock",evidence:"mock"});}await finalizeTyped({job,cleanAttempt:1,interpretedAttempt:1});
  const config=JSON.parse(await readFile(new URL("../config/notion-user.example.json",import.meta.url),"utf8")),notion=await prepareProcessingNotionPreview({job,config,profile:"user"}),original=notion.properties.find(x=>x.field==="Original");assert.deepEqual(original.assets.map(x=>x.filename),["original-source.json","page-001.png"]);assert.equal(notion.reviewState,"Approved");
  const record={Title:"Desktop source", "Review state":"Approved", "Return target":"Use Default", Original:original.assets.map(x=>({name:x.filename,mimeType:x.mimeType})), Clean:[{name:"clean.png",mimeType:"image/png",localPath:path.join(job,"clean.png")}], Interpreted:[{name:"interpreted.png",mimeType:"image/png",localPath:path.join(job,"interpreted.png")} ]};const returned=await planDesktopReturn({record,recordDirectory:s.root,noteTitle:"Desktop source result",folderId:"folder",folderName:"AI-no-Te"});assert.equal(returned.resolvedTarget,"clean");assert.equal(returned.originalProtection.overwrite,false);
}));

test("CLI list/preview/import stay within the read-only AINOTE boundary",()=>fixture(async s=>{
  const list=await desktopInputCommand("desktop-list",["--json"],s.deps);assert.equal(list.ainoteWrites,0);assert.equal(list.notes.length,3);
  const preview=await desktopInputCommand("desktop-preview",["--note","手書きメモ","--pages","1","--json"],s.deps);assert.equal(preview.externalWrites,0);
  const result=await desktopInputCommand("desktop-import",["--note","手書きメモ","--pages","1","--output",path.join(s.root,"cli-job"),"--json"],s.deps);assert.equal(result.processingReady,true);assert.equal(result.ainoteWrites,0);
}));

test("public distribution includes Desktop Input runtime",async()=>{
  const manifest=JSON.parse(await readFile(new URL("../public-files.json",import.meta.url)));for(const file of ["src/ainote/desktop-input.mjs","tests/desktop-input.test.mjs"])assert.ok(manifest.classifications.PUBLIC.includes(file));
});
