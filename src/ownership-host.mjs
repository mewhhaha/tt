/** ABI extension validation and scalar metrics only; ownership executes in Wasm. */
import { fail } from './core.mjs';
import { OWNED_EXPORTS } from './wasm-ownership.mjs';
export function readOwnership(module, abi) {
  const sections=WebAssembly.Module.customSections(module,'tt.ownership');
  if(!sections.length)return null;
  const bad=()=>fail(0,'invalid tt.ownership storage contract','E_WASM');
  if(sections.length!==1||sections[0].byteLength>256)bad();
  let c;try{c=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(sections[0]));}catch{bad();}
  if(!c||Array.isArray(c)||Object.keys(c).sort().join(',')!=='arena_limit,arena_start,version'||c.version!==1||
    !Number.isSafeInteger(c.arena_start)||c.arena_start%65536!==0||c.arena_start<abi.heap_start+4*1024*1024||
    c.arena_limit!==64*1024*1024||c.arena_start>=c.arena_limit)bad();
  return Object.freeze(c);
}
export function ownershipMetrics(instance) {
  const e=instance.exports;
  return {owned_live_bytes:e.owned_live_bytes(),owned_peak_bytes:e.owned_peak_bytes(),
    owned_reserved_bytes:e.owned_reserved_bytes(),owned_reuses:e.owned_reuses()};
}
export {OWNED_EXPORTS};
