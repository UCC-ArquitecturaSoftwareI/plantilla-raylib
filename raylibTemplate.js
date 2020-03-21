// Copyright 2010 The Emscripten Authors.  All rights reserved.
// Emscripten is available under two separate licenses, the MIT license and the
// University of Illinois/NCSA Open Source License.  Both these licenses can be
// found in the LICENSE file.

// The Module object: Our interface to the outside world. We import
// and export values on it. There are various ways Module can be used:
// 1. Not defined. We create it here
// 2. A function parameter, function(Module) { ..generated code.. }
// 3. pre-run appended it, var Module = {}; ..generated code..
// 4. External script tag defines var Module.
// We need to check if Module already exists (e.g. case 3 above).
// Substitution will be replaced with actual code on later stage of the build,
// this way Closure Compiler will not mangle it (e.g. case 4. above).
// Note that if you want to run closure, and also to use Module
// after the generated code, you will need to define   var Module = {};
// before the code. Then that object will be used in the code, and you
// can continue to use Module afterwards as well.
var Module = typeof Module !== 'undefined' ? Module : {};

// --pre-jses are emitted after the Module integration code, so that they can
// refer to Module (if they choose; they can also define Module)
// {{PRE_JSES}}

// Sometimes an existing Module object exists with properties
// meant to overwrite the default module functionality. Here
// we collect those properties and reapply _after_ we configure
// the current environment's defaults to avoid having to be so
// defensive during initialization.
var moduleOverrides = {};
var key;
for (key in Module) {
  if (Module.hasOwnProperty(key)) {
    moduleOverrides[key] = Module[key];
  }
}

var arguments_ = [];
var thisProgram = './this.program';
var quit_ = function(status, toThrow) {
  throw toThrow;
};

// Determine the runtime environment we are in. You can customize this by
// setting the ENVIRONMENT setting at compile time (see settings.js).

var ENVIRONMENT_IS_WEB = false;
var ENVIRONMENT_IS_WORKER = false;
var ENVIRONMENT_IS_NODE = false;
var ENVIRONMENT_HAS_NODE = false;
var ENVIRONMENT_IS_SHELL = false;
ENVIRONMENT_IS_WEB = typeof window === 'object';
ENVIRONMENT_IS_WORKER = typeof importScripts === 'function';
// A web environment like Electron.js can have Node enabled, so we must
// distinguish between Node-enabled environments and Node environments per se.
// This will allow the former to do things like mount NODEFS.
// Extended check using process.versions fixes issue #8816.
// (Also makes redundant the original check that 'require' is a function.)
ENVIRONMENT_HAS_NODE = typeof process === 'object' && typeof process.versions === 'object' && typeof process.versions.node === 'string';
ENVIRONMENT_IS_NODE = ENVIRONMENT_HAS_NODE && !ENVIRONMENT_IS_WEB && !ENVIRONMENT_IS_WORKER;
ENVIRONMENT_IS_SHELL = !ENVIRONMENT_IS_WEB && !ENVIRONMENT_IS_NODE && !ENVIRONMENT_IS_WORKER;

if (Module['ENVIRONMENT']) {
  throw new Error('Module.ENVIRONMENT has been deprecated. To force the environment, use the ENVIRONMENT compile-time option (for example, -s ENVIRONMENT=web or -s ENVIRONMENT=node)');
}



// `/` should be present at the end if `scriptDirectory` is not empty
var scriptDirectory = '';
function locateFile(path) {
  if (Module['locateFile']) {
    return Module['locateFile'](path, scriptDirectory);
  }
  return scriptDirectory + path;
}

// Hooks that are implemented differently in different runtime environments.
var read_,
    readAsync,
    readBinary,
    setWindowTitle;

var nodeFS;
var nodePath;

if (ENVIRONMENT_IS_NODE) {
  scriptDirectory = __dirname + '/';


  read_ = function shell_read(filename, binary) {
    if (!nodeFS) nodeFS = require('fs');
    if (!nodePath) nodePath = require('path');
    filename = nodePath['normalize'](filename);
    return nodeFS['readFileSync'](filename, binary ? null : 'utf8');
  };

  readBinary = function readBinary(filename) {
    var ret = read_(filename, true);
    if (!ret.buffer) {
      ret = new Uint8Array(ret);
    }
    assert(ret.buffer);
    return ret;
  };




  if (process['argv'].length > 1) {
    thisProgram = process['argv'][1].replace(/\\/g, '/');
  }

  arguments_ = process['argv'].slice(2);

  if (typeof module !== 'undefined') {
    module['exports'] = Module;
  }

  process['on']('uncaughtException', function(ex) {
    // suppress ExitStatus exceptions from showing an error
    if (!(ex instanceof ExitStatus)) {
      throw ex;
    }
  });

  process['on']('unhandledRejection', abort);

  quit_ = function(status) {
    process['exit'](status);
  };

  Module['inspect'] = function () { return '[Emscripten Module object]'; };


} else
if (ENVIRONMENT_IS_SHELL) {


  if (typeof read != 'undefined') {
    read_ = function shell_read(f) {
      return read(f);
    };
  }

  readBinary = function readBinary(f) {
    var data;
    if (typeof readbuffer === 'function') {
      return new Uint8Array(readbuffer(f));
    }
    data = read(f, 'binary');
    assert(typeof data === 'object');
    return data;
  };

  if (typeof scriptArgs != 'undefined') {
    arguments_ = scriptArgs;
  } else if (typeof arguments != 'undefined') {
    arguments_ = arguments;
  }

  if (typeof quit === 'function') {
    quit_ = function(status) {
      quit(status);
    };
  }

  if (typeof print !== 'undefined') {
    // Prefer to use print/printErr where they exist, as they usually work better.
    if (typeof console === 'undefined') console = {};
    console.log = print;
    console.warn = console.error = typeof printErr !== 'undefined' ? printErr : print;
  }
} else

// Note that this includes Node.js workers when relevant (pthreads is enabled).
// Node.js workers are detected as a combination of ENVIRONMENT_IS_WORKER and
// ENVIRONMENT_HAS_NODE.
if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
  if (ENVIRONMENT_IS_WORKER) { // Check worker, not web, since window could be polyfilled
    scriptDirectory = self.location.href;
  } else if (document.currentScript) { // web
    scriptDirectory = document.currentScript.src;
  }
  // blob urls look like blob:http://site.com/etc/etc and we cannot infer anything from them.
  // otherwise, slice off the final part of the url to find the script directory.
  // if scriptDirectory does not contain a slash, lastIndexOf will return -1,
  // and scriptDirectory will correctly be replaced with an empty string.
  if (scriptDirectory.indexOf('blob:') !== 0) {
    scriptDirectory = scriptDirectory.substr(0, scriptDirectory.lastIndexOf('/')+1);
  } else {
    scriptDirectory = '';
  }


  // Differentiate the Web Worker from the Node Worker case, as reading must
  // be done differently.
  {


  read_ = function shell_read(url) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, false);
      xhr.send(null);
      return xhr.responseText;
  };

  if (ENVIRONMENT_IS_WORKER) {
    readBinary = function readBinary(url) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, false);
        xhr.responseType = 'arraybuffer';
        xhr.send(null);
        return new Uint8Array(xhr.response);
    };
  }

  readAsync = function readAsync(url, onload, onerror) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'arraybuffer';
    xhr.onload = function xhr_onload() {
      if (xhr.status == 200 || (xhr.status == 0 && xhr.response)) { // file URLs can return 0
        onload(xhr.response);
        return;
      }
      onerror();
    };
    xhr.onerror = onerror;
    xhr.send(null);
  };




  }

  setWindowTitle = function(title) { document.title = title };
} else
{
  throw new Error('environment detection error');
}


// Set up the out() and err() hooks, which are how we can print to stdout or
// stderr, respectively.
var out = Module['print'] || console.log.bind(console);
var err = Module['printErr'] || console.warn.bind(console);

// Merge back in the overrides
for (key in moduleOverrides) {
  if (moduleOverrides.hasOwnProperty(key)) {
    Module[key] = moduleOverrides[key];
  }
}
// Free the object hierarchy contained in the overrides, this lets the GC
// reclaim data used e.g. in memoryInitializerRequest, which is a large typed array.
moduleOverrides = null;

// Emit code to handle expected values on the Module object. This applies Module.x
// to the proper local x. This has two benefits: first, we only emit it if it is
// expected to arrive, and second, by using a local everywhere else that can be
// minified.
if (Module['arguments']) arguments_ = Module['arguments'];if (!Object.getOwnPropertyDescriptor(Module, 'arguments')) Object.defineProperty(Module, 'arguments', { configurable: true, get: function() { abort('Module.arguments has been replaced with plain arguments_') } });
if (Module['thisProgram']) thisProgram = Module['thisProgram'];if (!Object.getOwnPropertyDescriptor(Module, 'thisProgram')) Object.defineProperty(Module, 'thisProgram', { configurable: true, get: function() { abort('Module.thisProgram has been replaced with plain thisProgram') } });
if (Module['quit']) quit_ = Module['quit'];if (!Object.getOwnPropertyDescriptor(Module, 'quit')) Object.defineProperty(Module, 'quit', { configurable: true, get: function() { abort('Module.quit has been replaced with plain quit_') } });

// perform assertions in shell.js after we set up out() and err(), as otherwise if an assertion fails it cannot print the message
// Assertions on removed incoming Module JS APIs.
assert(typeof Module['memoryInitializerPrefixURL'] === 'undefined', 'Module.memoryInitializerPrefixURL option was removed, use Module.locateFile instead');
assert(typeof Module['pthreadMainPrefixURL'] === 'undefined', 'Module.pthreadMainPrefixURL option was removed, use Module.locateFile instead');
assert(typeof Module['cdInitializerPrefixURL'] === 'undefined', 'Module.cdInitializerPrefixURL option was removed, use Module.locateFile instead');
assert(typeof Module['filePackagePrefixURL'] === 'undefined', 'Module.filePackagePrefixURL option was removed, use Module.locateFile instead');
assert(typeof Module['read'] === 'undefined', 'Module.read option was removed (modify read_ in JS)');
assert(typeof Module['readAsync'] === 'undefined', 'Module.readAsync option was removed (modify readAsync in JS)');
assert(typeof Module['readBinary'] === 'undefined', 'Module.readBinary option was removed (modify readBinary in JS)');
assert(typeof Module['setWindowTitle'] === 'undefined', 'Module.setWindowTitle option was removed (modify setWindowTitle in JS)');
if (!Object.getOwnPropertyDescriptor(Module, 'read')) Object.defineProperty(Module, 'read', { configurable: true, get: function() { abort('Module.read has been replaced with plain read_') } });
if (!Object.getOwnPropertyDescriptor(Module, 'readAsync')) Object.defineProperty(Module, 'readAsync', { configurable: true, get: function() { abort('Module.readAsync has been replaced with plain readAsync') } });
if (!Object.getOwnPropertyDescriptor(Module, 'readBinary')) Object.defineProperty(Module, 'readBinary', { configurable: true, get: function() { abort('Module.readBinary has been replaced with plain readBinary') } });
// TODO: add when SDL2 is fixed if (!Object.getOwnPropertyDescriptor(Module, 'setWindowTitle')) Object.defineProperty(Module, 'setWindowTitle', { configurable: true, get: function() { abort('Module.setWindowTitle has been replaced with plain setWindowTitle') } });
var IDBFS = 'IDBFS is no longer included by default; build with -lidbfs.js';
var PROXYFS = 'PROXYFS is no longer included by default; build with -lproxyfs.js';
var WORKERFS = 'WORKERFS is no longer included by default; build with -lworkerfs.js';
var NODEFS = 'NODEFS is no longer included by default; build with -lnodefs.js';


// TODO remove when SDL2 is fixed (also see above)



// Copyright 2017 The Emscripten Authors.  All rights reserved.
// Emscripten is available under two separate licenses, the MIT license and the
// University of Illinois/NCSA Open Source License.  Both these licenses can be
// found in the LICENSE file.

// {{PREAMBLE_ADDITIONS}}

var STACK_ALIGN = 16;

// stack management, and other functionality that is provided by the compiled code,
// should not be used before it is ready
stackSave = stackRestore = stackAlloc = function() {
  abort('cannot use the stack before compiled code is ready to run, and has provided stack access');
};

function staticAlloc(size) {
  abort('staticAlloc is no longer available at runtime; instead, perform static allocations at compile time (using makeStaticAlloc)');
}

function dynamicAlloc(size) {
  assert(DYNAMICTOP_PTR);
  var ret = HEAP32[DYNAMICTOP_PTR>>2];
  var end = (ret + size + 15) & -16;
  if (end > _emscripten_get_heap_size()) {
    abort('failure to dynamicAlloc - memory growth etc. is not supported there, call malloc/sbrk directly');
  }
  HEAP32[DYNAMICTOP_PTR>>2] = end;
  return ret;
}

function alignMemory(size, factor) {
  if (!factor) factor = STACK_ALIGN; // stack alignment (16-byte) by default
  return Math.ceil(size / factor) * factor;
}

function getNativeTypeSize(type) {
  switch (type) {
    case 'i1': case 'i8': return 1;
    case 'i16': return 2;
    case 'i32': return 4;
    case 'i64': return 8;
    case 'float': return 4;
    case 'double': return 8;
    default: {
      if (type[type.length-1] === '*') {
        return 4; // A pointer
      } else if (type[0] === 'i') {
        var bits = parseInt(type.substr(1));
        assert(bits % 8 === 0, 'getNativeTypeSize invalid bits ' + bits + ', type ' + type);
        return bits / 8;
      } else {
        return 0;
      }
    }
  }
}

function warnOnce(text) {
  if (!warnOnce.shown) warnOnce.shown = {};
  if (!warnOnce.shown[text]) {
    warnOnce.shown[text] = 1;
    err(text);
  }
}

var asm2wasmImports = { // special asm2wasm imports
    "f64-rem": function(x, y) {
        return x % y;
    },
    "debugger": function() {
        debugger;
    }
};



var jsCallStartIndex = 1;
var functionPointers = new Array(0);

// Wraps a JS function as a wasm function with a given signature.
function convertJsFunctionToWasm(func, sig) {

  // If the type reflection proposal is available, use the new
  // "WebAssembly.Function" constructor.
  // Otherwise, construct a minimal wasm module importing the JS function and
  // re-exporting it.
  if (typeof WebAssembly.Function === "function") {
    var typeNames = {
      'i': 'i32',
      'j': 'i64',
      'f': 'f32',
      'd': 'f64'
    };
    var type = {
      parameters: [],
      results: sig[0] == 'v' ? [] : [typeNames[sig[0]]]
    };
    for (var i = 1; i < sig.length; ++i) {
      type.parameters.push(typeNames[sig[i]]);
    }
    return new WebAssembly.Function(type, func);
  }

  // The module is static, with the exception of the type section, which is
  // generated based on the signature passed in.
  var typeSection = [
    0x01, // id: section,
    0x00, // length: 0 (placeholder)
    0x01, // count: 1
    0x60, // form: func
  ];
  var sigRet = sig.slice(0, 1);
  var sigParam = sig.slice(1);
  var typeCodes = {
    'i': 0x7f, // i32
    'j': 0x7e, // i64
    'f': 0x7d, // f32
    'd': 0x7c, // f64
  };

  // Parameters, length + signatures
  typeSection.push(sigParam.length);
  for (var i = 0; i < sigParam.length; ++i) {
    typeSection.push(typeCodes[sigParam[i]]);
  }

  // Return values, length + signatures
  // With no multi-return in MVP, either 0 (void) or 1 (anything else)
  if (sigRet == 'v') {
    typeSection.push(0x00);
  } else {
    typeSection = typeSection.concat([0x01, typeCodes[sigRet]]);
  }

  // Write the overall length of the type section back into the section header
  // (excepting the 2 bytes for the section id and length)
  typeSection[1] = typeSection.length - 2;

  // Rest of the module is static
  var bytes = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, // magic ("\0asm")
    0x01, 0x00, 0x00, 0x00, // version: 1
  ].concat(typeSection, [
    0x02, 0x07, // import section
      // (import "e" "f" (func 0 (type 0)))
      0x01, 0x01, 0x65, 0x01, 0x66, 0x00, 0x00,
    0x07, 0x05, // export section
      // (export "f" (func 0 (type 0)))
      0x01, 0x01, 0x66, 0x00, 0x00,
  ]));

   // We can compile this wasm module synchronously because it is very small.
  // This accepts an import (at "e.f"), that it reroutes to an export (at "f")
  var module = new WebAssembly.Module(bytes);
  var instance = new WebAssembly.Instance(module, {
    'e': {
      'f': func
    }
  });
  var wrappedFunc = instance.exports['f'];
  return wrappedFunc;
}

// Add a wasm function to the table.
function addFunctionWasm(func, sig) {
  var table = wasmTable;
  var ret = table.length;

  // Grow the table
  try {
    table.grow(1);
  } catch (err) {
    if (!err instanceof RangeError) {
      throw err;
    }
    throw 'Unable to grow wasm table. Use a higher value for RESERVED_FUNCTION_POINTERS or set ALLOW_TABLE_GROWTH.';
  }

  // Insert new element
  try {
    // Attempting to call this with JS function will cause of table.set() to fail
    table.set(ret, func);
  } catch (err) {
    if (!err instanceof TypeError) {
      throw err;
    }
    assert(typeof sig !== 'undefined', 'Missing signature argument to addFunction');
    var wrapped = convertJsFunctionToWasm(func, sig);
    table.set(ret, wrapped);
  }

  return ret;
}

function removeFunctionWasm(index) {
  // TODO(sbc): Look into implementing this to allow re-using of table slots
}

// 'sig' parameter is required for the llvm backend but only when func is not
// already a WebAssembly function.
function addFunction(func, sig) {
  assert(typeof func !== 'undefined');


  var base = 0;
  for (var i = base; i < base + 0; i++) {
    if (!functionPointers[i]) {
      functionPointers[i] = func;
      return jsCallStartIndex + i;
    }
  }
  throw 'Finished up all reserved function pointers. Use a higher value for RESERVED_FUNCTION_POINTERS.';

}

function removeFunction(index) {

  functionPointers[index-jsCallStartIndex] = null;
}

var funcWrappers = {};

function getFuncWrapper(func, sig) {
  if (!func) return; // on null pointer, return undefined
  assert(sig);
  if (!funcWrappers[sig]) {
    funcWrappers[sig] = {};
  }
  var sigCache = funcWrappers[sig];
  if (!sigCache[func]) {
    // optimize away arguments usage in common cases
    if (sig.length === 1) {
      sigCache[func] = function dynCall_wrapper() {
        return dynCall(sig, func);
      };
    } else if (sig.length === 2) {
      sigCache[func] = function dynCall_wrapper(arg) {
        return dynCall(sig, func, [arg]);
      };
    } else {
      // general case
      sigCache[func] = function dynCall_wrapper() {
        return dynCall(sig, func, Array.prototype.slice.call(arguments));
      };
    }
  }
  return sigCache[func];
}


function makeBigInt(low, high, unsigned) {
  return unsigned ? ((+((low>>>0)))+((+((high>>>0)))*4294967296.0)) : ((+((low>>>0)))+((+((high|0)))*4294967296.0));
}

function dynCall(sig, ptr, args) {
  if (args && args.length) {
    assert(args.length == sig.length-1);
    assert(('dynCall_' + sig) in Module, 'bad function pointer type - no table for sig \'' + sig + '\'');
    return Module['dynCall_' + sig].apply(null, [ptr].concat(args));
  } else {
    assert(sig.length == 1);
    assert(('dynCall_' + sig) in Module, 'bad function pointer type - no table for sig \'' + sig + '\'');
    return Module['dynCall_' + sig].call(null, ptr);
  }
}

var tempRet0 = 0;

var setTempRet0 = function(value) {
  tempRet0 = value;
};

var getTempRet0 = function() {
  return tempRet0;
};

function getCompilerSetting(name) {
  throw 'You must build with -s RETAIN_COMPILER_SETTINGS=1 for getCompilerSetting or emscripten_get_compiler_setting to work';
}

var Runtime = {
  // helpful errors
  getTempRet0: function() { abort('getTempRet0() is now a top-level function, after removing the Runtime object. Remove "Runtime."') },
  staticAlloc: function() { abort('staticAlloc() is now a top-level function, after removing the Runtime object. Remove "Runtime."') },
  stackAlloc: function() { abort('stackAlloc() is now a top-level function, after removing the Runtime object. Remove "Runtime."') },
};

// The address globals begin at. Very low in memory, for code size and optimization opportunities.
// Above 0 is static memory, starting with globals.
// Then the stack.
// Then 'dynamic' memory for sbrk.
var GLOBAL_BASE = 1024;




// === Preamble library stuff ===

// Documentation for the public APIs defined in this file must be updated in:
//    site/source/docs/api_reference/preamble.js.rst
// A prebuilt local version of the documentation is available at:
//    site/build/text/docs/api_reference/preamble.js.txt
// You can also build docs locally as HTML or other formats in site/
// An online HTML version (which may be of a different version of Emscripten)
//    is up at http://kripken.github.io/emscripten-site/docs/api_reference/preamble.js.html


var wasmBinary;if (Module['wasmBinary']) wasmBinary = Module['wasmBinary'];if (!Object.getOwnPropertyDescriptor(Module, 'wasmBinary')) Object.defineProperty(Module, 'wasmBinary', { configurable: true, get: function() { abort('Module.wasmBinary has been replaced with plain wasmBinary') } });
var noExitRuntime;if (Module['noExitRuntime']) noExitRuntime = Module['noExitRuntime'];if (!Object.getOwnPropertyDescriptor(Module, 'noExitRuntime')) Object.defineProperty(Module, 'noExitRuntime', { configurable: true, get: function() { abort('Module.noExitRuntime has been replaced with plain noExitRuntime') } });


if (typeof WebAssembly !== 'object') {
  abort('No WebAssembly support found. Build with -s WASM=0 to target JavaScript instead.');
}


// In MINIMAL_RUNTIME, setValue() and getValue() are only available when building with safe heap enabled, for heap safety checking.
// In traditional runtime, setValue() and getValue() are always available (although their use is highly discouraged due to perf penalties)

/** @type {function(number, number, string, boolean=)} */
function setValue(ptr, value, type, noSafe) {
  type = type || 'i8';
  if (type.charAt(type.length-1) === '*') type = 'i32'; // pointers are 32-bit
    switch(type) {
      case 'i1': HEAP8[((ptr)>>0)]=value; break;
      case 'i8': HEAP8[((ptr)>>0)]=value; break;
      case 'i16': HEAP16[((ptr)>>1)]=value; break;
      case 'i32': HEAP32[((ptr)>>2)]=value; break;
      case 'i64': (tempI64 = [value>>>0,(tempDouble=value,(+(Math_abs(tempDouble))) >= (+1) ? (tempDouble > (+0) ? ((Math_min((+(Math_floor((tempDouble)/(+4294967296)))), (+4294967295)))|0)>>>0 : (~~((+(Math_ceil((tempDouble - +(((~~(tempDouble)))>>>0))/(+4294967296))))))>>>0) : 0)],HEAP32[((ptr)>>2)]=tempI64[0],HEAP32[(((ptr)+(4))>>2)]=tempI64[1]); break;
      case 'float': HEAPF32[((ptr)>>2)]=value; break;
      case 'double': HEAPF64[((ptr)>>3)]=value; break;
      default: abort('invalid type for setValue: ' + type);
    }
}

/** @type {function(number, string, boolean=)} */
function getValue(ptr, type, noSafe) {
  type = type || 'i8';
  if (type.charAt(type.length-1) === '*') type = 'i32'; // pointers are 32-bit
    switch(type) {
      case 'i1': return HEAP8[((ptr)>>0)];
      case 'i8': return HEAP8[((ptr)>>0)];
      case 'i16': return HEAP16[((ptr)>>1)];
      case 'i32': return HEAP32[((ptr)>>2)];
      case 'i64': return HEAP32[((ptr)>>2)];
      case 'float': return HEAPF32[((ptr)>>2)];
      case 'double': return HEAPF64[((ptr)>>3)];
      default: abort('invalid type for getValue: ' + type);
    }
  return null;
}





// Wasm globals

var wasmMemory;

// In fastcomp asm.js, we don't need a wasm Table at all.
// In the wasm backend, we polyfill the WebAssembly object,
// so this creates a (non-native-wasm) table for us.
var wasmTable = new WebAssembly.Table({
  'initial': 320,
  'maximum': 320,
  'element': 'anyfunc'
});


//========================================
// Runtime essentials
//========================================

// whether we are quitting the application. no code should run after this.
// set in exit() and abort()
var ABORT = false;

// set by exit() and abort().  Passed to 'onExit' handler.
// NOTE: This is also used as the process return code code in shell environments
// but only when noExitRuntime is false.
var EXITSTATUS = 0;

/** @type {function(*, string=)} */
function assert(condition, text) {
  if (!condition) {
    abort('Assertion failed: ' + text);
  }
}

// Returns the C function with a specified identifier (for C++, you need to do manual name mangling)
function getCFunc(ident) {
  var func = Module['_' + ident]; // closure exported function
  assert(func, 'Cannot call unknown function ' + ident + ', make sure it is exported');
  return func;
}

// C calling interface.
function ccall(ident, returnType, argTypes, args, opts) {
  // For fast lookup of conversion functions
  var toC = {
    'string': function(str) {
      var ret = 0;
      if (str !== null && str !== undefined && str !== 0) { // null string
        // at most 4 bytes per UTF-8 code point, +1 for the trailing '\0'
        var len = (str.length << 2) + 1;
        ret = stackAlloc(len);
        stringToUTF8(str, ret, len);
      }
      return ret;
    },
    'array': function(arr) {
      var ret = stackAlloc(arr.length);
      writeArrayToMemory(arr, ret);
      return ret;
    }
  };

  function convertReturnValue(ret) {
    if (returnType === 'string') return UTF8ToString(ret);
    if (returnType === 'boolean') return Boolean(ret);
    return ret;
  }

  var func = getCFunc(ident);
  var cArgs = [];
  var stack = 0;
  assert(returnType !== 'array', 'Return type should not be "array".');
  if (args) {
    for (var i = 0; i < args.length; i++) {
      var converter = toC[argTypes[i]];
      if (converter) {
        if (stack === 0) stack = stackSave();
        cArgs[i] = converter(args[i]);
      } else {
        cArgs[i] = args[i];
      }
    }
  }
  var ret = func.apply(null, cArgs);
  if (typeof EmterpreterAsync === 'object' && EmterpreterAsync.state) {
    assert(opts && opts.async, 'The call to ' + ident + ' is running asynchronously. If this was intended, add the async option to the ccall/cwrap call.');
    assert(!EmterpreterAsync.restartFunc, 'Cannot have multiple async ccalls in flight at once');
    return new Promise(function(resolve) {
      EmterpreterAsync.restartFunc = func;
      EmterpreterAsync.asyncFinalizers.push(function(ret) {
        if (stack !== 0) stackRestore(stack);
        resolve(convertReturnValue(ret));
      });
    });
  }

  ret = convertReturnValue(ret);
  if (stack !== 0) stackRestore(stack);
  // If this is an async ccall, ensure we return a promise
  if (opts && opts.async) return Promise.resolve(ret);
  return ret;
}

function cwrap(ident, returnType, argTypes, opts) {
  return function() {
    return ccall(ident, returnType, argTypes, arguments, opts);
  }
}

var ALLOC_NORMAL = 0; // Tries to use _malloc()
var ALLOC_STACK = 1; // Lives for the duration of the current function call
var ALLOC_DYNAMIC = 2; // Cannot be freed except through sbrk
var ALLOC_NONE = 3; // Do not allocate

// allocate(): This is for internal use. You can use it yourself as well, but the interface
//             is a little tricky (see docs right below). The reason is that it is optimized
//             for multiple syntaxes to save space in generated code. So you should
//             normally not use allocate(), and instead allocate memory using _malloc(),
//             initialize it with setValue(), and so forth.
// @slab: An array of data, or a number. If a number, then the size of the block to allocate,
//        in *bytes* (note that this is sometimes confusing: the next parameter does not
//        affect this!)
// @types: Either an array of types, one for each byte (or 0 if no type at that position),
//         or a single type which is used for the entire block. This only matters if there
//         is initial data - if @slab is a number, then this does not matter at all and is
//         ignored.
// @allocator: How to allocate memory, see ALLOC_*
/** @type {function((TypedArray|Array<number>|number), string, number, number=)} */
function allocate(slab, types, allocator, ptr) {
  var zeroinit, size;
  if (typeof slab === 'number') {
    zeroinit = true;
    size = slab;
  } else {
    zeroinit = false;
    size = slab.length;
  }

  var singleType = typeof types === 'string' ? types : null;

  var ret;
  if (allocator == ALLOC_NONE) {
    ret = ptr;
  } else {
    ret = [_malloc,
    stackAlloc,
    dynamicAlloc][allocator](Math.max(size, singleType ? 1 : types.length));
  }

  if (zeroinit) {
    var stop;
    ptr = ret;
    assert((ret & 3) == 0);
    stop = ret + (size & ~3);
    for (; ptr < stop; ptr += 4) {
      HEAP32[((ptr)>>2)]=0;
    }
    stop = ret + size;
    while (ptr < stop) {
      HEAP8[((ptr++)>>0)]=0;
    }
    return ret;
  }

  if (singleType === 'i8') {
    if (slab.subarray || slab.slice) {
      HEAPU8.set(/** @type {!Uint8Array} */ (slab), ret);
    } else {
      HEAPU8.set(new Uint8Array(slab), ret);
    }
    return ret;
  }

  var i = 0, type, typeSize, previousType;
  while (i < size) {
    var curr = slab[i];

    type = singleType || types[i];
    if (type === 0) {
      i++;
      continue;
    }
    assert(type, 'Must know what type to store in allocate!');

    if (type == 'i64') type = 'i32'; // special case: we have one i32 here, and one i32 later

    setValue(ret+i, curr, type);

    // no need to look up size unless type changes, so cache it
    if (previousType !== type) {
      typeSize = getNativeTypeSize(type);
      previousType = type;
    }
    i += typeSize;
  }

  return ret;
}

// Allocate memory during any stage of startup - static memory early on, dynamic memory later, malloc when ready
function getMemory(size) {
  if (!runtimeInitialized) return dynamicAlloc(size);
  return _malloc(size);
}




/** @type {function(number, number=)} */
function Pointer_stringify(ptr, length) {
  abort("this function has been removed - you should use UTF8ToString(ptr, maxBytesToRead) instead!");
}

// Given a pointer 'ptr' to a null-terminated ASCII-encoded string in the emscripten HEAP, returns
// a copy of that string as a Javascript String object.

function AsciiToString(ptr) {
  var str = '';
  while (1) {
    var ch = HEAPU8[((ptr++)>>0)];
    if (!ch) return str;
    str += String.fromCharCode(ch);
  }
}

// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in ASCII form. The copy will require at most str.length+1 bytes of space in the HEAP.

function stringToAscii(str, outPtr) {
  return writeAsciiToMemory(str, outPtr, false);
}


// Given a pointer 'ptr' to a null-terminated UTF8-encoded string in the given array that contains uint8 values, returns
// a copy of that string as a Javascript String object.

var UTF8Decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf8') : undefined;

/**
 * @param {number} idx
 * @param {number=} maxBytesToRead
 * @return {string}
 */
function UTF8ArrayToString(u8Array, idx, maxBytesToRead) {
  var endIdx = idx + maxBytesToRead;
  var endPtr = idx;
  // TextDecoder needs to know the byte length in advance, it doesn't stop on null terminator by itself.
  // Also, use the length info to avoid running tiny strings through TextDecoder, since .subarray() allocates garbage.
  // (As a tiny code save trick, compare endPtr against endIdx using a negation, so that undefined means Infinity)
  while (u8Array[endPtr] && !(endPtr >= endIdx)) ++endPtr;

  if (endPtr - idx > 16 && u8Array.subarray && UTF8Decoder) {
    return UTF8Decoder.decode(u8Array.subarray(idx, endPtr));
  } else {
    var str = '';
    // If building with TextDecoder, we have already computed the string length above, so test loop end condition against that
    while (idx < endPtr) {
      // For UTF8 byte structure, see:
      // http://en.wikipedia.org/wiki/UTF-8#Description
      // https://www.ietf.org/rfc/rfc2279.txt
      // https://tools.ietf.org/html/rfc3629
      var u0 = u8Array[idx++];
      if (!(u0 & 0x80)) { str += String.fromCharCode(u0); continue; }
      var u1 = u8Array[idx++] & 63;
      if ((u0 & 0xE0) == 0xC0) { str += String.fromCharCode(((u0 & 31) << 6) | u1); continue; }
      var u2 = u8Array[idx++] & 63;
      if ((u0 & 0xF0) == 0xE0) {
        u0 = ((u0 & 15) << 12) | (u1 << 6) | u2;
      } else {
        if ((u0 & 0xF8) != 0xF0) warnOnce('Invalid UTF-8 leading byte 0x' + u0.toString(16) + ' encountered when deserializing a UTF-8 string on the asm.js/wasm heap to a JS string!');
        u0 = ((u0 & 7) << 18) | (u1 << 12) | (u2 << 6) | (u8Array[idx++] & 63);
      }

      if (u0 < 0x10000) {
        str += String.fromCharCode(u0);
      } else {
        var ch = u0 - 0x10000;
        str += String.fromCharCode(0xD800 | (ch >> 10), 0xDC00 | (ch & 0x3FF));
      }
    }
  }
  return str;
}

// Given a pointer 'ptr' to a null-terminated UTF8-encoded string in the emscripten HEAP, returns a
// copy of that string as a Javascript String object.
// maxBytesToRead: an optional length that specifies the maximum number of bytes to read. You can omit
//                 this parameter to scan the string until the first \0 byte. If maxBytesToRead is
//                 passed, and the string at [ptr, ptr+maxBytesToReadr[ contains a null byte in the
//                 middle, then the string will cut short at that byte index (i.e. maxBytesToRead will
//                 not produce a string of exact length [ptr, ptr+maxBytesToRead[)
//                 N.B. mixing frequent uses of UTF8ToString() with and without maxBytesToRead may
//                 throw JS JIT optimizations off, so it is worth to consider consistently using one
//                 style or the other.
/**
 * @param {number} ptr
 * @param {number=} maxBytesToRead
 * @return {string}
 */
function UTF8ToString(ptr, maxBytesToRead) {
  return ptr ? UTF8ArrayToString(HEAPU8, ptr, maxBytesToRead) : '';
}

// Copies the given Javascript String object 'str' to the given byte array at address 'outIdx',
// encoded in UTF8 form and null-terminated. The copy will require at most str.length*4+1 bytes of space in the HEAP.
// Use the function lengthBytesUTF8 to compute the exact number of bytes (excluding null terminator) that this function will write.
// Parameters:
//   str: the Javascript string to copy.
//   outU8Array: the array to copy to. Each index in this array is assumed to be one 8-byte element.
//   outIdx: The starting offset in the array to begin the copying.
//   maxBytesToWrite: The maximum number of bytes this function can write to the array.
//                    This count should include the null terminator,
//                    i.e. if maxBytesToWrite=1, only the null terminator will be written and nothing else.
//                    maxBytesToWrite=0 does not write any bytes to the output, not even the null terminator.
// Returns the number of bytes written, EXCLUDING the null terminator.

function stringToUTF8Array(str, outU8Array, outIdx, maxBytesToWrite) {
  if (!(maxBytesToWrite > 0)) // Parameter maxBytesToWrite is not optional. Negative values, 0, null, undefined and false each don't write out any bytes.
    return 0;

  var startIdx = outIdx;
  var endIdx = outIdx + maxBytesToWrite - 1; // -1 for string null terminator.
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! So decode UTF16->UTF32->UTF8.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    // For UTF8 byte structure, see http://en.wikipedia.org/wiki/UTF-8#Description and https://www.ietf.org/rfc/rfc2279.txt and https://tools.ietf.org/html/rfc3629
    var u = str.charCodeAt(i); // possibly a lead surrogate
    if (u >= 0xD800 && u <= 0xDFFF) {
      var u1 = str.charCodeAt(++i);
      u = 0x10000 + ((u & 0x3FF) << 10) | (u1 & 0x3FF);
    }
    if (u <= 0x7F) {
      if (outIdx >= endIdx) break;
      outU8Array[outIdx++] = u;
    } else if (u <= 0x7FF) {
      if (outIdx + 1 >= endIdx) break;
      outU8Array[outIdx++] = 0xC0 | (u >> 6);
      outU8Array[outIdx++] = 0x80 | (u & 63);
    } else if (u <= 0xFFFF) {
      if (outIdx + 2 >= endIdx) break;
      outU8Array[outIdx++] = 0xE0 | (u >> 12);
      outU8Array[outIdx++] = 0x80 | ((u >> 6) & 63);
      outU8Array[outIdx++] = 0x80 | (u & 63);
    } else {
      if (outIdx + 3 >= endIdx) break;
      if (u >= 0x200000) warnOnce('Invalid Unicode code point 0x' + u.toString(16) + ' encountered when serializing a JS string to an UTF-8 string on the asm.js/wasm heap! (Valid unicode code points should be in range 0-0x1FFFFF).');
      outU8Array[outIdx++] = 0xF0 | (u >> 18);
      outU8Array[outIdx++] = 0x80 | ((u >> 12) & 63);
      outU8Array[outIdx++] = 0x80 | ((u >> 6) & 63);
      outU8Array[outIdx++] = 0x80 | (u & 63);
    }
  }
  // Null-terminate the pointer to the buffer.
  outU8Array[outIdx] = 0;
  return outIdx - startIdx;
}

// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in UTF8 form. The copy will require at most str.length*4+1 bytes of space in the HEAP.
// Use the function lengthBytesUTF8 to compute the exact number of bytes (excluding null terminator) that this function will write.
// Returns the number of bytes written, EXCLUDING the null terminator.

function stringToUTF8(str, outPtr, maxBytesToWrite) {
  assert(typeof maxBytesToWrite == 'number', 'stringToUTF8(str, outPtr, maxBytesToWrite) is missing the third parameter that specifies the length of the output buffer!');
  return stringToUTF8Array(str, HEAPU8,outPtr, maxBytesToWrite);
}

// Returns the number of bytes the given Javascript string takes if encoded as a UTF8 byte array, EXCLUDING the null terminator byte.
function lengthBytesUTF8(str) {
  var len = 0;
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! So decode UTF16->UTF32->UTF8.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    var u = str.charCodeAt(i); // possibly a lead surrogate
    if (u >= 0xD800 && u <= 0xDFFF) u = 0x10000 + ((u & 0x3FF) << 10) | (str.charCodeAt(++i) & 0x3FF);
    if (u <= 0x7F) ++len;
    else if (u <= 0x7FF) len += 2;
    else if (u <= 0xFFFF) len += 3;
    else len += 4;
  }
  return len;
}


// Given a pointer 'ptr' to a null-terminated UTF16LE-encoded string in the emscripten HEAP, returns
// a copy of that string as a Javascript String object.

var UTF16Decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-16le') : undefined;
function UTF16ToString(ptr) {
  assert(ptr % 2 == 0, 'Pointer passed to UTF16ToString must be aligned to two bytes!');
  var endPtr = ptr;
  // TextDecoder needs to know the byte length in advance, it doesn't stop on null terminator by itself.
  // Also, use the length info to avoid running tiny strings through TextDecoder, since .subarray() allocates garbage.
  var idx = endPtr >> 1;
  while (HEAP16[idx]) ++idx;
  endPtr = idx << 1;

  if (endPtr - ptr > 32 && UTF16Decoder) {
    return UTF16Decoder.decode(HEAPU8.subarray(ptr, endPtr));
  } else {
    var i = 0;

    var str = '';
    while (1) {
      var codeUnit = HEAP16[(((ptr)+(i*2))>>1)];
      if (codeUnit == 0) return str;
      ++i;
      // fromCharCode constructs a character from a UTF-16 code unit, so we can pass the UTF16 string right through.
      str += String.fromCharCode(codeUnit);
    }
  }
}

// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in UTF16 form. The copy will require at most str.length*4+2 bytes of space in the HEAP.
// Use the function lengthBytesUTF16() to compute the exact number of bytes (excluding null terminator) that this function will write.
// Parameters:
//   str: the Javascript string to copy.
//   outPtr: Byte address in Emscripten HEAP where to write the string to.
//   maxBytesToWrite: The maximum number of bytes this function can write to the array. This count should include the null
//                    terminator, i.e. if maxBytesToWrite=2, only the null terminator will be written and nothing else.
//                    maxBytesToWrite<2 does not write any bytes to the output, not even the null terminator.
// Returns the number of bytes written, EXCLUDING the null terminator.

function stringToUTF16(str, outPtr, maxBytesToWrite) {
  assert(outPtr % 2 == 0, 'Pointer passed to stringToUTF16 must be aligned to two bytes!');
  assert(typeof maxBytesToWrite == 'number', 'stringToUTF16(str, outPtr, maxBytesToWrite) is missing the third parameter that specifies the length of the output buffer!');
  // Backwards compatibility: if max bytes is not specified, assume unsafe unbounded write is allowed.
  if (maxBytesToWrite === undefined) {
    maxBytesToWrite = 0x7FFFFFFF;
  }
  if (maxBytesToWrite < 2) return 0;
  maxBytesToWrite -= 2; // Null terminator.
  var startPtr = outPtr;
  var numCharsToWrite = (maxBytesToWrite < str.length*2) ? (maxBytesToWrite / 2) : str.length;
  for (var i = 0; i < numCharsToWrite; ++i) {
    // charCodeAt returns a UTF-16 encoded code unit, so it can be directly written to the HEAP.
    var codeUnit = str.charCodeAt(i); // possibly a lead surrogate
    HEAP16[((outPtr)>>1)]=codeUnit;
    outPtr += 2;
  }
  // Null-terminate the pointer to the HEAP.
  HEAP16[((outPtr)>>1)]=0;
  return outPtr - startPtr;
}

// Returns the number of bytes the given Javascript string takes if encoded as a UTF16 byte array, EXCLUDING the null terminator byte.

function lengthBytesUTF16(str) {
  return str.length*2;
}

function UTF32ToString(ptr) {
  assert(ptr % 4 == 0, 'Pointer passed to UTF32ToString must be aligned to four bytes!');
  var i = 0;

  var str = '';
  while (1) {
    var utf32 = HEAP32[(((ptr)+(i*4))>>2)];
    if (utf32 == 0)
      return str;
    ++i;
    // Gotcha: fromCharCode constructs a character from a UTF-16 encoded code (pair), not from a Unicode code point! So encode the code point to UTF-16 for constructing.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    if (utf32 >= 0x10000) {
      var ch = utf32 - 0x10000;
      str += String.fromCharCode(0xD800 | (ch >> 10), 0xDC00 | (ch & 0x3FF));
    } else {
      str += String.fromCharCode(utf32);
    }
  }
}

// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in UTF32 form. The copy will require at most str.length*4+4 bytes of space in the HEAP.
// Use the function lengthBytesUTF32() to compute the exact number of bytes (excluding null terminator) that this function will write.
// Parameters:
//   str: the Javascript string to copy.
//   outPtr: Byte address in Emscripten HEAP where to write the string to.
//   maxBytesToWrite: The maximum number of bytes this function can write to the array. This count should include the null
//                    terminator, i.e. if maxBytesToWrite=4, only the null terminator will be written and nothing else.
//                    maxBytesToWrite<4 does not write any bytes to the output, not even the null terminator.
// Returns the number of bytes written, EXCLUDING the null terminator.

function stringToUTF32(str, outPtr, maxBytesToWrite) {
  assert(outPtr % 4 == 0, 'Pointer passed to stringToUTF32 must be aligned to four bytes!');
  assert(typeof maxBytesToWrite == 'number', 'stringToUTF32(str, outPtr, maxBytesToWrite) is missing the third parameter that specifies the length of the output buffer!');
  // Backwards compatibility: if max bytes is not specified, assume unsafe unbounded write is allowed.
  if (maxBytesToWrite === undefined) {
    maxBytesToWrite = 0x7FFFFFFF;
  }
  if (maxBytesToWrite < 4) return 0;
  var startPtr = outPtr;
  var endPtr = startPtr + maxBytesToWrite - 4;
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! We must decode the string to UTF-32 to the heap.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    var codeUnit = str.charCodeAt(i); // possibly a lead surrogate
    if (codeUnit >= 0xD800 && codeUnit <= 0xDFFF) {
      var trailSurrogate = str.charCodeAt(++i);
      codeUnit = 0x10000 + ((codeUnit & 0x3FF) << 10) | (trailSurrogate & 0x3FF);
    }
    HEAP32[((outPtr)>>2)]=codeUnit;
    outPtr += 4;
    if (outPtr + 4 > endPtr) break;
  }
  // Null-terminate the pointer to the HEAP.
  HEAP32[((outPtr)>>2)]=0;
  return outPtr - startPtr;
}

// Returns the number of bytes the given Javascript string takes if encoded as a UTF16 byte array, EXCLUDING the null terminator byte.

function lengthBytesUTF32(str) {
  var len = 0;
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! We must decode the string to UTF-32 to the heap.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    var codeUnit = str.charCodeAt(i);
    if (codeUnit >= 0xD800 && codeUnit <= 0xDFFF) ++i; // possibly a lead surrogate, so skip over the tail surrogate.
    len += 4;
  }

  return len;
}

// Allocate heap space for a JS string, and write it there.
// It is the responsibility of the caller to free() that memory.
function allocateUTF8(str) {
  var size = lengthBytesUTF8(str) + 1;
  var ret = _malloc(size);
  if (ret) stringToUTF8Array(str, HEAP8, ret, size);
  return ret;
}

// Allocate stack space for a JS string, and write it there.
function allocateUTF8OnStack(str) {
  var size = lengthBytesUTF8(str) + 1;
  var ret = stackAlloc(size);
  stringToUTF8Array(str, HEAP8, ret, size);
  return ret;
}

// Deprecated: This function should not be called because it is unsafe and does not provide
// a maximum length limit of how many bytes it is allowed to write. Prefer calling the
// function stringToUTF8Array() instead, which takes in a maximum length that can be used
// to be secure from out of bounds writes.
/** @deprecated */
function writeStringToMemory(string, buffer, dontAddNull) {
  warnOnce('writeStringToMemory is deprecated and should not be called! Use stringToUTF8() instead!');

  var /** @type {number} */ lastChar, /** @type {number} */ end;
  if (dontAddNull) {
    // stringToUTF8Array always appends null. If we don't want to do that, remember the
    // character that existed at the location where the null will be placed, and restore
    // that after the write (below).
    end = buffer + lengthBytesUTF8(string);
    lastChar = HEAP8[end];
  }
  stringToUTF8(string, buffer, Infinity);
  if (dontAddNull) HEAP8[end] = lastChar; // Restore the value under the null character.
}

function writeArrayToMemory(array, buffer) {
  assert(array.length >= 0, 'writeArrayToMemory array must have a length (should be an array or typed array)')
  HEAP8.set(array, buffer);
}

function writeAsciiToMemory(str, buffer, dontAddNull) {
  for (var i = 0; i < str.length; ++i) {
    assert(str.charCodeAt(i) === str.charCodeAt(i)&0xff);
    HEAP8[((buffer++)>>0)]=str.charCodeAt(i);
  }
  // Null-terminate the pointer to the HEAP.
  if (!dontAddNull) HEAP8[((buffer)>>0)]=0;
}




// Memory management

var PAGE_SIZE = 16384;
var WASM_PAGE_SIZE = 65536;
var ASMJS_PAGE_SIZE = 16777216;

function alignUp(x, multiple) {
  if (x % multiple > 0) {
    x += multiple - (x % multiple);
  }
  return x;
}

var HEAP,
/** @type {ArrayBuffer} */
  buffer,
/** @type {Int8Array} */
  HEAP8,
/** @type {Uint8Array} */
  HEAPU8,
/** @type {Int16Array} */
  HEAP16,
/** @type {Uint16Array} */
  HEAPU16,
/** @type {Int32Array} */
  HEAP32,
/** @type {Uint32Array} */
  HEAPU32,
/** @type {Float32Array} */
  HEAPF32,
/** @type {Float64Array} */
  HEAPF64;

function updateGlobalBufferAndViews(buf) {
  buffer = buf;
  Module['HEAP8'] = HEAP8 = new Int8Array(buf);
  Module['HEAP16'] = HEAP16 = new Int16Array(buf);
  Module['HEAP32'] = HEAP32 = new Int32Array(buf);
  Module['HEAPU8'] = HEAPU8 = new Uint8Array(buf);
  Module['HEAPU16'] = HEAPU16 = new Uint16Array(buf);
  Module['HEAPU32'] = HEAPU32 = new Uint32Array(buf);
  Module['HEAPF32'] = HEAPF32 = new Float32Array(buf);
  Module['HEAPF64'] = HEAPF64 = new Float64Array(buf);
}

var STATIC_BASE = 1024,
    STACK_BASE = 32128,
    STACKTOP = STACK_BASE,
    STACK_MAX = 5275008,
    DYNAMIC_BASE = 5275008,
    DYNAMICTOP_PTR = 31936;

assert(STACK_BASE % 16 === 0, 'stack must start aligned');
assert(DYNAMIC_BASE % 16 === 0, 'heap must start aligned');


function abortStackOverflowEmterpreter() {
  abort("Emterpreter stack overflow! Decrease the recursion level or increase EMT_STACK_MAX in tools/emterpretify.py (current value " + EMT_STACK_MAX + ").");
}

var TOTAL_STACK = 5242880;
if (Module['TOTAL_STACK']) assert(TOTAL_STACK === Module['TOTAL_STACK'], 'the stack size can no longer be determined at runtime')

var INITIAL_TOTAL_MEMORY = Module['TOTAL_MEMORY'] || 16777216;if (!Object.getOwnPropertyDescriptor(Module, 'TOTAL_MEMORY')) Object.defineProperty(Module, 'TOTAL_MEMORY', { configurable: true, get: function() { abort('Module.TOTAL_MEMORY has been replaced with plain INITIAL_TOTAL_MEMORY') } });

assert(INITIAL_TOTAL_MEMORY >= TOTAL_STACK, 'TOTAL_MEMORY should be larger than TOTAL_STACK, was ' + INITIAL_TOTAL_MEMORY + '! (TOTAL_STACK=' + TOTAL_STACK + ')');

// check for full engine support (use string 'subarray' to avoid closure compiler confusion)
assert(typeof Int32Array !== 'undefined' && typeof Float64Array !== 'undefined' && Int32Array.prototype.subarray !== undefined && Int32Array.prototype.set !== undefined,
       'JS engine does not provide full typed array support');






// In standalone mode, the wasm creates the memory, and the user can't provide it.
// In non-standalone/normal mode, we create the memory here.

// Create the main memory. (Note: this isn't used in STANDALONE_WASM mode since the wasm
// memory is created in the wasm, not in JS.)

  if (Module['wasmMemory']) {
    wasmMemory = Module['wasmMemory'];
  } else
  {
    wasmMemory = new WebAssembly.Memory({
      'initial': INITIAL_TOTAL_MEMORY / WASM_PAGE_SIZE
      ,
      'maximum': INITIAL_TOTAL_MEMORY / WASM_PAGE_SIZE
    });
  }


if (wasmMemory) {
  buffer = wasmMemory.buffer;
}

// If the user provides an incorrect length, just use that length instead rather than providing the user to
// specifically provide the memory length with Module['TOTAL_MEMORY'].
INITIAL_TOTAL_MEMORY = buffer.byteLength;
assert(INITIAL_TOTAL_MEMORY % WASM_PAGE_SIZE === 0);
updateGlobalBufferAndViews(buffer);

HEAP32[DYNAMICTOP_PTR>>2] = DYNAMIC_BASE;




// Initializes the stack cookie. Called at the startup of main and at the startup of each thread in pthreads mode.
function writeStackCookie() {
  assert((STACK_MAX & 3) == 0);
  HEAPU32[(STACK_MAX >> 2)-1] = 0x02135467;
  HEAPU32[(STACK_MAX >> 2)-2] = 0x89BACDFE;
  // Also test the global address 0 for integrity.
  // We don't do this with ASan because ASan does its own checks for this.
  HEAP32[0] = 0x63736d65; /* 'emsc' */
}

function checkStackCookie() {
  var cookie1 = HEAPU32[(STACK_MAX >> 2)-1];
  var cookie2 = HEAPU32[(STACK_MAX >> 2)-2];
  if (cookie1 != 0x02135467 || cookie2 != 0x89BACDFE) {
    abort('Stack overflow! Stack cookie has been overwritten, expected hex dwords 0x89BACDFE and 0x02135467, but received 0x' + cookie2.toString(16) + ' ' + cookie1.toString(16));
  }
  // Also test the global address 0 for integrity.
  // We don't do this with ASan because ASan does its own checks for this.
  if (HEAP32[0] !== 0x63736d65 /* 'emsc' */) abort('Runtime error: The application has corrupted its heap memory area (address zero)!');
}

function abortStackOverflow(allocSize) {
  abort('Stack overflow! Attempted to allocate ' + allocSize + ' bytes on the stack, but stack has only ' + (STACK_MAX - stackSave() + allocSize) + ' bytes available!');
}




// Endianness check (note: assumes compiler arch was little-endian)
(function() {
  var h16 = new Int16Array(1);
  var h8 = new Int8Array(h16.buffer);
  h16[0] = 0x6373;
  if (h8[0] !== 0x73 || h8[1] !== 0x63) throw 'Runtime error: expected the system to be little-endian!';
})();

function abortFnPtrError(ptr, sig) {
	abort("Invalid function pointer " + ptr + " called with signature '" + sig + "'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this). Build with ASSERTIONS=2 for more info.");
}



function callRuntimeCallbacks(callbacks) {
  while(callbacks.length > 0) {
    var callback = callbacks.shift();
    if (typeof callback == 'function') {
      callback();
      continue;
    }
    var func = callback.func;
    if (typeof func === 'number') {
      if (callback.arg === undefined) {
        Module['dynCall_v'](func);
      } else {
        Module['dynCall_vi'](func, callback.arg);
      }
    } else {
      func(callback.arg === undefined ? null : callback.arg);
    }
  }
}

var __ATPRERUN__  = []; // functions called before the runtime is initialized
var __ATINIT__    = []; // functions called during startup
var __ATMAIN__    = []; // functions called when main() is to be run
var __ATEXIT__    = []; // functions called during shutdown
var __ATPOSTRUN__ = []; // functions called after the main() is called

var runtimeInitialized = false;
var runtimeExited = false;


function preRun() {

  if (Module['preRun']) {
    if (typeof Module['preRun'] == 'function') Module['preRun'] = [Module['preRun']];
    while (Module['preRun'].length) {
      addOnPreRun(Module['preRun'].shift());
    }
  }

  callRuntimeCallbacks(__ATPRERUN__);
}

function initRuntime() {
  checkStackCookie();
  assert(!runtimeInitialized);
  runtimeInitialized = true;
  if (!Module["noFSInit"] && !FS.init.initialized) FS.init();
TTY.init();
  callRuntimeCallbacks(__ATINIT__);
}

function preMain() {
  checkStackCookie();
  FS.ignorePermissions = false;
  callRuntimeCallbacks(__ATMAIN__);
}

function exitRuntime() {
  checkStackCookie();
  runtimeExited = true;
}

function postRun() {
  checkStackCookie();

  if (Module['postRun']) {
    if (typeof Module['postRun'] == 'function') Module['postRun'] = [Module['postRun']];
    while (Module['postRun'].length) {
      addOnPostRun(Module['postRun'].shift());
    }
  }

  callRuntimeCallbacks(__ATPOSTRUN__);
}

function addOnPreRun(cb) {
  __ATPRERUN__.unshift(cb);
}

function addOnInit(cb) {
  __ATINIT__.unshift(cb);
}

function addOnPreMain(cb) {
  __ATMAIN__.unshift(cb);
}

function addOnExit(cb) {
}

function addOnPostRun(cb) {
  __ATPOSTRUN__.unshift(cb);
}

function unSign(value, bits, ignore) {
  if (value >= 0) {
    return value;
  }
  return bits <= 32 ? 2*Math.abs(1 << (bits-1)) + value // Need some trickery, since if bits == 32, we are right at the limit of the bits JS uses in bitshifts
                    : Math.pow(2, bits)         + value;
}
function reSign(value, bits, ignore) {
  if (value <= 0) {
    return value;
  }
  var half = bits <= 32 ? Math.abs(1 << (bits-1)) // abs is needed if bits == 32
                        : Math.pow(2, bits-1);
  if (value >= half && (bits <= 32 || value > half)) { // for huge values, we can hit the precision limit and always get true here. so don't do that
                                                       // but, in general there is no perfect solution here. With 64-bit ints, we get rounding and errors
                                                       // TODO: In i64 mode 1, resign the two parts separately and safely
    value = -2*half + value; // Cannot bitshift half, as it may be at the limit of the bits JS uses in bitshifts
  }
  return value;
}


assert(Math.imul, 'This browser does not support Math.imul(), build with LEGACY_VM_SUPPORT or POLYFILL_OLD_MATH_FUNCTIONS to add in a polyfill');
assert(Math.fround, 'This browser does not support Math.fround(), build with LEGACY_VM_SUPPORT or POLYFILL_OLD_MATH_FUNCTIONS to add in a polyfill');
assert(Math.clz32, 'This browser does not support Math.clz32(), build with LEGACY_VM_SUPPORT or POLYFILL_OLD_MATH_FUNCTIONS to add in a polyfill');
assert(Math.trunc, 'This browser does not support Math.trunc(), build with LEGACY_VM_SUPPORT or POLYFILL_OLD_MATH_FUNCTIONS to add in a polyfill');

var Math_abs = Math.abs;
var Math_cos = Math.cos;
var Math_sin = Math.sin;
var Math_tan = Math.tan;
var Math_acos = Math.acos;
var Math_asin = Math.asin;
var Math_atan = Math.atan;
var Math_atan2 = Math.atan2;
var Math_exp = Math.exp;
var Math_log = Math.log;
var Math_sqrt = Math.sqrt;
var Math_ceil = Math.ceil;
var Math_floor = Math.floor;
var Math_pow = Math.pow;
var Math_imul = Math.imul;
var Math_fround = Math.fround;
var Math_round = Math.round;
var Math_min = Math.min;
var Math_max = Math.max;
var Math_clz32 = Math.clz32;
var Math_trunc = Math.trunc;



// A counter of dependencies for calling run(). If we need to
// do asynchronous work before running, increment this and
// decrement it. Incrementing must happen in a place like
// Module.preRun (used by emcc to add file preloading).
// Note that you can add dependencies in preRun, even though
// it happens right before run - run will be postponed until
// the dependencies are met.
var runDependencies = 0;
var runDependencyWatcher = null;
var dependenciesFulfilled = null; // overridden to take different actions when all run dependencies are fulfilled
var runDependencyTracking = {};

function getUniqueRunDependency(id) {
  var orig = id;
  while (1) {
    if (!runDependencyTracking[id]) return id;
    id = orig + Math.random();
  }
  return id;
}

function addRunDependency(id) {
  runDependencies++;

  if (Module['monitorRunDependencies']) {
    Module['monitorRunDependencies'](runDependencies);
  }

  if (id) {
    assert(!runDependencyTracking[id]);
    runDependencyTracking[id] = 1;
    if (runDependencyWatcher === null && typeof setInterval !== 'undefined') {
      // Check for missing dependencies every few seconds
      runDependencyWatcher = setInterval(function() {
        if (ABORT) {
          clearInterval(runDependencyWatcher);
          runDependencyWatcher = null;
          return;
        }
        var shown = false;
        for (var dep in runDependencyTracking) {
          if (!shown) {
            shown = true;
            err('still waiting on run dependencies:');
          }
          err('dependency: ' + dep);
        }
        if (shown) {
          err('(end of list)');
        }
      }, 10000);
    }
  } else {
    err('warning: run dependency added without ID');
  }
}

function removeRunDependency(id) {
  runDependencies--;

  if (Module['monitorRunDependencies']) {
    Module['monitorRunDependencies'](runDependencies);
  }

  if (id) {
    assert(runDependencyTracking[id]);
    delete runDependencyTracking[id];
  } else {
    err('warning: run dependency removed without ID');
  }
  if (runDependencies == 0) {
    if (runDependencyWatcher !== null) {
      clearInterval(runDependencyWatcher);
      runDependencyWatcher = null;
    }
    if (dependenciesFulfilled) {
      var callback = dependenciesFulfilled;
      dependenciesFulfilled = null;
      callback(); // can add another dependenciesFulfilled
    }
  }
}

Module["preloadedImages"] = {}; // maps url to image data
Module["preloadedAudios"] = {}; // maps url to audio data

var abortDecorators = [];

function abort(what) {
  if (Module['onAbort']) {
    Module['onAbort'](what);
  }

  what += '';
  out(what);
  err(what);

  ABORT = true;
  EXITSTATUS = 1;

  var output = 'abort(' + what + ') at ' + stackTrace();
  abortDecorators.forEach(function(decorator) {
    output = decorator(output, what);
  });
  what = output;

  // Throw a wasm runtime error, because a JS error might be seen as a foreign
  // exception, which means we'd run destructors on it. We need the error to
  // simply make the program stop.
  throw new WebAssembly.RuntimeError(what);
}


var memoryInitializer = null;







// Copyright 2017 The Emscripten Authors.  All rights reserved.
// Emscripten is available under two separate licenses, the MIT license and the
// University of Illinois/NCSA Open Source License.  Both these licenses can be
// found in the LICENSE file.

// Prefix of data URIs emitted by SINGLE_FILE and related options.
var dataURIPrefix = 'data:application/octet-stream;base64,';

// Indicates whether filename is a base64 data URI.
function isDataURI(filename) {
  return String.prototype.startsWith ?
      filename.startsWith(dataURIPrefix) :
      filename.indexOf(dataURIPrefix) === 0;
}




var wasmBinaryFile = 'raylibTemplate.wasm';
if (!isDataURI(wasmBinaryFile)) {
  wasmBinaryFile = locateFile(wasmBinaryFile);
}

function getBinary() {
  try {
    if (wasmBinary) {
      return new Uint8Array(wasmBinary);
    }

    if (readBinary) {
      return readBinary(wasmBinaryFile);
    } else {
      throw "both async and sync fetching of the wasm failed";
    }
  }
  catch (err) {
    abort(err);
  }
}

function getBinaryPromise() {
  // if we don't have the binary yet, and have the Fetch api, use that
  // in some environments, like Electron's render process, Fetch api may be present, but have a different context than expected, let's only use it on the Web
  if (!wasmBinary && (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) && typeof fetch === 'function') {
    return fetch(wasmBinaryFile, { credentials: 'same-origin' }).then(function(response) {
      if (!response['ok']) {
        throw "failed to load wasm binary file at '" + wasmBinaryFile + "'";
      }
      return response['arrayBuffer']();
    }).catch(function () {
      return getBinary();
    });
  }
  // Otherwise, getBinary should be able to get it synchronously
  return new Promise(function(resolve, reject) {
    resolve(getBinary());
  });
}



// Create the wasm instance.
// Receives the wasm imports, returns the exports.
function createWasm() {
  // prepare imports
  var info = {
    'env': asmLibraryArg,
    'wasi_snapshot_preview1': asmLibraryArg
    ,
    'global': {
      'NaN': NaN,
      'Infinity': Infinity
    },
    'global.Math': Math,
    'asm2wasm': asm2wasmImports
  };
  // Load the wasm module and create an instance of using native support in the JS engine.
  // handle a generated wasm instance, receiving its exports and
  // performing other necessary setup
  function receiveInstance(instance, module) {
    var exports = instance.exports;
    Module['asm'] = exports;
    removeRunDependency('wasm-instantiate');
  }
   // we can't run yet (except in a pthread, where we have a custom sync instantiator)
  addRunDependency('wasm-instantiate');


  // Async compilation can be confusing when an error on the page overwrites Module
  // (for example, if the order of elements is wrong, and the one defining Module is
  // later), so we save Module and check it later.
  var trueModule = Module;
  function receiveInstantiatedSource(output) {
    // 'output' is a WebAssemblyInstantiatedSource object which has both the module and instance.
    // receiveInstance() will swap in the exports (to Module.asm) so they can be called
    assert(Module === trueModule, 'the Module object should not be replaced during async compilation - perhaps the order of HTML elements is wrong?');
    trueModule = null;
      // TODO: Due to Closure regression https://github.com/google/closure-compiler/issues/3193, the above line no longer optimizes out down to the following line.
      // When the regression is fixed, can restore the above USE_PTHREADS-enabled path.
    receiveInstance(output['instance']);
  }


  function instantiateArrayBuffer(receiver) {
    return getBinaryPromise().then(function(binary) {
      return WebAssembly.instantiate(binary, info);
    }).then(receiver, function(reason) {
      err('failed to asynchronously prepare wasm: ' + reason);
      abort(reason);
    });
  }

  // Prefer streaming instantiation if available.
  function instantiateAsync() {
    if (!wasmBinary &&
        typeof WebAssembly.instantiateStreaming === 'function' &&
        !isDataURI(wasmBinaryFile) &&
        typeof fetch === 'function') {
      fetch(wasmBinaryFile, { credentials: 'same-origin' }).then(function (response) {
        var result = WebAssembly.instantiateStreaming(response, info);
        return result.then(receiveInstantiatedSource, function(reason) {
            // We expect the most common failure cause to be a bad MIME type for the binary,
            // in which case falling back to ArrayBuffer instantiation should work.
            err('wasm streaming compile failed: ' + reason);
            err('falling back to ArrayBuffer instantiation');
            instantiateArrayBuffer(receiveInstantiatedSource);
          });
      });
    } else {
      return instantiateArrayBuffer(receiveInstantiatedSource);
    }
  }
  // User shell pages can write their own Module.instantiateWasm = function(imports, successCallback) callback
  // to manually instantiate the Wasm module themselves. This allows pages to run the instantiation parallel
  // to any other async startup actions they are performing.
  if (Module['instantiateWasm']) {
    try {
      var exports = Module['instantiateWasm'](info, receiveInstance);
      return exports;
    } catch(e) {
      err('Module.instantiateWasm callback failed with error: ' + e);
      return false;
    }
  }

  instantiateAsync();
  return {}; // no exports yet; we'll fill them in later
}

Module['asm'] = createWasm;

// Globals used by JS i64 conversions
var tempDouble;
var tempI64;

// === Body ===

var ASM_CONSTS = [];





// STATICTOP = STATIC_BASE + 31104;
/* global initializers */ /*__ATINIT__.push();*/








/* no memory initializer */
var tempDoublePtr = 32112
assert(tempDoublePtr % 8 == 0);

function copyTempFloat(ptr) { // functions, because inlining this code increases code size too much
  HEAP8[tempDoublePtr] = HEAP8[ptr];
  HEAP8[tempDoublePtr+1] = HEAP8[ptr+1];
  HEAP8[tempDoublePtr+2] = HEAP8[ptr+2];
  HEAP8[tempDoublePtr+3] = HEAP8[ptr+3];
}

function copyTempDouble(ptr) {
  HEAP8[tempDoublePtr] = HEAP8[ptr];
  HEAP8[tempDoublePtr+1] = HEAP8[ptr+1];
  HEAP8[tempDoublePtr+2] = HEAP8[ptr+2];
  HEAP8[tempDoublePtr+3] = HEAP8[ptr+3];
  HEAP8[tempDoublePtr+4] = HEAP8[ptr+4];
  HEAP8[tempDoublePtr+5] = HEAP8[ptr+5];
  HEAP8[tempDoublePtr+6] = HEAP8[ptr+6];
  HEAP8[tempDoublePtr+7] = HEAP8[ptr+7];
}

// {{PRE_LIBRARY}}

var EMTSTACKTOP = getMemory(1048576);
var EMT_STACK_MAX = EMTSTACKTOP + 1048576;

var eb = getMemory(172792);
assert(eb % 8 === 0);
__ATPRERUN__.push(function() {
  HEAPU8.set([140,6,195,0,0,0,0,0,2,186,0,0,0,202,154,59,2,187,0,0,24,2,0,0,2,188,0,0,200,61,0,0,1,184,0,0,136,189,0,0,0,185,189,0,136,189,0,0,1,190,48,2,3,189,189,190,137,189,0,0,130,189,0,0,136,190,0,0,49,189,189,190,88,0,0,0,1,190,48,2,135,189,0,0,190,0,0,0,1,190,0,0,97,185,187,190,1,190,28,2,3,190,185,190,25,53,190,12,134,9,0,0,212,153,2,0,1,0,0,0,135,10,1,0,34,190,10,0,121,190,11,0,68,190,1,0,134,15,0,0,212,153,2,0,190,0,0,0,135,32,1,0,0,34,15,0,1,124,1,0,1,125,165,61,68,167,1,0,119,0,24,0,0,32,10,0,0,34,9,0,1,190,1,8,19,190,4,190,33,190,190,0,38,190,190,1,0,124,190,0,1,189,0,8,19,189,4,189,32,189,189,0,121,189,9,0,38,191,4,1,32,191,191,0,1,192,166,61,1,193,171,61,125,189,191,192,193,0,0,0,0,190,189,0,119,0,3,0,1,189,168,61,0,190,189,0,0,125,190,0,58,167,1,0,1,190,0,0,32,190,190,0,2,189,0,0,0,0,240,127,19,189,32,189,2,193,0,0,0,0,240,127,13,189,189,193,19,190,190,189,121,190,47,0,25,45,124,3,1,189,32,0,2,193,0,0,255,255,254,255,19,193,4,193,134,190,0,0,16,119,2,0,0,189,2,45,193,0,0,0,134,190,0,0,232,156,2,0,0,125,124,0,70,189,167,167,59,192,0,0,59,191,0,0,70,192,192,191,20,189,189,192,121,189,9,0,38,192,5,32,33,192,192,0,1,191,192,61,1,194,196,61,125,189,192,191,194,0,0,0,0,193,189,0,119,0,8,0,38,194,5,32,33,194,194,0,1,191,184,61,1,192,188,61,125,189,194,191,192,0,0,0,0,193,189,0,1,189,3,0,134,190,0,0,232,156,2,0,0,193,189,0,1,189,32,0,1,193,0,32,21,193,4,193,134,190,0,0,16,119,2,0,0,189,2,45,193,0,0,0,0,51,45,0,119,0,230,3,3,193,185,187,134,190,0,0,188,66,2,0,167,193,0,0,59,193,2,0,65,113,190,193,59,193,0,0,70,193,113,193,121,193,4,0,94,190,185,187,26,190,190,1,97,185,187,190,39,190,5,32,32,190,190,97,121,190,177,0,38,193,5,32,32,193,193,0,121,193,3,0,0,190,125,0,119,0,3,0,25,193,125,9,0,190,193,0,0,139,190,0,39,190,124,2,0,52,190,0,1,190,11,0,16,190,190,3,1,193,12,0,4,193,193,3,32,193,193,0,20,190,190,193,121,190,3,0,58,168,113,0,119,0,20,0,1,190,12,0,4,126,190,3,59,127,8,0,26,126,126,1,59,190,16,0,65,127,127,190,33,190,126,0,120,190,252,255,78,190,139,0,32,190,190,45,121,190,6,0,68,190,113,0,64,190,190,127,63,190,127,190,68,168,190,0,119,0,4,0,63,190,113,127,64,168,190,127,119,0,1,0,94,11,185,187,34,193,11,0,121,193,5,0,1,193,0,0,4,193,193,11,0,190,193,0,119,0,2,0,0,190,11,0,0,62,190,0,34,190,62,0,41,190,190,31,42,190,190,31,134,12,0,0,212,22,2,0,62,190,53,0,45,190,12,53,32,3,0,0,1,190,28,2,3,190,185,190,1,193,48,0,107,190,11,193,1,193,28,2,3,193,185,193,25,85,193,11,119,0,2,0,0,85,12,0,26,193,85,1,42,190,11,31,38,190,190,2,25,190,190,43,83,193,190,0,26,98,85,2,25,190,5,15,83,98,190,0,0,129,185,0,58,169,168,0,75,67,169,0,25,99,129,1,38,190,5,32,1,193,64,28,91,193,193,67,20,190,190,193,83,129,190,0,76,190,67,0,64,190,169,190,59,193,16,0,65,169,190,193,4,193,99,185,32,193,193,1,121,193,15,0,38,193,4,8,32,193,193,0,34,190,3,1,59,189,0,0,69,189,169,189,19,190,190,189,19,193,193,190,121,193,3,0,0,130,99,0,119,0,6,0,1,193,46,0,83,99,193,0,25,130,129,2,119,0,2,0,0,130,99,0,59,193,0,0,70,193,169,193,120,193,2,0,119,0,3,0,0,129,130,0,119,0,222,255,0,8,130,0,120,3,3,0,1,184,25,0,119,0,13,0,1,193,254,255,4,193,193,185,3,193,193,8,47,193,193,3,20,4,0,0,25,193,3,2,3,193,193,53,4,112,193,98,0,150,53,0,0,151,98,0,119,0,2,0,1,184,25,0,32,193,184,25,121,193,6,0,4,193,53,185,4,193,193,98,3,112,193,8,0,150,53,0,0,151,98,0,3,48,112,52,1,190,32,0,134,193,0,0,16,119,2,0,0,190,2,48,4,0,0,0,134,193,0,0,232,156,2,0,0,139,52,0,1,190,48,0,2,189,0,0,0,0,1,0,21,189,4,189,134,193,0,0,16,119,2,0,0,190,2,48,189,0,0,0,4,189,8,185,134,193,0,0,232,156,2,0,0,185,189,0,4,152,150,151,1,189,48,0,4,190,8,185,3,190,190,152,4,190,112,190,1,192,0,0,1,191,0,0,134,193,0,0,16,119,2,0,0,189,190,192,191,0,0,0,134,193,0,0,232,156,2,0,0,98,152,0,1,191,32,0,1,192,0,32,21,192,4,192,134,193,0,0,16,119,2,0,0,191,2,48,192,0,0,0,0,51,48,0,119,0,39,3,34,193,3,0,1,192,6,0,125,140,193,192,3,0,0,0,59,192,0,0,70,192,113,192,121,192,9,0,94,192,185,187,26,155,192,28,97,185,187,155,0,6,155,0,60,192,0,0,0,0,0,16,65,170,113,192,119,0,3,0,94,6,185,187,58,170,113,0,34,193,6,0,121,193,4,0,25,193,185,32,0,192,193,0,119,0,5,0,25,193,185,32,1,191,32,1,3,193,193,191,0,192,193,0,0,172,192,0,58,171,170,0,0,173,172,0,75,68,171,0,85,173,68,0,25,173,173,4,77,192,68,0,64,192,171,192,60,193,0,0,0,202,154,59,65,171,192,193,59,193,0,0,70,193,171,193,120,193,246,255,1,193,0,0,47,193,193,6,196,6,0,0,0,13,6,0,0,36,172,0,0,175,173,0,34,193,13,29,1,192,29,0,125,63,193,13,192,0,0,0,26,69,175,4,48,192,69,36,192,5,0,0,0,37,36,0,119,0,37,0,1,56,0,0,0,70,69,0,82,192,70,0,1,193,0,0,135,14,2,0,192,193,63,0,135,193,1,0,1,192,0,0,134,16,0,0,48,154,2,0,14,193,56,192,135,17,1,0,1,192,0,0,134,56,0,0,40,155,2,0,16,17,186,192,135,192,1,0,1,193,0,0,134,18,0,0,228,138,2,0,56,192,186,193,135,193,1,0,134,19,0,0,204,151,2,0,16,17,18,193,135,193,1,0,85,70,19,0,26,70,70,4,57,193,36,70,200,5,0,0,120,56,3,0,0,37,36,0,119,0,4,0,26,100,36,4,85,100,56,0,0,37,100,0,48,193,37,175,136,6,0,0,0,177,175,0,26,54,177,4,82,193,54,0,121,193,3,0,0,176,177,0,119,0,8,0,48,193,37,54,128,6,0,0,0,177,54,0,119,0,248,255,0,176,54,0,119,0,2,0,0,176,175,0,94,193,185,187,4,156,193,63,97,185,187,156,1,193,0,0,47,193,193,156,180,6,0,0,0,13,156,0,0,36,37,0,0,175,176,0,119,0,187,255,0,7,156,0,0,35,37,0,0,174,176,0,119,0,4,0,0,7,6,0,0,35,172,0,0,174,173,0,34,193,7,0,121,193,84,0,0,20,7,0,0,39,35,0,0,179,174,0,1,193,0,0,4,157,193,20,34,193,157,9,1,192,9,0,125,64,193,157,192,0,0,0,48,192,39,179,128,7,0,0,1,57,0,0,0,71,39,0,82,21,71,0,24,192,21,64,3,192,192,57,85,71,192,0,1,192,1,0,22,192,192,64,26,192,192,1,19,192,21,192,24,193,186,64,5,57,192,193,25,71,71,4,55,193,71,179,12,7,0,0,82,192,39,0,32,192,192,0,121,192,4,0,25,192,39,4,0,193,192,0,119,0,2,0,0,193,39,0,0,141,193,0,120,57,4,0,0,142,141,0,0,180,179,0,119,0,14,0,85,179,57,0,0,142,141,0,25,180,179,4,119,0,10,0,82,192,39,0,32,192,192,0,121,192,4,0,25,192,39,4,0,193,192,0,119,0,2,0,0,193,39,0,0,142,193,0,0,180,179,0,39,193,5,32,32,193,193,102,125,65,193,172,142,0,0,0,25,192,140,25,28,192,192,9,25,192,192,1,4,191,180,65,42,191,191,2,47,192,192,191,236,7,0,0,25,192,140,25,28,192,192,9,25,192,192,1,41,192,192,2,3,192,65,192,0,193,192,0,119,0,2,0,0,193,180,0,0,143,193,0,94,193,185,187,3,20,193,64,97,185,187,20,1,193,0,0,49,193,193,20,24,8,0,0,0,38,142,0,0,178,143,0,119,0,6,0,0,39,142,0,0,179,143,0,119,0,177,255,0,38,35,0,0,178,174,0,48,193,38,178,124,8,0,0,4,193,172,38,42,193,193,2,27,114,193,9,82,22,38,0,35,193,22,10,121,193,3,0,0,81,114,0,119,0,12,0,0,80,114,0,1,89,10,0,27,89,89,10,25,94,80,1,48,193,22,89,116,8,0,0,0,81,94,0,119,0,4,0,0,80,94,0,119,0,249,255,1,81,0,0,39,192,5,32,32,192,192,102,1,191,0,0,125,193,192,191,81,0,0,0,4,193,140,193,33,191,140,0,39,192,5,32,32,192,192,103,19,191,191,192,41,191,191,31,42,191,191,31,3,158,193,191,4,191,178,172,42,191,191,2,27,191,191,9,26,191,191,9,47,191,158,191,84,11,0,0,25,191,172,4,1,193,0,36,3,193,158,193,28,193,193,9,1,192,0,4,4,193,193,192,41,193,193,2,3,46,191,193,1,193,0,36,3,193,158,193,1,191,0,36,3,191,158,191,28,191,191,9,27,191,191,9,4,23,193,191,34,191,23,8,121,191,11,0,1,91,10,0,0,109,23,0,27,115,91,10,34,191,109,7,121,191,4,0,0,91,115,0,25,109,109,1,119,0,251,255,0,90,115,0,119,0,2,0,1,90,10,0,82,24,46,0,7,78,24,90,5,191,78,90,4,25,24,191,25,191,46,4,13,58,191,178,32,191,25,0,19,191,58,191,121,191,5,0,0,43,38,0,0,74,46,0,0,83,81,0,119,0,115,0,38,193,78,1,32,193,193,0,121,193,5,0,61,193,0,0,0,0,0,90,58,191,193,0,119,0,5,0,62,193,0,0,1,0,0,0,0,0,64,67,58,191,193,0,58,144,191,0,43,191,90,1,0,79,191,0,48,193,25,79,192,9,0,0,61,193,0,0,0,0,0,63,58,191,193,0,119,0,11,0,13,192,25,79,19,192,58,192,121,192,4,0,59,192,1,0,58,193,192,0,119,0,4,0,61,192,0,0,0,0,192,63,58,193,192,0,58,191,193,0,58,149,191,0,120,124,4,0,58,128,144,0,58,138,149,0,119,0,15,0,78,191,125,0,32,59,191,45,121,59,4,0,68,193,144,0,58,191,193,0,119,0,2,0,58,191,144,0,58,128,191,0,121,59,4,0,68,193,149,0,58,191,193,0,119,0,2,0,58,191,149,0,58,138,191,0,4,191,24,25,85,46,191,0,63,191,128,138,70,191,191,128,121,191,58,0,4,191,24,25,3,49,191,90,85,46,49,0,2,191,0,0,255,201,154,59,48,191,191,49,204,10,0,0,0,41,38,0,0,73,46,0,26,101,73,4,1,191,0,0,85,73,191,0,48,191,101,41,148,10,0,0,26,102,41,4,1,191,0,0,85,102,191,0,0,42,102,0,119,0,2,0,0,42,41,0,82,191,101,0,25,95,191,1,85,101,95,0,2,191,0,0,255,201,154,59,48,191,191,95,192,10,0,0,0,41,42,0,0,73,101,0,119,0,236,255,0,40,42,0,0,72,101,0,119,0,3,0,0,40,38,0,0,72,46,0,4,191,172,40,42,191,191,2,27,116,191,9,82,26,40,0,35,191,26,10,121,191,5,0,0,43,40,0,0,74,72,0,0,83,116,0,119,0,16,0,0,82,116,0,1,92,10,0,27,92,92,10,25,96,82,1,48,191,26,92,36,11,0,0,0,43,40,0,0,74,72,0,0,83,96,0,119,0,6,0,0,82,96,0,119,0,247,255,0,43,38,0,0,74,46,0,0,83,81,0,25,47,74,4,0,44,43,0,0,84,83,0,16,191,47,178,125,181,191,47,178,0,0,0,119,0,4,0,0,44,38,0,0,84,81,0,0,181,178,0,1,191,0,0,4,161,191,84,48,191,44,181,168,11,0,0,0,183,181,0,26,55,183,4,82,191,55,0,121,191,4,0,1,60,1,0,0,182,183,0,119,0,10,0,48,191,44,55,156,11,0,0,0,183,55,0,119,0,247,255,1,60,0,0,0,182,55,0,119,0,3,0,1,60,0,0,0,182,181,0,39,191,5,32,32,191,191,103,121,191,80,0,33,191,140,0,40,191,191,1,38,191,191,1,3,191,140,191,15,191,84,191,1,193,251,255,15,193,193,84,19,191,191,193,121,191,9,0,33,191,140,0,40,191,191,1,38,191,191,1,3,191,140,191,26,191,191,1,4,118,191,84,26,164,5,1,119,0,7,0,33,191,140,0,40,191,191,1,38,191,191,1,3,191,140,191,26,118,191,1,26,164,5,2,38,191,4,8,120,191,52,0,121,60,20,0,26,191,182,4,82,27,191,0,120,27,3,0,1,111,9,0,119,0,16,0,31,191,27,10,120,191,11,0,1,93,10,0,1,110,0,0,27,93,93,10,25,97,110,1,9,191,27,93,121,191,3,0,0,111,97,0,119,0,6,0,0,110,97,0,119,0,249,255,1,111,0,0,119,0,2,0,1,111,9,0,4,191,182,172,42,191,191,2,27,191,191,9,26,117,191,9,39,191,164,32,32,191,191,102,121,191,12,0,4,159,117,111,1,191,0,0,15,191,191,159,1,193,0,0,125,145,191,159,193,0,0,0,15,193,118,145,125,119,193,118,145,0,0,0,0,165,164,0,119,0,18,0,3,193,117,84,4,160,193,111,1,193,0,0,15,193,193,160,1,191,0,0,125,146,193,160,191,0,0,0,15,191,118,146,125,119,191,118,146,0,0,0,0,165,164,0,119,0,6,0,0,119,118,0,0,165,164,0,119,0,3,0,0,119,140,0,0,165,5,0,33,166,119,0,121,166,4,0,1,193,1,0,0,191,193,0,119,0,4,0,43,193,4,3,38,193,193,1,0,191,193,0,0,28,191,0,39,191,165,32,32,61,191,102,121,61,8,0,1,88,0,0,1,191,0,0,15,191,191,84,1,193,0,0,125,153,191,84,193,0,0,0,119,0,34,0,34,193,84,0,125,66,193,161,84,0,0,0,34,193,66,0,41,193,193,31,42,193,193,31,134,29,0,0,212,22,2,0,66,193,53,0,4,193,53,29,34,193,193,2,121,193,12,0,0,87,29,0,26,103,87,1,1,193,48,0,83,103,193,0,4,193,53,103,34,193,193,2,121,193,3,0,0,87,103,0,119,0,249,255,0,86,103,0,119,0,2,0,0,86,29,0,26,193,86,1,42,191,84,31,38,191,191,2,25,191,191,43,83,193,191,0,26,104,86,2,83,104,165,0,0,88,104,0,4,153,53,104,25,191,124,1,3,191,191,119,3,191,191,28,3,50,191,153,1,193,32,0,134,191,0,0,16,119,2,0,0,193,2,50,4,0,0,0,134,191,0,0,232,156,2,0,0,125,124,0,1,193,48,0,2,192,0,0,0,0,1,0,21,192,4,192,134,191,0,0,16,119,2,0,0,193,2,50,192,0,0,0,121,61,110,0,16,191,172,44,125,147,191,172,44,0,0,0,0,75,147,0,82,191,75,0,1,192,0,0,25,193,185,9,134,30,0,0,212,22,2,0,191,192,193,0,45,193,75,147,120,14,0,0,25,193,185,9,45,193,30,193,112,14,0,0,1,192,48,0,107,185,8,192,25,132,185,8,119,0,18,0,0,132,30,0,119,0,16,0,48,192,185,30,176,14,0,0,1,193,48,0,4,191,30,185,135,192,3,0,185,193,191,0,0,131,30,0,26,105,131,1,48,192,185,105,168,14,0,0,0,131,105,0,119,0,252,255,0,132,105,0,119,0,2,0,0,132,30,0,25,191,185,9,4,191,191,132,134,192,0,0,232,156,2,0,0,132,191,0,25,75,75,4,57,192,75,172,52,14,0,0,38,192,4,8,32,192,192,0,40,191,166,1,19,192,192,191,120,192,5,0,1,191,1,0,134,192,0,0,232,156,2,0,0,188,191,0,16,192,75,182,1,191,0,0,15,191,191,119,19,192,192,191,121,192,42,0,0,76,75,0,0,121,119,0,82,192,76,0,1,191,0,0,25,193,185,9,134,31,0,0,212,22,2,0,192,191,193,0,48,193,185,31,100,15,0,0,1,191,48,0,4,192,31,185,135,193,3,0,185,191,192,0,0,134,31,0,26,106,134,1,48,193,185,106,92,15,0,0,0,134,106,0,119,0,252,255,0,133,106,0,119,0,2,0,0,133,31,0,34,191,121,9,1,190,9,0,125,192,191,121,190,0,0,0,134,193,0,0,232,156,2,0,0,133,192,0,25,76,76,4,26,162,121,9,16,193,76,182,1,192,9,0,15,192,192,121,19,193,193,192,120,193,3,0,0,120,162,0,119,0,4,0,0,121,162,0,119,0,218,255,0,120,119,0,1,192,48,0,25,190,120,9,1,191,9,0,1,189,0,0,134,193,0,0,16,119,2,0,0,192,190,191,189,0,0,0,119,0,98,0,121,60,3,0,0,193,182,0,119,0,3,0,25,189,44,4,0,193,189,0,0,148,193,0,16,193,44,148,1,189,255,255,15,189,189,119,19,193,193,189,121,193,74,0,0,77,44,0,0,123,119,0,82,193,77,0,1,189,0,0,25,191,185,9,134,33,0,0,212,22,2,0,193,189,191,0,25,191,185,9,45,191,33,191,64,16,0,0,1,189,48,0,107,185,8,189,25,135,185,8,119,0,2,0,0,135,33,0,45,189,77,44,148,16,0,0,25,108,135,1,1,191,1,0,134,189,0,0,232,156,2,0,0,135,191,0,38,189,4,8,32,189,189,0,34,191,123,1,19,189,189,191,121,189,3,0,0,137,108,0,119,0,25,0,1,191,1,0,134,189,0,0,232,156,2,0,0,188,191,0,0,137,108,0,119,0,19,0,50,189,135,185,164,16,0,0,0,137,135,0,119,0,15,0,1,191,48,0,1,193,0,0,4,193,193,185,3,193,135,193,135,189,3,0,185,191,193,0,0,136,135,0,26,107,136,1,48,189,185,107,212,16,0,0,0,136,107,0,119,0,252,255,0,137,107,0,119,0,1,0,25,189,185,9,4,154,189,137,15,191,154,123,125,193,191,154,123,0,0,0,134,189,0,0,232,156,2,0,0,137,193,0,4,163,123,154,25,77,77,4,16,189,77,148,1,193,255,255,15,193,193,163,19,189,189,193,120,189,3,0,0,122,163,0,119,0,4,0,0,123,163,0,119,0,186,255,0,122,119,0,1,193,48,0,25,191,122,18,1,190,18,0,1,192,0,0,134,189,0,0,16,119,2,0,0,193,191,190,192,0,0,0,4,192,53,88,134,189,0,0,232,156,2,0,0,88,192,0,1,192,32,0,1,190,0,32,21,190,4,190,134,189,0,0,16,119,2,0,0,192,2,50,190,0,0,0,0,51,50,0,137,185,0,0,15,190,51,2,125,189,190,2,51,0,0,0,139,189,0,0,140,2,105,0,0,0,0,0,136,97,0,0,0,96,97,0,136,97,0,0,1,98,192,0,3,97,97,98,137,97,0,0,130,97,0,0,136,98,0,0,49,97,97,98,204,17,0,0,1,98,192,0,135,97,0,0,98,0,0,0,1,97,184,0,3,91,96,97,1,97,180,0,3,75,96,97,1,97,176,0,3,95,96,97,1,97,172,0,3,63,96,97,1,97,168,0,3,80,96,97,1,97,164,0,3,94,96,97,1,97,160,0,3,93,96,97,1,97,156,0,3,40,96,97,1,97,152,0,3,27,96,97,1,97,148,0,3,92,96,97,1,97,144,0,3,54,96,97,1,97,140,0,3,83,96,97,1,97,136,0,3,78,96,97,1,97,132,0,3,57,96,97,1,97,128,0,3,56,96,97,25,53,96,124,25,46,96,120,25,55,96,116,25,81,96,112,25,82,96,108,25,89,96,104,25,90,96,100,25,76,96,96,25,77,96,92,25,79,96,88,25,47,96,84,25,48,96,80,25,84,96,76,25,41,96,72,25,58,96,68,25,51,96,64,25,87,96,60,25,44,96,56,25,61,96,52,25,52,96,48,25,88,96,44,25,45,96,40,25,62,96,36,25,49,96,32,25,85,96,28,25,42,96,24,25,59,96,20,25,50,96,16,25,86,96,12,25,43,96,8,25,60,96,4,0,39,96,0,85,91,0,0,85,75,1,0,82,97,91,0,25,97,97,20,116,80,97,0,82,97,91,0,25,97,97,108,116,94,97,0,82,97,91,0,25,97,97,112,116,93,97,0,82,97,91,0,25,97,97,64,116,40,97,0,82,97,91,0,25,97,97,68,116,27,97,0,82,97,91,0,25,97,97,76,116,92,97,0,82,97,91,0,25,97,97,96,116,54,97,0,82,97,91,0,1,98,164,0,3,97,97,98,116,83,97,0,82,97,91,0,25,97,97,16,116,78,97,0,82,97,91,0,1,98,184,0,3,97,97,98,116,57,97,0,82,97,92,0,41,97,97,1,82,98,54,0,3,97,97,98,85,56,97,0,82,97,91,0,1,98,132,0,3,97,97,98,116,53,97,0,116,55,75,0,82,97,91,0,1,98,180,0,3,97,97,98,116,81,97,0,82,97,91,0,1,98,176,0,3,97,97,98,116,82,97,0,82,97,91,0,1,98,168,0,3,97,97,98,116,89,97,0,82,97,91,0,1,98,160,0,94,97,97,98,29,97,97,4,85,90,97,0,82,98,53,0,82,99,55,0,5,97,98,99,85,47,97,0,82,97,94,0,82,99,55,0,41,99,99,3,3,97,97,99,116,76,97,0,82,97,94,0,82,99,55,0,41,99,99,3,3,97,97,99,25,97,97,4,116,77,97,0,82,99,75,0,82,98,91,0,106,98,98,28,5,97,99,98,85,79,97,0,82,98,91,0,134,97,0,0,212,145,2,0,98,0,0,0,120,97,7,0,1,98,83,54,1,99,90,48,1,100,105,7,1,101,232,54,135,97,4,0,98,99,100,101,82,101,57,0,1,100,0,0,82,98,80,0,41,98,98,2,82,102,40,0,5,99,98,102,135,97,3,0,101,100,99,0,1,97,0,0,85,46,97,0,82,97,40,0,1,103,1,0,1,99,4,0,138,97,103,99,244,21,0,0,48,23,0,0,196,24,0,0,168,26,0,0,116,63,76,0,82,99,77,0,82,100,63,0,54,99,99,100,180,21,0,0,82,12,46,0,25,99,12,1,85,46,99,0,85,50,12,0,82,100,63,0,82,101,81,0,82,102,82,0,82,98,89,0,82,103,83,0,82,104,90,0,134,99,0,0,28,255,1,0,100,101,102,98,103,104,0,0,85,86,99,0,82,104,93,0,82,103,47,0,82,98,50,0,3,103,103,98,41,103,103,2,100,99,104,103,145,99,99,0,89,43,99,0,1,99,0,0,85,95,99,0,82,99,80,0,82,104,95,0,56,99,99,104,164,21,0,0,82,104,95,0,82,103,40,0,5,99,104,103,85,60,99,0,1,99,0,0,85,39,99,0,82,99,40,0,82,103,39,0,56,99,99,103,148,21,0,0,82,99,86,0,82,103,60,0,82,104,39,0,3,103,103,104,41,103,103,2,100,13,99,103,145,13,13,0,88,99,43,0,145,99,99,0,65,69,13,99,145,69,69,0,82,99,57,0,82,103,60,0,82,104,39,0,3,103,103,104,41,103,103,2,3,33,99,103,88,99,33,0,145,99,99,0,63,103,99,69,145,103,103,0,89,33,103,0,82,103,39,0,25,103,103,1,85,39,103,0,119,0,227,255,82,103,95,0,25,103,103,1,85,95,103,0,119,0,213,255,82,103,63,0,25,103,103,1,85,63,103,0,119,0,180,255,82,14,91,0,82,15,80,0,82,16,78,0,82,17,79,0,3,26,16,17,82,18,57,0,82,19,40,0,82,20,27,0,82,21,56,0,134,103,0,0,68,110,0,0,14,15,26,18,19,20,21,0,137,96,0,0,139,0,0,0,119,0,187,1,116,63,76,0,82,99,77,0,82,100,63,0,54,99,99,100,240,22,0,0,82,22,46,0,25,99,22,1,85,46,99,0,85,48,22,0,82,100,63,0,82,101,81,0,82,102,82,0,82,98,89,0,82,103,83,0,82,104,90,0,134,99,0,0,28,255,1,0,100,101,102,98,103,104,0,0,85,84,99,0,82,104,93,0,82,103,47,0,82,98,48,0,3,103,103,98,41,103,103,2,100,99,104,103,145,99,99,0,89,41,99,0,1,99,0,0,85,95,99,0,82,99,80,0,82,104,95,0,56,99,99,104,224,22,0,0,116,58,95,0,82,99,84,0,82,104,58,0,25,104,104,0,41,104,104,2,100,23,99,104,145,23,23,0,88,99,41,0,145,99,99,0,65,70,23,99,145,70,70,0,82,99,57,0,82,104,58,0,25,104,104,0,41,104,104,2,3,34,99,104,88,99,34,0,145,99,99,0,63,104,99,70,145,104,104,0,89,34,104,0,82,104,95,0,25,104,104,1,85,95,104,0,119,0,228,255,82,104,63,0,25,104,104,1,85,63,104,0,119,0,195,255,82,14,91,0,82,15,80,0,82,16,78,0,82,17,79,0,3,26,16,17,82,18,57,0,82,19,40,0,82,20,27,0,82,21,56,0,134,104,0,0,68,110,0,0,14,15,26,18,19,20,21,0,137,96,0,0,139,0,0,0,119,0,1,0,116,63,76,0,82,104,77,0,82,99,63,0,54,104,104,99,132,24,0,0,82,24,46,0,25,104,24,1,85,46,104,0,85,51,24,0,82,99,63,0,82,103,81,0,82,98,82,0,82,102,89,0,82,101,83,0,82,100,90,0,134,104,0,0,28,255,1,0,99,103,98,102,101,100,0,0,85,87,104,0,82,100,93,0,82,101,47,0,82,102,51,0,3,101,101,102,41,101,101,2,100,104,100,101,145,104,104,0,89,44,104,0,1,104,0,0,85,95,104,0,82,104,80,0,82,100,95,0,56,104,104,100,116,24,0,0,82,104,95,0,41,104,104,1,85,61,104,0,82,104,87,0,82,100,61,0,25,100,100,0,41,100,100,2,100,25,104,100,145,25,25,0,88,104,44,0,145,104,104,0,65,71,25,104,145,71,71,0,82,104,57,0,82,100,61,0,25,100,100,0,41,100,100,2,3,35,104,100,88,104,35,0,145,104,104,0,63,100,104,71,145,100,100,0,89,35,100,0,82,100,87,0,82,104,61,0,25,104,104,1,41,104,104,2,100,2,100,104,145,2,2,0,88,100,44,0,145,100,100,0,65,72,2,100,145,72,72,0,82,100,57,0,82,104,61,0,25,104,104,1,41,104,104,2,3,36,100,104,88,100,36,0,145,100,100,0,63,104,100,72,145,104,104,0,89,36,104,0,82,104,95,0,25,104,104,1,85,95,104,0,119,0,206,255,82,104,63,0,25,104,104,1,85,63,104,0,119,0,173,255,82,14,91,0,82,15,80,0,82,16,78,0,82,17,79,0,3,26,16,17,82,18,57,0,82,19,40,0,82,20,27,0,82,21,56,0,134,104,0,0,68,110,0,0,14,15,26,18,19,20,21,0,137,96,0,0,139,0,0,0,119,0,1,0,116,63,76,0,82,104,77,0,82,100,63,0,54,104,104,100,104,26,0,0,82,3,46,0,25,104,3,1,85,46,104,0,85,52,3,0,82,100,63,0,82,101,81,0,82,102,82,0,82,98,89,0,82,103,83,0,82,99,90,0,134,104,0,0,28,255,1,0,100,101,102,98,103,99,0,0,85,88,104,0,82,99,93,0,82,103,47,0,82,98,52,0,3,103,103,98,41,103,103,2,100,104,99,103,145,104,104,0,89,45,104,0,1,104,0,0,85,95,104,0,82,104,80,0,82,99,95,0,56,104,104,99,88,26,0,0,82,104,95,0,27,104,104,3,85,62,104,0,82,104,88,0,82,99,62,0,25,99,99,0,41,99,99,2,100,4,104,99,145,4,4,0,88,104,45,0,145,104,104,0,65,73,4,104,145,73,73,0,82,104,57,0,82,99,62,0,25,99,99,0,41,99,99,2,3,37,104,99,88,104,37,0,145,104,104,0,63,99,104,73,145,99,99,0,89,37,99,0,82,99,88,0,82,104,62,0,25,104,104,1,41,104,104,2,100,5,99,104,145,5,5,0,88,99,45,0,145,99,99,0,65,74,5,99,145,74,74,0,82,99,57,0,82,104,62,0,25,104,104,1,41,104,104,2,3,38,99,104,88,99,38,0,145,99,99,0,63,104,99,74,145,104,104,0,89,38,104,0,82,104,88,0,82,99,62,0,25,99,99,2,41,99,99,2,100,6,104,99,145,6,6,0,88,104,45,0,145,104,104,0,65,64,6,104,145,64,64,0,82,104,57,0,82,99,62,0,25,99,99,2,41,99,99,2,3,28,104,99,88,104,28,0,145,104,104,0,63,99,104,64,145,99,99,0,89,28,99,0,82,99,95,0,25,99,99,1,85,95,99,0,119,0,186,255,82,99,63,0,25,99,99,1,85,63,99,0,119,0,153,255,82,14,91,0,82,15,80,0,82,16,78,0,82,17,79,0,3,26,16,17,82,18,57,0,82,19,40,0,82,20,27,0,82,21,56,0,134,99,0,0,68,110,0,0,14,15,26,18,19,20,21,0,137,96,0,0,139,0,0,0,119,0,1,0,116,63,76,0,82,99,77,0,82,104,63,0,54,99,99,104,156,28,0,0,82,7,46,0,25,99,7,1,85,46,99,0,85,49,7,0,82,104,63,0,82,103,81,0,82,98,82,0,82,102,89,0,82,101,83,0,82,100,90,0,134,99,0,0,28,255,1,0,104,103,98,102,101,100,0,0,85,85,99,0,82,100,93,0,82,101,47,0,82,102,49,0,3,101,101,102,41,101,101,2,100,99,100,101,145,99,99,0,89,42,99,0,1,99,0,0,85,95,99,0,82,99,80,0,82,100,95,0,56,99,99,100,140,28,0,0,82,99,95,0,41,99,99,2,85,59,99,0,82,99,85,0,82,100,59,0,25,100,100,0,41,100,100,2,100,8,99,100,145,8,8,0,88,99,42,0,145,99,99,0,65,65,8,99,145,65,65,0,82,99,57,0,82,100,59,0,25,100,100,0,41,100,100,2,3,29,99,100,88,99,29,0,145,99,99,0,63,100,99,65,145,100,100,0,89,29,100,0,82,100,85,0,82,99,59,0,25,99,99,1,41,99,99,2,100,9,100,99,145,9,9,0,88,100,42,0,145,100,100,0,65,66,9,100,145,66,66,0,82,100,57,0,82,99,59,0,25,99,99,1,41,99,99,2,3,30,100,99,88,100,30,0,145,100,100,0,63,99,100,66,145,99,99,0,89,30,99,0,82,99,85,0,82,100,59,0,25,100,100,2,41,100,100,2,100,10,99,100,145,10,10,0,88,99,42,0,145,99,99,0,65,67,10,99,145,67,67,0,82,99,57,0,82,100,59,0,25,100,100,2,41,100,100,2,3,31,99,100,88,99,31,0,145,99,99,0,63,100,99,67,145,100,100,0,89,31,100,0,82,100,85,0,82,99,59,0,25,99,99,3,41,99,99,2,100,11,100,99,145,11,11,0,88,100,42,0,145,100,100,0,65,68,11,100,145,68,68,0,82,100,57,0,82,99,59,0,25,99,99,3,41,99,99,2,3,32,100,99,88,100,32,0,145,100,100,0,63,99,100,68,145,99,99,0,89,32,99,0,82,99,95,0,25,99,99,1,85,95,99,0,119,0,166,255,82,99,63,0,25,99,99,1,85,63,99,0,119,0,133,255,82,14,91,0,82,15,80,0,82,16,78,0,82,17,79,0,3,26,16,17,82,18,57,0,82,19,40,0,82,20,27,0,82,21,56,0,134,99,0,0,68,110,0,0,14,15,26,18,19,20,21,0,137,96,0,0,139,0,0,0,119,0,233,253,139,0,0,0,140,7,163,0,0,0,0,0,2,156,0,0,148,61,0,0,2,157,0,0,255,0,0,0,2,158,0,0,0,8,0,0,1,153,0,0,136,159,0,0,0,154,159,0,136,159,0,0,25,159,159,64,137,159,0,0,130,159,0,0,136,160,0,0,49,159,159,160,52,29,0,0,1,160,64,0,135,159,0,0,160,0,0,0,25,127,154,56,25,64,154,40,0,70,154,0,25,148,154,48,25,111,154,60,85,127,1,0,33,142,0,0,25,58,70,40,0,134,58,0,25,59,70,39,25,68,148,4,1,80,0,0,1,105,0,0,1,107,0,0,0,79,80,0,0,104,105,0,1,159,255,255,47,159,159,79,180,29,0,0,2,159,0,0,255,255,255,127,4,159,159,79,47,159,159,104,172,29,0,0,134,159,0,0,144,162,2,0,1,160,61,0,85,159,160,0,1,81,255,255,119,0,4,0,3,81,104,79,119,0,2,0,0,81,79,0,82,11,127,0,78,12,11,0,41,160,12,24,42,160,160,24,120,160,3,0,1,153,92,0,119,0,127,3,0,34,12,0,0,36,11,0,41,160,34,24,42,160,160,24,1,159,0,0,1,161,38,0,138,160,159,161,140,30,0,0,136,30,0,0,136,30,0,0,136,30,0,0,136,30,0,0,136,30,0,0,136,30,0,0,136,30,0,0,136,30,0,0,136,30,0,0,136,30,0,0,136,30,0,0,136,30,0,0,136,30,0,0,136,30,0,0,136,30,0,0,136,30,0,0,136,30,0,0,136,30,0,0,136,30,0,0,136,30,0,0,136,30,0,0,136,30,0,0,136,30,0,0,136,30,0,0,136,30,0,0,136,30,0,0,136,30,0,0,136,30,0,0,136,30,0,0,136,30,0,0,136,30,0,0,136,30,0,0,136,30,0,0,136,30,0,0,136,30,0,0,136,30,0,0,148,30,0,0,119,0,5,0,0,151,36,0,119,0,8,0,1,153,10,0,119,0,6,0,25,100,36,1,85,127,100,0,78,34,100,0,0,36,100,0,119,0,204,255,32,160,153,10,121,160,19,0,1,153,0,0,0,40,36,0,0,152,36,0,102,160,40,1,33,160,160,37,121,160,3,0,0,151,152,0,119,0,11,0,25,101,152,1,25,40,40,2,85,127,40,0,78,160,40,0,33,160,160,37,121,160,3,0,0,151,101,0,119,0,3,0,0,152,101,0,119,0,242,255,4,104,151,11,121,142,4,0,134,160,0,0,232,156,2,0,0,11,104,0,120,104,2,0,119,0,3,0,0,79,81,0,119,0,149,255,82,159,127,0,102,159,159,1,134,160,0,0,0,161,2,0,159,0,0,0,32,143,160,0,82,8,127,0,121,143,5,0,1,10,1,0,1,65,255,255,0,108,107,0,119,0,12,0,102,160,8,2,32,160,160,36,121,160,6,0,1,10,3,0,102,160,8,1,26,65,160,48,1,108,1,0,119,0,4,0,1,10,1,0,1,65,255,255,0,108,107,0,3,102,8,10,85,127,102,0,78,15,102,0,41,160,15,24,42,160,160,24,26,138,160,32,1,160,31,0,16,160,160,138,1,159,1,0,22,159,159,138,2,161,0,0,137,40,1,0,19,159,159,161,32,159,159,0,20,160,160,159,121,160,5,0,0,7,15,0,1,87,0,0,0,131,102,0,119,0,31,0,1,88,0,0,0,132,102,0,0,139,138,0,1,160,1,0,22,160,160,139,20,160,160,88,0,112,160,0,25,103,132,1,85,127,103,0,78,18,103,0,41,160,18,24,42,160,160,24,26,139,160,32,1,160,31,0,16,160,160,139,1,159,1,0,22,159,159,139,2,161,0,0,137,40,1,0,19,159,159,161,32,159,159,0,20,160,160,159,121,160,5,0,0,7,18,0,0,87,112,0,0,131,103,0,119,0,4,0,0,88,112,0,0,132,103,0,119,0,230,255,41,160,7,24,42,160,160,24,32,160,160,42,121,160,71,0,102,159,131,1,134,160,0,0,0,161,2,0,159,0,0,0,120,160,3,0,1,153,27,0,119,0,19,0,82,28,127,0,102,160,28,2,32,160,160,36,121,160,14,0,25,69,28,1,78,160,69,0,26,160,160,48,41,160,160,2,1,159,10,0,97,4,160,159,1,109,1,0,25,133,28,3,78,159,69,0,26,159,159,48,41,159,159,3,94,145,3,159,119,0,2,0,1,153,27,0,32,159,153,27,121,159,25,0,1,153,0,0,121,108,3,0,1,126,255,255,119,0,191,2,121,142,15,0,82,159,2,0,1,160,4,0,26,160,160,1,3,159,159,160,1,160,4,0,26,160,160,1,11,160,160,0,19,159,159,160,0,35,159,0,82,37,35,0,25,159,35,4,85,2,159,0,0,82,37,0,119,0,2,0,1,82,0,0,1,109,0,0,82,159,127,0,25,133,159,1,0,145,82,0,85,127,133,0,34,78,145,0,0,38,133,0,121,78,5,0,1,160,0,32,20,160,87,160,0,159,160,0,119,0,2,0,0,159,87,0,0,89,159,0,0,110,109,0,121,78,5,0,1,160,0,0,4,160,160,145,0,159,160,0,119,0,2,0,0,159,145,0,0,146,159,0,119,0,12,0,134,71,0,0,196,142,2,0,127,0,0,0,34,159,71,0,121,159,3,0,1,126,255,255,119,0,145,2,82,38,127,0,0,89,87,0,0,110,108,0,0,146,71,0,78,159,38,0,32,159,159,46,121,159,61,0,25,66,38,1,78,159,66,0,33,159,159,42,121,159,8,0,85,127,66,0,134,72,0,0,196,142,2,0,127,0,0,0,82,9,127,0,0,115,72,0,119,0,52,0,102,160,38,2,134,159,0,0,0,161,2,0,160,0,0,0,121,159,20,0,82,39,127,0,102,159,39,3,32,159,159,36,121,159,16,0,25,67,39,2,78,159,67,0,26,159,159,48,41,159,159,2,1,160,10,0,97,4,159,160,78,160,67,0,26,160,160,48,41,160,160,3,94,41,3,160,25,56,39,4,85,127,56,0,0,9,56,0,0,115,41,0,119,0,28,0,121,110,3,0,1,126,255,255,119,0,100,2,121,142,15,0,82,160,2,0,1,159,4,0,26,159,159,1,3,160,160,159,1,159,4,0,26,159,159,1,11,159,159,0,19,160,160,159,0,42,160,0,82,43,42,0,25,160,42,4,85,2,160,0,0,83,43,0,119,0,2,0,1,83,0,0,82,160,127,0,25,57,160,2,85,127,57,0,0,9,57,0,0,115,83,0,119,0,3,0,0,9,38,0,1,115,255,255,0,44,9,0,1,130,0,0,1,160,57,0,78,159,44,0,26,159,159,65,48,160,160,159,196,34,0,0,1,126,255,255,119,0,67,2,0,155,44,0,25,44,44,1,85,127,44,0,78,160,155,0,26,160,160,65,1,159,112,26,27,161,130,58,3,159,159,161,90,45,160,159,19,160,45,157,0,85,160,0,1,160,8,0,26,159,85,1,57,160,160,159,8,35,0,0,0,130,85,0,119,0,233,255,41,160,45,24,42,160,160,24,120,160,3,0,1,126,255,255,119,0,45,2,1,160,255,255,15,76,160,65,41,160,45,24,42,160,160,24,32,160,160,19,121,160,6,0,121,76,3,0,1,126,255,255,119,0,36,2,1,153,54,0,119,0,20,0,121,76,11,0,41,160,65,2,97,4,160,85,41,160,65,3,3,46,3,160,106,47,46,4,0,48,64,0,116,48,46,0,109,48,4,47,1,153,54,0,119,0,9,0,120,142,3,0,1,126,0,0,119,0,20,2,134,160,0,0,252,169,1,0,64,85,2,6,82,49,127,0,1,153,55,0,32,160,153,54,121,160,7,0,1,153,0,0,121,142,4,0,0,49,44,0,1,153,55,0,119,0,2,0,1,106,0,0,32,160,153,55,121,160,1,2,1,153,0,0,26,160,49,1,78,86,160,0,33,159,130,0,38,161,86,15,32,161,161,3,19,159,159,161,121,159,4,0,38,159,86,223,0,160,159,0,119,0,2,0,0,160,86,0,0,140,160,0,2,160,0,0,255,255,254,255,19,160,89,160,0,63,160,0,1,160,0,32,19,160,89,160,32,160,160,0,125,128,160,89,63,0,0,0,1,160,65,0,1,162,56,0,138,140,160,162,28,37,0,0,0,37,0,0,32,37,0,0,0,37,0,0,60,37,0,0,64,37,0,0,68,37,0,0,0,37,0,0,0,37,0,0,0,37,0,0,0,37,0,0,0,37,0,0,0,37,0,0,0,37,0,0,0,37,0,0,0,37,0,0,0,37,0,0,0,37,0,0,72,37,0,0,0,37,0,0,0,37,0,0,0,37,0,0,0,37,0,0,124,37,0,0,0,37,0,0,0,37,0,0,0,37,0,0,0,37,0,0,0,37,0,0,0,37,0,0,0,37,0,0,0,37,0,0,128,37,0,0,0,37,0,0,132,37,0,0,168,37,0,0,80,38,0,0,104,38,0,0,108,38,0,0,0,37,0,0,112,38,0,0,0,37,0,0,0,37,0,0,0,37,0,0,0,37,0,0,116,38,0,0,68,39,0,0,160,39,0,0,0,37,0,0,0,37,0,0,200,39,0,0,0,37,0,0,52,40,0,0,0,37,0,0,0,37,0,0,80,40,0,0,0,55,11,0,0,92,128,0,0,119,115,0,1,122,0,0,1,125,148,61,0,135,134,0,119,0,211,0,119,0,77,0,116,148,64,0,1,160,0,0,85,68,160,0,85,64,148,0,1,118,255,255,1,153,79,0,119,0,203,0,119,0,69,0,119,0,68,0,119,0,67,0,120,115,10,0,1,159,32,0,1,162,0,0,134,160,0,0,16,119,2,0,0,159,146,162,128,0,0,0,1,94,0,0,1,153,89,0,119,0,190,0,0,118,115,0,1,153,79,0,119,0,187,0,119,0,181,0,119,0,52,0,82,159,64,0,83,59,159,0,0,55,59,0,0,92,63,0,1,119,1,0,1,122,0,0,1,125,148,61,0,135,134,0,119,0,176,0,0,19,64,0,82,20,19,0,106,21,19,4,34,160,21,0,121,160,16,0,1,160,0,0,1,159,0,0,134,22,0,0,204,151,2,0,160,159,20,21,135,23,1,0,0,24,64,0,85,24,22,0,109,24,4,23,0,25,22,0,0,26,23,0,1,120,1,0,1,123,148,61,1,153,72,0,119,0,156,0,0,25,20,0,0,26,21,0,1,159,1,8,19,159,128,159,33,159,159,0,38,159,159,1,0,120,159,0,19,160,128,158,32,160,160,0,121,160,8,0,38,161,128,1,32,161,161,0,1,162,150,61,125,160,161,156,162,0,0,0,0,159,160,0,119,0,3,0,1,160,149,61,0,159,160,0,0,123,159,0,1,153,72,0,119,0,134,0,38,160,5,1,86,162,64,0,135,106,5,0,160,0,162,146,115,128,140,0,119,0,86,1,119,0,250,255,119,0,249,255,119,0,206,255,19,160,130,157,41,160,160,24,42,160,160,24,1,159,0,0,1,161,8,0,138,160,159,161,180,38,0,0,196,38,0,0,212,38,0,0,244,38,0,0,4,39,0,0,172,38,0,0,20,39,0,0,36,39,0,0,1,106,0,0,119,0,67,1,82,159,64,0,85,159,81,0,1,106,0,0,119,0,63,1,82,159,64,0,85,159,81,0,1,106,0,0,119,0,59,1,82,51,64,0,85,51,81,0,34,161,81,0,41,161,161,31,42,161,161,31,109,51,4,161,1,106,0,0,119,0,51,1,82,161,64,0,84,161,81,0,1,106,0,0,119,0,47,1,82,161,64,0,83,161,81,0,1,106,0,0,119,0,43,1,82,161,64,0,85,161,81,0,1,106,0,0,119,0,39,1,82,52,64,0,85,52,81,0,34,159,81,0,41,159,159,31,42,159,159,31,109,52,4,159,1,106,0,0,119,0,31,1,0,16,64,0,82,159,16,0,106,160,16,4,134,17,0,0,164,136,2,0,159,160,58,0,4,136,134,17,0,54,17,0,0,91,128,0,38,159,128,8,32,159,159,0,15,161,136,115,20,159,159,161,121,159,3,0,0,160,115,0,119,0,3,0,25,159,136,1,0,160,159,0,0,117,160,0,1,121,0,0,1,124,148,61,1,153,73,0,119,0,50,0,39,160,128,8,0,90,160,0,1,160,8,0,16,160,160,115,1,159,8,0,125,116,160,115,159,0,0,0,1,141,120,0,1,153,67,0,119,0,40,0,82,30,64,0,32,159,30,0,1,160,158,61,125,84,159,160,30,0,0,0,1,160,0,0,134,73,0,0,0,166,1,0,84,160,115,0,32,144,73,0,0,55,84,0,0,92,63,0,121,144,3,0,0,160,115,0], eb + 0);
  HEAPU8.set([119,0,3,0,4,159,73,84,0,160,159,0,0,119,160,0,1,122,0,0,1,125,148,61,121,144,4,0,3,159,84,115,0,160,159,0,119,0,2,0,0,160,73,0,0,135,160,0,119,0,13,0,0,50,64,0,82,25,50,0,106,26,50,4,1,120,0,0,1,123,148,61,1,153,72,0,119,0,6,0,0,90,128,0,0,116,115,0,0,141,140,0,1,153,67,0,119,0,1,0,32,160,153,67,121,160,35,0,1,153,0,0,0,53,64,0,82,160,53,0,106,162,53,4,38,159,141,32,134,13,0,0,32,131,2,0,160,162,58,159,0,14,64,0,38,159,90,8,32,159,159,0,82,162,14,0,32,162,162,0,106,160,14,4,32,160,160,0,19,162,162,160,20,159,159,162,0,114,159,0,0,54,13,0,0,91,90,0,0,117,116,0,1,159,0,0,1,162,2,0,125,121,114,159,162,0,0,0,121,114,3,0,0,162,156,0,119,0,4,0,43,159,141,4,3,159,156,159,0,162,159,0,0,124,162,0,1,153,73,0,119,0,82,0,32,162,153,72,121,162,11,0,1,153,0,0,134,54,0,0,212,22,2,0,25,26,58,0,0,91,128,0,0,117,115,0,0,121,120,0,0,124,123,0,1,153,73,0,119,0,70,0,32,162,153,79,121,162,68,0,1,153,0,0,1,95,0,0,82,149,64,0,82,31,149,0,120,31,3,0,0,93,95,0,119,0,19,0,134,74,0,0,120,155,2,0,111,31,0,0,34,77,74,0,4,162,118,95,16,162,162,74,20,162,77,162,121,162,3,0,1,153,83,0,119,0,9,0,3,61,74,95,48,162,61,118,136,41,0,0,0,95,61,0,25,149,149,4,119,0,237,255,0,93,61,0,119,0,1,0,32,162,153,83,121,162,6,0,1,153,0,0,121,77,3,0,1,126,255,255,119,0,138,0,0,93,95,0,1,159,32,0,134,162,0,0,16,119,2,0,0,159,146,93,128,0,0,0,120,93,4,0,1,94,0,0,1,153,89,0,119,0,27,0,1,96,0,0,82,150,64,0,82,32,150,0,120,32,4,0,0,94,93,0,1,153,89,0,119,0,20,0,134,75,0,0,120,155,2,0,111,32,0,0,3,96,75,96,47,162,93,96,16,42,0,0,0,94,93,0,1,153,89,0,119,0,11,0,134,162,0,0,232,156,2,0,0,111,75,0,50,162,93,96,48,42,0,0,0,94,93,0,1,153,89,0,119,0,3,0,25,150,150,4,119,0,233,255,32,162,153,73,121,162,41,0,1,153,0,0,0,27,64,0,82,162,27,0,33,162,162,0,106,159,27,4,33,159,159,0,20,162,162,159,0,29,162,0,33,162,117,0,20,162,162,29,0,113,162,0,4,162,134,54,40,159,29,1,38,159,159,1,3,60,162,159,125,55,113,54,58,0,0,0,1,162,255,255,47,162,162,117,164,42,0,0,2,162,0,0,255,255,254,255,19,162,91,162,0,159,162,0,119,0,2,0,0,159,91,0,0,92,159,0,121,113,6,0,15,160,60,117,125,162,160,117,60,0,0,0,0,159,162,0,119,0,3,0,1,162,0,0,0,159,162,0,0,119,159,0,0,122,121,0,0,125,124,0,0,135,134,0,119,0,15,0,32,159,153,89,121,159,13,0,1,153,0,0,1,162,32,0,1,160,0,32,21,160,128,160,134,159,0,0,16,119,2,0,0,162,146,94,160,0,0,0,15,159,94,146,125,106,159,146,94,0,0,0,119,0,42,0,4,137,135,55,15,159,119,137,125,129,159,137,119,0,0,0,3,62,129,122,15,159,146,62,125,147,159,62,146,0,0,0,1,160,32,0,134,159,0,0,16,119,2,0,0,160,147,62,92,0,0,0,134,159,0,0,232,156,2,0,0,125,122,0,1,160,48,0,2,162,0,0,0,0,1,0,21,162,92,162,134,159,0,0,16,119,2,0,0,160,147,62,162,0,0,0,1,162,48,0,1,160,0,0,134,159,0,0,16,119,2,0,0,162,129,137,160,0,0,0,134,159,0,0,232,156,2,0,0,55,137,0,1,160,32,0,1,162,0,32,21,162,92,162,134,159,0,0,16,119,2,0,0,160,147,62,162,0,0,0,0,106,147,0,0,80,81,0,0,105,106,0,0,107,110,0,119,0,105,252,32,159,153,92,121,159,36,0,120,0,34,0,120,107,3,0,1,126,0,0,119,0,32,0,1,97,1,0,41,159,97,2,94,33,4,159,120,33,2,0,119,0,13,0,41,162,97,3,3,162,3,162,134,159,0,0,252,169,1,0,162,33,2,6,25,99,97,1,35,159,99,10,121,159,3,0,0,97,99,0,119,0,243,255,1,126,1,0,119,0,15,0,0,98,97,0,41,159,98,2,94,159,4,159,121,159,3,0,1,126,255,255,119,0,9,0,25,98,98,1,1,159,10,0,50,159,159,98,88,44,0,0,1,126,1,0,119,0,3,0,119,0,245,255,0,126,81,0,137,154,0,0,139,126,0,0,140,2,73,0,0,0,0,0,2,65,0,0,208,20,0,0,2,66,0,0,144,0,0,0,136,67,0,0,0,64,67,0,136,67,0,0,3,67,67,66,137,67,0,0,130,67,0,0,136,68,0,0,49,67,67,68,172,44,0,0,135,67,0,0,66,0,0,0,1,67,136,0,3,61,64,67,1,67,132,0,3,60,64,67,1,67,128,0,3,10,64,67,25,23,64,124,25,8,64,120,25,62,64,116,25,24,64,112,25,55,64,108,25,54,64,104,25,28,64,100,25,42,64,96,25,43,64,92,25,44,64,88,25,45,64,84,25,56,64,80,25,27,64,76,25,63,64,72,25,29,64,68,25,46,64,64,25,36,64,60,25,52,64,56,25,37,64,52,25,53,64,48,25,30,64,44,25,47,64,40,25,31,64,36,25,48,64,32,25,32,64,28,25,49,64,24,25,33,64,20,25,50,64,16,25,34,64,12,25,51,64,8,25,35,64,4,0,7,64,0,85,61,0,0,85,60,1,0,82,67,61,0,25,67,67,64,116,23,67,0,82,67,61,0,25,67,67,68,116,8,67,0,82,67,61,0,25,67,67,76,116,62,67,0,82,67,61,0,25,67,67,96,116,24,67,0,82,67,61,0,25,67,67,4,116,55,67,0,82,67,61,0,25,67,67,12,116,54,67,0,82,68,61,0,134,67,0,0,148,139,2,0,68,0,0,0,85,28,67,0,82,67,61,0,25,67,67,88,116,42,67,0,82,67,61,0,25,67,67,92,116,43,67,0,82,67,43,0,82,68,60,0,82,69,61,0,106,69,69,8,134,22,0,0,60,102,2,0,67,68,69,0,82,68,54,0,5,69,22,68,85,44,69,0,82,69,61,0,82,69,69,0,82,68,44,0,3,69,69,68,85,45,69,0,82,69,55,0,82,68,61,0,94,68,68,66,3,69,69,68,85,56,69,0,82,69,62,0,41,69,69,1,82,68,24,0,3,69,69,68,85,27,69,0,1,69,0,0,82,68,61,0,94,68,68,66,4,69,69,68,85,63,69,0,82,69,43,0,32,69,69,4,121,69,40,0,1,69,0,0,82,68,60,0,49,69,69,68,104,46,0,0,82,69,60,0,82,68,61,0,106,68,68,8,54,69,69,68,224,46,0,0,82,69,56,0,82,68,63,0,56,69,69,68,216,46,0,0,1,69,0,0,85,10,69,0,82,69,23,0,82,68,10,0,56,69,69,68,200,46,0,0,82,69,63,0,82,68,23,0,5,57,69,68,82,68,28,0,82,69,10,0,3,69,57,69,41,69,69,2,59,67,0,0,145,67,67,0,101,68,69,67,82,67,10,0,25,67,67,1,85,10,67,0,119,0,239,255,82,67,63,0,25,67,67,1,85,63,67,0,119,0,229,255,137,64,0,0,139,0,0,0,82,67,27,0,1,69,0,0,1,72,8,0,138,67,69,72,44,47,0,0,236,47,0,0,244,48,0,0,188,49,0,0,240,50,0,0,180,51,0,0,224,52,0,0,144,53,0,0,1,68,135,53,1,70,90,48,1,71,88,5,1,72,184,53,135,69,4,0,68,70,71,72,119,0,219,1,82,69,56,0,82,68,63,0,56,69,69,68,148,54,0,0,82,68,63,0,82,70,23,0,5,69,68,70,85,29,69,0,82,69,42,0,82,70,63,0,82,68,55,0,134,19,0,0,60,102,2,0,69,70,68,0,82,70,23,0,5,68,19,70,85,46,68,0,1,68,0,0,85,10,68,0,82,68,23,0,82,70,10,0,56,68,68,70,220,47,0,0,82,70,45,0,82,69,46,0,82,71,10,0,3,69,69,71,91,68,70,69,76,68,68,0,145,68,68,0,59,70,255,0,145,70,70,0,66,38,68,70,145,38,38,0,82,70,28,0,82,68,29,0,82,69,10,0,3,68,68,69,41,68,68,2,101,70,68,38,82,68,10,0,25,68,68,1,85,10,68,0,119,0,232,255,82,68,63,0,25,68,68,1,85,63,68,0,119,0,209,255,82,68,56,0,82,70,63,0,56,68,68,70,148,54,0,0,82,70,63,0,82,69,23,0,5,68,70,69,85,36,68,0,82,68,42,0,82,69,63,0,82,70,55,0,134,20,0,0,60,102,2,0,68,69,70,0,82,69,23,0,5,70,20,69,85,52,70,0,1,70,0,0,85,10,70,0,82,70,23,0,82,69,10,0,56,70,70,69,144,48,0,0,82,70,45,0,82,69,52,0,82,68,10,0,3,69,69,68,91,70,70,69,41,70,70,2,100,6,65,70,145,6,6,0,82,70,28,0,82,69,36,0,82,68,10,0,3,69,69,68,41,69,69,2,101,70,69,6,82,69,10,0,25,69,69,1,85,10,69,0,119,0,235,255,82,69,61,0,106,69,69,72,38,69,69,2,120,69,18,0,82,70,45,0,82,68,52,0,82,71,8,0,3,68,68,71,91,69,70,68,76,69,69,0,145,69,69,0,59,70,255,0,145,70,70,0,66,40,69,70,145,40,40,0,82,70,28,0,82,69,36,0,82,68,8,0,3,69,69,68,41,69,69,2,101,70,69,40,82,69,63,0,25,69,69,1,85,63,69,0,119,0,191,255,82,69,56,0,82,70,63,0,56,69,69,70,148,54,0,0,82,70,63,0,82,68,23,0,5,69,70,68,85,37,69,0,82,69,42,0,82,68,63,0,82,70,55,0,134,21,0,0,60,102,2,0,69,68,70,0,82,68,23,0,5,70,21,68,85,53,70,0,1,70,0,0,85,10,70,0,82,70,23,0,82,68,10,0,56,70,70,68,172,49,0,0,82,68,45,0,82,69,53,0,82,71,10,0,3,69,69,71,41,69,69,1,93,70,68,69,76,70,70,0,145,70,70,0,60,68,0,0,255,255,0,0,145,68,68,0,66,41,70,68,145,41,41,0,82,68,28,0,82,70,37,0,82,69,10,0,3,70,70,69,41,70,70,2,101,68,70,41,82,70,10,0,25,70,70,1,85,10,70,0,119,0,230,255,82,70,63,0,25,70,70,1,85,63,70,0,119,0,207,255,82,70,56,0,82,68,63,0,56,70,70,68,148,54,0,0,82,68,63,0,82,69,23,0,5,70,68,69,85,30,70,0,82,70,42,0,82,69,63,0,82,68,55,0,134,11,0,0,60,102,2,0,70,69,68,0,82,69,23,0,5,68,11,69,85,47,68,0,1,68,0,0,85,10,68,0,82,68,23,0,82,69,10,0,56,68,68,69,132,50,0,0,82,70,45,0,82,71,47,0,82,72,10,0,3,71,71,72,41,71,71,1,93,69,70,71,76,69,69,0,145,69,69,0,60,70,0,0,255,255,0,0,145,70,70,0,66,68,69,70,145,68,68,0,134,12,0,0,192,103,2,0,68,0,0,0,145,12,12,0,82,68,28,0,82,70,30,0,82,69,10,0,3,70,70,69,41,70,70,2,101,68,70,12,82,70,10,0,25,70,70,1,85,10,70,0,119,0,226,255,82,70,61,0,106,70,70,72,38,70,70,2,120,70,20,0,82,68,45,0,82,69,47,0,82,71,8,0,3,69,69,71,41,69,69,1,93,70,68,69,76,70,70,0,145,70,70,0,60,68,0,0,255,255,0,0,145,68,68,0,66,39,70,68,145,39,39,0,82,68,28,0,82,70,30,0,82,69,8,0,3,70,70,69,41,70,70,2,101,68,70,39,82,70,63,0,25,70,70,1,85,63,70,0,119,0,180,255,82,70,56,0,82,68,63,0,56,70,70,68,148,54,0,0,82,68,63,0,82,69,23,0,5,70,68,69,85,31,70,0,82,70,42,0,82,69,63,0,82,68,55,0,134,13,0,0,60,102,2,0,70,69,68,0,82,69,23,0,5,68,13,69,85,48,68,0,1,68,0,0,85,10,68,0,82,68,23,0,82,69,10,0,56,68,68,69,164,51,0,0,82,68,45,0,82,69,48,0,82,70,10,0,3,69,69,70,41,69,69,2,94,68,68,69,77,68,68,0,62,69,0,0,0,0,224,255,255,255,239,65,66,25,68,69,145,25,25,0,82,69,28,0,82,68,31,0,82,70,10,0,3,68,68,70,41,68,68,2,101,69,68,25,82,68,10,0,25,68,68,1,85,10,68,0,119,0,231,255,82,68,63,0,25,68,68,1,85,63,68,0,119,0,208,255,82,68,56,0,82,69,63,0,56,68,68,69,148,54,0,0,82,69,63,0,82,70,23,0,5,68,69,70,85,32,68,0,82,68,42,0,82,70,63,0,82,69,55,0,134,14,0,0,60,102,2,0,68,70,69,0,82,70,23,0,5,69,14,70,85,49,69,0,1,69,0,0,85,10,69,0,82,69,23,0,82,70,10,0,56,69,69,70,120,52,0,0,82,70,45,0,82,68,49,0,82,71,10,0,3,68,68,71,41,68,68,2,94,70,70,68,77,70,70,0,62,68,0,0,0,0,224,255,255,255,239,65,66,69,70,68,145,69,69,0,134,15,0,0,192,103,2,0,69,0,0,0,145,15,15,0,82,69,28,0,82,68,32,0,82,70,10,0,3,68,68,70,41,68,68,2,101,69,68,15,82,68,10,0,25,68,68,1,85,10,68,0,119,0,227,255,82,68,61,0,106,68,68,72,38,68,68,2,120,68,19,0,82,68,45,0,82,69,49,0,82,70,8,0,3,69,69,70,41,69,69,2,94,68,68,69,77,68,68,0,62,69,0,0,0,0,224,255,255,255,239,65,66,26,68,69,145,26,26,0,82,69,28,0,82,68,32,0,82,70,8,0,3,68,68,70,41,68,68,2,101,69,68,26,82,68,63,0,25,68,68,1,85,63,68,0,119,0,182,255,82,68,56,0,82,69,63,0,56,68,68,69,148,54,0,0,82,69,63,0,82,70,23,0,5,68,69,70,85,33,68,0,82,68,42,0,82,70,63,0,82,69,55,0,134,16,0,0,60,102,2,0,68,70,69,0,82,70,23,0,5,69,16,70,85,50,69,0,1,69,0,0,85,10,69,0,82,69,23,0,82,70,10,0,56,69,69,70,128,53,0,0,82,69,45,0,82,70,50,0,82,68,10,0,3,70,70,68,41,70,70,2,100,2,69,70,145,2,2,0,82,69,28,0,82,70,33,0,82,68,10,0,3,70,70,68,41,70,70,2,101,69,70,2,82,70,10,0,25,70,70,1,85,10,70,0,119,0,236,255,82,70,63,0,25,70,70,1,85,63,70,0,119,0,213,255,82,70,56,0,82,69,63,0,56,70,70,69,148,54,0,0,82,69,63,0,82,68,23,0,5,70,69,68,85,34,70,0,82,70,42,0,82,68,63,0,82,69,55,0,134,17,0,0,60,102,2,0,70,68,69,0,82,68,23,0,5,69,17,68,85,51,69,0,1,69,0,0,85,10,69,0,82,69,23,0,82,68,10,0,56,69,69,68,64,54,0,0,82,68,45,0,82,70,51,0,82,71,10,0,3,70,70,71,41,70,70,2,100,69,68,70,145,69,69,0,134,18,0,0,192,103,2,0,69,0,0,0,145,18,18,0,82,69,28,0,82,68,34,0,82,70,10,0,3,68,68,70,41,68,68,2,101,69,68,18,82,68,10,0,25,68,68,1,85,10,68,0,119,0,232,255,82,68,61,0,106,68,68,72,38,68,68,2,120,68,14,0,82,68,45,0,82,69,51,0,82,70,8,0,3,69,69,70,41,69,69,2,100,3,68,69,145,3,3,0,82,68,28,0,82,69,34,0,82,70,8,0,3,69,69,70,41,69,69,2,101,68,69,3,82,69,63,0,25,69,69,1,85,63,69,0,119,0,192,255,82,67,61,0,106,67,67,72,38,67,67,1,120,67,74,0,1,67,0,0,82,69,61,0,94,69,69,66,4,67,67,69,85,63,67,0,82,67,56,0,82,69,63,0,56,67,67,69,200,55,0,0,82,69,63,0,82,72,23,0,5,67,69,72,85,35,67,0,82,72,28,0,82,69,35,0,82,71,8,0,3,69,69,71,41,69,69,2,100,67,72,69,145,67,67,0,89,7,67,0,82,67,61,0,106,67,67,76,33,67,67,3,121,67,18,0,88,72,7,0,145,72,72,0,62,69,0,0,13,34,37,0,0,0,240,58,145,69,69,0,63,67,72,69,145,67,67,0,89,7,67,0,88,4,7,0,145,4,4,0,82,67,28,0,82,69,35,0,82,72,8,0,3,69,69,72,41,69,69,2,101,67,69,4,1,69,0,0,85,10,69,0,82,69,23,0,82,67,10,0,56,69,69,67,184,55,0,0,82,69,10,0,82,67,8,0,46,69,69,67,168,55,0,0,88,5,7,0,145,5,5,0,82,69,28,0,82,67,35,0,82,72,10,0,3,67,67,72,41,67,67,2,3,9,69,67,88,69,9,0,145,69,69,0,65,67,69,5,145,67,67,0,89,9,67,0,82,67,10,0,25,67,67,1,85,10,67,0,119,0,232,255,82,67,63,0,25,67,67,1,85,63,67,0,119,0,189,255,82,67,42,0,33,67,67,4,121,67,3,0,137,64,0,0,139,0,0,0,1,67,0,0,82,69,61,0,94,69,69,66,4,67,67,69,85,63,67,0,1,67,0,0,82,69,63,0,56,67,67,69,96,56,0,0,1,67,0,0,85,10,67,0,82,67,23,0,82,69,10,0,56,67,67,69,80,56,0,0,82,67,63,0,82,69,23,0,5,58,67,69,82,69,28,0,82,67,10,0,3,67,58,67,41,67,67,2,59,72,0,0,145,72,72,0,101,69,67,72,82,72,10,0,25,72,72,1,85,10,72,0,119,0,239,255,82,72,63,0,25,72,72,1,85,63,72,0,119,0,229,255,116,63,55,0,82,72,56,0,82,67,63,0,56,72,72,67,212,56,0,0,1,72,0,0,85,10,72,0,82,72,23,0,82,67,10,0,56,72,72,67,196,56,0,0,82,72,63,0,82,67,23,0,5,59,72,67,82,67,28,0,82,72,10,0,3,72,59,72,41,72,72,2,59,69,0,0,145,69,69,0,101,67,72,69,82,69,10,0,25,69,69,1,85,10,69,0,119,0,239,255,82,69,63,0,25,69,69,1,85,63,69,0,119,0,229,255,137,64,0,0,139,0,0,0,140,4,102,0,0,0,0,0,2,88,0,0,255,127,0,0,2,89,0,0,1,1,0,0,2,90,0,0,143,0,0,0,2,91,0,0,144,0,0,0,2,92,0,0,144,1,0,0,2,93,0,0,128,15,0,0,2,94,0,0,224,15,0,0,2,95,0,0,255,63,0,0,2,96,0,0,255,0,0,0,1,74,0,0,136,97,0,0,0,75,97,0,136,97,0,0,25,97,97,96,137,97,0,0,130,97,0,0,136,98,0,0,49,97,97,98,96,57,0,0,1,98,96,0,135,97,0,0,98,0,0,0,25,71,75,84,25,59,75,80,25,60,75,76,25,69,75,72,25,70,75,68,25,36,75,64,25,65,75,60,25,66,75,56,25,37,75,52,25,68,75,48,25,63,75,44,25,62,75,40,25,34,75,36,25,35,75,32,25,64,75,28,25,67,75,24,25,57,75,20,25,61,75,16,25,58,75,12,25,72,75,8,25,73,75,4,0,38,75,0,85,59,0,0,85,60,1,0,85,69,2,0,85,70,3,0,1,97,0,0,85,36,97,0,1,97,0,0,85,37,97,0,1,97,0,0,85,68,97,0,2,98,0,0,0,0,1,0,135,97,6,0,98,0,0,0,85,63,97,0,82,97,63,0,120,97,6,0,1,97,0,0,85,71,97,0,82,18,71,0,137,75,0,0,139,18,0,0,82,97,70,0,34,97,97,5,121,97,3,0,1,97,5,0,85,70,97,0,82,97,68,0,120,97,3,0,1,74,7,0,119,0,11,0,82,97,68,0,26,97,97,8,82,97,97,0,82,98,68,0,26,98,98,8,106,98,98,4,25,98,98,1,49,97,97,98,92,58,0,0,1,74,7,0,32,97,74,7,121,97,6,0,1,98,1,0,1,99,1,0,134,97,0,0,36,4,2,0,68,98,99,0,82,76,68,0,0,19,76,0,26,97,76,8,25,27,97,4,82,20,27,0,25,97,20,1,85,27,97,0,1,99,120,0,95,19,20,99,82,99,68,0,120,99,3,0,1,74,10,0,119,0,11,0,82,99,68,0,26,99,99,8,82,99,99,0,82,97,68,0,26,97,97,8,106,97,97,4,25,97,97,1,49,99,99,97,212,58,0,0,1,74,10,0,32,99,74,10,121,99,6,0,1,97,1,0,1,98,1,0,134,99,0,0,36,4,2,0,68,97,98,0,82,77,68,0,0,6,77,0,26,99,77,8,25,29,99,4,82,7,29,0,25,99,7,1,85,29,99,0,1,98,94,0,95,6,7,98,82,98,36,0,1,99,1,0,82,97,37,0,22,99,99,97,20,98,98,99,85,36,98,0,82,98,37,0,25,98,98,1,85,37,98,0,82,99,68,0,134,98,0,0,228,23,2,0,99,36,37,0,85,68,98,0,82,98,36,0,1,99,1,0,82,97,37,0,22,99,99,97,20,98,98,99,85,36,98,0,82,98,37,0,25,98,98,2,85,37,98,0,82,99,68,0,134,98,0,0,228,23,2,0,99,36,37,0,85,68,98,0,1,98,0,0,85,65,98,0,1,98,0,64,82,99,65,0,56,98,98,99,192,59,0,0,82,98,63,0,82,99,65,0,41,99,99,2,1,97,0,0,97,98,99,97,82,97,65,0,25,97,97,1,85,65,97,0,119,0,244,255,1,97,0,0,85,65,97,0,82,97,60,0,26,97,97,3,82,99,65,0,56,97,97,99,84,67,0,0,82,99,59,0,82,98,65,0,3,99,99,98,134,97,0,0,92,60,2,0,99,0,0,0,19,97,97,95,85,62,97,0,1,97,3,0,85,34,97,0,1,97,0,0,85,35,97,0,82,97,63,0,82,99,62,0,41,99,99,2,3,97,97,99,116,64,97,0,82,97,64,0,121,97,5,0,82,97,64,0,26,97,97,8,106,50,97,4,119,0,2,0,1,50,0,0,85,67,50,0,1,97,0,0,85,66,97,0,82,97,67,0,82,99,66,0,56,97,97,99,244,60,0,0,82,97,65,0,2,99,0,0,0,128,0,0,4,97,97,99,82,99,64,0,82,98,66,0,41,98,98,2,94,99,99,98,82,98,59,0,4,99,99,98,47,97,97,99,228,60,0,0,82,84,65,0,82,99,64,0,82,98,66,0,41,98,98,2,94,99,99,98,82,98,59,0,3,98,98,84,82,100,60,0,4,100,100,84,134,97,0,0,192,62,2,0,99,98,100,0,85,57,97,0,82,97,34,0,82,100,57,0,49,97,97,100,228,60,0,0,116,34,57,0,82,97,64,0,82,100,66,0,41,100,100,2,3,97,97,100,116,35,97,0,82,97,66,0,25,97,97,1,85,66,97,0,119,0,214,255,82,97,63,0,82,100,62,0,41,100,100,2,94,97,97,100,121,97,28,0,82,97,63,0,82,100,62,0,41,100,100,2,94,97,97,100,26,97,97,8,106,97,97,4,82,100,70,0,41,100,100,1,45,97,97,100,116,61,0,0,82,97,63,0,82,100,62,0,41,100,100,2,94,85,97,100,82,97,70,0,41,97,97,2,0,86,97,0,3,100,85,86,135,97,7,0,85,100,86,0,82,97,63,0,82,100,62,0,41,100,100,2,94,97,97,100,26,97,97,8,82,100,70,0,109,97,4,100,82,100,63,0,82,97,62,0,41,97,97,2,94,100,100,97,120,100,3,0,1,74,29,0,119,0,17,0,82,100,63,0,82,97,62,0,41,97,97,2,94,100,100,97,26,100,100,8,82,100,100,0,82,97,63,0,82,98,62,0,41,98,98,2,94,97,97,98,26,97,97,8,106,97,97,4,25,97,97,1,49,100,100,97,208,61,0,0,1,74,29,0,32,100,74,29,121,100,11,0,1,74,0,0,82,97,63,0,82,98,62,0,41,98,98,2,3,97,97,98,1,98,1,0,1,99,4,0,134,100,0,0,36,4,2,0,97,98,99,0,82,100,59,0,82,99,65,0,3,23,100,99,82,99,63,0,82,100,62,0,41,100,100,2,94,83,99,100,0,21,83,0,26,99,83,8,25,28,99,4,82,4,28,0,25,99,4,1,85,28,99,0,41,99,4,2,97,21,99,23,82,99,35,0,121,99,64,0,82,100,59,0,82,98,65,0,3,100,100,98,25,100,100,1,134,99,0,0,92,60,2,0,100,0,0,0,19,99,99,95,85,62,99,0,82,99,63,0,82,100,62,0,41,100,100,2,3,99,99,100,116,64,99,0,82,99,64,0,121,99,5,0,82,99,64,0,26,99,99,8,106,49,99,4,119,0,2,0,1,49,0,0,85,67,49,0,1,99,0,0,85,66,99,0,82,99,67,0,82,100,66,0,56,99,99,100,64,63,0,0,82,99,65,0,4,99,99,88,82,100,64,0,82,98,66,0,41,98,98,2,94,100,100,98,82,98,59,0,4,100,100,98,47,99,99,100,40,63,0,0,82,87,65,0,82,100,64,0,82,98,66,0,41,98,98,2,94,100,100,98,82,98,59,0,3,98,98,87,25,98,98,1,82,97,60,0,4,97,97,87,26,97,97,1,134,99,0,0,192,62,2,0,100,98,97,0,85,61,99,0,82,99,34,0,82,97,61,0,54,99,99,97,56,63,0,0,82,99,66,0,25,99,99,1,85,66,99,0,119,0,220,255,1,99,0,0,85,35,99,0,82,99,59,0,82,97,65,0,3,22,99,97,82,97,35,0,121,97,209,0,82,97,35,0,4,97,22,97,85,58,97,0,82,97,58,0,17,97,97,88,82,99,34,0,1,98,2,1,17,99,99,98,19,97,97,99,120,97,3,0,1,74,41,0,119,0,245,0,1,97,0,0,85,66,97,0,82,5,66,0,82,97,34,0,82,99,66,0,25,99,99,1,41,99,99,1,93,99,93,99,26,99,99,1,56,97,97,99,188,63,0,0,25,97,5,1,85,66,97,0,119,0,245,255,82,97,66,0,3,24,97,89,3,97,5,89,49,97,97,90,28,64,0,0,25,97,24,48,1,99,8,0,134,39,0,0,76,122,2,0,97,99,0,0,82,99,36,0,82,97,37,0,22,97,39,97,20,99,99,97,85,36,99,0,82,99,37,0,25,99,99,8,85,37,99,0,82,97,68,0,134,99,0,0,228,23,2,0,97,36,37,0,85,68,99,0,119,0,73,0,82,99,66,0,3,25,99,89,49,99,24,96,124,64,0,0,3,99,92,25,4,99,99,91,1,97,9,0,134,40,0,0,76,122,2,0,99,97,0,0,82,97,36,0,82,99,37,0,22,99,40,99,20,97,97,99,85,36,97,0,82,97,37,0,25,97,97,9,85,37,97,0,82,99,68,0,134,97,0,0,228,23,2,0,99,36,37,0,85,68,97,0,119,0,49,0,82,97,66,0,3,26,97,89,1,97,23,1,49,97,25,97,228,64,0,0,25,97,26,0,1,99,0,1,4,97,97,99,1,99,7,0,134,41,0,0,76,122,2,0,97,99,0,0,82,99,36,0,82,97,37,0,22,97,41,97,20,99,99,97,85,36,99,0,82,99,37,0,25,99,99,7,85,37,99,0,82,97,68,0,134,99,0,0,228,23,2,0,97,36,37,0,85,68,99,0,119,0,23,0,1,99,192,0,3,99,99,26,1,97,24,1,4,99,99,97,1,97,8,0,134,42,0,0,76,122,2,0,99,97,0,0,82,97,36,0,82,99,37,0,22,99,42,99,20,97,97,99,85,36,97,0,82,97,37,0,25,97,97,8,85,37,97,0,82,99,68,0,134,97,0,0,228,23,2,0,99,36,37,0,85,68,97,0,119,0,1,0,1,97,192,15,82,99,66,0,90,97,97,99,121,97,22,0,82,97,36,0,82,99,34,0,82,98,66,0,41,98,98,1,93,98,93,98,4,99,99,98,82,98,37,0,22,99,99,98,20,97,97,99,85,36,97,0,82,97,37,0,1,99,192,15,82,98,66,0,91,99,99,98,3,97,97,99,85,37,97,0,82,99,68,0,134,97,0,0,228,23,2,0,99,36,37,0,85,68,97,0,1,97,0,0,85,66,97,0,82,8,66,0,82,97,58,0,82,99,66,0,25,99,99,1,41,99,99,1,93,99,94,99,26,99,99,1,56,97,97,99,216,65,0,0,25,97,8,1,85,66,97,0,119,0,245,255,1,97,5,0,134,43,0,0,76,122,2,0,8,97,0,0,82,97,36,0,82,99,37,0,22,99,43,99,20,97,97,99,85,36,97,0,82,97,37,0,25,97,97,5,85,37,97,0,82,99,68,0,134,97,0,0,228,23,2,0,99,36,37,0,85,68,97,0,1,97,32,16,82,99,66,0,90,97,97,99,121,97,22,0,82,97,36,0,82,99,58,0,82,98,66,0,41,98,98,1,93,98,94,98,4,99,99,98,82,98,37,0,22,99,99,98,20,97,97,99,85,36,97,0,82,97,37,0,1,99,32,16,82,98,66,0,91,99,99,98,3,97,97,99,85,37,97,0,82,99,68,0,134,97,0,0,228,23,2,0,99,36,37,0,85,68,97,0,82,97,65,0,82,99,34,0,3,97,97,99,85,65,97,0,119,0,78,254,82,97,59,0,82,99,65,0,91,51,97,99,79,97,22,0,49,97,97,90,248,66,0,0,25,97,51,48,1,99,8,0,134,44,0,0,76,122,2,0,97,99,0,0,82,99,36,0,82,97,37,0,22,97,44,97,20,99,99,97,85,36,99,0,82,99,37,0,25,99,99,8,85,37,99,0,82,97,68,0,134,99,0,0,228,23,2,0,97,36,37,0,85,68,99,0,119,0,20,0,3,99,92,51,4,99,99,91,1,97,9,0,134,45,0,0,76,122,2,0,99,97,0,0,82,97,36,0,82,99,37,0,22,99,45,99,20,97,97,99,85,36,97,0,82,97,37,0,25,97,97,9,85,37,97,0,82,99,68,0,134,97,0,0,228,23,2,0,99,36,37,0,85,68,97,0,82,97,65,0,25,97,97,1,85,65,97,0,119,0,30,254,32,97,74,41,121,97,7,0,1,99,195,47,1,98,142,47,1,100,154,3,1,101,221,47,135,97,4,0,99,98,100,101,82,97,60,0,82,101,65,0,56,97,97,101,76,68,0,0,82,97,59,0,82,101,65,0,91,52,97,101,82,97,59,0,82,101,65,0,91,97,97,101,49,97,97,90,240,67,0,0,25,97,52,48,1,101,8,0,134,46,0,0,76,122,2,0,97,101,0,0,82,101,36,0,82,97,37,0,22,97,46,97,20,101,101,97,85,36,101,0,82,101,37,0,25,101,101,8,85,37,101,0,82,97,68,0,134,101,0,0,228,23,2,0,97,36,37,0,85,68,101,0,119,0,20,0,3,101,92,52,4,101,101,91,1,97,9,0,134,47,0,0,76,122,2,0,101,97,0,0,82,97,36,0,82,101,37,0,22,101,47,101,20,97,97,101,85,36,97,0,82,97,37,0,25,97,97,9,85,37,97,0,82,101,68,0,134,97,0,0,228,23,2,0,101,36,37,0,85,68,97,0,82,97,65,0,25,97,97,1,85,65,97,0,119,0,203,255,1,97,0,0,1,101,7,0,134,48,0,0,76,122,2,0,97,101,0,0,82,101,36,0,82,97,37,0,22,97,48,97,20,101,101,97,85,36,101,0,82,101,37,0,25,101,101,7,85,37,101,0,82,97,68,0,134,101,0,0,228,23,2,0,97,36,37,0,85,68,101,0,82,101,37,0,120,101,2,0,119,0,16,0,82,101,36,0,1,97,0,0,82,100,37,0,22,97,97,100,20,101,101,97,85,36,101,0,82,101,37,0,25,101,101,1,85,37,101,0,82,97,68,0,134,101,0,0,228,23,2,0,97,36,37,0,85,68,101,0,119,0,239,255,1,101,0,0,85,65,101,0,82,9,63,0,1,101,0,64,82,97,65,0,56,101,101,97,52,69,0,0,82,101,65,0,41,101,101,2,94,101,9,101,121,101,8,0,82,97,63,0,82,100,65,0,41,100,100,2,94,97,97,100,26,97,97,8,135,101,8,0,97,0,0,0,82,101,65,0,25,101,101,1,85,65,101,0,119,0,237,255,135,101,8,0,9,0,0,0,1,101,1,0,85,72,101,0,1,101,0,0,85,73,101,0,82,101,60,0,1,97,176,21,8,101,101,97,85,38,101,0,1,101,0,0,85,66,101,0,82,101,60,0,82,97,66,0,56,101,101,97,16,70,0,0,1,101,0,0,85,65,101,0,82,101,38,0,82,97,65,0,56,101,101,97,204,69,0,0,82,101,72,0,82,97,59,0,82,100,66,0,82,98,65,0,3,100,100,98,91,97,97,100,3,101,101,97,85,72,101,0,82,101,73,0,82,97,72,0,3,101,101,97,85,73,101,0,82,101,65,0,25,101,101,1,85,65,101,0,119,0,237,255,82,101,72,0,2,97,0,0,241,255,0,0,9,101,101,97,85,72,101,0,82,101,73,0,2,97,0,0,241,255,0,0,9,101,101,97,85,73,101,0,82,101,66,0,82,97,38,0,3,101,101,97,85,66,101,0,1,101,176,21,85,38,101,0,119,0,214,255,82,101,68,0,120,101,3,0,1,74,87,0,119,0,11,0,82,101,68,0,26,101,101,8,82,101,101,0,82,97,68,0,26,97,97,8,106,97,97,4,25,97,97,1,49,101,101,97,72,70,0,0,1,74,87,0,32,101,74,87,121,101,6,0,1,97,1,0,1,100,1,0,134,101,0,0,36,4,2,0,68,97,100,0,82,101,73,0,43,101,101,8,19,101,101,96,0,53,101,0,82,78,68,0,0,10,78,0,26,101,78,8,25,30,101,4,82,11,30,0,25,101,11,1,85,30,101,0,95,10,11,53,82,101,68,0,120,101,3,0,1,74,90,0,119,0,11,0,82,101,68,0,26,101,101,8,82,101,101,0,82,100,68,0,26,100,100,8,106,100,100,4,25,100,100,1,49,101,101,100,204,70,0,0,1,74,90,0,32,101,74,90,121,101,6,0,1,100,1,0,1,97,1,0,134,101,0,0,36,4,2,0,68,100,97,0,82,101,73,0,19,101,101,96,0,54,101,0,82,79,68,0,0,12,79,0,26,101,79,8,25,31,101,4,82,13,31,0,25,101,13,1,85,31,101,0,95,12,13,54,82,101,68,0,120,101,3,0,1,74,93,0,119,0,11,0,82,101,68,0,26,101,101,8,82,101,101,0,82,97,68,0,26,97,97,8,106,97,97,4,25,97,97,1,49,101,101,97,76,71,0,0,1,74,93,0,32,101,74,93,121,101,6,0,1,97,1,0,1,100,1,0,134,101,0,0,36,4,2,0,68,97,100,0,82,101,72,0,43,101,101,8,19,101,101,96,0,55,101,0,82,80,68,0,0,14,80,0,26,101,80,8,25,32,101,4,82,15,32,0,25,101,15,1,85,32,101,0,95,14,15,55,82,101,68,0,120,101,3,0,1,74,96,0,119,0,11,0,82,101,68,0,26,101,101,8,82,101,101,0,82,100,68,0,26,100,100,8,106,100,100,4,25,100,100,1,49,101,101,100,208,71,0,0,1,74,96,0,32,101,74,96,121,101,6,0,1,100,1,0,1,97,1,0,134,101,0,0,36,4,2,0,68,100,97,0,82,101,72,0,19,101,101,96,0,56,101,0,82,81,68,0,0,16,81,0,26,101,81,8,25,33,101,4,82,17,33,0,25,101,17,1,85,33,101,0,95,16,17,56,82,101,69,0,82,97,68,0,26,97,97,8,25,97,97,4,116,101,97,0,82,82,68,0,26,101,82,8,82,100,69,0,82,100,100,0,135,97,7,0,101,82,100,0,82,97,68,0,26,97,97,8,85,71,97,0,82,18,71,0,137,75,0,0,139,18,0,0,140,2,88,0,0,0,0,0,2,79,0,0,255,255,0,0,2,80,0,0,255,0,0,0,136,81,0,0,0,68,81,0,136,81,0,0,25,81,81,112,137,81,0,0,130,81,0,0,136,82,0,0,49,81,81,82,164,72,0,0,1,82,112,0,135,81,0,0,82,0,0,0,25,2,68,76,25,54,68,72,25,63,68,68,25,64,68,64,25,55,68,60,25,44,68,56,25,52,68,52,25,65,68,106,25,41,68,105,25,17,68,104,25,53,68,48,25,45,68,44,25,56,68,40,25,66,68,103,25,42,68,102,25,18,68,101,25,11,68,100,25,46,68,36,25,67,68,99,25,43,68,98,25,19,68,97,25,12,68,96,25,47,68,32,25,48,68,28,25,57,68,24,25,49,68,20,25,50,68,16,25,58,68,12,25,51,68,8,25,59,68,4,85,54,0,0,85,63,1,0,82,81,54,0,82,81,81,0,120,81,3,0,137,68,0,0,139,0,0,0,82,81,54,0,106,81,81,4,120,81,3,0,137,68,0,0,139,0,0,0,82,82,63,0,121,82,6,0,82,82,54,0,106,82,82,8,33,82,82,0,0,81,82,0,119,0,3,0,1,82,0,0,0,81,82,0,120,81,3,0,137,68,0,0,139,0,0,0,82,81,54,0,106,81,81,16,82,82,63,0,45,81,81,82,152,73,0,0,137,68,0,0,139,0,0,0,82,82,63,0,34,82,82,11,121,82,6,0,82,82,54,0,106,82,82,16,34,82,82,11,0,81,82,0,119,0,3,0,1,82,0,0,0,81,82,0,120,81,8,0,1,82,4,0,1,83,217,59,134,81,0,0,216,31,2,0,82,83,68,0,137,68,0,0,139,0,0,0,82,3,54,0,116,2,3,0,106,83,3,4,109,2,4,83,106,81,3,8,109,2,8,81,106,83,3,12,109,2,12,83,106,81,3,16,109,2,16,81,134,81,0,0,116,191,0,0,2,0,0,0,85,64,81,0,82,83,54,0,82,83,83,0,135,81,8,0,83,0,0,0,82,81,54,0,1,83,0,0,85,81,83,0,82,83,54,0,82,81,63,0,109,83,16,81,1,81,0,0,85,55,81,0,82,81,54,0,106,81,81,16,1,83,1,0,1,85,10,0,138,81,83,85,136,74,0,0,168,75,0,0,36,77,0,0,132,78,0,0,200,79,0,0,128,81,0,0,52,83,0,0,192,84,0,0,204,85,0,0,204,86,0,0,119,0,94,3,82,69,54,0,106,82,69,4,106,84,69,8,5,83,82,84,135,22,6,0,83,0,0,0,82,83,54,0,85,83,22,0,1,83,0,0,85,44,83,0,82,84,54,0,106,84,84,4,82,82,54,0,106,82,82,8,5,83,84,82,82,82,44,0,56,83,83,82,252,87,0,0,82,82,64,0,82,84,44,0,41,84,84,4,100,83,82,84,145,83,83,0,62,82,0,0,209,221,1,224,208,34,211,63,145,82,82,0,65,60,83,82,145,60,60,0,82,84,64,0,82,85,44,0,41,85,85,4,3,84,84,85,112,83,84,4,145,83,83,0,62,84,0,0,217,84,201,63,180,200,226,63,145,84,84,0,65,82,83,84,145,82,82,0,63,13,60,82,145,13,13,0,82,86,64,0,82,87,44,0,41,87,87,4,3,86,86,87,112,85,86,8,145,85,85,0,62,86,0,0,201,118,190,159,26,47,189,63,145,86,86,0,65,83,85,86,145,83,83,0,63,84,13,83,145,84,84,0,59,83,255,0,145,83,83,0,65,82,84,83,145,82,82,0,75,82,82,0,19,82,82,80,0,31,82,0,82,82,54,0,82,82,82,0,82,83,44,0,95,82,83,31,82,83,44,0,25,83,83,1,85,44,83,0,119,0,195,255,82,70,54,0,106,82,70,4,106,84,70,8,5,83,82,84,41,83,83,1,135,27,6,0,83,0,0,0,82,83,54,0,85,83,27,0,1,83,0,0,85,52,83,0,82,84,54,0,106,84,84,4,82,82,54,0,106,82,82,8,5,83,84,82,41,83,83,1,82,82,52,0,56,83,83,82,252,87,0,0,82,82,64,0,82,84,55,0,41,84,84,4,100,83,82,84,145,83,83,0,62,82,0,0,209,221,1,224,208,34,211,63,145,82,82,0,65,62,83,82,145,62,62,0,82,84,64,0,82,86,55,0,41,86,86,4,3,84,84,86,112,83,84,4,145,83,83,0,62,84,0,0,217,84,201,63,180,200,226,63,145,84,84,0,65,82,83,84,145,82,82,0,63,16,62,82,145,16,16,0,82,85,64,0,82,87,55,0,41,87,87,4,3,85,85,87,112,86,85,8,145,86,86,0,62,85,0,0,201,118,190,159,26,47,189,63,145,85,85,0,65,83,86,85,145,83,83,0,63,84,16,83,145,84,84,0,59,83,255,0,145,83,83,0,65,82,84,83,145,82,82,0,75,82,82,0,19,82,82,80,0,39,82,0,82,82,54,0,82,82,82,0,82,83,52,0,95,82,83,39,82,84,64,0,82,85,55,0,41,85,85,4,3,84,84,85,112,82,84,12,145,82,82,0,59,84,255,0,145,84,84,0,65,83,82,84,145,83,83,0,75,83,83,0,19,83,83,80,0,40,83,0,82,83,54,0,82,83,83,0,82,84,52,0,25,84,84,1,95,83,84,40,82,84,52,0,25,84,84,2,85,52,84,0,82,84,55,0,25,84,84,1,85,55,84,0,119,0,173,255,82,71,54,0,106,83,71,4,106,82,71,8,5,84,83,82,41,84,84,1,135,29,6,0,84,0,0,0,82,84,54,0,85,84,29,0,1,84,0,0,83,65,84,0,1,84,0,0,83,41,84,0,1,84,0,0,83,17,84,0,1,84,0,0,85,53,84,0,82,82,54,0,106,82,82,4,82,83,54,0,106,83,83,8,5,84,82,83,82,83,53,0,56,84,84,83,252,87,0,0,82,85,64,0,82,86,53,0,41,86,86,4,100,82,85,86,145,82,82,0,59,85,31,0,145,85,85,0,65,83,82,85,145,83,83,0,134,84,0,0,28,159,2,0,83,0,0,0,75,84,84,0,83,65,84,0,82,82,64,0,82,86,53,0,41,86,86,4,3,82,82,86,112,85,82,4,145,85,85,0,59,82,63,0,145,82,82,0,65,83,85,82,145,83,83,0,134,84,0,0,28,159,2,0,83,0,0,0,75,84,84,0,83,41,84,0,82,85,64,0,82,86,53,0,41,86,86,4,3,85,85,86,112,82,85,8,145,82,82,0,59,85,31,0,145,85,85,0,65,83,82,85,145,83,83,0,134,84,0,0,28,159,2,0,83,0,0,0,75,84,84,0,83,17,84,0,82,84,54,0,82,84,84,0,82,83,53,0,41,83,83,1,79,85,65,0,19,85,85,79,41,85,85,11,79,82,41,0,19,82,82,79,41,82,82,5,20,85,85,82,79,82,17,0,19,82,82,79,20,85,85,82,96,84,83,85,82,85,53,0,25,85,85,1,85,53,85,0,119,0,186,255,82,72,54,0,106,83,72,4,106,84,72,8,5,85,83,84,27,85,85,3,135,20,6,0,85,0,0,0,82,85,54,0,85,85,20,0,1,85,0,0,85,45,85,0,1,85,0,0,85,56,85,0,82,84,54,0,106,84,84,4,82,83,54,0,106,83,83,8,5,85,84,83,27,85,85,3,82,83,45,0,56,85,85,83,252,87,0,0,82,84,64,0,82,82,56,0,41,82,82,4,100,83,84,82,145,83,83,0,59,84,255,0,145,84,84,0,65,85,83,84,145,85,85,0,75,85,85,0,19,85,85,80,0,32,85,0,82,85,54,0,82,85,85,0,82,84,45,0,95,85,84,32,82,83,64,0,82,82,56,0,41,82,82,4,3,83,83,82,112,85,83,4,145,85,85,0,59,83,255,0,145,83,83,0,65,84,85,83,145,84,84,0,75,84,84,0,19,84,84,80,0,33,84,0,82,84,54,0,82,84,84,0,82,83,45,0,25,83,83,1,95,84,83,33,82,85,64,0,82,82,56,0,41,82,82,4,3,85,85,82,112,84,85,8,145,84,84,0,59,85,255,0,145,85,85,0,65,83,84,85,145,83,83,0,75,83,83,0,19,83,83,80,0,34,83,0,82,83,54,0,82,83,83,0,82,85,45,0,25,85,85,2,95,83,85,34,82,85,45,0,25,85,85,3,85,45,85,0,82,85,56,0,25,85,85,1,85,56,85,0,119,0,189,255,82,73,54,0,106,83,73,4,106,84,73,8,5,85,83,84,41,85,85,1,135,21,6,0,85,0,0,0,82,85,54,0,85,85,21,0,1,85,0,0,83,66,85,0,1,85,0,0,83,42,85,0,1,85,0,0], eb + 10240);
  HEAPU8.set([83,18,85,0,1,85,0,0,83,11,85,0,1,85,0,0,85,46,85,0,82,84,54,0,106,84,84,4,82,83,54,0,106,83,83,8,5,85,84,83,82,83,46,0,56,85,85,83,252,87,0,0,82,82,64,0,82,86,46,0,41,86,86,4,100,84,82,86,145,84,84,0,59,82,31,0,145,82,82,0,65,83,84,82,145,83,83,0,134,85,0,0,28,159,2,0,83,0,0,0,75,85,85,0,83,66,85,0,82,84,64,0,82,86,46,0,41,86,86,4,3,84,84,86,112,82,84,4,145,82,82,0,59,84,31,0,145,84,84,0,65,83,82,84,145,83,83,0,134,85,0,0,28,159,2,0,83,0,0,0,75,85,85,0,83,42,85,0,82,82,64,0,82,86,46,0,41,86,86,4,3,82,82,86,112,84,82,8,145,84,84,0,59,82,31,0,145,82,82,0,65,83,84,82,145,83,83,0,134,85,0,0,28,159,2,0,83,0,0,0,75,85,85,0,83,18,85,0,82,83,64,0,82,82,46,0,41,82,82,4,3,83,83,82,112,85,83,12,145,85,85,0,62,83,0,0,112,79,227,32,25,25,201,63,145,83,83,0,73,30,85,83,1,85,1,0,1,82,0,0,125,83,30,85,82,0,0,0,83,11,83,0,82,83,54,0,82,83,83,0,82,82,46,0,41,82,82,1,79,85,66,0,19,85,85,79,41,85,85,11,79,84,42,0,19,84,84,79,41,84,84,6,20,85,85,84,79,84,18,0,19,84,84,79,41,84,84,1,20,85,85,84,79,84,11,0,19,84,84,79,20,85,85,84,96,83,82,85,82,85,46,0,25,85,85,1,85,46,85,0,119,0,166,255,82,74,54,0,106,82,74,4,106,83,74,8,5,85,82,83,41,85,85,1,135,23,6,0,85,0,0,0,82,85,54,0,85,85,23,0,1,85,0,0,83,67,85,0,1,85,0,0,83,43,85,0,1,85,0,0,83,19,85,0,1,85,0,0,83,12,85,0,1,85,0,0,85,47,85,0,82,83,54,0,106,83,83,4,82,82,54,0,106,82,82,8,5,85,83,82,82,82,47,0,56,85,85,82,252,87,0,0,82,84,64,0,82,86,47,0,41,86,86,4,100,83,84,86,145,83,83,0,59,84,15,0,145,84,84,0,65,82,83,84,145,82,82,0,134,85,0,0,28,159,2,0,82,0,0,0,75,85,85,0,83,67,85,0,82,83,64,0,82,86,47,0,41,86,86,4,3,83,83,86,112,84,83,4,145,84,84,0,59,83,15,0,145,83,83,0,65,82,84,83,145,82,82,0,134,85,0,0,28,159,2,0,82,0,0,0,75,85,85,0,83,43,85,0,82,84,64,0,82,86,47,0,41,86,86,4,3,84,84,86,112,83,84,8,145,83,83,0,59,84,15,0,145,84,84,0,65,82,83,84,145,82,82,0,134,85,0,0,28,159,2,0,82,0,0,0,75,85,85,0,83,19,85,0,82,83,64,0,82,86,47,0,41,86,86,4,3,83,83,86,112,84,83,12,145,84,84,0,59,83,15,0,145,83,83,0,65,82,84,83,145,82,82,0,134,85,0,0,28,159,2,0,82,0,0,0,75,85,85,0,83,12,85,0,82,85,54,0,82,85,85,0,82,82,47,0,41,82,82,1,79,83,67,0,19,83,83,79,41,83,83,12,79,84,43,0,19,84,84,79,41,84,84,8,20,83,83,84,79,84,19,0,19,84,84,79,41,84,84,4,20,83,83,84,79,84,12,0,19,84,84,79,20,83,83,84,96,85,82,83,82,83,47,0,25,83,83,1,85,47,83,0,119,0,167,255,82,75,54,0,106,82,75,4,106,85,75,8,5,83,82,85,41,83,83,2,135,24,6,0,83,0,0,0,82,83,54,0,85,83,24,0,1,83,0,0,85,48,83,0,1,83,0,0,85,57,83,0,82,85,54,0,106,85,85,4,82,82,54,0,106,82,82,8,5,83,85,82,41,83,83,2,82,82,48,0,56,83,83,82,252,87,0,0,82,85,64,0,82,84,57,0,41,84,84,4,100,82,85,84,145,82,82,0,59,85,255,0,145,85,85,0,65,83,82,85,145,83,83,0,75,83,83,0,19,83,83,80,0,35,83,0,82,83,54,0,82,83,83,0,82,85,48,0,95,83,85,35,82,82,64,0,82,84,57,0,41,84,84,4,3,82,82,84,112,83,82,4,145,83,83,0,59,82,255,0,145,82,82,0,65,85,83,82,145,85,85,0,75,85,85,0,19,85,85,80,0,36,85,0,82,85,54,0,82,85,85,0,82,82,48,0,25,82,82,1,95,85,82,36,82,83,64,0,82,84,57,0,41,84,84,4,3,83,83,84,112,85,83,8,145,85,85,0,59,83,255,0,145,83,83,0,65,82,85,83,145,82,82,0,75,82,82,0,19,82,82,80,0,37,82,0,82,82,54,0,82,82,82,0,82,83,48,0,25,83,83,2,95,82,83,37,82,85,64,0,82,84,57,0,41,84,84,4,3,85,85,84,112,82,85,12,145,82,82,0,59,85,255,0,145,85,85,0,65,83,82,85,145,83,83,0,75,83,83,0,19,83,83,80,0,38,83,0,82,83,54,0,82,83,83,0,82,85,48,0,25,85,85,3,95,83,85,38,82,85,48,0,25,85,85,4,85,48,85,0,82,85,57,0,25,85,85,1,85,57,85,0,119,0,171,255,82,76,54,0,106,83,76,4,106,82,76,8,5,85,83,82,41,85,85,2,135,25,6,0,85,0,0,0,82,85,54,0,85,85,25,0,1,85,0,0,85,49,85,0,82,82,54,0,106,82,82,4,82,83,54,0,106,83,83,8,5,85,82,83,82,83,49,0,56,85,85,83,252,87,0,0,82,83,64,0,82,82,49,0,41,82,82,4,100,85,83,82,145,85,85,0,62,83,0,0,209,221,1,224,208,34,211,63,145,83,83,0,65,61,85,83,145,61,61,0,82,82,64,0,82,84,49,0,41,84,84,4,3,82,82,84,112,85,82,4,145,85,85,0,62,82,0,0,217,84,201,63,180,200,226,63,145,82,82,0,65,83,85,82,145,83,83,0,63,14,61,83,145,14,14,0,82,85,64,0,82,84,49,0,41,84,84,4,3,85,85,84,112,82,85,8,145,82,82,0,62,85,0,0,201,118,190,159,26,47,189,63,145,85,85,0,65,83,82,85,145,83,83,0,63,15,14,83,145,15,15,0,82,83,54,0,82,83,83,0,82,85,49,0,41,85,85,2,101,83,85,15,82,85,49,0,25,85,85,1,85,49,85,0,119,0,201,255,82,77,54,0,106,83,77,4,106,82,77,8,5,85,83,82,27,85,85,3,41,85,85,2,135,26,6,0,85,0,0,0,82,85,54,0,85,85,26,0,1,85,0,0,85,50,85,0,1,85,0,0,85,58,85,0,82,82,54,0,106,82,82,4,82,83,54,0,106,83,83,8,5,85,82,83,27,85,85,3,82,83,50,0,56,85,85,83,252,87,0,0,82,85,64,0,82,83,58,0,41,83,83,4,100,4,85,83,145,4,4,0,82,85,54,0,82,85,85,0,82,83,50,0,41,83,83,2,101,85,83,4,82,83,64,0,82,85,58,0,41,85,85,4,3,83,83,85,112,5,83,4,145,5,5,0,82,83,54,0,82,83,83,0,82,85,50,0,25,85,85,1,41,85,85,2,101,83,85,5,82,85,64,0,82,83,58,0,41,83,83,4,3,85,85,83,112,6,85,8,145,6,6,0,82,85,54,0,82,85,85,0,82,83,50,0,25,83,83,2,41,83,83,2,101,85,83,6,82,83,50,0,25,83,83,3,85,50,83,0,82,83,58,0,25,83,83,1,85,58,83,0,119,0,207,255,82,78,54,0,106,85,78,4,106,82,78,8,5,83,85,82,41,83,83,2,41,83,83,2,135,28,6,0,83,0,0,0,82,83,54,0,85,83,28,0,1,83,0,0,85,51,83,0,1,83,0,0,85,59,83,0,82,82,54,0,106,82,82,4,82,85,54,0,106,85,85,8,5,83,82,85,41,83,83,2,82,85,51,0,56,83,83,85,252,87,0,0,82,83,64,0,82,85,59,0,41,85,85,4,100,7,83,85,145,7,7,0,82,83,54,0,82,83,83,0,82,85,51,0,41,85,85,2,101,83,85,7,82,85,64,0,82,83,59,0,41,83,83,4,3,85,85,83,112,8,85,4,145,8,8,0,82,85,54,0,82,85,85,0,82,83,51,0,25,83,83,1,41,83,83,2,101,85,83,8,82,83,64,0,82,85,59,0,41,85,85,4,3,83,83,85,112,9,83,8,145,9,9,0,82,83,54,0,82,83,83,0,82,85,51,0,25,85,85,2,41,85,85,2,101,83,85,9,82,85,64,0,82,83,59,0,41,83,83,4,3,85,85,83,112,10,85,12,145,10,10,0,82,85,54,0,82,85,85,0,82,83,51,0,25,83,83,3,41,83,83,2,101,85,83,10,82,83,51,0,25,83,83,4,85,51,83,0,82,83,59,0,25,83,83,1,85,59,83,0,119,0,195,255,82,83,64,0,135,81,8,0,83,0,0,0,1,81,0,0,85,64,81,0,82,81,54,0,106,81,81,12,36,81,81,1,121,81,3,0,137,68,0,0,139,0,0,0,82,81,54,0,1,83,1,0,109,81,12,83,82,83,54,0,82,83,83,0,120,83,3,0,137,68,0,0,139,0,0,0,82,81,54,0,134,83,0,0,72,65,1,0,81,0,0,0,137,68,0,0,139,0,0,0,140,2,96,0,0,0,0,0,1,88,0,0,136,90,0,0,0,89,90,0,136,90,0,0,1,91,224,0,3,90,90,91,137,90,0,0,130,90,0,0,136,91,0,0,49,90,90,91,160,88,0,0,1,91,224,0,135,90,0,0,91,0,0,0,1,90,208,0,3,86,89,90,1,90,204,0,3,85,89,90,1,90,200,0,3,87,89,90,1,90,196,0,3,52,89,90,1,90,192,0,3,51,89,90,1,90,188,0,3,25,89,90,1,90,184,0,3,37,89,90,1,90,180,0,3,40,89,90,1,90,176,0,3,39,89,90,1,90,172,0,3,36,89,90,1,90,168,0,3,38,89,90,1,90,164,0,3,58,89,90,1,90,160,0,3,70,89,90,1,90,156,0,3,75,89,90,1,90,152,0,3,46,89,90,1,90,148,0,3,41,89,90,1,90,144,0,3,53,89,90,1,90,140,0,3,31,89,90,1,90,136,0,3,80,89,90,1,90,132,0,3,26,89,90,1,90,128,0,3,73,89,90,25,78,89,124,25,49,89,120,25,44,89,116,25,56,89,112,25,34,89,108,25,83,89,104,25,30,89,100,25,74,89,96,25,79,89,92,25,50,89,88,25,45,89,84,25,57,89,80,25,35,89,76,25,84,89,72,25,27,89,68,25,71,89,64,25,76,89,60,25,47,89,56,25,42,89,52,25,54,89,48,25,32,89,44,25,81,89,40,25,28,89,36,25,72,89,32,25,77,89,28,25,48,89,24,25,43,89,20,25,55,89,16,25,33,89,12,25,24,89,8,25,82,89,4,0,29,89,0,85,86,0,0,85,85,1,0,82,90,86,0,25,90,90,4,116,51,90,0,82,90,86,0,25,90,90,64,116,25,90,0,82,91,86,0,134,90,0,0,148,139,2,0,91,0,0,0,85,37,90,0,82,90,86,0,25,90,90,100,116,40,90,0,82,90,86,0,25,90,90,104,116,39,90,0,82,90,86,0,1,91,128,0,3,90,90,91,116,36,90,0,82,90,86,0,1,91,144,0,3,90,90,91,116,38,90,0,82,90,51,0,82,91,38,0,41,91,91,1,3,90,90,91,85,58,90,0,82,91,86,0,134,90,0,0,52,146,2,0,91,0,0,0,121,90,7,0,1,91,10,52,1,92,90,48,1,93,0,6,1,94,51,52,135,90,4,0,91,92,93,94,82,90,25,0,1,94,1,0,1,95,4,0,138,90,94,95,88,92,0,0,212,93,0,0,176,95,0,0,220,97,0,0,1,93,0,0,85,87,93,0,82,93,58,0,82,92,87,0,49,93,93,92,180,90,0,0,1,88,47,0,119,0,92,0,82,93,40,0,82,92,87,0,41,92,92,3,3,93,93,92,116,72,93,0,82,93,40,0,82,92,87,0,41,92,92,3,3,93,93,92,25,93,93,4,116,77,93,0,82,93,87,0,82,92,38,0,4,93,93,92,85,48,93,0,82,92,48,0,82,94,25,0,5,93,92,94,85,43,93,0,116,55,77,0,82,94,36,0,82,92,87,0,5,93,94,92,85,33,93,0,116,52,72,0,82,93,55,0,82,92,52,0,54,93,93,92,16,92,0,0,82,92,52,0,82,94,25,0,5,93,92,94,85,82,93,0,82,94,39,0,82,92,33,0,82,91,52,0,3,92,92,91,82,91,72,0,4,92,92,91,41,92,92,2,100,93,94,92,145,93,93,0,89,29,93,0,88,93,29,0,145,93,93,0,59,94,0,0,145,94,94,0,70,93,93,94,120,93,3,0,1,88,41,0,119,0,41,0,1,93,0,0,85,24,93,0,82,93,25,0,82,94,24,0,56,93,93,94,0,92,0,0,82,93,37,0,82,94,43,0,82,92,24,0,3,94,94,92,41,94,94,2,100,9,93,94,145,9,9,0,88,93,29,0,145,93,93,0,65,66,9,93,145,66,66,0,82,93,85,0,82,94,82,0,82,92,24,0,3,94,94,92,41,94,94,2,3,20,93,94,88,93,20,0,145,93,93,0,63,94,93,66,145,94,94,0,89,20,94,0,82,94,24,0,25,94,94,1,85,24,94,0,119,0,227,255,82,94,52,0,25,94,94,1,85,52,94,0,119,0,195,255,82,94,87,0,25,94,94,1,85,87,94,0,119,0,160,255,32,94,88,41,121,94,8,0,1,93,89,52,1,92,90,48,1,91,109,6,1,95,51,52,135,94,4,0,93,92,91,95,119,0,6,2,32,94,88,47,121,94,4,2,137,89,0,0,139,0,0,0,119,0,1,2,1,94,0,0,85,87,94,0,82,94,58,0,82,93,87,0,49,94,94,93,120,92,0,0,1,88,47,0,119,0,74,0,82,94,40,0,82,93,87,0,41,93,93,3,3,94,94,93,116,70,94,0,82,94,40,0,82,93,87,0,41,93,93,3,3,94,94,93,25,94,94,4,116,75,94,0,82,94,87,0,82,93,38,0,4,94,94,93,85,46,94,0,116,41,46,0,116,53,75,0,82,93,36,0,82,92,87,0,5,94,93,92,85,31,94,0,116,52,70,0,82,94,53,0,82,92,52,0,54,94,94,92,140,93,0,0,116,80,52,0,82,92,39,0,82,93,31,0,82,91,52,0,3,93,93,91,82,91,70,0,4,93,93,91,41,93,93,2,100,94,92,93,145,94,94,0,89,26,94,0,88,94,26,0,145,94,94,0,59,92,0,0,145,92,92,0,70,94,94,92,120,94,3,0,1,88,9,0,119,0,29,0,82,94,37,0,82,92,41,0,25,92,92,0,41,92,92,2,100,10,94,92,145,10,10,0,88,94,26,0,145,94,94,0,65,67,10,94,145,67,67,0,82,94,85,0,82,92,80,0,25,92,92,0,41,92,92,2,3,21,94,92,88,94,21,0,145,94,94,0,63,92,94,67,145,92,92,0,89,21,92,0,82,92,52,0,25,92,92,1,85,52,92,0,119,0,210,255,82,92,87,0,25,92,92,1,85,87,92,0,119,0,178,255,32,92,88,9,121,92,8,0,1,94,89,52,1,93,90,48,1,91,18,6,1,95,51,52,135,92,4,0,94,93,91,95,119,0,167,1,32,92,88,47,121,92,165,1,137,89,0,0,139,0,0,0,119,0,162,1,1,92,0,0,85,87,92,0,82,92,58,0,82,95,87,0,49,92,92,95,244,93,0,0,1,88,47,0,119,0,98,0,82,92,40,0,82,95,87,0,41,95,95,3,3,92,92,95,116,73,92,0,82,92,40,0,82,95,87,0,41,95,95,3,3,92,92,95,25,92,92,4,116,78,92,0,82,92,87,0,82,95,38,0,4,92,92,95,85,49,92,0,82,92,49,0,41,92,92,1,85,44,92,0,116,56,78,0,82,95,36,0,82,91,87,0,5,92,95,91,85,34,92,0,116,52,73,0,82,92,56,0,82,91,52,0,54,92,92,91,104,95,0,0,82,92,52,0,41,92,92,1,85,83,92,0,82,91,39,0,82,95,34,0,82,93,52,0,3,95,95,93,82,93,73,0,4,95,95,93,41,95,95,2,100,92,91,95,145,92,92,0,89,30,92,0,88,92,30,0,145,92,92,0,59,91,0,0,145,91,91,0,70,92,92,91,120,92,3,0,1,88,17,0,119,0,49,0,82,92,37,0,82,91,44,0,25,91,91,0,41,91,91,2,100,11,92,91,145,11,11,0,88,92,30,0,145,92,92,0,65,68,11,92,145,68,68,0,82,92,85,0,82,91,83,0,25,91,91,0,41,91,91,2,3,22,92,91,88,92,22,0,145,92,92,0,63,91,92,68,145,91,91,0,89,22,91,0,82,91,37,0,82,92,44,0,25,92,92,1,41,92,92,2,100,12,91,92,145,12,12,0,88,91,30,0,145,91,91,0,65,69,12,91,145,69,69,0,82,91,85,0,82,92,83,0,25,92,92,1,41,92,92,2,3,23,91,92,88,91,23,0,145,91,91,0,63,92,91,69,145,92,92,0,89,23,92,0,82,92,52,0,25,92,92,1,85,52,92,0,119,0,188,255,82,92,87,0,25,92,92,1,85,87,92,0,119,0,154,255,32,92,88,17,121,92,8,0,1,91,89,52,1,95,90,48,1,93,39,6,1,94,51,52,135,92,4,0,91,95,93,94,119,0,48,1,32,92,88,47,121,92,46,1,137,89,0,0,139,0,0,0,119,0,43,1,1,92,0,0,85,87,92,0,82,92,58,0,82,94,87,0,49,92,92,94,208,95,0,0,1,88,47,0,119,0,118,0,82,92,40,0,82,94,87,0,41,94,94,3,3,92,92,94,116,74,92,0,82,92,40,0,82,94,87,0,41,94,94,3,3,92,92,94,25,92,92,4,116,79,92,0,82,92,87,0,82,94,38,0,4,92,92,94,85,50,92,0,82,92,50,0,27,92,92,3,85,45,92,0,116,57,79,0,82,94,36,0,82,93,87,0,5,92,94,93,85,35,92,0,116,52,74,0,82,92,57,0,82,93,52,0,54,92,92,93,148,97,0,0,82,92,52,0,27,92,92,3,85,84,92,0,82,93,39,0,82,94,35,0,82,95,52,0,3,94,94,95,82,95,74,0,4,94,94,95,41,94,94,2,100,92,93,94,145,92,92,0,89,27,92,0,88,92,27,0,145,92,92,0,59,93,0,0,145,93,93,0,70,92,92,93,120,92,3,0,1,88,25,0,119,0,69,0,82,92,37,0,82,93,45,0,25,93,93,0,41,93,93,2,100,2,92,93,145,2,2,0,88,92,27,0,145,92,92,0,65,59,2,92,145,59,59,0,82,92,85,0,82,93,84,0,25,93,93,0,41,93,93,2,3,13,92,93,88,92,13,0,145,92,92,0,63,93,92,59,145,93,93,0,89,13,93,0,82,93,37,0,82,92,45,0,25,92,92,1,41,92,92,2,100,3,93,92,145,3,3,0,88,93,27,0,145,93,93,0,65,60,3,93,145,60,60,0,82,93,85,0,82,92,84,0,25,92,92,1,41,92,92,2,3,14,93,92,88,93,14,0,145,93,93,0,63,92,93,60,145,92,92,0,89,14,92,0,82,92,37,0,82,93,45,0,25,93,93,2,41,93,93,2,100,4,92,93,145,4,4,0,88,92,27,0,145,92,92,0,65,61,4,92,145,61,61,0,82,92,85,0,82,93,84,0,25,93,93,2,41,93,93,2,3,15,92,93,88,92,15,0,145,92,92,0,63,93,92,61,145,93,93,0,89,15,93,0,82,93,52,0,25,93,93,1,85,52,93,0,119,0,168,255,82,93,87,0,25,93,93,1,85,87,93,0,119,0,134,255,32,93,88,25,121,93,8,0,1,92,89,52,1,94,90,48,1,95,61,6,1,91,51,52,135,93,4,0,92,94,95,91,119,0,165,0,32,93,88,47,121,93,163,0,137,89,0,0,139,0,0,0,119,0,160,0,1,93,0,0,85,87,93,0,82,93,58,0,82,91,87,0,49,93,93,91,252,97,0,0,1,88,47,0,119,0,138,0,82,93,40,0,82,91,87,0,41,91,91,3,3,93,93,91,116,71,93,0,82,93,40,0,82,91,87,0,41,91,91,3,3,93,93,91,25,93,93,4,116,76,93,0,82,93,87,0,82,91,38,0,4,93,93,91,85,47,93,0,82,93,47,0,41,93,93,2,85,42,93,0,116,54,76,0,82,91,36,0,82,95,87,0,5,93,91,95,85,32,93,0,116,52,71,0,82,93,54,0,82,95,52,0,54,93,93,95,16,100,0,0,82,93,52,0,41,93,93,2,85,81,93,0,82,95,39,0,82,91,32,0,82,94,52,0,3,91,91,94,82,94,71,0,4,91,91,94,41,91,91,2,100,93,95,91,145,93,93,0,89,28,93,0,88,93,28,0,145,93,93,0,59,95,0,0,145,95,95,0,70,93,93,95,120,93,3,0,1,88,33,0,119,0,89,0,82,93,37,0,82,95,42,0,25,95,95,0,41,95,95,2,100,5,93,95,145,5,5,0,88,93,28,0,145,93,93,0,65,62,5,93,145,62,62,0,82,93,85,0,82,95,81,0,25,95,95,0,41,95,95,2,3,16,93,95,88,93,16,0,145,93,93,0,63,95,93,62,145,95,95,0,89,16,95,0,82,95,37,0,82,93,42,0,25,93,93,1,41,93,93,2,100,6,95,93,145,6,6,0,88,95,28,0,145,95,95,0,65,63,6,95,145,63,63,0,82,95,85,0,82,93,81,0,25,93,93,1,41,93,93,2,3,17,95,93,88,95,17,0,145,95,95,0,63,93,95,63,145,93,93,0,89,17,93,0,82,93,37,0,82,95,42,0,25,95,95,2,41,95,95,2,100,7,93,95,145,7,7,0,88,93,28,0,145,93,93,0,65,64,7,93,145,64,64,0,82,93,85,0,82,95,81,0,25,95,95,2,41,95,95,2,3,18,93,95,88,93,18,0,145,93,93,0,63,95,93,64,145,95,95,0,89,18,95,0,82,95,37,0,82,93,42,0,25,93,93,3,41,93,93,2,100,8,95,93,145,8,8,0,88,95,28,0,145,95,95,0,65,65,8,95,145,65,65,0,82,95,85,0,82,93,81,0,25,93,93,3,41,93,93,2,3,19,95,93,88,95,19,0,145,95,95,0,63,93,95,65,145,93,93,0,89,19,93,0,82,93,52,0,25,93,93,1,85,52,93,0,119,0,148,255,82,93,87,0,25,93,93,1,85,87,93,0,119,0,114,255,32,93,88,33,121,93,8,0,1,95,89,52,1,91,90,48,1,94,84,6,1,92,51,52,135,93,4,0,95,91,94,92,119,0,6,0,32,93,88,47,121,93,4,0,137,89,0,0,139,0,0,0,119,0,1,0,139,0,0,0,140,2,85,0,0,0,0,0,2,78,0,0,144,0,0,0,2,79,0,0,90,48,0,0,2,80,0,0,115,52,0,0,1,76,0,0,136,81,0,0,0,77,81,0,136,81,0,0,25,81,81,112,137,81,0,0,130,81,0,0,136,82,0,0,49,81,81,82,176,100,0,0,1,82,112,0,135,81,0,0,82,0,0,0,25,74,77,100,25,72,77,96,25,75,77,92,25,57,77,88,25,73,77,84,25,40,77,80,25,49,77,76,25,51,77,72,25,50,77,68,25,48,77,64,25,69,77,60,25,70,77,56,25,71,77,52,25,47,77,48,25,46,77,44,25,52,77,40,25,41,77,36,25,55,77,32,25,44,77,28,25,56,77,24,25,45,77,20,25,53,77,16,25,42,77,12,25,54,77,8,25,43,77,4,0,39,77,0,85,74,0,0,85,72,1,0,82,81,74,0,25,81,81,20,116,73,81,0,82,81,74,0,25,81,81,64,116,40,81,0,82,82,74,0,134,81,0,0,148,139,2,0,82,0,0,0,85,49,81,0,82,81,74,0,25,81,81,100,116,51,81,0,82,81,74,0,25,81,81,104,116,50,81,0,82,81,74,0,1,82,128,0,3,81,81,82,116,48,81,0,1,81,0,0,85,75,81,0,82,81,73,0,82,82,75,0,49,81,81,82,148,101,0,0,1,76,43,0,119,0,203,1,82,81,51,0,82,82,75,0,41,82,82,3,3,81,81,82,116,69,81,0,82,81,51,0,82,82,75,0,41,82,82,3,3,81,81,82,25,81,81,4,116,70,81,0,82,82,75,0,82,83,40,0,5,81,82,83,85,71,81,0,82,83,48,0,82,82,75,0,5,81,83,82,85,47,81,0,1,81,0,0,85,46,81,0,82,81,70,0,82,82,69,0,47,81,81,82,0,102,0,0,1,76,4,0,119,0,176,1,82,81,69,0,1,82,0,0,82,83,74,0,94,83,83,78,4,82,82,83,47,81,81,82,36,102,0,0,1,76,6,0,119,0,167,1,82,81,70,0,1,82,0,0,82,83,74,0,94,83,83,78,4,82,82,83,47,81,81,82,72,102,0,0,1,76,8,0,119,0,158,1,82,81,74,0,106,81,81,4,82,82,74,0,94,82,82,78,3,81,81,82,82,82,69,0,49,81,81,82,112,102,0,0,1,76,10,0,119,0,148,1,82,81,74,0,106,81,81,4,82,82,74,0,94,82,82,78,3,81,81,82,82,82,70,0,49,81,81,82,152,102,0,0,1,76,12,0,119,0,138,1,82,81,40,0,1,84,1,0,1,82,4,0,138,81,84,82,180,103,0,0,116,104,0,0,140,105,0,0,244,106,0,0,116,57,69,0,82,82,70,0,82,83,57,0,54,82,82,83,172,108,0,0,82,83,57,0,82,84,40,0,5,82,83,84,85,54,82,0,82,11,50,0,82,12,47,0,82,13,46,0,25,82,13,1,85,46,82,0,3,84,12,13,41,84,84,2,100,82,11,84,145,82,82,0,89,43,82,0,88,82,43,0,145,82,82,0,59,84,0,0,145,84,84,0,70,82,82,84,120,82,3,0,1,76,37,0,119,0,103,1,1,82,0,0,85,39,82,0,82,82,40,0,82,84,39,0,56,82,82,84,164,103,0,0,82,82,49,0,82,84,54,0,82,83,39,0,3,84,84,83,41,84,84,2,100,14,82,84,145,14,14,0,88,82,43,0,145,82,82,0,65,64,14,82,145,64,64,0,82,82,72,0,82,84,71,0,82,83,39,0,3,84,84,83,41,84,84,2,3,34,82,84,88,82,34,0,145,82,82,0,63,84,82,64,145,84,84,0,89,34,84,0,82,84,39,0,25,84,84,1,85,39,84,0,119,0,227,255,82,84,57,0,25,84,84,1,85,57,84,0,119,0,195,255,116,57,69,0,82,82,70,0,82,83,57,0,54,82,82,83,172,108,0,0,116,52,57,0,82,15,50,0,82,16,47,0,82,17,46,0,25,82,17,1,85,46,82,0,3,83,16,17,41,83,83,2,100,82,15,83,145,82,82,0,89,41,82,0,88,82,41,0,145,82,82,0,59,83,0,0,145,83,83,0,70,82,82,83,120,82,3,0,1,76,17,0,119,0,43,1,82,82,49,0,82,83,52,0,25,83,83,0,41,83,83,2,100,18,82,83,145,18,18,0,88,82,41,0,145,82,82,0,65,65,18,82,145,65,65,0,82,82,72,0,82,83,71,0,25,83,83,0,41,83,83,2,3,35,82,83,88,82,35,0,145,82,82,0,63,83,82,65,145,83,83,0,89,35,83,0,82,83,57,0,25,83,83,1,85,57,83,0,119,0,210,255,116,57,69,0,82,83,70,0,82,82,57,0,54,83,83,82,172,108,0,0,82,83,57,0,41,83,83,1,85,55,83,0,82,19,50,0,82,20,47,0,82,21,46,0,25,83,21,1,85,46,83,0,3,82,20,21,41,82,82,2,100,83,19,82,145,83,83,0,89,44,83,0,88,83,44,0,145,83,83,0,59,82,0,0,145,82,82,0,70,83,83,82,120,83,3,0,1,76,22,0,119,0,249,0,82,83,49,0,82,82,55,0,25,82,82,0,41,82,82,2,100,22,83,82,145,22,22,0,88,83,44,0,145,83,83,0,65,66,22,83,145,66,66,0,82,83,72,0,82,82,71,0,25,82,82,0,41,82,82,2,3,36,83,82,88,83,36,0,145,83,83,0,63,82,83,66,145,82,82,0,89,36,82,0,82,82,49,0,82,83,55,0,25,83,83,1,41,83,83,2,100,23,82,83,145,23,23,0,88,82,44,0,145,82,82,0,65,67,23,82,145,67,67,0,82,82,72,0,82,83,71,0,25,83,83,1,41,83,83,2,3,37,82,83,88,82,37,0,145,82,82,0,63,83,82,67,145,83,83,0,89,37,83,0,82,83,57,0,25,83,83,1,85,57,83,0,119,0,188,255,116,57,69,0,82,83,70,0,82,82,57,0,54,83,83,82,172,108,0,0,82,83,57,0,27,83,83,3,85,56,83,0,82,24,50,0,82,25,47,0,82,26,46,0,25,83,26,1,85,46,83,0,3,82,25,26,41,82,82,2,100,83,24,82,145,83,83,0,89,45,83,0,88,83,45,0,145,83,83,0,59,82,0,0,145,82,82,0,70,83,83,82,120,83,3,0,1,76,27,0,119,0,179,0,82,83,49,0,82,82,56,0,25,82,82,0,41,82,82,2,100,27,83,82,145,27,27,0,88,83,45,0,145,83,83,0,65,68,27,83,145,68,68,0,82,83,72,0,82,82,71,0,25,82,82,0,41,82,82,2,3,38,83,82,88,83,38,0,145,83,83,0,63,82,83,68,145,82,82,0,89,38,82,0,82,82,49,0,82,83,56,0,25,83,83,1,41,83,83,2,100,2,82,83,145,2,2,0,88,82,45,0,145,82,82,0,65,58,2,82,145,58,58,0,82,82,72,0,82,83,71,0,25,83,83,1,41,83,83,2,3,28,82,83,88,82,28,0,145,82,82,0,63,83,82,58,145,83,83,0,89,28,83,0,82,83,49,0,82,82,56,0,25,82,82,2,41,82,82,2,100,3,83,82,145,3,3,0,88,83,45,0,145,83,83,0,65,59,3,83,145,59,59,0,82,83,72,0,82,82,71,0,25,82,82,2,41,82,82,2,3,29,83,82,88,83,29,0,145,83,83,0,63,82,83,59,145,82,82,0,89,29,82,0,82,82,57,0,25,82,82,1,85,57,82,0,119,0,168,255,116,57,69,0,82,82,70,0,82,83,57,0,54,82,82,83,172,108,0,0,82,82,57,0,41,82,82,2,85,53,82,0,82,4,50,0,82,5,47,0,82,6,46,0,25,82,6,1,85,46,82,0,3,83,5,6,41,83,83,2,100,82,4,83,145,82,82,0,89,42,82,0,88,82,42,0,145,82,82,0,59,83,0,0,145,83,83,0,70,82,82,83,120,82,3,0,1,76,32,0,119,0,89,0,82,82,49,0,82,83,53,0,25,83,83,0,41,83,83,2,100,7,82,83,145,7,7,0,88,82,42,0,145,82,82,0,65,60,7,82,145,60,60,0,82,82,72,0,82,83,71,0,25,83,83,0,41,83,83,2,3,30,82,83,88,82,30,0,145,82,82,0,63,83,82,60,145,83,83,0,89,30,83,0,82,83,49,0,82,82,53,0,25,82,82,1,41,82,82,2,100,8,83,82,145,8,8,0,88,83,42,0,145,83,83,0,65,61,8,83,145,61,61,0,82,83,72,0,82,82,71,0,25,82,82,1,41,82,82,2,3,31,83,82,88,83,31,0,145,83,83,0,63,82,83,61,145,82,82,0,89,31,82,0,82,82,49,0,82,83,53,0,25,83,83,2,41,83,83,2,100,9,82,83,145,9,9,0,88,82,42,0,145,82,82,0,65,62,9,82,145,62,62,0,82,82,72,0,82,83,71,0,25,83,83,2,41,83,83,2,3,32,82,83,88,82,32,0,145,82,82,0,63,83,82,62,145,83,83,0,89,32,83,0,82,83,49,0,82,82,53,0,25,82,82,3,41,82,82,2,100,10,83,82,145,10,10,0,88,83,42,0,145,83,83,0,65,63,10,83,145,63,63,0,82,83,72,0,82,82,71,0,25,82,82,3,41,82,82,2,3,33,83,82,88,83,33,0,145,83,83,0,63,82,83,63,145,82,82,0,89,33,82,0,82,82,57,0,25,82,82,1,85,57,82,0,119,0,148,255,82,81,75,0,25,81,81,1,85,75,81,0,119,0,49,254,1,81,4,0,1,84,40,0,138,76,81,84,108,109,0,0,104,109,0,0,128,109,0,0,104,109,0,0,148,109,0,0,104,109,0,0,168,109,0,0,104,109,0,0,188,109,0,0,104,109,0,0,104,109,0,0,104,109,0,0,104,109,0,0,208,109,0,0,104,109,0,0,104,109,0,0,104,109,0,0,104,109,0,0,228,109,0,0,104,109,0,0,104,109,0,0,104,109,0,0,104,109,0,0,248,109,0,0,104,109,0,0,104,109,0,0,104,109,0,0,104,109,0,0,12,110,0,0,104,109,0,0,104,109,0,0,104,109,0,0,104,109,0,0,32,110,0,0,104,109,0,0,104,109,0,0,104,109,0,0,104,109,0,0,104,109,0,0,52,110,0,0,119,0,54,0,1,84,106,52,1,82,180,5,135,81,4,0,84,79,82,80,119,0,49,0,1,82,151,52,1,84,181,5,135,81,4,0,82,79,84,80,119,0,44,0,1,84,201,52,1,82,182,5,135,81,4,0,84,79,82,80,119,0,39,0,1,82,251,52,1,84,183,5,135,81,4,0,82,79,84,80,119,0,34,0,1,84,65,53,1,82,184,5,135,81,4,0,84,79,82,80,119,0,29,0,1,82,89,52,1,84,192,5,135,81,4,0,82,79,84,80,119,0,24,0,1,84,89,52,1,82,201,5,135,81,4,0,84,79,82,80,119,0,19,0,1,82,89,52,1,84,211,5,135,81,4,0,82,79,84,80,119,0,14,0,1,84,89,52,1,82,222,5,135,81,4,0,84,79,82,80,119,0,9,0,1,82,89,52,1,84,235,5,135,81,4,0,82,79,84,80,119,0,4,0,137,77,0,0,139,0,0,0,119,0,1,0,139,0,0,0,140,7,65,0,0,0,0,0,2,56,0,0,255,255,0,0,2,57,0,0,255,0,0,0,1,54,0,0,136,58,0,0,0,55,58,0,136,58,0,0,1,59,0,1,3,58,58,59,137,58,0,0,130,58,0,0,136,59,0,0,49,58,58,59,148,110,0,0,1,59,0,1,135,58,0,0,59,0,0,0,1,58,240,0,3,52,55,58,1,58,236,0,3,40,55,58,1,58,232,0,3,41,55,58,1,58,228,0,3,28,55,58,1,58,224,0,3,16,55,58,1,58,220,0,3,12,55,58,1,58,216,0,3,27,55,58,1,58,212,0,3,53,55,58,1,58,208,0,3,37,55,58,1,58,204,0,3,39,55,58,0,38,55,0,1,58,200,0,3,42,55,58,1,58,196,0,3,11,55,58,1,58,192,0,3,51,55,58,1,58,188,0,3,48,55,58,1,58,184,0,3,29,55,58,1,58,180,0,3,49,55,58,1,58,176,0,3,36,55,58,1,58,172,0,3,50,55,58,1,58,168,0,3,30,55,58,1,58,164,0,3,43,55,58,1,58,160,0,3,31,55,58,1,58,156,0,3,44,55,58,1,58,152,0,3,32,55,58,1,58,148,0,3,45,55,58,1,58,144,0,3,33,55,58,1,58,140,0,3,46,55,58,1,58,136,0,3,34,55,58,1,58,132,0,3,47,55,58,1,58,128,0,3,35,55,58,85,52,0,0,85,40,1,0,85,41,2,0,85,28,3,0,85,16,4,0,85,12,5,0,85,27,6,0,82,58,52,0,106,58,58,72,38,58,58,1,120,58,66,0,1,58,0,0,85,53,58,0,82,58,40,0,82,59,53,0,56,58,58,59,176,112,0,0,82,59,53,0,82,60,16,0,5,58,59,60,85,42,58,0,82,60,28,0,82,59,42,0,82,61,12,0,3,59,59,61,41,59,59,2,100,58,60,59,145,58,58,0,89,11,58,0,88,58,11,0,145,58,58,0,59,60,0,0,145,60,60,0,70,58,58,60,121,58,8,0,59,58,1,0,145,58,58,0,88,60,11,0,145,60,60,0,66,17,58,60,145,17,17,0,119,0,3,0,59,17,0,0,145,17,17,0,89,51,17,0,1,60,0,0,85,37,60,0,82,60,16,0,82,58,37,0,56,60,60,58,160,112,0,0,82,60,37,0,82,58,12,0,46,60,60,58,144,112,0,0,88,7,51,0,145,7,7,0,82,60,28,0,82,58,42,0,82,59,37,0,3,58,58,59,41,58,58,2,3,13,60,58,88,60,13,0,145,60,60,0,65,58,60,7,145,58,58,0,89,13,58,0,82,58,37,0,25,58,58,1,85,37,58,0,119,0,232,255,82,58,53,0,25,58,58,1,85,53,58,0,119,0,194,255,1,58,0,0,85,53,58,0,1,58,0,0,85,39,58,0,82,58,16,0,82,60,53,0,56,58,58,60,56,113,0,0,82,58,53,0,82,60,12,0,46,58,58,60,232,112,0,0,1,54,16,0,119,0,6,0,82,58,52,0,106,58,58,72,38,58,58,2,121,58,2,0,1,54,16,0,32,58,54,16,121,58,10,0,1,54,0,0,82,58,53,0,19,58,58,56,0,18,58,0,82,10,39,0,25,58,10,1,85,39,58,0,41,58,10,1,96,38,58,18,82,58,53,0,25,58,58,1,85,53,58,0,119,0,227,255,82,58,27,0,1,59,0,0,1,63,8,0,138,58,59,63,132,113,0,0,88,114,0,0,128,115,0,0,92,116,0,0,208,117,0,0,160,118,0,0,252,119,0,0,156,120,0,0,1,60,135,53,1,61,90,48,1,62,69,7,1,63,0,54,135,59,4,0,60,61,62,63,119,0,6,2,1,60,0,0,85,53,60,0,82,60,40,0,82,59,53,0,56,60,60,59,76,114,0,0,82,59,53,0,82,61,16,0,5,60,59,61,85,48,60,0,1,60,0,0,85,37,60,0,82,60,16,0,82,61,37,0,56,60,60,61,60,114,0,0,82,60,48,0,82,61,37,0,3,60,60,61,85,29,60,0,82,62,28,0,82,63,29,0,41,63,63,2,100,59,62,63,145,59,59,0,134,61,0,0,12,128,2,0,59,0,0,0,145,61,61,0,59,59,255,0,145,59,59,0,65,60,61,59,145,60,60,0,61,59,0,0,0,0,0,63,63,60,60,59,75,60,60,0,19,60,60,57,0,25,60,0,82,60,41,0,82,59,29,0,95,60,59,25,82,59,37,0,25,59,59,1,85,37,59,0,119,0,223,255,82,59,53,0,25,59,59,1,85,53,59,0,119,0,209,255,137,55,0,0,139,0,0,0,119,0,1,0,1,59,0,0,85,53,59,0,82,59,40,0,82,60,53,0,56,59,59,60,116,115,0,0,82,60,53,0,82,61,16,0,5,59,60,61,85,49,59,0,1,59,0,0,85,37,59,0,82,59,39,0,82,61,37,0,56,59,59,61,236,114,0,0,82,59,49,0,82,61,37,0,41,61,61,1,93,61,38,61,3,59,59,61,85,36,59,0,82,61,28,0,82,60,36,0,41,60,60,2,100,59,61,60,145,59,59,0,134,15,0,0,84,46,2,0,59,0,0,0,82,59,41,0,82,61,36,0,95,59,61,15,82,61,37,0,25,61,61,1,85,37,61,0,119,0,232,255,82,61,52,0,106,61,61,72,38,61,61,2,120,61,27,0,82,62,28,0,82,63,49,0,82,64,12,0,3,63,63,64,41,63,63,2,100,60,62,63,145,60,60,0,134,59,0,0,12,128,2,0,60,0,0,0,145,59,59,0,59,60,255,0,145,60,60,0,65,61,59,60,145,61,61,0,61,60,0,0,0,0,0,63,63,61,61,60,75,61,61,0,19,61,61,57,0,26,61,0,82,61,41,0,82,60,49,0,82,59,12,0,3,60,60,59,95,61,60,26,82,60,53,0,25,60,60,1,85,53,60,0,119,0,188,255,137,55,0,0,139,0,0,0,119,0,1,0,1,60,0,0,85,53,60,0,82,60,40,0,82,61,53,0,56,60,60,61,80,116,0,0,82,61,53,0,82,59,16,0,5,60,61,59,85,50,60,0,1,60,0,0,85,37,60,0,82,60,16,0,82,59,37,0,56,60,60,59,64,116,0,0,82,60,50,0,82,59,37,0,3,60,60,59,85,30,60,0,82,62,28,0,82,63,30,0,41,63,63,2,100,61,62,63,145,61,61,0,134,59,0,0,12,128,2,0,61,0,0,0,145,59,59,0,60,61,0,0,255,255,0,0,145,61,61,0,65,60,59,61,145,60,60,0,61,61,0,0,0,0,0,63,63,60,60,61,75,60,60,0,19,60,60,56,0,19,60,0,82,60,41,0,82,61,30,0,41,61,61,1,96,60,61,19,82,61,37,0,25,61,61,1,85,37,61,0,119,0,221,255,82,61,53,0,25,61,61,1,85,53,61,0,119,0,207,255,137,55,0,0,139,0,0,0,119,0,1,0,1,61,0,0,85,53,61,0,82,61,40,0,82,60,53,0,56,61,61,60,196,117,0,0,82,60,53,0,82,59,16,0,5,61,60,59,85,43,61,0,1,61,0,0,85,37,61,0,82,61,39,0,82,59,37,0,56,61,61,59,52,117,0,0,82,61,43,0,82,59,37,0,41,59,59,1,93,59,38,59,3,61,61,59,85,31,61,0,82,63,28,0,82,64,31,0,41,64,64,2,100,62,63,64,145,62,62,0,134,60,0,0,12,128,2,0,62,0,0,0,145,60,60,0,134,59,0,0,200,104,2,0,60,0,0,0,145,59,59,0,60,60,0,0,255,255,0,0,145,60,60,0,65,61,59,60,145,61,61,0,61,60,0,0,0,0,0,63,63,61,61,60,75,61,61,0,19,61,61,56,0,20,61,0,82,61,41,0,82,60,31,0,41,60,60,1,96,61,60,20,82,60,37,0,25,60,60,1,85,37,60,0,119,0,215,255,82,60,52,0,106,60,60,72,38,60,60,2,120,60,29,0,82,62,28,0,82,63,43,0,82,64,12,0,3,63,63,64,41,63,63,2,100,59,62,63,145,59,59,0,134,61,0,0,12,128,2,0,59,0,0,0,145,61,61,0,60,59,0,0,255,255,0,0,145,59,59,0,65,60,61,59,145,60,60,0,61,59,0,0,0,0,0,63,63,60,60,59,75,60,60,0,19,60,60,56,0,21,60,0,82,60,41,0,82,59,43,0,82,61,12,0,3,59,59,61,41,59,59,1,96,60,59,21,82,59,53,0,25,59,59,1,85,53,59,0,119,0,169,255,137,55,0,0,139,0,0,0,119,0,1,0,1,59,0,0,85,53,59,0,82,59,40,0,82,60,53,0,56,59,59,60,148,118,0,0,82,60,53,0,82,61,16,0,5,59,60,61,85,44,59,0,1,59,0,0,85,37,59,0,82,59,16,0,82,61,37,0,56,59,59,61,132,118,0,0,82,59,44,0,82,61,37,0,3,59,59,61,85,32,59,0,82,60,28,0,82,62,32,0,41,62,62,2,100,61,60,62,145,61,61,0,134,59,0,0,12,128,2,0,61,0,0,0,145,59,59,0,62,61,0,0,0,0,224,255,255,255,239,65,65,59,59,61,61,61,0,0,0,0,0,63,63,59,59,61,75,22,59,0,82,59,41,0,82,61,32,0,41,61,61,2,97,59,61,22,82,61,37,0,25,61,61,1,85,37,61,0,119,0,224,255,82,61,53,0,25,61,61,1,85,53,61,0,119,0,210,255,137,55,0,0,139,0,0,0,119,0,1,0,1,61,0,0,85,53,61,0,82,61,40,0,82,59,53,0,56,61,61,59,240,119,0,0,82,59,53,0,82,60,16,0,5,61,59,60,85,45,61,0,1,61,0,0,85,37,61,0,82,61,39,0,82,60,37,0,56,61,61,60,108,119,0,0,82,61,45,0,82,60,37,0,41,60,60,1,93,60,38,60,3,61,61,60,85,33,61,0,82,62,28,0,82,63,33,0,41,63,63,2,100,59,62,63,145,59,59,0,134,60,0,0,12,128,2,0,59,0,0,0,145,60,60,0,134,61,0,0,200,104,2,0,60,0,0,0,145,61,61,0,62,60,0,0,0,0,224,255,255,255,239,65,65,61,61,60,61,60,0,0,0,0,0,63,63,61,61,60,75,23,61,0,82,61,41,0,82,60,33,0,41,60,60,2,97,61,60,23,82,60,37,0,25,60,60,1,85,37,60,0,119,0,218,255,82,60,52,0,106,60,60,72,38,60,60,2,120,60,26,0,82,59,28,0,82,62,45,0,82,63,12,0,3,62,62,63,41,62,62,2,100,61,59,62,145,61,61,0,134,60,0,0,12,128,2,0,61,0,0,0,145,60,60,0,62,61,0,0,0,0,224,255,255,255,239,65,65,60,60,61,61,61,0,0,0,0,0,63,63,60,60,61,75,24,60,0,82,60,41,0,82,61,45,0,82,59,12,0,3,61,61,59,41,61,61,2,97,60,61,24,82,61,53,0,25,61,61,1,85,53,61,0,119,0,175,255,137,55,0,0,139,0,0,0,119,0,1,0,1,61,0,0], eb + 20480);
  HEAPU8.set([85,53,61,0,82,61,40,0,82,60,53,0,56,61,61,60,144,120,0,0,82,60,53,0,82,59,16,0,5,61,60,59,85,46,61,0,1,61,0,0,85,37,61,0,82,61,16,0,82,59,37,0,56,61,61,59,128,120,0,0,82,61,46,0,82,59,37,0,3,61,61,59,85,34,61,0,82,61,28,0,82,59,34,0,41,59,59,2,100,8,61,59,145,8,8,0,82,61,41,0,82,59,34,0,41,59,59,2,101,61,59,8,82,59,37,0,25,59,59,1,85,37,59,0,119,0,236,255,82,59,53,0,25,59,59,1,85,53,59,0,119,0,222,255,137,55,0,0,139,0,0,0,119,0,1,0,1,59,0,0,85,53,59,0,82,59,40,0,82,61,53,0,56,59,59,61,140,121,0,0,82,61,53,0,82,60,16,0,5,59,61,60,85,47,59,0,1,59,0,0,85,37,59,0,82,59,39,0,82,60,37,0,56,59,59,60,56,121,0,0,82,59,47,0,82,60,37,0,41,60,60,1,93,60,38,60,3,59,59,60,85,35,59,0,82,60,28,0,82,61,35,0,41,61,61,2,100,59,60,61,145,59,59,0,134,14,0,0,200,104,2,0,59,0,0,0,145,14,14,0,82,59,41,0,82,60,35,0,41,60,60,2,101,59,60,14,82,60,37,0,25,60,60,1,85,37,60,0,119,0,230,255,82,60,52,0,106,60,60,72,38,60,60,2,120,60,14,0,82,60,28,0,82,59,47,0,82,61,12,0,3,59,59,61,41,59,59,2,100,9,60,59,145,9,9,0,82,60,41,0,82,59,47,0,82,61,12,0,3,59,59,61,41,59,59,2,101,60,59,9,82,59,53,0,25,59,59,1,85,53,59,0,119,0,199,255,137,55,0,0,139,0,0,0,119,0,245,253,139,0,0,0,140,2,123,0,0,0,0,0,2,113,0,0,173,29,0,0,2,114,0,0,176,29,0,0,2,115,0,0,172,29,0,0,2,116,0,0,0,1,0,0,2,117,0,0,216,118,0,0,2,118,0,0,224,119,0,0,2,119,0,0,177,29,0,0,3,62,0,1,106,3,0,4,38,120,3,1,120,120,218,0,82,4,0,0,38,120,3,3,120,120,2,0,139,0,0,0,1,120,0,0,4,120,120,4,3,63,0,120,3,68,4,1,1,120,192,118,82,12,120,0,48,120,63,12,32,122,0,0,135,120,9,0,1,120,196,118,82,120,120,0,45,120,120,63,112,122,0,0,25,100,62,4,82,16,100,0,38,120,16,3,33,120,120,3,121,120,4,0,0,102,63,0,0,103,68,0,119,0,195,0,1,120,184,118,85,120,68,0,38,120,16,254,85,100,120,0,39,121,68,1,109,63,4,121,85,62,68,0,139,0,0,0,43,121,4,3,0,109,121,0,48,121,4,116,56,123,0,0,106,21,63,8,106,30,63,12,41,121,109,1,41,121,121,2,3,72,117,121,46,121,21,72,184,122,0,0,48,121,21,12,168,122,0,0,135,121,9,0,106,121,21,12,46,121,121,63,184,122,0,0,135,121,9,0,45,121,30,21,236,122,0,0,1,121,176,118,1,120,176,118,82,120,120,0,1,122,1,0,22,122,122,109,11,122,122,0,19,120,120,122,85,121,120,0,0,102,63,0,0,103,68,0,119,0,156,0,45,120,30,72,252,122,0,0,25,97,30,8,119,0,11,0,48,120,30,12,8,123,0,0,135,120,9,0,25,96,30,8,82,120,96,0,45,120,120,63,32,123,0,0,0,97,96,0,119,0,2,0,135,120,9,0,109,21,12,30,85,97,21,0,0,102,63,0,0,103,68,0,119,0,137,0,106,42,63,24,106,5,63,12,45,120,5,63,224,123,0,0,25,89,63,16,25,85,89,4,82,7,85,0,120,7,8,0,82,8,89,0,120,8,3,0,1,49,0,0,119,0,49,0,0,48,8,0,0,56,89,0,119,0,3,0,0,48,7,0,0,56,85,0,0,46,48,0,0,54,56,0,25,86,46,20,82,9,86,0,120,9,8,0,25,73,46,16,82,10,73,0,120,10,2,0,119,0,9,0,0,47,10,0,0,55,73,0,119,0,3,0,0,47,9,0,0,55,86,0,0,46,47,0,0,54,55,0,119,0,242,255,48,120,54,12,208,123,0,0,135,120,9,0,119,0,23,0,1,120,0,0,85,54,120,0,0,49,46,0,119,0,19,0,106,6,63,8,48,120,6,12,240,123,0,0,135,120,9,0,25,88,6,12,82,120,88,0,46,120,120,63,4,124,0,0,135,120,9,0,25,99,5,8,82,120,99,0,45,120,120,63,36,124,0,0,85,88,5,0,85,99,6,0,0,49,5,0,119,0,2,0,135,120,9,0,120,42,4,0,0,102,63,0,0,103,68,0,119,0,73,0,106,11,63,28,41,120,11,2,3,74,118,120,82,120,74,0,45,120,120,63,132,124,0,0,85,74,49,0,120,49,31,0,1,120,180,118,1,121,180,118,82,121,121,0,1,122,1,0,22,122,122,11,11,122,122,0,19,121,121,122,85,120,121,0,0,102,63,0,0,103,68,0,119,0,54,0,1,121,192,118,82,121,121,0,48,121,42,121,156,124,0,0,135,121,9,0,119,0,14,0,25,75,42,16,82,120,75,0,45,120,120,63,180,124,0,0,0,121,75,0,119,0,3,0,25,120,42,20,0,121,120,0,85,121,49,0,120,49,4,0,0,102,63,0,0,103,68,0,119,0,35,0,1,121,192,118,82,13,121,0,48,121,49,13,228,124,0,0,135,121,9,0,109,49,24,42,25,90,63,16,82,14,90,0,121,14,8,0,48,121,14,13,4,125,0,0,135,121,9,0,119,0,4,0,109,49,16,14,109,14,24,49,119,0,1,0,106,15,90,4,120,15,4,0,0,102,63,0,0,103,68,0,119,0,14,0,1,121,192,118,82,121,121,0,48,121,15,121,60,125,0,0,135,121,9,0,119,0,8,0,109,49,20,15,109,15,24,49,0,102,63,0,0,103,68,0,119,0,3,0,0,102,0,0,0,103,1,0,1,121,192,118,82,17,121,0,48,121,62,17,108,125,0,0,135,121,9,0,25,101,62,4,82,18,101,0,38,121,18,2,120,121,224,0,1,121,200,118,82,121,121,0,45,121,121,62,224,125,0,0,1,121,188,118,82,121,121,0,3,64,121,103,1,121,188,118,85,121,64,0,1,121,200,118,85,121,102,0,39,120,64,1,109,102,4,120,1,120,196,118,82,120,120,0,46,120,102,120,196,125,0,0,139,0,0,0,1,120,196,118,1,121,0,0,85,120,121,0,1,121,184,118,1,120,0,0,85,121,120,0,139,0,0,0,1,120,196,118,82,120,120,0,45,120,120,62,28,126,0,0,1,120,184,118,82,120,120,0,3,65,120,103,1,120,184,118,85,120,65,0,1,120,196,118,85,120,102,0,39,121,65,1,109,102,4,121,97,102,65,65,139,0,0,0,38,121,18,248,3,66,121,103,43,121,18,3,0,110,121,0,48,121,18,116,220,126,0,0,106,19,62,8,106,20,62,12,41,121,110,1,41,121,121,2,3,76,117,121,46,121,19,76,108,126,0,0,48,121,19,17,92,126,0,0,135,121,9,0,106,121,19,12,46,121,121,62,108,126,0,0,135,121,9,0,45,121,20,19,152,126,0,0,1,121,176,118,1,120,176,118,82,120,120,0,1,122,1,0,22,122,122,110,11,122,122,0,19,120,120,122,85,121,120,0,119,0,140,0,45,120,20,76,168,126,0,0,25,94,20,8,119,0,11,0,48,120,20,17,180,126,0,0,135,120,9,0,25,93,20,8,82,120,93,0,45,120,120,62,204,126,0,0,0,94,93,0,119,0,2,0,135,120,9,0,109,19,12,20,85,94,19,0,119,0,123,0,106,22,62,24,106,23,62,12,45,120,23,62,132,127,0,0,25,91,62,16,25,77,91,4,82,25,77,0,120,25,8,0,82,26,91,0,120,26,3,0,1,53,0,0,119,0,49,0,0,52,26,0,0,59,91,0,119,0,3,0,0,52,25,0,0,59,77,0,0,50,52,0,0,57,59,0,25,78,50,20,82,27,78,0,120,27,8,0,25,79,50,16,82,28,79,0,120,28,2,0,119,0,9,0,0,51,28,0,0,58,79,0,119,0,3,0,0,51,27,0,0,58,78,0,0,50,51,0,0,57,58,0,119,0,242,255,48,120,57,17,116,127,0,0,135,120,9,0,119,0,23,0,1,120,0,0,85,57,120,0,0,53,50,0,119,0,19,0,106,24,62,8,48,120,24,17,148,127,0,0,135,120,9,0,25,87,24,12,82,120,87,0,46,120,120,62,168,127,0,0,135,120,9,0,25,95,23,8,82,120,95,0,45,120,120,62,200,127,0,0,85,87,23,0,85,95,24,0,0,53,23,0,119,0,2,0,135,120,9,0,121,22,62,0,106,29,62,28,41,120,29,2,3,80,118,120,82,120,80,0,45,120,120,62,20,128,0,0,85,80,53,0,120,53,27,0,1,120,180,118,1,121,180,118,82,121,121,0,1,122,1,0,22,122,122,29,11,122,122,0,19,121,121,122,85,120,121,0,119,0,45,0,1,121,192,118,82,121,121,0,48,121,22,121,44,128,0,0,135,121,9,0,119,0,12,0,25,81,22,16,82,120,81,0,45,120,120,62,68,128,0,0,0,121,81,0,119,0,3,0,25,120,22,20,0,121,120,0,85,121,53,0,120,53,2,0,119,0,28,0,1,121,192,118,82,31,121,0,48,121,53,31,108,128,0,0,135,121,9,0,109,53,24,22,25,92,62,16,82,32,92,0,121,32,8,0,48,121,32,31,140,128,0,0,135,121,9,0,119,0,4,0,109,53,16,32,109,32,24,53,119,0,1,0,106,33,92,4,121,33,10,0,1,121,192,118,82,121,121,0,48,121,33,121,184,128,0,0,135,121,9,0,119,0,4,0,109,53,20,33,109,33,24,53,119,0,1,0,39,120,66,1,109,102,4,120,97,102,66,66,1,120,196,118,82,120,120,0,45,120,102,120,240,128,0,0,1,120,184,118,85,120,66,0,139,0,0,0,119,0,9,0,0,104,66,0,119,0,7,0,38,120,18,254,85,101,120,0,39,121,103,1,109,102,4,121,97,102,103,103,0,104,103,0,43,121,104,3,0,111,121,0,48,121,104,116,156,129,0,0,41,121,111,1,41,121,121,2,3,82,117,121,1,121,176,118,82,34,121,0,1,121,1,0,22,121,121,111,0,105,121,0,19,121,34,105,120,121,7,0,1,121,176,118,20,120,34,105,85,121,120,0,25,2,82,8,0,43,82,0,119,0,11,0,25,35,82,8,82,36,35,0,1,120,192,118,82,120,120,0,48,120,36,120,128,129,0,0,135,120,9,0,119,0,3,0,0,2,35,0,0,43,36,0,85,2,102,0,109,43,12,102,109,102,8,43,109,102,12,82,139,0,0,0,43,120,104,8,0,112,120,0,120,112,3,0,1,44,0,0,119,0,42,0,2,120,0,0,255,255,255,0,48,120,120,104,200,129,0,0,1,44,31,0,119,0,36,0,2,120,0,0,0,255,15,0,3,120,112,120,43,120,120,16,38,120,120,8,0,69,120,0,22,120,112,69,0,106,120,0,2,120,0,0,0,240,7,0,3,120,106,120,43,120,120,16,38,120,120,4,0,70,120,0,22,120,106,70,0,107,120,0,2,120,0,0,0,192,3,0,3,120,107,120,43,120,120,16,38,120,120,2,0,71,120,0,1,120,14,0,20,121,70,69,20,121,121,71,4,120,120,121,22,121,107,71,43,121,121,15,3,67,120,121,25,121,67,7,24,121,104,121,38,121,121,1,41,120,67,1,20,121,121,120,0,44,121,0,41,121,44,2,3,83,118,121,109,102,28,44,1,120,0,0,109,102,20,120,1,121,0,0,109,102,16,121,1,121,180,118,82,37,121,0,1,121,1,0,22,121,121,44,0,108,121,0,19,121,37,108,120,121,9,0,1,121,180,118,20,120,37,108,85,121,120,0,85,83,102,0,109,102,24,83,109,102,12,102,109,102,8,102,139,0,0,0,82,38,83,0,106,120,38,4,38,120,120,248,45,120,120,104,200,130,0,0,0,60,38,0,119,0,40,0,32,121,44,31,121,121,4,0,1,121,0,0,0,120,121,0,119,0,5,0,1,121,25,0,43,122,44,1,4,121,121,122,0,120,121,0,22,120,104,120,0,45,120,0,0,61,38,0,25,120,61,16,43,121,45,31,41,121,121,2,3,84,120,121,82,39,84,0,120,39,2,0,119,0,11,0,106,121,39,4,38,121,121,248,45,121,121,104,44,131,0,0,0,60,39,0,119,0,15,0,41,121,45,1,0,45,121,0,0,61,39,0,119,0,240,255,1,121,192,118,82,121,121,0,48,121,84,121,80,131,0,0,135,121,9,0,85,84,102,0,109,102,24,61,109,102,12,102,109,102,8,102,139,0,0,0,25,98,60,8,82,40,98,0,1,121,192,118,82,41,121,0,18,121,41,40,18,120,41,60,19,121,121,120,120,121,2,0,135,121,9,0,109,40,12,102,85,98,102,0,109,102,8,40,109,102,12,60,1,120,0,0,109,102,24,120,139,0,0,0,140,9,114,0,0,0,0,0,136,105,0,0,0,100,105,0,136,105,0,0,1,106,160,0,3,105,105,106,137,105,0,0,130,105,0,0,136,106,0,0,49,105,105,106,224,131,0,0,1,106,160,0,135,105,0,0,106,0,0,0,1,105,152,0,3,78,100,105,1,105,148,0,3,87,100,105,1,105,144,0,3,68,100,105,1,105,140,0,3,79,100,105,1,105,136,0,3,96,100,105,1,105,132,0,3,95,100,105,1,105,128,0,3,99,100,105,1,105,156,0,3,58,100,105,25,88,100,124,25,89,100,120,25,69,100,116,25,53,100,112,25,74,100,108,25,92,100,104,25,72,100,100,25,56,100,96,25,77,100,92,25,90,100,16,25,70,100,8,0,54,100,0,25,75,100,88,25,85,100,84,25,82,100,80,25,84,100,76,25,81,100,72,25,83,100,68,25,80,100,64,25,76,100,60,25,91,100,56,25,71,100,52,25,55,100,48,25,93,100,44,25,73,100,40,25,57,100,36,25,94,100,32,25,97,100,28,25,98,100,24,85,78,0,0,85,87,1,0,85,68,2,0,85,79,3,0,85,96,4,0,85,95,5,0,85,99,6,0,38,105,7,1,83,58,105,0,85,88,8,0,82,106,87,0,32,106,106,0,121,106,4,0,1,106,1,0,0,105,106,0,119,0,5,0,82,106,79,0,82,107,68,0,17,106,106,107,0,105,106,0,121,105,3,0,137,100,0,0,139,0,0,0,82,105,79,0,82,106,68,0,25,106,106,1,46,105,105,106,220,135,0,0,1,105,255,0,85,85,105,0,1,105,0,0,85,82,105,0,1,105,255,0,85,84,105,0,1,105,0,0,85,81,105,0,1,105,255,0,85,83,105,0,1,105,0,0,85,80,105,0,1,105,0,0,85,76,105,0,82,105,87,0,82,106,76,0,56,105,105,106,28,134,0,0,82,105,78,0,82,106,76,0,41,106,106,2,25,106,106,0,91,105,105,106,85,91,105,0,82,105,78,0,82,106,76,0,41,106,106,2,25,106,106,1,91,105,105,106,85,71,105,0,82,105,78,0,82,106,76,0,41,106,106,2,25,106,106,2,91,105,105,106,85,55,105,0,82,105,82,0,82,106,91,0,47,105,105,106,168,133,0,0,116,82,91,0,82,105,91,0,82,106,85,0,47,105,105,106,188,133,0,0,116,85,91,0,82,105,81,0,82,106,71,0,47,105,105,106,208,133,0,0,116,81,71,0,82,105,71,0,82,106,84,0,47,105,105,106,228,133,0,0,116,84,71,0,82,105,80,0,82,106,55,0,47,105,105,106,248,133,0,0,116,80,55,0,82,105,55,0,82,106,83,0,47,105,105,106,12,134,0,0,116,83,55,0,82,105,76,0,25,105,105,1,85,76,105,0,119,0,201,255,82,105,82,0,82,106,85,0,4,105,105,106,85,93,105,0,82,105,81,0,82,106,84,0,4,105,105,106,85,73,105,0,82,105,80,0,82,106,83,0,4,105,105,106,85,57,105,0,1,105,1,0,85,94,105,0,82,106,73,0,82,107,57,0,15,106,106,107,1,107,2,0,1,108,1,0,125,105,106,107,108,0,0,0,85,94,105,0,82,105,57,0,82,108,93,0,47,105,105,108,156,134,0,0,82,105,73,0,82,108,93,0,47,105,105,108,156,134,0,0,1,105,0,0,85,94,105,0,82,105,87,0,82,108,96,0,82,107,68,0,4,108,108,107,5,86,105,108,82,108,79,0,82,105,68,0,4,108,108,105,6,108,86,108,85,97,108,0,82,108,87,0,82,105,97,0,4,108,108,105,85,98,108,0,82,105,78,0,1,107,0,0,82,106,87,0,82,109,94,0,82,110,97,0,134,108,0,0,244,247,1,0,105,107,106,109,110,0,0,0,82,108,88,0,1,110,4,3,3,108,108,110,82,110,99,0,82,109,94,0,95,108,110,109,82,109,88,0,1,110,3,4,3,109,109,110,82,110,99,0,82,108,78,0,82,106,97,0,41,106,106,2,82,107,94,0,3,106,106,107,90,108,108,106,95,109,110,108,82,101,96,0,82,102,95,0,82,110,78,0,82,109,97,0,82,106,68,0,4,107,101,102,28,105,102,2,82,111,99,0,41,111,111,1,78,112,58,0,38,112,112,1,82,113,88,0,134,108,0,0,164,131,0,0,110,109,106,101,107,105,111,112,113,0,0,0,82,103,96,0,82,104,95,0,82,113,78,0,82,112,97,0,41,112,112,2,3,113,113,112,82,112,98,0,82,111,79,0,3,105,103,104,28,107,104,2,82,106,99,0,41,106,106,1,25,106,106,1,78,109,58,0,38,109,109,1,82,110,88,0,134,108,0,0,164,131,0,0,113,112,103,111,105,107,106,109,110,0,0,0,137,100,0,0,139,0,0,0,78,108,58,0,38,108,108,1,121,108,176,0,82,108,68,0,32,108,108,1,121,108,83,0,1,108,255,0,85,89,108,0,1,108,255,0,85,69,108,0,1,108,255,0,85,53,108,0,1,108,0,0,85,74,108,0,82,51,89,0,82,108,87,0,82,110,74,0,56,108,108,110,244,136,0,0,82,108,78,0,82,110,74,0,41,110,110,2,25,110,110,0,91,108,108,110,48,108,51,108,76,136,0,0,82,59,89,0,119,0,6,0,82,108,78,0,82,110,74,0,41,110,110,2,25,110,110,0,91,59,108,110,85,89,59,0,82,108,69,0,82,110,78,0,82,109,74,0,41,109,109,2,25,109,109,1,91,110,110,109,48,108,108,110,140,136,0,0,82,61,69,0,119,0,6,0,82,108,78,0,82,110,74,0,41,110,110,2,25,110,110,1,91,61,108,110,85,69,61,0,82,108,53,0,82,110,78,0,82,109,74,0,41,109,109,2,25,109,109,2,91,110,110,109,48,108,108,110,204,136,0,0,82,62,53,0,119,0,6,0,82,108,78,0,82,110,74,0,41,110,110,2,25,110,110,2,91,62,108,110,85,53,62,0,82,108,74,0,25,108,108,1,85,74,108,0,119,0,201,255,82,108,88,0,25,108,108,4,82,110,68,0,95,108,110,51,82,110,88,0,1,108,4,1,3,110,110,108,82,108,68,0,82,109,69,0,95,110,108,109,82,109,88,0,1,108,4,2,3,109,109,108,82,108,68,0,82,110,53,0,95,109,108,110,137,100,0,0,139,0,0,0,82,110,68,0,1,108,1,0,82,109,88,0,82,109,109,0,22,108,108,109,26,108,108,1,45,110,110,108,164,138,0,0,1,110,0,0,85,92,110,0,1,110,0,0,85,72,110,0,1,110,0,0,85,56,110,0,1,110,0,0,85,77,110,0,82,47,92,0,82,110,87,0,82,108,77,0,56,110,110,108,92,138,0,0,82,110,78,0,82,108,77,0,41,108,108,2,25,108,108,0,91,110,110,108,48,110,110,47,180,137,0,0,82,63,92,0,119,0,6,0,82,110,78,0,82,108,77,0,41,108,108,2,25,108,108,0,91,63,110,108,85,92,63,0,82,110,78,0,82,108,77,0,41,108,108,2,25,108,108,1,91,110,110,108,82,108,72,0,48,110,110,108,244,137,0,0,82,64,72,0,119,0,6,0,82,110,78,0,82,108,77,0,41,108,108,2,25,108,108,1,91,64,110,108,85,72,64,0,82,110,78,0,82,108,77,0,41,108,108,2,25,108,108,2,91,110,110,108,82,108,56,0,48,110,110,108,52,138,0,0,82,60,56,0,119,0,6,0,82,110,78,0,82,108,77,0,41,108,108,2,25,108,108,2,91,60,110,108,85,56,60,0,82,110,77,0,25,110,110,1,85,77,110,0,119,0,201,255,82,110,88,0,25,110,110,4,82,108,68,0,95,110,108,47,82,108,88,0,1,110,4,1,3,108,108,110,82,110,68,0,82,109,72,0,95,108,110,109,82,109,88,0,1,110,4,2,3,109,109,110,82,110,68,0,82,108,56,0,95,109,110,108,137,100,0,0,139,0,0,0,0,48,90,0,1,108,0,0,85,48,108,0,1,110,0,0,109,48,4,110,0,49,70,0,1,110,0,0,85,49,110,0,1,108,0,0,109,49,4,108,0,50,54,0,1,108,0,0,85,50,108,0,1,110,0,0,109,50,4,110,1,110,0,0,85,75,110,0,82,110,87,0,82,108,75,0,56,110,110,108,200,139,0,0,0,52,90,0,82,110,52,0,106,108,52,4,82,109,78,0,82,106,75,0,41,106,106,2,25,106,106,0,91,109,109,106,1,106,0,0,134,9,0,0,48,154,2,0,110,108,109,106,135,10,1,0,0,11,90,0,85,11,9,0,109,11,4,10,0,12,70,0,82,106,12,0,106,109,12,4,82,108,78,0,82,110,75,0,41,110,110,2,25,110,110,1,91,108,108,110,1,110,0,0,134,13,0,0,48,154,2,0,106,109,108,110,135,14,1,0,0,15,70,0,85,15,13,0,109,15,4,14,0,16,54,0,82,110,16,0,106,108,16,4,82,109,78,0,82,106,75,0,41,106,106,2,25,106,106,2,91,109,109,106,1,106,0,0,134,17,0,0,48,154,2,0,110,108,109,106,135,18,1,0,0,19,54,0,85,19,17,0,109,19,4,18,82,106,75,0,25,106,106,1,85,75,106,0,119,0,201,255,82,106,87,0,28,65,106,2,0,20,90,0,82,106,20,0,106,109,20,4,34,108,65,0,41,108,108,31,42,108,108,31,134,21,0,0,48,154,2,0,106,109,65,108,135,22,1,0,0,23,90,0,85,23,21,0,109,23,4,22,82,108,87,0,28,66,108,2,0,24,70,0,82,108,24,0,106,109,24,4,34,106,66,0,41,106,106,31,42,106,106,31,134,25,0,0,48,154,2,0,108,109,66,106,135,26,1,0,0,27,70,0,85,27,25,0,109,27,4,26,82,106,87,0,28,67,106,2,0,28,54,0,82,106,28,0,106,109,28,4,34,108,67,0,41,108,108,31,42,108,108,31,134,29,0,0,48,154,2,0,106,109,67,108,135,30,1,0,0,31,54,0,85,31,29,0,109,31,4,30,82,32,87,0,0,33,90,0,82,108,33,0,106,109,33,4,34,106,32,0,41,106,106,31,42,106,106,31,134,34,0,0,40,155,2,0,108,109,32,106,135,35,1,0,0,36,90,0,85,36,34,0,109,36,4,35,82,37,87,0,0,38,70,0,82,106,38,0,106,109,38,4,34,108,37,0,41,108,108,31,42,108,108,31,134,39,0,0,40,155,2,0,106,109,37,108,135,40,1,0,0,41,70,0,85,41,39,0,109,41,4,40,82,42,87,0,0,43,54,0,82,108,43,0,106,109,43,4,34,106,42,0,41,106,106,31,42,106,106,31,134,44,0,0,40,155,2,0,108,109,42,106,135,45,1,0,0,46,54,0,85,46,44,0,109,46,4,45,82,106,88,0,25,106,106,4,82,109,68,0,82,108,90,0,95,106,109,108,82,108,88,0,1,109,4,1,3,108,108,109,82,109,68,0,82,106,70,0,95,108,109,106,82,106,88,0,1,109,4,2,3,106,106,109,82,109,68,0,82,108,54,0,95,106,109,108,137,100,0,0,139,0,0,0,140,6,82,0,0,0,0,0,2,72,0,0,0,1,0,0,2,73,0,0,4,1,0,0,2,74,0,0,4,2,0,0,2,75,0,0,64,66,15,0,1,70,0,0,136,76,0,0,0,71,76,0,136,76,0,0,1,77,128,0,3,76,76,77,137,76,0,0,130,76,0,0,136,77,0,0,49,76,76,77,208,141,0,0,1,77,128,0,135,76,0,0,77,0,0,0,25,41,71,120,25,49,71,116,25,52,71,112,25,67,71,108,25,38,71,104,25,53,71,100,25,51,71,96,25,60,71,92,25,39,71,88,25,54,71,124,25,56,71,84,25,69,71,80,25,68,71,76,25,50,71,72,25,42,71,68,25,66,71,64,25,37,71,60,25,20,71,56,25,21,71,52,25,22,71,48,25,65,71,44,25,36,71,40,25,19,71,36,25,64,71,32,25,62,71,28,25,63,71,24,25,61,71,20,25,59,71,16,25,57,71,12,25,58,71,8,25,55,71,4,0,40,71,0,85,41,0,0,85,49,1,0,85,52,2,0,85,67,3,0,85,38,4,0,85,53,5,0,82,77,67,0,82,78,38,0,5,76,77,78,85,51,76,0,82,78,51,0,41,78,78,2,41,78,78,2,135,76,6,0,78,0,0,0,85,60,76,0,1,76,0,0,85,39,76,0,82,76,51,0,41,76,76,2,82,78,39,0,56,76,76,78,236,142,0,0,82,76,49,0,82,78,39,0,90,76,76,78,83,54,76,0,79,76,54,0,41,76,76,8,85,56,76,0,82,76,60,0,82,78,39,0,41,78,78,2,82,77,56,0,97,76,78,77,82,77,39,0,25,77,77,1,85,39,77,0,119,0,236,255,1,77,0,0,85,69,77,0,82,77,38,0,82,78,69,0,57,77,77,78,124,150,0,0,1,77,0,0,85,68,77,0,82,77,67,0,82,78,68,0,57,77,77,78,108,150,0,0,82,77,69,0,82,78,67,0,5,43,77,78,82,78,60,0,82,77,68,0,3,77,43,77,41,77,77,2,41,77,77,2,3,78,78,77,85,50,78,0,82,78,41,0,121,78,10,0,82,78,69,0,82,77,67,0,5,44,78,77,82,77,41,0,82,78,68,0,3,78,44,78,41,78,78,2,3,23,77,78,119,0,2,0,1,23,0,0,85,42,23,0,82,78,50,0,82,78,78,0,25,78,78,127,6,78,78,72,85,66,78,0,82,78,50,0,106,78,78,4,25,78,78,127,6,78,78,72,85,37,78,0,82,78,50,0,106,78,78,8,25,78,78,127,6,78,78,72,85,20,78,0,82,78,41,0,121,78,34,0,82,78,42,0,79,78,78,0,82,77,66,0,45,78,78,77,56,144,0,0,82,78,42,0,103,78,78,1,82,77,37,0,45,78,78,77,48,144,0,0,82,78,42,0,103,78,78,2,82,77,20,0,45,78,78,77,40,144,0,0,82,78,50,0,116,78,66,0,82,78,50,0,82,77,37,0,109,78,4,77,82,77,50,0,82,78,20,0,109,77,8,78,82,78,50,0,1,77,0,0,109,78,12,77,119,0,8,0,1,70,15,0,119,0,6,0,1,70,15,0,119,0,4,0,1,70,15,0,119,0,2,0,1,70,15,0,32,77,70,15,121,77,133,1,1,70,0,0,85,21,75,0,1,77,0,0,85,22,77,0,82,78,53,0,82,76,66,0,82,79,37,0,82,80,20,0,1,81,1,0,134,77,0,0,48,122,1,0,78,76,79,80,22,21,81,0,82,77,50,0,82,77,77,0,82,81,53,0,25,81,81,4,82,80,22,0,91,81,81,80,41,81,81,8,4,77,77,81,85,65,77,0,82,77,50,0,106,77,77,4,82,81,53,0,3,81,81,73,82,80,22,0,91,81,81,80,41,81,81,8,4,77,77,81,85,36,77,0,82,77,50,0,106,77,77,8,82,81,53,0,3,81,81,74,82,80,22,0,91,81,81,80,41,81,81,8,4,77,77,81,85,19,77,0,82,77,50,0,82,81,53,0,25,81,81,4,82,80,22,0,91,81,81,80,85,77,81,0,82,81,50,0,82,77,53,0,3,77,77,73,82,80,22,0,91,77,77,80,109,81,4,77,82,77,50,0,82,81,53,0,3,81,81,74,82,80,22,0,91,81,81,80,109,77,8,81,82,81,50,0,82,77,22,0,109,81,12,77,82,77,69,0,82,81,67,0,5,45,77,81,82,81,68,0,3,81,45,81,25,81,81,1,85,64,81,0,82,81,69,0,82,77,67,0,5,46,81,77,82,77,67,0,3,77,46,77,82,81,68,0,3,77,77,81,26,77,77,1,85,62,77,0,82,77,69,0,82,81,67,0,5,47,77,81,82,81,67,0,3,81,47,81,82,77,68,0,3,81,81,77,85,63,81,0,82,81,69,0,82,77,67,0,5,48,81,77,82,77,67,0,3,77,48,77,82,81,68,0,3,77,77,81,25,77,77,1,85,61,77,0,82,77,64,0,82,81,51,0,47,77,77,81,240,146,0,0,82,77,60,0,82,81,64,0,41,81,81,2,41,81,81,2,3,77,77,81,85,59,77,0,82,77,65,0,27,77,77,7,28,77,77,16,1,81,0,0,82,80,59,0,82,80,80,0,4,81,81,80,47,77,77,81,36,146,0,0,1,77,0,0,82,81,59,0,82,81,81,0,4,24,77,81,119,0,4,0,82,81,65,0,27,81,81,7,28,24,81,16,82,6,59,0,82,81,6,0,3,81,81,24,85,6,81,0,82,81,36,0,27,81,81,7,28,81,81,16,1,77,0,0,82,80,59,0,106,80,80,4,4,77,77,80,47,81,81,77,120,146,0,0,1,81,0,0,82,77,59,0,106,77,77,4,4,25,81,77,119,0,4,0,82,77,36,0,27,77,77,7,28,25,77,16,82,77,59,0,25,11,77,4,82,77,11,0,3,77,77,25,85,11,77,0,82,77,19,0,27,77,77,7,28,77,77,16,1,81,0,0,82,80,59,0,106,80,80,8,4,81,81,80,47,77,77,81,208,146,0,0,1,77,0,0,82,81,59,0,106,81,81,8,4,26,77,81,119,0,4,0,82,81,19,0,27,81,81,7,28,26,81,16,82,81,59,0,25,12,81,8,82,81,12,0,3,81,81,26,85,12,81,0,82,81,62,0,82,77,51,0,47,81,81,77,28,148,0,0,82,81,60,0,82,77,62,0,41,77,77,2,41,77,77,2,3,81,81,77,85,57,81,0,82,81,65,0,27,81,81,3,28,81,81,16,1,77,0,0,82,80,57,0,82,80,80,0,4,77,77,80,47,81,81,77,80,147,0,0,1,81,0,0,82,77,57,0,82,77,77,0,4,27,81,77,119,0,4,0,82,77,65,0,27,77,77,3,28,27,77,16,82,7,57,0,82,77,7,0,3,77,77,27,85,7,77,0,82,77,36,0,27,77,77,3,28,77,77,16,1,81,0,0,82,80,57,0,106,80,80,4,4,81,81,80,47,77,77,81,164,147,0,0,1,77,0,0,82,81,57,0,106,81,81,4,4,28,77,81,119,0,4,0,82,81,36,0,27,81,81,3,28,28,81,16,82,81,57,0,25,13,81,4,82,81,13,0,3,81,81,28,85,13,81,0,82,81,19,0,27,81,81,3,28,81,81,16,1,77,0,0,82,80,57,0,106,80,80,8,4,77,77,80,47,81,81,77,252,147,0,0,1,81,0,0,82,77,57,0,106,77,77,8,4,29,81,77,119,0,4,0,82,77,19,0,27,77,77,3,28,29,77,16,82,77,57,0,25,14,77,8,82,77,14,0,3,77,77,29,85,14,77,0,82,77,63,0,82,81,51,0,47,77,77,81,72,149,0,0,82,77,60,0,82,81,63,0,41,81,81,2,41,81,81,2,3,77,77,81,85,58,77,0,82,77,65,0,27,77,77,5,28,77,77,16,1,81,0,0,82,80,58,0,82,80,80,0,4,81,81,80,47,77,77,81,124,148,0,0,1,77,0,0,82,81,58,0,82,81,81,0,4,30,77,81,119,0,4,0,82,81,65,0,27,81,81,5,28,30,81,16,82,8,58,0,82,81,8,0,3,81,81,30,85,8,81,0,82,81,36,0,27,81,81,5,28,81,81,16,1,77,0,0,82,80,58,0,106,80,80,4,4,77,77,80,47,81,81,77,208,148,0,0,1,81,0,0,82,77,58,0,106,77,77,4,4,31,81,77,119,0,4,0,82,77,36,0,27,77,77,5,28,31,77,16,82,77,58,0,25,15,77,4,82,77,15,0,3,77,77,31,85,15,77,0,82,77,19,0,27,77,77,5,28,77,77,16,1,81,0,0,82,80,58,0,106,80,80,8,4,81,81,80,47,77,77,81,40,149,0,0,1,77,0,0,82,81,58,0,106,81,81,8,4,32,77,81,119,0,4,0,82,81,19,0,27,81,81,5,28,32,81,16,82,81,58,0,25,16,81,8,82,81,16,0,3,81,81,32,85,16,81,0,82,81,61,0,82,77,51,0,47,81,81,77,92,150,0,0,82,81,60,0,82,77,61,0,41,77,77,2,41,77,77,2,3,81,81,77,85,55,81,0,82,81,65,0,28,81,81,16,1,77,0,0,82,80,55,0,82,80,80,0,4,77,77,80,47,81,81,77,164,149,0,0,1,81,0,0,82,77,55,0,82,77,77,0,4,33,81,77,119,0,3,0,82,77,65,0,28,33,77,16,82,9,55,0,82,77,9,0,3,77,77,33,85,9,77,0,82,77,36,0,28,77,77,16,1,81,0,0,82,80,55,0,106,80,80,4,4,81,81,80,47,77,77,81,240,149,0,0,1,77,0,0,82,81,55,0,106,81,81,4,4,34,77,81,119,0,3,0,82,81,36,0,28,34,81,16,82,81,55,0,25,17,81,4,82,81,17,0,3,81,81,34,85,17,81,0,82,81,19,0,28,81,81,16,1,77,0,0,82,80,55,0,106,80,80,8,4,77,77,80,47,81,81,77,64,150,0,0,1,81,0,0,82,77,55,0,106,77,77,8,4,35,81,77,119,0,3,0,82,77,19,0,28,35,77,16,82,77,55,0,25,18,77,8,82,77,18,0,3,77,77,35,85,18,77,0,82,77,68,0,25,77,77,1,85,68,77,0,119,0,41,254,82,77,69,0,25,77,77,1,85,69,77,0,119,0,31,254,1,77,0,0,85,40,77,0,82,10,60,0,82,77,51,0,41,77,77,2,82,81,40,0,56,77,77,81,196,150,0,0,82,77,52,0,82,81,40,0,82,80,40,0,41,80,80,2,94,80,10,80,95,77,81,80,82,80,40,0,25,80,80,1,85,40,80,0,119,0,241,255,135,80,8,0,10,0,0,0,137,71,0,0,139,0,0,0,140,13,86,0,0,0,0,0,2,72,0,0,90,48,0,0,2,73,0,0,141,48,0,0,2,74,0,0,180,0,0,0,2,75,0,0,184,0,0,0,2,76,0,0,204,0,0,0,2,77,0,0,212,0,0,0,2,78,0,0,26,9,0,0,2,79,0,0,130,49,0,0,1,50,0,0,136,80,0,0,0,51,80,0,136,80,0,0,25,80,80,80,137,80,0,0,130,80,0,0,136,81,0,0,49,80,80,81,80,151,0,0,1,81,80,0,135,80,0,0,81,0,0,0,25,42,51,64,25,33,51,60,25,34,51,56,25,35,51,52,25,40,51,48,25,41,51,44,25,20,51,40,25,32,51,36,25,47,51,32,25,30,51,28,25,31,51,24,25,27,51,20,25,43,51,16,25,44,51,12,25,36,51,8,25,48,51,4,0,49,51,0,85,33,0,0,85,34,1,0,85,35,2,0,85,40,3,0,85,41,4,0,85,20,5,0,85,32,6,0,85,47,7,0,85,30,8,0,85,31,9,0,85,27,10,0,85,43,11,0,85,44,12,0,82,81,33,0,134,80,0,0,232,45,1,0,81,0,0,0,85,36,80,0,82,80,35,0,121,80,3,0,82,28,35,0,119,0,9,0,82,52,33,0,106,80,52,64,106,81,52,4,5,37,80,81,1,81,66,48,82,80,47,0,91,81,81,80,5,28,37,81,85,48,28,0,82,81,41,0,121,81,3,0,82,29,41,0,119,0,9,0,82,53,33,0,106,81,53,64,106,80,53,20,5,39,81,80,1,80,66,48,82,81,47,0,91,80,80,81,5,29,39,80,85,49,29,0,82,80,33,0,106,80,80,64,34,80,80,0,121,80,5,0,1,81,70,48,1,82,8,9,135,80,4,0,81,72,82,73,1,80,64,0,82,82,33,0,106,82,82,64,47,80,80,82,136,152,0,0,1,82,165,48,1,81,9,9,135,80,4,0,82,72,81,73,1,80,0,0,82,81,33,0,106,81,81,64,49,80,80,81,84,158,0,0,82,80,33,0,106,80,80,64,36,80,80,64,121,80,107,1,1,80,6,0,82,81,33,0,106,81,81,80,50,80,80,81,208,152,0,0,1,81,186,48,1,82,14,9,135,80,4,0,81,72,82,73,1,80,6,0,82,82,33,0,106,82,82,84,50,80,80,82,244,152,0,0,1,82,31,49,1,81,15,9,135,80,4,0,82,72,81,73,1,80,6,0,82,81,33,0,106,81,81,80,50,80,80,81,28,153,0,0,1,80,0,0,85,42,80,0,82,19,42,0,137,51,0,0,139,19,0,0,1,80,6,0,82,81,33,0,106,81,81,84,50,80,80,81,68,153,0,0,1,80,0,0,85,42,80,0,82,19,42,0,137,51,0,0,139,19,0,0,82,80,20,0,34,80,80,0,121,80,4,0,82,80,32,0,39,80,80,3,85,32,80,0,82,80,32,0,38,80,80,2,121,80,6,0,82,80,32,0,38,80,80,1,120,80,4,0,1,50,26,0,119,0,2,0,1,50,26,0,32,80,50,26,121,80,13,0,82,80,20,0,34,80,80,0,121,80,3,0,135,80,4,0,79,72,78,73,82,80,20,0,82,81,33,0,106,81,81,64,54,80,80,81,184,153,0,0,135,80,4,0,79,72,78,73,82,80,33,0,106,80,80,64,82,81,20,0,49,80,80,81,224,153,0,0,1,80,0,0,85,42,80,0,82,19,42,0,137,51,0,0,139,19,0,0,82,80,43,0,120,80,5,0,1,81,183,49,1,82,32,9,135,80,4,0,81,72,82,73,82,80,43,0,120,80,6,0,1,80,0,0,85,42,80,0,82,19,42,0,137,51,0,0,139,19,0,0,82,80,44,0,82,82,36,0,48,80,80,82,52,154,0,0,1,82,191,49,1,81,37,9,135,80,4,0,82,72,81,73,82,80,44,0,82,81,36,0,48,80,80,81,88,154,0,0,1,80,0,0,85,42,80,0,82,19,42,0,137,51,0,0,139,19,0,0,82,81,43,0,1,82,0,0,82,83,44,0,135,80,3,0,81,82,83,0,82,80,33,0,116,80,34,0,82,80,33,0,82,83,48,0,109,80,12,83,82,83,33,0,82,80,40,0,109,83,16,80,82,80,33,0,82,83,49,0,109,80,28,83,82,83,33,0,82,80,20,0,109,83,68,80,82,80,33,0,82,83,32,0,109,80,72,83,82,83,33,0,82,80,47,0,109,83,76,80,82,80,33,0,82,83,30,0,109,80,88,83,82,83,33,0,82,80,31,0,109,83,92,80,82,80,33,0,82,83,27,0,109,80,96,83,82,54,33,0,106,83,54,80,112,80,54,56,145,80,80,0,134,24,0,0,152,51,2,0,83,80,0,0,82,80,33,0,1,83,128,0,97,80,83,24,82,55,33,0,106,83,55,84,112,80,55,60,145,80,80,0,134,25,0,0,152,51,2,0,83,80,0,0,82,80,33,0,1,83,132,0,97,80,83,25,82,56,33,0,106,83,56,80,112,80,56,56,145,80,80,0,134,26,0,0,44,28,2,0,83,80,0,0,82,80,33,0,1,83,136,0,97,80,83,26,82,57,33,0,106,83,57,84,112,80,57,60,145,80,80,0,134,21,0,0,44,28,2,0,83,80,0,0,82,80,33,0,1,83,140,0,97,80,83,21,82,58,33,0,106,83,58,80,112,80,58,56,145,80,80,0,134,22,0,0,20,137,2,0,83,80,0,0,82,80,33,0,1,83,144,0,97,80,83,22,82,59,33,0,106,83,59,84,112,80,59,60,145,80,80,0,134,23,0,0,20,137,2,0,83,80,0,0,82,80,33,0,1,83,148,0,97,80,83,23,82,60,33,0,106,80,60,20,106,82,60,64,5,83,80,82,41,83,83,2,0,38,83,0,82,83,33,0,1,82,160,0,97,83,82,38,82,61,33,0,106,83,61,4,1,80,144,0,94,80,61,80,41,80,80,1,3,83,83,80,109,61,116,83,82,83,33,0,82,82,43,0,109,83,100,82,82,62,33,0,106,83,62,100,1,80,188,0,94,80,62,80,3,83,83,80,109,62,104,83,82,63,33,0,106,82,63,104,1,80,192,0,94,80,63,80,3,82,82,80,109,63,108,82,82,64,33,0,106,83,64,108,1,80,196,0,94,80,64,80,3,83,83,80,109,64,112,83,82,65,33,0,106,82,65,112,1,80,200,0,94,80,65,80,3,82,82,80,109,65,120,82,82,83,33,0,134,82,0,0,212,145,2,0,83,0,0,0,33,45,82,0,82,13,33,0,121,45,29,0,1,83,0,0,109,13,124,83,82,68,33,0,106,82,68,120,94,80,68,76,3,82,82,80,97,68,74,82,82,69,33,0,94,83,69,74,94,80,69,77,3,83,83,80,97,69,75,83,82,83,33,0,94,83,83,75,82,82,33,0,1,80,216,0,94,82,82,80,3,83,83,82,82,82,43,0,82,80,44,0,3,82,82,80,52,83,83,82,120,157,0,0,1,82,232,49,1,80,81,9,135,83,4,0,82,72,80,73,119,0,29,0,82,70,33,0,106,80,13,120,94,82,70,76,3,80,80,82,109,70,124,80,82,71,33,0,106,83,71,124,1,82,208,0,94,82,71,82,3,83,83,82,97,71,74,83,82,83,33,0,1,80,0,0,97,83,75,80,82,80,33,0,94,80,80,74,82,83,33,0,94,83,83,77,3,80,80,83,82,83,43,0,82,82,44,0,3,83,83,82,52,80,80,83,120,157,0,0,1,83,110,50,1,82,89,9,135,80,4,0,83,72,82,73,82,80,33,0,1,82,176,0,1,83,255,255,97,80,82,83,82,83,33,0,112,14,83,56,145,14,14,0,82,83,33,0,112,15,83,48,145,15,15,0,82,66,33,0,106,82,66,100,106,80,66,104,106,81,66,80,106,84,66,4,106,85,66,20,134,83,0,0,184,99,1,0,82,80,81,14,15,84,85,0,82,83,33,0,112,16,83,60,145,16,16,0,82,83,33,0,112,17,83,52,145,17,17,0,82,67,33,0,106,85,67,108,106,84,67,112,106,81,67,84,106,80,67,8,106,82,67,24,134,83,0,0,184,99,1,0,85,84,81,16,17,80,82,0,82,82,33,0,134,83,0,0,212,145,2,0,82,0,0,0,33,46,83,0,82,18,33,0,121,46,5,0,134,83,0,0,252,137,1,0,18,0,0,0,119,0,4,0,134,83,0,0,236,148,1,0,18,0,0,0,1,83,1,0,85,42,83,0,82,19,42,0,137,51,0,0,139,19,0,0,1,83,0,0,85,42,83,0,82,19,42,0,137,51,0,0,139,19,0,0,140,1,6,0,0,0,0,0,1,4,22,63,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,3,0,119,0,100,4,1,4,38,63,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,14,0,119,0,93,4,1,4,53,63,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,8,0,119,0,86,4,1,4,74,63,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,15,0,119,0,79,4,1,4,87,63,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,16,0,119,0,72,4,1,4,105,63,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,17,0,119,0,65,4,1,4,124,63,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,18,0,119,0,58,4,1,4,138,63,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,1,0,119,0,51,4,1,4,151,63,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,4,0,119,0,44,4,1,4,167,63,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,19,0,119,0,37,4,1,4,191,63,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,20,0,119,0,30,4,1,4,203,63,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,3,0,119,0,23,4,1,4,223,63,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,4,0,119,0,16,4,1,4,236,63,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,5,0,119,0,9,4,1,4,252,63,134,3,0,0], eb + 30720);
  HEAPU8.set([196,128,2,0,0,4,0,0,120,3,3,0,1,1,5,0,119,0,2,4,1,4,21,64,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,5,0,119,0,251,3,1,4,29,64,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,2,0,119,0,244,3,1,4,42,64,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,1,0,119,0,237,3,1,4,56,64,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,6,0,119,0,230,3,1,4,71,64,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,6,0,119,0,223,3,1,4,83,64,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,7,0,119,0,216,3,1,4,99,64,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,1,0,119,0,209,3,1,4,122,64,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,1,0,119,0,202,3,1,4,148,64,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,2,0,119,0,195,3,1,4,165,64,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,3,0,119,0,188,3,1,4,185,64,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,1,0,119,0,181,3,1,4,201,64,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,6,0,119,0,174,3,1,4,216,64,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,8,0,119,0,167,3,1,4,227,64,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,21,0,119,0,160,3,1,4,243,64,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,22,0,119,0,153,3,1,4,8,65,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,9,0,119,0,146,3,1,4,24,65,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,23,0,119,0,139,3,1,4,46,65,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,10,0,119,0,132,3,1,4,61,65,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,24,0,119,0,125,3,1,4,78,65,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,11,0,119,0,118,3,1,4,90,65,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,12,0,119,0,111,3,1,4,102,65,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,1,0,119,0,104,3,1,4,116,65,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,25,0,119,0,97,3,1,4,131,65,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,13,0,119,0,90,3,1,4,141,65,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,14,0,119,0,83,3,1,4,168,65,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,9,0,119,0,76,3,1,4,181,65,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,7,0,119,0,69,3,1,4,196,65,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,15,0,119,0,62,3,1,4,205,65,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,16,0,119,0,55,3,1,4,231,65,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,2,0,119,0,48,3,1,4,240,65,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,3,0,119,0,41,3,1,4,248,65,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,8,0,119,0,34,3,1,4,18,66,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,3,0,119,0,27,3,1,4,41,66,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,17,0,119,0,20,3,1,4,53,66,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,26,0,119,0,13,3,1,4,66,66,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,18,0,119,0,6,3,1,4,83,66,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,27,0,119,0,255,2,1,4,101,66,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,28,0,119,0,248,2,1,4,120,66,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,29,0,119,0,241,2,1,4,134,66,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,1,0,119,0,234,2,1,4,152,66,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,2,0,119,0,227,2,1,4,171,66,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,9,0,119,0,220,2,1,4,192,66,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,1,0,119,0,213,2,1,4,212,66,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,30,0,119,0,206,2,1,4,226,66,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,10,0,119,0,199,2,1,4,249,66,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,2,0,119,0,192,2,1,4,4,67,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,31,0,119,0,185,2,1,4,16,67,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,10,0,119,0,178,2,1,4,54,67,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,32,0,119,0,171,2,1,4,68,67,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,11,0,119,0,164,2,1,4,83,67,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,11,0,119,0,157,2,1,4,103,67,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,12,0,119,0,150,2,1,4,132,67,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,13,0,119,0,143,2,1,4,146,67,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,12,0,119,0,136,2,1,4,165,67,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,13,0,119,0,129,2,1,4,192,67,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,14,0,119,0,122,2,1,4,210,67,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,7,0,119,0,115,2,1,4,222,67,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,14,0,119,0,108,2,1,4,242,67,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,15,0,119,0,101,2,1,4,6,68,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,16,0,119,0,94,2,1,4,21,68,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,17,0,119,0,87,2,1,4,36,68,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,2,0,119,0,80,2,1,4,57,68,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,18,0,119,0,73,2,1,4,77,68,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,19,0,119,0,66,2,1,4,97,68,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,20,0,119,0,59,2,1,4,123,68,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,33,0,119,0,52,2,1,4,130,68,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,8,0,119,0,45,2,1,4,141,68,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,9,0,119,0,38,2,1,4,153,68,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,10,0,119,0,31,2,1,4,169,68,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,11,0,119,0,24,2,1,4,181,68,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,12,0,119,0,17,2,1,4,198,68,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,13,0,119,0,10,2,1,4,209,68,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,14,0,119,0,3,2,1,4,221,68,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,2,0,119,0,252,1,1,4,233,68,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,19,0,119,0,245,1,1,4,247,68,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,34,0,119,0,238,1,1,4,5,69,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,2,0,119,0,231,1,1,4,21,69,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,3,0,119,0,224,1,1,4,34,69,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,4,0,119,0,217,1,1,4,58,69,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,15,0,119,0,210,1,1,4,80,69,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,1,0,119,0,203,1,1,4,97,69,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,16,0,119,0,196,1,1,4,107,69,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,4,0,119,0,189,1,1,4,122,69,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,17,0,119,0,182,1,1,4,137,69,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,21,0,119,0,175,1,1,4,151,69,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,18,0,119,0,168,1,1,4,173,69,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,20,0,119,0,161,1,1,4,187,69,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,35,0,119,0,154,1,1,4,209,69,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,22,0,119,0,147,1,1,4,221,69,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,19,0,119,0,140,1,1,4,241,69,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,2,0,119,0,133,1,1,4,254,69,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,1,0,119,0,126,1,1,4,14,70,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,23,0,119,0,119,1,1,4,31,70,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,24,0,119,0,112,1,1,4,47,70,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,25,0,119,0,105,1,1,4,64,70,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,3,0,119,0,98,1,1,4,80,70,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,1,0,119,0,91,1,1,4,92,70,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,26,0,119,0,84,1,1,4,105,70,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,36,0,119,0,77,1,1,4,117,70,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,27,0,119,0,70,1,1,4,130,70,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,1,0,119,0,63,1,1,4,142,70,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,28,0,119,0,56,1,1,4,155,70,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,29,0,119,0,49,1,1,4,167,70,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,30,0,119,0,42,1,1,4,180,70,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,1,0,119,0,35,1,1,4,192,70,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,31,0,119,0,28,1,1,4,205,70,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,20,0,119,0,21,1,1,4,217,70,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,32,0,119,0,14,1,1,4,230,70,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,1,0,119,0,7,1,1,4,242,70,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,33,0,119,0,0,1,1,4,255,70,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,5,0,119,0,249,0,1,4,11,71,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,34,0,119,0,242,0,1,4,24,71,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,21,0,119,0,235,0,1,4,43,71,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,22,0,119,0,228,0,1,4,62,71,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,23,0,119,0,221,0,1,4,81,71,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,21,0,119,0,214,0,1,4,94,71,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,22,0,119,0,207,0,1,4,112,71,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,2,0,119,0,200,0,1,4,129,71,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,37,0,119,0,193,0,1,4,147,71,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,2,0,119,0,186,0,1,4,164,71,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,38,0,119,0,179,0,1,4,182,71,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,2,0,119,0,172,0,1,4,199,71,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,39,0,119,0,165,0,1,4,217,71,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,2,0,119,0,158,0,1,4,234,71,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,40,0,119,0,151,0,1,4,252,71,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,1,0,119,0,144,0,1,4,18,72,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,24,0,119,0,137,0,1,4,29,72,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,7,0,119,0,130,0,1,4,45,72,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,8,0,119,0,123,0,1,4,64,72,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,3,0,119,0,116,0,1,4,77,72,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,9,0,119,0,109,0,1,4,93,72,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,1,0,119,0,102,0,1,4,107,72,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,10,0,119,0,95,0,1,4,125,72,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,3,0,119,0,88,0,1,4,141,72,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,4,0,119,0,81,0,1,4,163,72,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,5,0,119,0,74,0,1,4,186,72,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,6,0,119,0,67,0,1,4,210,72,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,7,0,119,0,60,0,1,4,235,72,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,2,0,119,0,53,0,1,4,0,73,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,11,0,119,0,46,0,1,4,24,73,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,12,0,119,0,39,0,1,4,45,73,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,4,0,119,0,32,0,1,4,64,73,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,13,0,119,0,25,0,1,4,83,73,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,2,0,119,0,18,0,1,4,110,73,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,2,0,119,0,11,0,1,4,139,73,134,3,0,0,196,128,2,0,0,4,0,0,32,2,3,0,1,4,6,0,1,5,0,0,125,3,2,4,5,0,0,0,139,3,0,0,139,1,0,0,140,3,125,0,0,0,0,0,136,120,0,0,0,117,120,0,136,120,0,0,25,120,120,64,137,120,0,0,130,120,0,0,136,121,0,0,49,120,120,121,84,176,0,0,1,121,64,0,135,120,0,0,121,0,0,0,0,115,117,0,0,116,115,0,25,119,116,64,1,120,0,0,85,116,120,0,25,116,116,4,54,120,116,119,96,176,0,0,88,3,1,0,145,3,3,0,88,120,2,0,145,120,120,0,65,99,3,120,145,99,99,0,112,23,1,16,145,23,23,0,112,121,2,4,145,121,121,0,65,120,23,121,145,120,120,0,63,67,99,120,145,67,67,0,112,34,1,32,145,34,34,0,112,121,2,8,145,121,121,0,65,120,34,121,145,120,120,0,63,91,67,120,145,91,91,0,112,45,1,48,145,45,45,0,112,122,2,12,145,122,122,0,65,121,45,122,145,121,121,0,63,120,91,121,145,120,120,0,89,115,120,0,88,56,1,0,145,56,56,0,112,120,2,16,145,120,120,0,65,100,56,120,145,100,100,0,112,4,1,16,145,4,4,0,112,121,2,20,145,121,121,0,65,120,4,121,145,120,120,0,63,72,100,120,145,72,72,0,112,15,1,32,145,15,15,0,112,121,2,24,145,121,121,0,65,120,15,121,145,120,120,0,63,77,72,120,145,77,77,0,112,20,1,48,145,20,20,0,112,123,2,28,145,123,123,0,65,122,20,123,145,122,122,0,63,121,77,122,145,121,121,0,113,115,16,121,88,21,1,0,145,21,21,0,112,121,2,32,145,121,121,0,65,109,21,121,145,109,109,0,112,22,1,16,145,22,22,0,112,120,2,36,145,120,120,0,65,121,22,120,145,121,121,0,63,88,109,121,145,88,88,0,112,24,1,32,145,24,24,0,112,120,2,40,145,120,120,0,65,121,24,120,145,121,121,0,63,89,88,121,145,89,89,0,112,25,1,48,145,25,25,0,112,123,2,44,145,123,123,0,65,122,25,123,145,122,122,0,63,120,89,122,145,120,120,0,113,115,32,120,88,26,1,0,145,26,26,0,112,120,2,48,145,120,120,0,65,110,26,120,145,110,110,0,112,27,1,16,145,27,27,0,112,121,2,52,145,121,121,0,65,120,27,121,145,120,120,0,63,90,110,120,145,90,90,0,112,28,1,32,145,28,28,0,112,121,2,56,145,121,121,0,65,120,28,121,145,120,120,0,63,92,90,120,145,92,92,0,112,29,1,48,145,29,29,0,112,123,2,60,145,123,123,0,65,122,29,123,145,122,122,0,63,121,92,122,145,121,121,0,113,115,48,121,112,30,1,4,145,30,30,0,88,121,2,0,145,121,121,0,65,111,30,121,145,111,111,0,112,31,1,20,145,31,31,0,112,120,2,4,145,120,120,0,65,121,31,120,145,121,121,0,63,93,111,121,145,93,93,0,112,32,1,36,145,32,32,0,112,120,2,8,145,120,120,0,65,121,32,120,145,121,121,0,63,94,93,121,145,94,94,0,112,33,1,52,145,33,33,0,112,123,2,12,145,123,123,0,65,122,33,123,145,122,122,0,63,120,94,122,145,120,120,0,113,115,4,120,112,35,1,4,145,35,35,0,112,120,2,16,145,120,120,0,65,112,35,120,145,112,112,0,112,36,1,20,145,36,36,0,112,121,2,20,145,121,121,0,65,120,36,121,145,120,120,0,63,95,112,120,145,95,95,0,112,37,1,36,145,37,37,0,112,121,2,24,145,121,121,0,65,120,37,121,145,120,120,0,63,96,95,120,145,96,96,0,112,38,1,52,145,38,38,0,112,123,2,28,145,123,123,0,65,122,38,123,145,122,122,0,63,121,96,122,145,121,121,0,113,115,20,121,112,39,1,4,145,39,39,0,112,121,2,32,145,121,121,0,65,113,39,121,145,113,113,0,112,40,1,20,145,40,40,0,112,120,2,36,145,120,120,0,65,121,40,120,145,121,121,0,63,97,113,121,145,97,97,0,112,41,1,36,145,41,41,0,112,120,2,40,145,120,120,0,65,121,41,120,145,121,121,0,63,98,97,121,145,98,98,0,112,42,1,52,145,42,42,0,112,123,2,44,145,123,123,0,65,122,42,123,145,122,122,0,63,120,98,122,145,120,120,0,113,115,36,120,112,43,1,4,145,43,43,0,112,120,2,48,145,120,120,0,65,114,43,120,145,114,114,0,112,44,1,20,145,44,44,0,112,121,2,52,145,121,121,0,65,120,44,121,145,120,120,0,63,68,114,120,145,68,68,0,112,46,1,36,145,46,46,0,112,121,2,56,145,121,121,0,65,120,46,121,145,120,120,0,63,69,68,120,145,69,69,0,112,47,1,52,145,47,47,0,112,123,2,60,145,123,123,0,65,122,47,123,145,122,122,0,63,121,69,122,145,121,121,0,113,115,52,121,112,48,1,8,145,48,48,0,88,121,2,0,145,121,121,0,65,101,48,121,145,101,101,0,112,49,1,24,145,49,49,0,112,120,2,4,145,120,120,0,65,121,49,120,145,121,121,0,63,70,101,121,145,70,70,0,112,50,1,40,145,50,50,0,112,120,2,8,145,120,120,0,65,121,50,120,145,121,121,0,63,71,70,121,145,71,71,0,112,51,1,56,145,51,51,0,112,123,2,12,145,123,123,0,65,122,51,123,145,122,122,0,63,120,71,122,145,120,120,0,113,115,8,120,112,52,1,8,145,52,52,0,112,120,2,16,145,120,120,0,65,102,52,120,145,102,102,0,112,53,1,24,145,53,53,0,112,121,2,20,145,121,121,0,65,120,53,121,145,120,120,0,63,73,102,120,145,73,73,0,112,54,1,40,145,54,54,0,112,121,2,24,145,121,121,0,65,120,54,121,145,120,120,0,63,74,73,120,145,74,74,0,112,55,1,56,145,55,55,0,112,123,2,28,145,123,123,0,65,122,55,123,145,122,122,0,63,121,74,122,145,121,121,0,113,115,24,121,112,57,1,8,145,57,57,0,112,121,2,32,145,121,121,0,65,103,57,121,145,103,103,0,112,58,1,24,145,58,58,0,112,120,2,36,145,120,120,0,65,121,58,120,145,121,121,0,63,75,103,121,145,75,75,0,112,59,1,40,145,59,59,0,112,120,2,40,145,120,120,0,65,121,59,120,145,121,121,0,63,76,75,121,145,76,76,0,112,60,1,56,145,60,60,0,112,123,2,44,145,123,123,0,65,122,60,123,145,122,122,0,63,120,76,122,145,120,120,0,113,115,40,120,112,61,1,8,145,61,61,0,112,120,2,48,145,120,120,0,65,104,61,120,145,104,104,0,112,62,1,24,145,62,62,0,112,121,2,52,145,121,121,0,65,120,62,121,145,120,120,0,63,78,104,120,145,78,78,0,112,63,1,40,145,63,63,0,112,121,2,56,145,121,121,0,65,120,63,121,145,120,120,0,63,79,78,120,145,79,79,0,112,64,1,56,145,64,64,0,112,123,2,60,145,123,123,0,65,122,64,123,145,122,122,0,63,121,79,122,145,121,121,0,113,115,56,121,112,65,1,12,145,65,65,0,88,121,2,0,145,121,121,0,65,105,65,121,145,105,105,0,112,66,1,28,145,66,66,0,112,120,2,4,145,120,120,0,65,121,66,120,145,121,121,0,63,80,105,121,145,80,80,0,112,5,1,44,145,5,5,0,112,120,2,8,145,120,120,0,65,121,5,120,145,121,121,0,63,81,80,121,145,81,81,0,112,6,1,60,145,6,6,0,112,123,2,12,145,123,123,0,65,122,6,123,145,122,122,0,63,120,81,122,145,120,120,0,113,115,12,120,112,7,1,12,145,7,7,0,112,120,2,16,145,120,120,0,65,106,7,120,145,106,106,0,112,8,1,28,145,8,8,0,112,121,2,20,145,121,121,0,65,120,8,121,145,120,120,0,63,82,106,120,145,82,82,0,112,9,1,44,145,9,9,0,112,121,2,24,145,121,121,0,65,120,9,121,145,120,120,0,63,83,82,120,145,83,83,0,112,10,1,60,145,10,10,0,112,123,2,28,145,123,123,0,65,122,10,123,145,122,122,0,63,121,83,122,145,121,121,0,113,115,28,121,112,11,1,12,145,11,11,0,112,121,2,32,145,121,121,0,65,107,11,121,145,107,107,0,112,12,1,28,145,12,12,0,112,120,2,36,145,120,120,0,65,121,12,120,145,121,121,0,63,84,107,121,145,84,84,0,112,13,1,44,145,13,13,0,112,120,2,40,145,120,120,0,65,121,13,120,145,121,121,0,63,85,84,121,145,85,85,0,112,14,1,60,145,14,14,0,112,123,2,44,145,123,123,0,65,122,14,123,145,122,122,0,63,120,85,122,145,120,120,0,113,115,44,120,112,16,1,12,145,16,16,0,112,120,2,48,145,120,120,0,65,108,16,120,145,108,108,0,112,17,1,28,145,17,17,0,112,121,2,52,145,121,121,0,65,120,17,121,145,120,120,0,63,86,108,120,145,86,86,0,112,18,1,44,145,18,18,0,112,121,2,56,145,121,121,0,65,120,18,121,145,120,120,0,63,87,86,120,145,87,87,0,112,19,1,60,145,19,19,0,112,123,2,60,145,123,123,0,65,122,19,123,145,122,122,0,63,121,87,122,145,121,121,0,113,115,60,121,0,116,0,0,0,118,115,0,25,119,116,64,116,116,118,0,25,116,116,4,25,118,118,4,54,121,116,119,64,184,0,0,137,117,0,0,139,0,0,0,140,2,71,0,0,0,0,0,136,64,0,0,0,63,64,0,136,64,0,0,25,64,64,112,137,64,0,0,130,64,0,0,136,65,0,0,49,64,64,65,148,184,0,0,1,65,112,0,135,64,0,0,65,0,0,0,25,59,63,108,25,49,63,104,25,62,63,100,25,37,63,96,25,52,63,92,25,61,63,88,25,60,63,84,25,25,63,80,25,55,63,76,25,31,63,72,25,29,63,68,25,30,63,64,25,53,63,60,25,54,63,56,25,57,63,52,25,58,63,48,25,50,63,44,25,51,63,40,25,28,63,36,25,27,63,32,25,26,63,28,25,56,63,24,25,32,63,20,25,34,63,16,25,35,63,12,25,36,63,8,25,33,63,4,0,24,63,0,85,59,0,0,85,49,1,0,82,64,59,0,25,64,64,20,116,52,64,0,82,64,59,0,25,64,64,108,116,61,64,0,82,64,59,0,25,64,64,112,116,60,64,0,82,64,59,0,25,64,64,64,116,25,64,0,82,64,59,0,1,65,164,0,3,64,64,65,116,55,64,0,82,64,59,0,25,64,64,124,116,31,64,0,82,64,59,0,1,65,132,0,3,64,64,65,116,29,64,0,82,64,49,0,82,65,59,0,1,66,148,0,94,65,65,66,3,64,64,65,85,30,64,0,82,64,59,0,1,65,180,0,3,64,64,65,116,53,64,0,82,64,59,0,1,65,176,0,3,64,64,65,116,54,64,0,82,64,59,0,1,65,168,0,3,64,64,65,116,57,64,0,82,64,59,0,1,65,160,0,94,64,64,65,29,64,64,4,85,58,64,0,82,64,61,0,82,65,30,0,41,65,65,3,3,64,64,65,116,50,64,0,82,64,61,0,82,65,30,0,41,65,65,3,3,64,64,65,25,64,64,4,116,51,64,0,82,65,59,0,134,64,0,0,212,145,2,0,65,0,0,0,121,64,7,0,1,65,240,50,1,66,90,48,1,67,212,7,1,68,138,51,135,64,4,0,65,66,67,68,116,37,50,0,82,64,51,0,82,68,37,0,54,64,64,68,108,191,0,0,82,64,37,0,82,68,50,0,4,64,64,68,85,28,64,0,82,68,29,0,82,67,30,0,5,64,68,67,85,27,64,0,82,67,60,0,82,68,27,0,82,66,28,0,3,68,68,66,41,68,68,2,100,64,67,68,145,64,64,0,89,26,64,0,82,67,37,0,82,68,53,0,82,66,54,0,82,65,57,0,82,69,55,0,82,70,58,0,134,64,0,0,28,255,1,0,67,68,66,65,69,70,0,0,85,56,64,0,82,64,25,0,1,65,1,0,1,70,4,0,138,64,65,70,116,187,0,0,240,187,0,0,196,188,0,0,232,189,0,0,1,70,0,0,85,62,70,0,82,70,52,0,82,69,62,0,56,70,70,69,92,191,0,0,82,69,62,0,82,65,25,0,5,70,69,65,85,33,70,0,1,70,0,0,85,24,70,0,82,70,25,0,82,65,24,0,56,70,70,65,100,187,0,0,82,70,31,0,82,65,33,0,82,69,24,0,3,65,65,69,41,65,65,2,100,6,70,65,145,6,6,0,88,70,26,0,145,70,70,0,65,38,6,70,145,38,38,0,82,70,56,0,82,65,33,0,82,69,24,0,3,65,65,69,41,65,65,2,3,14,70,65,88,70,14,0,145,70,70,0,63,65,70,38,145,65,65,0,89,14,65,0,82,65,24,0,25,65,65,1,85,24,65,0,119,0,227,255,82,65,62,0,25,65,65,1,85,62,65,0,119,0,213,255,1,70,0,0,85,62,70,0,82,70,52,0,82,69,62,0,56,70,70,69,92,191,0,0,116,32,62,0,82,70,31,0,82,69,32,0,25,69,69,0,41,69,69,2,100,7,70,69,145,7,7,0,88,70,26,0,145,70,70,0,65,39,7,70,145,39,39,0,82,70,56,0,82,69,32,0,25,69,69,0,41,69,69,2,3,15,70,69,88,70,15,0,145,70,70,0,63,69,70,39,145,69,69,0,89,15,69,0,82,69,62,0,25,69,69,1,85,62,69,0,119,0,228,255,1,69,0,0,85,62,69,0,82,69,52,0,82,70,62,0,56,69,69,70,92,191,0,0,82,69,62,0,41,69,69,1,85,34,69,0,82,69,31,0,82,70,34,0,25,70,70,0,41,70,70,2,100,8,69,70,145,8,8,0,88,69,26,0,145,69,69,0,65,40,8,69,145,40,40,0,82,69,56,0,82,70,34,0,25,70,70,0,41,70,70,2,3,16,69,70,88,69,16,0,145,69,69,0,63,70,69,40,145,70,70,0,89,16,70,0,82,70,31,0,82,69,34,0,25,69,69,1,41,69,69,2,100,9,70,69,145,9,9,0,88,70,26,0,145,70,70,0,65,41,9,70,145,41,41,0,82,70,56,0,82,69,34,0,25,69,69,1,41,69,69,2,3,17,70,69,88,70,17,0,145,70,70,0,63,69,70,41,145,69,69,0,89,17,69,0,82,69,62,0,25,69,69,1,85,62,69,0,119,0,206,255,1,69,0,0,85,62,69,0,82,69,52,0,82,70,62,0,56,69,69,70,92,191,0,0,82,69,62,0,27,69,69,3,85,35,69,0,82,69,31,0,82,70,35,0,25,70,70,0,41,70,70,2,100,10,69,70,145,10,10,0,88,69,26,0,145,69,69,0,65,42,10,69,145,42,42,0,82,69,56,0,82,70,35,0,25,70,70,0,41,70,70,2,3,18,69,70,88,69,18,0,145,69,69,0,63,70,69,42,145,70,70,0,89,18,70,0,82,70,31,0,82,69,35,0,25,69,69,1,41,69,69,2,100,11,70,69,145,11,11,0,88,70,26,0,145,70,70,0,65,43,11,70,145,43,43,0,82,70,56,0,82,69,35,0,25,69,69,1,41,69,69,2,3,19,70,69,88,70,19,0,145,70,70,0,63,69,70,43,145,69,69,0,89,19,69,0,82,69,31,0,82,70,35,0,25,70,70,2,41,70,70,2,100,12,69,70,145,12,12,0,88,69,26,0,145,69,69,0,65,44,12,69,145,44,44,0,82,69,56,0,82,70,35,0,25,70,70,2,41,70,70,2,3,20,69,70,88,69,20,0,145,69,69,0,63,70,69,44,145,70,70,0,89,20,70,0,82,70,62,0,25,70,70,1,85,62,70,0,119,0,186,255,1,70,0,0,85,62,70,0,82,70,52,0,82,69,62,0,56,70,70,69,92,191,0,0,82,70,62,0,41,70,70,2,85,36,70,0,82,70,31,0,82,69,36,0,25,69,69,0,41,69,69,2,100,2,70,69,145,2,2,0,88,70,26,0,145,70,70,0,65,45,2,70,145,45,45,0,82,70,56,0,82,69,36,0,25,69,69,0,41,69,69,2,3,21,70,69,88,70,21,0,145,70,70,0,63,69,70,45,145,69,69,0,89,21,69,0,82,69,31,0,82,70,36,0,25,70,70,1,41,70,70,2,100,3,69,70,145,3,3,0,88,69,26,0,145,69,69,0,65,46,3,69,145,46,46,0,82,69,56,0,82,70,36,0,25,70,70,1,41,70,70,2,3,22,69,70,88,69,22,0,145,69,69,0,63,70,69,46,145,70,70,0,89,22,70,0,82,70,31,0,82,69,36,0,25,69,69,2,41,69,69,2,100,4,70,69,145,4,4,0,88,70,26,0,145,70,70,0,65,47,4,70,145,47,47,0,82,70,56,0,82,69,36,0,25,69,69,2,41,69,69,2,3,23,70,69,88,70,23,0,145,70,70,0,63,69,70,47,145,69,69,0,89,23,69,0,82,69,31,0,82,70,36,0,25,70,70,3,41,70,70,2,100,5,69,70,145,5,5,0,88,69,26,0,145,69,69,0,65,48,5,69,145,48,48,0,82,69,56,0,82,70,36,0,25,70,70,3,41,70,70,2,3,13,69,70,88,69,13,0,145,69,69,0,63,70,69,48,145,70,70,0,89,13,70,0,82,70,62,0,25,70,70,1,85,62,70,0,119,0,166,255,82,64,37,0,25,64,64,1,85,37,64,0,119,0,174,254,137,63,0,0,139,0,0,0,140,1,51,0,0,0,0,0,2,42,0,0,0,248,0,0,2,43,0,0,240,0,0,0,2,44,0,0,192,7,0,0,2,45,0,0,224,7,0,0,2,46,0,0,0,15,0,0,136,47,0,0,0,41,47,0,136,47,0,0,25,47,47,32,137,47,0,0,130,47,0,0,136,48,0,0,49,47,47,48,212,191,0,0,1,48,32,0,135,47,0,0,48,0,0,0,25,40,41,12,25,25,41,8,25,26,41,4,25,37,41,20,25,39,41,18,25,38,41,16,106,49,0,4,106,50,0,8,5,48,49,50,41,48,48,4,135,47,6,0,48,0,0,0,85,40,47,0,1,47,11,0,106,48,0,16,49,47,47,48,56,192,0,0,1,48,4,0,1,50,143,58,134,47,0,0,216,31,2,0,48,50,41,0,82,9,40,0,137,41,0,0,139,9,0,0,1,47,0,0,85,25,47,0,1,47,0,0,85,26,47,0,106,50,0,4,106,48,0,8,5,47,50,48,82,48,25,0,56,47,47,48,40,201,0,0,106,47,0,16,1,50,1,0,1,48,10,0,138,47,50,48,156,192,0,0,96,193,0,0,80,194,0,0,60,195,0,0,20,196,0,0,44,197,0,0,68,198,0,0,60,199,0,0,184,199,0,0,96,200,0,0,119,0,32,2,82,50,0,0,82,49,25,0,91,48,50,49,76,48,48,0,145,48,48,0,59,50,255,0,145,50,50,0,66,11,48,50,145,11,11,0,82,50,40,0,82,48,25,0,41,48,48,4,101,50,48,11,82,50,0,0,82,49,25,0,91,48,50,49,76,48,48,0,145,48,48,0,59,50,255,0,145,50,50,0,66,12,48,50,145,12,12,0,82,50,40,0,82,48,25,0,41,48,48,4,3,50,50,48,113,50,4,12,82,48,0,0,82,49,25,0,91,50,48,49,76,50,50,0,145,50,50,0,59,48,255,0,145,48,48,0,66,17,50,48,145,17,17,0,82,48,40,0,82,50,25,0,41,50,50,4,3,48,48,50,113,48,8,17,82,48,40,0,82,50,25,0,41,50,50,4,3,48,48,50,59,50,1,0,145,50,50,0,113,48,12,50,119,0,239,1,82,48,0,0,82,49,26,0,91,50,48,49,76,50,50,0,145,50,50,0,59,48,255,0,145,48,48,0,66,21,50,48,145,21,21,0,82,48,40,0,82,50,25,0,41,50,50,4,101,48,50,21,82,48,0,0,82,49,26,0,91,50,48,49,76,50,50,0,145,50,50,0,59,48,255,0,145,48,48,0,66,22,50,48,145,22,22,0,82,48,40,0,82,50,25,0,41,50,50,4,3,48,48,50,113,48,4,22,82,50,0,0,82,49,26,0,91,48,50,49,76,48,48,0,145,48,48,0,59,50,255,0,145,50,50,0,66,23,48,50,145,23,23,0,82,50,40,0,82,48,25,0,41,48,48,4,3,50,50,48,113,50,8,23,82,48,0,0,82,49,26,0,25,49,49,1,91,50,48,49,76,50,50,0,145,50,50,0,59,48,255,0,145,48,48,0,66,24,50,48,145,24,24,0,82,48,40,0,82,50,25,0,41,50,50,4,3,48,48,50,113,48,12,24,82,48,26,0,25,48,48,2,85,26,48,0,119,0,179,1,82,48,0,0,82,50,25,0,41,50,50,1,92,48,48,50,84,39,48,0,81,50,39,0,19,50,50,42,42,50,50,11,76,50,50,0,145,48,50,0,62,50,0,0,184,121,99,0,33,132,160,63,145,50,50,0,65,34,48,50,145,34,34,0,82,50,40,0,82,48,25,0,41,48,48,4,101,50,48,34,81,50,39,0,19,50,50,45,42,50,50,5,76,50,50,0,145,48,50,0,62,50,0,0,104,239,45,32,4,65,144,63,145,50,50,0,65,35,48,50,145,35,35,0,82,50,40,0,82,48,25,0,41,48,48,4,3,50,50,48,113,50,4,35,81,48,39,0,38,48,48,31,76,48,48,0,145,50,48,0,62,48,0,0,184,121,99,0,33,132,160,63,145,48,48,0,65,36,50,48,145,36,36,0,82,48,40,0,82,50,25,0,41,50,50,4,3,48,48,50,113,48,8,36,82,48,40,0,82,50,25,0,41,50,50,4,3,48,48,50,59,50,1,0,145,50,50,0,113,48,12,50,119,0,120,1,82,48,0,0,82,49,26,0,91,50,48,49,76,50,50,0,145,50,50,0,59,48,255,0,145,48,48,0,66,18,50,48,145,18,18,0,82,48,40,0,82,50,25,0,41,50,50,4,101,48,50,18,82,48,0,0,82,49,26,0,25,49,49,1,91,50,48,49,76,50,50,0,145,50,50,0,59,48,255,0,145,48,48,0,66,19,50,48,145,19,19,0,82,48,40,0,82,50,25,0,41,50,50,4,3,48,48,50,113,48,4,19,82,50,0,0,82,49,26,0,25,49,49,2,91,48,50,49,76,48,48,0,145,48,48,0,59,50,255,0,145,50,50,0,66,20,48,50,145,20,20,0,82,50,40,0,82,48,25,0,41,48,48,4,3,50,50,48,113,50,8,20,82,50,40,0,82,48,25,0,41,48,48,4,3,50,50,48,59,48,1,0,145,48,48,0,113,50,12,48,82,48,26,0,25,48,48,3,85,26,48,0,119,0,66,1,82,48,0,0,82,50,25,0,41,50,50,1,92,48,48,50,84,37,48,0,81,50,37,0,19,50,50,42,42,50,50,11,76,50,50,0,145,48,50,0,62,50,0,0,184,121,99,0,33,132,160,63,145,50,50,0,65,31,48,50,145,31,31,0,82,50,40,0,82,48,25,0,41,48,48,4,101,50,48,31,81,50,37,0,19,50,50,44,42,50,50,6,76,50,50,0,145,48,50,0,62,50,0,0,184,121,99,0,33,132,160,63,145,50,50,0,65,32,48,50,145,32,32,0,82,50,40,0,82,48,25,0,41,48,48,4,3,50,50,48,113,50,4,32,81,48,37,0,38,48,48,62,42,48,48,1,76,48,48,0,145,50,48,0,62,48,0,0,184,121,99,0,33,132,160,63,145,48,48,0,65,33,50,48,145,33,33,0,82,48,40,0,82,50,25,0,41,50,50,4,3,48,48,50,113,48,8,33,81,50,37,0,38,50,50,1,32,50,50,0,121,50,5,0,59,50,0,0,145,50,50,0,58,48,50,0,119,0,4,0,59,50,1,0,145,50,50,0,58,48,50,0,58,10,48,0,82,48,40,0,82,50,25,0,41,50,50,4,3,48,48,50,113,48,12,10,119,0,252,0,82,50,0,0,82,48,25,0,41,48,48,1,92,50,50,48,84,38,50,0,81,48,38,0,2,49,0,0,0,240,0,0,19,48,48,49,42,48,48,12,76,48,48,0,145,50,48,0,62,48,0,0,125,14,208,31,17,17,177,63,145,48,48,0,65,27,50,48,145,27,27,0,82,48,40,0,82,50,25,0,41,50,50,4,101,48,50,27,81,48,38,0,19,48,48,46,42,48,48,8,76,48,48,0,145,50,48,0,62,48,0,0,125,14,208,31,17,17,177,63,145,48,48,0,65,28,50,48,145,28,28,0,82,48,40,0,82,50,25,0,41,50,50,4,3,48,48,50,113,48,4,28,81,50,38,0,19,50,50,43,42,50,50,4,76,50,50,0,145,48,50,0,62,50,0,0,125,14,208,31,17,17,177,63,145,50,50,0,65,29,48,50,145,29,29,0,82,50,40,0,82,48,25,0,41,48,48,4,3,50,50,48,113,50,8,29,81,48,38,0,38,48,48,15,76,48,48,0,145,50,48,0,62,48,0,0,125,14,208,31,17,17,177,63,145,48,48,0,65,30,50,48,145,30,30,0,82,48,40,0,82,50,25,0,41,50,50,4,3,48,48,50,113,48,12,30,119,0,182,0,82,50,0,0,82,49,26,0,91,48,50,49,76,48,48,0,145,48,48,0,59,50,255,0,145,50,50,0,66,13,48,50,145,13,13,0,82,50,40,0,82,48,25,0,41,48,48,4,101,50,48,13,82,50,0,0,82,49,26,0,25,49,49,1,91,48,50,49,76,48,48,0,145,48,48,0,59,50,255,0,145,50,50,0,66,14,48,50,145,14,14,0,82,50,40,0,82,48,25,0,41,48,48,4,3,50,50,48,113,50,4,14,82,48,0,0,82,49,26,0,25,49,49,2,91,50,48,49,76,50,50,0,145,50,50,0,59,48,255,0,145,48,48,0,66,15,50,48,145,15,15,0,82,48,40,0,82,50,25,0,41,50,50,4,3,48,48,50,113,48,8,15,82,50,0,0,82,49,26,0,25,49,49,3,91,48,50,49,76,48,48,0,145,48,48,0,59,50,255,0,145,50,50,0,66,16,48,50,145,16,16,0,82,50,40,0,82,48,25,0,41,48,48,4,3,50,50,48,113,50,12,16,82,50,26,0,25,50,50,4,85,26,50,0,119,0,120,0,82,48,0,0,82,50,26,0,41,50,50,2,100,1,48,50,145,1,1,0,82,48,40,0,82,50,25,0,41,50,50,4,101,48,50,1,82,50,40,0,82,48,25,0,41,48,48,4,3,50,50,48,59,48,0,0,145,48,48,0,113,50,4,48,82,48,40,0,82,50,25,0,41,50,50,4,3,48,48,50,59,50,0,0,145,50,50,0,113,48,8,50,82,50,40,0,82,48,25,0,41,48,48,4,3,50,50,48,59,48,1,0,145,48,48,0,113,50,12,48,119,0,89,0,82,48,0,0,82,50,26,0,41,50,50,2,100,2,48,50,145,2,2,0,82,48,40,0,82,50,25,0,41,50,50,4,101,48,50,2,82,50,0,0,82,48,26,0,25,48,48,1,41,48,48,2,100,3,50,48,145,3,3,0,82,50,40,0,82,48,25,0,41,48,48,4], eb + 40960);
  HEAPU8.set([3,50,50,48,113,50,4,3,82,50,0,0,82,48,26,0,25,48,48,2,41,48,48,2,100,4,50,48,145,4,4,0,82,50,40,0,82,48,25,0,41,48,48,4,3,50,50,48,113,50,8,4,82,50,40,0,82,48,25,0,41,48,48,4,3,50,50,48,59,48,1,0,145,48,48,0,113,50,12,48,82,48,26,0,25,48,48,3,85,26,48,0,119,0,47,0,82,48,0,0,82,50,26,0,41,50,50,2,100,5,48,50,145,5,5,0,82,48,40,0,82,50,25,0,41,50,50,4,101,48,50,5,82,50,0,0,82,48,26,0,25,48,48,1,41,48,48,2,100,6,50,48,145,6,6,0,82,50,40,0,82,48,25,0,41,48,48,4,3,50,50,48,113,50,4,6,82,50,0,0,82,48,26,0,25,48,48,2,41,48,48,2,100,7,50,48,145,7,7,0,82,50,40,0,82,48,25,0,41,48,48,4,3,50,50,48,113,50,8,7,82,50,0,0,82,48,26,0,25,48,48,3,41,48,48,2,100,8,50,48,145,8,8,0,82,50,40,0,82,48,25,0,41,48,48,4,3,50,50,48,113,50,12,8,82,50,26,0,25,50,50,4,85,26,50,0,119,0,1,0,82,47,25,0,25,47,47,1,85,25,47,0,119,0,201,253,82,9,40,0,137,41,0,0,139,9,0,0,140,6,102,0,0,0,0,0,2,87,0,0,133,29,0,0,2,88,0,0,134,29,0,0,2,89,0,0,138,29,0,0,2,90,0,0,139,29,0,0,2,91,0,0,135,29,0,0,2,92,0,0,136,29,0,0,136,93,0,0,0,86,93,0,136,93,0,0,25,93,93,64,137,93,0,0,130,93,0,0,136,94,0,0,49,93,93,94,156,201,0,0,1,94,64,0,135,93,0,0,94,0,0,0,25,79,86,52,25,81,86,48,25,76,86,44,25,80,86,40,25,84,86,36,25,83,86,32,25,82,86,28,25,64,86,24,25,85,86,4,0,77,86,0,89,79,1,0,85,81,2,0,85,76,3,0,85,80,4,0,88,93,79,0,145,93,93,0,59,94,0,0,145,94,94,0,72,93,93,94,121,93,6,0,62,93,0,0,148,28,229,157,153,153,185,63,145,93,93,0,89,79,93,0,82,93,76,0,82,94,81,0,47,93,93,94,28,202,0,0,116,84,81,0,116,81,76,0,116,76,84,0,82,93,80,0,34,93,93,4,121,93,59,0,59,98,1,0,145,98,98,0,61,100,0,0,0,0,0,63,145,100,100,0,88,101,79,0,145,101,101,0,66,99,100,101,145,99,99,0,64,97,98,99,145,97,97,0,59,99,2,0,135,96,10,0,97,99,0,0,145,96,96,0,59,99,2,0,145,99,99,0,65,95,96,99,145,95,95,0,59,99,1,0,145,99,99,0,64,94,95,99,145,94,94,0,134,93,0,0,12,187,1,0,94,0,0,0,145,93,93,0,89,83,93,0,82,93,76,0,82,94,81,0,4,65,93,94,76,94,65,0,145,65,94,0,62,96,0,0,80,53,221,95,251,33,25,64,145,96,96,0,88,97,83,0,145,97,97,0,66,95,96,97,145,95,95,0,135,99,11,0,95,0,0,0,145,99,99,0,65,93,65,99,145,93,93,0,59,99,104,1,145,99,99,0,66,94,93,99,145,94,94,0,75,66,94,0,85,80,66,0,82,99,80,0,36,99,99,0,1,93,4,0,125,94,99,93,66,0,0,0,85,80,94,0,82,94,76,0,82,93,81,0,4,67,94,93,76,93,67,0,145,67,93,0,82,94,80,0,76,94,94,0,145,94,94,0,66,93,67,94,145,93,93,0,89,82,93,0,82,93,81,0,76,93,93,0,145,93,93,0,89,64,93,0,82,94,80,0,41,94,94,2,28,94,94,2,134,93,0,0,108,140,2,0,94,0,0,0,121,93,3,0,134,93,0,0,208,155,2,0,134,93,0,0,88,235,1,0,85,0,0,0,82,94,85,0,134,93,0,0,108,205,1,0,94,0,0,0,1,94,7,0,134,93,0,0,204,196,1,0,94,0,0,0,1,93,0,0,85,77,93,0,82,93,80,0,28,93,93,2,82,94,77,0,56,93,93,94,24,208,0,0,78,94,5,0,102,99,5,1,102,95,5,2,102,97,5,3,134,93,0,0,248,33,2,0,94,99,95,97,1,93,20,118,88,18,93,0,145,18,18,0,1,97,40,118,82,93,97,0,76,93,93,0,145,93,93,0,66,70,18,93,145,70,70,0,1,93,24,118,88,19,93,0,145,19,19,0,1,99,44,118,82,95,99,0,76,95,95,0,145,95,95,0,66,97,19,95,145,97,97,0,134,93,0,0,156,99,2,0,70,97,0,0,88,20,0,0,145,20,20,0,112,97,0,4,145,97,97,0,134,93,0,0,52,143,2,0,20,97,0,0,1,93,20,118,88,21,93,0,145,21,21,0,1,97,40,118,82,93,97,0,76,93,93,0,145,93,93,0,66,71,21,93,145,71,71,0,1,93,24,118,88,22,93,0,145,22,22,0,1,97,32,118,88,93,97,0,145,93,93,0,63,51,22,93,145,51,51,0,1,99,44,118,82,95,99,0,76,95,95,0,145,95,95,0,66,97,51,95,145,97,97,0,134,93,0,0,156,99,2,0,71,97,0,0,88,23,0,0,145,23,23,0,88,97,64,0,145,97,97,0,62,95,0,0,20,25,67,160,70,223,145,63,145,95,95,0,65,93,97,95,145,93,93,0,135,24,12,0,93,0,0,0,145,24,24,0,88,95,79,0,145,95,95,0,65,93,24,95,145,93,93,0,63,57,23,93,145,57,57,0,112,25,0,4,145,25,25,0,88,95,64,0,145,95,95,0,62,97,0,0,20,25,67,160,70,223,145,63,145,97,97,0,65,93,95,97,145,93,93,0,135,26,13,0,93,0,0,0,145,26,26,0,88,99,79,0,145,99,99,0,65,95,26,99,145,95,95,0,63,97,25,95,145,97,97,0,134,93,0,0,52,143,2,0,57,97,0,0,1,93,20,118,88,27,93,0,145,27,27,0,1,97,28,118,88,93,97,0,145,93,93,0,63,58,27,93,145,58,58,0,1,97,40,118,82,93,97,0,76,93,93,0,145,93,93,0,66,72,58,93,145,72,72,0,1,93,24,118,88,28,93,0,145,28,28,0,1,97,32,118,88,93,97,0,145,93,93,0,63,59,28,93,145,59,59,0,1,99,44,118,82,95,99,0,76,95,95,0,145,95,95,0,66,97,59,95,145,97,97,0,134,93,0,0,156,99,2,0,72,97,0,0,88,29,0,0,145,29,29,0,88,30,64,0,145,30,30,0,88,95,82,0,145,95,95,0,63,97,30,95,145,97,97,0,62,95,0,0,20,25,67,160,70,223,145,63,145,95,95,0,65,93,97,95,145,93,93,0,135,31,12,0,93,0,0,0,145,31,31,0,88,95,79,0,145,95,95,0,65,93,31,95,145,93,93,0,63,60,29,93,145,60,60,0,112,32,0,4,145,32,32,0,88,33,64,0,145,33,33,0,88,97,82,0,145,97,97,0,63,95,33,97,145,95,95,0,62,97,0,0,20,25,67,160,70,223,145,63,145,97,97,0,65,93,95,97,145,93,93,0,135,34,13,0,93,0,0,0,145,34,34,0,88,99,79,0,145,99,99,0,65,95,34,99,145,95,95,0,63,97,32,95,145,97,97,0,134,93,0,0,52,143,2,0,60,97,0,0,1,93,20,118,88,35,93,0,145,35,35,0,1,97,28,118,88,93,97,0,145,93,93,0,63,61,35,93,145,61,61,0,1,97,40,118,82,93,97,0,76,93,93,0,145,93,93,0,66,73,61,93,145,73,73,0,1,93,24,118,88,36,93,0,145,36,36,0,1,99,44,118,82,95,99,0,76,95,95,0,145,95,95,0,66,97,36,95,145,97,97,0,134,93,0,0,156,99,2,0,73,97,0,0,88,37,0,0,145,37,37,0,88,38,64,0,145,38,38,0,88,99,82,0,145,99,99,0,59,94,2,0,145,94,94,0,65,95,99,94,145,95,95,0,63,97,38,95,145,97,97,0,62,95,0,0,20,25,67,160,70,223,145,63,145,95,95,0,65,93,97,95,145,93,93,0,135,39,12,0,93,0,0,0,145,39,39,0,88,95,79,0,145,95,95,0,65,93,39,95,145,93,93,0,63,62,37,93,145,62,62,0,112,40,0,4,145,40,40,0,88,41,64,0,145,41,41,0,88,94,82,0,145,94,94,0,59,99,2,0,145,99,99,0,65,97,94,99,145,97,97,0,63,95,41,97,145,95,95,0,62,97,0,0,20,25,67,160,70,223,145,63,145,97,97,0,65,93,95,97,145,93,93,0,135,42,13,0,93,0,0,0,145,42,42,0,88,99,79,0,145,99,99,0,65,95,42,99,145,95,95,0,63,97,40,95,145,97,97,0,134,93,0,0,52,143,2,0,62,97,0,0,88,93,82,0,145,93,93,0,59,97,2,0,145,97,97,0,65,78,93,97,145,78,78,0,88,93,64,0,145,93,93,0,63,97,93,78,145,97,97,0,89,64,97,0,82,97,77,0,25,97,97,1,85,77,97,0,119,0,228,254,82,97,80,0,30,97,97,2,120,97,7,0,134,97,0,0,248,142,1,0,134,97,0,0,88,157,2,0,137,86,0,0,139,0,0,0,78,93,5,0,102,95,5,1,102,99,5,2,102,94,5,3,134,97,0,0,248,33,2,0,93,95,99,94,1,97,20,118,88,43,97,0,145,43,43,0,1,94,40,118,82,97,94,0,76,97,97,0,145,97,97,0,66,74,43,97,145,74,74,0,1,97,24,118,88,44,97,0,145,44,44,0,1,95,44,118,82,99,95,0,76,99,99,0,145,99,99,0,66,94,44,99,145,94,94,0,134,97,0,0,156,99,2,0,74,94,0,0,88,45,0,0,145,45,45,0,112,94,0,4,145,94,94,0,134,97,0,0,52,143,2,0,45,94,0,0,1,97,20,118,88,46,97,0,145,46,46,0,1,94,40,118,82,97,94,0,76,97,97,0,145,97,97,0,66,75,46,97,145,75,75,0,1,97,24,118,88,47,97,0,145,47,47,0,1,94,32,118,88,97,94,0,145,97,97,0,63,63,47,97,145,63,63,0,1,95,44,118,82,99,95,0,76,99,99,0,145,99,99,0,66,94,63,99,145,94,94,0,134,97,0,0,156,99,2,0,75,94,0,0,88,48,0,0,145,48,48,0,88,94,64,0,145,94,94,0,62,99,0,0,20,25,67,160,70,223,145,63,145,99,99,0,65,97,94,99,145,97,97,0,135,49,12,0,97,0,0,0,145,49,49,0,88,99,79,0,145,99,99,0,65,97,49,99,145,97,97,0,63,52,48,97,145,52,52,0,112,50,0,4,145,50,50,0,88,99,64,0,145,99,99,0,62,94,0,0,20,25,67,160,70,223,145,63,145,94,94,0,65,97,99,94,145,97,97,0,135,6,13,0,97,0,0,0,145,6,6,0,88,95,79,0,145,95,95,0,65,99,6,95,145,99,99,0,63,94,50,99,145,94,94,0,134,97,0,0,52,143,2,0,52,94,0,0,1,97,20,118,88,7,97,0,145,7,7,0,1,94,28,118,88,97,94,0,145,97,97,0,63,53,7,97,145,53,53,0,1,94,40,118,82,97,94,0,76,97,97,0,145,97,97,0,66,68,53,97,145,68,68,0,1,97,24,118,88,8,97,0,145,8,8,0,1,94,32,118,88,97,94,0,145,97,97,0,63,54,8,97,145,54,54,0,1,95,44,118,82,99,95,0,76,99,99,0,145,99,99,0,66,94,54,99,145,94,94,0,134,97,0,0,156,99,2,0,68,94,0,0,88,9,0,0,145,9,9,0,88,10,64,0,145,10,10,0,88,99,82,0,145,99,99,0,63,94,10,99,145,94,94,0,62,99,0,0,20,25,67,160,70,223,145,63,145,99,99,0,65,97,94,99,145,97,97,0,135,11,12,0,97,0,0,0,145,11,11,0,88,99,79,0,145,99,99,0,65,97,11,99,145,97,97,0,63,55,9,97,145,55,55,0,112,12,0,4,145,12,12,0,88,13,64,0,145,13,13,0,88,94,82,0,145,94,94,0,63,99,13,94,145,99,99,0,62,94,0,0,20,25,67,160,70,223,145,63,145,94,94,0,65,97,99,94,145,97,97,0,135,14,13,0,97,0,0,0,145,14,14,0,88,95,79,0,145,95,95,0,65,99,14,95,145,99,99,0,63,94,12,99,145,94,94,0,134,97,0,0,52,143,2,0,55,94,0,0,1,97,20,118,88,15,97,0,145,15,15,0,1,94,28,118,88,97,94,0,145,97,97,0,63,56,15,97,145,56,56,0,1,94,40,118,82,97,94,0,76,97,97,0,145,97,97,0,66,69,56,97,145,69,69,0,1,97,24,118,88,16,97,0,145,16,16,0,1,95,44,118,82,99,95,0,76,99,99,0,145,99,99,0,66,94,16,99,145,94,94,0,134,97,0,0,156,99,2,0,69,94,0,0,88,17,0,0,145,17,17,0,112,94,0,4,145,94,94,0,134,97,0,0,52,143,2,0,17,94,0,0,134,97,0,0,248,142,1,0,134,97,0,0,88,157,2,0,137,86,0,0,139,0,0,0,140,6,48,0,0,0,0,0,136,39,0,0,0,38,39,0,136,39,0,0,25,39,39,112,137,39,0,0,130,39,0,0,136,40,0,0,49,39,39,40,232,211,0,0,1,40,112,0,135,39,0,0,40,0,0,0,25,31,38,96,25,30,38,92,25,33,38,88,25,34,38,84,25,35,38,80,25,26,38,76,25,29,38,72,25,22,38,68,0,18,38,0,25,32,38,104,25,28,38,64,25,27,38,60,25,20,38,56,25,37,38,52,25,25,38,48,25,24,38,44,25,36,38,40,25,21,38,36,25,14,38,32,25,15,38,28,25,19,38,24,25,23,38,20,85,30,0,0,85,33,1,0,85,34,2,0,85,35,3,0,85,26,4,0,85,29,5,0,1,39,255,255,85,22,39,0,1,39,64,16,82,39,39,0,85,18,39,0,1,40,68,16,82,40,40,0,109,18,4,40,1,39,72,16,82,39,39,0,109,18,8,39,1,40,76,16,82,40,40,0,109,18,12,40,1,39,80,16,82,39,39,0,109,18,16,39,1,39,1,48,78,39,39,0,83,32,39,0,1,40,2,48,78,40,40,0,107,32,1,40,1,39,3,48,78,39,39,0,107,32,2,39,1,40,4,48,78,40,40,0,107,32,3,40,1,39,5,48,78,39,39,0,107,32,4,39,1,40,6,48,78,40,40,0,107,32,5,40,1,39,7,48,78,39,39,0,107,32,6,39,1,40,8,48,78,40,40,0,107,32,7,40,82,40,33,0,120,40,5,0,82,39,34,0,82,41,26,0,5,40,39,41,85,33,40,0,1,40,5,0,82,41,22,0,49,40,40,41,44,213,0,0,1,40,255,255,85,22,40,0,82,41,34,0,82,39,26,0,5,40,41,39,25,12,40,1,82,41,35,0,5,39,12,41,135,40,6,0,39,0,0,0,85,20,40,0,82,40,20,0,120,40,6,0,1,40,0,0,85,31,40,0,82,11,31,0,137,38,0,0,139,11,0,0,82,41,34,0,82,42,26,0,5,39,41,42,135,40,6,0,39,0,0,0,85,25,40,0,82,40,25,0,120,40,9,0,82,39,20,0,135,40,8,0,39,0,0,0,1,40,0,0,85,31,40,0,82,11,31,0,137,38,0,0,139,11,0,0,1,40,0,0,85,24,40,0,82,40,35,0,82,39,24,0,56,40,40,39,156,215,0,0,1,40,255,255,82,39,22,0,47,40,40,39,12,214,0,0,116,21,22,0,82,39,30,0,82,42,33,0,82,41,34,0,82,43,35,0,82,44,24,0,82,45,26,0,82,46,22,0,82,47,25,0,134,40,0,0,136,6,1,0,39,42,41,43,44,45,46,47,119,0,73,0,1,40,0,0,85,14,40,0,2,40,0,0,255,255,255,127,85,15,40,0,1,40,0,0,85,21,40,0,1,40,5,0,82,47,21,0,56,40,40,47,232,214,0,0,82,47,30,0,82,46,33,0,82,45,34,0,82,44,35,0,82,43,24,0,82,41,26,0,82,42,21,0,82,39,25,0,134,40,0,0,136,6,1,0,47,46,45,44,43,41,42,39,1,40,0,0,85,19,40,0,1,40,0,0,85,23,40,0,82,39,34,0,82,42,26,0,5,40,39,42,82,42,23,0,56,40,40,42,192,214,0,0,82,40,25,0,82,42,23,0,90,40,40,42,135,16,14,0,40,0,0,0,82,40,19,0,3,40,40,16,85,19,40,0,82,40,23,0,25,40,40,1,85,23,40,0,119,0,239,255,82,40,19,0,82,42,15,0,47,40,40,42,216,214,0,0,116,15,19,0,116,14,21,0,82,40,21,0,25,40,40,1,85,21,40,0,119,0,209,255,82,40,21,0,82,42,14,0,46,40,40,42,44,215,0,0,82,42,30,0,82,39,33,0,82,41,34,0,82,43,35,0,82,44,24,0,82,45,26,0,82,46,14,0,82,47,25,0,134,40,0,0,136,6,1,0,42,39,41,43,44,45,46,47,116,21,14,0,82,40,20,0,82,46,24,0,82,44,34,0,82,43,26,0,5,45,44,43,25,45,45,1,5,47,46,45,82,45,21,0,95,40,47,45,82,45,20,0,82,40,24,0,82,43,34,0,82,44,26,0,5,46,43,44,25,46,46,1,5,47,40,46,3,45,45,47,25,13,45,1,82,47,25,0,82,40,34,0,82,44,26,0,5,46,40,44,135,45,7,0,13,47,46,0,82,45,24,0,25,45,45,1,85,24,45,0,119,0,135,255,82,46,25,0,135,45,8,0,46,0,0,0,82,46,20,0,82,44,35,0,82,43,34,0,82,41,26,0,5,40,43,41,25,40,40,1,5,47,44,40,1,40,8,0,134,45,0,0,220,56,0,0,46,47,36,40,85,37,45,0,82,40,20,0,135,45,8,0,40,0,0,0,82,45,37,0,120,45,6,0,1,45,0,0,85,31,45,0,82,11,31,0,137,38,0,0,139,11,0,0,82,40,36,0,25,40,40,45,25,40,40,12,135,45,6,0,40,0,0,0,85,28,45,0,82,45,28,0,120,45,6,0,1,45,0,0,85,31,45,0,82,11,31,0,137,38,0,0,139,11,0,0,82,45,29,0,82,40,36,0,25,40,40,45,25,40,40,12,85,45,40,0,116,27,28,0,82,45,27,0,1,47,8,0,135,40,7,0,45,32,47,0,82,40,27,0,25,40,40,8,85,27,40,0,82,40,27,0,1,47,0,0,83,40,47,0,82,47,27,0,1,40,0,0,107,47,1,40,82,40,27,0,1,47,0,0,107,40,2,47,82,47,27,0,1,40,13,0,107,47,3,40,82,40,27,0,25,40,40,4,85,27,40,0,82,40,27,0,1,47,9,48,78,47,47,0,83,40,47,0,82,47,27,0,1,40,10,48,78,40,40,0,107,47,1,40,82,40,27,0,1,47,11,48,78,47,47,0,107,40,2,47,82,47,27,0,1,40,12,48,78,40,40,0,107,47,3,40,82,40,27,0,25,40,40,4,85,27,40,0,82,40,27,0,82,47,34,0,42,47,47,24,83,40,47,0,82,47,27,0,82,40,34,0,42,40,40,16,107,47,1,40,82,40,27,0,82,47,34,0,42,47,47,8,107,40,2,47,82,47,27,0,82,40,34,0,107,47,3,40,82,40,27,0,25,40,40,4,85,27,40,0,82,40,27,0,82,47,35,0,42,47,47,24,83,40,47,0,82,47,27,0,82,40,35,0,42,40,40,16,107,47,1,40,82,40,27,0,82,47,35,0,42,47,47,8,107,40,2,47,82,47,27,0,82,40,35,0,107,47,3,40,82,40,27,0,25,40,40,4,85,27,40,0,82,6,27,0,25,40,6,1,85,27,40,0,1,40,8,0,83,6,40,0,82,40,26,0,41,40,40,2,94,40,18,40,1,47,255,0,19,40,40,47,0,17,40,0,82,7,27,0,25,40,7,1,85,27,40,0,83,7,17,0,82,8,27,0,25,40,8,1,85,27,40,0,1,40,0,0,83,8,40,0,82,9,27,0,25,40,9,1,85,27,40,0,1,40,0,0,83,9,40,0,82,10,27,0,25,40,10,1,85,27,40,0,1,40,0,0,83,10,40,0,1,47,13,0,134,40,0,0,64,61,2,0,27,47,0,0,82,40,27,0,82,47,36,0,42,47,47,24,83,40,47,0,82,47,27,0,82,40,36,0,42,40,40,16,107,47,1,40,82,40,27,0,82,47,36,0,42,47,47,8,107,40,2,47,82,47,27,0,82,40,36,0,107,47,3,40,82,40,27,0,25,40,40,4,85,27,40,0,82,40,27,0,1,47,14,48,78,47,47,0,83,40,47,0,82,47,27,0,1,40,15,48,78,40,40,0,107,47,1,40,82,40,27,0,1,47,16,48,78,47,47,0,107,40,2,47,82,47,27,0,1,40,17,48,78,40,40,0,107,47,3,40,82,40,27,0,25,40,40,4,85,27,40,0,82,47,27,0,82,45,37,0,82,46,36,0,135,40,7,0,47,45,46,0,82,40,27,0,82,46,36,0,3,40,40,46,85,27,40,0,82,46,37,0,135,40,8,0,46,0,0,0,82,46,36,0,134,40,0,0,64,61,2,0,27,46,0,0,82,40,27,0,1,46,0,0,83,40,46,0,82,46,27,0,1,40,0,0,107,46,1,40,82,40,27,0,1,46,0,0,107,40,2,46,82,46,27,0,1,40,0,0,107,46,3,40,82,40,27,0,25,40,40,4,85,27,40,0,82,40,27,0,1,46,19,48,78,46,46,0,83,40,46,0,82,46,27,0,1,40,20,48,78,40,40,0,107,46,1,40,82,40,27,0,1,46,21,48,78,46,46,0,107,40,2,46,82,46,27,0,1,40,22,48,78,40,40,0,107,46,3,40,82,40,27,0,25,40,40,4,85,27,40,0,1,46,0,0,134,40,0,0,64,61,2,0,27,46,0,0,82,40,27,0,82,46,28,0,82,45,29,0,82,45,45,0,3,46,46,45,46,40,40,46,168,219,0,0,1,46,24,48,1,45,142,47,1,47,131,4,1,44,44,48,135,40,4,0,46,45,47,44,116,31,28,0,82,11,31,0,137,38,0,0,139,11,0,0,140,1,40,0,0,0,0,0,2,31,0,0,255,0,0,0,2,32,0,0,0,248,0,0,2,33,0,0,240,0,0,0,2,34,0,0,192,7,0,0,1,29,0,0,136,35,0,0,0,30,35,0,136,35,0,0,25,35,35,48,137,35,0,0,130,35,0,0,136,36,0,0,49,35,35,36,20,220,0,0,1,36,48,0,135,35,0,0,36,0,0,0,25,28,30,8,0,27,30,0,25,26,30,24,25,25,30,20,25,20,30,16,25,21,30,12,25,22,30,32,25,24,30,30,25,23,30,28,106,35,0,4,121,35,70,2,106,35,0,8,121,35,68,2,106,37,0,4,106,38,0,8,5,36,37,38,41,36,36,2,135,35,6,0,36,0,0,0,85,25,35,0,1,35,11,0,106,36,0,16,49,35,35,36,140,220,0,0,1,36,4,0,1,38,143,58,134,35,0,0,216,31,2,0,36,38,27,0,119,0,47,2,106,35,0,16,32,35,35,8,121,35,3,0,1,29,9,0,119,0,10,0,106,35,0,16,32,35,35,9,121,35,3,0,1,29,9,0,119,0,5,0,106,35,0,16,32,35,35,10,121,35,2,0,1,29,9,0,32,35,29,9,121,35,6,0,1,38,4,0,1,36,207,58,134,35,0,0,216,31,2,0,38,36,28,0,1,35,0,0,85,20,35,0,1,35,0,0,85,21,35,0,106,36,0,4,106,38,0,8,5,35,36,38,82,38,20,0,56,35,35,38,68,229,0,0,106,35,0,16,1,38,1,0,1,36,10,0,138,35,38,36,68,221,0,0,188,221,0,0,76,222,0,0,68,223,0,0,208,223,0,0,208,224,0,0,252,225,0,0,148,226,0,0,32,227,0,0,24,228,0,0,119,0,253,1,82,38,25,0,82,36,20,0,41,36,36,2,82,37,0,0,82,39,20,0,90,37,37,39,95,38,36,37,82,37,25,0,82,36,20,0,41,36,36,2,3,37,37,36,82,36,0,0,82,38,20,0,90,36,36,38,107,37,1,36,82,36,25,0,82,37,20,0,41,37,37,2,3,36,36,37,82,37,0,0,82,38,20,0,90,37,37,38,107,36,2,37,82,37,25,0,82,36,20,0,41,36,36,2,3,37,37,36,1,36,255,255,107,37,3,36,119,0,223,1,82,36,25,0,82,37,20,0,41,37,37,2,82,38,0,0,82,39,21,0,90,38,38,39,95,36,37,38,82,38,25,0,82,37,20,0,41,37,37,2,3,38,38,37,82,37,0,0,82,36,21,0,90,37,37,36,107,38,1,37,82,37,25,0,82,38,20,0,41,38,38,2,3,37,37,38,82,38,0,0,82,36,21,0,90,38,38,36,107,37,2,38,82,38,25,0,82,37,20,0,41,37,37,2,3,38,38,37,82,37,0,0,82,36,21,0,25,36,36,1,90,37,37,36,107,38,3,37,82,37,21,0,25,37,37,2,85,21,37,0,119,0,187,1,82,37,0,0,82,36,20,0,41,36,36,1,92,37,37,36,84,24,37,0,81,38,24,0,19,38,38,32,42,38,38,11,76,38,38,0,145,36,38,0,59,38,8,0,145,38,38,0,65,37,36,38,145,37,37,0,75,37,37,0,19,37,37,31,0,18,37,0,82,37,25,0,82,38,20,0,41,38,38,2,95,37,38,18,81,36,24,0,1,39,224,7,19,36,36,39,42,36,36,5,76,36,36,0,145,37,36,0,59,36,4,0,145,36,36,0,65,38,37,36,145,38,38,0,75,38,38,0,19,38,38,31,0,19,38,0,82,38,25,0,82,36,20,0,41,36,36,2,3,38,38,36,107,38,1,19,81,37,24,0,38,37,37,31,76,37,37,0,145,36,37,0,59,37,8,0,145,37,37,0,65,38,36,37,145,38,38,0,75,38,38,0,19,38,38,31,0,2,38,0,82,38,25,0,82,37,20,0,41,37,37,2,3,38,38,37,107,38,2,2,82,38,25,0,82,37,20,0,41,37,37,2,3,38,38,37,1,37,255,255,107,38,3,37,119,0,125,1,82,38,25,0,82,37,20,0,41,37,37,2,82,36,0,0,82,39,21,0,90,36,36,39,95,38,37,36,82,36,25,0,82,37,20,0,41,37,37,2,3,36,36,37,82,37,0,0,82,38,21,0,25,38,38,1,90,37,37,38,107,36,1,37,82,37,25,0,82,36,20,0,41,36,36,2,3,37,37,36,82,36,0,0,82,38,21,0,25,38,38,2,90,36,36,38,107,37,2,36,82,36,25,0,82,37,20,0,41,37,37,2,3,36,36,37,1,37,255,255,107,36,3,37,82,37,21,0,25,37,37,3,85,21,37,0,119,0,90,1,82,37,0,0,82,38,20,0,41,38,38,1,92,37,37,38,84,22,37,0,81,36,22,0,19,36,36,32,42,36,36,11,76,36,36,0,145,38,36,0,59,36,8,0,145,36,36,0,65,37,38,36,145,37,37,0,75,37,37,0,19,37,37,31,0,15,37,0,82,37,25,0,82,36,20,0,41,36,36,2,95,37,36,15,81,38,22,0,19,38,38,34,42,38,38,6,76,38,38,0,145,37,38,0,59,38,8,0,145,38,38,0,65,36,37,38,145,36,36,0,75,36,36,0,19,36,36,31,0,16,36,0,82,36,25,0,82,38,20,0,41,38,38,2,3,36,36,38,107,36,1,16,81,37,22,0,38,37,37,62,42,37,37,1,76,37,37,0,145,38,37,0,59,37,8,0,145,37,37,0,65,36,38,37,145,36,36,0,75,36,36,0,19,36,36,31,0,17,36,0,82,36,25,0,82,37,20,0,41,37,37,2,3,36,36,37,107,36,2,17,82,36,25,0,82,37,20,0,41,37,37,2,3,36,36,37,81,37,22,0,38,37,37,1,5,37,37,31,107,36,3,37,119,0,26,1,82,37,0,0,82,38,20,0,41,38,38,1,92,37,37,38,84,23,37,0,81,36,23,0,2,39,0,0,0,240,0,0,19,36,36,39,42,36,36,12,76,36,36,0,145,38,36,0,59,36,17,0,145,36,36,0,65,37,38,36,145,37,37,0,75,37,37,0,19,37,37,31,0,3,37,0,82,37,25,0,82,36,20,0,41,36,36,2,95,37,36,3,81,38,23,0,1,39,0,15,19,38,38,39,42,38,38,8,76,38,38,0,145,37,38,0,59,38,17,0,145,38,38,0,65,36,37,38,145,36,36,0,75,36,36,0,19,36,36,31,0,4,36,0,82,36,25,0,82,38,20,0,41,38,38,2,3,36,36,38,107,36,1,4,81,37,23,0,19,37,37,33,42,37,37,4,76,37,37,0,145,38,37,0,59,37,17,0,145,37,37,0,65,36,38,37,145,36,36,0,75,36,36,0,19,36,36,31,0,5,36,0,82,36,25,0,82,37,20,0,41,37,37,2,3,36,36,37,107,36,2,5,81,38,23,0,38,38,38,15,76,38,38,0,145,37,38,0,59,38,17,0,145,38,38,0,65,36,37,38,145,36,36,0,75,36,36,0,19,36,36,31,0,6,36,0,82,36,25,0,82,38,20,0,41,38,38,2,3,36,36,38,107,36,3,6,119,0,207,0,82,36,25,0,82,38,20,0,41,38,38,2,82,37,0,0,82,39,21,0,90,37,37,39,95,36,38,37,82,37,25,0,82,38,20,0,41,38,38,2,3,37,37,38,82,38,0,0,82,36,21,0,25,36,36,1,90,38,38,36,107,37,1,38,82,38,25,0,82,37,20,0,41,37,37,2,3,38,38,37,82,37,0,0,82,36,21,0,25,36,36,2,90,37,37,36,107,38,2,37,82,37,25,0,82,38,20,0,41,38,38,2,3,37,37,38,82,38,0,0,82,36,21,0,25,36,36,3,90,38,38,36,107,37,3,38,82,38,21,0,25,38,38,4,85,21,38,0,119,0,169,0,82,38,0,0,82,39,21,0,41,39,39,2,100,36,38,39,145,36,36,0,59,38,255,0,145,38,38,0,65,37,36,38,145,37,37,0,75,37,37,0,19,37,37,31,0,7,37,0,82,37,25,0,82,38,20,0,41,38,38,2,95,37,38,7,82,38,25,0,82,37,20,0,41,37,37,2,3,38,38,37,1,37,0,0,107,38,1,37,82,37,25,0,82,38,20,0,41,38,38,2,3,37,37,38,1,38,0,0,107,37,2,38,82,38,25,0,82,37,20,0,41,37,37,2,3,38,38,37,1,37,255,255,107,38,3,37,119,0,134,0,82,36,0,0,82,39,21,0,41,39,39,2,100,38,36,39,145,38,38,0,59,36,255,0,145,36,36,0,65,37,38,36,145,37,37,0,75,37,37,0,19,37,37,31,0,8,37,0,82,37,25,0,82,36,20,0,41,36,36,2,95,37,36,8,82,38,0,0,82,39,21,0,25,39,39,1,41,39,39,2,100,37,38,39,145,37,37,0,59,38,255,0,145,38,38,0,65,36,37,38,145,36,36,0,75,36,36,0,19,36,36,31,0,9,36,0,82,36,25,0,82,38,20,0,41,38,38,2,3,36,36,38,107,36,1,9,82,37,0,0,82,39,21,0,25,39,39,2,41,39,39,2,100,38,37,39,145,38,38,0,59,37,255,0,145,37,37,0,65,36,38,37,145,36,36,0,75,36,36,0,19,36,36,31,0,10,36,0,82,36,25,0,82,37,20,0,41,37,37,2,3,36,36,37,107,36,2,10,82,36,25,0,82,37,20,0,41,37,37,2,3,36,36,37,1,37,255,255,107,36,3,37,82,37,21,0,25,37,37,3,85,21,37,0,119,0,72,0,82,38,0,0,82,39,21,0,41,39,39,2,100,36,38,39,145,36,36,0,59,38,255,0,145,38,38,0,65,37,36,38,145,37,37,0,75,37,37,0,19,37,37,31,0,11,37,0,82,37,25,0,82,38,20,0,41,38,38,2,95,37,38,11,82,36,0,0,82,39,21,0,41,39,39,2,100,37,36,39,145,37,37,0,59,36,255,0,145,36,36,0,65,38,37,36,145,38,38,0,75,38,38,0,19,38,38,31,0,12,38,0,82,38,25,0,82,36,20,0,41,36,36,2,3,38,38,36,107,38,1,12,82,37,0,0,82,39,21,0,41,39,39,2,100,36,37,39,145,36,36,0,59,37,255,0,145,37,37,0,65,38,36,37,145,38,38,0,75,38,38,0,19,38,38,31,0,13,38,0,82,38,25,0,82,37,20,0,41,37,37,2,3,38,38,37,107,38,2,13,82,36,0,0,82,39,21,0,41,39,39,2,100,37,36,39,145,37,37,0,59,36,255,0,145,36,36,0,65,38,37,36,145,38,38,0,75,38,38,0,19,38,38,31,0,14,38,0,82,38,25,0,82,36,20,0,41,36,36,2,3,38,38,36,107,38,3,14,82,38,21,0,25,38,38,4,85,21,38,0,119,0,1,0,82,35,20,0,25,35,35,1,85,20,35,0,119,0,236,253,116,26,25,0,82,1,26,0,137,30,0,0,139,1,0,0,1,35,0,0,85,26,35,0,82,1,26,0,137,30,0,0,139,1,0,0,140,2,56,0,0,0,0,0,2,46,0,0,245,28,0,0,2,47,0,0,251,28,0,0,2,48,0,0,73,29,0,0,2,49,0,0,74,29,0,0,1,42,0,0,136,50,0,0,0,43,50,0,136,50,0,0,1,51,224,1,3,50,50,51,137,50,0,0,130,50,0,0,136,51,0,0,49,50,50,51,200,229,0,0,1,51,224,1,135,50,0,0,51,0,0,0,1,50,152,0,3,37,43,50,1,50,144,0,3,36,43,50,1,50,136,0,3,35,43,50,1,50,128,0,3,34,43,50,25,33,43,120,25,32,43,112,25,31,43,104,25,30,43,96,25,29,43,88,25,28,43,80,25,27,43,72,25,26,43,64,25,24,43,56,25,23,43,48,25,22,43,40,25,21,43,32,25,39,43,24,25,38,43,16,25,25,43,8,0,20,43,0,1,50,208,1,3,40,43,50,1,50,204,1,3,7,43,50,1,50,200,1,3,13,43,50,1,50,196,1,3,4,43,50,1,50,192,1,3,5,43,50,1,50,188,1,3,12,43,50,1,50,184,1,3,6,43,50,1,50,180,1,3,8,43,50,1,50,176,1,3,9,43,50,1,50,212,1,3,14,43,50,1,50,168,1,3,15,43,50,1,50,104,1,3,16,43,50,1,50,100,1,3,10,43,50,1,50,96,1,3,11,43,50,1,50,32,1,3,17,43,50,1,50,224,0,3,18,43,50,1,50,160,0,3,19,43,50,85,40,0,0,85,7,1,0,1,51,0,31,135,50,15,0,51,0,0,0,85,20,50,0,1,51,3,0,1,52,5,31,134,50,0,0,216,31,2,0,51,52,20,0,1,52,1,31,135,50,15,0,52,0,0,0,85,25,50,0,1,52,3,0,1,51,23,31,134,50,0,0,216,31,2,0,52,51,25,0,1,51,2,31,135,50,15,0,51,0,0,0,85,38,50,0,1,51,3,0,1,52,41,31,134,50,0,0,216,31,2,0,51,52,38,0,2,52,0,0,140,139,0,0,135,50,15,0,52,0,0,0,85,39,50,0,1,52,3,0,1,51,59,31,134,50,0,0,216,31,2,0,52,51,39,0,1,50,0,0,85,13,50,0,1,51,0,8,135,50,6,0,51,0,0,0,85,4,50,0,1,51,3,31,135,50,15,0,51,0,0,0,85,5,50,0,82,51,5,0,135,50,16,0,51,0,0,0,25,50,50,1,85,12,50,0,82,51,12,0,1,52,1,0,134,50,0,0,128,137,2,0,51,52,0,0,85,6,50,0,82,52,6,0,82,51,5,0,135,50,17,0,52,51,0,0,82,50,4,0,82,51,13,0,41,51,51,2,82,52,6,0,97,50,51,52,1,52,0,0,85,8,52,0,82,52,12,0,82,51,8,0,56,52,52,51,60,232,0,0,82,52,6,0,82,51,8,0,90,52,52,51,32,52,52,32,121,52,16,0,82,52,6,0,82,51,8,0,1,50,0,0,95,52,51,50,82,50,13,0,25,50,50,1,85,13,50,0,82,50,4,0,82,51,13,0,41,51,51,2,82,52,6,0,82,53,8,0,25,53,53,1,3,52,52,53,97,50,51,52,82,52,8,0,25,52,52,1,85,8,52,0,119,0,229,255,116,21,13,0,1,51,3,0,1,50,77,31,134,52,0,0,216,31,2,0,51,50,21,0,1,52,0,0,85,9,52,0,82,2,4,0,82,52,13,0,82,50,9,0,56,52,52,50,176,235,0,0,82,50,9,0,41,50,50,2,94,50,2,50,1,51,112,31,134,52,0,0,196,128,2,0,50,51,0,0,120,52,31,0,1,52,40,117,1,50,24,73,135,51,18,0,50,0,0,0,85,52,51,0,1,51,236,115,1,50,235,72,135,52,18,0,50,0,0,0,85,51,52,0,1,52,36,117,1,50,0,73,135,51,18,0,50,0,0,0,85,52,51,0,1,51,40,117,82,51,51,0,33,51,51,0,1,52,236,115,82,52,52,0,33,52,52,0,19,51,51,52,1,52,36,117,82,52,52,0,33,52,52,0,19,51,51,52,121,51,4,0,1,51,161,120,1,52,1,0,83,51,52,0,82,51,4,0,82,50,9,0,41,50,50,2,94,51,51,50,1,50,139,31,134,52,0,0,196,128,2,0,51,50,0,0,120,52,4,0,1,52,163,120,1,50,1,0,83,52,50,0,82,52,4,0,82,51,9,0,41,51,51,2,94,52,52,51,1,51,159,31,134,50,0,0,196,128,2,0,52,51,0,0,120,50,4,0,1,50,164,120,1,51,1,0,83,50,51,0,82,50,4,0,82,52,9,0,41,52,52,2,94,50,50,52,1,52,231,31,134,51,0,0,196,128,2,0,50,52,0,0,120,51,3,0,1,42,18,0,119,0,22,0,82,52,4,0,82,50,9,0,41,50,50,2,94,52,52,50,1,50,7,32,134,51,0,0,196,128,2,0,52,50,0,0,120,51,3,0,1,42,18,0,119,0,11,0,82,50,4,0,82,52,9,0,41,52,52,2,94,50,50,52,1,52,40,32,134,51,0,0,196,128,2,0,50,52,0,0,120,51,2,0,1,42,18,0,32,51,42,18,121,51,5,0,1,42,0,0,1,51,165,120,1,52,1,0,83,51,52,0,82,51,4,0,82,50,9,0,41,50,50,2,94,51,51,50,1,50,80,32,134,52,0,0,196,128,2,0,51,50,0,0,120,52,3,0,1,42,21,0,119,0,11,0,82,50,4,0,82,51,9,0,41,51,51,2,94,50,50,51,1,51,116,32,134,52,0,0,196,128,2,0,50,51,0,0,120,52,2,0,1,42,21,0,32,52,42,21,121,52,5,0,1,42,0,0,1,52,166,120,1,51,1,0,83,52,51,0,82,52,4,0,82,50,9,0,41,50,50,2,94,52,52,50,1,50,149,32,134,51,0,0,196,128,2,0,52,50,0,0,120,51,4,0,1,51,167,120,1,50,1,0,83,51,50,0,82,51,4,0,82,52,9,0,41,52,52,2,94,51,51,52,1,52,174,32,134,50,0,0,196,128,2,0,51,52,0,0,120,50,4,0,1,50,168,120,1,52,1,0,83,50,52,0,82,50,4,0,82,51,9,0,41,51,51,2,94,50,50,51,1,51,207,32,134,52,0,0,196,128,2,0,50,51,0,0,120,52,4,0,1,52,169,120,1,51,1,0,83,52,51,0,82,52,4,0,82,50,9,0,41,50,50,2,94,52,52,50,1,50,243,32,134,51,0,0,196,128,2,0,52,50,0,0,120,51,9,0,1,51,170,120,1,50,1,0,83,51,50,0,2,51,0,0,255,132,0,0,1,52,32,117,135,50,19,0,51,52,0,0,82,52,4,0,82,51,9,0,41,51,51,2,94,52,52,51,1,51,21,33,134,50,0,0,196,128,2,0,52,51,0,0,120,50,4,0,1,50,162,120,1,51,1,0,83,50,51,0,82,50,4,0,82,52,9,0,41,52,52,2,94,50,50,52,1,52,49,33,134,51,0,0,196,128,2,0,50,52,0,0,120,51,4,0,1,51,171,120,1,52,1,0,83,51,52,0,82,52,9,0,25,52,52,1,85,9,52,0,119,0,44,255,135,52,8,0,2,0,0,0,82,51,6,0,135,52,8,0,51,0,0,0,1,52,161,120,78,52,52,0,38,52,52,1,121,52,7,0,1,51,3,0,1,50,69,33,134,52,0,0,216,31,2,0,51,50,22,0,119,0,6,0,1,50,4,0,1,51,144,33,134,52,0,0,216,31,2,0,50,51,23,0,1,52,163,120,78,52,52,0,38,52,52,1,121,52,7,0,1,51,3,0,1,50,205,33,134,52,0,0,216,31,2,0,51,50,24,0,119,0,6,0,1,50,4,0,1,51,24,34,134,52,0,0,216,31,2,0,50,51,26,0,1,52,165,120,78,52,52,0,38,52,52,1,121,52,6,0,1,51,3,0,1,50,116,34,134,52,0,0,216,31,2,0,51,50,27,0,1,52,166,120,78,52,52,0,38,52,52,1,121,52,6,0,1,50,3,0,1,51,162,34,134,52,0,0,216,31,2,0,50,51,28,0,1,52,167,120,78,52,52,0,38,52,52,1,121,52,6,0,1,51,3,0,1,50,209,34,134,52,0,0,216,31,2,0,51,50,29,0,1,52,168,120,78,52,52,0,38,52,52,1,121,52,6,0,1,50,3,0,1,51,4,35,134,52,0,0,216,31,2,0,50,51,30,0,1,52,169,120,78,52,52,0,38,52,52,1,121,52,6,0,1,51,3,0,1,50,51,35,134,52,0,0,216,31,2,0,51,50,31,0,1,52,170,120,78,52,52,0,38,52,52,1,121,52,10,0,1,50,32,117,88,52,50,0,145,52,52,0,87,32,52,0,1,50,3,0,1,51,98,35,134,52,0,0,216,31,2,0,50,51,32,0,1,52,162,120,78,52,52,0,38,52,52,1,121,52,6,0,1,51,3,0,1,50,164,35,134,52,0,0,216,31,2,0,51,50,33,0,1,52,171,120,78,52,52,0,38,52,52,1,121,52,6,0,1,50,3,0,1,51,217,35,134,52,0,0,216,31,2,0,50,51,34,0,1,52,252,35,78,52,52,0,83,14,52,0,1,51,253,35,78,51,51,0,107,14,1,51,1,52,254,35,78,52,52,0,107,14,2,52,1,51,255,35,78,51,51,0,107,14,3,51,1,51,224,115,1,50,1,0,1,53,1,0,1,54,7,0,1,55,1,0,134,52,0,0,16,70,1,0,14,50,53,54,55,0,0,0,85,51,52,0,1,52,224,115,82,52,52,0,121,52,10,0,1,52,224,115,82,52,52,0,85,35,52,0,1,51,3,0,1,55,0,36,134,52,0,0,216,31,2,0,51,55,35,0,119,0,6,0,1,55,4,0,1,51,51,36,134,52,0,0,216,31,2,0,55,51,36,0,134,52,0,0,68,203,1,0,15,0,0,0,1,52,44,117,82,51,15,0,85,52,51,0,1,51,48,117,106,52,15,4,85,51,52,0,1,52,228,115,1,51,44,117,82,51,51,0,85,52,51,0,1,51,232,115,1,52,48,117,82,52,52,0,85,51,52,0,134,52,0,0,224,102,1,0,134,52,0,0,244,119,2,0,16,0,0,0,1,41,148,115,0,44,16,0,25,45,41,64,116,41,44,0,25,41,41,4,25,44,44,4,54,52,41,45,108,238,0,0,1,52,212,115,1,55,0,16,135,51,6,0,55,0,0,0,85,52,51,0,1,51,0,0,85,10,51,0,1,51,0,1,82,52,10,0,56,51,51,52,44,239,0,0,1,51,212,115,82,51,51,0,82,52,10,0,41,52,52,4,1,55,7,0,97,51,52,55,1,55,212,115,82,55,55,0,82,52,10,0,41,52,52,4,3,55,55,52,1,52,0,0,109,55,4,52,1,52,212,115,82,52,52,0,82,55,10,0,41,55,55,4,3,52,52,55,1,55,0,0,109,52,8,55,1,55,212,115,82,55,55,0,82,52,10,0,41,52,52,4,3,55,55,52,1,52,224,115,82,52,52,0,109,55,12,52,82,52,10,0,25,52,52,1,85,10,52,0,119,0,221,255,1,52,216,115,1,55,1,0,85,52,55,0,1,55,0,0,85,11,55,0,1,55,32,0,82,52,11,0,56,55,55,52,156,239,0,0,1,55,192,73,82,52,11,0,41,52,52,6,3,3,55,52,134,52,0,0,244,119,2,0,17,0,0,0,0,41,3,0,0,44,17,0,25,45,41,64,116,41,44,0,25,41,41,4,25,44,44,4,54,52,41,45,120,239,0,0,82,52,11,0,25,52,52,1,85,11,52,0,119,0,234,255,134,52,0,0,244,119,2,0,18,0,0,0,1,41,12,115,0,44,18,0,25,45,41,64,116,41,44,0,25,41,41,4,25,44,44,4,54,52,41,45,180,239,0,0,134,52,0,0,244,119,2,0,19,0,0,0,1,41,80,115,0,44,19,0,25,45,41,64,116,41,44,0,25,41,41,4,25,44,44,4,54,52,41,45,224,239,0,0,1,52,76,115,1,55,80,115,85,52,55,0], eb + 51200);
  HEAPU8.set([1,52,3,2,135,55,20,0,52,0,0,0,1,52,113,11,135,55,21,0,52,0,0,0,1,52,2,3,1,51,3,3,135,55,22,0,52,51,0,0,1,51,226,11,135,55,23,0,51,0,0,0,1,51,5,4,135,55,24,0,51,0,0,0,1,51,1,9,135,55,25,0,51,0,0,0,1,51,68,11,135,55,23,0,51,0,0,0,59,51,0,0,59,52,0,0,59,54,0,0,59,53,1,0,135,55,26,0,51,52,54,53,59,53,1,0,135,55,27,0,53,0,0,0,1,53,0,65,135,55,28,0,53,0,0,0,1,55,240,115,82,53,40,0,85,55,53,0,1,53,244,115,82,55,7,0,85,53,55,0,1,53,3,0,1,54,90,36,134,55,0,0,216,31,2,0,53,54,37,0,137,43,0,0,139,0,0,0,140,1,34,0,0,0,0,0,2,27,0,0,79,29,0,0,2,28,0,0,90,29,0,0,2,29,0,0,82,29,0,0,1,25,0,0,136,30,0,0,0,26,30,0,136,30,0,0,25,30,30,48,137,30,0,0,130,30,0,0,136,31,0,0,49,30,30,31,16,241,0,0,1,31,48,0,135,30,0,0,31,0,0,0,25,16,26,32,25,15,26,24,25,1,26,16,25,3,26,8,0,2,26,0,1,30,64,117,106,31,0,4,85,30,31,0,82,31,0,0,32,10,31,1,1,31,2,0,1,30,64,117,82,30,30,0,49,31,31,30,120,244,0,0,121,10,23,0,25,19,0,24,1,31,72,117,82,30,19,0,85,31,30,0,1,30,76,117,106,31,19,4,85,30,31,0,25,31,0,24,25,5,31,8,1,31,116,117,82,30,5,0,85,31,30,0,1,30,120,117,106,31,5,4,85,30,31,0,1,31,60,117,1,30,4,0,85,31,30,0,134,30,0,0,124,151,2,0,137,26,0,0,139,0,0,0,82,30,0,0,33,30,30,2,121,30,23,0,82,30,0,0,121,30,3,0,137,26,0,0,139,0,0,0,1,30,132,117,59,31,0,0,145,31,31,0,89,30,31,0,59,31,0,0,145,31,31,0,89,2,31,0,59,30,0,0,145,30,30,0,113,2,4,30,1,30,64,117,1,31,0,0,85,30,31,0,1,31,60,117,1,30,0,0,85,31,30,0,137,26,0,0,139,0,0,0,1,30,108,117,82,30,30,0,85,15,30,0,1,31,112,117,82,31,31,0,109,15,4,31,1,31,124,117,82,31,31,0,85,16,31,0,1,30,128,117,82,30,30,0,109,16,4,30,1,30,132,117,134,31,0,0,232,102,2,0,15,16,0,0,145,31,31,0,89,30,31,0,1,31,72,117,1,30,108,117,82,30,30,0,85,31,30,0,1,30,76,117,1,31,112,117,82,31,31,0,85,30,31,0,1,31,116,117,1,30,124,117,82,30,30,0,85,31,30,0,1,30,120,117,1,31,128,117,82,31,31,0,85,30,31,0,25,20,0,24,1,31,108,117,82,30,20,0,85,31,30,0,1,30,112,117,106,31,20,4,85,30,31,0,25,31,0,24,25,6,31,8,1,31,124,117,82,30,6,0,85,31,30,0,1,30,128,117,106,31,6,4,85,30,31,0,1,31,72,117,82,31,31,0,85,15,31,0,1,30,76,117,82,30,30,0,109,15,4,30,1,30,108,117,82,30,30,0,85,16,30,0,1,31,112,117,82,31,31,0,109,16,4,31,134,31,0,0,232,102,2,0,15,16,0,0,145,31,31,0,62,30,0,0,133,240,30,64,225,122,116,63,145,30,30,0,74,31,31,30,121,31,3,0,1,25,41,0,119,0,30,0,1,31,116,117,82,31,31,0,85,15,31,0,1,30,120,117,82,30,30,0,109,15,4,30,1,30,124,117,82,30,30,0,85,16,30,0,1,31,128,117,82,31,31,0,109,16,4,31,134,31,0,0,232,102,2,0,15,16,0,0,145,31,31,0,62,30,0,0,133,240,30,64,225,122,116,63,145,30,30,0,74,31,31,30,121,31,3,0,1,25,41,0,119,0,6,0,1,31,60,117,1,30,4,0,85,31,30,0,134,30,0,0,124,151,2,0,32,30,25,41,121,30,34,0,1,30,108,117,82,30,30,0,85,15,30,0,1,31,112,117,82,31,31,0,109,15,4,31,1,31,124,117,82,31,31,0,85,16,31,0,1,30,128,117,82,30,30,0,109,16,4,30,134,8,0,0,232,102,2,0,15,16,0,0,145,8,8,0,1,32,132,117,88,31,32,0,145,31,31,0,64,30,8,31,145,30,30,0,59,31,0,0,145,31,31,0,71,30,30,31,121,30,5,0,1,30,60,117,1,31,0,1,85,30,31,0,119,0,5,0,1,31,60,117,1,30,0,2,85,31,30,0,119,0,1,0,1,30,108,117,82,30,30,0,85,15,30,0,1,31,112,117,82,31,31,0,109,15,4,31,1,31,124,117,82,31,31,0,85,16,31,0,1,30,128,117,82,30,30,0,109,16,4,30,134,30,0,0,208,105,2,0,15,16,0,0,145,30,30,0,137,26,0,0,139,0,0,0,121,10,100,0,1,30,68,117,1,31,68,117,82,31,31,0,25,31,31,1,85,30,31,0,1,31,60,117,82,31,31,0,32,31,31,0,1,30,2,0,1,32,68,117,82,32,32,0,17,30,30,32,19,31,31,30,121,31,40,0,134,7,0,0,124,151,2,0,1,31,208,114,86,31,31,0,64,31,7,31,59,30,44,1,71,31,31,30,121,31,30,0,25,17,0,24,1,31,72,117,82,31,31,0,85,15,31,0,1,30,76,117,82,30,30,0,109,15,4,30,116,16,17,0,106,31,17,4,109,16,4,31,134,31,0,0,232,102,2,0,15,16,0,0,145,31,31,0,62,30,0,0,201,124,126,223,81,184,158,63,145,30,30,0,71,31,31,30,121,31,8,0,1,31,60,117,1,30,2,0,85,31,30,0,1,30,68,117,1,31,0,0,85,30,31,0,119,0,6,0,1,25,7,0,119,0,4,0,1,25,7,0,119,0,2,0,1,25,7,0,32,31,25,7,121,31,7,0,1,31,68,117,1,30,1,0,85,31,30,0,1,30,60,117,1,31,1,0,85,30,31,0,25,18,0,24,1,31,72,117,82,30,18,0,85,31,30,0,1,30,76,117,106,31,18,4,85,30,31,0,25,21,0,24,1,31,80,117,82,30,21,0,85,31,30,0,1,30,84,117,106,31,21,4,85,30,31,0,1,31,88,117,1,30,72,117,82,30,30,0,85,31,30,0,1,30,92,117,1,31,76,117,82,31,31,0,85,30,31,0,1,31,208,114,134,30,0,0,124,151,2,0,87,31,30,0,1,30,152,29,106,31,0,8,85,30,31,0,59,31,0,0,145,31,31,0,89,1,31,0,59,30,0,0,145,30,30,0,113,1,4,30,137,26,0,0,139,0,0,0,82,30,0,0,121,30,81,0,82,30,0,0,33,30,30,2,121,30,3,0,137,26,0,0,139,0,0,0,1,30,60,117,82,30,30,0,32,30,30,8,121,30,5,0,1,30,208,114,134,31,0,0,124,151,2,0,87,30,31,0,1,31,172,120,78,31,31,0,38,31,31,1,120,31,8,0,1,31,216,114,134,30,0,0,124,151,2,0,87,31,30,0,1,30,172,120,1,31,1,0,83,30,31,0,25,23,0,24,1,31,108,117,82,30,23,0,85,31,30,0,1,30,112,117,106,31,23,4,85,30,31,0,1,31,60,117,82,31,31,0,32,31,31,4,121,31,44,0,1,31,173,120,78,31,31,0,38,31,31,1,121,31,8,0,25,24,0,24,1,31,72,117,82,30,24,0,85,31,30,0,1,30,76,117,106,31,24,4,85,30,31,0,1,31,173,120,1,30,0,0,83,31,30,0,1,30,72,117,82,30,30,0,85,15,30,0,1,31,76,117,82,31,31,0,109,15,4,31,1,31,108,117,82,31,31,0,85,16,31,0,1,30,112,117,82,30,30,0,109,16,4,30,134,30,0,0,232,102,2,0,15,16,0,0,145,30,30,0,62,31,0,0,199,74,54,225,81,184,142,63,145,31,31,0,74,30,30,31,121,30,8,0,1,30,208,114,134,31,0,0,124,151,2,0,87,30,31,0,1,31,60,117,1,30,8,0,85,31,30,0,137,26,0,0,139,0,0,0,1,30,60,117,82,30,30,0,32,30,30,8,121,30,8,0,25,22,0,24,1,30,88,117,82,31,22,0,85,30,31,0,1,31,92,117,106,30,22,4,85,31,30,0,1,30,72,117,82,30,30,0,85,15,30,0,1,31,76,117,82,31,31,0,109,15,4,31,1,31,88,117,82,31,31,0,85,16,31,0,1,30,92,117,82,30,30,0,109,16,4,30,1,30,96,117,134,31,0,0,232,102,2,0,15,16,0,0,145,31,31,0,89,30,31,0,1,31,96,117,88,4,31,0,145,4,4,0,134,9,0,0,124,151,2,0,1,31,100,117,1,33,216,114,86,33,33,0,64,32,9,33,145,32,32,0,66,30,4,32,145,30,30,0,89,31,30,0,1,30,172,120,1,31,0,0,83,30,31,0,1,30,100,117,88,31,30,0,145,31,31,0,62,30,0,0,29,93,35,224,77,98,64,63,145,30,30,0,73,31,31,30,121,31,106,0,1,31,152,29,82,31,31,0,106,30,0,8,45,31,31,30,196,249,0,0,1,31,72,117,82,31,31,0,85,15,31,0,1,30,76,117,82,30,30,0,109,15,4,30,1,30,88,117,82,30,30,0,85,16,30,0,1,31,92,117,82,31,31,0,109,16,4,31,1,31,104,117,59,32,104,1,145,32,32,0,134,33,0,0,208,105,2,0,15,16,0,0,145,33,33,0,64,30,32,33,145,30,30,0,89,31,30,0,1,31,104,117,88,30,31,0,145,30,30,0,59,31,30,0,145,31,31,0,71,11,30,31,1,30,104,117,88,31,30,0,145,31,31,0,59,30,74,1,145,30,30,0,73,31,31,30,20,31,11,31,121,31,5,0,1,31,60,117,1,30,16,0,85,31,30,0,119,0,62,0,1,31,104,117,88,30,31,0,145,30,30,0,59,31,30,0,145,31,31,0,73,12,30,31,1,30,104,117,88,31,30,0,145,31,31,0,59,30,120,0,145,30,30,0,71,31,31,30,19,31,12,31,121,31,5,0,1,31,60,117,1,30,64,0,85,31,30,0,119,0,44,0,1,31,104,117,88,30,31,0,145,30,30,0,59,31,120,0,145,31,31,0,73,13,30,31,1,30,104,117,88,31,30,0,145,31,31,0,59,30,210,0,145,30,30,0,71,31,31,30,19,31,13,31,121,31,5,0,1,31,60,117,1,30,32,0,85,31,30,0,119,0,26,0,1,31,104,117,88,30,31,0,145,30,30,0,59,31,210,0,145,31,31,0,73,14,30,31,1,30,104,117,88,31,30,0,145,31,31,0,59,30,44,1,145,30,30,0,71,31,31,30,19,31,14,31,121,31,5,0,1,31,60,117,1,30,128,0,85,31,30,0,119,0,8,0,1,30,60,117,1,31,0,0,85,30,31,0,119,0,4,0,1,25,23,0,119,0,2,0,1,25,23,0,32,31,25,23,121,31,16,0,1,31,96,117,59,30,0,0,145,30,30,0,89,31,30,0,1,30,100,117,59,31,0,0,145,31,31,0,89,30,31,0,1,31,104,117,59,30,0,0,145,30,30,0,89,31,30,0,1,30,60,117,1,31,0,0,85,30,31,0,59,31,0,0,145,31,31,0,89,3,31,0,59,30,0,0,145,30,30,0,113,3,4,30,1,30,80,117,82,31,3,0,85,30,31,0,1,31,84,117,106,30,3,4,85,31,30,0,1,30,64,117,1,31,0,0,85,30,31,0,137,26,0,0,139,0,0,0,140,0,47,0,0,0,0,0,2,41,0,0,149,29,0,0,2,42,0,0,150,29,0,0,136,43,0,0,0,37,43,0,136,43,0,0,1,44,48,12,3,43,43,44,137,43,0,0,130,43,0,0,136,44,0,0,49,43,43,44,164,250,0,0,1,44,48,12,135,43,0,0,44,0,0,0,1,43,8,12,3,26,37,43,1,43,244,11,3,25,37,43,1,43,128,11,3,36,37,43,1,43,128,3,3,20,37,43,1,43,240,11,3,8,37,43,1,43,236,11,3,7,37,43,0,9,37,0,1,43,232,11,3,28,37,43,1,43,228,11,3,27,37,43,1,43,224,11,3,30,37,43,1,43,220,11,3,21,37,43,1,43,32,12,3,0,37,43,1,43,216,11,3,17,37,43,1,43,212,11,3,22,37,43,1,43,208,11,3,32,37,43,1,43,28,12,3,1,37,43,1,43,188,11,3,24,37,43,1,43,168,11,3,34,37,43,1,43,164,11,3,18,37,43,1,43,160,11,3,19,37,43,1,43,156,11,3,33,37,43,1,43,152,11,3,23,37,43,1,43,132,11,3,35,37,43,1,43,60,118,1,44,224,0,85,43,44,0,1,43,0,4,1,45,0,8,135,44,29,0,20,43,45,0,1,44,10,0,85,8,44,0,1,44,1,0,85,7,44,0,1,45,0,12,1,43,128,3,135,44,29,0,9,45,43,0,1,44,128,0,85,28,44,0,1,44,128,0,85,27,44,0,82,45,28,0,82,46,27,0,5,43,45,46,41,43,43,2,135,44,6,0,43,0,0,0,85,30,44,0,1,44,0,0,85,21,44,0,82,43,28,0,82,46,27,0,5,44,43,46,82,46,21,0,56,44,44,46,64,252,0,0,82,44,30,0,82,46,21,0,41,46,46,2,3,4,44,46,1,46,0,0,83,0,46,0,1,44,0,0,107,0,1,44,1,46,0,0,107,0,2,46,1,44,0,0,107,0,3,44,78,44,0,0,83,4,44,0,102,46,0,1,107,4,1,46,102,44,0,2,107,4,2,44,102,46,0,3,107,4,3,46,82,46,21,0,25,46,46,1,85,21,46,0,119,0,227,255,1,46,0,0,85,17,46,0,1,46,0,0,85,22,46,0,82,44,28,0,82,43,27,0,5,46,44,43,82,43,22,0,56,46,46,43,56,253,0,0,1,46,31,0,85,32,46,0,82,2,17,0,82,46,32,0,34,46,46,0,120,46,34,0,41,46,2,2,94,46,20,46,1,43,1,0,82,44,32,0,22,43,43,44,19,46,46,43,121,46,23,0,82,46,30,0,82,43,22,0,82,44,32,0,3,43,43,44,41,43,43,2,3,5,46,43,1,43,255,255,83,1,43,0,1,46,255,255,107,1,1,46,1,43,255,255,107,1,2,43,1,46,255,255,107,1,3,46,78,46,1,0,83,5,46,0,102,43,1,1,107,5,1,43,102,46,1,2,107,5,2,46,102,43,1,3,107,5,3,43,82,43,32,0,26,43,43,1,85,32,43,0,119,0,220,255,25,31,2,1,85,17,31,0,1,46,0,2,82,44,17,0,15,46,46,44,1,44,0,0,125,43,46,44,31,0,0,0,85,17,43,0,82,43,22,0,25,43,43,32,85,22,43,0,119,0,199,255,82,44,30,0,82,46,28,0,82,45,27,0,134,43,0,0,64,227,1,0,24,44,46,45,1,45,2,0,134,43,0,0,92,72,0,0,24,45,0,0,82,45,30,0,135,43,8,0,45,0,0,0,116,26,24,0,106,45,24,4,109,26,4,45,106,43,24,8,109,26,8,43,106,45,24,12,109,26,12,45,106,43,24,16,109,26,16,43,134,43,0,0,0,27,2,0,34,26,0,0,1,43,64,118,82,45,34,0,85,43,45,0,1,45,68,118,106,43,34,4,85,45,43,0,1,43,72,118,106,45,34,8,85,43,45,0,1,45,76,118,106,43,34,12,85,45,43,0,1,43,80,118,106,45,34,16,85,43,45,0,1,45,88,118,1,46,60,118,82,46,46,0,27,46,46,36,135,43,6,0,46,0,0,0,85,45,43,0,1,43,84,118,1,46,60,118,82,46,46,0,41,46,46,4,135,45,6,0,46,0,0,0,85,43,45,0,1,45,0,0,85,18,45,0,116,19,7,0,116,33,7,0,1,45,0,0,85,23,45,0,1,45,60,118,82,45,45,0,82,43,23,0,56,45,45,43,220,0,1,0,82,38,23,0,1,45,88,118,82,45,45,0,27,43,38,36,25,46,38,32,97,45,43,46,82,10,19,0,76,46,10,0,145,10,46,0,1,46,84,118,82,46,46,0,82,43,23,0,41,43,43,4,101,46,43,10,82,39,7,0,82,46,18,0,82,45,8,0,3,45,45,39,5,43,46,45,3,11,39,43,76,43,11,0,145,11,43,0,1,43,84,118,82,43,43,0,82,45,23,0,41,45,45,4,3,43,43,45,113,43,4,11,82,43,23,0,41,43,43,2,94,12,9,43,76,43,12,0,145,12,43,0,1,43,84,118,82,43,43,0,82,45,23,0,41,45,45,4,3,43,43,45,113,43,8,12,82,13,8,0,76,43,13,0,145,13,43,0,1,43,84,118,82,43,43,0,82,45,23,0,41,45,45,4,3,43,43,45,113,43,12,13,1,43,84,118,82,43,43,0,82,45,23,0,41,45,45,4,3,43,43,45,112,3,43,8,145,3,3,0,82,45,7,0,76,45,45,0,145,45,45,0,63,43,3,45,145,43,43,0,75,14,43,0,82,43,33,0,3,43,43,14,85,33,43,0,1,43,68,118,82,43,43,0,82,45,33,0,49,43,43,45,216,255,0,0,82,43,18,0,25,43,43,1,85,18,43,0,82,43,7,0,41,43,43,1,82,45,23,0,41,45,45,2,94,45,9,45,3,43,43,45,85,19,43,0,116,33,19,0,82,15,7,0,76,43,15,0,145,15,43,0,1,43,84,118,82,43,43,0,82,45,23,0,41,45,45,4,101,43,45,15,82,40,7,0,82,43,18,0,82,46,8,0,3,46,46,40,5,45,43,46,3,16,40,45,76,45,16,0,145,16,45,0,1,45,84,118,82,45,45,0,82,46,23,0,41,46,46,4,3,45,45,46,113,45,4,16,119,0,2,0,116,19,33,0,1,45,88,118,82,45,45,0,82,46,23,0,27,46,46,36,3,45,45,46,1,46,0,0,109,45,4,46,1,46,88,118,82,46,46,0,82,45,23,0,27,45,45,36,3,46,46,45,1,45,0,0,109,46,8,45,1,45,88,118,82,45,45,0,82,46,23,0,27,46,46,36,3,45,45,46,1,46,0,0,109,45,12,46,1,46,88,118,82,46,46,0,82,45,23,0,27,45,45,36,3,46,46,45,25,29,46,16,1,46,84,118,82,46,46,0,82,45,23,0,41,45,45,4,3,6,46,45,116,25,24,0,106,46,24,4,109,25,4,46,106,45,24,8,109,25,8,45,106,46,24,12,109,25,12,46,106,45,24,16,109,25,16,45,116,26,6,0,106,46,6,4,109,26,4,46,106,45,6,8,109,26,8,45,106,46,6,12,109,26,12,46,134,46,0,0,208,37,2,0,35,25,26,0,116,29,35,0,106,45,35,4,109,29,4,45,106,46,35,8,109,29,8,46,106,45,35,12,109,29,12,45,106,46,35,16,109,29,16,46,82,46,23,0,25,46,46,1,85,23,46,0,119,0,84,255,116,26,24,0,106,45,24,4,109,26,4,45,106,46,24,8,109,26,8,46,106,45,24,12,109,26,12,45,106,46,24,16,109,26,16,46,134,46,0,0,236,159,2,0,26,0,0,0,1,46,56,118,1,43,84,118,82,43,43,0,112,45,43,12,145,45,45,0,75,45,45,0,85,46,45,0,1,45,64,118,82,45,45,0,85,36,45,0,1,46,3,0,1,43,97,47,134,45,0,0,216,31,2,0,46,43,36,0,137,37,0,0,139,0,0,0,140,5,65,0,0,0,0,0,0,5,0,0,0,6,1,0,0,7,6,0,0,8,2,0,0,9,3,0,0,10,9,0,120,7,28,0,33,11,4,0,120,10,12,0,121,11,5,0,9,60,5,8,85,4,60,0,1,61,0,0,109,4,4,61,1,57,0,0,7,56,5,8,135,61,30,0,57,0,0,0,139,56,0,0,119,0,15,0,120,11,6,0,1,57,0,0,1,56,0,0,135,61,30,0,57,0,0,0,139,56,0,0,85,4,0,0,38,60,1,0,109,4,4,60,1,57,0,0,1,56,0,0,135,60,30,0,57,0,0,0,139,56,0,0,32,12,10,0,120,8,77,0,121,12,11,0,121,4,5,0,9,60,7,8,85,4,60,0,1,61,0,0,109,4,4,61,1,57,0,0,7,56,7,8,135,61,30,0,57,0,0,0,139,56,0,0,120,5,11,0,121,4,5,0,1,61,0,0,85,4,61,0,9,60,7,10,109,4,4,60,1,57,0,0,7,56,7,10,135,60,30,0,57,0,0,0,139,56,0,0,26,13,10,1,19,60,13,10,120,60,15,0,121,4,6,0,85,4,0,0,19,61,13,7,38,62,1,0,20,61,61,62,109,4,4,61,1,57,0,0,135,61,31,0,10,0,0,0,24,61,7,61,0,56,61,0,135,61,30,0,57,0,0,0,139,56,0,0,135,61,32,0,10,0,0,0,135,60,32,0,7,0,0,0,4,14,61,60,37,60,14,30,121,60,15,0,25,15,14,1,1,60,31,0,4,16,60,14,0,33,15,0,22,60,7,16,24,61,5,15,20,60,60,61,0,32,60,0,24,60,7,15,0,31,60,0,1,30,0,0,22,60,5,16,0,29,60,0,119,0,133,0,120,4,6,0,1,57,0,0,1,56,0,0,135,60,30,0,57,0,0,0,139,56,0,0,85,4,0,0,38,61,1,0,20,61,6,61,109,4,4,61,1,57,0,0,1,56,0,0,135,61,30,0,57,0,0,0,139,56,0,0,119,0,117,0,120,12,42,0,135,61,32,0,10,0,0,0,135,60,32,0,7,0,0,0,4,25,61,60,37,60,25,31,121,60,20,0,25,26,25,1,1,60,31,0,4,27,60,25,26,60,25,31,42,60,60,31,0,28,60,0,0,33,26,0,24,60,5,26,19,60,60,28,22,61,7,27,20,60,60,61,0,32,60,0,24,60,7,26,19,60,60,28,0,31,60,0,1,30,0,0,22,60,5,27,0,29,60,0,119,0,90,0,120,4,6,0,1,57,0,0,1,56,0,0,135,60,30,0,57,0,0,0,139,56,0,0,85,4,0,0,38,61,1,0,20,61,6,61,109,4,4,61,1,57,0,0,1,56,0,0,135,61,30,0,57,0,0,0,139,56,0,0,26,17,8,1,19,61,17,8,121,61,44,0,135,61,32,0,8,0,0,0,25,61,61,33,135,60,32,0,7,0,0,0,4,19,61,60,1,60,64,0,4,20,60,19,1,60,32,0,4,21,60,19,42,60,21,31,0,22,60,0,26,23,19,32,42,60,23,31,0,24,60,0,0,33,19,0,26,60,21,1,42,60,60,31,24,61,7,23,19,60,60,61,22,61,7,21,24,62,5,19,20,61,61,62,19,61,61,24,20,60,60,61,0,32,60,0,24,60,7,19,19,60,24,60,0,31,60,0,22,60,5,20,19,60,60,22,0,30,60,0,22,60,7,20,24,61,5,23,20,60,60,61,19,60,60,22,22,61,5,21,26,62,19,33,42,62,62,31,19,61,61,62,20,60,60,61,0,29,60,0,119,0,29,0,121,4,5,0,19,60,17,5,85,4,60,0,1,61,0,0,109,4,4,61,32,61,8,1,121,61,9,0,38,61,1,0,20,61,6,61,0,57,61,0,0,56,0,0,135,61,30,0,57,0,0,0,139,56,0,0,119,0,14,0,135,18,31,0,8,0,0,0,24,61,7,18,0,57,61,0,1,61,32,0,4,61,61,18,22,61,7,61,24,60,5,18,20,61,61,60,0,56,61,0,135,61,30,0,57,0,0,0,139,56,0,0,120,33,8,0,0,53,29,0,0,52,30,0,0,51,31,0,0,50,32,0,1,49,0,0,1,48,0,0,119,0,71,0,0,34,2,0,38,61,3,0,20,61,9,61,0,35,61,0,1,61,255,255,1,60,255,255,134,36,0,0,48,154,2,0,34,35,61,60,135,37,1,0,0,43,29,0,0,42,30,0,0,41,31,0,0,40,32,0,0,39,33,0,1,38,0,0,0,58,43,0,43,60,42,31,41,61,43,1,20,60,60,61,0,43,60,0,41,60,42,1,20,60,38,60,0,42,60,0,41,60,40,1,43,61,58,31,20,60,60,61,0,44,60,0,43,60,40,31,41,61,41,1,20,60,60,61,0,45,60,0,134,60,0,0,204,151,2,0,36,37,44,45,135,46,1,0,34,61,46,0,1,62,255,255,1,63,0,0,125,60,61,62,63,0,0,0,41,60,60,1,0,59,60,0,42,60,46,31,20,60,60,59,0,47,60,0,38,60,47,1,0,38,60,0,19,60,47,34,34,62,46,0,1,61,255,255,1,64,0,0,125,63,62,61,64,0,0,0,42,63,63,31,20,63,63,59,19,63,63,35,134,40,0,0,204,151,2,0,44,45,60,63,135,41,1,0,26,39,39,1,33,63,39,0,120,63,209,255,0,53,43,0,0,52,42,0,0,51,41,0,0,50,40,0,1,49,0,0,0,48,38,0,0,54,52,0,1,55,0,0,121,4,3,0,85,4,50,0,109,4,4,51,43,63,54,31,20,60,53,55,41,60,60,1,20,63,63,60,41,60,55,1,43,64,54,31,20,60,60,64,38,60,60,0,20,63,63,60,20,63,63,49,0,57,63,0,41,63,54,1,1,60,0,0,43,60,60,31,20,63,63,60,38,63,63,254,20,63,63,48,0,56,63,0,135,63,30,0,57,0,0,0,139,56,0,0,140,8,58,0,0,0,0,0,2,51,0,0,255,0,0,0,136,52,0,0,0,29,52,0,136,52,0,0,25,52,52,64,137,52,0,0,130,52,0,0,136,53,0,0,49,52,52,53,200,6,1,0,1,53,64,0,135,52,0,0,53,0,0,0,25,22,29,48,25,24,29,44,25,26,29,40,25,17,29,36,25,27,29,32,25,21,29,28,25,16,29,24,25,19,29,20,25,20,29,16,25,18,29,12,25,25,29,8,25,28,29,4,0,23,29,0,85,22,0,0,85,24,1,0,85,26,2,0,85,17,3,0,85,27,4,0,85,21,5,0,85,16,6,0,85,19,7,0,82,53,27,0,1,54,96,20,1,55,128,20,125,52,53,54,55,0,0,0,85,20,52,0,82,52,20,0,82,55,16,0,41,55,55,2,3,52,52,55,116,25,52,0,1,52,0,0,121,52,6,0,82,52,17,0,26,52,52,1,82,55,27,0,4,10,52,55,119,0,2,0,82,10,27,0,82,55,22,0,82,54,24,0,5,52,54,10,3,55,55,52,85,28,55,0,82,9,24,0,1,52,0,0,121,52,5,0,1,52,0,0,4,52,52,9,0,55,52,0,119,0,2,0,0,55,9,0,85,23,55,0,82,55,25,0,120,55,10,0,82,52,19,0,82,54,28,0,82,56,26,0,82,57,21,0,5,53,56,57,135,55,29,0,52,54,53,0,137,29,0,0,139,0,0,0,1,55,0,0,85,18,55,0,82,8,25,0,82,55,21,0,82,53,18,0,56,55,55,53,8,9,1,0,1,55,1,0,1,53,6,0,138,8,55,53,16,8,1,0,40,8,1,0,80,8,1,0,124,8,1,0,200,8,1,0,224,8,1,0,119,0,59,0,82,30,18,0,82,55,19,0,82,53,28,0,90,53,53,30,95,55,30,53,119,0,53,0,82,31,18,0,82,32,28,0,82,53,19,0,91,55,32,31,82,54,23,0,4,54,31,54,91,54,32,54,4,55,55,54,95,53,31,55,119,0,43,0,82,33,18,0,82,34,28,0,82,55,19,0,91,53,34,33,82,54,23,0,4,54,33,54,91,54,34,54,42,54,54,1,4,53,53,54,95,55,33,53,119,0,32,0,82,35,28,0,82,36,18,0,91,53,35,36,1,54,0,0,82,52,23,0,4,52,36,52,91,52,35,52,1,57,0,0,134,55,0,0,196,25,2,0,54,52,57,0,19,55,55,51,4,53,53,55,19,53,53,51,0,15,53,0,82,53,19,0,82,55,18,0,95,53,55,15,119,0,13,0,82,37,18,0,82,55,19,0,82,53,28,0,90,53,53,37,95,55,37,53,119,0,7,0,82,38,18,0,82,53,19,0,82,55,28,0,90,55,55,38,95,53,38,55,119,0,1,0,82,55,18,0,25,55,55,1,85,18,55,0,119,0,180,255,1,55,1,0,1,53,6,0,138,8,55,53,56,9,1,0,148,9,1,0,240,9,1,0,96,10,1,0,248,10,1,0,88,11,1,0,137,29,0,0,139,0,0,0,119,0,171,0,116,18,21,0,82,53,26,0,82,57,21,0,5,55,53,57,82,57,18,0,56,55,55,57,136,9,1,0,82,39,18,0,82,40,28,0,82,55,19,0,91,57,40,39,82,53,21,0,4,53,39,53,91,53,40,53,4,57,57,53,95,55,39,57,82,57,18,0,25,57,57,1,85,18,57,0,119,0,238,255,137,29,0,0,139,0,0,0,119,0,1,0,116,18,21,0,82,55,26,0,82,53,21,0,5,57,55,53,82,53,18,0,56,57,57,53,228,9,1,0,82,41,18,0,82,42,28,0,82,57,19,0,91,53,42,41,82,55,23,0,4,55,41,55,91,55,42,55,4,53,53,55,95,57,41,53,82,53,18,0,25,53,53,1,85,18,53,0,119,0,238,255,137,29,0,0,139,0,0,0,119,0,1,0,116,18,21,0,82,57,26,0,82,55,21,0,5,53,57,55,82,55,18,0,56,53,53,55,84,10,1,0,82,43,18,0,82,44,28,0,82,53,19,0,91,55,44,43,82,57,21,0,4,57,43,57,91,57,44,57,82,52,23,0,4,52,43,52,91,52,44,52,3,57,57,52,42,57,57,1,4,55,55,57,95,53,43,55,82,55,18,0,25,55,55,1,85,18,55,0,119,0,233,255,137,29,0,0,139,0,0,0,119,0,1,0,116,18,21,0,82,53,26,0,82,57,21,0,5,55,53,57,82,57,18,0,56,55,55,57,236,10,1,0,82,55,28,0,82,57,18,0,91,11,55,57,82,45,28,0,82,46,18,0,82,55,18,0,82,57,23,0,4,47,55,57,82,48,21,0,4,55,46,48,91,55,45,55,91,53,45,47,4,52,47,48,91,52,45,52,134,57,0,0,196,25,2,0,55,53,52,0,19,57,57,51,4,57,11,57,19,57,57,51,0,12,57,0,82,57,19,0,82,52,18,0,95,57,52,12,82,52,18,0,25,52,52,1,85,18,52,0,119,0,223,255,137,29,0,0,139,0,0,0,119,0,1,0,116,18,21,0,82,57,26,0,82,53,21,0,5,52,57,53,82,53,18,0,56,52,52,53,76,11,1,0,82,49,18,0,82,50,28,0,82,52,19,0,91,53,50,49,82,57,21,0,4,57,49,57,91,57,50,57,42,57,57,1,4,53,53,57,95,52,49,53,82,53,18,0,25,53,53,1,85,18,53,0,119,0,237,255,137,29,0,0,139,0,0,0,119,0,1,0,116,18,21,0,82,52,26,0,82,57,21,0,5,53,52,57,82,57,18,0,56,53,53,57,212,11,1,0,82,53,28,0,82,57,18,0,91,13,53,57,82,57,28,0,82,52,18,0,82,55,21,0,4,52,52,55,91,57,57,52,1,52,0,0,1,55,0,0,134,53,0,0,196,25,2,0,57,52,55,0,19,53,53,51,4,53,13,53,19,53,53,51,0,14,53,0,82,53,19,0,82,55,18,0,95,53,55,14,82,55,18,0,25,55,55,1,85,18,55,0,119,0,227,255,137,29,0,0,139,0,0,0,119,0,84,255,139,0,0,0,140,6,48,0,0,0,0,0,1,38,0,0,136,40,0,0,0,39,40,0,136,40,0,0,25,40,40,80,137,40,0,0,130,40,0,0,136,41,0,0,49,40,40,41,32,12,1,0,1,41,80,0,135,40,0,0,41,0,0,0,25,23,39,64,25,22,39,60,25,24,39,56,25,34,39,52,25,26,39,48,25,31,39,44,25,30,39,40,25,29,39,36,25,25,39,32,25,27,39,28,25,35,39,24,25,33,39,20,25,36,39,16,25,21,39,12,25,32,39,8,25,28,39,4,0,37,39,0,85,23,0,0,85,22,1,0,85,24,2,0,89,34,3,0,85,26,4,0,85,31,5,0,88,6,34,0,145,6,6,0,82,41,24,0,82,42,26,0,82,43,31,0,134,40,0,0,236,40,2,0,6,41,42,43,85,30,40,0,82,43,24,0,88,42,34,0,145,42,42,0,134,40,0,0,152,51,2,0,43,42,0,0,85,29,40,0,1,40,0,0,85,25,40,0,82,40,31,0,82,42,25,0,49,40,40,42,220,12,1,0,1,38,22,0,119,0,160,0,59,40,0,0,145,40,40,0,89,36,40,0,1,40,0,0,85,27,40,0,82,40,30,0,82,42,27,0,56,40,40,42,232,13,1,0,82,40,23,0,82,42,27,0,41,42,42,3,94,40,40,42,82,42,25,0,49,40,40,42,172,13,1,0,82,40,25,0,82,42,23,0,82,43,27,0,41,43,43,3,3,42,42,43,106,42,42,4,49,40,40,42,164,13,1,0,88,9,34,0,145,9,9,0,82,43,22,0,82,41,24,0,82,44,27,0,82,45,25,0,82,46,23,0,82,47,27,0,41,47,47,3,94,46,46,47,4,45,45,46,134,42,0,0,56,55,2,0,43,41,9,44,45,0,0,0,88,40,42,0,145,40,40,0,89,21,40,0,88,10,21,0,145,10,10,0,88,42,36,0,145,42,42,0,63,40,42,10,145,40,40,0,89,36,40,0,119,0,4,0,1,38,8,0,119,0,2,0,1,38,8,0,32,40,38,8,121,40,9,0,1,38,0,0,82,40,25,0,82,42,23,0,82,45,27,0,41,45,45,3,94,42,42,45,54,40,40,42,232,13,1,0,82,40,27,0,25,40,40,1,85,27,40,0,119,0,195,255,88,40,36,0,145,40,40,0,62,42,0,0,223,67,234,191,204,204,236,63,145,42,42,0,73,40,40,42,120,40,3,0,1,38,11,0,119,0,83,0,88,40,36,0,145,40,40,0,62,42,0,0,82,253,247,158,153,153,241,63,145,42,42,0,71,40,40,42,120,40,3,0,1,38,13,0,119,0,73,0,59,42,1,0,145,42,42,0,88,45,36,0,145,45,45,0,66,40,42,45,145,40,40,0,89,33,40,0,1,40,0,0,85,27,40,0,82,40,30,0,82,45,27,0,56,40,40,45,72,15,1,0,82,40,23,0,82,45,27,0,41,45,45,3,94,40,40,45,82,45,25,0,49,40,40,45,12,15,1,0,82,40,25,0,82,45,23,0,82,42,27,0,41,42,42,3,3,45,45,42,106,45,45,4,49,40,40,45,4,15,1,0,88,11,33,0,145,11,11,0,88,12,34,0,145,12,12,0,82,40,22,0,82,45,24,0,82,42,27,0,82,44,25,0,82,41,23,0,82,43,27,0,41,43,43,3,94,41,41,43,4,44,44,41,134,18,0,0,56,55,2,0,40,45,12,42,44,0,0,0,88,42,18,0,145,42,42,0,65,44,42,11,145,44,44,0,89,18,44,0,119,0,4,0,1,38,19,0,119,0,2,0,1,38,19,0,32,44,38,19,121,44,9,0,1,38,0,0,82,44,25,0,82,42,23,0,82,45,27,0,41,45,45,3,94,42,42,45,54,44,44,42,72,15,1,0,82,44,27,0,25,44,44,1,85,27,44,0,119,0,198,255,82,44,25,0,25,44,44,1,85,25,44,0,119,0,92,255,32,44,38,11,121,44,8,0,1,42,10,55,1,45,90,48,1,40,116,4,1,41,23,55,135,44,4,0,42,45,40,41,119,0,159,0,32,44,38,13,121,44,8,0,1,41,64,55,1,40,90,48,1,45,117,4,1,42,23,55,135,44,4,0,41,40,45,42,119,0,150,0,32,44,38,22,121,44,148,0,1,44,0,0,85,27,44,0,82,44,30,0,82,42,27,0,56,44,44,42,136,17,1,0,1,44,0,0,85,35,44,0,88,13,34,0,145,13,13,0,82,45,22,0,82,40,24,0,82,41,27,0,82,43,35,0,134,42,0,0,56,55,2,0,45,40,13,41,43,0,0,0,88,44,42,0,145,44,44,0,59,42,0,0,145,42,42,0,69,20,44,42,82,14,35,0,120,20,2,0,119,0,4,0,25,42,14,1,85,35,42,0,119,0,236,255,82,42,23,0,82,44,27,0,41,44,44,3,3,16,42,44,82,44,16,0,3,44,44,14,85,16,44,0,82,44,23,0,82,42,27,0,41,42,42,3,3,17,44,42,1,42,0,0,82,44,23,0,82,43,27,0,41,43,43,3,94,44,44,43,56,42,42,44,128,16,1,0,82,42,17,0,25,42,42,1,85,17,42,0,82,42,35,0,25,42,42,1,85,35,42,0,119,0,239,255,106,42,17,4,82,44,23,0,82,43,27,0,41,43,43,3,94,44,44,43,4,42,42,44,25,42,42,1,85,32,42,0,82,44,29,0,82,43,32,0,134,42,0,0,144,144,2,0,44,43,0,0,85,28,42,0,82,43,24,0,88,44,34,0,145,44,44,0,134,42,0,0,152,51,2,0,43,44,0,0,85,37,42,0,1,42,0,0,85,25,42,0,82,42,28,0,82,44,25,0,56,42,42,44,120,17,1,0,82,42,37,0,82,44,25,0,82,43,35,0,3,44,44,43,56,42,42,44,120,17,1,0,88,15,34,0,145,15,15,0,82,44,22,0,82,43,24,0,82,41,27,0,82,40,25,0,82,45,35,0,3,40,40,45,134,42,0,0,56,55,2,0,44,43,15,41,40,0,0,0,88,7,42,0,145,7,7,0,88,8,34,0,145,8,8,0,82,40,22,0,82,41,24,0,82,43,27,0,82,44,25,0,134,42,0,0,56,55,2,0,40,41,8,43,44,0,0,0,89,42,7,0,82,42,25,0,25,42,42,1,85,25,42,0,119,0,218,255,82,42,27,0,25,42,42,1,85,27,42,0,119,0,139,255,1,42,0,0,85,25,42,0,82,42,30,0,82,44,25,0,56,42,42,44,236,17,1,0,82,42,23,0,82,44,25,0,41,44,44,3,3,42,42,44,106,42,42,4,82,44,31,0,26,44,44,1,134,19,0,0,144,144,2,0,42,44,0,0,82,44,23,0,82,42,25,0,41,42,42,3,3,44,44,42,109,44,4,19,82,44,25,0,25,44,44,1,85,25,44,0,119,0,234,255,137,39,0,0,139,0,0,0,139,0,0,0,140,2,74,0,0,0,0,0,2,70,0,0,255,0,0,0,1,68,0,0,136,71,0,0,0,69,71,0,136,71,0,0,1,72,32,4,3,71,71,72,137,71,0,0,130,71,0,0,136,72,0,0,49,71,71,72,64,18,1,0,1,72,32,4,135,71,0,0,72,0,0,0,1,71,0,4,3,15,69,71,0,58,69,0,1,71,0,0,85,15,71,0,1,72,0,0,109,15,4,72,1,71,0,0,109,15,8,71,1,72,0,0,109,15,12,72,1,71,0,0,109,15,16,71,1,72,0,0,109,15,20,72,1,71,0,0,109,15,24,71,1,72,0,0,109,15,28,72,78,2,1,0,41,72,2,24,42,72,72,24,120,72,8,0,1,25,255,255,1,29,255,255,1,43,0,0,1,49,1,0,1,52,1,0,1,68,25,0,119,0,146,0,0,5,2,0,1,44,0,0,90,72,0,44,120,72,3,0,1,57,0,0,119,0,140,0,19,72,5,70,0,22,72,0,43,72,22,5,41,72,72,2,3,14,15,72,82,72,14,0,1,71,1,0,38,73,22,31,22,71,71,73,20,72,72,71,85,14,72,0,25,44,44,1,41,72,22,2,97,58,72,44,90,5,1,44,41,72,5,24,42,72,72,24,33,72,72,0,120,72,234,255,1,72,1,0,16,18,72,44,121,18,112,0,1,10,1,0,1,26,255,255,1,32,0,0,1,36,1,0,1,50,1,0,3,72,36,26,90,6,1,72,90,7,1,10,41,72,6,24,42,72,72,24,41,71,7,24,42,71,71,24,45,72,72,71,144,19,1,0,45,72,36,50,124,19,1,0,0,27,26,0,3,33,50,32,1,37,1,0,0,51,50,0,119,0,20,0,0,27,26,0,0,33,32,0,25,37,36,1,0,51,50,0,119,0,15,0,19,72,7,70,19,71,6,70,47,72,72,71,180,19,1,0,0,27,26,0,0,33,10,0,1,37,1,0,4,51,10,26,119,0,6,0,0,27,32,0,25,33,32,1,1,37,1,0,1,51,1,0,119,0,1,0,3,10,37,33,57,72,44,10,232,19,1,0,0,26,27,0,0,32,33,0,0,36,37,0,0,50,51,0,119,0,214,255,121,18,56,0,1,11,1,0,1,30,255,255,1,34,0,0,1,38,1,0,1,54,1,0,3,72,38,30,90,8,1,72,90,9,1,11,41,72,8,24,42,72,72,24,41,71,9,24,42,71,71,24,45,72,72,71,84,20,1,0,45,72,38,54,64,20,1,0,0,31,30,0,3,35,54,34,1,39,1,0,0,55,54,0,119,0,20,0,0,31,30,0,0,35,34,0,25,39,38,1,0,55,54,0,119,0,15,0,19,72,8,70,19,71,9,70,47,72,72,71,120,20,1,0,0,31,30,0,0,35,11,0,1,39,1,0,4,55,11,30,119,0,6,0,0,31,34,0,25,35,34,1,1,39,1,0,1,55,1,0,119,0,1,0,3,11,39,35,50,72,44,11,180,20,1,0,0,25,27,0,0,29,31,0,0,43,44,0,0,49,51,0,0,52,55,0,1,68,25,0,119,0,19,0,0,30,31,0,0,34,35,0,0,38,39,0,0,54,55,0,119,0,207,255,0,25,27,0,1,29,255,255,0,43,44,0,0,49,51,0,1,52,1,0,1,68,25,0,119,0,7,0,1,25,255,255,1,29,255,255,0,43,44,0,1,49,1,0,1,52,1,0,1,68,25,0,32,72,68,25,121,72,124,0,25,72,25,1,25,71,29,1,16,19,72,71,125,53,19,52,49,0,0,0,125,28,19,29,25,0,0,0,25,12,28,1,3,72,1,53,134,71,0,0,136,133,2,0,1,72,12,0,120,71,6,0,4,60,43,53,0,47,60,0,0,56,53,0,0,63,60,0,119,0,10,0,4,71,43,28,26,64,71,1,16,72,64,28,125,71,72,28,64,0,0,0,25,13,71,1,1,47,0,0,0,56,13,0,4,63,43,13,39,71,43,63,0,48,71,0,26,61,43,1,33,65,47,0,0,23,0,0,1,45,0,0,0,66,0,0,0,59,23,0,4,71,66,59,48,71,71,43,212,21,1,0,1,71,0,0,134,16,0,0,0,166,1,0,66,71,48,0,120,16,3,0,3,67,66,48,119,0,9,0,4,71,16,59,48,71,71,43,204,21,1,0,1,57,0,0,119,0,74,0,0,67,16,0,119,0,2,0,0,67,66,0,91,21,23,61,1,71,1,0,38,72,21,31,22,71,71,72,43,72,21,5,41,72,72,2,94,72,15,72,19,71,71,72,120,71,4,0,0,40,43,0,1,46,0,0,119,0,55,0,41,71,21,2,94,71,58,71,4,62,43,71,121,62,9,0,33,71,45,0,19,71,65,71,16,72,62,56,19,71,71,72,125,40,71,63,62,0,0,0,1,46,0,0,119,0,43,0,16,17,45,12,125,20,17,12,45,0,0,0,90,3,1,20,41,71,3,24,42,71,71,24,121,71,19,0,0,4,3,0,0,41,20,0,41,71,4,24,42,71,71,24,90,72,23,41,53,71,71,72,144,22,1,0,25,24,41,1,90,4,1,24,41,71,4,24,42,71,71,24,120,71,2,0,119,0,6,0,0,41,24,0,119,0,244,255,4,40,41,28,1,46,0,0,119,0,18,0,120,17,3,0,0,57,23,0,119,0,19,0,0,42,12,0,26,42,42,1,90,71,1,42,90,72,23,42,46,71,71,72,204,22,1,0,0,40,56,0,0,46,47,0,119,0,6,0,50,71,42,45,220,22,1,0,0,57,23,0,119,0,6,0,119,0,244,255,3,23,23,40,0,45,46,0,0,66,67,0,119,0,168,255,137,69,0,0,139,57,0,0,140,0,10,0,0,0,0,0,135,0,33,0,1,1,0,0,135,0,34,0,1,0,0,0,1,1,0,0,135,0,35,0,1,0,0,0,1,1,0,0,1,2,0,0,135,0,36,0,1,2,0,0,1,2,0,0,1,1,0,0,135,0,37,0,2,1,0,0,1,1,0,0,135,0,38,0,1,0,0,0,1,1,0,0,1,2,0,0,135,0,39,0,1,2,0,0,1,2,0,0,135,0,40,0,2,0,0,0,1,2,0,0,1,1,0,0,135,0,41,0,2,1,0,0,1,1,0,0,135,0,42,0,1,0,0,0,1,1,0,0,135,0,43,0,1,0,0,0,59,1,0,0,145,1,1,0,59,2,0,0,145,2,2,0,135,0,44,0,1,2,0,0,1,2,0,0,1,1,0,0,135,0,45,0,2,1,0,0,1,1,0,0,135,0,46,0,1,0,0,0,1,1,0,0,135,0,47,0,1,0,0,0,1,1,0,0,1,2,0,0,1,3,0,0,135,0,48,0,1,2,3,0,1,3,0,0,1,2,0,0,1,1,0,0,1,4,0,0,135,0,49,0,3,2,1,4,1,4,0,0,135,0,50,0], eb + 61440);
  HEAPU8.set([4,0,0,0,1,4,0,0,135,0,51,0,4,0,0,0,135,0,52,0,135,0,53,0,1,4,0,0,1,1,0,0,1,2,0,0,1,3,0,0,135,0,54,0,4,1,2,3,1,3,0,0,1,2,0,0,1,1,0,0,1,4,0,0,1,5,0,0,135,0,55,0,3,2,1,4,5,0,0,0,1,5,0,0,135,0,56,0,5,0,0,0,1,5,0,0,1,4,0,0,135,0,57,0,5,4,0,0,1,4,0,0,135,0,58,0,4,0,0,0,1,4,0,0,1,5,0,0,135,0,59,0,4,5,0,0,1,5,0,0,1,4,0,0,135,0,60,0,5,4,0,0,1,4,0,0,1,5,0,0,135,0,61,0,4,5,0,0,1,5,0,0,1,4,0,0,1,1,0,0,1,2,0,0,1,3,0,0,1,6,0,0,1,7,0,0,135,0,62,0,5,4,1,2,3,6,7,0,1,7,0,0,1,6,0,0,1,3,0,0,1,2,0,0,1,1,0,0,1,4,0,0,1,5,0,0,135,0,63,0,7,6,3,2,1,4,5,0,1,5,0,0,1,4,0,0,1,1,0,0,1,2,0,0,135,0,64,0,5,4,1,2,1,2,0,0,1,1,0,0,135,0,65,0,2,1,0,0,1,1,0,0,1,2,0,0,135,0,66,0,1,2,0,0,1,2,0,0,1,1,0,0,1,4,0,0,135,0,67,0,2,1,4,0,135,0,68,0,1,4,0,0,1,1,0,0,135,0,69,0,4,1,0,0,1,1,0,0,1,4,0,0,1,2,0,0,1,5,0,0,135,0,70,0,1,4,2,5,1,5,0,0,1,2,0,0,135,0,71,0,5,2,0,0,1,2,0,0,1,5,0,0,1,4,0,0,135,0,72,0,2,5,4,0,1,4,0,0,1,5,0,0,1,2,0,0,1,1,0,0,135,0,73,0,4,5,2,1,1,1,0,0,1,2,0,0,1,5,0,0,135,0,74,0,1,2,5,0,1,5,0,0,1,2,0,0,1,1,0,0,135,0,75,0,5,2,1,0,1,1,0,0,1,2,0,0,1,5,0,0,1,4,0,0,135,0,76,0,1,2,5,4,1,4,0,0,1,5,0,0,1,2,0,0,1,1,0,0,135,0,77,0,4,5,2,1,1,1,0,0,1,2,0,0,1,5,0,0,1,4,0,0,135,0,78,0,1,2,5,4,1,4,0,0,135,0,79,0,4,0,0,0,1,4,0,0,1,5,0,0,1,2,0,0,135,0,80,0,4,5,2,0,1,2,0,0,1,5,0,0,1,4,0,0,135,0,81,0,2,5,4,0,1,4,0,0,1,5,0,0,1,2,0,0,135,0,82,0,4,5,2,0,1,2,0,0,1,5,0,0,1,4,0,0,135,0,83,0,2,5,4,0,1,4,0,0,1,5,0,0,135,0,84,0,4,5,0,0,1,5,0,0,1,4,0,0,1,2,0,0,135,0,85,0,5,4,2,0,1,2,0,0,1,4,0,0,1,5,0,0,135,0,86,0,2,4,5,0,1,5,0,0,1,4,0,0,1,2,0,0,135,0,87,0,5,4,2,0,1,2,0,0,1,4,0,0,135,0,88,0,2,4,0,0,1,4,0,0,135,0,89,0,4,0,0,0,41,0,0,24,1,4,0,0,135,0,90,0,4,0,0,0,41,0,0,24,1,4,0,0,135,0,91,0,4,0,0,0,41,0,0,24,1,4,0,0,135,0,92,0,4,0,0,0,41,0,0,24,1,4,0,0,135,0,93,0,4,0,0,0,41,0,0,24,1,4,0,0,135,0,94,0,4,0,0,0,41,0,0,24,1,4,0,0,135,0,95,0,4,0,0,0,41,0,0,24,59,4,0,0,145,4,4,0,135,0,96,0,4,0,0,0,1,4,0,0,135,0,97,0,4,0,0,0,1,4,0,0,1,2,0,0,135,0,98,0,4,2,0,0,59,2,0,0,145,2,2,0,59,4,0,0,145,4,4,0,135,0,99,0,2,4,0,0,1,4,0,0,1,2,0,0,1,5,0,0,1,1,0,0,1,3,0,0,1,6,0,0,1,7,0,0,135,0,100,0,4,2,5,1,3,6,7,0,135,0,101,0,1,7,0,0,1,6,0,0,1,3,0,0,1,1,0,0,135,0,102,0,7,6,3,1,59,1,0,0,145,1,1,0,1,3,0,0,135,0,103,0,1,3,0,0,1,3,0,0,1,1,0,0,1,6,0,0,1,7,0,0,135,0,104,0,3,1,6,7,1,7,0,0,1,6,0,0,1,1,0,0,1,3,0,0,1,5,0,0,135,0,105,0,7,6,1,3,5,0,0,0,1,5,0,0,1,3,0,0,1,1,0,0,1,6,0,0,135,0,106,0,5,3,1,6,1,6,0,0,1,1,0,0,1,3,0,0,135,0,107,0,6,1,3,0,1,3,0,0,1,1,0,0,1,6,0,0,1,5,0,0,135,0,108,0,3,1,6,5,1,5,0,0,135,0,109,0,5,0,0,0,1,5,0,0,1,6,0,0,135,0,110,0,5,6,0,0,1,6,0,0,1,5,0,0,1,1,0,0,135,0,111,0,6,5,1,0,1,1,0,0,1,5,0,0,1,6,0,0,1,3,0,0,135,0,112,0,1,5,6,3,1,3,0,0,1,6,0,0,1,5,0,0,1,1,0,0,1,7,0,0,1,2,0,0,1,4,0,0,1,8,0,0,1,9,0,0,135,0,113,0,3,6,5,1,7,2,4,8,9,0,0,0,1,9,0,0,1,8,0,0,59,4,0,0,145,4,4,0,135,0,114,0,9,8,4,0,1,4,0,0,1,8,0,0,1,9,0,0,135,0,115,0,4,8,9,0,1,9,0,0,1,8,0,0,1,4,0,0,135,0,116,0,9,8,4,0,1,4,0,0,1,8,0,0,1,9,0,0,135,0,117,0,4,8,9,0,1,9,0,0,1,8,0,0,1,4,0,0,1,2,0,0,1,7,0,0,1,1,0,0,1,5,0,0,1,6,0,0,1,3,0,0,135,0,118,0,9,8,4,2,7,1,5,6,3,0,0,0,1,3,0,0,59,6,0,0,145,6,6,0,135,0,119,0,3,6,0,0,1,6,0,0,1,3,0,0,1,5,0,0,135,0,120,0,6,3,5,0,1,5,0,0,1,3,0,0,135,0,121,0,5,3,0,0,1,3,0,0,1,5,0,0,1,6,0,0,135,0,122,0,3,5,6,0,1,6,0,0,59,5,0,0,145,5,5,0,59,3,0,0,145,3,3,0,135,0,123,0,6,5,3,0,1,3,0,0,1,5,0,0,1,6,0,0,135,0,124,0,3,5,6,0,1,6,0,0,1,5,0,0,1,3,0,0,135,0,125,0,6,5,3,0,1,3,0,0,1,5,0,0,1,6,0,0,135,0,126,0,3,5,6,0,1,6,0,0,59,5,0,0,145,5,5,0,59,3,0,0,145,3,3,0,59,1,0,0,145,1,1,0,135,0,127,0,6,5,3,1,1,1,0,0,1,3,0,0,1,5,0,0,135,0,128,0,1,3,5,0,1,5,0,0,1,3,0,0,1,1,0,0,1,6,0,0,135,0,129,0,5,3,1,6,1,6,0,0,1,1,0,0,1,3,0,0,135,0,130,0,6,1,3,0,1,3,0,0,1,1,0,0,135,0,131,0,3,1,0,0,1,1,0,0,1,3,0,0,135,0,132,0,1,3,0,0,1,3,0,0,1,1,0,0,135,0,133,0,3,1,0,0,1,1,0,0,135,0,134,0,1,0,0,0,41,0,0,24,1,1,0,0,1,3,0,0,135,0,135,0,1,3,0,0,1,3,0,0,135,0,136,0,3,0,0,0,1,3,0,0,1,1,0,0,135,0,137,0,3,1,0,0,1,1,0,0,1,3,0,0,1,6,0,0,135,0,138,0,1,3,6,0,1,6,0,0,1,3,0,0,1,1,0,0,135,0,139,0,6,3,1,0,1,1,0,0,1,3,0,0,1,6,0,0,135,0,140,0,1,3,6,0,1,6,0,0,1,3,0,0,1,1,0,0,135,0,141,0,6,3,1,0,1,1,0,0,1,3,0,0,1,6,0,0,135,0,142,0,1,3,6,0,1,6,0,0,135,0,143,0,6,0,0,0,1,6,0,0,1,3,0,0,135,0,144,0,6,3,0,0,1,3,0,0,1,6,0,0,135,0,145,0,3,6,0,0,1,6,0,0,135,0,146,0,6,0,0,0,41,0,0,24,1,6,0,0,1,3,0,0,135,0,147,0,6,3,0,0,1,3,0,0,1,6,0,0,1,1,0,0,1,5,0,0,135,0,148,0,3,6,1,5,1,5,0,0,1,1,0,0,1,6,0,0,1,3,0,0,1,7,0,0,135,0,149,0,5,1,6,3,7,0,0,0,1,7,0,0,135,0,150,0,7,0,0,0,1,7,0,0,1,3,0,0,135,0,151,0,7,3,0,0,1,3,0,0,1,7,0,0,1,6,0,0,135,0,152,0,3,7,6,0,1,6,0,0,1,7,0,0,135,0,153,0,6,7,0,0,1,7,0,0,1,6,0,0,135,0,154,0,7,6,0,0,1,6,0,0,1,7,0,0,135,0,155,0,6,7,0,0,1,7,0,0,1,6,0,0,135,0,156,0,7,6,0,0,59,6,0,0,145,6,6,0,59,7,0,0,145,7,7,0,59,3,0,0,145,3,3,0,59,1,0,0,145,1,1,0,135,0,157,0,6,7,3,1,1,1,0,0,135,0,158,0,1,0,0,0,1,1,0,0,1,3,0,0,135,0,159,0,1,3,0,0,1,3,0,0,1,1,0,0,135,0,160,0,3,1,0,0,1,1,0,0,1,3,0,0,1,7,0,0,1,6,0,0,135,0,161,0,1,3,7,6,1,6,0,0,1,7,0,0,1,3,0,0,1,1,0,0,135,0,162,0,6,7,3,1,1,1,0,0,1,3,0,0,1,7,0,0,1,6,0,0,135,0,163,0,1,3,7,6,1,6,0,0,135,0,164,0,6,0,0,0,1,6,0,0,135,0,165,0,6,0,0,0,59,6,0,0,145,6,6,0,59,7,0,0,145,7,7,0,59,3,0,0,145,3,3,0,59,1,0,0,145,1,1,0,135,0,166,0,6,7,3,1,59,1,0,0,145,1,1,0,135,0,167,0,1,0,0,0,1,1,0,0,135,0,168,0,1,0,0,0,1,1,0,0,1,3,0,0,1,7,0,0,1,6,0,0,135,0,169,0,1,3,7,6,1,6,0,0,135,0,170,0,6,0,0,0,1,6,0,0,1,7,0,0,1,3,0,0,1,1,0,0,1,5,0,0,1,2,0,0,1,4,0,0,1,8,0,0,135,0,171,0,6,7,3,1,5,2,4,8,1,8,0,0,1,4,0,0,1,2,0,0,1,5,0,0,1,1,0,0,1,3,0,0,1,7,0,0,1,6,0,0,1,9,0,0,135,0,172,0,8,4,2,5,1,3,7,6,9,0,0,0,1,9,0,0,1,6,0,0,1,7,0,0,1,3,0,0,1,1,0,0,1,5,0,0,1,2,0,0,1,4,0,0,135,0,173,0,9,6,7,3,1,5,2,4,1,4,0,0,1,2,0,0,1,5,0,0,1,1,0,0,1,3,0,0,1,7,0,0,1,6,0,0,1,9,0,0,135,0,174,0,4,2,5,1,3,7,6,9,1,9,0,0,59,6,0,0,145,6,6,0,59,7,0,0,145,7,7,0,59,3,0,0,145,3,3,0,59,1,0,0,145,1,1,0,135,0,175,0,9,6,7,3,1,0,0,0,1,1,0,0,1,3,0,0,1,7,0,0,135,0,176,0,1,3,7,0,1,7,0,0,1,3,0,0,1,1,0,0,1,6,0,0,1,9,0,0,135,0,177,0,7,3,1,6,9,0,0,0,1,9,0,0,1,6,0,0,1,1,0,0,135,0,178,0,9,6,1,0,1,1,0,0,1,6,0,0,1,9,0,0,1,3,0,0,135,0,179,0,1,6,9,3,1,3,0,0,1,9,0,0,1,6,0,0,1,1,0,0,135,0,180,0,3,9,6,1,1,1,0,0,1,6,0,0,1,9,0,0,1,3,0,0,135,0,181,0,1,6,9,3,1,3,0,0,135,0,182,0,3,0,0,0,1,3,0,0,135,0,183,0,3,0,0,0,1,3,0,0,59,9,0,0,145,9,9,0,135,0,184,0,3,9,0,0,1,9,0,0,1,3,0,0,135,0,185,0,9,3,0,0,1,3,0,0,59,9,0,0,145,9,9,0,59,6,0,0,145,6,6,0,135,0,186,0,3,9,6,0,1,6,0,0,1,9,0,0,135,0,187,0,6,9,0,0,1,9,0,0,59,6,0,0,145,6,6,0,59,3,0,0,145,3,3,0,59,1,0,0,145,1,1,0,135,0,188,0,9,6,3,1,1,1,0,0,1,3,0,0,135,0,189,0,1,3,0,0,1,3,0,0,59,1,0,0,145,1,1,0,59,6,0,0,145,6,6,0,59,9,0,0,145,9,9,0,59,7,0,0,145,7,7,0,135,0,190,0,3,1,6,9,7,0,0,0,1,7,0,0,1,9,0,0,135,0,191,0,7,9,0,0,1,9,0,0,1,7,0,0,1,6,0,0,1,1,0,0,1,3,0,0,1,5,0,0,135,0,192,0,9,7,6,1,3,5,0,0,1,5,0,0,1,3,0,0,1,1,0,0,1,6,0,0,135,0,193,0,5,3,1,6,139,0,0,0,140,2,68,0,0,0,0,0,2,62,0,0,173,29,0,0,2,63,0,0,176,29,0,0,2,64,0,0,172,29,0,0,25,48,0,4,82,2,48,0,38,65,2,248,0,34,65,0,3,26,0,34,1,65,192,118,82,3,65,0,38,65,2,3,0,35,65,0,33,65,35,1,18,66,3,0,19,65,65,66,16,66,0,26,19,65,65,66,120,65,2,0,135,65,9,0,25,51,26,4,82,9,51,0,38,65,9,1,120,65,2,0,135,65,9,0,120,35,19,0,1,65,0,1,48,65,1,65,104,36,1,0,1,54,0,0,139,54,0,0,25,65,1,4,50,65,65,34,148,36,1,0,4,65,34,1,1,66,144,120,82,66,66,0,41,66,66,1,50,65,65,66,148,36,1,0,0,54,0,0,139,54,0,0,1,54,0,0,139,54,0,0,50,65,1,34,244,36,1,0,4,58,34,1,37,65,58,15,121,65,3,0,0,54,0,0,139,54,0,0,3,27,0,1,38,65,2,1,20,65,65,1,39,65,65,2,85,48,65,0,39,66,58,3,109,27,4,66,82,66,51,0,39,66,66,1,85,51,66,0,134,66,0,0,156,121,0,0,27,58,0,0,0,54,0,0,139,54,0,0,1,66,200,118,82,66,66,0,45,66,66,26,88,37,1,0,1,66,188,118,82,66,66,0,3,25,66,34,4,60,25,1,3,29,0,1,50,66,25,1,40,37,1,0,1,54,0,0,139,54,0,0,38,66,2,1,20,66,66,1,39,66,66,2,85,48,66,0,39,65,60,1,109,29,4,65,1,65,200,118,85,65,29,0,1,65,188,118,85,65,60,0,0,54,0,0,139,54,0,0,1,65,196,118,82,65,65,0,45,65,65,26,24,38,1,0,1,65,184,118,82,65,65,0,3,33,65,34,48,65,33,1,132,37,1,0,1,54,0,0,139,54,0,0,4,61,33,1,1,65,15,0,48,65,65,61,212,37,1,0,3,30,0,1,3,31,0,33,38,65,2,1,20,65,65,1,39,65,65,2,85,48,65,0,39,66,61,1,109,30,4,66,85,31,61,0,25,52,31,4,82,66,52,0,38,66,66,254,85,52,66,0,0,56,30,0,0,57,61,0,119,0,12,0,38,66,2,1,20,66,66,33,39,66,66,2,85,48,66,0,3,66,0,33,25,53,66,4,82,66,53,0,39,66,66,1,85,53,66,0,1,56,0,0,1,57,0,0,1,66,184,118,85,66,57,0,1,66,196,118,85,66,56,0,0,54,0,0,139,54,0,0,38,66,9,2,121,66,3,0,1,54,0,0,139,54,0,0,38,66,9,248,3,32,66,34,48,66,32,1,64,38,1,0,1,54,0,0,139,54,0,0,4,59,32,1,43,66,9,3,0,55,66,0,1,66,0,1,48,66,9,66,4,39,1,0,106,4,26,8,106,5,26,12,1,66,216,118,41,65,55,1,41,65,65,2,3,36,66,65,46,65,4,36,148,38,1,0,48,65,4,3,132,38,1,0,135,65,9,0,106,65,4,12,46,65,65,26,148,38,1,0,135,65,9,0,45,65,5,4,192,38,1,0,1,65,176,118,1,66,176,118,82,66,66,0,1,67,1,0,22,67,67,55,11,67,67,0,19,66,66,67,85,65,66,0,119,0,141,0,45,66,5,36,208,38,1,0,25,46,5,8,119,0,11,0,48,66,5,3,220,38,1,0,135,66,9,0,25,45,5,8,82,66,45,0,45,66,66,26,244,38,1,0,0,46,45,0,119,0,2,0,135,66,9,0,109,4,12,5,85,46,4,0,119,0,124,0,106,6,26,24,106,7,26,12,45,66,7,26,172,39,1,0,25,43,26,16,25,37,43,4,82,10,37,0,120,10,8,0,82,11,43,0,120,11,3,0,1,21,0,0,119,0,49,0,0,20,11,0,0,24,43,0,119,0,3,0,0,20,10,0,0,24,37,0,0,18,20,0,0,22,24,0,25,38,18,20,82,12,38,0,120,12,8,0,25,39,18,16,82,13,39,0,120,13,2,0,119,0,9,0,0,19,13,0,0,23,39,0,119,0,3,0,0,19,12,0,0,23,38,0,0,18,19,0,0,22,23,0,119,0,242,255,48,66,22,3,156,39,1,0,135,66,9,0,119,0,23,0,1,66,0,0,85,22,66,0,0,21,18,0,119,0,19,0,106,8,26,8,48,66,8,3,188,39,1,0,135,66,9,0,25,42,8,12,82,66,42,0,46,66,66,26,208,39,1,0,135,66,9,0,25,47,7,8,82,66,47,0,45,66,66,26,240,39,1,0,85,42,7,0,85,47,8,0,0,21,7,0,119,0,2,0,135,66,9,0,121,6,63,0,106,14,26,28,1,66,224,119,41,65,14,2,3,40,66,65,82,65,40,0,45,65,65,26,64,40,1,0,85,40,21,0,120,21,27,0,1,65,180,118,1,66,180,118,82,66,66,0,1,67,1,0,22,67,67,14,11,67,67,0,19,66,66,67,85,65,66,0,119,0,45,0,1,66,192,118,82,66,66,0,48,66,6,66,88,40,1,0,135,66,9,0,119,0,12,0,25,41,6,16,82,65,41,0,45,65,65,26,112,40,1,0,0,66,41,0,119,0,3,0,25,65,6,20,0,66,65,0,85,66,21,0,120,21,2,0,119,0,28,0,1,66,192,118,82,15,66,0,48,66,21,15,152,40,1,0,135,66,9,0,109,21,24,6,25,44,26,16,82,16,44,0,121,16,8,0,48,66,16,15,184,40,1,0,135,66,9,0,119,0,4,0,109,21,16,16,109,16,24,21,119,0,1,0,106,17,44,4,121,17,10,0,1,66,192,118,82,66,66,0,48,66,17,66,228,40,1,0,135,66,9,0,119,0,4,0,109,21,20,17,109,17,24,21,119,0,1,0,35,66,59,16,121,66,13,0,38,66,2,1,20,66,66,32,39,66,66,2,85,48,66,0,3,66,0,32,25,49,66,4,82,66,49,0,39,66,66,1,85,49,66,0,0,54,0,0,139,54,0,0,119,0,18,0,3,28,0,1,38,66,2,1,20,66,66,1,39,66,66,2,85,48,66,0,39,65,59,3,109,28,4,65,3,65,0,32,25,50,65,4,82,65,50,0,39,65,65,1,85,50,65,0,134,65,0,0,156,121,0,0,28,59,0,0,0,54,0,0,139,54,0,0,1,65,0,0,139,65,0,0,140,6,53,0,0,0,0,0,136,49,0,0,0,45,49,0,136,49,0,0,1,50,176,0,3,49,49,50,137,49,0,0,130,49,0,0,136,50,0,0,49,49,49,50,176,41,1,0,1,50,176,0,135,49,0,0,50,0,0,0,1,49,128,0,3,43,45,49,25,7,45,120,25,35,45,104,25,20,45,88,25,42,45,68,25,38,45,64,25,28,45,60,25,37,45,56,25,31,45,52,25,40,45,48,25,39,45,44,25,36,45,40,25,29,45,36,25,22,45,32,25,21,45,28,25,30,45,24,25,34,45,8,0,6,45,0,85,38,1,0,89,28,3,0,89,37,4,0,82,50,38,0,135,49,16,0,50,0,0,0,85,31,49,0,1,49,0,0,85,40,49,0,59,49,0,0,145,49,49,0,89,39,49,0,88,8,28,0,145,8,8,0,82,50,0,0,76,50,50,0,145,50,50,0,66,49,8,50,145,49,49,0,89,36,49,0,1,49,0,0,85,29,49,0,82,49,31,0,82,50,29,0,56,49,49,50,224,45,1,0,1,49,0,0,85,22,49,0,82,50,38,0,82,51,29,0,3,50,50,51,134,49,0,0,108,90,1,0,50,22,0,0,85,21,49,0,82,14,21,0,0,44,43,0,0,46,0,0,25,47,44,36,116,44,46,0,25,44,44,4,25,46,46,4,54,49,44,47,152,42,1,0,134,49,0,0,60,65,2,0,43,14,0,0,85,30,49,0,82,49,21,0,32,49,49,63,121,49,3,0,1,49,1,0,85,22,49,0,82,49,21,0,32,49,49,10,121,49,18,0,82,48,0,0,28,49,48,2,3,23,48,49,76,49,23,0,145,23,49,0,88,50,36,0,145,50,50,0,65,49,23,50,145,49,49,0,75,24,49,0,82,49,40,0,3,49,49,24,85,40,49,0,59,49,0,0,145,49,49,0,89,39,49,0,119,0,168,0,82,49,21,0,33,49,49,32,82,50,21,0,33,50,50,9,19,49,49,50,121,49,115,0,88,9,2,0,145,9,9,0,88,49,39,0,145,49,49,0,63,15,9,49,145,15,15,0,106,49,0,32,82,50,30,0,27,50,50,36,3,49,49,50,106,25,49,4,76,49,25,0,145,25,49,0,88,51,36,0,145,51,51,0,65,50,25,51,145,50,50,0,63,49,15,50,145,49,49,0,89,34,49,0,112,10,2,4,145,10,10,0,82,49,40,0,76,49,49,0,145,49,49,0,63,16,10,49,145,16,16,0,106,49,0,32,82,50,30,0,27,50,50,36,3,49,49,50,106,26,49,8,76,49,26,0,145,26,49,0,88,52,36,0,145,52,52,0,65,51,26,52,145,51,51,0,63,50,16,51,145,50,50,0,113,34,4,50,106,50,0,28,82,49,30,0,41,49,49,4,3,50,50,49,112,11,50,8,145,11,11,0,88,51,36,0,145,51,51,0,65,49,11,51,145,49,49,0,113,34,8,49,106,49,0,28,82,50,30,0,41,50,50,4,3,49,49,50,112,12,49,12,145,12,12,0,88,51,36,0,145,51,51,0,65,50,12,51,145,50,50,0,113,34,12,50,25,41,0,8,106,50,0,28,82,49,30,0,41,49,49,4,3,19,50,49,59,49,0,0,145,49,49,0,89,6,49,0,59,50,0,0,145,50,50,0,113,6,4,50,116,42,41,0,106,49,41,4,109,42,4,49,106,50,41,8,109,42,8,50,106,49,41,12,109,42,12,49,106,50,41,16,109,42,16,50,116,20,19,0,106,49,19,4,109,20,4,49,106,50,19,8,109,20,8,50,106,49,19,12,109,20,12,49,116,35,34,0,106,50,34,4,109,35,4,50,106,49,34,8,109,35,8,49,106,50,34,12,109,35,12,50,116,7,6,0,106,49,6,4,109,7,4,49,78,49,5,0,83,43,49,0,102,50,5,1,107,43,1,50,102,49,5,2,107,43,2,49,102,50,5,3,107,43,3,50,59,49,0,0,145,49,49,0,134,50,0,0,140,109,1,0,42,20,35,7,49,43,0,0,106,50,0,32,82,49,30,0,27,49,49,36,3,50,50,49,106,50,50,12,120,50,21,0,106,50,0,28,82,49,30,0,41,49,49,4,3,50,50,49,112,13,50,8,145,13,13,0,88,50,36,0,145,50,50,0,65,32,13,50,145,32,32,0,88,50,37,0,145,50,50,0,63,17,32,50,145,17,17,0,88,49,39,0,145,49,49,0,63,50,49,17,145,50,50,0,89,39,50,0,119,0,22,0,106,50,0,32,82,49,30,0,27,49,49,36,3,50,50,49,106,27,50,12,76,50,27,0,145,27,50,0,88,50,36,0,145,50,50,0,65,33,27,50,145,33,33,0,88,50,37,0,145,50,50,0,63,18,33,50,145,18,18,0,88,49,39,0,145,49,49,0,63,50,49,18,145,50,50,0,89,39,50,0,119,0,1,0,82,50,29,0,82,49,22,0,26,49,49,1,3,50,50,49,85,29,50,0,82,50,29,0,25,50,50,1,85,29,50,0,119,0,30,255,137,45,0,0,139,0,0,0,140,1,66,0,0,0,0,0,136,61,0,0,0,48,61,0,136,61,0,0,25,61,61,16,137,61,0,0,130,61,0,0,136,62,0,0,49,61,61,62,32,46,1,0,1,62,16,0,135,61,0,0,62,0,0,0,25,35,48,8,25,43,48,4,0,31,48,0,85,35,0,0,82,49,35,0,106,62,49,80,112,63,49,56,145,63,63,0,134,61,0,0,20,137,2,0,62,63,0,0,85,43,61,0,82,50,35,0,106,63,50,84,112,62,50,60,145,62,62,0,134,61,0,0,44,28,2,0,63,62,0,0,85,31,61,0,82,61,35,0,112,19,61,56,145,19,19,0,82,51,35,0,106,61,51,80,106,62,51,4,106,63,51,20,134,27,0,0,236,40,2,0,19,61,62,63,82,63,35,0,1,62,152,0,97,63,62,27,82,62,35,0,112,1,62,60,145,1,1,0,82,52,35,0,106,62,52,84,106,63,52,8,106,61,52,24,134,28,0,0,236,40,2,0,1,62,63,61,82,61,35,0,1,63,156,0,97,61,63,28,82,63,35,0,1,61,164,0,82,62,31,0,25,62,62,1,97,63,61,62,82,53,35,0,1,62,188,0,1,61,152,0,94,61,53,61,41,61,61,3,97,53,62,61,82,62,35,0,134,61,0,0,252,137,2,0,62,0,0,0,41,61,61,2,0,36,61,0,82,61,35,0,1,62,192,0,97,61,62,36,82,54,35,0,1,62,196,0,1,61,156,0,94,61,54,61,41,61,61,3,97,54,62,61,82,62,35,0,134,61,0,0,112,138,2,0,62,0,0,0,41,61,61,2,0,37,61,0,82,61,35,0,1,62,200,0,97,61,62,37,82,55,35,0,106,61,55,4,82,63,43,0,41,63,63,1,3,61,61,63,106,63,55,64,5,62,61,63,41,62,62,2,0,38,62,0,82,62,35,0,1,63,204,0,97,62,63,38,82,56,35,0,106,62,56,20,106,61,56,64,5,63,62,61,41,63,63,2,0,39,63,0,82,63,35,0,1,61,208,0,97,63,61,39,82,57,35,0,106,61,57,20,106,63,57,64,5,40,61,63,82,61,35,0,1,62,164,0,94,61,61,62,5,63,40,61,41,63,63,2,0,41,63,0,82,63,35,0,1,61,212,0,97,63,61,41,82,58,35,0,106,63,58,20,106,62,58,64,5,61,63,62,41,61,61,2,0,42,61,0,82,61,35,0,1,62,216,0,97,61,62,42,82,62,35,0,106,62,62,80,120,62,7,0,1,61,14,58,1,63,90,48,1,64,217,8,1,65,43,58,135,62,4,0,61,63,64,65,1,62,6,0,82,65,35,0,106,65,65,80,50,62,62,65,96,48,1,0,1,65,186,48,1,64,90,48,1,63,218,8,1,61,43,58,135,62,4,0,65,64,63,61,82,62,35,0,106,62,62,84,120,62,7,0,1,61,67,58,1,63,90,48,1,64,219,8,1,65,43,58,135,62,4,0,61,63,64,65,1,62,6,0,82,65,35,0,106,65,65,84,50,62,62,65,176,48,1,0,1,65,31,49,1,64,90,48,1,63,220,8,1,61,43,58,135,62,4,0,65,64,63,61,82,61,35,0,134,62,0,0,212,145,2,0,61,0,0,0,33,45,62,0,82,2,35,0,121,45,47,0,1,62,208,0,1,61,0,0,97,2,62,61,82,59,35,0,0,3,59,0,1,61,188,0,3,34,3,61,82,4,34,0,0,5,59,0,1,61,192,0,3,33,5,61,82,6,33,0,3,20,4,6,0,7,59,0,1,61,196,0,3,47,7,61,82,8,47,0,3,21,20,8,0,9,59,0,1,61,200,0,3,46,9,61,82,10,46,0,3,22,21,10,0,11,59,0,1,61,204,0,3,29,11,61,82,12,29,0,3,23,22,12,0,13,59,0,1,61,208,0,3,32,13,61,82,14,32,0,3,24,23,14,0,15,59,0,1,61,212,0,3,44,15,61,82,16,44,0,3,25,24,16,0,17,59,0,1,61,216,0,3,30,17,61,82,18,30,0,3,26,25,18,137,48,0,0,139,26,0,0,119,0,46,0,1,61,216,0,1,62,0,0,97,2,61,62,82,60,35,0,0,3,60,0,1,62,188,0,3,34,3,62,82,4,34,0,0,5,60,0,1,62,192,0,3,33,5,62,82,6,33,0,3,20,4,6,0,7,60,0,1,62,196,0,3,47,7,62,82,8,47,0,3,21,20,8,0,9,60,0,1,62,200,0,3,46,9,62,82,10,46,0,3,22,21,10,0,11,60,0,1,62,204,0,3,29,11,62,82,12,29,0,3,23,22,12,0,13,60,0,1,62,208,0,3,32,13,62,82,14,32,0,3,24,23,14,0,15,60,0,1,62,212,0,3,44,15,62,82,16,44,0,3,25,24,16,0,17,60,0,1,62,216,0,3,30,17,62,82,18,30,0,3,26,25,18,137,48,0,0,139,26,0,0,1,62,0,0,139,62,0,0,140,2,45,0,0,0,0,0,2,34,0,0,2,32,2,0,2,35,0,0,3,32,2,0,2,36,0,0,98,29,0,0,2,37,0,0,101,29,0,0,1,30,0,0,136,38,0,0,0,31,38,0,136,38,0,0,1,39,176,0,3,38,38,39,137,38,0,0,130,38,0,0,136,39,0,0,49,38,38,39,160,50,1,0,1,39,176,0,135,38,0,0,39,0,0,0,25,3,31,56,25,24,31,48,25,23,31,40,25,27,31,32,25,26,31,24,25,25,31,16,25,22,31,8,0,21,31,0,1,38,164,0,3,19,31,38,1,38,156,0,3,28,31,38,1,38,152,0,3,16,31,38,25,20,31,88,25,13,31,80,25,18,31,76,25,17,31,72,25,15,31,68,25,14,31,64,1,38,160,0,3,2,31,38,85,28,0,0,85,16,1,0,1,38,148,117,82,39,28,0,85,38,39,0,1,39,152,117,82,38,16,0,85,39,38,0,134,38,0,0,244,119,2,0,20,0,0,0,1,29,156,117,0,32,20,0,25,33,29,64,116,29,32,0,25,29,29,4,25,32,32,4,54,38,29,33,48,51,1,0,1,39,1,0,135,38,194,0,39,0,0,0,135,38,195,0,120,38,13,0,1,39,4,0,1,40,205,44,134,38,0,0,216,31,2,0,39,40,21,0,1,38,0,0,83,19,38,0,78,4,19,0,38,38,4,1,0,12,38,0,137,31,0,0,139,12,0,0,1,38,220,117,1,40,148,117,82,40,40,0,85,38,40,0,1,40,224,117,1,38,152,117,82,38,38,0,85,40,38,0,135,38,196,0,1,38,0,0,121,38,7,0,2,40,0,0,4,0,2,0,1,39,0,0,135,38,197,0,40,39,0,0,119,0,6,0,2,39,0,0,4,0,2,0,1,40,1,0,135,38,197,0,39,40,0,0,1,38,0,0,121,38,7,0,2,40,0,0,3,0,2,0,1,39,1,0,135,38,197,0,40,39,0,0,119,0,6,0,2,39,0,0,3,0,2,0,1,40,0,0,135,38,197,0,39,40,0,0,1,38,0,0,121,38,7,0,2,40,0,0,5,0,2,0,1,39,0,0,135,38,197,0,40,39,0,0,119,0,6,0,2,39,0,0,5,0,2,0,1,40,1,0,135,38,197,0,39,40,0,0,1,38,0,0,121,38,6,0,2,40,0,0,13,16,2,0,1,39,4,0,135,38,197,0,40,39,0,0,134,38,0,0,204,162,2,0,32,38,38,2,121,38,8,0,1,39,2,0,135,38,197,0,34,39,0,0,1,39,1,0,135,38,197,0,35,39,0,0,119,0,45,0,134,38,0,0,204,162,2,0,32,38,38,3,121,38,19,0,1,39,3,0,135,38,197,0,34,39,0,0,1,39,3,0,135,38,197,0,35,39,0,0,2,39,0,0,8,32,2,0,2,40,0,0,1,32,3,0,135,38,197,0,39,40,0,0,2,40,0,0,6,32,2,0,1,39,0,0,135,38,197,0,40,39,0,0,119,0,23,0,134,38,0,0,204,162,2,0,32,38,38,4,121,38,19,0,1,39,2,0,135,38,197,0,34,39,0,0,1,39,0,0,135,38,197,0,35,39,0,0,2,39,0,0,1,32,2,0,2,40,0,0,2,0,3,0,135,38,197,0,39,40,0,0,2,40,0,0,11,32,2,0,2,39,0,0,1,96,3,0,135,38,197,0,40,39,0,0,1,38,0,0,121,38,115,0,1,38,228,117,1,39,220,117,82,39,39,0,28,39,39,2,1,40,148,117,82,40,40,0,28,40,40,2,4,39,39,40,85,38,39,0,1,39,232,117,1,38,224,117,82,38,38,0,28,38,38,2,1,40,152,117,82,40,40,0,28,40,40,2,4,38,38,40,85,39,38,0,1,38,228,117,82,38,38,0,34,38,38,0,121,38,4,0,1,38,228,117,1,39,0,0,85,38,39,0,1,39,232,117,82,39,39,0,34,39,39,0,121,39,4,0,1,39,232,117,1,38,0,0,85,39,38,0,1,38,0,0,85,13,38,0,135,39,198,0,135,38,199,0,39,13,0,0,85,18,38,0,1,38,0,0,85,17,38,0,82,38,13,0,82,39,17,0,56,38,38,39,84,54,1,0,1,38,148,117,82,38,38,0,82,39,18,0,82,40,17,0,27,40,40,24,94,39,39,40,49,38,38,39,68,54,1,0,1,38,152,117,82,38,38,0,82,39,18,0,82,40,17,0,27,40,40,24,3,39,39,40,106,39,39,4,49,38,38,39,68,54,1,0,1,30,29,0,119,0,5,0,82,38,17,0,25,38,38,1,85,17,38,0,119,0,230,255,32,38,30,29,121,38,14,0,1,38,220,117,82,39,18,0,82,40,17,0,27,40,40,24,94,39,39,40,85,38,39,0,1,39,224,117,82,38,18,0,82,40,17,0,27,40,40,24,3,38,38,40,106,38,38,4,85,39,38,0,1,38,224,117,82,5,38,0,1,38,220,117,82,38,38,0,85,22,38,0,109,22,4,5,1,39,4,0,1,40,231,44,134,38,0,0,216,31,2,0,39,40,22,0,1,40,220,117,82,40,40,0,1,39,224,117,82,39,39,0,134,38,0,0,8,117,1,0,40,39,0,0,1,38,220,117,82,6,38,0,1,38,224,117,82,7,38,0,1,38,144,117,82,8,38,0,1,38,136,117,135,40,198,0,1,41,0,0,135,39,200,0,6,7,8,40,41,0,0,0,85,38,39,0,119,0,25,0,1,39,136,117,1,41,148,117,82,41,41,0,1,40,152,117,82,40,40,0,1,42,144,117,82,42,42,0,1,43,0,0,1,44,0,0,135,38,200,0,41,40,42,43,44,0,0,0,85,39,38,0,1,38,136,117,82,38,38,0,121,38,9,0,1,38,236,117,1,39,148,117,82,39,39,0,85,38,39,0,1,39,240,117,1,38,152,117,82,38,38,0,85,39,38,0,1,38,136,117,82,38,38,0,120,38,14,0,135,38,201,0,1,39,4,0,1,44,13,45,134,38,0,0,216,31,2,0,39,44,25,0,1,38,0,0,83,19,38,0,78,4,19,0,38,38,4,1,0,12,38,0,137,31,0,0,139,12,0,0,1,44,3,0,1,39,46,45,134,38,0,0,216,31,2,0,44,39,26,0,1,38,240,117,82,9,38,0,1,38,236,117,82,38,38,0,85,27,38,0,109,27,4,9,1,39,3,0,1,44,86,45,134,38,0,0,216,31,2,0,39,44,27,0,1,38,152,117,82,10,38,0,1,38,148,117,82,38,38,0,85,23,38,0,109,23,4,10,1,44,3,0,1,39,107,45,134,38,0,0,216,31,2,0,44,39,23,0,1,38,248,117,82,11,38,0,1,38,244,117,82,38,38,0,85,3,38,0,109,3,4,11,1,39,3,0,1,44,128,45,134,38,0,0,216,31,2,0,39,44,3,0,1,44,136,117,82,44,44,0,1,39,1,0,135,38,202,0,44,39,0,0,1,39,136,117,82,39,39,0,1,44,2,0,135,38,203,0,39,44,0,0,1,44,136,117,82,44,44,0,1,39,1,0,135,38,204,0,44,39,0,0,1,39,136,117,82,39,39,0,1,44,1,0,135,38,205,0,39,44,0,0,1,44,136,117,82,44,44,0,1,39,1,0,135,38,206,0,44,39,0,0,1,39,136,117,82,39,39,0,1,44,3,0,135,38,207,0,39,44,0,0,1,44,136,117,82,44,44,0,1,39,2,0,135,38,208,0,44,39,0,0,1,39,136,117,82,39,39,0,1,44,4,0,135,38,209,0,39,44,0,0,1,44,136,117,82,44,44,0,1,39,2,0,135,38,210,0,44,39,0,0,1,39,136,117,82,39,39,0,135,38,211,0,39,0,0,0,1,38,0,0,121,38,9,0,1,39,1,0,135,38,212,0,39,0,0,0,1,39,3,0,1,44,153,45,134,38,0,0,216,31,2,0,39,44,24,0,1,44,148,117,82,44,44,0,1,39,152,117,82,39,39,0,134,38,0,0,104,229,0,0,44,39,0,0,1,38,236,117,82,38,38,0,85,15,38,0,1,38,240,117,82,38,38,0,85,14,38,0,82,39,15,0,82,44,14,0,134,38,0,0,140,113,2,0,39,44,0,0,1,38,245,255,83,2,38,0,1,44,245,255,107,2,1,44,1,38,245,255,107,2,2,38,1,44,255,255,107,2,3,44,78,44,2,0,83,3,44,0,102,38,2,1,107,3,1,38,102,44,2,2,107,3,2,44,102,38,2,3,107,3,3,38,134,38,0,0,84,153,2,0,3,0,0,0,1,38,1,0,83,19,38,0,78,4,19,0,38,38,4,1,0,12,38,0,137,31,0,0,139,12,0,0,140,0,31,0,0,0,0,0,2,21,0,0,245,28,0,0,2,22,0,0,250,28,0,0,2,23,0,0,247,28,0,0,1,15,0,0,136,24,0,0,0,16,24,0,136,24,0,0,1,25,160,1,3,24,24,25,137,24,0,0,130,24,0,0,136,25,0,0,49,24,24,25,60,58,1,0,1,25,160,1,135,24,0,0,25,0,0,0,1,24,88,1,3,8,16,24,1,24,216,0,3,11,16,24,1,24,24,1,3,10,16,24,1,24,152,0,3,9,16,24,1,24,148,0,3,3,16,24,1,24,144,0,3,2,16,24,25,7,16,80,25,12,16,16,25,13,16,8,25,4,16,4,0,5,16,0,0,14,10,0,1,17,12,115,25,18,14,64,116,14,17,0,25,14,14,4,25,17,17,4,54,24,14,18,140,58,1,0,0,14,9,0,1,17,80,115,25,18,14,64,116,14,17,0,25,14,14,4,25,17,17,4,54,24,14,18,172,58,1,0,1,24,1,0,85,3,24,0,1,25,0,0,1,26,2,0,1,27,1,0,125,24,25,26,27,0,0,0,85,3,24,0,1,24,0,0,85,2,24,0,82,24,3,0,82,27,2,0,56,24,24,27,224,63,1,0,82,24,3,0,32,24,24,2,121,24,21,0,82,0,2,0,0,14,11,0,0,17,10,0,25,18,14,64,116,14,17,0,25,14,14,4,25,17,17,4,54,24,14,18,20,59,1,0,0,14,8,0,0,17,9,0,25,18,14,64,116,14,17,0,25,14,14,4,25,17,17,4,54,24,14,18,52,59,1,0,134,24,0,0,216,177,1,0,0,11,8,0,1,24,0,0,1,27,192,81,1,26,220,115,82,26,26,0,27,26,26,48,94,27,27,26,47,24,24,27,156,63,1,0,1,27,228,115,82,27,27,0,135,24,213,0,27,0,0,0,0,14,11,0,1,17,80,115,25,18,14,64,116,14,17,0,25,14,14,4,25,17,17,4,54,24,14,18,144,59,1,0,0,14,8,0,1,17,12,115,25,18,14,64,116,14,17,0,25,14,14,4,25,17,17,4,54,24,14,18,176,59,1,0,134,24,0,0,28,176,0,0,7,11,8,0,1,24,232,115,82,24,24,0,106,1,24,24,0,14,8,0,0,17,7,0,25,18,14,64,116,14,17,0,25,14,14,4,25,17,17,4,54,24,14,18,232,59,1,0,134,24,0,0,116,1,2,0,12,8,0,0,1,27,1,0,1,26,0,0,135,24,214,0,1,27,26,12,1,26,232,115,82,26,26,0,106,26,26,44,59,27,1,0,59,25,1,0,59,28,1,0,59,29,1,0,135,24,215,0,26,27,25,28,29,0,0,0,1,29,232,115,82,29,29,0,106,29,29,56,1,28,0,0,135,24,216,0,29,28,0,0,1,24,0,0,85,13,24,0,1,24,161,120,78,24,24,0,38,24,24,1,121,24,13,0,1,28,236,115,82,28,28,0,38,28,28,31,1,29,192,81,1,25,220,115,82,25,25,0,27,25,25,48,3,29,29,25,106,29,29,28,135,24,217,0,28,29,0,0,119,0,92,0,2,28,0,0,146,136,0,0,1,29,192,81,1,25,220,115,82,25,25,0,27,25,25,48,3,29,29,25,106,29,29,32,135,24,218,0,28,29,0,0,1,29,232,115,82,29,29,0,82,29,29,0,1,28,3,0,1,25,6,20,1,27,0,0,1,26,0,0,1,30,0,0,135,24,219,0,29,28,25,27,26,30,0,0,1,30,232,115,82,30,30,0,82,30,30,0,135,24,220,0,30,0,0,0,2,30,0,0,146,136,0,0,1,26,192,81,1,27,220,115,82,27,27,0,27,27,27,48,3,26,26,27,25,26,26,32,106,26,26,4,135,24,218,0,30,26,0,0,1,26,232,115,82,26,26,0,106,26,26,4,1,30,2,0,1,27,6,20,1,25,0,0,1,28,0,0,1,29,0,0,135,24,219,0,26,30,27,25,28,29,0,0,1,29,232,115,82,29,29,0,106,29,29,4,135,24,220,0,29,0,0,0,2,29,0,0,146,136,0,0,1,28,192,81,1,25,220,115,82,25,25,0,27,25,25,48,3,28,28,25,25,28,28,32,106,28,28,8,135,24,218,0,29,28,0,0,1,28,232,115,82,28,28,0,106,28,28,20,1,29,4,0,1,25,1,20,1,27,1,0,1,30,0,0,1,26,0,0,135,24,219,0,28,29,25,27,30,26,0,0,1,26,232,115,82,26,26,0,106,26,26,20,135,24,220,0,26,0,0,0,2,26,0,0,147,136,0,0,1,30,192,81,1,27,220,115,82,27,27,0,27,27,27,48,3,30,30,27,25,30,30,32,106,30,30,12,135,24,218,0,26,30,0,0,2,30,0,0,192,132,0,0,135,24,221,0,30,0,0,0,1,24,0,0,85,4,24,0,1,24,216,115,82,24,24,0,82,30,4,0,56,24,24,30,84,63,1,0,1,30,225,13,1,26,212,115,82,26,26,0,82,27,4,0,41,27,27,4,3,26,26,27,106,26,26,12,135,24,222,0,30,26,0,0,1,24,212,115,82,24,24,0,82,26,4,0,41,26,26,4,94,24,24,26,32,24,24,1,121,24,3,0,1,15,13,0,119,0,26,0,1,24,212,115,82,24,24,0,82,26,4,0,41,26,26,4,94,24,24,26,32,24,24,4,121,24,3,0,1,15,13,0,119,0,17,0,1,26,4,0,1,30,212,115,82,30,30,0,82,27,4,0,41,27,27,4,3,30,30,27,106,30,30,4,28,30,30,4,27,30,30,6,1,27,3,20,82,25,13,0,41,25,25,1,29,25,25,4,27,25,25,6,135,24,223,0,26,30,27,25,32,24,15,13,121,24,12,0,1,15,0,0,1,24,212,115,82,24,24,0,82,25,4,0,41,25,25,4,3,20,24,25,82,24,20,0,82,27,13,0,106,30,20,4,135,25,224,0,24,27,30,0,1,25,212,115,82,25,25,0,82,30,4,0,41,30,30,4,3,19,25,30,82,30,13,0,106,25,19,4,106,27,19,8,3,25,25,27,3,30,30,25,85,13,30,0,82,30,4,0,25,30,30,1,85,4,30,0,119,0,181,255,1,30,161,120,78,30,30,0,38,30,30,1,120,30,11,0,2,25,0,0,146,136,0,0,1,27,0,0,135,30,218,0,25,27,0,0,2,27,0,0,147,136,0,0,1,25,0,0,135,30,218,0,27,25,0,0,1,25,225,13,1,27,0,0,135,30,222,0,25,27,0,0,1,30,161,120,78,30,30,0,38,30,30,1,121,30,7,0,1,27,236,115,82,27,27,0,38,27,27,31,1,25,0,0,135,30,217,0,27,25,0,0,1,27,0,0,135,30,213,0,27,0,0,0,82,30,2,0,25,30,30,1,85,2,30,0,119,0,195,254,1,30,192,81,1,27,220,115,82,27,27,0,27,27,27,48,1,25,0,0,97,30,27,25,1,25,192,81,1,27,220,115], eb + 71680);
  HEAPU8.set([82,27,27,0,27,27,27,48,3,25,25,27,1,27,0,0,109,25,4,27,1,27,192,81,1,25,220,115,82,25,25,0,27,25,25,48,3,27,27,25,1,25,0,0,109,27,8,25,1,25,148,29,59,27,255,255,145,27,27,0,89,25,27,0,1,14,12,115,0,17,10,0,25,18,14,64,116,14,17,0,25,14,14,4,25,17,17,4,54,27,14,18,76,64,1,0,1,14,80,115,0,17,9,0,25,18,14,64,116,14,17,0,25,14,14,4,25,17,17,4,54,27,14,18,108,64,1,0,1,27,0,0,85,5,27,0,1,27,0,1,82,25,5,0,56,27,27,25,252,64,1,0,1,27,212,115,82,27,27,0,82,25,5,0,41,25,25,4,1,30,7,0,97,27,25,30,1,30,212,115,82,30,30,0,82,25,5,0,41,25,25,4,3,30,30,25,1,25,0,0,109,30,4,25,1,25,212,115,82,25,25,0,82,30,5,0,41,30,30,4,3,25,25,30,1,30,224,115,82,30,30,0,109,25,12,30,82,30,5,0,25,30,30,1,85,5,30,0,119,0,228,255,1,30,216,115,1,25,1,0,85,30,25,0,1,25,220,115,82,25,25,0,25,6,25,1,1,25,220,115,85,25,6,0,1,25,220,115,1,27,1,0,1,24,220,115,82,24,24,0,17,27,27,24,1,24,0,0,125,30,27,24,6,0,0,0,85,25,30,0,137,16,0,0,139,0,0,0,140,1,35,0,0,0,0,0,136,31,0,0,0,29,31,0,136,31,0,0,1,32,160,0,3,31,31,32,137,31,0,0,130,31,0,0,136,32,0,0,49,31,31,32,132,65,1,0,1,32,160,0,135,31,0,0,32,0,0,0,25,13,29,80,25,26,29,72,25,25,29,48,25,24,29,40,25,23,29,32,25,28,29,24,25,27,29,16,0,22,29,0,1,31,148,0,3,14,29,31,1,31,144,0,3,15,29,31,1,31,140,0,3,18,29,31,1,31,136,0,3,16,29,31,1,31,132,0,3,17,29,31,1,31,128,0,3,21,29,31,25,20,29,124,25,12,29,104,25,11,29,100,85,14,0,0,82,31,14,0,82,31,31,0,120,31,3,0,137,29,0,0,139,0,0,0,82,31,14,0,106,31,31,4,120,31,3,0,137,29,0,0,139,0,0,0,82,31,14,0,106,31,31,8,120,31,3,0,137,29,0,0,139,0,0,0,1,31,1,0,85,15,31,0,82,31,14,0,25,31,31,4,116,18,31,0,82,31,14,0,25,31,31,8,116,16,31,0,82,32,18,0,82,33,16,0,82,34,14,0,106,34,34,16,134,31,0,0,212,9,2,0,32,33,34,0,85,17,31,0,82,34,18,0,33,34,34,1,121,34,4,0,1,34,1,0,0,31,34,0,119,0,4,0,82,34,16,0,33,34,34,1,0,31,34,0,120,31,2,0,119,0,47,0,82,31,18,0,33,31,31,1,121,31,4,0,82,31,18,0,28,31,31,2,85,18,31,0,82,31,16,0,33,31,31,1,121,31,4,0,82,31,16,0,28,31,31,2,85,16,31,0,82,31,18,0,34,31,31,1,121,31,3,0,1,31,1,0,85,18,31,0,82,31,16,0,34,31,31,1,121,31,3,0,1,31,1,0,85,16,31,0,82,1,16,0,82,2,17,0,116,22,18,0,109,22,4,1,109,22,8,2,1,34,2,0,1,33,15,60,134,31,0,0,216,31,2,0,34,33,22,0,82,31,15,0,25,31,31,1,85,15,31,0,82,31,18,0,82,33,16,0,82,34,14,0,106,34,34,16,134,10,0,0,212,9,2,0,31,33,34,0,82,34,17,0,3,34,34,10,85,17,34,0,119,0,200,255,82,3,15,0,82,34,14,0,25,34,34,12,116,27,34,0,109,27,4,3,1,33,2,0,1,31,60,60,134,34,0,0,216,31,2,0,33,31,27,0,116,28,17,0,1,31,2,0,1,33,105,60,134,34,0,0,216,31,2,0,31,33,28,0,82,34,14,0,116,13,34,0,1,33,2,0,1,31,137,60,134,34,0,0,216,31,2,0,33,31,13,0,82,34,15,0,82,31,14,0,106,31,31,12,49,34,34,31,208,67,1,0,1,31,4,0,1,33,65,61,134,34,0,0,216,31,2,0,31,33,26,0,137,29,0,0,139,0,0,0,82,33,14,0,82,33,33,0,82,31,17,0,134,34,0,0,204,115,2,0,33,31,0,0,85,21,34,0,82,34,21,0,121,34,10,0,82,34,14,0,116,34,21,0,116,23,21,0,1,31,2,0,1,33,175,60,134,34,0,0,216,31,2,0,31,33,23,0,119,0,6,0,1,33,4,0,1,31,217,60,134,34,0,0,216,31,2,0,33,31,24,0,82,34,14,0,82,4,34,0,82,30,14,0,106,31,30,4,106,33,30,8,106,32,30,16,134,34,0,0,212,9,2,0,31,33,32,0,3,34,4,34,85,20,34,0,82,34,14,0,106,34,34,4,28,34,34,2,85,18,34,0,82,34,14,0,106,34,34,8,28,34,34,2,85,16,34,0,82,32,18,0,82,33,16,0,82,31,14,0,106,31,31,16,134,34,0,0,212,9,2,0,32,33,31,0,85,17,34,0,82,5,14,0,116,13,5,0,106,31,5,4,109,13,4,31,106,34,5,8,109,13,8,34,106,31,5,12,109,13,12,31,106,34,5,16,109,13,16,34,134,34,0,0,132,218,1,0,12,13,0,0,1,34,1,0,85,11,34,0,82,34,15,0,82,31,11,0,56,34,34,31,216,69,1,0,82,6,18,0,82,7,16,0,82,8,17,0,82,9,20,0,116,25,11,0,109,25,4,6,109,25,8,7,109,25,12,8,109,25,16,9,1,31,2,0,1,33,8,61,134,34,0,0,216,31,2,0,31,33,25,0,82,33,18,0,82,31,16,0,134,34,0,0,244,175,1,0,12,33,31,0,82,31,20,0,82,33,12,0,82,32,17,0,135,34,29,0,31,33,32,0,82,34,20,0,82,32,17,0,3,34,34,32,85,20,34,0,82,34,14,0,25,19,34,12,82,34,19,0,25,34,34,1,85,19,34,0,82,34,18,0,28,34,34,2,85,18,34,0,82,34,16,0,28,34,34,2,85,16,34,0,82,34,18,0,34,34,34,1,121,34,3,0,1,34,1,0,85,18,34,0,82,34,16,0,34,34,34,1,121,34,3,0,1,34,1,0,85,16,34,0,82,32,18,0,82,33,16,0,82,31,14,0,106,31,31,16,134,34,0,0,212,9,2,0,32,33,31,0,85,17,34,0,82,34,11,0,25,34,34,1,85,11,34,0,119,0,192,255,116,13,12,0,106,31,12,4,109,13,4,31,106,34,12,8,109,13,8,34,106,31,12,12,109,13,12,31,106,34,12,16,109,13,16,34,134,34,0,0,236,159,2,0,13,0,0,0,137,29,0,0,139,0,0,0,140,5,49,0,0,0,0,0,2,42,0,0,225,13,0,0,136,43,0,0,0,41,43,0,136,43,0,0,1,44,160,0,3,43,43,44,137,43,0,0,130,43,0,0,136,44,0,0,49,43,43,44,84,70,1,0,1,44,160,0,135,43,0,0,44,0,0,0,25,37,41,88,25,36,41,72,25,35,41,48,25,34,41,40,25,33,41,32,25,32,41,24,25,39,41,16,25,38,41,8,0,31,41,0,1,43,148,0,3,30,41,43,1,43,144,0,3,17,41,43,1,43,140,0,3,40,41,43,1,43,136,0,3,22,41,43,1,43,132,0,3,18,41,43,1,43,128,0,3,29,41,43,25,24,41,124,25,28,41,120,25,25,41,116,25,26,41,112,25,23,41,108,25,27,41,104,25,20,41,100,25,19,41,96,25,21,41,92,85,17,0,0,85,40,1,0,85,22,2,0,85,18,3,0,85,29,4,0,1,44,0,0,135,43,222,0,42,44,0,0,1,43,0,0,85,24,43,0,1,43,165,120,78,43,43,0,38,43,43,1,120,43,22,0,82,43,18,0,32,43,43,11,82,44,18,0,32,44,44,12,20,43,43,44,82,44,18,0,32,44,44,13,20,43,43,44,82,44,18,0,32,44,44,14,20,43,43,44,121,43,10,0,1,44,4,0,1,45,3,42,134,43,0,0,216,31,2,0,44,45,31,0,116,30,24,0,82,16,30,0,137,41,0,0,139,16,0,0,1,43,166,120,78,43,43,0,38,43,43,1,40,43,43,1,82,45,18,0,32,45,45,15,19,43,43,45,121,43,10,0,1,45,4,0,1,44,47,42,134,43,0,0,216,31,2,0,45,44,38,0,116,30,24,0,82,16,30,0,137,41,0,0,139,16,0,0,1,43,167,120,78,43,43,0,38,43,43,1,120,43,16,0,82,43,18,0,32,43,43,16,82,44,18,0,32,44,44,17,20,43,43,44,121,43,10,0,1,44,4,0,1,45,92,42,134,43,0,0,216,31,2,0,44,45,39,0,116,30,24,0,82,16,30,0,137,41,0,0,139,16,0,0,1,43,168,120,78,43,43,0,38,43,43,1,120,43,16,0,82,43,18,0,32,43,43,18,82,45,18,0,32,45,45,19,20,43,43,45,121,43,10,0,1,45,4,0,1,44,137,42,134,43,0,0,216,31,2,0,45,44,32,0,116,30,24,0,82,16,30,0,137,41,0,0,139,16,0,0,1,43,169,120,78,43,43,0,38,43,43,1,120,43,16,0,82,43,18,0,32,43,43,20,82,44,18,0,32,44,44,21,20,43,43,44,121,43,10,0,1,44,4,0,1,45,182,42,134,43,0,0,216,31,2,0,44,45,33,0,116,30,24,0,82,16,30,0,137,41,0,0,139,16,0,0,1,45,245,12,1,44,1,0,135,43,225,0,45,44,0,0,1,44,1,0,135,43,226,0,44,24,0,0,82,44,24,0,135,43,222,0,42,44,0,0,116,28,40,0,116,25,22,0,1,43,0,0,85,26,43,0,116,34,17,0,1,44,2,0,1,45,227,42,134,43,0,0,216,31,2,0,44,45,34,0,1,43,0,0,85,23,43,0,82,43,29,0,82,45,23,0,56,43,43,45,36,74,1,0,82,45,28,0,82,44,25,0,82,46,18,0,134,43,0,0,212,9,2,0,45,44,46,0,85,27,43,0,82,46,18,0,134,43,0,0,144,128,1,0,46,20,19,21,82,5,28,0,82,6,25,0,82,7,27,0,82,8,26,0,116,35,23,0,109,35,4,5,109,35,8,6,109,35,12,7,109,35,16,8,1,46,2,0,1,44,15,43,134,43,0,0,216,31,2,0,46,44,35,0,82,43,20,0,33,43,43,255,121,43,28,0,82,9,23,0,82,10,20,0,82,11,28,0,82,12,25,0,82,43,18,0,34,43,43,11,121,43,12,0,1,44,0,0,82,46,19,0,82,45,21,0,82,47,17,0,82,48,26,0,3,47,47,48,135,43,227,0,42,9,10,11,12,44,46,45,47,0,0,0,119,0,10,0,1,47,0,0,82,45,27,0,82,46,17,0,82,44,26,0,3,46,46,44,135,43,228,0,42,9,10,11,12,47,45,46,119,0,1,0,82,43,28,0,28,43,43,2,85,28,43,0,82,43,25,0,28,43,43,2,85,25,43,0,82,43,26,0,82,46,27,0,3,43,43,46,85,26,43,0,82,43,28,0,34,43,43,1,121,43,3,0,1,43,1,0,85,28,43,0,82,43,25,0,34,43,43,1,121,43,3,0,1,43,1,0,85,25,43,0,82,43,23,0,25,43,43,1,85,23,43,0,119,0,174,255,1,43,163,120,78,43,43,0,38,43,43,1,121,43,10,0,1,46,2,40,1,45,1,41,135,43,229,0,42,46,45,0,1,45,3,40,1,46,1,41,135,43,229,0,42,45,46,0,119,0,11,0,1,46,2,40,2,45,0,0,47,129,0,0,135,43,229,0,42,46,45,0,1,45,3,40,2,46,0,0,47,129,0,0,135,43,229,0,42,45,46,0,1,46,0,40,1,45,0,38,135,43,229,0,42,46,45,0,1,45,1,40,1,46,0,38,135,43,229,0,42,45,46,0,1,46,0,0,135,43,222,0,42,46,0,0,1,43,0,0,82,46,24,0,48,43,43,46,240,74,1,0,82,13,40,0,82,14,22,0,82,15,29,0,116,36,24,0,109,36,4,13,109,36,8,14,109,36,12,15,1,46,3,0,1,45,68,43,134,43,0,0,216,31,2,0,46,45,36,0,119,0,6,0,1,45,4,0,1,46,130,43,134,43,0,0,216,31,2,0,45,46,37,0,116,30,24,0,82,16,30,0,137,41,0,0,139,16,0,0,140,8,38,0,0,0,0,0,2,31,0,0,0,0,32,0,2,32,0,0,255,15,0,0,2,33,0,0,255,0,0,0,136,34,0,0,0,30,34,0,136,34,0,0,1,35,80,1,3,34,34,35,137,34,0,0,130,34,0,0,136,35,0,0,49,34,34,35,104,75,1,0,1,35,80,1,135,34,0,0,35,0,0,0,1,34,68,1,3,15,30,34,1,34,64,1,3,17,30,34,1,34,60,1,3,19,30,34,1,34,56,1,3,26,30,34,1,34,52,1,3,27,30,34,1,34,48,1,3,16,30,34,1,34,44,1,3,14,30,34,1,34,40,1,3,24,30,34,1,34,36,1,3,21,30,34,1,34,32,1,3,10,30,34,1,34,28,1,3,12,30,34,1,34,24,1,3,13,30,34,1,34,20,1,3,11,30,34,1,34,16,1,3,20,30,34,25,25,30,8,25,29,30,4,0,28,30,0,1,34,72,1,3,23,30,34,85,15,0,0,85,17,1,0,85,19,2,0,85,26,3,0,85,27,4,0,85,16,5,0,85,14,6,0,85,24,7,0,1,35,33,0,82,36,15,0,134,34,0,0,172,48,2,0,35,36,0,0,1,36,249,0,82,35,15,0,134,34,0,0,172,48,2,0,36,35,0,0,1,35,4,0,82,36,15,0,134,34,0,0,172,48,2,0,35,36,0,0,1,36,5,0,82,35,15,0,134,34,0,0,172,48,2,0,36,35,0,0,82,35,14,0,19,35,35,33,82,36,15,0,134,34,0,0,172,48,2,0,35,36,0,0,82,36,14,0,43,36,36,8,19,36,36,33,82,35,15,0,134,34,0,0,172,48,2,0,36,35,0,0,1,35,0,0,82,36,15,0,134,34,0,0,172,48,2,0,35,36,0,0,1,36,0,0,82,35,15,0,134,34,0,0,172,48,2,0,36,35,0,0,1,35,44,0,82,36,15,0,134,34,0,0,172,48,2,0,35,36,0,0,82,36,19,0,19,36,36,33,82,35,15,0,134,34,0,0,172,48,2,0,36,35,0,0,82,35,19,0,43,35,35,8,19,35,35,33,82,36,15,0,134,34,0,0,172,48,2,0,35,36,0,0,82,36,26,0,19,36,36,33,82,35,15,0,134,34,0,0,172,48,2,0,36,35,0,0,82,35,26,0,43,35,35,8,19,35,35,33,82,36,15,0,134,34,0,0,172,48,2,0,35,36,0,0,82,36,27,0,19,36,36,33,82,35,15,0,134,34,0,0,172,48,2,0,36,35,0,0,82,35,27,0,43,35,35,8,19,35,35,33,82,36,15,0,134,34,0,0,172,48,2,0,35,36,0,0,82,36,16,0,19,36,36,33,82,35,15,0,134,34,0,0,172,48,2,0,36,35,0,0,82,35,16,0,43,35,35,8,19,35,35,33,82,36,15,0,134,34,0,0,172,48,2,0,35,36,0,0,1,36,128,0,82,35,24,0,82,35,35,0,3,36,36,35,26,36,36,1,82,35,15,0,134,34,0,0,172,48,2,0,36,35,0,0,82,35,15,0,82,36,24,0,134,34,0,0,156,39,2,0,35,36,0,0,82,34,24,0,116,21,34,0,1,34,1,0,82,36,24,0,82,36,36,0,22,34,34,36,85,10,34,0,82,36,21,0,82,35,15,0,134,34,0,0,172,48,2,0,36,35,0,0,135,34,6,0,31,0,0,0,85,12,34,0,82,35,12,0,1,36,0,0,135,34,3,0,35,36,31,0,1,34,255,255,85,13,34,0,82,34,21,0,25,34,34,1,85,11,34,0,82,34,10,0,25,34,34,1,85,20,34,0,1,36,0,0,107,25,1,36,1,36,0,0,83,25,36,0,1,34,0,0,109,25,4,34,82,36,15,0,82,35,10,0,82,37,11,0,134,34,0,0,224,55,2,0,36,25,35,37,1,34,0,0,85,29,34,0,82,34,16,0,82,37,29,0,57,34,34,37,252,79,1,0,1,34,0,0,85,28,34,0,82,34,27,0,82,37,28,0,57,34,34,37,236,79,1,0,82,34,29,0,82,37,27,0,5,22,34,37,82,37,17,0,82,34,28,0,3,34,22,34,41,34,34,2,25,34,34,3,90,37,37,34,83,23,37,0,82,37,13,0,34,37,37,0,121,37,4,0,79,37,23,0,85,13,37,0,119,0,64,0,82,37,12,0,82,34,13,0,41,34,34,9,3,37,37,34,79,34,23,0,41,34,34,1,92,37,37,34,121,37,10,0,82,37,12,0,82,34,13,0,41,34,34,9,3,37,37,34,79,34,23,0,41,34,34,1,93,37,37,34,85,13,37,0,119,0,47,0,82,34,15,0,82,35,13,0,82,36,11,0,134,37,0,0,224,55,2,0,34,25,35,36,82,37,20,0,25,18,37,1,85,20,18,0,82,37,12,0,82,36,13,0,41,36,36,9,3,37,37,36,79,36,23,0,41,36,36,1,96,37,36,18,1,36,1,0,82,37,11,0,22,36,36,37,82,37,20,0,50,36,36,37,136,79,1,0,82,36,11,0,25,36,36,1,85,11,36,0,82,36,20,0,45,36,36,32,212,79,1,0,82,37,15,0,82,35,10,0,82,34,11,0,134,36,0,0,224,55,2,0,37,25,35,34,82,34,12,0,1,35,0,0,135,36,3,0,34,35,31,0,82,36,21,0,25,36,36,1,85,11,36,0,82,36,10,0,25,36,36,1,85,20,36,0,79,36,23,0,85,13,36,0,82,36,28,0,25,36,36,1,85,28,36,0,119,0,170,255,82,36,29,0,25,36,36,1,85,29,36,0,119,0,160,255,82,35,15,0,82,34,13,0,82,37,11,0,134,36,0,0,224,55,2,0,35,25,34,37,82,37,15,0,82,34,10,0,82,35,11,0,134,36,0,0,224,55,2,0,37,25,34,35,82,35,15,0,82,34,10,0,25,34,34,1,82,37,21,0,25,37,37,1,134,36,0,0,224,55,2,0,35,25,34,37,78,36,25,0,120,36,2,0,119,0,6,0,1,37,0,0,134,36,0,0,220,43,2,0,25,37,0,0,119,0,249,255,106,36,25,4,120,36,11,0,82,8,15,0,1,37,0,0,134,36,0,0,172,48,2,0,37,8,0,0,82,9,12,0,135,36,8,0,9,0,0,0,137,30,0,0,139,0,0,0,82,37,15,0,134,36,0,0,32,124,2,0,37,25,0,0,82,8,15,0,1,37,0,0,134,36,0,0,172,48,2,0,37,8,0,0,82,9,12,0,135,36,8,0,9,0,0,0,137,30,0,0,139,0,0,0,140,3,62,0,0,0,0,0,136,58,0,0,0,55,58,0,136,58,0,0,25,58,58,112,137,58,0,0,130,58,0,0,136,59,0,0,49,58,58,59,12,81,1,0,1,59,112,0,135,58,0,0,59,0,0,0,25,25,55,96,25,48,55,32,25,51,55,24,25,52,55,20,25,53,55,16,25,28,55,12,25,49,55,8,25,27,55,4,0,50,55,0,89,25,2,0,0,54,48,0,25,57,54,64,1,58,0,0,85,54,58,0,25,54,54,4,54,58,54,57,60,81,1,0,88,58,1,0,145,58,58,0,89,51,58,0,112,58,1,4,145,58,58,0,89,52,58,0,112,58,1,8,145,58,58,0,89,53,58,0,88,8,51,0,145,8,8,0,88,58,51,0,145,58,58,0,65,29,8,58,145,29,29,0,88,16,52,0,145,16,16,0,88,59,52,0,145,59,59,0,65,58,16,59,145,58,58,0,63,24,29,58,145,24,24,0,88,23,53,0,145,23,23,0,88,61,53,0,145,61,61,0,65,60,23,61,145,60,60,0,63,59,24,60,145,59,59,0,135,58,230,0,59,0,0,0,145,58,58,0,89,28,58,0,88,58,28,0,145,58,58,0,59,59,1,0,145,59,59,0,70,26,58,59,88,59,28,0,145,59,59,0,59,58,0,0,145,58,58,0,70,59,59,58,19,59,26,59,121,59,29,0,59,58,1,0,145,58,58,0,88,60,28,0,145,60,60,0,66,59,58,60,145,59,59,0,89,28,59,0,88,3,28,0,145,3,3,0,88,60,51,0,145,60,60,0,65,59,60,3,145,59,59,0,89,51,59,0,88,4,28,0,145,4,4,0,88,60,52,0,145,60,60,0,65,59,60,4,145,59,59,0,89,52,59,0,88,5,28,0,145,5,5,0,88,60,53,0,145,60,60,0,65,59,60,5,145,59,59,0,89,53,59,0,88,60,25,0,145,60,60,0,135,59,12,0,60,0,0,0,145,59,59,0,89,49,59,0,88,60,25,0,145,60,60,0,135,59,13,0,60,0,0,0,145,59,59,0,89,27,59,0,59,60,1,0,145,60,60,0,88,58,27,0,145,58,58,0,64,59,60,58,145,59,59,0,89,50,59,0,88,6,51,0,145,6,6,0,88,59,51,0,145,59,59,0,65,30,6,59,145,30,30,0,88,59,50,0,145,59,59,0,65,31,30,59,145,31,31,0,88,58,27,0,145,58,58,0,63,59,31,58,145,59,59,0,89,48,59,0,88,7,52,0,145,7,7,0,88,59,51,0,145,59,59,0,65,32,7,59,145,32,32,0,88,59,50,0,145,59,59,0,65,33,32,59,145,33,33,0,88,9,53,0,145,9,9,0,88,61,49,0,145,61,61,0,65,60,9,61,145,60,60,0,63,58,33,60,145,58,58,0,113,48,16,58,88,10,53,0,145,10,10,0,88,58,51,0,145,58,58,0,65,34,10,58,145,34,34,0,88,58,50,0,145,58,58,0,65,35,34,58,145,35,35,0,88,11,52,0,145,11,11,0,88,61,49,0,145,61,61,0,65,60,11,61,145,60,60,0,64,59,35,60,145,59,59,0,113,48,32,59,59,58,0,0,145,58,58,0,113,48,48,58,88,12,51,0,145,12,12,0,88,58,52,0,145,58,58,0,65,36,12,58,145,36,36,0,88,58,50,0,145,58,58,0,65,37,36,58,145,37,37,0,88,13,53,0,145,13,13,0,88,61,49,0,145,61,61,0,65,60,13,61,145,60,60,0,64,59,37,60,145,59,59,0,113,48,4,59,88,14,52,0,145,14,14,0,88,59,52,0,145,59,59,0,65,38,14,59,145,38,38,0,88,59,50,0,145,59,59,0,65,39,38,59,145,39,39,0,88,60,27,0,145,60,60,0,63,58,39,60,145,58,58,0,113,48,20,58,88,15,53,0,145,15,15,0,88,58,52,0,145,58,58,0,65,40,15,58,145,40,40,0,88,58,50,0,145,58,58,0,65,41,40,58,145,41,41,0,88,17,51,0,145,17,17,0,88,61,49,0,145,61,61,0,65,60,17,61,145,60,60,0,63,59,41,60,145,59,59,0,113,48,36,59,59,58,0,0,145,58,58,0,113,48,52,58,88,18,51,0,145,18,18,0,88,58,53,0,145,58,58,0,65,42,18,58,145,42,42,0,88,58,50,0,145,58,58,0,65,43,42,58,145,43,43,0,88,19,52,0,145,19,19,0,88,61,49,0,145,61,61,0,65,60,19,61,145,60,60,0,63,59,43,60,145,59,59,0,113,48,8,59,88,20,52,0,145,20,20,0,88,59,53,0,145,59,59,0,65,44,20,59,145,44,44,0,88,59,50,0,145,59,59,0,65,45,44,59,145,45,45,0,88,21,51,0,145,21,21,0,88,61,49,0,145,61,61,0,65,60,21,61,145,60,60,0,64,58,45,60,145,58,58,0,113,48,24,58,88,22,53,0,145,22,22,0,88,58,53,0,145,58,58,0,65,46,22,58,145,46,46,0,88,58,50,0,145,58,58,0,65,47,46,58,145,47,47,0,88,60,27,0,145,60,60,0,63,59,47,60,145,59,59,0,113,48,40,59,59,58,0,0,145,58,58,0,113,48,56,58,59,59,0,0,145,59,59,0,113,48,12,59,59,58,0,0,145,58,58,0,113,48,28,58,59,59,0,0,145,59,59,0,113,48,44,59,59,58,1,0,145,58,58,0,113,48,60,58,0,54,0,0,0,56,48,0,25,57,54,64,116,54,56,0,25,54,54,4,25,56,56,4,54,58,54,57,164,85,1,0,137,55,0,0,139,0,0,0,140,7,38,0,0,0,0,0,1,31,0,0,136,33,0,0,0,32,33,0,136,33,0,0,25,33,33,48,137,33,0,0,130,33,0,0,136,34,0,0,49,33,33,34,252,85,1,0,1,34,48,0,135,33,0,0,34,0,0,0,25,18,32,40,25,26,32,36,25,22,32,32,25,23,32,28,25,21,32,24,25,14,32,20,25,13,32,16,25,20,32,12,25,30,32,8,25,19,32,4,0,24,32,0,85,18,0,0,89,26,1,0,85,22,2,0,85,23,3,0,89,21,4,0,85,14,5,0,85,13,6,0,59,33,0,0,145,33,33,0,89,30,33,0,82,33,23,0,82,34,22,0,4,27,33,34,59,34,1,0,145,34,34,0,88,33,26,0,145,33,33,0,66,15,34,33,145,15,15,0,1,36,160,20,82,37,18,0,41,37,37,3,3,36,36,37,106,36,36,4,38,36,36,7,135,35,231,0,36,15,0,0,145,35,35,0,59,36,2,0,145,36,36,0,65,34,35,36,145,34,34,0,135,33,11,0,34,0,0,0,75,33,33,0,47,33,33,27,212,86,1,0,1,34,115,56,1,36,90,48,1,35,19,4,1,37,214,56,135,33,4,0,34,36,35,37,82,33,14,0,116,33,22,0,82,33,14,0,82,37,23,0,109,33,4,37,82,37,14,0,106,37,37,4,82,33,14,0,82,33,33,0,47,37,37,33,24,87,1,0,1,33,223,55,1,35,90,48,1,36,24,4,1,34,214,56,135,37,4,0,33,35,36,34,1,37,0,0,85,20,37,0,82,37,23,0,82,34,22,0,4,37,37,34,82,34,20,0,54,37,37,34,100,88,1,0,82,36,20,0,82,35,22,0,3,34,36,35,76,34,34,0,145,34,34,0,61,35,0,0,0,0,0,63,145,35,35,0,63,37,34,35,145,37,37,0,89,24,37,0,88,7,21,0,145,7,7,0,88,37,24,0,145,37,37,0,64,28,7,37,145,28,28,0,59,37,1,0,145,37,37,0,88,35,26,0,145,35,35,0,66,16,37,35,145,16,16,0,1,35,160,20,82,37,18,0,41,37,37,3,94,35,35,37,38,35,35,7,135,12,232,0,35,28,16,0,145,12,12,0,82,35,13,0,82,37,20,0,41,37,37,2,101,35,37,12,82,37,20,0,120,37,21,0,82,35,13,0,82,34,20,0,41,34,34,2,100,37,35,34,145,37,37,0,59,35,0,0,145,35,35,0,70,37,37,35,121,37,3,0,1,31,10,0,119,0,11,0,82,37,22,0,25,25,37,1,85,22,25,0,82,37,14,0,85,37,25,0,82,37,20,0,26,37,37,1,85,20,37,0,119,0,2,0,1,31,10,0,32,37,31,10,121,37,12,0,1,31,0,0,82,37,13,0,82,35,20,0,41,35,35,2,100,8,37,35,145,8,8,0,88,35,30,0,145,35,35,0,63,37,35,8,145,37,37,0,89,30,37,0,82,37,20,0,25,37,37,1,85,20,37,0,119,0,176,255,82,35,23,0,25,37,35,1,76,37,37,0,145,37,37,0,61,35,0,0,0,0,0,63,145,35,35,0,63,10,37,35,145,10,10,0,88,35,21,0,145,35,35,0,64,29,10,35,145,29,29,0,59,35,1,0,145,35,35,0,88,37,26,0,145,37,37,0,66,17,35,37,145,17,17,0,1,35,160,20,82,34,18,0,41,34,34,3,94,35,35,34,38,35,35,7,135,37,232,0,35,29,17,0,145,37,37,0,59,35,0,0,145,35,35,0,69,37,37,35,120,37,7,0,1,35,253,56,1,34,90,48,1,36,42,4,1,33,214,56,135,37,4,0,35,34,36,33,88,37,30,0,145,37,37,0,62,33,0,0,205,204,204,204,204,204,236,63,73,37,37,33,120,37,7,0,1,33,105,57,1,36,90,48,1,34,44,4,1,35,214,56,135,37,4,0,33,36,34,35,88,37,30,0,145,37,37,0,62,35,0,0,82,253,247,158,153,153,241,63,145,35,35,0,71,37,37,35,120,37,7,0,1,35,124,57,1,34,90,48,1,36,45,4,1,33,214,56,135,37,4,0,35,34,36,33,59,33,1,0,145,33,33,0,88,36,30,0,145,36,36,0,66,37,33,36,145,37,37,0,89,19,37,0,1,37,0,0,85,20,37,0,82,37,23,0,82,36,22,0,4,37,37,36,82,36,20,0,54,37,37,36,220,89,1,0,88,9,19,0,145,9,9,0,82,37,13,0,82,36,20,0,41,36,36,2,3,11,37,36,88,37,11,0,145,37,37,0,65,36,37,9,145,36,36,0,89,11,36,0,82,36,20,0,25,36,36,1,85,20,36,0,119,0,236,255,82,36,23,0,82,37,22,0,4,36,36,37,85,20,36,0,82,36,20,0,34,36,36,0,121,36,3,0,1,31,25,0,119,0,23,0,82,37,13,0,82,33,20,0,41,33,33,2,100,36,37,33,145,36,36,0,59,37,0,0,145,37,37,0,70,36,36,37,121,36,3,0,1,31,25,0,119,0,12,0,82,36,14,0,82,37,14,0,82,37,37,0,82,33,20,0,3,37,37,33,26,37,37,1,109,36,4,37,82,37,20,0,26,37,37,1,85,20,37,0,119,0,230,255,32,37,31,25,121,37,3,0,137,32,0,0,139,0,0,0,139,0,0,0,140,2,22,0,0,0,0,0,2,16,0,0,128,0,0,0,2,17,0,0,224,0,0,0,2,18,0,0,240,0,0,0,1,14,0,0,136,19,0,0,0,15,19,0,136,19,0,0,25,19,19,32,137,19,0,0,130,19,0,0,136,20,0,0,49,19,19,20,192,90,1,0,1,20,32,0,135,19,0,0,20,0,0,0,25,12,15,16,25,13,15,12,25,3,15,8,25,4,15,4,0,5,15,0,25,6,15,25,25,7,15,24,25,9,15,23,25,8,15,22,25,10,15,21,25,11,15,20,85,13,0,0,85,3,1,0,1,19,63,0,85,4,19,0,82,19,13,0,79,19,19,0,85,5,19,0,82,19,3,0,1,20,1,0,85,19,20,0,82,20,5,0,36,20,20,127,121,20,5,0,82,20,13,0,78,20,20,0,85,4,20,0,119,0,253,0,82,20,5,0,19,20,20,17,1,19,192,0,45,20,20,19,212,91,1,0,82,20,13,0,102,20,20,1,83,6,20,0,79,20,6,0,121,20,25,0,79,20,6,0,42,20,20,6,32,20,20,2,121,20,21,0,1,20,194,0,82,19,5,0,17,20,20,19,82,19,5,0,1,21,223,0,17,19,19,21,19,20,20,19,120,20,2,0,119,0,230,0,82,20,5,0,38,20,20,31,41,20,20,6,79,19,6,0,38,19,19,63,20,20,20,19,85,4,20,0,82,20,3,0,1,19,2,0,85,20,19,0,119,0,219,0,82,19,3,0,1,20,2,0,85,19,20,0,116,12,4,0,82,2,12,0,137,15,0,0,139,2,0,0,82,20,5,0,19,20,20,18,45,20,20,17,60,93,1,0,82,20,13,0,102,20,20,1,83,7,20,0,1,20,0,0,83,9,20,0,79,20,7,0,121,20,73,0,79,20,7,0,42,20,20,6,32,20,20,2,121,20,69,0,82,20,13,0,102,20,20,2,83,9,20,0,79,20,9,0,121,20,57,0,79,20,9,0,42,20,20,6,32,20,20,2,121,20,53,0,82,20,5,0,45,20,20,17,104,92,1,0,1,20,160,0,79,19,7,0,49,20,20,19,100,92,1,0,79,20,7,0,1,19,191,0,49,20,20,19,100,92,1,0,1,14,19,0,119,0,2,0,1,14,19,0,32,20,14,19,121,20,30,0,82,20,5,0,1,19,237,0,45,20,20,19,160,92,1,0,79,20,7,0,54,20,20,16,232,92,1,0,1,20,159,0,79,19,7,0,54,20,20,19,232,92,1,0,82,20,5,0,54,20,20,17,32,95,1,0,82,20,5,0,38,20,20,15,41,20,20,12,79,19,7,0,38,19,19,63,41,19,19,6,20,20,20,19,79,19,9,0,38,19,19,63,20,20,20,19,85,4,20,0,82,20,3,0,1,19,3,0,85,20,19,0,119,0,143,0,82,19,3,0,1,20,2,0,85,19,20,0,116,12,4,0,82,2,12,0,137,15,0,0,139,2,0,0,82,20,3,0,1,19,3,0,85,20,19,0,116,12,4,0,82,2,12,0,137,15,0,0,139,2,0,0,82,19,3,0,1,20,2,0,85,19,20,0,116,12,4,0,82,2,12,0,137,15,0,0,139,2,0,0,82,20,5,0,1,19,248,0,19,20,20,19,45,20,20,18,32,95,1,0,1,20,244,0,82,19,5,0,47,20,20,19,112,93,1,0,116,12,4,0,82,2,12,0,137,15,0,0,139,2,0,0,82,20,13,0,102,20,20,1,83,8,20,0,1,20,0,0,83,10,20,0,1,20,0,0,83,11,20,0,79,20,8,0,121,20,93,0,79,20,8,0,42,20,20,6,32,20,20,2,121,20,89,0,82,20,13,0,102,20,20,2,83,10,20,0,79,20,10,0,121,20,77,0,79,20,10,0,42,20,20,6,32,20,20,2,121,20,73,0,82,20,13,0,102,20,20,3,83,11,20,0,79,20,11,0,121,20,61,0,79,20,11,0,42,20,20,6,32,20,20,2,121,20,57,0,82,20,5,0,45,20,20,18,32,94,1,0,1,20,144,0,79,19,8,0,49,20,20,19,28,94,1,0,79,20,8,0,1,19,191,0,49,20,20,19,28,94,1,0,1,14,40,0,119,0,2,0,1,14,40,0,32,20,14,40,121,20,34,0,82,20,5,0,1,19,244,0,45,20,20,19,88,94,1,0,79,20,8,0,54,20,20,16,176,94,1,0,1,20,143,0,79,19,8,0,54,20,20,19,176,94,1,0,82,20,5,0,54,20,20,18,32,95,1,0,82,20,5,0,38,20,20,7,41,20,20,18,79,19,8,0,38,19,19,63,41,19,19,12,20,20,20,19,79,19,10,0,38,19,19,63,41,19,19,6,20,20,20,19,79,19,11,0,38,19,19,63,20,20,20,19,85,4,20,0,82,20,3,0,1,19,4,0,85,20,19,0,119,0,29,0,82,19,3,0,1,20,2,0,85,19,20,0,116,12,4,0,82,2,12,0,137,15,0,0,139,2,0,0,82,20,3,0,1,19,4,0,85,20,19,0,116,12,4,0,82,2,12,0,137,15,0,0,139,2,0,0,82,19,3,0,1,20,3,0,85,19,20,0,116,12,4,0,82,2,12,0,137,15,0,0,139,2,0,0,82,20,3,0,1,19,2,0,85,20,19,0,116,12,4,0,82,2,12,0,137,15,0,0,139,2,0,0,2,19,0,0,255,255,16,0,82,20,4,0,47,19,19,20,60,95,1,0,1,19,63,0,85,4,19,0,116,12,4,0,82,2,12,0,137,15,0,0,139,2,0,0,140,2,40,0,0,0,0,0,136,36,0,0,0,35,36,0,136,36,0,0,25,36,36,80,137,36,0,0,130,36,0,0,136,37,0,0,49,36,36,37,132,95,1,0,1,37,80,0,135,36,0,0,37,0,0,0,25,2,35,48,0,33,35,0,25,26,35,44,25,30,35,40,25,22,35,36,25,27,35,32,25,25,35,28,25,23,35,24,25,32,35,4,85,26,0,0,82,36,26,0,82,36,36,0,120,36,3,0,137,35,0,0,139,0,0,0,82,36,26,0,106,36,36,4,120,36,3,0,137,35,0,0,139,0,0,0,82,36,26,0,106,36,36,8,120,36,3,0,137,35,0,0,139,0,0,0,88,36,1,0,145,36,36,0,59,37,0,0,145,37,37,0,71,36,36,37,121,36,12,0,88,13,1,0,145,13,13,0,25,34,1,8,88,37,34,0,145,37,37,0,63,36,37,13,145,36,36,0,89,34,36,0,59,36,0,0,145,36,36,0,89,1,36,0,112,36,1,4,145,36,36,0,59,37,0,0,145,37,37,0,71,36,36,37,121,36,12,0,112,3,1,4,145,3,3,0,25,24,1,12,88,37,24,0,145,37,37,0,63,36,37,3,145,36,36,0,89,24,36,0,59,37,0,0,145,37,37,0,113,1,4,37,88,4,1,0,145,4,4,0,112,37,1,8,145,37,37,0,63,14,4,37,145,14,14,0,82,36,26,0,106,37,36,4,76,37,37,0,145,37,37,0,73,37,14,37,121,37,10,0,82,37,26,0,106,18,37,4,76,37,18,0,145,18,37,0,88,38,1,0,145,38,38,0,64,36,18,38,145,36,36,0,113,1,8,36,112,5,1,4,145,5,5,0,112,36,1,12,145,36,36,0,63,15,5,36,145,15,15,0,82,37,26,0,106,36,37,8,76,36,36,0,145,36,36,0,73,36,15,36,121,36,10,0,82,36,26,0,106,19,36,8,76,36,19,0,145,19,36,0,112,38,1,4,145,38,38,0,64,37,19,38,145,37,37,0,113,1,12,37,88,6,1,0,145,6,6,0,82,36,26,0,106,37,36,4,76,37,37,0,145,37,37,0,71,37,6,37,121,37,154,0,112,7,1,4,145,7,7,0,82,36,26,0,106,37,36,8,76,37,37,0,145,37,37,0,71,37,7,37,121,37,146,0,82,8,26,0,116,2,8,0,106,36,8,4,109,2,4,36,106,37,8,8,109,2,8,37,106,36,8,12,109,2,12,36,106,37,8,16,109,2,16,37,134,37,0,0,184,219,0,0,2,0,0,0,85,30,37,0,112,37,1,8,145,37,37,0,75,20,37,0,112,38,1,12,145,38,38,0,75,38,38,0,5,36,20,38,41,36,36,2,135,37,6,0,36,0,0,0,85,22,37,0,112,37,1,4,145,37,37,0,75,37,37,0,85,27,37,0,112,9,1,4,145,9,9,0,112,36,1,12,145,36,36,0,63,37,9,36,145,37,37,0,75,37,37,0,82,36,27,0,56,37,37,36,216,98,1,0,88,37,1,0,145,37,37,0,75,37,37,0,85,25,37,0,88,10,1,0,145,10,10,0,112,36,1,8,145,36,36,0,63,37,10,36,145,37,37,0,75,37,37,0,82,36,25,0,56,37,37,36,200,98,1,0,82,37,27,0,112,36,1,4,145,36,36,0,75,36,36,0,4,31,37,36,112,36,1,8,145,36,36,0,75,36,36,0,5,28,31,36,82,36,22,0,82,37,25,0,88,38,1,0,145,38,38,0,75,38,38,0,4,37,37,38,3,37,28,37,41,37,37,2,3,16,36,37,82,37,27,0,82,36,26,0,106,36,36,4,5,29,37,36,82,36,30,0,82,37,25,0,3,37,29,37,41,37,37,2,3,17,36,37,78,37,17,0,83,16,37,0,102,36,17,1,107,16,1,36,102,37,17,2,107,16,2,37,102,36,17,3,107,16,3,36,82,36,25,0,25,36,36,1,85,25,36,0,119,0,208,255,82,36,27,0,25,36,36,1,85,27,36,0,119,0,190,255,82,37,30,0,135,36,8,0,37,0,0,0,82,36,26,0,25,36,36,16,116,23,36,0,82,11,26,0,116,2,11,0,106,37,11,4,109,2,4,37,106,36,11,8,109,2,8,36,106,37,11,12,109,2,12,37,106,36,11,16,109,2,16,36,134,36,0,0,236,159,2,0,2,0,0,0,82,12,26,0,112,36,1,8,145,36,36,0,75,21,36,0,82,37,22,0,112,38,1,12,145,38,38,0,75,38,38,0,134,36,0,0,64,227,1,0,32,37,21,38,116,12,32,0,106,38,32,4,109,12,4,38,106,36,32,8,109,12,8,36,106,38,32,12,109,12,12,38,106,36,32,16,109,12,16,36,82,38,22,0,135,36,8,0,38,0,0,0,82,38,26,0,82,37,23,0,134,36,0,0,92,72,0,0,38,37,0,0,137,35,0,0,139,0,0,0,1,37,4,0,1,38,162,59,134,36,0,0,216,31,2,0,37,38,33,0,137,35,0,0,139,0,0,0,140,7,59,0,0,0,0,0,136,53,0,0,0,52,53,0,136,53,0,0,25,53,53,80,137,53,0,0,130,53,0,0,136,54,0,0,49,53,53,54,240,99,1,0,1,54,80,0,135,53,0,0,54,0,0,0,25,33,52,68,25,32,52,64,25,35,52,60,25,48,52,56,25,49,52,52,25,40,52,48,25,47,52,44,25,41,52,40,25,51,52,36,25,46,52,32,25,36,52,28,25,37,52,24,25,38,52,20,25,39,52,16,25,43,52,12,25,44,52,8,25,45,52,4,0,42,52,0,85,33,0,0,85,32,1,0,85,35,2,0,89,48,3,0,89,49,4,0,85,40,5,0,85,47,6,0,88,7,48,0,145,7,7,0,82,54,35,0,82,55,40,0,82,56,47,0,134,53,0,0,236,40,2,0,7,54,55,56,85,51,53,0,88,56,48,0,145,56,56,0,134,53,0,0,24,149,2,0,56,0,0,0,33,50,53,0,1,53,160,20,82,56,35,0,41,56,56,3,3,53,53,56,106,26,53,4,88,27,48,0,145,27,27,0,121,50,63,0,59,53,1,0,145,53,53,0,66,34,53,27,145,34,34,0,38,53,26,7,135,29,231,0,53,34,0,0,145,29,29,0,88,56,48,0,145,56,56,0,65,53,29,56,145,53,53,0,89,46,53,0,1,53,0,0,85,41,53,0,82,53,51,0,82,56,41,0,56,53,53,56,160,101,1,0,88,8,46,0,145,8,8,0,88,9,48,0,145,9,9,0,82,56,41,0,88,55,49,0,145,55,55,0,134,53,0,0,108,155,1,0,56,8,9,55,37,38,36,0,82,10,35,0,88,11,48,0,145,11,11,0,82,12,37,0,82,13,38,0,88,14,36,0,145,14,14,0,82,53,33,0,82,55,41,0,134,30,0,0,172,143,2,0,53,55,0,0,88,15,48,0,145,15,15,0,82,56,32,0,82,54,35,0,82,57,41,0,1,58,0,0,134,53,0,0,56,55,2,0,56,54,15,57,58,0,0,0,134,55,0,0,192,85,1,0,10,11,12,13,14,30,53,0,82,55,41,0,25,55,55,1,85,41,55,0,119,0,212,255,137,52,0,0,139,0,0,0,38,55,26,7,135,31,231,0,55,27,0,0,145,31,31,0,88,53,48,0,145,53,53,0,66,55,31,53,145,55,55,0,89,39,55,0,1,55,0,0,85,41,55,0,82,55,51,0,82,53,41,0,56,55,55,53,172,102,1,0,82,16,41,0,82,53,35,0,88,58,48,0,145,58,58,0,134,55,0,0,20,137,2,0,53,58,0,0,4,55,16,55,85,42,55,0,88,17,39,0,145,17,17,0,88,18,48,0,145,18,18,0,82,58,42,0,88,53,49,0,145,53,53,0,134,55,0,0,44,157,1,0,58,17,18,53,44,45,43,0,82,19,35,0,88,20,48,0,145,20,20,0,82,21,44,0,82,22,45,0,88,23,43,0,145,23,23,0,82,55,33,0,82,53,41,0,134,28,0,0,172,143,2,0,55,53,0,0,88,24,48,0,145,24,24,0,82,58,32,0,82,57,35,0,82,54,41,0,1,56,0,0,134,55,0,0,56,55,2,0,58,57,24,54,56,0,0,0,134,53,0,0,124,125,1,0,19,20,21,22,23,28,55,0,82,53,41,0,25,53,53,1,85,41,53,0,119,0,203,255,88,25,48,0,145,25,25,0,82,55,33,0,82,56,32,0,82,54,35,0,82,57,40,0,82,58,47,0,134,53,0,0,228,11,1,0,55,56,54,25,57,58,0,0,137,52,0,0,139,0,0,0,140,0,24,0,0,0,0,0,2,14,0,0,192,81,0,0,2,15,0,0,0,96,0,0,2,16,0,0,0,128,0,0,136,17,0,0,0,13,17,0,136,17,0,0,25,17,17,48,137,17,0,0,130,17,0,0,136,18,0,0,49,17,17,18,48,103,1,0,1,18,48,0,135,17,0,0,18,0,0,0,25,12,13,8,0,11,13,0,25,4,13,36,25,6,13,32,25,7,13,28,25,8,13,24,25,10,13,20,25,9,13,16,25,5,13,12,1,17,0,0,85,4,17,0,1,17,1,0,82,18,4,0,56,17,17,18,48,106,1,0,2,17,0,0,0,128,1,0,135,0,6,0,17,0,0,0,82,17,4,0,27,17,17,48,3,17,14,17,109,17,12,0,2,17,0,0,0,0,1,0,135,1,6,0,17,0,0,0,82,17,4,0,27,17,17,48,3,17,14,17,109,17,16,1,135,2,6,0,16,0,0,0,82,17,4,0,27,17,17,48,3,17,14,17,109,17,20,2,135,3,6,0,15,0,0,0,82,17,4,0,27,17,17,48,3,17,14,17,109,17,24,3,1,17,0,0,85,6,17,0,82,17,6,0,56,17,15,17,36,104,1,0,82,17,4,0,27,17,17,48,3,17,14,17,106,17,17,12], eb + 81920);
  HEAPU8.set([82,18,6,0,41,18,18,2,59,19,0,0,145,19,19,0,101,17,18,19,82,19,6,0,25,19,19,1,85,6,19,0,119,0,241,255,1,19,0,0,85,7,19,0,1,19,0,64,82,18,7,0,56,19,19,18,112,104,1,0,82,19,4,0,27,19,19,48,3,19,14,19,106,19,19,16,82,18,7,0,41,18,18,2,59,17,0,0,145,17,17,0,101,19,18,17,82,17,7,0,25,17,17,1,85,7,17,0,119,0,240,255,1,17,0,0,85,8,17,0,82,17,8,0,56,17,16,17,176,104,1,0,82,17,4,0,27,17,17,48,3,17,14,17,106,17,17,20,82,18,8,0,1,19,0,0,95,17,18,19,82,19,8,0,25,19,19,1,85,8,19,0,119,0,243,255,1,19,0,0,85,10,19,0,1,19,0,0,85,9,19,0,1,19,0,48,82,18,9,0,56,19,19,18,232,105,1,0,82,19,4,0,27,19,19,48,3,19,14,19,106,19,19,24,82,18,9,0,41,18,18,1,82,17,10,0,41,17,17,2,96,19,18,17,82,17,4,0,27,17,17,48,3,17,14,17,106,17,17,24,82,18,9,0,25,18,18,1,41,18,18,1,82,19,10,0,41,19,19,2,25,19,19,1,96,17,18,19,82,19,4,0,27,19,19,48,3,19,14,19,106,19,19,24,82,18,9,0,25,18,18,2,41,18,18,1,82,17,10,0,41,17,17,2,25,17,17,2,96,19,18,17,82,17,4,0,27,17,17,48,3,17,14,17,106,17,17,24,82,18,9,0,25,18,18,3,41,18,18,1,82,19,10,0,41,19,19,2,96,17,18,19,82,19,4,0,27,19,19,48,3,19,14,19,106,19,19,24,82,18,9,0,25,18,18,4,41,18,18,1,82,17,10,0,41,17,17,2,25,17,17,2,96,19,18,17,82,17,4,0,27,17,17,48,3,17,14,17,106,17,17,24,82,18,9,0,25,18,18,5,41,18,18,1,82,19,10,0,41,19,19,2,25,19,19,3,96,17,18,19,82,19,10,0,25,19,19,1,85,10,19,0,82,19,9,0,25,19,19,6,85,9,19,0,119,0,183,255,82,19,4,0,27,19,19,48,1,18,0,0,97,14,19,18,82,18,4,0,27,18,18,48,3,18,14,18,1,19,0,0,109,18,4,19,82,19,4,0,27,19,19,48,3,19,14,19,1,18,0,0,109,19,8,18,82,18,4,0,25,18,18,1,85,4,18,0,119,0,76,255,1,19,3,0,1,17,137,36,134,18,0,0,216,31,2,0,19,17,11,0,1,18,0,0,85,5,18,0,1,18,1,0,82,17,5,0,56,18,18,17,64,109,1,0,1,18,161,120,78,18,18,0,38,18,18,1,121,18,20,0,1,17,40,117,82,17,17,0,38,17,17,63,1,19,1,0,82,20,5,0,27,20,20,48,3,20,14,20,25,20,20,28,135,18,233,0,17,19,20,0,1,17,236,115,82,17,17,0,38,17,17,31,82,20,5,0,27,20,20,48,3,20,14,20,106,20,20,28,135,18,217,0,17,20,0,0,1,17,1,0,82,20,5,0,27,20,20,48,3,20,14,20,25,20,20,32,135,18,234,0,17,20,0,0,2,20,0,0,146,136,0,0,82,17,5,0,27,17,17,48,3,17,14,17,106,17,17,32,135,18,218,0,20,17,0,0,2,17,0,0,146,136,0,0,2,20,0,0,0,128,1,0,82,19,5,0,27,19,19,48,3,19,14,19,106,19,19,12,2,21,0,0,232,136,0,0,135,18,235,0,17,20,19,21,1,21,232,115,82,21,21,0,82,21,21,0,135,18,220,0,21,0,0,0,1,21,232,115,82,21,21,0,82,21,21,0,1,19,3,0,1,20,6,20,1,17,0,0,1,22,0,0,1,23,0,0,135,18,219,0,21,19,20,17,22,23,0,0,1,23,1,0,82,22,5,0,27,22,22,48,3,22,14,22,25,22,22,32,25,22,22,4,135,18,234,0,23,22,0,0,2,22,0,0,146,136,0,0,82,23,5,0,27,23,23,48,3,23,14,23,25,23,23,32,106,23,23,4,135,18,218,0,22,23,0,0,2,23,0,0,146,136,0,0,2,22,0,0,0,0,1,0,82,17,5,0,27,17,17,48,3,17,14,17,106,17,17,16,2,20,0,0,232,136,0,0,135,18,235,0,23,22,17,20,1,20,232,115,82,20,20,0,106,20,20,4,135,18,220,0,20,0,0,0,1,20,232,115,82,20,20,0,106,20,20,4,1,17,2,0,1,22,6,20,1,23,0,0,1,19,0,0,1,21,0,0,135,18,219,0,20,17,22,23,19,21,0,0,1,21,1,0,82,19,5,0,27,19,19,48,3,19,14,19,25,19,19,32,25,19,19,8,135,18,234,0,21,19,0,0,2,19,0,0,146,136,0,0,82,21,5,0,27,21,21,48,3,21,14,21,25,21,21,32,106,21,21,8,135,18,218,0,19,21,0,0,2,21,0,0,146,136,0,0,82,19,5,0,27,19,19,48,3,19,14,19,106,19,19,20,2,23,0,0,232,136,0,0,135,18,235,0,21,16,19,23,1,23,232,115,82,23,23,0,106,23,23,20,135,18,220,0,23,0,0,0,1,23,232,115,82,23,23,0,106,23,23,20,1,19,4,0,1,21,1,20,1,22,1,0,1,17,0,0,1,20,0,0,135,18,219,0,23,19,21,22,17,20,0,0,1,20,1,0,82,17,5,0,27,17,17,48,3,17,14,17,25,17,17,32,25,17,17,12,135,18,234,0,20,17,0,0,2,17,0,0,147,136,0,0,82,20,5,0,27,20,20,48,3,20,14,20,25,20,20,32,106,20,20,12,135,18,218,0,17,20,0,0,2,20,0,0,147,136,0,0,82,17,5,0,27,17,17,48,3,17,14,17,106,17,17,24,2,22,0,0,228,136,0,0,135,18,235,0,20,15,17,22,82,18,5,0,25,18,18,1,85,5,18,0,119,0,68,255,1,22,3,0,1,17,185,36,134,18,0,0,216,31,2,0,22,17,12,0,1,18,161,120,78,18,18,0,38,18,18,1,120,18,3,0,137,13,0,0,139,0,0,0,1,17,236,115,82,17,17,0,38,17,17,31,1,22,0,0,135,18,217,0,17,22,0,0,137,13,0,0,139,0,0,0,140,6,50,0,0,0,0,0,136,45,0,0,0,44,45,0,136,45,0,0,25,45,45,16,137,45,0,0,130,45,0,0,136,46,0,0,49,45,45,46,196,109,1,0,1,46,16,0,135,45,0,0,46,0,0,0,25,39,44,8,25,41,44,4,0,38,44,0,25,37,44,12,89,39,4,0,82,45,0,0,37,45,45,0,121,45,3,0,137,44,0,0,139,0,0,0,106,45,0,4,76,45,45,0,145,45,45,0,89,41,45,0,106,45,0,8,76,45,45,0,145,45,45,0,89,38,45,0,1,45,0,0,83,37,45,0,112,45,1,8,145,45,45,0,59,46,0,0,145,46,46,0,71,45,45,46,121,45,11,0,1,45,1,0,83,37,45,0,25,42,1,8,88,46,42,0,145,46,46,0,59,47,255,255,145,47,47,0,65,45,46,47,145,45,45,0,89,42,45,0,112,45,1,12,145,45,45,0,59,47,0,0,145,47,47,0,71,45,45,47,121,45,9,0,112,19,1,12,145,19,19,0,25,43,1,4,88,47,43,0,145,47,47,0,64,45,47,19,145,45,45,0,89,43,45,0,82,47,0,0,134,45,0,0,108,205,1,0,47,0,0,0,134,45,0,0,144,134,2,0,88,20,2,0,145,20,20,0,112,47,2,4,145,47,47,0,59,46,0,0,145,46,46,0,134,45,0,0,60,7,2,0,20,47,46,0,88,46,39,0,145,46,46,0,59,47,0,0,145,47,47,0,59,48,0,0,145,48,48,0,59,49,1,0,145,49,49,0,134,45,0,0,36,191,1,0,46,47,48,49,88,45,3,0,145,45,45,0,68,40,45,0,145,40,40,0,112,48,3,4,145,48,48,0,68,49,48,0,145,49,49,0,59,48,0,0,145,48,48,0,134,45,0,0,60,7,2,0,40,49,48,0,1,48,7,0,134,45,0,0,204,196,1,0,48,0,0,0,78,48,5,0,102,49,5,1,102,47,5,2,102,46,5,3,134,45,0,0,248,33,2,0,48,49,47,46,59,46,0,0,145,46,46,0,59,47,0,0,145,47,47,0,59,49,1,0,145,49,49,0,134,45,0,0,232,149,2,0,46,47,49,0,88,6,1,0,145,6,6,0,78,45,37,0,38,45,45,1,121,45,19,0,112,45,1,8,145,45,45,0,63,21,6,45,145,21,21,0,88,45,41,0,145,45,45,0,66,29,21,45,145,29,29,0,112,7,1,4,145,7,7,0,88,47,38,0,145,47,47,0,66,49,7,47,145,49,49,0,134,45,0,0,156,99,2,0,29,49,0,0,119,0,14,0,88,45,41,0,145,45,45,0,66,30,6,45,145,30,30,0,112,8,1,4,145,8,8,0,88,47,38,0,145,47,47,0,66,49,8,47,145,49,49,0,134,45,0,0,156,99,2,0,30,49,0,0,59,49,0,0,145,49,49,0,59,47,0,0,145,47,47,0,134,45,0,0,52,143,2,0,49,47,0,0,88,9,1,0,145,9,9,0,78,45,37,0,38,45,45,1,121,45,23,0,112,45,1,8,145,45,45,0,63,22,9,45,145,22,22,0,88,45,41,0,145,45,45,0,66,31,22,45,145,31,31,0,112,10,1,4,145,10,10,0,112,45,1,12,145,45,45,0,63,23,10,45,145,23,23,0,88,49,38,0,145,49,49,0,66,47,23,49,145,47,47,0,134,45,0,0,156,99,2,0,31,47,0,0,119,0,18,0,88,45,41,0,145,45,45,0,66,32,9,45,145,32,32,0,112,11,1,4,145,11,11,0,112,45,1,12,145,45,45,0,63,24,11,45,145,24,24,0,88,49,38,0,145,49,49,0,66,47,24,49,145,47,47,0,134,45,0,0,156,99,2,0,32,47,0,0,59,47,0,0,145,47,47,0,112,49,2,12,145,49,49,0,134,45,0,0,52,143,2,0,47,49,0,0,88,12,1,0,145,12,12,0,78,45,37,0,38,45,45,1,121,45,19,0,88,45,41,0,145,45,45,0,66,33,12,45,145,33,33,0,112,13,1,4,145,13,13,0,112,45,1,12,145,45,45,0,63,25,13,45,145,25,25,0,88,47,38,0,145,47,47,0,66,49,25,47,145,49,49,0,134,45,0,0,156,99,2,0,33,49,0,0,119,0,22,0,112,45,1,8,145,45,45,0,63,26,12,45,145,26,26,0,88,45,41,0,145,45,45,0,66,34,26,45,145,34,34,0,112,14,1,4,145,14,14,0,112,45,1,12,145,45,45,0,63,27,14,45,145,27,27,0,88,47,38,0,145,47,47,0,66,49,27,47,145,49,49,0,134,45,0,0,156,99,2,0,34,49,0,0,112,15,2,8,145,15,15,0,112,49,2,12,145,49,49,0,134,45,0,0,52,143,2,0,15,49,0,0,88,16,1,0,145,16,16,0,78,45,37,0,38,45,45,1,121,45,15,0,88,45,41,0,145,45,45,0,66,35,16,45,145,35,35,0,112,17,1,4,145,17,17,0,88,47,38,0,145,47,47,0,66,49,17,47,145,49,49,0,134,45,0,0,156,99,2,0,35,49,0,0,119,0,18,0,112,45,1,8,145,45,45,0,63,28,16,45,145,28,28,0,88,45,41,0,145,45,45,0,66,36,28,45,145,36,36,0,112,18,1,4,145,18,18,0,88,47,38,0,145,47,47,0,66,49,18,47,145,49,49,0,134,45,0,0,156,99,2,0,36,49,0,0,112,49,2,8,145,49,49,0,59,47,0,0,145,47,47,0,134,45,0,0,52,143,2,0,49,47,0,0,134,45,0,0,248,142,1,0,134,45,0,0,96,109,2,0,134,45,0,0,88,157,2,0,137,44,0,0,139,0,0,0,140,23,69,0,0,0,0,0,136,56,0,0,0,55,56,0,136,56,0,0,1,57,80,1,3,56,56,57,137,56,0,0,130,56,0,0,136,57,0,0,49,56,56,57,196,114,1,0,1,57,80,1,135,56,0,0,57,0,0,0,1,56,68,1,3,47,55,56,1,56,60,1,3,37,55,56,1,56,56,1,3,40,55,56,1,56,52,1,3,38,55,56,1,56,48,1,3,39,55,56,1,56,44,1,3,42,55,56,1,56,40,1,3,45,55,56,1,56,36,1,3,43,55,56,1,56,32,1,3,44,55,56,1,56,28,1,3,48,55,56,1,56,24,1,3,50,55,56,1,56,20,1,3,49,55,56,1,56,16,1,3,51,55,56,1,56,12,1,3,52,55,56,1,56,8,1,3,29,55,56,1,56,4,1,3,28,55,56,1,56,0,1,3,34,55,56,1,56,252,0,3,53,55,56,1,56,248,0,3,35,55,56,1,56,244,0,3,54,55,56,1,56,240,0,3,31,55,56,1,56,236,0,3,32,55,56,1,56,232,0,3,30,55,56,25,36,55,12,25,46,55,8,25,41,55,4,0,33,55,0,1,56,64,1,97,55,56,0,85,37,1,0,85,40,2,0,85,38,3,0,85,39,4,0,85,42,5,0,85,45,6,0,85,43,7,0,85,44,8,0,89,48,9,0,89,50,10,0,89,49,11,0,89,51,12,0,85,52,13,0,85,29,14,0,85,28,15,0,85,34,16,0,85,53,17,0,85,35,18,0,85,54,19,0,85,31,20,0,85,32,21,0,85,30,22,0,82,57,40,0,82,58,38,0,82,59,45,0,82,60,43,0,82,61,29,0,134,56,0,0,76,33,2,0,36,57,58,59,60,61,0,0,88,24,48,0,145,24,24,0,88,25,50,0,145,25,25,0,88,26,49,0,145,26,26,0,88,27,51,0,145,27,27,0,82,61,52,0,134,56,0,0,164,146,1,0,36,24,25,26,27,61,0,0,82,61,35,0,82,60,54,0,134,56,0,0,184,50,2,0,36,61,60,0,134,56,0,0,232,45,1,0,36,0,0,0,85,41,56,0,82,60,41,0,135,56,6,0,60,0,0,0,85,33,56,0,82,56,33,0,121,56,28,0,82,60,37,0,82,61,39,0,82,59,42,0,82,58,44,0,82,57,28,0,82,62,34,0,82,63,53,0,82,64,31,0,82,65,32,0,82,66,30,0,82,67,33,0,82,68,41,0,134,56,0,0,212,150,0,0,36,60,61,59,58,57,62,63,64,65,66,67,68,0,0,0,85,46,56,0,82,68,33,0,135,56,8,0,68,0,0,0,116,47,46,0,82,23,47,0,137,55,0,0,139,23,0,0,119,0,6,0,1,56,0,0,85,47,56,0,82,23,47,0,137,55,0,0,139,23,0,0,1,56,0,0,139,56,0,0,140,2,41,0,0,0,0,0,2,34,0,0,101,29,0,0,2,35,0,0,102,29,0,0,2,36,0,0,123,29,0,0,136,37,0,0,0,31,37,0,136,37,0,0,1,38,144,0,3,37,37,38,137,37,0,0,130,37,0,0,136,38,0,0,49,37,37,38,92,117,1,0,1,38,144,0,135,37,0,0,38,0,0,0,25,28,31,24,25,27,31,16,0,26,31,0,25,29,31,120,25,22,31,116,25,23,31,112,25,25,31,48,25,21,31,44,25,24,31,40,1,37,128,0,97,31,37,0,109,31,124,1,1,37,148,117,82,37,37,0,1,38,220,117,82,38,38,0,49,37,37,38,212,119,1,0,1,37,152,117,82,37,37,0,1,38,224,117,82,38,38,0,49,37,37,38,212,119,1,0,1,37,220,117,82,37,37,0,1,38,148,117,82,38,38,0,49,37,37,38,44,118,1,0,1,37,224,117,82,37,37,0,1,38,152,117,82,38,38,0,49,37,37,38,44,118,1,0,1,37,236,117,1,38,148,117,82,38,38,0,85,37,38,0,1,38,240,117,1,37,152,117,82,37,37,0,85,38,37,0,1,37,244,117,1,38,0,0,85,37,38,0,1,38,248,117,1,37,0,0,85,38,37,0,137,31,0,0,139,0,0,0,1,37,152,117,82,5,37,0,1,37,220,117,82,6,37,0,1,37,224,117,82,7,37,0,1,37,148,117,82,37,37,0,85,28,37,0,109,28,4,5,109,28,8,6,109,28,12,7,1,38,3,0,1,39,239,46,134,37,0,0,216,31,2,0,38,39,28,0,1,37,220,117,82,15,37,0,76,37,15,0,145,15,37,0,1,38,224,117,82,39,38,0,76,39,39,0,145,39,39,0,66,37,15,39,145,37,37,0,89,21,37,0,1,37,148,117,82,17,37,0,76,37,17,0,145,17,37,0,1,38,152,117,82,39,38,0,76,39,39,0,145,39,39,0,66,37,17,39,145,37,37,0,89,24,37,0,88,8,21,0,145,8,8,0,88,37,24,0,145,37,37,0,72,37,8,37,121,37,32,0,1,37,236,117,1,39,148,117,82,39,39,0,85,37,39,0,1,39,148,117,82,18,39,0,76,39,18,0,145,18,39,0,1,39,240,117,88,40,21,0,145,40,40,0,66,38,18,40,145,38,38,0,134,37,0,0,28,159,2,0,38,0,0,0,75,37,37,0,85,39,37,0,1,37,244,117,1,39,0,0,85,37,39,0,1,39,248,117,1,37,240,117,82,37,37,0,1,38,152,117,82,38,38,0,4,37,37,38,85,39,37,0,137,31,0,0,139,0,0,0,119,0,31,0,1,37,152,117,82,19,37,0,76,37,19,0,145,19,37,0,1,37,236,117,88,40,21,0,145,40,40,0,65,38,19,40,145,38,38,0,134,39,0,0,28,159,2,0,38,0,0,0,75,39,39,0,85,37,39,0,1,39,240,117,1,37,152,117,82,37,37,0,85,39,37,0,1,37,244,117,1,39,236,117,82,39,39,0,1,38,148,117,82,38,38,0,4,39,39,38,85,37,39,0,1,39,248,117,1,37,0,0,85,39,37,0,137,31,0,0,139,0,0,0,1,37,152,117,82,9,37,0,1,37,220,117,82,10,37,0,1,37,224,117,82,11,37,0,1,37,148,117,82,37,37,0,85,26,37,0,109,26,4,9,109,26,8,10,109,26,12,11,1,39,4,0,1,38,96,46,134,37,0,0,216,31,2,0,39,38,26,0,1,37,220,117,82,12,37,0,76,37,12,0,145,12,37,0,1,39,148,117,82,38,39,0,76,38,38,0,145,38,38,0,66,37,12,38,145,37,37,0,89,29,37,0,1,37,224,117,82,16,37,0,76,37,16,0,145,16,37,0,1,39,152,117,82,38,39,0,76,38,38,0,145,38,38,0,66,37,16,38,145,37,37,0,89,22,37,0,88,2,29,0,145,2,2,0,88,37,22,0,145,37,37,0,72,37,2,37,121,37,30,0,1,37,236,117,1,38,220,117,82,38,38,0,85,37,38,0,1,38,152,117,82,20,38,0,76,38,20,0,145,20,38,0,1,38,240,117,88,40,29,0,145,40,40,0,65,39,20,40,145,39,39,0,134,37,0,0,28,159,2,0,39,0,0,0,75,37,37,0,85,38,37,0,1,37,244,117,1,38,0,0,85,37,38,0,1,38,248,117,1,37,224,117,82,37,37,0,1,39,240,117,82,39,39,0,4,37,37,39,85,38,37,0,119,0,29,0,1,37,148,117,82,13,37,0,76,37,13,0,145,13,37,0,1,37,236,117,88,40,22,0,145,40,40,0,65,39,13,40,145,39,39,0,134,38,0,0,28,159,2,0,39,0,0,0,75,38,38,0,85,37,38,0,1,38,240,117,1,37,224,117,82,37,37,0,85,38,37,0,1,37,244,117,1,38,220,117,82,38,38,0,1,39,236,117,82,39,39,0,4,38,38,39,85,37,38,0,1,38,248,117,1,37,0,0,85,38,37,0,1,37,236,117,82,14,37,0,76,37,14,0,145,14,37,0,1,39,148,117,82,38,39,0,76,38,38,0,145,38,38,0,66,37,14,38,145,37,37,0,89,23,37,0,88,3,23,0,145,3,3,0,88,38,23,0,145,38,38,0,59,39,1,0,145,39,39,0,134,37,0,0,176,52,2,0,25,3,38,39,1,30,156,117,0,32,25,0,25,33,30,64,116,30,32,0,25,30,30,4,25,32,32,4,54,37,30,33,200,121,1,0,1,37,236,117,1,39,220,117,82,39,39,0,85,37,39,0,1,39,240,117,1,37,224,117,82,37,37,0,85,39,37,0,1,37,240,117,82,4,37,0,1,37,236,117,82,37,37,0,85,27,37,0,109,27,4,4,1,39,4,0,1,38,174,46,134,37,0,0,216,31,2,0,39,38,27,0,137,31,0,0,139,0,0,0,140,7,41,0,0,0,0,0,136,33,0,0,0,32,33,0,136,33,0,0,25,33,33,80,137,33,0,0,130,33,0,0,136,34,0,0,49,33,33,34,104,122,1,0,1,34,80,0,135,33,0,0,34,0,0,0,25,26,32,64,25,27,32,60,25,22,32,56,25,16,32,52,25,19,32,48,25,18,32,44,25,31,32,40,25,24,32,36,25,28,32,32,25,23,32,28,25,17,32,24,25,21,32,20,25,20,32,8,25,29,32,4,0,30,32,0,85,26,0,0,85,27,1,0,85,22,2,0,85,16,3,0,85,19,4,0,85,18,5,0,85,31,6,0,1,33,1,0,82,34,26,0,82,34,34,0,22,33,33,34,26,33,33,1,82,34,31,0,47,33,33,34,20,124,1,0,82,33,31,0,1,34,1,0,82,35,26,0,82,35,35,0,22,34,34,35,4,33,33,34,85,24,33,0,82,33,24,0,120,33,3,0,137,32,0,0,139,0,0,0,82,33,27,0,82,34,26,0,25,34,34,4,82,35,24,0,91,34,34,35,4,33,33,34,85,28,33,0,82,33,22,0,82,34,26,0,1,35,4,1,3,34,34,35,82,35,24,0,91,34,34,35,4,33,33,34,85,23,33,0,82,33,16,0,82,34,26,0,1,35,4,2,3,34,34,35,82,35,24,0,91,34,34,35,4,33,33,34,85,17,33,0,82,7,28,0,82,8,23,0,82,9,17,0,82,34,28,0,34,34,34,0,121,34,5,0,1,34,0,0,4,34,34,7,0,33,34,0,119,0,2,0,0,33,7,0,82,35,23,0,34,35,35,0,121,35,5,0,1,35,0,0,4,35,35,8,0,34,35,0,119,0,2,0,0,34,8,0,3,33,33,34,82,35,17,0,34,35,35,0,121,35,5,0,1,35,0,0,4,35,35,9,0,34,35,0,119,0,2,0,0,34,9,0,3,33,33,34,85,21,33,0,82,33,18,0,82,33,33,0,82,34,21,0,49,33,33,34,252,123,1,0,137,32,0,0,139,0,0,0,82,33,19,0,116,33,24,0,82,33,18,0,116,33,21,0,137,32,0,0,139,0,0,0,116,20,27,0,82,34,22,0,109,20,4,34,82,33,16,0,109,20,8,33,82,33,26,0,1,34,4,3,3,33,33,34,82,34,31,0,91,33,33,34,41,33,33,2,3,33,20,33,116,29,33,0,82,33,26,0,1,34,3,4,3,33,33,34,82,34,31,0,91,33,33,34,85,30,33,0,82,10,26,0,82,11,27,0,82,12,22,0,82,13,16,0,82,14,19,0,82,15,18,0,82,33,31,0,41,33,33,1,0,25,33,0,82,33,29,0,82,34,30,0,47,33,33,34,8,125,1,0,134,33,0,0,48,122,1,0,10,11,12,13,14,15,25,0,82,33,18,0,82,33,33,0,82,34,30,0,82,35,29,0,4,34,34,35,49,33,33,34,200,124,1,0,137,32,0,0,139,0,0,0,82,34,26,0,82,35,27,0,82,36,22,0,82,37,16,0,82,38,19,0,82,39,18,0,82,40,31,0,41,40,40,1,25,40,40,1,134,33,0,0,48,122,1,0,34,35,36,37,38,39,40,0,137,32,0,0,139,0,0,0,119,0,29,0,25,40,25,1,134,33,0,0,48,122,1,0,10,11,12,13,14,15,40,0,82,33,18,0,82,33,33,0,82,40,29,0,82,39,30,0,4,40,40,39,49,33,33,40,64,125,1,0,137,32,0,0,139,0,0,0,82,40,26,0,82,39,27,0,82,38,22,0,82,37,16,0,82,36,19,0,82,35,18,0,82,34,31,0,41,34,34,1,134,33,0,0,48,122,1,0,40,39,38,37,36,35,34,0,137,32,0,0,139,0,0,0,139,0,0,0,140,7,34,0,0,0,0,0,1,27,0,0,136,29,0,0,0,28,29,0,136,29,0,0,25,29,29,48,137,29,0,0,130,29,0,0,136,30,0,0,49,29,29,30,184,125,1,0,1,30,48,0,135,29,0,0,30,0,0,0,25,16,28,36,25,23,28,32,25,20,28,28,25,21,28,24,25,19,28,20,25,15,28,16,25,14,28,12,25,17,28,8,25,22,28,4,0,26,28,0,85,16,0,0,89,23,1,0,85,20,2,0,85,21,3,0,89,19,4,0,85,15,5,0,85,14,6,0,82,29,21,0,82,30,20,0,4,24,29,30,88,11,23,0,145,11,11,0,1,32,160,20,82,33,16,0,41,33,33,3,3,32,32,33,106,32,32,4,38,32,32,7,135,31,231,0,32,11,0,0,145,31,31,0,59,32,2,0,145,32,32,0,65,29,31,32,145,29,29,0,135,30,11,0,29,0,0,0,75,30,30,0,47,30,30,24,112,126,1,0,1,29,77,55,1,32,90,48,1,31,67,4,1,33,182,55,135,30,4,0,29,32,31,33,82,30,15,0,116,30,20,0,82,30,15,0,82,33,21,0,109,30,4,33,82,33,15,0,106,33,33,4,82,30,15,0,82,30,30,0,47,33,33,30,180,126,1,0,1,30,223,55,1,31,90,48,1,32,72,4,1,29,182,55,135,33,4,0,30,31,32,29,1,33,0,0,85,17,33,0,82,33,21,0,82,29,20,0,4,33,33,29,82,29,17,0,54,33,33,29,124,127,1,0,82,32,17,0,82,31,20,0,3,29,32,31,76,29,29,0,145,29,29,0,61,31,0,0,0,0,0,63,145,31,31,0,63,33,29,31,145,33,33,0,89,22,33,0,88,7,22,0,145,7,7,0,88,31,19,0,145,31,31,0,64,33,7,31,145,33,33,0,89,26,33,0,88,8,26,0,145,8,8,0,88,9,23,0,145,9,9,0,1,33,160,20,82,31,16,0,41,31,31,3,94,33,33,31,38,33,33,7,135,13,232,0,33,8,9,0,145,13,13,0,88,33,23,0,145,33,33,0,65,18,13,33,145,18,18,0,82,33,14,0,82,31,17,0,41,31,31,2,101,33,31,18,82,31,17,0,25,31,31,1,85,17,31,0,119,0,209,255,82,33,21,0,25,31,33,1,76,31,31,0,145,31,31,0,61,33,0,0,0,0,0,63,145,33,33,0,63,12,31,33,145,12,12,0,88,33,19,0,145,33,33,0,64,25,12,33,145,25,25,0,88,10,23,0,145,10,10,0,1,31,160,20,82,29,16,0,41,29,29,3,94,31,31,29,38,31,31,7,135,33,232,0,31,25,10,0,145,33,33,0,59,31,0,0,145,31,31,0,69,33,33,31,120,33,7,0,1,31,2,56,1,29,90,48,1,32,81,4,1,30,182,55,135,33,4,0,31,29,32,30,82,33,21,0,82,30,20,0,4,33,33,30,85,17,33,0,82,33,17,0,34,33,33,0,121,33,3,0,1,27,14,0,119,0,23,0,82,30,14,0,82,32,17,0,41,32,32,2,100,33,30,32,145,33,33,0,59,30,0,0,145,30,30,0,70,33,33,30,121,33,3,0,1,27,14,0,119,0,12,0,82,33,15,0,82,30,15,0,82,30,30,0,82,32,17,0,3,30,30,32,26,30,30,1,109,33,4,30,82,30,17,0,26,30,30,1,85,17,30,0,119,0,230,255,32,30,27,14,121,30,3,0,137,28,0,0,139,0,0,0,139,0,0,0,140,4,16,0,0,0,0,0,2,9,0,0,8,25,0,0,2,10,0,0,7,25,0,0,2,11,0,0,1,20,0,0,136,12,0,0,0,8,12,0,136,12,0,0,25,12,12,32,137,12,0,0,130,12,0,0,136,13,0,0,49,12,12,13,224,128,1,0,1,13,32,0,135,12,0,0,13,0,0,0,25,4,8,16,25,6,8,12,25,5,8,8,25,7,8,4,85,4,0,0,85,6,1,0,85,5,2,0,85,7,3,0,82,12,6,0,1,13,255,255,85,12,13,0,82,13,5,0,1,12,255,255,85,13,12,0,82,12,7,0,1,13,255,255,85,12,13,0,82,13,4,0,1,14,1,0,1,15,21,0,138,13,14,15,160,129,1,0,196,129,1,0,232,129,1,0,12,130,1,0,40,130,1,0,76,130,1,0,112,130,1,0,140,130,1,0,196,130,1,0,244,130,1,0,36,131,1,0,72,131,1,0,108,131,1,0,144,131,1,0,180,131,1,0,216,131,1,0,252,131,1,0,32,132,1,0,68,132,1,0,104,132,1,0,140,132,1,0,1,12,4,0,1,15,159,43,134,14,0,0,216,31,2,0,12,15,8,0,119,0,197,0,82,12,6,0,1,14,9,25,85,12,14,0,82,14,5,0,1,12,9,25,85,14,12,0,82,12,7,0,85,12,11,0,119,0,188,0,82,12,6,0,1,14,10,25,85,12,14,0,82,14,5,0,1,12,10,25,85,14,12,0,82,12,7,0,85,12,11,0,119,0,179,0,82,12,6,0,85,12,10,0,82,12,5,0,85,12,10,0,82,12,7,0,2,14,0,0,99,131,0,0,85,12,14,0,119,0,170,0,82,14,6,0,85,14,10,0,82,14,5,0,85,14,10,0,82,14,7,0,85,14,11,0,119,0,163,0,82,14,6,0,85,14,9,0,82,14,5,0,85,14,9,0,82,14,7,0,2,12,0,0,52,128,0,0,85,14,12,0,119,0,154,0,82,12,6,0,85,12,9,0,82,12,5,0,85,12,9,0,82,12,7,0,2,14,0,0,51,128,0,0,85,12,14,0,119,0,145,0,82,14,6,0,85,14,9,0,82,14,5,0,85,14,9,0,82,14,7,0,85,14,11,0,119,0,138,0,1,14,164,120,78,14,14,0,38,14,14,1,121,14,4,0,82,14,6,0,1,12,9,25,85,14,12,0,82,12,5,0,1,14,9,25,85,12,14,0,82,14,7,0,1,12,6,20,85,14,12,0,119,0,124,0,1,12,164,120,78,12,12,0,38,12,12,1,121,12,3,0,82,12,6,0,85,12,10,0,82,12,5,0,85,12,10,0,82,12,7,0,1,14,6,20,85,12,14,0,119,0,112,0,1,14,164,120,78,14,14,0,38,14,14,1,121,14,3,0,82,14,6,0,85,14,9,0,82,14,5,0,85,14,9,0,82,14,7,0,1,12,6,20,85,14,12,0,119,0,100,0,1,12,165,120,78,12,12,0,38,12,12,1,121,12,96,0,82,12,6,0,2,14,0,0,240,131,0,0,85,12,14,0,119,0,91,0,1,14,165,120,78,14,14,0,38,14,14,1,121,14,87,0,82,14,6,0,2,12,0,0,241,131,0,0,85,14,12,0,119,0,82,0,1,12,165,120,78,12,12,0,38,12,12,1,121,12,78,0,82,12,6,0,2,14,0,0,242,131,0,0,85,12,14,0,119,0,73,0,1,14,165,120,78,14,14,0,38,14,14,1,121,14,69,0,82,14,6,0,2,12,0,0,243,131,0,0,85,14,12,0,119,0,64,0,1,12,166,120,78,12,12,0,38,12,12,1,121,12,60,0,82,12,6,0,2,14,0,0,100,141,0,0,85,12,14,0,119,0,55,0,1,14,167,120,78,14,14,0,38,14,14,1,121,14,51,0,82,14,6,0,2,12,0,0,116,146,0,0,85,14,12,0,119,0,46,0,1,12,167,120,78,12,12,0,38,12,12,1,121,12,42,0,82,12,6,0,2,14,0,0,120,146,0,0,85,12,14,0,119,0,37,0,1,14,168,120,78,14,14,0,38,14,14,1,121,14,33,0,82,14,6,0,2,12,0,0,0,140,0,0,85,14,12,0,119,0,28,0,1,12,168,120,78,12,12,0,38,12,12,1,121,12,24,0,82,12,6,0,2,14,0,0,2,140,0,0,85,12,14,0,119,0,19,0,1,14,169,120,78,14,14,0,38,14,14,1,121,14,15,0,82,14,6,0,2,12,0,0,176,147,0,0,85,14,12,0,119,0,10,0,1,12,169,120,78,12,12,0,38,12,12,1,121,12,6,0,82,12,6,0,2,14,0,0,183,147,0,0,85,12,14,0,119,0,1,0,137,8,0,0,139,0,0,0,140,3,36,0,0,0,0,0,136,33,0,0,0,28,33,0,136,33,0,0,1,34,160,0,3,33,33,34,137,33,0,0,130,33,0,0,136,34,0,0,49,33,33,34,244,132,1,0,1,34,160,0,135,33,0,0,34,0,0,0,25,20,28,104,25,18,28,96,25,24,28,92,25,19,28,32,25,3,28,24,25,4,28,16,25,9,28,8,0,8,28,0,85,18,0,0,85,24,1,0,109,28,88,2,82,33,18,0,32,33,33,22,121,33,4,0,1,33,1,0,85,19,33,0,119,0,12,0,82,33,18,0,32,33,33,23,121,33,4,0,1,33,0,0,85,19,33,0,119,0,6,0,82,33,18,0,32,33,33,24,121,33,3,0,1,33,2,0,85,19,33,0,82,34,24,0,82,34,34,0,109,19,4,34,82,33,24,0,106,33,33,20,109,19,8,33,25,33,19,8,82,34,24,0,25,34,34,20,106,34,34,52,109,33,4,34,25,21,19,24,82,33,24,0,25,33,33,20,106,34,33,36,76,34,34,0,145,34,34,0,89,3,34,0,82,35,24,0,25,35,35,20,106,33,35,40,76,33,33,0,145,33,33,0,113,3,4,33,116,21,3,0,106,34,3,4,109,21,4,34,25,34,19,24,25,31,34,8,25,34,19,24,25,32,34,8,0,5,31,0,82,33,24,0,25,33,33,20,25,33,33,52,106,34,33,36,76,34,34,0,145,34,34,0,89,4,34,0,82,35,24,0,25,35,35,20,25,35,35,52,106,33,35,40,76,33,33,0,145,33,33,0,113,4,4,33,116,5,4,0,106,34,4,4,109,5,4,34,1,33,39,44,135,34,236,0,33,9,8,0,134,10,0,0,56,162,2,0,76,34,10,0,145,10,34,0,86,34,9,0,145,34,34,0,66,14,10,34,145,14,14,0,25,22,19,24,88,33,22,0,145,33,33,0,65,34,33,14,145,34,34,0,89,22,34,0,134,11,0,0,12,162,2,0,76,34,11,0,145,11,34,0,86,34,8,0,145,34,34,0,66,15,11,34,145,15,15,0,25,34,19,24,25,25,34,4,88,33,25,0,145,33,33,0,65,34,33,15,145,34,34,0,89,25,34,0,134,12,0,0,56,162,2,0,76,34,12,0,145,12,34,0,86,34,9,0,145,34,34,0,66,16,12,34,145,16,16,0,0,6,31,0,88,33,6,0,145,33,33,0,65,34,33,16,145,34,34,0,89,6,34,0,134,13,0,0,12,162,2,0,76,34,13,0,145,13,34,0,86,34,8,0,145,34,34,0,66,17,13,34,145,17,17,0,25,26,32,4,88,33,26,0,145,33,33,0,65,34,33,17,145,34,34,0,89,26,34,0,25,23,19,24,1,34,240,81,82,33,23,0,85,34,33,0,1,33,244,81,106,34,23,4,85,33,34,0,0,7,31,0,1,34,248,81,82,33,7,0,85,34,33,0,1,33,252,81,106,34,7,4,85,33,34,0,0,27,20,0,0,29,19,0,25,30,27,56,116,27,29,0,25,27,27,4,25,29,29,4,54,34,27,30,92,135,1,0,134,34,0,0,188,240,0,0,20,0,0,0,137,28,0,0,1,34,1,0,139,34,0,0,140,2,32,0,0,0,0,0,2,22,0,0,168,0,0,0,2,23,0,0,176,0,0,0,1,18,0,0,136,24,0,0,0,19,24,0,136,24,0,0,25,24,24,64,137,24,0,0,130,24,0,0,136,25,0,0,49,24,24,25,212,135,1,0,1,25,64,0,135,24,0,0,25,0,0,0,25,16,19,52,25,7,19,48,25,10,19,44,25,4,19,40,25,3,19,36,25,17,19,32,25,5,19,28,25,11,19,24,25,8,19,20,25,6,19,16,25,12,19,12,25,15,19,8,25,9,19,4,0,13,19,0,85,16,0,0,85,7,1,0,82,24,16,0,25,24,24,28,116,10,24,0,82,24,16,0,25,24,24,64,116,4,24,0,82,24,16,0,25,24,24,68,116,3,24,0,82,24,16,0,25,24,24,76,116,17,24,0,82,24,16,0,25,24,24,96,116,5,24,0,82,24,16,0,25,24,24,20,116,11,24,0,82,24,16,0,25,24,24,16,116,8,24,0,82,24,17,0,41,24,24,1,82,25,5,0,3,24,24,25,85,6,24,0,82,24,16,0,1,25,180,0,3,24,24,25,116,12,24,0,82,24,16,0,1,25,160,0,94,24,24,25,29,24,24,4,85,15,24,0,82,24,16,0,94,24,24,23,34,24,24,0,121,24,3,0,137,19,0,0,139,0,0,0,82,24,7,0,82,25,16,0,94,25,25,22,49,24,24,25,212,136,1,0,1,18,10,0,119,0,60,0,1,24,0,0,82,25,16,0,94,25,25,22,49,24,24,25,104,137,1,0,82,24,16,0,94,24,24,22,82,25,16,0,106,25,25,24,47,24,24,25,104,137,1,0,82,25,16,0,94,25,25,22,82,26,10,0,5,24,25,26,85,9,24,0,82,26,12,0,82,25,16,0,94,25,25,23,82,27,15,0,134,24,0,0,152,114,2,0,26,25,27,0,85,13,24,0,82,27,16,0,82,25,11,0,82,26,8,0,82,28,9,0,3,26,26,28,82,28,13,0,82,29,4,0,82,30,3,0,82,31,6,0,134,24,0,0,68,110,0,0,27,25,26,28,29,30,31,0,82,2,16,0,82,24,16,0,94,24,24,22,82,31,16,0,1,30,172,0,94,31,31,30,52,24,24,31,192,137,1,0,3,14,2,22,82,24,14,0,25,24,24,1,85,14,24,0,82,24,16,0,3,20,24,23,82,21,16,0,82,24,20,0,25,24,24,1,1,31,164,0,94,31,21,31,8,24,24,31,85,20,24,0,119,0,191,255,32,24,18,10,121,24,3,0,137,19,0,0,139,0,0,0,1,31,255,255,97,2,23,31,82,31,16,0,1,24,0,0,97,31,22,24,82,24,16,0,1,31,172,0,1,30,0,0,97,24,31,30,137,19,0,0,139,0,0,0,140,1,27,0,0,0,0,0,2,19,0,0,168,0,0,0,2,20,0,0,172,0,0,0,2,21,0,0,176,0,0,0,1,15,0,0,136,22,0,0,0,16,22,0,136,22,0,0,25,22,22,32,137,22,0,0,130,22,0,0,136,23,0,0,49,22,22,23,80,138,1,0,1,23,32,0,135,22,0,0,23,0,0,0,25,13,16,24,25,14,16,20,25,12,16,16,25,10,16,12,25,7,16,8,25,8,16,4,0,9,16,0,85,13,0,0,82,23,13,0,112,22,23,60,145,22,22,0,89,12,22,0,59,22,1,0,145,22,22,0,88,23,12,0,145,23,23,0,66,6,22,23,145,6,6,0,1,23,160,20,82,22,13,0,106,22,22,84,41,22,22,3,3,23,23,22,106,23,23,4,38,23,23,7,135,5,231,0,23,6,0,0,145,5,5,0,88,22,12,0,145,22,22,0,65,23,5,22,145,23,23,0,89,10,23,0,82,22,13,0,134,23,0,0,212,145,2,0,22,0,0,0,120,23,7,0,1,22,83,54,1,24,90,48,1,25,21,8,1,26,124,54,135,23,4,0,22,24,25,26,1,23,0,0,85,14,23,0,82,23,13,0,106,23,23,24,82,26,14,0,49,23,23,26,36,139,1,0,1,15,19,0,119,0,100,0,59,23,0,0,145,23,23,0,89,7,23,0,1,23,0,0,85,8,23,0,1,23,0,0,85,9,23,0,88,1,10,0,145,1,1,0,88,2,12,0,145,2,2,0,82,26,14,0,82,24,13,0,112,25,24,52,145,25,25,0,134,23,0,0,108,155,1,0,26,1,2,25,8,9,7,0,82,23,13,0,1,25,164,0,94,23,23,25,82,25,9,0,82,26,8,0,4,25,25,26,25,25,25,1,47,23,23,25,156,139,1,0,1,15,6,0,119,0,70,0,1,23,0,0,82,25,13,0,94,25,25,21,49,23,23,25,56,140,1,0,82,23,8,0,82,25,13,0,94,25,25,19,56,23,23,25,56,140,1,0,82,3,13,0,82,23,13,0,94,23,23,19,82,25,13,0,94,25,25,20,52,23,23,25,24,140,1,0,3,11,3,19,82,23,11,0,25,23,23,1,85,11,23,0,82,23,13,0,3,17,23,21,82,18,13,0,82,23,17,0,25,23,23,1,1,25,164,0,94,25,18,25,8,23,23,25,85,17,23,0,119,0,231,255,1,25,255,255,97,3,21,25,82,25,13,0,1,23,0,0,97,25,19,23,82,23,13,0,1,25,0,0,97,23,20,25,82,25,13,0,94,25,25,21,34,25,25,0,121,25,6,0,82,23,13,0,82,26,8,0,134,25,0,0,128,64,2,0,23,26,0,0,82,4,13,0,82,25,9,0,82,26,13,0,94,26,26,20,56,25,25,26,144,140,1,0,82,26,13,0,94,26,26,20,25,26,26,1,134,25,0,0,128,64,2,0,4,26,0,0,119,0,244,255,82,26,14,0,134,25,0,0,144,17,0,0,4,26,0,0,82,25,14,0,25,25,25,1,85,14,25,0,119,0,151,255,32,25,15,6,121,25,8,0,1,26,152,54,1,23,90,48,1,24,30,8,1,22,124,54,135,25,4,0,26,23,24,22,119,0,5,0,32,25,15,19,121,25,3,0,137,16,0,0,139,0,0,0,139,0,0,0,140,3,42,0,0,0,0,0,2,38,0,0,128,128,128,128,2,39,0,0,255,254,254,254,1,37,0,0,0,3,1,0,21,40,3,0,38,40,40,3,120,40,88,0,33,32,2,0,38,40,3,3,33,40,40,0,19,40,32,40,121,40,29,0,0,8,0,0,0,19,2,0,0,26,1,0,78,4,26,0,83,8,4,0,41,40,4,24,42,40,40,24,120,40,4,0,0,11,8,0,0,24,19,0,119,0,76,0,26,12,19,1,25,13,26,1,25,17,8,1,33,30,12,0,38,40,13,3,33,40,40,0,19,40,30,40,121,40,5,0,0,8,17,0,0,19,12,0,0,26,13,0,119,0,237,255,0,7,17,0,0,18,12,0,0,25,13,0,0,31,30,0,119,0,5,0,0,7,0,0,0,18,2,0,0,25,1,0,0,31,32,0,121,31,47,0,78,40,25,0,120,40,4,0,0,11,7,0,0,24,18,0,119,0,49,0,1,40,3,0,48,40,40,18,68,142,1,0,0,21,18,0,0,34,7,0,0,36,25,0,82,5,36,0,19,40,5,38,21,40,40,38,2,41,0,0,1,1,1,1,4,41,5,41,19,40,40,41,121,40,5,0,0,20,21,0,0,33,34,0,0,35,36,0,119,0,19,0,85,34,5,0,26,29,21,4,25,14,36,4,25,15,34,4,1,40,3,0,48,40,40,29,52,142,1,0,0,21,29,0,0,34,15,0,0,36,14,0,119,0,234,255,0,20,29,0,0,33,15,0,0,35,14,0,119,0,4,0,0,20,18,0,0,33,7,0,0,35,25,0,0,9,33,0,0,22,20,0,0,27,35,0,1,37,13,0,119,0,8,0,0,11,7,0,1,24,0,0,119,0,5,0,0,9,0,0,0,22,2,0,0,27,1,0,1,37,13,0,32,40,37,13,121,40,25,0,120,22,4,0,0,11,9,0,1,24,0,0,119,0,21,0,0,10,9,0,0,23,22,0,0,28,27,0,78,6,28,0,83,10,6,0,41,40,6,24,42,40,40,24,120,40,4,0,0,11,10,0,0,24,23,0,119,0,10,0,26,23,23,1,25,16,10,1,120,23,4,0,0,11,16,0,1,24,0,0,119,0,4,0,0,10,16,0,25,28,28,1,119,0,240,255,1,41,0,0,135,40,3,0,11,41,24,0,139,11,0,0,140,0,30,0,0,0,0,0,2,24,0,0,247,28,0,0,2,25,0,0,192,81,0,0,136,26,0,0,0,7,26,0,136,26,0,0,25,26,26,32,137,26,0,0,130,26,0,0,136,27,0,0,49,26,26,27,64,143,1,0,1,27,32,0,135,26,0,0,27,0,0,0,25,0,7,16,25,3,7,12,25,1,7,8,25,5,7,4,0,4,7,0,1,26,220,115,82,26,26,0,27,26,26,48,94,26,25,26,1,27,220,115,82,27,27,0,27,27,27,48,3,27,25,27,106,27,27,8,46,26,26,27,36,145,1,0,1,26,220,115,82,26,26,0,27,26,26,48,3,8,25,26,82,26,8,0,106,27,8,8,4,26,26,27,85,0,26,0,1,26,0,0,85,3,26,0,82,26,0,0,82,27,3,0,56,26,26,27,36,145,1,0,1,26,220,115,82,26,26,0,27,26,26,48,3,9,25,26,1,26,220,115,82,26,26,0,27,26,26,48,3,26,25,26,106,10,26,20,1,26,220,115,82,26,26,0,27,26,26,48,3,26,25,26,106,26,26,8,41,26,26,2,0,11,26,0,26,27,11,4,90,27,10,27], eb + 92160);
  HEAPU8.set([95,10,11,27,1,27,220,115,82,27,27,0,27,27,27,48,3,12,25,27,1,27,220,115,82,27,27,0,27,27,27,48,3,27,25,27,106,13,27,20,1,27,220,115,82,27,27,0,27,27,27,48,3,27,25,27,106,27,27,8,41,27,27,2,0,14,27,0,25,27,14,1,26,26,14,3,90,26,13,26,95,13,27,26,1,26,220,115,82,26,26,0,27,26,26,48,3,15,25,26,1,26,220,115,82,26,26,0,27,26,26,48,3,26,25,26,106,16,26,20,1,26,220,115,82,26,26,0,27,26,26,48,3,26,25,26,106,26,26,8,41,26,26,2,0,17,26,0,25,26,17,2,26,27,17,2,90,27,16,27,95,16,26,27,1,27,220,115,82,27,27,0,27,27,27,48,3,18,25,27,1,27,220,115,82,27,27,0,27,27,27,48,3,27,25,27,106,19,27,20,1,27,220,115,82,27,27,0,27,27,27,48,3,27,25,27,106,27,27,8,41,27,27,2,0,20,27,0,25,27,20,3,26,26,20,1,90,26,19,26,95,19,27,26,1,26,220,115,82,26,26,0,27,26,26,48,3,26,25,26,25,2,26,8,82,26,2,0,25,26,26,1,85,2,26,0,82,26,3,0,25,26,26,1,85,3,26,0,119,0,162,255,1,26,220,115,82,26,26,0,27,26,26,48,94,26,25,26,1,27,220,115,82,27,27,0,27,27,27,48,3,27,25,27,106,27,27,4,46,26,26,27,20,146,1,0,1,26,220,115,82,26,26,0,27,26,26,48,3,21,25,26,82,26,21,0,106,27,21,4,4,26,26,27,85,1,26,0,1,26,0,0,85,5,26,0,82,26,1,0,82,27,5,0,56,26,26,27,20,146,1,0,1,26,220,115,82,26,26,0,27,26,26,48,3,22,25,26,106,26,22,16,106,27,22,4,41,27,27,1,41,27,27,2,59,28,0,0,145,28,28,0,101,26,27,28,1,28,220,115,82,28,28,0,27,28,28,48,3,23,25,28,106,28,23,16,106,27,23,4,41,27,27,1,25,27,27,1,41,27,27,2,59,26,0,0,145,26,26,0,101,28,27,26,1,26,220,115,82,26,26,0,27,26,26,48,3,26,25,26,25,6,26,4,82,26,6,0,25,26,26,1,85,6,26,0,82,26,5,0,25,26,26,1,85,5,26,0,119,0,218,255,1,26,148,29,1,29,148,29,88,28,29,0,145,28,28,0,62,29,0,0,50,236,172,223,226,54,10,63,145,29,29,0,63,27,28,29,145,27,27,0,89,26,27,0,1,27,220,115,82,27,27,0,27,27,27,48,94,27,25,27,1,26,252,31,47,27,27,26,100,146,1,0,137,7,0,0,139,0,0,0,1,27,144,115,82,27,27,0,85,4,27,0,82,27,4,0,34,27,27,0,120,27,7,0,134,27,0,0,96,109,2,0,82,27,4,0,26,27,27,1,85,4,27,0,119,0,248,255,134,27,0,0,208,155,2,0,137,7,0,0,139,0,0,0,140,6,39,0,0,0,0,0,136,37,0,0,0,36,37,0,136,37,0,0,25,37,37,32,137,37,0,0,130,37,0,0,136,38,0,0,49,37,37,38,220,146,1,0,1,38,32,0,135,37,0,0,38,0,0,0,25,28,36,20,25,31,36,16,25,33,36,12,25,32,36,8,25,34,36,4,0,35,36,0,85,28,0,0,89,31,1,0,89,33,2,0,89,32,3,0,89,34,4,0,85,35,5,0,88,6,31,0,145,6,6,0,82,37,28,0,113,37,32,6,88,11,33,0,145,11,11,0,82,37,28,0,113,37,36,11,88,16,32,0,145,16,16,0,82,37,28,0,113,37,40,16,88,19,34,0,145,19,19,0,82,37,28,0,113,37,44,19,82,37,35,0,121,37,24,0,82,37,35,0,88,7,37,0,145,7,7,0,82,37,28,0,113,37,56,7,82,37,35,0,112,8,37,4,145,8,8,0,82,37,28,0,113,37,60,8,82,37,35,0,112,9,37,8,145,9,9,0,82,37,28,0,113,37,48,9,82,37,35,0,112,10,37,12,145,10,10,0,82,37,28,0,113,37,52,10,137,36,0,0,139,0,0,0,119,0,79,0,82,37,28,0,106,20,37,20,76,37,20,0,145,20,37,0,82,38,28,0,106,37,38,4,76,37,37,0,145,37,37,0,66,22,20,37,145,22,22,0,88,12,32,0,145,12,12,0,88,38,31,0,145,38,38,0,64,37,12,38,145,37,37,0,66,27,22,37,145,27,27,0,82,37,28,0,113,37,56,27,82,37,28,0,106,21,37,24,76,37,21,0,145,21,37,0,82,38,28,0,106,37,38,8,76,37,37,0,145,37,37,0,66,23,21,37,145,23,23,0,88,13,34,0,145,13,13,0,88,38,33,0,145,38,38,0,64,37,13,38,145,37,37,0,66,24,23,37,145,24,24,0,82,37,28,0,113,37,60,24,88,14,31,0,145,14,14,0,82,38,28,0,106,37,38,20,76,37,37,0,145,37,37,0,65,29,14,37,145,29,29,0,88,15,32,0,145,15,15,0,88,38,31,0,145,38,38,0,64,37,15,38,145,37,37,0,66,25,29,37,145,25,25,0,82,37,28,0,113,37,48,25,88,17,33,0,145,17,17,0,82,38,28,0,106,37,38,24,76,37,37,0,145,37,37,0,65,30,17,37,145,30,30,0,88,18,34,0,145,18,18,0,88,38,33,0,145,38,38,0,64,37,18,38,145,37,37,0,66,26,30,37,145,26,26,0,82,37,28,0,113,37,52,26,137,36,0,0,139,0,0,0,139,0,0,0,140,1,25,0,0,0,0,0,2,19,0,0,172,0,0,0,1,16,0,0,136,20,0,0,0,17,20,0,136,20,0,0,25,20,20,48,137,20,0,0,130,20,0,0,136,21,0,0,49,20,20,21,48,149,1,0,1,21,48,0,135,20,0,0,21,0,0,0,25,14,17,36,25,15,17,32,25,13,17,28,25,11,17,24,25,6,17,20,25,12,17,16,25,7,17,12,25,8,17,8,25,9,17,4,0,10,17,0,85,14,0,0,82,21,14,0,112,20,21,60,145,20,20,0,89,13,20,0,82,20,14,0,25,20,20,24,116,11,20,0,88,4,13,0,145,4,4,0,1,20,160,20,82,21,14,0,106,21,21,84,41,21,21,3,3,20,20,21,106,20,20,4,38,20,20,7,135,5,231,0,20,4,0,0,145,5,5,0,88,21,13,0,145,21,21,0,66,20,5,21,145,20,20,0,89,6,20,0,82,20,14,0,1,21,148,0,3,20,20,21,116,12,20,0,82,20,14,0,106,20,20,8,82,21,12,0,3,20,20,21,85,7,20,0,82,21,14,0,134,20,0,0,212,145,2,0,21,0,0,0,121,20,7,0,1,21,240,50,1,22,90,48,1,23,122,8,1,24,26,51,135,20,4,0,21,22,23,24,1,20,0,0,82,24,12,0,4,20,20,24,85,15,20,0,82,20,7,0,82,24,15,0,49,20,20,24,52,150,1,0,1,16,16,0,119,0,73,0,88,1,6,0,145,1,1,0,88,2,13,0,145,2,2,0,82,24,15,0,82,22,14,0,112,23,22,52,145,23,23,0,134,20,0,0,44,157,1,0,24,1,2,23,9,10,8,0,82,20,14,0,1,23,164,0,94,20,20,23,82,23,10,0,82,24,9,0,4,23,23,24,25,23,23,1,47,20,20,23,144,150,1,0,1,16,6,0,119,0,50,0,1,20,0,0,82,23,10,0,49,20,20,23,68,151,1,0,82,20,9,0,82,23,11,0,47,20,20,23,68,151,1,0,82,23,14,0,82,24,9,0,134,20,0,0,136,135,1,0,23,24,0,0,82,24,14,0,82,23,15,0,134,20,0,0,100,54,2,0,24,23,0,0,82,20,14,0,1,23,176,0,94,20,20,23,34,20,20,0,121,20,6,0,82,23,14,0,82,24,9,0,134,20,0,0,200,253,1,0,23,24,0,0,82,3,14,0,82,20,10,0,82,24,14,0,94,24,24,19,56,20,20,24,52,151,1,0,82,24,14,0,94,24,24,19,25,24,24,1,134,20,0,0,200,253,1,0,3,24,0,0,119,0,244,255,82,24,15,0,134,20,0,0,92,184,0,0,3,24,0,0,82,20,15,0,25,20,20,1,85,15,20,0,119,0,179,255,32,20,16,6,121,20,8,0,1,24,56,51,1,23,90,48,1,22,131,8,1,21,26,51,135,20,4,0,24,23,22,21,119,0,10,0,32,20,16,16,121,20,8,0,82,18,14,0,106,21,18,24,134,20,0,0,136,135,1,0,18,21,0,0,137,17,0,0,139,0,0,0,139,0,0,0,140,2,20,0,0,0,0,0,2,13,0,0,0,0,128,127,2,14,0,0,255,0,0,0,2,15,0,0,255,255,255,127,1,12,0,0,127,16,0,0,89,16,1,0,127,16,0,0,82,9,16,0,19,16,9,15,0,3,16,0,48,16,13,3,236,151,1,0,1,12,3,0,119,0,219,0,127,16,0,0,89,16,0,0,127,16,0,0,82,2,16,0,19,16,2,15,0,4,16,0,48,16,13,4,20,152,1,0,1,12,3,0,119,0,209,0,2,16,0,0,0,0,128,63,45,16,9,16,56,152,1,0,134,6,0,0,88,210,1,0,0,0,0,0,145,6,6,0,119,0,200,0,43,16,2,31,0,7,16,0,43,16,9,30,38,16,16,2,20,16,16,7,0,5,16,0,120,4,23,0,38,16,5,3,1,17,0,0,1,18,4,0,138,16,17,18,120,152,1,0,128,152,1,0,132,152,1,0,152,152,1,0,119,0,14,0,58,6,0,0,119,0,182,0,119,0,254,255,62,6,0,0,80,53,221,95,251,33,9,64,145,6,6,0,119,0,176,0,62,6,0,0,80,53,221,95,251,33,9,192,145,6,6,0,119,0,171,0,19,16,9,15,0,10,16,0,47,16,10,13,16,153,1,0,1,16,0,0,1,17,1,0,138,10,16,17,208,152,1,0,119,0,83,0,119,0,1,0,32,17,7,0,121,17,7,0,62,17,0,0,80,53,221,95,251,33,249,63,145,17,17,0,58,16,17,0,119,0,6,0,62,17,0,0,80,53,221,95,251,33,249,191,145,17,17,0,58,16,17,0,58,6,16,0,119,0,146,0,2,16,0,0,0,0,128,127,1,17,1,0,138,10,16,17,40,153,1,0,119,0,61,0,119,0,1,0,19,16,5,14,0,8,16,0,45,16,4,13,176,153,1,0,38,16,8,3,1,17,0,0,1,18,4,0,138,16,17,18,96,153,1,0,116,153,1,0,136,153,1,0,156,153,1,0,119,0,47,0,62,6,0,0,80,53,221,95,251,33,233,63,145,6,6,0,119,0,121,0,62,6,0,0,80,53,221,95,251,33,233,191,145,6,6,0,119,0,116,0,62,6,0,0,222,30,132,128,124,217,2,64,145,6,6,0,119,0,111,0,62,6,0,0,222,30,132,128,124,217,2,192,145,6,6,0,119,0,106,0,38,16,8,3,1,17,0,0,1,18,4,0,138,16,17,18,212,153,1,0,224,153,1,0,240,153,1,0,4,154,1,0,119,0,18,0,59,6,0,0,145,6,6,0,119,0,94,0,61,6,0,0,0,0,0,128,145,6,6,0,119,0,90,0,62,6,0,0,80,53,221,95,251,33,9,64,145,6,6,0,119,0,85,0,62,6,0,0,80,53,221,95,251,33,9,192,145,6,6,0,119,0,80,0,13,16,4,13,2,17,0,0,0,0,0,13,3,17,3,17,16,17,17,4,20,16,16,17,121,16,16,0,32,17,7,0,121,17,7,0,62,17,0,0,80,53,221,95,251,33,249,63,145,17,17,0,58,16,17,0,119,0,6,0,62,17,0,0,80,53,221,95,251,33,249,191,145,17,17,0,58,16,17,0,58,6,16,0,119,0,58,0,34,16,9,0,2,17,0,0,0,0,0,13,3,17,4,17,16,17,17,3,19,16,16,17,121,16,4,0,59,11,0,0,145,11,11,0,119,0,10,0,66,17,0,1,145,17,17,0,135,16,237,0,17,0,0,0,145,16,16,0,134,11,0,0,88,210,1,0,16,0,0,0,145,11,11,0,38,16,5,3,1,17,0,0,1,18,3,0,138,16,17,18,12,155,1,0,20,155,1,0,32,155,1,0,62,17,0,0,193,73,171,191,165,119,119,62,145,17,17,0,63,18,11,17,145,18,18,0,62,17,0,0,80,53,221,95,251,33,9,192,145,17,17,0,63,6,18,17,145,6,6,0,119,0,19,0,58,6,11,0,119,0,17,0,68,6,11,0,145,6,6,0,119,0,14,0,62,17,0,0,80,53,221,95,251,33,9,64,145,17,17,0,62,19,0,0,193,73,171,191,165,119,119,62,145,19,19,0,63,18,11,19,145,18,18,0,64,6,17,18,145,6,6,0,119,0,1,0,32,16,12,3,121,16,3,0,63,6,0,1,145,6,6,0,145,16,6,0,139,16,0,0,140,7,34,0,0,0,0,0,136,31,0,0,0,30,31,0,136,31,0,0,25,31,31,48,137,31,0,0,130,31,0,0,136,32,0,0,49,31,31,32,164,155,1,0,1,32,48,0,135,31,0,0,32,0,0,0,25,23,30,44,25,24,30,40,25,29,30,36,25,28,30,32,25,19,30,28,25,20,30,24,25,18,30,20,25,25,30,16,25,26,30,12,25,27,30,8,25,21,30,4,0,22,30,0,85,23,0,0,89,24,1,0,89,29,2,0,89,28,3,0,85,19,4,0,85,20,5,0,85,18,6,0,82,32,23,0,76,32,32,0,145,32,32,0,61,33,0,0,0,0,0,63,145,33,33,0,63,31,32,33,145,31,31,0,89,25,31,0,88,7,25,0,145,7,7,0,88,33,24,0,145,33,33,0,64,31,7,33,145,31,31,0,89,26,31,0,88,9,25,0,145,9,9,0,88,33,24,0,145,33,33,0,63,31,9,33,145,31,31,0,89,27,31,0,88,10,26,0,145,10,10,0,88,31,28,0,145,31,31,0,63,12,10,31,145,12,12,0,88,33,29,0,145,33,33,0,66,31,12,33,145,31,31,0,89,21,31,0,88,11,27,0,145,11,11,0,88,31,28,0,145,31,31,0,63,13,11,31,145,13,13,0,88,33,29,0,145,33,33,0,66,31,13,33,145,31,31,0,89,22,31,0,88,8,25,0,145,8,8,0,88,31,28,0,145,31,31,0,63,14,8,31,145,14,14,0,88,31,29,0,145,31,31,0,66,17,14,31,145,17,17,0,82,31,18,0,89,31,17,0,88,33,21,0,145,33,33,0,61,32,0,0,0,0,0,63,63,33,33,32,135,31,238,0,33,0,0,0,75,16,31,0,82,31,19,0,85,31,16,0,88,33,22,0,145,33,33,0,61,32,0,0,0,0,0,63,64,33,33,32,135,31,238,0,33,0,0,0,75,15,31,0,82,31,20,0,85,31,15,0,137,30,0,0,139,0,0,0,140,7,34,0,0,0,0,0,136,31,0,0,0,30,31,0,136,31,0,0,25,31,31,48,137,31,0,0,130,31,0,0,136,32,0,0,49,31,31,32,100,157,1,0,1,32,48,0,135,31,0,0,32,0,0,0,25,21,30,44,25,17,30,40,25,28,30,36,25,27,30,32,25,23,30,28,25,24,30,24,25,22,30,20,25,14,30,16,25,15,30,12,25,16,30,8,25,25,30,4,0,26,30,0,85,21,0,0,89,17,1,0,89,28,2,0,89,27,3,0,85,23,4,0,85,24,5,0,85,22,6,0,82,32,21,0,76,32,32,0,145,32,32,0,61,33,0,0,0,0,0,63,145,33,33,0,63,31,32,33,145,31,31,0,89,14,31,0,88,7,14,0,145,7,7,0,88,33,17,0,145,33,33,0,64,31,7,33,145,31,31,0,89,15,31,0,88,9,14,0,145,9,9,0,88,33,17,0,145,33,33,0,63,31,9,33,145,31,31,0,89,16,31,0,88,10,15,0,145,10,10,0,88,31,28,0,145,31,31,0,65,18,10,31,145,18,18,0,88,33,27,0,145,33,33,0,64,31,18,33,145,31,31,0,89,25,31,0,88,11,16,0,145,11,11,0,88,31,28,0,145,31,31,0,65,19,11,31,145,19,19,0,88,33,27,0,145,33,33,0,64,31,19,33,145,31,31,0,89,26,31,0,88,8,14,0,145,8,8,0,88,31,28,0,145,31,31,0,65,20,8,31,145,20,20,0,88,31,27,0,145,31,31,0,64,29,20,31,145,29,29,0,82,31,22,0,89,31,29,0,88,33,25,0,145,33,33,0,61,32,0,0,0,0,0,63,63,33,33,32,135,31,238,0,33,0,0,0,75,13,31,0,82,31,23,0,85,31,13,0,88,33,26,0,145,33,33,0,61,32,0,0,0,0,0,63,64,33,33,32,135,31,238,0,33,0,0,0,75,12,31,0,82,31,24,0,85,31,12,0,137,30,0,0,139,0,0,0,140,6,25,0,0,0,0,0,1,16,0,0,136,19,0,0,0,17,19,0,136,19,0,0,25,19,19,48,137,19,0,0,130,19,0,0,136,20,0,0,49,19,19,20,40,159,1,0,1,20,48,0,135,19,0,0,20,0,0,0,25,10,17,36,25,11,17,32,25,13,17,28,25,15,17,24,25,8,17,20,25,14,17,16,25,12,17,12,25,9,17,8,25,6,17,4,0,7,17,0,85,10,0,0,85,11,1,0,85,13,2,0,85,15,3,0,85,8,4,0,85,14,5,0,82,20,15,0,82,21,8,0,5,19,20,21,85,12,19,0,1,19,0,0,85,9,19,0,82,19,12,0,82,21,9,0,57,19,19,21,32,161,1,0,82,19,10,0,121,19,41,0,82,19,10,0,79,19,19,0,82,21,11,0,79,21,21,0,45,19,19,21,48,160,1,0,82,19,10,0,103,19,19,1,82,21,11,0,103,21,21,1,45,19,19,21,40,160,1,0,82,19,10,0,103,19,19,2,82,21,11,0,103,21,21,2,45,19,19,21,32,160,1,0,82,19,13,0,82,21,10,0,78,21,21,0,83,19,21,0,82,21,13,0,82,19,10,0,102,19,19,1,107,21,1,19,82,19,13,0,82,21,10,0,102,21,21,2,107,19,2,21,82,21,13,0,1,19,0,0,107,21,3,19,119,0,8,0,1,16,8,0,119,0,6,0,1,16,8,0,119,0,4,0,1,16,8,0,119,0,2,0,1,16,8,0,32,19,16,8,121,19,41,0,1,16,0,0,2,19,0,0,64,66,15,0,85,6,19,0,1,19,1,0,85,7,19,0,82,18,11,0,82,21,14,0,82,20,11,0,79,20,20,0,103,22,18,1,103,23,18,2,1,24,1,0,134,19,0,0,48,122,1,0,21,20,22,23,7,6,24,0,82,19,13,0,82,24,14,0,25,24,24,4,82,23,7,0,90,24,24,23,83,19,24,0,82,24,13,0,82,19,14,0,1,23,4,1,3,19,19,23,82,23,7,0,90,19,19,23,107,24,1,19,82,19,13,0,82,24,14,0,1,23,4,2,3,24,24,23,82,23,7,0,90,24,24,23,107,19,2,24,82,24,13,0,82,19,7,0,107,24,3,19,82,19,10,0,121,19,4,0,82,19,10,0,25,19,19,4,85,10,19,0,82,19,13,0,25,19,19,4,85,13,19,0,82,19,11,0,25,19,19,4,85,11,19,0,82,19,9,0,25,19,19,1,85,9,19,0,119,0,153,255,137,17,0,0,139,0,0,0,140,7,31,0,0,0,0,0,136,27,0,0,0,24,27,0,136,27,0,0,1,28,128,0,3,27,27,28,137,27,0,0,130,27,0,0,136,28,0,0,49,27,27,28,100,161,1,0,1,28,128,0,135,27,0,0,28,0,0,0,25,13,24,40,25,16,24,32,25,7,24,24,25,22,24,16,25,14,24,8,0,11,24,0,25,15,24,64,25,17,24,56,25,21,24,52,25,12,24,48,87,13,1,0,87,16,2,0,87,7,3,0,87,22,4,0,87,14,5,0,87,11,6,0,0,23,15,0,25,26,23,64,1,27,0,0,85,23,27,0,25,23,23,4,54,27,23,26,172,161,1,0,86,28,16,0,86,29,13,0,64,27,28,29,145,27,27,0,89,17,27,0,86,29,22,0,86,28,7,0,64,27,29,28,145,27,27,0,89,21,27,0,86,28,11,0,86,29,14,0,64,27,28,29,145,27,27,0,89,12,27,0,59,29,2,0,145,29,29,0,88,28,17,0,145,28,28,0,66,27,29,28,145,27,27,0,89,15,27,0,59,28,0,0,145,28,28,0,113,15,16,28,59,27,0,0,145,27,27,0,113,15,32,27,59,28,0,0,145,28,28,0,113,15,48,28,59,27,0,0,145,27,27,0,113,15,4,27,59,29,2,0,145,29,29,0,88,30,21,0,145,30,30,0,66,28,29,30,145,28,28,0,113,15,20,28,59,27,0,0,145,27,27,0,113,15,36,27,59,28,0,0,145,28,28,0,113,15,52,28,59,27,0,0,145,27,27,0,113,15,8,27,59,28,0,0,145,28,28,0,113,15,24,28,59,30,254,255,145,30,30,0,88,29,12,0,145,29,29,0,66,27,30,29,145,27,27,0,113,15,40,27,59,28,0,0,145,28,28,0,113,15,56,28,86,10,13,0,145,10,10,0,86,27,16,0,145,27,27,0,63,28,10,27,145,28,28,0,68,20,28,0,145,20,20,0,88,29,17,0,145,29,29,0,66,27,20,29,145,27,27,0,113,15,12,27,86,8,22,0,145,8,8,0,86,28,7,0,145,28,28,0,63,27,8,28,145,27,27,0,68,18,27,0,145,18,18,0,88,29,21,0,145,29,29,0,66,28,18,29,145,28,28,0,113,15,28,28,86,9,11,0,145,9,9,0,86,27,14,0,145,27,27,0,63,28,9,27,145,28,28,0,68,19,28,0,145,19,19,0,88,29,12,0,145,29,29,0,66,27,19,29,145,27,27,0,113,15,44,27,59,28,1,0,145,28,28,0,113,15,60,28,0,23,0,0,0,25,15,0,25,26,23,64,116,23,25,0,25,23,23,4,25,25,25,4,54,28,23,26,112,163,1,0,137,24,0,0,139,0,0,0,140,2,19,0,0,0,0,0,136,14,0,0,0,13,14,0,136,14,0,0,25,14,14,112,137,14,0,0,130,14,0,0,136,15,0,0,49,14,14,15,196,163,1,0,1,15,112,0,135,14,0,0,15,0,0,0,0,11,13,0,25,5,13,104,25,10,13,100,25,8,13,96,25,9,13,32,25,12,13,28,25,6,13,24,25,3,13,20,25,7,13,16,25,4,13,12,85,5,1,0,1,14,0,0,85,10,14,0,82,15,5,0,1,16,192,47,134,14,0,0,116,100,2,0,15,16,0,0,85,8,14,0,82,14,8,0,120,14,10,0,116,11,5,0,1,16,4,0,1,15,66,59,134,14,0,0,216,31,2,0,16,15,11,0,82,2,10,0,137,13,0,0,139,2,0,0,1,15,107,59,1,16,12,0,135,14,239,0,9,15,16,0,1,16,0,0,109,9,12,16,1,14,0,0,109,9,16,14,1,16,1,0,109,9,20,16,1,14,0,0,109,9,24,14,1,16,0,0,109,9,28,16,1,14,0,0,109,9,32,14,106,16,0,4,109,9,36,16,106,14,0,8,109,9,40,14,1,16,0,0,109,9,44,16,1,14,0,0,109,9,48,14,1,16,1,0,109,9,52,16,106,14,0,12,109,9,56,14,1,16,0,0,109,9,60,16,106,14,0,16,25,15,9,28,25,17,9,24,25,18,9,16,134,16,0,0,144,128,1,0,14,15,17,18,106,18,9,24,109,9,32,18,106,18,9,24,32,18,18,255,121,18,8,0,1,16,4,0,1,17,119,59,25,15,13,8,134,18,0,0,216,31,2,0,16,17,15,0,119,0,58,0,1,15,64,0,1,17,1,0,82,16,8,0,134,18,0,0,128,127,2,0,9,15,17,16,85,10,18,0,25,18,0,4,116,12,18,0,25,18,0,8,116,6,18,0,1,18,0,0,85,3,18,0,1,18,0,0,85,7,18,0,106,18,0,12,82,16,7,0,56,18,18,16,228,165,1,0,82,16,12,0,82,17,6,0,106,15,0,16,134,18,0,0,212,9,2,0,16,17,15,0,85,4,18,0,1,15,4,0,1,17,1,0,82,16,8,0,134,18,0,0,128,127,2,0,4,15,17,16,85,10,18,0,82,16,0,0,82,17,3,0,3,16,16,17,82,17,4,0,1,15,1,0,82,14,8,0,134,18,0,0,128,127,2,0,16,17,15,14,85,10,18,0,82,18,12,0,28,18,18,2,85,12,18,0,82,18,6,0,28,18,18,2,85,6,18,0,82,18,3,0,82,14,4,0,3,18,18,14,85,3,18,0,82,18,7,0,25,18,18,1,85,7,18,0,119,0,215,255,82,14,8,0,134,18,0,0,128,108,2,0,14,0,0,0,82,2,10,0,137,13,0,0,139,2,0,0,140,3,36,0,0,0,0,0,2,31,0,0,128,128,128,128,2,32,0,0,255,254,254,254,2,33,0,0,255,0,0,0,1,30,0,0,19,34,1,33,0,7,34,0,33,26,2,0,38,34,0,3,33,34,34,0,19,34,26,34,121,34,29,0,19,34,1,33,0,4,34,0,0,14,2,0,0,21,0,0,78,34,21,0,41,35,4,24,42,35,35,24,45,34,34,35,116,166,1,0,0,13,14,0,0,20,21,0,1,30,6,0,119,0,20,0,25,9,21,1,26,8,14,1,33,24,8,0,38,34,9,3,33,34,34,0,19,34,24,34,121,34,4,0,0,14,8,0,0,21,9,0,119,0,238,255,0,12,8,0,0,19,9,0,0,25,24,0,1,30,5,0,119,0,5,0,0,12,2,0,0,19,0,0,0,25,26,0,1,30,5,0,32,34,30,5,121,34,7,0,121,25,5,0,0,13,12,0,0,20,19,0,1,30,6,0,119,0,2,0,1,30,16,0,32,34,30,6,121,34,71,0,19,34,1,33,0,5,34,0,78,34,20,0,41,35,5,24,42,35,35,24,45,34,34,35,24,167,1,0,120,13,3,0,1,30,16,0,119,0,61,0,0,6,20,0,119,0,59,0,2,34,0,0,1,1,1,1,5,11,7,34,1,34,3,0,48,34,34,13,156,167,1,0,0,17,13,0,0,28,20,0,82,34,28,0,21,34,34,11,0,29,34,0,19,34,29,31,21,34,34,31,2,35,0,0,1,1,1,1,4,35,29,35,19,34,34,35,121,34,4,0,0,3,28,0,0,16,17,0,119,0,16,0,25,10,28,4,26,23,17,4,1,34,3,0,48,34,34,23,140,167,1,0,0,17,23,0,0,28,10,0,119,0,236,255,0,15,23,0,0,27,10,0,1,30,11,0,119,0,4,0,0,15,13,0,0,27,20,0,1,30,11,0,32,34,30,11,121,34,6,0,120,15,3,0,1,30,16,0,119,0,18,0,0,3,27,0,0,16,15,0,0,18,16,0,0,22,3,0,78,34,22,0,41,35,5,24,42,35,35,24,45,34,34,35,232,167,1,0,0,6,22,0,119,0,7,0,26,18,18,1,120,18,3,0,1,30,16,0,119,0,3,0,25,22,22,1,119,0,244,255,32,34,30,16,121,34,2,0,1,6,0,0,139,6,0,0,140,7,31,0,0,0,0,0,136,21,0,0,0,20,21,0,136,21,0,0,25,21,21,64,137,21,0,0,130,21,0,0,136,22,0,0,49,21,21,22,72,168,1,0,1,22,64,0,135,21,0,0,22,0,0,0,25,13,20,44,25,14,20,40,25,19,20,36,25,10,20,32,25,7,20,28,25,8,20,48,25,16,20,24,25,11,20,20,25,9,20,16,25,15,20,12,25,12,20,8,25,18,20,4,0,17,20,0,85,13,0,0,85,14,1,0,85,19,2,0,85,10,3,0,85,7,4,0,38,21,5,1,83,8,21,0,85,16,6,0,82,21,16,0,116,21,7,0,82,22,19,0,82,23,10,0,5,21,22,23,41,21,21,2,85,11,21,0,82,23,11,0,135,21,6,0,23,0,0,0,85,9,21,0,82,23,9,0,82,22,14,0,82,24,11,0,135,21,29,0,23,22,24,0,82,24,19,0,82,22,10,0,5,21,24,22,85,15,21,0,82,21,13,0,121,21,8,0,82,22,13,0,82,24,9,0,82,23,15,0,134,21,0,0,172,242,1,0,22,24,23,0,85,15,21,0,1,21,1,0,82,23,7,0,22,21,21,23,85,12,21,0,82,21,12,0,28,21,21,2,85,18,21,0,82,21,18,0,28,21,21,2,85,17,21,0,82,23,9,0,82,24,15,0,1,22,1,0,82,25,12,0,82,26,18,0,82,27,17,0,1,28,1,0,78,29,8,0,38,29,29,1,82,30,16,0,134,21,0,0,164,131,0,0,23,24,22,25,26,27,28,29,30,0,0,0,82,30,9,0,135,21,8,0,30,0,0,0,82,21,16,0,1,30,3,4,3,21,21,30,1,30,1,0,82,29,7,0,26,29,29,1,22,30,30,29,1,29,0,0,95,21,30,29,82,29,16,0,1,30,4,3,3,29,29,30,1,30,1,0,82,21,7,0,26,21,21,1,22,30,30,21,1,21,0,0,95,29,30,21,82,21,16,0,1,30,4,2,1,29,0,0,95,21,30,29,82,29,16,0,1,30,4,1,1,21,0,0,95,29,30,21,82,21,16,0,1,30,0,0,107,21,4,30,137,20,0,0,139,0,0,0,140,4,37,0,0,0,0,0,2,33,0,0,255,0,0,0,2,34,0,0,255,255,0,0,37,35,1,20,121,35,183,0,1,35,9,0,1,36,10,0,138,1,35,36,84,170,1,0,140,170,1,0,216,170,1,0,28,171,1,0,100,171,1,0,192,171,1,0,8,172,1,0,100,172,1,0,172,172,1,0,228,172,1,0,119,0,169,0,82,35,2,0,1,36,4,0,26,36,36,1,3,35,35,36,1,36,4,0,26,36,36,1,11,36,36,0,19,35,35,36,0,17,35,0,82,22,17,0,25,35,17,4,85,2,35,0,85,0,22,0,119,0,155,0,82,35,2,0,1,36,4,0,26,36,36,1,3,35,35,36,1,36,4,0,26,36,36,1,11,36,36,0,19,35,35,36,0,6,35,0,82,7,6,0,25,35,6,4,85,2,35,0,0,8,0,0,85,8,7,0,34,36,7,0,41,36,36,31,42,36,36,31,109,8,4,36,119,0,136,0,82,36,2,0,1,35,4,0,26,35,35,1,3,36,36,35,1,35,4,0,26,35,35,1,11,35,35,0,19,36,36,35,0,9,36,0,82,10,9,0,25,36,9,4,85,2,36,0,0,11,0,0,85,11,10,0,1,35,0,0,109,11,4,35,119,0,119,0,82,35,2,0,1,36,8,0,26,36,36,1,3,35,35,36,1,36,8,0,26,36,36,1,11,36,36,0,19,35,35,36,0,12,35,0,0,13,12,0,82,14,13,0,106,15,13,4,25,35,12,8,85,2,35,0,0,16,0,0,85,16,14,0,109,16,4,15,119,0,101,0,82,35,2,0,1,36,4,0,26,36,36,1,3,35,35,36,1,36,4,0,26,36,36,1,11,36,36,0,19,35,35,36,0,18,35,0,82,19,18,0,25,35,18,4,85,2,35,0,19,35,19,34,41,35,35,16,42,35,35,16,0,20,35,0,0,21,0,0,85,21,20,0,34,36,20,0,41,36,36,31,42,36,36,31,109,21,4,36,119,0,78,0,82,36,2,0,1,35,4,0,26,35,35,1,3,36,36,35,1,35,4,0,26,35,35,1,11,35,35,0,19,36,36,35,0,23,36,0,82,24,23,0,25,36,23,4,85,2,36,0,0,25,0,0,19,36,24,34,85,25,36,0,1,35,0,0,109,25,4,35,119,0,60,0,82,35,2,0,1,36,4,0,26,36,36,1,3,35,35,36,1,36,4,0,26,36,36,1,11,36,36,0,19,35,35,36,0,26,35,0,82,27,26,0,25,35,26,4,85,2,35,0,19,35,27,33,41,35,35,24,42,35,35,24,0,28,35,0,0,29,0,0,85,29,28,0,34,36,28,0,41,36,36,31,42,36,36,31,109,29,4,36,119,0,37,0,82,36,2,0,1,35,4,0,26,35,35,1,3,36,36,35,1,35,4,0,26,35,35,1,11,35,35,0,19,36,36,35,0,30,36,0,82,31,30,0,25,36,30,4,85,2,36,0,0,32,0,0,19,36,31,33,85,32,36,0,1,35,0,0,109,32,4,35,119,0,19,0,82,35,2,0,1,36,8,0,26,36,36,1,3,35,35,36,1,36,8,0,26,36,36,1,11,36,36,0,19,35,35,36,0,4,35,0,86,5,4,0,25,35,4,8,85,2,35,0,87,0,5,0,119,0,5,0,38,36,3,63,135,35,233,0,36,0,2,0,119,0,1,0,139,0,0,0,140,5,26,0,0,0,0,0,136,22,0,0,0,21,22,0,136,22,0,0,1,23,80,2,3,22,22,23,137,22,0,0,130,22,0,0,136,23,0,0,49,22,22,23,52,173,1,0,1,23,80,2,135,22,0,0,23,0,0,0,1,22,56,2,3,18,21,22,1,22,48,2,3,16,21,22,1,22,40,2,3,15,21,22,1,22,32,2,3,14,21,22,1,22,16,2,3,19,21,22,1,22,8,2,3,17,21,22,1,22,0,2,3,13,21,22,1,22,76,2,3,20,21,22,1,22,72,2,3,10,21,22,1,22,64,2,3,7,21,22,1,22,60,2,3,11,21,22,0,12,21,0,85,20,0,0,85,10,1,0,1,22,68,2,97,21,22,2,85,7,3,0,85,11,4,0,82,22,10,0,1,23,0,1,13,22,22,23,82,23,7,0,32,23,23,1,19,22,22,23,121,22,7,0,82,23,20,0,1,24,1,0,135,22,240,0,23,24,0,0,137,21,0,0,139,0,0,0,82,22,10,0,1,24,45,1,13,22,22,24,82,24,7,0,32,24,24,1,19,22,22,24,120,22,7,0,1,22,64,82,82,24,10,0,82,23,7,0,95,22,24,23,137,21,0,0,139,0,0,0,82,23,11,0,33,23,23,2,121,23,18,0,1,23,12,118,82,23,23,0,85,18,23,0,1,22,53,46,134,24,0,0,204,124,2,0,22,18,0,0,134,23,0,0,180,2,2,0,24,0,0,0,1,23,12,118,1,24,12,118,82,24,24,0,25,24,24,1,85,23,24,0,137,21,0,0,139,0,0,0,1,24,181,120,78,24,24,0,38,24,24,1,121,24,40,0,134,24,0,0,152,131,2,0,1,24,181,120,1,23,0,0,83,24,23,0,1,23,12,118,82,23,23,0,26,23,23,1,85,13,23,0,1,23,176,45,134,9,0,0,204,124,2,0,23,13,0,0,1,23,12,118,82,23,23,0,26,23,23,1,85,17,23,0,1,23,176,45,134,8,0,0,204,124,2,0,23,17,0,0,85,19,9,0,109,19,4,8,1,22,194,45,134,24,0,0,204,124,2,0,22,19,0,0,135,23,241,0,24,0,0,0,1,24,3,0,1,22,229,45,1,25,24,2,3,25,21,25,134,23,0,0,216,31,2,0,24,22,25,0,137,21,0,0,139,0,0,0,119,0,58,0,1,23,181,120,1,25,1,0,83,23,25,0,1,25,16,118,1,23,0,0,85,25,23,0,1,25,0,0,1,22,0,2,135,23,3,0,12,25,22,0,1,23,12,118,82,23,23,0,85,14,23,0,1,25,0,46,134,22,0,0,204,124,2,0,25,14,0,0,135,23,17,0,12,22,0,0,1,23,148,117,82,5,23,0,1,23,152,117,82,6,23,0,134,25,0,0,88,161,2,0,145,25,25,0,59,24,10,0,145,24,24,0,65,22,25,24,145,22,22,0,75,22,22,0,1,24,8,0,1,25,0,0,134,23,0,0,36,222,1,0,12,5,6,22,24,25,0,0,1,23,12,118,1,25,12,118,82,25,25,0,25,25,25,1,85,23,25,0,1,25,12,118,82,25,25,0,85,15,25,0,1,23,176,45,134,25,0,0,204,124,2,0,23,15,0,0,85,16,25,0,1,23,3,0,1,24,20,46,134,25,0,0,216,31,2,0,23,24,16,0,137,21,0,0,139,0,0,0,139,0,0,0,140,3,26,0,0,0,0,0,136,16,0,0,0,14,16,0,136,16,0,0,25,16,16,64,137,16,0,0,130,16,0,0,136,17,0,0,49,16,16,17,44,176,1,0,1,17,64,0,135,16,0,0,17,0,0,0,25,3,14,44,25,8,14,40,25,10,14,36,25,9,14,32,25,12,14,28,25,11,14,24,25,7,14,20,0,13,14,0,85,8,0,0,85,10,1,0,85,9,2,0,82,16,8,0,82,16,16,0,120,16,3,0,137,14,0,0,139,0,0,0,82,16,8,0,106,16,16,4,120,16,3,0,137,14,0,0,139,0,0,0,82,16,8,0,106,16,16,8,120,16,3,0,137,14,0,0,139,0,0,0,82,6,8,0,116,3,6,0,106,17,6,4,109,3,4,17,106,16,6,8,109,3,8,16,106,17,6,12,109,3,12,17,106,16,6,16,109,3,16,16,134,16,0,0,184,219,0,0,3,0,0,0,85,12,16,0,82,18,10,0,82,19,9,0,5,17,18,19,41,17,17,2,135,16,6,0,17,0,0,0,85,11,16,0,82,15,8,0,82,17,12,0,106,19,15,4,106,18,15,8,1,20,0,0,82,21,11,0,82,22,10,0,82,23,9,0,1,24,0,0,1,25,4,0,134,16,0,0,220,230,1,0,17,19,18,20,21,22,23,24,25,0,0,0,82,16,8,0,25,16,16,16,116,7,16,0,82,4,8,0,116,3,4,0,106,25,4,4,109,3,4,25,106,16,4,8,109,3,8,16,106,25,4,12,109,3,12,25,106,16,4,16,109,3,16,16,134,16,0,0,236,159,2,0,3,0,0,0,82,5,8,0,82,25,11,0,82,24,10,0,82,23,9,0,134,16,0,0,64,227,1,0,13,25,24,23,116,5,13,0,106,23,13,4,109,5,4,23,106,16,13,8,109,5,8,16,106,23,13,12,109,5,12,23,106,16,13,16,109,5,16,16,82,23,8,0,82,24,7,0,134,16,0,0,92,72,0,0,23,24,0,0,82,24,11,0,135,16,8,0,24,0,0,0,82,24,12,0,135,16,8,0,24,0,0,0,137,14,0,0,139,0,0,0,140,3,19,0,0,0,0,0,136,15,0,0,0,12,15,0,136,15,0,0,1,16,80,1,3,15,15,16,137,15,0,0,130,15,0,0,136,16,0,0,49,15,15,16,20,178,1,0,1,16,80,1,135,15,0,0,16,0,0,0,1,15,8,1,3,8,12,15,1,15,128,0,3,9,12,15,1,15,0,1,3,5,12,15,1,15,192,0,3,7,12,15,25,6,12,64,0,10,12,0,85,5,0,0,0,11,7,0,0,13,1,0,25,14,11,64,116,11,13,0,25,11,11,4,25,13,13,4,54,15,11,14,76,178,1,0,0,11,6,0,0,13,2,0,25,14,11,64,116,11,13,0,25,11,11,4,25,13,13,4,54,15,11,14,108,178,1,0,82,16,5,0,1,17,240,115,82,17,17,0,5,15,16,17,28,4,15,2,1,17,0,0,1,16,240,115,82,16,16,0,28,16,16,2,1,18,244,115,82,18,18,0,134,15,0,0,8,127,2,0,4,17,16,18,1,15,128,116,82,18,5,0,41,18,18,6,3,3,15,18,0,11,9,0,0,13,2,0,25,14,11,64,116,11,13,0,25,11,11,4,25,13,13,4,54,18,11,14,212,178,1,0,0,11,8,0,0,13,3,0,25,14,11,64,116,11,13,0,25,11,11,4,25,13,13,4,54,18,11,14,244,178,1,0,134,18,0,0,28,176,0,0,10,9,8,0,0,11,6,0,0,13,10,0,25,14,11,64,116,11,13,0,25,11,11,4,25,13,13,4,54,18,11,14,32,179,1,0,0,11,7,0,1,18,0,116,82,15,5,0,41,15,15,6,3,13,18,15,25,14,11,64,116,11,13,0,25,11,11,4,25,13,13,4,54,15,11,14,76,179,1,0,0,11,8,0,0,13,6,0,25,14,11,64,116,11,13,0,25,11,11,4,25,13,13,4,54,15,11,14,108,179,1,0,134,15,0,0,28,151,2,0,8,0,0,0,0,11,8,0,0,13,7,0,25,14,11,64,116,11,13,0,25,11,11,4,25,13,13,4,54,15,11,14,152,179,1,0,134,15,0,0,240,150,2,0,8,0,0,0,137,12,0,0,139,0,0,0,140,0,15,0,0,0,0,0,136,8,0,0,0,7,8,0,136,8,0,0,25,8,8,32,137,8,0,0,130,8,0,0,136,9,0,0,49,8,8,9,248,179,1,0,1,9,32,0,135,8,0,0,9,0,0,0,25,2,7,20,25,3,7,8,25,0,7,16,25,1,7,12,0,6,7,0,134,8,0,0,208,155,2,0,1,8,181,120,78,8,8,0,38,8,8,1,121,8,92,0,1,8,16,118,1,9,16,118,82,9,9,0,25,9,9,1,85,8,9,0,1,9,16,118,82,9,9,0,30,9,9,10,120,9,24,0,1,8,148,117,82,8,8,0,1,10,152,117,82,10,10,0,134,9,0,0,236,240,1,0,8,10,0,0,85,3,9,0,82,10,3,0,1,8,148,117,82,8,8,0,1,11,152,117,82,11,11,0,1,12,10,0,1,13,8,0,1,14,0,0,134,9,0,0,172,233,1,0,10,8,11,12,13,14,0,0,82,14,3,0,135,9,8,0,14,0,0,0,1,9,16,118,82,9,9,0,28,9,9,15,30,9,9,2,32,9,9,1,121,9,52,0,1,9,152,117,82,9,9,0,26,4,9,20,1,9,230,255,83,0,9,0,1,14,41,0,107,0,1,14,1,9,55,0,107,0,2,9,1,14,255,255,107,0,3,14,78,14,0,0,83,2,14,0,102,9,0,1,107,2,1,9,102,14,0,2,107,2,2,14,102,9,0,3,107,2,3,9,1,14,30,0,59,13,10,0,145,13,13,0,134,9,0,0,0,25,2,0,14,4,13,2,1,9,152,117,82,9,9,0,26,5,9,25,1,9,190,255,83,1,9,0,1,13,33,0,107,1,1,13,1,9,55,0,107,1,2,9,1,13,255,255,107,1,3,13,78,13,1,0,83,2,13,0,102,9,1,1,107,2,1,9,102,13,1,2,107,2,2,13,102,9,1,3,107,2,3,9,1,13,87,47,1,14,50,0,1,12,10,0,134,9,0,0,224,208,1,0,13,14,5,12,2,0,0,0,134,9,0,0,208,155,2,0,134,9,0,0,20,161,2,0,134,9,0,0,96,200,1,0,1,9,240,114,134,12,0,0,128,162,2,0,87,9,12,0,1,12,0,115,1,9,240,114,86,9,9,0,1,14,224,114,86,14,14,0,64,9,9,14,87,12,9,0,1,9,224,114,1,12,240,114,86,12,12,0,87,9,12,0,1,12,232,114,1,9,248,114,86,9,9,0,1,14,0,115,86,14,14,0,63,9,9,14,87,12,9,0,1,9,232,114,86,9,9,0,59,12,0,0,71,9,9,12,120,9,3,0,137,7,0,0,139,0,0,0,59,13,0,0,1,11,232,114,86,11,11,0,64,14,13,11,145,14,14,0,59,11,232,3,145,11,11,0,65,12,14,11,145,12,12,0,134,9,0,0,164,116,2,0,12,0,0,0,1,9,240,114,134,12,0,0,128,162,2,0,87,9,12,0,1,12,240,114,86,12,12,0,1,9,224,114,86,9,9,0,64,12,12,9,87,6,12,0,1,12,224,114,1,9,240,114,86,9,9,0,87,12,9,0,1,9,232,114,1,12,232,114,86,12,12,0,86,11,6,0,63,12,12,11,87,9,12,0,137,7,0,0,139,0,0,0,140,2,22,0,0,0,0,0,136,18,0,0,0,17,18,0,136,18,0,0,25,18,18,48,137,18,0,0,130,18,0,0,136,19,0,0,49,18,18,19,212,182,1,0,1,19,48,0,135,18,0,0,19,0,0,0,25,14,17,16,25,13,17,8,0,12,17,0,25,11,17,44,25,5,17,40,25,8,17,36,25,10,17,32,25,7,17,28,25,6,17,24,25,9,17,20,85,11,0,0,85,5,1,0,1,18,0,0,85,8,18,0,1,18,0,0,85,10,18,0,135,18,242,0,85,8,18,0,82,19,8,0,82,20,11,0,135,18,243,0,19,20,0,0,82,20,8,0,82,19,5,0,135,18,243,0,20,19,0,0,82,19,8,0,1,20,0,0,1,21,178,40,135,18,244,0,19,20,21,0,82,21,8,0,1,20,1,0,1,19,193,40,135,18,244,0,21,20,19,0,82,19,8,0,1,20,2,0,1,21,36,41,135,18,244,0,19,20,21,0,82,21,8,0,1,20,3,0,1,19,208,40,135,18,244,0,21,20,19,0,82,19,8,0,1,20,4,0,1,21,49,41,135,18,244,0,19,20,21,0,82,21,8,0,1,20,5,0,1,19,63,41,135,18,244,0,21,20,19,0,82,19,8,0,135,18,245,0,19,0,0,0,82,19,8,0,2,20,0,0,130,139,0,0,135,18,246,0,19,20,10,0,82,2,8,0,82,18,10,0,120,18,57,0,85,12,2,0,1,20,4,0,1,19,79,41,134,18,0,0,216,31,2,0,20,19,12,0,1,18,0,0,85,7,18,0], eb + 102400);
  HEAPU8.set([82,19,8,0,2,20,0,0,132,139,0,0,135,18,246,0,19,20,7,0,82,3,7,0,135,18,247,0,85,9,18,0,0,16,3,0,136,18,0,0,0,15,18,0,136,18,0,0,27,20,16,1,25,20,20,15,38,20,20,240,3,18,18,20,137,18,0,0,130,18,0,0,136,20,0,0,49,18,18,20,104,184,1,0,27,20,16,1,25,20,20,15,38,20,20,240,135,18,0,0,20,0,0,0,82,20,8,0,82,19,7,0,135,18,248,0,20,19,6,15,85,13,15,0,1,19,3,0,1,20,125,41,134,18,0,0,216,31,2,0,19,20,13,0,82,20,8,0,135,18,249,0,20,0,0,0,1,18,0,0,85,8,18,0,82,20,9,0,135,18,250,0,20,0,0,0,82,4,8,0,137,17,0,0,139,4,0,0,119,0,10,0,85,14,2,0,1,20,3,0,1,19,128,41,134,18,0,0,216,31,2,0,20,19,14,0,82,4,8,0,137,17,0,0,139,4,0,0,1,18,0,0,139,18,0,0,140,3,26,0,0,0,0,0,136,23,0,0,0,17,23,0,136,23,0,0,1,24,128,0,3,23,23,24,137,23,0,0,130,23,0,0,136,24,0,0,49,23,23,24,40,185,1,0,1,24,128,0,135,23,0,0,24,0,0,0,25,8,17,56,25,11,17,40,0,9,17,0,25,13,17,36,25,14,17,32,25,15,17,28,25,10,17,16,25,7,17,4,89,13,0,0,89,14,1,0,89,15,2,0,88,23,13,0,145,23,23,0,89,10,23,0,88,24,14,0,145,24,24,0,113,10,4,24,88,23,15,0,145,23,23,0,113,10,8,23,1,23,160,120,78,23,23,0,38,23,23,1,121,23,22,0,116,11,10,0,106,24,10,4,109,11,4,24,106,23,10,8,109,11,8,23,0,16,8,0,1,18,148,115,25,19,16,64,116,16,18,0,25,16,16,4,25,18,18,4,54,23,16,19,168,185,1,0,134,23,0,0,64,220,1,0,7,11,8,0,116,10,7,0,106,24,7,4,109,10,4,24,106,23,7,8,109,10,8,23,1,23,192,81,1,24,220,115,82,24,24,0,27,24,24,48,94,23,23,24,1,24,0,32,47,23,23,24,236,186,1,0,88,5,10,0,145,5,5,0,1,23,192,81,1,24,220,115,82,24,24,0,27,24,24,48,3,20,23,24,106,24,20,12,82,23,20,0,27,23,23,3,41,23,23,2,101,24,23,5,112,3,10,4,145,3,3,0,1,23,192,81,1,24,220,115,82,24,24,0,27,24,24,48,3,21,23,24,106,24,21,12,82,23,21,0,27,23,23,3,25,23,23,1,41,23,23,2,101,24,23,3,112,4,10,8,145,4,4,0,1,23,192,81,1,24,220,115,82,24,24,0,27,24,24,48,3,22,23,24,106,24,22,12,82,23,22,0,27,23,23,3,25,23,23,2,41,23,23,2,101,24,23,4,1,23,192,81,1,24,220,115,82,24,24,0,27,24,24,48,3,6,23,24,82,24,6,0,25,24,24,1,85,6,24,0,1,24,212,115,82,24,24,0,1,23,216,115,82,23,23,0,26,23,23,1,41,23,23,4,3,24,24,23,25,12,24,4,82,24,12,0,25,24,24,1,85,12,24,0,137,17,0,0,139,0,0,0,119,0,8,0,1,23,5,0,1,25,233,30,134,24,0,0,216,31,2,0,23,25,9,0,137,17,0,0,139,0,0,0,139,0,0,0,140,1,23,0,0,0,0,0,127,10,0,0,89,10,0,0,127,10,0,0,82,1,10,0,2,10,0,0,255,255,255,127,19,10,1,10,0,3,10,0,2,10,0,0,255,255,127,63,48,10,10,3,176,187,1,0,2,10,0,0,0,0,128,63,45,10,3,10,144,187,1,0,34,11,1,0,121,11,7,0,62,11,0,0,252,222,166,63,251,33,9,64,145,11,11,0,58,10,11,0,119,0,4,0,59,11,0,0,145,11,11,0,58,10,11,0,58,9,10,0,145,10,9,0,139,10,0,0,119,0,9,0,59,10,0,0,145,10,10,0,64,11,0,0,145,11,11,0,66,9,10,11,145,9,9,0,145,11,9,0,139,11,0,0,2,11,0,0,0,0,0,63,48,11,3,11,192,188,1,0,2,11,0,0,1,0,128,50,48,11,3,11,232,187,1,0,62,9,0,0,252,222,166,63,251,33,249,63,145,9,9,0,145,11,9,0,139,11,0,0,65,6,0,0,145,6,6,0,62,11,0,0,252,222,166,63,251,33,249,63,145,11,11,0,62,13,0,0,105,182,47,0,45,68,116,62,145,13,13,0,62,20,0,0,122,198,19,64,119,226,165,191,145,20,20,0,62,22,0,0,224,255,229,95,109,186,129,63,145,22,22,0,65,21,6,22,145,21,21,0,64,19,20,21,145,19,19,0,65,18,6,19,145,18,18,0,62,19,0,0,37,239,15,160,78,85,197,63,145,19,19,0,63,17,18,19,145,17,17,0,65,16,6,17,145,16,16,0,59,19,1,0,145,19,19,0,62,21,0,0,44,67,13,192,181,156,230,63,145,21,21,0,65,18,6,21,145,18,18,0,64,17,19,18,145,17,17,0,66,15,16,17,145,15,15,0,65,14,15,0,145,14,14,0,64,12,13,14,145,12,12,0,64,10,0,12,145,10,10,0,64,9,11,10,145,9,9,0,145,10,9,0,139,10,0,0,34,10,1,0,121,10,71,0,59,11,1,0,145,11,11,0,63,10,0,11,145,10,10,0,61,11,0,0,0,0,0,63,145,11,11,0,65,7,10,11,145,7,7,0,145,11,7,0,135,4,230,0,11,0,0,0,145,4,4,0,62,10,0,0,252,222,166,63,251,33,249,63,145,10,10,0,62,21,0,0,122,198,19,64,119,226,165,191,145,21,21,0,62,22,0,0,224,255,229,95,109,186,129,63,145,22,22,0,65,20,7,22,145,20,20,0,64,19,21,20,145,19,19,0,65,18,7,19,145,18,18,0,62,19,0,0,37,239,15,160,78,85,197,63,145,19,19,0,63,16,18,19,145,16,16,0,65,17,7,16,145,17,17,0,59,19,1,0,145,19,19,0,62,20,0,0,44,67,13,192,181,156,230,63,145,20,20,0,65,18,7,20,145,18,18,0,64,16,19,18,145,16,16,0,66,15,17,16,145,15,15,0,65,13,15,4,145,13,13,0,62,15,0,0,105,182,47,0,45,68,116,190,145,15,15,0,63,14,13,15,145,14,14,0,63,12,4,14,145,12,12,0,64,11,10,12,145,11,11,0,59,12,2,0,145,12,12,0,65,9,11,12,145,9,9,0,145,12,9,0,139,12,0,0,119,0,79,0,59,11,1,0,145,11,11,0,64,12,11,0,145,12,12,0,61,11,0,0,0,0,0,63,145,11,11,0,65,8,12,11,145,8,8,0,145,11,8,0,135,5,230,0,11,0,0,0,145,5,5,0,127,11,0,0,127,12,0,0,89,12,5,0,127,12,0,0,82,12,12,0,1,10,0,240,19,12,12,10,85,11,12,0,127,12,0,0,88,2,12,0,145,2,2,0,62,18,0,0,122,198,19,64,119,226,165,191,145,18,18,0,62,20,0,0,224,255,229,95,109,186,129,63,145,20,20,0,65,19,8,20,145,19,19,0,64,17,18,19,145,17,17,0,65,16,8,17,145,16,16,0,62,17,0,0,37,239,15,160,78,85,197,63,145,17,17,0,63,13,16,17,145,13,13,0,65,15,8,13,145,15,15,0,59,17,1,0,145,17,17,0,62,19,0,0,44,67,13,192,181,156,230,63,145,19,19,0,65,16,8,19,145,16,16,0,64,13,17,16,145,13,13,0,66,14,15,13,145,14,14,0,65,10,14,5,145,10,10,0,65,15,2,2,145,15,15,0,64,13,8,15,145,13,13,0,63,15,5,2,145,15,15,0,66,14,13,15,145,14,14,0,63,11,10,14,145,11,11,0,63,12,11,2,145,12,12,0,59,11,2,0,145,11,11,0,65,9,12,11,145,9,9,0,145,11,9,0,139,11,0,0,59,11,0,0,145,11,11,0,139,11,0,0,140,4,25,0,0,0,0,0,136,23,0,0,0,19,23,0,136,23,0,0,1,24,112,1,3,23,23,24,137,23,0,0,130,23,0,0,136,24,0,0,49,23,23,24,96,191,1,0,1,24,112,1,135,23,0,0,24,0,0,0,1,23,40,1,3,4,19,23,1,23,232,0,3,11,19,23,1,23,228,0,3,8,19,23,1,23,224,0,3,15,19,23,1,23,220,0,3,16,19,23,1,23,216,0,3,17,19,23,1,23,152,0,3,10,19,23,1,23,140,0,3,9,19,23,1,23,128,0,3,7,19,23,25,13,19,64,0,14,19,0,89,8,0,0,89,15,1,0,89,16,2,0,89,17,3,0,134,23,0,0,244,119,2,0,10,0,0,0,88,23,15,0,145,23,23,0,89,9,23,0,88,24,16,0,145,24,24,0,113,9,4,24,88,23,17,0,145,23,23,0,113,9,8,23,116,4,9,0,106,24,9,4,109,4,4,24,106,23,9,8,109,4,8,23,134,23,0,0,112,11,2,0,7,4,0,0,88,23,8,0,145,23,23,0,62,24,0,0,20,25,67,160,70,223,145,63,145,24,24,0,65,12,23,24,145,12,12,0,116,4,7,0,106,23,7,4,109,4,4,23,106,24,7,8,109,4,8,24,134,24,0,0,212,80,1,0,13,4,12,0,0,18,10,0,0,20,13,0,25,21,18,64,116,18,20,0,25,18,18,4,25,20,20,4,54,24,18,21,92,192,1,0,1,24,76,115,82,22,24,0,0,5,22,0,0,6,22,0,0,18,11,0,0,20,10,0,25,21,18,64,116,18,20,0,25,18,18,4,25,20,20,4,54,24,18,21,140,192,1,0,0,18,4,0,0,20,6,0,25,21,18,64,116,18,20,0,25,18,18,4,25,20,20,4,54,24,18,21,172,192,1,0,134,24,0,0,28,176,0,0,14,11,4,0,0,18,5,0,0,20,14,0,25,21,18,64,116,18,20,0,25,18,18,4,25,20,20,4,54,24,18,21,216,192,1,0,137,19,0,0,139,0,0,0,140,1,15,0,0,0,0,0,136,12,0,0,0,8,12,0,136,12,0,0,1,13,16,1,3,12,12,13,137,12,0,0,130,12,0,0,136,13,0,0,49,12,12,13,48,193,1,0,1,13,16,1,135,12,0,0,13,0,0,0,1,12,200,0,3,4,8,12,1,12,136,0,3,1,8,12,1,12,128,0,3,5,8,12,25,3,8,64,0,6,8,0,85,5,0,0,82,13,5,0,88,12,13,0,145,12,12,0,89,3,12,0,82,14,5,0,112,13,14,16,145,13,13,0,113,3,4,13,82,14,5,0,112,12,14,32,145,12,12,0,113,3,8,12,82,14,5,0,112,13,14,48,145,13,13,0,113,3,12,13,82,14,5,0,112,12,14,4,145,12,12,0,113,3,16,12,82,14,5,0,112,13,14,20,145,13,13,0,113,3,20,13,82,14,5,0,112,12,14,36,145,12,12,0,113,3,24,12,82,14,5,0,112,13,14,52,145,13,13,0,113,3,28,13,82,14,5,0,112,12,14,8,145,12,12,0,113,3,32,12,82,14,5,0,112,13,14,24,145,13,13,0,113,3,36,13,82,14,5,0,112,12,14,40,145,12,12,0,113,3,40,12,82,14,5,0,112,13,14,56,145,13,13,0,113,3,44,13,82,14,5,0,112,12,14,12,145,12,12,0,113,3,48,12,82,14,5,0,112,13,14,28,145,13,13,0,113,3,52,13,82,14,5,0,112,12,14,44,145,12,12,0,113,3,56,12,82,14,5,0,112,13,14,60,145,13,13,0,113,3,60,13,1,13,76,115,82,11,13,0,0,2,11,0,0,7,1,0,0,9,11,0,25,10,7,64,116,7,9,0,25,7,7,4,25,9,9,4,54,13,7,10,108,194,1,0,0,7,4,0,0,9,3,0,25,10,7,64,116,7,9,0,25,7,7,4,25,9,9,4,54,13,7,10,140,194,1,0,134,13,0,0,28,176,0,0,6,1,4,0,0,7,2,0,0,9,6,0,25,10,7,64,116,7,9,0,25,7,7,4,25,9,9,4,54,13,7,10,184,194,1,0,137,8,0,0,139,0,0,0,140,2,22,0,0,0,0,0,136,16,0,0,0,15,16,0,136,16,0,0,25,16,16,48,137,16,0,0,130,16,0,0,136,17,0,0,49,16,16,17,12,195,1,0,1,17,48,0,135,16,0,0,17,0,0,0,25,9,15,28,25,14,15,8,0,13,15,0,25,8,15,24,25,12,15,20,25,10,15,16,25,11,15,12,85,8,1,0,1,16,0,0,85,12,16,0,116,9,0,0,106,17,0,4,109,9,4,17,106,16,0,8,109,9,8,16,106,17,0,12,109,9,12,17,106,16,0,16,109,9,16,16,134,16,0,0,184,219,0,0,9,0,0,0,85,10,16,0,82,16,8,0,1,17,94,58,134,5,0,0,128,250,1,0,16,17,0,0,82,2,8,0,121,5,13,0,106,16,0,4,106,18,0,8,1,19,4,0,82,20,10,0,106,21,0,4,41,21,21,2,134,17,0,0,48,249,1,0,2,16,18,19,20,21,0,0,85,12,17,0,119,0,49,0,1,17,99,58,134,7,0,0,128,250,1,0,2,17,0,0,82,3,8,0,121,7,15,0,116,9,0,0,106,21,0,4,109,9,4,21,106,17,0,8,109,9,8,17,106,21,0,12,109,9,12,21,106,17,0,16,109,9,16,17,134,17,0,0,140,163,1,0,9,3,0,0,85,12,17,0,119,0,29,0,1,21,0,59,134,17,0,0,128,250,1,0,3,21,0,0,121,17,24,0,82,21,8,0,1,20,192,47,134,17,0,0,116,100,2,0,21,20,0,0,85,11,17,0,82,4,0,0,106,17,0,4,106,20,0,8,106,21,0,16,134,6,0,0,212,9,2,0,17,20,21,0,1,20,1,0,82,17,11,0,134,21,0,0,128,127,2,0,4,6,20,17,85,12,21,0,82,17,11,0,134,21,0,0,128,108,2,0,17,0,0,0,82,17,10,0,135,21,8,0,17,0,0,0,82,21,12,0,121,21,10,0,116,13,8,0,1,17,3,0,1,20,5,59,134,21,0,0,216,31,2,0,17,20,13,0,137,15,0,0,139,0,0,0,119,0,8,0,1,20,4,0,1,17,37,59,134,21,0,0,216,31,2,0,20,17,14,0,137,15,0,0,139,0,0,0,139,0,0,0,140,1,16,0,0,0,0,0,2,10,0,0,246,28,0,0,2,11,0,0,245,28,0,0,2,12,0,0,247,28,0,0,136,13,0,0,0,9,13,0,136,13,0,0,25,13,13,16,137,13,0,0,130,13,0,0,136,14,0,0,49,13,13,14,28,197,1,0,1,14,16,0,135,13,0,0,14,0,0,0,0,7,9,0,85,7,0,0,1,13,212,115,82,13,13,0,1,14,216,115,82,14,14,0,26,14,14,1,41,14,14,4,94,13,13,14,82,14,7,0,45,13,13,14,84,197,1,0,137,9,0,0,139,0,0,0,1,13,0,0,1,14,212,115,82,14,14,0,1,15,216,115,82,15,15,0,26,15,15,1,41,15,15,4,3,14,14,15,106,14,14,4,47,13,13,14,208,199,1,0,1,13,212,115,82,13,13,0,1,14,216,115,82,14,14,0,26,14,14,1,41,14,14,4,3,2,13,14,1,14,212,115,82,14,14,0,1,13,216,115,82,13,13,0,26,13,13,1,41,13,13,4,94,14,14,13,32,14,14,1,121,14,25,0,1,14,212,115,82,14,14,0,1,13,216,115,82,13,13,0,26,13,13,1,41,13,13,4,3,14,14,13,106,1,14,4,1,14,212,115,82,14,14,0,1,13,216,115,82,13,13,0,26,13,13,1,41,13,13,4,3,14,14,13,106,15,2,4,34,15,15,4,121,15,3,0,0,13,1,0,119,0,3,0,30,15,1,4,0,13,15,0,109,14,8,13,119,0,38,0,1,13,212,115,82,13,13,0,1,14,216,115,82,14,14,0,26,14,14,1,41,14,14,4,3,3,13,14,82,14,2,0,33,14,14,4,121,14,4,0,1,13,0,0,109,3,8,13,119,0,25,0,106,13,3,4,34,13,13,4,121,13,3,0,1,6,1,0,119,0,12,0,1,13,4,0,1,14,212,115,82,14,14,0,1,15,216,115,82,15,15,0,26,15,15,1,41,15,15,4,3,14,14,15,106,14,14,4,30,14,14,4,4,6,13,14,1,14,212,115,82,14,14,0,1,13,216,115,82,13,13,0,26,13,13,1,41,13,13,4,3,14,14,13,109,14,8,6,1,13,212,115,82,13,13,0,1,15,216,115,82,15,15,0,26,15,15,1,41,15,15,4,3,13,13,15,106,13,13,8,134,14,0,0,108,140,2,0,13,0,0,0,121,14,4,0,134,14,0,0,208,155,2,0,119,0,57,0,1,14,192,81,1,13,220,115,82,13,13,0,27,13,13,48,3,4,14,13,82,13,4,0,1,14,212,115,82,14,14,0,1,15,216,115,82,15,15,0,26,15,15,1,41,15,15,4,3,14,14,15,106,14,14,8,3,13,13,14,85,4,13,0,1,13,192,81,1,14,220,115,82,14,14,0,27,14,14,48,3,13,13,14,25,5,13,8,82,13,5,0,1,14,212,115,82,14,14,0,1,15,216,115,82,15,15,0,26,15,15,1,41,15,15,4,3,14,14,15,106,14,14,8,3,13,13,14,85,5,13,0,1,13,192,81,1,14,220,115,82,14,14,0,27,14,14,48,3,13,13,14,25,8,13,4,82,13,8,0,1,14,212,115,82,14,14,0,1,15,216,115,82,15,15,0,26,15,15,1,41,15,15,4,3,14,14,15,106,14,14,8,3,13,13,14,85,8,13,0,1,13,216,115,1,14,216,115,82,14,14,0,25,14,14,1,85,13,14,0,119,0,1,0,1,14,0,1,1,13,216,115,82,13,13,0,49,14,14,13,236,199,1,0,134,14,0,0,208,155,2,0,1,14,212,115,82,14,14,0,1,13,216,115,82,13,13,0,26,13,13,1,41,13,13,4,82,15,7,0,97,14,13,15,1,15,212,115,82,15,15,0,1,13,216,115,82,13,13,0,26,13,13,1,41,13,13,4,3,15,15,13,1,13,0,0,109,15,4,13,1,13,212,115,82,13,13,0,1,15,216,115,82,15,15,0,26,15,15,1,41,15,15,4,3,13,13,15,1,15,224,115,82,15,15,0,109,13,12,15,137,9,0,0,139,0,0,0,140,0,21,0,0,0,0,0,2,15,0,0,16,4,0,0,2,16,0,0,64,84,0,0,136,17,0,0,0,13,17,0,136,17,0,0,1,18,208,5,3,17,17,18,137,17,0,0,130,17,0,0,136,18,0,0,49,17,17,18,172,200,1,0,1,18,208,5,135,17,0,0,18,0,0,0,1,17,204,5,3,5,13,17,1,17,200,5,3,7,13,17,1,17,196,5,3,11,13,17,1,17,192,5,3,6,13,17,1,17,188,5,3,10,13,17,0,4,13,0,1,17,184,5,3,12,13,17,1,17,180,5,3,8,13,17,1,17,176,5,3,3,13,17,1,17,172,5,3,9,13,17,1,17,168,5,3,2,13,17,134,17,0,0,184,141,2,0,1,17,8,118,1,18,0,0,85,17,18,0,1,17,136,117,82,17,17,0,1,19,160,5,3,19,13,19,1,20,152,5,3,20,13,20,135,18,251,0,17,19,20,0,1,18,0,0,85,5,18,0,1,18,0,2,82,20,5,0,56,18,18,20,92,201,1,0,82,18,5,0,25,18,18,1,85,5,18,0,119,0,249,255,1,18,0,0,85,7,18,0,1,18,3,0,82,20,7,0,56,18,18,20,152,201,1,0,82,14,7,0,1,18,178,120,1,20,175,120,90,20,20,14,95,18,14,20,82,20,7,0,25,20,20,1,85,7,20,0,119,0,244,255,1,20,4,118,1,18,0,0,85,20,18,0,1,18,0,0,85,11,18,0,135,18,252,0,120,18,3,0,135,18,253,0,85,11,18,0,1,18,0,0,85,6,18,0,82,20,6,0,82,19,11,0,47,20,20,19,228,201,1,0,82,20,6,0,34,20,20,4,0,18,20,0,119,0,3,0,1,20,0,0,0,18,20,0,120,18,2,0,119,0,83,0,1,18,0,0,85,10,18,0,82,0,6,0,1,18,32,0,82,20,10,0,56,18,18,20,32,202,1,0,82,18,10,0,25,18,18,1,85,10,18,0,119,0,248,255,135,18,254,0,0,4,0,0,85,12,18,0,82,18,12,0,120,18,63,0,1,18,0,0,85,8,18,0,82,20,8,0,106,19,4,12,47,20,20,19,92,202,1,0,82,20,8,0,34,20,20,32,0,18,20,0,119,0,3,0,1,20,0,0,0,18,20,0,120,18,2,0,119,0,26,0,82,20,8,0,134,18,0,0,40,35,2,0,20,0,0,0,85,3,18,0,82,18,6,0,41,18,18,5,3,18,16,18,82,20,3,0,3,1,18,20,3,20,4,15,82,18,8,0,41,18,18,2,94,20,20,18,32,20,20,1,121,20,4,0,1,20,1,0,83,1,20,0,119,0,3,0,1,20,0,0,83,1,20,0,82,20,8,0,25,20,20,1,85,8,20,0,119,0,220,255,1,20,0,0,85,9,20,0,82,18,9,0,106,19,4,8,47,18,18,19,248,202,1,0,82,18,9,0,34,18,18,8,0,20,18,0,119,0,3,0,1,18,0,0,0,20,18,0,120,20,2,0,119,0,10,0,82,18,9,0,134,20,0,0,48,118,2,0,18,0,0,0,85,2,20,0,82,20,9,0,25,20,20,1,85,9,20,0,119,0,236,255,82,20,6,0,25,20,20,1,85,6,20,0,119,0,163,255,137,13,0,0,139,0,0,0,140,1,19,0,0,0,0,0,136,15,0,0,0,14,15,0,136,15,0,0,25,15,15,32,137,15,0,0,130,15,0,0,136,16,0,0,49,15,15,16,124,203,1,0,1,16,32,0,135,15,0,0,16,0,0,0,25,13,14,8,0,12,14,0,25,11,14,24,25,10,14,20,25,9,14,16,25,8,14,12,1,15,0,0,85,11,15,0,1,16,0,0,109,11,4,16,1,17,32,0,1,18,4,0,134,15,0,0,128,137,2,0,17,18,0,0,109,11,4,15,1,15,0,0,85,10,15,0,1,15,32,0,82,16,10,0,56,15,15,16,248,203,1,0,106,15,11,4,82,16,10,0,41,16,16,2,1,18,255,255,97,15,16,18,82,18,10,0,25,18,18,1,85,10,18,0,119,0,244,255,1,18,230,36,85,9,18,0,1,18,201,38,85,8,18,0,1,18,52,117,82,15,9,0,2,17,0,0,49,139,0,0,134,16,0,0,240,231,1,0,15,17,0,0,85,18,16,0,1,16,56,117,82,17,8,0,2,15,0,0,48,139,0,0,134,18,0,0,240,231,1,0,17,15,0,0,85,16,18,0,1,16,52,117,82,16,16,0,1,15,56,117,82,15,15,0,134,18,0,0,156,182,1,0,16,15,0,0,85,11,18,0,82,1,11,0,1,18,0,0,82,15,11,0,48,18,18,15,60,205,1,0,85,12,1,0,1,15,3,0,1,16,130,40,134,18,0,0,216,31,2,0,15,16,12,0,82,18,11,0,1,16,178,40,135,7,255,0,18,16,0,0,106,16,11,4,85,16,7,0,82,16,11,0,1,18,193,40,135,2,255,0,16,18,0,0,106,18,11,4,109,18,4,2,82,18,11,0,1,16,208,40,135,3,255,0,18,16,0,0,106,16,11,4,109,16,20,3,82,16,11,0,1,18,220,40,135,4,0,1,16,18,0,0,106,18,11,4,109,18,24,4,82,18,11,0,1,16,224,40,135,5,0,1,18,16,0,0,106,16,11,4,109,16,44,5,82,16,11,0,1,18,235,40,135,6,0,1,16,18,0,0,106,18,11,4,109,18,56,6,116,0,11,0,106,16,11,4,109,0,4,16,137,14,0,0,139,0,0,0,119,0,12,0,85,13,1,0,1,18,4,0,1,15,244,40,134,16,0,0,216,31,2,0,18,15,13,0,116,0,11,0,106,15,11,4,109,0,4,15,137,14,0,0,139,0,0,0,139,0,0,0,140,1,16,0,0,0,0,0,2,10,0,0,246,28,0,0,2,11,0,0,245,28,0,0,2,12,0,0,247,28,0,0,136,13,0,0,0,9,13,0,136,13,0,0,25,13,13,16,137,13,0,0,130,13,0,0,136,14,0,0,49,13,13,14,188,205,1,0,1,14,16,0,135,13,0,0,14,0,0,0,0,7,9,0,85,7,0,0,1,13,212,115,82,13,13,0,1,14,216,115,82,14,14,0,26,14,14,1,41,14,14,4,3,13,13,14,106,13,13,12,82,14,7,0,45,13,13,14,248,205,1,0,137,9,0,0,139,0,0,0,1,13,0,0,1,14,212,115,82,14,14,0,1,15,216,115,82,15,15,0,26,15,15,1,41,15,15,4,3,14,14,15,106,14,14,4,47,13,13,14,116,208,1,0,1,13,212,115,82,13,13,0,1,14,216,115,82,14,14,0,26,14,14,1,41,14,14,4,3,2,13,14,1,14,212,115,82,14,14,0,1,13,216,115,82,13,13,0,26,13,13,1,41,13,13,4,94,14,14,13,32,14,14,1,121,14,25,0,1,14,212,115,82,14,14,0,1,13,216,115,82,13,13,0,26,13,13,1,41,13,13,4,3,14,14,13,106,1,14,4,1,14,212,115,82,14,14,0,1,13,216,115,82,13,13,0,26,13,13,1,41,13,13,4,3,14,14,13,106,15,2,4,34,15,15,4,121,15,3,0,0,13,1,0,119,0,3,0,30,15,1,4,0,13,15,0,109,14,8,13,119,0,38,0,1,13,212,115,82,13,13,0,1,14,216,115,82,14,14,0,26,14,14,1,41,14,14,4,3,3,13,14,82,14,2,0,33,14,14,4,121,14,4,0,1,13,0,0,109,3,8,13,119,0,25,0,106,13,3,4,34,13,13,4,121,13,3,0,1,6,1,0,119,0,12,0,1,13,4,0,1,14,212,115,82,14,14,0,1,15,216,115,82,15,15,0,26,15,15,1,41,15,15,4,3,14,14,15,106,14,14,4,30,14,14,4,4,6,13,14,1,14,212,115,82,14,14,0,1,13,216,115,82,13,13,0,26,13,13,1,41,13,13,4,3,14,14,13,109,14,8,6,1,13,212,115,82,13,13,0,1,15,216,115,82,15,15,0,26,15,15,1,41,15,15,4,3,13,13,15,106,13,13,8,134,14,0,0,108,140,2,0,13,0,0,0,121,14,4,0,134,14,0,0,208,155,2,0,119,0,57,0,1,14,192,81,1,13,220,115,82,13,13,0,27,13,13,48,3,4,14,13,82,13,4,0,1,14,212,115,82,14,14,0,1,15,216,115,82,15,15,0,26,15,15,1,41,15,15,4,3,14,14,15,106,14,14,8,3,13,13,14,85,4,13,0,1,13,192,81,1,14,220,115,82,14,14,0,27,14,14,48,3,13,13,14,25,5,13,8,82,13,5,0,1,14,212,115,82,14,14,0,1,15,216,115,82,15,15,0,26,15,15,1,41,15,15,4,3,14,14,15,106,14,14,8,3,13,13,14,85,5,13,0,1,13,192,81,1,14,220,115,82,14,14,0,27,14,14,48,3,13,13,14,25,8,13,4,82,13,8,0,1,14,212,115,82,14,14,0,1,15,216,115,82,15,15,0,26,15,15,1,41,15,15,4,3,14,14,15,106,14,14,8,3,13,13,14,85,8,13,0,1,13,216,115,1,14,216,115,82,14,14,0,25,14,14,1,85,13,14,0,119,0,1,0,1,14,0,1,1,13,216,115,82,13,13,0,49,14,14,13,144,208,1,0,134,14,0,0,208,155,2,0,1,14,212,115,82,14,14,0,1,13,216,115,82,13,13,0,26,13,13,1,41,13,13,4,3,14,14,13,82,13,7,0,109,14,12,13,1,13,212,115,82,13,13,0,1,14,216,115,82,14,14,0,26,14,14,1,41,14,14,4,3,13,13,14,1,14,0,0,109,13,4,14,137,9,0,0,139,0,0,0,140,5,26,0,0,0,0,0,136,24,0,0,0,21,24,0,136,24,0,0,1,25,160,0,3,24,24,25,137,24,0,0,130,24,0,0,136,25,0,0,49,24,24,25,28,209,1,0,1,25,160,0,135,24,0,0,25,0,0,0,1,24,152,0,3,8,21,24,1,24,144,0,3,16,21,24,25,7,21,108,25,18,21,104,25,13,21,100,25,14,21,96,25,12,21,92,25,19,21,56,25,15,21,48,25,11,21,40,25,17,21,36,0,6,21,0,85,18,0,0,85,13,1,0,85,14,2,0,85,12,3,0,134,24,0,0,196,150,2,0,19,0,0,0,106,24,19,8,120,24,3,0,137,21,0,0,139,0,0,0,82,24,13,0,76,24,24,0,145,24,24,0,89,15,24,0,82,25,14,0,76,25,25,0,145,25,25,0,113,15,4,25,1,25,10,0,85,11,25,0,82,25,12,0,82,24,11,0,47,25,25,24,188,209,1,0,116,12,11,0,82,25,12,0,82,24,11,0,6,25,25,24,85,17,25,0,134,25,0,0,196,150,2,0,6,0,0,0,82,5,18,0,82,9,12,0,76,25,9,0,145,9,25,0,82,10,17,0,76,25,10,0,145,10,25,0,0,20,7,0,0,22,6,0,25,23,20,36,116,20,22,0,25,20,20,4,25,22,22,4,54,25,20,23,0,210,1,0,116,16,15,0,106,24,15,4,109,16,4,24,78,24,4,0,83,8,24,0,102,25,4,1,107,8,1,25,102,24,4,2,107,8,2,24,102,25,4,3,107,8,3,25,134,25,0,0,116,41,1,0,7,5,16,9,10,8,0,0,137,21,0,0,139,0,0,0,140,1,22,0,0,0,0,0,127,17,0,0,89,17,0,0,127,17,0,0,82,1,17,0,43,17,1,31,0,13,17,0,2,17,0,0,255,255,255,127,19,17,1,17,0,3,17,0,2,17,0,0,255,255,127,76,48,17,17,3,236,210,1,0,32,18,13,0,121,18,7,0,62,18,0,0,252,222,166,63,251,33,249,63,145,18,18,0,58,17,18,0,119,0,6,0,62,18,0,0,252,222,166,63,251,33,249,191,145,18,18,0,58,17,18,0,58,5,17,0,2,18,0,0,0,0,128,127,16,18,18,3,126,17,18,0,5,0,0,0,145,17,17,0,139,17,0,0,2,17,0,0,0,0,224,62,48,17,3,17,40,211,1,0,2,17,0,0,0,0,128,57,48,17,3,17,28,211,1,0,58,12,0,0,145,17,12,0,139,17,0,0,119,0,72,0,1,6,255,255,58,16,0,0,119,0,69,0,145,17,0,0,135,4,237,0,17,0,0,0,145,4,4,0,2,17,0,0,0,0,152,63,48,17,3,17,200,211,1,0,2,17,0,0,0,0,48,63,48,17,3,17,152,211,1,0,1,6,0,0,59,19,2,0,145,19,19,0,65,18,4,19,145,18,18,0,59,19,255,255,145,19,19,0,63,17,18,19,145,17,17,0,59,18,2,0,145,18,18,0,63,19,4,18,145,19,19,0,66,16,17,19,145,16,16,0,119,0,41,0,1,6,1,0,59,17,255,255,145,17,17,0,63,19,4,17,145,19,19,0,59,18,1,0,145,18,18,0,63,17,4,18,145,17,17,0,66,16,19,17,145,16,16,0,119,0,29,0,2,17,0,0,0,0,28,64,48,17,3,17,32,212,1,0,1,6,2,0,61,19,0,0,0,0,192,191,145,19,19,0,63,17,4,19,145,17,17,0,61,20,0,0,0,0,192,63,145,20,20,0,65,18,4,20,145,18,18,0,59,20,1,0,145,20,20,0,63,19,18,20,145,19,19,0,66,16,17,19,145,16,16,0,119,0,7,0,1,6,3,0,59,19,255,255,145,19,19,0,66,16,19,4,145,16,16,0,119,0,1,0,65,7,16,16,145,7,7,0,65,8,7,7,145,8,8,0,62,21,0,0,48,15,216,159,132,149,175,63,145,21,21,0,65,18,8,21,145,18,18,0,62,21,0,0,96,42,231,159,161,62,194,63,145,21,21,0,63,20,18,21,145,20,20,0,65,17,8,20,145,17,17,0,62,20,0,0,159,176,92,32,85,85,213,63,145,20,20,0,63,19,17,20,145,19,19,0,65,9,7,19,145,9,9,0,62,20,0,0,154,171,96,0,83,153,201,191,145,20,20,0,62,21,0,0,153,156,0,225,72,66,187,63,145,21,21,0,65,17,8,21,145,17,17,0,64,19,20,17,145,19,19,0,65,10,8,19,145,10,10,0,34,19,6,0,121,19,10,0,63,17,10,9,145,17,17,0,65,19,16,17,145,19,19,0,64,12,16,19,145,12,12,0,145,19,12,0,139,19,0,0,119,0,26,0,1,19,80,28,41,17,6,2,100,2,19,17,145,2,2,0,63,19,10,9,145,19,19,0,65,11,16,19,145,11,11,0,1,21,96,28,41,18,6,2,100,20,21,18,145,20,20,0,64,17,11,20,145,17,17,0,64,19,17,16,145,19,19,0,64,14,2,19,145,14,14,0,68,15,14,0,145,15,15,0,32,19,13,0,126,12,19,14,15,0,0,0,145,19,12,0,139,19,0,0,59,19,0,0,145,19,19,0,139,19,0,0,140,3,18,0,0,0,0,0,136,15,0,0,0,14,15,0,136,15,0,0,25,15,15,32,137,15,0,0,130,15,0,0,136,16,0,0,49,15,15,16,172,213,1,0,1,16,32,0,135,15,0,0,16,0,0,0,25,9,14,8,25,10,14,4,0,11,14,0,25,12,14,19,25,7,14,18,25,5,14,17,25,3,14,16,25,13,14,15,25,8,14,14,25,6,14,13,25,4,14,12,85,9,0,0,85,10,1,0,85,11,2,0,82,15,9,0,82,16,10,0,41,16,16,2,90,15,15,16,83,12,15,0,82,15,9,0,82,16,10,0,41,16,16,2,25,16,16,1,90,15,15,16,83,7,15,0,82,15,9,0,82,16,10,0,41,16,16,2,25,16,16,2,90,15,15,16,83,5,15,0,82,15,9,0,82,16,10,0,41,16,16,2,25,16,16,3,90,15,15,16,83,3,15,0,82,15,9,0,82,16,11,0,41,16,16,2,90,15,15,16,83,13,15,0,82,15,9,0,82,16,11,0,41,16,16,2,25,16,16,1,90,15,15,16,83,8,15,0,82,15,9,0,82,16,11,0,41,16,16,2,25,16,16,2,90,15,15,16,83,6,15,0,82,15,9,0,82,16,10,0,41,16,16,2,25,16,16,3,90,15,15,16,83,4,15,0,82,15,9,0,82,16,10,0,41,16,16,2,78,17,13,0,95,15,16,17,82,17,9,0,82,16,10,0,41,16,16,2,25,16,16,1,78,15,8,0,95,17,16,15,82,15,9,0,82,16,10,0,41,16,16,2,25,16,16,2,78,17,6,0,95,15,16,17,82,17,9,0,82,16,10,0,41,16,16,2,25,16,16,3,78,15,4,0,95,17,16,15,82,15,9,0,82,16,11,0,41,16,16,2,78,17,12,0,95,15,16,17,82,17,9,0,82,16,11,0,41,16,16,2,25,16,16,1,78,15,7,0,95,17,16,15,82,15,9,0,82,16,11,0,41,16,16,2,25,16,16,2,78,17,5,0,95,15,16,17,82,17,9,0,82,16,11,0,41,16,16,2,25,16,16,3,78,15,3,0,95,17,16,15,137,14,0,0,139,0,0,0,140,2,31,0,0,0,0,0,2,27,0,0,128,128,128,128,2,28,0,0,255,254,254,254,1,26,0,0,0,2,1,0,21,29,2,0,38,29,29,3,120,29,59,0,38,29,2,3,120,29,4,0,0,8,0,0,0,18,1,0,119,0,20,0,0,9,0,0,0,19,1,0,78,4,19,0,83,9,4,0,41,29,4,24,42,29,29,24,120,29,3,0,0,17,9,0,119,0,48,0,25,12,19,1,25,16,9,1,38,29,12,3,120,29,4,0,0,8,16,0,0,18,12,0,119,0,4,0,0,9,16,0,0,19,12,0,119,0,240,255,82,5,18,0,19,29,5,27,21,29,29,27,2,30,0,0,1,1,1,1,4,30,5,30,19,29,29,30,120,29,21,0,0,6,5,0,0,23,8,0,0,25,18,0,25,13,25,4,25,14,23,4,85,23,6,0,82,6,13,0,19,29,6,27,21,29,29,27,2,30,0,0,1,1,1,1,4,30,6,30,19,29,29,30,121,29,4,0,0,22,14,0,0,24,13,0,119,0,6,0,0,23,14,0,0,25,13,0,119,0,240,255,0,22,8,0,0,24,18,0,0,10,22,0,0,20,24,0,1,26,10,0,119,0,4,0,0,10,0,0,0,20,1,0,1,26,10,0,32,29,26,10,121,29,21,0,78,7,20,0,83,10,7,0,41,29,7,24,42,29,29,24,120,29,3,0,0,17,10,0,119,0,14,0,0,11,10,0,0,21,20,0,25,21,21,1,25,15,11,1,78,3,21,0,83,15,3,0,41,29,3,24,42,29,29,24,120,29,3,0,0,17,15,0,119,0,3,0,0,11,15,0,119,0,246,255,139,17,0,0,140,5,21,0,0,0,0,0,136,17,0,0,0,16,17,0,136,17,0,0,25,17,17,48,137,17,0,0,130,17,0,0,136,18,0,0,49,17,17,18,16,217,1,0,1,18,48,0,135,17,0,0,18,0,0,0,25,9,16,32,25,10,16,28,25,13,16,24,25,7,16,20,25,11,16,16,25,12,16,12,25,15,16,8,25,14,16,36,25,8,16,4,0,6,16,0,85,9,0,0,85,10,1,0,85,13,2,0,85,7,3,0,85,11,4,0,82,17,9,0,82,18,11,0,41,18,18,2,82,19,7,0,3,18,18,19,91,17,17,18,85,12,17,0,82,18,9,0,82,19,11,0,82,20,13,0,26,20,20,1,134,17,0,0,116,213,1,0,18,19,20,0,116,15,10,0,1,17,0,0,83,14,17,0,116,8,10,0,82,5,9,0,82,17,13,0,26,17,17,1,82,20,8,0,56,17,17,20,96,218,1,0,82,17,8,0,41,17,17,2,82,20,7,0,3,17,17,20,91,17,5,17,85,6,17,0,82,17,6,0,82,20,12,0,47,17,17,20,252,217,1,0,82,20,9,0,82,19,8,0,82,18,15,0,134,17,0,0,116,213,1,0,20,19,18,0,82,17,15,0,25,17,17,1,85,15,17,0,119,0,22,0,82,17,6,0,82,18,12,0,45,17,17,18,80,218,1,0,78,17,14,0,38,17,17,1,121,17,10,0,82,18,9,0,82,19,8,0,82,20,15,0,134,17,0,0,116,213,1,0,18,19,20,0,82,17,15,0,25,17,17,1,85,15,17,0,78,17,14,0,38,17,17,1,40,17,17,1,38,17,17,1,83,14,17,0,82,17,8,0,25,17,17,1,85,8,17,0,119,0,206,255,82,20,15,0,82,19,13,0,26,19,19,1,134,17,0,0,116,213,1,0,5,20,19,0,137,16,0,0,82,17,15,0,139,17,0,0,140,2,13,0,0,0,0,0,136,9,0,0,0,8,9,0,136,9,0,0,25,9,9,48,137,9,0,0,130,9,0,0,136,10,0,0,49,9,9,10,188,218,1,0,1,10,48,0,135,9,0,0,10,0,0,0,25,5,8,16,25,7,8,12,25,3,8,8,25,6,8,4,0,4,8,0,1,9,0,0,85,5,9,0,1,10,0,0,109,5,4,10,1,9,0,0,109,5,8,9,1,10,0,0,109,5,12,10,1,9,0,0,109,5,16,9,25,9,1,4,116,7,9,0,25,9,1,8,116,3,9,0,1,9,0,0,85,6,9,0,1,9,0,0,85,4,9,0,106,9,1,12,82,10,4,0,56,9,9,10,156,219,1,0,82,9,7,0,82,10,3,0,106,11,1,16,134,2,0,0,212,9,2,0,9,10,11,0,82,11,6,0,3,11,11,2,85,6,11,0,82,11,7,0,28,11,11,2,85,7,11,0,82,11,3,0,28,11,11,2,85,3,11,0,82,11,7,0,34,11,11,1,121,11,3,0,1,11,1,0,85,7,11,0,82,11,3,0,34,11,11,1,121,11,3,0,1,11,1,0,85,3,11,0,82,11,4,0,25,11,11,1,85,4,11,0,119,0,224,255,82,10,6,0,135,11,6,0,10,0,0,0,85,5,11,0,82,11,5,0,120,11,12,0,116,0,5,0,106,10,5,4,109,0,4,10,106,11,5,8,109,0,8,11,106,10,5,12,109,0,12,10,106,11,5,16,109,0,16,11,137,8,0,0,139,0,0,0,82,10,5,0,82,9,1,0,82,12,6,0,135,11,29,0,10,9,12,0,106,12,1,4,109,5,4,12,106,11,1,8,109,5,8,11,106,12,1,12,109,5,12,12,106,11,1,16,109,5,16,11,116,0,5,0,106,12,5,4,109,0,4,12,106,11,5,8,109,0,8,11,106,12,5,12,109,0,12,12,106,11,5,16,109,0,16,11,137,8,0,0,139,0,0,0,140,3,30,0,0,0,0,0,136,26,0,0,0,25,26,0,136,26,0,0,25,26,26,32,137,26,0,0,130,26,0,0,136,27,0,0,49,26,26,27,120,220,1,0,1,27,32,0,135,26,0,0,27,0,0,0,25,21,25,12,25,22,25,8,25,23,25,4,0,24,25,0,1,26,0,0,85,21,26,0,1,27,0,0,109,21,4,27,1,26,0,0,109,21,8,26,88,26,1,0,145,26,26,0,89,22,26,0,112,26,1,4,145,26,26,0,89,23,26,0,112,26,1,8,145,26,26,0,89,24,26,0,88,9,2,0,145,9,9,0,88,26,22,0,145,26,26,0,65,18,9,26,145,18,18,0,112,10,2,4,145,10,10,0,88,27,23,0,145,27,27,0,65,26,10,27,145,26,26,0,63,12,18,26,145,12,12,0,112,11,2,8,145,11,11,0,88,27,24,0,145,27,27,0,65,26,11,27,145,26,26,0,63,17,12,26,145,17,17,0,112,27,2,12,145,27,27,0,63,26,17,27,145,26,26,0,89,21,26,0,112,3,2,16,145,3,3,0,88,26,22,0,145,26,26,0,65,20,3,26,145,20,20,0,112,4,2,20,145,4,4,0,88,27,23,0,145,27,27,0,65,26,4,27,145,26,26,0,63,13,20,26,145,13,13,0,112,5,2,24,145,5,5,0,88,27,24,0,145,27,27,0,65,26,5,27,145,26,26,0,63,14,13,26,145,14,14,0,112,28,2,28,145,28,28,0,63,27,14,28,145,27,27,0,113,21,4,27,112,6,2,32,145,6,6,0,88,27,22,0,145,27,27,0,65,19,6,27,145,19,19,0,112,7,2,36,145,7,7,0,88,26,23,0,145,26,26,0,65,27,7,26,145,27,27,0,63,15,19,27,145,15,15,0,112,8,2,40,145,8,8,0,88,26,24,0,145,26,26,0,65,27,8,26,145,27,27,0,63,16,15,27,145,16,16,0,112,28,2,44,145,28,28,0,63,26,16,28,145,26,26,0,113,21,8,26,116,0,21,0,106,27,21,4,109,0,4,27,106,26,21,8,109,0,8,26,137,25,0,0,139,0,0,0,140,6,20,0,0,0,0,0,2,14,0,0,99,29,0,0,136,15,0,0,0,13,15,0,136,15,0,0,25,15,15,32,137,15,0,0,130,15,0,0,136,16,0,0,49,15,15,16,100,222,1,0,1,16,32,0,135,15,0,0,16,0,0,0,25,11,13,21,25,9,13,16,25,12,13,12,25,10,13,8,25,8,13,4,85,9,0,0,85,12,1,0,85,10,2,0,85,8,3,0,85,13,4,0,38,16,5,1,107,13,20,16,1,16,140,117,82,17,9,0,1,18,192,47,134,15,0,0,116,100,2,0,17,18,0,0,85,16,15,0,1,15,140,117,82,15,15,0,120,15,8,0,1,15,0,0,83,11,15,0,78,6,11,0,38,15,6,1,0,7,15,0,137,13,0,0,139,7,0,0,1,15,8,115,82,17,12,0,82,19,10,0,5,18,17,19,41,18,18,2,135,16,6,0,18,0,0,0,85,15,16,0,1,15,245,43,1,18,140,117,82,18,18,0,134,16,0,0,72,155,2,0,15,18,0,0,82,18,12,0,1,15,255,0,19,18,18,15,1,15,140,117,82,15,15,0,134,16,0,0,172,48,2,0,18,15,0,0,82,15,12,0,43,15,15,8,1,18,255,0,19,15,15,18,1,18,140,117,82,18,18,0,134,16,0,0,172,48,2,0,15,18,0,0,82,18,10,0,1,15,255,0,19,18,18,15,1,15,140,117,82,15,15,0,134,16,0,0,172,48,2,0,18,15,0,0,82,15,10,0,43,15,15,8,1,18,255,0,19,15,15,18,1,18,140,117,82,18,18,0,134,16,0,0,172,48,2,0,15,18,0,0,1,18,240,0,1,15,140,117,82,15,15,0,134,16,0,0,172,48,2,0,18,15,0,0,1,15,0,0,1,18,140,117,82,18,18,0,134,16,0,0,172,48,2,0,15,18,0,0,1,18,0,0,1,15,140,117,82,15,15,0,134,16,0,0,172,48,2,0,18,15,0,0,1,15,0,0,1,18,140,117,82,18,18,0,134,16,0,0,172,48,2,0,15,18,0,0,1,18,0,0,1,15,140,117], eb + 112640);
  HEAPU8.set([82,15,15,0,134,16,0,0,172,48,2,0,18,15,0,0,1,15,0,0,1,18,140,117,82,18,18,0,134,16,0,0,172,48,2,0,15,18,0,0,1,18,0,0,1,15,140,117,82,15,15,0,134,16,0,0,172,48,2,0,18,15,0,0,1,15,0,0,1,18,140,117,82,18,18,0,134,16,0,0,172,48,2,0,15,18,0,0,1,18,0,0,1,15,140,117,82,15,15,0,134,16,0,0,172,48,2,0,18,15,0,0,82,16,8,0,121,16,55,0,1,15,33,0,1,18,140,117,82,18,18,0,134,16,0,0,172,48,2,0,15,18,0,0,1,18,255,0,1,15,140,117,82,15,15,0,134,16,0,0,172,48,2,0,18,15,0,0,1,15,11,0,1,18,140,117,82,18,18,0,134,16,0,0,172,48,2,0,15,18,0,0,1,18,252,43,1,15,140,117,82,15,15,0,134,16,0,0,72,155,2,0,18,15,0,0,1,15,3,0,1,18,140,117,82,18,18,0,134,16,0,0,172,48,2,0,15,18,0,0,1,18,1,0,1,15,140,117,82,15,15,0,134,16,0,0,172,48,2,0,18,15,0,0,1,15,0,0,1,18,140,117,82,18,18,0,134,16,0,0,172,48,2,0,15,18,0,0,1,18,0,0,1,15,140,117,82,15,15,0,134,16,0,0,172,48,2,0,18,15,0,0,1,15,0,0,1,18,140,117,82,18,18,0,134,16,0,0,172,48,2,0,15,18,0,0,1,16,1,0,83,11,16,0,78,6,11,0,38,16,6,1,0,7,16,0,137,13,0,0,139,7,0,0,140,5,30,0,0,0,0,0,136,26,0,0,0,24,26,0,136,26,0,0,1,27,224,0,3,26,26,27,137,26,0,0,130,26,0,0,136,27,0,0,49,26,26,27,168,225,1,0,1,27,224,0,135,26,0,0,27,0,0,0,1,26,208,0,3,9,24,26,1,26,160,0,3,16,24,26,25,15,24,80,0,14,24,0,0,23,16,0,25,25,23,40,1,26,0,0,85,23,26,0,25,23,23,4,54,26,23,25,200,225,1,0,116,9,2,0,1,27,0,0,134,26,0,0,224,28,0,0,27,1,9,15,16,3,4,0,34,26,26,0,121,26,3,0,1,18,255,255,119,0,78,0,1,26,255,255,106,27,0,76,47,26,26,27,36,226,1,0,134,13,0,0,88,162,2,0,0,0,0,0,119,0,2,0,1,13,0,0,82,5,0,0,38,26,5,32,0,8,26,0,102,26,0,74,34,26,26,1,121,26,3,0,38,26,5,223,85,0,26,0,25,11,0,48,82,26,11,0,120,26,42,0,25,10,0,44,82,6,10,0,85,10,14,0,25,20,0,28,85,20,14,0,25,22,0,20,85,22,14,0,1,26,80,0,85,11,26,0,25,21,0,16,25,26,14,80,85,21,26,0,134,12,0,0,224,28,0,0,0,1,9,15,16,3,4,0,120,6,3,0,0,17,12,0,119,0,27,0,106,27,0,36,38,27,27,15,1,28,0,0,1,29,0,0,135,26,1,1,27,0,28,29,82,26,22,0,32,26,26,0,1,27,255,255,125,19,26,27,12,0,0,0,85,10,6,0,1,27,0,0,85,11,27,0,1,27,0,0,85,21,27,0,1,27,0,0,85,20,27,0,1,27,0,0,85,22,27,0,0,17,19,0,119,0,5,0,134,17,0,0,224,28,0,0,0,1,9,15,16,3,4,0,82,7,0,0,20,27,7,8,85,0,27,0,121,13,4,0,134,27,0,0,76,162,2,0,0,0,0,0,38,27,7,32,32,27,27,0,1,26,255,255,125,18,27,17,26,0,0,0,137,24,0,0,139,18,0,0,140,4,15,0,0,0,0,0,136,11,0,0,0,10,11,0,136,11,0,0,25,11,11,48,137,11,0,0,130,11,0,0,136,12,0,0,49,11,11,12,120,227,1,0,1,12,48,0,135,11,0,0,12,0,0,0,25,8,10,36,25,9,10,32,25,4,10,28,25,6,10,8,25,7,10,4,0,5,10,0,85,8,1,0,85,9,2,0,85,4,3,0,1,11,0,0,85,6,11,0,1,12,0,0,109,6,4,12,1,11,0,0,109,6,8,11,1,12,0,0,109,6,12,12,1,11,0,0,109,6,16,11,1,11,0,0,85,6,11,0,82,12,9,0,109,6,4,12,82,11,4,0,109,6,8,11,1,12,1,0,109,6,12,12,1,11,7,0,109,6,16,11,1,11,0,0,85,7,11,0,106,13,6,4,106,14,6,8,5,12,13,14,41,12,12,2,135,11,6,0,12,0,0,0,85,6,11,0,1,11,0,0,85,5,11,0,106,12,6,4,106,14,6,8,5,11,12,14,41,11,11,2,82,14,5,0,56,11,11,14,216,228,1,0,82,11,6,0,82,14,5,0,82,12,8,0,82,13,7,0,41,13,13,2,90,12,12,13,95,11,14,12,82,12,6,0,82,14,5,0,25,14,14,1,82,11,8,0,82,13,7,0,41,13,13,2,3,11,11,13,102,11,11,1,95,12,14,11,82,11,6,0,82,14,5,0,25,14,14,2,82,12,8,0,82,13,7,0,41,13,13,2,3,12,12,13,102,12,12,2,95,11,14,12,82,12,6,0,82,14,5,0,25,14,14,3,82,11,8,0,82,13,7,0,41,13,13,2,3,11,11,13,102,11,11,3,95,12,14,11,82,11,7,0,25,11,11,1,85,7,11,0,82,11,5,0,25,11,11,4,85,5,11,0,119,0,209,255,116,0,6,0,106,14,6,4,109,0,4,14,106,11,6,8,109,0,8,11,106,14,6,12,109,0,12,14,106,11,6,16,109,0,16,11,137,10,0,0,139,0,0,0,140,3,19,0,0,0,0,0,136,13,0,0,0,12,13,0,136,13,0,0,25,13,13,32,137,13,0,0,130,13,0,0,136,14,0,0,49,13,13,14,60,229,1,0,1,14,32,0,135,13,0,0,14,0,0,0,25,11,12,20,25,6,12,16,25,10,12,12,25,8,12,8,25,9,12,4,0,7,12,0,85,6,0,0,85,10,1,0,85,8,2,0,82,13,6,0,1,14,1,0,1,18,4,0,138,13,14,18,156,229,1,0,220,229,1,0,108,230,1,0,196,230,1,0,1,15,207,53,1,16,90,48,1,17,226,3,1,18,234,53,135,14,4,0,15,16,17,18,119,0,78,0,82,14,10,0,34,14,14,0,121,14,4,0,1,14,0,0,85,11,14,0,119,0,72,0,82,14,8,0,82,15,10,0,49,14,14,15,212,229,1,0,82,14,8,0,26,14,14,1,85,11,14,0,119,0,64,0,116,11,10,0,119,0,62,0,82,4,10,0,82,5,8,0,82,14,10,0,34,14,14,0,121,14,12,0,47,14,4,5,12,230,1,0,1,14,0,0,82,15,10,0,4,14,14,15,85,11,14,0,119,0,50,0,82,14,8,0,26,14,14,1,85,11,14,0,119,0,46,0,47,14,4,5,44,230,1,0,116,11,10,0,119,0,42,0,82,14,8,0,41,14,14,1,85,9,14,0,82,14,9,0,82,15,10,0,49,14,14,15,84,230,1,0,1,14,0,0,85,11,14,0,119,0,32,0,82,14,9,0,82,15,10,0,4,14,14,15,26,14,14,1,85,11,14,0,119,0,26,0,82,3,10,0,1,14,0,0,82,15,10,0,49,14,14,15,144,230,1,0,82,14,8,0,8,14,3,14,85,11,14,0,119,0,17,0,1,14,0,0,4,14,14,3,82,15,8,0,8,14,14,15,85,7,14,0,82,14,7,0,121,14,5,0,82,14,8,0,82,15,7,0,4,14,14,15,85,7,14,0,116,11,7,0,119,0,4,0,1,14,0,0,85,11,14,0,119,0,1,0,137,12,0,0,82,13,11,0,139,13,0,0,140,9,43,0,0,0,0,0,136,20,0,0,0,19,20,0,136,20,0,0,25,20,20,48,137,20,0,0,130,20,0,0,136,21,0,0,49,20,20,21,20,231,1,0,1,21,48,0,135,20,0,0,21,0,0,0,25,11,19,32,25,13,19,28,25,10,19,24,25,12,19,20,25,16,19,16,25,18,19,12,25,15,19,8,25,17,19,4,0,14,19,0,85,11,0,0,85,13,1,0,85,10,2,0,85,12,3,0,85,16,4,0,85,18,5,0,85,15,6,0,85,17,7,0,85,14,8,0,1,20,0,0,82,21,11,0,82,22,13,0,82,23,10,0,82,24,12,0,82,25,16,0,82,26,18,0,82,27,15,0,82,28,17,0,59,29,0,0,145,29,29,0,59,30,0,0,145,30,30,0,59,31,1,0,145,31,31,0,59,32,1,0,145,32,32,0,1,33,0,0,82,34,14,0,1,35,255,255,1,36,0,0,1,37,0,0,1,38,0,0,1,39,0,0,1,40,1,0,1,41,1,0,1,42,0,0,134,9,0,0,136,114,1,0,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,0,137,19,0,0,139,9,0,0,140,2,22,0,0,0,0,0,136,18,0,0,0,17,18,0,136,18,0,0,25,18,18,48,137,18,0,0,130,18,0,0,136,19,0,0,49,18,18,19,40,232,1,0,1,19,48,0,135,18,0,0,19,0,0,0,25,14,17,16,25,13,17,8,0,12,17,0,25,9,17,44,25,11,17,40,25,8,17,36,25,10,17,32,25,6,17,28,25,5,17,24,25,7,17,20,85,9,0,0,85,11,1,0,82,19,11,0,135,18,2,1,19,0,0,0,85,8,18,0,82,19,8,0,1,20,1,0,1,21,0,0,135,18,3,1,19,20,9,21,1,18,0,0,85,10,18,0,82,21,8,0,135,18,4,1,21,0,0,0,82,21,8,0,2,20,0,0,129,139,0,0,135,18,5,1,21,20,10,0,82,3,8,0,82,18,10,0,33,18,18,1,121,18,52,0,85,12,3,0,1,20,4,0,1,21,176,41,134,18,0,0,216,31,2,0,20,21,12,0,1,18,0,0,85,6,18,0,82,21,8,0,2,20,0,0,132,139,0,0,135,18,5,1,21,20,6,0,82,4,6,0,135,18,247,0,85,7,18,0,0,16,4,0,136,18,0,0,0,15,18,0,136,18,0,0,27,20,16,1,25,20,20,15,38,20,20,240,3,18,18,20,137,18,0,0,130,18,0,0,136,20,0,0,49,18,18,20,60,233,1,0,27,20,16,1,25,20,20,15,38,20,20,240,135,18,0,0,20,0,0,0,82,20,8,0,82,21,6,0,135,18,6,1,20,21,5,15,85,13,15,0,1,21,3,0,1,20,125,41,134,18,0,0,216,31,2,0,21,20,13,0,82,20,7,0,135,18,250,0,20,0,0,0,82,2,8,0,137,17,0,0,139,2,0,0,119,0,10,0,85,14,3,0,1,20,3,0,1,21,217,41,134,18,0,0,216,31,2,0,20,21,14,0,82,2,8,0,137,17,0,0,139,2,0,0,1,18,0,0,139,18,0,0,140,6,32,0,0,0,0,0,136,24,0,0,0,22,24,0,136,24,0,0,1,25,32,5,3,24,24,25,137,24,0,0,130,24,0,0,136,25,0,0,49,24,24,25,232,233,1,0,1,25,32,5,135,24,0,0,25,0,0,0,1,24,29,5,3,20,22,24,1,24,24,5,3,17,22,24,1,24,20,5,3,21,22,24,1,24,16,5,3,16,22,24,1,24,12,5,3,14,22,24,1,24,8,5,3,13,22,24,1,24,28,5,3,15,22,24,1,24,4,5,3,18,22,24,0,19,22,0,85,17,0,0,85,21,1,0,85,16,2,0,85,14,3,0,85,13,4,0,38,24,5,1,83,15,24,0,1,24,140,117,82,24,24,0,120,24,8,0,1,24,0,0,83,20,24,0,78,6,20,0,38,24,6,1,0,12,24,0,137,22,0,0,139,12,0,0,1,24,8,115,82,24,24,0,85,18,24,0,78,24,15,0,38,24,24,1,0,23,24,0,121,23,4,0,1,26,0,0,0,25,26,0,119,0,3,0,82,26,18,0,0,25,26,0,82,26,17,0,82,27,21,0,82,28,16,0,82,29,13,0,134,24,0,0,16,168,1,0,25,26,27,28,29,23,19,0,82,7,18,0,82,8,17,0,1,24,8,115,82,9,24,0,82,10,21,0,82,11,16,0,78,24,15,0,38,24,24,1,121,24,6,0,134,24,0,0,112,141,0,0,7,8,9,10,11,19,0,0,119,0,5,0,134,24,0,0,236,158,1,0,7,8,9,10,11,19,0,0,1,29,140,117,82,29,29,0,1,28,8,115,82,28,28,0,1,27,0,0,1,26,0,0,82,25,21,0,82,30,16,0,82,31,14,0,134,24,0,0,20,75,1,0,29,28,27,26,25,30,31,19,1,24,1,0,83,20,24,0,78,6,20,0,38,24,6,1,0,12,24,0,137,22,0,0,139,12,0,0,140,1,12,0,0,0,0,0,136,8,0,0,0,7,8,0,136,8,0,0,25,8,8,112,137,8,0,0,130,8,0,0,136,9,0,0,49,8,8,9,144,235,1,0,1,9,112,0,135,8,0,0,9,0,0,0,25,5,7,72,25,3,7,56,25,6,7,16,0,1,7,0,1,8,36,118,82,8,8,0,121,8,18,0,1,8,36,118,82,8,8,0,85,0,8,0,1,9,40,118,82,9,9,0,109,0,4,9,1,8,44,118,82,8,8,0,109,0,8,8,1,9,48,118,82,9,9,0,109,0,12,9,1,8,52,118,82,8,8,0,109,0,16,8,137,7,0,0,139,0,0,0,134,8,0,0,196,150,2,0,5,0,0,0,25,4,5,8,1,8,36,118,82,9,4,0,85,8,9,0,1,9,40,118,106,8,4,4,85,9,8,0,1,8,44,118,106,9,4,8,85,8,9,0,1,9,48,118,106,8,4,12,85,9,8,0,1,8,52,118,106,9,4,16,85,8,9,0,134,9,0,0,196,150,2,0,6,0,0,0,106,9,6,28,1,8,240,5,3,2,9,8,116,3,2,0,106,9,2,4,109,3,4,9,106,8,2,8,109,3,8,8,106,9,2,12,109,3,12,9,88,8,3,0,145,8,8,0,59,10,1,0,145,10,10,0,63,9,8,10,145,9,9,0,89,1,9,0,112,8,3,4,145,8,8,0,59,11,1,0,145,11,11,0,63,10,8,11,145,10,10,0,113,1,4,10,112,11,3,8,145,11,11,0,59,8,2,0,145,8,8,0,64,9,11,8,145,9,9,0,113,1,8,9,112,8,3,12,145,8,8,0,59,11,2,0,145,11,11,0,64,10,8,11,145,10,10,0,113,1,12,10,1,10,20,118,82,9,1,0,85,10,9,0,1,9,24,118,106,10,1,4,85,9,10,0,1,10,28,118,106,9,1,8,85,10,9,0,1,9,32,118,106,10,1,12,85,9,10,0,1,10,36,118,82,10,10,0,85,0,10,0,1,9,40,118,82,9,9,0,109,0,4,9,1,10,44,118,82,10,10,0,109,0,8,10,1,9,48,118,82,9,9,0,109,0,12,9,1,10,52,118,82,10,10,0,109,0,16,10,137,7,0,0,139,0,0,0,140,3,27,0,0,0,0,0,1,22,0,0,136,24,0,0,0,23,24,0,136,24,0,0,25,24,24,32,137,24,0,0,130,24,0,0,136,25,0,0,49,24,24,25,144,237,1,0,1,25,32,0,135,24,0,0,25,0,0,0,0,15,23,0,25,16,23,16,25,20,0,28,82,3,20,0,85,15,3,0,25,21,0,20,82,24,21,0,4,19,24,3,109,15,4,19,109,15,8,1,109,15,12,2,25,10,0,60,0,11,15,0,1,14,2,0,3,17,19,2,82,26,10,0,135,25,7,1,26,11,14,16,134,24,0,0,24,153,2,0,25,0,0,0,120,24,3,0,82,4,16,0,119,0,4,0,1,24,255,255,85,16,24,0,1,4,255,255,45,24,17,4,12,238,1,0,1,22,6,0,119,0,30,0,34,24,4,0,121,24,3,0,1,22,8,0,119,0,26,0,106,7,11,4,16,8,7,4,121,8,4,0,25,25,11,8,0,24,25,0,119,0,2,0,0,24,11,0,0,12,24,0,1,25,0,0,125,24,8,7,25,0,0,0,4,9,4,24,82,24,12,0,3,24,24,9,85,12,24,0,25,13,12,4,82,24,13,0,4,24,24,9,85,13,24,0,0,11,12,0,41,24,8,31,42,24,24,31,3,14,14,24,4,17,17,4,119,0,212,255,32,24,22,6,121,24,10,0,106,5,0,44,106,25,0,48,3,25,5,25,109,0,16,25,0,6,5,0,85,20,6,0,85,21,6,0,0,18,2,0,119,0,18,0,32,25,22,8,121,25,16,0,1,24,0,0,109,0,16,24,1,24,0,0,85,20,24,0,1,24,0,0,85,21,24,0,82,24,0,0,39,24,24,32,85,0,24,0,32,24,14,2,121,24,3,0,1,18,0,0,119,0,3,0,106,24,11,4,4,18,2,24,137,23,0,0,139,18,0,0,140,2,19,0,0,0,0,0,136,15,0,0,0,14,15,0,136,15,0,0,25,15,15,48,137,15,0,0,130,15,0,0,136,16,0,0,49,15,15,16,48,239,1,0,1,16,48,0,135,15,0,0,16,0,0,0,25,12,14,24,25,11,14,8,0,10,14,0,25,13,14,40,1,16,202,61,78,17,1,0,134,15,0,0,168,154,2,0,16,17,0,0,120,15,7,0,134,15,0,0,144,162,2,0,1,17,28,0,85,15,17,0,1,8,0,0,119,0,94,0,1,17,152,4,135,6,6,0,17,0,0,0,120,6,3,0,1,8,0,0,119,0,88,0,1,15,0,0,1,16,144,0,135,17,3,0,6,15,16,0,1,16,43,0,134,17,0,0,168,154,2,0,1,16,0,0,32,9,17,0,78,2,1,0,121,9,9,0,41,16,2,24,42,16,16,24,32,16,16,114,1,15,8,0,1,18,4,0,125,17,16,15,18,0,0,0,85,6,17,0,41,17,2,24,42,17,17,24,32,17,17,97,121,17,26,0,85,10,0,0,1,18,3,0,109,10,4,18,1,18,221,0,135,5,8,1,18,10,0,0,1,18,0,4,19,18,5,18,120,18,10,0,85,11,0,0,1,17,4,0,109,11,4,17,1,18,0,4,20,18,5,18,109,11,8,18,1,17,221,0,135,18,8,1,17,11,0,0,82,18,6,0,1,17,128,0,20,18,18,17,0,7,18,0,85,6,7,0,0,4,7,0,119,0,2,0,82,4,6,0,109,6,60,0,1,17,152,0,3,17,6,17,109,6,44,17,1,18,0,4,109,6,48,18,25,3,6,75,1,18,255,255,83,3,18,0,38,18,4,8,120,18,11,0,85,12,0,0,1,17,19,84,109,12,4,17,109,12,8,13,1,18,54,0,135,17,9,1,18,12,0,0,120,17,3,0,1,17,10,0,83,3,17,0,1,18,8,0,109,6,32,18,1,17,1,0,109,6,36,17,1,18,2,0,109,6,40,18,1,17,2,0,109,6,12,17,1,17,100,118,82,17,17,0,120,17,3,0,1,18,255,255,109,6,76,18,134,18,0,0,72,151,2,0,6,0,0,0,0,8,6,0,137,14,0,0,139,8,0,0,140,2,21,0,0,0,0,0,136,13,0,0,0,11,13,0,136,13,0,0,25,13,13,32,137,13,0,0,130,13,0,0,136,14,0,0,49,13,13,14,36,241,1,0,1,14,32,0,135,13,0,0,14,0,0,0,25,8,11,20,25,2,11,16,25,7,11,12,25,3,11,8,25,10,11,4,0,9,11,0,85,8,0,0,85,2,1,0,82,15,8,0,82,16,2,0,5,14,15,16,41,14,14,2,1,16,1,0,134,13,0,0,128,137,2,0,14,16,0,0,85,7,13,0,1,16,0,0,1,14,0,0,82,15,8,0,82,17,2,0,1,18,8,25,1,19,1,20,82,20,7,0,135,13,10,1,16,14,15,17,18,19,20,0,82,19,8,0,82,18,2,0,5,20,19,18,41,20,20,2,135,13,6,0,20,0,0,0,85,3,13,0,82,13,2,0,26,13,13,1,85,10,13,0,82,13,10,0,34,13,13,0,120,13,53,0,1,13,0,0,85,9,13,0,82,13,8,0,41,13,13,2,82,20,9,0,56,13,13,20,132,242,1,0,82,20,10,0,82,18,8,0,5,13,20,18,41,13,13,2,0,4,13,0,82,18,2,0,26,18,18,1,82,20,10,0,4,18,18,20,82,20,8,0,5,13,18,20,41,13,13,2,0,5,13,0,82,12,9,0,82,13,3,0,3,20,5,12,82,18,7,0,3,19,4,12,90,18,18,19,95,13,20,18,82,18,9,0,25,18,18,1,30,18,18,4,120,18,14,0,82,20,2,0,26,20,20,1,82,13,10,0,4,20,20,13,82,13,8,0,5,18,20,13,41,18,18,2,0,6,18,0,82,18,3,0,82,13,9,0,3,13,6,13,1,20,255,255,95,18,13,20,82,20,9,0,25,20,20,1,85,9,20,0,119,0,211,255,82,20,10,0,26,20,20,1,85,10,20,0,119,0,202,255,82,13,7,0,135,20,8,0,13,0,0,0,137,11,0,0,82,20,3,0,139,20,0,0,140,3,13,0,0,0,0,0,1,9,0,0,136,11,0,0,0,10,11,0,136,11,0,0,25,11,11,32,137,11,0,0,130,11,0,0,136,12,0,0,49,11,11,12,232,242,1,0,1,12,32,0,135,11,0,0,12,0,0,0,25,5,10,20,25,3,10,16,25,7,10,12,25,6,10,8,25,8,10,4,0,4,10,0,85,5,0,0,85,3,1,0,85,7,2,0,1,11,0,0,85,6,11,0,116,8,3,0,1,11,0,0,85,4,11,0,82,11,7,0,82,12,4,0,56,11,11,12,8,244,1,0,82,11,5,0,79,11,11,0,82,12,3,0,79,12,12,0,46,11,11,12,80,243,1,0,1,9,6,0,119,0,16,0,82,11,5,0,103,11,11,1,82,12,3,0,103,12,12,1,46,11,11,12,112,243,1,0,1,9,6,0,119,0,8,0,82,11,5,0,103,11,11,2,82,12,3,0,103,12,12,2,46,11,11,12,140,243,1,0,1,9,6,0,32,11,9,6,121,11,20,0,1,9,0,0,82,11,8,0,82,12,3,0,78,12,12,0,83,11,12,0,82,12,8,0,82,11,3,0,102,11,11,1,107,12,1,11,82,11,8,0,82,12,3,0,102,12,12,2,107,11,2,12,82,12,6,0,25,12,12,1,85,6,12,0,82,12,8,0,25,12,12,4,85,8,12,0,82,12,5,0,25,12,12,4,85,5,12,0,82,12,3,0,25,12,12,4,85,3,12,0,82,12,4,0,25,12,12,1,85,4,12,0,119,0,199,255,137,10,0,0,82,12,6,0,139,12,0,0,140,4,22,0,0,0,0,0,136,19,0,0,0,15,19,0,136,19,0,0,1,20,144,0,3,19,19,20,137,19,0,0,130,19,0,0,136,20,0,0,49,19,19,20,80,244,1,0,1,20,144,0,135,19,0,0,20,0,0,0,25,9,15,80,25,5,15,72,25,4,15,68,25,8,15,8,0,12,15,0,109,15,76,0,85,5,1,0,85,4,2,0,109,15,64,3,82,18,5,0,1,19,178,120,1,20,175,120,90,20,20,18,95,19,18,20,1,20,175,120,82,19,5,0,82,21,4,0,95,20,19,21,1,19,0,0,134,21,0,0,196,106,2,0,19,0,0,0,121,21,4,0,1,21,1,0,85,8,21,0,119,0,8,0,1,19,0,0,134,21,0,0,252,133,2,0,19,0,0,0,121,21,3,0,1,21,0,0,85,8,21,0,1,19,0,0,109,8,8,19,1,21,1,0,109,8,4,21,25,10,8,24,134,21,0,0,108,135,2,0,12,0,0,0,116,10,12,0,106,19,12,4,109,10,4,19,134,6,0,0,56,162,2,0,76,19,6,0,145,6,19,0,25,11,8,24,88,21,11,0,145,21,21,0,66,19,21,6,145,19,19,0,89,11,19,0,134,7,0,0,12,162,2,0,76,19,7,0,145,7,19,0,25,19,8,24,25,13,19,4,88,21,13,0,145,21,21,0,66,19,21,7,145,19,19,0,89,13,19,0,0,14,9,0,0,16,8,0,25,17,14,56,116,14,16,0,25,14,14,4,25,16,16,4,54,19,14,17,96,245,1,0,134,19,0,0,188,240,0,0,9,0,0,0,137,15,0,0,139,0,0,0,140,6,29,0,0,0,0,0,136,22,0,0,0,18,22,0,136,22,0,0,1,23,48,1,3,22,22,23,137,22,0,0,130,22,0,0,136,23,0,0,49,22,22,23,196,245,1,0,1,23,48,1,135,22,0,0,23,0,0,0,1,22,240,0,3,11,18,22,1,22,176,0,3,6,18,22,25,9,18,40,25,12,18,32,25,8,18,24,25,14,18,16,25,16,18,8,0,15,18,0,25,10,18,112,25,13,18,48,87,9,0,0,87,12,1,0,87,8,2,0,87,14,3,0,87,16,4,0,87,15,5,0,86,23,9,0,86,24,12,0,86,25,8,0,86,26,14,0,86,27,16,0,86,28,15,0,134,22,0,0,40,161,1,0,10,23,24,25,26,27,28,0,1,22,76,115,82,21,22,0,0,7,21,0,0,17,6,0,0,19,21,0,25,20,17,64,116,17,19,0,25,17,17,4,25,19,19,4,54,22,17,20,76,246,1,0,0,17,11,0,0,19,10,0,25,20,17,64,116,17,19,0,25,17,17,4,25,19,19,4,54,22,17,20,108,246,1,0,134,22,0,0,28,176,0,0,13,6,11,0,0,17,7,0,0,19,13,0,25,20,17,64,116,17,19,0,25,17,17,4,25,19,19,4,54,22,17,20,152,246,1,0,137,18,0,0,139,0,0,0,140,3,20,0,0,0,0,0,136,18,0,0,0,15,18,0,136,18,0,0,1,19,144,0,3,18,18,19,137,18,0,0,130,18,0,0,136,19,0,0,49,18,18,19,240,246,1,0,1,19,144,0,135,18,0,0,19,0,0,0,25,7,15,88,25,11,15,8,0,12,15,0,25,6,15,24,25,3,15,16,109,15,80,0,87,11,1,0,87,12,2,0,1,18,2,0,85,6,18,0,1,19,0,0,109,6,8,19,1,18,1,0,109,6,4,18,25,8,6,24,86,18,11,0,145,18,18,0,89,3,18,0,86,19,12,0,145,19,19,0,113,3,4,19,116,8,3,0,106,18,3,4,109,8,4,18,25,9,6,24,1,18,240,81,82,19,9,0,85,18,19,0,1,19,244,81,106,18,9,4,85,19,18,0,134,5,0,0,56,162,2,0,76,18,5,0,145,5,18,0,25,10,6,24,88,19,10,0,145,19,19,0,66,18,19,5,145,18,18,0,89,10,18,0,134,4,0,0,12,162,2,0,76,18,4,0,145,4,18,0,25,18,6,24,25,13,18,4,88,19,13,0,145,19,19,0,66,18,19,4,145,18,18,0,89,13,18,0,0,14,7,0,0,16,6,0,25,17,14,56,116,14,16,0,25,14,14,4,25,16,16,4,54,18,14,17,204,247,1,0,134,18,0,0,188,240,0,0,7,0,0,0,137,15,0,0,139,0,0,0,140,5,19,0,0,0,0,0,136,13,0,0,0,11,13,0,136,13,0,0,25,13,13,32,137,13,0,0,130,13,0,0,136,14,0,0,49,13,13,14,44,248,1,0,1,14,32,0,135,13,0,0,14,0,0,0,25,6,11,20,25,7,11,16,25,10,11,12,25,5,11,8,25,8,11,4,0,9,11,0,85,6,0,0,85,7,1,0,85,10,2,0,85,5,3,0,85,8,4,0,82,13,10,0,26,13,13,1,82,14,7,0,49,13,13,14,116,248,1,0,137,11,0,0,139,0,0,0,82,12,7,0,82,13,10,0,4,13,13,12,28,13,13,2,3,13,12,13,85,9,13,0,82,14,6,0,82,15,7,0,82,16,10,0,82,17,5,0,82,18,9,0,134,13,0,0,216,216,1,0,14,15,16,17,18,0,0,0,85,9,13,0,82,13,8,0,82,18,9,0,47,13,13,18,232,248,1,0,82,18,6,0,82,17,7,0,82,16,9,0,82,15,5,0,82,14,8,0,134,13,0,0,244,247,1,0,18,17,16,15,14,0,0,0,82,13,8,0,82,14,9,0,49,13,13,14,0,249,1,0,137,11,0,0,139,0,0,0,82,14,6,0,82,15,9,0,25,15,15,1,82,16,10,0,82,17,5,0,82,18,8,0,134,13,0,0,244,247,1,0,14,15,16,17,18,0,0,0,137,11,0,0,139,0,0,0,140,6,25,0,0,0,0,0,136,19,0,0,0,18,19,0,136,19,0,0,25,19,19,48,137,19,0,0,130,19,0,0,136,20,0,0,49,19,19,20,104,249,1,0,1,20,48,0,135,19,0,0,20,0,0,0,25,14,18,36,25,11,18,32,25,16,18,28,25,17,18,24,25,8,18,20,25,9,18,16,25,15,18,12,25,10,18,8,25,12,18,4,0,13,18,0,85,11,0,0,85,16,1,0,85,17,2,0,85,8,3,0,85,9,4,0,85,15,5,0,82,20,9,0,82,21,15,0,82,22,16,0,82,23,17,0,82,24,8,0,134,19,0,0,176,211,0,0,20,21,22,23,24,12,0,0,85,13,19,0,82,19,13,0,120,19,6,0,1,19,0,0,85,14,19,0,82,6,14,0,137,18,0,0,139,6,0,0,82,24,11,0,1,23,192,47,134,19,0,0,252,139,2,0,24,23,0,0,85,10,19,0,82,7,13,0,82,19,10,0,121,19,20,0,1,23,1,0,82,24,12,0,82,22,10,0,134,19,0,0,128,127,2,0,7,23,24,22,82,22,10,0,134,19,0,0,128,108,2,0,22,0,0,0,82,22,13,0,135,19,8,0,22,0,0,0,1,19,1,0,85,14,19,0,82,6,14,0,137,18,0,0,139,6,0,0,119,0,8,0,135,19,8,0,7,0,0,0,1,19,0,0,85,14,19,0,82,6,14,0,137,18,0,0,139,6,0,0,1,19,0,0,139,19,0,0,140,2,18,0,0,0,0,0,1,12,0,0,136,14,0,0,0,13,14,0,136,14,0,0,25,14,14,48,137,14,0,0,130,14,0,0,136,15,0,0,49,14,14,15,188,250,1,0,1,15,48,0,135,14,0,0,15,0,0,0,25,8,13,36,25,4,13,32,25,10,13,40,25,6,13,28,25,5,13,24,25,3,13,20,0,7,13,0,25,9,13,16,85,8,0,0,85,4,1,0,1,14,0,0,83,10,14,0,82,15,8,0,134,14,0,0,124,123,2,0,15,0,0,0,85,6,14,0,82,14,6,0,120,14,6,0,78,2,10,0,38,14,2,1,0,11,14,0,137,13,0,0,139,11,0,0,1,14,0,0,85,5,14,0,82,15,4,0,1,16,59,0,134,14,0,0,184,19,2,0,15,16,5,0,85,3,14,0,1,14,0,0,85,7,14,0,1,16,0,0,109,7,4,16,1,14,0,0,109,7,8,14,1,16,0,0,109,7,12,16,82,15,6,0,134,14,0,0,160,112,2,0,15,0,0,0,135,16,17,0,7,14,0,0,1,16,0,0,85,9,16,0,82,16,5,0,82,14,9,0,49,16,16,14,148,251,1,0,1,12,7,0,119,0,17,0,82,15,3,0,82,17,9,0,41,17,17,2,94,15,15,17,25,15,15,1,134,14,0,0,160,112,2,0,15,0,0,0,134,16,0,0,248,132,2,0,7,14,0,0,120,16,5,0,82,16,9,0,25,16,16,1,85,9,16,0,119,0,235,255,32,16,12,7,121,16,6,0,78,2,10,0,38,16,2,1,0,11,16,0,137,13,0,0,139,11,0,0,1,16,1,0,83,10,16,0,78,2,10,0,38,16,2,1,0,11,16,0,137,13,0,0,139,11,0,0,140,2,19,0,0,0,0,0,136,14,0,0,0,13,14,0,136,14,0,0,25,14,14,32,137,14,0,0,130,14,0,0,136,15,0,0,49,14,14,15,68,252,1,0,1,15,32,0,135,14,0,0,15,0,0,0,25,8,13,20,25,12,13,16,25,9,13,12,25,6,13,8,25,11,13,4,0,7,13,0,89,12,0,0,89,9,1,0,88,15,9,0,145,15,15,0,59,16,2,0,145,16,16,0,66,14,15,16,145,14,14,0,89,6,14,0,88,16,6,0,145,16,16,0,61,15,0,0,0,0,0,63,145,15,15,0,63,14,16,15,145,14,14,0,89,11,14,0,88,14,9,0,145,14,14,0,59,15,1,0,145,15,15,0,72,14,14,15,120,14,7,0,1,15,23,54,1,16,90,48,1,17,250,2,1,18,59,54,135,14,4,0,15,16,17,18,88,18,12,0,145,18,18,0,135,14,237,0,18,0,0,0,145,14,14,0,89,12,14,0,88,4,12,0,145,4,4,0,88,14,11,0,145,14,14,0,74,14,4,14,121,14,9,0,59,14,0,0,145,14,14,0,89,8,14,0,88,3,8,0,145,3,3,0,137,13,0,0,145,14,3,0,139,14,0,0,61,18,0,0,0,0,0,63,145,18,18,0,88,17,6,0,145,17,17,0,64,14,18,17,145,14,14,0,89,7,14,0,88,5,12,0,145,5,5,0,88,14,7,0,145,14,14,0,72,14,5,14,121,14,10,0,59,14,1,0,145,14,14,0,89,8,14,0,88,3,8,0,145,3,3,0,137,13,0,0,145,14,3,0,139,14,0,0,119,0,17,0,88,2,11,0,145,2,2,0,88,14,12,0,145,14,14,0,64,10,2,14,145,10,10,0,88,17,9,0,145,17,17,0,66,14,10,17,145,14,14,0,89,8,14,0,88,3,8,0,145,3,3,0,137,13,0,0,145,14,3,0,139,14,0,0,59,14,0,0,145,14,14,0,139,14,0,0,140,2,17,0,0,0,0,0,2,10,0,0,176,0,0,0,2,11,0,0,168,0,0,0,136,12,0,0,0,7,12,0,136,12,0,0,25,12,12,16,137,12,0,0,130,12,0,0,136,13,0,0,49,12,12,13,16,254,1,0,1,13,16,0,135,12,0,0,13,0,0,0,25,6,7,12,25,2,7,8,25,5,7,4,0,3,7,0,85,6,0,0,85,2,1,0,82,12,6,0,1,13,172,0,82,14,2,0,97,12,13,14,82,14,6,0,3,4,14,10,82,14,6,0,94,14,14,10,34,14,14,0,121,14,9,0,1,14,0,0,85,4,14,0,1,14,0,0,85,5,14,0,82,14,6,0,82,13,2,0,97,14,11,13,119,0,23,0,82,9,6,0,82,13,4,0,1,14,172,0,94,14,9,14,94,12,9,11,4,14,14,12,3,13,13,14,1,14,164,0,94,14,9,14,8,13,13,14,85,5,13,0,82,13,5,0,82,14,6,0,94,14,14,10,53,13,13,14,200,254,1,0,1,14,174,51,1,12,90,48,1,15,151,5,1,16,231,51,135,13,4,0,14,12,15,16,82,8,6,0,1,16,180,0,94,16,8,16,82,15,5,0,1,12,160,0,94,12,8,12,29,12,12,4,134,13,0,0,152,114,2,0,16,15,12,0,85,3,13,0,82,12,3,0,1,15,0,0,82,16,6,0,1,14,160,0,94,16,16,14,135,13,3,0,12,15,16,0,137,7,0,0,82,13,3,0,139,13,0,0,140,6,18,0,0,0,0,0,136,15,0,0,0,14,15,0,136,15,0,0,25,15,15,32,137,15,0,0,130,15,0,0,136,16,0,0,49,15,15,16,84,255,1,0,1,16,32,0,135,15,0,0,16,0,0,0,25,9,14,24,25,10,14,20,25,6,14,16,25,8,14,12,25,13,14,8,25,12,14,4,0,11,14,0,85,9,0,0,85,10,1,0,85,6,2,0,85,8,3,0,85,13,4,0,85,12,5,0,82,15,6,0,82,16,9,0,82,17,8,0,4,16,16,17,3,15,15,16,82,16,13,0,8,15,15,16,85,11,15,0,82,15,10,0,82,16,11,0,82,17,12,0,134,7,0,0,152,114,2,0,15,16,17,0,137,14,0,0,139,7,0,0,140,2,25,0,0,0,0,0,2,19,0,0,128,128,128,128,2,20,0,0,255,254,254,254,2,21,0,0,255,0,0,0,19,22,1,21,0,8,22,0,120,8,5,0,135,22,16,0,0,0,0,0,3,12,0,22,119,0,92,0,38,22,0,3,120,22,3,0,0,13,0,0,119,0,28,0,19,22,1,21,0,2,22,0,0,14,0,0,78,3,14,0,41,23,3,24,42,23,23,24,32,23,23,0,121,23,4,0,1,23,1,0,0,22,23,0,119,0,7,0,41,23,3,24,42,23,23,24,41,24,2,24,42,24,24,24,13,23,23,24,0,22,23,0,121,22,3,0,0,12,14,0,119,0,68,0,25,9,14,1,38,22,9,3,120,22,3,0,0,13,9,0,119,0,3,0,0,14,9,0,119,0,233,255,2,22,0,0,1,1,1,1,5,11,8,22,82,4,13,0,19,22,4,19,21,22,22,19,2,23,0,0,1,1,1,1,4,23,4,23,19,22,22,23,120,22,27,0,0,5,4,0,0,17,13,0,21,22,5,11,0,18,22,0,19,22,18,19,21,22,22,19,2,23,0,0,1,1,1,1,4,23,18,23,19,22,22,23,121,22,3,0,0,16,17,0,119,0,15,0,25,10,17,4,82,5,10,0,19,22,5,19,21,22,22,19,2,23,0,0,1,1,1,1,4,23,5,23,19,22,22,23,121,22,3,0,0,16,10,0,119,0,4,0,0,17,10,0,119,0,233,255,0,16,13,0,19,22,1,21,0,6,22,0,0,15,16,0,78,7,15,0,41,23,7,24,42,23,23,24,32,23,23,0,121,23,4,0,1,23,1,0,0,22,23,0,119,0,7,0,41,23,7,24,42,23,23,24,41,24,6,24,42,24,24,24,13,23,23,24,0,22,23,0,121,22,3,0,0,12,15,0,119,0,3,0,25,15,15,1,119,0,238,255,139,12,0,0,140,2,10,0,0,0,0,0,136,7,0,0,0,4,7,0,136,7,0,0,25,7,7,64,137,7,0,0,130,7,0,0,136,8,0,0,49,7,7,8,172,1,2,0,1,8,64,0,135,7,0,0,8,0,0,0,0,2,4,0,0,3,2,0,25,6,3,64,1,7,0,0,85,3,7,0,25,3,3,4,54,7,3,6,184,1,2,0,88,7,1,0,145,7,7,0,89,2,7,0,112,8,1,16,145,8,8,0,113,2,4,8,112,7,1,32,145,7,7,0,113,2,8,7,112,8,1,48,145,8,8,0,113,2,12,8,112,7,1,4,145,7,7,0,113,2,16,7,112,8,1,20,145,8,8,0,113,2,20,8,112,7,1,36,145,7,7,0,113,2,24,7,112,8,1,52,145,8,8,0,113,2,28,8,112,7,1,8,145,7,7,0,113,2,32,7,112,8,1,24,145,8,8,0,113,2,36,8,112,7,1,40,145,7,7,0,113,2,40,7,112,8,1,56,145,8,8,0,113,2,44,8,112,7,1,12,145,7,7,0,113,2,48,7,112,8,1,28,145,8,8,0,113,2,52,8,112,7,1,44,145,7,7,0,113,2,56,7,112,8,1,60,145,8,8,0,113,2,60,8,0,3,0,0,0,5,2,0,25,6,3,64,116,3,5,0,25,3,3,4,25,5,5,4,54,8,3,6,152,2,2,0,137,4,0,0,139,0,0,0,140,1,14,0,0,0,0,0,136,11,0,0,0,10,11,0,136,11,0,0,1,12,64,2,3,11,11,12,137,11,0,0,130,11,0,0,136,12,0,0,49,11,11,12,240,2,2,0,1,12,64,2,135,11,0,0,12,0,0,0,1,11,40,2,3,5,10,11,1,11,8,2,3,9,10,11,1,11,0,2,3,8,10,11,1,11,36,2,3,3,10,11,1,11,32,2,3,6,10,11,1,11,12,2,3,4,10,11,0,7,10,0,85,3,0,0,1,12,236,117,82,12,12,0,1,13,240,117,82,13,13,0,134,11,0,0,236,240,1,0,12,13,0,0,85,6,11,0,116,4,6,0,1,13,236,117,82,13,13,0,109,4,4,13,1,11,240,117,82,11,11,0,109,4,8,11,1,13,1,0,109,4,12,13,1,11,7,0,109,4,16,11,1,13,0,0,1,12,0,2,135,11,3,0,7,13,12,0,82,12,3,0,135,11,17,0,7,12,0,0,116,5,4,0,106,12,4,4,109,5,4,12,106,11,4,8,109,5,8,11,106,12,4,12,109,5,12,12,106,11,4,16,109,5,16,11,134,11,0,0,212,194,1,0,5,7,0,0,82,12,6,0,135,11,8,0,12,0,0,0,134,1,0,0,104,110,2,0,7,0,0,0,134,2,0,0,104,110,2,0,7,0,0,0,85,8,1,0,109,8,4,2,1,13,194,45,134,12,0,0,204,124,2,0,13,8,0,0,135,11,241,0,12,0,0,0,85,9,7,0,1,12,3,0,1,13,72,46,134,11,0,0,216,31,2,0,12,13,9,0,137,10,0,0,139,0,0,0,140,3,18,0,0,0,0,0,136,13,0,0,0,12,13,0,136,13,0,0,25,13,13,32,137,13,0,0,130,13,0,0,136,14,0,0,49,13,13,14,92,4,2,0,1,14,32,0,135,13,0,0,14,0,0,0,25,5,12,16,25,8,12,12,25,9,12,8,25,10,12,4,0,11,12,0,85,5,0,0,85,8,1,0,85,9,2,0,82,13,5,0,82,13,13,0,121,13,9,0,82,13,5,0,82,13,13,0,26,13,13,8,82,13,13,0,41,13,13,1,82,14,8,0,3,6,13,14,119,0,3,0,82,14,8,0,25,6,14,1,85,10,6,0,82,14,5,0,82,14,14,0,121,14,5,0,82,14,5,0,82,14,14,0,26,7,14,8,119,0,2,0,1,7,0,0,82,15,9,0,82,16,10,0,5,13,15,16,25,13,13,8,134,14,0,0,204,115,2,0,7,13,0,0,85,11,14,0,82,14,11,0,120,14,7,0,1,13,240,47,1,16,142,47,1,15,25,3,1,17,242,47,135,14,4,0,13,16,15,17,82,14,11,0,120,14,5,0,82,3,5,0,82,4,3,0,137,12,0,0,139,4,0,0,82,14,5,0,82,14,14,0,120,14,4,0,82,14,11,0,1,17,0,0,109,14,4,17,82,17,5,0,82,14,11,0,25,14,14,8,85,17,14,0,82,14,5,0,82,14,14,0,26,14,14,8,116,14,10,0,82,3,5,0,82,4,3,0,137,12,0,0,139,4,0,0,140,2,21,0,0,0,0,0,136,11,0,0,0,10,11,0,136,11,0,0,25,11,11,16,137,11,0,0,130,11,0,0,136,12,0,0,49,11,11,12,172,5,2,0,1,12,16,0,135,11,0,0,12,0,0,0,25,8,10,8,25,9,10,4,89,9,0,0,89,10,1,0,88,12,9,0,145,12,12,0,135,11,237,0,12,0,0,0,145,11,11,0,89,9,11,0,88,11,9,0,145,11,11,0,59,12,1,0,145,12,12,0,71,6,11,12,88,2,9,0,145,2,2,0,121,6,31,0,88,12,9,0,145,12,12,0,65,7,2,12,145,7,7,0,88,16,9,0,145,16,16,0,59,17,21,0,145,17,17,0,65,15,16,17,145,15,15,0,59,17,36,0,145,17,17,0,64,14,15,17,145,14,14,0,65,13,7,14,145,13,13,0,59,14,16,0,145,14,14,0,63,11,13,14,145,11,11,0,59,14,18,0,145,14,14,0,66,12,11,14,145,12,12,0,89,8,12,0,88,5,8,0,145,5,5,0,137,10,0,0,145,12,5,0,139,12,0,0,59,12,2,0,145,12,12,0,71,12,2,12,121,12,38,0,88,3,9,0,145,3,3,0,88,4,9,0,145,4,4,0,59,16,36,0,145,16,16,0,88,19,9,0,145,19,19,0,59,20,7,0,145,20,20,0,65,18,19,20,145,18,18,0,64,15,16,18,145,15,15,0,65,17,4,15,145,17,17,0,59,15,196,255,145,15,15,0,63,13,17,15,145,13,13,0,65,11,3,13,145,11,11,0,59,13,32,0,145,13,13,0,63,14,11,13,145,14,14,0,59,13,18,0,145,13,13,0,66,12,14,13,145,12,12,0,89,8,12,0,88,5,8,0,145,5,5,0,137,10,0,0,145,12,5,0,139,12,0,0,119,0,9,0,59,12,0,0,145,12,12,0,89,8,12,0,88,5,8,0,145,5,5,0,137,10,0,0,145,12,5,0,139,12,0,0,59,12,0,0,145,12,12,0,139,12,0,0,140,3,21,0,0,0,0,0,136,19,0,0,0,15,19,0,136,19,0,0,1,20,16,1,3,19,19,20,137,19,0,0,130,19,0,0,136,20,0,0,49,19,19,20,120,7,2,0,1,20,16,1,135,19,0,0,20,0,0,0,1,19,208,0,3,3,15,19,1,19,144,0,3,9,15,19,1,19,136,0,3,11,15,19,1,19,132,0,3,12,15,19,1,19,128,0,3,13,15,19,25,8,15,64,0,10,15,0,89,11,0,0,89,12,1,0,89,13,2,0,88,4,11,0,145,4,4,0,88,5,12,0,145,5,5,0,88,20,13,0,145,20,20,0,134,19,0,0,100,14,2,0,8,4,5,20,1,19,76,115,82,18,19,0,0,6,18,0,0,7,18,0,0,14,9,0,0,16,8,0,25,17,14,64,116,14,16,0,25,14,14,4,25,16,16,4], eb + 122880);
  HEAPU8.set([54,19,14,17,244,7,2,0,0,14,3,0,0,16,7,0,25,17,14,64,116,14,16,0,25,14,14,4,25,16,16,4,54,19,14,17,20,8,2,0,134,19,0,0,28,176,0,0,10,9,3,0,0,14,6,0,0,16,10,0,25,17,14,64,116,14,16,0,25,14,14,4,25,16,16,4,54,19,14,17,64,8,2,0,137,15,0,0,139,0,0,0,140,2,21,0,0,0,0,0,2,17,0,0,255,0,0,0,1,15,0,0,136,18,0,0,0,16,18,0,136,18,0,0,25,18,18,32,137,18,0,0,130,18,0,0,136,19,0,0,49,18,18,19,160,8,2,0,1,19,32,0,135,18,0,0,19,0,0,0,0,8,16,0,78,2,1,0,41,18,2,24,42,18,18,24,120,18,3,0,1,15,3,0,119,0,61,0,102,18,1,1,120,18,3,0,1,15,3,0,119,0,57,0,1,19,0,0,1,20,32,0,135,18,3,0,8,19,20,0,78,3,1,0,41,18,3,24,42,18,18,24,121,18,20,0,0,4,3,0,0,9,1,0,19,18,4,17,0,11,18,0,43,18,11,5,41,18,18,2,3,7,8,18,82,18,7,0,1,20,1,0,38,19,11,31,22,20,20,19,20,18,18,20,85,7,18,0,25,9,9,1,78,4,9,0,41,18,4,24,42,18,18,24,33,18,18,0,120,18,240,255,78,5,0,0,41,18,5,24,42,18,18,24,120,18,3,0,0,13,0,0,119,0,24,0,0,6,5,0,0,14,0,0,19,18,6,17,0,10,18,0,43,18,10,5,41,18,18,2,94,18,8,18,1,20,1,0,38,19,10,31,22,20,20,19,19,18,18,20,121,18,3,0,0,13,14,0,119,0,10,0,25,12,14,1,78,6,12,0,41,18,6,24,42,18,18,24,120,18,3,0,0,13,12,0,119,0,3,0,0,14,12,0,119,0,236,255,32,18,15,3,121,18,6,0,41,18,2,24,42,18,18,24,134,13,0,0,200,255,1,0,0,18,0,0,137,16,0,0,4,18,13,0,139,18,0,0,140,3,13,0,0,0,0,0,136,10,0,0,0,9,10,0,136,10,0,0,25,10,10,32,137,10,0,0,130,10,0,0,136,11,0,0,49,10,10,11,12,10,2,0,1,11,32,0,135,10,0,0,11,0,0,0,25,8,9,16,25,6,9,12,25,5,9,8,25,4,9,4,0,3,9,0,85,8,0,0,85,6,1,0,85,5,2,0,1,10,0,0,85,4,10,0,1,10,0,0,85,3,10,0,82,10,5,0,1,11,1,0,1,12,21,0,138,10,11,12,164,10,2,0,176,10,2,0,188,10,2,0,192,10,2,0,204,10,2,0,208,10,2,0,212,10,2,0,224,10,2,0,236,10,2,0,248,10,2,0,4,11,2,0,16,11,2,0,20,11,2,0,32,11,2,0,36,11,2,0,40,11,2,0,44,11,2,0,48,11,2,0,52,11,2,0,56,11,2,0,60,11,2,0,119,0,42,0,1,11,8,0,85,3,11,0,119,0,39,0,1,11,16,0,85,3,11,0,119,0,36,0,119,0,253,255,1,11,24,0,85,3,11,0,119,0,32,0,119,0,249,255,119,0,248,255,1,11,32,0,85,3,11,0,119,0,27,0,1,11,32,0,85,3,11,0,119,0,24,0,1,11,96,0,85,3,11,0,119,0,21,0,1,11,128,0,85,3,11,0,119,0,18,0,1,11,4,0,85,3,11,0,119,0,15,0,119,0,253,255,1,11,8,0,85,3,11,0,119,0,11,0,119,0,253,255,119,0,248,255,119,0,247,255,119,0,250,255,119,0,245,255,119,0,244,255,119,0,247,255,1,11,2,0,85,3,11,0,119,0,1,0,82,10,8,0,82,11,6,0,5,7,10,11,82,10,3,0,5,11,7,10,28,11,11,8,85,4,11,0,137,9,0,0,82,11,4,0,139,11,0,0,140,2,15,0,0,0,0,0,136,12,0,0,0,11,12,0,136,12,0,0,25,12,12,32,137,12,0,0,130,12,0,0,136,13,0,0,49,12,12,13,168,11,2,0,1,13,32,0,135,12,0,0,13,0,0,0,25,8,11,20,25,7,11,8,25,6,11,4,0,5,11,0,116,7,1,0,106,13,1,4,109,7,4,13,106,12,1,8,109,7,8,12,116,8,1,0,106,13,1,4,109,8,4,13,106,12,1,8,109,8,8,12,134,12,0,0,136,125,2,0,8,0,0,0,145,12,12,0,89,6,12,0,88,12,6,0,145,12,12,0,59,13,0,0,145,13,13,0,69,12,12,13,121,12,4,0,59,12,1,0,145,12,12,0,89,6,12,0,59,13,1,0,145,13,13,0,88,14,6,0,145,14,14,0,66,12,13,14,145,12,12,0,89,5,12,0,88,2,5,0,145,2,2,0,88,14,7,0,145,14,14,0,65,12,14,2,145,12,12,0,89,7,12,0,88,3,5,0,145,3,3,0,25,9,7,4,88,14,9,0,145,14,14,0,65,12,14,3,145,12,12,0,89,9,12,0,88,4,5,0,145,4,4,0,25,10,7,8,88,14,10,0,145,14,14,0,65,12,14,4,145,12,12,0,89,10,12,0,116,0,7,0,106,14,7,4,109,0,4,14,106,12,7,8,109,0,8,12,137,11,0,0,139,0,0,0,140,2,19,0,0,0,0,0,136,11,0,0,0,10,11,0,136,11,0,0,25,11,11,16,137,11,0,0,130,11,0,0,136,12,0,0,49,11,11,12,228,12,2,0,1,12,16,0,135,11,0,0,12,0,0,0,25,8,10,8,25,9,10,4,89,9,0,0,89,10,1,0,88,12,9,0,145,12,12,0,135,11,237,0,12,0,0,0,145,11,11,0,89,9,11,0,88,11,9,0,145,11,11,0,59,12,1,0,145,12,12,0,71,6,11,12,88,2,9,0,145,2,2,0,121,6,31,0,88,12,9,0,145,12,12,0,65,7,2,12,145,7,7,0,88,16,9,0,145,16,16,0,59,17,3,0,145,17,17,0,65,15,16,17,145,15,15,0,59,17,6,0,145,17,17,0,64,14,15,17,145,14,14,0,65,13,7,14,145,13,13,0,59,14,4,0,145,14,14,0,63,11,13,14,145,11,11,0,59,14,6,0,145,14,14,0,66,12,11,14,145,12,12,0,89,8,12,0,88,5,8,0,145,5,5,0,137,10,0,0,145,12,5,0,139,12,0,0,59,12,2,0,145,12,12,0,71,12,2,12,121,12,34,0,88,3,9,0,145,3,3,0,88,4,9,0,145,4,4,0,59,16,6,0,145,16,16,0,88,18,9,0,145,18,18,0,64,15,16,18,145,15,15,0,65,17,4,15,145,17,17,0,59,15,244,255,145,15,15,0,63,13,17,15,145,13,13,0,65,11,3,13,145,11,11,0,59,13,8,0,145,13,13,0,63,14,11,13,145,14,14,0,59,13,6,0,145,13,13,0,66,12,14,13,145,12,12,0,89,8,12,0,88,5,8,0,145,5,5,0,137,10,0,0,145,12,5,0,139,12,0,0,119,0,9,0,59,12,0,0,145,12,12,0,89,8,12,0,88,5,8,0,145,5,5,0,137,10,0,0,145,12,5,0,139,12,0,0,59,12,0,0,145,12,12,0,139,12,0,0,140,4,14,0,0,0,0,0,136,12,0,0,0,9,12,0,136,12,0,0,25,12,12,80,137,12,0,0,130,12,0,0,136,13,0,0,49,12,12,13,156,14,2,0,1,13,80,0,135,12,0,0,13,0,0,0,25,5,9,72,25,6,9,68,25,7,9,64,0,4,9,0,89,5,1,0,89,6,2,0,89,7,3,0,59,12,1,0,145,12,12,0,89,4,12,0,59,13,0,0,145,13,13,0,113,4,4,13,59,12,0,0,145,12,12,0,113,4,8,12,88,13,5,0,145,13,13,0,113,4,12,13,59,12,0,0,145,12,12,0,113,4,16,12,59,13,1,0,145,13,13,0,113,4,20,13,59,12,0,0,145,12,12,0,113,4,24,12,88,13,6,0,145,13,13,0,113,4,28,13,59,12,0,0,145,12,12,0,113,4,32,12,59,13,0,0,145,13,13,0,113,4,36,13,59,12,1,0,145,12,12,0,113,4,40,12,88,13,7,0,145,13,13,0,113,4,44,13,59,12,0,0,145,12,12,0,113,4,48,12,59,13,0,0,145,13,13,0,113,4,52,13,59,12,0,0,145,12,12,0,113,4,56,12,59,13,1,0,145,13,13,0,113,4,60,13,0,8,0,0,0,10,4,0,25,11,8,64,116,8,10,0,25,8,8,4,25,10,10,4,54,13,8,11,132,15,2,0,137,9,0,0,139,0,0,0,140,3,20,0,0,0,0,0,1,17,0,0,25,15,2,16,82,3,15,0,120,3,10,0,134,18,0,0,40,139,2,0,2,0,0,0,120,18,4,0,82,5,15,0,1,17,5,0,119,0,5,0,1,12,0,0,119,0,3,0,0,5,3,0,1,17,5,0,32,18,17,5,121,18,53,0,25,16,2,20,82,4,16,0,0,6,4,0,4,18,5,4,48,18,18,1,24,16,2,0,106,18,2,36,38,18,18,15,135,12,1,1,18,2,0,1,119,0,42,0,102,18,2,75,34,18,18,0,32,19,1,0,20,18,18,19,121,18,6,0,0,7,6,0,1,10,0,0,0,11,1,0,0,13,0,0,119,0,26,0,0,9,1,0,26,14,9,1,90,18,0,14,32,18,18,10,120,18,9,0,120,14,6,0,0,7,6,0,1,10,0,0,0,11,1,0,0,13,0,0,119,0,15,0,0,9,14,0,119,0,245,255,106,18,2,36,38,18,18,15,135,8,1,1,18,2,0,9,48,18,8,9,148,16,2,0,0,12,8,0,119,0,11,0,82,7,16,0,0,10,9,0,4,11,1,9,3,13,0,9,135,18,29,0,7,13,11,0,82,18,16,0,3,18,18,11,85,16,18,0,3,12,10,11,139,12,0,0,140,2,20,0,0,0,0,0,136,11,0,0,0,10,11,0,136,11,0,0,25,11,11,16,137,11,0,0,130,11,0,0,136,12,0,0,49,11,11,12,248,16,2,0,1,12,16,0,135,11,0,0,12,0,0,0,25,8,10,8,25,9,10,4,89,9,0,0,89,10,1,0,88,12,9,0,145,12,12,0,135,11,237,0,12,0,0,0,145,11,11,0,89,9,11,0,88,11,9,0,145,11,11,0,59,12,1,0,145,12,12,0,71,6,11,12,88,2,9,0,145,2,2,0,121,6,29,0,88,12,9,0,145,12,12,0,65,7,2,12,145,7,7,0,59,11,1,0,145,11,11,0,61,15,0,0,0,0,32,64,145,15,15,0,88,17,9,0,145,17,17,0,61,18,0,0,0,0,192,63,145,18,18,0,65,16,17,18,145,16,16,0,64,14,15,16,145,14,14,0,65,13,7,14,145,13,13,0,64,12,11,13,145,12,12,0,89,8,12,0,88,5,8,0,145,5,5,0,137,10,0,0,145,12,5,0,139,12,0,0,59,12,2,0,145,12,12,0,71,12,2,12,121,12,36,0,88,3,9,0,145,3,3,0,88,4,9,0,145,4,4,0,59,13,2,0,145,13,13,0,88,17,9,0,145,17,17,0,61,19,0,0,0,0,0,63,145,19,19,0,65,18,17,19,145,18,18,0,61,19,0,0,0,0,32,64,145,19,19,0,64,15,18,19,145,15,15,0,65,16,4,15,145,16,16,0,59,15,4,0,145,15,15,0,63,14,16,15,145,14,14,0,65,11,3,14,145,11,11,0,64,12,13,11,145,12,12,0,89,8,12,0,88,5,8,0,145,5,5,0,137,10,0,0,145,12,5,0,139,12,0,0,119,0,9,0,59,12,0,0,145,12,12,0,89,8,12,0,88,5,8,0,145,5,5,0,137,10,0,0,145,12,5,0,139,12,0,0,59,12,0,0,145,12,12,0,139,12,0,0,140,3,22,0,0,0,0,0,1,16,0,0,136,18,0,0,0,17,18,0,136,18,0,0,25,18,18,32,137,18,0,0,130,18,0,0,136,19,0,0,49,18,18,19,180,18,2,0,1,19,32,0,135,18,0,0,19,0,0,0,0,11,17,0,25,13,17,16,85,11,1,0,25,12,11,4,25,10,0,48,82,5,10,0,33,18,5,0,38,18,18,1,4,18,2,18,85,12,18,0,25,9,0,44,82,19,9,0,109,11,8,19,109,11,12,5,106,20,0,60,1,21,2,0,135,18,11,1,20,11,21,13,134,19,0,0,24,153,2,0,18,0,0,0,120,19,30,0,82,4,13,0,34,19,4,1,121,19,4,0,0,6,4,0,1,16,4,0,119,0,28,0,82,7,12,0,48,19,7,4,120,19,2,0,82,8,9,0,25,15,0,4,85,15,8,0,0,3,8,0,4,18,4,7,3,18,3,18,109,0,8,18,82,18,10,0,120,18,3,0,0,14,2,0,119,0,14,0,25,18,3,1,85,15,18,0,26,18,2,1,78,19,3,0,95,1,18,19,0,14,2,0,119,0,7,0,0,14,4,0,119,0,5,0,1,19,255,255,85,13,19,0,1,6,255,255,1,16,4,0,32,19,16,4,121,19,7,0,38,19,6,48,40,19,19,16,82,18,0,0,20,19,19,18,85,0,19,0,0,14,6,0,137,17,0,0,139,14,0,0,140,3,15,0,0,0,0,0,2,10,0,0,192,100,0,0,2,11,0,0,0,4,0,0,2,12,0,0,192,104,0,0,136,13,0,0,0,8,13,0,136,13,0,0,25,13,13,32,137,13,0,0,130,13,0,0,136,14,0,0,49,13,13,14,8,20,2,0,1,14,32,0,135,13,0,0,14,0,0,0,25,7,8,12,25,5,8,16,25,3,8,8,25,4,8,4,0,6,8,0,85,7,0,0,83,5,1,0,85,3,2,0,1,14,0,0,135,13,3,0,10,14,11,0,85,12,10,0,1,13,0,0,85,4,13,0,82,13,7,0,121,13,41,0,1,13,1,0,85,4,13,0,1,13,0,0,85,6,13,0,82,13,6,0,56,13,11,13,232,20,2,0,82,9,6,0,82,14,7,0,90,14,14,9,95,10,9,14,82,14,6,0,90,14,10,14,120,14,2,0,119,0,26,0,82,14,6,0,90,14,10,14,78,13,5,0,45,14,14,13,216,20,2,0,82,14,6,0,1,13,0,0,95,10,14,13,82,13,4,0,41,13,13,2,82,14,6,0,3,14,10,14,25,14,14,1,97,12,13,14,82,14,4,0,25,14,14,1,85,4,14,0,82,14,4,0,1,13,128,0,52,14,14,13,232,20,2,0,82,14,6,0,25,14,14,1,85,6,14,0,119,0,221,255,82,14,3,0,116,14,4,0,137,8,0,0,139,12,0,0,140,3,14,0,0,0,0,0,136,8,0,0,0,7,8,0,136,8,0,0,25,8,8,16,137,8,0,0,130,8,0,0,136,9,0,0,49,8,8,9,48,21,2,0,1,9,16,0,135,8,0,0,9,0,0,0,0,5,7,0,25,6,7,12,25,3,7,8,25,4,7,4,85,6,0,0,85,3,1,0,85,4,2,0,1,8,31,44,85,5,8,0,1,9,3,0,1,10,8,44,134,8,0,0,216,31,2,0,9,10,5,0,1,8,144,117,82,10,4,0,85,8,10,0,1,10,174,120,82,9,6,0,82,11,3,0,134,8,0,0,64,50,1,0,9,11,0,0,38,8,8,1,83,10,8,0,1,8,174,120,78,8,8,0,38,8,8,1,120,8,3,0,137,7,0,0,139,0,0,0,134,8,0,0,52,160,2,0,134,8,0,0,88,250,0,0,1,10,0,0,1,11,0,0,1,9,1,0,1,12,3,0,1,13,2,0,135,8,12,1,10,11,9,12,13,0,0,0,1,13,39,44,1,12,0,0,1,9,1,0,1,11,4,0,1,10,2,0,135,8,13,1,13,12,9,11,10,0,0,0,1,10,39,44,1,11,0,0,1,9,1,0,1,12,5,0,1,13,2,0,135,8,14,1,10,11,9,12,13,0,0,0,1,13,39,44,1,12,0,0,1,9,1,0,1,11,6,0,1,10,2,0,135,8,15,1,13,12,9,11,10,0,0,0,1,10,39,44,1,11,0,0,1,9,1,0,1,12,6,0,1,13,2,0,135,8,16,1,10,11,9,12,13,0,0,0,1,13,39,44,1,12,0,0,1,9,1,0,1,11,6,0,1,10,2,0,135,8,17,1,13,12,9,11,10,0,0,0,1,10,39,44,1,11,0,0,1,9,1,0,1,12,6,0,1,13,2,0,135,8,18,1,10,11,9,12,13,0,0,0,1,13,0,0,1,12,1,0,1,9,7,0,1,11,2,0,135,8,19,1,13,12,9,11,1,11,0,0,1,9,1,0,1,12,7,0,1,13,2,0,135,8,20,1,11,9,12,13,137,7,0,0,139,0,0,0,140,3,20,0,0,0,0,0,1,17,0,0,16,17,17,1,32,18,1,0,1,19,255,255,16,19,19,0,19,18,18,19,20,17,17,18,121,17,38,0,0,5,0,0,0,6,1,0,0,9,2,0,0,14,5,0,1,17,10,0,1,18,0,0,134,5,0,0,40,155,2,0,5,6,17,18,0,15,6,0,135,6,1,0,1,18,10,0,1,17,0,0,134,3,0,0,228,138,2,0,5,6,18,17,135,17,1,0,134,4,0,0,204,151,2,0,14,15,3,17,135,17,1,0,26,9,9,1,1,17,255,0,19,17,4,17,39,17,17,48,83,9,17,0,1,17,9,0,16,17,17,15,32,18,15,9,1,19,255,255,16,19,19,14,19,18,18,19,20,17,17,18,120,17,226,255,0,8,9,0,0,12,5,0,119,0,3,0,0,8,2,0,0,12,0,0,120,12,3,0,0,10,8,0,119,0,16,0,0,11,8,0,0,13,12,0,0,16,13,0,29,13,13,10,26,7,11,1,27,17,13,10,4,17,16,17,39,17,17,48,83,7,17,0,35,17,16,10,121,17,3,0,0,10,7,0,119,0,3,0,0,11,7,0,119,0,244,255,139,10,0,0,140,3,19,0,0,0,0,0,1,13,0,0,136,16,0,0,0,14,16,0,136,16,0,0,25,16,16,16,137,16,0,0,130,16,0,0,136,17,0,0,49,16,16,17,32,24,2,0,1,17,16,0,135,16,0,0,17,0,0,0,25,12,14,8,25,9,14,4,0,10,14,0,85,12,0,0,85,9,1,0,85,10,2,0,82,6,12,0,82,16,10,0,82,16,16,0,34,16,16,8,120,16,44,0,120,6,3,0,1,13,5,0,119,0,11,0,82,16,12,0,26,16,16,8,82,16,16,0,82,17,12,0,26,17,17,8,106,17,17,4,25,17,17,1,49,16,16,17,128,24,2,0,1,13,5,0,32,16,13,5,121,16,7,0,1,13,0,0,1,17,1,0,1,18,1,0,134,16,0,0,36,4,2,0,12,17,18,0,82,16,9,0,82,16,16,0,1,18,255,0,19,16,16,18,0,11,16,0,82,15,12,0,0,7,15,0,26,16,15,8,25,8,16,4,82,3,8,0,25,16,3,1,85,8,16,0,95,7,3,11,82,4,9,0,82,16,4,0,43,16,16,8,85,4,16,0,82,5,10,0,82,16,5,0,26,16,16,8,85,5,16,0,119,0,209,255,137,14,0,0,139,6,0,0,140,4,14,0,0,0,0,0,136,12,0,0,0,11,12,0,136,12,0,0,25,12,12,48,137,12,0,0,130,12,0,0,136,13,0,0,49,12,12,13,56,25,2,0,1,13,48,0,135,12,0,0,13,0,0,0,25,9,11,32,25,5,11,24,25,7,11,16,25,8,11,12,25,10,11,8,0,4,11,0,85,7,0,0,85,8,1,0,89,10,2,0,82,12,7,0,76,12,12,0,145,12,12,0,89,4,12,0,82,13,8,0,76,13,13,0,145,13,13,0,113,4,4,13,88,6,10,0,145,6,6,0,116,5,4,0,106,12,4,4,109,5,4,12,78,12,3,0,83,9,12,0,102,13,3,1,107,9,1,13,102,12,3,2,107,9,2,12,102,13,3,3,107,9,3,13,134,13,0,0,32,62,2,0,5,6,9,0,137,11,0,0,139,0,0,0,140,3,16,0,0,0,0,0,136,13,0,0,0,12,13,0,136,13,0,0,25,13,13,32,137,13,0,0,130,13,0,0,136,14,0,0,49,13,13,14,252,25,2,0,1,14,32,0,135,13,0,0,14,0,0,0,25,11,12,28,25,4,12,24,25,5,12,20,25,6,12,16,25,7,12,12,25,8,12,8,25,9,12,4,0,10,12,0,85,4,0,0,85,5,1,0,85,6,2,0,82,13,4,0,82,14,5,0,3,13,13,14,82,14,6,0,4,13,13,14,85,7,13,0,82,14,7,0,82,15,4,0,4,14,14,15,135,13,14,0,14,0,0,0,85,8,13,0,82,14,7,0,82,15,5,0,4,14,14,15,135,13,14,0,14,0,0,0,85,9,13,0,82,14,7,0,82,15,6,0,4,14,14,15,135,13,14,0,14,0,0,0,85,10,13,0,82,13,8,0,82,14,9,0,49,13,13,14,188,26,2,0,82,13,8,0,82,14,10,0,49,13,13,14,188,26,2,0,82,13,4,0,83,11,13,0,78,3,11,0,137,12,0,0,139,3,0,0,82,13,9,0,82,14,10,0,49,13,13,14,228,26,2,0,82,13,5,0,83,11,13,0,78,3,11,0,137,12,0,0,139,3,0,0,119,0,6,0,82,13,6,0,83,11,13,0,78,3,11,0,137,12,0,0,139,3,0,0,1,13,0,0,139,13,0,0,140,2,12,0,0,0,0,0,1,4,0,0,136,6,0,0,0,5,6,0,136,6,0,0,25,6,6,32,137,6,0,0,130,6,0,0,136,7,0,0,49,6,6,7,60,27,2,0,1,7,32,0,135,6,0,0,7,0,0,0,0,3,5,0,25,2,5,4,1,6,0,0,85,2,6,0,1,7,0,0,109,2,4,7,1,6,0,0,109,2,8,6,1,7,0,0,109,2,12,7,1,6,0,0,109,2,16,6,82,6,1,0,121,6,20,0,106,6,1,4,121,6,16,0,106,6,1,8,121,6,12,0,82,7,1,0,106,8,1,4,106,9,1,8,106,10,1,16,106,11,1,12,134,6,0,0,16,70,1,0,7,8,9,10,11,0,0,0,85,2,6,0,119,0,6,0,1,4,5,0,119,0,4,0,1,4,5,0,119,0,2,0,1,4,5,0,32,6,4,5,121,6,6,0,1,11,4,0,1,10,104,58,134,6,0,0,216,31,2,0,11,10,3,0,106,10,1,4,109,2,4,10,106,6,1,8,109,2,8,6,106,10,1,12,109,2,12,10,106,6,1,16,109,2,16,6,116,0,2,0,106,10,2,4,109,0,4,10,106,6,2,8,109,0,8,6,106,10,2,12,109,0,12,10,106,6,2,16,109,0,16,6,137,5,0,0,139,0,0,0,140,2,17,0,0,0,0,0,136,12,0,0,0,11,12,0,136,12,0,0,25,12,12,16,137,12,0,0,130,12,0,0,136,13,0,0,49,12,12,13,100,28,2,0,1,13,16,0,135,12,0,0,13,0,0,0,25,8,11,8,25,6,11,4,0,9,11,0,85,6,0,0,89,9,1,0,82,12,6,0,120,12,7,0,1,13,144,57,1,14,90,48,1,15,116,3,1,16,156,57,135,12,4,0,13,14,15,16,1,12,6,0,82,16,6,0,50,12,12,16,192,28,2,0,1,16,186,57,1,15,90,48,1,14,117,3,1,13,156,57,135,12,4,0,16,15,14,13,88,13,9,0,145,13,13,0,134,12,0,0,24,149,2,0,13,0,0,0,33,10,12,0,1,12,160,20,82,13,6,0,41,13,13,3,3,12,12,13,106,2,12,4,88,3,9,0,145,3,3,0,121,10,21,0,59,12,1,0,145,12,12,0,66,5,12,3,145,5,5,0,38,15,2,7,135,14,231,0,15,5,0,0,145,14,14,0,59,15,2,0,145,15,15,0,65,13,14,15,145,13,13,0,135,12,11,0,13,0,0,0,75,12,12,0,85,8,12,0,82,4,8,0,137,11,0,0,139,4,0,0,119,0,20,0,38,13,2,7,135,12,231,0,13,3,0,0,145,12,12,0,59,13,2,0,145,13,13,0,65,7,12,13,145,7,7,0,88,15,9,0,145,15,15,0,66,12,7,15,145,12,12,0,135,13,11,0,12,0,0,0,75,13,13,0,85,8,13,0,82,4,8,0,137,11,0,0,139,4,0,0,1,13,0,0,139,13,0,0,140,3,16,0,0,0,0,0,136,13,0,0,0,11,13,0,136,13,0,0,25,13,13,48,137,13,0,0,130,13,0,0,136,14,0,0,49,13,13,14,212,29,2,0,1,14,48,0,135,13,0,0,14,0,0,0,25,9,11,32,25,10,11,16,0,8,11,0,25,7,11,40,109,11,44,0,85,7,1,0,109,11,36,2,82,12,7,0,1,13,8,1,94,3,12,13,1,13,12,1,94,4,12,13,1,13,16,1,94,5,12,13,1,13,20,1,94,6,12,13,82,13,7,0,82,13,13,0,121,13,19,0,85,8,3,0,109,8,4,4,109,8,8,5,109,8,12,6,1,14,3,0,1,15,54,44,134,13,0,0,216,31,2,0,14,15,8,0,1,15,3,0,1,14,190,44,134,13,0,0,216,31,2,0,15,14,9,0,137,11,0,0,1,13,0,0,139,13,0,0,119,0,18,0,85,10,3,0,109,10,4,4,109,10,8,5,109,10,12,6,1,14,3,0,1,15,123,44,134,13,0,0,216,31,2,0,14,15,10,0,1,15,3,0,1,14,190,44,134,13,0,0,216,31,2,0,15,14,9,0,137,11,0,0,1,13,0,0,139,13,0,0,1,13,0,0,139,13,0,0,140,4,21,0,0,0,0,0,1,16,0,0,136,18,0,0,0,17,18,0,136,18,0,0,1,19,160,0,3,18,18,19,137,18,0,0,130,18,0,0,136,19,0,0,49,18,18,19,244,30,2,0,1,19,160,0,135,18,0,0,19,0,0,0,1,18,144,0,3,6,17,18,0,8,17,0,1,19,0,29,1,20,144,0,135,18,29,0,8,19,20,0,2,18,0,0,254,255,255,127,26,20,1,1,48,18,18,20,80,31,2,0,120,1,5,0,1,9,1,0,0,11,6,0,1,16,4,0,119,0,10,0,134,18,0,0,144,162,2,0,1,20,61,0,85,18,20,0,1,10,255,255,119,0,4,0,0,9,1,0,0,11,0,0,1,16,4,0,32,20,16,4,121,20,28,0,1,20,254,255,4,13,20,11,16,20,13,9,125,12,20,13,9,0,0,0,109,8,48,12,25,15,8,20,85,15,11,0,109,8,44,11,3,5,11,12,25,14,8,16,85,14,5,0,109,8,28,5,134,7,0,0,196,156,2,0,8,2,3,0,120,12,3,0,0,10,7,0,119,0,9,0,82,4,15,0,82,20,14,0,13,20,4,20,41,20,20,31,42,20,20,31,1,18,0,0,95,4,20,18,0,10,7,0,137,17,0,0,139,10,0,0,140,3,13,0,0,0,0,0,136,10,0,0,0,8,10,0,136,10,0,0,1,11,160,0,3,10,10,11,137,10,0,0,130,10,0,0,136,11,0,0,49,10,10,11,20,32,2,0,1,11,160,0,135,10,0,0,11,0,0,0,1,10,148,0,3,5,8,10,1,10,144,0,3,6,8,10,1,10,128,0,3,3,8,10,0,4,8,0,85,5,0,0,85,6,1,0,82,10,5,0,34,10,10,3,121,10,3,0,137,8,0,0,139,0,0,0,85,3,2,0,0,7,4,0,1,10,128,0,3,9,7,10,1,10,0,0,85,7,10,0,25,7,7,4,54,10,7,9,92,32,2,0,82,10,5,0,1,11,1,0,1,12,6,0,138,10,11,12,156,32,2,0,172,32,2,0,188,32,2,0,204,32,2,0,220,32,2,0,236,32,2,0,119,0,25,0,1,12,97,61,135,11,17,0,4,12,0,0,119,0,21,0,1,12,105,61,135,11,17,0,4,12,0,0,119,0,17,0,1,12,113,61,135,11,17,0,4,12,0,0,119,0,13,0,1,12,120,61,135,11,17,0,4,12,0,0,119,0,9,0,1,12,130,61,135,11,17,0,4,12,0,0,119,0,5,0,1,12,138,61,135,11,17,0,4,12,0,0,119,0,1,0,82,11,6,0,135,10,21,1,4,11,0,0,1,11,146,61,135,10,21,1,4,11,0,0,134,10,0,0,116,158,2,0,4,3,0,0,1,10,5,0,82,11,5,0,49,10,10,11,64,33,2,0,1,11,1,0,135,10,22,1,11,0,0,0,119,0,3,0,137,8,0,0,139,0,0,0,139,0,0,0,140,6,15,0,0,0,0,0,136,13,0,0,0,12,13,0,136,13,0,0,25,13,13,32,137,13,0,0,130,13,0,0,136,14,0,0,49,13,13,14,132,33,2,0,1,14,32,0,135,13,0,0,14,0,0,0,25,7,12,20,25,9,12,16,25,8,12,12,25,11,12,8,25,10,12,4,0,6,12,0,85,7,0,0,85,9,1,0,85,8,2,0,85,11,3,0,85,10,4,0,85,6,5,0,82,13,7,0,82,14,9,0,109,13,4,14,82,14,7,0,82,13,8,0,109,14,8,13,82,13,7,0,82,14,11,0,109,13,20,14,82,14,7,0,82,13,10,0,109,14,24,13,82,13,7,0,82,14,6,0,109,13,64,14,137,12,0,0,139,0,0,0,140,4,17,0,0,0,0,0,136,14,0,0,0,9,14,0,136,14,0,0,25,14,14,16,137,14,0,0,130,14,0,0,136,15,0,0,49,14,14,15,48,34,2,0,1,15,16,0,135,14,0,0,15,0,0,0,25,6,9,3,25,7,9,2,25,8,9,1,0,5,9,0,83,6,0,0,83,7,1,0,83,8,2,0,83,5,3,0,1,14,192,81,1,15,220,115,82,15,15,0,27,15,15,48,3,10,14,15,106,15,10,20,106,14,10,8,41,14,14,2,78,16,6,0,95,15,14,16,1,16,192,81,1,14,220,115,82,14,14,0,27,14,14,48,3,11,16,14,106,14,11,20,106,16,11,8,41,16,16,2,25,16,16,1,78,15,7,0,95,14,16,15,1,15,192,81,1,16,220,115,82,16,16,0,27,16,16,48,3,12,15,16,106,16,12,20,106,15,12,8,41,15,15,2,25,15,15,2,78,14,8,0,95,16,15,14,1,14,192,81,1,15,220,115,82,15,15,0,27,15,15,48,3,13,14,15,106,15,13,20,106,14,13,8,41,14,14,2,25,14,14,3,78,16,5,0,95,15,14,16,1,16,192,81,1,14,220,115,82,14,14,0,27,14,14,48,3,16,16,14,25,4,16,8,82,16,4,0,25,16,16,1,85,4,16,0,137,9,0,0,139,0,0,0,140,1,7,0,0,0,0,0,136,4,0,0,0,3,4,0,136,4,0,0,25,4,4,16,137,4,0,0,130,4,0,0,136,5,0,0,49,4,4,5,96,35,2,0,1,5,16,0,135,4,0,0,5,0,0,0,25,2,3,4,0,1,3,0,85,2,0,0,1,4,0,0,85,1,4,0,82,4,2,0,1,5,0,0,1,6,16,0,138,4,5,6,200,35,2,0,212,35,2,0,224,35,2,0,236,35,2,0,248,35,2,0,4,36,2,0,16,36,2,0,28,36,2,0,40,36,2,0,52,36,2,0,64,36,2,0,76,36,2,0,88,36,2,0,100,36,2,0,112,36,2,0,124,36,2,0,119,0,49,0,1,5,7,0,85,1,5,0,119,0,46,0,1,5,6,0,85,1,5,0,119,0,43,0,1,5,8,0,85,1,5,0,119,0,40,0,1,5,5,0,85,1,5,0,119,0,37,0,1,5,9,0,85,1,5,0,119,0,34,0,1,5,11,0,85,1,5,0,119,0,31,0,1,5,10,0,85,1,5,0,119,0,28,0,1,5,12,0,85,1,5,0,119,0,25,0,1,5,13,0,85,1,5,0,119,0,22,0,1,5,15,0,85,1,5,0,119,0,19,0,1,5,16,0,85,1,5,0,119,0,16,0,1,5,17,0,85,1,5,0,119,0,13,0,1,5,1,0,85,1,5,0,119,0,10,0,1,5,3,0,85,1,5,0,119,0,7,0,1,5,4,0,85,1,5,0,119,0,4,0,1,5,2,0,85,1,5,0,119,0,1,0,137,3,0,0,82,4,1,0,139,4,0,0,140,1,14,0,0,0,0,0,2,11,0,0,108,7,0,0,120,0,53,0,1,12,176,29,82,12,12,0,120,12,3,0,1,2,0,0,119,0,6,0,1,12,176,29,82,12,12,0,134,2,0,0,148,36,2,0,12,0,0,0,134,12,0,0,240,161,2,0,82,4,12,0,120,4,3,0,0,7,2,0,119,0,33,0,0,5,4,0,0,8,2,0,1,12,255,255,106,13,5,76,47,12,12,13,16,37,2,0,134,3,0,0,88,162,2,0,5,0,0,0,119,0,2,0,1,3,0,0,106,12,5,28,106,13,5,20,48,12,12,13,60,37,2,0,134,12,0,0,172,63,2,0,5,0,0,0,20,12,12,8,0,9,12,0,119,0,2,0,0,9,8,0,121,3,4,0,134,12,0,0,76,162,2,0,5,0,0,0,106,5,5,56,120,5,3,0,0,7,9,0,119,0,3,0,0,8,9,0,119,0,227,255,134,12,0,0,32,162,2,0,0,10,7,0,119,0,22,0,106,12,0,76,36,12,12,255,121,12,5,0,134,10,0,0,172,63,2,0,0,0,0,0,119,0,15,0,134,12,0,0,88,162,2,0,0,0,0,0,32,6,12,0,134,1,0,0,172,63,2,0,0,0,0,0,121,6,3,0,0,10,1,0,119,0,5,0,134,12,0,0,76,162,2,0,0,0,0,0,0,10,1,0,139,10,0,0,140,3,8,0,0,0,0,0,136,6,0,0,0,5,6,0,136,6,0,0,25,6,6,48,137,6,0,0,130,6,0,0,136,7,0,0,49,6,6,7,8,38,2,0,1,7,48,0,135,6,0,0,7,0,0,0,25,3,5,20,0,4,5,0,116,3,1,0,106,7,1,4,109,3,4,7,106,6,1,8,109,3,8,6,106,7,1,12,109,3,12,7,106,6,1,16,109,3,16,6,134,6,0,0,132,218,1,0,4,3,0,0,116,3,2,0,106,7,2,4,109,3,4,7,106,6,2,8,109,3,8,6,106,7,2,12,109,3,12,7,134,7,0,0,76,95,1,0,4,3,0,0,116,0,4,0,106,6,4,4,109,0,4,6,106,7,4,8,109,0,8,7,106,6,4,12,109,0,12,6,106,7,4,16,109,0,16,7,137,5,0,0,139,0,0,0,140,0,9,0,0,0,0,0,136,4,0,0,0,3,4,0,136,4,0,0,25,4,4,16,137,4,0,0,130,4,0,0,136,5,0,0,49,4,4,5,204,38,2,0,1,5,16,0,135,4,0,0,5,0,0,0,25,2,3,8,25,0,3,4,0,1,3,0,134,4,0,0,64,126,2,0,1,4,245,255,83,0,4,0,1,5,245,255,107,0,1,5,1,4,245,255,107,0,2,4,1,5,255,255,107,0,3,5,78,5,0,0,83,2,5,0,102,4,0,1,107,2,1,4,102,5,0,2,107,2,2,5,102,4,0,3,107,2,3,4,134,4,0,0,84,153,2,0,2,0,0,0,1,4,200,255,83,1,4,0,1,5,200,255,107,1,1,5,1,4,200,255,107,1,2,4,1,5,255,255,107,1,3,5,78,5,1,0,83,2,5,0,102,4,1,1,107,2,1,4,102,5,1,2,107,2,2,5,102,4,1,3,107,2,3,4,1,5,199,30,1,6,20,0,1,7,20,0,1,8,40,0,134,4,0,0,224,208,1,0,5,6,7,8,2,0,0,0,134,4,0,0,192,179,1,0,137,3,0,0,139,0,0,0,140,2,12,0,0,0,0,0,136,9,0,0,0,8,9,0,136,9,0,0,25,9,9,32,137,9,0,0,130,9,0,0,136,10,0,0,49,9,9,10,212,39,2,0,1,10,32,0,135,9,0,0,10,0,0,0,25,3,8,20,25,6,8,16,25,5,8,12,25,7,8,8,25,4,8,4,0,2,8,0,85,3,0,0,85,6,1,0,1,10,0,0,82,11,3,0,134,9,0,0,172,48,2,0,10,11,0,0,1,11,0,0,82,10,3,0,134,9,0,0,172,48,2,0,11,10,0,0,1,10,0,0,82,11,3,0,134,9,0,0,172,48,2,0,10,11,0,0,1,9,1,0,85,5,9,0,1,9,1,0,82,11,6,0,82,11,11,0,22,9,9,11,82,11,5,0,56,9,9,11,228,40,2,0,82,9,6,0,25,9,9,4,82,11,5,0,91,9,9,11,85,7,9,0,82,9,6,0,1,11,4,1,3,9,9,11,82,11,5,0,91,9,9,11,85,4,9,0,82,9,6,0,1,11,4,2,3,9,9,11,82,11,5,0,91,9,9,11,85,2,9,0,82,11,7,0,82,10,3,0,134,9,0,0,172,48,2,0,11,10,0,0,82,10,4,0,82,11,3,0,134,9,0,0,172,48,2,0,10,11,0,0,82,11,2,0,82,10,3,0,134,9,0,0,172,48,2,0,11,10,0,0,82,9,5,0,25,9,9,1,85,5,9,0,119,0,214,255,137,8,0,0,139,0,0,0,140,4,15,0,0,0,0,0,136,12,0,0,0,11,12,0,136,12,0,0,25,12,12,32,137,12,0,0,130,12,0,0,136,13,0,0,49,12,12,13,36,41,2,0,1,13,32,0,135,12,0,0,13,0,0,0,25,9,11,16,25,10,11,12,25,6,11,8,25,7,11,4,0,8,11,0,89,10,0,0,85,6,1,0,85,7,2,0,85,8,3,0,88,13,10,0,145,13,13,0,134,12,0,0,24,149,2,0,13,0,0,0,121,12,6,0,116,9,8,0,82,5,9,0,137,11,0,0,139,5,0,0,119,0,14,0,82,4,7,0,82,13,6,0,88,14,10,0,145,14,14,0,134,12,0,0,20,137,2,0,13,14,0,0,41,12,12,1,3,12,4,12,85,9,12,0,82,5,9,0,137,11,0,0,139,5,0,0,1,12,0,0,139,12,0,0,140,1,6,0,0,0,0,0,1,4,206,61,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,7,0,119,0,130,0,1,4,219,61,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,8,0,119,0,123,0,1,4,235,61,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,3,0,119,0,116,0,1,4,245,61,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,9,0,119,0,109,0,1,4,2,62,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,1,0,119,0,102,0,1,4,13,62,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,10,0,119,0,95,0,1,4,28,62,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,3,0,119,0,88,0,1,4,41,62,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,4,0,119,0,81,0,1,4,60,62,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,5,0,119,0,74,0,1,4,80,62,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,6,0,119,0,67,0,1,4,101,62,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,7,0,119,0,60,0,1,4,123,62,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,2,0,119,0,53,0,1,4,141,62,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,11,0,119,0,46,0,1,4,162,62,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,12,0,119,0,39,0,1,4,180,62,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,4,0,119,0,32,0,1,4,196,62,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,13,0,119,0,25,0,1,4,210,62,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,2,0,119,0,18,0,1,4,232,62,134,3,0,0,196,128,2,0,0,4,0,0,120,3,3,0,1,1,2,0,119,0,11,0,1,4,0,63,134,3,0,0,196,128,2,0,0,4,0,0,32,2,3,0,1,4,6,0,1,5,0,0,125,3,2,4,5,0,0,0,139,3,0,0,139,1,0,0,140,2,14,0,0,0,0,0,136,12,0,0,0,10,12,0,136,12,0,0,25,12,12,16,137,12,0,0,130,12,0,0,136,13,0,0,49,12,12,13,20,44,2,0,1,13,16,0,135,12,0,0,13,0,0,0,25,9,10,4,0,5,10,0,85,9,0,0,85,5,1,0,82,12,5,0,38,12,12,1,85,5,12,0,82,12,5,0,82,13,9,0,79,13,13,0,22,12,12,13,85,5,12,0,82,12,9,0,25,6,12,1,79,12,6,0,82,13,5,0,20,12,12,13,83,6,12,0,82,4,9,0,78,12,4,0,25,12,12,1,41,12,12,24,42,12,12,24,83,4,12,0,82,12,9,0,79,12,12,0,36,12,12,7,121,12,3,0,137,10,0,0,139,0,0,0,82,11,9,0,102,2,11,1,25,7,11,8,25,8,11,4,82,3,8,0,25,12,3,1,85,8,12,0,95,7,3,2,82,12,9,0,1,13,0,0,83,12,13,0,82,13,9,0,1,12,0,0,107,13,1,12,137,10,0,0,139,0,0,0,140,3,8,0,0,0,0,0,2,4,0,0,128,0,0,0,120,0,3,0,1,3,1,0,119,0,91,0,35,5,1,128,121,5,4,0,83,0,1,0,1,3,1,0,119,0,86,0,134,5,0,0,156,161,2,0,1,6,188,0,94,5,5,6,82,5,5,0,120,5,15,0,38,5,1,128,2,6,0,0,128,223,0,0,45,5,5,6,52,45,2,0,83,0,1,0,1,3,1,0,119,0,72,0,134,5,0,0,144,162,2,0,1,6,25,0,85,5,6,0,1,3,255,255,119,0,66,0,1,6,0,8,48,6,1,6,124,45,2,0,43,6,1,6,1,5,192,0,20,6,6,5,83,0,6,0,38,5,1,63,20,5,5,4,107,0,1,5,1,3,2,0,119,0,54,0,2,5,0,0,0,216,0,0,16,5,1,5,1,6,0,224,19,6,1,6,2,7,0,0,0,224,0,0,13,6,6,7,20,5,5,6,121,5,14,0,43,5,1,12,1,6,224,0,20,5,5,6,83,0,5,0,43,6,1,6,38,6,6,63,20,6,6,4,107,0,1,6,38,5,1,63,20,5,5,4,107,0,2,5,1,3,3,0,119,0,31,0,2,5,0,0,0,0,1,0,4,5,1,5,2,6,0,0,0,0,16,0,48,5,5,6,56,46,2,0,43,5,1,18,1,6,240,0,20,5,5,6,83,0,5,0,43,6,1,12,38,6,6,63,20,6,6,4,107,0,1,6,43,5,1,6,38,5,5,63,20,5,5,4,107,0,2,5,38,6,1,63,20,6,6,4,107,0,3,6,1,3,4,0,119,0,7,0,134,6,0,0,144,162,2,0,1,5,25,0,85,6,5,0,1,3,255,255,119,0,1,0,139,3,0,0,140,1,15,0,0,0,0,0,136,11,0,0,0,10,11,0,136,11,0,0,25,11,11,32,137,11,0,0,130,11,0,0,136,12,0,0,49,11,11,12,140,46,2,0,1,12,32,0,135,11,0,0,12,0,0,0,25,6,10,20,25,9,10,16,25,3,10,12,25,7,10,8,25,8,10,4,0,5,10,0,89,6,0,0,88,1,6,0,145,1,1,0,1,12,164,29,88,11,12,0,145,11,11,0,73,11,1,11,120,11,5,0,1,12,164,29,88,11,12,0,145,11,11,0,89,6,11,0,88,2,6,0,145,2,2,0,1,12,168,29,88,11,12,0,145,11,11,0,73,11,2,11,121,11,5,0,1,12,168,29,88,11,12,0,145,11,11,0,89,6,11,0,88,11,6,0,145,11,11,0,89,5,11,0,1,11,208,24,82,12,5,0,1,13,164,29,82,13,13,0,4,12,12,13,43,12,12,20,41,12,12,2,3,11,11,12,116,9,11,0,82,11,9,0,43,11,11,16,41,11,11,9,85,3,11,0,82,11,9,0,2,12,0,0,255,255,0,0,19,11,11,12,85,7,11,0,82,11,5,0,43,11,11,12,1,12,255,0,19,11,11,12,85,8,11,0,82,11,3,0,82,13,7,0,82,14,8,0,5,12,13,14,3,11,11,12,43,11,11,16,1,12,255,0,19,11,11,12,0,4,11,0,137,10,0,0,139,4,0,0,140,4,19,0,0,0,0,0,136,16,0,0,0,15,16,0,136,16,0,0,25,16,16,32,137,16,0,0,130,16,0,0,136,17,0,0,49,16,16,17,204,47,2,0,1,17,32,0,135,16,0,0,17,0,0,0,25,14,15,19,25,13,15,18,25,8,15,17,25,7,15,16,25,12,15,12,25,11,15,8,25,10,15,4,0,9,15,0,83,14,0,0,83,13,1,0,83,8,2,0,83,7,3,0,79,17,14,0], eb + 133120);
  HEAPU8.set([76,17,17,0,145,17,17,0,59,18,255,0,145,18,18,0,66,16,17,18,145,16,16,0,89,12,16,0,79,18,13,0,76,18,18,0,145,18,18,0,59,17,255,0,145,17,17,0,66,16,18,17,145,16,16,0,89,11,16,0,79,17,8,0,76,17,17,0,145,17,17,0,59,18,255,0,145,18,18,0,66,16,17,18,145,16,16,0,89,10,16,0,79,18,7,0,76,18,18,0,145,18,18,0,59,17,255,0,145,17,17,0,66,16,18,17,145,16,16,0,89,9,16,0,88,4,12,0,145,4,4,0,88,5,11,0,145,5,5,0,88,6,10,0,145,6,6,0,88,17,9,0,145,17,17,0,135,16,26,0,4,5,6,17,137,15,0,0,139,0,0,0,140,2,15,0,0,0,0,0,2,13,0,0,255,0,0,0,1,12,0,0,106,14,1,76,34,14,14,0,121,14,3,0,1,12,3,0,119,0,36,0,134,14,0,0,88,162,2,0,1,0,0,0,120,14,3,0,1,12,3,0,119,0,30,0,19,14,0,13,0,7,14,0,19,14,0,13,0,8,14,0,102,14,1,75,45,14,8,14,16,49,2,0,1,12,10,0,119,0,12,0,25,11,1,20,82,3,11,0,106,14,1,16,48,14,3,14,56,49,2,0,25,14,3,1,85,11,14,0,83,3,7,0,0,4,8,0,119,0,2,0,1,12,10,0,32,14,12,10,121,14,4,0,134,4,0,0,96,59,2,0,1,0,0,0,134,14,0,0,76,162,2,0,1,0,0,0,0,9,4,0,32,14,12,3,121,14,21,0,19,14,0,13,0,5,14,0,19,14,0,13,0,6,14,0,102,14,1,75,46,14,6,14,172,49,2,0,25,10,1,20,82,2,10,0,106,14,1,16,48,14,2,14,172,49,2,0,25,14,2,1,85,10,14,0,83,2,5,0,0,9,6,0,119,0,4,0,134,9,0,0,96,59,2,0,1,0,0,0,139,9,0,0,140,2,16,0,0,0,0,0,103,14,1,1,41,14,14,16,79,15,1,0,41,15,15,24,20,14,14,15,103,15,1,2,41,15,15,8,20,14,14,15,103,15,1,3,20,14,14,15,0,9,14,0,25,4,0,3,78,2,4,0,103,14,0,1,41,14,14,16,79,15,0,0,41,15,15,24,20,14,14,15,103,15,0,2,41,15,15,8,20,14,14,15,1,15,255,0,19,15,2,15,20,14,14,15,0,10,14,0,41,14,2,24,42,14,14,24,32,13,14,0,13,14,10,9,20,14,14,13,121,14,4,0,0,5,4,0,0,12,13,0,119,0,21,0,0,6,4,0,0,7,10,0,25,8,6,1,78,3,8,0,41,14,7,8,1,15,255,0,19,15,3,15,20,14,14,15,0,7,14,0,41,14,3,24,42,14,14,24,32,11,14,0,13,14,7,9,20,14,14,11,121,14,4,0,0,5,8,0,0,12,11,0,119,0,3,0,0,6,8,0,119,0,239,255,121,12,4,0,1,15,0,0,0,14,15,0,119,0,3,0,26,15,5,3,0,14,15,0,139,14,0,0,140,3,12,0,0,0,0,0,136,9,0,0,0,8,9,0,136,9,0,0,25,9,9,16,137,9,0,0,130,9,0,0,136,10,0,0,49,9,9,10,240,50,2,0,1,10,16,0,135,9,0,0,10,0,0,0,25,4,8,8,25,3,8,4,0,7,8,0,85,4,0,0,85,3,1,0,85,7,2,0,82,9,3,0,120,9,13,0,82,11,4,0,112,10,11,56,145,10,10,0,134,9,0,0,24,149,2,0,10,0,0,0,33,5,9,0,1,10,4,0,1,11,5,0,125,9,5,10,11,0,0,0,85,3,9,0,82,9,7,0,120,9,13,0,82,10,4,0,112,11,10,60,145,11,11,0,134,9,0,0,24,149,2,0,11,0,0,0,33,6,9,0,1,11,4,0,1,10,5,0,125,9,6,11,10,0,0,0,85,7,9,0,82,9,4,0,82,10,3,0,109,9,80,10,82,10,4,0,82,9,7,0,109,10,84,9,137,8,0,0,139,0,0,0,140,2,15,0,0,0,0,0,136,11,0,0,0,10,11,0,136,11,0,0,25,11,11,16,137,11,0,0,130,11,0,0,136,12,0,0,49,11,11,12,208,51,2,0,1,12,16,0,135,11,0,0,12,0,0,0,25,7,10,8,25,6,10,4,0,8,10,0,85,6,0,0,89,8,1,0,88,12,8,0,145,12,12,0,134,11,0,0,24,149,2,0,12,0,0,0,33,9,11,0,1,11,160,20,82,12,6,0,41,12,12,3,3,11,11,12,106,2,11,4,88,3,8,0,145,3,3,0,121,9,21,0,59,11,1,0,145,11,11,0,66,5,11,3,145,5,5,0,38,14,2,7,135,13,231,0,14,5,0,0,145,13,13,0,59,14,2,0,145,14,14,0,65,12,13,14,145,12,12,0,135,11,11,0,12,0,0,0,75,11,11,0,85,7,11,0,82,4,7,0,137,10,0,0,139,4,0,0,119,0,16,0,38,13,2,7,135,14,231,0,13,3,0,0,145,14,14,0,59,13,2,0,145,13,13,0,65,12,14,13,145,12,12,0,135,11,11,0,12,0,0,0,75,11,11,0,85,7,11,0,82,4,7,0,137,10,0,0,139,4,0,0,1,11,0,0,139,11,0,0,140,4,14,0,0,0,0,0,136,12,0,0,0,9,12,0,136,12,0,0,25,12,12,80,137,12,0,0,130,12,0,0,136,13,0,0,49,12,12,13,232,52,2,0,1,13,80,0,135,12,0,0,13,0,0,0,25,5,9,72,25,6,9,68,25,7,9,64,0,4,9,0,89,5,1,0,89,6,2,0,89,7,3,0,0,8,4,0,25,11,8,64,1,12,0,0,85,8,12,0,25,8,8,4,54,12,8,11,12,53,2,0,88,12,5,0,145,12,12,0,89,4,12,0,88,13,6,0,145,13,13,0,113,4,20,13,88,12,7,0,145,12,12,0,113,4,40,12,59,13,1,0,145,13,13,0,113,4,60,13,0,8,0,0,0,10,4,0,25,11,8,64,116,8,10,0,25,8,8,4,25,10,10,4,54,13,8,11,92,53,2,0,137,9,0,0,139,0,0,0,140,2,16,0,0,0,0,0,103,14,1,1,41,14,14,16,79,15,1,0,41,15,15,24,20,14,14,15,103,15,1,2,41,15,15,8,20,14,14,15,0,10,14,0,25,4,0,2,78,2,4,0,103,14,0,1,41,14,14,16,79,15,0,0,41,15,15,24,20,14,14,15,1,15,255,0,19,15,2,15,41,15,15,8,20,14,14,15,0,9,14,0,41,14,2,24,42,14,14,24,32,13,14,0,13,14,9,10,20,14,14,13,121,14,4,0,0,5,4,0,0,12,13,0,119,0,21,0,0,6,4,0,0,7,9,0,25,8,6,1,78,3,8,0,1,14,255,0,19,14,3,14,20,14,7,14,41,14,14,8,0,7,14,0,41,14,3,24,42,14,14,24,32,11,14,0,13,14,7,10,20,14,14,11,121,14,4,0,0,5,8,0,0,12,11,0,119,0,3,0,0,6,8,0,119,0,239,255,121,12,4,0,1,15,0,0,0,14,15,0,119,0,3,0,26,15,5,2,0,14,15,0,139,14,0,0,140,2,16,0,0,0,0,0,136,10,0,0,0,7,10,0,136,10,0,0,25,10,10,16,137,10,0,0,130,10,0,0,136,11,0,0,49,10,10,11,156,54,2,0,1,11,16,0,135,10,0,0,11,0,0,0,25,5,7,4,0,4,7,0,85,5,0,0,85,4,1,0,82,11,5,0,82,12,4,0,134,10,0,0,104,44,0,0,11,12,0,0,82,8,5,0,106,12,8,124,1,11,0,0,106,14,8,20,106,15,8,64,5,13,14,15,41,13,13,2,135,10,3,0,12,11,13,0,82,13,5,0,134,10,0,0,52,146,2,0,13,0,0,0,33,6,10,0,82,9,5,0,0,3,9,0,106,2,9,124,121,6,7,0,134,10,0,0,92,100,0,0,3,2,0,0,137,7,0,0,139,0,0,0,119,0,6,0,134,10,0,0,96,88,0,0,3,2,0,0,137,7,0,0,139,0,0,0,139,0,0,0,140,5,16,0,0,0,0,0,136,13,0,0,0,12,13,0,136,13,0,0,25,13,13,32,137,13,0,0,130,13,0,0,136,14,0,0,49,13,13,14,112,55,2,0,1,14,32,0,135,13,0,0,14,0,0,0,25,6,12,20,25,7,12,16,25,10,12,12,25,9,12,8,25,5,12,4,0,11,12,0,85,6,0,0,85,7,1,0,89,10,2,0,85,9,3,0,85,5,4,0,82,14,7,0,88,15,10,0,145,15,15,0,134,13,0,0,152,51,2,0,14,15,0,0,85,11,13,0,82,13,11,0,82,15,9,0,5,8,13,15,137,12,0,0,82,15,6,0,82,13,5,0,3,13,8,13,41,13,13,2,3,15,15,13,139,15,0,0,140,4,13,0,0,0,0,0,136,10,0,0,0,9,10,0,136,10,0,0,25,10,10,32,137,10,0,0,130,10,0,0,136,11,0,0,49,10,10,11,24,56,2,0,1,11,32,0,135,10,0,0,11,0,0,0,25,5,9,16,25,8,9,12,25,4,9,8,25,7,9,4,0,6,9,0,85,5,0,0,85,8,1,0,85,4,2,0,85,7,3,0,1,10,0,0,85,6,10,0,82,10,7,0,82,11,6,0,57,10,10,11,172,56,2,0,82,11,8,0,82,12,4,0,134,10,0,0,220,43,2,0,11,12,0,0,82,10,4,0,43,10,10,1,85,4,10,0,82,10,8,0,106,10,10,4,1,12,255,0,45,10,10,12,156,56,2,0,82,12,5,0,82,11,8,0,134,10,0,0,32,124,2,0,12,11,0,0,82,10,6,0,25,10,10,1,85,6,10,0,119,0,231,255,137,9,0,0,139,0,0,0,140,0,8,0,0,0,0,0,1,3,192,81,1,4,220,115,82,4,4,0,27,4,4,48,94,3,3,4,36,3,3,0,121,3,2,0,139,0,0,0,1,3,161,120,78,3,3,0,38,3,3,1,121,3,12,0,1,4,236,115,82,4,4,0,38,4,4,31,1,5,192,81,1,6,220,115,82,6,6,0,27,6,6,48,3,5,5,6,106,5,5,28,135,3,217,0,4,5,0,0,2,4,0,0,146,136,0,0,1,5,192,81,1,6,220,115,82,6,6,0,27,6,6,48,3,5,5,6,106,5,5,32,135,3,218,0,4,5,0,0,1,3,192,81,1,5,220,115,82,5,5,0,27,5,5,48,3,0,3,5,2,3,0,0,146,136,0,0,1,4,0,0,82,6,0,0,27,6,6,12,106,7,0,12,135,5,23,1,3,4,6,7,2,7,0,0,146,136,0,0,1,6,192,81,1,4,220,115,82,4,4,0,27,4,4,48,3,6,6,4,25,6,6,32,106,6,6,4,135,5,218,0,7,6,0,0,1,5,192,81,1,6,220,115,82,6,6,0,27,6,6,48,3,1,5,6,2,5,0,0,146,136,0,0,1,7,0,0,82,4,1,0,41,4,4,3,106,3,1,16,135,6,23,1,5,7,4,3,2,3,0,0,146,136,0,0,1,4,192,81,1,7,220,115,82,7,7,0,27,7,7,48,3,4,4,7,25,4,4,32,106,4,4,8,135,6,218,0,3,4,0,0,1,6,192,81,1,4,220,115,82,4,4,0,27,4,4,48,3,2,6,4,2,6,0,0,146,136,0,0,1,3,0,0,82,7,2,0,41,7,7,2,106,5,2,20,135,4,23,1,6,3,7,5,1,4,161,120,78,4,4,0,38,4,4,1,120,4,2,0,139,0,0,0,1,5,236,115,82,5,5,0,38,5,5,31,1,7,0,0,135,4,217,0,5,7,0,0,139,0,0,0,140,3,13,0,0,0,0,0,2,9,0,0,127,29,0,0,136,10,0,0,0,7,10,0,136,10,0,0,25,10,10,16,137,10,0,0,130,10,0,0,136,11,0,0,49,10,10,11,164,58,2,0,1,11,16,0,135,10,0,0,11,0,0,0,25,4,7,8,25,6,7,4,0,5,7,0,109,7,12,0,85,4,1,0,85,6,2,0,134,10,0,0,0,141,2,0,1,10,252,117,82,12,4,0,41,12,12,2,135,11,6,0,12,0,0,0,85,10,11,0,1,11,0,0,85,5,11,0,82,11,4,0,82,10,5,0,56,11,11,10,76,59,2,0,1,11,0,2,135,3,6,0,11,0,0,0,1,11,252,117,82,11,11,0,82,10,5,0,41,10,10,2,97,11,10,3,82,10,5,0,41,10,10,2,0,8,10,0,1,11,252,117,82,11,11,0,94,11,11,8,82,12,6,0,94,12,12,8,135,10,17,0,11,12,0,0,82,10,5,0,25,10,10,1,85,5,10,0,119,0,231,255,1,10,0,118,82,12,4,0,85,10,12,0,137,7,0,0,139,0,0,0,140,2,16,0,0,0,0,0,1,11,0,0,136,13,0,0,0,12,13,0,136,13,0,0,25,13,13,16,137,13,0,0,130,13,0,0,136,14,0,0,49,13,13,14,156,59,2,0,1,14,16,0,135,13,0,0,14,0,0,0,0,5,12,0,1,13,255,0,19,13,1,13,0,6,13,0,83,5,6,0,25,9,0,16,82,2,9,0,120,2,10,0,134,13,0,0,40,139,2,0,0,0,0,0,120,13,4,0,82,4,9,0,1,11,4,0,119,0,5,0,1,8,255,255,119,0,3,0,0,4,2,0,1,11,4,0,32,13,11,4,121,13,26,0,25,10,0,20,82,3,10,0,48,13,3,4,44,60,2,0,1,13,255,0,19,13,1,13,0,7,13,0,102,13,0,75,46,13,7,13,44,60,2,0,25,13,3,1,85,10,13,0,83,3,6,0,0,8,7,0,119,0,11,0,106,14,0,36,38,14,14,15,1,15,1,0,135,13,1,1,14,0,5,15,32,13,13,1,121,13,3,0,79,8,5,0,119,0,2,0,1,8,255,255,137,12,0,0,139,8,0,0,140,1,10,0,0,0,0,0,136,8,0,0,0,3,8,0,136,8,0,0,25,8,8,16,137,8,0,0,130,8,0,0,136,9,0,0,49,8,8,9,148,60,2,0,1,9,16,0,135,8,0,0,9,0,0,0,25,1,3,4,0,2,3,0,85,1,0,0,82,4,1,0,82,8,1,0,79,8,8,0,103,9,4,1,41,9,9,8,3,8,8,9,103,9,4,2,41,9,9,16,3,8,8,9,85,2,8,0,82,8,2,0,82,9,2,0,41,9,9,3,21,8,8,9,85,2,8,0,82,5,2,0,43,8,5,5,3,8,5,8,85,2,8,0,82,8,2,0,82,9,2,0,41,9,9,4,21,8,8,9,85,2,8,0,82,6,2,0,43,8,6,17,3,8,6,8,85,2,8,0,82,8,2,0,82,9,2,0,41,9,9,25,21,8,8,9,85,2,8,0,82,7,2,0,43,8,7,6,3,8,7,8,85,2,8,0,137,3,0,0,82,8,2,0,139,8,0,0,140,2,11,0,0,0,0,0,136,8,0,0,0,6,8,0,136,8,0,0,25,8,8,16,137,8,0,0,130,8,0,0,136,9,0,0,49,8,8,9,120,61,2,0,1,9,16,0,135,8,0,0,9,0,0,0,25,4,6,8,25,5,6,4,0,3,6,0,85,4,0,0,85,5,1,0,82,7,5,0,82,9,4,0,82,9,9,0,1,10,0,0,4,10,10,7,3,9,9,10,26,9,9,4,25,10,7,4,134,8,0,0,8,115,2,0,9,10,0,0,85,3,8,0,82,8,4,0,82,8,8,0,82,10,3,0,43,10,10,24,83,8,10,0,82,10,4,0,82,10,10,0,82,8,3,0,43,8,8,16,107,10,1,8,82,8,4,0,82,8,8,0,82,10,3,0,43,10,10,8,107,8,2,10,82,10,4,0,82,10,10,0,82,8,3,0,107,10,3,8,82,2,4,0,82,8,2,0,25,8,8,4,85,2,8,0,137,6,0,0,139,0,0,0,140,3,12,0,0,0,0,0,136,8,0,0,0,7,8,0,136,8,0,0,25,8,8,32,137,8,0,0,130,8,0,0,136,9,0,0,49,8,8,9,88,62,2,0,1,9,32,0,135,8,0,0,9,0,0,0,25,5,7,16,25,4,7,8,0,6,7,0,89,6,1,0,88,3,6,0,145,3,3,0,116,4,0,0,106,9,0,4,109,4,4,9,78,9,2,0,83,5,9,0,102,8,2,1,107,5,1,8,102,9,2,2,107,5,2,9,102,8,2,3,107,5,3,8,1,9,0,0,1,10,104,1,1,11,36,0,134,8,0,0,52,201,0,0,4,3,9,10,11,5,0,0,137,7,0,0,139,0,0,0,140,3,12,0,0,0,0,0,1,7,0,0,136,9,0,0,0,8,9,0,136,9,0,0,25,9,9,16,137,9,0,0,130,9,0,0,136,10,0,0,49,9,9,10,252,62,2,0,1,10,16,0,135,9,0,0,10,0,0,0,25,3,8,12,25,4,8,8,25,6,8,4,0,5,8,0,85,3,0,0,85,4,1,0,85,6,2,0,1,9,0,0,85,5,9,0,82,10,5,0,82,11,6,0,47,10,10,11,68,63,2,0,82,10,5,0,1,11,2,1,15,10,10,11,0,9,10,0,119,0,3,0,1,10,0,0,0,9,10,0,120,9,3,0,1,7,5,0,119,0,15,0,82,9,3,0,82,10,5,0,91,9,9,10,82,10,4,0,82,11,5,0,91,10,10,11,46,9,9,10,128,63,2,0,1,7,5,0,119,0,5,0,82,9,5,0,25,9,9,1,85,5,9,0,119,0,229,255,32,9,7,5,121,9,4,0,137,8,0,0,82,9,5,0,139,9,0,0,1,9,0,0,139,9,0,0,140,1,14,0,0,0,0,0,1,9,0,0,25,8,0,20,25,7,0,28,82,10,7,0,82,11,8,0,48,10,10,11,0,64,2,0,106,11,0,36,38,11,11,15,1,12,0,0,1,13,0,0,135,10,1,1,11,0,12,13,82,10,8,0,120,10,3,0,1,4,255,255,119,0,4,0,1,9,3,0,119,0,2,0,1,9,3,0,32,10,9,3,121,10,29,0,25,5,0,4,82,1,5,0,25,3,0,8,82,2,3,0,48,10,1,2,80,64,2,0,4,6,1,2,106,11,0,40,38,11,11,3,34,13,6,0,41,13,13,31,42,13,13,31,1,12,1,0,135,10,24,1,11,0,6,13,12,0,0,0,135,10,1,0,1,11,0,0,109,0,16,11,1,11,0,0,85,7,11,0,1,11,0,0,85,8,11,0,1,11,0,0,85,3,11,0,1,11,0,0,85,5,11,0,1,4,0,0,139,4,0,0,140,2,11,0,0,0,0,0,136,8,0,0,0,7,8,0,136,8,0,0,25,8,8,16,137,8,0,0,130,8,0,0,136,9,0,0,49,8,8,9,184,64,2,0,1,9,16,0,135,8,0,0,9,0,0,0,25,5,7,4,0,4,7,0,85,5,0,0,85,4,1,0,82,9,5,0,82,10,4,0,134,8,0,0,104,44,0,0,9,10,0,0,82,10,5,0,134,8,0,0,52,146,2,0,10,0,0,0,33,6,8,0,82,2,5,0,82,8,5,0,82,10,4,0,134,3,0,0,200,253,1,0,8,10,0,0,121,6,7,0,134,10,0,0,92,100,0,0,2,3,0,0,137,7,0,0,139,0,0,0,119,0,6,0,134,10,0,0,96,88,0,0,2,3,0,0,137,7,0,0,139,0,0,0,139,0,0,0,140,2,11,0,0,0,0,0,1,7,0,0,136,9,0,0,0,8,9,0,136,9,0,0,25,9,9,16,137,9,0,0,130,9,0,0,136,10,0,0,49,9,9,10,120,65,2,0,1,10,16,0,135,9,0,0,10,0,0,0,25,4,8,8,25,6,8,4,0,5,8,0,85,4,1,0,1,9,63,0,85,6,9,0,1,9,0,0,85,5,9,0,106,9,0,4,82,10,5,0,49,9,9,10,176,65,2,0,1,7,6,0,119,0,12,0,82,2,5,0,106,9,0,32,82,10,5,0,27,10,10,36,94,9,9,10,82,10,4,0,52,9,9,10,220,65,2,0,25,9,2,1,85,5,9,0,119,0,240,255,32,9,7,6,121,9,4,0,82,3,6,0,137,8,0,0,139,3,0,0,85,6,2,0,82,3,6,0,137,8,0,0,139,3,0,0,140,2,10,0,0,0,0,0,136,7,0,0,0,6,7,0,136,7,0,0,25,7,7,32,137,7,0,0,130,7,0,0,136,8,0,0,49,7,7,8,56,66,2,0,1,8,32,0,135,7,0,0,8,0,0,0,0,5,6,0,25,3,6,16,25,4,6,8,85,3,1,0,1,7,156,29,82,7,7,0,85,4,7,0,1,8,160,29,82,8,8,0,109,4,4,8,82,8,3,0,34,8,8,10,121,8,9,0,1,8,240,81,82,7,3,0,41,7,7,3,3,2,8,7,116,4,2,0,106,8,2,4,109,4,4,8,119,0,8,0,1,8,10,0,85,5,8,0,1,7,4,0,1,9,188,43,134,8,0,0,216,31,2,0,7,9,5,0,116,0,4,0,106,9,4,4,109,0,4,9,137,6,0,0,139,0,0,0,140,2,13,0,0,0,0,0,127,9,0,0,87,9,0,0,127,9,0,0,82,2,9,0,127,9,0,0,106,3,9,4,1,9,52,0,135,4,25,1,2,3,9,0,135,9,1,0,1,9,255,7,19,9,4,9,1,11,0,0,1,10,0,8,138,9,11,10,72,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0], eb + 143360);
  HEAPU8.set([0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,0,99,2,0,144,99,2,0,1,10,255,7,19,10,4,10,1,11,254,3,4,10,10,11,85,1,10,0,127,10,0,0,85,10,2,0,127,10,0,0,2,11,0,0,255,255,15,128,19,11,3,11,2,12,0,0,0,0,224,63,20,11,11,12,109,10,4,11,127,11,0,0,86,6,11,0,119,0,21,0,59,10,0,0,70,10,0,10,121,10,11,0,61,10,0,0,0,0,128,95,65,10,0,10,134,5,0,0,188,66,2,0,10,1,0,0,82,10,1,0,26,7,10,64,58,8,5,0,119,0,3,0,1,7,0,0,58,8,0,0,85,1,7,0,58,6,8,0,119,0,3,0,58,6,0,0,119,0,1,0,139,6,0,0,140,2,12,0,0,0,0,0,136,10,0,0,0,7,10,0,136,10,0,0,25,10,10,16,137,10,0,0,130,10,0,0,136,11,0,0,49,10,10,11,212,99,2,0,1,11,16,0,135,10,0,0,11,0,0,0,25,5,7,4,0,6,7,0,89,5,0,0,89,6,1,0,88,2,5,0,145,2,2,0,1,10,192,81,1,11,220,115,82,11,11,0,27,11,11,48,3,8,10,11,106,11,8,16,106,10,8,4,41,10,10,1,41,10,10,2,101,11,10,2,88,3,6,0,145,3,3,0,1,10,192,81,1,11,220,115,82,11,11,0,27,11,11,48,3,9,10,11,106,11,9,16,106,10,9,4,41,10,10,1,25,10,10,1,41,10,10,2,101,11,10,3,1,10,192,81,1,11,220,115,82,11,11,0,27,11,11,48,3,10,10,11,25,4,10,4,82,10,4,0,25,10,10,1,85,4,10,0,137,7,0,0,139,0,0,0,140,2,11,0,0,0,0,0,136,8,0,0,0,7,8,0,136,8,0,0,25,8,8,16,137,8,0,0,130,8,0,0,136,9,0,0,49,8,8,9,172,100,2,0,1,9,16,0,135,8,0,0,9,0,0,0,0,6,7,0,1,9,202,61,78,10,1,0,134,8,0,0,168,154,2,0,9,10,0,0,120,8,7,0,134,8,0,0,144,162,2,0,1,10,28,0,85,8,10,0,1,5,0,0,119,0,31,0,134,10,0,0,164,120,2,0,1,0,0,0,2,8,0,0,0,128,0,0,20,10,10,8,0,4,10,0,85,6,0,0,109,6,4,4,1,8,182,1,109,6,8,8,1,10,5,0,135,8,26,1,10,6,0,0,134,2,0,0,156,153,2,0,8,0,0,0,34,8,2,0,121,8,3,0,1,5,0,0,119,0,10,0,134,3,0,0,248,238,1,0,2,1,0,0,120,3,5,0,135,8,27,1,2,0,0,0,1,5,0,0,119,0,2,0,0,5,3,0,137,7,0,0,139,5,0,0,140,2,6,0,0,0,0,0,78,2,1,0,41,5,2,24,42,5,5,24,120,5,3,0,0,4,0,0,119,0,47,0,41,5,2,24,42,5,5,24,134,3,0,0,168,154,2,0,0,5,0,0,120,3,3,0,1,4,0,0,119,0,39,0,102,5,1,1,120,5,3,0,0,4,3,0,119,0,35,0,102,5,3,1,120,5,3,0,1,4,0,0,119,0,31,0,102,5,1,2,120,5,5,0,134,4,0,0,132,117,2,0,3,1,0,0,119,0,25,0,102,5,3,2,120,5,3,0,1,4,0,0,119,0,21,0,102,5,1,3,120,5,5,0,134,4,0,0,120,53,2,0,3,1,0,0,119,0,15,0,102,5,3,3,120,5,3,0,1,4,0,0,119,0,11,0,102,5,1,4,120,5,5,0,134,4,0,0,188,49,2,0,3,1,0,0,119,0,5,0,134,4,0,0,248,17,1,0,3,1,0,0,119,0,1,0,139,4,0,0,140,3,13,0,0,0,0,0,136,9,0,0,0,8,9,0,136,9,0,0,25,9,9,16,137,9,0,0,130,9,0,0,136,10,0,0,49,9,9,10,116,102,2,0,1,10,16,0,135,9,0,0,10,0,0,0,25,7,8,12,25,4,8,8,25,6,8,4,0,5,8,0,85,4,0,0,85,6,1,0,85,5,2,0,1,9,0,0,82,10,6,0,49,9,9,10,192,102,2,0,82,9,6,0,82,10,5,0,47,9,9,10,192,102,2,0,116,7,6,0,82,3,7,0,137,8,0,0,139,3,0,0,82,10,4,0,82,11,6,0,82,12,5,0,134,9,0,0,4,229,1,0,10,11,12,0,85,7,9,0,82,3,7,0,137,8,0,0,139,3,0,0,140,2,18,0,0,0,0,0,136,12,0,0,0,11,12,0,136,12,0,0,25,12,12,16,137,12,0,0,130,12,0,0,136,13,0,0,49,12,12,13,32,103,2,0,1,13,16,0,135,12,0,0,13,0,0,0,0,8,11,0,88,2,0,0,145,2,2,0,88,12,1,0,145,12,12,0,64,9,2,12,145,9,9,0,88,3,0,0,145,3,3,0,88,13,1,0,145,13,13,0,64,12,3,13,145,12,12,0,65,7,9,12,145,7,7,0,112,4,0,4,145,4,4,0,112,12,1,4,145,12,12,0,64,10,4,12,145,10,10,0,112,5,0,4,145,5,5,0,112,16,1,4,145,16,16,0,64,15,5,16,145,15,15,0,65,14,10,15,145,14,14,0,63,13,7,14,145,13,13,0,135,12,230,0,13,0,0,0,145,12,12,0,89,8,12,0,88,6,8,0,145,6,6,0,137,11,0,0,145,12,6,0,139,12,0,0,140,1,11,0,0,0,0,0,136,7,0,0,0,6,7,0,136,7,0,0,25,7,7,16,137,7,0,0,130,7,0,0,136,8,0,0,49,7,7,8,248,103,2,0,1,8,16,0,135,7,0,0,8,0,0,0,25,5,6,4,0,4,6,0,89,4,0,0,88,7,4,0,145,7,7,0,62,8,0,0,26,195,59,192,220,181,164,63,145,8,8,0,72,3,7,8,88,1,4,0,145,1,1,0,121,3,14,0,62,7,0,0,42,162,203,64,10,215,41,64,145,7,7,0,66,8,1,7,145,8,8,0,89,5,8,0,88,2,5,0,145,2,2,0,137,6,0,0,145,8,2,0,139,8,0,0,119,0,24,0,62,10,0,0,45,167,251,191,245,40,172,63,145,10,10,0,63,9,1,10,145,9,9,0,62,10,0,0,148,129,168,160,71,225,240,63,145,10,10,0,66,7,9,10,145,7,7,0,61,10,0,0,154,153,25,64,135,8,10,0,7,10,0,0,145,8,8,0,89,5,8,0,88,2,5,0,145,2,2,0,137,6,0,0,145,8,2,0,139,8,0,0,59,8,0,0,145,8,8,0,139,8,0,0,140,1,11,0,0,0,0,0,136,7,0,0,0,6,7,0,136,7,0,0,25,7,7,16,137,7,0,0,130,7,0,0,136,8,0,0,49,7,7,8,0,105,2,0,1,8,16,0,135,7,0,0,8,0,0,0,25,5,6,4,0,4,6,0,89,4,0,0,88,7,4,0,145,7,7,0,62,8,0,0,8,79,230,127,195,165,105,63,145,8,8,0,72,3,7,8,88,1,4,0,145,1,1,0,121,3,14,0,62,7,0,0,42,162,203,64,10,215,41,64,145,7,7,0,65,8,1,7,145,8,8,0,89,5,8,0,88,2,5,0,145,2,2,0,137,6,0,0,145,8,2,0,139,8,0,0,119,0,24,0,61,10,0,0,85,85,213,62,135,9,10,0,1,10,0,0,145,9,9,0,62,10,0,0,148,129,168,160,71,225,240,63,145,10,10,0,65,7,9,10,145,7,7,0,62,10,0,0,45,167,251,191,245,40,172,63,145,10,10,0,64,8,7,10,145,8,8,0,89,5,8,0,88,2,5,0,145,2,2,0,137,6,0,0,145,8,2,0,139,8,0,0,59,8,0,0,145,8,8,0,139,8,0,0,140,2,12,0,0,0,0,0,136,8,0,0,0,7,8,0,136,8,0,0,25,8,8,16,137,8,0,0,130,8,0,0,136,9,0,0,49,8,8,9,8,106,2,0,1,9,16,0,135,8,0,0,9,0,0,0,0,5,7,0,112,2,1,4,145,2,2,0,112,8,0,4,145,8,8,0,64,6,2,8,145,6,6,0,88,3,1,0,145,3,3,0,88,11,0,0,145,11,11,0,64,10,3,11,145,10,10,0,134,9,0,0,160,151,1,0,6,10,0,0,145,9,9,0,62,10,0,0,72,183,111,255,219,165,76,64,145,10,10,0,65,8,9,10,145,8,8,0,89,5,8,0,88,8,5,0,145,8,8,0,59,10,0,0,145,10,10,0,71,8,8,10,120,8,6,0,88,4,5,0,145,4,4,0,137,7,0,0,145,8,4,0,139,8,0,0,88,10,5,0,145,10,10,0,59,9,104,1,145,9,9,0,63,8,10,9,145,8,8,0,89,5,8,0,88,4,5,0,145,4,4,0,137,7,0,0,145,8,4,0,139,8,0,0,140,1,10,0,0,0,0,0,1,5,0,0,136,7,0,0,0,6,7,0,136,7,0,0,25,7,7,16,137,7,0,0,130,7,0,0,136,8,0,0,49,7,7,8,0,107,2,0,1,8,16,0,135,7,0,0,8,0,0,0,0,2,6,0,25,3,6,4,85,2,0,0,1,7,0,0,83,3,7,0,1,7,175,120,82,8,2,0,90,7,7,8,1,8,178,120,82,9,2,0,90,8,8,9,46,7,7,8,80,107,2,0,1,7,175,120,82,8,2,0,90,7,7,8,33,7,7,1,121,7,4,0,1,5,3,0,119,0,2,0,1,5,3,0,32,7,5,3,121,7,11,0,1,8,1,0,134,7,0,0,12,144,2,0,8,0,0,0,120,7,6,0,78,1,3,0,38,7,1,1,0,4,7,0,137,6,0,0,139,4,0,0,1,7,1,0,83,3,7,0,78,1,3,0,38,7,1,1,0,4,7,0,137,6,0,0,139,4,0,0,140,1,10,0,0,0,0,0,135,9,16,0,0,0,0,0,25,9,9,1,135,1,6,0,9,0,0,0,135,9,17,0,1,0,0,0,1,9,166,73,134,5,0,0,96,101,2,0,1,9,0,0,121,5,3,0,1,9,0,0,83,5,9,0,1,9,170,73,134,6,0,0,96,101,2,0,1,9,0,0,121,6,3,0,1,9,0,0,83,6,9,0,1,9,174,73,134,7,0,0,96,101,2,0,1,9,0,0,121,7,3,0,1,9,0,0,83,7,9,0,1,9,178,73,134,2,0,0,96,101,2,0,1,9,0,0,121,2,3,0,1,9,0,0,83,2,9,0,1,9,184,73,134,3,0,0,96,101,2,0,1,9,0,0,121,3,3,0,1,9,0,0,83,3,9,0,134,4,0,0,104,158,0,0,1,0,0,0,120,4,5,0,134,8,0,0,176,41,2,0,1,0,0,0,119,0,2,0,0,8,4,0,135,9,8,0,1,0,0,0,139,8,0,0,140,1,12,0,0,0,0,0,1,10,255,255,106,11,0,76,47,10,10,11,168,108,2,0,134,7,0,0,88,162,2,0,0,0,0,0,119,0,2,0,1,7,0,0,134,10,0,0,68,148,2,0,0,0,0,0,82,10,0,0,38,10,10,1,33,9,10,0,120,9,17,0,134,5,0,0,240,161,2,0,106,2,0,52,25,1,0,56,121,2,3,0,82,11,1,0,109,2,56,11,82,3,1,0,121,3,2,0,109,3,52,2,82,11,5,0,45,11,11,0,0,109,2,0,85,5,3,0,134,11,0,0,32,162,2,0,134,6,0,0,148,36,2,0,0,0,0,0,106,10,0,12,38,10,10,15,135,11,28,1,10,0,0,0,20,11,11,6,0,8,11,0,106,4,0,96,121,4,3,0,135,11,8,0,4,0,0,0,121,9,6,0,121,7,7,0,134,11,0,0,76,162,2,0,0,0,0,0,119,0,3,0,135,11,8,0,0,0,0,0,139,8,0,0,140,0,8,0,0,0,0,0,136,5,0,0,0,2,5,0,136,5,0,0,25,5,5,64,137,5,0,0,130,5,0,0,136,6,0,0,49,5,5,6,152,109,2,0,1,6,64,0,135,5,0,0,6,0,0,0,0,0,2,0,1,5,0,0,1,6,144,115,82,6,6,0,47,5,5,6,28,110,2,0,0,1,0,0,1,5,192,73,1,6,144,115,82,6,6,0,26,6,6,1,41,6,6,6,3,3,5,6,25,4,1,64,116,1,3,0,25,1,1,4,25,3,3,4,54,6,1,4,208,109,2,0,1,6,76,115,82,1,6,0,0,3,0,0,25,4,1,64,116,1,3,0,25,1,1,4,25,3,3,4,54,6,1,4,244,109,2,0,1,6,144,115,1,5,144,115,82,5,5,0,26,5,5,1,85,6,5,0,1,5,144,115,82,5,5,0,32,5,5,0,1,6,144,29,82,6,6,0,1,7,0,23,13,6,6,7,19,5,5,6,120,5,3,0,137,2,0,0,139,0,0,0,1,5,76,115,1,6,80,115,85,5,6,0,1,6,160,120,1,5,0,0,83,6,5,0,137,2,0,0,139,0,0,0,140,1,9,0,0,0,0,0,136,6,0,0,0,5,6,0,136,6,0,0,25,6,6,16,137,6,0,0,130,6,0,0,136,7,0,0,49,6,6,7,160,110,2,0,1,7,16,0,135,6,0,0,7,0,0,0,25,4,5,8,25,3,5,4,0,2,5,0,85,3,0,0,1,6,0,0,85,2,6,0,82,6,3,0,121,6,7,0,82,7,3,0,1,8,93,46,134,6,0,0,228,122,2,0,7,8,0,0,85,2,6,0,82,6,2,0,121,6,11,0,82,6,2,0,82,8,3,0,46,6,6,8,8,111,2,0,82,6,2,0,25,6,6,1,85,4,6,0,82,1,4,0,137,5,0,0,139,1,0,0,116,4,3,0,82,1,4,0,137,5,0,0,139,1,0,0,140,2,9,0,0,0,0,0,136,6,0,0,0,5,6,0,136,6,0,0,25,6,6,16,137,6,0,0,130,6,0,0,136,7,0,0,49,6,6,7,80,111,2,0,1,7,16,0,135,6,0,0,7,0,0,0,25,3,5,8,25,4,5,4,89,4,0,0,89,5,1,0,88,7,4,0,145,7,7,0,135,6,237,0,7,0,0,0,145,6,6,0,89,4,6,0,88,6,4,0,145,6,6,0,59,7,1,0,145,7,7,0,72,6,6,7,121,6,14,0,59,7,1,0,145,7,7,0,88,8,4,0,145,8,8,0,64,6,7,8,145,6,6,0,89,3,6,0,88,2,3,0,145,2,2,0,137,5,0,0,145,6,2,0,139,6,0,0,119,0,9,0,59,6,0,0,145,6,6,0,89,3,6,0,88,2,3,0,145,2,2,0,137,5,0,0,145,6,2,0,139,6,0,0,59,6,0,0,145,6,6,0,139,6,0,0,140,3,9,0,0,0,0,0,136,6,0,0,0,5,6,0,136,6,0,0,1,7,16,1,3,6,6,7,137,6,0,0,130,6,0,0,136,7,0,0,49,6,6,7,44,112,2,0,1,7,16,1,135,6,0,0,7,0,0,0,1,6,12,1,3,3,5,6,0,4,5,0,85,3,0,0,1,6,8,1,97,5,6,1,1,6,4,1,97,5,6,2,82,6,3,0,32,6,6,4,121,6,16,0,1,6,0,0,121,6,14,0,135,6,29,1,4,0,0,0,82,6,4,0,121,6,5,0,135,6,30,1,135,6,29,1,4,0,0,0,119,0,6,0,1,7,0,0,1,8,1,0,135,6,31,1,7,8,0,0,119,0,1,0,137,5,0,0,1,6,0,0,139,6,0,0,140,1,9,0,0,0,0,0,1,4,0,0,136,6,0,0,0,5,6,0,136,6,0,0,25,6,6,16,137,6,0,0,130,6,0,0,136,7,0,0,49,6,6,7,220,112,2,0,1,7,16,0,135,6,0,0,7,0,0,0,25,3,5,4,0,2,5,0,85,3,0,0,1,6,0,0,85,2,6,0,1,6,0,4,82,7,2,0,49,6,6,7,8,113,2,0,1,4,6,0,119,0,22,0,82,6,3,0,82,7,2,0,90,6,6,7,120,6,2,0,119,0,17,0,82,7,3,0,82,8,2,0,90,7,7,8,134,6,0,0,144,157,2,0,7,0,0,0,1,7,255,0,19,6,6,7,0,1,6,0,1,6,192,106,82,7,2,0,95,6,7,1,82,7,2,0,25,7,7,1,85,2,7,0,119,0,230,255,32,7,4,6,121,7,4,0,137,5,0,0,1,7,192,106,139,7,0,0,1,7,192,106,82,6,2,0,1,8,0,0,95,7,6,8,137,5,0,0,1,8,192,106,139,8,0,0,140,2,14,0,0,0,0,0,136,7,0,0,0,4,7,0,136,7,0,0,25,7,7,16,137,7,0,0,130,7,0,0,136,8,0,0,49,7,7,8,196,113,2,0,1,8,16,0,135,7,0,0,8,0,0,0,25,3,4,4,0,2,4,0,85,3,0,0,85,2,1,0,1,7,236,117,82,8,3,0,85,7,8,0,1,8,240,117,82,7,2,0,85,8,7,0,1,7,244,117,82,5,7,0,1,7,248,117,82,6,7,0,28,8,5,2,28,9,6,2,1,10,236,117,82,10,10,0,4,10,10,5,1,11,240,117,82,11,11,0,4,11,11,6,134,7,0,0,8,127,2,0,8,9,10,11,1,11,1,23,134,7,0,0,148,146,2,0,11,0,0,0,134,7,0,0,92,145,2,0,59,11,0,0,1,10,236,117,82,10,10,0,76,10,10,0,1,9,240,117,82,9,9,0,76,9,9,0,59,8,0,0,59,12,0,0,59,13,1,0,134,7,0,0,136,245,1,0,11,10,9,8,12,13,0,0,1,13,0,23,134,7,0,0,148,146,2,0,13,0,0,0,134,7,0,0,92,145,2,0,137,4,0,0,139,0,0,0,140,3,12,0,0,0,0,0,136,8,0,0,0,7,8,0,136,8,0,0,25,8,8,16,137,8,0,0,130,8,0,0,136,9,0,0,49,8,8,9,208,114,2,0,1,9,16,0,135,8,0,0,9,0,0,0,25,5,7,8,25,4,7,4,0,6,7,0,85,5,0,0,85,4,1,0,85,6,2,0,82,8,5,0,82,10,4,0,82,11,6,0,5,9,10,11,41,9,9,2,3,3,8,9,137,7,0,0,139,3,0,0,140,2,13,0,0,0,0,0,136,8,0,0,0,7,8,0,136,8,0,0,25,8,8,16,137,8,0,0,130,8,0,0,136,9,0,0,49,8,8,9,64,115,2,0,1,9,16,0,135,8,0,0,9,0,0,0,25,3,7,12,25,6,7,8,25,4,7,4,0,5,7,0,85,3,0,0,85,6,1,0,1,8,255,255,85,4,8,0,1,8,0,0,85,5,8,0,82,2,4,0,82,8,6,0,82,9,5,0,56,8,8,9,192,115,2,0,43,8,2,8,1,9,96,16,82,10,3,0,82,11,5,0,91,10,10,11,82,11,4,0,1,12,255,0,19,11,11,12,21,10,10,11,41,10,10,2,94,9,9,10,21,8,8,9,85,4,8,0,82,8,5,0,25,8,8,1,85,5,8,0,119,0,235,255,137,7,0,0,11,8,2,0,139,8,0,0,140,2,12,0,0,0,0,0,120,0,4,0,135,5,6,0,1,0,0,0,139,5,0,0,1,7,191,255,48,7,7,1,8,116,2,0,134,7,0,0,144,162,2,0,1,8,48,0,85,7,8,0,1,5,0,0,139,5,0,0,26,8,0,8,35,9,1,11,121,9,4,0,1,9,16,0,0,7,9,0,119,0,4,0,25,9,1,11,38,9,9,248,0,7,9,0,134,4,0,0,220,35,1,0,8,7,0,0,121,4,3,0,25,5,4,8,139,5,0,0,135,3,6,0,1,0,0,0,120,3,3,0,1,5,0,0,139,5,0,0,26,7,0,4,82,2,7,0,38,7,2,248,38,9,2,3,32,9,9,0,1,10,8,0,1,11,4,0,125,8,9,10,11,0,0,0,4,6,7,8,16,11,6,1,125,7,11,6,1,0,0,0,135,8,29,0,3,0,7,0,135,8,8,0,0,0,0,0,0,5,3,0,139,5,0,0,140,1,10,0,0,0,0,0,136,6,0,0,0,5,6,0,136,6,0,0,25,6,6,32,137,6,0,0,130,6,0,0,136,7,0,0,49,6,6,7,220,116,2,0,1,7,32,0,135,6,0,0,7,0,0,0,25,2,5,16,25,3,5,8,0,4,5,0,89,2,0,0,1,6,0,0,85,3,6,0,1,7,0,0,109,3,4,7,88,6,2,0,145,6,6,0,59,8,232,3,145,8,8,0,66,7,6,8,145,7,7,0,75,7,7,0,85,4,7,0,82,7,4,0,1,8,232,3,5,1,7,8,76,8,1,0,145,1,8,0,88,7,2,0,145,7,7,0,64,8,7,1,145,8,8,0,89,2,8,0,116,3,4,0,88,6,2,0,145,6,6,0,60,9,0,0,64,66,15,0,145,9,9,0,65,7,6,9,145,7,7,0,75,7,7,0,109,3,4,7,135,7,32,1,3,3,0,0,32,7,7,255,120,7,253,255,137,5,0,0,139,0,0,0,140,2,15,0,0,0,0,0,2,11,0,0,255,0,0,0,2,12,0,0,255,255,0,0,79,13,1,0,41,13,13,8,103,14,1,1,20,13,13,14,0,10,13,0,25,5,0,1,78,2,5,0,41,13,2,24,42,13,13,24,120,13,3,0,1,4,0,0,119,0,25,0,0,7,5,0,79,13,0,0,41,13,13,8,19,14,2,11,20,13,13,14,0,8,13,0,19,13,8,12,0,6,13,0,52,13,6,10,40,118,2,0,25,9,7,1,78,3,9,0,41,13,3,24,42,13,13,24,120,13,3,0,1,4,0,0,119,0,8,0,0,7,9,0,41,13,6,8,19,14,3,11,20,13,13,14,0,8,13,0,119,0,240,255,26,4,7,1,139,4,0,0,140,1,8,0,0,0,0,0,1,3,0,0,136,5,0,0,0,4,5,0,136,5,0,0,25,5,5,16,137,5,0,0,130,5,0,0,136,6,0,0,49,5,5,6,108,118,2,0,1,6,16,0,135,5,0,0,6,0,0,0,25,1,4,4,0,2,4,0,85,1,0,0,1,5,0,0,85,2,5,0,82,5,1,0,1,6,0,0,1,7,4,0,138,5,6,7,164,118,2,0,180,118,2,0,188,118,2,0,196,118,2,0,119,0,11,0,1,6,1,0,85,2,6,0,1,3,3,0,119,0,7,0,1,3,3,0,119,0,5,0,1,3,4,0,119,0,3,0,1,3,5,0,119,0,1,0,32,5,3,3,121,5,4,0,1,5,2,0,85,2,5,0,1,3,4,0,32,5,3,4,121,5,4,0,1,5,3,0,85,2,5,0,1,3,5,0,32,5,3,5,121,5,3,0,1,5,3,0,85,2,5,0,137,4,0,0,82,5,2,0,139,5,0,0,140,5,16,0,0,0,0,0,136,11,0,0,0,10,11,0,136,11,0,0,1,12,0,1,3,11,11,12,137,11,0,0,130,11,0,0,136,12,0,0,49,11,11,12,76,119,2,0,1,12,0,1,135,11,0,0,12,0,0,0,0,8,10,0,15,11,3,2,2,12,0,0,0,32,1,0,19,12,4,12,32,12,12,0,19,11,11,12,121,11,33,0,4,9,2,3,41,12,1,24,42,12,12,24,1,14,0,1,16,14,9,14,1,15,0,1,125,13,14,9,15,0,0,0,135,11,3,0,8,12,13,0,1,11,255,0,48,11,11,9,220,119,2,0,4,5,2,3,0,7,9,0,1,13,0,1,134,11,0,0,232,156,2,0,0,8,13,0,1,11,0,1,4,7,7,11,1,11,255,0,55,11,11,7,168,119,2,0,1,11,255,0,19,11,5,11,0,6,11,0,119,0,2,0,0,6,9,0,134,11,0,0,232,156,2,0,0,8,6,0,137,10,0,0,139,0,0,0,140,1,8,0,0,0,0,0,136,6,0,0,0,3,6,0,136,6,0,0,25,6,6,64,137,6,0,0,130,6,0,0,136,7,0,0,49,6,6,7,44,120,2,0,1,7,64,0,135,6,0,0,7,0,0,0,0,1,3,0,0,2,1,0,25,5,2,64,1,6,0,0,85,2,6,0,25,2,2,4,54,6,2,5,56,120,2,0,59,6,1,0,145,6,6,0,89,1,6,0,59,7,1,0,145,7,7,0,113,1,20,7,59,6,1,0,145,6,6,0,113,1,40,6,59,7,1,0,145,7,7,0,113,1,60,7,0,2,0,0,0,4,1,0,25,5,2,64,116,2,4,0,25,2,2,4,25,4,4,4,54,7,2,5,136,120,2,0,137,3,0,0,139,0,0,0,140,1,13,0,0,0,0,0,1,12,43,0,134,11,0,0,168,154,2,0,0,12,0,0,32,7,11,0,78,1,0,0,41,11,1,24,42,11,11,24,0,10,11,0,121,7,5,0,33,12,10,114,38,12,12,1,0,11,12,0,119,0,3,0,1,12,2,0,0,11,12,0,0,2,11,0,1,12,120,0,134,11,0,0,168,154,2,0,0,12,0,0,32,9,11,0,121,9,3,0,0,11,2,0,119,0,4,0,1,12,128,0,20,12,2,12,0,11,12,0,0,5,11,0,1,12,101,0,134,11,0,0,168,154,2,0,0,12,0,0,32,8,11,0,121,8,3,0,0,11,5,0,119,0,5,0,2,12,0,0,0,0,8,0,20,12,5,12,0,11,12,0,0,3,11,0,32,12,10,114,121,12,3,0,0,11,3,0,119,0,3,0,39,12,3,64,0,11,12,0,0,6,11,0,32,12,10,119,121,12,5,0,1,12,0,2,20,12,6,12,0,11,12,0,119,0,2,0,0,11,6,0,0,4,11,0,32,12,10,97,121,12,5,0,1,12,0,4,20,12,4,12,0,11,12,0,119,0,2,0,0,11,4,0,139,11,0,0,140,3,9,0,0,0,0,0,136,6,0,0,0,5,6,0,136,6,0,0,25,6,6,16,137,6,0,0,130,6,0,0,136,7,0,0,49,6,6,7,232,121,2,0,1,7,16,0,135,6,0,0,7,0,0,0,25,3,5,8,25,4,5,4,85,3,0,0,85,4,1,0,85,5,2,0,82,6,3,0,33,6,6,1,121,6,4,0,137,5,0,0,1,6,0,0,139,6,0,0,82,7,4,0,25,7,7,32,1,8,47,44,134,6,0,0,196,128,2,0,7,8,0,0,121,6,4,0,137,5,0,0,1,6,0,0,139,6,0,0,135,6,30,1,137,5,0,0,1,6,0,0,139,6,0,0,140,2,10,0,0,0,0,0,136,8,0,0,0,7,8,0,136,8,0,0,25,8,8,16,137,8,0,0,130,8,0,0,136,9,0,0,49,8,8,9,132,122,2,0,1,9,16,0,135,8,0,0,9,0,0,0,25,4,7,8,25,5,7,4,0,6,7,0,85,4,0,0,85,5,1,0,1,8,0,0,85,6,8,0,82,2,5,0,26,8,2,1,85,5,8,0,82,3,6,0,120,2,2,0,119,0,10,0,41,8,3,1,82,9,4,0,38,9,9,1,20,8,8,9,85,6,8,0,82,8,4,0,42,8,8,1,85,4,8,0,119,0,242,255,137,7,0,0,139,3,0,0,140,2,10,0,0,0,0,0,136,7,0,0,0,6,7,0,136,7,0,0,25,7,7,16,137,7,0,0,130,7,0,0,136,8,0,0,49,7,7,8,28,123,2,0,1,8,16,0,135,7,0,0,8,0,0,0,25,5,6,8,25,3,6,4,0,4,6,0,85,5,0,0,85,3,1,0,1,7,0,0,85,4,7,0,82,8,5,0,82,9,3,0,134,7,0,0,228,154,2,0,8,9,0,0,85,5,7,0,82,7,5,0,120,7,2,0,119,0,6,0,82,2,5,0,25,7,2,1,85,5,7,0,85,4,2,0,119,0,243,255,137,6,0,0,82,7,4,0,139,7,0,0,140,1,9,0,0,0,0,0,136,6,0,0,0,5,6,0,136,6,0,0,25,6,6,16,137,6,0,0,130,6,0,0,136,7,0,0,49,6,6,7,180,123,2,0,1,7,16,0,135,6,0,0,7,0,0,0,25,4,5,8,25,3,5,4,0,2,5,0,85,3,0,0,82,7,3,0,1,8,46,0,134,6,0,0,148,158,2,0,7,8,0,0,85,2,6,0,82,6,2,0,121,6,11,0,82,6,2,0,82,8,3,0,46,6,6,8,12,124,2,0,82,6,2,0,25,6,6,1,85,4,6,0,82,1,4,0,137,5,0,0,139,1,0,0,1,6,0,0,85,4,6,0,82,1,4,0,137,5,0,0,139,1,0,0,140,2,11,0,0,0,0,0,136,6,0,0,0,4,6,0,136,6,0,0,25,6,6,16,137,6,0,0,130,6,0,0,136,7,0,0,49,6,6,7,88,124,2,0,1,7,16,0,135,6,0,0,7,0,0,0,25,2,4,4,0,3,4,0,85,2,0,0,85,3,1,0,82,7,3,0,106,7,7,4,82,8,2,0,134,6,0,0,172,48,2,0,7,8,0,0,82,5,3,0,25,8,5,8,1,7,1,0,106,9,5,4,82,10,2,0,134,6,0,0,128,127,2,0,8,7,9,10,82,6,3,0,1,10,0,0,83,6,10,0,82,10,3,0,1,6,0,0,107,10,1,6,82,6,3,0,1,10,0,0,109,6,4,10,137,4,0,0,139,0,0,0,140,2,11,0,0,0,0,0,136,7,0,0,0,6,7,0,136,7,0,0,25,7,7,32,137,7,0,0,130,7,0,0,136,8,0,0,49,7,7,8,4,125,2,0,1,8,32,0,135,7,0,0,8,0,0,0,25,5,6,20,25,4,6,16,0,3,6,0,85,5,0,0,1,7,192,84,1,8,92,118,82,8,8,0,41,8,8,10,3,7,7,8,85,4,7,0,85,3,1,0,82,8,4,0,82,9,5,0,134,7,0,0,36,157,2,0,8,9,3,0,1,7,92,118,82,7,7,0,25,2,7,1,1,7,92,118,85,7,2,0,1,7,92,118,1,8,4,0,1,10,92,118,82,10,10,0,17,8,8,10,1,10,0,0,125,9,8,10,2,0,0,0,85,7,9,0,137,6,0,0,82,9,4,0,139,9,0,0,140,1,14,0,0,0,0,0,136,9,0,0,0,8,9,0,136,9,0,0,25,9,9,16,137,9,0,0,130,9,0,0,136,10,0,0,49,9,9,10,192,125,2,0,1,10,16,0,135,9,0,0,10,0,0,0,0,7,8,0,88,1,0,0,145,1,1,0,88,9,0,0,145,9,9,0,65,6,1,9,145,6,6,0,112,2,0,4,145,2,2,0,112,10,0,4,145,10,10,0,65,9,2,10,145,9,9,0,63,5,6,9,145,5,5,0,112,3,0,8,145,3,3,0,112,12,0,8,145,12,12,0,65,11,3,12,145,11,11,0,63,10,5,11,145,10,10,0,135,9,230,0,10,0,0,0,145,9,9,0,89,7,9,0,88,4,7,0,145,4,4,0,137,8,0,0,145,9,4,0,139,9,0,0,140,0,9,0,0,0,0,0,136,6,0,0,0,3,6,0,136,6,0,0,1,7,128,0,3,6,6,7,137,6,0,0,130,6,0,0,136,7,0,0,49,6,6,7,124,126,2,0,1,7,128,0,135,6,0,0,7,0,0,0,25,0,3,64,0,1,3,0,1,6,240,114,134,7,0,0,128,162,2,0,87,6,7,0,1,7,248,114,1,6,240,114,86,6,6,0,1,8,224,114,86,8,8,0,64,6,6,8,87,7,6,0,1,6,224,114,1,7,240,114,86,7,7,0,87,6,7,0,134,7,0,0,92,145,2,0,0,2,0,0,1,4,156,117,25,5,2,64,116,2,4,0,25,2,2,4,25,4,4,4,54,7,2,5,212,126,2,0,134,7,0,0,116,1,2,0,1,0,0,0,134,7,0,0,244,192,1,0,1,0,0,0,137,3,0,0,139,0,0,0,140,4,14,0,0,0,0,0,136,9,0,0,0,8,9,0,136,9,0,0,25,9,9,16,137,9,0,0,130,9,0,0,136,10,0,0,49,9,9,10,64,127,2,0,1,10,16,0,135,9,0,0,10,0,0,0,25,6,8,12,25,7,8,8,25,5,8,4,0,4,8,0,85,6,0,0,85,7,1,0,85,5,2,0,85,4,3,0,82,10,6,0,82,11,7,0,82,12,5,0,82,13,4,0,135,9,33,1,10,11,12,13,137,8,0,0,139,0,0,0,140,4,12,0,0,0,0,0,5,7,2,1,32,10,1,0,1,11,0,0,125,9,10,11,2,0,0,0,1,11,255,255,106,10,3,76,47,11,11,10,232,127,2,0,134,11,0,0,88,162,2,0,3,0,0,0,32,8,11,0,134,4,0,0,160,15,2,0,0,7,3,0,121,8,3,0,0,5,4,0,119,0,9,0,134,11,0,0,76,162,2,0,3,0,0,0,0,5,4,0,119,0,4,0,134,5,0,0,160,15,2,0,0,7,3,0,45,11,5,7,4,128,2,0,0,6,9,0], eb + 153600);
  HEAPU8.set([119,0,2,0,7,6,5,1,139,6,0,0,140,1,7,0,0,0,0,0,136,5,0,0,0,4,5,0,136,5,0,0,25,5,5,16,137,5,0,0,130,5,0,0,136,6,0,0,49,5,5,6,68,128,2,0,1,6,16,0,135,5,0,0,6,0,0,0,25,2,4,4,0,3,4,0,89,3,0,0,88,5,3,0,145,5,5,0,59,6,0,0,145,6,6,0,71,5,5,6,121,5,5,0,59,5,0,0,145,5,5,0,89,2,5,0,119,0,15,0,88,5,3,0,145,5,5,0,59,6,1,0,145,6,6,0,73,5,5,6,121,5,5,0,59,5,1,0,145,5,5,0,89,2,5,0,119,0,5,0,88,5,3,0,145,5,5,0,89,2,5,0,119,0,1,0,88,1,2,0,145,1,1,0,137,4,0,0,145,5,1,0,139,5,0,0,140,2,13,0,0,0,0,0,78,4,0,0,78,5,1,0,41,11,4,24,42,11,11,24,32,11,11,0,121,11,4,0,1,11,1,0,0,10,11,0,119,0,7,0,41,11,4,24,42,11,11,24,41,12,5,24,42,12,12,24,14,11,11,12,0,10,11,0,121,10,4,0,0,2,5,0,0,3,4,0,119,0,23,0,0,8,0,0,0,9,1,0,25,8,8,1,25,9,9,1,78,6,8,0,78,7,9,0,41,11,6,24,42,11,11,24,32,11,11,0,121,11,4,0,1,11,1,0,0,10,11,0,119,0,7,0,41,11,6,24,42,11,11,24,41,12,7,24,42,12,12,24,14,11,11,12,0,10,11,0,121,10,239,255,0,2,7,0,0,3,6,0,1,10,255,0,19,10,3,10,1,11,255,0,19,11,2,11,4,10,10,11,139,10,0,0,140,3,7,0,0,0,0,0,136,5,0,0,0,4,5,0,136,5,0,0,25,5,5,16,137,5,0,0,130,5,0,0,136,6,0,0,49,5,5,6,192,129,2,0,1,6,16,0,135,5,0,0,6,0,0,0,25,3,4,4,109,4,8,0,85,3,1,0,85,4,2,0,82,5,3,0,1,6,16,5,94,5,5,6,121,5,9,0,82,5,3,0,1,6,20,5,94,5,5,6,34,5,5,4,121,5,4,0,137,4,0,0,1,5,0,0,139,5,0,0,137,4,0,0,1,5,0,0,139,5,0,0,140,2,10,0,0,0,0,0,136,7,0,0,0,6,7,0,136,7,0,0,25,7,7,16,137,7,0,0,130,7,0,0,136,8,0,0,49,7,7,8,68,130,2,0,1,8,16,0,135,7,0,0,8,0,0,0,0,5,6,0,25,4,6,12,25,3,6,8,85,4,0,0,85,3,1,0,82,2,3,0,116,5,4,0,109,5,4,2,1,8,4,0,1,9,49,47,134,7,0,0,216,31,2,0,8,9,5,0,137,6,0,0,139,0,0,0,140,4,14,0,0,0,0,0,136,10,0,0,0,9,10,0,136,10,0,0,25,10,10,16,137,10,0,0,130,10,0,0,136,11,0,0,49,10,10,11,184,130,2,0,1,11,16,0,135,10,0,0,11,0,0,0,0,8,9,0,106,12,0,60,1,13,255,0,19,13,3,13,135,11,34,1,12,1,2,13,8,0,0,0,134,10,0,0,24,153,2,0,11,0,0,0,120,10,5,0,0,7,8,0,106,5,7,4,82,6,7,0,119,0,8,0,0,4,8,0,1,10,255,255,85,4,10,0,1,11,255,255,109,4,4,11,1,5,255,255,1,6,255,255,135,11,30,0,5,0,0,0,137,9,0,0,139,6,0,0,140,4,11,0,0,0,0,0,32,9,0,0,32,10,1,0,19,9,9,10,121,9,3,0,0,7,2,0,119,0,22,0,0,4,0,0,0,5,1,0,0,8,2,0,26,6,8,1,1,9,64,28,38,10,4,15,91,9,9,10,20,9,9,3,83,6,9,0,1,9,4,0,135,4,25,1,4,5,9,0,135,5,1,0,32,9,4,0,32,10,5,0,19,9,9,10,121,9,3,0,0,7,6,0,119,0,3,0,0,8,6,0,119,0,239,255,139,7,0,0,140,0,7,0,0,0,0,0,136,4,0,0,0,3,4,0,136,4,0,0,25,4,4,16,137,4,0,0,130,4,0,0,136,5,0,0,49,4,4,5,208,131,2,0,1,5,16,0,135,4,0,0,5,0,0,0,0,2,3,0,1,4,140,117,82,4,4,0,121,4,30,0,1,5,59,0,1,6,140,117,82,6,6,0,134,4,0,0,172,48,2,0,5,6,0,0,1,6,140,117,82,6,6,0,134,4,0,0,128,108,2,0,6,0,0,0,1,6,8,115,82,6,6,0,135,4,8,0,6,0,0,0,1,4,140,117,1,6,0,0,85,4,6,0,1,6,8,115,1,4,0,0,85,6,4,0,1,4,1,0,83,2,4,0,78,0,2,0,38,4,0,1,0,1,4,0,137,3,0,0,139,1,0,0,119,0,8,0,1,4,0,0,83,2,4,0,78,0,2,0,38,4,0,1,0,1,4,0,137,3,0,0,139,1,0,0,1,4,0,0,139,4,0,0,140,3,9,0,0,0,0,0,136,6,0,0,0,5,6,0,136,6,0,0,25,6,6,16,137,6,0,0,130,6,0,0,136,7,0,0,49,6,6,7,176,132,2,0,1,7,16,0,135,6,0,0,7,0,0,0,25,4,5,4,0,3,5,0,109,5,8,0,85,4,1,0,85,3,2,0,82,7,4,0,82,8,3,0,134,6,0,0,140,113,2,0,7,8,0,0,1,6,148,117,82,8,4,0,85,6,8,0,1,8,152,117,82,6,3,0,85,8,6,0,137,5,0,0,139,0,0,0,140,2,10,0,0,0,0,0,136,7,0,0,0,6,7,0,136,7,0,0,25,7,7,16,137,7,0,0,130,7,0,0,136,8,0,0,49,7,7,8,48,133,2,0,1,8,16,0,135,7,0,0,8,0,0,0,25,4,6,4,0,5,6,0,25,3,6,8,85,4,0,0,85,5,1,0,1,7,0,0,83,3,7,0,82,8,4,0,82,9,5,0,134,7,0,0,196,128,2,0,8,9,0,0,32,2,7,0,1,9,1,0,1,8,0,0,125,7,2,9,8,0,0,0,83,3,7,0,137,6,0,0,78,7,3,0,38,7,7,1,139,7,0,0,140,3,12,0,0,0,0,0,2,9,0,0,255,0,0,0,120,2,3,0,1,5,0,0,119,0,22,0,0,6,0,0,0,7,2,0,0,8,1,0,78,3,6,0,78,4,8,0,41,10,3,24,42,10,10,24,41,11,4,24,42,11,11,24,53,10,10,11,236,133,2,0,26,7,7,1,120,7,3,0,1,5,0,0,119,0,7,0,25,6,6,1,25,8,8,1,119,0,242,255,19,10,3,9,19,11,4,9,4,5,10,11,139,5,0,0,140,1,7,0,0,0,0,0,136,4,0,0,0,3,4,0,136,4,0,0,25,4,4,16,137,4,0,0,130,4,0,0,136,5,0,0,49,4,4,5,52,134,2,0,1,5,16,0,135,4,0,0,5,0,0,0,0,1,3,0,25,2,3,4,85,1,0,0,1,4,0,0,83,2,4,0,1,4,175,120,82,5,1,0,90,4,4,5,1,5,178,120,82,6,1,0,90,5,5,6,46,4,4,5,128,134,2,0,1,4,175,120,82,5,1,0,90,4,4,5,120,4,3,0,1,4,1,0,83,2,4,0,137,3,0,0,78,4,2,0,38,4,4,1,139,4,0,0,140,0,7,0,0,0,0,0,136,4,0,0,0,1,4,0,136,4,0,0,25,4,4,16,137,4,0,0,130,4,0,0,136,5,0,0,49,4,4,5,200,134,2,0,1,5,16,0,135,4,0,0,5,0,0,0,1,4,32,0,1,5,144,115,82,5,5,0,49,4,4,5,240,134,2,0,1,5,5,0,1,6,211,30,134,4,0,0,216,31,2,0,5,6,1,0,1,4,144,29,82,4,4,0,1,6,0,23,45,4,4,6,28,135,2,0,1,4,160,120,1,6,1,0,83,4,6,0,1,6,76,115,1,4,148,115,85,6,4,0,1,4,192,73,1,6,144,115,82,6,6,0,41,6,6,6,3,0,4,6,1,6,76,115,82,2,6,0,25,3,0,64,116,0,2,0,25,0,0,4,25,2,2,4,54,6,0,3,60,135,2,0,1,6,144,115,1,4,144,115,82,4,4,0,25,4,4,1,85,6,4,0,137,1,0,0,139,0,0,0,140,1,6,0,0,0,0,0,136,4,0,0,0,3,4,0,136,4,0,0,25,4,4,16,137,4,0,0,130,4,0,0,136,5,0,0,49,4,4,5,164,135,2,0,1,5,16,0,135,4,0,0,5,0,0,0,25,1,3,8,0,2,3,0,1,4,0,0,85,1,4,0,1,5,0,0,109,1,4,5,1,4,0,0,134,5,0,0,0,66,2,0,2,4,0,0,116,1,2,0,106,4,2,4,109,1,4,4,116,0,1,0,106,5,1,4,109,0,4,5,137,3,0,0,139,0,0,0,140,1,9,0,0,0,0,0,136,4,0,0,0,3,4,0,136,4,0,0,25,4,4,16,137,4,0,0,130,4,0,0,136,5,0,0,49,4,4,5,36,136,2,0,1,5,16,0,135,4,0,0,5,0,0,0,0,2,3,0,89,2,0,0,88,4,2,0,145,4,4,0,59,5,1,0,145,5,5,0,72,4,4,5,121,4,16,0,88,5,2,0,145,5,5,0,59,6,2,0,145,6,6,0,66,4,5,6,145,4,4,0,61,6,0,0,0,0,0,63,145,6,6,0,63,1,4,6,145,1,1,0,137,3,0,0,145,6,1,0,139,6,0,0,119,0,7,0,1,4,23,54,1,5,90,48,1,7,12,3,1,8,34,54,135,6,4,0,4,5,7,8,59,6,0,0,145,6,6,0,139,6,0,0,140,3,10,0,0,0,0,0,32,8,0,0,32,9,1,0,19,8,8,9,121,8,3,0,0,6,2,0,119,0,20,0,0,3,0,0,0,4,1,0,0,7,2,0,26,5,7,1,38,8,3,7,39,8,8,48,83,5,8,0,1,8,3,0,135,3,25,1,3,4,8,0,135,4,1,0,32,8,3,0,32,9,4,0,19,8,8,9,121,8,3,0,0,6,5,0,119,0,3,0,0,7,5,0,119,0,241,255,139,6,0,0,140,2,9,0,0,0,0,0,136,6,0,0,0,5,6,0,136,6,0,0,25,6,6,16,137,6,0,0,130,6,0,0,136,7,0,0,49,6,6,7,76,137,2,0,1,7,16,0,135,6,0,0,7,0,0,0,25,3,5,4,0,4,5,0,85,3,0,0,89,4,1,0,82,7,3,0,88,8,4,0,145,8,8,0,134,6,0,0,44,28,2,0,7,8,0,0,28,2,6,2,137,5,0,0,139,2,0,0,140,2,7,0,0,0,0,0,120,0,3,0,1,4,0,0,119,0,14,0,5,3,1,0,2,5,0,0,255,255,0,0,20,6,1,0,48,5,5,6,196,137,2,0,7,5,3,0,13,5,5,1,1,6,255,255,125,4,5,3,6,0,0,0,119,0,2,0,0,4,3,0,135,2,6,0,4,0,0,0,120,2,2,0,139,2,0,0,26,6,2,4,82,6,6,0,38,6,6,3,120,6,2,0,139,2,0,0,1,5,0,0,135,6,3,0,2,5,4,0,139,2,0,0,140,1,10,0,0,0,0,0,136,6,0,0,0,4,6,0,136,6,0,0,25,6,6,16,137,6,0,0,130,6,0,0,136,7,0,0,49,6,6,7,52,138,2,0,1,7,16,0,135,6,0,0,7,0,0,0,0,2,4,0,85,2,0,0,82,6,2,0,1,7,152,0,94,1,6,7,82,5,2,0,106,7,5,80,112,8,5,56,145,8,8,0,134,6,0,0,152,51,2,0,7,8,0,0,5,3,1,6,137,4,0,0,139,3,0,0,140,1,10,0,0,0,0,0,136,6,0,0,0,4,6,0,136,6,0,0,25,6,6,16,137,6,0,0,130,6,0,0,136,7,0,0,49,6,6,7,168,138,2,0,1,7,16,0,135,6,0,0,7,0,0,0,0,2,4,0,85,2,0,0,82,6,2,0,1,7,156,0,94,1,6,7,82,5,2,0,106,7,5,84,112,8,5,60,145,8,8,0,134,6,0,0,152,51,2,0,7,8,0,0,5,3,1,6,137,4,0,0,139,3,0,0,140,4,11,0,0,0,0,0,0,4,0,0,0,5,2,0,134,6,0,0,36,147,2,0,4,5,0,0,135,7,1,0,5,9,1,5,5,10,3,4,3,9,9,10,3,9,9,7,38,10,7,0,20,9,9,10,135,8,30,0,9,0,0,0,139,6,0,0,140,1,8,0,0,0,0,0,25,4,0,74,78,3,4,0,1,6,255,0,3,6,3,6,20,6,6,3,83,4,6,0,82,1,0,0,38,6,1,8,120,6,13,0,1,7,0,0,109,0,8,7,1,6,0,0,109,0,4,6,106,2,0,44,109,0,28,2,109,0,20,2,106,7,0,48,3,7,2,7,109,0,16,7,1,5,0,0,119,0,4,0,39,7,1,32,85,0,7,0,1,5,255,255,139,5,0,0,140,1,9,0,0,0,0,0,136,5,0,0,0,3,5,0,136,5,0,0,25,5,5,16,137,5,0,0,130,5,0,0,136,6,0,0,49,5,5,6,204,139,2,0,1,6,16,0,135,5,0,0,6,0,0,0,0,2,3,0,85,2,0,0,82,4,2,0,106,5,4,120,1,7,144,0,94,7,4,7,106,8,4,64,5,6,7,8,41,6,6,2,3,1,5,6,137,3,0,0,139,1,0,0,140,2,9,0,0,0,0,0,136,6,0,0,0,5,6,0,136,6,0,0,25,6,6,16,137,6,0,0,130,6,0,0,136,7,0,0,49,6,6,7,52,140,2,0,1,7,16,0,135,6,0,0,7,0,0,0,25,3,5,8,25,4,5,4,0,2,5,0,85,3,0,0,85,4,1,0,82,7,3,0,82,8,4,0,134,6,0,0,116,100,2,0,7,8,0,0,85,2,6,0,137,5,0,0,82,6,2,0,139,6,0,0,140,1,8,0,0,0,0,0,136,4,0,0,0,3,4,0,136,4,0,0,25,4,4,16,137,4,0,0,130,4,0,0,136,5,0,0,49,4,4,5,164,140,2,0,1,5,16,0,135,4,0,0,5,0,0,0,0,2,3,0,25,1,3,4,85,2,0,0,1,4,0,0,83,1,4,0,1,5,0,32,1,6,192,81,1,7,220,115,82,7,7,0,27,7,7,48,94,6,6,7,82,7,2,0,3,6,6,7,17,5,5,6,1,6,1,0,1,7,0,0,125,4,5,6,7,0,0,0,83,1,4,0,137,3,0,0,78,4,1,0,38,4,4,1,139,4,0,0,140,0,5,0,0,0,0,0,136,3,0,0,0,2,3,0,136,3,0,0,25,3,3,16,137,3,0,0,130,3,0,0,136,4,0,0,49,3,3,4,56,141,2,0,1,4,16,0,135,3,0,0,4,0,0,0,0,1,2,0,1,3,0,118,82,3,3,0,36,3,3,0,121,3,3,0,137,2,0,0,139,0,0,0,1,3,0,0,85,1,3,0,1,3,252,117,82,0,3,0,1,3,0,118,82,3,3,0,82,4,1,0,56,3,3,4,156,141,2,0,82,4,1,0,41,4,4,2,94,4,0,4,135,3,8,0,4,0,0,0,82,3,1,0,25,3,3,1,85,1,3,0,119,0,241,255,135,3,8,0,0,0,0,0,1,3,0,118,1,4,0,0,85,3,4,0,137,2,0,0,139,0,0,0,140,0,5,0,0,0,0,0,2,1,0,0,79,29,0,0,1,2,60,117,82,2,2,0,32,2,2,1,1,3,60,117,82,3,3,0,32,3,3,2,20,2,2,3,1,3,64,117,82,3,3,0,34,3,3,2,19,2,2,3,121,2,6,0,1,2,60,117,1,3,4,0,85,2,3,0,134,3,0,0,124,151,2,0,134,0,0,0,124,151,2,0,1,3,208,114,86,3,3,0,64,3,0,3,59,2,44,1,73,3,3,2,1,2,60,117,82,2,2,0,32,2,2,8,19,3,3,2,1,2,64,117,82,2,2,0,34,2,2,2,19,3,3,2,121,3,9,0,1,3,60,117,1,2,4,0,85,3,2,0,134,2,0,0,124,151,2,0,1,2,173,120,1,3,1,0,83,2,3,0,1,3,60,117,82,3,3,0,32,3,3,16,1,2,60,117,82,2,2,0,32,2,2,64,20,3,3,2,1,2,60,117,82,2,2,0,32,2,2,32,20,3,3,2,1,2,60,117,82,2,2,0,1,4,128,0,13,2,2,4,20,3,3,2,120,3,2,0,139,0,0,0,1,3,60,117,1,2,0,0,85,3,2,0,139,0,0,0,140,1,8,0,0,0,0,0,82,7,0,0,78,7,7,0,134,6,0,0,0,161,2,0,7,0,0,0,120,6,3,0,1,3,0,0,119,0,18,0,1,4,0,0,82,1,0,0,27,6,4,10,26,6,6,48,78,7,1,0,3,2,6,7,25,5,1,1,85,0,5,0,78,6,5,0,134,7,0,0,0,161,2,0,6,0,0,0,120,7,3,0,0,3,2,0,119,0,3,0,0,4,2,0,119,0,241,255,139,3,0,0,140,2,10,0,0,0,0,0,136,7,0,0,0,6,7,0,136,7,0,0,25,7,7,16,137,7,0,0,130,7,0,0,136,8,0,0,49,7,7,8,108,143,2,0,1,8,16,0,135,7,0,0,8,0,0,0,25,4,6,4,0,5,6,0,89,4,0,0,89,5,1,0,88,2,4,0,145,2,2,0,88,3,5,0,145,3,3,0,1,9,148,29,88,8,9,0,145,8,8,0,134,7,0,0,236,184,1,0,2,3,8,0,137,6,0,0,139,0,0,0,140,2,7,0,0,0,0,0,136,5,0,0,0,4,5,0,136,5,0,0,25,5,5,16,137,5,0,0,130,5,0,0,136,6,0,0,49,5,5,6,228,143,2,0,1,6,16,0,135,5,0,0,6,0,0,0,25,2,4,4,0,3,4,0,85,2,0,0,85,3,1,0,137,4,0,0,82,5,2,0,82,6,3,0,41,6,6,3,3,5,5,6,139,5,0,0,140,1,6,0,0,0,0,0,136,4,0,0,0,3,4,0,136,4,0,0,25,4,4,16,137,4,0,0,130,4,0,0,136,5,0,0,49,4,4,5,68,144,2,0,1,5,16,0,135,4,0,0,5,0,0,0,25,2,3,4,0,1,3,0,85,1,0,0,1,4,255,3,1,5,60,117,82,5,5,0,19,4,4,5,82,5,1,0,45,4,4,5,120,144,2,0,1,4,1,0,83,2,4,0,119,0,3,0,1,4,0,0,83,2,4,0,137,3,0,0,78,4,2,0,38,4,4,1,139,4,0,0,140,2,9,0,0,0,0,0,136,7,0,0,0,4,7,0,136,7,0,0,25,7,7,16,137,7,0,0,130,7,0,0,136,8,0,0,49,7,7,8,200,144,2,0,1,8,16,0,135,7,0,0,8,0,0,0,25,2,4,4,0,3,4,0,85,2,0,0,85,3,1,0,137,4,0,0,82,5,2,0,82,6,3,0,47,8,5,6,244,144,2,0,0,7,5,0,119,0,2,0,0,7,6,0,139,7,0,0,140,3,7,0,0,0,0,0,136,5,0,0,0,4,5,0,136,5,0,0,25,5,5,32,137,5,0,0,130,5,0,0,136,6,0,0,49,5,5,6,52,145,2,0,1,6,32,0,135,5,0,0,6,0,0,0,0,3,4,0,109,4,16,0,111,4,8,1,87,3,2,0,1,5,4,118,86,6,3,0,75,6,6,0,85,5,6,0,137,4,0,0,139,0,0,0,140,0,8,0,0,0,0,0,136,6,0,0,0,3,6,0,136,6,0,0,25,6,6,64,137,6,0,0,130,6,0,0,136,7,0,0,49,6,6,7,148,145,2,0,1,7,64,0,135,6,0,0,7,0,0,0,0,1,3,0,1,6,76,115,82,0,6,0,134,6,0,0,244,119,2,0,1,0,0,0,0,2,0,0,0,4,1,0,25,5,2,64,116,2,4,0,25,2,2,4,25,4,4,4,54,6,2,5,184,145,2,0,137,3,0,0,139,0,0,0,140,1,6,0,0,0,0,0,136,4,0,0,0,3,4,0,136,4,0,0,25,4,4,16,137,4,0,0,130,4,0,0,136,5,0,0,49,4,4,5,12,146,2,0,1,5,16,0,135,4,0,0,5,0,0,0,0,2,3,0,85,2,0,0,82,5,2,0,112,4,5,60,145,4,4,0,134,1,0,0,24,149,2,0,4,0,0,0,137,3,0,0,139,1,0,0,140,1,6,0,0,0,0,0,136,4,0,0,0,3,4,0,136,4,0,0,25,4,4,16,137,4,0,0,130,4,0,0,136,5,0,0,49,4,4,5,108,146,2,0,1,5,16,0,135,4,0,0,5,0,0,0,0,2,3,0,85,2,0,0,82,5,2,0,112,4,5,56,145,4,4,0,134,1,0,0,24,149,2,0,4,0,0,0,137,3,0,0,139,1,0,0,140,1,5,0,0,0,0,0,136,3,0,0,0,2,3,0,136,3,0,0,25,3,3,16,137,3,0,0,130,3,0,0,136,4,0,0,49,3,3,4,204,146,2,0,1,4,16,0,135,3,0,0,4,0,0,0,0,1,2,0,85,1,0,0,82,3,1,0,1,4,1,23,45,3,3,4,244,146,2,0,1,3,76,115,1,4,12,115,85,3,4,0,119,0,8,0,82,4,1,0,1,3,0,23,45,4,4,3,16,147,2,0,1,4,76,115,1,3,80,115,85,4,3,0,1,3,144,29,82,4,1,0,85,3,4,0,137,2,0,0,139,0,0,0,140,2,12,0,0,0,0,0,2,9,0,0,255,255,0,0,19,9,0,9,0,2,9,0,2,9,0,0,255,255,0,0,19,9,1,9,0,3,9,0,5,4,3,2,43,9,0,16,0,5,9,0,43,9,4,16,5,10,3,5,3,6,9,10,43,10,1,16,0,7,10,0,5,8,7,2,43,9,6,16,5,11,7,5,3,9,9,11,2,11,0,0,255,255,0,0,19,11,6,11,3,11,11,8,43,11,11,16,3,9,9,11,135,10,30,0,9,0,0,0,3,10,6,8,41,10,10,16,2,9,0,0,255,255,0,0,19,9,4,9,20,10,10,9,139,10,0,0,140,3,8,0,0,0,0,0,120,2,3,0,1,5,0,0,119,0,15,0,1,6,255,0,19,6,1,6,0,3,6,0,0,4,2,0,26,4,4,1,90,6,0,4,41,7,3,24,42,7,7,24,52,6,6,7,0,148,2,0,120,4,250,255,1,5,0,0,119,0,2,0,3,5,0,4,139,5,0,0,140,3,8,0,0,0,0,0,25,6,0,20,82,3,6,0,106,7,0,16,4,5,7,3,16,7,2,5,125,4,7,2,5,0,0,0,135,7,29,0,3,1,4,0,82,7,6,0,3,7,7,4,85,6,7,0,139,2,0,0,140,1,7,0,0,0,0,0,106,5,0,68,121,5,19,0,1,5,132,0,94,3,0,5,1,5,128,0,3,1,0,5,121,3,4,0,1,5,128,0,82,6,1,0,97,3,5,6,82,4,1,0,120,4,6,0,134,6,0,0,136,161,2,0,1,5,232,0,3,2,6,5,119,0,3,0,1,5,132,0,3,2,4,5,85,2,3,0,139,0,0,0,140,2,5,0,0,0,0,0,136,3,0,0,0,2,3,0,136,3,0,0,25,3,3,16,137,3,0,0,130,3,0,0,136,4,0,0,49,3,3,4,216,148,2,0,1,4,16,0,135,3,0,0,4,0,0,0,109,2,4,0,85,2,1,0,1,3,16,0,1,4,8,118,82,4,4,0,49,3,3,4,252,148,2,0,137,2,0,0,139,0,0,0,1,3,8,118,1,4,8,118,82,4,4,0,25,4,4,1,85,3,4,0,137,2,0,0,139,0,0,0,140,1,6,0,0,0,0,0,136,4,0,0,0,3,4,0,136,4,0,0,25,4,4,16,137,4,0,0,130,4,0,0,136,5,0,0,49,4,4,5,80,149,2,0,1,5,16,0,135,4,0,0,5,0,0,0,0,2,3,0,89,2,0,0,88,4,2,0,145,4,4,0,59,5,1,0,145,5,5,0,73,4,4,5,38,4,4,1,0,1,4,0,137,3,0,0,139,1,0,0,140,1,7,0,0,0,0,0,136,5,0,0,0,4,5,0,136,5,0,0,25,5,5,16,137,5,0,0,130,5,0,0,136,6,0,0,49,5,5,6,180,149,2,0,1,6,16,0,135,5,0,0,6,0,0,0,0,3,4,0,0,1,3,0,1,5,0,0,85,1,5,0,1,6,0,0,109,1,4,6,0,2,3,0,26,6,0,1,85,2,6,0,1,5,0,0,109,2,4,5,137,4,0,0,139,0,0,0,140,3,6,0,0,0,0,0,136,4,0,0,0,3,4,0,136,4,0,0,25,4,4,16,137,4,0,0,130,4,0,0,136,5,0,0,49,4,4,5,32,150,2,0,1,5,16,0,135,4,0,0,5,0,0,0,113,3,8,0,113,3,4,1,89,3,2,0,137,3,0,0,139,0,0,0,140,2,5,0,0,0,0,0,136,3,0,0,0,2,3,0,136,3,0,0,25,3,3,16,137,3,0,0,130,3,0,0,136,4,0,0,49,3,3,4,108,150,2,0,1,4,16,0,135,3,0,0,4,0,0,0,109,2,4,0,85,2,1,0,137,2,0,0,139,0,0,0,140,2,5,0,0,0,0,0,136,3,0,0,0,2,3,0,136,3,0,0,25,3,3,16,137,3,0,0,130,3,0,0,136,4,0,0,49,3,3,4,180,150,2,0,1,4,16,0,135,3,0,0,4,0,0,0,109,2,4,0,85,2,1,0,137,2,0,0,139,0,0,0,140,1,5,0,0,0,0,0,0,1,0,0,1,2,56,118,25,3,1,36,116,1,2,0,25,1,1,4,25,2,2,4,54,4,1,3,216,150,2,0,139,0,0,0,140,1,5,0,0,0,0,0,1,1,12,115,0,2,0,0,25,3,1,64,116,1,2,0,25,1,1,4,25,2,2,4,54,4,1,3,4,151,2,0,139,0,0,0,140,1,5,0,0,0,0,0,1,1,80,115,0,2,0,0,25,3,1,64,116,1,2,0,25,1,1,4,25,2,2,4,54,4,1,3,48,151,2,0,139,0,0,0,140,1,5,0,0,0,0,0,134,2,0,0,240,161,2,0,82,4,2,0,109,0,56,4,82,1,2,0,121,1,2,0,109,1,52,0,85,2,0,0,134,4,0,0,32,162,2,0,139,0,0,0,140,0,4,0,0,0,0,0,136,2,0,0,0,1,2,0,136,2,0,0,25,2,2,16,137,2,0,0,130,2,0,0,136,3,0,0,49,2,2,3,180,151,2,0,1,3,16,0,135,2,0,0,3,0,0,0,0,0,1,0,59,2,0,0,87,0,2,0,137,1,0,0,86,2,0,0,139,2,0,0,140,4,7,0,0,0,0,0,4,5,1,3,0,4,5,0,16,6,0,2,4,4,5,6,135,6,30,0,4,0,0,0,4,6,0,2,139,6,0,0,140,1,4,0,0,0,0,0,136,2,0,0,0,1,2,0,136,2,0,0,25,2,2,16,137,2,0,0,130,2,0,0,136,3,0,0,49,2,2,3,44,152,2,0,1,3,16,0,135,2,0,0,3,0,0,0,89,1,0,0,137,1,0,0,59,2,0,0,145,2,2,0,139,2,0,0,140,1,4,0,0,0,0,0,136,2,0,0,0,1,2,0,136,2,0,0,25,2,2,16,137,2,0,0,130,2,0,0,136,3,0,0,49,2,2,3,120,152,2,0,1,3,16,0,135,2,0,0,3,0,0,0,89,1,0,0,137,1,0,0,59,2,2,0,145,2,2,0,139,2,0,0,140,1,4,0,0,0,0,0,136,2,0,0,0,1,2,0,136,2,0,0,25,2,2,16,137,2,0,0,130,2,0,0,136,3,0,0,49,2,2,3,196,152,2,0,1,3,16,0,135,2,0,0,3,0,0,0,89,1,0,0,137,1,0,0,59,2,1,0,145,2,2,0,139,2,0,0,140,2,6,0,0,0,0,0,82,4,1,0,1,5,8,0,26,5,5,1,3,4,4,5,1,5,8,0,26,5,5,1,11,5,5,0,19,4,4,5,0,2,4,0,86,3,2,0,25,4,2,8,85,1,4,0,87,0,3,0,139,0,0,0,140,1,4,0,0,0,0,0,41,2,0,16,42,2,2,16,120,2,3,0,1,1,0,0,119,0,8,0,134,2,0,0,144,162,2,0,2,3,0,0,255,255,0,0,19,3,0,3,85,2,3,0,1,1,255,255,139,1,0,0,140,1,6,0,0,0,0,0,78,2,0,0,102,3,0,1,102,4,0,2,102,5,0,3,134,1,0,0,148,47,2,0,2,3,4,5,134,1,0,0,112,161,2,0,139,0,0,0,140,5,6,0,0,0,0,0,135,5,190,0,0,1,2,3,4,0,0,0,139,0,0,0,140,1,4,0,0,0,0,0,1,2,0,240,48,2,2,0,204,153,2,0,134,2,0,0,144,162,2,0,1,3,0,0,4,3,3,0,85,2,3,0,1,1,255,255,119,0,2,0,0,1,0,0,139,1,0,0,140,1,4,0,0,0,0,0,127,2,0,0,87,2,0,0,127,2,0,0,82,1,2,0,127,3,0,0,106,3,3,4,135,2,30,0,3,0,0,0,139,1,0,0,140,5,6,0,0,0,0,0,135,5,175,0,0,1,2,3,4,0,0,0,139,0,0,0,140,9,11,0,0,0,0,0,1,10,27,0,135,9,35,1,10,0,0,0,139,0,0,0,140,4,8,0,0,0,0,0,3,4,0,2,3,6,1,3,16,7,4,0,3,6,6,7,135,5,30,0,6,0,0,0,139,4,0,0,140,4,5,0,0,0,0,0,135,4,188,0,0,1,2,3,139,0,0,0,140,8,10,0,0,0,0,0,1,9,26,0,135,8,36,1,9,0,0,0,139,0,0,0,140,4,5,0,0,0,0,0,135,4,166,0,0,1,2,3,139,0,0,0,140,4,5,0,0,0,0,0,135,4,157,0,0,1,2,3,139,0,0,0,140,2,6,0,0,0,0,0,134,2,0,0,200,255,1,0,0,1,0,0,78,4,2,0,1,5,255,0,19,5,1,5,41,5,5,24,42,5,5,24,13,4,4,5,1,5,0,0,125,3,4,2,5,0,0,0,139,3,0,0,140,2,6,0,0,0,0,0,134,3,0,0,92,8,2,0,0,1,0,0,3,2,0,3,78,4,2,0,32,4,4,0,1,5,0,0,125,3,4,5,2,0,0,0,139,3,0,0,140,4,5,0,0,0,0,0,135,4,127,0,0,1,2,3,139,0,0,0,140,4,6,0,0,0,0,0,1,5,0,0,134,4,0,0,80,1,1,0,0,1,2,3,5,0,0,0,139,4,0,0,140,2,5,0,0,0,0,0,135,2,16,0,0,0,0,0,1,4,1,0,134,3,0,0,128,127,2,0,0,4,2,1,14,3,3,2,41,3,3,31,42,3,3,31,139,3,0,0,140,2,4,0,0,0,0,0,120,0,3,0,1,2,0,0,119,0,5,0,1,3,0,0,134,2,0,0,204,44,2,0,0,1,3,0,139,2,0,0,140,7,9,0,0,0,0,0,1,8,25,0,135,7,37,1,8,0,0,0,139,0,0,0,140,5,7,0,0,0,0,0,1,6,18,0,135,5,38,1,6,0,0,0,139,0,0,0,140,0,2,0,0,0,0,0,1,0,192,81,1,1,220,115,82,1,1,0,27,1,1,48,94,0,0,1,36,0,0,0,121,0,2,0,139,0,0,0,134,0,0,0,180,56,2,0,134,0,0,0,228,57,1,0,139,0,0,0,140,3,4,0,0,0,0,0,135,3,186,0,0,1,2,0,139,0,0,0,140,2,2,0,0,0,0,0,137,0,0,0,132,0,0,1,139,0,0,0,140,6,8,0,0,0,0,0,1,7,4,0,135,6,39,1,7,0,0,0,1,6,0,0,139,6,0,0,140,4,6,0,0,0,0,0,1,5,0,0,135,4,30,0,5,0,0,0,1,4,0,0,139,4,0,0,140,3,4,0,0,0,0,0,135,3,114,0,0,1,2,0,139,0,0,0,140,3,4,0,0,0,0,0,135,3,123,0,0,1,2,0,139,0,0,0,140,6,8,0,0,0,0,0,1,7,24,0,135,6,40,1,7,0,0,0,139,0,0,0,140,4,6,0,0,0,0,0,1,5,11,0,135,4,41,1,5,0,0,0,139,0,0,0,140,3,6,0,0,0,0,0,1,4,1,0,1,5,5,0,134,3,0,0,108,225,1,0,0,1,2,4,5,0,0,0,139,3,0,0,140,3,4,0,0,0,0,0,82,3,0,0,38,3,3,32,120,3,4,0,134,3,0,0,160,15,2,0,1,2,0,0,139,0,0,0,140,4,6,0,0,0,0,0,1,5,17,0,135,4,42,1,5,0,0,0,139,0,0,0,140,3,5,0,0,0,0,0,2,4,0,0,255,255,255,127,134,3,0,0,180,30,2,0,0,4,1,2,139,3,0,0,140,2,3,0,0,0,0,0,135,2,99,0,0,1,0,0,139,0,0,0,140,0,2,0,0,0,0,0,1,0,192,81,1,1,220,115,82,1,1,0,27,1,1,48,94,0,0,1,1,1,0,32,47,0,0,1,132,157,2,0,139,0,0,0,134,0,0,0,208,155,2,0,139,0,0,0,140,1,4,0,0,0,0,0,134,2,0,0,236,160,2,0,0,0,0,0,32,1,2,0,121,1,3,0,0,2,0,0,119,0,3,0,39,3,0,32,0,2,3,0,139,2,0,0,140,2,3,0,0,0,0,0,135,2,184,0,0,1,0,0,139,0,0,0,140,2,3,0,0,0,0,0,135,2,103,0,0,1,0,0,139,0,0,0,140,2,3,0,0,0,0,0,135,2,44,0,0,1,0,0,139,0,0,0,140,1,4,0,0,0,0,0,106,3,0,60,134,2,0,0,204,161,2,0,3,0,0,0,135,1,27,1,2,0,0,0,2,2,0,0,255,255,0,0,19,1,1,2,139,1,0,0,140,5,7,0,0,0,0,0,1,6,23,0,135,5,43,1,6,0,0,0,139,0,0,0,140,2,3,0,0,0,0,0,135,2,119,0,0,1,0,0,139,0,0,0,140,4,6,0,0,0,0,0,1,5,7,0,135,4,44,1,5,0,0,0,1,4,0,0,139,4,0,0,140,2,4,0,0,0,0,0,1,3,172,29,82,3,3,0,134,2,0,0,196,156,2,0,3,0,1,0,139,2,0,0,140,2,4,0,0,0,0,0,135,3,16,0,0,0,0,0,25,3,3,1,134,2,0,0,184,147,2,0,0,1,3,0,139,2,0,0,140,2,4,0,0,0,0,0,1,3,1,0,135,2,45,1,3,0,0,0,59,2,0,0,145,2,2,0,139,2,0,0,140,4,6,0,0,0,0,0,1,5,22,0,135,4,46,1,5,0,0,0,139,0,0,0,140,3,5,0,0,0,0,0,1,4,16,0,135,3,47,1,4,0,0,0,139,0,0,0,140,1,2,0,0,0,0,0,135,1,167,0,0,0,0,0,139,0,0,0,140,1,4,0,0,0,0,0,59,2,0,0,74,2,0,2,121,2,8,0,61,3,0,0,0,0,0,63,63,3,0,3,135,2,238,0,3,0,0,0,58,1,2,0,119,0,7,0,61,3,0,0,0,0,0,63,64,3,0,3,135,2,11,0,3,0,0,0,58,1,2,0,139,1,0,0,140,3,5,0,0,0,0,0,1,4,6,0,135,3,48,1,4,0,0,0,1,3,0,0,139,3,0,0,140,3,5,0,0,0,0,0,1,4,20,0,135,3,49,1,4,0,0,0,139,0,0,0,140,1,2,0,0,0,0,0,135,1,96,0,0,0,0,0,139,0,0,0,140,0,4,0,0,0,0,0,1,1,32,3,1,2,194,1,1,3,168,30,134,0,0,0,248,20,2,0,1,2,3,0,1,3,1,0,1,2,0,0,1,1,1,0,135,0,50,1,3,2,1,0,1,0,0,0,139,0,0,0,140,1,3,0,0,0,0,0,82,2,0,0,135,1,8,0,2,0,0,0,139,0,0,0,140,3,5,0,0,0,0,0,1,4,21,0,135,3,51,1,4,0,0,0,139,0,0,0,140,2,4,0,0,0,0,0,1,3,10,0,135,2,52,1,3,0,0,0,139,0,0,0,140,0,3,0,0,0,0,0,1,2,0,0,135,1,53,1,2,0,0,0,134,0,0,0,124,149,2,0,1,0,0,0,1,0,224,114,134,1,0,0,128,162,2,0,87,0,1,0,139,0,0,0,140,3,5,0,0,0,0,0,1,4,14,0,135,3,54,1,4,0,0,0,139,0,0,0,140,1,3,0,0,0,0,0,1,2,0,0,135,1,55,1,2,0,0,0,59,1,0,0,145,1,1,0,139,1,0,0,140,2,4,0,0,0,0,0,1,3,5,0,135,2,56,1,3,0,0,0,1,2,0,0,139,2,0,0,140,2,4,0,0,0,0,0,1,3,15,0,135,2,57,1,3,0,0,0,139,0,0,0,140,2,4,0,0,0,0,0,1,3,12,0,135,2,58,1,3,0,0,0,139,0,0,0,140,1,2,0,0,0,0,0,26,1,0,65,35,1,1,26,139,1,0,0,140,1,2,0,0,0,0,0,26,1,0,48,35,1,1,10,139,1,0,0,140,0,2,0,0,0,0,0,1,1,136,117,82,1,1,0,135,0,59,1,1,0,0,0,139,0,0,0,140,2,4,0,0,0,0,0,1,3,19,0,135,2,60,1,3,0,0,0,139,0,0,0,140,1,2,0,0,0,0,0,1,1,0,0,139,1,0,0,140,0,2,0,0,0,0,0,1,1,232,114,86,0,1,0,145,0,0,0,139,0,0,0,140,0,2,0,0,0,0,0,1,1,0,65,135,0,28,0,1,0,0,0,139,0,0,0,140,0,1,0,0,0,0,0,134,0,0,0,188,162,2,0,139,0,0,0,140,0,1,0,0,0,0,0,134,0,0,0,188,162,2,0,139,0,0,0,140,1,3,0,0,0,0,0,1,2,3,0,135,1,61,1,2,0,0,0,1,1,0,0,139,1,0,0,140,1,1,0,0,0,0,0,139,0,0,0,140,1,3,0,0,0,0,0,1,2,9,0,135,1,62,1,2,0,0,0,139,0,0,0,140,0,2,0,0,0,0,0,1,1,164,118,135,0,63,1,1,0,0,0,1,0,172,118,139,0,0,0,140,0,1,0,0,0,0,0,1,0,152,117,82,0,0,0,139,0,0,0,140,0,2,0,0,0,0,0,1,1,164,118,135,0,64,1,1,0,0,0,139,0,0,0,140,0,1,0,0,0,0,0,1,0,148,117,82,0,0,0,139,0,0,0,140,1,1,0,0,0,0,0,139,0,0,0,140,1,2,0,0,0,0,0,1,1,1,0,139,1,0,0,140,1,3,0,0,0,0,0,1,2,13,0,135,1,65,1,2,0,0,0,139,0,0,0,140,0,1,0,0,0,0,0,135,0,66,1,139,0,0,0,140,0,1,0,0,0,0,0,1,0,160,118,139,0,0,0,140,0,2,0,0,0,0,0,1,1,2,0,135,0,67,1,1,0,0,0,1,0,0,0,139,0,0,0,140,0,1,0,0,0,0,0,1,0,180,29,139,0,0,0,140,0,1,0,0,0,0,0,1,0,4,0,139,0,0,0,140,0,2,0,0,0,0,0,1,1,8,0,135,0,68,1,1,0,0,0,139,0,0,0,0,0,0,0], eb + 163840);

  var relocations = [];
  relocations = relocations.concat([72,764,1016,1420,1460,1588,1620,1652,1696,1792,1852,1996,2056,2096,2152,2248,2476,2656,2684,2736,2832,2924,2960,3664,3676,3708,3740,3792,3888,3920,4140,4168,4248,4296,4540,5228,5232,5236,5240,5260,5376,5416,5636,5752,5952,6068,6356,6472,6840,6956,7460,7548,7568,7664,7668,7672,7676,7680,7684,7688,7692,7696,7700,7704,7708,7712,7716,7720,7724,7728,7732,7736,7740,7744,7748,7752,7756,7760,7764,7768,7772,7776,7780,7784,7788,7792,7796,7800,7804,7808,7812,8888,8956,9248,9252,9256,9260,9264,9268,9272,9276,9280,9284,9288,9292,9296,9300,9304,9308,9312,9316,9320,9324,9328,9332,9336,9340,9344,9348,9352,9356,9360,9364,9368,9372,9376,9380,9384,9388,9392,9396,9400,9404,9408,9412,9416,9420,9424,9428,9432,9436,9440,9444,9448,9452,9456,9460,9464,9468,9868,9872,9876,9880,9884,9888,9892,9896,10616,10752,10784,10892,11340,11424,11856,11876,11892,11916,12016,12020,12024,12028,12032,12036,12040,12044,12088,12164,12280,12356,12544,12620,12744,12820,13052,13128,13248,13324,13548,13624,13724,13800,14020,14176,14192,14332,14356,14448,14472,14672,14932,15052,15256,15320,15444,15492,15560,15660,15816,16048,16088,16164,16300,16332,16424,16524,16840,17064,17280,17312,17652,17776,17800,17984,18116,18244,18376,18580,18828,19036,19040,19044,19048,19052,19056,19060,19064,19068,19072,19148,19444,19844,20184,20528,20968,21384,21768,22052,22308,22672,23172,23176,23180,23184,23208,23332,23444,23660,23772,24040,24160,24516,24636,25072,25192,25760,25992,26100,26136,26172,26212,26252,26280,26284,26288,26292,26312,26424,26564,26756,27036,27396,27848,27852,27856,27860,27864,27868,27872,27876,27880,27884,27888,27892,27896,27900,27904,27908,27912,27916,27920,27924,27928,27932,27936,27940,27944,27948,27952,27956,27960,27964,27968,27972,27976,27980,27984,27988,27992,27996,28000,28004,28292,28608,28744,28760,28876,28892,29000,29004,29008,29012,29016,29020,29024,29028,29080,29120,29292,29332,29588,29628,29808,29848,30180,30220,30388,30428,30736,30776,30896,30936,31256,31276,31356,31384,31392,31408,31420,31472,31488,31508,31556,31684,31720,31740,31760,31820,31888,31912,31964,31992,32048,32100,32136,32188,32236,32304,32332,32340,32356,32368,32412,32428,32448,32488,32616,32652,32672,32692,32740,32800,32824,32868,32896,32940,32988,33052,33140,33212,33468,33568,33608,33744,34048,34120,34208,34228,34248,34268,34288,34308,34432,34448,34852,34880,34944,35008,35160,35212,35240,35304,35368,35572,36288,36520,36608,36632,36812,36832,36852,37328,37388,37472,37560,37628,37688,37772,37860,37928,37988,38072,38160,38228,38284,38360,38440,38552,38720,39028,39064,39100,39136,39172,39212,39340,39368,39456,39488,40176,40292,45124,45168,47184,47236,47660,47788,47792,47796,47800,47824,47864,48008,48132,48344,48636,49092,49172,49244,49264,49268,49272,49276,49280,49284,49288,49292,49296,49300,51596,51724,52148,54232,54560,54720,54736,54836,54924,54988,55028,56204,56324,56432,56580,56600,56604,56608,56612,56616,56620,56624,56628,56632,56636,58808,59352,59500,61052,61096,61260,61320,61380,61424,61696,61768,63544,64148,64476,64612,65080,65356,67256,67556,67572,67576,67580,67584,67588,67592,67860,67864,67868,67872,67876,67880,67920,68012,68104,68216,68368,68464,68624,68816,68860,68888,68920,69076,69224,69252,69284,69428,69564,69728,69864,69888,70044,70192,70492,70500,70556,70608,70688,70696,70752,70804,71064,71104,71276,71356,71376,74844,74864,74888,74912,75008,75036,75108,75128,75152,75316,75348,75380,75388,75404,75416,75460,75476,75496,75536,75664,75700,75720,75740,75792,75852,75876,75920,75948,75992,76192,76384,76456,77328,77892,77972,78480,78656,79348,79380,79416,80428,80540,80572,80628,80676,80708,80752,80800,80832,80888,81460,82012,82044,82068,82292,82864,83168,83524,84196,84664,84824,85636,85660,85880,85904,86268,86348,87476,87532,87736,87804,87860,88476,88752,88896,89056,89148,89164,89180,89216,89228,89244,89256,89420,89436,89588,89604,89620,89656,89668,89684,89696,89904,89972,90608,90664,91104,91384,91616,91936,92008,92140,92216,92288,92364,92760,93620,94900,95564,95648,95672,95696,95720,96728,96856,96988,97264,97424,97468,97588,97704,97876,97944,98000,98512,98612,98616,98620,98624,98628,98632,98636,98640,98644,98648,98652,98656,98660,98664,98668,98672,98676,98680,98684,98688,98692,99556,100204,100292,100552,100580,100604,100740,100928,101144,101264,101292,101312,101340,101488,101832,101920,102192,102268,102324,102732,102788,103000,103116,103712,103976,104068,104092,104108,104212,104416,104456,104480,104548,104552,104556,104560,104632,104648,104736,104760,104780,104784,104788,104792,104896,104900,104904,104908,105164,105168,105172,105364,105812,106264,106380,106412,106436,106460,106836,106940,107392,107444,107848,108128,108288,108332,108412,108508,108600,109096,109100,109104,109108,109112,109116,109120,109124,109128,109132,109860,110620,111108,111196,111228,111332,111364,111408,111452,111484,111528,111592,112324,112720,112920,113080,113144,113472,113488,113596,113612,114512,114796,114844,114876,114920,114976,115324,115356,115400,115452,115980,116040,116092,116704,116892,117064,117104,117200,117260,117320,117476,117612,117712,117880,118188,118252,118304,118916,119052,119220,119312,119444,119544,119560,119620,119636,119764,120220,121088,121256,121296,121352,121516,121636,121960,122452,123288,123352,123408,123752,123952,124204,124272,124276,124280,124284,124352,124404,124448,124484,124540,124676,124952,125220,125400,125824,126336,126464,126752,127252,127452,127704,127788,127812,127844,127876,128064,128368,128436,128604,128636,128680,128736,128988,129052,129128,129216,129268,129368,129708,129928,130100,130560,130732,130884,131484,131528,131752,131808,132172,132508,132968,133124,133156,133200,133264,133628,133708,133712,133716,133720,133724,133728,133732,133736,133740,133744,133748,133752,133756,133760,133764,133768,133772,133776,133780,133784,133788,134040,134356,134796,135060,135168,135304,135400,135844,135980,136184,136288,136340,136404,136480,137232,137336,137512,137708,137876,137892,137928,138028,138324,138404,138692,138980,139040,139268,139372,139392,139396,139400,139404,139408,139412,139564,139636,139808,140112,140164,140168,140172,140176,140180,140184,140188,140192,140196,140200,140204,140208,140212,140216,140220,140224,140540,140576,140792,140988,141252,141392,141588,142340,142628,142676,142832,142972,143292,143620,143648,143744,143764,144096,144320,144600,144668,144748,145036,145248,145416,145488,145540,146068,146160,146316,146428,146452,146564,146792,147016,147180,147244,147316,147404,147488,147624,147816,147876,147916,148008,148224,148228,148232,148236,148240,148244,148248,148252,148256,148260,148264,148268,148272,148276,148280,148284,148288,148292,148296,148300,148304,148308,148312,148316,148320,148324,148328,148332,148336,148340,148344,148348,148352,148356,148360,148364,148368,148372,148376,148380,148384,148388,148392,148396,148400,148404,148408,148412,148416,148420,148424,148428,148432,148436,148440,148444,148448,148452,148456,148460,148464,148468,148472,148476,148480,148484,148488,148492,148496,148500,148504,148508,148512,148516,148520,148524,148528,148532,148536,148540,148544,148548,148552,148556,148560,148564,148568,148572,148576,148580,148584,148588,148592,148596,148600,148604,148608,148612,148616,148620,148624,148628,148632,148636,148640,148644,148648,148652,148656,148660,148664,148668,148672,148676,148680,148684,148688,148692,148696,148700,148704,148708,148712,148716,148720,148724,148728,148732,148736,148740,148744,148748,148752,148756,148760,148764,148768,148772,148776,148780,148784,148788,148792,148796,148800,148804,148808,148812,148816,148820,148824,148828,148832,148836,148840,148844,148848,148852,148856,148860,148864,148868,148872,148876,148880,148884,148888,148892,148896,148900,148904,148908,148912,148916,148920,148924,148928,148932,148936,148940,148944,148948,148952,148956,148960,148964,148968,148972,148976,148980,148984,148988,148992,148996,149000,149004,149008,149012,149016,149020,149024,149028,149032,149036,149040,149044,149048,149052,149056,149060,149064,149068,149072,149076,149080,149084,149088,149092,149096,149100,149104,149108,149112,149116,149120,149124,149128,149132,149136,149140,149144,149148,149152,149156,149160,149164,149168,149172,149176,149180,149184,149188,149192,149196,149200,149204,149208,149212,149216,149220,149224,149228,149232,149236,149240,149244,149248,149252,149256,149260,149264,149268,149272,149276,149280,149284,149288,149292,149296,149300,149304,149308,149312,149316,149320,149324,149328,149332,149336,149340,149344,149348,149352,149356,149360,149364,149368,149372,149376,149380,149384,149388,149392,149396,149400,149404,149408,149412,149416,149420,149424,149428,149432,149436,149440,149444,149448,149452,149456,149460,149464,149468,149472,149476,149480,149484,149488,149492,149496,149500,149504,149508,149512,149516,149520,149524,149528,149532,149536,149540,149544,149548,149552,149556,149560,149564,149568,149572,149576,149580,149584,149588,149592,149596,149600,149604,149608,149612,149616,149620,149624,149628,149632,149636,149640,149644,149648,149652,149656,149660,149664,149668,149672,149676,149680,149684,149688,149692,149696,149700,149704,149708,149712,149716,149720,149724,149728,149732,149736,149740,149744,149748,149752,149756,149760,149764,149768,149772,149776,149780,149784,149788,149792,149796,149800,149804,149808,149812,149816,149820,149824,149828,149832,149836,149840,149844,149848,149852,149856,149860,149864,149868,149872,149876,149880,149884,149888,149892,149896,149900,149904,149908,149912,149916,149920,149924,149928,149932,149936,149940,149944,149948,149952,149956,149960,149964,149968,149972,149976,149980,149984,149988,149992,149996,150000,150004,150008,150012,150016,150020,150024,150028,150032,150036,150040,150044,150048,150052,150056,150060,150064,150068,150072,150076,150080,150084,150088,150092,150096,150100,150104,150108,150112,150116,150120,150124,150128,150132,150136,150140,150144,150148,150152,150156,150160,150164,150168,150172,150176,150180,150184,150188,150192,150196,150200,150204,150208,150212,150216,150220,150224,150228,150232,150236,150240,150244,150248,150252,150256,150260,150264,150268,150272,150276,150280,150284,150288,150292,150296,150300,150304,150308,150312,150316,150320,150324,150328,150332,150336,150340,150344,150348,150352,150356,150360,150364,150368,150372,150376,150380,150384,150388,150392,150396,150400,150404,150408,150412,150416,150420,150424,150428,150432,150436,150440,150444,150448,150452,150456,150460,150464,150468,150472,150476,150480,150484,150488,150492,150496,150500,150504,150508,150512,150516,150520,150524,150528,150532,150536,150540,150544,150548,150552,150556,150560,150564,150568,150572,150576,150580,150584,150588,150592,150596,150600,150604,150608,150612,150616,150620,150624,150628,150632,150636,150640,150644,150648,150652,150656,150660,150664,150668,150672,150676,150680,150684,150688,150692,150696,150700,150704,150708,150712,150716,150720,150724,150728,150732,150736,150740,150744,150748,150752,150756,150760,150764,150768,150772,150776,150780,150784,150788,150792,150796,150800,150804,150808,150812,150816,150820,150824,150828,150832,150836,150840,150844,150848,150852,150856,150860,150864,150868,150872,150876,150880,150884,150888,150892,150896,150900,150904,150908,150912,150916,150920,150924,150928,150932,150936,150940,150944,150948,150952,150956,150960,150964,150968,150972,150976,150980,150984,150988,150992,150996,151000,151004,151008,151012,151016,151020,151024,151028,151032,151036,151040,151044,151048,151052,151056,151060,151064,151068,151072,151076,151080,151084,151088,151092,151096,151100,151104,151108,151112,151116,151120,151124,151128,151132,151136,151140,151144,151148,151152,151156,151160,151164,151168,151172,151176,151180,151184,151188,151192,151196,151200,151204,151208,151212,151216,151220,151224,151228,151232,151236,151240,151244,151248,151252,151256,151260,151264,151268,151272,151276,151280,151284,151288,151292,151296,151300,151304,151308,151312,151316,151320,151324,151328,151332,151336,151340,151344,151348,151352,151356,151360,151364,151368,151372,151376,151380,151384,151388,151392,151396,151400,151404,151408,151412,151416,151420,151424,151428,151432,151436,151440,151444,151448,151452,151456,151460,151464,151468,151472,151476,151480,151484,151488,151492,151496,151500,151504,151508,151512,151516,151520,151524,151528,151532,151536,151540,151544,151548,151552,151556,151560,151564,151568,151572,151576,151580,151584,151588,151592,151596,151600,151604,151608,151612,151616,151620,151624,151628,151632,151636,151640,151644,151648,151652,151656,151660,151664,151668,151672,151676,151680,151684,151688,151692,151696,151700,151704,151708,151712,151716,151720,151724,151728,151732,151736,151740,151744,151748,151752,151756,151760,151764,151768,151772,151776,151780,151784,151788,151792,151796,151800,151804,151808,151812,151816,151820,151824,151828,151832,151836,151840,151844,151848,151852,151856,151860,151864,151868,151872,151876,151880,151884,151888,151892,151896,151900,151904,151908,151912,151916,151920,151924,151928,151932,151936,151940,151944,151948,151952,151956,151960,151964,151968,151972,151976,151980,151984,151988,151992,151996,152000,152004,152008,152012,152016,152020,152024,152028,152032,152036,152040,152044,152048,152052,152056,152060,152064,152068,152072,152076,152080,152084,152088,152092,152096,152100,152104,152108,152112,152116,152120,152124,152128,152132,152136,152140,152144,152148,152152,152156,152160,152164,152168,152172,152176,152180,152184,152188,152192,152196,152200,152204,152208,152212,152216,152220,152224,152228,152232,152236,152240,152244,152248,152252,152256,152260,152264,152268,152272,152276,152280,152284,152288,152292,152296,152300,152304,152308,152312,152316,152320,152324,152328,152332,152336,152340,152344,152348,152352,152356,152360,152364,152368,152372,152376,152380,152384,152388,152392,152396,152400,152404,152408,152412,152416,152420,152424,152428,152432,152436,152440,152444,152448,152452,152456,152460,152464,152468,152472,152476,152480,152484,152488,152492,152496,152500,152504,152508,152512,152516,152520,152524,152528,152532,152536,152540,152544,152548,152552,152556,152560,152564,152568,152572,152576,152580,152584,152588,152592,152596,152600,152604,152608,152612,152616,152620,152624,152628,152632,152636,152640,152644,152648,152652,152656,152660,152664,152668,152672,152676,152680,152684,152688,152692,152696,152700,152704,152708,152712,152716,152720,152724,152728,152732,152736,152740,152744,152748,152752,152756,152760,152764,152768,152772,152776,152780,152784,152788,152792,152796,152800,152804,152808,152812,152816,152820,152824,152828,152832,152836,152840,152844,152848,152852,152856,152860,152864,152868,152872,152876,152880,152884,152888,152892,152896,152900,152904,152908,152912,152916,152920,152924,152928,152932,152936,152940,152944,152948,152952,152956,152960,152964,152968,152972,152976,152980,152984,152988,152992,152996,153000,153004,153008,153012,153016,153020,153024,153028,153032,153036,153040,153044,153048,153052,153056,153060,153064,153068,153072,153076,153080,153084,153088,153092,153096,153100,153104,153108,153112,153116,153120,153124,153128,153132,153136,153140,153144,153148,153152,153156,153160,153164,153168,153172,153176,153180,153184,153188,153192,153196,153200,153204,153208,153212,153216,153220,153224,153228,153232,153236,153240,153244,153248,153252,153256,153260,153264,153268,153272,153276,153280,153284,153288,153292,153296,153300,153304,153308,153312,153316,153320,153324,153328,153332,153336,153340,153344,153348,153352,153356,153360,153364,153368,153372,153376,153380,153384,153388,153392,153396,153400,153404,153408,153412,153416,153420,153424,153428,153432,153436,153440,153444,153448,153452,153456,153460,153464,153468,153472,153476,153480,153484,153488,153492,153496,153500,153504,153508,153512,153516,153520,153524,153528,153532,153536,153540,153544,153548,153552,153556,153560,153564,153568,153572,153576,153580,153584,153588,153592,153596,153600,153604,153608,153612,153616,153620,153624,153628,153632,153636,153640,153644,153648,153652,153656,153660,153664,153668,153672,153676,153680,153684,153688,153692,153696,153700,153704,153708,153712,153716,153720,153724,153728,153732,153736,153740,153744,153748,153752,153756,153760,153764,153768,153772,153776,153780,153784,153788,153792,153796,153800,153804,153808,153812,153816,153820,153824,153828,153832,153836,153840,153844,153848,153852,153856,153860,153864,153868,153872,153876,153880,153884,153888,153892,153896,153900,153904,153908,153912,153916,153920,153924,153928,153932,153936,153940,153944,153948,153952,153956,153960,153964,153968,153972,153976,153980,153984,153988,153992,153996,154000,154004,154008,154012,154016,154020,154024,154028,154032,154036,154040,154044,154048,154052,154056,154060,154064,154068,154072,154076,154080,154084,154088,154092,154096,154100,154104,154108,154112,154116,154120,154124,154128,154132,154136,154140,154144,154148,154152,154156,154160,154164,154168,154172,154176,154180,154184,154188,154192,154196,154200,154204,154208,154212,154216,154220,154224,154228,154232,154236,154240,154244,154248,154252,154256,154260,154264,154268,154272,154276,154280,154284,154288,154292,154296,154300,154304,154308,154312,154316,154320,154324,154328,154332,154336,154340,154344,154348,154352,154356,154360,154364,154368,154372,154376,154380,154384,154388,154392,154396,154400,154404,154408,154412,154416,154420,154424,154428,154432,154436,154440,154444,154448,154452,154456,154460,154464,154468,154472,154476,154480,154484,154488,154492,154496,154500,154504,154508,154512,154516,154520,154524,154528,154532,154536,154540,154544,154548,154552,154556,154560,154564,154568,154572,154576,154580,154584,154588,154592,154596,154600,154604,154608,154612,154616,154620,154624,154628,154632,154636,154640,154644,154648,154652,154656,154660,154664,154668,154672,154676,154680,154684,154688,154692,154696,154700,154704,154708,154712,154716,154720,154724,154728,154732,154736,154740,154744,154748,154752,154756,154760,154764,154768,154772,154776,154780,154784,154788,154792,154796,154800,154804,154808,154812,154816,154820,154824,154828,154832,154836,154840,154844,154848,154852,154856,154860,154864,154868,154872,154876,154880,154884,154888,154892,154896,154900,154904,154908,154912,154916,154920,154924,154928,154932,154936,154940,154944,154948,154952,154956,154960,154964,154968,154972,154976,154980,154984,154988,154992,154996,155000,155004,155008,155012,155016,155020,155024,155028,155032,155036,155040,155044,155048,155052,155056,155060,155064,155068,155072,155076,155080,155084,155088,155092,155096,155100,155104,155108,155112,155116,155120,155124,155128,155132,155136,155140,155144,155148,155152,155156,155160,155164,155168,155172,155176,155180,155184,155188,155192,155196,155200,155204,155208,155212,155216,155220,155224,155228,155232,155236,155240,155244,155248,155252,155256,155260,155264,155268,155272,155276,155280,155284,155288,155292,155296,155300,155304,155308,155312,155316,155320,155324,155328,155332,155336,155340,155344,155348,155352,155356,155360,155364,155368,155372,155376,155380,155384,155388,155392,155396,155400,155404,155408,155412,155416,155420,155424,155428,155432,155436,155440,155444,155448,155452,155456,155460,155464,155468,155472,155476,155480,155484,155488,155492,155496,155500,155504,155508,155512,155516,155520,155524,155528,155532,155536,155540,155544,155548,155552,155556,155560,155564,155568,155572,155576,155580,155584,155588,155592,155596,155600,155604,155608,155612,155616,155620,155624,155628,155632,155636,155640,155644,155648,155652,155656,155660,155664,155668,155672,155676,155680,155684,155688,155692,155696,155700,155704,155708,155712,155716,155720,155724,155728,155732,155736,155740,155744,155748,155752,155756,155760,155764,155768,155772,155776,155780,155784,155788,155792,155796,155800,155804,155808,155812,155816,155820,155824,155828,155832,155836,155840,155844,155848,155852,155856,155860,155864,155868,155872,155876,155880,155884,155888,155892,155896,155900,155904,155908,155912,155916,155920,155924,155928,155932,155936,155940,155944,155948,155952,155956,155960,155964,155968,155972,155976,155980,155984,155988,155992,155996,156000,156004,156008,156012,156016,156020,156024,156028,156032,156036,156040,156044,156048,156052,156056,156060,156064,156068,156072,156076,156080,156084,156088,156092,156096,156100,156104,156108,156112,156116,156120,156124,156128,156132,156136,156140,156144,156148,156152,156156,156160,156164,156168,156172,156176,156180,156184,156188,156192,156196,156200,156204,156208,156212,156216,156220,156224,156228,156232,156236,156240,156244,156248,156252,156256,156260,156264,156268,156272,156276,156280,156284,156288,156292,156296,156300,156304,156308,156312,156316,156320,156324,156328,156332,156336,156340,156344,156348,156352,156356,156360,156364,156368,156372,156376,156380,156384,156388,156392,156396,156400,156404,156408,156412,156612,156828,157284,157340,157356,157456,157672,157936,158200,158448,158512,158868,158968,159112,159148,159200,159236,159376,159468,159552,159772,159948,159996,160180,160448,160560,160632,160748,160972,161264,161372,161424,161428,161432,161436,161596,161692,161736,161820,161864,161944,162264,162420,162572,162724,162800,162888,163060,163248,163436,163556,163632,163752,163832,163892,164272,164404,164520,164800,165024,165152,165324,165412,165476,165560,165592,165632,165708,165780,165908,166204,166312,166436,166552,166844,166948,167060,167208,167284,167772,167892,167988,168040,168120,168168,168228,168324,168392,168444,168540,168636,168672,168704,168944,169160,169200,169280,169380,169488,169564,169636,169704,169748,169792,169892,170012,170088,170164,170412,171388,112,140,328,344,444,468,496,752,1088,1104,1132,1152,1192,1208,1232,1508,1528,1548,1564,3432,3560,3576,3604,3652,3776,3824,3876,3964,4040,4124,4184,4228,4340,4416,4436,4460,5136,5308,5596,5684,5912,6000,6316,6404,6800,6888,7364,7576,7948,7984,8288,8564,8640,8668,9092,9560,9672,10068,10212,10372,10500,10572,10676,10736,10772,11004,11072,11088,11116,11140,11156,11180,11268,11676,11732,12124,12316,12580,12780,12880,13088,13284,13380,13584,13760,13836,14960,15080,15168,15224,15340,15536,15864,15960,16140,16348,16396,16444,16492,16548,16596,16636,16684,16788,16864,16912,17012,17080,17128,17160,17208,17328,17376,17408,17456,17496,17544,17612,18012,18144,18272,18404,18896,18956,19888,19948,20008,20572,20632,20692,21012,21072,21132,21192,22608,23024,23120,25920,29164,29384,29468,29672,29900,29916,30052,30264,30480,30496,30620,30988,34540,34672,34756,35616,35680,35744,35820,35880,35940,35996,36052,36108,36980,38864,39668,39708,39748,39788,39828,39868,40068,40380,40444,40464,40488,40504,40568,40596,40624,40652,40680,40708,40736,40764,40792,40820,40848,40876,40904,40932,40960,40988,41016,41044,41072,41100,41128,41156,41184,41212,41240,41268,41296,41324,41352,41380,41408,41436,41464,41492,41520,41548,41576,41604,41632,41660,41688,41716,41744,41772,41800,41828,41856,41884,41912,41940,41968,41996,42024,42052,42080,42108,42136,42164,42192,42220,42248,42276,42304,42332,42360,42388,42416,42444,42472,42500,42528,42556,42584,42612,42640,42668,42696,42724,42752,42780,42808,42836,42864,42892,42920,42948,42976,43004,43032,43060,43088,43116,43144,43172,43200,43228,43256,43284,43312,43340,43368,43396,43424,43452,43480,43508,43536,43564,43592,43620,43648,43676,43704,43732,43760,43788,43816,43844,43872,43900,43928,43956,43984,44012,44040,44068,44096,44124,44152,44180,44208,44236,44264,44292,44320,44348,44376,44404,44432,44460,44488,44516,44544,44572,44600,44628,44656,44684,44712,44740,44768,44796,44824,44852,44880,44908,44936,44964,44992,45020,45048,47608,47756,49188,51848,52060,52076,52084,52100,52116,52172,52256,52284,52388,52552,52676,52872,52976,53204,53288,53296,53328,53412,53440,53544,53708,53832,54028,54132,54160,54172,54180,54780,54876,55068,55244,55808,56020,56172,56448,56536,59092,59128,59164,59204,59284,59468,59524,59680,59728,59776,59820,59864,59928,59972,60036,60084,60132,60180,60248,60296,60384,60408,60444,60468,60504,60540,60576,60612,60648,60700,60736,60772,60852,60904,60928,60940,61008,61016,61284,61344,61388,61612,61852,62020,62212,62308,62368,62432,62564,62648,62720,62932,63036,63068,63240,63284,63412,63444,63612,64840,64856,64916,65696,65796,65856,66852,66956,67056,67744,68280,68512,68756,68784,68972,69344,69604,69804,69832,69928,69976,70080,70956,71076,74980,76124,76412,76464,77044,77380,77412,77456,77508,77580,77640,78008,78620,78692,78952,78996,79084,79540,79568,79756,79804,79848,79892,79936,80172,80200,80244,80320,80716,80840,80896,82516,82692,82732,82788,82812,82840,82880,82912,82956,82980,83016,83084,83140,83220,83240,83388,83456,83776,83844,83920,83996,84072,84168,84216,84236,84292,84708,84732,85016,85036,85056,85076,85100,85128,85148,85168,85188,85212,85240,85264,85292,85316,85344,85368,85396,85432,85452,85500,85608,85812,85924,86028,86052,86084,86112,86144,86180,86200,90500,90908,90952,91020,91048,91244,91268,91420,91472,91508,91524,91640,91688,91740,91776,91792,91852,92732,93516,93844,93856,93888,93932,93984,94000,94028,94064,94152,94208,94236,94340,94412,94440,94528,94616,94644,94716,94788,94816,94828,94836,94844,95236,95288,95312,95324,95412,95848,96024,96132,96272,96448,96548,96692,96800,97432,97520,97552,97636,98708,99896,99952,100012,100068,100212,100648,100700,101084,101220,101460,101508,101528,103040,103064,103912,104024,104124,104144,104184,104232,104252,104332,104488,105136,106620,107524,107560,107720,107764,107792,107868,107896,107936,108012,108804,108900,110128,110140,110196,110236,110268,110292,110328,110408,110444,110484,110536,110560,110784,110868,110940,110968,111024,111280,111372,111492,111536,111632,111708,111756,111896,111996,112012,112020,112028,112040,112188,112204,112624,112776,112848,113088,113400,114628,114696,114760,114884,115364,115548,115572,115616,115644,115700,115724,115748,115780,115800,115820,115864,115896,116440,116456,116712,116996,117364,117520,117680,117788,117820,117852,117900,118092,118652,118668,118924,119144,119248,119364,121212,121316,121384,121456,121656,122532,122632,122664,122700,122732,122768,122792,122816,122840,122864,122888,122912,122936,122960,122984,123016,123040,123064,123088,123112,123136,123160,123184,123208,123368,123416,123528,123644,123676,124876,125124,125276,125328,125620,125672,125692,125744,125940,126016,126428,126796,126812,126880,127192,127324,128160,128192,128236,128260,128300,128376,128552,128644,128880,128920,128996,129188,129244,129308,129472,129528,129568,129584,129780,129840,129892,129964,129976,130792,131000,131900,132024,132048,132060,132084,132116,132328,133072,133164,133568,134116,135100,135936,136544,136580,136624,136632,136984,137012,137028,137368,137652,138140,138200,138444,138812,138832,138884,138904,139068,139164,139544,140488,140500,140548,140584,140616,140652,140680,140696,140712,140736,140856,140896,141020,141092,141184,141200,141312,141332,141352,141476,141496,141516,141652,141704,141760,141788,141816,141844,141872,141900,141928,141956,141984,142012,142040,142068,142096,142124,142152,142180,142208,142236,142264,142592,142648,142908,143576,143688,143700,143792,144160,144216,144368,145080,145132,145164,145188,145324,145504,145556,146112,146368,146864,147116,147668,147684,147712,147728,147752,148128,156516,156860,156876,156900,156956,156984,157068,157132,157172,157212,157228,157392,158272,158564,158668,158696,158724,158752,158780,158804,158820,158876,158896,158924,158980,158988,159048,159436,160044,160288,160304,160316,160364,160384,160396,160756,160816,161712,161764,161972,162040,162088,162340,162628,162768,162936,162968,163132,163468,163524,163564,163576,163760,163776,163800,163820,164464,164568,164848,164868,165072,165208,165608,165828,166252,166492,166608,166648,166996,167432,167440,167516,167640,167700,167836,168356,168484,168580,169088,169812,169844,170296,170352,170364,170420,170676,170736,170808,170848,170900,171004,171012,171224,171264,171320,171400,171420,171532,171656,171692,171976,172108,172124,172436,172456]);

  for (var i = 0; i < relocations.length; i++) {
    assert(relocations[i] % 4 === 0);
    assert(relocations[i] >= 0 && relocations[i] < eb + 172792); // in range
    assert(HEAPU32[eb + relocations[i] >> 2] + eb < (-1 >>> 0), [i, relocations[i]]); // no overflows
    HEAPU32[eb + relocations[i] >> 2] = HEAPU32[eb + relocations[i] >> 2] + eb;
  }
});



  function demangle(func) {
      warnOnce('warning: build with  -s DEMANGLE_SUPPORT=1  to link in libcxxabi demangling');
      return func;
    }

  function demangleAll(text) {
      var regex =
        /\b__Z[\w\d_]+/g;
      return text.replace(regex,
        function(x) {
          var y = demangle(x);
          return x === y ? x : (y + ' [' + x + ']');
        });
    }

  function jsStackTrace() {
      var err = new Error();
      if (!err.stack) {
        // IE10+ special cases: It does have callstack info, but it is only populated if an Error object is thrown,
        // so try that as a special-case.
        try {
          throw new Error(0);
        } catch(e) {
          err = e;
        }
        if (!err.stack) {
          return '(no stack trace available)';
        }
      }
      return err.stack.toString();
    }

  function stackTrace() {
      var js = jsStackTrace();
      if (Module['extraStackTrace']) js += '\n' + Module['extraStackTrace']();
      return demangleAll(js);
    }

  function ___assert_fail(condition, filename, line, func) {
      abort('Assertion failed: ' + UTF8ToString(condition) + ', at: ' + [filename ? UTF8ToString(filename) : 'unknown filename', line, func ? UTF8ToString(func) : 'unknown function']);
    }

  function ___lock() {}

  
    

  
  function ___setErrNo(value) {
      if (Module['___errno_location']) HEAP32[((Module['___errno_location']())>>2)]=value;
      else err('failed to set errno from JS');
      return value;
    }
  
  
  var PATH={splitPath:function(filename) {
        var splitPathRe = /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/;
        return splitPathRe.exec(filename).slice(1);
      },normalizeArray:function(parts, allowAboveRoot) {
        // if the path tries to go above the root, `up` ends up > 0
        var up = 0;
        for (var i = parts.length - 1; i >= 0; i--) {
          var last = parts[i];
          if (last === '.') {
            parts.splice(i, 1);
          } else if (last === '..') {
            parts.splice(i, 1);
            up++;
          } else if (up) {
            parts.splice(i, 1);
            up--;
          }
        }
        // if the path is allowed to go above the root, restore leading ..s
        if (allowAboveRoot) {
          for (; up; up--) {
            parts.unshift('..');
          }
        }
        return parts;
      },normalize:function(path) {
        var isAbsolute = path.charAt(0) === '/',
            trailingSlash = path.substr(-1) === '/';
        // Normalize the path
        path = PATH.normalizeArray(path.split('/').filter(function(p) {
          return !!p;
        }), !isAbsolute).join('/');
        if (!path && !isAbsolute) {
          path = '.';
        }
        if (path && trailingSlash) {
          path += '/';
        }
        return (isAbsolute ? '/' : '') + path;
      },dirname:function(path) {
        var result = PATH.splitPath(path),
            root = result[0],
            dir = result[1];
        if (!root && !dir) {
          // No dirname whatsoever
          return '.';
        }
        if (dir) {
          // It has a dirname, strip trailing slash
          dir = dir.substr(0, dir.length - 1);
        }
        return root + dir;
      },basename:function(path) {
        // EMSCRIPTEN return '/'' for '/', not an empty string
        if (path === '/') return '/';
        var lastSlash = path.lastIndexOf('/');
        if (lastSlash === -1) return path;
        return path.substr(lastSlash+1);
      },extname:function(path) {
        return PATH.splitPath(path)[3];
      },join:function() {
        var paths = Array.prototype.slice.call(arguments, 0);
        return PATH.normalize(paths.join('/'));
      },join2:function(l, r) {
        return PATH.normalize(l + '/' + r);
      }};
  
  
  var PATH_FS={resolve:function() {
        var resolvedPath = '',
          resolvedAbsolute = false;
        for (var i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
          var path = (i >= 0) ? arguments[i] : FS.cwd();
          // Skip empty and invalid entries
          if (typeof path !== 'string') {
            throw new TypeError('Arguments to path.resolve must be strings');
          } else if (!path) {
            return ''; // an invalid portion invalidates the whole thing
          }
          resolvedPath = path + '/' + resolvedPath;
          resolvedAbsolute = path.charAt(0) === '/';
        }
        // At this point the path should be resolved to a full absolute path, but
        // handle relative paths to be safe (might happen when process.cwd() fails)
        resolvedPath = PATH.normalizeArray(resolvedPath.split('/').filter(function(p) {
          return !!p;
        }), !resolvedAbsolute).join('/');
        return ((resolvedAbsolute ? '/' : '') + resolvedPath) || '.';
      },relative:function(from, to) {
        from = PATH_FS.resolve(from).substr(1);
        to = PATH_FS.resolve(to).substr(1);
        function trim(arr) {
          var start = 0;
          for (; start < arr.length; start++) {
            if (arr[start] !== '') break;
          }
          var end = arr.length - 1;
          for (; end >= 0; end--) {
            if (arr[end] !== '') break;
          }
          if (start > end) return [];
          return arr.slice(start, end - start + 1);
        }
        var fromParts = trim(from.split('/'));
        var toParts = trim(to.split('/'));
        var length = Math.min(fromParts.length, toParts.length);
        var samePartsLength = length;
        for (var i = 0; i < length; i++) {
          if (fromParts[i] !== toParts[i]) {
            samePartsLength = i;
            break;
          }
        }
        var outputParts = [];
        for (var i = samePartsLength; i < fromParts.length; i++) {
          outputParts.push('..');
        }
        outputParts = outputParts.concat(toParts.slice(samePartsLength));
        return outputParts.join('/');
      }};
  
  var TTY={ttys:[],init:function () {
        // https://github.com/emscripten-core/emscripten/pull/1555
        // if (ENVIRONMENT_IS_NODE) {
        //   // currently, FS.init does not distinguish if process.stdin is a file or TTY
        //   // device, it always assumes it's a TTY device. because of this, we're forcing
        //   // process.stdin to UTF8 encoding to at least make stdin reading compatible
        //   // with text files until FS.init can be refactored.
        //   process['stdin']['setEncoding']('utf8');
        // }
      },shutdown:function() {
        // https://github.com/emscripten-core/emscripten/pull/1555
        // if (ENVIRONMENT_IS_NODE) {
        //   // inolen: any idea as to why node -e 'process.stdin.read()' wouldn't exit immediately (with process.stdin being a tty)?
        //   // isaacs: because now it's reading from the stream, you've expressed interest in it, so that read() kicks off a _read() which creates a ReadReq operation
        //   // inolen: I thought read() in that case was a synchronous operation that just grabbed some amount of buffered data if it exists?
        //   // isaacs: it is. but it also triggers a _read() call, which calls readStart() on the handle
        //   // isaacs: do process.stdin.pause() and i'd think it'd probably close the pending call
        //   process['stdin']['pause']();
        // }
      },register:function(dev, ops) {
        TTY.ttys[dev] = { input: [], output: [], ops: ops };
        FS.registerDevice(dev, TTY.stream_ops);
      },stream_ops:{open:function(stream) {
          var tty = TTY.ttys[stream.node.rdev];
          if (!tty) {
            throw new FS.ErrnoError(43);
          }
          stream.tty = tty;
          stream.seekable = false;
        },close:function(stream) {
          // flush any pending line data
          stream.tty.ops.flush(stream.tty);
        },flush:function(stream) {
          stream.tty.ops.flush(stream.tty);
        },read:function(stream, buffer, offset, length, pos /* ignored */) {
          if (!stream.tty || !stream.tty.ops.get_char) {
            throw new FS.ErrnoError(60);
          }
          var bytesRead = 0;
          for (var i = 0; i < length; i++) {
            var result;
            try {
              result = stream.tty.ops.get_char(stream.tty);
            } catch (e) {
              throw new FS.ErrnoError(29);
            }
            if (result === undefined && bytesRead === 0) {
              throw new FS.ErrnoError(6);
            }
            if (result === null || result === undefined) break;
            bytesRead++;
            buffer[offset+i] = result;
          }
          if (bytesRead) {
            stream.node.timestamp = Date.now();
          }
          return bytesRead;
        },write:function(stream, buffer, offset, length, pos) {
          if (!stream.tty || !stream.tty.ops.put_char) {
            throw new FS.ErrnoError(60);
          }
          try {
            for (var i = 0; i < length; i++) {
              stream.tty.ops.put_char(stream.tty, buffer[offset+i]);
            }
          } catch (e) {
            throw new FS.ErrnoError(29);
          }
          if (length) {
            stream.node.timestamp = Date.now();
          }
          return i;
        }},default_tty_ops:{get_char:function(tty) {
          if (!tty.input.length) {
            var result = null;
            if (ENVIRONMENT_IS_NODE) {
              // we will read data by chunks of BUFSIZE
              var BUFSIZE = 256;
              var buf = Buffer.alloc ? Buffer.alloc(BUFSIZE) : new Buffer(BUFSIZE);
              var bytesRead = 0;
  
              try {
                bytesRead = nodeFS.readSync(process.stdin.fd, buf, 0, BUFSIZE, null);
              } catch(e) {
                // Cross-platform differences: on Windows, reading EOF throws an exception, but on other OSes,
                // reading EOF returns 0. Uniformize behavior by treating the EOF exception to return 0.
                if (e.toString().indexOf('EOF') != -1) bytesRead = 0;
                else throw e;
              }
  
              if (bytesRead > 0) {
                result = buf.slice(0, bytesRead).toString('utf-8');
              } else {
                result = null;
              }
            } else
            if (typeof window != 'undefined' &&
              typeof window.prompt == 'function') {
              // Browser.
              result = window.prompt('Input: ');  // returns null on cancel
              if (result !== null) {
                result += '\n';
              }
            } else if (typeof readline == 'function') {
              // Command line.
              result = readline();
              if (result !== null) {
                result += '\n';
              }
            }
            if (!result) {
              return null;
            }
            tty.input = intArrayFromString(result, true);
          }
          return tty.input.shift();
        },put_char:function(tty, val) {
          if (val === null || val === 10) {
            out(UTF8ArrayToString(tty.output, 0));
            tty.output = [];
          } else {
            if (val != 0) tty.output.push(val); // val == 0 would cut text output off in the middle.
          }
        },flush:function(tty) {
          if (tty.output && tty.output.length > 0) {
            out(UTF8ArrayToString(tty.output, 0));
            tty.output = [];
          }
        }},default_tty1_ops:{put_char:function(tty, val) {
          if (val === null || val === 10) {
            err(UTF8ArrayToString(tty.output, 0));
            tty.output = [];
          } else {
            if (val != 0) tty.output.push(val);
          }
        },flush:function(tty) {
          if (tty.output && tty.output.length > 0) {
            err(UTF8ArrayToString(tty.output, 0));
            tty.output = [];
          }
        }}};
  
  var MEMFS={ops_table:null,mount:function(mount) {
        return MEMFS.createNode(null, '/', 16384 | 511 /* 0777 */, 0);
      },createNode:function(parent, name, mode, dev) {
        if (FS.isBlkdev(mode) || FS.isFIFO(mode)) {
          // no supported
          throw new FS.ErrnoError(63);
        }
        if (!MEMFS.ops_table) {
          MEMFS.ops_table = {
            dir: {
              node: {
                getattr: MEMFS.node_ops.getattr,
                setattr: MEMFS.node_ops.setattr,
                lookup: MEMFS.node_ops.lookup,
                mknod: MEMFS.node_ops.mknod,
                rename: MEMFS.node_ops.rename,
                unlink: MEMFS.node_ops.unlink,
                rmdir: MEMFS.node_ops.rmdir,
                readdir: MEMFS.node_ops.readdir,
                symlink: MEMFS.node_ops.symlink
              },
              stream: {
                llseek: MEMFS.stream_ops.llseek
              }
            },
            file: {
              node: {
                getattr: MEMFS.node_ops.getattr,
                setattr: MEMFS.node_ops.setattr
              },
              stream: {
                llseek: MEMFS.stream_ops.llseek,
                read: MEMFS.stream_ops.read,
                write: MEMFS.stream_ops.write,
                allocate: MEMFS.stream_ops.allocate,
                mmap: MEMFS.stream_ops.mmap,
                msync: MEMFS.stream_ops.msync
              }
            },
            link: {
              node: {
                getattr: MEMFS.node_ops.getattr,
                setattr: MEMFS.node_ops.setattr,
                readlink: MEMFS.node_ops.readlink
              },
              stream: {}
            },
            chrdev: {
              node: {
                getattr: MEMFS.node_ops.getattr,
                setattr: MEMFS.node_ops.setattr
              },
              stream: FS.chrdev_stream_ops
            }
          };
        }
        var node = FS.createNode(parent, name, mode, dev);
        if (FS.isDir(node.mode)) {
          node.node_ops = MEMFS.ops_table.dir.node;
          node.stream_ops = MEMFS.ops_table.dir.stream;
          node.contents = {};
        } else if (FS.isFile(node.mode)) {
          node.node_ops = MEMFS.ops_table.file.node;
          node.stream_ops = MEMFS.ops_table.file.stream;
          node.usedBytes = 0; // The actual number of bytes used in the typed array, as opposed to contents.length which gives the whole capacity.
          // When the byte data of the file is populated, this will point to either a typed array, or a normal JS array. Typed arrays are preferred
          // for performance, and used by default. However, typed arrays are not resizable like normal JS arrays are, so there is a small disk size
          // penalty involved for appending file writes that continuously grow a file similar to std::vector capacity vs used -scheme.
          node.contents = null; 
        } else if (FS.isLink(node.mode)) {
          node.node_ops = MEMFS.ops_table.link.node;
          node.stream_ops = MEMFS.ops_table.link.stream;
        } else if (FS.isChrdev(node.mode)) {
          node.node_ops = MEMFS.ops_table.chrdev.node;
          node.stream_ops = MEMFS.ops_table.chrdev.stream;
        }
        node.timestamp = Date.now();
        // add the new node to the parent
        if (parent) {
          parent.contents[name] = node;
        }
        return node;
      },getFileDataAsRegularArray:function(node) {
        if (node.contents && node.contents.subarray) {
          var arr = [];
          for (var i = 0; i < node.usedBytes; ++i) arr.push(node.contents[i]);
          return arr; // Returns a copy of the original data.
        }
        return node.contents; // No-op, the file contents are already in a JS array. Return as-is.
      },getFileDataAsTypedArray:function(node) {
        if (!node.contents) return new Uint8Array;
        if (node.contents.subarray) return node.contents.subarray(0, node.usedBytes); // Make sure to not return excess unused bytes.
        return new Uint8Array(node.contents);
      },expandFileStorage:function(node, newCapacity) {
        var prevCapacity = node.contents ? node.contents.length : 0;
        if (prevCapacity >= newCapacity) return; // No need to expand, the storage was already large enough.
        // Don't expand strictly to the given requested limit if it's only a very small increase, but instead geometrically grow capacity.
        // For small filesizes (<1MB), perform size*2 geometric increase, but for large sizes, do a much more conservative size*1.125 increase to
        // avoid overshooting the allocation cap by a very large margin.
        var CAPACITY_DOUBLING_MAX = 1024 * 1024;
        newCapacity = Math.max(newCapacity, (prevCapacity * (prevCapacity < CAPACITY_DOUBLING_MAX ? 2.0 : 1.125)) | 0);
        if (prevCapacity != 0) newCapacity = Math.max(newCapacity, 256); // At minimum allocate 256b for each file when expanding.
        var oldContents = node.contents;
        node.contents = new Uint8Array(newCapacity); // Allocate new storage.
        if (node.usedBytes > 0) node.contents.set(oldContents.subarray(0, node.usedBytes), 0); // Copy old data over to the new storage.
        return;
      },resizeFileStorage:function(node, newSize) {
        if (node.usedBytes == newSize) return;
        if (newSize == 0) {
          node.contents = null; // Fully decommit when requesting a resize to zero.
          node.usedBytes = 0;
          return;
        }
        if (!node.contents || node.contents.subarray) { // Resize a typed array if that is being used as the backing store.
          var oldContents = node.contents;
          node.contents = new Uint8Array(new ArrayBuffer(newSize)); // Allocate new storage.
          if (oldContents) {
            node.contents.set(oldContents.subarray(0, Math.min(newSize, node.usedBytes))); // Copy old data over to the new storage.
          }
          node.usedBytes = newSize;
          return;
        }
        // Backing with a JS array.
        if (!node.contents) node.contents = [];
        if (node.contents.length > newSize) node.contents.length = newSize;
        else while (node.contents.length < newSize) node.contents.push(0);
        node.usedBytes = newSize;
      },node_ops:{getattr:function(node) {
          var attr = {};
          // device numbers reuse inode numbers.
          attr.dev = FS.isChrdev(node.mode) ? node.id : 1;
          attr.ino = node.id;
          attr.mode = node.mode;
          attr.nlink = 1;
          attr.uid = 0;
          attr.gid = 0;
          attr.rdev = node.rdev;
          if (FS.isDir(node.mode)) {
            attr.size = 4096;
          } else if (FS.isFile(node.mode)) {
            attr.size = node.usedBytes;
          } else if (FS.isLink(node.mode)) {
            attr.size = node.link.length;
          } else {
            attr.size = 0;
          }
          attr.atime = new Date(node.timestamp);
          attr.mtime = new Date(node.timestamp);
          attr.ctime = new Date(node.timestamp);
          // NOTE: In our implementation, st_blocks = Math.ceil(st_size/st_blksize),
          //       but this is not required by the standard.
          attr.blksize = 4096;
          attr.blocks = Math.ceil(attr.size / attr.blksize);
          return attr;
        },setattr:function(node, attr) {
          if (attr.mode !== undefined) {
            node.mode = attr.mode;
          }
          if (attr.timestamp !== undefined) {
            node.timestamp = attr.timestamp;
          }
          if (attr.size !== undefined) {
            MEMFS.resizeFileStorage(node, attr.size);
          }
        },lookup:function(parent, name) {
          throw FS.genericErrors[44];
        },mknod:function(parent, name, mode, dev) {
          return MEMFS.createNode(parent, name, mode, dev);
        },rename:function(old_node, new_dir, new_name) {
          // if we're overwriting a directory at new_name, make sure it's empty.
          if (FS.isDir(old_node.mode)) {
            var new_node;
            try {
              new_node = FS.lookupNode(new_dir, new_name);
            } catch (e) {
            }
            if (new_node) {
              for (var i in new_node.contents) {
                throw new FS.ErrnoError(55);
              }
            }
          }
          // do the internal rewiring
          delete old_node.parent.contents[old_node.name];
          old_node.name = new_name;
          new_dir.contents[new_name] = old_node;
          old_node.parent = new_dir;
        },unlink:function(parent, name) {
          delete parent.contents[name];
        },rmdir:function(parent, name) {
          var node = FS.lookupNode(parent, name);
          for (var i in node.contents) {
            throw new FS.ErrnoError(55);
          }
          delete parent.contents[name];
        },readdir:function(node) {
          var entries = ['.', '..'];
          for (var key in node.contents) {
            if (!node.contents.hasOwnProperty(key)) {
              continue;
            }
            entries.push(key);
          }
          return entries;
        },symlink:function(parent, newname, oldpath) {
          var node = MEMFS.createNode(parent, newname, 511 /* 0777 */ | 40960, 0);
          node.link = oldpath;
          return node;
        },readlink:function(node) {
          if (!FS.isLink(node.mode)) {
            throw new FS.ErrnoError(28);
          }
          return node.link;
        }},stream_ops:{read:function(stream, buffer, offset, length, position) {
          var contents = stream.node.contents;
          if (position >= stream.node.usedBytes) return 0;
          var size = Math.min(stream.node.usedBytes - position, length);
          assert(size >= 0);
          if (size > 8 && contents.subarray) { // non-trivial, and typed array
            buffer.set(contents.subarray(position, position + size), offset);
          } else {
            for (var i = 0; i < size; i++) buffer[offset + i] = contents[position + i];
          }
          return size;
        },write:function(stream, buffer, offset, length, position, canOwn) {
          // The data buffer should be a typed array view
          assert(!(buffer instanceof ArrayBuffer));
  
          if (!length) return 0;
          var node = stream.node;
          node.timestamp = Date.now();
  
          if (buffer.subarray && (!node.contents || node.contents.subarray)) { // This write is from a typed array to a typed array?
            if (canOwn) {
              assert(position === 0, 'canOwn must imply no weird position inside the file');
              node.contents = buffer.subarray(offset, offset + length);
              node.usedBytes = length;
              return length;
            } else if (node.usedBytes === 0 && position === 0) { // If this is a simple first write to an empty file, do a fast set since we don't need to care about old data.
              node.contents = new Uint8Array(buffer.subarray(offset, offset + length));
              node.usedBytes = length;
              return length;
            } else if (position + length <= node.usedBytes) { // Writing to an already allocated and used subrange of the file?
              node.contents.set(buffer.subarray(offset, offset + length), position);
              return length;
            }
          }
  
          // Appending to an existing file and we need to reallocate, or source data did not come as a typed array.
          MEMFS.expandFileStorage(node, position+length);
          if (node.contents.subarray && buffer.subarray) node.contents.set(buffer.subarray(offset, offset + length), position); // Use typed array write if available.
          else {
            for (var i = 0; i < length; i++) {
             node.contents[position + i] = buffer[offset + i]; // Or fall back to manual write if not.
            }
          }
          node.usedBytes = Math.max(node.usedBytes, position+length);
          return length;
        },llseek:function(stream, offset, whence) {
          var position = offset;
          if (whence === 1) {
            position += stream.position;
          } else if (whence === 2) {
            if (FS.isFile(stream.node.mode)) {
              position += stream.node.usedBytes;
            }
          }
          if (position < 0) {
            throw new FS.ErrnoError(28);
          }
          return position;
        },allocate:function(stream, offset, length) {
          MEMFS.expandFileStorage(stream.node, offset + length);
          stream.node.usedBytes = Math.max(stream.node.usedBytes, offset + length);
        },mmap:function(stream, buffer, offset, length, position, prot, flags) {
          // The data buffer should be a typed array view
          assert(!(buffer instanceof ArrayBuffer));
          if (!FS.isFile(stream.node.mode)) {
            throw new FS.ErrnoError(43);
          }
          var ptr;
          var allocated;
          var contents = stream.node.contents;
          // Only make a new copy when MAP_PRIVATE is specified.
          if ( !(flags & 2) &&
                contents.buffer === buffer.buffer ) {
            // We can't emulate MAP_SHARED when the file is not backed by the buffer
            // we're mapping to (e.g. the HEAP buffer).
            allocated = false;
            ptr = contents.byteOffset;
          } else {
            // Try to avoid unnecessary slices.
            if (position > 0 || position + length < stream.node.usedBytes) {
              if (contents.subarray) {
                contents = contents.subarray(position, position + length);
              } else {
                contents = Array.prototype.slice.call(contents, position, position + length);
              }
            }
            allocated = true;
            // malloc() can lead to growing the heap. If targeting the heap, we need to
            // re-acquire the heap buffer object in case growth had occurred.
            var fromHeap = (buffer.buffer == HEAP8.buffer);
            ptr = _malloc(length);
            if (!ptr) {
              throw new FS.ErrnoError(48);
            }
            (fromHeap ? HEAP8 : buffer).set(contents, ptr);
          }
          return { ptr: ptr, allocated: allocated };
        },msync:function(stream, buffer, offset, length, mmapFlags) {
          if (!FS.isFile(stream.node.mode)) {
            throw new FS.ErrnoError(43);
          }
          if (mmapFlags & 2) {
            // MAP_PRIVATE calls need not to be synced back to underlying fs
            return 0;
          }
  
          var bytesWritten = MEMFS.stream_ops.write(stream, buffer, 0, length, offset, false);
          // should we check if bytesWritten and length are the same?
          return 0;
        }}};
  
  var ERRNO_MESSAGES={0:"Success",1:"Arg list too long",2:"Permission denied",3:"Address already in use",4:"Address not available",5:"Address family not supported by protocol family",6:"No more processes",7:"Socket already connected",8:"Bad file number",9:"Trying to read unreadable message",10:"Mount device busy",11:"Operation canceled",12:"No children",13:"Connection aborted",14:"Connection refused",15:"Connection reset by peer",16:"File locking deadlock error",17:"Destination address required",18:"Math arg out of domain of func",19:"Quota exceeded",20:"File exists",21:"Bad address",22:"File too large",23:"Host is unreachable",24:"Identifier removed",25:"Illegal byte sequence",26:"Connection already in progress",27:"Interrupted system call",28:"Invalid argument",29:"I/O error",30:"Socket is already connected",31:"Is a directory",32:"Too many symbolic links",33:"Too many open files",34:"Too many links",35:"Message too long",36:"Multihop attempted",37:"File or path name too long",38:"Network interface is not configured",39:"Connection reset by network",40:"Network is unreachable",41:"Too many open files in system",42:"No buffer space available",43:"No such device",44:"No such file or directory",45:"Exec format error",46:"No record locks available",47:"The link has been severed",48:"Not enough core",49:"No message of desired type",50:"Protocol not available",51:"No space left on device",52:"Function not implemented",53:"Socket is not connected",54:"Not a directory",55:"Directory not empty",56:"State not recoverable",57:"Socket operation on non-socket",59:"Not a typewriter",60:"No such device or address",61:"Value too large for defined data type",62:"Previous owner died",63:"Not super-user",64:"Broken pipe",65:"Protocol error",66:"Unknown protocol",67:"Protocol wrong type for socket",68:"Math result not representable",69:"Read only file system",70:"Illegal seek",71:"No such process",72:"Stale file handle",73:"Connection timed out",74:"Text file busy",75:"Cross-device link",100:"Device not a stream",101:"Bad font file fmt",102:"Invalid slot",103:"Invalid request code",104:"No anode",105:"Block device required",106:"Channel number out of range",107:"Level 3 halted",108:"Level 3 reset",109:"Link number out of range",110:"Protocol driver not attached",111:"No CSI structure available",112:"Level 2 halted",113:"Invalid exchange",114:"Invalid request descriptor",115:"Exchange full",116:"No data (for no delay io)",117:"Timer expired",118:"Out of streams resources",119:"Machine is not on the network",120:"Package not installed",121:"The object is remote",122:"Advertise error",123:"Srmount error",124:"Communication error on send",125:"Cross mount point (not really error)",126:"Given log. name not unique",127:"f.d. invalid for this operation",128:"Remote address changed",129:"Can   access a needed shared lib",130:"Accessing a corrupted shared lib",131:".lib section in a.out corrupted",132:"Attempting to link in too many libs",133:"Attempting to exec a shared library",135:"Streams pipe error",136:"Too many users",137:"Socket type not supported",138:"Not supported",139:"Protocol family not supported",140:"Can't send after socket shutdown",141:"Too many references",142:"Host is down",148:"No medium (in tape drive)",156:"Level 2 not synchronized"};
  
  var ERRNO_CODES={EPERM:63,ENOENT:44,ESRCH:71,EINTR:27,EIO:29,ENXIO:60,E2BIG:1,ENOEXEC:45,EBADF:8,ECHILD:12,EAGAIN:6,EWOULDBLOCK:6,ENOMEM:48,EACCES:2,EFAULT:21,ENOTBLK:105,EBUSY:10,EEXIST:20,EXDEV:75,ENODEV:43,ENOTDIR:54,EISDIR:31,EINVAL:28,ENFILE:41,EMFILE:33,ENOTTY:59,ETXTBSY:74,EFBIG:22,ENOSPC:51,ESPIPE:70,EROFS:69,EMLINK:34,EPIPE:64,EDOM:18,ERANGE:68,ENOMSG:49,EIDRM:24,ECHRNG:106,EL2NSYNC:156,EL3HLT:107,EL3RST:108,ELNRNG:109,EUNATCH:110,ENOCSI:111,EL2HLT:112,EDEADLK:16,ENOLCK:46,EBADE:113,EBADR:114,EXFULL:115,ENOANO:104,EBADRQC:103,EBADSLT:102,EDEADLOCK:16,EBFONT:101,ENOSTR:100,ENODATA:116,ETIME:117,ENOSR:118,ENONET:119,ENOPKG:120,EREMOTE:121,ENOLINK:47,EADV:122,ESRMNT:123,ECOMM:124,EPROTO:65,EMULTIHOP:36,EDOTDOT:125,EBADMSG:9,ENOTUNIQ:126,EBADFD:127,EREMCHG:128,ELIBACC:129,ELIBBAD:130,ELIBSCN:131,ELIBMAX:132,ELIBEXEC:133,ENOSYS:52,ENOTEMPTY:55,ENAMETOOLONG:37,ELOOP:32,EOPNOTSUPP:138,EPFNOSUPPORT:139,ECONNRESET:15,ENOBUFS:42,EAFNOSUPPORT:5,EPROTOTYPE:67,ENOTSOCK:57,ENOPROTOOPT:50,ESHUTDOWN:140,ECONNREFUSED:14,EADDRINUSE:3,ECONNABORTED:13,ENETUNREACH:40,ENETDOWN:38,ETIMEDOUT:73,EHOSTDOWN:142,EHOSTUNREACH:23,EINPROGRESS:26,EALREADY:7,EDESTADDRREQ:17,EMSGSIZE:35,EPROTONOSUPPORT:66,ESOCKTNOSUPPORT:137,EADDRNOTAVAIL:4,ENETRESET:39,EISCONN:30,ENOTCONN:53,ETOOMANYREFS:141,EUSERS:136,EDQUOT:19,ESTALE:72,ENOTSUP:138,ENOMEDIUM:148,EILSEQ:25,EOVERFLOW:61,ECANCELED:11,ENOTRECOVERABLE:56,EOWNERDEAD:62,ESTRPIPE:135};var FS={root:null,mounts:[],devices:{},streams:[],nextInode:1,nameTable:null,currentPath:"/",initialized:false,ignorePermissions:true,trackingDelegate:{},tracking:{openFlags:{READ:1,WRITE:2}},ErrnoError:null,genericErrors:{},filesystems:null,syncFSRequests:0,handleFSError:function(e) {
        if (!(e instanceof FS.ErrnoError)) throw e + ' : ' + stackTrace();
        return ___setErrNo(e.errno);
      },lookupPath:function(path, opts) {
        path = PATH_FS.resolve(FS.cwd(), path);
        opts = opts || {};
  
        if (!path) return { path: '', node: null };
  
        var defaults = {
          follow_mount: true,
          recurse_count: 0
        };
        for (var key in defaults) {
          if (opts[key] === undefined) {
            opts[key] = defaults[key];
          }
        }
  
        if (opts.recurse_count > 8) {  // max recursive lookup of 8
          throw new FS.ErrnoError(32);
        }
  
        // split the path
        var parts = PATH.normalizeArray(path.split('/').filter(function(p) {
          return !!p;
        }), false);
  
        // start at the root
        var current = FS.root;
        var current_path = '/';
  
        for (var i = 0; i < parts.length; i++) {
          var islast = (i === parts.length-1);
          if (islast && opts.parent) {
            // stop resolving
            break;
          }
  
          current = FS.lookupNode(current, parts[i]);
          current_path = PATH.join2(current_path, parts[i]);
  
          // jump to the mount's root node if this is a mountpoint
          if (FS.isMountpoint(current)) {
            if (!islast || (islast && opts.follow_mount)) {
              current = current.mounted.root;
            }
          }
  
          // by default, lookupPath will not follow a symlink if it is the final path component.
          // setting opts.follow = true will override this behavior.
          if (!islast || opts.follow) {
            var count = 0;
            while (FS.isLink(current.mode)) {
              var link = FS.readlink(current_path);
              current_path = PATH_FS.resolve(PATH.dirname(current_path), link);
  
              var lookup = FS.lookupPath(current_path, { recurse_count: opts.recurse_count });
              current = lookup.node;
  
              if (count++ > 40) {  // limit max consecutive symlinks to 40 (SYMLOOP_MAX).
                throw new FS.ErrnoError(32);
              }
            }
          }
        }
  
        return { path: current_path, node: current };
      },getPath:function(node) {
        var path;
        while (true) {
          if (FS.isRoot(node)) {
            var mount = node.mount.mountpoint;
            if (!path) return mount;
            return mount[mount.length-1] !== '/' ? mount + '/' + path : mount + path;
          }
          path = path ? node.name + '/' + path : node.name;
          node = node.parent;
        }
      },hashName:function(parentid, name) {
        var hash = 0;
  
  
        for (var i = 0; i < name.length; i++) {
          hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
        }
        return ((parentid + hash) >>> 0) % FS.nameTable.length;
      },hashAddNode:function(node) {
        var hash = FS.hashName(node.parent.id, node.name);
        node.name_next = FS.nameTable[hash];
        FS.nameTable[hash] = node;
      },hashRemoveNode:function(node) {
        var hash = FS.hashName(node.parent.id, node.name);
        if (FS.nameTable[hash] === node) {
          FS.nameTable[hash] = node.name_next;
        } else {
          var current = FS.nameTable[hash];
          while (current) {
            if (current.name_next === node) {
              current.name_next = node.name_next;
              break;
            }
            current = current.name_next;
          }
        }
      },lookupNode:function(parent, name) {
        var err = FS.mayLookup(parent);
        if (err) {
          throw new FS.ErrnoError(err, parent);
        }
        var hash = FS.hashName(parent.id, name);
        for (var node = FS.nameTable[hash]; node; node = node.name_next) {
          var nodeName = node.name;
          if (node.parent.id === parent.id && nodeName === name) {
            return node;
          }
        }
        // if we failed to find it in the cache, call into the VFS
        return FS.lookup(parent, name);
      },createNode:function(parent, name, mode, rdev) {
        if (!FS.FSNode) {
          FS.FSNode = function(parent, name, mode, rdev) {
            if (!parent) {
              parent = this;  // root node sets parent to itself
            }
            this.parent = parent;
            this.mount = parent.mount;
            this.mounted = null;
            this.id = FS.nextInode++;
            this.name = name;
            this.mode = mode;
            this.node_ops = {};
            this.stream_ops = {};
            this.rdev = rdev;
          };
  
          FS.FSNode.prototype = {};
  
          // compatibility
          var readMode = 292 | 73;
          var writeMode = 146;
  
          // NOTE we must use Object.defineProperties instead of individual calls to
          // Object.defineProperty in order to make closure compiler happy
          Object.defineProperties(FS.FSNode.prototype, {
            read: {
              get: function() { return (this.mode & readMode) === readMode; },
              set: function(val) { val ? this.mode |= readMode : this.mode &= ~readMode; }
            },
            write: {
              get: function() { return (this.mode & writeMode) === writeMode; },
              set: function(val) { val ? this.mode |= writeMode : this.mode &= ~writeMode; }
            },
            isFolder: {
              get: function() { return FS.isDir(this.mode); }
            },
            isDevice: {
              get: function() { return FS.isChrdev(this.mode); }
            }
          });
        }
  
        var node = new FS.FSNode(parent, name, mode, rdev);
  
        FS.hashAddNode(node);
  
        return node;
      },destroyNode:function(node) {
        FS.hashRemoveNode(node);
      },isRoot:function(node) {
        return node === node.parent;
      },isMountpoint:function(node) {
        return !!node.mounted;
      },isFile:function(mode) {
        return (mode & 61440) === 32768;
      },isDir:function(mode) {
        return (mode & 61440) === 16384;
      },isLink:function(mode) {
        return (mode & 61440) === 40960;
      },isChrdev:function(mode) {
        return (mode & 61440) === 8192;
      },isBlkdev:function(mode) {
        return (mode & 61440) === 24576;
      },isFIFO:function(mode) {
        return (mode & 61440) === 4096;
      },isSocket:function(mode) {
        return (mode & 49152) === 49152;
      },flagModes:{"r":0,"rs":1052672,"r+":2,"w":577,"wx":705,"xw":705,"w+":578,"wx+":706,"xw+":706,"a":1089,"ax":1217,"xa":1217,"a+":1090,"ax+":1218,"xa+":1218},modeStringToFlags:function(str) {
        var flags = FS.flagModes[str];
        if (typeof flags === 'undefined') {
          throw new Error('Unknown file open mode: ' + str);
        }
        return flags;
      },flagsToPermissionString:function(flag) {
        var perms = ['r', 'w', 'rw'][flag & 3];
        if ((flag & 512)) {
          perms += 'w';
        }
        return perms;
      },nodePermissions:function(node, perms) {
        if (FS.ignorePermissions) {
          return 0;
        }
        // return 0 if any user, group or owner bits are set.
        if (perms.indexOf('r') !== -1 && !(node.mode & 292)) {
          return 2;
        } else if (perms.indexOf('w') !== -1 && !(node.mode & 146)) {
          return 2;
        } else if (perms.indexOf('x') !== -1 && !(node.mode & 73)) {
          return 2;
        }
        return 0;
      },mayLookup:function(dir) {
        var err = FS.nodePermissions(dir, 'x');
        if (err) return err;
        if (!dir.node_ops.lookup) return 2;
        return 0;
      },mayCreate:function(dir, name) {
        try {
          var node = FS.lookupNode(dir, name);
          return 20;
        } catch (e) {
        }
        return FS.nodePermissions(dir, 'wx');
      },mayDelete:function(dir, name, isdir) {
        var node;
        try {
          node = FS.lookupNode(dir, name);
        } catch (e) {
          return e.errno;
        }
        var err = FS.nodePermissions(dir, 'wx');
        if (err) {
          return err;
        }
        if (isdir) {
          if (!FS.isDir(node.mode)) {
            return 54;
          }
          if (FS.isRoot(node) || FS.getPath(node) === FS.cwd()) {
            return 10;
          }
        } else {
          if (FS.isDir(node.mode)) {
            return 31;
          }
        }
        return 0;
      },mayOpen:function(node, flags) {
        if (!node) {
          return 44;
        }
        if (FS.isLink(node.mode)) {
          return 32;
        } else if (FS.isDir(node.mode)) {
          if (FS.flagsToPermissionString(flags) !== 'r' || // opening for write
              (flags & 512)) { // TODO: check for O_SEARCH? (== search for dir only)
            return 31;
          }
        }
        return FS.nodePermissions(node, FS.flagsToPermissionString(flags));
      },MAX_OPEN_FDS:4096,nextfd:function(fd_start, fd_end) {
        fd_start = fd_start || 0;
        fd_end = fd_end || FS.MAX_OPEN_FDS;
        for (var fd = fd_start; fd <= fd_end; fd++) {
          if (!FS.streams[fd]) {
            return fd;
          }
        }
        throw new FS.ErrnoError(33);
      },getStream:function(fd) {
        return FS.streams[fd];
      },createStream:function(stream, fd_start, fd_end) {
        if (!FS.FSStream) {
          FS.FSStream = function(){};
          FS.FSStream.prototype = {};
          // compatibility
          Object.defineProperties(FS.FSStream.prototype, {
            object: {
              get: function() { return this.node; },
              set: function(val) { this.node = val; }
            },
            isRead: {
              get: function() { return (this.flags & 2097155) !== 1; }
            },
            isWrite: {
              get: function() { return (this.flags & 2097155) !== 0; }
            },
            isAppend: {
              get: function() { return (this.flags & 1024); }
            }
          });
        }
        // clone it, so we can return an instance of FSStream
        var newStream = new FS.FSStream();
        for (var p in stream) {
          newStream[p] = stream[p];
        }
        stream = newStream;
        var fd = FS.nextfd(fd_start, fd_end);
        stream.fd = fd;
        FS.streams[fd] = stream;
        return stream;
      },closeStream:function(fd) {
        FS.streams[fd] = null;
      },chrdev_stream_ops:{open:function(stream) {
          var device = FS.getDevice(stream.node.rdev);
          // override node's stream ops with the device's
          stream.stream_ops = device.stream_ops;
          // forward the open call
          if (stream.stream_ops.open) {
            stream.stream_ops.open(stream);
          }
        },llseek:function() {
          throw new FS.ErrnoError(70);
        }},major:function(dev) {
        return ((dev) >> 8);
      },minor:function(dev) {
        return ((dev) & 0xff);
      },makedev:function(ma, mi) {
        return ((ma) << 8 | (mi));
      },registerDevice:function(dev, ops) {
        FS.devices[dev] = { stream_ops: ops };
      },getDevice:function(dev) {
        return FS.devices[dev];
      },getMounts:function(mount) {
        var mounts = [];
        var check = [mount];
  
        while (check.length) {
          var m = check.pop();
  
          mounts.push(m);
  
          check.push.apply(check, m.mounts);
        }
  
        return mounts;
      },syncfs:function(populate, callback) {
        if (typeof(populate) === 'function') {
          callback = populate;
          populate = false;
        }
  
        FS.syncFSRequests++;
  
        if (FS.syncFSRequests > 1) {
          console.log('warning: ' + FS.syncFSRequests + ' FS.syncfs operations in flight at once, probably just doing extra work');
        }
  
        var mounts = FS.getMounts(FS.root.mount);
        var completed = 0;
  
        function doCallback(err) {
          assert(FS.syncFSRequests > 0);
          FS.syncFSRequests--;
          return callback(err);
        }
  
        function done(err) {
          if (err) {
            if (!done.errored) {
              done.errored = true;
              return doCallback(err);
            }
            return;
          }
          if (++completed >= mounts.length) {
            doCallback(null);
          }
        };
  
        // sync all mounts
        mounts.forEach(function (mount) {
          if (!mount.type.syncfs) {
            return done(null);
          }
          mount.type.syncfs(mount, populate, done);
        });
      },mount:function(type, opts, mountpoint) {
        if (typeof type === 'string') {
          // The filesystem was not included, and instead we have an error
          // message stored in the variable.
          throw type;
        }
        var root = mountpoint === '/';
        var pseudo = !mountpoint;
        var node;
  
        if (root && FS.root) {
          throw new FS.ErrnoError(10);
        } else if (!root && !pseudo) {
          var lookup = FS.lookupPath(mountpoint, { follow_mount: false });
  
          mountpoint = lookup.path;  // use the absolute path
          node = lookup.node;
  
          if (FS.isMountpoint(node)) {
            throw new FS.ErrnoError(10);
          }
  
          if (!FS.isDir(node.mode)) {
            throw new FS.ErrnoError(54);
          }
        }
  
        var mount = {
          type: type,
          opts: opts,
          mountpoint: mountpoint,
          mounts: []
        };
  
        // create a root node for the fs
        var mountRoot = type.mount(mount);
        mountRoot.mount = mount;
        mount.root = mountRoot;
  
        if (root) {
          FS.root = mountRoot;
        } else if (node) {
          // set as a mountpoint
          node.mounted = mount;
  
          // add the new mount to the current mount's children
          if (node.mount) {
            node.mount.mounts.push(mount);
          }
        }
  
        return mountRoot;
      },unmount:function (mountpoint) {
        var lookup = FS.lookupPath(mountpoint, { follow_mount: false });
  
        if (!FS.isMountpoint(lookup.node)) {
          throw new FS.ErrnoError(28);
        }
  
        // destroy the nodes for this mount, and all its child mounts
        var node = lookup.node;
        var mount = node.mounted;
        var mounts = FS.getMounts(mount);
  
        Object.keys(FS.nameTable).forEach(function (hash) {
          var current = FS.nameTable[hash];
  
          while (current) {
            var next = current.name_next;
  
            if (mounts.indexOf(current.mount) !== -1) {
              FS.destroyNode(current);
            }
  
            current = next;
          }
        });
  
        // no longer a mountpoint
        node.mounted = null;
  
        // remove this mount from the child mounts
        var idx = node.mount.mounts.indexOf(mount);
        assert(idx !== -1);
        node.mount.mounts.splice(idx, 1);
      },lookup:function(parent, name) {
        return parent.node_ops.lookup(parent, name);
      },mknod:function(path, mode, dev) {
        var lookup = FS.lookupPath(path, { parent: true });
        var parent = lookup.node;
        var name = PATH.basename(path);
        if (!name || name === '.' || name === '..') {
          throw new FS.ErrnoError(28);
        }
        var err = FS.mayCreate(parent, name);
        if (err) {
          throw new FS.ErrnoError(err);
        }
        if (!parent.node_ops.mknod) {
          throw new FS.ErrnoError(63);
        }
        return parent.node_ops.mknod(parent, name, mode, dev);
      },create:function(path, mode) {
        mode = mode !== undefined ? mode : 438 /* 0666 */;
        mode &= 4095;
        mode |= 32768;
        return FS.mknod(path, mode, 0);
      },mkdir:function(path, mode) {
        mode = mode !== undefined ? mode : 511 /* 0777 */;
        mode &= 511 | 512;
        mode |= 16384;
        return FS.mknod(path, mode, 0);
      },mkdirTree:function(path, mode) {
        var dirs = path.split('/');
        var d = '';
        for (var i = 0; i < dirs.length; ++i) {
          if (!dirs[i]) continue;
          d += '/' + dirs[i];
          try {
            FS.mkdir(d, mode);
          } catch(e) {
            if (e.errno != 20) throw e;
          }
        }
      },mkdev:function(path, mode, dev) {
        if (typeof(dev) === 'undefined') {
          dev = mode;
          mode = 438 /* 0666 */;
        }
        mode |= 8192;
        return FS.mknod(path, mode, dev);
      },symlink:function(oldpath, newpath) {
        if (!PATH_FS.resolve(oldpath)) {
          throw new FS.ErrnoError(44);
        }
        var lookup = FS.lookupPath(newpath, { parent: true });
        var parent = lookup.node;
        if (!parent) {
          throw new FS.ErrnoError(44);
        }
        var newname = PATH.basename(newpath);
        var err = FS.mayCreate(parent, newname);
        if (err) {
          throw new FS.ErrnoError(err);
        }
        if (!parent.node_ops.symlink) {
          throw new FS.ErrnoError(63);
        }
        return parent.node_ops.symlink(parent, newname, oldpath);
      },rename:function(old_path, new_path) {
        var old_dirname = PATH.dirname(old_path);
        var new_dirname = PATH.dirname(new_path);
        var old_name = PATH.basename(old_path);
        var new_name = PATH.basename(new_path);
        // parents must exist
        var lookup, old_dir, new_dir;
        try {
          lookup = FS.lookupPath(old_path, { parent: true });
          old_dir = lookup.node;
          lookup = FS.lookupPath(new_path, { parent: true });
          new_dir = lookup.node;
        } catch (e) {
          throw new FS.ErrnoError(10);
        }
        if (!old_dir || !new_dir) throw new FS.ErrnoError(44);
        // need to be part of the same mount
        if (old_dir.mount !== new_dir.mount) {
          throw new FS.ErrnoError(75);
        }
        // source must exist
        var old_node = FS.lookupNode(old_dir, old_name);
        // old path should not be an ancestor of the new path
        var relative = PATH_FS.relative(old_path, new_dirname);
        if (relative.charAt(0) !== '.') {
          throw new FS.ErrnoError(28);
        }
        // new path should not be an ancestor of the old path
        relative = PATH_FS.relative(new_path, old_dirname);
        if (relative.charAt(0) !== '.') {
          throw new FS.ErrnoError(55);
        }
        // see if the new path already exists
        var new_node;
        try {
          new_node = FS.lookupNode(new_dir, new_name);
        } catch (e) {
          // not fatal
        }
        // early out if nothing needs to change
        if (old_node === new_node) {
          return;
        }
        // we'll need to delete the old entry
        var isdir = FS.isDir(old_node.mode);
        var err = FS.mayDelete(old_dir, old_name, isdir);
        if (err) {
          throw new FS.ErrnoError(err);
        }
        // need delete permissions if we'll be overwriting.
        // need create permissions if new doesn't already exist.
        err = new_node ?
          FS.mayDelete(new_dir, new_name, isdir) :
          FS.mayCreate(new_dir, new_name);
        if (err) {
          throw new FS.ErrnoError(err);
        }
        if (!old_dir.node_ops.rename) {
          throw new FS.ErrnoError(63);
        }
        if (FS.isMountpoint(old_node) || (new_node && FS.isMountpoint(new_node))) {
          throw new FS.ErrnoError(10);
        }
        // if we are going to change the parent, check write permissions
        if (new_dir !== old_dir) {
          err = FS.nodePermissions(old_dir, 'w');
          if (err) {
            throw new FS.ErrnoError(err);
          }
        }
        try {
          if (FS.trackingDelegate['willMovePath']) {
            FS.trackingDelegate['willMovePath'](old_path, new_path);
          }
        } catch(e) {
          console.log("FS.trackingDelegate['willMovePath']('"+old_path+"', '"+new_path+"') threw an exception: " + e.message);
        }
        // remove the node from the lookup hash
        FS.hashRemoveNode(old_node);
        // do the underlying fs rename
        try {
          old_dir.node_ops.rename(old_node, new_dir, new_name);
        } catch (e) {
          throw e;
        } finally {
          // add the node back to the hash (in case node_ops.rename
          // changed its name)
          FS.hashAddNode(old_node);
        }
        try {
          if (FS.trackingDelegate['onMovePath']) FS.trackingDelegate['onMovePath'](old_path, new_path);
        } catch(e) {
          console.log("FS.trackingDelegate['onMovePath']('"+old_path+"', '"+new_path+"') threw an exception: " + e.message);
        }
      },rmdir:function(path) {
        var lookup = FS.lookupPath(path, { parent: true });
        var parent = lookup.node;
        var name = PATH.basename(path);
        var node = FS.lookupNode(parent, name);
        var err = FS.mayDelete(parent, name, true);
        if (err) {
          throw new FS.ErrnoError(err);
        }
        if (!parent.node_ops.rmdir) {
          throw new FS.ErrnoError(63);
        }
        if (FS.isMountpoint(node)) {
          throw new FS.ErrnoError(10);
        }
        try {
          if (FS.trackingDelegate['willDeletePath']) {
            FS.trackingDelegate['willDeletePath'](path);
          }
        } catch(e) {
          console.log("FS.trackingDelegate['willDeletePath']('"+path+"') threw an exception: " + e.message);
        }
        parent.node_ops.rmdir(parent, name);
        FS.destroyNode(node);
        try {
          if (FS.trackingDelegate['onDeletePath']) FS.trackingDelegate['onDeletePath'](path);
        } catch(e) {
          console.log("FS.trackingDelegate['onDeletePath']('"+path+"') threw an exception: " + e.message);
        }
      },readdir:function(path) {
        var lookup = FS.lookupPath(path, { follow: true });
        var node = lookup.node;
        if (!node.node_ops.readdir) {
          throw new FS.ErrnoError(54);
        }
        return node.node_ops.readdir(node);
      },unlink:function(path) {
        var lookup = FS.lookupPath(path, { parent: true });
        var parent = lookup.node;
        var name = PATH.basename(path);
        var node = FS.lookupNode(parent, name);
        var err = FS.mayDelete(parent, name, false);
        if (err) {
          // According to POSIX, we should map EISDIR to EPERM, but
          // we instead do what Linux does (and we must, as we use
          // the musl linux libc).
          throw new FS.ErrnoError(err);
        }
        if (!parent.node_ops.unlink) {
          throw new FS.ErrnoError(63);
        }
        if (FS.isMountpoint(node)) {
          throw new FS.ErrnoError(10);
        }
        try {
          if (FS.trackingDelegate['willDeletePath']) {
            FS.trackingDelegate['willDeletePath'](path);
          }
        } catch(e) {
          console.log("FS.trackingDelegate['willDeletePath']('"+path+"') threw an exception: " + e.message);
        }
        parent.node_ops.unlink(parent, name);
        FS.destroyNode(node);
        try {
          if (FS.trackingDelegate['onDeletePath']) FS.trackingDelegate['onDeletePath'](path);
        } catch(e) {
          console.log("FS.trackingDelegate['onDeletePath']('"+path+"') threw an exception: " + e.message);
        }
      },readlink:function(path) {
        var lookup = FS.lookupPath(path);
        var link = lookup.node;
        if (!link) {
          throw new FS.ErrnoError(44);
        }
        if (!link.node_ops.readlink) {
          throw new FS.ErrnoError(28);
        }
        return PATH_FS.resolve(FS.getPath(link.parent), link.node_ops.readlink(link));
      },stat:function(path, dontFollow) {
        var lookup = FS.lookupPath(path, { follow: !dontFollow });
        var node = lookup.node;
        if (!node) {
          throw new FS.ErrnoError(44);
        }
        if (!node.node_ops.getattr) {
          throw new FS.ErrnoError(63);
        }
        return node.node_ops.getattr(node);
      },lstat:function(path) {
        return FS.stat(path, true);
      },chmod:function(path, mode, dontFollow) {
        var node;
        if (typeof path === 'string') {
          var lookup = FS.lookupPath(path, { follow: !dontFollow });
          node = lookup.node;
        } else {
          node = path;
        }
        if (!node.node_ops.setattr) {
          throw new FS.ErrnoError(63);
        }
        node.node_ops.setattr(node, {
          mode: (mode & 4095) | (node.mode & ~4095),
          timestamp: Date.now()
        });
      },lchmod:function(path, mode) {
        FS.chmod(path, mode, true);
      },fchmod:function(fd, mode) {
        var stream = FS.getStream(fd);
        if (!stream) {
          throw new FS.ErrnoError(8);
        }
        FS.chmod(stream.node, mode);
      },chown:function(path, uid, gid, dontFollow) {
        var node;
        if (typeof path === 'string') {
          var lookup = FS.lookupPath(path, { follow: !dontFollow });
          node = lookup.node;
        } else {
          node = path;
        }
        if (!node.node_ops.setattr) {
          throw new FS.ErrnoError(63);
        }
        node.node_ops.setattr(node, {
          timestamp: Date.now()
          // we ignore the uid / gid for now
        });
      },lchown:function(path, uid, gid) {
        FS.chown(path, uid, gid, true);
      },fchown:function(fd, uid, gid) {
        var stream = FS.getStream(fd);
        if (!stream) {
          throw new FS.ErrnoError(8);
        }
        FS.chown(stream.node, uid, gid);
      },truncate:function(path, len) {
        if (len < 0) {
          throw new FS.ErrnoError(28);
        }
        var node;
        if (typeof path === 'string') {
          var lookup = FS.lookupPath(path, { follow: true });
          node = lookup.node;
        } else {
          node = path;
        }
        if (!node.node_ops.setattr) {
          throw new FS.ErrnoError(63);
        }
        if (FS.isDir(node.mode)) {
          throw new FS.ErrnoError(31);
        }
        if (!FS.isFile(node.mode)) {
          throw new FS.ErrnoError(28);
        }
        var err = FS.nodePermissions(node, 'w');
        if (err) {
          throw new FS.ErrnoError(err);
        }
        node.node_ops.setattr(node, {
          size: len,
          timestamp: Date.now()
        });
      },ftruncate:function(fd, len) {
        var stream = FS.getStream(fd);
        if (!stream) {
          throw new FS.ErrnoError(8);
        }
        if ((stream.flags & 2097155) === 0) {
          throw new FS.ErrnoError(28);
        }
        FS.truncate(stream.node, len);
      },utime:function(path, atime, mtime) {
        var lookup = FS.lookupPath(path, { follow: true });
        var node = lookup.node;
        node.node_ops.setattr(node, {
          timestamp: Math.max(atime, mtime)
        });
      },open:function(path, flags, mode, fd_start, fd_end) {
        if (path === "") {
          throw new FS.ErrnoError(44);
        }
        flags = typeof flags === 'string' ? FS.modeStringToFlags(flags) : flags;
        mode = typeof mode === 'undefined' ? 438 /* 0666 */ : mode;
        if ((flags & 64)) {
          mode = (mode & 4095) | 32768;
        } else {
          mode = 0;
        }
        var node;
        if (typeof path === 'object') {
          node = path;
        } else {
          path = PATH.normalize(path);
          try {
            var lookup = FS.lookupPath(path, {
              follow: !(flags & 131072)
            });
            node = lookup.node;
          } catch (e) {
            // ignore
          }
        }
        // perhaps we need to create the node
        var created = false;
        if ((flags & 64)) {
          if (node) {
            // if O_CREAT and O_EXCL are set, error out if the node already exists
            if ((flags & 128)) {
              throw new FS.ErrnoError(20);
            }
          } else {
            // node doesn't exist, try to create it
            node = FS.mknod(path, mode, 0);
            created = true;
          }
        }
        if (!node) {
          throw new FS.ErrnoError(44);
        }
        // can't truncate a device
        if (FS.isChrdev(node.mode)) {
          flags &= ~512;
        }
        // if asked only for a directory, then this must be one
        if ((flags & 65536) && !FS.isDir(node.mode)) {
          throw new FS.ErrnoError(54);
        }
        // check permissions, if this is not a file we just created now (it is ok to
        // create and write to a file with read-only permissions; it is read-only
        // for later use)
        if (!created) {
          var err = FS.mayOpen(node, flags);
          if (err) {
            throw new FS.ErrnoError(err);
          }
        }
        // do truncation if necessary
        if ((flags & 512)) {
          FS.truncate(node, 0);
        }
        // we've already handled these, don't pass down to the underlying vfs
        flags &= ~(128 | 512);
  
        // register the stream with the filesystem
        var stream = FS.createStream({
          node: node,
          path: FS.getPath(node),  // we want the absolute path to the node
          flags: flags,
          seekable: true,
          position: 0,
          stream_ops: node.stream_ops,
          // used by the file family libc calls (fopen, fwrite, ferror, etc.)
          ungotten: [],
          error: false
        }, fd_start, fd_end);
        // call the new stream's open function
        if (stream.stream_ops.open) {
          stream.stream_ops.open(stream);
        }
        if (Module['logReadFiles'] && !(flags & 1)) {
          if (!FS.readFiles) FS.readFiles = {};
          if (!(path in FS.readFiles)) {
            FS.readFiles[path] = 1;
            console.log("FS.trackingDelegate error on read file: " + path);
          }
        }
        try {
          if (FS.trackingDelegate['onOpenFile']) {
            var trackingFlags = 0;
            if ((flags & 2097155) !== 1) {
              trackingFlags |= FS.tracking.openFlags.READ;
            }
            if ((flags & 2097155) !== 0) {
              trackingFlags |= FS.tracking.openFlags.WRITE;
            }
            FS.trackingDelegate['onOpenFile'](path, trackingFlags);
          }
        } catch(e) {
          console.log("FS.trackingDelegate['onOpenFile']('"+path+"', flags) threw an exception: " + e.message);
        }
        return stream;
      },close:function(stream) {
        if (FS.isClosed(stream)) {
          throw new FS.ErrnoError(8);
        }
        if (stream.getdents) stream.getdents = null; // free readdir state
        try {
          if (stream.stream_ops.close) {
            stream.stream_ops.close(stream);
          }
        } catch (e) {
          throw e;
        } finally {
          FS.closeStream(stream.fd);
        }
        stream.fd = null;
      },isClosed:function(stream) {
        return stream.fd === null;
      },llseek:function(stream, offset, whence) {
        if (FS.isClosed(stream)) {
          throw new FS.ErrnoError(8);
        }
        if (!stream.seekable || !stream.stream_ops.llseek) {
          throw new FS.ErrnoError(70);
        }
        if (whence != 0 && whence != 1 && whence != 2) {
          throw new FS.ErrnoError(28);
        }
        stream.position = stream.stream_ops.llseek(stream, offset, whence);
        stream.ungotten = [];
        return stream.position;
      },read:function(stream, buffer, offset, length, position) {
        if (length < 0 || position < 0) {
          throw new FS.ErrnoError(28);
        }
        if (FS.isClosed(stream)) {
          throw new FS.ErrnoError(8);
        }
        if ((stream.flags & 2097155) === 1) {
          throw new FS.ErrnoError(8);
        }
        if (FS.isDir(stream.node.mode)) {
          throw new FS.ErrnoError(31);
        }
        if (!stream.stream_ops.read) {
          throw new FS.ErrnoError(28);
        }
        var seeking = typeof position !== 'undefined';
        if (!seeking) {
          position = stream.position;
        } else if (!stream.seekable) {
          throw new FS.ErrnoError(70);
        }
        var bytesRead = stream.stream_ops.read(stream, buffer, offset, length, position);
        if (!seeking) stream.position += bytesRead;
        return bytesRead;
      },write:function(stream, buffer, offset, length, position, canOwn) {
        if (length < 0 || position < 0) {
          throw new FS.ErrnoError(28);
        }
        if (FS.isClosed(stream)) {
          throw new FS.ErrnoError(8);
        }
        if ((stream.flags & 2097155) === 0) {
          throw new FS.ErrnoError(8);
        }
        if (FS.isDir(stream.node.mode)) {
          throw new FS.ErrnoError(31);
        }
        if (!stream.stream_ops.write) {
          throw new FS.ErrnoError(28);
        }
        if (stream.flags & 1024) {
          // seek to the end before writing in append mode
          FS.llseek(stream, 0, 2);
        }
        var seeking = typeof position !== 'undefined';
        if (!seeking) {
          position = stream.position;
        } else if (!stream.seekable) {
          throw new FS.ErrnoError(70);
        }
        var bytesWritten = stream.stream_ops.write(stream, buffer, offset, length, position, canOwn);
        if (!seeking) stream.position += bytesWritten;
        try {
          if (stream.path && FS.trackingDelegate['onWriteToFile']) FS.trackingDelegate['onWriteToFile'](stream.path);
        } catch(e) {
          console.log("FS.trackingDelegate['onWriteToFile']('"+stream.path+"') threw an exception: " + e.message);
        }
        return bytesWritten;
      },allocate:function(stream, offset, length) {
        if (FS.isClosed(stream)) {
          throw new FS.ErrnoError(8);
        }
        if (offset < 0 || length <= 0) {
          throw new FS.ErrnoError(28);
        }
        if ((stream.flags & 2097155) === 0) {
          throw new FS.ErrnoError(8);
        }
        if (!FS.isFile(stream.node.mode) && !FS.isDir(stream.node.mode)) {
          throw new FS.ErrnoError(43);
        }
        if (!stream.stream_ops.allocate) {
          throw new FS.ErrnoError(138);
        }
        stream.stream_ops.allocate(stream, offset, length);
      },mmap:function(stream, buffer, offset, length, position, prot, flags) {
        // User requests writing to file (prot & PROT_WRITE != 0).
        // Checking if we have permissions to write to the file unless
        // MAP_PRIVATE flag is set. According to POSIX spec it is possible
        // to write to file opened in read-only mode with MAP_PRIVATE flag,
        // as all modifications will be visible only in the memory of
        // the current process.
        if ((prot & 2) !== 0
            && (flags & 2) === 0
            && (stream.flags & 2097155) !== 2) {
          throw new FS.ErrnoError(2);
        }
        if ((stream.flags & 2097155) === 1) {
          throw new FS.ErrnoError(2);
        }
        if (!stream.stream_ops.mmap) {
          throw new FS.ErrnoError(43);
        }
        return stream.stream_ops.mmap(stream, buffer, offset, length, position, prot, flags);
      },msync:function(stream, buffer, offset, length, mmapFlags) {
        if (!stream || !stream.stream_ops.msync) {
          return 0;
        }
        return stream.stream_ops.msync(stream, buffer, offset, length, mmapFlags);
      },munmap:function(stream) {
        return 0;
      },ioctl:function(stream, cmd, arg) {
        if (!stream.stream_ops.ioctl) {
          throw new FS.ErrnoError(59);
        }
        return stream.stream_ops.ioctl(stream, cmd, arg);
      },readFile:function(path, opts) {
        opts = opts || {};
        opts.flags = opts.flags || 'r';
        opts.encoding = opts.encoding || 'binary';
        if (opts.encoding !== 'utf8' && opts.encoding !== 'binary') {
          throw new Error('Invalid encoding type "' + opts.encoding + '"');
        }
        var ret;
        var stream = FS.open(path, opts.flags);
        var stat = FS.stat(path);
        var length = stat.size;
        var buf = new Uint8Array(length);
        FS.read(stream, buf, 0, length, 0);
        if (opts.encoding === 'utf8') {
          ret = UTF8ArrayToString(buf, 0);
        } else if (opts.encoding === 'binary') {
          ret = buf;
        }
        FS.close(stream);
        return ret;
      },writeFile:function(path, data, opts) {
        opts = opts || {};
        opts.flags = opts.flags || 'w';
        var stream = FS.open(path, opts.flags, opts.mode);
        if (typeof data === 'string') {
          var buf = new Uint8Array(lengthBytesUTF8(data)+1);
          var actualNumBytes = stringToUTF8Array(data, buf, 0, buf.length);
          FS.write(stream, buf, 0, actualNumBytes, undefined, opts.canOwn);
        } else if (ArrayBuffer.isView(data)) {
          FS.write(stream, data, 0, data.byteLength, undefined, opts.canOwn);
        } else {
          throw new Error('Unsupported data type');
        }
        FS.close(stream);
      },cwd:function() {
        return FS.currentPath;
      },chdir:function(path) {
        var lookup = FS.lookupPath(path, { follow: true });
        if (lookup.node === null) {
          throw new FS.ErrnoError(44);
        }
        if (!FS.isDir(lookup.node.mode)) {
          throw new FS.ErrnoError(54);
        }
        var err = FS.nodePermissions(lookup.node, 'x');
        if (err) {
          throw new FS.ErrnoError(err);
        }
        FS.currentPath = lookup.path;
      },createDefaultDirectories:function() {
        FS.mkdir('/tmp');
        FS.mkdir('/home');
        FS.mkdir('/home/web_user');
      },createDefaultDevices:function() {
        // create /dev
        FS.mkdir('/dev');
        // setup /dev/null
        FS.registerDevice(FS.makedev(1, 3), {
          read: function() { return 0; },
          write: function(stream, buffer, offset, length, pos) { return length; }
        });
        FS.mkdev('/dev/null', FS.makedev(1, 3));
        // setup /dev/tty and /dev/tty1
        // stderr needs to print output using Module['printErr']
        // so we register a second tty just for it.
        TTY.register(FS.makedev(5, 0), TTY.default_tty_ops);
        TTY.register(FS.makedev(6, 0), TTY.default_tty1_ops);
        FS.mkdev('/dev/tty', FS.makedev(5, 0));
        FS.mkdev('/dev/tty1', FS.makedev(6, 0));
        // setup /dev/[u]random
        var random_device;
        if (typeof crypto === 'object' && typeof crypto['getRandomValues'] === 'function') {
          // for modern web browsers
          var randomBuffer = new Uint8Array(1);
          random_device = function() { crypto.getRandomValues(randomBuffer); return randomBuffer[0]; };
        } else
        if (ENVIRONMENT_IS_NODE) {
          // for nodejs with or without crypto support included
          try {
            var crypto_module = require('crypto');
            // nodejs has crypto support
            random_device = function() { return crypto_module['randomBytes'](1)[0]; };
          } catch (e) {
            // nodejs doesn't have crypto support
          }
        } else
        {}
        if (!random_device) {
          // we couldn't find a proper implementation, as Math.random() is not suitable for /dev/random, see emscripten-core/emscripten/pull/7096
          random_device = function() { abort("no cryptographic support found for random_device. consider polyfilling it if you want to use something insecure like Math.random(), e.g. put this in a --pre-js: var crypto = { getRandomValues: function(array) { for (var i = 0; i < array.length; i++) array[i] = (Math.random()*256)|0 } };"); };
        }
        FS.createDevice('/dev', 'random', random_device);
        FS.createDevice('/dev', 'urandom', random_device);
        // we're not going to emulate the actual shm device,
        // just create the tmp dirs that reside in it commonly
        FS.mkdir('/dev/shm');
        FS.mkdir('/dev/shm/tmp');
      },createSpecialDirectories:function() {
        // create /proc/self/fd which allows /proc/self/fd/6 => readlink gives the name of the stream for fd 6 (see test_unistd_ttyname)
        FS.mkdir('/proc');
        FS.mkdir('/proc/self');
        FS.mkdir('/proc/self/fd');
        FS.mount({
          mount: function() {
            var node = FS.createNode('/proc/self', 'fd', 16384 | 511 /* 0777 */, 73);
            node.node_ops = {
              lookup: function(parent, name) {
                var fd = +name;
                var stream = FS.getStream(fd);
                if (!stream) throw new FS.ErrnoError(8);
                var ret = {
                  parent: null,
                  mount: { mountpoint: 'fake' },
                  node_ops: { readlink: function() { return stream.path } }
                };
                ret.parent = ret; // make it look like a simple root node
                return ret;
              }
            };
            return node;
          }
        }, {}, '/proc/self/fd');
      },createStandardStreams:function() {
        // TODO deprecate the old functionality of a single
        // input / output callback and that utilizes FS.createDevice
        // and instead require a unique set of stream ops
  
        // by default, we symlink the standard streams to the
        // default tty devices. however, if the standard streams
        // have been overwritten we create a unique device for
        // them instead.
        if (Module['stdin']) {
          FS.createDevice('/dev', 'stdin', Module['stdin']);
        } else {
          FS.symlink('/dev/tty', '/dev/stdin');
        }
        if (Module['stdout']) {
          FS.createDevice('/dev', 'stdout', null, Module['stdout']);
        } else {
          FS.symlink('/dev/tty', '/dev/stdout');
        }
        if (Module['stderr']) {
          FS.createDevice('/dev', 'stderr', null, Module['stderr']);
        } else {
          FS.symlink('/dev/tty1', '/dev/stderr');
        }
  
        // open default streams for the stdin, stdout and stderr devices
        var stdin = FS.open('/dev/stdin', 'r');
        var stdout = FS.open('/dev/stdout', 'w');
        var stderr = FS.open('/dev/stderr', 'w');
        assert(stdin.fd === 0, 'invalid handle for stdin (' + stdin.fd + ')');
        assert(stdout.fd === 1, 'invalid handle for stdout (' + stdout.fd + ')');
        assert(stderr.fd === 2, 'invalid handle for stderr (' + stderr.fd + ')');
      },ensureErrnoError:function() {
        if (FS.ErrnoError) return;
        FS.ErrnoError = function ErrnoError(errno, node) {
          this.node = node;
          this.setErrno = function(errno) {
            this.errno = errno;
            for (var key in ERRNO_CODES) {
              if (ERRNO_CODES[key] === errno) {
                this.code = key;
                break;
              }
            }
          };
          this.setErrno(errno);
          this.message = ERRNO_MESSAGES[errno];
  
          // Try to get a maximally helpful stack trace. On Node.js, getting Error.stack
          // now ensures it shows what we want.
          if (this.stack) {
            // Define the stack property for Node.js 4, which otherwise errors on the next line.
            Object.defineProperty(this, "stack", { value: (new Error).stack, writable: true });
            this.stack = demangleAll(this.stack);
          }
        };
        FS.ErrnoError.prototype = new Error();
        FS.ErrnoError.prototype.constructor = FS.ErrnoError;
        // Some errors may happen quite a bit, to avoid overhead we reuse them (and suffer a lack of stack info)
        [44].forEach(function(code) {
          FS.genericErrors[code] = new FS.ErrnoError(code);
          FS.genericErrors[code].stack = '<generic error, no stack>';
        });
      },staticInit:function() {
        FS.ensureErrnoError();
  
        FS.nameTable = new Array(4096);
  
        FS.mount(MEMFS, {}, '/');
  
        FS.createDefaultDirectories();
        FS.createDefaultDevices();
        FS.createSpecialDirectories();
  
        FS.filesystems = {
          'MEMFS': MEMFS,
        };
      },init:function(input, output, error) {
        assert(!FS.init.initialized, 'FS.init was previously called. If you want to initialize later with custom parameters, remove any earlier calls (note that one is automatically added to the generated code)');
        FS.init.initialized = true;
  
        FS.ensureErrnoError();
  
        // Allow Module.stdin etc. to provide defaults, if none explicitly passed to us here
        Module['stdin'] = input || Module['stdin'];
        Module['stdout'] = output || Module['stdout'];
        Module['stderr'] = error || Module['stderr'];
  
        FS.createStandardStreams();
      },quit:function() {
        FS.init.initialized = false;
        // force-flush all streams, so we get musl std streams printed out
        var fflush = Module['_fflush'];
        if (fflush) fflush(0);
        // close all of our streams
        for (var i = 0; i < FS.streams.length; i++) {
          var stream = FS.streams[i];
          if (!stream) {
            continue;
          }
          FS.close(stream);
        }
      },getMode:function(canRead, canWrite) {
        var mode = 0;
        if (canRead) mode |= 292 | 73;
        if (canWrite) mode |= 146;
        return mode;
      },joinPath:function(parts, forceRelative) {
        var path = PATH.join.apply(null, parts);
        if (forceRelative && path[0] == '/') path = path.substr(1);
        return path;
      },absolutePath:function(relative, base) {
        return PATH_FS.resolve(base, relative);
      },standardizePath:function(path) {
        return PATH.normalize(path);
      },findObject:function(path, dontResolveLastLink) {
        var ret = FS.analyzePath(path, dontResolveLastLink);
        if (ret.exists) {
          return ret.object;
        } else {
          ___setErrNo(ret.error);
          return null;
        }
      },analyzePath:function(path, dontResolveLastLink) {
        // operate from within the context of the symlink's target
        try {
          var lookup = FS.lookupPath(path, { follow: !dontResolveLastLink });
          path = lookup.path;
        } catch (e) {
        }
        var ret = {
          isRoot: false, exists: false, error: 0, name: null, path: null, object: null,
          parentExists: false, parentPath: null, parentObject: null
        };
        try {
          var lookup = FS.lookupPath(path, { parent: true });
          ret.parentExists = true;
          ret.parentPath = lookup.path;
          ret.parentObject = lookup.node;
          ret.name = PATH.basename(path);
          lookup = FS.lookupPath(path, { follow: !dontResolveLastLink });
          ret.exists = true;
          ret.path = lookup.path;
          ret.object = lookup.node;
          ret.name = lookup.node.name;
          ret.isRoot = lookup.path === '/';
        } catch (e) {
          ret.error = e.errno;
        };
        return ret;
      },createFolder:function(parent, name, canRead, canWrite) {
        var path = PATH.join2(typeof parent === 'string' ? parent : FS.getPath(parent), name);
        var mode = FS.getMode(canRead, canWrite);
        return FS.mkdir(path, mode);
      },createPath:function(parent, path, canRead, canWrite) {
        parent = typeof parent === 'string' ? parent : FS.getPath(parent);
        var parts = path.split('/').reverse();
        while (parts.length) {
          var part = parts.pop();
          if (!part) continue;
          var current = PATH.join2(parent, part);
          try {
            FS.mkdir(current);
          } catch (e) {
            // ignore EEXIST
          }
          parent = current;
        }
        return current;
      },createFile:function(parent, name, properties, canRead, canWrite) {
        var path = PATH.join2(typeof parent === 'string' ? parent : FS.getPath(parent), name);
        var mode = FS.getMode(canRead, canWrite);
        return FS.create(path, mode);
      },createDataFile:function(parent, name, data, canRead, canWrite, canOwn) {
        var path = name ? PATH.join2(typeof parent === 'string' ? parent : FS.getPath(parent), name) : parent;
        var mode = FS.getMode(canRead, canWrite);
        var node = FS.create(path, mode);
        if (data) {
          if (typeof data === 'string') {
            var arr = new Array(data.length);
            for (var i = 0, len = data.length; i < len; ++i) arr[i] = data.charCodeAt(i);
            data = arr;
          }
          // make sure we can write to the file
          FS.chmod(node, mode | 146);
          var stream = FS.open(node, 'w');
          FS.write(stream, data, 0, data.length, 0, canOwn);
          FS.close(stream);
          FS.chmod(node, mode);
        }
        return node;
      },createDevice:function(parent, name, input, output) {
        var path = PATH.join2(typeof parent === 'string' ? parent : FS.getPath(parent), name);
        var mode = FS.getMode(!!input, !!output);
        if (!FS.createDevice.major) FS.createDevice.major = 64;
        var dev = FS.makedev(FS.createDevice.major++, 0);
        // Create a fake device that a set of stream ops to emulate
        // the old behavior.
        FS.registerDevice(dev, {
          open: function(stream) {
            stream.seekable = false;
          },
          close: function(stream) {
            // flush any pending line data
            if (output && output.buffer && output.buffer.length) {
              output(10);
            }
          },
          read: function(stream, buffer, offset, length, pos /* ignored */) {
            var bytesRead = 0;
            for (var i = 0; i < length; i++) {
              var result;
              try {
                result = input();
              } catch (e) {
                throw new FS.ErrnoError(29);
              }
              if (result === undefined && bytesRead === 0) {
                throw new FS.ErrnoError(6);
              }
              if (result === null || result === undefined) break;
              bytesRead++;
              buffer[offset+i] = result;
            }
            if (bytesRead) {
              stream.node.timestamp = Date.now();
            }
            return bytesRead;
          },
          write: function(stream, buffer, offset, length, pos) {
            for (var i = 0; i < length; i++) {
              try {
                output(buffer[offset+i]);
              } catch (e) {
                throw new FS.ErrnoError(29);
              }
            }
            if (length) {
              stream.node.timestamp = Date.now();
            }
            return i;
          }
        });
        return FS.mkdev(path, mode, dev);
      },createLink:function(parent, name, target, canRead, canWrite) {
        var path = PATH.join2(typeof parent === 'string' ? parent : FS.getPath(parent), name);
        return FS.symlink(target, path);
      },forceLoadFile:function(obj) {
        if (obj.isDevice || obj.isFolder || obj.link || obj.contents) return true;
        var success = true;
        if (typeof XMLHttpRequest !== 'undefined') {
          throw new Error("Lazy loading should have been performed (contents set) in createLazyFile, but it was not. Lazy loading only works in web workers. Use --embed-file or --preload-file in emcc on the main thread.");
        } else if (read_) {
          // Command-line.
          try {
            // WARNING: Can't read binary files in V8's d8 or tracemonkey's js, as
            //          read() will try to parse UTF8.
            obj.contents = intArrayFromString(read_(obj.url), true);
            obj.usedBytes = obj.contents.length;
          } catch (e) {
            success = false;
          }
        } else {
          throw new Error('Cannot load without read() or XMLHttpRequest.');
        }
        if (!success) ___setErrNo(29);
        return success;
      },createLazyFile:function(parent, name, url, canRead, canWrite) {
        // Lazy chunked Uint8Array (implements get and length from Uint8Array). Actual getting is abstracted away for eventual reuse.
        function LazyUint8Array() {
          this.lengthKnown = false;
          this.chunks = []; // Loaded chunks. Index is the chunk number
        }
        LazyUint8Array.prototype.get = function LazyUint8Array_get(idx) {
          if (idx > this.length-1 || idx < 0) {
            return undefined;
          }
          var chunkOffset = idx % this.chunkSize;
          var chunkNum = (idx / this.chunkSize)|0;
          return this.getter(chunkNum)[chunkOffset];
        };
        LazyUint8Array.prototype.setDataGetter = function LazyUint8Array_setDataGetter(getter) {
          this.getter = getter;
        };
        LazyUint8Array.prototype.cacheLength = function LazyUint8Array_cacheLength() {
          // Find length
          var xhr = new XMLHttpRequest();
          xhr.open('HEAD', url, false);
          xhr.send(null);
          if (!(xhr.status >= 200 && xhr.status < 300 || xhr.status === 304)) throw new Error("Couldn't load " + url + ". Status: " + xhr.status);
          var datalength = Number(xhr.getResponseHeader("Content-length"));
          var header;
          var hasByteServing = (header = xhr.getResponseHeader("Accept-Ranges")) && header === "bytes";
          var usesGzip = (header = xhr.getResponseHeader("Content-Encoding")) && header === "gzip";
  
          var chunkSize = 1024*1024; // Chunk size in bytes
  
          if (!hasByteServing) chunkSize = datalength;
  
          // Function to get a range from the remote URL.
          var doXHR = (function(from, to) {
            if (from > to) throw new Error("invalid range (" + from + ", " + to + ") or no bytes requested!");
            if (to > datalength-1) throw new Error("only " + datalength + " bytes available! programmer error!");
  
            // TODO: Use mozResponseArrayBuffer, responseStream, etc. if available.
            var xhr = new XMLHttpRequest();
            xhr.open('GET', url, false);
            if (datalength !== chunkSize) xhr.setRequestHeader("Range", "bytes=" + from + "-" + to);
  
            // Some hints to the browser that we want binary data.
            if (typeof Uint8Array != 'undefined') xhr.responseType = 'arraybuffer';
            if (xhr.overrideMimeType) {
              xhr.overrideMimeType('text/plain; charset=x-user-defined');
            }
  
            xhr.send(null);
            if (!(xhr.status >= 200 && xhr.status < 300 || xhr.status === 304)) throw new Error("Couldn't load " + url + ". Status: " + xhr.status);
            if (xhr.response !== undefined) {
              return new Uint8Array(xhr.response || []);
            } else {
              return intArrayFromString(xhr.responseText || '', true);
            }
          });
          var lazyArray = this;
          lazyArray.setDataGetter(function(chunkNum) {
            var start = chunkNum * chunkSize;
            var end = (chunkNum+1) * chunkSize - 1; // including this byte
            end = Math.min(end, datalength-1); // if datalength-1 is selected, this is the last block
            if (typeof(lazyArray.chunks[chunkNum]) === "undefined") {
              lazyArray.chunks[chunkNum] = doXHR(start, end);
            }
            if (typeof(lazyArray.chunks[chunkNum]) === "undefined") throw new Error("doXHR failed!");
            return lazyArray.chunks[chunkNum];
          });
  
          if (usesGzip || !datalength) {
            // if the server uses gzip or doesn't supply the length, we have to download the whole file to get the (uncompressed) length
            chunkSize = datalength = 1; // this will force getter(0)/doXHR do download the whole file
            datalength = this.getter(0).length;
            chunkSize = datalength;
            console.log("LazyFiles on gzip forces download of the whole file when length is accessed");
          }
  
          this._length = datalength;
          this._chunkSize = chunkSize;
          this.lengthKnown = true;
        };
        if (typeof XMLHttpRequest !== 'undefined') {
          if (!ENVIRONMENT_IS_WORKER) throw 'Cannot do synchronous binary XHRs outside webworkers in modern browsers. Use --embed-file or --preload-file in emcc';
          var lazyArray = new LazyUint8Array();
          Object.defineProperties(lazyArray, {
            length: {
              get: function() {
                if(!this.lengthKnown) {
                  this.cacheLength();
                }
                return this._length;
              }
            },
            chunkSize: {
              get: function() {
                if(!this.lengthKnown) {
                  this.cacheLength();
                }
                return this._chunkSize;
              }
            }
          });
  
          var properties = { isDevice: false, contents: lazyArray };
        } else {
          var properties = { isDevice: false, url: url };
        }
  
        var node = FS.createFile(parent, name, properties, canRead, canWrite);
        // This is a total hack, but I want to get this lazy file code out of the
        // core of MEMFS. If we want to keep this lazy file concept I feel it should
        // be its own thin LAZYFS proxying calls to MEMFS.
        if (properties.contents) {
          node.contents = properties.contents;
        } else if (properties.url) {
          node.contents = null;
          node.url = properties.url;
        }
        // Add a function that defers querying the file size until it is asked the first time.
        Object.defineProperties(node, {
          usedBytes: {
            get: function() { return this.contents.length; }
          }
        });
        // override each stream op with one that tries to force load the lazy file first
        var stream_ops = {};
        var keys = Object.keys(node.stream_ops);
        keys.forEach(function(key) {
          var fn = node.stream_ops[key];
          stream_ops[key] = function forceLoadLazyFile() {
            if (!FS.forceLoadFile(node)) {
              throw new FS.ErrnoError(29);
            }
            return fn.apply(null, arguments);
          };
        });
        // use a custom read function
        stream_ops.read = function stream_ops_read(stream, buffer, offset, length, position) {
          if (!FS.forceLoadFile(node)) {
            throw new FS.ErrnoError(29);
          }
          var contents = stream.node.contents;
          if (position >= contents.length)
            return 0;
          var size = Math.min(contents.length - position, length);
          assert(size >= 0);
          if (contents.slice) { // normal array
            for (var i = 0; i < size; i++) {
              buffer[offset + i] = contents[position + i];
            }
          } else {
            for (var i = 0; i < size; i++) { // LazyUint8Array from sync binary XHR
              buffer[offset + i] = contents.get(position + i);
            }
          }
          return size;
        };
        node.stream_ops = stream_ops;
        return node;
      },createPreloadedFile:function(parent, name, url, canRead, canWrite, onload, onerror, dontCreateFile, canOwn, preFinish) {
        Browser.init(); // XXX perhaps this method should move onto Browser?
        // TODO we should allow people to just pass in a complete filename instead
        // of parent and name being that we just join them anyways
        var fullname = name ? PATH_FS.resolve(PATH.join2(parent, name)) : parent;
        var dep = getUniqueRunDependency('cp ' + fullname); // might have several active requests for the same fullname
        function processData(byteArray) {
          function finish(byteArray) {
            if (preFinish) preFinish();
            if (!dontCreateFile) {
              FS.createDataFile(parent, name, byteArray, canRead, canWrite, canOwn);
            }
            if (onload) onload();
            removeRunDependency(dep);
          }
          var handled = false;
          Module['preloadPlugins'].forEach(function(plugin) {
            if (handled) return;
            if (plugin['canHandle'](fullname)) {
              plugin['handle'](byteArray, fullname, finish, function() {
                if (onerror) onerror();
                removeRunDependency(dep);
              });
              handled = true;
            }
          });
          if (!handled) finish(byteArray);
        }
        addRunDependency(dep);
        if (typeof url == 'string') {
          Browser.asyncLoad(url, function(byteArray) {
            processData(byteArray);
          }, onerror);
        } else {
          processData(url);
        }
      },indexedDB:function() {
        return window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;
      },DB_NAME:function() {
        return 'EM_FS_' + window.location.pathname;
      },DB_VERSION:20,DB_STORE_NAME:"FILE_DATA",saveFilesToDB:function(paths, onload, onerror) {
        onload = onload || function(){};
        onerror = onerror || function(){};
        var indexedDB = FS.indexedDB();
        try {
          var openRequest = indexedDB.open(FS.DB_NAME(), FS.DB_VERSION);
        } catch (e) {
          return onerror(e);
        }
        openRequest.onupgradeneeded = function openRequest_onupgradeneeded() {
          console.log('creating db');
          var db = openRequest.result;
          db.createObjectStore(FS.DB_STORE_NAME);
        };
        openRequest.onsuccess = function openRequest_onsuccess() {
          var db = openRequest.result;
          var transaction = db.transaction([FS.DB_STORE_NAME], 'readwrite');
          var files = transaction.objectStore(FS.DB_STORE_NAME);
          var ok = 0, fail = 0, total = paths.length;
          function finish() {
            if (fail == 0) onload(); else onerror();
          }
          paths.forEach(function(path) {
            var putRequest = files.put(FS.analyzePath(path).object.contents, path);
            putRequest.onsuccess = function putRequest_onsuccess() { ok++; if (ok + fail == total) finish() };
            putRequest.onerror = function putRequest_onerror() { fail++; if (ok + fail == total) finish() };
          });
          transaction.onerror = onerror;
        };
        openRequest.onerror = onerror;
      },loadFilesFromDB:function(paths, onload, onerror) {
        onload = onload || function(){};
        onerror = onerror || function(){};
        var indexedDB = FS.indexedDB();
        try {
          var openRequest = indexedDB.open(FS.DB_NAME(), FS.DB_VERSION);
        } catch (e) {
          return onerror(e);
        }
        openRequest.onupgradeneeded = onerror; // no database to load from
        openRequest.onsuccess = function openRequest_onsuccess() {
          var db = openRequest.result;
          try {
            var transaction = db.transaction([FS.DB_STORE_NAME], 'readonly');
          } catch(e) {
            onerror(e);
            return;
          }
          var files = transaction.objectStore(FS.DB_STORE_NAME);
          var ok = 0, fail = 0, total = paths.length;
          function finish() {
            if (fail == 0) onload(); else onerror();
          }
          paths.forEach(function(path) {
            var getRequest = files.get(path);
            getRequest.onsuccess = function getRequest_onsuccess() {
              if (FS.analyzePath(path).exists) {
                FS.unlink(path);
              }
              FS.createDataFile(PATH.dirname(path), PATH.basename(path), getRequest.result, true, true, true);
              ok++;
              if (ok + fail == total) finish();
            };
            getRequest.onerror = function getRequest_onerror() { fail++; if (ok + fail == total) finish() };
          });
          transaction.onerror = onerror;
        };
        openRequest.onerror = onerror;
      }};var SYSCALLS={DEFAULT_POLLMASK:5,mappings:{},umask:511,calculateAt:function(dirfd, path) {
        if (path[0] !== '/') {
          // relative path
          var dir;
          if (dirfd === -100) {
            dir = FS.cwd();
          } else {
            var dirstream = FS.getStream(dirfd);
            if (!dirstream) throw new FS.ErrnoError(8);
            dir = dirstream.path;
          }
          path = PATH.join2(dir, path);
        }
        return path;
      },doStat:function(func, path, buf) {
        try {
          var stat = func(path);
        } catch (e) {
          if (e && e.node && PATH.normalize(path) !== PATH.normalize(FS.getPath(e.node))) {
            // an error occurred while trying to look up the path; we should just report ENOTDIR
            return -54;
          }
          throw e;
        }
        HEAP32[((buf)>>2)]=stat.dev;
        HEAP32[(((buf)+(4))>>2)]=0;
        HEAP32[(((buf)+(8))>>2)]=stat.ino;
        HEAP32[(((buf)+(12))>>2)]=stat.mode;
        HEAP32[(((buf)+(16))>>2)]=stat.nlink;
        HEAP32[(((buf)+(20))>>2)]=stat.uid;
        HEAP32[(((buf)+(24))>>2)]=stat.gid;
        HEAP32[(((buf)+(28))>>2)]=stat.rdev;
        HEAP32[(((buf)+(32))>>2)]=0;
        (tempI64 = [stat.size>>>0,(tempDouble=stat.size,(+(Math_abs(tempDouble))) >= (+1) ? (tempDouble > (+0) ? ((Math_min((+(Math_floor((tempDouble)/(+4294967296)))), (+4294967295)))|0)>>>0 : (~~((+(Math_ceil((tempDouble - +(((~~(tempDouble)))>>>0))/(+4294967296))))))>>>0) : 0)],HEAP32[(((buf)+(40))>>2)]=tempI64[0],HEAP32[(((buf)+(44))>>2)]=tempI64[1]);
        HEAP32[(((buf)+(48))>>2)]=4096;
        HEAP32[(((buf)+(52))>>2)]=stat.blocks;
        HEAP32[(((buf)+(56))>>2)]=(stat.atime.getTime() / 1000)|0;
        HEAP32[(((buf)+(60))>>2)]=0;
        HEAP32[(((buf)+(64))>>2)]=(stat.mtime.getTime() / 1000)|0;
        HEAP32[(((buf)+(68))>>2)]=0;
        HEAP32[(((buf)+(72))>>2)]=(stat.ctime.getTime() / 1000)|0;
        HEAP32[(((buf)+(76))>>2)]=0;
        (tempI64 = [stat.ino>>>0,(tempDouble=stat.ino,(+(Math_abs(tempDouble))) >= (+1) ? (tempDouble > (+0) ? ((Math_min((+(Math_floor((tempDouble)/(+4294967296)))), (+4294967295)))|0)>>>0 : (~~((+(Math_ceil((tempDouble - +(((~~(tempDouble)))>>>0))/(+4294967296))))))>>>0) : 0)],HEAP32[(((buf)+(80))>>2)]=tempI64[0],HEAP32[(((buf)+(84))>>2)]=tempI64[1]);
        return 0;
      },doMsync:function(addr, stream, len, flags) {
        var buffer = new Uint8Array(HEAPU8.subarray(addr, addr + len));
        FS.msync(stream, buffer, 0, len, flags);
      },doMkdir:function(path, mode) {
        // remove a trailing slash, if one - /a/b/ has basename of '', but
        // we want to create b in the context of this function
        path = PATH.normalize(path);
        if (path[path.length-1] === '/') path = path.substr(0, path.length-1);
        FS.mkdir(path, mode, 0);
        return 0;
      },doMknod:function(path, mode, dev) {
        // we don't want this in the JS API as it uses mknod to create all nodes.
        switch (mode & 61440) {
          case 32768:
          case 8192:
          case 24576:
          case 4096:
          case 49152:
            break;
          default: return -28;
        }
        FS.mknod(path, mode, dev);
        return 0;
      },doReadlink:function(path, buf, bufsize) {
        if (bufsize <= 0) return -28;
        var ret = FS.readlink(path);
  
        var len = Math.min(bufsize, lengthBytesUTF8(ret));
        var endChar = HEAP8[buf+len];
        stringToUTF8(ret, buf, bufsize+1);
        // readlink is one of the rare functions that write out a C string, but does never append a null to the output buffer(!)
        // stringToUTF8() always appends a null byte, so restore the character under the null byte after the write.
        HEAP8[buf+len] = endChar;
  
        return len;
      },doAccess:function(path, amode) {
        if (amode & ~7) {
          // need a valid mode
          return -28;
        }
        var node;
        var lookup = FS.lookupPath(path, { follow: true });
        node = lookup.node;
        if (!node) {
          return -44;
        }
        var perms = '';
        if (amode & 4) perms += 'r';
        if (amode & 2) perms += 'w';
        if (amode & 1) perms += 'x';
        if (perms /* otherwise, they've just passed F_OK */ && FS.nodePermissions(node, perms)) {
          return -2;
        }
        return 0;
      },doDup:function(path, flags, suggestFD) {
        var suggest = FS.getStream(suggestFD);
        if (suggest) FS.close(suggest);
        return FS.open(path, flags, 0, suggestFD, suggestFD).fd;
      },doReadv:function(stream, iov, iovcnt, offset) {
        var ret = 0;
        for (var i = 0; i < iovcnt; i++) {
          var ptr = HEAP32[(((iov)+(i*8))>>2)];
          var len = HEAP32[(((iov)+(i*8 + 4))>>2)];
          var curr = FS.read(stream, HEAP8,ptr, len, offset);
          if (curr < 0) return -1;
          ret += curr;
          if (curr < len) break; // nothing more to read
        }
        return ret;
      },doWritev:function(stream, iov, iovcnt, offset) {
        var ret = 0;
        for (var i = 0; i < iovcnt; i++) {
          var ptr = HEAP32[(((iov)+(i*8))>>2)];
          var len = HEAP32[(((iov)+(i*8 + 4))>>2)];
          var curr = FS.write(stream, HEAP8,ptr, len, offset);
          if (curr < 0) return -1;
          ret += curr;
        }
        return ret;
      },varargs:0,get:function(varargs) {
        SYSCALLS.varargs += 4;
        var ret = HEAP32[(((SYSCALLS.varargs)-(4))>>2)];
        return ret;
      },getStr:function() {
        var ret = UTF8ToString(SYSCALLS.get());
        return ret;
      },getStreamFromFD:function(fd) {
        // TODO: when all syscalls use wasi, can remove the next line
        if (fd === undefined) fd = SYSCALLS.get();
        var stream = FS.getStream(fd);
        if (!stream) throw new FS.ErrnoError(8);
        return stream;
      },get64:function() {
        var low = SYSCALLS.get(), high = SYSCALLS.get();
        if (low >= 0) assert(high === 0);
        else assert(high === -1);
        return low;
      },getZero:function() {
        assert(SYSCALLS.get() === 0);
      }};function ___syscall221(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // fcntl64
      var stream = SYSCALLS.getStreamFromFD(), cmd = SYSCALLS.get();
      switch (cmd) {
        case 0: {
          var arg = SYSCALLS.get();
          if (arg < 0) {
            return -28;
          }
          var newStream;
          newStream = FS.open(stream.path, stream.flags, 0, arg);
          return newStream.fd;
        }
        case 1:
        case 2:
          return 0;  // FD_CLOEXEC makes no sense for a single process.
        case 3:
          return stream.flags;
        case 4: {
          var arg = SYSCALLS.get();
          stream.flags |= arg;
          return 0;
        }
        case 12:
        /* case 12: Currently in musl F_GETLK64 has same value as F_GETLK, so omitted to avoid duplicate case blocks. If that changes, uncomment this */ {
          
          var arg = SYSCALLS.get();
          var offset = 0;
          // We're always unlocked.
          HEAP16[(((arg)+(offset))>>1)]=2;
          return 0;
        }
        case 13:
        case 14:
        /* case 13: Currently in musl F_SETLK64 has same value as F_SETLK, so omitted to avoid duplicate case blocks. If that changes, uncomment this */
        /* case 14: Currently in musl F_SETLKW64 has same value as F_SETLKW, so omitted to avoid duplicate case blocks. If that changes, uncomment this */
          
          
          return 0; // Pretend that the locking is successful.
        case 16:
        case 8:
          return -28; // These are for sockets. We don't have them fully implemented yet.
        case 9:
          // musl trusts getown return values, due to a bug where they must be, as they overlap with errors. just return -1 here, so fnctl() returns that, and we set errno ourselves.
          ___setErrNo(28);
          return -1;
        default: {
          return -28;
        }
      }
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  function ___syscall5(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // open
      var pathname = SYSCALLS.getStr(), flags = SYSCALLS.get(), mode = SYSCALLS.get(); // optional TODO
      var stream = FS.open(pathname, flags, mode);
      return stream.fd;
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  function ___syscall54(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // ioctl
      var stream = SYSCALLS.getStreamFromFD(), op = SYSCALLS.get();
      switch (op) {
        case 21509:
        case 21505: {
          if (!stream.tty) return -59;
          return 0;
        }
        case 21510:
        case 21511:
        case 21512:
        case 21506:
        case 21507:
        case 21508: {
          if (!stream.tty) return -59;
          return 0; // no-op, not actually adjusting terminal settings
        }
        case 21519: {
          if (!stream.tty) return -59;
          var argp = SYSCALLS.get();
          HEAP32[((argp)>>2)]=0;
          return 0;
        }
        case 21520: {
          if (!stream.tty) return -59;
          return -28; // not supported
        }
        case 21531: {
          var argp = SYSCALLS.get();
          return FS.ioctl(stream, op, argp);
        }
        case 21523: {
          // TODO: in theory we should write to the winsize struct that gets
          // passed in, but for now musl doesn't read anything on it
          if (!stream.tty) return -59;
          return 0;
        }
        case 21524: {
          // TODO: technically, this ioctl call should change the window size.
          // but, since emscripten doesn't have any concept of a terminal window
          // yet, we'll just silently throw it away as we do TIOCGWINSZ
          if (!stream.tty) return -59;
          return 0;
        }
        default: abort('bad ioctl syscall ' + op);
      }
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  
  
   
  
   
  
  function _llvm_cttz_i32(x) { // Note: Currently doesn't take isZeroUndef()
      x = x | 0;
      return (x ? (31 - (Math_clz32((x ^ (x - 1))) | 0) | 0) : 32) | 0;
    }  

  function ___unlock() {}

  
  function _fd_close(fd) {try {
  
      var stream = SYSCALLS.getStreamFromFD(fd);
      FS.close(stream);
      return 0;
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return e.errno;
  }
  }function ___wasi_fd_close(
  ) {
  return _fd_close.apply(null, arguments)
  }

  
  function _fd_read(fd, iov, iovcnt, pnum) {try {
  
      var stream = SYSCALLS.getStreamFromFD(fd);
      var num = SYSCALLS.doReadv(stream, iov, iovcnt);
      HEAP32[((pnum)>>2)]=num
      return 0;
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return e.errno;
  }
  }function ___wasi_fd_read(
  ) {
  return _fd_read.apply(null, arguments)
  }

  
  function _fd_seek(fd, offset_low, offset_high, whence, newOffset) {try {
  
      var stream = SYSCALLS.getStreamFromFD(fd);
      var HIGH_OFFSET = 0x100000000; // 2^32
      // use an unsigned operator on low and shift high by 32-bits
      var offset = offset_high * HIGH_OFFSET + (offset_low >>> 0);
  
      var DOUBLE_LIMIT = 0x20000000000000; // 2^53
      // we also check for equality since DOUBLE_LIMIT + 1 == DOUBLE_LIMIT
      if (offset <= -DOUBLE_LIMIT || offset >= DOUBLE_LIMIT) {
        return -61;
      }
  
      FS.llseek(stream, offset, whence);
      (tempI64 = [stream.position>>>0,(tempDouble=stream.position,(+(Math_abs(tempDouble))) >= (+1) ? (tempDouble > (+0) ? ((Math_min((+(Math_floor((tempDouble)/(+4294967296)))), (+4294967295)))|0)>>>0 : (~~((+(Math_ceil((tempDouble - +(((~~(tempDouble)))>>>0))/(+4294967296))))))>>>0) : 0)],HEAP32[((newOffset)>>2)]=tempI64[0],HEAP32[(((newOffset)+(4))>>2)]=tempI64[1]);
      if (stream.getdents && offset === 0 && whence === 0) stream.getdents = null; // reset readdir state
      return 0;
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return e.errno;
  }
  }function ___wasi_fd_seek(
  ) {
  return _fd_seek.apply(null, arguments)
  }

  
  function _fd_write(fd, iov, iovcnt, pnum) {try {
  
      var stream = SYSCALLS.getStreamFromFD(fd);
      var num = SYSCALLS.doWritev(stream, iov, iovcnt);
      HEAP32[((pnum)>>2)]=num
      return 0;
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return e.errno;
  }
  }function ___wasi_fd_write(
  ) {
  return _fd_write.apply(null, arguments)
  }

  function _abort() {
      abort();
    }

   

   

  
  
  
  
  function _emscripten_set_main_loop_timing(mode, value) {
      Browser.mainLoop.timingMode = mode;
      Browser.mainLoop.timingValue = value;
  
      if (!Browser.mainLoop.func) {
        console.error('emscripten_set_main_loop_timing: Cannot set timing mode for main loop since a main loop does not exist! Call emscripten_set_main_loop first to set one up.');
        return 1; // Return non-zero on failure, can't set timing mode when there is no main loop.
      }
  
      if (mode == 0 /*EM_TIMING_SETTIMEOUT*/) {
        Browser.mainLoop.scheduler = function Browser_mainLoop_scheduler_setTimeout() {
          var timeUntilNextTick = Math.max(0, Browser.mainLoop.tickStartTime + value - _emscripten_get_now())|0;
          setTimeout(Browser.mainLoop.runner, timeUntilNextTick); // doing this each time means that on exception, we stop
        };
        Browser.mainLoop.method = 'timeout';
      } else if (mode == 1 /*EM_TIMING_RAF*/) {
        Browser.mainLoop.scheduler = function Browser_mainLoop_scheduler_rAF() {
          Browser.requestAnimationFrame(Browser.mainLoop.runner);
        };
        Browser.mainLoop.method = 'rAF';
      } else if (mode == 2 /*EM_TIMING_SETIMMEDIATE*/) {
        if (typeof setImmediate === 'undefined') {
          // Emulate setImmediate. (note: not a complete polyfill, we don't emulate clearImmediate() to keep code size to minimum, since not needed)
          var setImmediates = [];
          var emscriptenMainLoopMessageId = 'setimmediate';
          var Browser_setImmediate_messageHandler = function(event) {
            // When called in current thread or Worker, the main loop ID is structured slightly different to accommodate for --proxy-to-worker runtime listening to Worker events,
            // so check for both cases.
            if (event.data === emscriptenMainLoopMessageId || event.data.target === emscriptenMainLoopMessageId) {
              event.stopPropagation();
              setImmediates.shift()();
            }
          }
          addEventListener("message", Browser_setImmediate_messageHandler, true);
          setImmediate = function Browser_emulated_setImmediate(func) {
            setImmediates.push(func);
            if (ENVIRONMENT_IS_WORKER) {
              if (Module['setImmediates'] === undefined) Module['setImmediates'] = [];
              Module['setImmediates'].push(func);
              postMessage({target: emscriptenMainLoopMessageId}); // In --proxy-to-worker, route the message via proxyClient.js
            } else postMessage(emscriptenMainLoopMessageId, "*"); // On the main thread, can just send the message to itself.
          }
        }
        Browser.mainLoop.scheduler = function Browser_mainLoop_scheduler_setImmediate() {
          setImmediate(Browser.mainLoop.runner);
        };
        Browser.mainLoop.method = 'immediate';
      }
      return 0;
    }
  
  function _emscripten_get_now() { abort() }function _emscripten_set_main_loop(func, fps, simulateInfiniteLoop, arg, noSetTiming) {
      noExitRuntime = true;
  
      assert(!Browser.mainLoop.func, 'emscripten_set_main_loop: there can only be one main loop function at once: call emscripten_cancel_main_loop to cancel the previous one before setting a new one with different parameters.');
  
      Browser.mainLoop.func = func;
      Browser.mainLoop.arg = arg;
  
      var browserIterationFunc;
      if (typeof arg !== 'undefined') {
        browserIterationFunc = function() {
          Module['dynCall_vi'](func, arg);
        };
      } else {
        browserIterationFunc = function() {
          Module['dynCall_v'](func);
        };
      }
  
      var thisMainLoopId = Browser.mainLoop.currentlyRunningMainloop;
  
      Browser.mainLoop.runner = function Browser_mainLoop_runner() {
        if (ABORT) return;
        if (Browser.mainLoop.queue.length > 0) {
          var start = Date.now();
          var blocker = Browser.mainLoop.queue.shift();
          blocker.func(blocker.arg);
          if (Browser.mainLoop.remainingBlockers) {
            var remaining = Browser.mainLoop.remainingBlockers;
            var next = remaining%1 == 0 ? remaining-1 : Math.floor(remaining);
            if (blocker.counted) {
              Browser.mainLoop.remainingBlockers = next;
            } else {
              // not counted, but move the progress along a tiny bit
              next = next + 0.5; // do not steal all the next one's progress
              Browser.mainLoop.remainingBlockers = (8*remaining + next)/9;
            }
          }
          console.log('main loop blocker "' + blocker.name + '" took ' + (Date.now() - start) + ' ms'); //, left: ' + Browser.mainLoop.remainingBlockers);
          Browser.mainLoop.updateStatus();
  
          // catches pause/resume main loop from blocker execution
          if (thisMainLoopId < Browser.mainLoop.currentlyRunningMainloop) return;
  
          setTimeout(Browser.mainLoop.runner, 0);
          return;
        }
  
        // catch pauses from non-main loop sources
        if (thisMainLoopId < Browser.mainLoop.currentlyRunningMainloop) return;
  
        // Implement very basic swap interval control
        Browser.mainLoop.currentFrameNumber = Browser.mainLoop.currentFrameNumber + 1 | 0;
        if (Browser.mainLoop.timingMode == 1/*EM_TIMING_RAF*/ && Browser.mainLoop.timingValue > 1 && Browser.mainLoop.currentFrameNumber % Browser.mainLoop.timingValue != 0) {
          // Not the scheduled time to render this frame - skip.
          Browser.mainLoop.scheduler();
          return;
        } else if (Browser.mainLoop.timingMode == 0/*EM_TIMING_SETTIMEOUT*/) {
          Browser.mainLoop.tickStartTime = _emscripten_get_now();
        }
  
        // Signal GL rendering layer that processing of a new frame is about to start. This helps it optimize
        // VBO double-buffering and reduce GPU stalls.
  
  
  
        if (Browser.mainLoop.method === 'timeout' && Module.ctx) {
          err('Looks like you are rendering without using requestAnimationFrame for the main loop. You should use 0 for the frame rate in emscripten_set_main_loop in order to use requestAnimationFrame, as that can greatly improve your frame rates!');
          Browser.mainLoop.method = ''; // just warn once per call to set main loop
        }
  
        Browser.mainLoop.runIter(browserIterationFunc);
  
        checkStackCookie();
  
        // catch pauses from the main loop itself
        if (thisMainLoopId < Browser.mainLoop.currentlyRunningMainloop) return;
  
        // Queue new audio data. This is important to be right after the main loop invocation, so that we will immediately be able
        // to queue the newest produced audio samples.
        // TODO: Consider adding pre- and post- rAF callbacks so that GL.newRenderingFrameStarted() and SDL.audio.queueNewAudioData()
        //       do not need to be hardcoded into this function, but can be more generic.
        if (typeof SDL === 'object' && SDL.audio && SDL.audio.queueNewAudioData) SDL.audio.queueNewAudioData();
  
        Browser.mainLoop.scheduler();
      }
  
      if (!noSetTiming) {
        if (fps && fps > 0) _emscripten_set_main_loop_timing(0/*EM_TIMING_SETTIMEOUT*/, 1000.0 / fps);
        else _emscripten_set_main_loop_timing(1/*EM_TIMING_RAF*/, 1); // Do rAF by rendering each frame (no decimating)
  
        Browser.mainLoop.scheduler();
      }
  
      if (simulateInfiniteLoop) {
        throw 'unwind';
      }
    }var Browser={mainLoop:{scheduler:null,method:"",currentlyRunningMainloop:0,func:null,arg:0,timingMode:0,timingValue:0,currentFrameNumber:0,queue:[],pause:function() {
          Browser.mainLoop.scheduler = null;
          Browser.mainLoop.currentlyRunningMainloop++; // Incrementing this signals the previous main loop that it's now become old, and it must return.
        },resume:function() {
          Browser.mainLoop.currentlyRunningMainloop++;
          var timingMode = Browser.mainLoop.timingMode;
          var timingValue = Browser.mainLoop.timingValue;
          var func = Browser.mainLoop.func;
          Browser.mainLoop.func = null;
          _emscripten_set_main_loop(func, 0, false, Browser.mainLoop.arg, true /* do not set timing and call scheduler, we will do it on the next lines */);
          _emscripten_set_main_loop_timing(timingMode, timingValue);
          Browser.mainLoop.scheduler();
        },updateStatus:function() {
          if (Module['setStatus']) {
            var message = Module['statusMessage'] || 'Please wait...';
            var remaining = Browser.mainLoop.remainingBlockers;
            var expected = Browser.mainLoop.expectedBlockers;
            if (remaining) {
              if (remaining < expected) {
                Module['setStatus'](message + ' (' + (expected - remaining) + '/' + expected + ')');
              } else {
                Module['setStatus'](message);
              }
            } else {
              Module['setStatus']('');
            }
          }
        },runIter:function(func) {
          if (ABORT) return;
          if (Module['preMainLoop']) {
            var preRet = Module['preMainLoop']();
            if (preRet === false) {
              return; // |return false| skips a frame
            }
          }
          try {
            func();
          } catch (e) {
            if (e instanceof ExitStatus) {
              return;
            } else {
              if (e && typeof e === 'object' && e.stack) err('exception thrown: ' + [e, e.stack]);
              throw e;
            }
          }
          if (Module['postMainLoop']) Module['postMainLoop']();
        }},isFullscreen:false,pointerLock:false,moduleContextCreatedCallbacks:[],workers:[],init:function() {
        if (!Module["preloadPlugins"]) Module["preloadPlugins"] = []; // needs to exist even in workers
  
        if (Browser.initted) return;
        Browser.initted = true;
  
        try {
          new Blob();
          Browser.hasBlobConstructor = true;
        } catch(e) {
          Browser.hasBlobConstructor = false;
          console.log("warning: no blob constructor, cannot create blobs with mimetypes");
        }
        Browser.BlobBuilder = typeof MozBlobBuilder != "undefined" ? MozBlobBuilder : (typeof WebKitBlobBuilder != "undefined" ? WebKitBlobBuilder : (!Browser.hasBlobConstructor ? console.log("warning: no BlobBuilder") : null));
        Browser.URLObject = typeof window != "undefined" ? (window.URL ? window.URL : window.webkitURL) : undefined;
        if (!Module.noImageDecoding && typeof Browser.URLObject === 'undefined') {
          console.log("warning: Browser does not support creating object URLs. Built-in browser image decoding will not be available.");
          Module.noImageDecoding = true;
        }
  
        // Support for plugins that can process preloaded files. You can add more of these to
        // your app by creating and appending to Module.preloadPlugins.
        //
        // Each plugin is asked if it can handle a file based on the file's name. If it can,
        // it is given the file's raw data. When it is done, it calls a callback with the file's
        // (possibly modified) data. For example, a plugin might decompress a file, or it
        // might create some side data structure for use later (like an Image element, etc.).
  
        var imagePlugin = {};
        imagePlugin['canHandle'] = function imagePlugin_canHandle(name) {
          return !Module.noImageDecoding && /\.(jpg|jpeg|png|bmp)$/i.test(name);
        };
        imagePlugin['handle'] = function imagePlugin_handle(byteArray, name, onload, onerror) {
          var b = null;
          if (Browser.hasBlobConstructor) {
            try {
              b = new Blob([byteArray], { type: Browser.getMimetype(name) });
              if (b.size !== byteArray.length) { // Safari bug #118630
                // Safari's Blob can only take an ArrayBuffer
                b = new Blob([(new Uint8Array(byteArray)).buffer], { type: Browser.getMimetype(name) });
              }
            } catch(e) {
              warnOnce('Blob constructor present but fails: ' + e + '; falling back to blob builder');
            }
          }
          if (!b) {
            var bb = new Browser.BlobBuilder();
            bb.append((new Uint8Array(byteArray)).buffer); // we need to pass a buffer, and must copy the array to get the right data range
            b = bb.getBlob();
          }
          var url = Browser.URLObject.createObjectURL(b);
          assert(typeof url == 'string', 'createObjectURL must return a url as a string');
          var img = new Image();
          img.onload = function img_onload() {
            assert(img.complete, 'Image ' + name + ' could not be decoded');
            var canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            Module["preloadedImages"][name] = canvas;
            Browser.URLObject.revokeObjectURL(url);
            if (onload) onload(byteArray);
          };
          img.onerror = function img_onerror(event) {
            console.log('Image ' + url + ' could not be decoded');
            if (onerror) onerror();
          };
          img.src = url;
        };
        Module['preloadPlugins'].push(imagePlugin);
  
        var audioPlugin = {};
        audioPlugin['canHandle'] = function audioPlugin_canHandle(name) {
          return !Module.noAudioDecoding && name.substr(-4) in { '.ogg': 1, '.wav': 1, '.mp3': 1 };
        };
        audioPlugin['handle'] = function audioPlugin_handle(byteArray, name, onload, onerror) {
          var done = false;
          function finish(audio) {
            if (done) return;
            done = true;
            Module["preloadedAudios"][name] = audio;
            if (onload) onload(byteArray);
          }
          function fail() {
            if (done) return;
            done = true;
            Module["preloadedAudios"][name] = new Audio(); // empty shim
            if (onerror) onerror();
          }
          if (Browser.hasBlobConstructor) {
            try {
              var b = new Blob([byteArray], { type: Browser.getMimetype(name) });
            } catch(e) {
              return fail();
            }
            var url = Browser.URLObject.createObjectURL(b); // XXX we never revoke this!
            assert(typeof url == 'string', 'createObjectURL must return a url as a string');
            var audio = new Audio();
            audio.addEventListener('canplaythrough', function() { finish(audio) }, false); // use addEventListener due to chromium bug 124926
            audio.onerror = function audio_onerror(event) {
              if (done) return;
              console.log('warning: browser could not fully decode audio ' + name + ', trying slower base64 approach');
              function encode64(data) {
                var BASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
                var PAD = '=';
                var ret = '';
                var leftchar = 0;
                var leftbits = 0;
                for (var i = 0; i < data.length; i++) {
                  leftchar = (leftchar << 8) | data[i];
                  leftbits += 8;
                  while (leftbits >= 6) {
                    var curr = (leftchar >> (leftbits-6)) & 0x3f;
                    leftbits -= 6;
                    ret += BASE[curr];
                  }
                }
                if (leftbits == 2) {
                  ret += BASE[(leftchar&3) << 4];
                  ret += PAD + PAD;
                } else if (leftbits == 4) {
                  ret += BASE[(leftchar&0xf) << 2];
                  ret += PAD;
                }
                return ret;
              }
              audio.src = 'data:audio/x-' + name.substr(-3) + ';base64,' + encode64(byteArray);
              finish(audio); // we don't wait for confirmation this worked - but it's worth trying
            };
            audio.src = url;
            // workaround for chrome bug 124926 - we do not always get oncanplaythrough or onerror
            Browser.safeSetTimeout(function() {
              finish(audio); // try to use it even though it is not necessarily ready to play
            }, 10000);
          } else {
            return fail();
          }
        };
        Module['preloadPlugins'].push(audioPlugin);
  
  
        // Canvas event setup
  
        function pointerLockChange() {
          Browser.pointerLock = document['pointerLockElement'] === Module['canvas'] ||
                                document['mozPointerLockElement'] === Module['canvas'] ||
                                document['webkitPointerLockElement'] === Module['canvas'] ||
                                document['msPointerLockElement'] === Module['canvas'];
        }
        var canvas = Module['canvas'];
        if (canvas) {
          // forced aspect ratio can be enabled by defining 'forcedAspectRatio' on Module
          // Module['forcedAspectRatio'] = 4 / 3;
  
          canvas.requestPointerLock = canvas['requestPointerLock'] ||
                                      canvas['mozRequestPointerLock'] ||
                                      canvas['webkitRequestPointerLock'] ||
                                      canvas['msRequestPointerLock'] ||
                                      function(){};
          canvas.exitPointerLock = document['exitPointerLock'] ||
                                   document['mozExitPointerLock'] ||
                                   document['webkitExitPointerLock'] ||
                                   document['msExitPointerLock'] ||
                                   function(){}; // no-op if function does not exist
          canvas.exitPointerLock = canvas.exitPointerLock.bind(document);
  
          document.addEventListener('pointerlockchange', pointerLockChange, false);
          document.addEventListener('mozpointerlockchange', pointerLockChange, false);
          document.addEventListener('webkitpointerlockchange', pointerLockChange, false);
          document.addEventListener('mspointerlockchange', pointerLockChange, false);
  
          if (Module['elementPointerLock']) {
            canvas.addEventListener("click", function(ev) {
              if (!Browser.pointerLock && Module['canvas'].requestPointerLock) {
                Module['canvas'].requestPointerLock();
                ev.preventDefault();
              }
            }, false);
          }
        }
      },createContext:function(canvas, useWebGL, setInModule, webGLContextAttributes) {
        if (useWebGL && Module.ctx && canvas == Module.canvas) return Module.ctx; // no need to recreate GL context if it's already been created for this canvas.
  
        var ctx;
        var contextHandle;
        if (useWebGL) {
          // For GLES2/desktop GL compatibility, adjust a few defaults to be different to WebGL defaults, so that they align better with the desktop defaults.
          var contextAttributes = {
            antialias: false,
            alpha: false,
            majorVersion: 1,
          };
  
          if (webGLContextAttributes) {
            for (var attribute in webGLContextAttributes) {
              contextAttributes[attribute] = webGLContextAttributes[attribute];
            }
          }
  
          // This check of existence of GL is here to satisfy Closure compiler, which yells if variable GL is referenced below but GL object is not
          // actually compiled in because application is not doing any GL operations. TODO: Ideally if GL is not being used, this function
          // Browser.createContext() should not even be emitted.
          if (typeof GL !== 'undefined') {
            contextHandle = GL.createContext(canvas, contextAttributes);
            if (contextHandle) {
              ctx = GL.getContext(contextHandle).GLctx;
            }
          }
        } else {
          ctx = canvas.getContext('2d');
        }
  
        if (!ctx) return null;
  
        if (setInModule) {
          if (!useWebGL) assert(typeof GLctx === 'undefined', 'cannot set in module if GLctx is used, but we are a non-GL context that would replace it');
  
          Module.ctx = ctx;
          if (useWebGL) GL.makeContextCurrent(contextHandle);
          Module.useWebGL = useWebGL;
          Browser.moduleContextCreatedCallbacks.forEach(function(callback) { callback() });
          Browser.init();
        }
        return ctx;
      },destroyContext:function(canvas, useWebGL, setInModule) {},fullscreenHandlersInstalled:false,lockPointer:undefined,resizeCanvas:undefined,requestFullscreen:function(lockPointer, resizeCanvas, vrDevice) {
        Browser.lockPointer = lockPointer;
        Browser.resizeCanvas = resizeCanvas;
        Browser.vrDevice = vrDevice;
        if (typeof Browser.lockPointer === 'undefined') Browser.lockPointer = true;
        if (typeof Browser.resizeCanvas === 'undefined') Browser.resizeCanvas = false;
        if (typeof Browser.vrDevice === 'undefined') Browser.vrDevice = null;
  
        var canvas = Module['canvas'];
        function fullscreenChange() {
          Browser.isFullscreen = false;
          var canvasContainer = canvas.parentNode;
          if ((document['fullscreenElement'] || document['mozFullScreenElement'] ||
               document['msFullscreenElement'] || document['webkitFullscreenElement'] ||
               document['webkitCurrentFullScreenElement']) === canvasContainer) {
            canvas.exitFullscreen = Browser.exitFullscreen;
            if (Browser.lockPointer) canvas.requestPointerLock();
            Browser.isFullscreen = true;
            if (Browser.resizeCanvas) {
              Browser.setFullscreenCanvasSize();
            } else {
              Browser.updateCanvasDimensions(canvas);
            }
          } else {
            // remove the full screen specific parent of the canvas again to restore the HTML structure from before going full screen
            canvasContainer.parentNode.insertBefore(canvas, canvasContainer);
            canvasContainer.parentNode.removeChild(canvasContainer);
  
            if (Browser.resizeCanvas) {
              Browser.setWindowedCanvasSize();
            } else {
              Browser.updateCanvasDimensions(canvas);
            }
          }
          if (Module['onFullScreen']) Module['onFullScreen'](Browser.isFullscreen);
          if (Module['onFullscreen']) Module['onFullscreen'](Browser.isFullscreen);
        }
  
        if (!Browser.fullscreenHandlersInstalled) {
          Browser.fullscreenHandlersInstalled = true;
          document.addEventListener('fullscreenchange', fullscreenChange, false);
          document.addEventListener('mozfullscreenchange', fullscreenChange, false);
          document.addEventListener('webkitfullscreenchange', fullscreenChange, false);
          document.addEventListener('MSFullscreenChange', fullscreenChange, false);
        }
  
        // create a new parent to ensure the canvas has no siblings. this allows browsers to optimize full screen performance when its parent is the full screen root
        var canvasContainer = document.createElement("div");
        canvas.parentNode.insertBefore(canvasContainer, canvas);
        canvasContainer.appendChild(canvas);
  
        // use parent of canvas as full screen root to allow aspect ratio correction (Firefox stretches the root to screen size)
        canvasContainer.requestFullscreen = canvasContainer['requestFullscreen'] ||
                                            canvasContainer['mozRequestFullScreen'] ||
                                            canvasContainer['msRequestFullscreen'] ||
                                           (canvasContainer['webkitRequestFullscreen'] ? function() { canvasContainer['webkitRequestFullscreen'](Element['ALLOW_KEYBOARD_INPUT']) } : null) ||
                                           (canvasContainer['webkitRequestFullScreen'] ? function() { canvasContainer['webkitRequestFullScreen'](Element['ALLOW_KEYBOARD_INPUT']) } : null);
  
        if (vrDevice) {
          canvasContainer.requestFullscreen({ vrDisplay: vrDevice });
        } else {
          canvasContainer.requestFullscreen();
        }
      },requestFullScreen:function() {
        abort('Module.requestFullScreen has been replaced by Module.requestFullscreen (without a capital S)');
      },exitFullscreen:function() {
        // This is workaround for chrome. Trying to exit from fullscreen
        // not in fullscreen state will cause "TypeError: Document not active"
        // in chrome. See https://github.com/emscripten-core/emscripten/pull/8236
        if (!Browser.isFullscreen) {
          return false;
        }
  
        var CFS = document['exitFullscreen'] ||
                  document['cancelFullScreen'] ||
                  document['mozCancelFullScreen'] ||
                  document['msExitFullscreen'] ||
                  document['webkitCancelFullScreen'] ||
            (function() {});
        CFS.apply(document, []);
        return true;
      },nextRAF:0,fakeRequestAnimationFrame:function(func) {
        // try to keep 60fps between calls to here
        var now = Date.now();
        if (Browser.nextRAF === 0) {
          Browser.nextRAF = now + 1000/60;
        } else {
          while (now + 2 >= Browser.nextRAF) { // fudge a little, to avoid timer jitter causing us to do lots of delay:0
            Browser.nextRAF += 1000/60;
          }
        }
        var delay = Math.max(Browser.nextRAF - now, 0);
        setTimeout(func, delay);
      },requestAnimationFrame:function(func) {
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(func);
          return;
        }
        var RAF = Browser.fakeRequestAnimationFrame;
        RAF(func);
      },safeCallback:function(func) {
        return function() {
          if (!ABORT) return func.apply(null, arguments);
        };
      },allowAsyncCallbacks:true,queuedAsyncCallbacks:[],pauseAsyncCallbacks:function() {
        Browser.allowAsyncCallbacks = false;
      },resumeAsyncCallbacks:function() { // marks future callbacks as ok to execute, and synchronously runs any remaining ones right now
        Browser.allowAsyncCallbacks = true;
        if (Browser.queuedAsyncCallbacks.length > 0) {
          var callbacks = Browser.queuedAsyncCallbacks;
          Browser.queuedAsyncCallbacks = [];
          callbacks.forEach(function(func) {
            func();
          });
        }
      },safeRequestAnimationFrame:function(func) {
        return Browser.requestAnimationFrame(function() {
          if (ABORT) return;
          if (Browser.allowAsyncCallbacks) {
            func();
          } else {
            Browser.queuedAsyncCallbacks.push(func);
          }
        });
      },safeSetTimeout:function(func, timeout) {
        noExitRuntime = true;
        return setTimeout(function() {
          if (ABORT) return;
          if (Browser.allowAsyncCallbacks) {
            func();
          } else {
            Browser.queuedAsyncCallbacks.push(func);
          }
        }, timeout);
      },safeSetInterval:function(func, timeout) {
        noExitRuntime = true;
        return setInterval(function() {
          if (ABORT) return;
          if (Browser.allowAsyncCallbacks) {
            func();
          } // drop it on the floor otherwise, next interval will kick in
        }, timeout);
      },getMimetype:function(name) {
        return {
          'jpg': 'image/jpeg',
          'jpeg': 'image/jpeg',
          'png': 'image/png',
          'bmp': 'image/bmp',
          'ogg': 'audio/ogg',
          'wav': 'audio/wav',
          'mp3': 'audio/mpeg'
        }[name.substr(name.lastIndexOf('.')+1)];
      },getUserMedia:function(func) {
        if(!window.getUserMedia) {
          window.getUserMedia = navigator['getUserMedia'] ||
                                navigator['mozGetUserMedia'];
        }
        window.getUserMedia(func);
      },getMovementX:function(event) {
        return event['movementX'] ||
               event['mozMovementX'] ||
               event['webkitMovementX'] ||
               0;
      },getMovementY:function(event) {
        return event['movementY'] ||
               event['mozMovementY'] ||
               event['webkitMovementY'] ||
               0;
      },getMouseWheelDelta:function(event) {
        var delta = 0;
        switch (event.type) {
          case 'DOMMouseScroll':
            // 3 lines make up a step
            delta = event.detail / 3;
            break;
          case 'mousewheel':
            // 120 units make up a step
            delta = event.wheelDelta / 120;
            break;
          case 'wheel':
            delta = event.deltaY
            switch(event.deltaMode) {
              case 0:
                // DOM_DELTA_PIXEL: 100 pixels make up a step
                delta /= 100;
                break;
              case 1:
                // DOM_DELTA_LINE: 3 lines make up a step
                delta /= 3;
                break;
              case 2:
                // DOM_DELTA_PAGE: A page makes up 80 steps
                delta *= 80;
                break;
              default:
                throw 'unrecognized mouse wheel delta mode: ' + event.deltaMode;
            }
            break;
          default:
            throw 'unrecognized mouse wheel event: ' + event.type;
        }
        return delta;
      },mouseX:0,mouseY:0,mouseMovementX:0,mouseMovementY:0,touches:{},lastTouches:{},calculateMouseEvent:function(event) { // event should be mousemove, mousedown or mouseup
        if (Browser.pointerLock) {
          // When the pointer is locked, calculate the coordinates
          // based on the movement of the mouse.
          // Workaround for Firefox bug 764498
          if (event.type != 'mousemove' &&
              ('mozMovementX' in event)) {
            Browser.mouseMovementX = Browser.mouseMovementY = 0;
          } else {
            Browser.mouseMovementX = Browser.getMovementX(event);
            Browser.mouseMovementY = Browser.getMovementY(event);
          }
  
          // check if SDL is available
          if (typeof SDL != "undefined") {
            Browser.mouseX = SDL.mouseX + Browser.mouseMovementX;
            Browser.mouseY = SDL.mouseY + Browser.mouseMovementY;
          } else {
            // just add the mouse delta to the current absolut mouse position
            // FIXME: ideally this should be clamped against the canvas size and zero
            Browser.mouseX += Browser.mouseMovementX;
            Browser.mouseY += Browser.mouseMovementY;
          }
        } else {
          // Otherwise, calculate the movement based on the changes
          // in the coordinates.
          var rect = Module["canvas"].getBoundingClientRect();
          var cw = Module["canvas"].width;
          var ch = Module["canvas"].height;
  
          // Neither .scrollX or .pageXOffset are defined in a spec, but
          // we prefer .scrollX because it is currently in a spec draft.
          // (see: http://www.w3.org/TR/2013/WD-cssom-view-20131217/)
          var scrollX = ((typeof window.scrollX !== 'undefined') ? window.scrollX : window.pageXOffset);
          var scrollY = ((typeof window.scrollY !== 'undefined') ? window.scrollY : window.pageYOffset);
          // If this assert lands, it's likely because the browser doesn't support scrollX or pageXOffset
          // and we have no viable fallback.
          assert((typeof scrollX !== 'undefined') && (typeof scrollY !== 'undefined'), 'Unable to retrieve scroll position, mouse positions likely broken.');
  
          if (event.type === 'touchstart' || event.type === 'touchend' || event.type === 'touchmove') {
            var touch = event.touch;
            if (touch === undefined) {
              return; // the "touch" property is only defined in SDL
  
            }
            var adjustedX = touch.pageX - (scrollX + rect.left);
            var adjustedY = touch.pageY - (scrollY + rect.top);
  
            adjustedX = adjustedX * (cw / rect.width);
            adjustedY = adjustedY * (ch / rect.height);
  
            var coords = { x: adjustedX, y: adjustedY };
  
            if (event.type === 'touchstart') {
              Browser.lastTouches[touch.identifier] = coords;
              Browser.touches[touch.identifier] = coords;
            } else if (event.type === 'touchend' || event.type === 'touchmove') {
              var last = Browser.touches[touch.identifier];
              if (!last) last = coords;
              Browser.lastTouches[touch.identifier] = last;
              Browser.touches[touch.identifier] = coords;
            }
            return;
          }
  
          var x = event.pageX - (scrollX + rect.left);
          var y = event.pageY - (scrollY + rect.top);
  
          // the canvas might be CSS-scaled compared to its backbuffer;
          // SDL-using content will want mouse coordinates in terms
          // of backbuffer units.
          x = x * (cw / rect.width);
          y = y * (ch / rect.height);
  
          Browser.mouseMovementX = x - Browser.mouseX;
          Browser.mouseMovementY = y - Browser.mouseY;
          Browser.mouseX = x;
          Browser.mouseY = y;
        }
      },asyncLoad:function(url, onload, onerror, noRunDep) {
        var dep = !noRunDep ? getUniqueRunDependency('al ' + url) : '';
        readAsync(url, function(arrayBuffer) {
          assert(arrayBuffer, 'Loading data file "' + url + '" failed (no arrayBuffer).');
          onload(new Uint8Array(arrayBuffer));
          if (dep) removeRunDependency(dep);
        }, function(event) {
          if (onerror) {
            onerror();
          } else {
            throw 'Loading data file "' + url + '" failed.';
          }
        });
        if (dep) addRunDependency(dep);
      },resizeListeners:[],updateResizeListeners:function() {
        var canvas = Module['canvas'];
        Browser.resizeListeners.forEach(function(listener) {
          listener(canvas.width, canvas.height);
        });
      },setCanvasSize:function(width, height, noUpdates) {
        var canvas = Module['canvas'];
        Browser.updateCanvasDimensions(canvas, width, height);
        if (!noUpdates) Browser.updateResizeListeners();
      },windowedWidth:0,windowedHeight:0,setFullscreenCanvasSize:function() {
        // check if SDL is available
        if (typeof SDL != "undefined") {
          var flags = HEAPU32[((SDL.screen)>>2)];
          flags = flags | 0x00800000; // set SDL_FULLSCREEN flag
          HEAP32[((SDL.screen)>>2)]=flags
        }
        Browser.updateCanvasDimensions(Module['canvas']);
        Browser.updateResizeListeners();
      },setWindowedCanvasSize:function() {
        // check if SDL is available
        if (typeof SDL != "undefined") {
          var flags = HEAPU32[((SDL.screen)>>2)];
          flags = flags & ~0x00800000; // clear SDL_FULLSCREEN flag
          HEAP32[((SDL.screen)>>2)]=flags
        }
        Browser.updateCanvasDimensions(Module['canvas']);
        Browser.updateResizeListeners();
      },updateCanvasDimensions:function(canvas, wNative, hNative) {
        if (wNative && hNative) {
          canvas.widthNative = wNative;
          canvas.heightNative = hNative;
        } else {
          wNative = canvas.widthNative;
          hNative = canvas.heightNative;
        }
        var w = wNative;
        var h = hNative;
        if (Module['forcedAspectRatio'] && Module['forcedAspectRatio'] > 0) {
          if (w/h < Module['forcedAspectRatio']) {
            w = Math.round(h * Module['forcedAspectRatio']);
          } else {
            h = Math.round(w / Module['forcedAspectRatio']);
          }
        }
        if (((document['fullscreenElement'] || document['mozFullScreenElement'] ||
             document['msFullscreenElement'] || document['webkitFullscreenElement'] ||
             document['webkitCurrentFullScreenElement']) === canvas.parentNode) && (typeof screen != 'undefined')) {
           var factor = Math.min(screen.width / w, screen.height / h);
           w = Math.round(w * factor);
           h = Math.round(h * factor);
        }
        if (Browser.resizeCanvas) {
          if (canvas.width  != w) canvas.width  = w;
          if (canvas.height != h) canvas.height = h;
          if (typeof canvas.style != 'undefined') {
            canvas.style.removeProperty( "width");
            canvas.style.removeProperty("height");
          }
        } else {
          if (canvas.width  != wNative) canvas.width  = wNative;
          if (canvas.height != hNative) canvas.height = hNative;
          if (typeof canvas.style != 'undefined') {
            if (w != wNative || h != hNative) {
              canvas.style.setProperty( "width", w + "px", "important");
              canvas.style.setProperty("height", h + "px", "important");
            } else {
              canvas.style.removeProperty( "width");
              canvas.style.removeProperty("height");
            }
          }
        }
      },wgetRequests:{},nextWgetRequestHandle:0,getNextWgetRequestHandle:function() {
        var handle = Browser.nextWgetRequestHandle;
        Browser.nextWgetRequestHandle++;
        return handle;
      }};var EGL={errorCode:12288,defaultDisplayInitialized:false,currentContext:0,currentReadSurface:0,currentDrawSurface:0,contextAttributes:{alpha:false,depth:false,stencil:false,antialias:false},stringCache:{},setErrorCode:function(code) {
        EGL.errorCode = code;
      },chooseConfig:function(display, attribList, config, config_size, numConfigs) {
        if (display != 62000 /* Magic ID for Emscripten 'default display' */) {
          EGL.setErrorCode(0x3008 /* EGL_BAD_DISPLAY */);
          return 0;
        }
  
        if (attribList) {
          // read attribList if it is non-null
          for(;;) {
            var param = HEAP32[((attribList)>>2)];
            if (param == 0x3021 /*EGL_ALPHA_SIZE*/) {
              var alphaSize = HEAP32[(((attribList)+(4))>>2)];
              EGL.contextAttributes.alpha = (alphaSize > 0);
            } else if (param == 0x3025 /*EGL_DEPTH_SIZE*/) {
              var depthSize = HEAP32[(((attribList)+(4))>>2)];
              EGL.contextAttributes.depth = (depthSize > 0);
            } else if (param == 0x3026 /*EGL_STENCIL_SIZE*/) {
              var stencilSize = HEAP32[(((attribList)+(4))>>2)];
              EGL.contextAttributes.stencil = (stencilSize > 0);
            } else if (param == 0x3031 /*EGL_SAMPLES*/) {
              var samples = HEAP32[(((attribList)+(4))>>2)];
              EGL.contextAttributes.antialias = (samples > 0);
            } else if (param == 0x3032 /*EGL_SAMPLE_BUFFERS*/) {
              var samples = HEAP32[(((attribList)+(4))>>2)];
              EGL.contextAttributes.antialias = (samples == 1);
            } else if (param == 0x3100 /*EGL_CONTEXT_PRIORITY_LEVEL_IMG*/) {
              var requestedPriority = HEAP32[(((attribList)+(4))>>2)];
              EGL.contextAttributes.lowLatency = (requestedPriority != 0x3103 /*EGL_CONTEXT_PRIORITY_LOW_IMG*/);
            } else if (param == 0x3038 /*EGL_NONE*/) {
                break;
            }
            attribList += 8;
          }
        }
  
        if ((!config || !config_size) && !numConfigs) {
          EGL.setErrorCode(0x300C /* EGL_BAD_PARAMETER */);
          return 0;
        }
        if (numConfigs) {
          HEAP32[((numConfigs)>>2)]=1; // Total number of supported configs: 1.
        }
        if (config && config_size > 0) {
          HEAP32[((config)>>2)]=62002;
        }
  
        EGL.setErrorCode(0x3000 /* EGL_SUCCESS */);
        return 1;
      }};function _eglGetProcAddress(name_) {
      return _emscripten_GetProcAddress(name_);
    }

  
  var JSEvents={keyEvent:0,mouseEvent:0,wheelEvent:0,uiEvent:0,focusEvent:0,deviceOrientationEvent:0,deviceMotionEvent:0,fullscreenChangeEvent:0,pointerlockChangeEvent:0,visibilityChangeEvent:0,touchEvent:0,previousFullscreenElement:null,previousScreenX:null,previousScreenY:null,removeEventListenersRegistered:false,removeAllEventListeners:function() {
        for(var i = JSEvents.eventHandlers.length-1; i >= 0; --i) {
          JSEvents._removeHandler(i);
        }
        JSEvents.eventHandlers = [];
        JSEvents.deferredCalls = [];
      },registerRemoveEventListeners:function() {
        if (!JSEvents.removeEventListenersRegistered) {
          __ATEXIT__.push(JSEvents.removeAllEventListeners);
          JSEvents.removeEventListenersRegistered = true;
        }
      },deferredCalls:[],deferCall:function(targetFunction, precedence, argsList) {
        function arraysHaveEqualContent(arrA, arrB) {
          if (arrA.length != arrB.length) return false;
  
          for(var i in arrA) {
            if (arrA[i] != arrB[i]) return false;
          }
          return true;
        }
        // Test if the given call was already queued, and if so, don't add it again.
        for(var i in JSEvents.deferredCalls) {
          var call = JSEvents.deferredCalls[i];
          if (call.targetFunction == targetFunction && arraysHaveEqualContent(call.argsList, argsList)) {
            return;
          }
        }
        JSEvents.deferredCalls.push({
          targetFunction: targetFunction,
          precedence: precedence,
          argsList: argsList
        });
  
        JSEvents.deferredCalls.sort(function(x,y) { return x.precedence < y.precedence; });
      },removeDeferredCalls:function(targetFunction) {
        for(var i = 0; i < JSEvents.deferredCalls.length; ++i) {
          if (JSEvents.deferredCalls[i].targetFunction == targetFunction) {
            JSEvents.deferredCalls.splice(i, 1);
            --i;
          }
        }
      },canPerformEventHandlerRequests:function() {
        return JSEvents.inEventHandler && JSEvents.currentEventHandler.allowsDeferredCalls;
      },runDeferredCalls:function() {
        if (!JSEvents.canPerformEventHandlerRequests()) {
          return;
        }
        for(var i = 0; i < JSEvents.deferredCalls.length; ++i) {
          var call = JSEvents.deferredCalls[i];
          JSEvents.deferredCalls.splice(i, 1);
          --i;
          call.targetFunction.apply(this, call.argsList);
        }
      },inEventHandler:0,currentEventHandler:null,eventHandlers:[],removeAllHandlersOnTarget:function(target, eventTypeString) {
        for(var i = 0; i < JSEvents.eventHandlers.length; ++i) {
          if (JSEvents.eventHandlers[i].target == target && 
            (!eventTypeString || eventTypeString == JSEvents.eventHandlers[i].eventTypeString)) {
             JSEvents._removeHandler(i--);
           }
        }
      },_removeHandler:function(i) {
        var h = JSEvents.eventHandlers[i];
        h.target.removeEventListener(h.eventTypeString, h.eventListenerFunc, h.useCapture);
        JSEvents.eventHandlers.splice(i, 1);
      },registerOrRemoveHandler:function(eventHandler) {
        var jsEventHandler = function jsEventHandler(event) {
          // Increment nesting count for the event handler.
          ++JSEvents.inEventHandler;
          JSEvents.currentEventHandler = eventHandler;
          // Process any old deferred calls the user has placed.
          JSEvents.runDeferredCalls();
          // Process the actual event, calls back to user C code handler.
          eventHandler.handlerFunc(event);
          // Process any new deferred calls that were placed right now from this event handler.
          JSEvents.runDeferredCalls();
          // Out of event handler - restore nesting count.
          --JSEvents.inEventHandler;
        };
        
        if (eventHandler.callbackfunc) {
          eventHandler.eventListenerFunc = jsEventHandler;
          eventHandler.target.addEventListener(eventHandler.eventTypeString, jsEventHandler, eventHandler.useCapture);
          JSEvents.eventHandlers.push(eventHandler);
          JSEvents.registerRemoveEventListeners();
        } else {
          for(var i = 0; i < JSEvents.eventHandlers.length; ++i) {
            if (JSEvents.eventHandlers[i].target == eventHandler.target
             && JSEvents.eventHandlers[i].eventTypeString == eventHandler.eventTypeString) {
               JSEvents._removeHandler(i--);
             }
          }
        }
      },getNodeNameForTarget:function(target) {
        if (!target) return '';
        if (target == window) return '#window';
        if (target == screen) return '#screen';
        return (target && target.nodeName) ? target.nodeName : '';
      },fullscreenEnabled:function() {
        return document.fullscreenEnabled
        // Safari 13.0.3 on macOS Catalina 10.15.1 still ships with prefixed webkitFullscreenEnabled.
        // TODO: If Safari at some point ships with unprefixed version, update the version check above.
        || document.webkitFullscreenEnabled
         ;
      }};
  
  function __requestPointerLock(target) {
      if (target.requestPointerLock) {
        target.requestPointerLock();
      } else if (target.msRequestPointerLock) {
        target.msRequestPointerLock();
      } else {
        // document.body is known to accept pointer lock, so use that to differentiate if the user passed a bad element,
        // or if the whole browser just doesn't support the feature.
        if (document.body.requestPointerLock
          || document.body.msRequestPointerLock
          ) {
          return -3;
        } else {
          return -1;
        }
      }
      return 0;
    }function _emscripten_exit_pointerlock() {
      // Make sure no queued up calls will fire after this.
      JSEvents.removeDeferredCalls(__requestPointerLock);
  
      if (document.exitPointerLock) {
        document.exitPointerLock();
      } else if (document.msExitPointerLock) {
        document.msExitPointerLock();
      } else {
        return -1;
      }
      return 0;
    }

  
  
  function __maybeCStringToJsString(cString) {
      return cString === cString + 0 ? UTF8ToString(cString) : cString;
    }
  
  var __specialEventTargets=[0, typeof document !== 'undefined' ? document : 0, typeof window !== 'undefined' ? window : 0];function __findEventTarget(target) {
      var domElement = __specialEventTargets[target] || (typeof document !== 'undefined' ? document.querySelector(__maybeCStringToJsString(target)) : undefined);
      return domElement;
    }
  
  function __getBoundingClientRect(e) {
      return e.getBoundingClientRect();
    }function _emscripten_get_element_css_size(target, width, height) {
      target = __findEventTarget(target);
      if (!target) return -4;
  
      var rect = __getBoundingClientRect(target);
      // N.b. .getBoundingClientRect(element).width & .height do not exist on IE 8, so IE 9+ is needed.
      HEAPF64[((width)>>3)]=rect.width;
      HEAPF64[((height)>>3)]=rect.height;
  
      return 0;
    }

  
  function __fillGamepadEventData(eventStruct, e) {
      HEAPF64[((eventStruct)>>3)]=e.timestamp;
      for(var i = 0; i < e.axes.length; ++i) {
        HEAPF64[(((eventStruct+i*8)+(16))>>3)]=e.axes[i];
      }
      for(var i = 0; i < e.buttons.length; ++i) {
        if (typeof(e.buttons[i]) === 'object') {
          HEAPF64[(((eventStruct+i*8)+(528))>>3)]=e.buttons[i].value;
        } else {
          HEAPF64[(((eventStruct+i*8)+(528))>>3)]=e.buttons[i];
        }
      }
      for(var i = 0; i < e.buttons.length; ++i) {
        if (typeof(e.buttons[i]) === 'object') {
          HEAP32[(((eventStruct+i*4)+(1040))>>2)]=e.buttons[i].pressed;
        } else {
          HEAP32[(((eventStruct+i*4)+(1040))>>2)]=e.buttons[i] == 1.0;
        }
      }
      HEAP32[(((eventStruct)+(1296))>>2)]=e.connected;
      HEAP32[(((eventStruct)+(1300))>>2)]=e.index;
      HEAP32[(((eventStruct)+(8))>>2)]=e.axes.length;
      HEAP32[(((eventStruct)+(12))>>2)]=e.buttons.length;
      stringToUTF8(e.id, eventStruct + 1304, 64);
      stringToUTF8(e.mapping, eventStruct + 1368, 64);
    }function _emscripten_get_gamepad_status(index, gamepadState) {
      if (!JSEvents.lastGamepadState) throw 'emscripten_get_gamepad_status() can only be called after having first called emscripten_sample_gamepad_data() and that function has returned EMSCRIPTEN_RESULT_SUCCESS!';
  
      // INVALID_PARAM is returned on a Gamepad index that never was there.
      if (index < 0 || index >= JSEvents.lastGamepadState.length) return -5;
  
      // NO_DATA is returned on a Gamepad index that was removed.
      // For previously disconnected gamepads there should be an empty slot (null/undefined/false) at the index.
      // This is because gamepads must keep their original position in the array.
      // For example, removing the first of two gamepads produces [null/undefined/false, gamepad].
      if (!JSEvents.lastGamepadState[index]) return -7;
  
      __fillGamepadEventData(gamepadState, JSEvents.lastGamepadState[index]);
      return 0;
    }

  function _emscripten_get_heap_size() {
      return HEAP8.length;
    }

  function _emscripten_get_num_gamepads() {
      if (!JSEvents.lastGamepadState) throw 'emscripten_get_num_gamepads() can only be called after having first called emscripten_sample_gamepad_data() and that function has returned EMSCRIPTEN_RESULT_SUCCESS!';
      // N.B. Do not call emscripten_get_num_gamepads() unless having first called emscripten_sample_gamepad_data(), and that has returned EMSCRIPTEN_RESULT_SUCCESS.
      // Otherwise the following line will throw an exception.
      return JSEvents.lastGamepadState.length;
    }

  
  function __fillPointerlockChangeEventData(eventStruct, e) {
      var pointerLockElement = document.pointerLockElement || document.mozPointerLockElement || document.webkitPointerLockElement || document.msPointerLockElement;
      var isPointerlocked = !!pointerLockElement;
      HEAP32[((eventStruct)>>2)]=isPointerlocked;
      var nodeName = JSEvents.getNodeNameForTarget(pointerLockElement);
      var id = (pointerLockElement && pointerLockElement.id) ? pointerLockElement.id : '';
      stringToUTF8(nodeName, eventStruct + 4, 128);
      stringToUTF8(id, eventStruct + 132, 128);
    }function _emscripten_get_pointerlock_status(pointerlockStatus) {
      if (pointerlockStatus) __fillPointerlockChangeEventData(pointerlockStatus);
      if (!document.body || (!document.body.requestPointerLock && !document.body.mozRequestPointerLock && !document.body.webkitRequestPointerLock && !document.body.msRequestPointerLock)) {
        return -1;
      }
      return 0;
    }

   

  
  var GL={counter:1,lastError:0,buffers:[],mappedBuffers:{},programs:[],framebuffers:[],renderbuffers:[],textures:[],uniforms:[],shaders:[],vaos:[],contexts:{},currentContext:null,offscreenCanvases:{},timerQueriesEXT:[],programInfos:{},stringCache:{},unpackAlignment:4,init:function() {
        var miniTempFloatBuffer = new Float32Array(GL.MINI_TEMP_BUFFER_SIZE);
        for (var i = 0; i < GL.MINI_TEMP_BUFFER_SIZE; i++) {
          GL.miniTempBufferFloatViews[i] = miniTempFloatBuffer.subarray(0, i+1);
        }
  
        var miniTempIntBuffer = new Int32Array(GL.MINI_TEMP_BUFFER_SIZE);
        for (var i = 0; i < GL.MINI_TEMP_BUFFER_SIZE; i++) {
          GL.miniTempBufferIntViews[i] = miniTempIntBuffer.subarray(0, i+1);
        }
      },recordError:function recordError(errorCode) {
        if (!GL.lastError) {
          GL.lastError = errorCode;
        }
      },getNewId:function(table) {
        var ret = GL.counter++;
        for (var i = table.length; i < ret; i++) {
          table[i] = null;
        }
        return ret;
      },MINI_TEMP_BUFFER_SIZE:256,miniTempBufferFloatViews:[0],miniTempBufferIntViews:[0],getSource:function(shader, count, string, length) {
        var source = '';
        for (var i = 0; i < count; ++i) {
          var len = length ? HEAP32[(((length)+(i*4))>>2)] : -1;
          source += UTF8ToString(HEAP32[(((string)+(i*4))>>2)], len < 0 ? undefined : len);
        }
        return source;
      },createContext:function(canvas, webGLContextAttributes) {
  
  
  
  
  
        var ctx = 
          (canvas.getContext("webgl", webGLContextAttributes)
            // https://caniuse.com/#feat=webgl
            );
  
  
        if (!ctx) return 0;
  
        var handle = GL.registerContext(ctx, webGLContextAttributes);
  
  
  
        return handle;
      },registerContext:function(ctx, webGLContextAttributes) {
        var handle = _malloc(8); // Make space on the heap to store GL context attributes that need to be accessible as shared between threads.
        var context = {
          handle: handle,
          attributes: webGLContextAttributes,
          version: webGLContextAttributes.majorVersion,
          GLctx: ctx
        };
  
  
        // Store the created context object so that we can access the context given a canvas without having to pass the parameters again.
        if (ctx.canvas) ctx.canvas.GLctxObject = context;
        GL.contexts[handle] = context;
        if (typeof webGLContextAttributes.enableExtensionsByDefault === 'undefined' || webGLContextAttributes.enableExtensionsByDefault) {
          GL.initExtensions(context);
        }
  
  
  
  
        return handle;
      },makeContextCurrent:function(contextHandle) {
  
        GL.currentContext = GL.contexts[contextHandle]; // Active Emscripten GL layer context object.
        Module.ctx = GLctx = GL.currentContext && GL.currentContext.GLctx; // Active WebGL context object.
        return !(contextHandle && !GLctx);
      },getContext:function(contextHandle) {
        return GL.contexts[contextHandle];
      },deleteContext:function(contextHandle) {
        if (GL.currentContext === GL.contexts[contextHandle]) GL.currentContext = null;
        if (typeof JSEvents === 'object') JSEvents.removeAllHandlersOnTarget(GL.contexts[contextHandle].GLctx.canvas); // Release all JS event handlers on the DOM element that the GL context is associated with since the context is now deleted.
        if (GL.contexts[contextHandle] && GL.contexts[contextHandle].GLctx.canvas) GL.contexts[contextHandle].GLctx.canvas.GLctxObject = undefined; // Make sure the canvas object no longer refers to the context object so there are no GC surprises.
        _free(GL.contexts[contextHandle]);
        GL.contexts[contextHandle] = null;
      },acquireInstancedArraysExtension:function(ctx) {
        // Extension available in WebGL 1 from Firefox 26 and Google Chrome 30 onwards. Core feature in WebGL 2.
        var ext = ctx.getExtension('ANGLE_instanced_arrays');
        if (ext) {
          ctx['vertexAttribDivisor'] = function(index, divisor) { ext['vertexAttribDivisorANGLE'](index, divisor); };
          ctx['drawArraysInstanced'] = function(mode, first, count, primcount) { ext['drawArraysInstancedANGLE'](mode, first, count, primcount); };
          ctx['drawElementsInstanced'] = function(mode, count, type, indices, primcount) { ext['drawElementsInstancedANGLE'](mode, count, type, indices, primcount); };
        }
      },acquireVertexArrayObjectExtension:function(ctx) {
        // Extension available in WebGL 1 from Firefox 25 and WebKit 536.28/desktop Safari 6.0.3 onwards. Core feature in WebGL 2.
        var ext = ctx.getExtension('OES_vertex_array_object');
        if (ext) {
          ctx['createVertexArray'] = function() { return ext['createVertexArrayOES'](); };
          ctx['deleteVertexArray'] = function(vao) { ext['deleteVertexArrayOES'](vao); };
          ctx['bindVertexArray'] = function(vao) { ext['bindVertexArrayOES'](vao); };
          ctx['isVertexArray'] = function(vao) { return ext['isVertexArrayOES'](vao); };
        }
      },acquireDrawBuffersExtension:function(ctx) {
        // Extension available in WebGL 1 from Firefox 28 onwards. Core feature in WebGL 2.
        var ext = ctx.getExtension('WEBGL_draw_buffers');
        if (ext) {
          ctx['drawBuffers'] = function(n, bufs) { ext['drawBuffersWEBGL'](n, bufs); };
        }
      },initExtensions:function(context) {
        // If this function is called without a specific context object, init the extensions of the currently active context.
        if (!context) context = GL.currentContext;
  
        if (context.initExtensionsDone) return;
        context.initExtensionsDone = true;
  
        var GLctx = context.GLctx;
  
        // Detect the presence of a few extensions manually, this GL interop layer itself will need to know if they exist.
  
        if (context.version < 2) {
          GL.acquireInstancedArraysExtension(GLctx);
          GL.acquireVertexArrayObjectExtension(GLctx);
          GL.acquireDrawBuffersExtension(GLctx);
        }
  
        GLctx.disjointTimerQueryExt = GLctx.getExtension("EXT_disjoint_timer_query");
  
        // These are the 'safe' feature-enabling extensions that don't add any performance impact related to e.g. debugging, and
        // should be enabled by default so that client GLES2/GL code will not need to go through extra hoops to get its stuff working.
        // As new extensions are ratified at http://www.khronos.org/registry/webgl/extensions/ , feel free to add your new extensions
        // here, as long as they don't produce a performance impact for users that might not be using those extensions.
        // E.g. debugging-related extensions should probably be off by default.
        var automaticallyEnabledExtensions = [ // Khronos ratified WebGL extensions ordered by number (no debug extensions):
                                               "OES_texture_float", "OES_texture_half_float", "OES_standard_derivatives",
                                               "OES_vertex_array_object", "WEBGL_compressed_texture_s3tc", "WEBGL_depth_texture",
                                               "OES_element_index_uint", "EXT_texture_filter_anisotropic", "EXT_frag_depth",
                                               "WEBGL_draw_buffers", "ANGLE_instanced_arrays", "OES_texture_float_linear",
                                               "OES_texture_half_float_linear", "EXT_blend_minmax", "EXT_shader_texture_lod",
                                               // Community approved WebGL extensions ordered by number:
                                               "WEBGL_compressed_texture_pvrtc", "EXT_color_buffer_half_float", "WEBGL_color_buffer_float",
                                               "EXT_sRGB", "WEBGL_compressed_texture_etc1", "EXT_disjoint_timer_query",
                                               "WEBGL_compressed_texture_etc", "WEBGL_compressed_texture_astc", "EXT_color_buffer_float",
                                               "WEBGL_compressed_texture_s3tc_srgb", "EXT_disjoint_timer_query_webgl2",
                                               // Old style prefixed forms of extensions (but still currently used on e.g. iPhone Xs as
                                               // tested on iOS 12.4.1):
                                               "WEBKIT_WEBGL_compressed_texture_pvrtc"];
  
        function shouldEnableAutomatically(extension) {
          var ret = false;
          automaticallyEnabledExtensions.forEach(function(include) {
            if (extension.indexOf(include) != -1) {
              ret = true;
            }
          });
          return ret;
        }
  
        var exts = GLctx.getSupportedExtensions() || []; // .getSupportedExtensions() can return null if context is lost, so coerce to empty array.
        exts.forEach(function(ext) {
          if (automaticallyEnabledExtensions.indexOf(ext) != -1) {
            GLctx.getExtension(ext); // Calling .getExtension enables that extension permanently, no need to store the return value to be enabled.
          }
        });
      },populateUniformTable:function(program) {
        var p = GL.programs[program];
        var ptable = GL.programInfos[program] = {
          uniforms: {},
          maxUniformLength: 0, // This is eagerly computed below, since we already enumerate all uniforms anyway.
          maxAttributeLength: -1, // This is lazily computed and cached, computed when/if first asked, "-1" meaning not computed yet.
          maxUniformBlockNameLength: -1 // Lazily computed as well
        };
  
        var utable = ptable.uniforms;
        // A program's uniform table maps the string name of an uniform to an integer location of that uniform.
        // The global GL.uniforms map maps integer locations to WebGLUniformLocations.
        var numUniforms = GLctx.getProgramParameter(p, 0x8B86/*GL_ACTIVE_UNIFORMS*/);
        for (var i = 0; i < numUniforms; ++i) {
          var u = GLctx.getActiveUniform(p, i);
  
          var name = u.name;
          ptable.maxUniformLength = Math.max(ptable.maxUniformLength, name.length+1);
  
          // If we are dealing with an array, e.g. vec4 foo[3], strip off the array index part to canonicalize that "foo", "foo[]",
          // and "foo[0]" will mean the same. Loop below will populate foo[1] and foo[2].
          if (name.slice(-1) == ']') {
            name = name.slice(0, name.lastIndexOf('['));
          }
  
          // Optimize memory usage slightly: If we have an array of uniforms, e.g. 'vec3 colors[3];', then
          // only store the string 'colors' in utable, and 'colors[0]', 'colors[1]' and 'colors[2]' will be parsed as 'colors'+i.
          // Note that for the GL.uniforms table, we still need to fetch the all WebGLUniformLocations for all the indices.
          var loc = GLctx.getUniformLocation(p, name);
          if (loc) {
            var id = GL.getNewId(GL.uniforms);
            utable[name] = [u.size, id];
            GL.uniforms[id] = loc;
  
            for (var j = 1; j < u.size; ++j) {
              var n = name + '['+j+']';
              loc = GLctx.getUniformLocation(p, n);
              id = GL.getNewId(GL.uniforms);
  
              GL.uniforms[id] = loc;
            }
          }
        }
      }};function _emscripten_glActiveTexture(x0) { GLctx['activeTexture'](x0) }

  function _emscripten_glAttachShader(program, shader) {
      GLctx.attachShader(GL.programs[program],
                              GL.shaders[shader]);
    }

  function _emscripten_glBeginQueryEXT(target, id) {
      GLctx.disjointTimerQueryExt['beginQueryEXT'](target, GL.timerQueriesEXT[id]);
    }

  function _emscripten_glBindAttribLocation(program, index, name) {
      GLctx.bindAttribLocation(GL.programs[program], index, UTF8ToString(name));
    }

  function _emscripten_glBindBuffer(target, buffer) {
  
      GLctx.bindBuffer(target, GL.buffers[buffer]);
    }

  function _emscripten_glBindFramebuffer(target, framebuffer) {
  
      GLctx.bindFramebuffer(target, GL.framebuffers[framebuffer]);
  
    }

  function _emscripten_glBindRenderbuffer(target, renderbuffer) {
      GLctx.bindRenderbuffer(target, GL.renderbuffers[renderbuffer]);
    }

  function _emscripten_glBindTexture(target, texture) {
      GLctx.bindTexture(target, GL.textures[texture]);
    }

  function _emscripten_glBindVertexArrayOES(vao) {
      GLctx['bindVertexArray'](GL.vaos[vao]);
    }

  function _emscripten_glBlendColor(x0, x1, x2, x3) { GLctx['blendColor'](x0, x1, x2, x3) }

  function _emscripten_glBlendEquation(x0) { GLctx['blendEquation'](x0) }

  function _emscripten_glBlendEquationSeparate(x0, x1) { GLctx['blendEquationSeparate'](x0, x1) }

  function _emscripten_glBlendFunc(x0, x1) { GLctx['blendFunc'](x0, x1) }

  function _emscripten_glBlendFuncSeparate(x0, x1, x2, x3) { GLctx['blendFuncSeparate'](x0, x1, x2, x3) }

  function _emscripten_glBufferData(target, size, data, usage) {
        // N.b. here first form specifies a heap subarray, second form an integer size, so the ?: code here is polymorphic. It is advised to avoid
        // randomly mixing both uses in calling code, to avoid any potential JS engine JIT issues.
        GLctx.bufferData(target, data ? HEAPU8.subarray(data, data+size) : size, usage);
    }

  function _emscripten_glBufferSubData(target, offset, size, data) {
      GLctx.bufferSubData(target, offset, HEAPU8.subarray(data, data+size));
    }

  function _emscripten_glCheckFramebufferStatus(x0) { return GLctx['checkFramebufferStatus'](x0) }

  function _emscripten_glClear(x0) { GLctx['clear'](x0) }

  function _emscripten_glClearColor(x0, x1, x2, x3) { GLctx['clearColor'](x0, x1, x2, x3) }

  function _emscripten_glClearDepthf(x0) { GLctx['clearDepth'](x0) }

  function _emscripten_glClearStencil(x0) { GLctx['clearStencil'](x0) }

  function _emscripten_glColorMask(red, green, blue, alpha) {
      GLctx.colorMask(!!red, !!green, !!blue, !!alpha);
    }

  function _emscripten_glCompileShader(shader) {
      GLctx.compileShader(GL.shaders[shader]);
    }

  function _emscripten_glCompressedTexImage2D(target, level, internalFormat, width, height, border, imageSize, data) {
      GLctx['compressedTexImage2D'](target, level, internalFormat, width, height, border, data ? HEAPU8.subarray((data),(data+imageSize)) : null);
    }

  function _emscripten_glCompressedTexSubImage2D(target, level, xoffset, yoffset, width, height, format, imageSize, data) {
      GLctx['compressedTexSubImage2D'](target, level, xoffset, yoffset, width, height, format, data ? HEAPU8.subarray((data),(data+imageSize)) : null);
    }

  function _emscripten_glCopyTexImage2D(x0, x1, x2, x3, x4, x5, x6, x7) { GLctx['copyTexImage2D'](x0, x1, x2, x3, x4, x5, x6, x7) }

  function _emscripten_glCopyTexSubImage2D(x0, x1, x2, x3, x4, x5, x6, x7) { GLctx['copyTexSubImage2D'](x0, x1, x2, x3, x4, x5, x6, x7) }

  function _emscripten_glCreateProgram() {
      var id = GL.getNewId(GL.programs);
      var program = GLctx.createProgram();
      program.name = id;
      GL.programs[id] = program;
      return id;
    }

  function _emscripten_glCreateShader(shaderType) {
      var id = GL.getNewId(GL.shaders);
      GL.shaders[id] = GLctx.createShader(shaderType);
      return id;
    }

  function _emscripten_glCullFace(x0) { GLctx['cullFace'](x0) }

  function _emscripten_glDeleteBuffers(n, buffers) {
      for (var i = 0; i < n; i++) {
        var id = HEAP32[(((buffers)+(i*4))>>2)];
        var buffer = GL.buffers[id];
  
        // From spec: "glDeleteBuffers silently ignores 0's and names that do not
        // correspond to existing buffer objects."
        if (!buffer) continue;
  
        GLctx.deleteBuffer(buffer);
        buffer.name = 0;
        GL.buffers[id] = null;
  
        if (id == GL.currArrayBuffer) GL.currArrayBuffer = 0;
        if (id == GL.currElementArrayBuffer) GL.currElementArrayBuffer = 0;
      }
    }

  function _emscripten_glDeleteFramebuffers(n, framebuffers) {
      for (var i = 0; i < n; ++i) {
        var id = HEAP32[(((framebuffers)+(i*4))>>2)];
        var framebuffer = GL.framebuffers[id];
        if (!framebuffer) continue; // GL spec: "glDeleteFramebuffers silently ignores 0s and names that do not correspond to existing framebuffer objects".
        GLctx.deleteFramebuffer(framebuffer);
        framebuffer.name = 0;
        GL.framebuffers[id] = null;
      }
    }

  function _emscripten_glDeleteProgram(id) {
      if (!id) return;
      var program = GL.programs[id];
      if (!program) { // glDeleteProgram actually signals an error when deleting a nonexisting object, unlike some other GL delete functions.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      GLctx.deleteProgram(program);
      program.name = 0;
      GL.programs[id] = null;
      GL.programInfos[id] = null;
    }

  function _emscripten_glDeleteQueriesEXT(n, ids) {
      for (var i = 0; i < n; i++) {
        var id = HEAP32[(((ids)+(i*4))>>2)];
        var query = GL.timerQueriesEXT[id];
        if (!query) continue; // GL spec: "unused names in ids are ignored, as is the name zero."
        GLctx.disjointTimerQueryExt['deleteQueryEXT'](query);
        GL.timerQueriesEXT[id] = null;
      }
    }

  function _emscripten_glDeleteRenderbuffers(n, renderbuffers) {
      for (var i = 0; i < n; i++) {
        var id = HEAP32[(((renderbuffers)+(i*4))>>2)];
        var renderbuffer = GL.renderbuffers[id];
        if (!renderbuffer) continue; // GL spec: "glDeleteRenderbuffers silently ignores 0s and names that do not correspond to existing renderbuffer objects".
        GLctx.deleteRenderbuffer(renderbuffer);
        renderbuffer.name = 0;
        GL.renderbuffers[id] = null;
      }
    }

  function _emscripten_glDeleteShader(id) {
      if (!id) return;
      var shader = GL.shaders[id];
      if (!shader) { // glDeleteShader actually signals an error when deleting a nonexisting object, unlike some other GL delete functions.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      GLctx.deleteShader(shader);
      GL.shaders[id] = null;
    }

  function _emscripten_glDeleteTextures(n, textures) {
      for (var i = 0; i < n; i++) {
        var id = HEAP32[(((textures)+(i*4))>>2)];
        var texture = GL.textures[id];
        if (!texture) continue; // GL spec: "glDeleteTextures silently ignores 0s and names that do not correspond to existing textures".
        GLctx.deleteTexture(texture);
        texture.name = 0;
        GL.textures[id] = null;
      }
    }

  function _emscripten_glDeleteVertexArraysOES(n, vaos) {
      for (var i = 0; i < n; i++) {
        var id = HEAP32[(((vaos)+(i*4))>>2)];
        GLctx['deleteVertexArray'](GL.vaos[id]);
        GL.vaos[id] = null;
      }
    }

  function _emscripten_glDepthFunc(x0) { GLctx['depthFunc'](x0) }

  function _emscripten_glDepthMask(flag) {
      GLctx.depthMask(!!flag);
    }

  function _emscripten_glDepthRangef(x0, x1) { GLctx['depthRange'](x0, x1) }

  function _emscripten_glDetachShader(program, shader) {
      GLctx.detachShader(GL.programs[program],
                              GL.shaders[shader]);
    }

  function _emscripten_glDisable(x0) { GLctx['disable'](x0) }

  function _emscripten_glDisableVertexAttribArray(index) {
      GLctx.disableVertexAttribArray(index);
    }

  function _emscripten_glDrawArrays(mode, first, count) {
  
      GLctx.drawArrays(mode, first, count);
  
    }

  function _emscripten_glDrawArraysInstancedANGLE(mode, first, count, primcount) {
      GLctx['drawArraysInstanced'](mode, first, count, primcount);
    }

  
  var __tempFixedLengthArray=[];function _emscripten_glDrawBuffersWEBGL(n, bufs) {
  
      var bufArray = __tempFixedLengthArray[n];
      for (var i = 0; i < n; i++) {
        bufArray[i] = HEAP32[(((bufs)+(i*4))>>2)];
      }
  
      GLctx['drawBuffers'](bufArray);
    }

  function _emscripten_glDrawElements(mode, count, type, indices) {
  
      GLctx.drawElements(mode, count, type, indices);
  
    }

  function _emscripten_glDrawElementsInstancedANGLE(mode, count, type, indices, primcount) {
      GLctx['drawElementsInstanced'](mode, count, type, indices, primcount);
    }

  function _emscripten_glEnable(x0) { GLctx['enable'](x0) }

  function _emscripten_glEnableVertexAttribArray(index) {
      GLctx.enableVertexAttribArray(index);
    }

  function _emscripten_glEndQueryEXT(target) {
      GLctx.disjointTimerQueryExt['endQueryEXT'](target);
    }

  function _emscripten_glFinish() { GLctx['finish']() }

  function _emscripten_glFlush() { GLctx['flush']() }

  function _emscripten_glFramebufferRenderbuffer(target, attachment, renderbuffertarget, renderbuffer) {
      GLctx.framebufferRenderbuffer(target, attachment, renderbuffertarget,
                                         GL.renderbuffers[renderbuffer]);
    }

  function _emscripten_glFramebufferTexture2D(target, attachment, textarget, texture, level) {
      GLctx.framebufferTexture2D(target, attachment, textarget,
                                      GL.textures[texture], level);
    }

  function _emscripten_glFrontFace(x0) { GLctx['frontFace'](x0) }

  
  function __glGenObject(n, buffers, createFunction, objectTable
      ) {
      for (var i = 0; i < n; i++) {
        var buffer = GLctx[createFunction]();
        var id = buffer && GL.getNewId(objectTable);
        if (buffer) {
          buffer.name = id;
          objectTable[id] = buffer;
        } else {
          GL.recordError(0x0502 /* GL_INVALID_OPERATION */);
        }
        HEAP32[(((buffers)+(i*4))>>2)]=id;
      }
    }function _emscripten_glGenBuffers(n, buffers) {
      __glGenObject(n, buffers, 'createBuffer', GL.buffers
        );
    }

  function _emscripten_glGenFramebuffers(n, ids) {
      __glGenObject(n, ids, 'createFramebuffer', GL.framebuffers
        );
    }

  function _emscripten_glGenQueriesEXT(n, ids) {
      for (var i = 0; i < n; i++) {
        var query = GLctx.disjointTimerQueryExt['createQueryEXT']();
        if (!query) {
          GL.recordError(0x0502 /* GL_INVALID_OPERATION */);
          while(i < n) HEAP32[(((ids)+(i++*4))>>2)]=0;
          return;
        }
        var id = GL.getNewId(GL.timerQueriesEXT);
        query.name = id;
        GL.timerQueriesEXT[id] = query;
        HEAP32[(((ids)+(i*4))>>2)]=id;
      }
    }

  function _emscripten_glGenRenderbuffers(n, renderbuffers) {
      __glGenObject(n, renderbuffers, 'createRenderbuffer', GL.renderbuffers
        );
    }

  function _emscripten_glGenTextures(n, textures) {
      __glGenObject(n, textures, 'createTexture', GL.textures
        );
    }

  function _emscripten_glGenVertexArraysOES(n, arrays) {
      __glGenObject(n, arrays, 'createVertexArray', GL.vaos
        );
    }

  function _emscripten_glGenerateMipmap(x0) { GLctx['generateMipmap'](x0) }

  function _emscripten_glGetActiveAttrib(program, index, bufSize, length, size, type, name) {
      program = GL.programs[program];
      var info = GLctx.getActiveAttrib(program, index);
      if (!info) return; // If an error occurs, nothing will be written to length, size and type and name.
  
      var numBytesWrittenExclNull = (bufSize > 0 && name) ? stringToUTF8(info.name, name, bufSize) : 0;
      if (length) HEAP32[((length)>>2)]=numBytesWrittenExclNull;
      if (size) HEAP32[((size)>>2)]=info.size;
      if (type) HEAP32[((type)>>2)]=info.type;
    }

  function _emscripten_glGetActiveUniform(program, index, bufSize, length, size, type, name) {
      program = GL.programs[program];
      var info = GLctx.getActiveUniform(program, index);
      if (!info) return; // If an error occurs, nothing will be written to length, size, type and name.
  
      var numBytesWrittenExclNull = (bufSize > 0 && name) ? stringToUTF8(info.name, name, bufSize) : 0;
      if (length) HEAP32[((length)>>2)]=numBytesWrittenExclNull;
      if (size) HEAP32[((size)>>2)]=info.size;
      if (type) HEAP32[((type)>>2)]=info.type;
    }

  function _emscripten_glGetAttachedShaders(program, maxCount, count, shaders) {
      var result = GLctx.getAttachedShaders(GL.programs[program]);
      var len = result.length;
      if (len > maxCount) {
        len = maxCount;
      }
      HEAP32[((count)>>2)]=len;
      for (var i = 0; i < len; ++i) {
        var id = GL.shaders.indexOf(result[i]);
        HEAP32[(((shaders)+(i*4))>>2)]=id;
      }
    }

  function _emscripten_glGetAttribLocation(program, name) {
      return GLctx.getAttribLocation(GL.programs[program], UTF8ToString(name));
    }

  
  function emscriptenWebGLGet(name_, p, type) {
      // Guard against user passing a null pointer.
      // Note that GLES2 spec does not say anything about how passing a null pointer should be treated.
      // Testing on desktop core GL 3, the application crashes on glGetIntegerv to a null pointer, but
      // better to report an error instead of doing anything random.
      if (!p) {
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      var ret = undefined;
      switch(name_) { // Handle a few trivial GLES values
        case 0x8DFA: // GL_SHADER_COMPILER
          ret = 1;
          break;
        case 0x8DF8: // GL_SHADER_BINARY_FORMATS
          if (type != 0 && type != 1) {
            GL.recordError(0x0500); // GL_INVALID_ENUM
          }
          return; // Do not write anything to the out pointer, since no binary formats are supported.
        case 0x8DF9: // GL_NUM_SHADER_BINARY_FORMATS
          ret = 0;
          break;
        case 0x86A2: // GL_NUM_COMPRESSED_TEXTURE_FORMATS
          // WebGL doesn't have GL_NUM_COMPRESSED_TEXTURE_FORMATS (it's obsolete since GL_COMPRESSED_TEXTURE_FORMATS returns a JS array that can be queried for length),
          // so implement it ourselves to allow C++ GLES2 code get the length.
          var formats = GLctx.getParameter(0x86A3 /*GL_COMPRESSED_TEXTURE_FORMATS*/);
          ret = formats ? formats.length : 0;
          break;
      }
  
      if (ret === undefined) {
        var result = GLctx.getParameter(name_);
        switch (typeof(result)) {
          case "number":
            ret = result;
            break;
          case "boolean":
            ret = result ? 1 : 0;
            break;
          case "string":
            GL.recordError(0x0500); // GL_INVALID_ENUM
            return;
          case "object":
            if (result === null) {
              // null is a valid result for some (e.g., which buffer is bound - perhaps nothing is bound), but otherwise
              // can mean an invalid name_, which we need to report as an error
              switch(name_) {
                case 0x8894: // ARRAY_BUFFER_BINDING
                case 0x8B8D: // CURRENT_PROGRAM
                case 0x8895: // ELEMENT_ARRAY_BUFFER_BINDING
                case 0x8CA6: // FRAMEBUFFER_BINDING
                case 0x8CA7: // RENDERBUFFER_BINDING
                case 0x8069: // TEXTURE_BINDING_2D
                case 0x85B5: // WebGL 2 GL_VERTEX_ARRAY_BINDING, or WebGL 1 extension OES_vertex_array_object GL_VERTEX_ARRAY_BINDING_OES
                case 0x8514: { // TEXTURE_BINDING_CUBE_MAP
                  ret = 0;
                  break;
                }
                default: {
                  GL.recordError(0x0500); // GL_INVALID_ENUM
                  return;
                }
              }
            } else if (result instanceof Float32Array ||
                       result instanceof Uint32Array ||
                       result instanceof Int32Array ||
                       result instanceof Array) {
              for (var i = 0; i < result.length; ++i) {
                switch (type) {
                  case 0: HEAP32[(((p)+(i*4))>>2)]=result[i]; break;
                  case 2: HEAPF32[(((p)+(i*4))>>2)]=result[i]; break;
                  case 4: HEAP8[(((p)+(i))>>0)]=result[i] ? 1 : 0; break;
                }
              }
              return;
            } else {
              try {
                ret = result.name | 0;
              } catch(e) {
                GL.recordError(0x0500); // GL_INVALID_ENUM
                err('GL_INVALID_ENUM in glGet' + type + 'v: Unknown object returned from WebGL getParameter(' + name_ + ')! (error: ' + e + ')');
                return;
              }
            }
            break;
          default:
            GL.recordError(0x0500); // GL_INVALID_ENUM
            err('GL_INVALID_ENUM in glGet' + type + 'v: Native code calling glGet' + type + 'v(' + name_ + ') and it returns ' + result + ' of type ' + typeof(result) + '!');
            return;
        }
      }
  
      switch (type) {
        case 1: (tempI64 = [ret>>>0,(tempDouble=ret,(+(Math_abs(tempDouble))) >= (+1) ? (tempDouble > (+0) ? ((Math_min((+(Math_floor((tempDouble)/(+4294967296)))), (+4294967295)))|0)>>>0 : (~~((+(Math_ceil((tempDouble - +(((~~(tempDouble)))>>>0))/(+4294967296))))))>>>0) : 0)],HEAP32[((p)>>2)]=tempI64[0],HEAP32[(((p)+(4))>>2)]=tempI64[1]);    break;
        case 0: HEAP32[((p)>>2)]=ret;    break;
        case 2:   HEAPF32[((p)>>2)]=ret;  break;
        case 4: HEAP8[((p)>>0)]=ret ? 1 : 0; break;
      }
    }function _emscripten_glGetBooleanv(name_, p) {
      emscriptenWebGLGet(name_, p, 4);
    }

  function _emscripten_glGetBufferParameteriv(target, value, data) {
      if (!data) {
        // GLES2 specification does not specify how to behave if data is a null pointer. Since calling this function does not make sense
        // if data == null, issue a GL error to notify user about it.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      HEAP32[((data)>>2)]=GLctx.getBufferParameter(target, value);
    }

  function _emscripten_glGetError() {
      var error = GLctx.getError() || GL.lastError;
      GL.lastError = 0/*GL_NO_ERROR*/;
      return error;
    }

  function _emscripten_glGetFloatv(name_, p) {
      emscriptenWebGLGet(name_, p, 2);
    }

  function _emscripten_glGetFramebufferAttachmentParameteriv(target, attachment, pname, params) {
      var result = GLctx.getFramebufferAttachmentParameter(target, attachment, pname);
      if (result instanceof WebGLRenderbuffer ||
          result instanceof WebGLTexture) {
        result = result.name | 0;
      }
      HEAP32[((params)>>2)]=result;
    }

  function _emscripten_glGetIntegerv(name_, p) {
      emscriptenWebGLGet(name_, p, 0);
    }

  function _emscripten_glGetProgramInfoLog(program, maxLength, length, infoLog) {
      var log = GLctx.getProgramInfoLog(GL.programs[program]);
      if (log === null) log = '(unknown error)';
      var numBytesWrittenExclNull = (maxLength > 0 && infoLog) ? stringToUTF8(log, infoLog, maxLength) : 0;
      if (length) HEAP32[((length)>>2)]=numBytesWrittenExclNull;
    }

  function _emscripten_glGetProgramiv(program, pname, p) {
      if (!p) {
        // GLES2 specification does not specify how to behave if p is a null pointer. Since calling this function does not make sense
        // if p == null, issue a GL error to notify user about it.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
  
      if (program >= GL.counter) {
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
  
      var ptable = GL.programInfos[program];
      if (!ptable) {
        GL.recordError(0x0502 /* GL_INVALID_OPERATION */);
        return;
      }
  
      if (pname == 0x8B84) { // GL_INFO_LOG_LENGTH
        var log = GLctx.getProgramInfoLog(GL.programs[program]);
        if (log === null) log = '(unknown error)';
        HEAP32[((p)>>2)]=log.length + 1;
      } else if (pname == 0x8B87 /* GL_ACTIVE_UNIFORM_MAX_LENGTH */) {
        HEAP32[((p)>>2)]=ptable.maxUniformLength;
      } else if (pname == 0x8B8A /* GL_ACTIVE_ATTRIBUTE_MAX_LENGTH */) {
        if (ptable.maxAttributeLength == -1) {
          program = GL.programs[program];
          var numAttribs = GLctx.getProgramParameter(program, 0x8B89/*GL_ACTIVE_ATTRIBUTES*/);
          ptable.maxAttributeLength = 0; // Spec says if there are no active attribs, 0 must be returned.
          for (var i = 0; i < numAttribs; ++i) {
            var activeAttrib = GLctx.getActiveAttrib(program, i);
            ptable.maxAttributeLength = Math.max(ptable.maxAttributeLength, activeAttrib.name.length+1);
          }
        }
        HEAP32[((p)>>2)]=ptable.maxAttributeLength;
      } else if (pname == 0x8A35 /* GL_ACTIVE_UNIFORM_BLOCK_MAX_NAME_LENGTH */) {
        if (ptable.maxUniformBlockNameLength == -1) {
          program = GL.programs[program];
          var numBlocks = GLctx.getProgramParameter(program, 0x8A36/*GL_ACTIVE_UNIFORM_BLOCKS*/);
          ptable.maxUniformBlockNameLength = 0;
          for (var i = 0; i < numBlocks; ++i) {
            var activeBlockName = GLctx.getActiveUniformBlockName(program, i);
            ptable.maxUniformBlockNameLength = Math.max(ptable.maxUniformBlockNameLength, activeBlockName.length+1);
          }
        }
        HEAP32[((p)>>2)]=ptable.maxUniformBlockNameLength;
      } else {
        HEAP32[((p)>>2)]=GLctx.getProgramParameter(GL.programs[program], pname);
      }
    }

  function _emscripten_glGetQueryObjecti64vEXT(id, pname, params) {
      if (!params) {
        // GLES2 specification does not specify how to behave if params is a null pointer. Since calling this function does not make sense
        // if p == null, issue a GL error to notify user about it.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      var query = GL.timerQueriesEXT[id];
      var param = GLctx.disjointTimerQueryExt['getQueryObjectEXT'](query, pname);
      var ret;
      if (typeof param == 'boolean') {
        ret = param ? 1 : 0;
      } else {
        ret = param;
      }
      (tempI64 = [ret>>>0,(tempDouble=ret,(+(Math_abs(tempDouble))) >= (+1) ? (tempDouble > (+0) ? ((Math_min((+(Math_floor((tempDouble)/(+4294967296)))), (+4294967295)))|0)>>>0 : (~~((+(Math_ceil((tempDouble - +(((~~(tempDouble)))>>>0))/(+4294967296))))))>>>0) : 0)],HEAP32[((params)>>2)]=tempI64[0],HEAP32[(((params)+(4))>>2)]=tempI64[1]);
    }

  function _emscripten_glGetQueryObjectivEXT(id, pname, params) {
      if (!params) {
        // GLES2 specification does not specify how to behave if params is a null pointer. Since calling this function does not make sense
        // if p == null, issue a GL error to notify user about it.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      var query = GL.timerQueriesEXT[id];
      var param = GLctx.disjointTimerQueryExt['getQueryObjectEXT'](query, pname);
      var ret;
      if (typeof param == 'boolean') {
        ret = param ? 1 : 0;
      } else {
        ret = param;
      }
      HEAP32[((params)>>2)]=ret;
    }

  function _emscripten_glGetQueryObjectui64vEXT(id, pname, params) {
      if (!params) {
        // GLES2 specification does not specify how to behave if params is a null pointer. Since calling this function does not make sense
        // if p == null, issue a GL error to notify user about it.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      var query = GL.timerQueriesEXT[id];
      var param = GLctx.disjointTimerQueryExt['getQueryObjectEXT'](query, pname);
      var ret;
      if (typeof param == 'boolean') {
        ret = param ? 1 : 0;
      } else {
        ret = param;
      }
      (tempI64 = [ret>>>0,(tempDouble=ret,(+(Math_abs(tempDouble))) >= (+1) ? (tempDouble > (+0) ? ((Math_min((+(Math_floor((tempDouble)/(+4294967296)))), (+4294967295)))|0)>>>0 : (~~((+(Math_ceil((tempDouble - +(((~~(tempDouble)))>>>0))/(+4294967296))))))>>>0) : 0)],HEAP32[((params)>>2)]=tempI64[0],HEAP32[(((params)+(4))>>2)]=tempI64[1]);
    }

  function _emscripten_glGetQueryObjectuivEXT(id, pname, params) {
      if (!params) {
        // GLES2 specification does not specify how to behave if params is a null pointer. Since calling this function does not make sense
        // if p == null, issue a GL error to notify user about it.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      var query = GL.timerQueriesEXT[id];
      var param = GLctx.disjointTimerQueryExt['getQueryObjectEXT'](query, pname);
      var ret;
      if (typeof param == 'boolean') {
        ret = param ? 1 : 0;
      } else {
        ret = param;
      }
      HEAP32[((params)>>2)]=ret;
    }

  function _emscripten_glGetQueryivEXT(target, pname, params) {
      if (!params) {
        // GLES2 specification does not specify how to behave if params is a null pointer. Since calling this function does not make sense
        // if p == null, issue a GL error to notify user about it.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      HEAP32[((params)>>2)]=GLctx.disjointTimerQueryExt['getQueryEXT'](target, pname);
    }

  function _emscripten_glGetRenderbufferParameteriv(target, pname, params) {
      if (!params) {
        // GLES2 specification does not specify how to behave if params is a null pointer. Since calling this function does not make sense
        // if params == null, issue a GL error to notify user about it.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      HEAP32[((params)>>2)]=GLctx.getRenderbufferParameter(target, pname);
    }

  function _emscripten_glGetShaderInfoLog(shader, maxLength, length, infoLog) {
      var log = GLctx.getShaderInfoLog(GL.shaders[shader]);
      if (log === null) log = '(unknown error)';
      var numBytesWrittenExclNull = (maxLength > 0 && infoLog) ? stringToUTF8(log, infoLog, maxLength) : 0;
      if (length) HEAP32[((length)>>2)]=numBytesWrittenExclNull;
    }

  function _emscripten_glGetShaderPrecisionFormat(shaderType, precisionType, range, precision) {
      var result = GLctx.getShaderPrecisionFormat(shaderType, precisionType);
      HEAP32[((range)>>2)]=result.rangeMin;
      HEAP32[(((range)+(4))>>2)]=result.rangeMax;
      HEAP32[((precision)>>2)]=result.precision;
    }

  function _emscripten_glGetShaderSource(shader, bufSize, length, source) {
      var result = GLctx.getShaderSource(GL.shaders[shader]);
      if (!result) return; // If an error occurs, nothing will be written to length or source.
      var numBytesWrittenExclNull = (bufSize > 0 && source) ? stringToUTF8(result, source, bufSize) : 0;
      if (length) HEAP32[((length)>>2)]=numBytesWrittenExclNull;
    }

  function _emscripten_glGetShaderiv(shader, pname, p) {
      if (!p) {
        // GLES2 specification does not specify how to behave if p is a null pointer. Since calling this function does not make sense
        // if p == null, issue a GL error to notify user about it.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      if (pname == 0x8B84) { // GL_INFO_LOG_LENGTH
        var log = GLctx.getShaderInfoLog(GL.shaders[shader]);
        if (log === null) log = '(unknown error)';
        HEAP32[((p)>>2)]=log.length + 1;
      } else if (pname == 0x8B88) { // GL_SHADER_SOURCE_LENGTH
        var source = GLctx.getShaderSource(GL.shaders[shader]);
        var sourceLength = (source === null || source.length == 0) ? 0 : source.length + 1;
        HEAP32[((p)>>2)]=sourceLength;
      } else {
        HEAP32[((p)>>2)]=GLctx.getShaderParameter(GL.shaders[shader], pname);
      }
    }

  
  function stringToNewUTF8(jsString) {
      var length = lengthBytesUTF8(jsString)+1;
      var cString = _malloc(length);
      stringToUTF8(jsString, cString, length);
      return cString;
    }function _emscripten_glGetString(name_) {
      if (GL.stringCache[name_]) return GL.stringCache[name_];
      var ret;
      switch(name_) {
        case 0x1F03 /* GL_EXTENSIONS */:
          var exts = GLctx.getSupportedExtensions() || []; // .getSupportedExtensions() can return null if context is lost, so coerce to empty array.
          exts = exts.concat(exts.map(function(e) { return "GL_" + e; }));
          ret = stringToNewUTF8(exts.join(' '));
          break;
        case 0x1F00 /* GL_VENDOR */:
        case 0x1F01 /* GL_RENDERER */:
        case 0x9245 /* UNMASKED_VENDOR_WEBGL */:
        case 0x9246 /* UNMASKED_RENDERER_WEBGL */:
          var s = GLctx.getParameter(name_);
          if (!s) {
            GL.recordError(0x0500/*GL_INVALID_ENUM*/);
          }
          ret = stringToNewUTF8(s);
          break;
  
        case 0x1F02 /* GL_VERSION */:
          var glVersion = GLctx.getParameter(GLctx.VERSION);
          // return GLES version string corresponding to the version of the WebGL context
          {
            glVersion = 'OpenGL ES 2.0 (' + glVersion + ')';
          }
          ret = stringToNewUTF8(glVersion);
          break;
        case 0x8B8C /* GL_SHADING_LANGUAGE_VERSION */:
          var glslVersion = GLctx.getParameter(GLctx.SHADING_LANGUAGE_VERSION);
          // extract the version number 'N.M' from the string 'WebGL GLSL ES N.M ...'
          var ver_re = /^WebGL GLSL ES ([0-9]\.[0-9][0-9]?)(?:$| .*)/;
          var ver_num = glslVersion.match(ver_re);
          if (ver_num !== null) {
            if (ver_num[1].length == 3) ver_num[1] = ver_num[1] + '0'; // ensure minor version has 2 digits
            glslVersion = 'OpenGL ES GLSL ES ' + ver_num[1] + ' (' + glslVersion + ')';
          }
          ret = stringToNewUTF8(glslVersion);
          break;
        default:
          GL.recordError(0x0500/*GL_INVALID_ENUM*/);
          return 0;
      }
      GL.stringCache[name_] = ret;
      return ret;
    }

  function _emscripten_glGetTexParameterfv(target, pname, params) {
      if (!params) {
        // GLES2 specification does not specify how to behave if params is a null pointer. Since calling this function does not make sense
        // if p == null, issue a GL error to notify user about it.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      HEAPF32[((params)>>2)]=GLctx.getTexParameter(target, pname);
    }

  function _emscripten_glGetTexParameteriv(target, pname, params) {
      if (!params) {
        // GLES2 specification does not specify how to behave if params is a null pointer. Since calling this function does not make sense
        // if p == null, issue a GL error to notify user about it.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      HEAP32[((params)>>2)]=GLctx.getTexParameter(target, pname);
    }

  function _emscripten_glGetUniformLocation(program, name) {
      name = UTF8ToString(name);
  
      var arrayIndex = 0;
      // If user passed an array accessor "[index]", parse the array index off the accessor.
      if (name[name.length - 1] == ']') {
        var leftBrace = name.lastIndexOf('[');
        arrayIndex = name[leftBrace+1] != ']' ? parseInt(name.slice(leftBrace + 1)) : 0; // "index]", parseInt will ignore the ']' at the end; but treat "foo[]" as "foo[0]"
        name = name.slice(0, leftBrace);
      }
  
      var uniformInfo = GL.programInfos[program] && GL.programInfos[program].uniforms[name]; // returns pair [ dimension_of_uniform_array, uniform_location ]
      if (uniformInfo && arrayIndex >= 0 && arrayIndex < uniformInfo[0]) { // Check if user asked for an out-of-bounds element, i.e. for 'vec4 colors[3];' user could ask for 'colors[10]' which should return -1.
        return uniformInfo[1] + arrayIndex;
      } else {
        return -1;
      }
    }

  
  function emscriptenWebGLGetUniform(program, location, params, type) {
      if (!params) {
        // GLES2 specification does not specify how to behave if params is a null pointer. Since calling this function does not make sense
        // if params == null, issue a GL error to notify user about it.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      var data = GLctx.getUniform(GL.programs[program], GL.uniforms[location]);
      if (typeof data == 'number' || typeof data == 'boolean') {
        switch (type) {
          case 0: HEAP32[((params)>>2)]=data; break;
          case 2: HEAPF32[((params)>>2)]=data; break;
          default: throw 'internal emscriptenWebGLGetUniform() error, bad type: ' + type;
        }
      } else {
        for (var i = 0; i < data.length; i++) {
          switch (type) {
            case 0: HEAP32[(((params)+(i*4))>>2)]=data[i]; break;
            case 2: HEAPF32[(((params)+(i*4))>>2)]=data[i]; break;
            default: throw 'internal emscriptenWebGLGetUniform() error, bad type: ' + type;
          }
        }
      }
    }function _emscripten_glGetUniformfv(program, location, params) {
      emscriptenWebGLGetUniform(program, location, params, 2);
    }

  function _emscripten_glGetUniformiv(program, location, params) {
      emscriptenWebGLGetUniform(program, location, params, 0);
    }

  function _emscripten_glGetVertexAttribPointerv(index, pname, pointer) {
      if (!pointer) {
        // GLES2 specification does not specify how to behave if pointer is a null pointer. Since calling this function does not make sense
        // if pointer == null, issue a GL error to notify user about it.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      HEAP32[((pointer)>>2)]=GLctx.getVertexAttribOffset(index, pname);
    }

  
  function emscriptenWebGLGetVertexAttrib(index, pname, params, type) {
      if (!params) {
        // GLES2 specification does not specify how to behave if params is a null pointer. Since calling this function does not make sense
        // if params == null, issue a GL error to notify user about it.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      var data = GLctx.getVertexAttrib(index, pname);
      if (pname == 0x889F/*VERTEX_ATTRIB_ARRAY_BUFFER_BINDING*/) {
        HEAP32[((params)>>2)]=data["name"];
      } else if (typeof data == 'number' || typeof data == 'boolean') {
        switch (type) {
          case 0: HEAP32[((params)>>2)]=data; break;
          case 2: HEAPF32[((params)>>2)]=data; break;
          case 5: HEAP32[((params)>>2)]=Math.fround(data); break;
          default: throw 'internal emscriptenWebGLGetVertexAttrib() error, bad type: ' + type;
        }
      } else {
        for (var i = 0; i < data.length; i++) {
          switch (type) {
            case 0: HEAP32[(((params)+(i*4))>>2)]=data[i]; break;
            case 2: HEAPF32[(((params)+(i*4))>>2)]=data[i]; break;
            case 5: HEAP32[(((params)+(i*4))>>2)]=Math.fround(data[i]); break;
            default: throw 'internal emscriptenWebGLGetVertexAttrib() error, bad type: ' + type;
          }
        }
      }
    }function _emscripten_glGetVertexAttribfv(index, pname, params) {
      // N.B. This function may only be called if the vertex attribute was specified using the function glVertexAttrib*f(),
      // otherwise the results are undefined. (GLES3 spec 6.1.12)
      emscriptenWebGLGetVertexAttrib(index, pname, params, 2);
    }

  function _emscripten_glGetVertexAttribiv(index, pname, params) {
      // N.B. This function may only be called if the vertex attribute was specified using the function glVertexAttrib*f(),
      // otherwise the results are undefined. (GLES3 spec 6.1.12)
      emscriptenWebGLGetVertexAttrib(index, pname, params, 5);
    }

  function _emscripten_glHint(x0, x1) { GLctx['hint'](x0, x1) }

  function _emscripten_glIsBuffer(buffer) {
      var b = GL.buffers[buffer];
      if (!b) return 0;
      return GLctx.isBuffer(b);
    }

  function _emscripten_glIsEnabled(x0) { return GLctx['isEnabled'](x0) }

  function _emscripten_glIsFramebuffer(framebuffer) {
      var fb = GL.framebuffers[framebuffer];
      if (!fb) return 0;
      return GLctx.isFramebuffer(fb);
    }

  function _emscripten_glIsProgram(program) {
      program = GL.programs[program];
      if (!program) return 0;
      return GLctx.isProgram(program);
    }

  function _emscripten_glIsQueryEXT(id) {
      var query = GL.timerQueriesEXT[id];
      if (!query) return 0;
      return GLctx.disjointTimerQueryExt['isQueryEXT'](query);
    }

  function _emscripten_glIsRenderbuffer(renderbuffer) {
      var rb = GL.renderbuffers[renderbuffer];
      if (!rb) return 0;
      return GLctx.isRenderbuffer(rb);
    }

  function _emscripten_glIsShader(shader) {
      var s = GL.shaders[shader];
      if (!s) return 0;
      return GLctx.isShader(s);
    }

  function _emscripten_glIsTexture(id) {
      var texture = GL.textures[id];
      if (!texture) return 0;
      return GLctx.isTexture(texture);
    }

  function _emscripten_glIsVertexArrayOES(array) {
  
      var vao = GL.vaos[array];
      if (!vao) return 0;
      return GLctx['isVertexArray'](vao);
    }

  function _emscripten_glLineWidth(x0) { GLctx['lineWidth'](x0) }

  function _emscripten_glLinkProgram(program) {
      GLctx.linkProgram(GL.programs[program]);
      GL.populateUniformTable(program);
    }

  function _emscripten_glPixelStorei(pname, param) {
      if (pname == 0x0cf5 /* GL_UNPACK_ALIGNMENT */) {
        GL.unpackAlignment = param;
      }
      GLctx.pixelStorei(pname, param);
    }

  function _emscripten_glPolygonOffset(x0, x1) { GLctx['polygonOffset'](x0, x1) }

  function _emscripten_glQueryCounterEXT(id, target) {
      GLctx.disjointTimerQueryExt['queryCounterEXT'](GL.timerQueriesEXT[id], target);
    }

  
  
  function __computeUnpackAlignedImageSize(width, height, sizePerPixel, alignment) {
      function roundedToNextMultipleOf(x, y) {
        return (x + y - 1) & -y;
      }
      var plainRowSize = width * sizePerPixel;
      var alignedRowSize = roundedToNextMultipleOf(plainRowSize, alignment);
      return height * alignedRowSize;
    }
  
  function __colorChannelsInGlTextureFormat(format) {
      // Micro-optimizations for size: map format to size by subtracting smallest enum value (0x1902) from all values first.
      // Also omit the most common size value (1) from the list, which is assumed by formats not on the list.
      var colorChannels = {
        // 0x1902 /* GL_DEPTH_COMPONENT */ - 0x1902: 1,
        // 0x1906 /* GL_ALPHA */ - 0x1902: 1,
        5: 3,
        6: 4,
        // 0x1909 /* GL_LUMINANCE */ - 0x1902: 1,
        8: 2,
        29502: 3,
        29504: 4,
      };
      return colorChannels[format - 0x1902]||1;
    }
  
  function __heapObjectForWebGLType(type) {
      // Micro-optimization for size: Subtract lowest GL enum number (0x1400/* GL_BYTE */) from type to compare
      // smaller values for the heap, for shorter generated code size.
      // Also the type HEAPU16 is not tested for explicitly, but any unrecognized type will return out HEAPU16.
      // (since most types are HEAPU16)
      type -= 0x1400;
  
      if (type == 1) return HEAPU8;
  
  
      if (type == 4) return HEAP32;
  
      if (type == 6) return HEAPF32;
  
      if (type == 5
        || type == 28922
        )
        return HEAPU32;
  
      return HEAPU16;
    }
  
  function __heapAccessShiftForWebGLHeap(heap) {
      return 31 - Math.clz32(heap.BYTES_PER_ELEMENT);
    }function emscriptenWebGLGetTexPixelData(type, format, width, height, pixels, internalFormat) {
      var heap = __heapObjectForWebGLType(type);
      var shift = __heapAccessShiftForWebGLHeap(heap);
      var byteSize = 1<<shift;
      var sizePerPixel = __colorChannelsInGlTextureFormat(format) * byteSize;
      var bytes = __computeUnpackAlignedImageSize(width, height, sizePerPixel, GL.unpackAlignment);
      return heap.subarray(pixels >> shift, pixels + bytes >> shift);
    }function _emscripten_glReadPixels(x, y, width, height, format, type, pixels) {
      var pixelData = emscriptenWebGLGetTexPixelData(type, format, width, height, pixels, format);
      if (!pixelData) {
        GL.recordError(0x0500/*GL_INVALID_ENUM*/);
        return;
      }
      GLctx.readPixels(x, y, width, height, format, type, pixelData);
    }

  function _emscripten_glReleaseShaderCompiler() {
      // NOP (as allowed by GLES 2.0 spec)
    }

  function _emscripten_glRenderbufferStorage(x0, x1, x2, x3) { GLctx['renderbufferStorage'](x0, x1, x2, x3) }

  function _emscripten_glSampleCoverage(value, invert) {
      GLctx.sampleCoverage(value, !!invert);
    }

  function _emscripten_glScissor(x0, x1, x2, x3) { GLctx['scissor'](x0, x1, x2, x3) }

  function _emscripten_glShaderBinary() {
      GL.recordError(0x0500/*GL_INVALID_ENUM*/);
    }

  function _emscripten_glShaderSource(shader, count, string, length) {
      var source = GL.getSource(shader, count, string, length);
  
  
      GLctx.shaderSource(GL.shaders[shader], source);
    }

  function _emscripten_glStencilFunc(x0, x1, x2) { GLctx['stencilFunc'](x0, x1, x2) }

  function _emscripten_glStencilFuncSeparate(x0, x1, x2, x3) { GLctx['stencilFuncSeparate'](x0, x1, x2, x3) }

  function _emscripten_glStencilMask(x0) { GLctx['stencilMask'](x0) }

  function _emscripten_glStencilMaskSeparate(x0, x1) { GLctx['stencilMaskSeparate'](x0, x1) }

  function _emscripten_glStencilOp(x0, x1, x2) { GLctx['stencilOp'](x0, x1, x2) }

  function _emscripten_glStencilOpSeparate(x0, x1, x2, x3) { GLctx['stencilOpSeparate'](x0, x1, x2, x3) }

  function _emscripten_glTexImage2D(target, level, internalFormat, width, height, border, format, type, pixels) {
      GLctx.texImage2D(target, level, internalFormat, width, height, border, format, type, pixels ? emscriptenWebGLGetTexPixelData(type, format, width, height, pixels, internalFormat) : null);
    }

  function _emscripten_glTexParameterf(x0, x1, x2) { GLctx['texParameterf'](x0, x1, x2) }

  function _emscripten_glTexParameterfv(target, pname, params) {
      var param = HEAPF32[((params)>>2)];
      GLctx.texParameterf(target, pname, param);
    }

  function _emscripten_glTexParameteri(x0, x1, x2) { GLctx['texParameteri'](x0, x1, x2) }

  function _emscripten_glTexParameteriv(target, pname, params) {
      var param = HEAP32[((params)>>2)];
      GLctx.texParameteri(target, pname, param);
    }

  function _emscripten_glTexSubImage2D(target, level, xoffset, yoffset, width, height, format, type, pixels) {
      var pixelData = null;
      if (pixels) pixelData = emscriptenWebGLGetTexPixelData(type, format, width, height, pixels, 0);
      GLctx.texSubImage2D(target, level, xoffset, yoffset, width, height, format, type, pixelData);
    }

  function _emscripten_glUniform1f(location, v0) {
      GLctx.uniform1f(GL.uniforms[location], v0);
    }

  function _emscripten_glUniform1fv(location, count, value) {
  
  
      if (count <= GL.MINI_TEMP_BUFFER_SIZE) {
        // avoid allocation when uploading few enough uniforms
        var view = GL.miniTempBufferFloatViews[count-1];
        for (var i = 0; i < count; ++i) {
          view[i] = HEAPF32[(((value)+(4*i))>>2)];
        }
      } else
      {
        var view = HEAPF32.subarray((value)>>2,(value+count*4)>>2);
      }
      GLctx.uniform1fv(GL.uniforms[location], view);
    }

  function _emscripten_glUniform1i(location, v0) {
      GLctx.uniform1i(GL.uniforms[location], v0);
    }

  function _emscripten_glUniform1iv(location, count, value) {
  
  
      if (count <= GL.MINI_TEMP_BUFFER_SIZE) {
        // avoid allocation when uploading few enough uniforms
        var view = GL.miniTempBufferIntViews[count-1];
        for (var i = 0; i < count; ++i) {
          view[i] = HEAP32[(((value)+(4*i))>>2)];
        }
      } else
      {
        var view = HEAP32.subarray((value)>>2,(value+count*4)>>2);
      }
      GLctx.uniform1iv(GL.uniforms[location], view);
    }

  function _emscripten_glUniform2f(location, v0, v1) {
      GLctx.uniform2f(GL.uniforms[location], v0, v1);
    }

  function _emscripten_glUniform2fv(location, count, value) {
  
  
      if (2*count <= GL.MINI_TEMP_BUFFER_SIZE) {
        // avoid allocation when uploading few enough uniforms
        var view = GL.miniTempBufferFloatViews[2*count-1];
        for (var i = 0; i < 2*count; i += 2) {
          view[i] = HEAPF32[(((value)+(4*i))>>2)];
          view[i+1] = HEAPF32[(((value)+(4*i+4))>>2)];
        }
      } else
      {
        var view = HEAPF32.subarray((value)>>2,(value+count*8)>>2);
      }
      GLctx.uniform2fv(GL.uniforms[location], view);
    }

  function _emscripten_glUniform2i(location, v0, v1) {
      GLctx.uniform2i(GL.uniforms[location], v0, v1);
    }

  function _emscripten_glUniform2iv(location, count, value) {
  
  
      if (2*count <= GL.MINI_TEMP_BUFFER_SIZE) {
        // avoid allocation when uploading few enough uniforms
        var view = GL.miniTempBufferIntViews[2*count-1];
        for (var i = 0; i < 2*count; i += 2) {
          view[i] = HEAP32[(((value)+(4*i))>>2)];
          view[i+1] = HEAP32[(((value)+(4*i+4))>>2)];
        }
      } else
      {
        var view = HEAP32.subarray((value)>>2,(value+count*8)>>2);
      }
      GLctx.uniform2iv(GL.uniforms[location], view);
    }

  function _emscripten_glUniform3f(location, v0, v1, v2) {
      GLctx.uniform3f(GL.uniforms[location], v0, v1, v2);
    }

  function _emscripten_glUniform3fv(location, count, value) {
  
  
      if (3*count <= GL.MINI_TEMP_BUFFER_SIZE) {
        // avoid allocation when uploading few enough uniforms
        var view = GL.miniTempBufferFloatViews[3*count-1];
        for (var i = 0; i < 3*count; i += 3) {
          view[i] = HEAPF32[(((value)+(4*i))>>2)];
          view[i+1] = HEAPF32[(((value)+(4*i+4))>>2)];
          view[i+2] = HEAPF32[(((value)+(4*i+8))>>2)];
        }
      } else
      {
        var view = HEAPF32.subarray((value)>>2,(value+count*12)>>2);
      }
      GLctx.uniform3fv(GL.uniforms[location], view);
    }

  function _emscripten_glUniform3i(location, v0, v1, v2) {
      GLctx.uniform3i(GL.uniforms[location], v0, v1, v2);
    }

  function _emscripten_glUniform3iv(location, count, value) {
  
  
      if (3*count <= GL.MINI_TEMP_BUFFER_SIZE) {
        // avoid allocation when uploading few enough uniforms
        var view = GL.miniTempBufferIntViews[3*count-1];
        for (var i = 0; i < 3*count; i += 3) {
          view[i] = HEAP32[(((value)+(4*i))>>2)];
          view[i+1] = HEAP32[(((value)+(4*i+4))>>2)];
          view[i+2] = HEAP32[(((value)+(4*i+8))>>2)];
        }
      } else
      {
        var view = HEAP32.subarray((value)>>2,(value+count*12)>>2);
      }
      GLctx.uniform3iv(GL.uniforms[location], view);
    }

  function _emscripten_glUniform4f(location, v0, v1, v2, v3) {
      GLctx.uniform4f(GL.uniforms[location], v0, v1, v2, v3);
    }

  function _emscripten_glUniform4fv(location, count, value) {
  
  
      if (4*count <= GL.MINI_TEMP_BUFFER_SIZE) {
        // avoid allocation when uploading few enough uniforms
        var view = GL.miniTempBufferFloatViews[4*count-1];
        for (var i = 0; i < 4*count; i += 4) {
          view[i] = HEAPF32[(((value)+(4*i))>>2)];
          view[i+1] = HEAPF32[(((value)+(4*i+4))>>2)];
          view[i+2] = HEAPF32[(((value)+(4*i+8))>>2)];
          view[i+3] = HEAPF32[(((value)+(4*i+12))>>2)];
        }
      } else
      {
        var view = HEAPF32.subarray((value)>>2,(value+count*16)>>2);
      }
      GLctx.uniform4fv(GL.uniforms[location], view);
    }

  function _emscripten_glUniform4i(location, v0, v1, v2, v3) {
      GLctx.uniform4i(GL.uniforms[location], v0, v1, v2, v3);
    }

  function _emscripten_glUniform4iv(location, count, value) {
  
  
      if (4*count <= GL.MINI_TEMP_BUFFER_SIZE) {
        // avoid allocation when uploading few enough uniforms
        var view = GL.miniTempBufferIntViews[4*count-1];
        for (var i = 0; i < 4*count; i += 4) {
          view[i] = HEAP32[(((value)+(4*i))>>2)];
          view[i+1] = HEAP32[(((value)+(4*i+4))>>2)];
          view[i+2] = HEAP32[(((value)+(4*i+8))>>2)];
          view[i+3] = HEAP32[(((value)+(4*i+12))>>2)];
        }
      } else
      {
        var view = HEAP32.subarray((value)>>2,(value+count*16)>>2);
      }
      GLctx.uniform4iv(GL.uniforms[location], view);
    }

  function _emscripten_glUniformMatrix2fv(location, count, transpose, value) {
  
  
      if (4*count <= GL.MINI_TEMP_BUFFER_SIZE) {
        // avoid allocation when uploading few enough uniforms
        var view = GL.miniTempBufferFloatViews[4*count-1];
        for (var i = 0; i < 4*count; i += 4) {
          view[i] = HEAPF32[(((value)+(4*i))>>2)];
          view[i+1] = HEAPF32[(((value)+(4*i+4))>>2)];
          view[i+2] = HEAPF32[(((value)+(4*i+8))>>2)];
          view[i+3] = HEAPF32[(((value)+(4*i+12))>>2)];
        }
      } else
      {
        var view = HEAPF32.subarray((value)>>2,(value+count*16)>>2);
      }
      GLctx.uniformMatrix2fv(GL.uniforms[location], !!transpose, view);
    }

  function _emscripten_glUniformMatrix3fv(location, count, transpose, value) {
  
  
      if (9*count <= GL.MINI_TEMP_BUFFER_SIZE) {
        // avoid allocation when uploading few enough uniforms
        var view = GL.miniTempBufferFloatViews[9*count-1];
        for (var i = 0; i < 9*count; i += 9) {
          view[i] = HEAPF32[(((value)+(4*i))>>2)];
          view[i+1] = HEAPF32[(((value)+(4*i+4))>>2)];
          view[i+2] = HEAPF32[(((value)+(4*i+8))>>2)];
          view[i+3] = HEAPF32[(((value)+(4*i+12))>>2)];
          view[i+4] = HEAPF32[(((value)+(4*i+16))>>2)];
          view[i+5] = HEAPF32[(((value)+(4*i+20))>>2)];
          view[i+6] = HEAPF32[(((value)+(4*i+24))>>2)];
          view[i+7] = HEAPF32[(((value)+(4*i+28))>>2)];
          view[i+8] = HEAPF32[(((value)+(4*i+32))>>2)];
        }
      } else
      {
        var view = HEAPF32.subarray((value)>>2,(value+count*36)>>2);
      }
      GLctx.uniformMatrix3fv(GL.uniforms[location], !!transpose, view);
    }

  function _emscripten_glUniformMatrix4fv(location, count, transpose, value) {
  
  
      if (16*count <= GL.MINI_TEMP_BUFFER_SIZE) {
        // avoid allocation when uploading few enough uniforms
        var view = GL.miniTempBufferFloatViews[16*count-1];
        for (var i = 0; i < 16*count; i += 16) {
          view[i] = HEAPF32[(((value)+(4*i))>>2)];
          view[i+1] = HEAPF32[(((value)+(4*i+4))>>2)];
          view[i+2] = HEAPF32[(((value)+(4*i+8))>>2)];
          view[i+3] = HEAPF32[(((value)+(4*i+12))>>2)];
          view[i+4] = HEAPF32[(((value)+(4*i+16))>>2)];
          view[i+5] = HEAPF32[(((value)+(4*i+20))>>2)];
          view[i+6] = HEAPF32[(((value)+(4*i+24))>>2)];
          view[i+7] = HEAPF32[(((value)+(4*i+28))>>2)];
          view[i+8] = HEAPF32[(((value)+(4*i+32))>>2)];
          view[i+9] = HEAPF32[(((value)+(4*i+36))>>2)];
          view[i+10] = HEAPF32[(((value)+(4*i+40))>>2)];
          view[i+11] = HEAPF32[(((value)+(4*i+44))>>2)];
          view[i+12] = HEAPF32[(((value)+(4*i+48))>>2)];
          view[i+13] = HEAPF32[(((value)+(4*i+52))>>2)];
          view[i+14] = HEAPF32[(((value)+(4*i+56))>>2)];
          view[i+15] = HEAPF32[(((value)+(4*i+60))>>2)];
        }
      } else
      {
        var view = HEAPF32.subarray((value)>>2,(value+count*64)>>2);
      }
      GLctx.uniformMatrix4fv(GL.uniforms[location], !!transpose, view);
    }

  function _emscripten_glUseProgram(program) {
      GLctx.useProgram(GL.programs[program]);
    }

  function _emscripten_glValidateProgram(program) {
      GLctx.validateProgram(GL.programs[program]);
    }

  function _emscripten_glVertexAttrib1f(x0, x1) { GLctx['vertexAttrib1f'](x0, x1) }

  function _emscripten_glVertexAttrib1fv(index, v) {
  
      GLctx.vertexAttrib1f(index, HEAPF32[v>>2]);
    }

  function _emscripten_glVertexAttrib2f(x0, x1, x2) { GLctx['vertexAttrib2f'](x0, x1, x2) }

  function _emscripten_glVertexAttrib2fv(index, v) {
  
      GLctx.vertexAttrib2f(index, HEAPF32[v>>2], HEAPF32[v+4>>2]);
    }

  function _emscripten_glVertexAttrib3f(x0, x1, x2, x3) { GLctx['vertexAttrib3f'](x0, x1, x2, x3) }

  function _emscripten_glVertexAttrib3fv(index, v) {
  
      GLctx.vertexAttrib3f(index, HEAPF32[v>>2], HEAPF32[v+4>>2], HEAPF32[v+8>>2]);
    }

  function _emscripten_glVertexAttrib4f(x0, x1, x2, x3, x4) { GLctx['vertexAttrib4f'](x0, x1, x2, x3, x4) }

  function _emscripten_glVertexAttrib4fv(index, v) {
  
      GLctx.vertexAttrib4f(index, HEAPF32[v>>2], HEAPF32[v+4>>2], HEAPF32[v+8>>2], HEAPF32[v+12>>2]);
    }

  function _emscripten_glVertexAttribDivisorANGLE(index, divisor) {
      GLctx['vertexAttribDivisor'](index, divisor);
    }

  function _emscripten_glVertexAttribPointer(index, size, type, normalized, stride, ptr) {
      GLctx.vertexAttribPointer(index, size, type, !!normalized, stride, ptr);
    }

  function _emscripten_glViewport(x0, x1, x2, x3) { GLctx['viewport'](x0, x1, x2, x3) }

  function _emscripten_request_pointerlock(target, deferUntilInEventHandler) {
      target = __findEventTarget(target);
      if (!target) return -4;
      if (!target.requestPointerLock
        && !target.msRequestPointerLock
        ) {
        return -1;
      }
  
      var canPerformRequests = JSEvents.canPerformEventHandlerRequests();
  
      // Queue this function call if we're not currently in an event handler and the user saw it appropriate to do so.
      if (!canPerformRequests) {
        if (deferUntilInEventHandler) {
          JSEvents.deferCall(__requestPointerLock, 2 /* priority below fullscreen */, [target]);
          return 1;
        } else {
          return -2;
        }
      }
  
      return __requestPointerLock(target);
    }

  
  function abortOnCannotGrowMemory(requestedSize) {
      abort('Cannot enlarge memory arrays to size ' + requestedSize + ' bytes (OOM). Either (1) compile with  -s TOTAL_MEMORY=X  with X higher than the current value ' + HEAP8.length + ', (2) compile with  -s ALLOW_MEMORY_GROWTH=1  which allows increasing the size at runtime, or (3) if you want malloc to return NULL (0) instead of this abort, compile with  -s ABORTING_MALLOC=0 ');
    }function _emscripten_resize_heap(requestedSize) {
      abortOnCannotGrowMemory(requestedSize);
    }

  function _emscripten_run_script(ptr) {
      eval(UTF8ToString(ptr));
    }

  function _emscripten_sample_gamepad_data() {
      return (JSEvents.lastGamepadState = (navigator.getGamepads ? navigator.getGamepads() : (navigator.webkitGetGamepads ? navigator.webkitGetGamepads() : null)))
        ? 0 : -1;
    }

  
  
  function __fillMouseEventData(eventStruct, e, target) {
      HEAP32[((eventStruct)>>2)]=e.screenX;
      HEAP32[(((eventStruct)+(4))>>2)]=e.screenY;
      HEAP32[(((eventStruct)+(8))>>2)]=e.clientX;
      HEAP32[(((eventStruct)+(12))>>2)]=e.clientY;
      HEAP32[(((eventStruct)+(16))>>2)]=e.ctrlKey;
      HEAP32[(((eventStruct)+(20))>>2)]=e.shiftKey;
      HEAP32[(((eventStruct)+(24))>>2)]=e.altKey;
      HEAP32[(((eventStruct)+(28))>>2)]=e.metaKey;
      HEAP16[(((eventStruct)+(32))>>1)]=e.button;
      HEAP16[(((eventStruct)+(34))>>1)]=e.buttons;
      var movementX = e["movementX"]
        || (e.screenX-JSEvents.previousScreenX)
        ;
      var movementY = e["movementY"]
        || (e.screenY-JSEvents.previousScreenY)
        ;
  
      HEAP32[(((eventStruct)+(36))>>2)]=movementX;
      HEAP32[(((eventStruct)+(40))>>2)]=movementY;
  
      var rect = __specialEventTargets.indexOf(target) < 0 ? __getBoundingClientRect(target) : {'left':0,'top':0};
      HEAP32[(((eventStruct)+(44))>>2)]=e.clientX - rect.left;
      HEAP32[(((eventStruct)+(48))>>2)]=e.clientY - rect.top;
  
      // wheel and mousewheel events contain wrong screenX/screenY on chrome/opera
        // https://github.com/emscripten-core/emscripten/pull/4997
      // https://bugs.chromium.org/p/chromium/issues/detail?id=699956
      if (e.type !== 'wheel' && e.type !== 'mousewheel') {
        JSEvents.previousScreenX = e.screenX;
        JSEvents.previousScreenY = e.screenY;
      }
    }function __registerMouseEventCallback(target, userData, useCapture, callbackfunc, eventTypeId, eventTypeString, targetThread) {
      if (!JSEvents.mouseEvent) JSEvents.mouseEvent = _malloc( 64 );
      target = __findEventTarget(target);
  
      var mouseEventHandlerFunc = function(ev) {
        var e = ev || event;
  
        // TODO: Make this access thread safe, or this could update live while app is reading it.
        __fillMouseEventData(JSEvents.mouseEvent, e, target);
  
        if (dynCall_iiii(callbackfunc, eventTypeId, JSEvents.mouseEvent, userData)) e.preventDefault();
      };
  
      var eventHandler = {
        target: target,
        allowsDeferredCalls: eventTypeString != 'mousemove' && eventTypeString != 'mouseenter' && eventTypeString != 'mouseleave', // Mouse move events do not allow fullscreen/pointer lock requests to be handled in them!
        eventTypeString: eventTypeString,
        callbackfunc: callbackfunc,
        handlerFunc: mouseEventHandlerFunc,
        useCapture: useCapture
      };
      JSEvents.registerOrRemoveHandler(eventHandler);
    }function _emscripten_set_click_callback_on_thread(target, userData, useCapture, callbackfunc, targetThread) {
      __registerMouseEventCallback(target, userData, useCapture, callbackfunc, 4, "click", targetThread);
      return 0;
    }

  
  
  function __fillFullscreenChangeEventData(eventStruct, e) {
      var fullscreenElement = document.fullscreenElement || document.mozFullScreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
      var isFullscreen = !!fullscreenElement;
      HEAP32[((eventStruct)>>2)]=isFullscreen;
      HEAP32[(((eventStruct)+(4))>>2)]=JSEvents.fullscreenEnabled();
      // If transitioning to fullscreen, report info about the element that is now fullscreen.
      // If transitioning to windowed mode, report info about the element that just was fullscreen.
      var reportedElement = isFullscreen ? fullscreenElement : JSEvents.previousFullscreenElement;
      var nodeName = JSEvents.getNodeNameForTarget(reportedElement);
      var id = (reportedElement && reportedElement.id) ? reportedElement.id : '';
      stringToUTF8(nodeName, eventStruct + 8, 128);
      stringToUTF8(id, eventStruct + 136, 128);
      HEAP32[(((eventStruct)+(264))>>2)]=reportedElement ? reportedElement.clientWidth : 0;
      HEAP32[(((eventStruct)+(268))>>2)]=reportedElement ? reportedElement.clientHeight : 0;
      HEAP32[(((eventStruct)+(272))>>2)]=screen.width;
      HEAP32[(((eventStruct)+(276))>>2)]=screen.height;
      if (isFullscreen) {
        JSEvents.previousFullscreenElement = fullscreenElement;
      }
    }function __registerFullscreenChangeEventCallback(target, userData, useCapture, callbackfunc, eventTypeId, eventTypeString, targetThread) {
      if (!JSEvents.fullscreenChangeEvent) JSEvents.fullscreenChangeEvent = _malloc( 280 );
  
      var fullscreenChangeEventhandlerFunc = function(ev) {
        var e = ev || event;
  
        var fullscreenChangeEvent = JSEvents.fullscreenChangeEvent;
  
        __fillFullscreenChangeEventData(fullscreenChangeEvent, e);
  
        if (dynCall_iiii(callbackfunc, eventTypeId, fullscreenChangeEvent, userData)) e.preventDefault();
      };
  
      var eventHandler = {
        target: target,
        allowsDeferredCalls: false,
        eventTypeString: eventTypeString,
        callbackfunc: callbackfunc,
        handlerFunc: fullscreenChangeEventhandlerFunc,
        useCapture: useCapture
      };
      JSEvents.registerOrRemoveHandler(eventHandler);
    }function _emscripten_set_fullscreenchange_callback_on_thread(target, userData, useCapture, callbackfunc, targetThread) {
      if (!JSEvents.fullscreenEnabled()) return -1;
      target = __findEventTarget(target);
      if (!target) return -4;
      __registerFullscreenChangeEventCallback(target, userData, useCapture, callbackfunc, 19, "fullscreenchange", targetThread);
  
  
      // Unprefixed Fullscreen API shipped in Chromium 71 (https://bugs.chromium.org/p/chromium/issues/detail?id=383813)
      // As of Safari 13.0.3 on macOS Catalina 10.15.1 still ships with prefixed webkitfullscreenchange. TODO: revisit this check once Safari ships unprefixed version.
      __registerFullscreenChangeEventCallback(target, userData, useCapture, callbackfunc, 19, "webkitfullscreenchange", targetThread);
  
      return 0;
    }

  
  function __registerGamepadEventCallback(target, userData, useCapture, callbackfunc, eventTypeId, eventTypeString, targetThread) {
      if (!JSEvents.gamepadEvent) JSEvents.gamepadEvent = _malloc( 1432 );
  
      var gamepadEventHandlerFunc = function(ev) {
        var e = ev || event;
  
        var gamepadEvent = JSEvents.gamepadEvent;
        __fillGamepadEventData(gamepadEvent, e["gamepad"]);
  
        if (dynCall_iiii(callbackfunc, eventTypeId, gamepadEvent, userData)) e.preventDefault();
      };
  
      var eventHandler = {
        target: __findEventTarget(target),
        allowsDeferredCalls: true,
        eventTypeString: eventTypeString,
        callbackfunc: callbackfunc,
        handlerFunc: gamepadEventHandlerFunc,
        useCapture: useCapture
      };
      JSEvents.registerOrRemoveHandler(eventHandler);
    }function _emscripten_set_gamepadconnected_callback_on_thread(userData, useCapture, callbackfunc, targetThread) {
      if (!navigator.getGamepads && !navigator.webkitGetGamepads) return -1;
      __registerGamepadEventCallback(2, userData, useCapture, callbackfunc, 26, "gamepadconnected", targetThread);
      return 0;
    }

  function _emscripten_set_gamepaddisconnected_callback_on_thread(userData, useCapture, callbackfunc, targetThread) {
      if (!navigator.getGamepads && !navigator.webkitGetGamepads) return -1;
      __registerGamepadEventCallback(2, userData, useCapture, callbackfunc, 27, "gamepaddisconnected", targetThread);
      return 0;
    }

  
  function __registerKeyEventCallback(target, userData, useCapture, callbackfunc, eventTypeId, eventTypeString, targetThread) {
      if (!JSEvents.keyEvent) JSEvents.keyEvent = _malloc( 164 );
  
      var keyEventHandlerFunc = function(ev) {
        var e = ev || event;
  
        var keyEventData = JSEvents.keyEvent;
        stringToUTF8(e.key ? e.key : "", keyEventData + 0, 32);
        stringToUTF8(e.code ? e.code : "", keyEventData + 32, 32);
        HEAP32[(((keyEventData)+(64))>>2)]=e.location;
        HEAP32[(((keyEventData)+(68))>>2)]=e.ctrlKey;
        HEAP32[(((keyEventData)+(72))>>2)]=e.shiftKey;
        HEAP32[(((keyEventData)+(76))>>2)]=e.altKey;
        HEAP32[(((keyEventData)+(80))>>2)]=e.metaKey;
        HEAP32[(((keyEventData)+(84))>>2)]=e.repeat;
        stringToUTF8(e.locale ? e.locale : "", keyEventData + 88, 32);
        stringToUTF8(e.char ? e.char : "", keyEventData + 120, 32);
        HEAP32[(((keyEventData)+(152))>>2)]=e.charCode;
        HEAP32[(((keyEventData)+(156))>>2)]=e.keyCode;
        HEAP32[(((keyEventData)+(160))>>2)]=e.which;
  
        if (dynCall_iiii(callbackfunc, eventTypeId, keyEventData, userData)) e.preventDefault();
      };
  
      var eventHandler = {
        target: __findEventTarget(target),
        allowsDeferredCalls: true,
        eventTypeString: eventTypeString,
        callbackfunc: callbackfunc,
        handlerFunc: keyEventHandlerFunc,
        useCapture: useCapture
      };
      JSEvents.registerOrRemoveHandler(eventHandler);
    }function _emscripten_set_keypress_callback_on_thread(target, userData, useCapture, callbackfunc, targetThread) {
      __registerKeyEventCallback(target, userData, useCapture, callbackfunc, 1, "keypress", targetThread);
      return 0;
    }


  
  function __registerTouchEventCallback(target, userData, useCapture, callbackfunc, eventTypeId, eventTypeString, targetThread) {
      if (!JSEvents.touchEvent) JSEvents.touchEvent = _malloc( 1684 );
  
      target = __findEventTarget(target);
  
      var touchEventHandlerFunc = function(ev) {
        var e = ev || event;
  
        var touches = {};
        for(var i = 0; i < e.touches.length; ++i) {
          var touch = e.touches[i];
          touch.changed = false;
          touches[touch.identifier] = touch;
        }
        for(var i = 0; i < e.changedTouches.length; ++i) {
          var touch = e.changedTouches[i];
          touches[touch.identifier] = touch;
          touch.changed = true;
        }
        for(var i = 0; i < e.targetTouches.length; ++i) {
          var touch = e.targetTouches[i];
          touches[touch.identifier].onTarget = true;
        }
  
        var touchEvent = JSEvents.touchEvent;
        var ptr = touchEvent;
        HEAP32[(((ptr)+(4))>>2)]=e.ctrlKey;
        HEAP32[(((ptr)+(8))>>2)]=e.shiftKey;
        HEAP32[(((ptr)+(12))>>2)]=e.altKey;
        HEAP32[(((ptr)+(16))>>2)]=e.metaKey;
        ptr += 20; // Advance to the start of the touch array.
        var targetRect = __getBoundingClientRect(target);
        var numTouches = 0;
        for(var i in touches) {
          var t = touches[i];
          HEAP32[((ptr)>>2)]=t.identifier;
          HEAP32[(((ptr)+(4))>>2)]=t.screenX;
          HEAP32[(((ptr)+(8))>>2)]=t.screenY;
          HEAP32[(((ptr)+(12))>>2)]=t.clientX;
          HEAP32[(((ptr)+(16))>>2)]=t.clientY;
          HEAP32[(((ptr)+(20))>>2)]=t.pageX;
          HEAP32[(((ptr)+(24))>>2)]=t.pageY;
          HEAP32[(((ptr)+(28))>>2)]=t.changed;
          HEAP32[(((ptr)+(32))>>2)]=t.onTarget;
          HEAP32[(((ptr)+(36))>>2)]=t.clientX - targetRect.left;
          HEAP32[(((ptr)+(40))>>2)]=t.clientY - targetRect.top;
  
          ptr += 52;
  
          if (++numTouches >= 32) {
            break;
          }
        }
        HEAP32[((touchEvent)>>2)]=numTouches;
  
        if (dynCall_iiii(callbackfunc, eventTypeId, touchEvent, userData)) e.preventDefault();
      };
  
      var eventHandler = {
        target: target,
        allowsDeferredCalls: eventTypeString == 'touchstart' || eventTypeString == 'touchend',
        eventTypeString: eventTypeString,
        callbackfunc: callbackfunc,
        handlerFunc: touchEventHandlerFunc,
        useCapture: useCapture
      };
      JSEvents.registerOrRemoveHandler(eventHandler);
    }function _emscripten_set_touchcancel_callback_on_thread(target, userData, useCapture, callbackfunc, targetThread) {
      __registerTouchEventCallback(target, userData, useCapture, callbackfunc, 25, "touchcancel", targetThread);
      return 0;
    }

  function _emscripten_set_touchend_callback_on_thread(target, userData, useCapture, callbackfunc, targetThread) {
      __registerTouchEventCallback(target, userData, useCapture, callbackfunc, 23, "touchend", targetThread);
      return 0;
    }

  function _emscripten_set_touchmove_callback_on_thread(target, userData, useCapture, callbackfunc, targetThread) {
      __registerTouchEventCallback(target, userData, useCapture, callbackfunc, 24, "touchmove", targetThread);
      return 0;
    }

  function _emscripten_set_touchstart_callback_on_thread(target, userData, useCapture, callbackfunc, targetThread) {
      __registerTouchEventCallback(target, userData, useCapture, callbackfunc, 22, "touchstart", targetThread);
      return 0;
    }

  function _exit(status) {
      // void _exit(int status);
      // http://pubs.opengroup.org/onlinepubs/000095399/functions/exit.html
      exit(status);
    }

  function _glActiveTexture(x0) { GLctx['activeTexture'](x0) }

  function _glAttachShader(program, shader) {
      GLctx.attachShader(GL.programs[program],
                              GL.shaders[shader]);
    }

  function _glBindAttribLocation(program, index, name) {
      GLctx.bindAttribLocation(GL.programs[program], index, UTF8ToString(name));
    }

  function _glBindBuffer(target, buffer) {
  
      GLctx.bindBuffer(target, GL.buffers[buffer]);
    }

  function _glBindTexture(target, texture) {
      GLctx.bindTexture(target, GL.textures[texture]);
    }

  function _glBlendFunc(x0, x1) { GLctx['blendFunc'](x0, x1) }

  function _glBufferData(target, size, data, usage) {
        // N.b. here first form specifies a heap subarray, second form an integer size, so the ?: code here is polymorphic. It is advised to avoid
        // randomly mixing both uses in calling code, to avoid any potential JS engine JIT issues.
        GLctx.bufferData(target, data ? HEAPU8.subarray(data, data+size) : size, usage);
    }

  function _glBufferSubData(target, offset, size, data) {
      GLctx.bufferSubData(target, offset, HEAPU8.subarray(data, data+size));
    }

  function _glClear(x0) { GLctx['clear'](x0) }

  function _glClearColor(x0, x1, x2, x3) { GLctx['clearColor'](x0, x1, x2, x3) }

  function _glClearDepthf(x0) { GLctx['clearDepth'](x0) }

  function _glCompileShader(shader) {
      GLctx.compileShader(GL.shaders[shader]);
    }

  function _glCompressedTexImage2D(target, level, internalFormat, width, height, border, imageSize, data) {
      GLctx['compressedTexImage2D'](target, level, internalFormat, width, height, border, data ? HEAPU8.subarray((data),(data+imageSize)) : null);
    }

  function _glCreateProgram() {
      var id = GL.getNewId(GL.programs);
      var program = GLctx.createProgram();
      program.name = id;
      GL.programs[id] = program;
      return id;
    }

  function _glCreateShader(shaderType) {
      var id = GL.getNewId(GL.shaders);
      GL.shaders[id] = GLctx.createShader(shaderType);
      return id;
    }

  function _glCullFace(x0) { GLctx['cullFace'](x0) }

  function _glDeleteProgram(id) {
      if (!id) return;
      var program = GL.programs[id];
      if (!program) { // glDeleteProgram actually signals an error when deleting a nonexisting object, unlike some other GL delete functions.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      GLctx.deleteProgram(program);
      program.name = 0;
      GL.programs[id] = null;
      GL.programInfos[id] = null;
    }

  function _glDepthFunc(x0) { GLctx['depthFunc'](x0) }

  function _glDisable(x0) { GLctx['disable'](x0) }

  function _glDrawArrays(mode, first, count) {
  
      GLctx.drawArrays(mode, first, count);
  
    }

  function _glDrawElements(mode, count, type, indices) {
  
      GLctx.drawElements(mode, count, type, indices);
  
    }

  function _glEnable(x0) { GLctx['enable'](x0) }

  function _glEnableVertexAttribArray(index) {
      GLctx.enableVertexAttribArray(index);
    }

  function _glFrontFace(x0) { GLctx['frontFace'](x0) }

  function _glGenBuffers(n, buffers) {
      __glGenObject(n, buffers, 'createBuffer', GL.buffers
        );
    }

  function _glGenTextures(n, textures) {
      __glGenObject(n, textures, 'createTexture', GL.textures
        );
    }

  function _glGetAttribLocation(program, name) {
      return GLctx.getAttribLocation(GL.programs[program], UTF8ToString(name));
    }

  function _glGetFloatv(name_, p) {
      emscriptenWebGLGet(name_, p, 2);
    }

  function _glGetProgramInfoLog(program, maxLength, length, infoLog) {
      var log = GLctx.getProgramInfoLog(GL.programs[program]);
      if (log === null) log = '(unknown error)';
      var numBytesWrittenExclNull = (maxLength > 0 && infoLog) ? stringToUTF8(log, infoLog, maxLength) : 0;
      if (length) HEAP32[((length)>>2)]=numBytesWrittenExclNull;
    }

  function _glGetProgramiv(program, pname, p) {
      if (!p) {
        // GLES2 specification does not specify how to behave if p is a null pointer. Since calling this function does not make sense
        // if p == null, issue a GL error to notify user about it.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
  
      if (program >= GL.counter) {
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
  
      var ptable = GL.programInfos[program];
      if (!ptable) {
        GL.recordError(0x0502 /* GL_INVALID_OPERATION */);
        return;
      }
  
      if (pname == 0x8B84) { // GL_INFO_LOG_LENGTH
        var log = GLctx.getProgramInfoLog(GL.programs[program]);
        if (log === null) log = '(unknown error)';
        HEAP32[((p)>>2)]=log.length + 1;
      } else if (pname == 0x8B87 /* GL_ACTIVE_UNIFORM_MAX_LENGTH */) {
        HEAP32[((p)>>2)]=ptable.maxUniformLength;
      } else if (pname == 0x8B8A /* GL_ACTIVE_ATTRIBUTE_MAX_LENGTH */) {
        if (ptable.maxAttributeLength == -1) {
          program = GL.programs[program];
          var numAttribs = GLctx.getProgramParameter(program, 0x8B89/*GL_ACTIVE_ATTRIBUTES*/);
          ptable.maxAttributeLength = 0; // Spec says if there are no active attribs, 0 must be returned.
          for (var i = 0; i < numAttribs; ++i) {
            var activeAttrib = GLctx.getActiveAttrib(program, i);
            ptable.maxAttributeLength = Math.max(ptable.maxAttributeLength, activeAttrib.name.length+1);
          }
        }
        HEAP32[((p)>>2)]=ptable.maxAttributeLength;
      } else if (pname == 0x8A35 /* GL_ACTIVE_UNIFORM_BLOCK_MAX_NAME_LENGTH */) {
        if (ptable.maxUniformBlockNameLength == -1) {
          program = GL.programs[program];
          var numBlocks = GLctx.getProgramParameter(program, 0x8A36/*GL_ACTIVE_UNIFORM_BLOCKS*/);
          ptable.maxUniformBlockNameLength = 0;
          for (var i = 0; i < numBlocks; ++i) {
            var activeBlockName = GLctx.getActiveUniformBlockName(program, i);
            ptable.maxUniformBlockNameLength = Math.max(ptable.maxUniformBlockNameLength, activeBlockName.length+1);
          }
        }
        HEAP32[((p)>>2)]=ptable.maxUniformBlockNameLength;
      } else {
        HEAP32[((p)>>2)]=GLctx.getProgramParameter(GL.programs[program], pname);
      }
    }

  function _glGetShaderInfoLog(shader, maxLength, length, infoLog) {
      var log = GLctx.getShaderInfoLog(GL.shaders[shader]);
      if (log === null) log = '(unknown error)';
      var numBytesWrittenExclNull = (maxLength > 0 && infoLog) ? stringToUTF8(log, infoLog, maxLength) : 0;
      if (length) HEAP32[((length)>>2)]=numBytesWrittenExclNull;
    }

  function _glGetShaderiv(shader, pname, p) {
      if (!p) {
        // GLES2 specification does not specify how to behave if p is a null pointer. Since calling this function does not make sense
        // if p == null, issue a GL error to notify user about it.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      if (pname == 0x8B84) { // GL_INFO_LOG_LENGTH
        var log = GLctx.getShaderInfoLog(GL.shaders[shader]);
        if (log === null) log = '(unknown error)';
        HEAP32[((p)>>2)]=log.length + 1;
      } else if (pname == 0x8B88) { // GL_SHADER_SOURCE_LENGTH
        var source = GLctx.getShaderSource(GL.shaders[shader]);
        var sourceLength = (source === null || source.length == 0) ? 0 : source.length + 1;
        HEAP32[((p)>>2)]=sourceLength;
      } else {
        HEAP32[((p)>>2)]=GLctx.getShaderParameter(GL.shaders[shader], pname);
      }
    }

  function _glGetString(name_) {
      if (GL.stringCache[name_]) return GL.stringCache[name_];
      var ret;
      switch(name_) {
        case 0x1F03 /* GL_EXTENSIONS */:
          var exts = GLctx.getSupportedExtensions() || []; // .getSupportedExtensions() can return null if context is lost, so coerce to empty array.
          exts = exts.concat(exts.map(function(e) { return "GL_" + e; }));
          ret = stringToNewUTF8(exts.join(' '));
          break;
        case 0x1F00 /* GL_VENDOR */:
        case 0x1F01 /* GL_RENDERER */:
        case 0x9245 /* UNMASKED_VENDOR_WEBGL */:
        case 0x9246 /* UNMASKED_RENDERER_WEBGL */:
          var s = GLctx.getParameter(name_);
          if (!s) {
            GL.recordError(0x0500/*GL_INVALID_ENUM*/);
          }
          ret = stringToNewUTF8(s);
          break;
  
        case 0x1F02 /* GL_VERSION */:
          var glVersion = GLctx.getParameter(GLctx.VERSION);
          // return GLES version string corresponding to the version of the WebGL context
          {
            glVersion = 'OpenGL ES 2.0 (' + glVersion + ')';
          }
          ret = stringToNewUTF8(glVersion);
          break;
        case 0x8B8C /* GL_SHADING_LANGUAGE_VERSION */:
          var glslVersion = GLctx.getParameter(GLctx.SHADING_LANGUAGE_VERSION);
          // extract the version number 'N.M' from the string 'WebGL GLSL ES N.M ...'
          var ver_re = /^WebGL GLSL ES ([0-9]\.[0-9][0-9]?)(?:$| .*)/;
          var ver_num = glslVersion.match(ver_re);
          if (ver_num !== null) {
            if (ver_num[1].length == 3) ver_num[1] = ver_num[1] + '0'; // ensure minor version has 2 digits
            glslVersion = 'OpenGL ES GLSL ES ' + ver_num[1] + ' (' + glslVersion + ')';
          }
          ret = stringToNewUTF8(glslVersion);
          break;
        default:
          GL.recordError(0x0500/*GL_INVALID_ENUM*/);
          return 0;
      }
      GL.stringCache[name_] = ret;
      return ret;
    }

  function _glGetUniformLocation(program, name) {
      name = UTF8ToString(name);
  
      var arrayIndex = 0;
      // If user passed an array accessor "[index]", parse the array index off the accessor.
      if (name[name.length - 1] == ']') {
        var leftBrace = name.lastIndexOf('[');
        arrayIndex = name[leftBrace+1] != ']' ? parseInt(name.slice(leftBrace + 1)) : 0; // "index]", parseInt will ignore the ']' at the end; but treat "foo[]" as "foo[0]"
        name = name.slice(0, leftBrace);
      }
  
      var uniformInfo = GL.programInfos[program] && GL.programInfos[program].uniforms[name]; // returns pair [ dimension_of_uniform_array, uniform_location ]
      if (uniformInfo && arrayIndex >= 0 && arrayIndex < uniformInfo[0]) { // Check if user asked for an out-of-bounds element, i.e. for 'vec4 colors[3];' user could ask for 'colors[10]' which should return -1.
        return uniformInfo[1] + arrayIndex;
      } else {
        return -1;
      }
    }

  function _glLinkProgram(program) {
      GLctx.linkProgram(GL.programs[program]);
      GL.populateUniformTable(program);
    }

  function _glPixelStorei(pname, param) {
      if (pname == 0x0cf5 /* GL_UNPACK_ALIGNMENT */) {
        GL.unpackAlignment = param;
      }
      GLctx.pixelStorei(pname, param);
    }

  function _glReadPixels(x, y, width, height, format, type, pixels) {
      var pixelData = emscriptenWebGLGetTexPixelData(type, format, width, height, pixels, format);
      if (!pixelData) {
        GL.recordError(0x0500/*GL_INVALID_ENUM*/);
        return;
      }
      GLctx.readPixels(x, y, width, height, format, type, pixelData);
    }

  function _glShaderSource(shader, count, string, length) {
      var source = GL.getSource(shader, count, string, length);
  
  
      GLctx.shaderSource(GL.shaders[shader], source);
    }

  function _glTexImage2D(target, level, internalFormat, width, height, border, format, type, pixels) {
      GLctx.texImage2D(target, level, internalFormat, width, height, border, format, type, pixels ? emscriptenWebGLGetTexPixelData(type, format, width, height, pixels, internalFormat) : null);
    }

  function _glTexParameteri(x0, x1, x2) { GLctx['texParameteri'](x0, x1, x2) }

  function _glUniform1i(location, v0) {
      GLctx.uniform1i(GL.uniforms[location], v0);
    }

  function _glUniform4f(location, v0, v1, v2, v3) {
      GLctx.uniform4f(GL.uniforms[location], v0, v1, v2, v3);
    }

  function _glUniformMatrix4fv(location, count, transpose, value) {
  
  
      if (16*count <= GL.MINI_TEMP_BUFFER_SIZE) {
        // avoid allocation when uploading few enough uniforms
        var view = GL.miniTempBufferFloatViews[16*count-1];
        for (var i = 0; i < 16*count; i += 16) {
          view[i] = HEAPF32[(((value)+(4*i))>>2)];
          view[i+1] = HEAPF32[(((value)+(4*i+4))>>2)];
          view[i+2] = HEAPF32[(((value)+(4*i+8))>>2)];
          view[i+3] = HEAPF32[(((value)+(4*i+12))>>2)];
          view[i+4] = HEAPF32[(((value)+(4*i+16))>>2)];
          view[i+5] = HEAPF32[(((value)+(4*i+20))>>2)];
          view[i+6] = HEAPF32[(((value)+(4*i+24))>>2)];
          view[i+7] = HEAPF32[(((value)+(4*i+28))>>2)];
          view[i+8] = HEAPF32[(((value)+(4*i+32))>>2)];
          view[i+9] = HEAPF32[(((value)+(4*i+36))>>2)];
          view[i+10] = HEAPF32[(((value)+(4*i+40))>>2)];
          view[i+11] = HEAPF32[(((value)+(4*i+44))>>2)];
          view[i+12] = HEAPF32[(((value)+(4*i+48))>>2)];
          view[i+13] = HEAPF32[(((value)+(4*i+52))>>2)];
          view[i+14] = HEAPF32[(((value)+(4*i+56))>>2)];
          view[i+15] = HEAPF32[(((value)+(4*i+60))>>2)];
        }
      } else
      {
        var view = HEAPF32.subarray((value)>>2,(value+count*64)>>2);
      }
      GLctx.uniformMatrix4fv(GL.uniforms[location], !!transpose, view);
    }

  function _glUseProgram(program) {
      GLctx.useProgram(GL.programs[program]);
    }

  function _glVertexAttribPointer(index, size, type, normalized, stride, ptr) {
      GLctx.vertexAttribPointer(index, size, type, !!normalized, stride, ptr);
    }

  function _glViewport(x0, x1, x2, x3) { GLctx['viewport'](x0, x1, x2, x3) }

  
  var GLFW={Window:function(id, width, height, title, monitor, share) {
        this.id = id;
        this.x = 0;
        this.y = 0;
        this.fullscreen = false; // Used to determine if app in fullscreen mode
        this.storedX = 0; // Used to store X before fullscreen
        this.storedY = 0; // Used to store Y before fullscreen
        this.width = width;
        this.height = height;
        this.storedWidth = width; // Used to store width before fullscreen
        this.storedHeight = height; // Used to store height before fullscreen
        this.title = title;
        this.monitor = monitor;
        this.share = share;
        this.attributes = GLFW.hints;
        this.inputModes = {
          0x00033001:0x00034001, // GLFW_CURSOR (GLFW_CURSOR_NORMAL)
          0x00033002:0, // GLFW_STICKY_KEYS
          0x00033003:0, // GLFW_STICKY_MOUSE_BUTTONS
        };
        this.buttons = 0;
        this.keys = new Array();
        this.domKeys = new Array();
        this.shouldClose = 0;
        this.title = null;
        this.windowPosFunc = null; // GLFWwindowposfun
        this.windowSizeFunc = null; // GLFWwindowsizefun
        this.windowCloseFunc = null; // GLFWwindowclosefun
        this.windowRefreshFunc = null; // GLFWwindowrefreshfun
        this.windowFocusFunc = null; // GLFWwindowfocusfun
        this.windowIconifyFunc = null; // GLFWwindowiconifyfun
        this.framebufferSizeFunc = null; // GLFWframebuffersizefun
        this.mouseButtonFunc = null; // GLFWmousebuttonfun
        this.cursorPosFunc = null; // GLFWcursorposfun
        this.cursorEnterFunc = null; // GLFWcursorenterfun
        this.scrollFunc = null; // GLFWscrollfun
        this.dropFunc = null; // GLFWdropfun
        this.keyFunc = null; // GLFWkeyfun
        this.charFunc = null; // GLFWcharfun
        this.userptr = null;
      },WindowFromId:function(id) {
        if (id <= 0 || !GLFW.windows) return null;
        return GLFW.windows[id - 1];
      },joystickFunc:null,errorFunc:null,monitorFunc:null,active:null,windows:null,monitors:null,monitorString:null,versionString:null,initialTime:null,extensions:null,hints:null,defaultHints:{131073:0,131074:0,131075:1,131076:1,131077:1,135169:8,135170:8,135171:8,135172:8,135173:24,135174:8,135175:0,135176:0,135177:0,135178:0,135179:0,135180:0,135181:0,135182:0,135183:0,139265:196609,139266:1,139267:0,139268:0,139269:0,139270:0,139271:0,139272:0},DOMToGLFWKeyCode:function(keycode) {
        switch (keycode) {
          // these keycodes are only defined for GLFW3, assume they are the same for GLFW2
          case 0x20:return 32; // DOM_VK_SPACE -> GLFW_KEY_SPACE
          case 0xDE:return 39; // DOM_VK_QUOTE -> GLFW_KEY_APOSTROPHE
          case 0xBC:return 44; // DOM_VK_COMMA -> GLFW_KEY_COMMA
          case 0xAD:return 45; // DOM_VK_HYPHEN_MINUS -> GLFW_KEY_MINUS
          case 0xBD:return 45; // DOM_VK_MINUS -> GLFW_KEY_MINUS
          case 0xBE:return 46; // DOM_VK_PERIOD -> GLFW_KEY_PERIOD
          case 0xBF:return 47; // DOM_VK_SLASH -> GLFW_KEY_SLASH
          case 0x30:return 48; // DOM_VK_0 -> GLFW_KEY_0
          case 0x31:return 49; // DOM_VK_1 -> GLFW_KEY_1
          case 0x32:return 50; // DOM_VK_2 -> GLFW_KEY_2
          case 0x33:return 51; // DOM_VK_3 -> GLFW_KEY_3
          case 0x34:return 52; // DOM_VK_4 -> GLFW_KEY_4
          case 0x35:return 53; // DOM_VK_5 -> GLFW_KEY_5
          case 0x36:return 54; // DOM_VK_6 -> GLFW_KEY_6
          case 0x37:return 55; // DOM_VK_7 -> GLFW_KEY_7
          case 0x38:return 56; // DOM_VK_8 -> GLFW_KEY_8
          case 0x39:return 57; // DOM_VK_9 -> GLFW_KEY_9
          case 0x3B:return 59; // DOM_VK_SEMICOLON -> GLFW_KEY_SEMICOLON
          case 0x3D:return 61; // DOM_VK_EQUALS -> GLFW_KEY_EQUAL
          case 0xBB:return 61; // DOM_VK_EQUALS -> GLFW_KEY_EQUAL
          case 0x41:return 65; // DOM_VK_A -> GLFW_KEY_A
          case 0x42:return 66; // DOM_VK_B -> GLFW_KEY_B
          case 0x43:return 67; // DOM_VK_C -> GLFW_KEY_C
          case 0x44:return 68; // DOM_VK_D -> GLFW_KEY_D
          case 0x45:return 69; // DOM_VK_E -> GLFW_KEY_E
          case 0x46:return 70; // DOM_VK_F -> GLFW_KEY_F
          case 0x47:return 71; // DOM_VK_G -> GLFW_KEY_G
          case 0x48:return 72; // DOM_VK_H -> GLFW_KEY_H
          case 0x49:return 73; // DOM_VK_I -> GLFW_KEY_I
          case 0x4A:return 74; // DOM_VK_J -> GLFW_KEY_J
          case 0x4B:return 75; // DOM_VK_K -> GLFW_KEY_K
          case 0x4C:return 76; // DOM_VK_L -> GLFW_KEY_L
          case 0x4D:return 77; // DOM_VK_M -> GLFW_KEY_M
          case 0x4E:return 78; // DOM_VK_N -> GLFW_KEY_N
          case 0x4F:return 79; // DOM_VK_O -> GLFW_KEY_O
          case 0x50:return 80; // DOM_VK_P -> GLFW_KEY_P
          case 0x51:return 81; // DOM_VK_Q -> GLFW_KEY_Q
          case 0x52:return 82; // DOM_VK_R -> GLFW_KEY_R
          case 0x53:return 83; // DOM_VK_S -> GLFW_KEY_S
          case 0x54:return 84; // DOM_VK_T -> GLFW_KEY_T
          case 0x55:return 85; // DOM_VK_U -> GLFW_KEY_U
          case 0x56:return 86; // DOM_VK_V -> GLFW_KEY_V
          case 0x57:return 87; // DOM_VK_W -> GLFW_KEY_W
          case 0x58:return 88; // DOM_VK_X -> GLFW_KEY_X
          case 0x59:return 89; // DOM_VK_Y -> GLFW_KEY_Y
          case 0x5a:return 90; // DOM_VK_Z -> GLFW_KEY_Z
          case 0xDB:return 91; // DOM_VK_OPEN_BRACKET -> GLFW_KEY_LEFT_BRACKET
          case 0xDC:return 92; // DOM_VK_BACKSLASH -> GLFW_KEY_BACKSLASH
          case 0xDD:return 93; // DOM_VK_CLOSE_BRACKET -> GLFW_KEY_RIGHT_BRACKET
          case 0xC0:return 94; // DOM_VK_BACK_QUOTE -> GLFW_KEY_GRAVE_ACCENT
  
  
          case 0x1B:return 256; // DOM_VK_ESCAPE -> GLFW_KEY_ESCAPE
          case 0x0D:return 257; // DOM_VK_RETURN -> GLFW_KEY_ENTER
          case 0x09:return 258; // DOM_VK_TAB -> GLFW_KEY_TAB
          case 0x08:return 259; // DOM_VK_BACK -> GLFW_KEY_BACKSPACE
          case 0x2D:return 260; // DOM_VK_INSERT -> GLFW_KEY_INSERT
          case 0x2E:return 261; // DOM_VK_DELETE -> GLFW_KEY_DELETE
          case 0x27:return 262; // DOM_VK_RIGHT -> GLFW_KEY_RIGHT
          case 0x25:return 263; // DOM_VK_LEFT -> GLFW_KEY_LEFT
          case 0x28:return 264; // DOM_VK_DOWN -> GLFW_KEY_DOWN
          case 0x26:return 265; // DOM_VK_UP -> GLFW_KEY_UP
          case 0x21:return 266; // DOM_VK_PAGE_UP -> GLFW_KEY_PAGE_UP
          case 0x22:return 267; // DOM_VK_PAGE_DOWN -> GLFW_KEY_PAGE_DOWN
          case 0x24:return 268; // DOM_VK_HOME -> GLFW_KEY_HOME
          case 0x23:return 269; // DOM_VK_END -> GLFW_KEY_END
          case 0x14:return 280; // DOM_VK_CAPS_LOCK -> GLFW_KEY_CAPS_LOCK
          case 0x91:return 281; // DOM_VK_SCROLL_LOCK -> GLFW_KEY_SCROLL_LOCK
          case 0x90:return 282; // DOM_VK_NUM_LOCK -> GLFW_KEY_NUM_LOCK
          case 0x2C:return 283; // DOM_VK_SNAPSHOT -> GLFW_KEY_PRINT_SCREEN
          case 0x13:return 284; // DOM_VK_PAUSE -> GLFW_KEY_PAUSE
          case 0x70:return 290; // DOM_VK_F1 -> GLFW_KEY_F1
          case 0x71:return 291; // DOM_VK_F2 -> GLFW_KEY_F2
          case 0x72:return 292; // DOM_VK_F3 -> GLFW_KEY_F3
          case 0x73:return 293; // DOM_VK_F4 -> GLFW_KEY_F4
          case 0x74:return 294; // DOM_VK_F5 -> GLFW_KEY_F5
          case 0x75:return 295; // DOM_VK_F6 -> GLFW_KEY_F6
          case 0x76:return 296; // DOM_VK_F7 -> GLFW_KEY_F7
          case 0x77:return 297; // DOM_VK_F8 -> GLFW_KEY_F8
          case 0x78:return 298; // DOM_VK_F9 -> GLFW_KEY_F9
          case 0x79:return 299; // DOM_VK_F10 -> GLFW_KEY_F10
          case 0x7A:return 300; // DOM_VK_F11 -> GLFW_KEY_F11
          case 0x7B:return 301; // DOM_VK_F12 -> GLFW_KEY_F12
          case 0x7C:return 302; // DOM_VK_F13 -> GLFW_KEY_F13
          case 0x7D:return 303; // DOM_VK_F14 -> GLFW_KEY_F14
          case 0x7E:return 304; // DOM_VK_F15 -> GLFW_KEY_F15
          case 0x7F:return 305; // DOM_VK_F16 -> GLFW_KEY_F16
          case 0x80:return 306; // DOM_VK_F17 -> GLFW_KEY_F17
          case 0x81:return 307; // DOM_VK_F18 -> GLFW_KEY_F18
          case 0x82:return 308; // DOM_VK_F19 -> GLFW_KEY_F19
          case 0x83:return 309; // DOM_VK_F20 -> GLFW_KEY_F20
          case 0x84:return 310; // DOM_VK_F21 -> GLFW_KEY_F21
          case 0x85:return 311; // DOM_VK_F22 -> GLFW_KEY_F22
          case 0x86:return 312; // DOM_VK_F23 -> GLFW_KEY_F23
          case 0x87:return 313; // DOM_VK_F24 -> GLFW_KEY_F24
          case 0x88:return 314; // 0x88 (not used?) -> GLFW_KEY_F25
          case 0x60:return 320; // DOM_VK_NUMPAD0 -> GLFW_KEY_KP_0
          case 0x61:return 321; // DOM_VK_NUMPAD1 -> GLFW_KEY_KP_1
          case 0x62:return 322; // DOM_VK_NUMPAD2 -> GLFW_KEY_KP_2
          case 0x63:return 323; // DOM_VK_NUMPAD3 -> GLFW_KEY_KP_3
          case 0x64:return 324; // DOM_VK_NUMPAD4 -> GLFW_KEY_KP_4
          case 0x65:return 325; // DOM_VK_NUMPAD5 -> GLFW_KEY_KP_5
          case 0x66:return 326; // DOM_VK_NUMPAD6 -> GLFW_KEY_KP_6
          case 0x67:return 327; // DOM_VK_NUMPAD7 -> GLFW_KEY_KP_7
          case 0x68:return 328; // DOM_VK_NUMPAD8 -> GLFW_KEY_KP_8
          case 0x69:return 329; // DOM_VK_NUMPAD9 -> GLFW_KEY_KP_9
          case 0x6E:return 330; // DOM_VK_DECIMAL -> GLFW_KEY_KP_DECIMAL
          case 0x6F:return 331; // DOM_VK_DIVIDE -> GLFW_KEY_KP_DIVIDE
          case 0x6A:return 332; // DOM_VK_MULTIPLY -> GLFW_KEY_KP_MULTIPLY
          case 0x6D:return 333; // DOM_VK_SUBTRACT -> GLFW_KEY_KP_SUBTRACT
          case 0x6B:return 334; // DOM_VK_ADD -> GLFW_KEY_KP_ADD
          // case 0x0D:return 335; // DOM_VK_RETURN -> GLFW_KEY_KP_ENTER (DOM_KEY_LOCATION_RIGHT)
          // case 0x61:return 336; // DOM_VK_EQUALS -> GLFW_KEY_KP_EQUAL (DOM_KEY_LOCATION_RIGHT)
          case 0x10:return 340; // DOM_VK_SHIFT -> GLFW_KEY_LEFT_SHIFT
          case 0x11:return 341; // DOM_VK_CONTROL -> GLFW_KEY_LEFT_CONTROL
          case 0x12:return 342; // DOM_VK_ALT -> GLFW_KEY_LEFT_ALT
          case 0x5B:return 343; // DOM_VK_WIN -> GLFW_KEY_LEFT_SUPER
          // case 0x10:return 344; // DOM_VK_SHIFT -> GLFW_KEY_RIGHT_SHIFT (DOM_KEY_LOCATION_RIGHT)
          // case 0x11:return 345; // DOM_VK_CONTROL -> GLFW_KEY_RIGHT_CONTROL (DOM_KEY_LOCATION_RIGHT)
          // case 0x12:return 346; // DOM_VK_ALT -> GLFW_KEY_RIGHT_ALT (DOM_KEY_LOCATION_RIGHT)
          // case 0x5B:return 347; // DOM_VK_WIN -> GLFW_KEY_RIGHT_SUPER (DOM_KEY_LOCATION_RIGHT)
          case 0x5D:return 348; // DOM_VK_CONTEXT_MENU -> GLFW_KEY_MENU
          // XXX: GLFW_KEY_WORLD_1, GLFW_KEY_WORLD_2 what are these?
          default:return -1; // GLFW_KEY_UNKNOWN
        };
      },getModBits:function(win) {
        var mod = 0;
        if (win.keys[340]) mod |= 0x0001; // GLFW_MOD_SHIFT
        if (win.keys[341]) mod |= 0x0002; // GLFW_MOD_CONTROL
        if (win.keys[342]) mod |= 0x0004; // GLFW_MOD_ALT
        if (win.keys[343]) mod |= 0x0008; // GLFW_MOD_SUPER
        return mod;
      },onKeyPress:function(event) {
        if (!GLFW.active || !GLFW.active.charFunc) return;
        if (event.ctrlKey || event.metaKey) return;
  
        // correct unicode charCode is only available with onKeyPress event
        var charCode = event.charCode;
        if (charCode == 0 || (charCode >= 0x00 && charCode <= 0x1F)) return;
  
  
        dynCall_vii(GLFW.active.charFunc, GLFW.active.id, charCode);
      },onKeyChanged:function(keyCode, status) {
        if (!GLFW.active) return;
  
        var key = GLFW.DOMToGLFWKeyCode(keyCode);
        if (key == -1) return;
  
        var repeat = status && GLFW.active.keys[key];
        GLFW.active.keys[key] = status;
        GLFW.active.domKeys[keyCode] = status;
        if (!GLFW.active.keyFunc) return;
  
  
        if (repeat) status = 2; // GLFW_REPEAT
        dynCall_viiiii(GLFW.active.keyFunc, GLFW.active.id, key, keyCode, status, GLFW.getModBits(GLFW.active));
      },onGamepadConnected:function(event) {
        GLFW.refreshJoysticks();
      },onGamepadDisconnected:function(event) {
        GLFW.refreshJoysticks();
      },onKeydown:function(event) {
        GLFW.onKeyChanged(event.keyCode, 1); // GLFW_PRESS or GLFW_REPEAT
  
        // This logic comes directly from the sdl implementation. We cannot
        // call preventDefault on all keydown events otherwise onKeyPress will
        // not get called
        if (event.keyCode === 8 /* backspace */ || event.keyCode === 9 /* tab */) {
          event.preventDefault();
        }
      },onKeyup:function(event) {
        GLFW.onKeyChanged(event.keyCode, 0); // GLFW_RELEASE
      },onBlur:function(event) {
        if (!GLFW.active) return;
  
        for (var i = 0; i < GLFW.active.domKeys.length; ++i) {
          if (GLFW.active.domKeys[i]) {
            GLFW.onKeyChanged(i, 0); // GLFW_RELEASE
          }
        }
      },onMousemove:function(event) {
        if (!GLFW.active) return;
  
        Browser.calculateMouseEvent(event);
  
        if (event.target != Module["canvas"] || !GLFW.active.cursorPosFunc) return;
  
  
        dynCall_vidd(GLFW.active.cursorPosFunc, GLFW.active.id, Browser.mouseX, Browser.mouseY);
      },DOMToGLFWMouseButton:function(event) {
        // DOM and glfw have different button codes.
        // See http://www.w3schools.com/jsref/event_button.asp.
        var eventButton = event['button'];
        if (eventButton > 0) {
          if (eventButton == 1) {
            eventButton = 2;
          } else {
            eventButton = 1;
          }
        }
        return eventButton;
      },onMouseenter:function(event) {
        if (!GLFW.active) return;
  
        if (event.target != Module["canvas"] || !GLFW.active.cursorEnterFunc) return;
  
        dynCall_vii(GLFW.active.cursorEnterFunc, GLFW.active.id, 1);
      },onMouseleave:function(event) {
        if (!GLFW.active) return;
  
        if (event.target != Module["canvas"] || !GLFW.active.cursorEnterFunc) return;
  
        dynCall_vii(GLFW.active.cursorEnterFunc, GLFW.active.id, 0);
      },onMouseButtonChanged:function(event, status) {
        if (!GLFW.active) return;
  
        Browser.calculateMouseEvent(event);
  
        if (event.target != Module["canvas"]) return;
  
        var eventButton = GLFW.DOMToGLFWMouseButton(event);
  
        if (status == 1) { // GLFW_PRESS
          GLFW.active.buttons |= (1 << eventButton);
          try {
            event.target.setCapture();
          } catch (e) {}
        } else {  // GLFW_RELEASE
          GLFW.active.buttons &= ~(1 << eventButton);
        }
  
        if (!GLFW.active.mouseButtonFunc) return;
  
  
        dynCall_viiii(GLFW.active.mouseButtonFunc, GLFW.active.id, eventButton, status, GLFW.getModBits(GLFW.active));
      },onMouseButtonDown:function(event) {
        if (!GLFW.active) return;
        GLFW.onMouseButtonChanged(event, 1); // GLFW_PRESS
      },onMouseButtonUp:function(event) {
        if (!GLFW.active) return;
        GLFW.onMouseButtonChanged(event, 0); // GLFW_RELEASE
      },onMouseWheel:function(event) {
        // Note the minus sign that flips browser wheel direction (positive direction scrolls page down) to native wheel direction (positive direction is mouse wheel up)
        var delta = -Browser.getMouseWheelDelta(event);
        delta = (delta == 0) ? 0 : (delta > 0 ? Math.max(delta, 1) : Math.min(delta, -1)); // Quantize to integer so that minimum scroll is at least +/- 1.
        GLFW.wheelPos += delta;
  
        if (!GLFW.active || !GLFW.active.scrollFunc || event.target != Module['canvas']) return;
  
  
        var sx = 0;
        var sy = 0;
        if (event.type == 'mousewheel') {
          sx = event.wheelDeltaX;
          sy = event.wheelDeltaY;
        } else {
          sx = event.deltaX;
          sy = event.deltaY;
        }
  
        dynCall_vidd(GLFW.active.scrollFunc, GLFW.active.id, sx, sy);
  
        event.preventDefault();
      },onCanvasResize:function(width, height) {
        if (!GLFW.active) return;
  
        var resizeNeeded = true;
  
        // If the client is requesting fullscreen mode
        if (document["fullscreen"] || document["fullScreen"] || document["mozFullScreen"] || document["webkitIsFullScreen"]) {
          GLFW.active.storedX = GLFW.active.x;
          GLFW.active.storedY = GLFW.active.y;
          GLFW.active.storedWidth = GLFW.active.width;
          GLFW.active.storedHeight = GLFW.active.height;
          GLFW.active.x = GLFW.active.y = 0;
          GLFW.active.width = screen.width;
          GLFW.active.height = screen.height;
          GLFW.active.fullscreen = true;
  
        // If the client is reverting from fullscreen mode
        } else if (GLFW.active.fullscreen == true) {
          GLFW.active.x = GLFW.active.storedX;
          GLFW.active.y = GLFW.active.storedY;
          GLFW.active.width = GLFW.active.storedWidth;
          GLFW.active.height = GLFW.active.storedHeight;
          GLFW.active.fullscreen = false;
  
        // If the width/height values do not match current active window sizes
        } else if (GLFW.active.width != width || GLFW.active.height != height) {
            GLFW.active.width = width;
            GLFW.active.height = height;
        } else {
          resizeNeeded = false;
        }
  
        // If any of the above conditions were true, we need to resize the canvas
        if (resizeNeeded) {
          // resets the canvas size to counter the aspect preservation of Browser.updateCanvasDimensions
          Browser.setCanvasSize(GLFW.active.width, GLFW.active.height, true);
          // TODO: Client dimensions (clientWidth/clientHeight) vs pixel dimensions (width/height) of
          // the canvas should drive window and framebuffer size respectfully.
          GLFW.onWindowSizeChanged();
          GLFW.onFramebufferSizeChanged();
        }
      },onWindowSizeChanged:function() {
        if (!GLFW.active) return;
  
        if (!GLFW.active.windowSizeFunc) return;
  
  
        dynCall_viii(GLFW.active.windowSizeFunc, GLFW.active.id, GLFW.active.width, GLFW.active.height);
      },onFramebufferSizeChanged:function() {
        if (!GLFW.active) return;
  
        if (!GLFW.active.framebufferSizeFunc) return;
  
        dynCall_viii(GLFW.active.framebufferSizeFunc, GLFW.active.id, GLFW.active.width, GLFW.active.height);
      },getTime:function() {
        return _emscripten_get_now() / 1000;
      },setWindowTitle:function(winid, title) {
        var win = GLFW.WindowFromId(winid);
        if (!win) return;
  
        win.title = UTF8ToString(title);
        if (GLFW.active.id == win.id) {
          document.title = win.title;
        }
      },setJoystickCallback:function(cbfun) {
        GLFW.joystickFunc = cbfun;
        GLFW.refreshJoysticks();
      },joys:{},lastGamepadState:null,lastGamepadStateFrame:null,refreshJoysticks:function() {
        // Produce a new Gamepad API sample if we are ticking a new game frame, or if not using emscripten_set_main_loop() at all to drive animation.
        if (Browser.mainLoop.currentFrameNumber !== GLFW.lastGamepadStateFrame || !Browser.mainLoop.currentFrameNumber) {
          GLFW.lastGamepadState = navigator.getGamepads ? navigator.getGamepads() : (navigator.webkitGetGamepads ? navigator.webkitGetGamepads : null);
          GLFW.lastGamepadStateFrame = Browser.mainLoop.currentFrameNumber;
  
          for (var joy = 0; joy < GLFW.lastGamepadState.length; ++joy) {
            var gamepad = GLFW.lastGamepadState[joy];
  
            if (gamepad) {
              if (!GLFW.joys[joy]) {
                console.log('glfw joystick connected:',joy);
                GLFW.joys[joy] = {
                  id: allocate(intArrayFromString(gamepad.id), 'i8', ALLOC_NORMAL),
                  buttonsCount: gamepad.buttons.length,
                  axesCount: gamepad.axes.length,
                  buttons: allocate(new Array(gamepad.buttons.length), 'i8', ALLOC_NORMAL),
                  axes: allocate(new Array(gamepad.axes.length*4), 'float', ALLOC_NORMAL)
                };
  
                if (GLFW.joystickFunc) {
                  dynCall_vii(GLFW.joystickFunc, joy, 0x00040001); // GLFW_CONNECTED
                }
              }
  
              var data = GLFW.joys[joy];
  
              for (var i = 0; i < gamepad.buttons.length;  ++i) {
                setValue(data.buttons + i, gamepad.buttons[i].pressed, 'i8');
              }
  
              for (var i = 0; i < gamepad.axes.length; ++i) {
                setValue(data.axes + i*4, gamepad.axes[i], 'float');
              }
            } else {
              if (GLFW.joys[joy]) {
                console.log('glfw joystick disconnected',joy);
  
                if (GLFW.joystickFunc) {
                  dynCall_vii(GLFW.joystickFunc, joy, 0x00040002); // GLFW_DISCONNECTED
                }
  
                _free(GLFW.joys[joy].id);
                _free(GLFW.joys[joy].buttons);
                _free(GLFW.joys[joy].axes);
  
                delete GLFW.joys[joy];
              }
            }
          }
        }
      },setKeyCallback:function(winid, cbfun) {
        var win = GLFW.WindowFromId(winid);
        if (!win) return null;
        var prevcbfun = win.keyFunc;
        win.keyFunc = cbfun;
        return prevcbfun;
      },setCharCallback:function(winid, cbfun) {
        var win = GLFW.WindowFromId(winid);
        if (!win) return null;
        var prevcbfun = win.charFunc;
        win.charFunc = cbfun;
        return prevcbfun;
      },setMouseButtonCallback:function(winid, cbfun) {
        var win = GLFW.WindowFromId(winid);
        if (!win) return null;
        var prevcbfun = win.mouseButtonFunc;
        win.mouseButtonFunc = cbfun;
        return prevcbfun;
      },setCursorPosCallback:function(winid, cbfun) {
        var win = GLFW.WindowFromId(winid);
        if (!win) return null;
        var prevcbfun = win.cursorPosFunc;
        win.cursorPosFunc = cbfun;
        return prevcbfun;
      },setScrollCallback:function(winid, cbfun) {
        var win = GLFW.WindowFromId(winid);
        if (!win) return null;
        var prevcbfun = win.scrollFunc;
        win.scrollFunc = cbfun;
        return prevcbfun;
      },setDropCallback:function(winid, cbfun) {
        var win = GLFW.WindowFromId(winid);
        if (!win) return null;
        var prevcbfun = win.dropFunc;
        win.dropFunc = cbfun;
        return prevcbfun;
      },onDrop:function(event) {
        if (!GLFW.active || !GLFW.active.dropFunc) return;
        if (!event.dataTransfer || !event.dataTransfer.files || event.dataTransfer.files.length == 0) return;
  
        event.preventDefault();
  
        var filenames = allocate(new Array(event.dataTransfer.files.length*4), 'i8*', ALLOC_NORMAL);
        var filenamesArray = [];
        var count = event.dataTransfer.files.length;
  
        // Read and save the files to emscripten's FS
        var written = 0;
        var drop_dir = '.glfw_dropped_files';
        FS.createPath('/', drop_dir);
  
        function save(file) {
          var path = '/' + drop_dir + '/' + file.name.replace(/\//g, '_');
          var reader = new FileReader();
          reader.onloadend = function(e) {
            if (reader.readyState != 2) { // not DONE
              ++written;
              console.log('failed to read dropped file: '+file.name+': '+reader.error);
              return;
            }
  
            var data = e.target.result;
            FS.writeFile(path, new Uint8Array(data));
            if (++written === count) {
              dynCall_viii(GLFW.active.dropFunc, GLFW.active.id, count, filenames);
  
              for (var i = 0; i < filenamesArray.length; ++i) {
                _free(filenamesArray[i]);
              }
              _free(filenames);
            }
          };
          reader.readAsArrayBuffer(file);
  
          var filename = allocate(intArrayFromString(path), 'i8', ALLOC_NORMAL);
          filenamesArray.push(filename);
          setValue(filenames + i*4, filename, 'i8*');
        }
  
        for (var i = 0; i < count; ++i) {
          save(event.dataTransfer.files[i]);
        }
  
        return false;
      },onDragover:function(event) {
        if (!GLFW.active || !GLFW.active.dropFunc) return;
  
        event.preventDefault();
        return false;
      },setWindowSizeCallback:function(winid, cbfun) {
        var win = GLFW.WindowFromId(winid);
        if (!win) return null;
        var prevcbfun = win.windowSizeFunc;
        win.windowSizeFunc = cbfun;
  
  
        return prevcbfun;
      },setWindowCloseCallback:function(winid, cbfun) {
        var win = GLFW.WindowFromId(winid);
        if (!win) return null;
        var prevcbfun = win.windowCloseFunc;
        win.windowCloseFunc = cbfun;
        return prevcbfun;
      },setWindowRefreshCallback:function(winid, cbfun) {
        var win = GLFW.WindowFromId(winid);
        if (!win) return null;
        var prevcbfun = win.windowRefreshFunc;
        win.windowRefreshFunc = cbfun;
        return prevcbfun;
      },onClickRequestPointerLock:function(e) {
        if (!Browser.pointerLock && Module['canvas'].requestPointerLock) {
          Module['canvas'].requestPointerLock();
          e.preventDefault();
        }
      },setInputMode:function(winid, mode, value) {
        var win = GLFW.WindowFromId(winid);
        if (!win) return;
  
        switch(mode) {
          case 0x00033001: { // GLFW_CURSOR
            switch(value) {
              case 0x00034001: { // GLFW_CURSOR_NORMAL
                win.inputModes[mode] = value;
                Module['canvas'].removeEventListener('click', GLFW.onClickRequestPointerLock, true);
                Module['canvas'].exitPointerLock();
                break;
              }
              case 0x00034002: { // GLFW_CURSOR_HIDDEN
                console.log("glfwSetInputMode called with GLFW_CURSOR_HIDDEN value not implemented.");
                break;
              }
              case 0x00034003: { // GLFW_CURSOR_DISABLED
                win.inputModes[mode] = value;
                Module['canvas'].addEventListener('click', GLFW.onClickRequestPointerLock, true);
                Module['canvas'].requestPointerLock();
                break;
              }
              default: {
                console.log("glfwSetInputMode called with unknown value parameter value: " + value + ".");
                break;
              }
            }
            break;
          }
          case 0x00033002: { // GLFW_STICKY_KEYS
            console.log("glfwSetInputMode called with GLFW_STICKY_KEYS mode not implemented.");
            break;
          }
          case 0x00033003: { // GLFW_STICKY_MOUSE_BUTTONS
            console.log("glfwSetInputMode called with GLFW_STICKY_MOUSE_BUTTONS mode not implemented.");
            break;
          }
          default: {
            console.log("glfwSetInputMode called with unknown mode parameter value: " + mode + ".");
            break;
          }
        }
      },getKey:function(winid, key) {
        var win = GLFW.WindowFromId(winid);
        if (!win) return 0;
        return win.keys[key];
      },getMouseButton:function(winid, button) {
        var win = GLFW.WindowFromId(winid);
        if (!win) return 0;
        return (win.buttons & (1 << button)) > 0;
      },getCursorPos:function(winid, x, y) {
        setValue(x, Browser.mouseX, 'double');
        setValue(y, Browser.mouseY, 'double');
      },getMousePos:function(winid, x, y) {
        setValue(x, Browser.mouseX, 'i32');
        setValue(y, Browser.mouseY, 'i32');
      },setCursorPos:function(winid, x, y) {
      },getWindowPos:function(winid, x, y) {
        var wx = 0;
        var wy = 0;
  
        var win = GLFW.WindowFromId(winid);
        if (win) {
          wx = win.x;
          wy = win.y;
        }
  
        setValue(x, wx, 'i32');
        setValue(y, wy, 'i32');
      },setWindowPos:function(winid, x, y) {
        var win = GLFW.WindowFromId(winid);
        if (!win) return;
        win.x = x;
        win.y = y;
      },getWindowSize:function(winid, width, height) {
        var ww = 0;
        var wh = 0;
  
        var win = GLFW.WindowFromId(winid);
        if (win) {
          ww = win.width;
          wh = win.height;
        }
  
        setValue(width, ww, 'i32');
        setValue(height, wh, 'i32');
      },setWindowSize:function(winid, width, height) {
        var win = GLFW.WindowFromId(winid);
        if (!win) return;
  
        if (GLFW.active.id == win.id) {
          if (width == screen.width && height == screen.height) {
            Browser.requestFullscreen();
          } else {
            Browser.exitFullscreen();
            Browser.setCanvasSize(width, height);
            win.width = width;
            win.height = height;
          }
        }
  
        if (!win.windowSizeFunc) return;
  
  
        dynCall_viii(win.windowSizeFunc, win.id, width, height);
      },createWindow:function(width, height, title, monitor, share) {
        var i, id;
        for (i = 0; i < GLFW.windows.length && GLFW.windows[i] !== null; i++);
        if (i > 0) throw "glfwCreateWindow only supports one window at time currently";
  
        // id for window
        id = i + 1;
  
        // not valid
        if (width <= 0 || height <= 0) return 0;
  
        if (monitor) {
          Browser.requestFullscreen();
        } else {
          Browser.setCanvasSize(width, height);
        }
  
        // Create context when there are no existing alive windows
        for (i = 0; i < GLFW.windows.length && GLFW.windows[i] == null; i++);
        if (i == GLFW.windows.length) {
          var contextAttributes = {
            antialias: (GLFW.hints[0x0002100D] > 1), // GLFW_SAMPLES
            depth: (GLFW.hints[0x00021005] > 0),     // GLFW_DEPTH_BITS
            stencil: (GLFW.hints[0x00021006] > 0),   // GLFW_STENCIL_BITS
            alpha: (GLFW.hints[0x00021004] > 0)      // GLFW_ALPHA_BITS
          }
          Module.ctx = Browser.createContext(Module['canvas'], true, true, contextAttributes);
        }
  
        // If context creation failed, do not return a valid window
        if (!Module.ctx) return 0;
  
        // Get non alive id
        var win = new GLFW.Window(id, width, height, title, monitor, share);
  
        // Set window to array
        if (id - 1 == GLFW.windows.length) {
          GLFW.windows.push(win);
        } else {
          GLFW.windows[id - 1] = win;
        }
  
        GLFW.active = win;
        return win.id;
      },destroyWindow:function(winid) {
        var win = GLFW.WindowFromId(winid);
        if (!win) return;
  
        if (win.windowCloseFunc)
          dynCall_vi(win.windowCloseFunc, win.id);
  
        GLFW.windows[win.id - 1] = null;
        if (GLFW.active.id == win.id)
          GLFW.active = null;
  
        // Destroy context when no alive windows
        for (var i = 0; i < GLFW.windows.length; i++)
          if (GLFW.windows[i] !== null) return;
  
        Module.ctx = Browser.destroyContext(Module['canvas'], true, true);
      },swapBuffers:function(winid) {
      },GLFW2ParamToGLFW3Param:function(param) {
        var table = {
          0x00030001:0, // GLFW_MOUSE_CURSOR
          0x00030002:0, // GLFW_STICKY_KEYS
          0x00030003:0, // GLFW_STICKY_MOUSE_BUTTONS
          0x00030004:0, // GLFW_SYSTEM_KEYS
          0x00030005:0, // GLFW_KEY_REPEAT
          0x00030006:0, // GLFW_AUTO_POLL_EVENTS
          0x00020001:0, // GLFW_OPENED
          0x00020002:0, // GLFW_ACTIVE
          0x00020003:0, // GLFW_ICONIFIED
          0x00020004:0, // GLFW_ACCELERATED
          0x00020005:0x00021001, // GLFW_RED_BITS
          0x00020006:0x00021002, // GLFW_GREEN_BITS
          0x00020007:0x00021003, // GLFW_BLUE_BITS
          0x00020008:0x00021004, // GLFW_ALPHA_BITS
          0x00020009:0x00021005, // GLFW_DEPTH_BITS
          0x0002000A:0x00021006, // GLFW_STENCIL_BITS
          0x0002000B:0x0002100F, // GLFW_REFRESH_RATE
          0x0002000C:0x00021007, // GLFW_ACCUM_RED_BITS
          0x0002000D:0x00021008, // GLFW_ACCUM_GREEN_BITS
          0x0002000E:0x00021009, // GLFW_ACCUM_BLUE_BITS
          0x0002000F:0x0002100A, // GLFW_ACCUM_ALPHA_BITS
          0x00020010:0x0002100B, // GLFW_AUX_BUFFERS
          0x00020011:0x0002100C, // GLFW_STEREO
          0x00020012:0, // GLFW_WINDOW_NO_RESIZE
          0x00020013:0x0002100D, // GLFW_FSAA_SAMPLES
          0x00020014:0x00022002, // GLFW_OPENGL_VERSION_MAJOR
          0x00020015:0x00022003, // GLFW_OPENGL_VERSION_MINOR
          0x00020016:0x00022006, // GLFW_OPENGL_FORWARD_COMPAT
          0x00020017:0x00022007, // GLFW_OPENGL_DEBUG_CONTEXT
          0x00020018:0x00022008, // GLFW_OPENGL_PROFILE
        };
        return table[param];
      }};function _glfwCreateWindow(width, height, title, monitor, share) {
      return GLFW.createWindow(width, height, title, monitor, share);
    }

  function _glfwDefaultWindowHints() {
      GLFW.hints = GLFW.defaultHints;
    }

  function _glfwGetCursorPos(winid, x, y) {
      GLFW.getCursorPos(winid, x, y);
    }

  function _glfwGetPrimaryMonitor() {
      return 1;
    }

  function _glfwGetTime() {
      return GLFW.getTime() - GLFW.initialTime;
    }

  function _glfwGetVideoModes(monitor, count) {
      setValue(count, 0, 'i32');
      return 0;
    }

  function _glfwInit() {
      if (GLFW.windows) return 1; // GL_TRUE
  
      GLFW.initialTime = GLFW.getTime();
      GLFW.hints = GLFW.defaultHints;
      GLFW.windows = new Array()
      GLFW.active = null;
  
      window.addEventListener("gamepadconnected", GLFW.onGamepadConnected, true);
      window.addEventListener("gamepaddisconnected", GLFW.onGamepadDisconnected, true);
      window.addEventListener("keydown", GLFW.onKeydown, true);
      window.addEventListener("keypress", GLFW.onKeyPress, true);
      window.addEventListener("keyup", GLFW.onKeyup, true);
      window.addEventListener("blur", GLFW.onBlur, true);
      Module["canvas"].addEventListener("mousemove", GLFW.onMousemove, true);
      Module["canvas"].addEventListener("mousedown", GLFW.onMouseButtonDown, true);
      Module["canvas"].addEventListener("mouseup", GLFW.onMouseButtonUp, true);
      Module["canvas"].addEventListener('wheel', GLFW.onMouseWheel, true);
      Module["canvas"].addEventListener('mousewheel', GLFW.onMouseWheel, true);
      Module["canvas"].addEventListener('mouseenter', GLFW.onMouseenter, true);
      Module["canvas"].addEventListener('mouseleave', GLFW.onMouseleave, true);
      Module["canvas"].addEventListener('drop', GLFW.onDrop, true);
      Module["canvas"].addEventListener('dragover', GLFW.onDragover, true);
  
      Browser.resizeListeners.push(function(width, height) {
         GLFW.onCanvasResize(width, height);
      });
      return 1; // GL_TRUE
    }

  function _glfwMakeContextCurrent(winid) {}

  function _glfwSetCharCallback(winid, cbfun) {
      return GLFW.setCharCallback(winid, cbfun);
    }

  function _glfwSetCursorEnterCallback(winid, cbfun) {
      var win = GLFW.WindowFromId(winid);
      if (!win) return null;
      var prevcbfun = win.cursorEnterFunc;
      win.cursorEnterFunc = cbfun;
      return prevcbfun;
    }

  function _glfwSetCursorPosCallback(winid, cbfun) {
      return GLFW.setCursorPosCallback(winid, cbfun);
    }

  function _glfwSetDropCallback(winid, cbfun) {
      return GLFW.setDropCallback(winid, cbfun);
    }

  function _glfwSetErrorCallback(cbfun) {
      var prevcbfun = GLFW.errorFunc;
      GLFW.errorFunc = cbfun;
      return prevcbfun;
    }

  function _glfwSetKeyCallback(winid, cbfun) {
      return GLFW.setKeyCallback(winid, cbfun);
    }

  function _glfwSetMouseButtonCallback(winid, cbfun) {
      return GLFW.setMouseButtonCallback(winid, cbfun);
    }

  function _glfwSetScrollCallback(winid, cbfun) {
      return GLFW.setScrollCallback(winid, cbfun);
    }

  function _glfwSetWindowIconifyCallback(winid, cbfun) {
      var win = GLFW.WindowFromId(winid);
      if (!win) return null;
      var prevcbfun = win.windowIconifyFunc;
      win.windowIconifyFunc = cbfun;
      return prevcbfun;
    }

  function _glfwSetWindowShouldClose(winid, value) {
      var win = GLFW.WindowFromId(winid);
      if (!win) return;
      win.shouldClose = value;
    }

  function _glfwSetWindowSizeCallback(winid, cbfun) {
      return GLFW.setWindowSizeCallback(winid, cbfun);
    }

  function _glfwSwapBuffers(winid) {
      GLFW.swapBuffers(winid);
    }

  function _glfwSwapInterval(interval) {
      interval = Math.abs(interval); // GLFW uses negative values to enable GLX_EXT_swap_control_tear, which we don't have, so just treat negative and positive the same.
      if (interval == 0) _emscripten_set_main_loop_timing(0/*EM_TIMING_SETTIMEOUT*/, 0);
      else _emscripten_set_main_loop_timing(1/*EM_TIMING_RAF*/, interval);
    }

  function _glfwTerminate() {
      window.removeEventListener("gamepadconnected", GLFW.onGamepadConnected, true);
      window.removeEventListener("gamepaddisconnected", GLFW.onGamepadDisconnected, true);
      window.removeEventListener("keydown", GLFW.onKeydown, true);
      window.removeEventListener("keypress", GLFW.onKeyPress, true);
      window.removeEventListener("keyup", GLFW.onKeyup, true);
      window.removeEventListener("blur", GLFW.onBlur, true);
      Module["canvas"].removeEventListener("mousemove", GLFW.onMousemove, true);
      Module["canvas"].removeEventListener("mousedown", GLFW.onMouseButtonDown, true);
      Module["canvas"].removeEventListener("mouseup", GLFW.onMouseButtonUp, true);
      Module["canvas"].removeEventListener('wheel', GLFW.onMouseWheel, true);
      Module["canvas"].removeEventListener('mousewheel', GLFW.onMouseWheel, true);
      Module["canvas"].removeEventListener('mouseenter', GLFW.onMouseenter, true);
      Module["canvas"].removeEventListener('mouseleave', GLFW.onMouseleave, true);
      Module["canvas"].removeEventListener('drop', GLFW.onDrop, true);
      Module["canvas"].removeEventListener('dragover', GLFW.onDragover, true);
  
  
      Module["canvas"].width = Module["canvas"].height = 1;
      GLFW.windows = null;
      GLFW.active = null;
    }

  function _glfwWindowHint(target, hint) {
      GLFW.hints[target] = hint;
    }



  var _llvm_cos_f32=Math_cos;

  
   

  var _llvm_sin_f32=Math_sin;

  function _llvm_stackrestore(p) {
      var self = _llvm_stacksave;
      var ret = self.LLVM_SAVEDSTACKS[p];
      self.LLVM_SAVEDSTACKS.splice(p, 1);
      stackRestore(ret);
    }

  function _llvm_stacksave() {
      var self = _llvm_stacksave;
      if (!self.LLVM_SAVEDSTACKS) {
        self.LLVM_SAVEDSTACKS = [];
      }
      self.LLVM_SAVEDSTACKS.push(stackSave());
      return self.LLVM_SAVEDSTACKS.length-1;
    }

  
  function _emscripten_memcpy_big(dest, src, num) {
      HEAPU8.set(HEAPU8.subarray(src, src+num), dest);
    }
  
   

   

   

  
  function _usleep(useconds) {
      // int usleep(useconds_t useconds);
      // http://pubs.opengroup.org/onlinepubs/000095399/functions/usleep.html
      // We're single-threaded, so use a busy loop. Super-ugly.
      var msec = useconds / 1000;
      if ((ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) && self['performance'] && self['performance']['now']) {
        var start = self['performance']['now']();
        while (self['performance']['now']() - start < msec) {
          // Do nothing.
        }
      } else {
        var start = Date.now();
        while (Date.now() - start < msec) {
          // Do nothing.
        }
      }
      return 0;
    }function _nanosleep(rqtp, rmtp) {
      // int nanosleep(const struct timespec  *rqtp, struct timespec *rmtp);
      if (rqtp === 0) {
        ___setErrNo(28);
        return -1;
      }
      var seconds = HEAP32[((rqtp)>>2)];
      var nanoseconds = HEAP32[(((rqtp)+(4))>>2)];
      if (nanoseconds < 0 || nanoseconds > 999999999 || seconds < 0) {
        ___setErrNo(28);
        return -1;
      }
      if (rmtp !== 0) {
        HEAP32[((rmtp)>>2)]=0;
        HEAP32[(((rmtp)+(4))>>2)]=0;
      }
      return _usleep((seconds * 1e6) + (nanoseconds / 1000));
    }

  function _time(ptr) {
      var ret = (Date.now()/1000)|0;
      if (ptr) {
        HEAP32[((ptr)>>2)]=ret;
      }
      return ret;
    }
FS.staticInit();;
Module["requestFullscreen"] = function Module_requestFullscreen(lockPointer, resizeCanvas, vrDevice) { Browser.requestFullscreen(lockPointer, resizeCanvas, vrDevice) };
  Module["requestFullScreen"] = function Module_requestFullScreen() { Browser.requestFullScreen() };
  Module["requestAnimationFrame"] = function Module_requestAnimationFrame(func) { Browser.requestAnimationFrame(func) };
  Module["setCanvasSize"] = function Module_setCanvasSize(width, height, noUpdates) { Browser.setCanvasSize(width, height, noUpdates) };
  Module["pauseMainLoop"] = function Module_pauseMainLoop() { Browser.mainLoop.pause() };
  Module["resumeMainLoop"] = function Module_resumeMainLoop() { Browser.mainLoop.resume() };
  Module["getUserMedia"] = function Module_getUserMedia() { Browser.getUserMedia() }
  Module["createContext"] = function Module_createContext(canvas, useWebGL, setInModule, webGLContextAttributes) { return Browser.createContext(canvas, useWebGL, setInModule, webGLContextAttributes) };
if (ENVIRONMENT_IS_NODE) {
    _emscripten_get_now = function _emscripten_get_now_actual() {
      var t = process['hrtime']();
      return t[0] * 1e3 + t[1] / 1e6;
    };
  } else if (typeof dateNow !== 'undefined') {
    _emscripten_get_now = dateNow;
  } else _emscripten_get_now = function() { return performance['now'](); };
  ;
var GLctx; GL.init();
for (var i = 0; i < 32; i++) __tempFixedLengthArray.push(new Array(i));;
var ASSERTIONS = true;

// Copyright 2017 The Emscripten Authors.  All rights reserved.
// Emscripten is available under two separate licenses, the MIT license and the
// University of Illinois/NCSA Open Source License.  Both these licenses can be
// found in the LICENSE file.

/** @type {function(string, boolean=, number=)} */
function intArrayFromString(stringy, dontAddNull, length) {
  var len = length > 0 ? length : lengthBytesUTF8(stringy)+1;
  var u8array = new Array(len);
  var numBytesWritten = stringToUTF8Array(stringy, u8array, 0, u8array.length);
  if (dontAddNull) u8array.length = numBytesWritten;
  return u8array;
}

function intArrayToString(array) {
  var ret = [];
  for (var i = 0; i < array.length; i++) {
    var chr = array[i];
    if (chr > 0xFF) {
      if (ASSERTIONS) {
        assert(false, 'Character code ' + chr + ' (' + String.fromCharCode(chr) + ')  at offset ' + i + ' not in 0x00-0xFF.');
      }
      chr &= 0xFF;
    }
    ret.push(String.fromCharCode(chr));
  }
  return ret.join('');
}


// ASM_LIBRARY EXTERN PRIMITIVES: Math_imul,Math_clz32,Math_floor,Math_ceil,Int8Array,Int32Array

function nullFunc_ff(x) { abortFnPtrError(x, 'ff'); }
function nullFunc_fff(x) { abortFnPtrError(x, 'fff'); }
function nullFunc_i(x) { abortFnPtrError(x, 'i'); }
function nullFunc_ii(x) { abortFnPtrError(x, 'ii'); }
function nullFunc_iidiiii(x) { abortFnPtrError(x, 'iidiiii'); }
function nullFunc_iii(x) { abortFnPtrError(x, 'iii'); }
function nullFunc_iiii(x) { abortFnPtrError(x, 'iiii'); }
function nullFunc_iiiii(x) { abortFnPtrError(x, 'iiiii'); }
function nullFunc_v(x) { abortFnPtrError(x, 'v'); }
function nullFunc_vf(x) { abortFnPtrError(x, 'vf'); }
function nullFunc_vff(x) { abortFnPtrError(x, 'vff'); }
function nullFunc_vffff(x) { abortFnPtrError(x, 'vffff'); }
function nullFunc_vfi(x) { abortFnPtrError(x, 'vfi'); }
function nullFunc_vi(x) { abortFnPtrError(x, 'vi'); }
function nullFunc_vidd(x) { abortFnPtrError(x, 'vidd'); }
function nullFunc_vif(x) { abortFnPtrError(x, 'vif'); }
function nullFunc_viff(x) { abortFnPtrError(x, 'viff'); }
function nullFunc_vifff(x) { abortFnPtrError(x, 'vifff'); }
function nullFunc_viffff(x) { abortFnPtrError(x, 'viffff'); }
function nullFunc_vii(x) { abortFnPtrError(x, 'vii'); }
function nullFunc_viif(x) { abortFnPtrError(x, 'viif'); }
function nullFunc_viii(x) { abortFnPtrError(x, 'viii'); }
function nullFunc_viiii(x) { abortFnPtrError(x, 'viiii'); }
function nullFunc_viiiii(x) { abortFnPtrError(x, 'viiiii'); }
function nullFunc_viiiiii(x) { abortFnPtrError(x, 'viiiiii'); }
function nullFunc_viiiiiii(x) { abortFnPtrError(x, 'viiiiiii'); }
function nullFunc_viiiiiiii(x) { abortFnPtrError(x, 'viiiiiiii'); }
function nullFunc_viiiiiiiii(x) { abortFnPtrError(x, 'viiiiiiiii'); }

var asmGlobalArg = {};

var asmLibraryArg = { "EMTSTACKTOP": EMTSTACKTOP, "EMT_STACK_MAX": EMT_STACK_MAX, "___assert_fail": ___assert_fail, "___lock": ___lock, "___setErrNo": ___setErrNo, "___syscall221": ___syscall221, "___syscall5": ___syscall5, "___syscall54": ___syscall54, "___unlock": ___unlock, "___wasi_fd_close": ___wasi_fd_close, "___wasi_fd_read": ___wasi_fd_read, "___wasi_fd_seek": ___wasi_fd_seek, "___wasi_fd_write": ___wasi_fd_write, "__colorChannelsInGlTextureFormat": __colorChannelsInGlTextureFormat, "__computeUnpackAlignedImageSize": __computeUnpackAlignedImageSize, "__fillFullscreenChangeEventData": __fillFullscreenChangeEventData, "__fillGamepadEventData": __fillGamepadEventData, "__fillMouseEventData": __fillMouseEventData, "__fillPointerlockChangeEventData": __fillPointerlockChangeEventData, "__findEventTarget": __findEventTarget, "__getBoundingClientRect": __getBoundingClientRect, "__glGenObject": __glGenObject, "__heapAccessShiftForWebGLHeap": __heapAccessShiftForWebGLHeap, "__heapObjectForWebGLType": __heapObjectForWebGLType, "__maybeCStringToJsString": __maybeCStringToJsString, "__memory_base": 1024, "__registerFullscreenChangeEventCallback": __registerFullscreenChangeEventCallback, "__registerGamepadEventCallback": __registerGamepadEventCallback, "__registerKeyEventCallback": __registerKeyEventCallback, "__registerMouseEventCallback": __registerMouseEventCallback, "__registerTouchEventCallback": __registerTouchEventCallback, "__requestPointerLock": __requestPointerLock, "__table_base": 0, "_abort": _abort, "_eglGetProcAddress": _eglGetProcAddress, "_emscripten_exit_pointerlock": _emscripten_exit_pointerlock, "_emscripten_get_element_css_size": _emscripten_get_element_css_size, "_emscripten_get_gamepad_status": _emscripten_get_gamepad_status, "_emscripten_get_heap_size": _emscripten_get_heap_size, "_emscripten_get_now": _emscripten_get_now, "_emscripten_get_num_gamepads": _emscripten_get_num_gamepads, "_emscripten_get_pointerlock_status": _emscripten_get_pointerlock_status, "_emscripten_glActiveTexture": _emscripten_glActiveTexture, "_emscripten_glAttachShader": _emscripten_glAttachShader, "_emscripten_glBeginQueryEXT": _emscripten_glBeginQueryEXT, "_emscripten_glBindAttribLocation": _emscripten_glBindAttribLocation, "_emscripten_glBindBuffer": _emscripten_glBindBuffer, "_emscripten_glBindFramebuffer": _emscripten_glBindFramebuffer, "_emscripten_glBindRenderbuffer": _emscripten_glBindRenderbuffer, "_emscripten_glBindTexture": _emscripten_glBindTexture, "_emscripten_glBindVertexArrayOES": _emscripten_glBindVertexArrayOES, "_emscripten_glBlendColor": _emscripten_glBlendColor, "_emscripten_glBlendEquation": _emscripten_glBlendEquation, "_emscripten_glBlendEquationSeparate": _emscripten_glBlendEquationSeparate, "_emscripten_glBlendFunc": _emscripten_glBlendFunc, "_emscripten_glBlendFuncSeparate": _emscripten_glBlendFuncSeparate, "_emscripten_glBufferData": _emscripten_glBufferData, "_emscripten_glBufferSubData": _emscripten_glBufferSubData, "_emscripten_glCheckFramebufferStatus": _emscripten_glCheckFramebufferStatus, "_emscripten_glClear": _emscripten_glClear, "_emscripten_glClearColor": _emscripten_glClearColor, "_emscripten_glClearDepthf": _emscripten_glClearDepthf, "_emscripten_glClearStencil": _emscripten_glClearStencil, "_emscripten_glColorMask": _emscripten_glColorMask, "_emscripten_glCompileShader": _emscripten_glCompileShader, "_emscripten_glCompressedTexImage2D": _emscripten_glCompressedTexImage2D, "_emscripten_glCompressedTexSubImage2D": _emscripten_glCompressedTexSubImage2D, "_emscripten_glCopyTexImage2D": _emscripten_glCopyTexImage2D, "_emscripten_glCopyTexSubImage2D": _emscripten_glCopyTexSubImage2D, "_emscripten_glCreateProgram": _emscripten_glCreateProgram, "_emscripten_glCreateShader": _emscripten_glCreateShader, "_emscripten_glCullFace": _emscripten_glCullFace, "_emscripten_glDeleteBuffers": _emscripten_glDeleteBuffers, "_emscripten_glDeleteFramebuffers": _emscripten_glDeleteFramebuffers, "_emscripten_glDeleteProgram": _emscripten_glDeleteProgram, "_emscripten_glDeleteQueriesEXT": _emscripten_glDeleteQueriesEXT, "_emscripten_glDeleteRenderbuffers": _emscripten_glDeleteRenderbuffers, "_emscripten_glDeleteShader": _emscripten_glDeleteShader, "_emscripten_glDeleteTextures": _emscripten_glDeleteTextures, "_emscripten_glDeleteVertexArraysOES": _emscripten_glDeleteVertexArraysOES, "_emscripten_glDepthFunc": _emscripten_glDepthFunc, "_emscripten_glDepthMask": _emscripten_glDepthMask, "_emscripten_glDepthRangef": _emscripten_glDepthRangef, "_emscripten_glDetachShader": _emscripten_glDetachShader, "_emscripten_glDisable": _emscripten_glDisable, "_emscripten_glDisableVertexAttribArray": _emscripten_glDisableVertexAttribArray, "_emscripten_glDrawArrays": _emscripten_glDrawArrays, "_emscripten_glDrawArraysInstancedANGLE": _emscripten_glDrawArraysInstancedANGLE, "_emscripten_glDrawBuffersWEBGL": _emscripten_glDrawBuffersWEBGL, "_emscripten_glDrawElements": _emscripten_glDrawElements, "_emscripten_glDrawElementsInstancedANGLE": _emscripten_glDrawElementsInstancedANGLE, "_emscripten_glEnable": _emscripten_glEnable, "_emscripten_glEnableVertexAttribArray": _emscripten_glEnableVertexAttribArray, "_emscripten_glEndQueryEXT": _emscripten_glEndQueryEXT, "_emscripten_glFinish": _emscripten_glFinish, "_emscripten_glFlush": _emscripten_glFlush, "_emscripten_glFramebufferRenderbuffer": _emscripten_glFramebufferRenderbuffer, "_emscripten_glFramebufferTexture2D": _emscripten_glFramebufferTexture2D, "_emscripten_glFrontFace": _emscripten_glFrontFace, "_emscripten_glGenBuffers": _emscripten_glGenBuffers, "_emscripten_glGenFramebuffers": _emscripten_glGenFramebuffers, "_emscripten_glGenQueriesEXT": _emscripten_glGenQueriesEXT, "_emscripten_glGenRenderbuffers": _emscripten_glGenRenderbuffers, "_emscripten_glGenTextures": _emscripten_glGenTextures, "_emscripten_glGenVertexArraysOES": _emscripten_glGenVertexArraysOES, "_emscripten_glGenerateMipmap": _emscripten_glGenerateMipmap, "_emscripten_glGetActiveAttrib": _emscripten_glGetActiveAttrib, "_emscripten_glGetActiveUniform": _emscripten_glGetActiveUniform, "_emscripten_glGetAttachedShaders": _emscripten_glGetAttachedShaders, "_emscripten_glGetAttribLocation": _emscripten_glGetAttribLocation, "_emscripten_glGetBooleanv": _emscripten_glGetBooleanv, "_emscripten_glGetBufferParameteriv": _emscripten_glGetBufferParameteriv, "_emscripten_glGetError": _emscripten_glGetError, "_emscripten_glGetFloatv": _emscripten_glGetFloatv, "_emscripten_glGetFramebufferAttachmentParameteriv": _emscripten_glGetFramebufferAttachmentParameteriv, "_emscripten_glGetIntegerv": _emscripten_glGetIntegerv, "_emscripten_glGetProgramInfoLog": _emscripten_glGetProgramInfoLog, "_emscripten_glGetProgramiv": _emscripten_glGetProgramiv, "_emscripten_glGetQueryObjecti64vEXT": _emscripten_glGetQueryObjecti64vEXT, "_emscripten_glGetQueryObjectivEXT": _emscripten_glGetQueryObjectivEXT, "_emscripten_glGetQueryObjectui64vEXT": _emscripten_glGetQueryObjectui64vEXT, "_emscripten_glGetQueryObjectuivEXT": _emscripten_glGetQueryObjectuivEXT, "_emscripten_glGetQueryivEXT": _emscripten_glGetQueryivEXT, "_emscripten_glGetRenderbufferParameteriv": _emscripten_glGetRenderbufferParameteriv, "_emscripten_glGetShaderInfoLog": _emscripten_glGetShaderInfoLog, "_emscripten_glGetShaderPrecisionFormat": _emscripten_glGetShaderPrecisionFormat, "_emscripten_glGetShaderSource": _emscripten_glGetShaderSource, "_emscripten_glGetShaderiv": _emscripten_glGetShaderiv, "_emscripten_glGetString": _emscripten_glGetString, "_emscripten_glGetTexParameterfv": _emscripten_glGetTexParameterfv, "_emscripten_glGetTexParameteriv": _emscripten_glGetTexParameteriv, "_emscripten_glGetUniformLocation": _emscripten_glGetUniformLocation, "_emscripten_glGetUniformfv": _emscripten_glGetUniformfv, "_emscripten_glGetUniformiv": _emscripten_glGetUniformiv, "_emscripten_glGetVertexAttribPointerv": _emscripten_glGetVertexAttribPointerv, "_emscripten_glGetVertexAttribfv": _emscripten_glGetVertexAttribfv, "_emscripten_glGetVertexAttribiv": _emscripten_glGetVertexAttribiv, "_emscripten_glHint": _emscripten_glHint, "_emscripten_glIsBuffer": _emscripten_glIsBuffer, "_emscripten_glIsEnabled": _emscripten_glIsEnabled, "_emscripten_glIsFramebuffer": _emscripten_glIsFramebuffer, "_emscripten_glIsProgram": _emscripten_glIsProgram, "_emscripten_glIsQueryEXT": _emscripten_glIsQueryEXT, "_emscripten_glIsRenderbuffer": _emscripten_glIsRenderbuffer, "_emscripten_glIsShader": _emscripten_glIsShader, "_emscripten_glIsTexture": _emscripten_glIsTexture, "_emscripten_glIsVertexArrayOES": _emscripten_glIsVertexArrayOES, "_emscripten_glLineWidth": _emscripten_glLineWidth, "_emscripten_glLinkProgram": _emscripten_glLinkProgram, "_emscripten_glPixelStorei": _emscripten_glPixelStorei, "_emscripten_glPolygonOffset": _emscripten_glPolygonOffset, "_emscripten_glQueryCounterEXT": _emscripten_glQueryCounterEXT, "_emscripten_glReadPixels": _emscripten_glReadPixels, "_emscripten_glReleaseShaderCompiler": _emscripten_glReleaseShaderCompiler, "_emscripten_glRenderbufferStorage": _emscripten_glRenderbufferStorage, "_emscripten_glSampleCoverage": _emscripten_glSampleCoverage, "_emscripten_glScissor": _emscripten_glScissor, "_emscripten_glShaderBinary": _emscripten_glShaderBinary, "_emscripten_glShaderSource": _emscripten_glShaderSource, "_emscripten_glStencilFunc": _emscripten_glStencilFunc, "_emscripten_glStencilFuncSeparate": _emscripten_glStencilFuncSeparate, "_emscripten_glStencilMask": _emscripten_glStencilMask, "_emscripten_glStencilMaskSeparate": _emscripten_glStencilMaskSeparate, "_emscripten_glStencilOp": _emscripten_glStencilOp, "_emscripten_glStencilOpSeparate": _emscripten_glStencilOpSeparate, "_emscripten_glTexImage2D": _emscripten_glTexImage2D, "_emscripten_glTexParameterf": _emscripten_glTexParameterf, "_emscripten_glTexParameterfv": _emscripten_glTexParameterfv, "_emscripten_glTexParameteri": _emscripten_glTexParameteri, "_emscripten_glTexParameteriv": _emscripten_glTexParameteriv, "_emscripten_glTexSubImage2D": _emscripten_glTexSubImage2D, "_emscripten_glUniform1f": _emscripten_glUniform1f, "_emscripten_glUniform1fv": _emscripten_glUniform1fv, "_emscripten_glUniform1i": _emscripten_glUniform1i, "_emscripten_glUniform1iv": _emscripten_glUniform1iv, "_emscripten_glUniform2f": _emscripten_glUniform2f, "_emscripten_glUniform2fv": _emscripten_glUniform2fv, "_emscripten_glUniform2i": _emscripten_glUniform2i, "_emscripten_glUniform2iv": _emscripten_glUniform2iv, "_emscripten_glUniform3f": _emscripten_glUniform3f, "_emscripten_glUniform3fv": _emscripten_glUniform3fv, "_emscripten_glUniform3i": _emscripten_glUniform3i, "_emscripten_glUniform3iv": _emscripten_glUniform3iv, "_emscripten_glUniform4f": _emscripten_glUniform4f, "_emscripten_glUniform4fv": _emscripten_glUniform4fv, "_emscripten_glUniform4i": _emscripten_glUniform4i, "_emscripten_glUniform4iv": _emscripten_glUniform4iv, "_emscripten_glUniformMatrix2fv": _emscripten_glUniformMatrix2fv, "_emscripten_glUniformMatrix3fv": _emscripten_glUniformMatrix3fv, "_emscripten_glUniformMatrix4fv": _emscripten_glUniformMatrix4fv, "_emscripten_glUseProgram": _emscripten_glUseProgram, "_emscripten_glValidateProgram": _emscripten_glValidateProgram, "_emscripten_glVertexAttrib1f": _emscripten_glVertexAttrib1f, "_emscripten_glVertexAttrib1fv": _emscripten_glVertexAttrib1fv, "_emscripten_glVertexAttrib2f": _emscripten_glVertexAttrib2f, "_emscripten_glVertexAttrib2fv": _emscripten_glVertexAttrib2fv, "_emscripten_glVertexAttrib3f": _emscripten_glVertexAttrib3f, "_emscripten_glVertexAttrib3fv": _emscripten_glVertexAttrib3fv, "_emscripten_glVertexAttrib4f": _emscripten_glVertexAttrib4f, "_emscripten_glVertexAttrib4fv": _emscripten_glVertexAttrib4fv, "_emscripten_glVertexAttribDivisorANGLE": _emscripten_glVertexAttribDivisorANGLE, "_emscripten_glVertexAttribPointer": _emscripten_glVertexAttribPointer, "_emscripten_glViewport": _emscripten_glViewport, "_emscripten_memcpy_big": _emscripten_memcpy_big, "_emscripten_request_pointerlock": _emscripten_request_pointerlock, "_emscripten_resize_heap": _emscripten_resize_heap, "_emscripten_run_script": _emscripten_run_script, "_emscripten_sample_gamepad_data": _emscripten_sample_gamepad_data, "_emscripten_set_click_callback_on_thread": _emscripten_set_click_callback_on_thread, "_emscripten_set_fullscreenchange_callback_on_thread": _emscripten_set_fullscreenchange_callback_on_thread, "_emscripten_set_gamepadconnected_callback_on_thread": _emscripten_set_gamepadconnected_callback_on_thread, "_emscripten_set_gamepaddisconnected_callback_on_thread": _emscripten_set_gamepaddisconnected_callback_on_thread, "_emscripten_set_keypress_callback_on_thread": _emscripten_set_keypress_callback_on_thread, "_emscripten_set_main_loop": _emscripten_set_main_loop, "_emscripten_set_main_loop_timing": _emscripten_set_main_loop_timing, "_emscripten_set_touchcancel_callback_on_thread": _emscripten_set_touchcancel_callback_on_thread, "_emscripten_set_touchend_callback_on_thread": _emscripten_set_touchend_callback_on_thread, "_emscripten_set_touchmove_callback_on_thread": _emscripten_set_touchmove_callback_on_thread, "_emscripten_set_touchstart_callback_on_thread": _emscripten_set_touchstart_callback_on_thread, "_exit": _exit, "_fd_close": _fd_close, "_fd_read": _fd_read, "_fd_seek": _fd_seek, "_fd_write": _fd_write, "_glActiveTexture": _glActiveTexture, "_glAttachShader": _glAttachShader, "_glBindAttribLocation": _glBindAttribLocation, "_glBindBuffer": _glBindBuffer, "_glBindTexture": _glBindTexture, "_glBlendFunc": _glBlendFunc, "_glBufferData": _glBufferData, "_glBufferSubData": _glBufferSubData, "_glClear": _glClear, "_glClearColor": _glClearColor, "_glClearDepthf": _glClearDepthf, "_glCompileShader": _glCompileShader, "_glCompressedTexImage2D": _glCompressedTexImage2D, "_glCreateProgram": _glCreateProgram, "_glCreateShader": _glCreateShader, "_glCullFace": _glCullFace, "_glDeleteProgram": _glDeleteProgram, "_glDepthFunc": _glDepthFunc, "_glDisable": _glDisable, "_glDrawArrays": _glDrawArrays, "_glDrawElements": _glDrawElements, "_glEnable": _glEnable, "_glEnableVertexAttribArray": _glEnableVertexAttribArray, "_glFrontFace": _glFrontFace, "_glGenBuffers": _glGenBuffers, "_glGenTextures": _glGenTextures, "_glGetAttribLocation": _glGetAttribLocation, "_glGetFloatv": _glGetFloatv, "_glGetProgramInfoLog": _glGetProgramInfoLog, "_glGetProgramiv": _glGetProgramiv, "_glGetShaderInfoLog": _glGetShaderInfoLog, "_glGetShaderiv": _glGetShaderiv, "_glGetString": _glGetString, "_glGetUniformLocation": _glGetUniformLocation, "_glLinkProgram": _glLinkProgram, "_glPixelStorei": _glPixelStorei, "_glReadPixels": _glReadPixels, "_glShaderSource": _glShaderSource, "_glTexImage2D": _glTexImage2D, "_glTexParameteri": _glTexParameteri, "_glUniform1i": _glUniform1i, "_glUniform4f": _glUniform4f, "_glUniformMatrix4fv": _glUniformMatrix4fv, "_glUseProgram": _glUseProgram, "_glVertexAttribPointer": _glVertexAttribPointer, "_glViewport": _glViewport, "_glfwCreateWindow": _glfwCreateWindow, "_glfwDefaultWindowHints": _glfwDefaultWindowHints, "_glfwGetCursorPos": _glfwGetCursorPos, "_glfwGetPrimaryMonitor": _glfwGetPrimaryMonitor, "_glfwGetTime": _glfwGetTime, "_glfwGetVideoModes": _glfwGetVideoModes, "_glfwInit": _glfwInit, "_glfwMakeContextCurrent": _glfwMakeContextCurrent, "_glfwSetCharCallback": _glfwSetCharCallback, "_glfwSetCursorEnterCallback": _glfwSetCursorEnterCallback, "_glfwSetCursorPosCallback": _glfwSetCursorPosCallback, "_glfwSetDropCallback": _glfwSetDropCallback, "_glfwSetErrorCallback": _glfwSetErrorCallback, "_glfwSetKeyCallback": _glfwSetKeyCallback, "_glfwSetMouseButtonCallback": _glfwSetMouseButtonCallback, "_glfwSetScrollCallback": _glfwSetScrollCallback, "_glfwSetWindowIconifyCallback": _glfwSetWindowIconifyCallback, "_glfwSetWindowShouldClose": _glfwSetWindowShouldClose, "_glfwSetWindowSizeCallback": _glfwSetWindowSizeCallback, "_glfwSwapBuffers": _glfwSwapBuffers, "_glfwSwapInterval": _glfwSwapInterval, "_glfwTerminate": _glfwTerminate, "_glfwWindowHint": _glfwWindowHint, "_llvm_cos_f32": _llvm_cos_f32, "_llvm_cttz_i32": _llvm_cttz_i32, "_llvm_sin_f32": _llvm_sin_f32, "_llvm_stackrestore": _llvm_stackrestore, "_llvm_stacksave": _llvm_stacksave, "_nanosleep": _nanosleep, "_time": _time, "_usleep": _usleep, "abort": abort, "abortOnCannotGrowMemory": abortOnCannotGrowMemory, "abortStackOverflow": abortStackOverflow, "abortStackOverflowEmterpreter": abortStackOverflowEmterpreter, "demangle": demangle, "demangleAll": demangleAll, "eb": eb, "emscriptenWebGLGet": emscriptenWebGLGet, "emscriptenWebGLGetTexPixelData": emscriptenWebGLGetTexPixelData, "emscriptenWebGLGetUniform": emscriptenWebGLGetUniform, "emscriptenWebGLGetVertexAttrib": emscriptenWebGLGetVertexAttrib, "getTempRet0": getTempRet0, "jsStackTrace": jsStackTrace, "memory": wasmMemory, "nullFunc_ff": nullFunc_ff, "nullFunc_fff": nullFunc_fff, "nullFunc_i": nullFunc_i, "nullFunc_ii": nullFunc_ii, "nullFunc_iidiiii": nullFunc_iidiiii, "nullFunc_iii": nullFunc_iii, "nullFunc_iiii": nullFunc_iiii, "nullFunc_iiiii": nullFunc_iiiii, "nullFunc_v": nullFunc_v, "nullFunc_vf": nullFunc_vf, "nullFunc_vff": nullFunc_vff, "nullFunc_vffff": nullFunc_vffff, "nullFunc_vfi": nullFunc_vfi, "nullFunc_vi": nullFunc_vi, "nullFunc_vidd": nullFunc_vidd, "nullFunc_vif": nullFunc_vif, "nullFunc_viff": nullFunc_viff, "nullFunc_vifff": nullFunc_vifff, "nullFunc_viffff": nullFunc_viffff, "nullFunc_vii": nullFunc_vii, "nullFunc_viif": nullFunc_viif, "nullFunc_viii": nullFunc_viii, "nullFunc_viiii": nullFunc_viiii, "nullFunc_viiiii": nullFunc_viiiii, "nullFunc_viiiiii": nullFunc_viiiiii, "nullFunc_viiiiiii": nullFunc_viiiiiii, "nullFunc_viiiiiiii": nullFunc_viiiiiiii, "nullFunc_viiiiiiiii": nullFunc_viiiiiiiii, "setTempRet0": setTempRet0, "stackTrace": stackTrace, "stringToNewUTF8": stringToNewUTF8, "table": wasmTable, "tempDoublePtr": tempDoublePtr };
// EMSCRIPTEN_START_ASM
var asm =Module["asm"]// EMSCRIPTEN_END_ASM
(asmGlobalArg, asmLibraryArg, buffer);

Module["asm"] = asm;
var ___errno_location = Module["___errno_location"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["___errno_location"].apply(null, arguments)
};

var ___muldi3 = Module["___muldi3"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["___muldi3"].apply(null, arguments)
};

var ___udivdi3 = Module["___udivdi3"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["___udivdi3"].apply(null, arguments)
};

var _bitshift64Lshr = Module["_bitshift64Lshr"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["_bitshift64Lshr"].apply(null, arguments)
};

var _bitshift64Shl = Module["_bitshift64Shl"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["_bitshift64Shl"].apply(null, arguments)
};

var _emscripten_GetProcAddress = Module["_emscripten_GetProcAddress"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["_emscripten_GetProcAddress"].apply(null, arguments)
};

var _emscripten_get_sbrk_ptr = Module["_emscripten_get_sbrk_ptr"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["_emscripten_get_sbrk_ptr"].apply(null, arguments)
};

var _fflush = Module["_fflush"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["_fflush"].apply(null, arguments)
};

var _free = Module["_free"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["_free"].apply(null, arguments)
};

var _i64Add = Module["_i64Add"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["_i64Add"].apply(null, arguments)
};

var _i64Subtract = Module["_i64Subtract"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["_i64Subtract"].apply(null, arguments)
};

var _llvm_round_f64 = Module["_llvm_round_f64"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["_llvm_round_f64"].apply(null, arguments)
};

var _main = Module["_main"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["_main"].apply(null, arguments)
};

var _malloc = Module["_malloc"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["_malloc"].apply(null, arguments)
};

var _memcpy = Module["_memcpy"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["_memcpy"].apply(null, arguments)
};

var _memmove = Module["_memmove"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["_memmove"].apply(null, arguments)
};

var _memset = Module["_memset"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["_memset"].apply(null, arguments)
};

var _strstr = Module["_strstr"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["_strstr"].apply(null, arguments)
};

var emtStackRestore = Module["emtStackRestore"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["emtStackRestore"].apply(null, arguments)
};

var emtStackSave = Module["emtStackSave"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["emtStackSave"].apply(null, arguments)
};

var emterpret = Module["emterpret"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["emterpret"].apply(null, arguments)
};

var establishStackSpace = Module["establishStackSpace"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["establishStackSpace"].apply(null, arguments)
};

var getEmtStackMax = Module["getEmtStackMax"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["getEmtStackMax"].apply(null, arguments)
};

var setAsyncState = Module["setAsyncState"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["setAsyncState"].apply(null, arguments)
};

var setEmtStackMax = Module["setEmtStackMax"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["setEmtStackMax"].apply(null, arguments)
};

var stackAlloc = Module["stackAlloc"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["stackAlloc"].apply(null, arguments)
};

var stackRestore = Module["stackRestore"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["stackRestore"].apply(null, arguments)
};

var stackSave = Module["stackSave"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["stackSave"].apply(null, arguments)
};

var dynCall_ff = Module["dynCall_ff"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_ff"].apply(null, arguments)
};

var dynCall_fff = Module["dynCall_fff"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_fff"].apply(null, arguments)
};

var dynCall_i = Module["dynCall_i"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_i"].apply(null, arguments)
};

var dynCall_ii = Module["dynCall_ii"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_ii"].apply(null, arguments)
};

var dynCall_iidiiii = Module["dynCall_iidiiii"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_iidiiii"].apply(null, arguments)
};

var dynCall_iii = Module["dynCall_iii"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_iii"].apply(null, arguments)
};

var dynCall_iiii = Module["dynCall_iiii"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_iiii"].apply(null, arguments)
};

var dynCall_iiiii = Module["dynCall_iiiii"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_iiiii"].apply(null, arguments)
};

var dynCall_v = Module["dynCall_v"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_v"].apply(null, arguments)
};

var dynCall_vf = Module["dynCall_vf"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_vf"].apply(null, arguments)
};

var dynCall_vff = Module["dynCall_vff"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_vff"].apply(null, arguments)
};

var dynCall_vffff = Module["dynCall_vffff"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_vffff"].apply(null, arguments)
};

var dynCall_vfi = Module["dynCall_vfi"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_vfi"].apply(null, arguments)
};

var dynCall_vi = Module["dynCall_vi"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_vi"].apply(null, arguments)
};

var dynCall_vidd = Module["dynCall_vidd"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_vidd"].apply(null, arguments)
};

var dynCall_vif = Module["dynCall_vif"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_vif"].apply(null, arguments)
};

var dynCall_viff = Module["dynCall_viff"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_viff"].apply(null, arguments)
};

var dynCall_vifff = Module["dynCall_vifff"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_vifff"].apply(null, arguments)
};

var dynCall_viffff = Module["dynCall_viffff"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_viffff"].apply(null, arguments)
};

var dynCall_vii = Module["dynCall_vii"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_vii"].apply(null, arguments)
};

var dynCall_viif = Module["dynCall_viif"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_viif"].apply(null, arguments)
};

var dynCall_viii = Module["dynCall_viii"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_viii"].apply(null, arguments)
};

var dynCall_viiii = Module["dynCall_viiii"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_viiii"].apply(null, arguments)
};

var dynCall_viiiii = Module["dynCall_viiiii"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_viiiii"].apply(null, arguments)
};

var dynCall_viiiiii = Module["dynCall_viiiiii"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_viiiiii"].apply(null, arguments)
};

var dynCall_viiiiiii = Module["dynCall_viiiiiii"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_viiiiiii"].apply(null, arguments)
};

var dynCall_viiiiiiii = Module["dynCall_viiiiiiii"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_viiiiiiii"].apply(null, arguments)
};

var dynCall_viiiiiiiii = Module["dynCall_viiiiiiiii"] = function() {
  assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
  assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
  return Module["asm"]["dynCall_viiiiiiiii"].apply(null, arguments)
};
;



// === Auto-generated postamble setup entry stuff ===

Module['asm'] = asm;

if (!Object.getOwnPropertyDescriptor(Module, "intArrayFromString")) Module["intArrayFromString"] = function() { abort("'intArrayFromString' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "intArrayToString")) Module["intArrayToString"] = function() { abort("'intArrayToString' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "ccall")) Module["ccall"] = function() { abort("'ccall' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "cwrap")) Module["cwrap"] = function() { abort("'cwrap' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "setValue")) Module["setValue"] = function() { abort("'setValue' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "getValue")) Module["getValue"] = function() { abort("'getValue' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "allocate")) Module["allocate"] = function() { abort("'allocate' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "getMemory")) Module["getMemory"] = function() { abort("'getMemory' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Object.getOwnPropertyDescriptor(Module, "AsciiToString")) Module["AsciiToString"] = function() { abort("'AsciiToString' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "stringToAscii")) Module["stringToAscii"] = function() { abort("'stringToAscii' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "UTF8ArrayToString")) Module["UTF8ArrayToString"] = function() { abort("'UTF8ArrayToString' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "UTF8ToString")) Module["UTF8ToString"] = function() { abort("'UTF8ToString' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "stringToUTF8Array")) Module["stringToUTF8Array"] = function() { abort("'stringToUTF8Array' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "stringToUTF8")) Module["stringToUTF8"] = function() { abort("'stringToUTF8' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "lengthBytesUTF8")) Module["lengthBytesUTF8"] = function() { abort("'lengthBytesUTF8' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "UTF16ToString")) Module["UTF16ToString"] = function() { abort("'UTF16ToString' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "stringToUTF16")) Module["stringToUTF16"] = function() { abort("'stringToUTF16' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "lengthBytesUTF16")) Module["lengthBytesUTF16"] = function() { abort("'lengthBytesUTF16' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "UTF32ToString")) Module["UTF32ToString"] = function() { abort("'UTF32ToString' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "stringToUTF32")) Module["stringToUTF32"] = function() { abort("'stringToUTF32' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "lengthBytesUTF32")) Module["lengthBytesUTF32"] = function() { abort("'lengthBytesUTF32' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "allocateUTF8")) Module["allocateUTF8"] = function() { abort("'allocateUTF8' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "stackTrace")) Module["stackTrace"] = function() { abort("'stackTrace' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "addOnPreRun")) Module["addOnPreRun"] = function() { abort("'addOnPreRun' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "addOnInit")) Module["addOnInit"] = function() { abort("'addOnInit' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "addOnPreMain")) Module["addOnPreMain"] = function() { abort("'addOnPreMain' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "addOnExit")) Module["addOnExit"] = function() { abort("'addOnExit' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "addOnPostRun")) Module["addOnPostRun"] = function() { abort("'addOnPostRun' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "writeStringToMemory")) Module["writeStringToMemory"] = function() { abort("'writeStringToMemory' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "writeArrayToMemory")) Module["writeArrayToMemory"] = function() { abort("'writeArrayToMemory' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "writeAsciiToMemory")) Module["writeAsciiToMemory"] = function() { abort("'writeAsciiToMemory' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "addRunDependency")) Module["addRunDependency"] = function() { abort("'addRunDependency' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Object.getOwnPropertyDescriptor(Module, "removeRunDependency")) Module["removeRunDependency"] = function() { abort("'removeRunDependency' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Object.getOwnPropertyDescriptor(Module, "ENV")) Module["ENV"] = function() { abort("'ENV' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "FS")) Module["FS"] = function() { abort("'FS' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "FS_createFolder")) Module["FS_createFolder"] = function() { abort("'FS_createFolder' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Object.getOwnPropertyDescriptor(Module, "FS_createPath")) Module["FS_createPath"] = function() { abort("'FS_createPath' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Object.getOwnPropertyDescriptor(Module, "FS_createDataFile")) Module["FS_createDataFile"] = function() { abort("'FS_createDataFile' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Object.getOwnPropertyDescriptor(Module, "FS_createPreloadedFile")) Module["FS_createPreloadedFile"] = function() { abort("'FS_createPreloadedFile' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Object.getOwnPropertyDescriptor(Module, "FS_createLazyFile")) Module["FS_createLazyFile"] = function() { abort("'FS_createLazyFile' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Object.getOwnPropertyDescriptor(Module, "FS_createLink")) Module["FS_createLink"] = function() { abort("'FS_createLink' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Object.getOwnPropertyDescriptor(Module, "FS_createDevice")) Module["FS_createDevice"] = function() { abort("'FS_createDevice' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Object.getOwnPropertyDescriptor(Module, "FS_unlink")) Module["FS_unlink"] = function() { abort("'FS_unlink' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Object.getOwnPropertyDescriptor(Module, "GL")) Module["GL"] = function() { abort("'GL' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "dynamicAlloc")) Module["dynamicAlloc"] = function() { abort("'dynamicAlloc' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "loadDynamicLibrary")) Module["loadDynamicLibrary"] = function() { abort("'loadDynamicLibrary' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "loadWebAssemblyModule")) Module["loadWebAssemblyModule"] = function() { abort("'loadWebAssemblyModule' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "getLEB")) Module["getLEB"] = function() { abort("'getLEB' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "getFunctionTables")) Module["getFunctionTables"] = function() { abort("'getFunctionTables' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "alignFunctionTables")) Module["alignFunctionTables"] = function() { abort("'alignFunctionTables' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "registerFunctions")) Module["registerFunctions"] = function() { abort("'registerFunctions' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "addFunction")) Module["addFunction"] = function() { abort("'addFunction' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "removeFunction")) Module["removeFunction"] = function() { abort("'removeFunction' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "getFuncWrapper")) Module["getFuncWrapper"] = function() { abort("'getFuncWrapper' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "prettyPrint")) Module["prettyPrint"] = function() { abort("'prettyPrint' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "makeBigInt")) Module["makeBigInt"] = function() { abort("'makeBigInt' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "dynCall")) Module["dynCall"] = function() { abort("'dynCall' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "getCompilerSetting")) Module["getCompilerSetting"] = function() { abort("'getCompilerSetting' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "print")) Module["print"] = function() { abort("'print' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "printErr")) Module["printErr"] = function() { abort("'printErr' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "getTempRet0")) Module["getTempRet0"] = function() { abort("'getTempRet0' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "setTempRet0")) Module["setTempRet0"] = function() { abort("'setTempRet0' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "callMain")) Module["callMain"] = function() { abort("'callMain' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "abort")) Module["abort"] = function() { abort("'abort' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "Pointer_stringify")) Module["Pointer_stringify"] = function() { abort("'Pointer_stringify' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "warnOnce")) Module["warnOnce"] = function() { abort("'warnOnce' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "stackSave")) Module["stackSave"] = function() { abort("'stackSave' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "stackRestore")) Module["stackRestore"] = function() { abort("'stackRestore' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "stackAlloc")) Module["stackAlloc"] = function() { abort("'stackAlloc' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "establishStackSpace")) Module["establishStackSpace"] = function() { abort("'establishStackSpace' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
Module["writeStackCookie"] = writeStackCookie;
Module["checkStackCookie"] = checkStackCookie;
Module["abortStackOverflow"] = abortStackOverflow;if (!Object.getOwnPropertyDescriptor(Module, "ALLOC_NORMAL")) Object.defineProperty(Module, "ALLOC_NORMAL", { configurable: true, get: function() { abort("'ALLOC_NORMAL' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") } });
if (!Object.getOwnPropertyDescriptor(Module, "ALLOC_STACK")) Object.defineProperty(Module, "ALLOC_STACK", { configurable: true, get: function() { abort("'ALLOC_STACK' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") } });
if (!Object.getOwnPropertyDescriptor(Module, "ALLOC_DYNAMIC")) Object.defineProperty(Module, "ALLOC_DYNAMIC", { configurable: true, get: function() { abort("'ALLOC_DYNAMIC' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") } });
if (!Object.getOwnPropertyDescriptor(Module, "ALLOC_NONE")) Object.defineProperty(Module, "ALLOC_NONE", { configurable: true, get: function() { abort("'ALLOC_NONE' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") } });
if (!Object.getOwnPropertyDescriptor(Module, "calledRun")) Object.defineProperty(Module, "calledRun", { configurable: true, get: function() { abort("'calledRun' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") } });



var calledRun;


/**
 * @constructor
 * @this {ExitStatus}
 */
function ExitStatus(status) {
  this.name = "ExitStatus";
  this.message = "Program terminated with exit(" + status + ")";
  this.status = status;
}

var calledMain = false;


dependenciesFulfilled = function runCaller() {
  // If run has never been called, and we should call run (INVOKE_RUN is true, and Module.noInitialRun is not false)
  if (!calledRun) run();
  if (!calledRun) dependenciesFulfilled = runCaller; // try this again later, after new deps are fulfilled
};

function callMain(args) {
  assert(runDependencies == 0, 'cannot call main when async dependencies remain! (listen on Module["onRuntimeInitialized"])');
  assert(__ATPRERUN__.length == 0, 'cannot call main when preRun functions remain to be called');

  var entryFunction = Module['_main'];


  args = args || [];

  var argc = args.length+1;
  var argv = stackAlloc((argc + 1) * 4);
  HEAP32[argv >> 2] = allocateUTF8OnStack(thisProgram);
  for (var i = 1; i < argc; i++) {
    HEAP32[(argv >> 2) + i] = allocateUTF8OnStack(args[i - 1]);
  }
  HEAP32[(argv >> 2) + argc] = 0;

  var initialEmtStackTop = Module['emtStackSave']();

  try {


    var ret = entryFunction(argc, argv);


    // if we are saving the stack, then do not call exit, we are not
    // really exiting now, just unwinding the JS stack
    if (!noExitRuntime) {
    // if we're not running an evented main loop, it's time to exit
      exit(ret, /* implicit = */ true);
    }
  }
  catch(e) {
    if (e instanceof ExitStatus) {
      // exit() throws this once it's done to make sure execution
      // has been stopped completely
      return;
    } else if (e == 'unwind') {
      // running an evented main loop, don't immediately exit
      noExitRuntime = true;
      // an infinite loop keeps the C stack around, but the emterpreter stack must be unwound - we do not want to restore the call stack at infinite loop
      Module['emtStackRestore'](initialEmtStackTop);
      return;
    } else {
      var toLog = e;
      if (e && typeof e === 'object' && e.stack) {
        toLog = [e, e.stack];
      }
      err('exception thrown: ' + toLog);
      quit_(1, e);
    }
  } finally {
    calledMain = true;
  }
}




/** @type {function(Array=)} */
function run(args) {
  args = args || arguments_;

  if (runDependencies > 0) {
    return;
  }

  writeStackCookie();

  preRun();

  if (runDependencies > 0) return; // a preRun added a dependency, run will be called later

  function doRun() {
    // run may have just been called through dependencies being fulfilled just in this very frame,
    // or while the async setStatus time below was happening
    if (calledRun) return;
    calledRun = true;

    if (ABORT) return;

    initRuntime();

    preMain();

    if (Module['onRuntimeInitialized']) Module['onRuntimeInitialized']();

    if (shouldRunNow) callMain(args);

    postRun();
  }

  if (Module['setStatus']) {
    Module['setStatus']('Running...');
    setTimeout(function() {
      setTimeout(function() {
        Module['setStatus']('');
      }, 1);
      doRun();
    }, 1);
  } else
  {
    doRun();
  }
  checkStackCookie();
}
Module['run'] = run;

function checkUnflushedContent() {
  // Compiler settings do not allow exiting the runtime, so flushing
  // the streams is not possible. but in ASSERTIONS mode we check
  // if there was something to flush, and if so tell the user they
  // should request that the runtime be exitable.
  // Normally we would not even include flush() at all, but in ASSERTIONS
  // builds we do so just for this check, and here we see if there is any
  // content to flush, that is, we check if there would have been
  // something a non-ASSERTIONS build would have not seen.
  // How we flush the streams depends on whether we are in SYSCALLS_REQUIRE_FILESYSTEM=0
  // mode (which has its own special function for this; otherwise, all
  // the code is inside libc)
  var print = out;
  var printErr = err;
  var has = false;
  out = err = function(x) {
    has = true;
  }
  try { // it doesn't matter if it fails
    var flush = Module['_fflush'];
    if (flush) flush(0);
    // also flush in the JS FS layer
    ['stdout', 'stderr'].forEach(function(name) {
      var info = FS.analyzePath('/dev/' + name);
      if (!info) return;
      var stream = info.object;
      var rdev = stream.rdev;
      var tty = TTY.ttys[rdev];
      if (tty && tty.output && tty.output.length) {
        has = true;
      }
    });
  } catch(e) {}
  out = print;
  err = printErr;
  if (has) {
    warnOnce('stdio streams had content in them that was not flushed. you should set EXIT_RUNTIME to 1 (see the FAQ), or make sure to emit a newline when you printf etc.');
  }
}

function exit(status, implicit) {
  checkUnflushedContent();

  // if this is just main exit-ing implicitly, and the status is 0, then we
  // don't need to do anything here and can just leave. if the status is
  // non-zero, though, then we need to report it.
  // (we may have warned about this earlier, if a situation justifies doing so)
  if (implicit && noExitRuntime && status === 0) {
    return;
  }

  if (noExitRuntime) {
    // if exit() was called, we may warn the user if the runtime isn't actually being shut down
    if (!implicit) {
      err('program exited (with status: ' + status + '), but EXIT_RUNTIME is not set, so halting execution but not exiting the runtime or preventing further async execution (build with EXIT_RUNTIME=1, if you want a true shutdown)');
    }
  } else {

    ABORT = true;
    EXITSTATUS = status;

    exitRuntime();

    if (Module['onExit']) Module['onExit'](status);
  }

  quit_(status, new ExitStatus(status));
}

if (Module['preInit']) {
  if (typeof Module['preInit'] == 'function') Module['preInit'] = [Module['preInit']];
  while (Module['preInit'].length > 0) {
    Module['preInit'].pop()();
  }
}

// shouldRunNow refers to calling main(), not run().
var shouldRunNow = true;

if (Module['noInitialRun']) shouldRunNow = false;


  noExitRuntime = true;

run();





// {{MODULE_ADDITIONS}}










