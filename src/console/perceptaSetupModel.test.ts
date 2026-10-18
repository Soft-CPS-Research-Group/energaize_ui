import {expect,it} from 'vitest';
import {equipmentSource,type Profile} from './perceptaSetupModel';
const owner={id:'meter',name:'Meter',scope:'assets' as const};
const profile={capabilities:[{enabled:true,collection:{role:'input',source_binding:{connection_id:'source',fetch_key:'measurement-tag'}}}]} as Profile;
it('does not mistake a Cleanwatts measurement reference for an equipment identifier',()=>{
 expect(equipmentSource(owner,profile,[],[{id:'source',name:'HTTP service',provider:'cleanwatts'}])?.device_id).toBeNull();
 expect(equipmentSource(owner,profile,[],[{id:'source',name:'Device service',provider:'softcps'}])?.device_id).toBe('measurement-tag');
});
it('uses the saved equipment origin ahead of older channel assignments',()=>{
 expect(equipmentSource(owner,profile,[{asset_id:'meter',connection_id:'new',device_id:'device'}],[])).toEqual({asset_id:'meter',connection_id:'new',device_id:'device'});
});
