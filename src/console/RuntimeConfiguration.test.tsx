import {render,screen} from '@testing-library/react';
import {it,expect} from 'vitest';
import {RuntimeConfiguration} from './RuntimeConfiguration';
it('shows actual exported channels and keeps the loaded state explicitly unconfirmed',()=>{
 render(<RuntimeConfiguration snapshot={{version:'one',applied:false,executable:false,channel_count:2,warnings:[],payload:{signal_catalogues:[{profiles:[{asset_id:'battery',asset_name:'Home battery',capabilities:[{name:'Power',source:'Provider A',tag:'00123',unit:'kW',sampling_interval_seconds:15},{name:'Charge command',capability_type:'actuator',source:'Controller',external_device_id:'battery-1',source_field:'setpoint',unit:'kW'}]}]}]}}}/>);
 expect(screen.getByText('Home battery')).toBeInTheDocument();expect(screen.getByText('Tag 00123')).toBeInTheDocument();expect(screen.getByText('COMMAND DESTINATION')).toBeInTheDocument();expect(screen.getByText(/not confirmation of the configuration loaded/)).toBeInTheDocument();
});
