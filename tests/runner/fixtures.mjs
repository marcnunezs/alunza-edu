export const hiddenSentinel = 'HIDDEN_FIXTURE_MUST_NOT_APPEAR_PUBLICLY';
const one = (expected = true, args = []) => [
  { id: 'visible-1', visibility: 'visible', args, expected },
];
// These fixed programs execute only inside the student capsule, never on the host.
const processProbe = String.raw`
const fs=require('node:fs'), cp=require('node:child_process');
const children=[], errors=[];
for(let i=0;i<40;i++){
  const child=cp.spawn('/bin/sleep',['5'],{stdio:'ignore'});
  child.on('error',error=>errors.push(error.code));
  children.push(child);
}
setTimeout(()=>{
  const live=children.filter(child=>Number.isInteger(child.pid));
  const validIdentity=pid=>{
    const status=fs.readFileSync('/proc/'+pid+'/status','utf8');
    const caps=status.split('\n').filter(line=>/^Cap(Inh|Prm|Eff|Bnd|Amb):/.test(line));
    return /^Uid:\s+10001\s+10001\s+10001\s+10001$/m.test(status) && caps.length===5 && caps.every(line=>line.split(':')[1].trim()==='0000000000000000');
  };
  const result={attempted:40,started:live.length,eagain:errors.filter(error=>error==='EAGAIN').length,
    unexpectedErrors:errors.filter(error=>error!=='EAGAIN').length,
    pidsMax:Number(fs.readFileSync('/sys/fs/cgroup/pids.max','utf8')),
    pidsCurrent:Number(fs.readFileSync('/sys/fs/cgroup/pids.current','utf8')),
    uid:process.getuid(),identitiesValid:validIdentity('self')&&live.every(child=>validIdentity(child.pid))};
  for(const child of live)child.kill('SIGKILL');
  process.stdout.write(JSON.stringify(result));
},250);`;
const networkProbe = String.raw`
const dns=require('node:dns'), net=require('node:net'), dgram=require('node:dgram');
const result={loopbackOnly:Object.keys(require('node:os').networkInterfaces()).every(name=>name==='lo')};
let finished=false;
const resolver=new dns.Resolver({timeout:100,tries:1});
const tcp=net.connect({host:'2001:db8::1',port:443});
const udp=dgram.createSocket('udp4');
const finish=()=>{
  if(finished || !result.dns || !result.ipv6 || !result.udp)return;
  finished=true;clearTimeout(timer);resolver.cancel();tcp.destroy();
  try{udp.close();}catch{}
  process.stdout.write(JSON.stringify(result));
};
const note=(key,value)=>{result[key]=value;finish();};
const timer=setTimeout(()=>{for(const key of ['dns','ipv6','udp'])result[key]??='PROBE_TIMEOUT';finish();},500);
resolver.setServers(['203.0.113.1']);
resolver.resolve4('alunza-runner.invalid',error=>note('dns',error?.code??'UNEXPECTED_SUCCESS'));
tcp.on('error',error=>note('ipv6',error.code));tcp.on('connect',()=>note('ipv6','UNEXPECTED_SUCCESS'));
udp.on('error',error=>note('udp',error.code));
udp.send(Buffer.from('fixture'),9,'203.0.113.1',error=>note('udp',error?.code??'UNEXPECTED_SUCCESS'));`;
export const runnerFixtures = [
  {
    id: 'sync-json-success',
    code: 'module.exports.solve=(a,b)=>({sum:a+b});',
    tests: one({ sum: 5 }, [2, 3]),
    expected: 'SUCCESS',
  },
  {
    id: 'syntax',
    code: 'module.exports.solve=(',
    tests: one(),
    expected: 'SYNTAX_ERROR',
  },
  {
    id: 'exception',
    code: 'module.exports.solve=()=>{throw new Error("student");};',
    tests: one(),
    expected: 'RUNTIME_ERROR',
  },
  {
    id: 'assertion',
    code: 'module.exports.solve=()=>false;',
    tests: one(),
    expected: 'FAILED_TEST',
  },
  {
    id: 'infinite-loop',
    code: 'module.exports.solve=()=>{for(;;){}};',
    tests: one(),
    expected: 'TIMEOUT',
  },
  {
    id: 'blocked-event-loop',
    code: 'module.exports.solve=()=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);',
    tests: one(),
    expected: 'TIMEOUT',
  },
  {
    id: 'cumulative-budget',
    code: 'module.exports.solve=()=>{Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1700);return true;};',
    tests: [...one(), { ...one()[0], id: 'visible-2' }],
    expected: 'TIMEOUT',
  },
  {
    id: 'native-buffer-memory',
    code: 'module.exports.solve=()=>{const blocks=[];for(;;)blocks.push(Buffer.alloc(8*1024*1024,1));};',
    tests: one(),
    expected: 'UNKNOWN',
    reason: 'MEMORY_LIMIT',
  },
  {
    id: 'descendant-memory',
    code: `module.exports.solve=()=>{require('node:child_process').spawnSync(process.execPath,['-e','const a=[];for(;;)a.push(Buffer.alloc(8*1024*1024,1));'],{stdio:'ignore'});return true;};`,
    tests: one(),
    expected: 'UNKNOWN',
    reason: 'MEMORY_LIMIT',
  },
  {
    id: 'javascript-heap-memory',
    code: 'module.exports.solve=()=>{const arrays=[];for(;;)arrays.push(new Array(1024*1024).fill(1));};',
    tests: one(),
    expected: 'UNKNOWN',
    observeTermination: true,
  },
  ...[65535, 65536, 65537].map((bytes) => ({
    id: `output-${bytes}`,
    code: `module.exports.solve=()=>{require('node:fs').writeSync(1,Buffer.alloc(${bytes},120));return true;};`,
    tests: one(),
    expected: bytes > 65536 ? 'UNKNOWN' : 'SUCCESS',
    ...(bytes > 65536 ? { reason: 'OUTPUT_LIMIT' } : {}),
  })),
  {
    id: 'combined-stdout-stderr',
    code: `module.exports.solve=()=>{const fs=require('node:fs');fs.writeSync(1,Buffer.alloc(32768));fs.writeSync(2,Buffer.alloc(32769));return true;};`,
    tests: one(),
    expected: 'UNKNOWN',
    reason: 'OUTPUT_LIMIT',
  },
  {
    id: 'output-utf8',
    code: `module.exports.solve=()=>{require('node:fs').writeSync(1,'é'.repeat(32769));return true;};`,
    tests: one(),
    expected: 'UNKNOWN',
    reason: 'OUTPUT_LIMIT',
  },
  {
    id: 'return-limit',
    code: `module.exports.solve=()=>'x'.repeat(65536);`,
    tests: one(),
    expected: 'UNKNOWN',
    reason: 'RETURN_LIMIT',
  },
  {
    id: 'async-rejected',
    code: 'module.exports.solve=async()=>true;',
    tests: one(),
    expected: 'RUNTIME_ERROR',
  },
  {
    id: 'cyclic-return',
    code: 'module.exports.solve=()=>{const x={};x.x=x;return x;};',
    tests: one(),
    expected: 'RUNTIME_ERROR',
  },
  {
    id: 'process-exit-incomplete',
    code: 'module.exports.solve=()=>process.exit(0);',
    tests: one(),
    expected: 'UNKNOWN',
    reason: 'PROTOCOL_INVALID',
  },
  {
    id: 'fake-stdout-verdict',
    code: `module.exports.solve=()=>{console.log('{"passed":true,"diagnosis":"SUCCESS"}');return false;};`,
    tests: one(),
    expected: 'FAILED_TEST',
  },
  {
    id: 'fake-return-verdict',
    code: `module.exports.solve=()=>{require('node:fs').writeSync(3,'{"passed":true,"diagnosis":"SUCCESS"}');process.exit(0);};`,
    tests: one(),
    expected: 'UNKNOWN',
    reason: 'PROTOCOL_INVALID',
  },
  {
    id: 'forged-return-known-gap',
    code: `module.exports.solve=()=>{require('node:fs').writeSync(3,'{"kind":"value","value":true}');process.exit(0);};`,
    tests: one(),
    expected: 'SUCCESS',
    knownGap:
      'Return value can be forged by its producer; normal invocation authenticity is not proven.',
  },
  {
    id: 'student-zero-capabilities',
    code: String.raw`module.exports.solve=()=>{const s=require('node:fs').readFileSync('/proc/self/status','utf8');return process.getuid()===10001 && ['CapInh','CapPrm','CapEff','CapBnd','CapAmb'].every(k=>s.split('\n').some(l=>l.startsWith(k+':')&&l.split(':')[1].trim()==='0000000000000000')) && /^NoNewPrivs:\s+1$/m.test(s);};`,
    tests: one(),
    expected: 'SUCCESS',
  },
  {
    id: 'parent-control-denied',
    code: `module.exports.solve=()=>{const fs=require('node:fs');return ['/proc/1/fd/1','/proc/1/environ'].every(p=>{try{fs.readFileSync(p);return false;}catch(e){return e.code==='EACCES'||e.code==='EPERM';}});};`,
    tests: one(),
    expected: 'SUCCESS',
  },
  {
    id: 'readonly-harness',
    code: `module.exports.solve=()=>{try{require('node:fs').writeFileSync('/opt/alunza/bridge.cjs','changed');return false;}catch(e){return ['EROFS','EACCES','EPERM'].includes(e.code);}};`,
    tests: one(),
    expected: 'SUCCESS',
  },
  {
    id: 'environment-allowlist',
    code: `module.exports.solve=()=>Object.keys(process.env).sort();`,
    tests: one(['HOME', 'LANG', 'PATH']),
    expected: 'SUCCESS',
  },
  {
    id: 'network-blocked',
    code: `module.exports.solve=()=>{const r=require('node:child_process').spawnSync(process.execPath,['-e',"const s=require('node:net').connect(443,'203.0.113.1');s.on('connect',()=>process.exit(9));s.on('error',()=>process.exit(0));setTimeout(()=>process.exit(0),500);"],{timeout:800,stdio:'ignore'});return r.status===0;};`,
    tests: one(),
    expected: 'SUCCESS',
  },
  {
    id: 'bounded-processes',
    observation: 'processes',
    code: `module.exports.solve=()=>{const r=require('node:child_process').spawnSync(process.execPath,['-e',${JSON.stringify(processProbe)}],{encoding:'utf8',timeout:1500,maxBuffer:4096});if(r.status!==0)return false;const x=JSON.parse(r.stdout);console.log(JSON.stringify(x));return x.attempted===40&&x.started>0&&x.started<40&&x.started+x.eagain===40&&x.eagain>0&&x.unexpectedErrors===0&&x.pidsMax===32&&x.pidsCurrent<=32&&x.uid===10001&&x.identitiesValid;};`,
    tests: one(),
    expected: 'SUCCESS',
  },
  {
    id: 'blocked-dns-ipv6-udp',
    observation: 'network',
    code: `module.exports.solve=()=>{const r=require('node:child_process').spawnSync(process.execPath,['-e',${JSON.stringify(networkProbe)}],{encoding:'utf8',timeout:1500,maxBuffer:4096});if(r.status!==0)return false;const x=JSON.parse(r.stdout);console.log(JSON.stringify(x));const denied=['ENETUNREACH','EHOSTUNREACH','EACCES','EPERM','ECONNREFUSED'];return x.loopbackOnly&&['dns','ipv6','udp'].every(key=>denied.includes(x[key]));};`,
    tests: one(),
    expected: 'SUCCESS',
  },
  {
    id: 'case-state-isolation',
    code: `module.exports.solve=()=>{const fs=require('node:fs');const before=fs.existsSync('/tmp/student-state');fs.writeFileSync('/tmp/student-state','set');return !before;};`,
    tests: [...one(), { ...one()[0], id: 'visible-2' }],
    expected: 'SUCCESS',
  },
  {
    id: 'hidden-projection',
    mode: 'SUBMIT',
    code: 'module.exports.solve=(x)=>{console.log(x);console.error(x);return x;};',
    tests: [
      {
        id: 'hidden-secret-case',
        visibility: 'hidden',
        args: [hiddenSentinel],
        expected: hiddenSentinel,
      },
    ],
    expected: 'SUCCESS',
    privateSentinel: hiddenSentinel,
  },
];
