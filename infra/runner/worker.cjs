// Trusted host of a fresh WASM interpreter. Student JavaScript never runs in Node.
const fs = require('node:fs');
const { performance } = require('node:perf_hooks');
const { newQuickJSWASMModuleFromVariant } = require('quickjs-emscripten-core');
const variant = require('@jitl/quickjs-wasmfile-release-sync').default;
const { assertIdentity } = require('./worker-identity.cjs');
const write = fs.writeSync.bind(fs);
let sent = false;
function complete(packet, code = 0) {
  if (sent) return;
  sent = true;
  write(3, JSON.stringify(packet));
  process.exitCode = code;
}

// Captured before the student module, reachable only through a host-owned handle.
// Do not stringify the original object: toJSON and modified intrinsics are untrusted.
const serializerSource = `((notifyLimit, isPromise) => {
  'use strict';
  const keys = Object.keys, descriptor = Object.getOwnPropertyDescriptor;
  const proto = Object.getPrototypeOf, objectProto = Object.prototype;
  const isArray = Array.isArray, finite = Number.isFinite, stringify = JSON.stringify;
  const apply = Reflect.apply, isView = ArrayBuffer.isView, tag = Symbol.toStringTag;
  const objectTag = Function.call.bind(Object.prototype.toString);
  const nativeBrands = [
    Map.prototype.has, Set.prototype.has, WeakMap.prototype.has, WeakSet.prototype.has,
    Date.prototype.getTime, descriptor(RegExp.prototype, 'source').get,
    descriptor(ArrayBuffer.prototype, 'byteLength').get,
    Number.prototype.valueOf, Boolean.prototype.valueOf, String.prototype.valueOf,
    BigInt.prototype.valueOf, Symbol.prototype.valueOf,
  ];
  if (typeof SharedArrayBuffer !== 'undefined') nativeBrands.push(descriptor(SharedArrayBuffer.prototype, 'byteLength').get);
  const nativeObject = value => {
    if (isView(value) || tag in value || objectTag(value) !== '[object Object]') return true;
    for (let index = 0; index < nativeBrands.length; index++) {
      try { apply(nativeBrands[index], value, []); return true; } catch {}
    }
    return false;
  };
  const has = Function.call.bind(Set.prototype.has), add = Function.call.bind(Set.prototype.add);
  const remove = Function.call.bind(Set.prototype.delete), SetType = Set;
  return function serialize(value) {
    const seen = new SetType();
    let length = 0;
    const append = text => {
      length += text.length;
      if (length > 65536) { notifyLimit(); throw new RangeError('return limit'); }
      return text;
    };
    const visit = (value, depth) => {
      if (depth > 256) throw new TypeError('JSON nesting');
      if (value === null || typeof value === 'string' || typeof value === 'boolean') return append(stringify(value));
      if (typeof value === 'number' && finite(value)) return append(stringify(value));
      if (typeof value !== 'object' || has(seen, value) || isPromise(value) || typeof value.then === 'function') throw new TypeError('JSON value required');
      const array = isArray(value);
      if (!array && nativeObject(value)) throw new TypeError('JSON object required');
      if (!array && proto(value) !== objectProto && proto(value) !== null) throw new TypeError('JSON object required');
      add(seen, value);
      let result = append(array ? '[' : '{');
      const names = keys(value);
      if (array && names.length !== value.length) throw new TypeError('Dense JSON array required');
      for (let index = 0; index < names.length; index++) {
        const key = names[index];
        if (array && key !== '' + index) throw new TypeError('JSON array required');
        const property = descriptor(value, key);
        if (!property || !descriptor(property, 'value')) throw new TypeError('JSON data property required');
        if (index) result += append(',');
        if (!array) result += append(stringify(key) + ':');
        result += visit(property.value, depth + 1);
      }
      remove(seen, value);
      return result + append(array ? ']' : '}');
    };
    return visit(value, 0);
  };
})`;

async function main() {
  try {
    assertIdentity();
  } catch {
    complete({ kind: 'invalid', reason: 'CAPABILITY_GAP' }, 71);
    return;
  }
  const started = performance.now();
  const input = JSON.parse(fs.readFileSync('/tmp/args.json', 'utf8'));
  const source = fs.readFileSync('/tmp/solution.cjs', 'utf8');
  const quickjs = await newQuickJSWASMModuleFromVariant(variant);
  const runtime = quickjs.newRuntime();
  runtime.setMemoryLimit(134217728);
  runtime.setMaxStackSize(1024 * 1024);
  let interrupted = false,
    outputExceeded = false,
    returnExceeded = false,
    outputBytes = 0;
  runtime.setInterruptHandler(() => {
    interrupted ||= performance.now() - started >= input.budgetMs;
    return interrupted || outputExceeded;
  });
  const vm = runtime.newContext();
  const handles = [];
  const keep = (value) => {
    handles.push(value);
    return value;
  };
  const get = (result) => {
    if (result.error) {
      result.error.dispose();
      throw new Error('Guest exception');
    }
    return keep(result.value);
  };
  let phase = 'setup';
  try {
    const serializerFactory = get(
      vm.evalCode(serializerSource, 'json-contract.js', { type: 'global' }),
    );
    const limitCallback = keep(
      vm.newFunction('returnLimit', () => {
        returnExceeded = true;
      }),
    );
    const promiseBrand = keep(
      vm.newFunction('isPromise', (value) => {
        // The FFI inspects QuickJS's internal Promise class, without invoking
        // guest getters. A non-Promise borrows the input handle: never dispose it.
        const state = vm.getPromiseState(value);
        if (state.type === 'fulfilled' && state.notAPromise) return vm.false;
        if (state.type === 'fulfilled') state.value.dispose();
        else if (state.type === 'rejected') state.error.dispose();
        return vm.true;
      }),
    );
    const serialize = get(
      vm.callFunction(
        serializerFactory,
        vm.undefined,
        limitCallback,
        promiseBrand,
      ),
    );
    const stringifyConsole = get(
      vm.evalCode(
        '(() => { const convert = String, encode = JSON.stringify; return value => encode(convert(value)); })()',
        'console.js',
        { type: 'global' },
      ),
    );
    const consoleObject = keep(vm.newObject());
    for (const [name, fd] of [
      ['log', 1],
      ['error', 2],
    ]) {
      const callback = keep(
        vm.newFunction(name, (...args) => {
          for (let index = 0; index <= args.length; index++) {
            let text;
            if (index === args.length) text = '\n';
            else {
              const converted = vm.callFunction(
                stringifyConsole,
                vm.undefined,
                args[index],
              );
              if (converted.error) return { error: converted.error };
              try {
                // QuickJS's C-string getter truncates raw U+0000. JSON transport
                // escapes it before crossing WASM; decode only in trusted Node.
                text =
                  (index ? ' ' : '') +
                  JSON.parse(vm.getString(converted.value));
              } finally {
                converted.value.dispose();
              }
            }
            const bytes = Buffer.from(text);
            const remaining = Math.max(0, input.outputRemaining - outputBytes);
            const kept = bytes.subarray(0, remaining);
            if (kept.length) write(fd, kept);
            outputBytes += kept.length;
            if (bytes.length > remaining) {
              outputExceeded = true;
              return { error: vm.newError('Output limit') };
            }
          }
        }),
      );
      vm.setProp(consoleObject, name, callback);
    }
    vm.setProp(vm.global, 'console', consoleObject);
    const moduleObject = keep(vm.newObject());
    const exportsObject = keep(vm.newObject());
    vm.setProp(moduleObject, 'exports', exportsObject);
    const functionConstructor = keep(vm.getProp(vm.global, 'Function'));
    phase = 'compile';
    const compiled = get(
      vm.callFunction(
        functionConstructor,
        vm.undefined,
        keep(vm.newString('module')),
        keep(vm.newString('exports')),
        keep(vm.newString(source)),
      ),
    );
    phase = 'invoke';
    // Parse before running the module, preserving ordinary JSON object prototypes
    // and own __proto__ keys without calling guest-modified setters or JSON.parse.
    const parse = keep(
      vm.getProp(keep(vm.getProp(vm.global, 'JSON')), 'parse'),
    );
    const argsValue = get(
      vm.callFunction(
        parse,
        vm.undefined,
        keep(vm.newString(JSON.stringify(input.args))),
      ),
    );
    const argumentsList = input.args.map((_, index) =>
      keep(vm.getProp(argsValue, index)),
    );
    get(vm.callFunction(compiled, exportsObject, moduleObject, exportsObject));
    const exported = keep(vm.getProp(moduleObject, 'exports'));
    const solve = keep(vm.getProp(exported, 'solve'));
    if (vm.typeof(solve) !== 'function') throw new Error('Missing solve');
    const value = get(vm.callFunction(solve, exported, argumentsList));
    const jsonText = get(vm.callFunction(serialize, vm.undefined, value));
    const packet = {
      kind: 'value',
      value: JSON.parse(vm.getString(jsonText)),
      invocation: 'QUICKJS_SYNC_CALL',
    };
    if (Buffer.byteLength(JSON.stringify(packet)) > 65536)
      complete({ kind: 'invalid', reason: 'RETURN_LIMIT' }, 65);
    else if (outputExceeded)
      complete({ kind: 'invalid', reason: 'OUTPUT_LIMIT' }, 65);
    else if (interrupted)
      complete({ kind: 'invalid', reason: 'EXECUTION_DEADLINE' }, 65);
    else complete(packet);
  } catch {
    if (outputExceeded)
      complete({ kind: 'invalid', reason: 'OUTPUT_LIMIT' }, 65);
    else if (interrupted)
      complete({ kind: 'invalid', reason: 'EXECUTION_DEADLINE' }, 65);
    else if (returnExceeded)
      complete({ kind: 'invalid', reason: 'RETURN_LIMIT' }, 65);
    else if (phase === 'compile') complete({ kind: 'syntax' }, 70);
    else if (phase === 'invoke') complete({ kind: 'exception' }, 70);
    else complete({ kind: 'invalid', reason: 'RUNNER_FAILURE' }, 71);
  } finally {
    for (const handle of handles.reverse()) handle.dispose();
    vm.dispose();
    runtime.dispose();
  }
}
main().catch(() => complete({ kind: 'invalid', reason: 'RUNNER_FAILURE' }, 71));
