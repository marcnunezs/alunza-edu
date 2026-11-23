const { execFileSync } = require('node:child_process');
const path = require('node:path');

let configuration;

beforeAll(() => {
  configuration = JSON.parse(
    execFileSync(
      process.platform === 'win32' ? 'python' : 'python3',
      [
        '-B',
        '-c',
        [
          'import importlib.util, json, sys',
          'from pathlib import Path',
          'spec = importlib.util.spec_from_file_location("boot_arguments", sys.argv[1])',
          'module = importlib.util.module_from_spec(spec)',
          'spec.loader.exec_module(module)',
          'print(json.dumps({"args": module.vm_args(Path("/supplied-kit"), "00000000-0000-4000-8000-000000000001"), "limits": module.LIMITS, "ttl": module.TTL, "operation": module.OPERATION, "cleanup": module.CLEANUP}))',
        ].join('\n'),
        path.join(__dirname, 'linux-single-execution/launch.py'),
      ],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000,
        maxBuffer: 65536,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    ),
  );
});

const values = (flag) =>
  configuration.args.flatMap((value, index) =>
    value === flag ? [configuration.args[index + 1]] : [],
  );

test('boot optimization omits only unused SATA and PS2 and keeps the serial receipt channel', () => {
  expect(values('-machine')).toEqual(['q35,sata=off,i8042=off']);
  expect(values('-serial')).toEqual(['stdio']);
  expect(values('-append')).toEqual([
    'root=/dev/vda rw rootwait rootfstype=ext4 init=/lib/systemd/systemd systemd.unit=alunza-single.target console=ttyS0,115200 panic=1 quiet systemd.show_status=error',
  ]);
  expect(values('-device')).toEqual([
    'virtio-blk-pci,drive=osdisk,serial=ALUNZAROOT',
    'nvme,id=ctrl,serial=ALUNZASINGLE',
    'nvme-ns,bus=ctrl,drive=store,nsid=1',
  ]);
  expect(values('-drive')).toEqual([
    'if=none,id=osdisk,file=os.qcow2,format=qcow2',
    'if=none,id=store,file=store.qcow2,format=qcow2',
  ]);
  expect(configuration.args).not.toContain('-initrd');
});

test('boot optimization preserves the paused KVM admission, resources, no NIC and clock limits', () => {
  expect(values('-accel')).toEqual(['kvm']);
  expect(values('-cpu')).toEqual(['host']);
  expect(values('-smp')).toEqual(['1']);
  expect(values('-m')).toEqual(['2048']);
  expect(values('-nic')).toEqual(['none']);
  expect(values('-uuid')).toEqual(['00000000-0000-4000-8000-000000000001']);
  expect(values('-smbios')).toEqual([
    'type=1,manufacturer=QEMU,product=AlunzaSingleExecution',
  ]);
  expect(values('-qmp')).toEqual(['unix:qmp.sock,server=on,wait=off']);
  expect(values('-fw_cfg')).toEqual([
    'name=opt/alunza/request,file=request.json',
  ]);
  expect(values('-rtc')).toEqual(['base=utc,clock=host']);
  for (const flag of ['-S', '-nodefaults', '-no-user-config', '-no-reboot']) {
    expect(configuration.args.filter((value) => value === flag)).toHaveLength(
      1,
    );
  }
  expect(configuration.limits).toEqual({
    vcpus: 1,
    envelopeMemoryBytes: 2147483648,
    studentMemoryBytes: 134217728,
    swapBytes: 0,
    runtimeMs: 3000,
    outputBytes: 65536,
  });
  expect([
    configuration.ttl,
    configuration.operation,
    configuration.cleanup,
  ]).toEqual([60, 30, 40]);
});
