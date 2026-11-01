import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlexibilitySelection } from './FlexibilitySelection';
import type { ChosenFlexibility, SelectionPolicy } from '../api/flexibilitySelection';

const settings = {base_window_kind:'required' as const,required_departure_time:null,default_soc_at_departure:null,default_cycle_id:null};
let policy: SelectionPolicy, result: ChosenFlexibility;
const props = {assetId:'charger-a',actorId:'alice',assetName:'EV da Ana',kind:'ev_charger',canEdit:true,from:'2026-11-01T00:00:00Z',until:'2026-11-02T00:00:00Z'};
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(()=>{
  policy={asset_id:'charger-a',revision:2,settings:{forecast_enabled:true,timezone:'Europe/Lisbon',selection:settings}};
  result={asset_id:'charger-a',policy_revision:2,computed_at:'2026-11-01T12:00:00Z',forecast_state:'usable',decision_id:null,offers:[{
    need_id:'need',asset_id:'charger-a',created_by:'alice',event_id:'event-a',occurrence_at:'2026-11-01T18:00:00Z',event_revision:3,exception_revision:1,
    session_type:'ev_charging',status:'resolved',semantics:'availability',starts_at:'2026-11-01T20:00:00Z',ends_at:'2026-11-02T07:00:00Z',
    soc_at_arrival:.4,soc_at_departure:.8,cycle:null,earliest_start:null,latest_start:null,simulated:true,execution_ready:false,
    origins:{starts_at:{source:'forecast',reference_id:'prediction',revision:1},soc_at_departure:{source:'recurrent',reference_id:'event',revision:3}},reasons:['forecast_refines_habit'],
  }]};
  fetcher=vi.fn(async(url:string,init:RequestInit={})=>{
    if(url.includes('/policy')){
      if(init.method==='PUT'){const body=JSON.parse(init.body as string);policy={...policy,revision:3,settings:body.settings};}
      return new Response(JSON.stringify(policy));
    }
    if(url.includes('/exceptions'))return new Response('{}');
    return new Response(JSON.stringify({...result,decision_id:init.method==='POST'?'recorded':null}));
  });
  vi.stubGlobal('fetch',fetcher);
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});

describe('Backend-connected flexibility selection',()=>{
  it('renders the actual backend result and provenance without choosing on the client',async()=>{
    render(<FlexibilitySelection {...props}/>);
    expect(await screen.findByText('Oferta resolvida')).toBeVisible();
    expect(screen.getByText('Objetivo à saída: 80%')).toBeVisible();
    expect(screen.getByText('Forecast · revisão 1')).toBeVisible();
    expect(screen.getByText('Inclui previsão simulada')).toBeVisible();
    expect(fetcher.mock.calls.some(([url])=>url.includes('simulated-predictions'))).toBe(false);
    expect(screen.queryByRole('button',{name:/aprovar|confirmar/i})).not.toBeInTheDocument();
  });
  it('saves explicit habit/requirement settings with concurrency protection and records backend selection',async()=>{
    const user=userEvent.setup();render(<FlexibilitySelection {...props}/>);
    await screen.findByText('Oferta resolvida');
    await user.click(screen.getByText('Hábitos e requisitos · editar'));
    await user.selectOptions(screen.getByLabelText('Significado dos horários da base'),'habitual');
    await user.type(screen.getByLabelText('Preciso do carro até às · opcional'),'07:00');
    await user.type(screen.getByLabelText('Objetivo de carga de recurso (%)'),'85');
    await user.click(screen.getByRole('button',{name:'Guardar regras e recalcular'}));
    expect(await screen.findByText('Regras guardadas. Decisão do backend registada.')).toBeVisible();
    const put=fetcher.mock.calls.find(([,init])=>init.method==='PUT')!;
    const payload=JSON.parse(put[1].body as string);
    expect(payload.expected_revision).toBe(2);
    expect(payload.settings.selection).toMatchObject({base_window_kind:'habitual',required_departure_time:'07:00',default_soc_at_departure:.85});
    expect(fetcher.mock.calls.some(([url,init])=>url.includes('/selection')&&init.method==='POST')).toBe(true);
  });
  it('manager consultation cannot save settings or change another author’s occurrence',async()=>{
    render(<FlexibilitySelection {...props} canEdit={false} actorId="manager"/>);
    await screen.findByText('Oferta resolvida');
    expect(screen.queryByRole('button',{name:'Guardar regras e recalcular'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Remover exceção e regressar à base'})).not.toBeInTheDocument();
    expect(fetcher.mock.calls.every(([,init])=>!init.method)).toBe(true);
  });
  it('a shared controller cannot edit another author’s request even when they can edit equipment rules',async()=>{
    render(<FlexibilitySelection {...props} actorId="bob"/>);
    await screen.findByText('Oferta resolvida');
    expect(screen.queryByRole('button',{name:'Declarar indisponibilidade nesta ocorrência'})).not.toBeInTheDocument();
  });
  it('distinguishes indisponibility from removing an exception and sends expected revisions',async()=>{
    const user=userEvent.setup();render(<FlexibilitySelection {...props}/>);
    await screen.findByText('Oferta resolvida');
    await user.click(screen.getByRole('button',{name:'Declarar indisponibilidade nesta ocorrência'}));
    await waitFor(()=>expect(fetcher.mock.calls.some(([,init])=>init.body&&JSON.parse(init.body as string).action==='cancel')).toBe(true));
    await user.click(await screen.findByRole('button',{name:'Remover exceção e regressar à base'}));
    await waitFor(()=>expect(fetcher.mock.calls.some(([,init])=>init.body&&JSON.parse(init.body as string).action==='restore')).toBe(true));
    const restore=fetcher.mock.calls.find(([,init])=>init.body&&JSON.parse(init.body as string).action==='restore')!;
    expect(JSON.parse(restore[1].body as string)).toMatchObject({expected_event_revision:3,expected_exception_revision:1});
  });
  it('preserves the washer programme and explains expected usage and infeasibility',async()=>{
    result.offers[0]={...result.offers[0],session_type:'appliance',status:'infeasible',semantics:'expected_usage',cycle:{id:'eco',name:'Eco',duration_minutes:90,energy_consumption_kwh:.6},reasons:['cycle_does_not_fit']};
    render(<FlexibilitySelection {...props} kind="appliance" cycles={[{id:'eco',name:'Eco'}]}/>);
    expect(await screen.findByText('Requisito inviável')).toBeVisible();
    expect(screen.getByText('Eco · 90 min · 0.6 kWh')).toBeVisible();
    expect(screen.getByText(/O ciclo não foi encurtado/)).toBeVisible();
    expect(screen.queryByLabelText(/Duração/)).not.toBeInTheDocument();
  });
  it('clears old equipment output when a new equipment read is denied',async()=>{
    const view=render(<FlexibilitySelection {...props}/>);
    await screen.findByText('Oferta resolvida');
    fetcher.mockImplementation(async()=>new Response(JSON.stringify({detail:'Sem acesso ao equipamento'}),{status:403}));
    view.rerender(<FlexibilitySelection {...props} assetId="other"/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Sem acesso');
    expect(screen.queryByText('Oferta resolvida')).not.toBeInTheDocument();
  });
});
