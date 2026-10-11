import { describe, expect, it } from 'vitest';
import { authenticateWorkspace } from './workspaceIdentity';
import { useCommunityBackendFixture } from '../test/communityBackendFixture';
import { MOCK_USERS } from '../constants';

describe('one sign-in across workspaces',()=>{
  it('preserves the Jobs account without requiring a community identity',async()=>{
    const account=MOCK_USERS['tiago.fonseca@energaize.io'];
    expect(await authenticateWorkspace('tiago.fonseca@energaize.io',account.password,true)).toMatchObject({role:'training_manager',remember:true});
  });
  it('resolves the manager and resident from current backend identities',async()=>{
    useCommunityBackendFixture();
    expect(await authenticateWorkspace(' REC@energaize.io ','rec123',false)).toMatchObject({role:'rec_manager',email:'rec@energaize.io'});
    expect(await authenticateWorkspace('prosumer@energaize.io','pros123',false)).toMatchObject({role:'prosumer',name:'Resident'});
  });
  it('does not grant manager access from the old frontend account fixture',async()=>{
    const fixture=useCommunityBackendFixture();fixture.grants.splice(0);
    await expect(authenticateWorkspace('rec@energaize.io','rec123',false)).rejects.toThrow('Invalid');
    expect(await authenticateWorkspace('rec@energaize.io','pros123',false)).toMatchObject({role:'prosumer'});
  });
  it('supports registered members beyond the old mock account list',async()=>{
    const fixture=useCommunityBackendFixture();fixture.users.push({...fixture.users[1],id:'new-member',email:'new@energaize.io'});
    expect(await authenticateWorkspace('new@energaize.io','pros123',false)).toMatchObject({role:'prosumer'});
    await expect(authenticateWorkspace('missing@energaize.io','pros123',false)).rejects.toThrow('Invalid');
  });
});
