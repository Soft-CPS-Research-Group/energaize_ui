/* Deployment is a REC Manager workspace; application settings are nested inside. */
const beforeRuntimeSite=siteDetailOriginal;
siteDetailOriginal=function(){
 if(state.tab==='percepta'||state.tab==='algorithm')state.tab='deployment';
 let html=beforeRuntimeSite();
 html=html.replace(/<button data-tab="algorithm"[^>]*>Algorithm<\/button>/,person().role==='manager'?`<button data-tab="deployment" class="${state.tab==='deployment'?'active':''}" aria-current="${state.tab==='deployment'?'page':'false'}">Deployment</button>`:'');
 html=html.replace(/<section class="surface" style="margin-top:20px"><div class="sectionhead"><h2>Site control<\/h2>[\s\S]*?<\/section>/,'');
 if(state.tab==='deployment'&&person().role==='manager'){
  const chargers=(connection.raw?.assets || []).filter(a=>a.asset_type==="ev_charger" && (a.data.site_id || a.data.site_Id)===chosen().id && (a.data.lifecycle_status || "installed")==="installed").map(a=>({id:a.id,name:a.data.name || "EV charger"}));
  const end=html.indexOf('</nav>')+6;
  html=html.slice(0,end)+`<div data-deployment-site="${esc(chosen().id)}" data-deployment-name="${esc(chosen().name)}" data-deployment-community="${esc(comm().name)}" data-deployment-chargers="${esc(JSON.stringify(chargers))}"></div></div></div>`;
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
