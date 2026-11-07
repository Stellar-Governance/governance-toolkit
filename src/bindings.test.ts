import { describe, expect, it } from 'vitest';
import { Client, Error as ContractErrors, ProposalState, VoteChoice } from './contract/index.js';

const options = {
  contractId: 'CAOERDLG52UU6X5JENOXNKN4DWWJPVPNK7AD4RYXE3MA4TRBY62O5I5F',
  networkPassphrase: 'Test SDF Network ; September 2015',
  rpcUrl: 'https://soroban-testnet.stellar.org',
};

describe('generated bindings', () => {
  it('expose every contract function', () => {
    const client = new Client(options);
    const names = client.spec
      .funcs()
      .map((f) => f.name.toStringStrict())
      .sort();
    expect(names).toEqual(
      [
        '__constructor',
        'cancel',
        'cast_vote',
        'deposit',
        'deposit_of',
        'execute',
        'get_config',
        'get_proposal',
        'get_vote',
        'power_at',
        'proposal_count',
        'propose',
        'queue',
        'state',
        'token',
        'total_power_at',
        'withdraw',
      ].sort(),
    );
  });

  it('keep the numeric values of the enums and error codes', () => {
    expect(VoteChoice.For).toBe(1);
    expect(ProposalState.Executed).toBe(5);
    expect(Object.keys(ContractErrors)).toHaveLength(18);
    expect(ContractErrors[16].message).toBe('TokenFailed');
  });

  it('throw for a function the contract does not have', () => {
    expect(() => new Client(options).spec.getFunc('no_such_function')).toThrow();
  });
});
