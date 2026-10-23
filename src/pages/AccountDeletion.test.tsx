import {fireEvent,render,screen} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import {AccountDeletion} from './AccountDeletion';
import {AccountDeletedPage} from './AccountDeletedPage';
import {MemoryRouter} from 'react-router-dom';
import {identity} from '../api/identityApi';
vi.mock('../api/identityApi',()=>({identity:vi.fn()}));
const call=vi.mocked(identity);
beforeEach(()=>{call.mockReset();window.location.hash='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';});
it('requires confirmation and keeps rejected deletion visible',async()=>{
 render(<AccountDeletion homes={[]} assets={[]} demo={false} onChange={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'Delete my account'}));
 const submit=screen.getByRole('button',{name:'Confirm account deletion'});expect(submit).toBeDisabled();
 fireEvent.change(screen.getByLabelText('Current password'),{target:{value:'test-password'}});
 fireEvent.change(screen.getByLabelText('Type DELETE to confirm'),{target:{value:'DELETE'}});
 call.mockRejectedValueOnce(new Error('Transfer ownership first.'));fireEvent.click(submit);
 expect(await screen.findByRole('alert')).toHaveTextContent('Transfer ownership first.');
 expect(call).toHaveBeenCalledWith('/erase','POST',{password:'test-password',confirmation:'DELETE'});
});
it('transfers only to an accepted home member and refreshes ownership',async()=>{
 const refresh=vi.fn().mockResolvedValue(undefined);
 render(<AccountDeletion homes={[{id:'home',name:'My home',candidates:[{id:'member',name:'Member'}]}]} assets={[]} demo={false} onChange={refresh}/>);
 expect(screen.queryByRole('button',{name:'Delete my account'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Transfer ownership of My home'}));
 fireEvent.change(screen.getByLabelText('New owner'),{target:{value:'member'}});
 fireEvent.change(screen.getByLabelText('Current password'),{target:{value:'test-password'}});
 fireEvent.change(screen.getByLabelText('Type TRANSFER to confirm'),{target:{value:'TRANSFER'}});
 call.mockResolvedValueOnce({message:'Ownership transferred.'});fireEvent.click(screen.getByRole('button',{name:'Confirm ownership transfer'}));
 expect(await screen.findByRole('status')).toHaveTextContent('Ownership transferred.');expect(refresh).toHaveBeenCalled();
 expect(call).toHaveBeenCalledWith('/homes/home/transfer-ownership','POST',{new_owner_id:'member',password:'test-password',confirmation:'TRANSFER'});
});
it('keeps a pending erasure pending and reports a status read failure honestly',async()=>{
 call.mockResolvedValueOnce({status:'pending',retrying:true});render(<MemoryRouter><AccountDeletedPage/></MemoryRouter>);
 expect(await screen.findByText(/retrying automatically/)).toBeInTheDocument();
 expect(screen.queryByText(/account has been deleted and/)).not.toBeInTheDocument();
 call.mockRejectedValueOnce(new Error('Status unavailable.'));fireEvent.click(screen.getByRole('button',{name:'Refresh status'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Status unavailable.');
});
