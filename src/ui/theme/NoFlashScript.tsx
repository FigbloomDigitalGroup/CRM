import { DEVICE_STORAGE_KEY, LEGACY_THEME_KEY, TEXT_SIZES } from "./resolve";

/**
 * Runs before first paint, as the first child of `.fb-app`, and applies what only this device knows: the light/dark switch and the
 * text size, bold, contrast, motion and marker modes. Without it the page would paint in the server's defaults and then jump.
 * Kept to a few plain lines on purpose (no imports, no framework) and wrapped so a blocked `localStorage` changes nothing.
 */
export const NO_FLASH_SOURCE = `(function(){try{
var el=document.currentScript&&document.currentScript.parentElement;if(!el)return;
var p={};try{p=JSON.parse(localStorage.getItem(${JSON.stringify(DEVICE_STORAGE_KEY)})||"{}")||{}}catch(e){}
var legacy=null;try{legacy=localStorage.getItem(${JSON.stringify(LEGACY_THEME_KEY)})}catch(e){}
if(!p.scheme&&(legacy==="dark"||legacy==="light"))p.scheme=legacy;
var def=el.getAttribute("data-fb-default"),scheme=def==="device"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):def;
if(el.getAttribute("data-fb-locked")!=="1"&&(p.scheme==="dark"||p.scheme==="light"))scheme=p.scheme;
el.setAttribute("data-fb-scheme",scheme);document.documentElement.setAttribute("data-theme",scheme);
el.setAttribute("data-fb-text",${JSON.stringify(TEXT_SIZES)}.indexOf(p.textSize)>=0?p.textSize:"DEFAULT");
el.setAttribute("data-fb-bold",p.bold===true?"1":"0");
el.setAttribute("data-fb-contrast",p.higherContrast===true?"1":"0");
el.setAttribute("data-fb-motion",p.reduceMotion===true?"1":"0");
el.setAttribute("data-fb-markers",p.statusMarkers===true?"1":"0");
}catch(e){}})();`;

export function NoFlashScript() {
  return <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SOURCE }} />;
}
