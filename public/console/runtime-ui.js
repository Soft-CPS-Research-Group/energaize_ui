/* Runtime is a separate backend. Jobs and worker agents do not participate. */
const beforeRuntimeSite=siteDetailOriginal;
siteDetailOriginal=function(){
 let html=beforeRuntimeSite();
 html=html.replace('<button data-tab="algorithm"',`<button data-tab="percepta" class="${state.tab==='percepta'?'active':''}">Percepta</button><button data-tab="algorithm"`);
 if(state.tab==='percepta'||state.tab==='algorithm'){
  const end=html.indexOf('</nav>')+6;
  html=html.slice(0,end)+`<div data-runtime-site="${esc(chosen().id)}" data-runtime-name="${esc(chosen().name)}" data-runtime-kind="${state.tab==='percepta'?'percepta':'controller'}"></div></div></div>`;
 }
 return html;
};
const beforeRuntimeAdmin=admin;
admin=function(){return beforeRuntimeAdmin()+`<div data-runtime-admin></div>`;};

const beforeCollectionInventory=siteList;
siteList=function(){
 const html=beforeCollectionInventory();
 if(!comm().recId)return html;
 const importButton=button('Import Excel','import','upload');
 return html.replace(importButton,`<span class="community-collection-entry" data-community-collection="${esc(comm().recId)}"></span>`+importButton);
};
