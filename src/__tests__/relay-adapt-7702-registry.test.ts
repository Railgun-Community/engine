import { expect } from 'chai';
import { RailgunEngine } from '../railgun-engine';

describe('RelayAdapt7702 registry address validation', () => {
  const configured = '0x5bf5b11053e734690269C6B9D438F8C9d48F528A';

  it('matches when the registry reports the same address (case-insensitive)', () => {
    expect(
      RailgunEngine.relayAdapt7702AddressMatchesRegistry(configured.toLowerCase(), configured),
    ).to.equal(true);
  });

  it('treats an absent or zero registry entry as unconfirmed (no block)', () => {
    expect(RailgunEngine.relayAdapt7702AddressMatchesRegistry(undefined, configured)).to.equal(
      true,
    );
    expect(
      RailgunEngine.relayAdapt7702AddressMatchesRegistry(`0x${'0'.repeat(40)}`, configured),
    ).to.equal(true);
  });

  it('flags a concrete mismatch (a wrong delegate must block)', () => {
    expect(
      RailgunEngine.relayAdapt7702AddressMatchesRegistry(`0x${'1'.repeat(40)}`, configured),
    ).to.equal(false);
  });
});
