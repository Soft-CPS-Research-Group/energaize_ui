/* Deployment is a REC Manager workspace; application settings are nested inside. */
const beforeRuntimeSite=siteDetailOriginal;
siteDetailOriginal=function(){
 if(state.tab==='percepta'||state.tab==='algorithm')state.tab='deployment';
 let html=beforeRuntimeSite();
 html=html.replace(/<button data-tab="algorithm"[^>]*>Algorithm<\/button>/,person().role==='manager'?`<button data-tab="deployment" class="${state.tab==='deployment'?'active':''}" aria-current="${state.tab==='deployment'?'page':'false'}">Deployment</button>`:'');
 html=html.replace(/<section class="surface" style="margin-top:20px"><div class="sectionhead"><h2>Site control<\/h2>[\s\S]*?<\/section>/,'');
 if(state.tab==='deployment'&&person().role==='manager'){
  const end=html.indexOf('</nav>')+6;
  html=html.slice(0,end)+`<div data-deployment-site="${esc(chosen().id)}" data-deployment-name="${esc(chosen().name)}"></div></div></div>`;
 }
 return html;
};

const beforeCollectionInventory=siteList;
siteList=function(){
 const html=beforeCollectionInventory();
 if(!comm().recId)return html;
 const importButton=button('Import Excel','import','upload');
 return html.replace(importButton,`<span class="community-collection-entry" data-community-collection="${esc(comm().recId)}"></span>`+importButton);
};
