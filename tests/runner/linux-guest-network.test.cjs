const { verifiedNetworkDenial } = require('./linux-guest-regressions.cjs');

const observed = {
  loopbackOnly: true,
  dns: 'ECONNREFUSED',
  ipv6: 'EADDRNOTAVAIL',
  udp: 'ENETUNREACH',
};
const routes = {
  interfaces: ['lo'],
  ipv4DefaultExternal: false,
  ipv6DefaultExternal: false,
};

test('an unavailable IPv6 source requires independent route and interface evidence', () => {
  expect(verifiedNetworkDenial(observed, routes)).toBe(true);
  for (const incomplete of [
    undefined,
    {},
    { ...routes, interfaces: ['lo', 'eth0'] },
    { ...routes, ipv4DefaultExternal: true },
    { ...routes, ipv6DefaultExternal: true },
  ]) {
    expect(verifiedNetworkDenial(observed, incomplete)).toBe(false);
  }
});

test.each(['dns', 'ipv6', 'udp'])(
  'a successful or inconclusive %s operation cannot attest network isolation',
  (field) => {
    for (const code of ['UNEXPECTED_SUCCESS', 'PROBE_TIMEOUT', undefined]) {
      expect(
        verifiedNetworkDenial({ ...observed, [field]: code }, routes),
      ).toBe(false);
    }
  },
);
