import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { accessSync, constants as fsConstants } from "node:fs";
import { copyFile, lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { deflateSync, inflateSync } from "node:zlib";

import { buildDesktopHelperEnv, resolveInstalledAinoteHelper } from "./desktop-return.mjs";

const MAX_IMAGE_BYTES = 100 * 1024 * 1024;
const MAX_PAGE_PIXELS = 100_000_000;
const DETAIL_ROUTE = "/note/getDetail";
const digest = value => createHash("sha256").update(value).digest("hex");
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const stableBytes = value => Buffer.from(JSON.stringify(canonical(value)));

export class DesktopInputError extends Error {
  constructor(code, message, stage = "validation") {
    super(message); this.name = "DesktopInputError"; this.code = code; this.stage = stage;
  }
}

function safeTitle(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 300 || /[\u0000-\u001f]/u.test(value)) {
    throw new DesktopInputError("INVALID_NOTE_TITLE", "AINOTE note title is missing or unsafe.");
  }
  return value.trim();
}

function appData(source = process.env) {
  return path.resolve(source.AINOTE_APP_DATA?.trim()
    || path.join(source.APPDATA?.trim() || path.join(os.homedir(), "AppData", "Roaming"), "AINOTE"));
}

export async function discoverDesktopDataRoot(source = process.env) {
  const base = path.join(appData(source), "data");
  const entries = await readdir(base, { withFileTypes: true }).catch(() => []);
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(base, entry.name);
    const db = await lstat(path.join(candidate, "db.json")).catch(() => null);
    const dirs = await lstat(path.join(candidate, "dir.json")).catch(() => null);
    if (db?.isFile() && !db.isSymbolicLink() && dirs?.isFile() && !dirs.isSymbolicLink()) candidates.push(candidate);
  }
  if (candidates.length !== 1) throw new DesktopInputError("DESKTOP_DATA_ROOT_AMBIGUOUS", "AINOTE Desktop data root is missing or not unique.", "data_root");
  return realpath(candidates[0]);
}

async function jsonFile(file, limit = 32 * 1024 * 1024) {
  const info = await lstat(file).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink() || info.size > limit) throw new DesktopInputError("MALFORMED_DESKTOP_DATA", "AINOTE Desktop metadata is missing or unsafe.");
  try { return JSON.parse(await readFile(file, "utf8")); } catch { throw new DesktopInputError("MALFORMED_DESKTOP_DATA", "AINOTE Desktop metadata is not valid JSON."); }
}

export function catalogFromDatabase(database) {
  if (!database || !Array.isArray(database.list)) throw new DesktopInputError("MALFORMED_DESKTOP_DATA", "AINOTE note database is malformed.");
  const records = database.list.filter(item => item && [1, 20].includes(Number(item.type))
    && Number(item.isDel ?? 0) === 0 && Number(item.appDel ?? 0) === 0 && typeof item.noteId === "string"
    && /^[A-Za-z0-9._-]{1,200}$/.test(item.noteId) && ![".", ".."].includes(item.noteId));
  records.sort((a, b) => String(a.noteName ?? "").localeCompare(String(b.noteName ?? ""), "ja") || a.noteId.localeCompare(b.noteId));
  return records.map((item, index) => Object.freeze({
    alias: `note-${String(index + 1).padStart(3, "0")}`, title: safeTitle(item.noteName), type: Number(item.type),
    noteId: item.noteId, recordSha256: digest(stableBytes(item)),
  }));
}

export function selectDesktopNote(catalog, selector) {
  if (!Array.isArray(catalog) || !catalog.length) throw new DesktopInputError("NOTE_NOT_FOUND", "No supported AINOTE Desktop notes are available.");
  if (typeof selector !== "string" || !selector.trim()) throw new DesktopInputError("NOTE_SELECTION_REQUIRED", "--note requires a listed alias or exact title.");
  const query = selector.trim();
  const byAlias = catalog.filter(note => note.alias === query);
  const matches = byAlias.length ? byAlias : catalog.filter(note => note.title === query);
  if (matches.length !== 1) throw new DesktopInputError(matches.length ? "AMBIGUOUS_NOTE" : "NOTE_NOT_FOUND", matches.length ? "AINOTE note title is ambiguous; use its listed alias." : "Selected AINOTE note was not found.");
  return matches[0];
}

export function parseDesktopPages(value, count) {
  if (!Number.isInteger(count) || count < 1 || count > 500) throw new DesktopInputError("UNSUPPORTED_NOTE_STRUCTURE", "AINOTE note has an invalid page count.");
  if (value === "all") return Array.from({ length: count }, (_, index) => index + 1);
  if (typeof value !== "string" || !value.trim()) throw new DesktopInputError("PAGE_SELECTION_REQUIRED", "--pages requires all, a page number, list, or range.");
  const pages = new Set();
  for (const token of value.split(",")) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(token.trim());
    if (!match) throw new DesktopInputError("INVALID_PAGE_SELECTION", "Invalid page selection.");
    const first = Number(match[1]), last = Number(match[2] ?? match[1]);
    if (first < 1 || last > count || first > last) throw new DesktopInputError("INVALID_PAGE_SELECTION", `Page selection must be within 1..${count}.`);
    for (let page = first; page <= last; page++) pages.add(page);
  }
  return [...pages].sort((a, b) => a - b);
}

function pythonCommand(source = process.env) { return source.AINOTE_PYTHON?.trim() || (process.platform === "win32" ? "python" : "python3"); }
function requestDetail(noteId, { helperPath, env = process.env, spawn = spawnSync } = {}) {
  const helper = helperPath ?? resolveInstalledAinoteHelper(env);
  const result = spawn(pythonCommand(env), [helper, "--url", `http://127.0.0.1:46588${DETAIL_ROUTE}?noteId=${encodeURIComponent(noteId)}`, "--method", "GET", "--no-auto-start"], {
    encoding: "utf8", windowsHide: true, timeout: 30_000, env: buildDesktopHelperEnv(env),
  });
  if (result.error || result.status !== 0) throw new DesktopInputError("DESKTOP_READ_FAILED", "AINOTE Desktop detail read failed.", "detail");
  let response; try { response = JSON.parse(result.stdout.trim()); } catch { throw new DesktopInputError("MALFORMED_DESKTOP_RESPONSE", "AINOTE Desktop detail response was not JSON.", "detail"); }
  if (response?.code !== 200) throw new DesktopInputError("DESKTOP_READ_FAILED", "AINOTE Desktop rejected the read-only detail request.", "detail");
  return response;
}

function pageList(note, detail) {
  const content = detail?.data?.note?.content;
  if (!content || content.source !== "A2") throw new DesktopInputError("UNSUPPORTED_NOTE_STRUCTURE", "Selected note is not a supported AINOTE Desktop A2 note.");
  const pages = note.type === 1 ? content.pageInfoList : content.pages;
  if (!Array.isArray(pages) || !pages.length || pages.length > 500) throw new DesktopInputError("UNSUPPORTED_NOTE_STRUCTURE", "Selected note page structure is unavailable.");
  return pages;
}

async function resource(dataRoot, noteId, value) {
  if (typeof value !== "string" || !value || path.basename(value) !== value) throw new DesktopInputError("MALFORMED_PAGE_RELATION", "AINOTE page resource relation is malformed.");
  const noteDirectory = path.join(dataRoot, noteId);
  const file = path.resolve(noteDirectory, "res", value);
  const prefix = `${path.resolve(noteDirectory, "res")}${path.sep}`.toLowerCase();
  if (!file.toLowerCase().startsWith(prefix)) throw new DesktopInputError("MALFORMED_PAGE_RELATION", "AINOTE page resource escaped its note directory.");
  const info = await lstat(file).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink() || info.size < 24 || info.size > MAX_IMAGE_BYTES) throw new DesktopInputError("PAGE_RESOURCE_MISSING", "Selected page resource is missing or unsafe.");
  const bytes = await readFile(file);
  return { file, bytes, sha256: digest(bytes), extension: path.extname(value).toLowerCase() };
}

function pngHeader(bytes) {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || bytes.toString("ascii", 12, 16) !== "IHDR") throw new DesktopInputError("MALFORMED_PAGE_IMAGE", "AINOTE page PNG is invalid.");
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height || width * height > MAX_PAGE_PIXELS) throw new DesktopInputError("MALFORMED_PAGE_IMAGE", "AINOTE page PNG dimensions are invalid.");
  return { width, height, bitDepth: bytes[24], colorType: bytes[25], interlace: bytes[28] };
}

function jpegHeader(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new DesktopInputError("MALFORMED_PAGE_IMAGE", "AINOTE page JPEG is invalid.");
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset++; continue; }
    const marker = bytes[offset + 1], length = bytes.readUInt16BE(offset + 2);
    if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
      const height = bytes.readUInt16BE(offset + 5), width = bytes.readUInt16BE(offset + 7);
      if (!width || !height || width * height > MAX_PAGE_PIXELS) break;
      return { width, height };
    }
    if (!length || length < 2) break; offset += 2 + length;
  }
  throw new DesktopInputError("MALFORMED_PAGE_IMAGE", "AINOTE page JPEG dimensions are unavailable.");
}

function paeth(a, b, c) { const p=a+b-c, pa=Math.abs(p-a), pb=Math.abs(p-b), pc=Math.abs(p-c); return pa<=pb&&pa<=pc?a:pb<=pc?b:c; }
function decodeRgba(bytes) {
  const info = pngHeader(bytes);
  if (info.bitDepth !== 8 || info.colorType !== 6 || info.interlace !== 0) throw new DesktopInputError("UNSUPPORTED_PAGE_LAYER", "Handwriting PNG layers must be non-interlaced 8-bit RGBA.");
  const chunks=[]; for(let o=8;o+12<=bytes.length;){const n=bytes.readUInt32BE(o),type=bytes.toString("ascii",o+4,o+8);if(type==="IDAT")chunks.push(bytes.subarray(o+8,o+8+n));o+=12+n;if(type==="IEND")break;}
  const raw=inflateSync(Buffer.concat(chunks)), stride=info.width*4, pixels=Buffer.alloc(stride*info.height); let input=0;
  if(raw.length!==info.height*(stride+1))throw new DesktopInputError("MALFORMED_PAGE_IMAGE","Handwriting PNG data length is invalid.");
  for(let y=0;y<info.height;y++){const filter=raw[input++];for(let x=0;x<stride;x++){const v=raw[input++],left=x>=4?pixels[y*stride+x-4]:0,up=y?pixels[(y-1)*stride+x]:0,ul=y&&x>=4?pixels[(y-1)*stride+x-4]:0;const add=filter===0?0:filter===1?left:filter===2?up:filter===3?Math.floor((left+up)/2):filter===4?paeth(left,up,ul):NaN;if(Number.isNaN(add))throw new DesktopInputError("MALFORMED_PAGE_IMAGE","Unsupported PNG filter.");pixels[y*stride+x]=(v+add)&255;}}
  return { ...info, pixels };
}

let crcTable;
function crc32(bytes){crcTable??=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;});let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
function chunk(type,data){const name=Buffer.from(type),out=Buffer.alloc(12+data.length);out.writeUInt32BE(data.length,0);name.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc32(Buffer.concat([name,data])),8+data.length);return out;}
function encodeRgba(width,height,pixels){const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;const raw=Buffer.alloc(height*(1+width*4));for(let y=0;y<height;y++){const o=y*(1+width*4);raw[o]=0;pixels.copy(raw,o+1,y*width*4,(y+1)*width*4);}return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ihdr),chunk("IDAT",deflateSync(raw,{level:9})),chunk("IEND",Buffer.alloc(0))]);}

export function composeHandwritingLayers(layerBytes) {
  if (!Array.isArray(layerBytes) || !layerBytes.length) throw new DesktopInputError("PAGE_RESOURCE_MISSING", "No handwriting layer is available.");
  const layers=layerBytes.map(decodeRgba), {width,height}=layers[0];
  if(layers.some(x=>x.width!==width||x.height!==height))throw new DesktopInputError("CONFLICTING_PAGE_LAYERS","Handwriting layers use different canvas sizes.");
  const out=Buffer.alloc(width*height*4,255);
  for(const layer of layers)for(let i=0;i<out.length;i+=4){const a=layer.pixels[i+3]/255,ia=1-a;out[i]=Math.round(layer.pixels[i]*a+out[i]*ia);out[i+1]=Math.round(layer.pixels[i+1]*a+out[i+1]*ia);out[i+2]=Math.round(layer.pixels[i+2]*a+out[i+2]*ia);out[i+3]=255;}
  return encodeRgba(width,height,out);
}

async function pagePlan(note, page, pageNumber, dataRoot) {
  let values=[]; let mode="copy";
  if(note.type===20){
    values=Object.entries(page?.hwSrc??{}).filter(([key,value])=>/^\d+_hw\.png$/i.test(key)&&typeof value==="string").sort(([a],[b])=>a.localeCompare(b,undefined,{numeric:true})).map(([,value])=>value);
    if(values.length)mode="compose-handwriting-layers";
    else { const attached=Object.values(page?.attachmentSrc??{}).filter(value=>typeof value==="string"&&/\.(?:png|jpe?g)$/i.test(value)); const snapshots=Object.values(page?.src??{}).filter(value=>typeof value==="string"&&/\.(?:png|jpe?g)$/i.test(value)); values=attached.length===1?attached:snapshots.length===1?snapshots:[]; }
  } else values=Object.values(page?.src??{}).filter(value=>typeof value==="string"&&/\.(?:png|jpe?g)$/i.test(value));
  if(!values.length)throw new DesktopInputError("UNSUPPORTED_PAGE_STRUCTURE",`Page ${pageNumber} has no unambiguous full-page image resource.`);
  if(mode==="copy"&&values.length!==1)throw new DesktopInputError("MALFORMED_PAGE_RELATION",`Page ${pageNumber} resolves to multiple full-page images.`);
  const resources=[];for(const value of values)resources.push(await resource(dataRoot,note.noteId,value));
  const outputBytes=mode==="compose-handwriting-layers"?composeHandwritingLayers(resources.map(x=>x.bytes)):resources[0].bytes;
  const png=/\.png$/i.test(mode==="copy"?resources[0].extension:".png");const dimensions=png?pngHeader(outputBytes):jpegHeader(outputBytes);
  return {pageNumber,mode,resources,outputBytes,width:dimensions.width,height:dimensions.height,extension:png?".png":".jpeg",mimeType:png?"image/png":"image/jpeg"};
}

async function context(options={},dependencies={}){
  const env=dependencies.env??process.env,dataRoot=dependencies.dataRoot??await discoverDesktopDataRoot(env),database=dependencies.database??await jsonFile(path.join(dataRoot,"db.json")),catalog=catalogFromDatabase(database);
  if(!options.note)return{env,dataRoot,database,catalog};const note=selectDesktopNote(catalog,options.note),detail=dependencies.detail??(dependencies.requestDetail??requestDetail)(note.noteId,{helperPath:dependencies.helperPath,env,spawn:dependencies.spawn}),pages=pageList(note,detail),selectedPages=parseDesktopPages(options.pages??"all",pages.length),plans=[];
  for(const number of selectedPages)plans.push(await pagePlan(note,pages[number-1],number,dataRoot));
  return{env,dataRoot,database,catalog,note,detail,pages,selectedPages,plans};
}

export async function previewDesktopInput(options={},dependencies={}){
  const c=await context(options,dependencies);if(!c.note)throw new DesktopInputError("NOTE_SELECTION_REQUIRED","Preview requires --note.");
  return Object.freeze({mode:"experimental-desktop-input-preview",title:c.note.title,noteType:c.note.type,pageCount:c.pages.length,selectedPages:c.selectedPages,resourceCount:c.plans.reduce((n,p)=>n+p.resources.length,0),plannedOutput:options.output?path.resolve(options.output):"new local job directory required for import",sourceMutation:0,ainoteWrites:0,externalWrites:0,experimental:true});
}

export async function importDesktopInput(options={},dependencies={}){
  if(typeof options.output!=="string"||!options.output.trim())throw new DesktopInputError("OUTPUT_REQUIRED","desktop-import requires a new --output directory.");
  const output=path.resolve(options.output);if(await lstat(output).catch(()=>null))throw new DesktopInputError("OUTPUT_EXISTS","Output already exists; choose a new directory.");
  const c=await context(options,dependencies);await mkdir(output,{mode:0o700});
  try{const generated=[];for(const plan of c.plans){const filename=`page-${String(plan.pageNumber).padStart(3,"0")}${plan.extension}`;await writeFile(path.join(output,filename),plan.outputBytes,{flag:"wx",mode:0o600});generated.push({pageNumber:plan.pageNumber,filename,mimeType:plan.mimeType,width:plan.width,height:plan.height,sha256:digest(plan.outputBytes),derivation:plan.mode,sourceResources:plan.resources.map(r=>({sha256:r.sha256,bytes:r.bytes.length}))});for(const r of plan.resources)if(digest(await readFile(r.file))!==r.sha256)throw new DesktopInputError("SOURCE_CHANGED","AINOTE source resource changed during import.");}
    const metadata={schemaVersion:2,status:"complete",source:{kind:"ainote-desktop",title:c.note.title,noteType:c.note.type,pageCount:c.pages.length,noteSha256:c.note.recordSha256,detailSha256:digest(stableBytes(c.detail)),readOnly:true,undocumented:true,versionDependent:true},selectedPages:c.selectedPages,generatedFiles:generated,createdAt:new Date().toISOString(),sourceMutation:0,ainoteWrites:0};
    await writeFile(path.join(output,"metadata.json"),`${JSON.stringify(metadata,null,2)}\n`,{flag:"wx",mode:0o600});return{...metadata,outputDirectory:output,processingReady:true};
  }catch(error){await writeFile(path.join(output,"failure.json"),`${JSON.stringify({status:"incomplete",message:error.message},null,2)}\n`,{flag:"wx",mode:0o600}).catch(()=>{});throw error;}
}

function option(args,name){const i=args.indexOf(name);if(i<0)return undefined;const value=args[i+1];if(!value||value.startsWith("--"))throw new DesktopInputError("INVALID_OPTION",`${name} requires a value.`);return value;}
export async function desktopInputCommand(action,args=[],dependencies={}){
  if(!["desktop-list","desktop-preview","desktop-import"].includes(action))throw new DesktopInputError("UNKNOWN_COMMAND","Use input desktop-list, desktop-preview, or desktop-import.");
  const allowed=new Set(["--note","--pages","--output","--json"]);for(let i=0;i<args.length;i++){if(!allowed.has(args[i]))throw new DesktopInputError("INVALID_OPTION",`Unknown input option: ${args[i]}`);if(args[i]!=="--json")i++;}
  if(action==="desktop-list"){const c=await context({},dependencies);const result={mode:"experimental-desktop-input-list",notes:c.catalog.map(({alias,title,type})=>({alias,title,type})),sourceMutation:0,ainoteWrites:0};return args.includes("--json")?result:["EXPERIMENTAL DESKTOP INPUT — READ ONLY","",...result.notes.map(n=>`${n.alias}  ${n.title}  (type ${n.type})`),"","AINOTE write: 0"].join("\n");}
  const options={note:option(args,"--note"),pages:option(args,"--pages")??"all",output:option(args,"--output")};const result=action==="desktop-preview"?await previewDesktopInput(options,dependencies):await importDesktopInput(options,dependencies);if(args.includes("--json"))return result;
  if(action==="desktop-preview")return["EXPERIMENTAL DESKTOP INPUT PREVIEW — READ ONLY","",`Note: ${result.title}`,`Pages: ${result.selectedPages.join(", ")} / ${result.pageCount}`,`Resources: ${result.resourceCount}`,`Planned local output: ${result.plannedOutput}`,"Original mutation: 0","AINOTE write: 0"].join("\n");
  return["EXPERIMENTAL DESKTOP INPUT — LOCAL IMPORT COMPLETE","",`Note: ${result.source.title}`,`Pages: ${result.selectedPages.join(", ")}`,`Output: ${result.outputDirectory}`,"Processing-ready: YES","Original mutation: 0","AINOTE write: 0"].join("\n");
}
