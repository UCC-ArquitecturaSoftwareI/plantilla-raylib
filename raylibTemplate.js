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
    'wasi_unstable': asmLibraryArg
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

var eb = getMemory(172784);
assert(eb % 8 === 0);
__ATPRERUN__.push(function() {
  HEAPU8.set([140,6,195,0,0,0,0,0,2,186,0,0,0,202,154,59,2,187,0,0,24,2,0,0,2,188,0,0,200,61,0,0,1,184,0,0,136,189,0,0,0,185,189,0,136,189,0,0,1,190,48,2,3,189,189,190,137,189,0,0,130,189,0,0,136,190,0,0,49,189,189,190,88,0,0,0,1,190,48,2,135,189,0,0,190,0,0,0,1,190,0,0,97,185,187,190,1,190,28,2,3,190,185,190,25,93,190,12,134,96,0,0,88,153,2,0,1,0,0,0,135,99,1,0,34,190,99,0,121,190,11,0,68,190,1,0,134,110,0,0,88,153,2,0,190,0,0,0,68,10,1,0,1,20,1,0,1,21,165,61,135,129,1,0,0,165,110,0,119,0,24,0,58,10,1,0,1,190,1,8,19,190,4,190,33,190,190,0,38,190,190,1,0,20,190,0,1,189,0,8,19,189,4,189,32,189,189,0,121,189,9,0,38,191,4,1,32,191,191,0,1,192,166,61,1,193,171,61,125,189,191,192,193,0,0,0,0,190,189,0,119,0,3,0,1,189,168,61,0,190,189,0,0,21,190,0,0,129,99,0,0,165,96,0,1,190,0,0,32,190,190,0,2,189,0,0,0,0,240,127,19,189,129,189,2,193,0,0,0,0,240,127,13,189,189,193,19,190,190,189,121,190,47,0,25,153,20,3,1,189,32,0,2,193,0,0,255,255,254,255,19,193,4,193,134,190,0,0,152,115,2,0,0,189,2,153,193,0,0,0,134,190,0,0,160,156,2,0,0,21,20,0,70,189,10,10,59,192,0,0,59,191,0,0,70,192,192,191,20,189,189,192,121,189,9,0,38,192,5,32,33,192,192,0,1,191,192,61,1,194,196,61,125,189,192,191,194,0,0,0,0,193,189,0,119,0,8,0,38,194,5,32,33,194,194,0,1,191,184,61,1,192,188,61,125,189,194,191,192,0,0,0,0,193,189,0,1,189,3,0,134,190,0,0,160,156,2,0,0,193,189,0,1,189,32,0,1,193,0,32,21,193,4,193,134,190,0,0,152,115,2,0,0,189,2,153,193,0,0,0,0,92,153,0,119,0,230,3,3,193,185,187,134,190,0,0,168,60,2,0,10,193,0,0,59,193,2,0,65,159,190,193,59,193,0,0,70,193,159,193,121,193,4,0,94,190,185,187,26,190,190,1,97,185,187,190,39,190,5,32,32,190,190,97,121,190,177,0,38,193,5,32,32,193,193,0,121,193,3,0,0,190,21,0,119,0,3,0,25,193,21,9,0,190,193,0,0,173,190,0,39,190,20,2,0,166,190,0,1,190,11,0,16,190,190,3,1,193,12,0,4,193,193,3,32,193,193,0,20,190,190,193,121,190,3,0,58,29,159,0,119,0,20,0,59,17,8,0,1,190,12,0,4,35,190,3,26,35,35,1,59,190,16,0,65,17,17,190,33,190,35,0,120,190,252,255,78,190,173,0,32,190,190,45,121,190,6,0,68,190,159,0,64,190,190,17,63,190,17,190,68,29,190,0,119,0,4,0,63,190,159,17,64,29,190,17,119,0,1,0,94,167,185,187,34,193,167,0,121,193,5,0,1,193,0,0,4,193,193,167,0,190,193,0,119,0,2,0,0,190,167,0,0,168,190,0,34,190,168,0,41,190,190,31,42,190,190,31,134,169,0,0,32,22,2,0,168,190,93,0,45,190,169,93,32,3,0,0,1,190,28,2,3,190,185,190,1,193,48,0,107,190,11,193,1,193,28,2,3,193,185,193,25,18,193,11,119,0,2,0,0,18,169,0,26,193,18,1,42,190,167,31,38,190,190,2,25,190,190,43,83,193,190,0,26,170,18,2,25,190,5,15,83,170,190,0,0,22,185,0,58,45,29,0,75,171,45,0,25,172,22,1,38,190,5,32,1,193,64,28,91,193,193,171,20,190,190,193,83,22,190,0,76,190,171,0,64,190,45,190,59,193,16,0,65,45,190,193,4,193,172,185,32,193,193,1,121,193,15,0,38,193,4,8,32,193,193,0,34,190,3,1,59,189,0,0,69,189,45,189,19,190,190,189,19,193,193,190,121,193,3,0,0,39,172,0,119,0,6,0,1,193,46,0,83,172,193,0,25,39,22,2,119,0,2,0,0,39,172,0,59,193,0,0,70,193,45,193,120,193,2,0,119,0,3,0,0,22,39,0,119,0,222,255,0,91,39,0,120,3,3,0,1,184,25,0,119,0,13,0,1,193,254,255,4,193,193,185,3,193,193,91,47,193,193,3,20,4,0,0,25,193,3,2,3,193,193,93,4,23,193,170,0,89,93,0,0,90,170,0,119,0,2,0,1,184,25,0,32,193,184,25,121,193,6,0,4,193,93,185,4,193,193,170,3,23,193,91,0,89,93,0,0,90,170,0,3,94,23,166,1,190,32,0,134,193,0,0,152,115,2,0,0,190,2,94,4,0,0,0,134,193,0,0,160,156,2,0,0,173,166,0,1,190,48,0,2,189,0,0,0,0,1,0,21,189,4,189,134,193,0,0,152,115,2,0,0,190,2,94,189,0,0,0,4,189,91,185,134,193,0,0,160,156,2,0,0,185,189,0,4,95,89,90,1,189,48,0,4,190,91,185,3,190,190,95,4,190,23,190,1,192,0,0,1,191,0,0,134,193,0,0,152,115,2,0,0,189,190,192,191,0,0,0,134,193,0,0,160,156,2,0,0,170,95,0,1,191,32,0,1,192,0,32,21,192,4,192,134,193,0,0,152,115,2,0,0,191,2,94,192,0,0,0,0,92,94,0,119,0,39,3,34,193,3,0,1,192,6,0,125,174,193,192,3,0,0,0,59,192,0,0,70,192,159,192,121,192,9,0,94,192,185,187,26,97,192,28,97,185,187,97,60,192,0,0,0,0,0,16,65,56,159,192,0,87,97,0,119,0,3,0,58,56,159,0,94,87,185,187,34,193,87,0,121,193,4,0,25,193,185,32,0,192,193,0,119,0,5,0,25,193,185,32,1,191,32,1,3,193,193,191,0,192,193,0,0,16,192,0,0,34,16,0,58,63,56,0,75,98,63,0,85,34,98,0,25,34,34,4,77,192,98,0,64,192,63,192,60,193,0,0,0,202,154,59,65,63,192,193,59,193,0,0,70,193,63,193,120,193,246,255,1,193,0,0,47,193,193,87,196,6,0,0,0,32,16,0,0,51,34,0,0,100,87,0,34,193,100,29,1,192,29,0,125,101,193,100,192,0,0,0,26,13,51,4,48,192,13,32,192,5,0,0,0,47,32,0,119,0,37,0,0,14,13,0,1,15,0,0,82,192,14,0,1,193,0,0,135,102,2,0,192,193,101,0,135,193,1,0,1,192,0,0,134,103,0,0,240,153,2,0,102,193,15,192,135,104,1,0,1,192,0,0,134,15,0,0,180,154,2,0,103,104,186,192,135,192,1,0,1,193,0,0,134,105,0,0,92,131,2,0,15,192,186,193,135,193,1,0,134,106,0,0,64,151,2,0,103,104,105,193,135,193,1,0,85,14,106,0,26,14,14,4,57,193,32,14,200,5,0,0,120,15,3,0,0,47,32,0,119,0,4,0,26,107,32,4,85,107,15,0,0,47,107,0,48,193,47,51,136,6,0,0,0,61,51,0,26,108,61,4,82,193,108,0,121,193,3,0,0,60,61,0,119,0,8,0,48,193,47,108,128,6,0,0,0,61,108,0,119,0,248,255,0,60,108,0,119,0,2,0,0,60,51,0,94,193,185,187,4,109,193,101,97,185,187,109,1,193,0,0,47,193,193,109,180,6,0,0,0,32,47,0,0,51,60,0,0,100,109,0,119,0,187,255,0,31,47,0,0,50,60,0,0,88,109,0,119,0,4,0,0,31,16,0,0,50,34,0,0,88,87,0,34,193,88,0,121,193,84,0,0,59,31,0,0,68,50,0,0,112,88,0,1,193,0,0,4,111,193,112,34,193,111,9,1,192,9,0,125,113,193,111,192,0,0,0,48,192,59,68,128,7,0,0,1,12,0,0,0,33,59,0,82,114,33,0,24,192,114,113,3,192,192,12,85,33,192,0,1,192,1,0,22,192,192,113,26,192,192,1,19,192,114,192,24,193,186,113,5,12,192,193,25,33,33,4,55,193,33,68,12,7,0,0,82,192,59,0,32,192,192,0,121,192,4,0,25,192,59,4,0,193,192,0,119,0,2,0,0,193,59,0,0,175,193,0,120,12,4,0,0,74,68,0,0,176,175,0,119,0,14,0,85,68,12,0,25,74,68,4,0,176,175,0,119,0,10,0,0,74,68,0,82,192,59,0,32,192,192,0,121,192,4,0,25,192,59,4,0,193,192,0,119,0,2,0,0,193,59,0,0,176,193,0,39,193,5,32,32,193,193,102,125,115,193,16,176,0,0,0,25,192,174,25,28,192,192,9,25,192,192,1,4,191,74,115,42,191,191,2,47,192,192,191,236,7,0,0,25,192,174,25,28,192,192,9,25,192,192,1,41,192,192,2,3,192,115,192,0,193,192,0,119,0,2,0,0,193,74,0,0,177,193,0,94,193,185,187,3,112,193,113,97,185,187,112,1,193,0,0,49,193,193,112,24,8,0,0,0,58,176,0,0,67,177,0,119,0,6,0,0,59,176,0,0,68,177,0,119,0,177,255,0,58,31,0,0,67,50,0,48,193,58,67,124,8,0,0,4,193,16,58,42,193,193,2,27,116,193,9,82,117,58,0,35,193,117,10,121,193,3,0,0,38,116,0,119,0,12,0,0,19,116,0,1,25,10,0,27,25,25,10,25,118,19,1,48,193,117,25,116,8,0,0,0,38,118,0,119,0,4,0,0,19,118,0,119,0,249,255,1,38,0,0,39,192,5,32,32,192,192,102,1,191,0,0,125,193,192,191,38,0,0,0,4,193,174,193,33,191,174,0,39,192,5,32,32,192,192,103,19,191,191,192,41,191,191,31,42,191,191,31,3,119,193,191,4,191,67,16,42,191,191,2,27,191,191,9,26,191,191,9,47,191,119,191,84,11,0,0,25,191,16,4,1,193,0,36,3,193,119,193,28,193,193,9,1,192,0,4,4,193,193,192,41,193,193,2,3,120,191,193,1,193,0,36,3,193,119,193,1,191,0,36,3,191,119,191,28,191,191,9,27,191,191,9,4,121,193,191,34,191,121,8,121,191,11,0,0,24,121,0,1,42,10,0,27,122,42,10,34,191,24,7,121,191,4,0,25,24,24,1,0,42,122,0,119,0,251,255,0,41,122,0,119,0,2,0,1,41,10,0,82,123,120,0,7,124,123,41,5,191,124,41,4,125,123,191,25,191,120,4,13,126,191,67,32,191,125,0,19,191,126,191,121,191,5,0,0,66,120,0,0,69,38,0,0,80,58,0,119,0,115,0,38,193,124,1,32,193,193,0,121,193,5,0,61,193,0,0,0,0,0,90,58,191,193,0,119,0,5,0,62,193,0,0,1,0,0,0,0,0,64,67,58,191,193,0,58,178,191,0,43,191,41,1,0,127,191,0,48,193,125,127,192,9,0,0,61,193,0,0,0,0,0,63,58,191,193,0,119,0,11,0,13,192,125,127,19,192,126,192,121,192,4,0,59,192,1,0,58,193,192,0,119,0,4,0,61,192,0,0,0,0,192,63,58,193,192,0,58,191,193,0,58,183,191,0,120,20,4,0,58,27,183,0,58,28,178,0,119,0,15,0,78,191,21,0,32,128,191,45,121,128,4,0,68,193,183,0,58,191,193,0,119,0,2,0,58,191,183,0,58,27,191,0,121,128,4,0,68,193,178,0,58,191,193,0,119,0,2,0,58,191,178,0,58,28,191,0,4,191,123,125,85,120,191,0,63,191,28,27,70,191,191,28,121,191,58,0,4,191,123,125,3,130,191,41,85,120,130,0,2,191,0,0,255,201,154,59,48,191,191,130,204,10,0,0,0,49,120,0,0,72,58,0,26,131,49,4,1,191,0,0,85,49,191,0,48,191,131,72,148,10,0,0,26,132,72,4,1,191,0,0,85,132,191,0,0,77,132,0,119,0,2,0,0,77,72,0,82,191,131,0,25,133,191,1,85,131,133,0,2,191,0,0,255,201,154,59,48,191,191,133,192,10,0,0,0,49,131,0,0,72,77,0,119,0,236,255,0,48,131,0,0,71,77,0,119,0,3,0,0,48,120,0,0,71,58,0,4,191,16,71,42,191,191,2,27,134,191,9,82,135,71,0,35,191,135,10,121,191,5,0,0,66,48,0,0,69,134,0,0,80,71,0,119,0,16,0,0,53,134,0,1,55,10,0,27,55,55,10,25,136,53,1,48,191,135,55,36,11,0,0,0,66,48,0,0,69,136,0,0,80,71,0,119,0,6,0,0,53,136,0,119,0,247,255,0,66,120,0,0,69,38,0,0,80,58,0,25,137,66,4,0,75,69,0,16,191,137,67,125,81,191,137,67,0,0,0,0,82,80,0,119,0,4,0,0,75,38,0,0,81,67,0,0,82,58,0,1,191,0,0,4,138,191,75,48,191,82,81,168,11,0,0,0,84,81,0,26,139,84,4,82,191,139,0,121,191,4,0,0,83,84,0,1,85,1,0,119,0,10,0,48,191,82,139,156,11,0,0,0,84,139,0,119,0,247,255,0,83,139,0,1,85,0,0,119,0,3,0,0,83,81,0,1,85,0,0,39,191,5,32,32,191,191,103,121,191,80,0,33,191,174,0,40,191,191,1,38,191,191,1,3,191,174,191,15,191,75,191,1,193,251,255,15,193,193,75,19,191,191,193,121,191,9,0,26,11,5,1,33,191,174,0,40,191,191,1,38,191,191,1,3,191,174,191,26,191,191,1,4,46,191,75,119,0,7,0,26,11,5,2,33,191,174,0,40,191,191,1,38,191,191,1,3,191,174,191,26,46,191,1,38,191,4,8,120,191,52,0,121,85,20,0,26,191,83,4,82,140,191,0,120,140,3,0,1,54,9,0,119,0,16,0,31,191,140,10,120,191,11,0,1,40,0,0,1,62,10,0,27,62,62,10,25,141,40,1,9,191,140,62,121,191,3,0,0,54,141,0,119,0,6,0,0,40,141,0,119,0,249,255,1,54,0,0,119,0,2,0,1,54,9,0,4,191,83,16,42,191,191,2,27,191,191,9,26,142,191,9,39,191,11,32,32,191,191,102,121,191,12,0,4,143,142,54,1,191,0,0,15,191,191,143,1,193,0,0,125,179,191,143,193,0,0,0,0,30,11,0,15,193,46,179,125,57,193,46,179,0,0,0,119,0,18,0,3,193,142,75,4,144,193,54,1,193,0,0,15,193,193,144,1,191,0,0,125,180,193,144,191,0,0,0,0,30,11,0,15,191,46,180,125,57,191,46,180,0,0,0,119,0,6,0,0,30,11,0,0,57,46,0,119,0,3,0,0,30,5,0,0,57,174,0,33,145,57,0,121,145,4,0,1,193,1,0,0,191,193,0,119,0,4,0,43,193,4,3,38,193,193,1,0,191,193,0,0,146,191,0,39,191,30,32,32,147,191,102,121,147,8,0,1,52,0,0,1,191,0,0,15,191,191,75,1,193,0,0,125,86,191,75,193,0,0,0,119,0,34,0,34,193,75,0,125,148,193,138,75,0,0,0,34,193,148,0,41,193,193,31,42,193,193,31,134,149,0,0,32,22,2,0,148,193,93,0,4,193,93,149,34,193,193,2,121,193,12,0,0,37,149,0,26,150,37,1,1,193,48,0,83,150,193,0,4,193,93,150,34,193,193,2,121,193,3,0,0,37,150,0,119,0,249,255,0,36,150,0,119,0,2,0,0,36,149,0,26,193,36,1,42,191,75,31,38,191,191,2,25,191,191,43,83,193,191,0,26,151,36,2,83,151,30,0,0,52,151,0,4,86,93,151,25,191,20,1,3,191,191,57,3,191,191,146,3,152,191,86,1,193,32,0,134,191,0,0,152,115,2,0,0,193,2,152,4,0,0,0,134,191,0,0,160,156,2,0,0,21,20,0,1,193,48,0,2,192,0,0,0,0,1,0,21,192,4,192,134,191,0,0,152,115,2,0,0,193,2,152,192,0,0,0,121,147,110,0,16,191,16,82,125,181,191,16,82,0,0,0,0,73,181,0,82,191,73,0,1,192,0,0,25,193,185,9,134,154,0,0,32,22,2,0,191,192,193,0,45,193,73,181,120,14,0,0,25,193,185,9,45,193,154,193,112,14,0,0,1,192,48,0,107,185,8,192,25,26,185,8,119,0,18,0,0,26,154,0,119,0,16,0,48,192,185,154,176,14,0,0,1,193,48,0,4,191,154,185,135,192,3,0,185,193,191,0,0,9,154,0,26,155,9,1,48,192,185,155,168,14,0,0,0,9,155,0,119,0,252,255,0,26,155,0,119,0,2,0,0,26,154,0,25,191,185,9,4,191,191,26,134,192,0,0,160,156,2,0,0,26,191,0,25,73,73,4,57,192,73,16,52,14,0,0,38,192,4,8,32,192,192,0,40,191,145,1,19,192,192,191,120,192,5,0,1,191,1,0,134,192,0,0,160,156,2,0,0,188,191,0,16,192,73,83,1,191,0,0,15,191,191,57,19,192,192,191,121,192,42,0,0,65,57,0,0,78,73,0,82,192,78,0,1,191,0,0,25,193,185,9,134,156,0,0,32,22,2,0,192,191,193,0,48,193,185,156,100,15,0,0,1,191,48,0,4,192,156,185,135,193,3,0,185,191,192,0,0,8,156,0,26,157,8,1,48,193,185,157,92,15,0,0,0,8,157,0,119,0,252,255,0,7,157,0,119,0,2,0,0,7,156,0,34,191,65,9,1,190,9,0,125,192,191,65,190,0,0,0,134,193,0,0,160,156,2,0,0,7,192,0,25,78,78,4,26,158,65,9,16,193,78,83,1,192,9,0,15,192,192,65,19,193,193,192,120,193,3,0,0,64,158,0,119,0,4,0,0,65,158,0,119,0,218,255,0,64,57,0,1,192,48,0,25,190,64,9,1,191,9,0,1,189,0,0,134,193,0,0,152,115,2,0,0,192,190,191,189,0,0,0,119,0,98,0,121,85,3,0,0,193,83,0,119,0,3,0,25,189,82,4,0,193,189,0,0,182,193,0,16,193,82,182,1,189,255,255,15,189,189,57,19,193,193,189,121,193,74,0,0,76,57,0,0,79,82,0,82,193,79,0,1,189,0,0,25,191,185,9,134,160,0,0,32,22,2,0,193,189,191,0,25,191,185,9,45,191,160,191,64,16,0,0,1,189,48,0,107,185,8,189,25,6,185,8,119,0,2,0,0,6,160,0,45,189,79,82,148,16,0,0,25,162,6,1,1,191,1,0,134,189,0,0,160,156,2,0,0,6,191,0,38,189,4,8,32,189,189,0,34,191,76,1,19,189,189,191,121,189,3,0,0,44,162,0,119,0,25,0,1,191,1,0,134,189,0,0,160,156,2,0,0,188,191,0,0,44,162,0,119,0,19,0,50,189,6,185,164,16,0,0,0,44,6,0,119,0,15,0,1,191,48,0,1,193,0,0,4,193,193,185,3,193,6,193,135,189,3,0,185,191,193,0,0,43,6,0,26,161,43,1,48,189,185,161,212,16,0,0,0,43,161,0,119,0,252,255,0,44,161,0,119,0,1,0,25,189,185,9,4,163,189,44,15,191,163,76,125,193,191,163,76,0,0,0,134,189,0,0,160,156,2,0,0,44,193,0,4,164,76,163,25,79,79,4,16,189,79,182,1,193,255,255,15,193,193,164,19,189,189,193,120,189,3,0,0,70,164,0,119,0,4,0,0,76,164,0,119,0,186,255,0,70,57,0,1,193,48,0,25,191,70,18,1,190,18,0,1,192,0,0,134,189,0,0,152,115,2,0,0,193,191,190,192,0,0,0,4,192,93,52,134,189,0,0,160,156,2,0,0,52,192,0,1,192,32,0,1,190,0,32,21,190,4,190,134,189,0,0,152,115,2,0,0,192,2,152,190,0,0,0,0,92,152,0,137,185,0,0,15,190,92,2,125,189,190,2,92,0,0,0,139,189,0,0,140,7,163,0,0,0,0,0,2,156,0,0,148,61,0,0,2,157,0,0,255,0,0,0,2,158,0,0,0,8,0,0,1,153,0,0,136,159,0,0,0,154,159,0,136,159,0,0,25,159,159,64,137,159,0,0,130,159,0,0,136,160,0,0,49,159,159,160,228,17,0,0,1,160,64,0,135,159,0,0,160,0,0,0,25,141,154,56,25,143,154,40,0,145,154,0,25,59,154,48,25,63,154,60,85,141,1,0,33,67,0,0,25,70,145,40,0,72,70,0,25,74,145,39,25,80,59,4,1,17,0,0,1,20,0,0,1,29,0,0,0,16,17,0,0,19,20,0,1,159,255,255,47,159,159,19,100,18,0,0,2,159,0,0,255,255,255,127,4,159,159,19,47,159,159,16,92,18,0,0,134,159,0,0,136,162,2,0,1,160,61,0,85,159,160,0,1,36,255,255,119,0,4,0,3,36,16,19,119,0,2,0,0,36,19,0,82,93,141,0,78,95,93,0,41,160,95,24,42,160,160,24,120,160,3,0,1,153,92,0,119,0,127,3,0,99,95,0,0,109,93,0,41,160,99,24,42,160,160,24,1,159,0,0,1,161,38,0,138,160,159,161,60,19,0,0,56,19,0,0,56,19,0,0,56,19,0,0,56,19,0,0,56,19,0,0,56,19,0,0,56,19,0,0,56,19,0,0,56,19,0,0,56,19,0,0,56,19,0,0,56,19,0,0,56,19,0,0,56,19,0,0,56,19,0,0,56,19,0,0,56,19,0,0,56,19,0,0,56,19,0,0,56,19,0,0,56,19,0,0,56,19,0,0,56,19,0,0,56,19,0,0,56,19,0,0,56,19,0,0,56,19,0,0,56,19,0,0,56,19,0,0,56,19,0,0,56,19,0,0,56,19,0,0,56,19,0,0,56,19,0,0,56,19,0,0,56,19,0,0,68,19,0,0,119,0,5,0,0,21,109,0,119,0,8,0,1,153,10,0,119,0,6,0,25,102,109,1,85,141,102,0,78,99,102,0,0,109,102,0,119,0,204,255,32,160,153,10,121,160,19,0,1,153,0,0,0,22,109,0,0,113,109,0,102,160,113,1,33,160,160,37,121,160,3,0,0,21,22,0,119,0,11,0,25,120,22,1,25,113,113,2,85,141,113,0,78,160,113,0,33,160,160,37,121,160,3,0,0,21,120,0,119,0,3,0,0,22,120,0,119,0,242,255,4,16,21,93,121,67,4,0,134,160,0,0,160,156,2,0,0,93,16,0,120,16,2,0,119,0,3,0,0,19,36,0,119,0,149,255,82,159,141,0,102,159,159,1,134,160,0,0,248,160,2,0,159,0,0,0,32,133,160,0,82,56,141,0,121,133,5,0,1,24,255,255,0,40,29,0,1,58,1,0,119,0,12,0,102,160,56,2,32,160,160,36,121,160,6,0,102,160,56,1,26,24,160,48,1,40,1,0,1,58,3,0,119,0,4,0,1,24,255,255,0,40,29,0,1,58,1,0,3,134,56,58,85,141,134,0,78,135,134,0,41,160,135,24,42,160,160,24,26,136,160,32,1,160,31,0,16,160,160,136,1,159,1,0,22,159,159,136,2,161,0,0,137,40,1,0,19,159,159,161,32,159,159,0,20,160,160,159,121,160,5,0,1,27,0,0,0,54,135,0,0,150,134,0,119,0,31,0,1,28,0,0,0,137,136,0,0,151,134,0,1,160,1,0,22,160,160,137,20,160,160,28,0,138,160,0,25,139,151,1,85,141,139,0,78,140,139,0,41,160,140,24,42,160,160,24,26,137,160,32,1,160,31,0,16,160,160,137,1,159,1,0,22,159,159,137,2,161,0,0,137,40,1,0,19,159,159,161,32,159,159,0,20,160,160,159,121,160,5,0,0,27,138,0,0,54,140,0,0,150,139,0,119,0,4,0,0,28,138,0,0,151,139,0,119,0,230,255,41,160,54,24,42,160,160,24,32,160,160,42,121,160,71,0,102,159,150,1,134,160,0,0,248,160,2,0,159,0,0,0,120,160,3,0,1,153,27,0,119,0,19,0,82,142,141,0,102,160,142,2,32,160,160,36,121,160,14,0,25,144,142,1,78,160,144,0,26,160,160,48,41,160,160,2,1,159,10,0,97,4,160,159,78,159,144,0,26,159,159,48,41,159,159,3,94,26,3,159,1,46,1,0,25,152,142,3,119,0,2,0,1,153,27,0,32,159,153,27,121,159,25,0,1,153,0,0,121,40,3,0,1,7,255,255,119,0,191,2,121,67,15,0,82,159,2,0,1,160,4,0,26,160,160,1,3,159,159,160,1,160,4,0,26,160,160,1,11,160,160,0,19,159,159,160,0,60,159,0,82,61,60,0,25,159,60,4,85,2,159,0,0,131,61,0,119,0,2,0,1,131,0,0,0,26,131,0,1,46,0,0,82,159,141,0,25,152,159,1,85,141,152,0,34,62,26,0,121,62,5,0,1,160,0,0,4,160,160,26,0,159,160,0,119,0,2,0,0,159,26,0,0,38,159,0,121,62,5,0,1,160,0,32,20,160,27,160,0,159,160,0,119,0,2,0,0,159,27,0,0,39,159,0,0,48,46,0,0,65,152,0,119,0,12,0,134,64,0,0,104,140,2,0,141,0,0,0,34,159,64,0,121,159,3,0,1,7,255,255,119,0,145,2,0,38,64,0,0,39,27,0,0,48,40,0,82,65,141,0,78,159,65,0,32,159,159,46,121,159,61,0,25,66,65,1,78,159,66,0,33,159,159,42,121,159,8,0,85,141,66,0,134,78,0,0,104,140,2,0,141,0,0,0,0,25,78,0,82,57,141,0,119,0,52,0,102,160,65,2,134,159,0,0,248,160,2,0,160,0,0,0,121,159,20,0,82,68,141,0,102,159,68,3,32,159,159,36,121,159,16,0,25,69,68,2,78,159,69,0,26,159,159,48,41,159,159,2,1,160,10,0,97,4,159,160,78,160,69,0,26,160,160,48,41,160,160,3,94,71,3,160,25,73,68,4,85,141,73,0,0,25,71,0,0,57,73,0,119,0,28,0,121,48,3,0,1,7,255,255,119,0,100,2,121,67,15,0,82,160,2,0,1,159,4,0,26,159,159,1,3,160,160,159,1,159,4,0,26,159,159,1,11,159,159,0,19,160,160,159,0,75,160,0,82,76,75,0,25,160,75,4,85,2,160,0,0,132,76,0,119,0,2,0,1,132,0,0,82,160,141,0,25,77,160,2,85,141,77,0,0,25,132,0,0,57,77,0,119,0,3,0,1,25,255,255,0,57,65,0,1,23,0,0,0,79,57,0,1,160,57,0,78,159,79,0,26,159,159,65,48,160,160,159,116,23,0,0,1,7,255,255,119,0,67,2,0,155,79,0,25,79,79,1,85,141,79,0,78,160,155,0,26,160,160,65,1,159,112,26,27,161,23,58,3,159,159,161,90,81,160,159,19,160,81,157,0,82,160,0,1,160,8,0,26,159,82,1,57,160,160,159,184,23,0,0,0,23,82,0,119,0,233,255,41,160,81,24,42,160,160,24,120,160,3,0,1,7,255,255,119,0,45,2,1,160,255,255,15,83,160,24,41,160,81,24,42,160,160,24,32,160,160,19,121,160,6,0,121,83,3,0,1,7,255,255,119,0,36,2,1,153,54,0,119,0,20,0,121,83,11,0,41,160,24,2,97,4,160,82,41,160,24,3,3,84,3,160,106,85,84,4,0,86,143,0,116,86,84,0,109,86,4,85,1,153,54,0,119,0,9,0,120,67,3,0,1,7,0,0,119,0,20,2,134,160,0,0,176,152,1,0,143,82,2,6,82,87,141,0,1,153,55,0,32,160,153,54,121,160,7,0,1,153,0,0,121,67,4,0,0,87,79,0,1,153,55,0,119,0,2,0,1,18,0,0,32,160,153,55,121,160,1,2,1,153,0,0,26,160,87,1,78,88,160,0,33,159,23,0,38,161,88,15,32,161,161,3,19,159,159,161,121,159,4,0,38,159,88,223,0,160,159,0,119,0,2,0,0,160,88,0,0,11,160,0,2,160,0,0,255,255,254,255,19,160,39,160,0,89,160,0,1,160,0,32,19,160,39,160,32,160,160,0,125,148,160,39,89,0,0,0,1,160,65,0,1,162,56,0,138,11,160,162,204,25,0,0,176,25,0,0,208,25,0,0,176,25,0,0,236,25,0,0,240,25,0,0,244,25,0,0,176,25,0,0,176,25,0,0,176,25,0,0,176,25,0,0,176,25,0,0,176,25,0,0,176,25,0,0,176,25,0,0,176,25,0,0,176,25,0,0,176,25,0,0,248,25,0,0,176,25,0,0,176,25,0,0,176,25,0,0,176,25,0,0,44,26,0,0,176,25,0,0,176,25,0,0,176,25,0,0,176,25,0,0,176,25,0,0,176,25,0,0,176,25,0,0,176,25,0,0,48,26,0,0,176,25,0,0,52,26,0,0,88,26,0,0,0,27,0,0,24,27,0,0,28,27,0,0,176,25,0,0,32,27,0,0,176,25,0,0,176,25,0,0,176,25,0,0,176,25,0,0,36,27,0,0,244,27,0,0,80,28,0,0,176,25,0,0,176,25,0,0,120,28,0,0,176,25,0,0,228,28,0,0,176,25,0,0,176,25,0,0,0,29,0,0,0,30,93,0,1,41,0,0,1,42,148,61,0,52,25,0,0,53,148,0,0,55,72,0,119,0,211,0,119,0,77,0,116,59,143,0,1,160,0,0,85,80,160,0,85,143,59,0,1,50,255,255,1,153,79,0,119,0,203,0,119,0,69,0,119,0,68,0,119,0,67,0,120,25,10,0,1,159,32,0,1,162,0,0,134,160,0,0,152,115,2,0,0,159,38,162,148,0,0,0,1,14,0,0,1,153,89,0,119,0,190,0,0,50,25,0,1,153,79,0,119,0,187,0,119,0,181,0,119,0,52,0,82,159,143,0,83,74,159,0,0,30,74,0,1,41,0,0,1,42,148,61,1,52,1,0,0,53,89,0,0,55,72,0,119,0,176,0,0,103,143,0,82,104,103,0,106,105,103,4,34,160,105,0,121,160,16,0,1,160,0,0,1,159,0,0,134,106,0,0,64,151,2,0,160,159,104,105,135,107,1,0,0,108,143,0,85,108,106,0,109,108,4,107,1,10,1,0,1,12,148,61,0,110,106,0,0,111,107,0,1,153,72,0,119,0,156,0,1,159,1,8,19,159,148,159,33,159,159,0,38,159,159,1,0,10,159,0,19,160,148,158,32,160,160,0,121,160,8,0,38,161,148,1,32,161,161,0,1,162,150,61,125,160,161,156,162,0,0,0,0,159,160,0,119,0,3,0,1,160,149,61,0,159,160,0,0,12,159,0,0,110,104,0,0,111,105,0,1,153,72,0,119,0,134,0,38,160,5,1,86,162,143,0,135,18,4,0,160,0,162,38,25,148,11,0,119,0,86,1,119,0,250,255,119,0,249,255,119,0,206,255,19,160,23,157,41,160,160,24,42,160,160,24,1,159,0,0,1,161,8,0,138,160,159,161,100,27,0,0,116,27,0,0,132,27,0,0,164,27,0,0,180,27,0,0,92,27,0,0,196,27,0,0,212,27,0,0,1,18,0,0,119,0,67,1,82,159,143,0,85,159,36,0,1,18,0,0,119,0,63,1,82,159,143,0,85,159,36,0,1,18,0,0,119,0,59,1,82,91,143,0,85,91,36,0,34,161,36,0,41,161,161,31,42,161,161,31,109,91,4,161,1,18,0,0,119,0,51,1,82,161,143,0,84,161,36,0,1,18,0,0,119,0,47,1,82,161,143,0,83,161,36,0,1,18,0,0,119,0,43,1,82,161,143,0,85,161,36,0,1,18,0,0,119,0,39,1,82,92,143,0,85,92,36,0,34,159,36,0,41,159,159,31,42,159,159,31,109,92,4,159,1,18,0,0,119,0,31,1,0,98,143,0,82,159,98,0,106,160,98,4,134,100,0,0,204,136,2,0,159,160,70,0,4,101,72,100,0,8,100,0,1,32,0,0,1,34,148,61,38,159,148,8,32,159,159,0,15,161,101,25,20,159,159,161,121,159,3,0,0,160,25,0,119,0,3,0,25,159,101,1,0,160,159,0,0,44,160,0,0,51,148,0,1,153,73,0,119,0,50,0,1,33,120,0,1,160,8,0,16,160,160,25,1,159,8,0,125,37,160,25,159,0,0,0,39,159,148,8,0,47,159,0,1,153,67,0,119,0,40,0,82,116,143,0,32,159,116,0,1,160,158,61,125,117,159,160,116,0,0,0,1,160,0,0,134,118,0,0,196,160,1,0,117,160,25,0,32,119,118,0,0,30,117,0,1,41,0,0,1,42,148,61,121,119,3,0,0,160,25,0,119,0,3,0,4,159,118,117,0,160,159,0,0,52,160,0,0,53,89,0,121,119,4,0,3,159,117,25,0,160,159,0,119,0,2,0,0,160,118,0,0,55,160,0,119,0,13,0,0,90,143,0,1,10,0,0,1,12,148,61,82,110,90,0,106,111,90,4,1,153,72,0,119,0,6,0,0,33,11,0,0,37,25,0,0,47,148,0,1,153,67,0,119,0,1,0,32,160,153,67,121,160,35,0,1,153,0,0,0,94,143,0,82,160,94,0,106,162,94,4,38,159,33,32,134,96,0,0,228,130,2,0,160,162,70,159,0,97,143,0,38,159,47,8,32,159,159,0,82,162,97,0,32,162,162,0,106,160,97,4,32,160,160,0,19,162,162,160,20,159,159,162,0,147,159,0,0,8,96,0,1,159,0,0,1,162,2,0,125,32,147,159,162,0,0,0,121,147,3,0,0,162,156,0,119,0,4,0,43,159,33,4,3,159,156,159,0,162,159,0,0,34,162,0,0,44,37,0,0,51,47,0,1,153,73,0,119,0,82,0,32,162,153,72,121,162,11,0,1,153,0,0,134,8,0,0,32,22,2,0,110,111,70,0,0,32,10,0,0,34,12,0,0,44,25,0,0,51,148,0,1,153,73,0,119,0,70,0,32,162,153,79,121,162,68,0,1,153,0,0,82,9,143,0,1,15,0,0,82,121,9,0,120,121,3,0,0,13,15,0,119,0,19,0,134,122,0,0,120,156,2,0,63,121,0,0,34,123,122,0,4,162,50,15,16,162,162,122,20,162,123,162,121,162,3,0,1,153,83,0,119,0,9,0,3,124,122,15,48,162,124,50,56,30,0,0,25,9,9,4,0,15,124,0,119,0,237,255,0,13,124,0,119,0,1,0,32,162,153,83,121,162,6,0,1,153,0,0,121,123,3,0,1,7,255,255,119,0,138,0,0,13,15,0,1,159,32,0,134,162,0,0,152,115,2,0,0,159,38,13,148,0,0,0,120,13,4,0,1,14,0,0,1,153,89,0,119,0,27,0,82,31,143,0,1,35,0,0,82,125,31,0,120,125,4,0,0,14,13,0,1,153,89,0,119,0,20,0,134,126,0,0,120,156,2,0,63,125,0,0,3,35,126,35,47,162,13,35,192,30,0,0,0,14,13,0,1,153,89,0,119,0,11,0,134,162,0,0,160,156,2,0,0,63,126,0,50,162,13,35,224,30,0,0,0,14,13,0,1,153,89,0,119,0,3,0,25,31,31,4,119,0,233,255,32,162,153,73,121,162,41,0,1,153,0,0,0,112,143,0,82,162,112,0,33,162,162,0,106,159,112,4,33,159,159,0,20,162,162,159,0,114,162,0,33,162,44,0,20,162,162,114,0,146,162,0,4,162,72,8,40,159,114,1,38,159,159,1,3,115,162,159,125,30,146,8,70,0,0,0,0,41,32,0,0,42,34,0,121,146,6,0,15,160,115,44,125,162,160,44,115,0,0,0,0,159,162,0,119,0,3,0,1,162,0,0,0,159,162,0,0,52,159,0,1,162,255,255,47,162,162,44,128,31,0,0,2,162,0,0,255,255,254,255,19,162,51,162,0,159,162,0,119,0,2,0,0,159,51,0,0,53,159,0,0,55,72,0,119,0,15,0,32,159,153,89,121,159,13,0,1,153,0,0,1,162,32,0,1,160,0,32,21,160,148,160,134,159,0,0,152,115,2,0,0,162,38,14,160,0,0,0,15,159,14,38,125,18,159,38,14,0,0,0,119,0,42,0,4,127,55,30,15,159,52,127,125,149,159,127,52,0,0,0,3,128,149,41,15,159,38,128,125,45,159,128,38,0,0,0,1,160,32,0,134,159,0,0,152,115,2,0,0,160,45,128,53,0,0,0,134,159,0,0,160,156,2,0,0,42,41,0,1,160,48,0,2,162,0,0,0,0,1,0,21,162,53,162,134,159,0,0,152,115,2,0,0,160,45,128,162,0,0,0,1,162,48,0,1,160,0,0,134,159,0,0,152,115,2,0,0,162,149,127,160,0,0,0,134,159,0,0,160,156,2,0,0,30,127,0,1,160,32,0,1,162,0,32,21,162,53,162,134,159,0,0,152,115,2,0,0,160,45,128,162,0,0,0,0,18,45,0,0,17,18,0,0,20,36,0,0,29,48,0,119,0,105,252,32,159,153,92,121,159,36,0,120,0,34,0,120,29,3,0,1,7,0,0,119,0,32,0,1,43,1,0,41,159,43,2,94,129,4,159,120,129,2,0,119,0,13,0,41,162,43,3,3,162,3,162,134,159,0,0,176,152,1,0,162,129,2,6,25,130,43,1,35,159,130,10,121,159,3,0,0,43,130,0,119,0,243,255,1,7,1,0,119,0,15,0,0,49,43,0,41,159,49,2,94,159,4,159,121,159,3,0,1,7,255,255,119,0,9,0,25,49,49,1,1,159,10,0,50,159,159,49,8,33,0,0,1,7,1,0,119,0,3,0,119,0,245,255,0,7,36,0,137,154,0,0,139,7,0,0,140,2,88,0,0,0,0,0,2,79,0,0,255,255,0,0,2,80,0,0,255,0,0,0,136,81,0,0,0,68,81,0,136,81,0,0,25,81,81,112,137,81,0,0,130,81,0,0,136,82,0,0,49,81,81,82,96,33,0,0,1,82,112,0,135,81,0,0,82,0,0,0,25,2,68,76,25,20,68,72,25,35,68,68,25,40,68,64,25,44,68,60,25,54,68,56,25,62,68,52,25,64,68,106,25,66,68,105,25,3,68,104,25,5,68,48,25,6,68,44,25,8,68,40,25,10,68,103,25,12,68,102,25,14,68,101,25,16,68,100,25,17,68,36,25,19,68,99,25,21,68,98,25,22,68,97,25,23,68,96,25,24,68,32,25,25,68,28,25,27,68,24,25,28,68,20,25,30,68,16,25,32,68,12,25,34,68,8,25,36,68,4,85,20,0,0,85,35,1,0,82,81,20,0,82,81,81,0,120,81,3,0,137,68,0,0,139,0,0,0,82,81,20,0,106,81,81,4,120,81,3,0,137,68,0,0,139,0,0,0,82,82,35,0,121,82,6,0,82,82,20,0,106,82,82,8,33,82,82,0,0,81,82,0,119,0,3,0,1,82,0,0,0,81,82,0,120,81,3,0,137,68,0,0,139,0,0,0,82,81,20,0,106,81,81,16,82,82,35,0,45,81,81,82,84,34,0,0,137,68,0,0,139,0,0,0,82,82,35,0,34,82,82,11,121,82,6,0,82,82,20,0,106,82,82,16,34,82,82,11,0,81,82,0,119,0,3,0,1,82,0,0,0,81,82,0,120,81,8,0,1,82,4,0,1,83,217,59,134,81,0,0,252,32,2,0,82,83,68,0,137,68,0,0,139,0,0,0,82,49,20,0,116,2,49,0,106,83,49,4,109,2,4,83,106,81,49,8,109,2,8,81,106,83,49,12,109,2,12,83,106,81,49,16,109,2,16,81,134,81,0,0,92,184,0,0,2,0,0,0,85,40,81,0,82,83,20,0,82,83,83,0,135,81,5,0,83,0,0,0,82,81,20,0,1,83,0,0,85,81,83,0,82,83,20,0,82,81,35,0,109,83,16,81,1,81,0,0,85,44,81,0,82,81,20,0,106,81,81,16,1,83,1,0,1,85,10,0,138,81,83,85,68,35,0,0,100,36,0,0,224,37,0,0,64,39,0,0,132,40,0,0,60,42,0,0,240,43,0,0,124,45,0,0,136,46,0,0,136,47,0,0,119,0,94,3,82,69,20,0,106,82,69,4,106,84,69,8,5,83,82,84,135,63,6,0,83,0,0,0,82,83,20,0,85,83,63,0,1,83,0,0,85,54,83,0,82,84,20,0,106,84,84,4,82,82,20,0,106,82,82,8,5,83,84,82,82,82,54,0,56,83,83,82,184,48,0,0,82,82,40,0,82,84,54,0,41,84,84,4,100,83,82,84,145,83,83,0,62,82,0,0,209,221,1,224,208,34,211,63,145,82,82,0,65,65,83,82,145,65,65,0,82,84,40,0,82,85,54,0,41,85,85,4,3,84,84,85,112,83,84,4,145,83,83,0,62,84,0,0,217,84,201,63,180,200,226,63,145,84,84,0,65,82,83,84,145,82,82,0,63,67,65,82,145,67,67,0,82,86,40,0,82,87,54,0,41,87,87,4,3,86,86,87,112,85,86,8,145,85,85,0,62,86,0,0,201,118,190,159,26,47,189,63,145,86,86,0,65,83,85,86,145,83,83,0,63,84,67,83,145,84,84,0,59,83,255,0,145,83,83,0,65,82,84,83,145,82,82,0,75,82,82,0,19,82,82,80,0,4,82,0,82,82,20,0,82,82,82,0,82,83,54,0,95,82,83,4,82,83,54,0,25,83,83,1,85,54,83,0,119,0,195,255,82,70,20,0,106,82,70,4,106,84,70,8,5,83,82,84,41,83,83,1,135,7,6,0,83,0,0,0,82,83,20,0,85,83,7,0,1,83,0,0,85,62,83,0,82,84,20,0,106,84,84,4,82,82,20,0,106,82,82,8,5,83,84,82,41,83,83,1,82,82,62,0,56,83,83,82,184,48,0,0,82,82,40,0,82,84,44,0,41,84,84,4,100,83,82,84,145,83,83,0,62,82,0,0,209,221,1,224,208,34,211,63,145,82,82,0,65,9,83,82,145,9,9,0,82,84,40,0,82,86,44,0,41,86,86,4,3,84,84,86,112,83,84,4,145,83,83,0,62,84,0,0,217,84,201,63,180,200,226,63,145,84,84,0,65,82,83,84,145,82,82,0,63,11,9,82,145,11,11,0,82,85,40,0,82,87,44,0,41,87,87,4,3,85,85,87,112,86,85,8,145,86,86,0,62,85,0,0,201,118,190,159,26,47,189,63,145,85,85,0,65,83,86,85,145,83,83,0,63,84,11,83,145,84,84,0,59,83,255,0,145,83,83,0,65,82,84,83,145,82,82,0,75,82,82,0,19,82,82,80,0,13,82,0,82,82,20,0,82,82,82,0,82,83,62,0,95,82,83,13,82,84,40,0,82,85,44,0,41,85,85,4,3,84,84,85,112,82,84,12,145,82,82,0,59,84,255,0,145,84,84,0,65,83,82,84,145,83,83,0,75,83,83,0,19,83,83,80,0,15,83,0,82,83,20,0,82,83,83,0,82,84,62,0,25,84,84,1,95,83,84,15,82,84,62,0,25,84,84,2,85,62,84,0,82,84,44,0,25,84,84,1,85,44,84,0,119,0,173,255,82,71,20,0,106,83,71,4,106,82,71,8,5,84,83,82,41,84,84,1,135,18,6,0,84,0,0,0,82,84,20,0,85,84,18,0,1,84,0,0,83,64,84,0,1,84,0,0,83,66,84,0,1,84,0,0,83,3,84,0,1,84,0,0,85,5,84,0,82,82,20,0,106,82,82,4,82,83,20,0,106,83,83,8,5,84,82,83,82,83,5,0,56,84,84,83,184,48,0,0,82,85,40,0,82,86,5,0,41,86,86,4,100,82,85,86,145,82,82,0,59,85,31,0,145,85,85,0,65,83,82,85,145,83,83,0,134,84,0,0,20,159,2,0,83,0,0,0,75,84,84,0,83,64,84,0,82,82,40,0,82,86,5,0,41,86,86,4,3,82,82,86,112,85,82,4,145,85,85,0,59,82,63,0,145,82,82,0,65,83,85,82,145,83,83,0,134,84,0,0,20,159,2,0,83,0,0,0,75,84,84,0,83,66,84,0,82,85,40,0,82,86,5,0,41,86,86,4,3,85,85,86,112,82,85,8,145,82,82,0,59,85,31,0,145,85,85,0,65,83,82,85,145,83,83,0,134,84,0,0,20,159,2,0,83,0,0,0,75,84,84,0,83,3,84,0,82,84,20,0,82,84,84,0,82,83,5,0,41,83,83,1,79,85,64,0,19,85,85,79,41,85,85,11,79,82,66,0,19,82,82,79,41,82,82,5,20,85,85,82,79,82,3,0,19,82,82,79,20,85,85,82,96,84,83,85,82,85,5,0,25,85,85,1,85,5,85,0,119,0,186,255,82,72,20,0,106,83,72,4,106,84,72,8,5,85,83,84,27,85,85,3,135,26,6,0,85,0,0,0,82,85,20,0,85,85,26,0,1,85,0,0,85,6,85,0,1,85,0,0,85,8,85,0,82,84,20,0,106,84,84,4,82,83,20,0,106,83,83,8,5,85,84,83,27,85,85,3,82,83,6,0,56,85,85,83,184,48,0,0,82,84,40,0,82,82,8,0,41,82,82,4,100,83,84,82,145,83,83,0,59,84,255,0,145,84,84,0,65,85,83,84,145,85,85,0,75,85,85,0,19,85,85,80,0,29,85,0,82,85,20,0,82,85,85,0,82,84,6,0,95,85,84,29,82,83,40,0,82,82,8,0,41,82,82,4,3,83,83,82,112,85,83,4,145,85,85,0,59,83,255,0,145,83,83,0,65,84,85,83,145,84,84,0], eb + 0);
  HEAPU8.set([75,84,84,0,19,84,84,80,0,31,84,0,82,84,20,0,82,84,84,0,82,83,6,0,25,83,83,1,95,84,83,31,82,85,40,0,82,82,8,0,41,82,82,4,3,85,85,82,112,84,85,8,145,84,84,0,59,85,255,0,145,85,85,0,65,83,84,85,145,83,83,0,75,83,83,0,19,83,83,80,0,33,83,0,82,83,20,0,82,83,83,0,82,85,6,0,25,85,85,2,95,83,85,33,82,85,6,0,25,85,85,3,85,6,85,0,82,85,8,0,25,85,85,1,85,8,85,0,119,0,189,255,82,73,20,0,106,83,73,4,106,84,73,8,5,85,83,84,41,85,85,1,135,37,6,0,85,0,0,0,82,85,20,0,85,85,37,0,1,85,0,0,83,10,85,0,1,85,0,0,83,12,85,0,1,85,0,0,83,14,85,0,1,85,0,0,83,16,85,0,1,85,0,0,85,17,85,0,82,84,20,0,106,84,84,4,82,83,20,0,106,83,83,8,5,85,84,83,82,83,17,0,56,85,85,83,184,48,0,0,82,82,40,0,82,86,17,0,41,86,86,4,100,84,82,86,145,84,84,0,59,82,31,0,145,82,82,0,65,83,84,82,145,83,83,0,134,85,0,0,20,159,2,0,83,0,0,0,75,85,85,0,83,10,85,0,82,84,40,0,82,86,17,0,41,86,86,4,3,84,84,86,112,82,84,4,145,82,82,0,59,84,31,0,145,84,84,0,65,83,82,84,145,83,83,0,134,85,0,0,20,159,2,0,83,0,0,0,75,85,85,0,83,12,85,0,82,82,40,0,82,86,17,0,41,86,86,4,3,82,82,86,112,84,82,8,145,84,84,0,59,82,31,0,145,82,82,0,65,83,84,82,145,83,83,0,134,85,0,0,20,159,2,0,83,0,0,0,75,85,85,0,83,14,85,0,82,83,40,0,82,82,17,0,41,82,82,4,3,83,83,82,112,85,83,12,145,85,85,0,62,83,0,0,112,79,227,32,25,25,201,63,145,83,83,0,73,38,85,83,1,85,1,0,1,82,0,0,125,83,38,85,82,0,0,0,83,16,83,0,82,83,20,0,82,83,83,0,82,82,17,0,41,82,82,1,79,85,10,0,19,85,85,79,41,85,85,11,79,84,12,0,19,84,84,79,41,84,84,6,20,85,85,84,79,84,14,0,19,84,84,79,41,84,84,1,20,85,85,84,79,84,16,0,19,84,84,79,20,85,85,84,96,83,82,85,82,85,17,0,25,85,85,1,85,17,85,0,119,0,166,255,82,74,20,0,106,82,74,4,106,83,74,8,5,85,82,83,41,85,85,1,135,39,6,0,85,0,0,0,82,85,20,0,85,85,39,0,1,85,0,0,83,19,85,0,1,85,0,0,83,21,85,0,1,85,0,0,83,22,85,0,1,85,0,0,83,23,85,0,1,85,0,0,85,24,85,0,82,83,20,0,106,83,83,4,82,82,20,0,106,82,82,8,5,85,83,82,82,82,24,0,56,85,85,82,184,48,0,0,82,84,40,0,82,86,24,0,41,86,86,4,100,83,84,86,145,83,83,0,59,84,15,0,145,84,84,0,65,82,83,84,145,82,82,0,134,85,0,0,20,159,2,0,82,0,0,0,75,85,85,0,83,19,85,0,82,83,40,0,82,86,24,0,41,86,86,4,3,83,83,86,112,84,83,4,145,84,84,0,59,83,15,0,145,83,83,0,65,82,84,83,145,82,82,0,134,85,0,0,20,159,2,0,82,0,0,0,75,85,85,0,83,21,85,0,82,84,40,0,82,86,24,0,41,86,86,4,3,84,84,86,112,83,84,8,145,83,83,0,59,84,15,0,145,84,84,0,65,82,83,84,145,82,82,0,134,85,0,0,20,159,2,0,82,0,0,0,75,85,85,0,83,22,85,0,82,83,40,0,82,86,24,0,41,86,86,4,3,83,83,86,112,84,83,12,145,84,84,0,59,83,15,0,145,83,83,0,65,82,84,83,145,82,82,0,134,85,0,0,20,159,2,0,82,0,0,0,75,85,85,0,83,23,85,0,82,85,20,0,82,85,85,0,82,82,24,0,41,82,82,1,79,83,19,0,19,83,83,79,41,83,83,12,79,84,21,0,19,84,84,79,41,84,84,8,20,83,83,84,79,84,22,0,19,84,84,79,41,84,84,4,20,83,83,84,79,84,23,0,19,84,84,79,20,83,83,84,96,85,82,83,82,83,24,0,25,83,83,1,85,24,83,0,119,0,167,255,82,75,20,0,106,82,75,4,106,85,75,8,5,83,82,85,41,83,83,2,135,41,6,0,83,0,0,0,82,83,20,0,85,83,41,0,1,83,0,0,85,25,83,0,1,83,0,0,85,27,83,0,82,85,20,0,106,85,85,4,82,82,20,0,106,82,82,8,5,83,85,82,41,83,83,2,82,82,25,0,56,83,83,82,184,48,0,0,82,85,40,0,82,84,27,0,41,84,84,4,100,82,85,84,145,82,82,0,59,85,255,0,145,85,85,0,65,83,82,85,145,83,83,0,75,83,83,0,19,83,83,80,0,42,83,0,82,83,20,0,82,83,83,0,82,85,25,0,95,83,85,42,82,82,40,0,82,84,27,0,41,84,84,4,3,82,82,84,112,83,82,4,145,83,83,0,59,82,255,0,145,82,82,0,65,85,83,82,145,85,85,0,75,85,85,0,19,85,85,80,0,43,85,0,82,85,20,0,82,85,85,0,82,82,25,0,25,82,82,1,95,85,82,43,82,83,40,0,82,84,27,0,41,84,84,4,3,83,83,84,112,85,83,8,145,85,85,0,59,83,255,0,145,83,83,0,65,82,85,83,145,82,82,0,75,82,82,0,19,82,82,80,0,45,82,0,82,82,20,0,82,82,82,0,82,83,25,0,25,83,83,2,95,82,83,45,82,85,40,0,82,84,27,0,41,84,84,4,3,85,85,84,112,82,85,12,145,82,82,0,59,85,255,0,145,85,85,0,65,83,82,85,145,83,83,0,75,83,83,0,19,83,83,80,0,46,83,0,82,83,20,0,82,83,83,0,82,85,25,0,25,85,85,3,95,83,85,46,82,85,25,0,25,85,85,4,85,25,85,0,82,85,27,0,25,85,85,1,85,27,85,0,119,0,171,255,82,76,20,0,106,83,76,4,106,82,76,8,5,85,83,82,41,85,85,2,135,47,6,0,85,0,0,0,82,85,20,0,85,85,47,0,1,85,0,0,85,28,85,0,82,82,20,0,106,82,82,4,82,83,20,0,106,83,83,8,5,85,82,83,82,83,28,0,56,85,85,83,184,48,0,0,82,83,40,0,82,82,28,0,41,82,82,4,100,85,83,82,145,85,85,0,62,83,0,0,209,221,1,224,208,34,211,63,145,83,83,0,65,48,85,83,145,48,48,0,82,82,40,0,82,84,28,0,41,84,84,4,3,82,82,84,112,85,82,4,145,85,85,0,62,82,0,0,217,84,201,63,180,200,226,63,145,82,82,0,65,83,85,82,145,83,83,0,63,50,48,83,145,50,50,0,82,85,40,0,82,84,28,0,41,84,84,4,3,85,85,84,112,82,85,8,145,82,82,0,62,85,0,0,201,118,190,159,26,47,189,63,145,85,85,0,65,83,82,85,145,83,83,0,63,51,50,83,145,51,51,0,82,83,20,0,82,83,83,0,82,85,28,0,41,85,85,2,101,83,85,51,82,85,28,0,25,85,85,1,85,28,85,0,119,0,201,255,82,77,20,0,106,83,77,4,106,82,77,8,5,85,83,82,27,85,85,3,41,85,85,2,135,52,6,0,85,0,0,0,82,85,20,0,85,85,52,0,1,85,0,0,85,30,85,0,1,85,0,0,85,32,85,0,82,82,20,0,106,82,82,4,82,83,20,0,106,83,83,8,5,85,82,83,27,85,85,3,82,83,30,0,56,85,85,83,184,48,0,0,82,85,40,0,82,83,32,0,41,83,83,4,100,53,85,83,145,53,53,0,82,85,20,0,82,85,85,0,82,83,30,0,41,83,83,2,101,85,83,53,82,83,40,0,82,85,32,0,41,85,85,4,3,83,83,85,112,55,83,4,145,55,55,0,82,83,20,0,82,83,83,0,82,85,30,0,25,85,85,1,41,85,85,2,101,83,85,55,82,85,40,0,82,83,32,0,41,83,83,4,3,85,85,83,112,56,85,8,145,56,56,0,82,85,20,0,82,85,85,0,82,83,30,0,25,83,83,2,41,83,83,2,101,85,83,56,82,83,30,0,25,83,83,3,85,30,83,0,82,83,32,0,25,83,83,1,85,32,83,0,119,0,207,255,82,78,20,0,106,85,78,4,106,82,78,8,5,83,85,82,41,83,83,2,41,83,83,2,135,57,6,0,83,0,0,0,82,83,20,0,85,83,57,0,1,83,0,0,85,34,83,0,1,83,0,0,85,36,83,0,82,82,20,0,106,82,82,4,82,85,20,0,106,85,85,8,5,83,82,85,41,83,83,2,82,85,34,0,56,83,83,85,184,48,0,0,82,83,40,0,82,85,36,0,41,85,85,4,100,58,83,85,145,58,58,0,82,83,20,0,82,83,83,0,82,85,34,0,41,85,85,2,101,83,85,58,82,85,40,0,82,83,36,0,41,83,83,4,3,85,85,83,112,59,85,4,145,59,59,0,82,85,20,0,82,85,85,0,82,83,34,0,25,83,83,1,41,83,83,2,101,85,83,59,82,83,40,0,82,85,36,0,41,85,85,4,3,83,83,85,112,60,83,8,145,60,60,0,82,83,20,0,82,83,83,0,82,85,34,0,25,85,85,2,41,85,85,2,101,83,85,60,82,85,40,0,82,83,36,0,41,83,83,4,3,85,85,83,112,61,85,12,145,61,61,0,82,85,20,0,82,85,85,0,82,83,34,0,25,83,83,3,41,83,83,2,101,85,83,61,82,83,34,0,25,83,83,4,85,34,83,0,82,83,36,0,25,83,83,1,85,36,83,0,119,0,195,255,82,83,40,0,135,81,5,0,83,0,0,0,1,81,0,0,85,40,81,0,82,81,20,0,106,81,81,12,36,81,81,1,121,81,3,0,137,68,0,0,139,0,0,0,82,81,20,0,1,83,1,0,109,81,12,83,82,83,20,0,82,83,83,0,120,83,3,0,137,68,0,0,139,0,0,0,82,81,20,0,134,83,0,0,232,60,1,0,81,0,0,0,137,68,0,0,139,0,0,0,140,4,102,0,0,0,0,0,2,88,0,0,255,127,0,0,2,89,0,0,1,1,0,0,2,90,0,0,144,1,0,0,2,91,0,0,143,0,0,0,2,92,0,0,144,0,0,0,2,93,0,0,224,15,0,0,2,94,0,0,128,15,0,0,2,95,0,0,255,63,0,0,2,96,0,0,255,0,0,0,1,74,0,0,136,97,0,0,0,75,97,0,136,97,0,0,25,97,97,96,137,97,0,0,130,97,0,0,136,98,0,0,49,97,97,98,160,49,0,0,1,98,96,0,135,97,0,0,98,0,0,0,25,37,75,84,25,48,75,80,25,60,75,76,25,71,75,72,25,72,75,68,25,73,75,64,25,4,75,60,25,6,75,56,25,7,75,52,25,8,75,48,25,9,75,44,25,10,75,40,25,11,75,36,25,12,75,32,25,13,75,28,25,14,75,24,25,15,75,20,25,18,75,16,25,21,75,12,25,22,75,8,25,24,75,4,0,25,75,0,85,48,0,0,85,60,1,0,85,71,2,0,85,72,3,0,1,97,0,0,85,73,97,0,1,97,0,0,85,7,97,0,1,97,0,0,85,8,97,0,2,98,0,0,0,0,1,0,135,97,6,0,98,0,0,0,85,9,97,0,82,97,9,0,120,97,6,0,1,97,0,0,85,37,97,0,82,69,37,0,137,75,0,0,139,69,0,0,82,97,72,0,34,97,97,5,121,97,3,0,1,97,5,0,85,72,97,0,82,97,8,0,120,97,3,0,1,74,7,0,119,0,11,0,82,97,8,0,26,97,97,8,82,97,97,0,82,98,8,0,26,98,98,8,106,98,98,4,25,98,98,1,49,97,97,98,156,50,0,0,1,74,7,0,32,97,74,7,121,97,6,0,1,98,1,0,1,99,1,0,134,97,0,0,116,12,2,0,8,98,99,0,82,76,8,0,0,39,76,0,26,97,76,8,25,42,97,4,82,45,42,0,25,97,45,1,85,42,97,0,1,99,120,0,95,39,45,99,82,99,8,0,120,99,3,0,1,74,10,0,119,0,11,0,82,99,8,0,26,99,99,8,82,99,99,0,82,97,8,0,26,97,97,8,106,97,97,4,25,97,97,1,49,99,99,97,20,51,0,0,1,74,10,0,32,99,74,10,121,99,6,0,1,97,1,0,1,98,1,0,134,99,0,0,116,12,2,0,8,97,98,0,82,77,8,0,0,61,77,0,26,99,77,8,25,68,99,4,82,70,68,0,25,99,70,1,85,68,99,0,1,98,94,0,95,61,70,98,82,98,73,0,1,99,1,0,82,97,7,0,22,99,99,97,20,98,98,99,85,73,98,0,82,98,7,0,25,98,98,1,85,7,98,0,82,99,8,0,134,98,0,0,204,30,2,0,99,73,7,0,85,8,98,0,82,98,73,0,1,99,1,0,82,97,7,0,22,99,99,97,20,98,98,99,85,73,98,0,82,98,7,0,25,98,98,2,85,7,98,0,82,99,8,0,134,98,0,0,204,30,2,0,99,73,7,0,85,8,98,0,1,98,0,0,85,4,98,0,1,98,0,64,82,99,4,0,56,98,98,99,0,52,0,0,82,98,9,0,82,99,4,0,41,99,99,2,1,97,0,0,97,98,99,97,82,97,4,0,25,97,97,1,85,4,97,0,119,0,244,255,1,97,0,0,85,4,97,0,82,97,60,0,26,97,97,3,82,99,4,0,56,97,97,99,148,59,0,0,82,99,48,0,82,98,4,0,3,99,99,98,134,97,0,0,244,53,2,0,99,0,0,0,19,97,97,95,85,10,97,0,1,97,3,0,85,11,97,0,1,97,0,0,85,12,97,0,82,97,9,0,82,99,10,0,41,99,99,2,3,97,97,99,116,13,97,0,82,97,13,0,121,97,5,0,82,97,13,0,26,97,97,8,106,5,97,4,119,0,2,0,1,5,0,0,85,14,5,0,1,97,0,0,85,6,97,0,82,97,14,0,82,99,6,0,56,97,97,99,52,53,0,0,82,97,4,0,2,99,0,0,0,128,0,0,4,97,97,99,82,99,13,0,82,98,6,0,41,98,98,2,94,99,99,98,82,98,48,0,4,99,99,98,47,97,97,99,36,53,0,0,82,84,4,0,82,99,13,0,82,98,6,0,41,98,98,2,94,99,99,98,82,98,48,0,3,98,98,84,82,100,60,0,4,100,100,84,134,97,0,0,188,59,2,0,99,98,100,0,85,15,97,0,82,97,11,0,82,100,15,0,49,97,97,100,36,53,0,0,116,11,15,0,82,97,13,0,82,100,6,0,41,100,100,2,3,97,97,100,116,12,97,0,82,97,6,0,25,97,97,1,85,6,97,0,119,0,214,255,82,97,9,0,82,100,10,0,41,100,100,2,94,97,97,100,121,97,28,0,82,97,9,0,82,100,10,0,41,100,100,2,94,97,97,100,26,97,97,8,106,97,97,4,82,100,72,0,41,100,100,1,45,97,97,100,180,53,0,0,82,97,9,0,82,100,10,0,41,100,100,2,94,85,97,100,82,97,72,0,41,97,97,2,0,86,97,0,3,100,85,86,135,97,7,0,85,100,86,0,82,97,9,0,82,100,10,0,41,100,100,2,94,97,97,100,26,97,97,8,82,100,72,0,109,97,4,100,82,100,9,0,82,97,10,0,41,97,97,2,94,100,100,97,120,100,3,0,1,74,29,0,119,0,17,0,82,100,9,0,82,97,10,0,41,97,97,2,94,100,100,97,26,100,100,8,82,100,100,0,82,97,9,0,82,98,10,0,41,98,98,2,94,97,97,98,26,97,97,8,106,97,97,4,25,97,97,1,49,100,100,97,16,54,0,0,1,74,29,0,32,100,74,29,121,100,11,0,1,74,0,0,82,97,9,0,82,98,10,0,41,98,98,2,3,97,97,98,1,98,1,0,1,99,4,0,134,100,0,0,116,12,2,0,97,98,99,0,82,100,48,0,82,99,4,0,3,16,100,99,82,99,9,0,82,100,10,0,41,100,100,2,94,83,99,100,0,17,83,0,26,99,83,8,25,19,99,4,82,20,19,0,25,99,20,1,85,19,99,0,41,99,20,2,97,17,99,16,82,99,12,0,121,99,64,0,82,100,48,0,82,98,4,0,3,100,100,98,25,100,100,1,134,99,0,0,244,53,2,0,100,0,0,0,19,99,99,95,85,10,99,0,82,99,9,0,82,100,10,0,41,100,100,2,3,99,99,100,116,13,99,0,82,99,13,0,121,99,5,0,82,99,13,0,26,99,99,8,106,23,99,4,119,0,2,0,1,23,0,0,85,14,23,0,1,99,0,0,85,6,99,0,82,99,14,0,82,100,6,0,56,99,99,100,128,55,0,0,82,99,4,0,4,99,99,88,82,100,13,0,82,98,6,0,41,98,98,2,94,100,100,98,82,98,48,0,4,100,100,98,47,99,99,100,104,55,0,0,82,87,4,0,82,100,13,0,82,98,6,0,41,98,98,2,94,100,100,98,82,98,48,0,3,98,98,87,25,98,98,1,82,97,60,0,4,97,97,87,26,97,97,1,134,99,0,0,188,59,2,0,100,98,97,0,85,18,99,0,82,99,11,0,82,97,18,0,54,99,99,97,120,55,0,0,82,99,6,0,25,99,99,1,85,6,99,0,119,0,220,255,1,99,0,0,85,12,99,0,82,99,48,0,82,97,4,0,3,26,99,97,82,97,12,0,121,97,209,0,82,97,12,0,4,97,26,97,85,21,97,0,82,97,21,0,17,97,97,88,82,99,11,0,1,98,2,1,17,99,99,98,19,97,97,99,120,97,3,0,1,74,41,0,119,0,245,0,1,97,0,0,85,6,97,0,82,27,6,0,82,97,11,0,82,99,6,0,25,99,99,1,41,99,99,1,93,99,94,99,26,99,99,1,56,97,97,99,252,55,0,0,25,97,27,1,85,6,97,0,119,0,245,255,82,97,6,0,3,28,97,89,3,97,27,89,49,97,97,91,92,56,0,0,25,97,28,48,1,99,8,0,134,29,0,0,180,128,2,0,97,99,0,0,82,99,73,0,82,97,7,0,22,97,29,97,20,99,99,97,85,73,99,0,82,99,7,0,25,99,99,8,85,7,99,0,82,97,8,0,134,99,0,0,204,30,2,0,97,73,7,0,85,8,99,0,119,0,73,0,82,99,6,0,3,30,99,89,49,99,28,96,188,56,0,0,3,99,90,30,4,99,99,92,1,97,9,0,134,31,0,0,180,128,2,0,99,97,0,0,82,97,73,0,82,99,7,0,22,99,31,99,20,97,97,99,85,73,97,0,82,97,7,0,25,97,97,9,85,7,97,0,82,99,8,0,134,97,0,0,204,30,2,0,99,73,7,0,85,8,97,0,119,0,49,0,82,97,6,0,3,32,97,89,1,97,23,1,49,97,30,97,36,57,0,0,25,97,32,0,1,99,0,1,4,97,97,99,1,99,7,0,134,33,0,0,180,128,2,0,97,99,0,0,82,99,73,0,82,97,7,0,22,97,33,97,20,99,99,97,85,73,99,0,82,99,7,0,25,99,99,7,85,7,99,0,82,97,8,0,134,99,0,0,204,30,2,0,97,73,7,0,85,8,99,0,119,0,23,0,1,99,192,0,3,99,99,32,1,97,24,1,4,99,99,97,1,97,8,0,134,34,0,0,180,128,2,0,99,97,0,0,82,97,73,0,82,99,7,0,22,99,34,99,20,97,97,99,85,73,97,0,82,97,7,0,25,97,97,8,85,7,97,0,82,99,8,0,134,97,0,0,204,30,2,0,99,73,7,0,85,8,97,0,119,0,1,0,1,97,192,15,82,99,6,0,90,97,97,99,121,97,22,0,82,97,73,0,82,99,11,0,82,98,6,0,41,98,98,1,93,98,94,98,4,99,99,98,82,98,7,0,22,99,99,98,20,97,97,99,85,73,97,0,82,97,7,0,1,99,192,15,82,98,6,0,91,99,99,98,3,97,97,99,85,7,97,0,82,99,8,0,134,97,0,0,204,30,2,0,99,73,7,0,85,8,97,0,1,97,0,0,85,6,97,0,82,35,6,0,82,97,21,0,82,99,6,0,25,99,99,1,41,99,99,1,93,99,93,99,26,99,99,1,56,97,97,99,24,58,0,0,25,97,35,1,85,6,97,0,119,0,245,255,1,97,5,0,134,36,0,0,180,128,2,0,35,97,0,0,82,97,73,0,82,99,7,0,22,99,36,99,20,97,97,99,85,73,97,0,82,97,7,0,25,97,97,5,85,7,97,0,82,99,8,0,134,97,0,0,204,30,2,0,99,73,7,0,85,8,97,0,1,97,32,16,82,99,6,0,90,97,97,99,121,97,22,0,82,97,73,0,82,99,21,0,82,98,6,0,41,98,98,1,93,98,93,98,4,99,99,98,82,98,7,0,22,99,99,98,20,97,97,99,85,73,97,0,82,97,7,0,1,99,32,16,82,98,6,0,91,99,99,98,3,97,97,99,85,7,97,0,82,99,8,0,134,97,0,0,204,30,2,0,99,73,7,0,85,8,97,0,82,97,4,0,82,99,11,0,3,97,97,99,85,4,97,0,119,0,78,254,82,97,48,0,82,99,4,0,91,38,97,99,79,97,26,0,49,97,97,91,56,59,0,0,25,97,38,48,1,99,8,0,134,40,0,0,180,128,2,0,97,99,0,0,82,99,73,0,82,97,7,0,22,97,40,97,20,99,99,97,85,73,99,0,82,99,7,0,25,99,99,8,85,7,99,0,82,97,8,0,134,99,0,0,204,30,2,0,97,73,7,0,85,8,99,0,119,0,20,0,3,99,90,38,4,99,99,92,1,97,9,0,134,41,0,0,180,128,2,0,99,97,0,0,82,97,73,0,82,99,7,0,22,99,41,99,20,97,97,99,85,73,97,0,82,97,7,0,25,97,97,9,85,7,97,0,82,99,8,0,134,97,0,0,204,30,2,0,99,73,7,0,85,8,97,0,82,97,4,0,25,97,97,1,85,4,97,0,119,0,30,254,32,97,74,41,121,97,7,0,1,99,195,47,1,98,142,47,1,100,154,3,1,101,221,47,135,97,8,0,99,98,100,101,82,97,60,0,82,101,4,0,56,97,97,101,140,60,0,0,82,97,48,0,82,101,4,0,91,43,97,101,82,97,48,0,82,101,4,0,91,97,97,101,49,97,97,91,48,60,0,0,25,97,43,48,1,101,8,0,134,44,0,0,180,128,2,0,97,101,0,0,82,101,73,0,82,97,7,0,22,97,44,97,20,101,101,97,85,73,101,0,82,101,7,0,25,101,101,8,85,7,101,0,82,97,8,0,134,101,0,0,204,30,2,0,97,73,7,0,85,8,101,0,119,0,20,0,3,101,90,43,4,101,101,92,1,97,9,0,134,46,0,0,180,128,2,0,101,97,0,0,82,97,73,0,82,101,7,0,22,101,46,101,20,97,97,101,85,73,97,0,82,97,7,0,25,97,97,9,85,7,97,0,82,101,8,0,134,97,0,0,204,30,2,0,101,73,7,0,85,8,97,0,82,97,4,0,25,97,97,1,85,4,97,0,119,0,203,255,1,97,0,0,1,101,7,0,134,47,0,0,180,128,2,0,97,101,0,0,82,101,73,0,82,97,7,0,22,97,47,97,20,101,101,97,85,73,101,0,82,101,7,0,25,101,101,7,85,7,101,0,82,97,8,0,134,101,0,0,204,30,2,0,97,73,7,0,85,8,101,0,82,101,7,0,120,101,2,0,119,0,16,0,82,101,73,0,1,97,0,0,82,100,7,0,22,97,97,100,20,101,101,97,85,73,101,0,82,101,7,0,25,101,101,1,85,7,101,0,82,97,8,0,134,101,0,0,204,30,2,0,97,73,7,0,85,8,101,0,119,0,239,255,1,101,0,0,85,4,101,0,82,49,9,0,1,101,0,64,82,97,4,0,56,101,101,97,116,61,0,0,82,101,4,0,41,101,101,2,94,101,49,101,121,101,8,0,82,97,9,0,82,100,4,0,41,100,100,2,94,97,97,100,26,97,97,8,135,101,5,0,97,0,0,0,82,101,4,0,25,101,101,1,85,4,101,0,119,0,237,255,135,101,5,0,49,0,0,0,1,101,1,0,85,22,101,0,1,101,0,0,85,24,101,0,82,101,60,0,1,97,176,21,8,101,101,97,85,25,101,0,1,101,0,0,85,6,101,0,82,101,60,0,82,97,6,0,56,101,101,97,80,62,0,0,1,101,0,0,85,4,101,0,82,101,25,0,82,97,4,0,56,101,101,97,12,62,0,0,82,101,22,0,82,97,48,0,82,100,6,0,82,98,4,0,3,100,100,98,91,97,97,100,3,101,101,97,85,22,101,0,82,101,24,0,82,97,22,0,3,101,101,97,85,24,101,0,82,101,4,0,25,101,101,1,85,4,101,0,119,0,237,255,82,101,22,0,2,97,0,0,241,255,0,0,9,101,101,97,85,22,101,0,82,101,24,0,2,97,0,0,241,255,0,0,9,101,101,97,85,24,101,0,82,101,6,0,82,97,25,0,3,101,101,97,85,6,101,0,1,101,176,21,85,25,101,0,119,0,214,255,82,101,8,0,120,101,3,0,1,74,87,0,119,0,11,0,82,101,8,0,26,101,101,8,82,101,101,0,82,97,8,0,26,97,97,8,106,97,97,4,25,97,97,1,49,101,101,97,136,62,0,0,1,74,87,0,32,101,74,87,121,101,6,0,1,97,1,0,1,100,1,0,134,101,0,0,116,12,2,0,8,97,100,0,82,101,24,0,43,101,101,8,19,101,101,96,0,50,101,0,82,78,8,0,0,51,78,0,26,101,78,8,25,52,101,4,82,53,52,0,25,101,53,1,85,52,101,0,95,51,53,50,82,101,8,0,120,101,3,0,1,74,90,0,119,0,11,0,82,101,8,0,26,101,101,8,82,101,101,0,82,100,8,0,26,100,100,8,106,100,100,4,25,100,100,1,49,101,101,100,12,63,0,0,1,74,90,0,32,101,74,90,121,101,6,0,1,100,1,0,1,97,1,0,134,101,0,0,116,12,2,0,8,100,97,0,82,101,24,0,19,101,101,96,0,54,101,0,82,79,8,0,0,55,79,0,26,101,79,8,25,56,101,4,82,57,56,0,25,101,57,1,85,56,101,0,95,55,57,54,82,101,8,0,120,101,3,0,1,74,93,0,119,0,11,0,82,101,8,0,26,101,101,8,82,101,101,0,82,97,8,0,26,97,97,8,106,97,97,4,25,97,97,1,49,101,101,97,140,63,0,0,1,74,93,0,32,101,74,93,121,101,6,0,1,97,1,0,1,100,1,0,134,101,0,0,116,12,2,0,8,97,100,0,82,101,22,0,43,101,101,8,19,101,101,96,0,58,101,0,82,80,8,0,0,59,80,0,26,101,80,8,25,62,101,4,82,63,62,0,25,101,63,1,85,62,101,0,95,59,63,58,82,101,8,0,120,101,3,0,1,74,96,0,119,0,11,0,82,101,8,0,26,101,101,8,82,101,101,0,82,100,8,0,26,100,100,8,106,100,100,4,25,100,100,1,49,101,101,100,16,64,0,0,1,74,96,0,32,101,74,96,121,101,6,0,1,100,1,0,1,97,1,0,134,101,0,0,116,12,2,0,8,100,97,0,82,101,22,0,19,101,101,96,0,64,101,0,82,81,8,0,0,65,81,0,26,101,81,8,25,66,101,4,82,67,66,0,25,101,67,1,85,66,101,0,95,65,67,64,82,101,71,0,82,97,8,0,26,97,97,8,25,97,97,4,116,101,97,0,82,82,8,0,26,101,82,8,82,100,71,0,82,100,100,0,135,97,7,0,101,82,100,0,82,97,8,0,26,97,97,8,85,37,97,0,82,69,37,0,137,75,0,0,139,69,0,0,140,2,73,0,0,0,0,0,2,65,0,0,208,20,0,0,2,66,0,0,144,0,0,0,136,67,0,0,0,64,67,0,136,67,0,0,3,67,67,66,137,67,0,0,130,67,0,0,136,68,0,0,49,67,67,68,224,64,0,0,135,67,0,0,66,0,0,0,1,67,136,0,3,18,64,67,1,67,132,0,3,35,64,67,1,67,128,0,3,49,64,67,25,56,64,124,25,59,64,120,25,61,64,116,25,62,64,112,25,63,64,108,25,2,64,104,25,4,64,100,25,5,64,96,25,7,64,92,25,9,64,88,25,10,64,84,25,12,64,80,25,13,64,76,25,15,64,72,25,16,64,68,25,19,64,64,25,21,64,60,25,22,64,56,25,24,64,52,25,26,64,48,25,27,64,44,25,29,64,40,25,30,64,36,25,32,64,32,25,33,64,28,25,36,64,24,25,38,64,20,25,39,64,16,25,41,64,12,25,43,64,8,25,44,64,4,0,46,64,0,85,18,0,0,85,35,1,0,82,67,18,0,25,67,67,64,116,56,67,0,82,67,18,0,25,67,67,68,116,59,67,0,82,67,18,0,25,67,67,76,116,61,67,0,82,67,18,0,25,67,67,96,116,62,67,0,82,67,18,0,25,67,67,4,116,63,67,0,82,67,18,0,25,67,67,12,116,2,67,0,82,68,18,0,134,67,0,0,200,143,2,0,68,0,0,0,85,4,67,0,82,67,18,0,25,67,67,88,116,5,67,0,82,67,18,0,25,67,67,92,116,7,67,0,82,67,7,0,82,68,35,0,82,69,18,0,106,69,69,8,134,60,0,0,212,109,2,0,67,68,69,0,82,68,2,0,5,69,60,68,85,9,69,0,82,69,18,0,82,69,69,0,82,68,9,0,3,69,69,68,85,10,69,0,82,69,63,0,82,68,18,0,94,68,68,66,3,69,69,68,85,12,69,0,82,69,61,0,41,69,69,1,82,68,62,0,3,69,69,68,85,13,69,0,1,69,0,0,82,68,18,0,94,68,68,66,4,69,69,68,85,15,69,0,82,69,7,0,32,69,69,4,121,69,40,0,1,69,0,0,82,68,35,0,49,69,69,68,156,66,0,0,82,69,35,0,82,68,18,0,106,68,68,8,54,69,69,68,20,67,0,0,82,69,12,0,82,68,15,0,56,69,69,68,12,67,0,0,1,69,0,0,85,49,69,0,82,69,56,0,82,68,49,0,56,69,69,68,252,66,0,0,82,69,15,0,82,68,56,0,5,3,69,68,82,68,4,0,82,69,49,0,3,69,3,69,41,69,69,2,59,67,0,0,145,67,67,0,101,68,69,67,82,67,49,0,25,67,67,1,85,49,67,0,119,0,239,255,82,67,15,0,25,67,67,1,85,15,67,0,119,0,229,255,137,64,0,0,139,0,0,0,82,67,13,0,1,69,0,0,1,72,8,0,138,67,69,72,96,67,0,0,32,68,0,0,40,69,0,0,240,69,0,0,36,71,0,0,232,71,0,0,20,73,0,0,196,73,0,0,1,68,135,53,1,70,90,48,1,71,88,5,1,72,184,53,135,69,8,0,68,70,71,72,119,0,219,1,82,69,12,0,82,68,15,0,56,69,69,68,200,74,0,0,82,68,15,0,82,70,56,0,5,69,68,70,85,16,69,0,82,69,5,0,82,70,15,0,82,68,63,0,134,6,0,0,212,109,2,0,69,70,68,0,82,70,56,0,5,68,6,70,85,19,68,0,1,68,0,0,85,49,68,0,82,68,56,0,82,70,49,0,56,68,68,70,16,68,0,0,82,70,10,0,82,69,19,0,82,71,49,0,3,69,69,71,91,68,70,69,76,68,68,0,145,68,68,0,59,70,255,0,145,70,70,0,66,8,68,70,145,8,8,0,82,70,4,0,82,68,16,0,82,69,49,0,3,68,68,69,41,68,68,2,101,70,68,8,82,68,49,0,25,68,68,1,85,49,68,0,119,0,232,255,82,68,15,0,25,68,68,1,85,15,68,0,119,0,209,255,82,68,12,0,82,70,15,0,56,68,68,70,200,74,0,0,82,70,15,0,82,69,56,0,5,68,70,69,85,21,68,0,82,68,5,0,82,69,15,0,82,70,63,0,134,11,0,0,212,109,2,0,68,69,70,0,82,69,56,0,5,70,11,69,85,22,70,0,1,70,0,0,85,49,70,0,82,70,56,0,82,69,49,0,56,70,70,69,196,68,0,0,82,70,10,0,82,69,22,0,82,68,49,0,3,69,69,68,91,70,70,69,41,70,70,2,100,14,65,70,145,14,14,0,82,70,4,0,82,69,21,0,82,68,49,0,3,69,69,68,41,69,69,2,101,70,69,14,82,69,49,0,25,69,69,1,85,49,69,0,119,0,235,255,82,69,18,0,106,69,69,72,38,69,69,2,120,69,18,0,82,70,10,0,82,68,22,0,82,71,59,0,3,68,68,71,91,69,70,68,76,69,69,0,145,69,69,0,59,70,255,0,145,70,70,0,66,17,69,70,145,17,17,0,82,70,4,0,82,69,21,0,82,68,59,0,3,69,69,68,41,69,69,2,101,70,69,17,82,69,15,0,25,69,69,1,85,15,69,0,119,0,191,255,82,69,12,0,82,70,15,0,56,69,69,70,200,74,0,0,82,70,15,0,82,68,56,0,5,69,70,68,85,24,69,0,82,69,5,0,82,68,15,0,82,70,63,0,134,20,0,0,212,109,2,0,69,68,70,0,82,68,56,0,5,70,20,68,85,26,70,0,1,70,0,0,85,49,70,0,82,70,56,0,82,68,49,0,56,70,70,68,224,69,0,0,82,68,10,0,82,69,26,0,82,71,49,0,3,69,69,71,41,69,69,1,93,70,68,69,76,70,70,0,145,70,70,0,60,68,0,0,255,255,0,0,145,68,68,0,66,23,70,68,145,23,23,0,82,68,4,0,82,70,24,0,82,69,49,0,3,70,70,69,41,70,70,2,101,68,70,23,82,70,49,0,25,70,70,1,85,49,70,0,119,0,230,255,82,70,15,0,25,70,70,1,85,15,70,0,119,0,207,255,82,70,12,0,82,68,15,0,56,70,70,68,200,74,0,0,82,68,15,0,82,69,56,0,5,70,68,69,85,27,70,0,82,70,5,0,82,69,15,0,82,68,63,0,134,25,0,0,212,109,2,0,70,69,68,0,82,69,56,0,5,68,25,69,85,29,68,0,1,68,0,0,85,49,68,0,82,68,56,0,82,69,49,0,56,68,68,69,184,70,0,0,82,70,10,0,82,71,29,0,82,72,49,0,3,71,71,72,41,71,71,1,93,69,70,71,76,69,69,0,145,69,69,0,60,70,0,0,255,255,0,0,145,70,70,0,66,68,69,70,145,68,68,0,134,28,0,0,84,101,2,0,68,0,0,0,145,28,28,0,82,68,4,0,82,70,27,0,82,69,49,0,3,70,70,69,41,70,70,2,101,68,70,28,82,70,49,0,25,70,70,1,85,49,70,0,119,0,226,255,82,70,18,0,106,70,70,72,38,70,70,2,120,70,20,0,82,68,10,0,82,69,29,0,82,71,59,0,3,69,69,71,41,69,69,1,93,70,68,69,76,70,70,0,145,70,70,0,60,68,0,0,255,255,0,0,145,68,68,0,66,31,70,68,145,31,31,0,82,68,4,0,82,70,27,0,82,69,59,0,3,70,70,69,41,70,70,2,101,68,70,31,82,70,15,0,25,70,70,1,85,15,70,0,119,0,180,255,82,70,12,0,82,68,15,0,56,70,70,68,200,74,0,0,82,68,15,0,82,69,56,0,5,70,68,69,85,30,70,0,82,70,5,0,82,69,15,0,82,68,63,0,134,34,0,0,212,109,2,0,70,69,68,0,82,69,56,0,5,68,34,69,85,32,68,0,1,68,0,0,85,49,68,0,82,68,56,0,82,69,49,0,56,68,68,69,216,71,0,0,82,68,10,0,82,69,32,0,82,70,49,0,3,69,69,70,41,69,69,2,94,68,68,69,77,68,68,0,62,69,0,0,0,0,224,255,255,255,239,65,66,37,68,69,145,37,37,0,82,69,4,0,82,68,30,0,82,70,49,0,3,68,68,70,41,68,68,2,101,69,68,37,82,68,49,0,25,68,68,1,85,49,68,0,119,0,231,255,82,68,15,0,25,68,68,1,85,15,68,0,119,0,208,255,82,68,12,0,82,69,15,0,56,68,68,69,200,74,0,0,82,69,15,0,82,70,56,0,5,68,69,70,85,33,68,0,82,68,5,0,82,70,15,0,82,69,63,0,134,40,0,0,212,109,2,0,68,70,69,0,82,70,56,0,5,69,40,70,85,36,69,0,1,69,0,0,85,49,69,0,82,69,56,0,82,70,49,0,56,69,69,70,172,72,0,0,82,70,10,0,82,68,36,0,82,71,49,0,3,68,68,71,41,68,68,2,94,70,70,68,77,70,70,0,62,68,0,0,0,0,224,255,255,255,239,65,66,69,70,68,145,69,69,0,134,42,0,0,84,101,2,0,69,0,0,0,145,42,42,0,82,69,4,0,82,68,33,0,82,70,49,0,3,68,68,70,41,68,68,2,101,69,68,42,82,68,49,0,25,68,68,1,85,49,68,0,119,0,227,255,82,68,18,0,106,68,68,72,38,68,68,2,120,68,19,0,82,68,10,0,82,69,36,0,82,70,59,0,3,69,69,70,41,69,69,2,94,68,68,69,77,68,68,0,62,69,0,0,0,0,224,255,255,255,239,65,66,45,68,69,145,45,45,0,82,69,4,0,82,68,33,0,82,70,59,0,3,68,68,70,41,68,68,2,101,69,68,45,82,68,15,0,25,68,68,1,85,15,68,0,119,0,182,255,82,68,12,0,82,69,15,0,56,68,68,69,200,74,0,0,82,69,15,0,82,70,56,0,5,68,69,70,85,38,68,0,82,68,5,0,82,70,15,0,82,69,63,0,134,47,0,0,212,109,2,0,68,70,69,0,82,70,56,0,5,69,47,70,85,39,69,0,1,69,0,0,85,49,69,0,82,69,56,0,82,70,49,0,56,69,69,70,180,73,0,0,82,69,10,0,82,70,39,0,82,68,49,0,3,70,70,68,41,70,70,2,100,48,69,70,145,48,48,0,82,69,4,0,82,70,38,0,82,68,49,0,3,70,70,68,41,70,70,2,101,69,70,48,82,70,49,0,25,70,70,1,85,49,70,0,119,0,236,255,82,70,15,0,25,70,70,1,85,15,70,0,119,0,213,255,82,70,12,0,82,69,15,0,56,70,70,69,200,74,0,0,82,69,15,0,82,68,56,0,5,70,69,68,85,41,70,0,82,70,5,0,82,68,15,0,82,69,63,0,134,50,0,0,212,109,2,0,70,68,69,0,82,68,56,0,5,69,50,68,85,43,69,0,1,69,0,0,85,49,69,0,82,69,56,0,82,68,49,0,56,69,69,68,116,74,0,0,82,68,10,0,82,70,43,0,82,71,49,0,3,70,70,71,41,70,70,2,100,69,68,70,145,69,69,0,134,51,0,0,84,101,2,0,69,0,0,0,145,51,51,0,82,69,4,0,82,68,41,0,82,70,49,0,3,68,68,70,41,68,68,2,101,69,68,51,82,68,49,0,25,68,68,1,85,49,68,0,119,0,232,255,82,68,18,0,106,68,68,72,38,68,68,2,120,68,14,0,82,68,10,0,82,69,43,0,82,70,59,0,3,69,69,70,41,69,69,2,100,52,68,69,145,52,52,0,82,68,4,0,82,69,41,0,82,70,59,0,3,69,69,70,41,69,69,2,101,68,69,52,82,69,15,0,25,69,69,1,85,15,69,0,119,0,192,255,82,67,18,0,106,67,67,72,38,67,67,1,120,67,74,0,1,67,0,0,82,69,18,0,94,69,69,66,4,67,67,69,85,15,67,0,82,67,12,0,82,69,15,0,56,67,67,69,252,75,0,0,82,69,15,0,82,72,56,0,5,67,69,72,85,44,67,0,82,72,4,0,82,69,44,0,82,71,59,0,3,69,69,71,41,69,69,2,100,67,72,69,145,67,67,0,89,46,67,0,82,67,18,0,106,67,67,76,33,67,67,3,121,67,18,0,88,72,46,0,145,72,72,0,62,69,0,0,13,34,37,0,0,0,240,58,145,69,69,0,63,67,72,69,145,67,67,0,89,46,67,0,88,53,46,0,145,53,53,0,82,67,4,0,82,69,44,0,82,72,59,0,3,69,69,72,41,69,69,2,101,67,69,53,1,69,0,0,85,49,69,0,82,69,56,0,82,67,49,0,56,69,69,67,236,75,0,0,82,69,49,0,82,67,59,0,46,69,69,67,220,75,0,0,88,54,46,0,145,54,54,0,82,69,4,0,82,67,44,0,82,72,49,0,3,67,67,72,41,67,67,2,3,55,69,67,88,69,55,0,145,69,69,0,65,67,69,54,145,67,67,0,89,55,67,0,82,67,49,0,25,67,67,1,85,49,67,0,119,0,232,255,82,67,15,0,25,67,67,1,85,15,67,0,119,0,189,255,82,67,5,0,33,67,67,4,121,67,3,0,137,64,0,0,139,0,0,0,1,67,0,0,82,69,18,0,94,69,69,66,4,67,67,69,85,15,67,0,1,67,0,0,82,69,15,0,56,67,67,69,148,76,0,0,1,67,0,0,85,49,67,0,82,67,56,0,82,69,49,0,56,67,67,69,132,76,0,0,82,67,15,0,82,69,56,0,5,57,67,69,82,69,4,0,82,67,49,0,3,67,57,67,41,67,67,2,59,72,0,0,145,72,72,0,101,69,67,72,82,72,49,0,25,72,72,1,85,49,72,0,119,0,239,255,82,72,15,0,25,72,72,1,85,15,72,0,119,0,229,255,116,15,63,0,82,72,12,0,82,67,15,0,56,72,72,67,8,77,0,0,1,72,0,0,85,49,72,0,82,72,56,0,82,67,49,0,56,72,72,67,248,76,0,0,82,72,15,0,82,67,56,0,5,58,72,67,82,67,4,0,82,72,49,0,3,72,58,72,41,72,72,2,59,69,0,0,145,69,69,0,101,67,72,69,82,69,49,0,25,69,69,1,85,49,69,0,119,0,239,255,82,69,15,0,25,69,69,1,85,15,69,0,119,0,229,255,137,64,0,0,139,0,0,0,140,2,105,0,0,0,0,0,136,97,0,0,0,96,97,0,136,97,0,0,1,98,192,0,3,97,97,98,137,97,0,0,130,97,0,0,136,98,0,0,49,97,97,98,76,77,0,0,1,98,192,0,135,97,0,0,98,0,0,0,1,97,184,0,3,19,96,97,1,97,180,0,3,45,96,97,1,97,176,0,3,69,96,97,1,97,172,0,3,91,96,97,1,97,168,0,3,92,96,97,1,97,164,0,3,93,96,97,1,97,160,0,3,94,96,97,1,97,156,0,3,95,96,97,1,97,152,0,3,2,96,97,1,97,148,0,3,3,96,97,1,97,144,0,3,4,96,97,1,97,140,0,3,5,96,97,1,97,136,0,3,7,96,97,1,97,132,0,3,8,96,97,1,97,128,0,3,11,96,97,25,13,96,124,25,15,96,120,25,16,96,116,25,20,96,112,25,23,96,108,25,26,96,104,25,28,96,100,25,29,96,96,25,31,96,92,25,34,96,88,25,38,96,84,25,41,96,80,25,43,96,76,25,46,96,72,25,47,96,68,25,50,96,64,25,53,96,60,25,56,96,56,25,60,96,52,25,63,96,48,25,65,96,44,25,67,96,40,25,68,96,36,25,70,96,32,25,74,96,28,25,78,96,24,25,85,96,20,25,86,96,16,25,87,96,12,25,88,96,8,25,89,96,4,0,90,96,0,85,19,0,0,85,45,1,0,82,97,19,0,25,97,97,20,116,92,97,0,82,97,19,0,25,97,97,108,116,93,97,0,82,97,19,0,25,97,97,112,116,94,97,0,82,97,19,0,25,97,97,64,116,95,97,0,82,97,19,0,25,97,97,68,116,2,97,0,82,97,19,0,25,97,97,76,116,3,97,0,82,97,19,0,25,97,97,96,116,4,97,0,82,97,19,0,1,98,164,0,3,97,97,98,116,5,97,0,82,97,19,0,25,97,97,16,116,7,97,0,82,97,19,0,1,98,184,0,3,97,97,98,116,8,97,0,82,97,3,0,41,97,97,1,82,98,4,0,3,97,97,98,85,11,97,0,82,97,19,0,1,98,132,0,3,97,97,98,116,13,97,0,116,16,45,0,82,97,19,0,1,98,180,0,3,97,97,98,116,20,97,0,82,97,19,0,1,98,176,0,3,97,97,98,116,23,97,0,82,97,19,0,1,98,168,0,3,97,97,98,116,26,97,0,82,97,19,0,1,98,160,0,94,97,97,98,29,97,97,4,85,28,97,0,82,98,13,0,82,99,16,0,5,97,98,99,85,38,97,0,82,97,93,0,82,99,16,0,41,99,99,3,3,97,97,99,116,29,97,0,82,97,93,0,82,99,16,0,41,99,99,3,3,97,97,99,25,97,97,4,116,31,97,0,82,99,45,0,82,98,19,0,106,98,98,28,5,97,99,98,85,34,97,0,82,98,19,0,134,97,0,0,80,148,2,0,98,0,0,0,120,97,7,0,1,98,83,54,1,99,90,48,1,100,105,7,1,101,232,54,135,97,8,0,98,99,100,101,82,101,8,0,1,100,0,0,82,98,92,0,41,98,98,2,82,102,95,0,5,99,98,102,135,97,3,0,101,100,99,0,1,97,0,0,85,15,97,0,82,97,95,0,1,103,1,0,1,99,4,0,138,97,103,99,116,81,0,0,176,82,0,0,68,84,0,0,40,86,0,0,116,91,29,0], eb + 10240);
  HEAPU8.set([82,99,31,0,82,100,91,0,54,99,99,100,52,81,0,0,82,66,15,0,25,99,66,1,85,15,99,0,85,86,66,0,82,100,91,0,82,101,20,0,82,102,23,0,82,98,26,0,82,103,5,0,82,104,28,0,134,99,0,0,48,58,2,0,100,101,102,98,103,104,0,0,85,87,99,0,82,104,94,0,82,103,38,0,82,98,86,0,3,103,103,98,41,103,103,2,100,99,104,103,145,99,99,0,89,88,99,0,1,99,0,0,85,69,99,0,82,99,92,0,82,104,69,0,56,99,99,104,36,81,0,0,82,104,69,0,82,103,95,0,5,99,104,103,85,89,99,0,1,99,0,0,85,90,99,0,82,99,95,0,82,103,90,0,56,99,99,103,20,81,0,0,82,99,87,0,82,103,89,0,82,104,90,0,3,103,103,104,41,103,103,2,100,71,99,103,145,71,71,0,88,99,88,0,145,99,99,0,65,72,71,99,145,72,72,0,82,99,8,0,82,103,89,0,82,104,90,0,3,103,103,104,41,103,103,2,3,73,99,103,88,99,73,0,145,99,99,0,63,103,99,72,145,103,103,0,89,73,103,0,82,103,90,0,25,103,103,1,85,90,103,0,119,0,227,255,82,103,69,0,25,103,103,1,85,69,103,0,119,0,213,255,82,103,91,0,25,103,103,1,85,91,103,0,119,0,180,255,82,75,19,0,82,76,92,0,82,77,7,0,82,79,34,0,3,80,77,79,82,81,8,0,82,82,95,0,82,83,2,0,82,84,11,0,134,103,0,0,48,120,0,0,75,76,80,81,82,83,84,0,137,96,0,0,139,0,0,0,119,0,187,1,116,91,29,0,82,99,31,0,82,100,91,0,54,99,99,100,112,82,0,0,82,6,15,0,25,99,6,1,85,15,99,0,85,41,6,0,82,100,91,0,82,101,20,0,82,102,23,0,82,98,26,0,82,103,5,0,82,104,28,0,134,99,0,0,48,58,2,0,100,101,102,98,103,104,0,0,85,43,99,0,82,104,94,0,82,103,38,0,82,98,41,0,3,103,103,98,41,103,103,2,100,99,104,103,145,99,99,0,89,46,99,0,1,99,0,0,85,69,99,0,82,99,92,0,82,104,69,0,56,99,99,104,96,82,0,0,116,47,69,0,82,99,43,0,82,104,47,0,25,104,104,0,41,104,104,2,100,9,99,104,145,9,9,0,88,99,46,0,145,99,99,0,65,10,9,99,145,10,10,0,82,99,8,0,82,104,47,0,25,104,104,0,41,104,104,2,3,12,99,104,88,99,12,0,145,99,99,0,63,104,99,10,145,104,104,0,89,12,104,0,82,104,69,0,25,104,104,1,85,69,104,0,119,0,228,255,82,104,91,0,25,104,104,1,85,91,104,0,119,0,195,255,82,75,19,0,82,76,92,0,82,77,7,0,82,79,34,0,3,80,77,79,82,81,8,0,82,82,95,0,82,83,2,0,82,84,11,0,134,104,0,0,48,120,0,0,75,76,80,81,82,83,84,0,137,96,0,0,139,0,0,0,119,0,1,0,116,91,29,0,82,104,31,0,82,99,91,0,54,104,104,99,4,84,0,0,82,14,15,0,25,104,14,1,85,15,104,0,85,50,14,0,82,99,91,0,82,103,20,0,82,98,23,0,82,102,26,0,82,101,5,0,82,100,28,0,134,104,0,0,48,58,2,0,99,103,98,102,101,100,0,0,85,53,104,0,82,100,94,0,82,101,38,0,82,102,50,0,3,101,101,102,41,101,101,2,100,104,100,101,145,104,104,0,89,56,104,0,1,104,0,0,85,69,104,0,82,104,92,0,82,100,69,0,56,104,104,100,244,83,0,0,82,104,69,0,41,104,104,1,85,60,104,0,82,104,53,0,82,100,60,0,25,100,100,0,41,100,100,2,100,17,104,100,145,17,17,0,88,104,56,0,145,104,104,0,65,18,17,104,145,18,18,0,82,104,8,0,82,100,60,0,25,100,100,0,41,100,100,2,3,21,104,100,88,104,21,0,145,104,104,0,63,100,104,18,145,100,100,0,89,21,100,0,82,100,53,0,82,104,60,0,25,104,104,1,41,104,104,2,100,22,100,104,145,22,22,0,88,100,56,0,145,100,100,0,65,24,22,100,145,24,24,0,82,100,8,0,82,104,60,0,25,104,104,1,41,104,104,2,3,25,100,104,88,100,25,0,145,100,100,0,63,104,100,24,145,104,104,0,89,25,104,0,82,104,69,0,25,104,104,1,85,69,104,0,119,0,206,255,82,104,91,0,25,104,104,1,85,91,104,0,119,0,173,255,82,75,19,0,82,76,92,0,82,77,7,0,82,79,34,0,3,80,77,79,82,81,8,0,82,82,95,0,82,83,2,0,82,84,11,0,134,104,0,0,48,120,0,0,75,76,80,81,82,83,84,0,137,96,0,0,139,0,0,0,119,0,1,0,116,91,29,0,82,104,31,0,82,100,91,0,54,104,104,100,232,85,0,0,82,27,15,0,25,104,27,1,85,15,104,0,85,63,27,0,82,100,91,0,82,101,20,0,82,102,23,0,82,98,26,0,82,103,5,0,82,99,28,0,134,104,0,0,48,58,2,0,100,101,102,98,103,99,0,0,85,65,104,0,82,99,94,0,82,103,38,0,82,98,63,0,3,103,103,98,41,103,103,2,100,104,99,103,145,104,104,0,89,67,104,0,1,104,0,0,85,69,104,0,82,104,92,0,82,99,69,0,56,104,104,99,216,85,0,0,82,104,69,0,27,104,104,3,85,68,104,0,82,104,65,0,82,99,68,0,25,99,99,0,41,99,99,2,100,30,104,99,145,30,30,0,88,104,67,0,145,104,104,0,65,32,30,104,145,32,32,0,82,104,8,0,82,99,68,0,25,99,99,0,41,99,99,2,3,33,104,99,88,104,33,0,145,104,104,0,63,99,104,32,145,99,99,0,89,33,99,0,82,99,65,0,82,104,68,0,25,104,104,1,41,104,104,2,100,35,99,104,145,35,35,0,88,99,67,0,145,99,99,0,65,36,35,99,145,36,36,0,82,99,8,0,82,104,68,0,25,104,104,1,41,104,104,2,3,37,99,104,88,99,37,0,145,99,99,0,63,104,99,36,145,104,104,0,89,37,104,0,82,104,65,0,82,99,68,0,25,99,99,2,41,99,99,2,100,39,104,99,145,39,39,0,88,104,67,0,145,104,104,0,65,40,39,104,145,40,40,0,82,104,8,0,82,99,68,0,25,99,99,2,41,99,99,2,3,42,104,99,88,104,42,0,145,104,104,0,63,99,104,40,145,99,99,0,89,42,99,0,82,99,69,0,25,99,99,1,85,69,99,0,119,0,186,255,82,99,91,0,25,99,99,1,85,91,99,0,119,0,153,255,82,75,19,0,82,76,92,0,82,77,7,0,82,79,34,0,3,80,77,79,82,81,8,0,82,82,95,0,82,83,2,0,82,84,11,0,134,99,0,0,48,120,0,0,75,76,80,81,82,83,84,0,137,96,0,0,139,0,0,0,119,0,1,0,116,91,29,0,82,99,31,0,82,104,91,0,54,99,99,104,28,88,0,0,82,44,15,0,25,99,44,1,85,15,99,0,85,70,44,0,82,104,91,0,82,103,20,0,82,98,23,0,82,102,26,0,82,101,5,0,82,100,28,0,134,99,0,0,48,58,2,0,104,103,98,102,101,100,0,0,85,74,99,0,82,100,94,0,82,101,38,0,82,102,70,0,3,101,101,102,41,101,101,2,100,99,100,101,145,99,99,0,89,78,99,0,1,99,0,0,85,69,99,0,82,99,92,0,82,100,69,0,56,99,99,100,12,88,0,0,82,99,69,0,41,99,99,2,85,85,99,0,82,99,74,0,82,100,85,0,25,100,100,0,41,100,100,2,100,48,99,100,145,48,48,0,88,99,78,0,145,99,99,0,65,49,48,99,145,49,49,0,82,99,8,0,82,100,85,0,25,100,100,0,41,100,100,2,3,51,99,100,88,99,51,0,145,99,99,0,63,100,99,49,145,100,100,0,89,51,100,0,82,100,74,0,82,99,85,0,25,99,99,1,41,99,99,2,100,52,100,99,145,52,52,0,88,100,78,0,145,100,100,0,65,54,52,100,145,54,54,0,82,100,8,0,82,99,85,0,25,99,99,1,41,99,99,2,3,55,100,99,88,100,55,0,145,100,100,0,63,99,100,54,145,99,99,0,89,55,99,0,82,99,74,0,82,100,85,0,25,100,100,2,41,100,100,2,100,57,99,100,145,57,57,0,88,99,78,0,145,99,99,0,65,58,57,99,145,58,58,0,82,99,8,0,82,100,85,0,25,100,100,2,41,100,100,2,3,59,99,100,88,99,59,0,145,99,99,0,63,100,99,58,145,100,100,0,89,59,100,0,82,100,74,0,82,99,85,0,25,99,99,3,41,99,99,2,100,61,100,99,145,61,61,0,88,100,78,0,145,100,100,0,65,62,61,100,145,62,62,0,82,100,8,0,82,99,85,0,25,99,99,3,41,99,99,2,3,64,100,99,88,100,64,0,145,100,100,0,63,99,100,62,145,99,99,0,89,64,99,0,82,99,69,0,25,99,99,1,85,69,99,0,119,0,166,255,82,99,91,0,25,99,99,1,85,91,99,0,119,0,133,255,82,75,19,0,82,76,92,0,82,77,7,0,82,79,34,0,3,80,77,79,82,81,8,0,82,82,95,0,82,83,2,0,82,84,11,0,134,99,0,0,48,120,0,0,75,76,80,81,82,83,84,0,137,96,0,0,139,0,0,0,119,0,233,253,139,0,0,0,140,2,96,0,0,0,0,0,1,88,0,0,136,90,0,0,0,89,90,0,136,90,0,0,1,91,224,0,3,90,90,91,137,90,0,0,130,90,0,0,136,91,0,0,49,90,90,91,160,88,0,0,1,91,224,0,135,90,0,0,91,0,0,0,1,90,208,0,3,21,89,90,1,90,204,0,3,41,89,90,1,90,200,0,3,64,89,90,1,90,196,0,3,78,89,90,1,90,192,0,3,84,89,90,1,90,188,0,3,85,89,90,1,90,184,0,3,86,89,90,1,90,180,0,3,87,89,90,1,90,176,0,3,2,89,90,1,90,172,0,3,3,89,90,1,90,168,0,3,4,89,90,1,90,164,0,3,7,89,90,1,90,160,0,3,9,89,90,1,90,156,0,3,10,89,90,1,90,152,0,3,11,89,90,1,90,148,0,3,12,89,90,1,90,144,0,3,14,89,90,1,90,140,0,3,17,89,90,1,90,136,0,3,22,89,90,1,90,132,0,3,23,89,90,1,90,128,0,3,24,89,90,25,25,89,124,25,26,89,120,25,29,89,116,25,32,89,112,25,35,89,108,25,39,89,104,25,40,89,100,25,42,89,96,25,43,89,92,25,44,89,88,25,47,89,84,25,50,89,80,25,53,89,76,25,57,89,72,25,60,89,68,25,62,89,64,25,63,89,60,25,65,89,56,25,66,89,52,25,67,89,48,25,70,89,44,25,72,89,40,25,73,89,36,25,74,89,32,25,75,89,28,25,76,89,24,25,77,89,20,25,79,89,16,25,80,89,12,25,81,89,8,25,82,89,4,0,83,89,0,85,21,0,0,85,41,1,0,82,90,21,0,25,90,90,4,116,84,90,0,82,90,21,0,25,90,90,64,116,85,90,0,82,91,21,0,134,90,0,0,200,143,2,0,91,0,0,0,85,86,90,0,82,90,21,0,25,90,90,100,116,87,90,0,82,90,21,0,25,90,90,104,116,2,90,0,82,90,21,0,1,91,128,0,3,90,90,91,116,3,90,0,82,90,21,0,1,91,144,0,3,90,90,91,116,4,90,0,82,90,84,0,82,91,4,0,41,91,91,1,3,90,90,91,85,7,90,0,82,91,21,0,134,90,0,0,28,149,2,0,91,0,0,0,121,90,7,0,1,91,10,52,1,92,90,48,1,93,0,6,1,94,51,52,135,90,8,0,91,92,93,94,82,90,85,0,1,94,1,0,1,95,4,0,138,90,94,95,88,92,0,0,212,93,0,0,176,95,0,0,220,97,0,0,1,93,0,0,85,64,93,0,82,93,7,0,82,92,64,0,49,93,93,92,180,90,0,0,1,88,47,0,119,0,92,0,82,93,87,0,82,92,64,0,41,92,92,3,3,93,93,92,116,74,93,0,82,93,87,0,82,92,64,0,41,92,92,3,3,93,93,92,25,93,93,4,116,75,93,0,82,93,64,0,82,92,4,0,4,93,93,92,85,76,93,0,82,92,76,0,82,94,85,0,5,93,92,94,85,77,93,0,116,79,75,0,82,94,3,0,82,92,64,0,5,93,94,92,85,80,93,0,116,78,74,0,82,93,79,0,82,92,78,0,54,93,93,92,16,92,0,0,82,92,78,0,82,94,85,0,5,93,92,94,85,82,93,0,82,94,2,0,82,92,80,0,82,91,78,0,3,92,92,91,82,91,74,0,4,92,92,91,41,92,92,2,100,93,94,92,145,93,93,0,89,83,93,0,88,93,83,0,145,93,93,0,59,94,0,0,145,94,94,0,70,93,93,94,120,93,3,0,1,88,41,0,119,0,41,0,1,93,0,0,85,81,93,0,82,93,85,0,82,94,81,0,56,93,93,94,0,92,0,0,82,93,86,0,82,94,77,0,82,92,81,0,3,94,94,92,41,94,94,2,100,68,93,94,145,68,68,0,88,93,83,0,145,93,93,0,65,69,68,93,145,69,69,0,82,93,41,0,82,94,82,0,82,92,81,0,3,94,94,92,41,94,94,2,3,71,93,94,88,93,71,0,145,93,93,0,63,94,93,69,145,94,94,0,89,71,94,0,82,94,81,0,25,94,94,1,85,81,94,0,119,0,227,255,82,94,78,0,25,94,94,1,85,78,94,0,119,0,195,255,82,94,64,0,25,94,94,1,85,64,94,0,119,0,160,255,32,94,88,41,121,94,8,0,1,93,89,52,1,92,90,48,1,91,109,6,1,95,51,52,135,94,8,0,93,92,91,95,119,0,6,2,32,94,88,47,121,94,4,2,137,89,0,0,139,0,0,0,119,0,1,2,1,94,0,0,85,64,94,0,82,94,7,0,82,93,64,0,49,94,94,93,120,92,0,0,1,88,47,0,119,0,74,0,82,94,87,0,82,93,64,0,41,93,93,3,3,94,94,93,116,9,94,0,82,94,87,0,82,93,64,0,41,93,93,3,3,94,94,93,25,94,94,4,116,10,94,0,82,94,64,0,82,93,4,0,4,94,94,93,85,11,94,0,116,12,11,0,116,14,10,0,82,93,3,0,82,92,64,0,5,94,93,92,85,17,94,0,116,78,9,0,82,94,14,0,82,92,78,0,54,94,94,92,140,93,0,0,116,22,78,0,82,92,2,0,82,93,17,0,82,91,78,0,3,93,93,91,82,91,9,0,4,93,93,91,41,93,93,2,100,94,92,93,145,94,94,0,89,23,94,0,88,94,23,0,145,94,94,0,59,92,0,0,145,92,92,0,70,94,94,92,120,94,3,0,1,88,9,0,119,0,29,0,82,94,86,0,82,92,12,0,25,92,92,0,41,92,92,2,100,5,94,92,145,5,5,0,88,94,23,0,145,94,94,0,65,6,5,94,145,6,6,0,82,94,41,0,82,92,22,0,25,92,92,0,41,92,92,2,3,8,94,92,88,94,8,0,145,94,94,0,63,92,94,6,145,92,92,0,89,8,92,0,82,92,78,0,25,92,92,1,85,78,92,0,119,0,210,255,82,92,64,0,25,92,92,1,85,64,92,0,119,0,178,255,32,92,88,9,121,92,8,0,1,94,89,52,1,93,90,48,1,91,18,6,1,95,51,52,135,92,8,0,94,93,91,95,119,0,167,1,32,92,88,47,121,92,165,1,137,89,0,0,139,0,0,0,119,0,162,1,1,92,0,0,85,64,92,0,82,92,7,0,82,95,64,0,49,92,92,95,244,93,0,0,1,88,47,0,119,0,98,0,82,92,87,0,82,95,64,0,41,95,95,3,3,92,92,95,116,24,92,0,82,92,87,0,82,95,64,0,41,95,95,3,3,92,92,95,25,92,92,4,116,25,92,0,82,92,64,0,82,95,4,0,4,92,92,95,85,26,92,0,82,92,26,0,41,92,92,1,85,29,92,0,116,32,25,0,82,95,3,0,82,91,64,0,5,92,95,91,85,35,92,0,116,78,24,0,82,92,32,0,82,91,78,0,54,92,92,91,104,95,0,0,82,92,78,0,41,92,92,1,85,39,92,0,82,91,2,0,82,95,35,0,82,93,78,0,3,95,95,93,82,93,24,0,4,95,95,93,41,95,95,2,100,92,91,95,145,92,92,0,89,40,92,0,88,92,40,0,145,92,92,0,59,91,0,0,145,91,91,0,70,92,92,91,120,92,3,0,1,88,17,0,119,0,49,0,82,92,86,0,82,91,29,0,25,91,91,0,41,91,91,2,100,13,92,91,145,13,13,0,88,92,40,0,145,92,92,0,65,15,13,92,145,15,15,0,82,92,41,0,82,91,39,0,25,91,91,0,41,91,91,2,3,16,92,91,88,92,16,0,145,92,92,0,63,91,92,15,145,91,91,0,89,16,91,0,82,91,86,0,82,92,29,0,25,92,92,1,41,92,92,2,100,18,91,92,145,18,18,0,88,91,40,0,145,91,91,0,65,19,18,91,145,19,19,0,82,91,41,0,82,92,39,0,25,92,92,1,41,92,92,2,3,20,91,92,88,91,20,0,145,91,91,0,63,92,91,19,145,92,92,0,89,20,92,0,82,92,78,0,25,92,92,1,85,78,92,0,119,0,188,255,82,92,64,0,25,92,92,1,85,64,92,0,119,0,154,255,32,92,88,17,121,92,8,0,1,91,89,52,1,95,90,48,1,93,39,6,1,94,51,52,135,92,8,0,91,95,93,94,119,0,48,1,32,92,88,47,121,92,46,1,137,89,0,0,139,0,0,0,119,0,43,1,1,92,0,0,85,64,92,0,82,92,7,0,82,94,64,0,49,92,92,94,208,95,0,0,1,88,47,0,119,0,118,0,82,92,87,0,82,94,64,0,41,94,94,3,3,92,92,94,116,42,92,0,82,92,87,0,82,94,64,0,41,94,94,3,3,92,92,94,25,92,92,4,116,43,92,0,82,92,64,0,82,94,4,0,4,92,92,94,85,44,92,0,82,92,44,0,27,92,92,3,85,47,92,0,116,50,43,0,82,94,3,0,82,93,64,0,5,92,94,93,85,53,92,0,116,78,42,0,82,92,50,0,82,93,78,0,54,92,92,93,148,97,0,0,82,92,78,0,27,92,92,3,85,57,92,0,82,93,2,0,82,94,53,0,82,95,78,0,3,94,94,95,82,95,42,0,4,94,94,95,41,94,94,2,100,92,93,94,145,92,92,0,89,60,92,0,88,92,60,0,145,92,92,0,59,93,0,0,145,93,93,0,70,92,92,93,120,92,3,0,1,88,25,0,119,0,69,0,82,92,86,0,82,93,47,0,25,93,93,0,41,93,93,2,100,27,92,93,145,27,27,0,88,92,60,0,145,92,92,0,65,28,27,92,145,28,28,0,82,92,41,0,82,93,57,0,25,93,93,0,41,93,93,2,3,30,92,93,88,92,30,0,145,92,92,0,63,93,92,28,145,93,93,0,89,30,93,0,82,93,86,0,82,92,47,0,25,92,92,1,41,92,92,2,100,31,93,92,145,31,31,0,88,93,60,0,145,93,93,0,65,33,31,93,145,33,33,0,82,93,41,0,82,92,57,0,25,92,92,1,41,92,92,2,3,34,93,92,88,93,34,0,145,93,93,0,63,92,93,33,145,92,92,0,89,34,92,0,82,92,86,0,82,93,47,0,25,93,93,2,41,93,93,2,100,36,92,93,145,36,36,0,88,92,60,0,145,92,92,0,65,37,36,92,145,37,37,0,82,92,41,0,82,93,57,0,25,93,93,2,41,93,93,2,3,38,92,93,88,92,38,0,145,92,92,0,63,93,92,37,145,93,93,0,89,38,93,0,82,93,78,0,25,93,93,1,85,78,93,0,119,0,168,255,82,93,64,0,25,93,93,1,85,64,93,0,119,0,134,255,32,93,88,25,121,93,8,0,1,92,89,52,1,94,90,48,1,95,61,6,1,91,51,52,135,93,8,0,92,94,95,91,119,0,165,0,32,93,88,47,121,93,163,0,137,89,0,0,139,0,0,0,119,0,160,0,1,93,0,0,85,64,93,0,82,93,7,0,82,91,64,0,49,93,93,91,252,97,0,0,1,88,47,0,119,0,138,0,82,93,87,0,82,91,64,0,41,91,91,3,3,93,93,91,116,62,93,0,82,93,87,0,82,91,64,0,41,91,91,3,3,93,93,91,25,93,93,4,116,63,93,0,82,93,64,0,82,91,4,0,4,93,93,91,85,65,93,0,82,93,65,0,41,93,93,2,85,66,93,0,116,67,63,0,82,91,3,0,82,95,64,0,5,93,91,95,85,70,93,0,116,78,62,0,82,93,67,0,82,95,78,0,54,93,93,95,16,100,0,0,82,93,78,0,41,93,93,2,85,72,93,0,82,95,2,0,82,91,70,0,82,94,78,0,3,91,91,94,82,94,62,0,4,91,91,94,41,91,91,2,100,93,95,91,145,93,93,0,89,73,93,0,88,93,73,0,145,93,93,0,59,95,0,0,145,95,95,0,70,93,93,95,120,93,3,0,1,88,33,0,119,0,89,0,82,93,86,0,82,95,66,0,25,95,95,0,41,95,95,2,100,45,93,95,145,45,45,0,88,93,73,0,145,93,93,0,65,46,45,93,145,46,46,0,82,93,41,0,82,95,72,0,25,95,95,0,41,95,95,2,3,48,93,95,88,93,48,0,145,93,93,0,63,95,93,46,145,95,95,0,89,48,95,0,82,95,86,0,82,93,66,0,25,93,93,1,41,93,93,2,100,49,95,93,145,49,49,0,88,95,73,0,145,95,95,0,65,51,49,95,145,51,51,0,82,95,41,0,82,93,72,0,25,93,93,1,41,93,93,2,3,52,95,93,88,95,52,0,145,95,95,0,63,93,95,51,145,93,93,0,89,52,93,0,82,93,86,0,82,95,66,0,25,95,95,2,41,95,95,2,100,54,93,95,145,54,54,0,88,93,73,0,145,93,93,0,65,55,54,93,145,55,55,0,82,93,41,0,82,95,72,0,25,95,95,2,41,95,95,2,3,56,93,95,88,93,56,0,145,93,93,0,63,95,93,55,145,95,95,0,89,56,95,0,82,95,86,0,82,93,66,0,25,93,93,3,41,93,93,2,100,58,95,93,145,58,58,0,88,95,73,0,145,95,95,0,65,59,58,95,145,59,59,0,82,95,41,0,82,93,72,0,25,93,93,3,41,93,93,2,3,61,95,93,88,95,61,0,145,95,95,0,63,93,95,59,145,93,93,0,89,61,93,0,82,93,78,0,25,93,93,1,85,78,93,0,119,0,148,255,82,93,64,0,25,93,93,1,85,64,93,0,119,0,114,255,32,93,88,33,121,93,8,0,1,95,89,52,1,91,90,48,1,94,84,6,1,92,51,52,135,93,8,0,95,91,94,92,119,0,6,0,32,93,88,47,121,93,4,0,137,89,0,0,139,0,0,0,119,0,1,0,139,0,0,0,140,2,123,0,0,0,0,0,2,113,0,0,173,29,0,0,2,114,0,0,176,29,0,0,2,115,0,0,172,29,0,0,2,116,0,0,0,1,0,0,2,117,0,0,224,119,0,0,2,118,0,0,216,118,0,0,2,119,0,0,177,29,0,0,3,61,0,1,106,91,0,4,38,120,91,1,120,120,218,0,82,105,0,0,38,120,91,3,120,120,2,0,139,0,0,0,1,120,0,0,4,120,120,105,3,30,0,120,3,34,105,1,1,120,192,118,82,36,120,0,48,120,30,36,224,100,0,0,135,120,9,0,1,120,196,118,82,120,120,0,45,120,120,30,48,101,0,0,25,27,61,4,82,28,27,0,38,120,28,3,33,120,120,3,121,120,4,0,0,7,30,0,0,8,34,0,119,0,195,0,1,120,184,118,85,120,34,0,38,120,28,254,85,27,120,0,39,121,34,1,109,30,4,121,85,61,34,0,139,0,0,0,43,121,105,3,0,49,121,0,48,121,105,116,248,101,0,0,106,62,30,8,106,66,30,12,41,121,49,1,41,121,121,2,3,73,118,121,46,121,62,73,120,101,0,0,48,121,62,36,104,101,0,0,135,121,9,0,106,121,62,12,46,121,121,30,120,101,0,0,135,121,9,0,45,121,66,62,172,101,0,0,1,121,176,118,1,120,176,118,82,120,120,0,1,122,1,0,22,122,122,49,11,122,122,0,19,120,120,122,85,121,120,0,0,7,30,0,0,8,34,0,119,0,156,0,45,120,66,73,188,101,0,0,25,25,66,8,119,0,11,0,48,120,66,36,200,101,0,0,135,120,9,0,25,90,66,8,82,120,90,0,45,120,120,30,224,101,0,0,0,25,90,0,119,0,2,0,135,120,9,0,109,62,12,66,85,25,62,0,0,7,30,0,0,8,34,0,119,0,137,0,106,92,30,24,106,93,30,12,45,120,93,30,160,102,0,0,25,97,30,16,25,98,97,4,82,99,98,0,120,99,8,0,82,100,97,0,120,100,3,0,1,22,0,0,119,0,49,0,0,11,100,0,0,14,97,0,119,0,3,0,0,11,99,0,0,14,98,0,0,9,11,0,0,12,14,0,25,101,9,20,82,102,101,0,120,102,8,0,25,103,9,16,82,104,103,0,120,104,2,0,119,0,9,0,0,10,104,0,0,13,103,0,119,0,3,0,0,10,102,0,0,13,101,0,0,9,10,0,0,12,13,0,119,0,242,255,48,120,12,36,144,102,0,0,135,120,9,0,119,0,23,0,1,120,0,0,85,12,120,0,0,22,9,0,119,0,19,0,106,94,30,8,48,120,94,36,176,102,0,0,135,120,9,0,25,95,94,12,82,120,95,0,46,120,120,30,196,102,0,0,135,120,9,0,25,96,93,8,82,120,96,0,45,120,120,30,228,102,0,0,85,95,93,0,85,96,94,0,0,22,93,0,119,0,2,0,135,120,9,0,120,92,4,0,0,7,30,0,0,8,34,0,119,0,73,0,106,106,30,28,41,120,106,2,3,107,117,120,82,120,107,0,45,120,120,30,68,103,0,0,85,107,22,0,120,22,31,0,1,120,180,118,1,121,180,118,82,121,121,0,1,122,1,0,22,122,122,106,11,122,122,0,19,121,121,122,85,120,121,0,0,7,30,0,0,8,34,0,119,0,54,0,1,121,192,118,82,121,121,0,48,121,92,121,92,103,0,0,135,121,9,0,119,0,14,0,25,108,92,16,82,120,108,0,45,120,120,30,116,103,0,0,0,121,108,0,119,0,3,0,25,120,92,20,0,121,120,0,85,121,22,0,120,22,4,0,0,7,30,0,0,8,34,0,119,0,35,0,1,121,192,118,82,109,121,0,48,121,22,109,164,103,0,0,135,121,9,0,109,22,24,92,25,110,30,16,82,111,110,0,121,111,8,0,48,121,111,109,196,103,0,0,135,121,9,0,119,0,4,0,109,22,16,111,109,111,24,22,119,0,1,0,106,112,110,4,120,112,4,0,0,7,30,0,0,8,34,0,119,0,14,0,1,121,192,118,82,121,121,0,48,121,112,121,252,103,0,0,135,121,9,0,119,0,8,0,109,22,20,112,109,112,24,22,0,7,30,0,0,8,34,0,119,0,3,0,0,7,0,0,0,8,1,0,1,121,192,118,82,29,121,0,48,121,61,29,44,104,0,0,135,121,9,0,25,31,61,4,82,32,31,0,38,121,32,2,120,121,224,0,1,121,200,118,82,121,121,0,45,121,121,61,160,104,0,0,1,121,188,118,82,121,121,0,3,33,121,8,1,121,188,118,85,121,33,0,1,121,200,118,85,121,7,0,39,120,33,1,109,7,4,120,1,120,196,118,82,120,120,0,46,120,7,120,132,104,0,0,139,0,0,0,1,120,196,118,1,121,0,0,85,120,121,0,1,121,184,118,1,120,0,0,85,121,120,0,139,0,0,0,1,120,196,118,82,120,120,0,45,120,120,61,220,104,0,0,1,120,184,118,82,120,120,0,3,35,120,8,1,120,184,118,85,120,35,0,1,120,196,118,85,120,7,0,39,121,35,1,109,7,4,121,97,7,35,35,139,0,0,0,38,121,32,248,3,37,121,8,43,121,32,3,0,38,121,0,48,121,32,116,156,105,0,0,106,39,61,8,106,40,61,12,41,121,38,1,41,121,121,2,3,41,118,121,46,121,39,41,44,105,0,0,48,121,39,29,28,105,0,0,135,121,9,0,106,121,39,12,46,121,121,61,44,105,0,0,135,121,9,0,45,121,40,39,88,105,0,0,1,121,176,118,1,120,176,118,82,120,120,0,1,122,1,0,22,122,122,38,11,122,122,0,19,120,120,122,85,121,120,0,119,0,140,0,45,120,40,41,104,105,0,0,25,24,40,8,119,0,11,0,48,120,40,29,116,105,0,0,135,120,9,0,25,42,40,8,82,120,42,0,45,120,120,61,140,105,0,0,0,24,42,0,119,0,2,0,135,120,9,0,109,39,12,40,85,24,39,0,119,0,123,0,106,43,61,24,106,44,61,12,45,120,44,61,68,106,0,0,25,48,61,16,25,50,48,4,82,51,50,0,120,51,8,0,82,52,48,0,120,52,3,0,1,23,0,0,119,0,49,0,0,17,52,0,0,20,48,0,119,0,3,0,0,17,51,0,0,20,50,0,0,15,17,0,0,18,20,0,25,53,15,20,82,54,53,0,120,54,8,0,25,55,15,16,82,56,55,0,120,56,2,0,119,0,9,0,0,16,56,0,0,19,55,0,119,0,3,0,0,16,54,0,0,19,53,0,0,15,16,0,0,18,19,0,119,0,242,255,48,120,18,29,52,106,0,0,135,120,9,0,119,0,23,0,1,120,0,0,85,18,120,0,0,23,15,0,119,0,19,0,106,45,61,8,48,120,45,29,84,106,0,0,135,120,9,0,25,46,45,12,82,120,46,0,46,120,120,61,104,106,0,0,135,120,9,0,25,47,44,8,82,120,47,0,45,120,120,61,136,106,0,0,85,46,44,0,85,47,45,0,0,23,44,0,119,0,2,0,135,120,9,0,121,43,62,0,106,57,61,28,41,120,57,2,3,58,117,120,82,120,58,0,45,120,120,61,212,106,0,0,85,58,23,0,120,23,27,0,1,120,180,118,1,121,180,118,82,121,121,0,1,122,1,0,22,122,122,57,11,122,122,0,19,121,121,122,85,120,121,0,119,0,45,0,1,121,192,118,82,121,121,0,48,121,43,121,236,106,0,0,135,121,9,0,119,0,12,0,25,59,43,16,82,120,59,0,45,120,120,61,4,107,0,0,0,121,59,0,119,0,3,0,25,120,43,20,0,121,120,0,85,121,23,0,120,23,2,0,119,0,28,0,1,121,192,118,82,60,121,0,48,121,23,60,44,107,0,0,135,121,9,0,109,23,24,43,25,63,61,16,82,64,63,0,121,64,8,0,48,121,64,60,76,107,0,0,135,121,9,0,119,0,4,0,109,23,16,64,109,64,24,23,119,0,1,0,106,65,63,4,121,65,10,0,1,121,192,118,82,121,121,0,48,121,65,121,120,107,0,0,135,121,9,0,119,0,4,0,109,23,20,65,109,65,24,23,119,0,1,0,39,120,37,1,109,7,4,120,97,7,37,37,1,120,196,118,82,120,120,0,45,120,7,120,176,107,0,0,1,120,184,118,85,120,37,0,139,0,0,0,119,0,9,0,0,21,37,0,119,0,7,0,38,120,32,254,85,31,120,0,39,121,8,1,109,7,4,121,97,7,8,8,0,21,8,0,43,121,21,3,0,67,121,0,48,121,21,116,92,108,0,0,41,121,67,1,41,121,121,2,3,68,118,121,1,121,176,118,82,69,121,0,1,121,1,0,22,121,121,67,0,70,121,0,19,121,69,70,120,121,7,0,1,121,176,118,20,120,69,70,85,121,120,0,0,6,68,0,25,26,68,8,119,0,11,0,25,71,68,8,82,72,71,0,1,120,192,118,82,120,120,0,48,120,72,120,64,108,0,0,135,120,9,0,119,0,3,0,0,6,72,0,0,26,71,0,85,26,7,0,109,6,12,7,109,7,8,6,109,7,12,68,139,0,0,0,43,120,21,8,0,74,120,0,120,74,3,0,1,5,0,0,119,0,42,0,2,120,0,0,255,255,255,0,48,120,120,21,136,108,0,0,1,5,31,0,119,0,36,0,2,120,0,0,0,255,15,0,3,120,74,120,43,120,120,16,38,120,120,8,0,75,120,0,22,120,74,75,0,76,120,0,2,120,0,0,0,240,7,0,3,120,76,120,43,120,120,16,38,120,120,4,0,77,120,0,22,120,76,77,0,78,120,0,2,120,0,0,0,192,3,0,3,120,78,120,43,120,120,16,38,120,120,2,0,79,120,0,1,120,14,0,20,121,77,75,20,121,121,79,4,120,120,121,22,121,78,79,43,121,121,15,3,80,120,121,25,121,80,7,24,121,21,121,38,121,121,1,41,120,80,1,20,121,121,120,0,5,121,0,41,121,5,2,3,81,117,121,109,7,28,5,1,120,0,0,109,7,20,120,1,121,0,0,109,7,16,121,1,121,180,118,82,82,121,0,1,121,1,0,22,121,121,5,0,83,121,0,19,121,82,83,120,121,9,0,1,121,180,118,20,120,82,83,85,121,120,0,85,81,7,0,109,7,24,81,109,7,12,7,109,7,8,7,139,0,0,0,82,84,81,0,106,120,84,4,38,120,120,248,45,120,120,21,136,109,0,0,0,3,84,0,119,0,40,0,32,121,5,31,121,121,4,0,1,121,0,0,0,120,121,0,119,0,5,0,1,121,25,0,43,122,5,1,4,121,121,122,0,120,121,0,22,120,21,120,0,2,120,0,0,4,84,0,25,120,4,16,43,121,2,31,41,121,121,2,3,86,120,121,82,85,86,0,120,85,2,0,119,0,11,0,106,121,85,4,38,121,121,248,45,121,121,21,236,109,0,0,0,3,85,0,119,0,15,0,41,121,2,1,0,2,121,0,0,4,85,0,119,0,240,255,1,121,192,118,82,121,121,0,48,121,86,121,16,110,0,0,135,121,9,0,85,86,7,0,109,7,24,4,109,7,12,7,109,7,8,7,139,0,0,0,25,87,3,8,82,88,87,0,1,121,192,118,82,89,121,0,18,121,89,88,18,120,89,3,19,121,121,120,120,121,2,0,135,121,9,0,109,88,12,7,85,87,7,0,109,7,8,88,109,7,12,3,1,120,0,0,109,7,24,120,139,0,0,0,140,9,114,0,0,0,0,0,136,105,0,0,0,100,105,0,136,105,0,0,1,106,160,0,3,105,105,106,137,105,0,0,130,105,0,0,136,106,0,0,49,105,105,106,160,110,0,0,1,106,160,0,135,105,0,0,106,0,0,0,1,105,152,0,3,98,100,105,1,105,148,0,3,9,100,105,1,105,144,0,3,10,100,105,1,105,140,0,3,12,100,105,1,105,136,0,3,13,100,105,1,105,132,0,3,14,100,105,1,105,128,0,3,16,100,105,1,105,156,0,3,17,100,105,25,19,100,124,25,20,100,120,25,22,100,116,25,24,100,112,25,25,100,108,25,27,100,104,25,30,100,100,25,31,100,96,25,36,100,92,25,38,100,16,25,42,100,8,0,44,100,0,25,48,100,88,25,51,100,84,25,56,100,80,25,60,100,76,25,64,100,72,25,68,100,68,25,72,100,64,25,77,100,60,25,81,100,56,25,85,100,52,25,88,100,48,25,89,100,44,25,90,100,40,25,91,100,36,25,92,100,32,25,93,100,28,25,94,100,24,85,98,0,0,85,9,1,0,85,10,2,0,85,12,3,0,85,13,4,0,85,14,5,0,85,16,6,0,38,105,7,1,83,17,105,0,85,19,8,0,82,106,9,0,32,106,106,0,121,106,4,0,1,106,1,0,0,105,106,0,119,0,5,0,82,106,12,0,82,107,10,0,17,106,106,107,0,105,106,0,121,105,3,0,137,100,0,0,139,0,0,0,82,105,12,0,82,106,10,0,25,106,106,1,46,105,105,106,156,114,0,0,1,105,255,0,85,51,105,0,1,105,0,0,85,56,105,0,1,105,255,0,85,60,105,0,1,105,0,0,85,64,105,0,1,105,255,0,85,68,105,0,1,105,0,0,85,72,105,0,1,105,0,0,85,77,105,0,82,105,9,0,82,106,77,0,56,105,105,106,220,112,0,0,82,105,98,0,82,106,77,0,41,106,106,2,25,106,106,0,91,105,105,106,85,81,105,0,82,105,98,0,82,106,77,0,41,106,106,2,25,106,106,1,91,105,105,106,85,85,105,0,82,105,98,0,82,106,77,0,41,106,106,2,25,106,106,2,91,105,105,106,85,88,105,0,82,105,56,0,82,106,81,0,47,105,105,106,104,112,0,0,116,56,81,0,82,105,81,0,82,106,51,0,47,105,105,106,124,112,0,0,116,51,81,0,82,105,64,0,82,106,85,0,47,105,105,106,144,112,0,0,116,64,85,0,82,105,85,0,82,106,60,0,47,105,105,106,164,112,0,0,116,60,85,0,82,105,72,0,82,106,88,0,47,105,105,106,184,112,0,0,116,72,88,0,82,105,88,0,82,106,68,0,47,105,105,106,204,112,0,0,116,68,88,0,82,105,77,0,25,105,105,1,85,77,105,0,119,0,201,255,82,105,56,0,82,106,51,0,4,105,105,106,85,89,105,0,82,105,64,0,82,106,60,0,4,105,105,106,85,90,105,0,82,105,72,0,82,106,68,0,4,105,105,106,85,91,105,0,1,105,1,0,85,92,105,0,82,106,90,0,82,107,91,0,15,106,106,107,1,107,2,0,1,108,1,0,125,105,106,107,108,0,0,0,85,92,105,0,82,105,91,0,82,108,89,0,47,105,105,108,92,113,0,0,82,105,90,0,82,108,89,0,47,105,105,108,92,113,0,0,1,105,0,0,85,92,105,0,82,105,9,0,82,108,13,0,82,107,10,0,4,108,108,107,5,95,105,108,82,108,12,0,82,105,10,0,4,108,108,105,6,108,95,108,85,93,108,0,82,108,9,0,82,105,93,0,4,108,108,105,85,94,108,0,82,105,98,0,1,107,0,0,82,106,9,0,82,109,92,0,82,110,93,0,134,108,0,0,144,19,2,0,105,107,106,109,110,0,0,0,82,108,19,0,1,110,4,3,3,108,108,110,82,110,16,0,82,109,92,0,95,108,110,109,82,109,19,0,1,110,3,4,3,109,109,110,82,110,16,0,82,108,98,0,82,106,93,0,41,106,106,2,82,107,92,0,3,106,106,107,90,108,108,106,95,109,110,108,82,101,13,0,82,102,14,0,82,110,98,0,82,109,93,0,82,106,10,0,4,107,101,102,28,105,102,2,82,111,16,0,41,111,111,1,78,112,17,0,38,112,112,1,82,113,19,0,134,108,0,0,100,110,0,0,110,109,106,101,107,105,111,112,113,0,0,0,82,103,13,0,82,104,14,0,82,113,98,0,82,112,93,0,41,112,112,2,3,113,113,112,82,112,94,0,82,111,12,0,3,105,103,104,28,107,104,2,82,106,16,0,41,106,106,1,25,106,106,1,78,109,17,0,38,109,109,1,82,110,19,0,134,108,0,0,100,110,0,0,113,112,103,111,105,107,106,109,110,0,0,0,137,100,0,0,139,0,0,0,78,108,17,0,38,108,108,1,121,108,176,0,82,108,10,0,32,108,108,1,121,108,83,0,1,108,255,0,85,20,108,0,1,108,255,0,85,22,108,0,1,108,255,0,85,24,108,0,1,108,0,0,85,25,108,0,82,96,20,0,82,108,9,0,82,110,25,0,56,108,108,110,180,115,0,0,82,108,98,0,82,110,25,0,41,110,110,2,25,110,110,0,91,108,108,110,48,108,96,108,12,115,0,0,82,97,20,0,119,0,6,0,82,108,98,0,82,110,25,0,41,110,110,2,25,110,110,0,91,97,108,110,85,20,97,0,82,108,22,0,82,110,98,0,82,109,25,0,41,109,109,2,25,109,109,1,91,110,110,109,48,108,108,110,76,115,0,0,82,99,22,0,119,0,6,0,82,108,98,0,82,110,25,0,41,110,110,2,25,110,110,1,91,99,108,110,85,22,99,0,82,108,24,0,82,110,98,0,82,109,25,0,41,109,109,2,25,109,109,2,91,110,110,109,48,108,108,110,140,115,0,0,82,11,24,0,119,0,6,0,82,108,98,0,82,110,25,0,41,110,110,2,25,110,110,2,91,11,108,110,85,24,11,0,82,108,25,0,25,108,108,1,85,25,108,0,119,0,201,255,82,108,19,0,25,108,108,4,82,110,10,0,95,108,110,96,82,110,19,0,1,108,4,1,3,110,110,108,82,108,10,0,82,109,22,0,95,110,108,109,82,109,19,0,1,108,4,2,3,109,109,108,82,108,10,0,82,110,24,0,95,109,108,110,137,100,0,0,139,0,0,0,82,110,10,0,1,108,1,0,82,109,19,0,82,109,109,0,22,108,108,109,26,108,108,1,45,110,110,108,100,117,0,0,1,110,0,0,85,27,110,0,1,110,0,0,85,30,110,0,1,110,0,0,85,31,110,0,1,110,0,0,85,36,110,0,82,15,27,0,82,110,9,0,82,108,36,0,56,110,110,108,28,117,0,0,82,110,98,0,82,108,36,0,41,108,108,2,25,108,108,0,91,110,110,108,48,110,110,15,116,116,0,0,82,18,27,0,119,0,6,0,82,110,98,0,82,108,36,0,41,108,108,2,25,108,108,0,91,18,110,108,85,27,18,0,82,110,98,0,82,108,36,0,41,108,108,2,25,108,108,1,91,110,110,108,82,108,30,0,48,110,110,108,180,116,0,0,82,21,30,0,119,0,6,0,82,110,98,0,82,108,36,0,41,108,108,2,25,108,108,1,91,21,110,108,85,30,21,0,82,110,98,0,82,108,36,0,41,108,108,2,25,108,108,2,91,110,110,108,82,108,31,0,48,110,110,108,244,116,0,0,82,23,31,0,119,0,6,0,82,110,98,0,82,108,36,0,41,108,108,2,25,108,108,2,91,23,110,108,85,31,23,0,82,110,36,0,25,110,110,1,85,36,110,0,119,0,201,255,82,110,19,0,25,110,110,4,82,108,10,0,95,110,108,15,82,108,19,0,1,110,4,1,3,108,108,110,82,110,10,0,82,109,30,0,95,108,110,109,82,109,19,0,1,110,4,2,3,109,109,110,82,110,10,0,82,108,31,0,95,109,110,108,137,100,0,0,139,0,0,0,0,26,38,0,1,108,0,0,85,26,108,0,1,110,0,0,109,26,4,110,0,28,42,0,1,110,0,0,85,28,110,0,1,108,0,0,109,28,4,108,0,29,44,0,1,108,0,0,85,29,108,0,1,110,0,0,109,29,4,110,1,110,0,0,85,48,110,0,82,110,9,0,82,108,48,0,56,110,110,108,136,118,0,0,0,32,38,0,82,110,32,0,106,108,32,4,82,109,98,0,82,106,48,0,41,106,106,2,25,106,106,0,91,109,109,106,1,106,0,0,134,33,0,0,240,153,2,0,110,108,109,106,135,34,1,0,0,35,38,0,85,35,33,0,109,35,4,34,0,37,42,0,82,106,37,0,106,109,37,4,82,108,98,0,82,110,48,0,41,110,110,2,25,110,110,1,91,108,108,110,1,110,0,0,134,39,0,0,240,153,2,0,106,109,108,110,135,40,1,0,0,41,42,0,85,41,39,0,109,41,4,40,0,43,44,0,82,110,43,0,106,108,43,4,82,109,98,0,82,106,48,0,41,106,106,2,25,106,106,2,91,109,109,106,1,106,0,0,134,45,0,0,240,153,2,0,110,108,109,106,135,46,1,0,0,47,44,0,85,47,45,0,109,47,4,46,82,106,48,0,25,106,106,1,85,48,106,0,119,0,201,255,82,106,9,0,28,49,106,2,0,50,38,0,82,106,50,0,106,109,50,4,34,108,49,0,41,108,108,31,42,108,108,31,134,52,0,0,240,153,2,0,106,109,49,108,135,53,1,0,0,54,38,0,85,54,52,0,109,54,4,53,82,108,9,0,28,55,108,2,0,57,42,0,82,108,57,0,106,109,57,4,34,106,55,0,41,106,106,31,42,106,106,31,134,58,0,0,240,153,2,0,108,109,55,106,135,59,1,0,0,61,42,0,85,61,58,0,109,61,4,59,82,106,9,0,28,62,106,2,0,63,44,0,82,106,63,0,106,109,63,4,34,108,62,0,41,108,108,31,42,108,108,31,134,65,0,0,240,153,2,0,106,109,62,108,135,66,1,0,0,67,44,0,85,67,65,0,109,67,4,66,82,69,9,0,0,70,38,0,82,108,70,0,106,109,70,4,34,106,69,0,41,106,106,31,42,106,106,31,134,71,0,0,180,154,2,0,108,109,69,106,135,73,1,0,0,74,38,0,85,74,71,0,109,74,4,73,82,75,9,0,0,76,42,0,82,106,76,0,106,109,76,4,34,108,75,0,41,108,108,31,42,108,108,31,134,78,0,0,180,154,2,0,106,109,75,108,135,79,1,0,0,80,42,0,85,80,78,0,109,80,4,79,82,82,9,0,0,83,44,0,82,108,83,0,106,109,83,4,34,106,82,0,41,106,106,31,42,106,106,31,134,84,0,0,180,154,2,0,108,109,82,106,135,86,1,0,0,87,44,0,85,87,84,0,109,87,4,86,82,106,19,0,25,106,106,4,82,109,10,0,82,108,38,0,95,106,109,108,82,108,19,0,1,109,4,1], eb + 20480);
  HEAPU8.set([3,108,108,109,82,109,10,0,82,106,42,0,95,108,109,106,82,106,19,0,1,109,4,2,3,106,106,109,82,109,10,0,82,108,44,0,95,106,109,108,137,100,0,0,139,0,0,0,140,7,65,0,0,0,0,0,2,56,0,0,255,255,0,0,2,57,0,0,255,0,0,0,1,54,0,0,136,58,0,0,0,55,58,0,136,58,0,0,1,59,0,1,3,58,58,59,137,58,0,0,130,58,0,0,136,59,0,0,49,58,58,59,128,120,0,0,1,59,0,1,135,58,0,0,59,0,0,0,1,58,240,0,3,48,55,58,1,58,236,0,3,50,55,58,1,58,232,0,3,52,55,58,1,58,228,0,3,7,55,58,1,58,224,0,3,8,55,58,1,58,220,0,3,10,55,58,1,58,216,0,3,11,55,58,1,58,212,0,3,12,55,58,1,58,208,0,3,14,55,58,1,58,204,0,3,15,55,58,0,17,55,0,1,58,200,0,3,18,55,58,1,58,196,0,3,19,55,58,1,58,192,0,3,21,55,58,1,58,188,0,3,22,55,58,1,58,184,0,3,23,55,58,1,58,180,0,3,25,55,58,1,58,176,0,3,26,55,58,1,58,172,0,3,27,55,58,1,58,168,0,3,29,55,58,1,58,164,0,3,30,55,58,1,58,160,0,3,32,55,58,1,58,156,0,3,33,55,58,1,58,152,0,3,34,55,58,1,58,148,0,3,35,55,58,1,58,144,0,3,37,55,58,1,58,140,0,3,38,55,58,1,58,136,0,3,40,55,58,1,58,132,0,3,41,55,58,1,58,128,0,3,43,55,58,85,48,0,0,85,50,1,0,85,52,2,0,85,7,3,0,85,8,4,0,85,10,5,0,85,11,6,0,82,58,48,0,106,58,58,72,38,58,58,1,120,58,66,0,1,58,0,0,85,12,58,0,82,58,50,0,82,59,12,0,56,58,58,59,156,122,0,0,82,59,12,0,82,60,8,0,5,58,59,60,85,18,58,0,82,60,7,0,82,59,18,0,82,61,10,0,3,59,59,61,41,59,59,2,100,58,60,59,145,58,58,0,89,19,58,0,88,58,19,0,145,58,58,0,59,60,0,0,145,60,60,0,70,58,58,60,121,58,8,0,59,58,1,0,145,58,58,0,88,60,19,0,145,60,60,0,66,46,58,60,145,46,46,0,119,0,3,0,59,46,0,0,145,46,46,0,89,21,46,0,1,60,0,0,85,14,60,0,82,60,8,0,82,58,14,0,56,60,60,58,140,122,0,0,82,60,14,0,82,58,10,0,46,60,60,58,124,122,0,0,88,47,21,0,145,47,47,0,82,60,7,0,82,58,18,0,82,59,14,0,3,58,58,59,41,58,58,2,3,49,60,58,88,60,49,0,145,60,60,0,65,58,60,47,145,58,58,0,89,49,58,0,82,58,14,0,25,58,58,1,85,14,58,0,119,0,232,255,82,58,12,0,25,58,58,1,85,12,58,0,119,0,194,255,1,58,0,0,85,12,58,0,1,58,0,0,85,15,58,0,82,58,8,0,82,60,12,0,56,58,58,60,36,123,0,0,82,58,12,0,82,60,10,0,46,58,58,60,212,122,0,0,1,54,16,0,119,0,6,0,82,58,48,0,106,58,58,72,38,58,58,2,121,58,2,0,1,54,16,0,32,58,54,16,121,58,10,0,1,54,0,0,82,58,12,0,19,58,58,56,0,51,58,0,82,53,15,0,25,58,53,1,85,15,58,0,41,58,53,1,96,17,58,51,82,58,12,0,25,58,58,1,85,12,58,0,119,0,227,255,82,58,11,0,1,59,0,0,1,63,8,0,138,58,59,63,112,123,0,0,68,124,0,0,108,125,0,0,72,126,0,0,188,127,0,0,140,128,0,0,232,129,0,0,136,130,0,0,1,60,135,53,1,61,90,48,1,62,69,7,1,63,0,54,135,59,8,0,60,61,62,63,119,0,6,2,1,60,0,0,85,12,60,0,82,60,50,0,82,59,12,0,56,60,60,59,56,124,0,0,82,59,12,0,82,61,8,0,5,60,59,61,85,22,60,0,1,60,0,0,85,14,60,0,82,60,8,0,82,61,14,0,56,60,60,61,40,124,0,0,82,60,22,0,82,61,14,0,3,60,60,61,85,23,60,0,82,62,7,0,82,63,23,0,41,63,63,2,100,59,62,63,145,59,59,0,134,61,0,0,16,123,2,0,59,0,0,0,145,61,61,0,59,59,255,0,145,59,59,0,65,60,61,59,145,60,60,0,61,59,0,0,0,0,0,63,63,60,60,59,75,60,60,0,19,60,60,57,0,9,60,0,82,60,52,0,82,59,23,0,95,60,59,9,82,59,14,0,25,59,59,1,85,14,59,0,119,0,223,255,82,59,12,0,25,59,59,1,85,12,59,0,119,0,209,255,137,55,0,0,139,0,0,0,119,0,1,0,1,59,0,0,85,12,59,0,82,59,50,0,82,60,12,0,56,59,59,60,96,125,0,0,82,60,12,0,82,61,8,0,5,59,60,61,85,25,59,0,1,59,0,0,85,14,59,0,82,59,15,0,82,61,14,0,56,59,59,61,216,124,0,0,82,59,25,0,82,61,14,0,41,61,61,1,93,61,17,61,3,59,59,61,85,26,59,0,82,61,7,0,82,60,26,0,41,60,60,2,100,59,61,60,145,59,59,0,134,13,0,0,156,39,2,0,59,0,0,0,82,59,52,0,82,61,26,0,95,59,61,13,82,61,14,0,25,61,61,1,85,14,61,0,119,0,232,255,82,61,48,0,106,61,61,72,38,61,61,2,120,61,27,0,82,62,7,0,82,63,25,0,82,64,10,0,3,63,63,64,41,63,63,2,100,60,62,63,145,60,60,0,134,59,0,0,16,123,2,0,60,0,0,0,145,59,59,0,59,60,255,0,145,60,60,0,65,61,59,60,145,61,61,0,61,60,0,0,0,0,0,63,63,61,61,60,75,61,61,0,19,61,61,57,0,16,61,0,82,61,52,0,82,60,25,0,82,59,10,0,3,60,60,59,95,61,60,16,82,60,12,0,25,60,60,1,85,12,60,0,119,0,188,255,137,55,0,0,139,0,0,0,119,0,1,0,1,60,0,0,85,12,60,0,82,60,50,0,82,61,12,0,56,60,60,61,60,126,0,0,82,61,12,0,82,59,8,0,5,60,61,59,85,27,60,0,1,60,0,0,85,14,60,0,82,60,8,0,82,59,14,0,56,60,60,59,44,126,0,0,82,60,27,0,82,59,14,0,3,60,60,59,85,29,60,0,82,62,7,0,82,63,29,0,41,63,63,2,100,61,62,63,145,61,61,0,134,59,0,0,16,123,2,0,61,0,0,0,145,59,59,0,60,61,0,0,255,255,0,0,145,61,61,0,65,60,59,61,145,60,60,0,61,61,0,0,0,0,0,63,63,60,60,61,75,60,60,0,19,60,60,56,0,20,60,0,82,60,52,0,82,61,29,0,41,61,61,1,96,60,61,20,82,61,14,0,25,61,61,1,85,14,61,0,119,0,221,255,82,61,12,0,25,61,61,1,85,12,61,0,119,0,207,255,137,55,0,0,139,0,0,0,119,0,1,0,1,61,0,0,85,12,61,0,82,61,50,0,82,60,12,0,56,61,61,60,176,127,0,0,82,60,12,0,82,59,8,0,5,61,60,59,85,30,61,0,1,61,0,0,85,14,61,0,82,61,15,0,82,59,14,0,56,61,61,59,32,127,0,0,82,61,30,0,82,59,14,0,41,59,59,1,93,59,17,59,3,61,61,59,85,32,61,0,82,63,7,0,82,64,32,0,41,64,64,2,100,62,63,64,145,62,62,0,134,60,0,0,16,123,2,0,62,0,0,0,145,60,60,0,134,59,0,0,92,102,2,0,60,0,0,0,145,59,59,0,60,60,0,0,255,255,0,0,145,60,60,0,65,61,59,60,145,61,61,0,61,60,0,0,0,0,0,63,63,61,61,60,75,61,61,0,19,61,61,56,0,24,61,0,82,61,52,0,82,60,32,0,41,60,60,1,96,61,60,24,82,60,14,0,25,60,60,1,85,14,60,0,119,0,215,255,82,60,48,0,106,60,60,72,38,60,60,2,120,60,29,0,82,62,7,0,82,63,30,0,82,64,10,0,3,63,63,64,41,63,63,2,100,59,62,63,145,59,59,0,134,61,0,0,16,123,2,0,59,0,0,0,145,61,61,0,60,59,0,0,255,255,0,0,145,59,59,0,65,60,61,59,145,60,60,0,61,59,0,0,0,0,0,63,63,60,60,59,75,60,60,0,19,60,60,56,0,28,60,0,82,60,52,0,82,59,30,0,82,61,10,0,3,59,59,61,41,59,59,1,96,60,59,28,82,59,12,0,25,59,59,1,85,12,59,0,119,0,169,255,137,55,0,0,139,0,0,0,119,0,1,0,1,59,0,0,85,12,59,0,82,59,50,0,82,60,12,0,56,59,59,60,128,128,0,0,82,60,12,0,82,61,8,0,5,59,60,61,85,33,59,0,1,59,0,0,85,14,59,0,82,59,8,0,82,61,14,0,56,59,59,61,112,128,0,0,82,59,33,0,82,61,14,0,3,59,59,61,85,34,59,0,82,60,7,0,82,62,34,0,41,62,62,2,100,61,60,62,145,61,61,0,134,59,0,0,16,123,2,0,61,0,0,0,145,59,59,0,62,61,0,0,0,0,224,255,255,255,239,65,65,59,59,61,61,61,0,0,0,0,0,63,63,59,59,61,75,31,59,0,82,59,52,0,82,61,34,0,41,61,61,2,97,59,61,31,82,61,14,0,25,61,61,1,85,14,61,0,119,0,224,255,82,61,12,0,25,61,61,1,85,12,61,0,119,0,210,255,137,55,0,0,139,0,0,0,119,0,1,0,1,61,0,0,85,12,61,0,82,61,50,0,82,59,12,0,56,61,61,59,220,129,0,0,82,59,12,0,82,60,8,0,5,61,59,60,85,35,61,0,1,61,0,0,85,14,61,0,82,61,15,0,82,60,14,0,56,61,61,60,88,129,0,0,82,61,35,0,82,60,14,0,41,60,60,1,93,60,17,60,3,61,61,60,85,37,61,0,82,62,7,0,82,63,37,0,41,63,63,2,100,59,62,63,145,59,59,0,134,60,0,0,16,123,2,0,59,0,0,0,145,60,60,0,134,61,0,0,92,102,2,0,60,0,0,0,145,61,61,0,62,60,0,0,0,0,224,255,255,255,239,65,65,61,61,60,61,60,0,0,0,0,0,63,63,61,61,60,75,36,61,0,82,61,52,0,82,60,37,0,41,60,60,2,97,61,60,36,82,60,14,0,25,60,60,1,85,14,60,0,119,0,218,255,82,60,48,0,106,60,60,72,38,60,60,2,120,60,26,0,82,59,7,0,82,62,35,0,82,63,10,0,3,62,62,63,41,62,62,2,100,61,59,62,145,61,61,0,134,60,0,0,16,123,2,0,61,0,0,0,145,60,60,0,62,61,0,0,0,0,224,255,255,255,239,65,65,60,60,61,61,61,0,0,0,0,0,63,63,60,60,61,75,39,60,0,82,60,52,0,82,61,35,0,82,59,10,0,3,61,61,59,41,61,61,2,97,60,61,39,82,61,12,0,25,61,61,1,85,12,61,0,119,0,175,255,137,55,0,0,139,0,0,0,119,0,1,0,1,61,0,0,85,12,61,0,82,61,50,0,82,60,12,0,56,61,61,60,124,130,0,0,82,60,12,0,82,59,8,0,5,61,60,59,85,38,61,0,1,61,0,0,85,14,61,0,82,61,8,0,82,59,14,0,56,61,61,59,108,130,0,0,82,61,38,0,82,59,14,0,3,61,61,59,85,40,61,0,82,61,7,0,82,59,40,0,41,59,59,2,100,42,61,59,145,42,42,0,82,61,52,0,82,59,40,0,41,59,59,2,101,61,59,42,82,59,14,0,25,59,59,1,85,14,59,0,119,0,236,255,82,59,12,0,25,59,59,1,85,12,59,0,119,0,222,255,137,55,0,0,139,0,0,0,119,0,1,0,1,59,0,0,85,12,59,0,82,59,50,0,82,61,12,0,56,59,59,61,120,131,0,0,82,61,12,0,82,60,8,0,5,59,61,60,85,41,59,0,1,59,0,0,85,14,59,0,82,59,15,0,82,60,14,0,56,59,59,60,36,131,0,0,82,59,41,0,82,60,14,0,41,60,60,1,93,60,17,60,3,59,59,60,85,43,59,0,82,60,7,0,82,61,43,0,41,61,61,2,100,59,60,61,145,59,59,0,134,44,0,0,92,102,2,0,59,0,0,0,145,44,44,0,82,59,52,0,82,60,43,0,41,60,60,2,101,59,60,44,82,60,14,0,25,60,60,1,85,14,60,0,119,0,230,255,82,60,48,0,106,60,60,72,38,60,60,2,120,60,14,0,82,60,7,0,82,59,41,0,82,61,10,0,3,59,59,61,41,59,59,2,100,45,60,59,145,45,45,0,82,60,52,0,82,59,41,0,82,61,10,0,3,59,59,61,41,59,59,2,101,60,59,45,82,59,12,0,25,59,59,1,85,12,59,0,119,0,199,255,137,55,0,0,139,0,0,0,119,0,245,253,139,0,0,0,140,2,85,0,0,0,0,0,2,78,0,0,144,0,0,0,2,79,0,0,90,48,0,0,2,80,0,0,115,52,0,0,1,76,0,0,136,81,0,0,0,77,81,0,136,81,0,0,25,81,81,112,137,81,0,0,130,81,0,0,136,82,0,0,49,81,81,82,220,131,0,0,1,82,112,0,135,81,0,0,82,0,0,0,25,33,77,100,25,63,77,96,25,70,77,92,25,71,77,88,25,72,77,84,25,73,77,80,25,74,77,76,25,75,77,72,25,2,77,68,25,6,77,64,25,9,77,60,25,11,77,56,25,15,77,52,25,18,77,48,25,21,77,44,25,24,77,40,25,28,77,36,25,30,77,32,25,34,77,28,25,38,77,24,25,41,77,20,25,43,77,16,25,47,77,12,25,50,77,8,25,53,77,4,0,56,77,0,85,33,0,0,85,63,1,0,82,81,33,0,25,81,81,20,116,72,81,0,82,81,33,0,25,81,81,64,116,73,81,0,82,82,33,0,134,81,0,0,200,143,2,0,82,0,0,0,85,74,81,0,82,81,33,0,25,81,81,100,116,75,81,0,82,81,33,0,25,81,81,104,116,2,81,0,82,81,33,0,1,82,128,0,3,81,81,82,116,6,81,0,1,81,0,0,85,70,81,0,82,81,72,0,82,82,70,0,49,81,81,82,192,132,0,0,1,76,43,0,119,0,203,1,82,81,75,0,82,82,70,0,41,82,82,3,3,81,81,82,116,9,81,0,82,81,75,0,82,82,70,0,41,82,82,3,3,81,81,82,25,81,81,4,116,11,81,0,82,82,70,0,82,83,73,0,5,81,82,83,85,15,81,0,82,83,6,0,82,82,70,0,5,81,83,82,85,18,81,0,1,81,0,0,85,21,81,0,82,81,11,0,82,82,9,0,47,81,81,82,44,133,0,0,1,76,4,0,119,0,176,1,82,81,9,0,1,82,0,0,82,83,33,0,94,83,83,78,4,82,82,83,47,81,81,82,80,133,0,0,1,76,6,0,119,0,167,1,82,81,11,0,1,82,0,0,82,83,33,0,94,83,83,78,4,82,82,83,47,81,81,82,116,133,0,0,1,76,8,0,119,0,158,1,82,81,33,0,106,81,81,4,82,82,33,0,94,82,82,78,3,81,81,82,82,82,9,0,49,81,81,82,156,133,0,0,1,76,10,0,119,0,148,1,82,81,33,0,106,81,81,4,82,82,33,0,94,82,82,78,3,81,81,82,82,82,11,0,49,81,81,82,196,133,0,0,1,76,12,0,119,0,138,1,82,81,73,0,1,84,1,0,1,82,4,0,138,81,84,82,224,134,0,0,160,135,0,0,184,136,0,0,32,138,0,0,116,71,9,0,82,82,11,0,82,83,71,0,54,82,82,83,216,139,0,0,82,83,71,0,82,84,73,0,5,82,83,84,85,50,82,0,82,64,2,0,82,65,18,0,82,66,21,0,25,82,66,1,85,21,82,0,3,84,65,66,41,84,84,2,100,82,64,84,145,82,82,0,89,53,82,0,88,82,53,0,145,82,82,0,59,84,0,0,145,84,84,0,70,82,82,84,120,82,3,0,1,76,37,0,119,0,103,1,1,82,0,0,85,56,82,0,82,82,73,0,82,84,56,0,56,82,82,84,208,134,0,0,82,82,74,0,82,84,50,0,82,83,56,0,3,84,84,83,41,84,84,2,100,67,82,84,145,67,67,0,88,82,53,0,145,82,82,0,65,68,67,82,145,68,68,0,82,82,63,0,82,84,15,0,82,83,56,0,3,84,84,83,41,84,84,2,3,69,82,84,88,82,69,0,145,82,82,0,63,84,82,68,145,84,84,0,89,69,84,0,82,84,56,0,25,84,84,1,85,56,84,0,119,0,227,255,82,84,71,0,25,84,84,1,85,71,84,0,119,0,195,255,116,71,9,0,82,82,11,0,82,83,71,0,54,82,82,83,216,139,0,0,116,24,71,0,82,3,2,0,82,4,18,0,82,5,21,0,25,82,5,1,85,21,82,0,3,83,4,5,41,83,83,2,100,82,3,83,145,82,82,0,89,28,82,0,88,82,28,0,145,82,82,0,59,83,0,0,145,83,83,0,70,82,82,83,120,82,3,0,1,76,17,0,119,0,43,1,82,82,74,0,82,83,24,0,25,83,83,0,41,83,83,2,100,7,82,83,145,7,7,0,88,82,28,0,145,82,82,0,65,8,7,82,145,8,8,0,82,82,63,0,82,83,15,0,25,83,83,0,41,83,83,2,3,10,82,83,88,82,10,0,145,82,82,0,63,83,82,8,145,83,83,0,89,10,83,0,82,83,71,0,25,83,83,1,85,71,83,0,119,0,210,255,116,71,9,0,82,83,11,0,82,82,71,0,54,83,83,82,216,139,0,0,82,83,71,0,41,83,83,1,85,30,83,0,82,12,2,0,82,13,18,0,82,14,21,0,25,83,14,1,85,21,83,0,3,82,13,14,41,82,82,2,100,83,12,82,145,83,83,0,89,34,83,0,88,83,34,0,145,83,83,0,59,82,0,0,145,82,82,0,70,83,83,82,120,83,3,0,1,76,22,0,119,0,249,0,82,83,74,0,82,82,30,0,25,82,82,0,41,82,82,2,100,16,83,82,145,16,16,0,88,83,34,0,145,83,83,0,65,17,16,83,145,17,17,0,82,83,63,0,82,82,15,0,25,82,82,0,41,82,82,2,3,19,83,82,88,83,19,0,145,83,83,0,63,82,83,17,145,82,82,0,89,19,82,0,82,82,74,0,82,83,30,0,25,83,83,1,41,83,83,2,100,20,82,83,145,20,20,0,88,82,34,0,145,82,82,0,65,22,20,82,145,22,22,0,82,82,63,0,82,83,15,0,25,83,83,1,41,83,83,2,3,23,82,83,88,82,23,0,145,82,82,0,63,83,82,22,145,83,83,0,89,23,83,0,82,83,71,0,25,83,83,1,85,71,83,0,119,0,188,255,116,71,9,0,82,83,11,0,82,82,71,0,54,83,83,82,216,139,0,0,82,83,71,0,27,83,83,3,85,38,83,0,82,25,2,0,82,26,18,0,82,27,21,0,25,83,27,1,85,21,83,0,3,82,26,27,41,82,82,2,100,83,25,82,145,83,83,0,89,41,83,0,88,83,41,0,145,83,83,0,59,82,0,0,145,82,82,0,70,83,83,82,120,83,3,0,1,76,27,0,119,0,179,0,82,83,74,0,82,82,38,0,25,82,82,0,41,82,82,2,100,29,83,82,145,29,29,0,88,83,41,0,145,83,83,0,65,31,29,83,145,31,31,0,82,83,63,0,82,82,15,0,25,82,82,0,41,82,82,2,3,32,83,82,88,83,32,0,145,83,83,0,63,82,83,31,145,82,82,0,89,32,82,0,82,82,74,0,82,83,38,0,25,83,83,1,41,83,83,2,100,35,82,83,145,35,35,0,88,82,41,0,145,82,82,0,65,36,35,82,145,36,36,0,82,82,63,0,82,83,15,0,25,83,83,1,41,83,83,2,3,37,82,83,88,82,37,0,145,82,82,0,63,83,82,36,145,83,83,0,89,37,83,0,82,83,74,0,82,82,38,0,25,82,82,2,41,82,82,2,100,39,83,82,145,39,39,0,88,83,41,0,145,83,83,0,65,40,39,83,145,40,40,0,82,83,63,0,82,82,15,0,25,82,82,2,41,82,82,2,3,42,83,82,88,83,42,0,145,83,83,0,63,82,83,40,145,82,82,0,89,42,82,0,82,82,71,0,25,82,82,1,85,71,82,0,119,0,168,255,116,71,9,0,82,82,11,0,82,83,71,0,54,82,82,83,216,139,0,0,82,82,71,0,41,82,82,2,85,43,82,0,82,44,2,0,82,45,18,0,82,46,21,0,25,82,46,1,85,21,82,0,3,83,45,46,41,83,83,2,100,82,44,83,145,82,82,0,89,47,82,0,88,82,47,0,145,82,82,0,59,83,0,0,145,83,83,0,70,82,82,83,120,82,3,0,1,76,32,0,119,0,89,0,82,82,74,0,82,83,43,0,25,83,83,0,41,83,83,2,100,48,82,83,145,48,48,0,88,82,47,0,145,82,82,0,65,49,48,82,145,49,49,0,82,82,63,0,82,83,15,0,25,83,83,0,41,83,83,2,3,51,82,83,88,82,51,0,145,82,82,0,63,83,82,49,145,83,83,0,89,51,83,0,82,83,74,0,82,82,43,0,25,82,82,1,41,82,82,2,100,52,83,82,145,52,52,0,88,83,47,0,145,83,83,0,65,54,52,83,145,54,54,0,82,83,63,0,82,82,15,0,25,82,82,1,41,82,82,2,3,55,83,82,88,83,55,0,145,83,83,0,63,82,83,54,145,82,82,0,89,55,82,0,82,82,74,0,82,83,43,0,25,83,83,2,41,83,83,2,100,57,82,83,145,57,57,0,88,82,47,0,145,82,82,0,65,58,57,82,145,58,58,0,82,82,63,0,82,83,15,0,25,83,83,2,41,83,83,2,3,59,82,83,88,82,59,0,145,82,82,0,63,83,82,58,145,83,83,0,89,59,83,0,82,83,74,0,82,82,43,0,25,82,82,3,41,82,82,2,100,60,83,82,145,60,60,0,88,83,47,0,145,83,83,0,65,61,60,83,145,61,61,0,82,83,63,0,82,82,15,0,25,82,82,3,41,82,82,2,3,62,83,82,88,83,62,0,145,83,83,0,63,82,83,61,145,82,82,0,89,62,82,0,82,82,71,0,25,82,82,1,85,71,82,0,119,0,148,255,82,81,70,0,25,81,81,1,85,70,81,0,119,0,49,254,1,81,4,0,1,84,40,0,138,76,81,84,152,140,0,0,148,140,0,0,172,140,0,0,148,140,0,0,192,140,0,0,148,140,0,0,212,140,0,0,148,140,0,0,232,140,0,0,148,140,0,0,148,140,0,0,148,140,0,0,148,140,0,0,252,140,0,0,148,140,0,0,148,140,0,0,148,140,0,0,148,140,0,0,16,141,0,0,148,140,0,0,148,140,0,0,148,140,0,0,148,140,0,0,36,141,0,0,148,140,0,0,148,140,0,0,148,140,0,0,148,140,0,0,56,141,0,0,148,140,0,0,148,140,0,0,148,140,0,0,148,140,0,0,76,141,0,0,148,140,0,0,148,140,0,0,148,140,0,0,148,140,0,0,148,140,0,0,96,141,0,0,119,0,54,0,1,84,106,52,1,82,180,5,135,81,8,0,84,79,82,80,119,0,49,0,1,82,151,52,1,84,181,5,135,81,8,0,82,79,84,80,119,0,44,0,1,84,201,52,1,82,182,5,135,81,8,0,84,79,82,80,119,0,39,0,1,82,251,52,1,84,183,5,135,81,8,0,82,79,84,80,119,0,34,0,1,84,65,53,1,82,184,5,135,81,8,0,84,79,82,80,119,0,29,0,1,82,89,52,1,84,192,5,135,81,8,0,82,79,84,80,119,0,24,0,1,84,89,52,1,82,201,5,135,81,8,0,84,79,82,80,119,0,19,0,1,82,89,52,1,84,211,5,135,81,8,0,82,79,84,80,119,0,14,0,1,84,89,52,1,82,222,5,135,81,8,0,84,79,82,80,119,0,9,0,1,82,89,52,1,84,235,5,135,81,8,0,82,79,84,80,119,0,4,0,137,77,0,0,139,0,0,0,119,0,1,0,139,0,0,0,140,6,82,0,0,0,0,0,2,72,0,0,0,1,0,0,2,73,0,0,4,2,0,0,2,74,0,0,4,1,0,0,2,75,0,0,64,66,15,0,1,70,0,0,136,76,0,0,0,71,76,0,136,76,0,0,1,77,128,0,3,76,76,77,137,76,0,0,130,76,0,0,136,77,0,0,49,76,76,77,208,141,0,0,1,77,128,0,135,76,0,0,77,0,0,0,25,63,71,120,25,64,71,116,25,66,71,112,25,69,71,108,25,6,71,104,25,7,71,100,25,8,71,96,25,9,71,92,25,10,71,88,25,11,71,124,25,12,71,84,25,13,71,80,25,14,71,76,25,15,71,72,25,17,71,68,25,20,71,64,25,22,71,60,25,23,71,56,25,24,71,52,25,27,71,48,25,28,71,44,25,31,71,40,25,32,71,36,25,35,71,32,25,36,71,28,25,39,71,24,25,40,71,20,25,43,71,16,25,44,71,12,25,47,71,8,25,48,71,4,0,50,71,0,85,63,0,0,85,64,1,0,85,66,2,0,85,69,3,0,85,6,4,0,85,7,5,0,82,77,69,0,82,78,6,0,5,76,77,78,85,8,76,0,82,78,8,0,41,78,78,2,41,78,78,2,135,76,6,0,78,0,0,0,85,9,76,0,1,76,0,0,85,10,76,0,82,76,8,0,41,76,76,2,82,78,10,0,56,76,76,78,236,142,0,0,82,76,64,0,82,78,10,0,90,76,76,78,83,11,76,0,79,76,11,0,41,76,76,8,85,12,76,0,82,76,9,0,82,78,10,0,41,78,78,2,82,77,12,0,97,76,78,77,82,77,10,0,25,77,77,1,85,10,77,0,119,0,236,255,1,77,0,0,85,13,77,0,82,77,6,0,82,78,13,0,57,77,77,78,124,150,0,0,1,77,0,0,85,14,77,0,82,77,69,0,82,78,14,0,57,77,77,78,108,150,0,0,82,77,13,0,82,78,69,0,5,65,77,78,82,78,9,0,82,77,14,0,3,77,65,77,41,77,77,2,41,77,77,2,3,78,78,77,85,15,78,0,82,78,63,0,121,78,10,0,82,78,13,0,82,77,69,0,5,67,78,77,82,77,63,0,82,78,14,0,3,78,67,78,41,78,78,2,3,68,77,78,119,0,2,0,1,68,0,0,85,17,68,0,82,78,15,0,82,78,78,0,25,78,78,127,6,78,78,72,85,20,78,0,82,78,15,0,106,78,78,4,25,78,78,127,6,78,78,72,85,22,78,0,82,78,15,0,106,78,78,8,25,78,78,127,6,78,78,72,85,23,78,0,82,78,63,0,121,78,34,0,82,78,17,0,79,78,78,0,82,77,20,0,45,78,78,77,56,144,0,0,82,78,17,0,103,78,78,1,82,77,22,0,45,78,78,77,48,144,0,0,82,78,17,0,103,78,78,2,82,77,23,0,45,78,78,77,40,144,0,0,82,78,15,0,116,78,20,0,82,78,15,0,82,77,22,0,109,78,4,77,82,77,15,0,82,78,23,0,109,77,8,78,82,78,15,0,1,77,0,0,109,78,12,77,119,0,8,0,1,70,15,0,119,0,6,0,1,70,15,0,119,0,4,0,1,70,15,0,119,0,2,0,1,70,15,0,32,77,70,15,121,77,133,1,1,70,0,0,85,24,75,0,1,77,0,0,85,27,77,0,82,78,7,0,82,76,20,0,82,79,22,0,82,80,23,0,1,81,1,0,134,77,0,0,168,119,1,0,78,76,79,80,27,24,81,0,82,77,15,0,82,77,77,0,82,81,7,0,25,81,81,4,82,80,27,0,91,81,81,80,41,81,81,8,4,77,77,81,85,28,77,0,82,77,15,0,106,77,77,4,82,81,7,0,3,81,81,74,82,80,27,0,91,81,81,80,41,81,81,8,4,77,77,81,85,31,77,0,82,77,15,0,106,77,77,8,82,81,7,0,3,81,81,73,82,80,27,0,91,81,81,80,41,81,81,8,4,77,77,81,85,32,77,0,82,77,15,0,82,81,7,0,25,81,81,4,82,80,27,0,91,81,81,80,85,77,81,0,82,81,15,0,82,77,7,0,3,77,77,74,82,80,27,0,91,77,77,80,109,81,4,77,82,77,15,0,82,81,7,0,3,81,81,73,82,80,27,0,91,81,81,80,109,77,8,81,82,81,15,0,82,77,27,0,109,81,12,77,82,77,13,0,82,81,69,0,5,16,77,81,82,81,14,0,3,81,16,81,25,81,81,1,85,35,81,0,82,81,13,0,82,77,69,0,5,18,81,77,82,77,69,0,3,77,18,77,82,81,14,0,3,77,77,81,26,77,77,1,85,36,77,0,82,77,13,0,82,81,69,0,5,19,77,81,82,81,69,0,3,81,19,81,82,77,14,0,3,81,81,77,85,39,81,0,82,81,13,0,82,77,69,0,5,21,81,77,82,77,69,0,3,77,21,77,82,81,14,0,3,77,77,81,25,77,77,1,85,40,77,0,82,77,35,0,82,81,8,0,47,77,77,81,240,146,0,0,82,77,9,0,82,81,35,0,41,81,81,2,41,81,81,2,3,77,77,81,85,43,77,0,82,77,28,0,27,77,77,7,28,77,77,16,1,81,0,0,82,80,43,0,82,80,80,0,4,81,81,80,47,77,77,81,36,146,0,0,1,77,0,0,82,81,43,0,82,81,81,0,4,26,77,81,119,0,4,0,82,81,28,0,27,81,81,7,28,26,81,16,82,25,43,0,82,81,25,0,3,81,81,26,85,25,81,0,82,81,31,0,27,81,81,7,28,81,81,16,1,77,0,0,82,80,43,0,106,80,80,4,4,77,77,80,47,81,81,77,120,146,0,0,1,81,0,0,82,77,43,0,106,77,77,4,4,30,81,77,119,0,4,0,82,77,31,0,27,77,77,7,28,30,77,16,82,77,43,0,25,29,77,4,82,77,29,0,3,77,77,30,85,29,77,0,82,77,32,0,27,77,77,7,28,77,77,16,1,81,0,0,82,80,43,0,106,80,80,8,4,81,81,80,47,77,77,81,208,146,0,0,1,77,0,0,82,81,43,0,106,81,81,8,4,34,77,81,119,0,4,0,82,81,32,0,27,81,81,7,28,34,81,16,82,81,43,0,25,33,81,8,82,81,33,0,3,81,81,34,85,33,81,0,82,81,36,0,82,77,8,0,47,81,81,77,28,148,0,0,82,81,9,0,82,77,36,0,41,77,77,2,41,77,77,2,3,81,81,77,85,44,81,0,82,81,28,0,27,81,81,3,28,81,81,16,1,77,0,0,82,80,44,0,82,80,80,0,4,77,77,80,47,81,81,77,80,147,0,0,1,81,0,0,82,77,44,0,82,77,77,0,4,38,81,77,119,0,4,0,82,77,28,0,27,77,77,3,28,38,77,16,82,37,44,0,82,77,37,0,3,77,77,38,85,37,77,0,82,77,31,0,27,77,77,3,28,77,77,16,1,81,0,0,82,80,44,0,106,80,80,4,4,81,81,80,47,77,77,81,164,147,0,0,1,77,0,0,82,81,44,0,106,81,81,4,4,42,77,81,119,0,4,0,82,81,31,0,27,81,81,3,28,42,81,16,82,81,44,0,25,41,81,4,82,81,41,0,3,81,81,42,85,41,81,0,82,81,32,0,27,81,81,3,28,81,81,16,1,77,0,0,82,80,44,0,106,80,80,8,4,77,77,80,47,81,81,77,252,147,0,0,1,81,0,0,82,77,44,0,106,77,77,8,4,46,81,77,119,0,4,0,82,77,32,0,27,77,77,3,28,46,77,16,82,77,44,0,25,45,77,8,82,77,45,0,3,77,77,46,85,45,77,0,82,77,39,0,82,81,8,0,47,77,77,81,72,149,0,0,82,77,9,0,82,81,39,0,41,81,81,2,41,81,81,2,3,77,77,81,85,47,77,0,82,77,28,0,27,77,77,5,28,77,77,16,1,81,0,0,82,80,47,0,82,80,80,0,4,81,81,80,47,77,77,81,124,148,0,0,1,77,0,0,82,81,47,0,82,81,81,0,4,51,77,81,119,0,4,0,82,81,28,0,27,81,81,5,28,51,81,16,82,49,47,0,82,81,49,0,3,81,81,51,85,49,81,0,82,81,31,0,27,81,81,5,28,81,81,16,1,77,0,0,82,80,47,0,106,80,80,4,4,77,77,80,47,81,81,77,208,148,0,0,1,81,0,0,82,77,47,0,106,77,77,4,4,53,81,77,119,0,4,0,82,77,31,0,27,77,77,5,28,53,77,16,82,77,47,0,25,52,77,4,82,77,52,0,3,77,77,53,85,52,77,0,82,77,32,0,27,77,77,5,28,77,77,16,1,81,0,0,82,80,47,0,106,80,80,8,4,81,81,80,47,77,77,81,40,149,0,0,1,77,0,0,82,81,47,0,106,81,81,8,4,55,77,81,119,0,4,0,82,81,32,0,27,81,81,5,28,55,81,16,82,81,47,0,25,54,81,8,82,81,54,0,3,81,81,55,85,54,81,0,82,81,40,0,82,77,8,0,47,81,81,77,92,150,0,0,82,81,9,0,82,77,40,0,41,77,77,2,41,77,77,2,3,81,81,77,85,48,81,0,82,81,28,0,28,81,81,16,1,77,0,0,82,80,48,0,82,80,80,0,4,77,77,80,47,81,81,77,164,149,0,0,1,81,0,0,82,77,48,0,82,77,77,0,4,57,81,77,119,0,3,0,82,77,28,0,28,57,77,16,82,56,48,0,82,77,56,0,3,77,77,57,85,56,77,0,82,77,31,0,28,77,77,16,1,81,0,0,82,80,48,0,106,80,80,4,4,81,81,80,47,77,77,81,240,149,0,0,1,77,0,0,82,81,48,0,106,81,81,4,4,59,77,81,119,0,3,0,82,81,31,0,28,59,81,16,82,81,48,0,25,58,81,4,82,81,58,0,3,81,81,59,85,58,81,0,82,81,32,0,28,81,81,16,1,77,0,0,82,80,48,0,106,80,80,8,4,77,77,80,47,81,81,77,64,150,0,0,1,81,0,0,82,77,48,0,106,77,77,8,4,61,81,77,119,0,3,0,82,77,32,0,28,61,77,16,82,77,48,0,25,60,77,8,82,77,60,0,3,77,77,61,85,60,77,0,82,77,14,0,25,77,77,1,85,14,77,0,119,0,41,254,82,77,13,0,25,77,77,1,85,13,77,0,119,0,31,254,1,77,0,0,85,50,77,0,82,62,9,0,82,77,8,0,41,77,77,2,82,81,50,0,56,77,77,81,196,150,0,0,82,77,66,0,82,81,50,0,82,80,50,0,41,80,80,2,94,80,62,80,95,77,81,80,82,80,50,0,25,80,80,1,85,50,80,0,119,0,241,255,135,80,5,0,62,0,0,0,137,71,0,0,139,0,0,0,140,3,125,0,0,0,0,0,136,120,0,0,0,117,120,0,136,120,0,0,25,120,120,64,137,120,0,0,130,120,0,0,136,121,0,0,49,120,120,121,12,151,0,0,1,121,64,0,135,120,0,0,121,0,0,0,0,68,117,0,0,116,68,0,25,119,116,64,1,120,0,0,85,116,120,0,25,116,116,4,54,120,116,119,24,151,0,0,88,94,1,0,145,94,94,0,88,120,2,0,145,120,120,0,65,102,94,120,145,102,102,0,112,108,1,16,145,108,108,0,112,121,2,4,145,121,121,0,65,120,108,121,145,120,120,0,63,8,102,120,145,8,8,0,112,15,1,32,145,15,15,0,112,121,2,8,145,121,121,0,65,120,15,121,145,120,120,0,63,28,8,120,145,28,28,0,112,35,1,48,145,35,35,0,112,122,2,12,145,122,122,0,65,121,35,122,145,121,121,0,63,120,28,121,145,120,120,0,89,68,120,0,88,51,1,0,145,51,51,0,112,120,2,16,145,120,120,0,65,61,51,120,145,61,61,0,112,69,1,16,145,69,69,0,112,121,2,20,145,121,121,0,65,120,69,121,145,120,120,0,63,81,61,120,145,81,81,0,112,88,1,32,145,88,88,0,112,121,2,24,145,121,121,0,65,120,88,121,145,120,120,0,63,95,81,120,145,95,95,0,112,96,1,48,145,96,96,0,112,123,2,28,145,123,123,0,65,122,96,123,145,122,122,0,63,121,95,122,145,121,121,0,113,68,16,121,88,97,1,0,145,97,97,0,112,121,2,32,145,121,121,0,65,98,97,121,145,98,98,0,112,99,1,16,145,99,99,0,112,120,2,36,145,120,120,0,65,121,99,120,145,121,121,0,63,100,98,121,145,100,100,0,112,101,1,32,145,101,101,0,112,120,2,40,145,120,120,0,65,121,101,120,145,121,121,0,63,103,100,121,145,103,103,0,112,104,1,48,145,104,104,0,112,123,2,44,145,123,123,0,65,122,104,123,145,122,122,0,63,120,103,122,145,120,120,0,113,68,32,120,88,105,1,0,145,105,105,0,112,120,2,48,145,120,120,0,65,106,105,120,145,106,106,0,112,107,1,16,145,107,107,0,112,121,2,52,145,121,121,0,65,120,107,121,145,120,120,0,63,109,106,120,145,109,109,0,112,110,1,32,145,110,110,0,112,121,2,56,145,121,121,0,65,120,110,121,145,120,120,0,63,111,109,120,145,111,111,0,112,112,1,48,145,112,112,0,112,123,2,60,145,123,123,0,65,122,112,123,145,122,122,0,63,121,111,122,145,121,121,0,113,68,48,121,112,113,1,4,145,113,113,0,88,121,2,0,145,121,121,0,65,114,113,121,145,114,114,0,112,115,1,20,145,115,115,0,112,120,2,4,145,120,120,0,65,121,115,120,145,121,121,0,63,3,114,121,145,3,3,0,112,4,1,36,145,4,4,0,112,120,2,8,145,120,120,0,65,121,4,120,145,121,121,0,63,5,3,121,145,5,5,0,112,6,1,52,145,6,6,0,112,123,2,12,145,123,123,0,65,122,6,123,145,122,122,0,63,120,5,122,145,120,120,0,113,68,4,120,112,7,1,4,145,7,7,0,112,120,2,16,145,120,120,0,65,9,7,120,145,9,9,0,112,10,1,20,145,10,10,0,112,121,2,20,145,121,121,0,65,120,10,121,145,120,120,0,63,11,9,120,145,11,11,0,112,12,1,36,145,12,12,0,112,121,2,24,145,121,121,0,65,120,12,121,145,120,120,0,63,13,11,120,145,13,13,0,112,14,1,52,145,14,14,0,112,123,2,28,145,123,123,0,65,122,14,123,145,122,122,0,63,121,13,122,145,121,121,0,113,68,20,121,112,16,1,4,145,16,16,0,112,121,2,32,145,121,121,0,65,17,16,121,145,17,17,0,112,18,1,20,145,18,18,0,112,120,2,36,145,120,120,0,65,121,18,120,145,121,121,0,63,19,17,121,145,19,19,0,112,20,1,36,145,20,20,0,112,120,2,40,145,120,120,0,65,121,20,120,145,121,121,0,63,21,19,121,145,21,21,0,112,22,1,52,145,22,22,0,112,123,2,44,145,123,123,0,65,122,22,123,145,122,122,0,63,120,21,122,145,120,120,0,113,68,36,120,112,23,1,4,145,23,23,0,112,120,2,48,145,120,120,0,65,24,23,120,145,24,24,0,112,25,1,20,145,25,25,0,112,121,2,52,145,121,121,0,65,120,25,121,145,120,120,0,63,26,24,120,145,26,26,0,112,27,1,36,145,27,27,0,112,121,2,56,145,121,121,0,65,120,27,121,145,120,120,0,63,29,26,120,145,29,29,0,112,30,1,52,145,30,30,0,112,123,2,60,145,123,123,0,65,122,30,123,145,122,122,0,63,121,29,122,145,121,121,0,113,68,52,121,112,31,1,8,145,31,31,0,88,121,2,0,145,121,121,0,65,32,31,121,145,32,32,0,112,33,1,24,145,33,33,0,112,120,2,4,145,120,120,0,65,121,33,120,145,121,121,0,63,34,32,121,145,34,34,0,112,36,1,40,145,36,36,0,112,120,2,8,145,120,120,0,65,121,36,120,145,121,121,0,63,37,34,121,145,37,37,0,112,38,1,56,145,38,38,0,112,123,2,12,145,123,123,0,65,122,38,123,145,122,122,0,63,120,37,122,145,120,120,0,113,68,8,120,112,39,1,8,145,39,39,0,112,120,2,16,145,120,120,0,65,40,39,120,145,40,40,0,112,41,1,24,145,41,41,0,112,121,2,20,145,121,121,0,65,120,41,121,145,120,120,0,63,42,40,120,145,42,42,0,112,43,1,40,145,43,43,0,112,121,2,24,145,121,121,0,65,120,43,121,145,120,120,0,63,44,42,120,145,44,44,0,112,45,1,56,145,45,45,0,112,123,2,28,145,123,123,0,65,122,45,123,145,122,122,0,63,121,44,122,145,121,121,0,113,68,24,121,112,46,1,8,145,46,46,0,112,121,2,32,145,121,121,0,65,47,46,121,145,47,47,0,112,48,1,24,145,48,48,0,112,120,2,36,145,120,120,0,65,121,48,120,145,121,121,0,63,49,47,121,145,49,49,0,112,50,1,40,145,50,50,0,112,120,2,40,145,120,120,0,65,121,50,120,145,121,121,0,63,52,49,121,145,52,52,0,112,53,1,56,145,53,53,0,112,123,2,44,145,123,123,0,65,122,53,123,145,122,122,0,63,120,52,122,145,120,120,0,113,68,40,120,112,54,1,8,145,54,54,0,112,120,2,48,145,120,120,0,65,55,54,120,145,55,55,0,112,56,1,24,145,56,56,0,112,121,2,52,145,121,121,0,65,120,56,121,145,120,120,0,63,57,55,120,145,57,57,0,112,58,1,40,145,58,58,0,112,121,2,56,145,121,121,0,65,120,58,121,145,120,120,0,63,59,57,120,145,59,59,0,112,60,1,56,145,60,60,0,112,123,2,60,145,123,123,0,65,122,60,123,145,122,122,0,63,121,59,122,145,121,121,0,113,68,56,121,112,62,1,12,145,62,62,0,88,121,2,0,145,121,121,0,65,63,62,121,145,63,63,0,112,64,1,28,145,64,64,0,112,120,2,4,145,120,120,0,65,121,64,120,145,121,121,0,63,65,63,121,145,65,65,0,112,66,1,44,145,66,66,0,112,120,2,8,145,120,120,0,65,121,66,120,145,121,121,0,63,67,65,121,145,67,67,0,112,70,1,60,145,70,70,0,112,123,2,12,145,123,123,0,65,122,70,123,145,122,122,0,63,120,67,122,145,120,120,0,113,68,12,120,112,71,1,12,145,71,71,0,112,120,2,16,145,120,120,0,65,72,71,120,145,72,72,0,112,73,1,28,145,73,73,0,112,121,2,20,145,121,121,0,65,120,73,121,145,120,120,0,63,74,72,120,145,74,74,0,112,75,1,44,145,75,75,0,112,121,2,24,145,121,121,0,65,120,75,121,145,120,120,0,63,76,74,120,145,76,76,0,112,77,1,60,145,77,77,0,112,123,2,28,145,123,123,0,65,122,77,123,145,122,122,0,63,121,76,122,145,121,121,0,113,68,28,121,112,78,1,12,145,78,78,0,112,121,2,32,145,121,121,0,65,79,78,121,145,79,79,0,112,80,1,28,145,80,80,0,112,120,2,36,145,120,120,0,65,121,80,120,145,121,121,0,63,82,79,121,145,82,82,0,112,83,1,44,145,83,83,0,112,120,2,40,145,120,120,0,65,121,83,120,145,121,121,0,63,84,82,121,145,84,84,0,112,85,1,60,145,85,85,0,112,123,2,44,145,123,123,0,65,122,85,123,145,122,122,0,63,120,84,122,145,120,120,0,113,68,44,120,112,86,1,12,145,86,86,0,112,120,2,48,145,120,120,0,65,87,86,120,145,87,87,0,112,89,1,28,145,89,89,0,112,121,2,52,145,121,121,0,65,120,89,121,145,120,120,0,63,90,87,120,145,90,90,0,112,91,1,44,145,91,91,0,112,121,2,56,145,121,121,0,65,120,91,121,145,120,120,0,63,92,90,120,145,92,92,0,112,93,1,60,145,93,93,0,112,123,2,60,145,123,123,0,65,122,93,123,145,122,122,0,63,121,92,122,145,121,121,0,113,68,60,121,0,116,0,0,0,118,68,0,25,119,116,64,116,116,118,0,25,116,116,4,25,118,118,4,54,121,116,119,248,158,0,0,137,117,0,0,139,0,0,0,140,1,6,0,0,0,0,0,1,4,46,63,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,1,0,119,0,100,4,1,4,62,63,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,7,0,119,0,93,4,1,4,77,63,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,3,0,119,0,86,4,1,4,98,63,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,8,0,119,0,79,4,1,4,111,63,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,9,0,119,0,72,4,1,4,129,63,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,10,0,119,0,65,4,1,4,148,63,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,11,0,119,0,58,4,1,4,162,63,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,1,0,119,0,51,4,1,4,175,63], eb + 30720);
  HEAPU8.set([134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,2,0,119,0,44,4,1,4,191,63,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,12,0,119,0,37,4,1,4,215,63,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,13,0,119,0,30,4,1,4,227,63,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,2,0,119,0,23,4,1,4,247,63,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,3,0,119,0,16,4,1,4,4,64,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,4,0,119,0,9,4,1,4,20,64,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,3,0,119,0,2,4,1,4,45,64,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,3,0,119,0,251,3,1,4,53,64,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,2,0,119,0,244,3,1,4,66,64,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,1,0,119,0,237,3,1,4,80,64,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,4,0,119,0,230,3,1,4,95,64,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,5,0,119,0,223,3,1,4,107,64,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,5,0,119,0,216,3,1,4,123,64,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,1,0,119,0,209,3,1,4,146,64,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,1,0,119,0,202,3,1,4,172,64,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,2,0,119,0,195,3,1,4,189,64,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,3,0,119,0,188,3,1,4,209,64,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,1,0,119,0,181,3,1,4,225,64,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,4,0,119,0,174,3,1,4,240,64,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,6,0,119,0,167,3,1,4,251,64,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,14,0,119,0,160,3,1,4,11,65,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,15,0,119,0,153,3,1,4,32,65,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,7,0,119,0,146,3,1,4,48,65,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,16,0,119,0,139,3,1,4,70,65,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,8,0,119,0,132,3,1,4,85,65,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,17,0,119,0,125,3,1,4,102,65,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,9,0,119,0,118,3,1,4,114,65,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,10,0,119,0,111,3,1,4,126,65,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,1,0,119,0,104,3,1,4,140,65,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,18,0,119,0,97,3,1,4,155,65,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,11,0,119,0,90,3,1,4,165,65,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,12,0,119,0,83,3,1,4,192,65,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,4,0,119,0,76,3,1,4,205,65,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,6,0,119,0,69,3,1,4,220,65,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,13,0,119,0,62,3,1,4,229,65,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,14,0,119,0,55,3,1,4,255,65,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,2,0,119,0,48,3,1,4,8,66,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,3,0,119,0,41,3,1,4,16,66,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,7,0,119,0,34,3,1,4,42,66,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,2,0,119,0,27,3,1,4,65,66,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,15,0,119,0,20,3,1,4,77,66,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,19,0,119,0,13,3,1,4,90,66,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,16,0,119,0,6,3,1,4,107,66,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,20,0,119,0,255,2,1,4,125,66,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,21,0,119,0,248,2,1,4,144,66,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,22,0,119,0,241,2,1,4,158,66,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,1,0,119,0,234,2,1,4,176,66,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,2,0,119,0,227,2,1,4,195,66,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,8,0,119,0,220,2,1,4,216,66,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,1,0,119,0,213,2,1,4,236,66,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,23,0,119,0,206,2,1,4,250,66,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,5,0,119,0,199,2,1,4,17,67,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,2,0,119,0,192,2,1,4,28,67,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,24,0,119,0,185,2,1,4,40,67,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,9,0,119,0,178,2,1,4,78,67,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,25,0,119,0,171,2,1,4,92,67,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,6,0,119,0,164,2,1,4,107,67,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,10,0,119,0,157,2,1,4,127,67,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,7,0,119,0,150,2,1,4,156,67,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,8,0,119,0,143,2,1,4,170,67,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,11,0,119,0,136,2,1,4,189,67,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,12,0,119,0,129,2,1,4,216,67,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,13,0,119,0,122,2,1,4,234,67,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,5,0,119,0,115,2,1,4,246,67,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,9,0,119,0,108,2,1,4,10,68,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,10,0,119,0,101,2,1,4,30,68,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,11,0,119,0,94,2,1,4,45,68,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,12,0,119,0,87,2,1,4,60,68,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,2,0,119,0,80,2,1,4,81,68,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,13,0,119,0,73,2,1,4,101,68,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,14,0,119,0,66,2,1,4,121,68,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,15,0,119,0,59,2,1,4,147,68,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,26,0,119,0,52,2,1,4,154,68,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,6,0,119,0,45,2,1,4,165,68,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,7,0,119,0,38,2,1,4,177,68,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,8,0,119,0,31,2,1,4,193,68,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,9,0,119,0,24,2,1,4,205,68,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,10,0,119,0,17,2,1,4,222,68,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,11,0,119,0,10,2,1,4,233,68,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,12,0,119,0,3,2,1,4,245,68,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,2,0,119,0,252,1,1,4,1,69,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,17,0,119,0,245,1,1,4,15,69,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,27,0,119,0,238,1,1,4,29,69,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,2,0,119,0,231,1,1,4,45,69,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,3,0,119,0,224,1,1,4,58,69,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,4,0,119,0,217,1,1,4,82,69,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,14,0,119,0,210,1,1,4,104,69,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,1,0,119,0,203,1,1,4,121,69,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,15,0,119,0,196,1,1,4,131,69,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,3,0,119,0,189,1,1,4,146,69,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,16,0,119,0,182,1,1,4,161,69,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,16,0,119,0,175,1,1,4,175,69,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,17,0,119,0,168,1,1,4,197,69,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,18,0,119,0,161,1,1,4,211,69,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,28,0,119,0,154,1,1,4,233,69,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,17,0,119,0,147,1,1,4,245,69,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,18,0,119,0,140,1,1,4,9,70,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,2,0,119,0,133,1,1,4,22,70,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,1,0,119,0,126,1,1,4,38,70,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,18,0,119,0,119,1,1,4,55,70,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,19,0,119,0,112,1,1,4,71,70,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,20,0,119,0,105,1,1,4,88,70,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,3,0,119,0,98,1,1,4,104,70,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,1,0,119,0,91,1,1,4,116,70,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,21,0,119,0,84,1,1,4,129,70,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,29,0,119,0,77,1,1,4,141,70,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,22,0,119,0,70,1,1,4,154,70,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,1,0,119,0,63,1,1,4,166,70,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,23,0,119,0,56,1,1,4,179,70,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,24,0,119,0,49,1,1,4,191,70,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,25,0,119,0,42,1,1,4,204,70,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,1,0,119,0,35,1,1,4,216,70,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,26,0,119,0,28,1,1,4,229,70,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,19,0,119,0,21,1,1,4,241,70,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,27,0,119,0,14,1,1,4,254,70,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,1,0,119,0,7,1,1,4,10,71,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,28,0,119,0,0,1,1,4,23,71,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,4,0,119,0,249,0,1,4,35,71,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,29,0,119,0,242,0,1,4,48,71,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,20,0,119,0,235,0,1,4,67,71,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,21,0,119,0,228,0,1,4,86,71,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,22,0,119,0,221,0,1,4,105,71,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,19,0,119,0,214,0,1,4,118,71,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,20,0,119,0,207,0,1,4,136,71,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,2,0,119,0,200,0,1,4,153,71,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,30,0,119,0,193,0,1,4,171,71,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,2,0,119,0,186,0,1,4,188,71,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,31,0,119,0,179,0,1,4,206,71,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,2,0,119,0,172,0,1,4,223,71,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,32,0,119,0,165,0,1,4,241,71,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,2,0,119,0,158,0,1,4,2,72,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,33,0,119,0,151,0,1,4,20,72,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,1,0,119,0,144,0,1,4,42,72,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,23,0,119,0,137,0,1,4,53,72,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,34,0,119,0,130,0,1,4,69,72,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,35,0,119,0,123,0,1,4,88,72,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,13,0,119,0,116,0,1,4,101,72,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,36,0,119,0,109,0,1,4,117,72,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,21,0,119,0,102,0,1,4,131,72,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,37,0,119,0,95,0,1,4,149,72,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,30,0,119,0,88,0,1,4,165,72,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,31,0,119,0,81,0,1,4,187,72,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,32,0,119,0,74,0,1,4,210,72,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,33,0,119,0,67,0,1,4,234,72,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,34,0,119,0,60,0,1,4,3,73,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,22,0,119,0,53,0,1,4,24,73,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,38,0,119,0,46,0,1,4,48,73,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,39,0,119,0,39,0,1,4,69,73,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,14,0,119,0,32,0,1,4,88,73,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,40,0,119,0,25,0,1,4,107,73,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,24,0,119,0,18,0,1,4,134,73,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,5,0,119,0,11,0,1,4,163,73,134,3,0,0,212,124,2,0,0,4,0,0,32,2,3,0,1,4,6,0,1,5,0,0,125,3,2,4,5,0,0,0,139,3,0,0,139,1,0,0,140,13,86,0,0,0,0,0,2,72,0,0,141,48,0,0,2,73,0,0,90,48,0,0,2,74,0,0,180,0,0,0,2,75,0,0,184,0,0,0,2,76,0,0,130,49,0,0,2,77,0,0,204,0,0,0,2,78,0,0,212,0,0,0,2,79,0,0,26,9,0,0,1,50,0,0,136,80,0,0,0,51,80,0,136,80,0,0,25,80,80,80,137,80,0,0,130,80,0,0,136,81,0,0,49,80,80,81,68,177,0,0,1,81,80,0,135,80,0,0,81,0,0,0,25,13,51,64,25,14,51,60,25,15,51,56,25,16,51,52,25,18,51,48,25,20,51,44,25,22,51,40,25,24,51,36,25,26,51,32,25,28,51,28,25,30,51,24,25,31,51,20,25,32,51,16,25,33,51,12,25,34,51,8,25,37,51,4,0,38,51,0,85,14,0,0,85,15,1,0,85,16,2,0,85,18,3,0,85,20,4,0,85,22,5,0,85,24,6,0,85,26,7,0,85,28,8,0,85,30,9,0,85,31,10,0,85,32,11,0,85,33,12,0,82,81,14,0,134,80,0,0,176,65,1,0,81,0,0,0,85,34,80,0,82,80,16,0,121,80,3,0,82,47,16,0,119,0,9,0,82,52,14,0,106,80,52,64,106,81,52,4,5,46,80,81,1,81,66,48,82,80,26,0,91,81,81,80,5,47,46,81,85,37,47,0,82,81,20,0,121,81,3,0,82,49,20,0,119,0,9,0,82,53,14,0,106,81,53,64,106,80,53,20,5,48,81,80,1,80,66,48,82,81,26,0,91,80,80,81,5,49,48,80,85,38,49,0,82,80,14,0,106,80,80,64,34,80,80,0,121,80,5,0,1,81,70,48,1,82,8,9,135,80,8,0,81,73,82,72,1,80,64,0,82,82,14,0,106,82,82,64,47,80,80,82,124,178,0,0,1,82,165,48,1,81,9,9,135,80,8,0,82,73,81,72,1,80,0,0,82,81,14,0,106,81,81,64,49,80,80,81,72,184,0,0,82,80,14,0,106,80,80,64,36,80,80,64,121,80,107,1,1,80,6,0,82,81,14,0,106,81,81,80,50,80,80,81,196,178,0,0,1,81,186,48,1,82,14,9,135,80,8,0,81,73,82,72,1,80,6,0,82,82,14,0,106,82,82,84,50,80,80,82,232,178,0,0,1,82,31,49,1,81,15,9,135,80,8,0,82,73,81,72,1,80,6,0,82,81,14,0,106,81,81,80,50,80,80,81,16,179,0,0,1,80,0,0,85,13,80,0,82,45,13,0,137,51,0,0,139,45,0,0,1,80,6,0,82,81,14,0,106,81,81,84,50,80,80,81,56,179,0,0,1,80,0,0,85,13,80,0,82,45,13,0,137,51,0,0,139,45,0,0,82,80,22,0,34,80,80,0,121,80,4,0,82,80,24,0,39,80,80,3,85,24,80,0,82,80,24,0,38,80,80,2,121,80,6,0,82,80,24,0,38,80,80,1,120,80,4,0,1,50,26,0,119,0,2,0,1,50,26,0,32,80,50,26,121,80,13,0,82,80,22,0,34,80,80,0,121,80,3,0,135,80,8,0,76,73,79,72,82,80,22,0,82,81,14,0,106,81,81,64,54,80,80,81,172,179,0,0,135,80,8,0,76,73,79,72,82,80,14,0,106,80,80,64,82,81,22,0,49,80,80,81,212,179,0,0,1,80,0,0,85,13,80,0,82,45,13,0,137,51,0,0,139,45,0,0,82,80,32,0,120,80,5,0,1,81,183,49,1,82,32,9,135,80,8,0,81,73,82,72,82,80,32,0,120,80,6,0,1,80,0,0,85,13,80,0,82,45,13,0,137,51,0,0,139,45,0,0,82,80,33,0,82,82,34,0,48,80,80,82,40,180,0,0,1,82,191,49,1,81,37,9,135,80,8,0,82,73,81,72,82,80,33,0,82,81,34,0,48,80,80,81,76,180,0,0,1,80,0,0,85,13,80,0,82,45,13,0,137,51,0,0,139,45,0,0,82,81,32,0,1,82,0,0,82,83,33,0,135,80,3,0,81,82,83,0,82,80,14,0,116,80,15,0,82,80,14,0,82,83,37,0,109,80,12,83,82,83,14,0,82,80,18,0,109,83,16,80,82,80,14,0,82,83,38,0,109,80,28,83,82,83,14,0,82,80,22,0,109,83,68,80,82,80,14,0,82,83,24,0,109,80,72,83,82,83,14,0,82,80,26,0,109,83,76,80,82,80,14,0,82,83,28,0,109,80,88,83,82,83,14,0,82,80,30,0,109,83,92,80,82,80,14,0,82,83,31,0,109,80,96,83,82,54,14,0,106,83,54,80,112,80,54,56,145,80,80,0,134,17,0,0,72,49,2,0,83,80,0,0,82,80,14,0,1,83,128,0,97,80,83,17,82,55,14,0,106,83,55,84,112,80,55,60,145,80,80,0,134,19,0,0,72,49,2,0,83,80,0,0,82,80,14,0,1,83,132,0,97,80,83,19,82,56,14,0,106,83,56,80,112,80,56,56,145,80,80,0,134,21,0,0,148,25,2,0,83,80,0,0,82,80,14,0,1,83,136,0,97,80,83,21,82,57,14,0,106,83,57,84,112,80,57,60,145,80,80,0,134,23,0,0,148,25,2,0,83,80,0,0,82,80,14,0,1,83,140,0,97,80,83,23,82,58,14,0,106,83,58,80,112,80,58,56,145,80,80,0,134,25,0,0,200,141,2,0,83,80,0,0,82,80,14,0,1,83,144,0,97,80,83,25,82,59,14,0,106,83,59,84,112,80,59,60,145,80,80,0,134,27,0,0,200,141,2,0,83,80,0,0,82,80,14,0,1,83,148,0,97,80,83,27,82,60,14,0,106,80,60,20,106,82,60,64,5,83,80,82,41,83,83,2,0,29,83,0,82,83,14,0,1,82,160,0,97,83,82,29,82,61,14,0,106,83,61,4,1,80,144,0,94,80,61,80,41,80,80,1,3,83,83,80,109,61,116,83,82,83,14,0,82,82,32,0,109,83,100,82,82,62,14,0,106,83,62,100,1,80,188,0,94,80,62,80,3,83,83,80,109,62,104,83,82,63,14,0,106,82,63,104,1,80,192,0,94,80,63,80,3,82,82,80,109,63,108,82,82,64,14,0,106,83,64,108,1,80,196,0,94,80,64,80,3,83,83,80,109,64,112,83,82,65,14,0,106,82,65,112,1,80,200,0,94,80,65,80,3,82,82,80,109,65,120,82,82,83,14,0,134,82,0,0,80,148,2,0,83,0,0,0,33,35,82,0,82,36,14,0,121,35,29,0,1,83,0,0,109,36,124,83,82,68,14,0,106,82,68,120,94,80,68,77,3,82,82,80,97,68,74,82,82,69,14,0,94,83,69,74,94,80,69,78,3,83,83,80,97,69,75,83,82,83,14,0,94,83,83,75,82,82,14,0,1,80,216,0,94,82,82,80,3,83,83,82,82,82,32,0,82,80,33,0,3,82,82,80,52,83,83,82,108,183,0,0,1,82,232,49,1,80,81,9,135,83,8,0,82,73,80,72,119,0,29,0,82,70,14,0,106,80,36,120,94,82,70,77,3,80,80,82,109,70,124,80,82,71,14,0,106,83,71,124,1,82,208,0,94,82,71,82,3,83,83,82,97,71,74,83,82,83,14,0,1,80,0,0,97,83,75,80,82,80,14,0,94,80,80,74,82,83,14,0,94,83,83,78,3,80,80,83,82,83,32,0,82,82,33,0,3,83,83,82,52,80,80,83,108,183,0,0,1,83,110,50,1,82,89,9,135,80,8,0,83,73,82,72,82,80,14,0,1,82,176,0,1,83,255,255,97,80,82,83,82,83,14,0,112,39,83,56,145,39,39,0,82,83,14,0,112,40,83,48,145,40,40,0,82,66,14,0,106,82,66,100,106,80,66,104,106,81,66,80,106,84,66,4,106,85,66,20,134,83,0,0,128,116,1,0,82,80,81,39,40,84,85,0,82,83,14,0,112,41,83,60,145,41,41,0,82,83,14,0,112,42,83,52,145,42,42,0,82,67,14,0,106,85,67,108,106,84,67,112,106,81,67,84,106,80,67,8,106,82,67,24,134,83,0,0,128,116,1,0,85,84,81,41,42,80,82,0,82,82,14,0,134,83,0,0,80,148,2,0,82,0,0,0,33,43,83,0,82,44,14,0,121,43,5,0,134,83,0,0,80,147,1,0,44,0,0,0,119,0,4,0,134,83,0,0,172,155,1,0,44,0,0,0,1,83,1,0,85,13,83,0,82,45,13,0,137,51,0,0,139,45,0,0,1,83,0,0,85,13,83,0,82,45,13,0,137,51,0,0,139,45,0,0,140,1,51,0,0,0,0,0,2,42,0,0,0,248,0,0,2,43,0,0,0,240,0,0,2,44,0,0,0,15,0,0,2,45,0,0,224,7,0,0,2,46,0,0,240,0,0,0,136,47,0,0,0,41,47,0,136,47,0,0,25,47,47,32,137,47,0,0,130,47,0,0,136,48,0,0,49,47,47,48,188,184,0,0,1,48,32,0,135,47,0,0,48,0,0,0,25,1,41,12,25,11,41,8,25,21,41,4,25,32,41,20,25,34,41,18,25,36,41,16,106,49,0,4,106,50,0,8,5,48,49,50,41,48,48,4,135,47,6,0,48,0,0,0,85,1,47,0,1,47,11,0,106,48,0,16,49,47,47,48,32,185,0,0,1,48,4,0,1,50,143,58,134,47,0,0,252,32,2,0,48,50,41,0,82,31,1,0,137,41,0,0,139,31,0,0,1,47,0,0,85,11,47,0,1,47,0,0,85,21,47,0,106,50,0,4,106,48,0,8,5,47,50,48,82,48,11,0,56,47,47,48,12,194,0,0,106,47,0,16,1,50,1,0,1,48,10,0,138,47,50,48,132,185,0,0,72,186,0,0,56,187,0,0,36,188,0,0,252,188,0,0,24,190,0,0,40,191,0,0,32,192,0,0,156,192,0,0,68,193,0,0,119,0,31,2,82,50,0,0,82,49,11,0,91,48,50,49,76,48,48,0,145,48,48,0,59,50,255,0,145,50,50,0,66,23,48,50,145,23,23,0,82,50,1,0,82,48,11,0,41,48,48,4,101,50,48,23,82,50,0,0,82,49,11,0,91,48,50,49,76,48,48,0,145,48,48,0,59,50,255,0,145,50,50,0,66,33,48,50,145,33,33,0,82,50,1,0,82,48,11,0,41,48,48,4,3,50,50,48,113,50,4,33,82,48,0,0,82,49,11,0,91,50,48,49,76,50,50,0,145,50,50,0,59,48,255,0,145,48,48,0,66,35,50,48,145,35,35,0,82,48,1,0,82,50,11,0,41,50,50,4,3,48,48,50,113,48,8,35,82,48,1,0,82,50,11,0,41,50,50,4,3,48,48,50,59,50,1,0,145,50,50,0,113,48,12,50,119,0,238,1,82,48,0,0,82,49,21,0,91,50,48,49,76,50,50,0,145,50,50,0,59,48,255,0,145,48,48,0,66,37,50,48,145,37,37,0,82,48,1,0,82,50,11,0,41,50,50,4,101,48,50,37,82,48,0,0,82,49,21,0,91,50,48,49,76,50,50,0,145,50,50,0,59,48,255,0,145,48,48,0,66,38,50,48,145,38,38,0,82,48,1,0,82,50,11,0,41,50,50,4,3,48,48,50,113,48,4,38,82,50,0,0,82,49,21,0,91,48,50,49,76,48,48,0,145,48,48,0,59,50,255,0,145,50,50,0,66,39,48,50,145,39,39,0,82,50,1,0,82,48,11,0,41,48,48,4,3,50,50,48,113,50,8,39,82,48,0,0,82,49,21,0,25,49,49,1,91,50,48,49,76,50,50,0,145,50,50,0,59,48,255,0,145,48,48,0,66,40,50,48,145,40,40,0,82,48,1,0,82,50,11,0,41,50,50,4,3,48,48,50,113,48,12,40,82,48,21,0,25,48,48,2,85,21,48,0,119,0,178,1,82,48,0,0,82,50,11,0,41,50,50,1,92,48,48,50,84,34,48,0,81,50,34,0,19,50,50,42,42,50,50,11,76,50,50,0,145,48,50,0,62,50,0,0,184,121,99,0,33,132,160,63,145,50,50,0,65,6,48,50,145,6,6,0,82,50,1,0,82,48,11,0,41,48,48,4,101,50,48,6,81,50,34,0,19,50,50,45,42,50,50,5,76,50,50,0,145,48,50,0,62,50,0,0,104,239,45,32,4,65,144,63,145,50,50,0,65,7,48,50,145,7,7,0,82,50,1,0,82,48,11,0,41,48,48,4,3,50,50,48,113,50,4,7,81,48,34,0,38,48,48,31,76,48,48,0,145,50,48,0,62,48,0,0,184,121,99,0,33,132,160,63,145,48,48,0,65,8,50,48,145,8,8,0,82,48,1,0,82,50,11,0,41,50,50,4,3,48,48,50,113,48,8,8,82,48,1,0,82,50,11,0,41,50,50,4,3,48,48,50,59,50,1,0,145,50,50,0,113,48,12,50,119,0,119,1,82,48,0,0,82,49,21,0,91,50,48,49,76,50,50,0,145,50,50,0,59,48,255,0,145,48,48,0,66,18,50,48,145,18,18,0,82,48,1,0,82,50,11,0,41,50,50,4,101,48,50,18,82,48,0,0,82,49,21,0,25,49,49,1,91,50,48,49,76,50,50,0,145,50,50,0,59,48,255,0,145,48,48,0,66,19,50,48,145,19,19,0,82,48,1,0,82,50,11,0,41,50,50,4,3,48,48,50,113,48,4,19,82,50,0,0,82,49,21,0,25,49,49,2,91,48,50,49,76,48,48,0,145,48,48,0,59,50,255,0,145,50,50,0,66,20,48,50,145,20,20,0,82,50,1,0,82,48,11,0,41,48,48,4,3,50,50,48,113,50,8,20,82,50,1,0,82,48,11,0,41,48,48,4,3,50,50,48,59,48,1,0,145,48,48,0,113,50,12,48,82,48,21,0,25,48,48,3,85,21,48,0,119,0,65,1,82,48,0,0,82,50,11,0,41,50,50,1,92,48,48,50,84,32,48,0,81,50,32,0,19,50,50,42,42,50,50,11,76,50,50,0,145,48,50,0,62,50,0,0,184,121,99,0,33,132,160,63,145,50,50,0,65,2,48,50,145,2,2,0,82,50,1,0,82,48,11,0,41,48,48,4,101,50,48,2,81,50,32,0,1,49,192,7,19,50,50,49,42,50,50,6,76,50,50,0,145,48,50,0,62,50,0,0,184,121,99,0,33,132,160,63,145,50,50,0,65,3,48,50,145,3,3,0,82,50,1,0,82,48,11,0,41,48,48,4,3,50,50,48,113,50,4,3,81,48,32,0,38,48,48,62,42,48,48,1,76,48,48,0,145,50,48,0,62,48,0,0,184,121,99,0,33,132,160,63,145,48,48,0,65,4,50,48,145,4,4,0,82,48,1,0,82,50,11,0,41,50,50,4,3,48,48,50,113,48,8,4,81,50,32,0,38,50,50,1,32,50,50,0,121,50,5,0,59,50,0,0,145,50,50,0,58,48,50,0,119,0,4,0,59,50,1,0,145,50,50,0,58,48,50,0,58,5,48,0,82,48,1,0,82,50,11,0,41,50,50,4,3,48,48,50,113,48,12,5,119,0,250,0,82,50,0,0,82,48,11,0,41,48,48,1,92,50,50,48,84,36,50,0,81,48,36,0,19,48,48,43,42,48,48,12,76,48,48,0,145,50,48,0,62,48,0,0,125,14,208,31,17,17,177,63,145,48,48,0,65,9,50,48,145,9,9,0,82,48,1,0,82,50,11,0,41,50,50,4,101,48,50,9,81,48,36,0,19,48,48,44,42,48,48,8,76,48,48,0,145,50,48,0,62,48,0,0,125,14,208,31,17,17,177,63,145,48,48,0,65,10,50,48,145,10,10,0,82,48,1,0,82,50,11,0,41,50,50,4,3,48,48,50,113,48,4,10,81,50,36,0,19,50,50,46,42,50,50,4,76,50,50,0,145,48,50,0,62,50,0,0,125,14,208,31,17,17,177,63,145,50,50,0,65,12,48,50,145,12,12,0,82,50,1,0,82,48,11,0,41,48,48,4,3,50,50,48,113,50,8,12,81,48,36,0,38,48,48,15,76,48,48,0,145,50,48,0,62,48,0,0,125,14,208,31,17,17,177,63,145,48,48,0,65,13,50,48,145,13,13,0,82,48,1,0,82,50,11,0,41,50,50,4,3,48,48,50,113,48,12,13,119,0,182,0,82,50,0,0,82,49,21,0,91,48,50,49,76,48,48,0,145,48,48,0,59,50,255,0,145,50,50,0,66,14,48,50,145,14,14,0,82,50,1,0,82,48,11,0,41,48,48,4,101,50,48,14,82,50,0,0,82,49,21,0,25,49,49,1,91,48,50,49,76,48,48,0,145,48,48,0,59,50,255,0,145,50,50,0,66,15,48,50,145,15,15,0,82,50,1,0,82,48,11,0,41,48,48,4,3,50,50,48,113,50,4,15,82,48,0,0,82,49,21,0,25,49,49,2,91,50,48,49,76,50,50,0,145,50,50,0,59,48,255,0,145,48,48,0,66,16,50,48,145,16,16,0,82,48,1,0,82,50,11,0,41,50,50,4,3,48,48,50,113,48,8,16,82,50,0,0,82,49,21,0,25,49,49,3,91,48,50,49,76,48,48,0,145,48,48,0,59,50,255,0,145,50,50,0,66,17,48,50,145,17,17,0,82,50,1,0,82,48,11,0,41,48,48,4,3,50,50,48,113,50,12,17,82,50,21,0,25,50,50,4,85,21,50,0,119,0,120,0,82,48,0,0,82,50,21,0,41,50,50,2,100,22,48,50,145,22,22,0,82,48,1,0,82,50,11,0,41,50,50,4,101,48,50,22,82,50,1,0,82,48,11,0,41,48,48,4,3,50,50,48,59,48,0,0,145,48,48,0,113,50,4,48,82,48,1,0,82,50,11,0,41,50,50,4,3,48,48,50,59,50,0,0,145,50,50,0,113,48,8,50,82,50,1,0,82,48,11,0,41,48,48,4,3,50,50,48,59,48,1,0,145,48,48,0,113,50,12,48,119,0,89,0,82,48,0,0,82,50,21,0,41,50,50,2,100,24,48,50,145,24,24,0,82,48,1,0,82,50,11,0,41,50,50,4,101,48,50,24,82,50,0,0,82,48,21,0,25,48,48,1,41,48,48,2,100,25,50,48,145,25,25,0,82,50,1,0,82,48,11,0,41,48,48,4,3,50,50,48,113,50,4,25,82,50,0,0,82,48,21,0,25,48,48,2,41,48,48,2,100,26,50,48,145,26,26,0,82,50,1,0,82,48,11,0,41,48,48,4,3,50,50,48,113,50,8,26,82,50,1,0,82,48,11,0,41,48,48,4,3,50,50,48,59,48,1,0,145,48,48,0,113,50,12,48,82,48,21,0,25,48,48,3,85,21,48,0,119,0,47,0,82,48,0,0,82,50,21,0,41,50,50,2,100,27,48,50,145,27,27,0,82,48,1,0,82,50,11,0,41,50,50,4,101,48,50,27,82,50,0,0,82,48,21,0,25,48,48,1,41,48,48,2,100,28,50,48,145,28,28,0,82,50,1,0,82,48,11,0,41,48,48,4,3,50,50,48,113,50,4,28,82,50,0,0,82,48,21,0,25,48,48,2,41,48,48,2,100,29,50,48,145,29,29,0,82,50,1,0,82,48,11,0,41,48,48,4,3,50,50,48,113,50,8,29,82,50,0,0,82,48,21,0,25,48,48,3,41,48,48,2,100,30,50,48,145,30,30,0,82,50,1,0,82,48,11,0,41,48,48,4,3,50,50,48,113,50,12,30,82,50,21,0,25,50,50,4,85,21,50,0,119,0,1,0,82,47,11,0,25,47,47,1,85,11,47,0,119,0,202,253,82,31,1,0,137,41,0,0,139,31,0,0,140,1,40,0,0,0,0,0,2,31,0,0,255,0,0,0,2,32,0,0,0,248,0,0,2,33,0,0,0,240,0,0,2,34,0,0,0,15,0,0,1,29,0,0,136,35,0,0,0,30,35,0,136,35,0,0,25,35,35,48,137,35,0,0,130,35,0,0,136,36,0,0,49,35,35,36,116,194,0,0,1,36,48,0,135,35,0,0,36,0,0,0,25,28,30,8,0,27,30,0,25,1,30,24,25,9,30,20,25,13,30,16,25,22,30,12,25,24,30,32,25,25,30,30,25,26,30,28,106,35,0,4,121,35,69,2,106,35,0,8,121,35,67,2,106,37,0,4,106,38,0,8,5,36,37,38,41,36,36,2,135,35,6,0,36,0,0,0,85,9,35,0,1,35,11,0,106,36,0,16,49,35,35,36,236,194,0,0,1,36,4,0,1,38,143,58,134,35,0,0,252,32,2,0,36,38,27,0,119,0,46,2,106,35,0,16,32,35,35,8,121,35,3,0,1,29,9,0,119,0,10,0,106,35,0,16,32,35,35,9,121,35,3,0,1,29,9,0,119,0,5,0,106,35,0,16,32,35,35,10,121,35,2,0,1,29,9,0,32,35,29,9,121,35,6,0,1,38,4,0,1,36,207,58,134,35,0,0,252,32,2,0,38,36,28,0,1,35,0,0,85,13,35,0,1,35,0,0,85,22,35,0,106,36,0,4,106,38,0,8,5,35,36,38,82,38,13,0,56,35,35,38,160,203,0,0,106,35,0,16,1,38,1,0,1,36,10,0,138,35,38,36,164,195,0,0,28,196,0,0,172,196,0,0,164,197,0,0,48,198,0,0,52,199,0,0,88,200,0,0,240,200,0,0,124,201,0,0,116,202,0,0,119,0,252,1,82,38,9,0,82,36,13,0,41,36,36,2,82,37,0,0,82,39,13,0,90,37,37,39,95,38,36,37,82,37,9,0,82,36,13,0,41,36,36,2,3,37,37,36,82,36,0,0,82,38,13,0,90,36,36,38,107,37,1,36,82,36,9,0,82,37,13,0,41,37,37,2,3,36,36,37,82,37,0,0,82,38,13,0,90,37,37,38,107,36,2,37,82,37,9,0,82,36,13,0,41,36,36,2,3,37,37,36,1,36,255,255,107,37,3,36,119,0,222,1,82,36,9,0,82,37,13,0,41,37,37,2,82,38,0,0,82,39,22,0,90,38,38,39,95,36,37,38,82,38,9,0,82,37,13,0,41,37,37,2,3,38,38,37,82,37,0,0,82,36,22,0,90,37,37,36,107,38,1,37,82,37,9,0,82,38,13,0,41,38,38,2,3,37,37,38,82,38,0,0,82,36,22,0,90,38,38,36,107,37,2,38,82,38,9,0,82,37,13,0,41,37,37,2,3,38,38,37,82,37,0,0,82,36,22,0,25,36,36,1,90,37,37,36,107,38,3,37,82,37,22,0,25,37,37,2,85,22,37,0,119,0,186,1,82,37,0,0,82,36,13,0,41,36,36,1,92,37,37,36,84,25,37,0,81,38,25,0,19,38,38,32,42,38,38,11,76,38,38,0,145,36,38,0,59,38,8,0,145,38,38,0,65,37,36,38,145,37,37,0,75,37,37,0,19,37,37,31,0,5,37,0,82,37,9,0,82,38,13,0,41,38,38,2,95,37,38,5,81,36,25,0,1,39,224,7,19,36,36,39,42,36,36,5,76,36,36,0,145,37,36,0,59,36,4,0,145,36,36,0,65,38,37,36,145,38,38,0,75,38,38,0,19,38,38,31,0,6,38,0,82,38,9,0,82,36,13,0,41,36,36,2,3,38,38,36,107,38,1,6,81,37,25,0,38,37,37,31,76,37,37,0,145,36,37,0,59,37,8,0,145,37,37,0,65,38,36,37,145,38,38,0,75,38,38,0,19,38,38,31,0,7,38,0,82,38,9,0,82,37,13,0,41,37,37,2,3,38,38,37,107,38,2,7,82,38,9,0,82,37,13,0,41,37,37,2,3,38,38,37,1,37,255,255,107,38,3,37,119,0,124,1,82,38,9,0,82,37,13,0,41,37,37,2,82,36,0,0,82,39,22,0,90,36,36,39,95,38,37,36,82,36,9,0,82,37,13,0,41,37,37,2,3,36,36,37,82,37,0,0,82,38,22,0,25,38,38,1,90,37,37,38,107,36,1,37,82,37,9,0,82,36,13,0,41,36,36,2,3,37,37,36,82,36,0,0,82,38,22,0,25,38,38,2,90,36,36,38,107,37,2,36,82,36,9,0,82,37,13,0,41,37,37,2,3,36,36,37,1,37,255,255,107,36,3,37,82,37,22,0,25,37,37,3,85,22,37,0,119,0,89,1,82,37,0,0,82,38,13,0,41,38,38,1,92,37,37,38,84,24,37,0,81,36,24,0,19,36,36,32,42,36,36,11,76,36,36,0,145,38,36,0,59,36,8,0,145,36,36,0,65,37,38,36,145,37,37,0,75,37,37,0,19,37,37,31,0,2,37,0,82,37,9,0,82,36,13,0,41,36,36,2,95,37,36,2,81,38,24,0,1,39,192,7,19,38,38,39,42,38,38,6,76,38,38,0,145,37,38,0,59,38,8,0,145,38,38,0,65,36,37,38,145,36,36,0,75,36,36,0,19,36,36,31,0,3,36,0,82,36,9,0,82,38,13,0,41,38,38,2,3,36,36,38,107,36,1,3,81,37,24,0,38,37,37,62,42,37,37,1,76,37,37,0,145,38,37,0,59,37,8,0,145,37,37,0,65,36,38,37,145,36,36,0,75,36,36,0,19,36,36,31,0,4,36,0,82,36,9,0,82,37,13,0,41,37,37,2,3,36,36,37,107,36,2,4,82,36,9,0,82,37,13,0,41,37,37,2,3,36,36,37,81,37,24,0,38,37,37,1,5,37,37,31,107,36,3,37,119,0,24,1,82,37,0,0,82,38,13,0,41,38,38,1,92,37,37,38,84,26,37,0,81,36,26,0,19,36,36,33,42,36,36,12,76,36,36,0,145,38,36,0,59,36,17,0,145,36,36,0,65,37,38,36,145,37,37,0,75,37,37,0,19,37,37,31,0,8,37,0,82,37,9,0,82,36,13,0,41,36,36,2,95,37,36,8,81,38,26,0,19,38,38,34,42,38,38,8,76,38,38,0,145,37,38,0,59,38,17,0,145,38,38,0,65,36,37,38,145,36,36,0,75,36,36,0,19,36,36,31,0,10,36,0,82,36,9,0,82,38,13,0,41,38,38,2,3,36,36,38,107,36,1,10,81,37,26,0,1,39,240,0,19,37,37,39,42,37,37,4,76,37,37,0,145,38,37,0,59,37,17,0,145,37,37,0,65,36,38,37,145,36,36,0,75,36,36,0,19,36,36,31,0,11,36,0], eb + 40960);
  HEAPU8.set([82,36,9,0,82,37,13,0,41,37,37,2,3,36,36,37,107,36,2,11,81,38,26,0,38,38,38,15,76,38,38,0,145,37,38,0,59,38,17,0,145,38,38,0,65,36,37,38,145,36,36,0,75,36,36,0,19,36,36,31,0,12,36,0,82,36,9,0,82,38,13,0,41,38,38,2,3,36,36,38,107,36,3,12,119,0,207,0,82,36,9,0,82,38,13,0,41,38,38,2,82,37,0,0,82,39,22,0,90,37,37,39,95,36,38,37,82,37,9,0,82,38,13,0,41,38,38,2,3,37,37,38,82,38,0,0,82,36,22,0,25,36,36,1,90,38,38,36,107,37,1,38,82,38,9,0,82,37,13,0,41,37,37,2,3,38,38,37,82,37,0,0,82,36,22,0,25,36,36,2,90,37,37,36,107,38,2,37,82,37,9,0,82,38,13,0,41,38,38,2,3,37,37,38,82,38,0,0,82,36,22,0,25,36,36,3,90,38,38,36,107,37,3,38,82,38,22,0,25,38,38,4,85,22,38,0,119,0,169,0,82,38,0,0,82,39,22,0,41,39,39,2,100,36,38,39,145,36,36,0,59,38,255,0,145,38,38,0,65,37,36,38,145,37,37,0,75,37,37,0,19,37,37,31,0,14,37,0,82,37,9,0,82,38,13,0,41,38,38,2,95,37,38,14,82,38,9,0,82,37,13,0,41,37,37,2,3,38,38,37,1,37,0,0,107,38,1,37,82,37,9,0,82,38,13,0,41,38,38,2,3,37,37,38,1,38,0,0,107,37,2,38,82,38,9,0,82,37,13,0,41,37,37,2,3,38,38,37,1,37,255,255,107,38,3,37,119,0,134,0,82,36,0,0,82,39,22,0,41,39,39,2,100,38,36,39,145,38,38,0,59,36,255,0,145,36,36,0,65,37,38,36,145,37,37,0,75,37,37,0,19,37,37,31,0,15,37,0,82,37,9,0,82,36,13,0,41,36,36,2,95,37,36,15,82,38,0,0,82,39,22,0,25,39,39,1,41,39,39,2,100,37,38,39,145,37,37,0,59,38,255,0,145,38,38,0,65,36,37,38,145,36,36,0,75,36,36,0,19,36,36,31,0,16,36,0,82,36,9,0,82,38,13,0,41,38,38,2,3,36,36,38,107,36,1,16,82,37,0,0,82,39,22,0,25,39,39,2,41,39,39,2,100,38,37,39,145,38,38,0,59,37,255,0,145,37,37,0,65,36,38,37,145,36,36,0,75,36,36,0,19,36,36,31,0,17,36,0,82,36,9,0,82,37,13,0,41,37,37,2,3,36,36,37,107,36,2,17,82,36,9,0,82,37,13,0,41,37,37,2,3,36,36,37,1,37,255,255,107,36,3,37,82,37,22,0,25,37,37,3,85,22,37,0,119,0,72,0,82,38,0,0,82,39,22,0,41,39,39,2,100,36,38,39,145,36,36,0,59,38,255,0,145,38,38,0,65,37,36,38,145,37,37,0,75,37,37,0,19,37,37,31,0,18,37,0,82,37,9,0,82,38,13,0,41,38,38,2,95,37,38,18,82,36,0,0,82,39,22,0,41,39,39,2,100,37,36,39,145,37,37,0,59,36,255,0,145,36,36,0,65,38,37,36,145,38,38,0,75,38,38,0,19,38,38,31,0,19,38,0,82,38,9,0,82,36,13,0,41,36,36,2,3,38,38,36,107,38,1,19,82,37,0,0,82,39,22,0,41,39,39,2,100,36,37,39,145,36,36,0,59,37,255,0,145,37,37,0,65,38,36,37,145,38,38,0,75,38,38,0,19,38,38,31,0,20,38,0,82,38,9,0,82,37,13,0,41,37,37,2,3,38,38,37,107,38,2,20,82,36,0,0,82,39,22,0,41,39,39,2,100,37,36,39,145,37,37,0,59,36,255,0,145,36,36,0,65,38,37,36,145,38,38,0,75,38,38,0,19,38,38,31,0,21,38,0,82,38,9,0,82,36,13,0,41,36,36,2,3,38,38,36,107,38,3,21,82,38,22,0,25,38,38,4,85,22,38,0,119,0,1,0,82,35,13,0,25,35,35,1,85,13,35,0,119,0,237,253,116,1,9,0,82,23,1,0,137,30,0,0,139,23,0,0,1,35,0,0,85,1,35,0,82,23,1,0,137,30,0,0,139,23,0,0,140,6,102,0,0,0,0,0,2,87,0,0,138,29,0,0,2,88,0,0,139,29,0,0,2,89,0,0,134,29,0,0,2,90,0,0,133,29,0,0,2,91,0,0,135,29,0,0,2,92,0,0,136,29,0,0,136,93,0,0,0,86,93,0,136,93,0,0,25,93,93,64,137,93,0,0,130,93,0,0,136,94,0,0,49,93,93,94,44,204,0,0,1,94,64,0,135,93,0,0,94,0,0,0,25,70,86,52,25,71,86,48,25,76,86,44,25,81,86,40,25,6,86,36,25,10,86,32,25,16,86,28,25,21,86,24,25,25,86,4,0,30,86,0,89,70,1,0,85,71,2,0,85,76,3,0,85,81,4,0,88,93,70,0,145,93,93,0,59,94,0,0,145,94,94,0,72,93,93,94,121,93,6,0,62,93,0,0,148,28,229,157,153,153,185,63,145,93,93,0,89,70,93,0,82,93,76,0,82,94,71,0,47,93,93,94,172,204,0,0,116,6,71,0,116,71,76,0,116,76,6,0,82,93,81,0,34,93,93,4,121,93,59,0,59,98,1,0,145,98,98,0,61,100,0,0,0,0,0,63,145,100,100,0,88,101,70,0,145,101,101,0,66,99,100,101,145,99,99,0,64,97,98,99,145,97,97,0,59,99,2,0,135,96,10,0,97,99,0,0,145,96,96,0,59,99,2,0,145,99,99,0,65,95,96,99,145,95,95,0,59,99,1,0,145,99,99,0,64,94,95,99,145,94,94,0,134,93,0,0,44,170,1,0,94,0,0,0,145,93,93,0,89,10,93,0,82,93,76,0,82,94,71,0,4,67,93,94,76,94,67,0,145,67,94,0,62,96,0,0,80,53,221,95,251,33,25,64,145,96,96,0,88,97,10,0,145,97,97,0,66,95,96,97,145,95,95,0,135,99,11,0,95,0,0,0,145,99,99,0,65,93,67,99,145,93,93,0,59,99,104,1,145,99,99,0,66,94,93,99,145,94,94,0,75,68,94,0,85,81,68,0,82,99,81,0,36,99,99,0,1,93,4,0,125,94,99,93,68,0,0,0,85,81,94,0,82,94,76,0,82,93,71,0,4,69,94,93,76,93,69,0,145,69,93,0,82,94,81,0,76,94,94,0,145,94,94,0,66,93,69,94,145,93,93,0,89,16,93,0,82,93,71,0,76,93,93,0,145,93,93,0,89,21,93,0,82,94,81,0,41,94,94,2,28,94,94,2,134,93,0,0,52,143,2,0,94,0,0,0,121,93,3,0,134,93,0,0,112,155,2,0,134,93,0,0,40,236,1,0,25,0,0,0,82,94,25,0,134,93,0,0,172,190,1,0,94,0,0,0,1,94,7,0,134,93,0,0,152,178,1,0,94,0,0,0,1,93,0,0,85,30,93,0,82,93,81,0,28,93,93,2,82,94,30,0,56,93,93,94,168,210,0,0,78,94,5,0,102,99,5,1,102,95,5,2,102,97,5,3,134,93,0,0,112,28,2,0,94,99,95,97,1,93,20,118,88,72,93,0,145,72,72,0,1,97,40,118,82,93,97,0,76,93,93,0,145,93,93,0,66,73,72,93,145,73,73,0,1,93,24,118,88,74,93,0,145,74,74,0,1,99,44,118,82,95,99,0,76,95,95,0,145,95,95,0,66,97,74,95,145,97,97,0,134,93,0,0,196,98,2,0,73,97,0,0,88,75,0,0,145,75,75,0,112,97,0,4,145,97,97,0,134,93,0,0,216,140,2,0,75,97,0,0,1,93,20,118,88,77,93,0,145,77,77,0,1,97,40,118,82,93,97,0,76,93,93,0,145,93,93,0,66,78,77,93,145,78,78,0,1,93,24,118,88,79,93,0,145,79,79,0,1,97,32,118,88,93,97,0,145,93,93,0,63,80,79,93,145,80,80,0,1,99,44,118,82,95,99,0,76,95,95,0,145,95,95,0,66,97,80,95,145,97,97,0,134,93,0,0,196,98,2,0,78,97,0,0,88,82,0,0,145,82,82,0,88,97,21,0,145,97,97,0,62,95,0,0,20,25,67,160,70,223,145,63,145,95,95,0,65,93,97,95,145,93,93,0,135,83,12,0,93,0,0,0,145,83,83,0,88,95,70,0,145,95,95,0,65,93,83,95,145,93,93,0,63,84,82,93,145,84,84,0,112,85,0,4,145,85,85,0,88,95,21,0,145,95,95,0,62,97,0,0,20,25,67,160,70,223,145,63,145,97,97,0,65,93,95,97,145,93,93,0,135,7,13,0,93,0,0,0,145,7,7,0,88,99,70,0,145,99,99,0,65,95,7,99,145,95,95,0,63,97,85,95,145,97,97,0,134,93,0,0,216,140,2,0,84,97,0,0,1,93,20,118,88,8,93,0,145,8,8,0,1,97,28,118,88,93,97,0,145,93,93,0,63,9,8,93,145,9,9,0,1,97,40,118,82,93,97,0,76,93,93,0,145,93,93,0,66,11,9,93,145,11,11,0,1,93,24,118,88,12,93,0,145,12,12,0,1,97,32,118,88,93,97,0,145,93,93,0,63,13,12,93,145,13,13,0,1,99,44,118,82,95,99,0,76,95,95,0,145,95,95,0,66,97,13,95,145,97,97,0,134,93,0,0,196,98,2,0,11,97,0,0,88,14,0,0,145,14,14,0,88,15,21,0,145,15,15,0,88,95,16,0,145,95,95,0,63,97,15,95,145,97,97,0,62,95,0,0,20,25,67,160,70,223,145,63,145,95,95,0,65,93,97,95,145,93,93,0,135,17,12,0,93,0,0,0,145,17,17,0,88,95,70,0,145,95,95,0,65,93,17,95,145,93,93,0,63,18,14,93,145,18,18,0,112,19,0,4,145,19,19,0,88,20,21,0,145,20,20,0,88,97,16,0,145,97,97,0,63,95,20,97,145,95,95,0,62,97,0,0,20,25,67,160,70,223,145,63,145,97,97,0,65,93,95,97,145,93,93,0,135,22,13,0,93,0,0,0,145,22,22,0,88,99,70,0,145,99,99,0,65,95,22,99,145,95,95,0,63,97,19,95,145,97,97,0,134,93,0,0,216,140,2,0,18,97,0,0,1,93,20,118,88,23,93,0,145,23,23,0,1,97,28,118,88,93,97,0,145,93,93,0,63,24,23,93,145,24,24,0,1,97,40,118,82,93,97,0,76,93,93,0,145,93,93,0,66,26,24,93,145,26,26,0,1,93,24,118,88,27,93,0,145,27,27,0,1,99,44,118,82,95,99,0,76,95,95,0,145,95,95,0,66,97,27,95,145,97,97,0,134,93,0,0,196,98,2,0,26,97,0,0,88,28,0,0,145,28,28,0,88,29,21,0,145,29,29,0,88,99,16,0,145,99,99,0,59,94,2,0,145,94,94,0,65,95,99,94,145,95,95,0,63,97,29,95,145,97,97,0,62,95,0,0,20,25,67,160,70,223,145,63,145,95,95,0,65,93,97,95,145,93,93,0,135,31,12,0,93,0,0,0,145,31,31,0,88,95,70,0,145,95,95,0,65,93,31,95,145,93,93,0,63,32,28,93,145,32,32,0,112,33,0,4,145,33,33,0,88,34,21,0,145,34,34,0,88,94,16,0,145,94,94,0,59,99,2,0,145,99,99,0,65,97,94,99,145,97,97,0,63,95,34,97,145,95,95,0,62,97,0,0,20,25,67,160,70,223,145,63,145,97,97,0,65,93,95,97,145,93,93,0,135,35,13,0,93,0,0,0,145,35,35,0,88,99,70,0,145,99,99,0,65,95,35,99,145,95,95,0,63,97,33,95,145,97,97,0,134,93,0,0,216,140,2,0,32,97,0,0,88,93,16,0,145,93,93,0,59,97,2,0,145,97,97,0,65,36,93,97,145,36,36,0,88,93,21,0,145,93,93,0,63,97,93,36,145,97,97,0,89,21,97,0,82,97,30,0,25,97,97,1,85,30,97,0,119,0,228,254,82,97,81,0,30,97,97,2,120,97,7,0,134,97,0,0,244,122,1,0,134,97,0,0,12,157,2,0,137,86,0,0,139,0,0,0,78,93,5,0,102,95,5,1,102,99,5,2,102,94,5,3,134,97,0,0,112,28,2,0,93,95,99,94,1,97,20,118,88,37,97,0,145,37,37,0,1,94,40,118,82,97,94,0,76,97,97,0,145,97,97,0,66,38,37,97,145,38,38,0,1,97,24,118,88,39,97,0,145,39,39,0,1,95,44,118,82,99,95,0,76,99,99,0,145,99,99,0,66,94,39,99,145,94,94,0,134,97,0,0,196,98,2,0,38,94,0,0,88,40,0,0,145,40,40,0,112,94,0,4,145,94,94,0,134,97,0,0,216,140,2,0,40,94,0,0,1,97,20,118,88,41,97,0,145,41,41,0,1,94,40,118,82,97,94,0,76,97,97,0,145,97,97,0,66,42,41,97,145,42,42,0,1,97,24,118,88,43,97,0,145,43,43,0,1,94,32,118,88,97,94,0,145,97,97,0,63,44,43,97,145,44,44,0,1,95,44,118,82,99,95,0,76,99,99,0,145,99,99,0,66,94,44,99,145,94,94,0,134,97,0,0,196,98,2,0,42,94,0,0,88,45,0,0,145,45,45,0,88,94,21,0,145,94,94,0,62,99,0,0,20,25,67,160,70,223,145,63,145,99,99,0,65,97,94,99,145,97,97,0,135,46,12,0,97,0,0,0,145,46,46,0,88,99,70,0,145,99,99,0,65,97,46,99,145,97,97,0,63,47,45,97,145,47,47,0,112,48,0,4,145,48,48,0,88,99,21,0,145,99,99,0,62,94,0,0,20,25,67,160,70,223,145,63,145,94,94,0,65,97,99,94,145,97,97,0,135,49,13,0,97,0,0,0,145,49,49,0,88,95,70,0,145,95,95,0,65,99,49,95,145,99,99,0,63,94,48,99,145,94,94,0,134,97,0,0,216,140,2,0,47,94,0,0,1,97,20,118,88,50,97,0,145,50,50,0,1,94,28,118,88,97,94,0,145,97,97,0,63,51,50,97,145,51,51,0,1,94,40,118,82,97,94,0,76,97,97,0,145,97,97,0,66,52,51,97,145,52,52,0,1,97,24,118,88,53,97,0,145,53,53,0,1,94,32,118,88,97,94,0,145,97,97,0,63,54,53,97,145,54,54,0,1,95,44,118,82,99,95,0,76,99,99,0,145,99,99,0,66,94,54,99,145,94,94,0,134,97,0,0,196,98,2,0,52,94,0,0,88,55,0,0,145,55,55,0,88,56,21,0,145,56,56,0,88,99,16,0,145,99,99,0,63,94,56,99,145,94,94,0,62,99,0,0,20,25,67,160,70,223,145,63,145,99,99,0,65,97,94,99,145,97,97,0,135,57,12,0,97,0,0,0,145,57,57,0,88,99,70,0,145,99,99,0,65,97,57,99,145,97,97,0,63,58,55,97,145,58,58,0,112,59,0,4,145,59,59,0,88,60,21,0,145,60,60,0,88,94,16,0,145,94,94,0,63,99,60,94,145,99,99,0,62,94,0,0,20,25,67,160,70,223,145,63,145,94,94,0,65,97,99,94,145,97,97,0,135,61,13,0,97,0,0,0,145,61,61,0,88,95,70,0,145,95,95,0,65,99,61,95,145,99,99,0,63,94,59,99,145,94,94,0,134,97,0,0,216,140,2,0,58,94,0,0,1,97,20,118,88,62,97,0,145,62,62,0,1,94,28,118,88,97,94,0,145,97,97,0,63,63,62,97,145,63,63,0,1,94,40,118,82,97,94,0,76,97,97,0,145,97,97,0,66,64,63,97,145,64,64,0,1,97,24,118,88,65,97,0,145,65,65,0,1,95,44,118,82,99,95,0,76,99,99,0,145,99,99,0,66,94,65,99,145,94,94,0,134,97,0,0,196,98,2,0,64,94,0,0,88,66,0,0,145,66,66,0,112,94,0,4,145,94,94,0,134,97,0,0,216,140,2,0,66,94,0,0,134,97,0,0,244,122,1,0,134,97,0,0,12,157,2,0,137,86,0,0,139,0,0,0,140,2,56,0,0,0,0,0,2,46,0,0,245,28,0,0,2,47,0,0,73,29,0,0,2,48,0,0,251,28,0,0,2,49,0,0,74,29,0,0,1,42,0,0,136,50,0,0,0,43,50,0,136,50,0,0,1,51,224,1,3,50,50,51,137,50,0,0,130,50,0,0,136,51,0,0,49,50,50,51,160,214,0,0,1,51,224,1,135,50,0,0,51,0,0,0,1,50,152,0,3,39,43,50,1,50,144,0,3,38,43,50,1,50,136,0,3,37,43,50,1,50,128,0,3,35,43,50,25,34,43,120,25,33,43,112,25,32,43,104,25,31,43,96,25,30,43,88,25,29,43,80,25,28,43,72,25,27,43,64,25,26,43,56,25,25,43,48,25,24,43,40,25,23,43,32,25,22,43,24,25,40,43,16,25,36,43,8,0,21,43,0,1,50,208,1,3,11,43,50,1,50,204,1,3,13,43,50,1,50,200,1,3,14,43,50,1,50,196,1,3,15,43,50,1,50,192,1,3,16,43,50,1,50,188,1,3,18,43,50,1,50,184,1,3,19,43,50,1,50,180,1,3,20,43,50,1,50,176,1,3,2,43,50,1,50,212,1,3,3,43,50,1,50,168,1,3,4,43,50,1,50,104,1,3,5,43,50,1,50,100,1,3,6,43,50,1,50,96,1,3,7,43,50,1,50,32,1,3,8,43,50,1,50,224,0,3,9,43,50,1,50,160,0,3,10,43,50,85,11,0,0,85,13,1,0,1,51,0,31,135,50,14,0,51,0,0,0,85,21,50,0,1,51,3,0,1,52,5,31,134,50,0,0,252,32,2,0,51,52,21,0,1,52,1,31,135,50,14,0,52,0,0,0,85,36,50,0,1,52,3,0,1,51,23,31,134,50,0,0,252,32,2,0,52,51,36,0,1,51,2,31,135,50,14,0,51,0,0,0,85,40,50,0,1,51,3,0,1,52,41,31,134,50,0,0,252,32,2,0,51,52,40,0,2,52,0,0,140,139,0,0,135,50,14,0,52,0,0,0,85,22,50,0,1,52,3,0,1,51,59,31,134,50,0,0,252,32,2,0,52,51,22,0,1,50,0,0,85,14,50,0,1,51,0,8,135,50,6,0,51,0,0,0,85,15,50,0,1,51,3,31,135,50,14,0,51,0,0,0,85,16,50,0,82,51,16,0,135,50,15,0,51,0,0,0,25,50,50,1,85,18,50,0,82,51,18,0,1,52,1,0,134,50,0,0,252,144,2,0,51,52,0,0,85,19,50,0,82,52,19,0,82,51,16,0,135,50,16,0,52,51,0,0,82,50,15,0,82,51,14,0,41,51,51,2,82,52,19,0,97,50,51,52,1,52,0,0,85,20,52,0,82,52,18,0,82,51,20,0,56,52,52,51,20,217,0,0,82,52,19,0,82,51,20,0,90,52,52,51,32,52,52,32,121,52,16,0,82,52,19,0,82,51,20,0,1,50,0,0,95,52,51,50,82,50,14,0,25,50,50,1,85,14,50,0,82,50,15,0,82,51,14,0,41,51,51,2,82,52,19,0,82,53,20,0,25,53,53,1,3,52,52,53,97,50,51,52,82,52,20,0,25,52,52,1,85,20,52,0,119,0,229,255,116,23,14,0,1,51,3,0,1,50,77,31,134,52,0,0,252,32,2,0,51,50,23,0,1,52,0,0,85,2,52,0,82,17,15,0,82,52,14,0,82,50,2,0,56,52,52,50,136,220,0,0,82,50,2,0,41,50,50,2,94,50,17,50,1,51,112,31,134,52,0,0,212,124,2,0,50,51,0,0,120,52,31,0,1,52,40,117,1,50,48,73,135,51,17,0,50,0,0,0,85,52,51,0,1,51,236,115,1,50,3,73,135,52,17,0,50,0,0,0,85,51,52,0,1,52,36,117,1,50,24,73,135,51,17,0,50,0,0,0,85,52,51,0,1,51,40,117,82,51,51,0,33,51,51,0,1,52,236,115,82,52,52,0,33,52,52,0,19,51,51,52,1,52,36,117,82,52,52,0,33,52,52,0,19,51,51,52,121,51,4,0,1,51,161,120,1,52,1,0,83,51,52,0,82,51,15,0,82,50,2,0,41,50,50,2,94,51,51,50,1,50,139,31,134,52,0,0,212,124,2,0,51,50,0,0,120,52,4,0,1,52,163,120,1,50,1,0,83,52,50,0,82,52,15,0,82,51,2,0,41,51,51,2,94,52,52,51,1,51,159,31,134,50,0,0,212,124,2,0,52,51,0,0,120,50,4,0,1,50,164,120,1,51,1,0,83,50,51,0,82,50,15,0,82,52,2,0,41,52,52,2,94,50,50,52,1,52,231,31,134,51,0,0,212,124,2,0,50,52,0,0,120,51,3,0,1,42,18,0,119,0,22,0,82,52,15,0,82,50,2,0,41,50,50,2,94,52,52,50,1,50,7,32,134,51,0,0,212,124,2,0,52,50,0,0,120,51,3,0,1,42,18,0,119,0,11,0,82,50,15,0,82,52,2,0,41,52,52,2,94,50,50,52,1,52,40,32,134,51,0,0,212,124,2,0,50,52,0,0,120,51,2,0,1,42,18,0,32,51,42,18,121,51,5,0,1,42,0,0,1,51,165,120,1,52,1,0,83,51,52,0,82,51,15,0,82,50,2,0,41,50,50,2,94,51,51,50,1,50,80,32,134,52,0,0,212,124,2,0,51,50,0,0,120,52,3,0,1,42,21,0,119,0,11,0,82,50,15,0,82,51,2,0,41,51,51,2,94,50,50,51,1,51,116,32,134,52,0,0,212,124,2,0,50,51,0,0,120,52,2,0,1,42,21,0,32,52,42,21,121,52,5,0,1,42,0,0,1,52,166,120,1,51,1,0,83,52,51,0,82,52,15,0,82,50,2,0,41,50,50,2,94,52,52,50,1,50,149,32,134,51,0,0,212,124,2,0,52,50,0,0,120,51,4,0,1,51,167,120,1,50,1,0,83,51,50,0,82,51,15,0,82,52,2,0,41,52,52,2,94,51,51,52,1,52,174,32,134,50,0,0,212,124,2,0,51,52,0,0,120,50,4,0,1,50,168,120,1,52,1,0,83,50,52,0,82,50,15,0,82,51,2,0,41,51,51,2,94,50,50,51,1,51,207,32,134,52,0,0,212,124,2,0,50,51,0,0,120,52,4,0,1,52,169,120,1,51,1,0,83,52,51,0,82,52,15,0,82,50,2,0,41,50,50,2,94,52,52,50,1,50,243,32,134,51,0,0,212,124,2,0,52,50,0,0,120,51,9,0,1,51,170,120,1,50,1,0,83,51,50,0,2,51,0,0,255,132,0,0,1,52,32,117,135,50,18,0,51,52,0,0,82,52,15,0,82,51,2,0,41,51,51,2,94,52,52,51,1,51,21,33,134,50,0,0,212,124,2,0,52,51,0,0,120,50,4,0,1,50,162,120,1,51,1,0,83,50,51,0,82,50,15,0,82,52,2,0,41,52,52,2,94,50,50,52,1,52,49,33,134,51,0,0,212,124,2,0,50,52,0,0,120,51,4,0,1,51,171,120,1,52,1,0,83,51,52,0,82,52,2,0,25,52,52,1,85,2,52,0,119,0,44,255,135,52,5,0,17,0,0,0,82,51,19,0,135,52,5,0,51,0,0,0,1,52,161,120,78,52,52,0,38,52,52,1,121,52,7,0,1,51,3,0,1,50,69,33,134,52,0,0,252,32,2,0,51,50,24,0,119,0,6,0,1,50,4,0,1,51,144,33,134,52,0,0,252,32,2,0,50,51,25,0,1,52,163,120,78,52,52,0,38,52,52,1,121,52,7,0,1,51,3,0,1,50,205,33,134,52,0,0,252,32,2,0,51,50,26,0,119,0,6,0,1,50,4,0,1,51,24,34,134,52,0,0,252,32,2,0,50,51,27,0,1,52,165,120,78,52,52,0,38,52,52,1,121,52,6,0,1,51,3,0,1,50,116,34,134,52,0,0,252,32,2,0,51,50,28,0,1,52,166,120,78,52,52,0,38,52,52,1,121,52,6,0,1,50,3,0,1,51,162,34,134,52,0,0,252,32,2,0,50,51,29,0,1,52,167,120,78,52,52,0,38,52,52,1,121,52,6,0,1,51,3,0,1,50,209,34,134,52,0,0,252,32,2,0,51,50,30,0,1,52,168,120,78,52,52,0,38,52,52,1,121,52,6,0,1,50,3,0,1,51,4,35,134,52,0,0,252,32,2,0,50,51,31,0,1,52,169,120,78,52,52,0,38,52,52,1,121,52,6,0,1,51,3,0,1,50,51,35,134,52,0,0,252,32,2,0,51,50,32,0,1,52,170,120,78,52,52,0,38,52,52,1,121,52,10,0,1,50,32,117,88,52,50,0,145,52,52,0,87,33,52,0,1,50,3,0,1,51,98,35,134,52,0,0,252,32,2,0,50,51,33,0,1,52,162,120,78,52,52,0,38,52,52,1,121,52,6,0,1,51,3,0,1,50,164,35,134,52,0,0,252,32,2,0,51,50,34,0,1,52,171,120,78,52,52,0,38,52,52,1,121,52,6,0,1,50,3,0,1,51,217,35,134,52,0,0,252,32,2,0,50,51,35,0,1,52,252,35,78,52,52,0,83,3,52,0,1,51,253,35,78,51,51,0,107,3,1,51,1,52,254,35,78,52,52,0,107,3,2,52,1,51,255,35,78,51,51,0,107,3,3,51,1,51,224,115,1,50,1,0,1,53,1,0,1,54,7,0,1,55,1,0,134,52,0,0,8,70,1,0,3,50,53,54,55,0,0,0,85,51,52,0,1,52,224,115,82,52,52,0,121,52,10,0,1,52,224,115,82,52,52,0,85,37,52,0,1,51,3,0,1,55,0,36,134,52,0,0,252,32,2,0,51,55,37,0,119,0,6,0,1,55,4,0,1,51,51,36,134,52,0,0,252,32,2,0,55,51,38,0,134,52,0,0,132,201,1,0,4,0,0,0,1,52,44,117,82,51,4,0,85,52,51,0,1,51,48,117,106,52,4,4,85,51,52,0,1,52,228,115,1,51,44,117,82,51,51,0,85,52,51,0,1,51,232,115,1,52,48,117,82,52,52,0,85,51,52,0,134,52,0,0,248,79,1,0,134,52,0,0,124,116,2,0,5,0,0,0,1,41,148,115,0,44,5,0,25,45,41,64,116,41,44,0,25,41,41,4,25,44,44,4,54,52,41,45,68,223,0,0,1,52,212,115,1,55,0,16,135,51,6,0,55,0,0,0,85,52,51,0,1,51,0,0,85,6,51,0,1,51,0,1,82,52,6,0,56,51,51,52,4,224,0,0,1,51,212,115,82,51,51,0,82,52,6,0,41,52,52,4,1,55,7,0,97,51,52,55,1,55,212,115,82,55,55,0,82,52,6,0,41,52,52,4,3,55,55,52,1,52,0,0,109,55,4,52,1,52,212,115,82,52,52,0,82,55,6,0,41,55,55,4,3,52,52,55,1,55,0,0,109,52,8,55,1,55,212,115,82,55,55,0,82,52,6,0,41,52,52,4,3,55,55,52,1,52,224,115,82,52,52,0,109,55,12,52,82,52,6,0,25,52,52,1,85,6,52,0,119,0,221,255,1,52,216,115,1,55,1,0,85,52,55,0,1,55,0,0,85,7,55,0,1,55,32,0,82,52,7,0,56,55,55,52,116,224,0,0,1,55,192,73,82,52,7,0,41,52,52,6,3,12,55,52,134,52,0,0,124,116,2,0,8,0,0,0,0,41,12,0,0,44,8,0,25,45,41,64,116,41,44,0,25,41,41,4,25,44,44,4,54,52,41,45,80,224,0,0,82,52,7,0,25,52,52,1,85,7,52,0,119,0,234,255,134,52,0,0,124,116,2,0,9,0,0,0,1,41,12,115,0,44,9,0,25,45,41,64,116,41,44,0,25,41,41,4,25,44,44,4,54,52,41,45,140,224,0,0,134,52,0,0,124,116,2,0,10,0,0,0,1,41,80,115,0,44,10,0,25,45,41,64,116,41,44,0,25,41,41,4,25,44,44,4,54,52,41,45,184,224,0,0,1,52,76,115,1,55,80,115,85,52,55,0,1,52,3,2,135,55,19,0,52,0,0,0,1,52,113,11,135,55,20,0,52,0,0,0,1,52,2,3,1,51,3,3,135,55,21,0,52,51,0,0,1,51,226,11,135,55,22,0,51,0,0,0,1,51,5,4,135,55,23,0,51,0,0,0,1,51,1,9,135,55,24,0,51,0,0,0,1,51,68,11,135,55,22,0,51,0,0,0,59,51,0,0,59,52,0,0,59,54,0,0,59,53,1,0,135,55,25,0,51,52,54,53,59,53,1,0,135,55,26,0,53,0,0,0,1,53,0,65,135,55,27,0,53,0,0,0,1,55,240,115,82,53,11,0,85,55,53,0,1,53,244,115,82,55,13,0,85,53,55,0,1,53,3,0,1,54,90,36,134,55,0,0,252,32,2,0,53,54,39,0,137,43,0,0,139,0,0,0,140,5,65,0,0,0,0,0,0,5,0,0,0,6,1,0,0,7,6,0,0,8,2,0,0,9,3,0,0,10,9,0,120,7,28,0,33,11,4,0,120,10,12,0,121,11,5,0,9,60,5,8,85,4,60,0,1,61,0,0,109,4,4,61,1,57,0,0,7,56,5,8,135,61,28,0,57,0,0,0,139,56,0,0,119,0,15,0,120,11,6,0,1,57,0,0,1,56,0,0,135,61,28,0,57,0,0,0,139,56,0,0,85,4,0,0,38,60,1,0,109,4,4,60,1,57,0,0,1,56,0,0,135,60,28,0,57,0,0,0,139,56,0,0,32,12,10,0,120,8,77,0,121,12,11,0,121,4,5,0,9,60,7,8,85,4,60,0,1,61,0,0,109,4,4,61,1,57,0,0,7,56,7,8,135,61,28,0,57,0,0,0,139,56,0,0,120,5,11,0,121,4,5,0,1,61,0,0,85,4,61,0,9,60,7,10,109,4,4,60,1,57,0,0,7,56,7,10,135,60,28,0,57,0,0,0,139,56,0,0,26,13,10,1,19,60,13,10,120,60,15,0,121,4,6,0,85,4,0,0,19,61,13,7,38,62,1,0,20,61,61,62,109,4,4,61,1,57,0,0,135,61,29,0,10,0,0,0,24,61,7,61,0,56,61,0,135,61,28,0,57,0,0,0,139,56,0,0,135,61,30,0,10,0,0,0,135,60,30,0,7,0,0,0,4,14,61,60,37,60,14,30,121,60,15,0,25,15,14,1,1,60,31,0,4,16,60,14,0,33,15,0,22,60,7,16,24,61,5,15,20,60,60,61,0,32,60,0,24,60,7,15,0,31,60,0,1,30,0,0,22,60,5,16,0,29,60,0,119,0,133,0,120,4,6,0,1,57,0,0,1,56,0,0,135,60,28,0,57,0,0,0,139,56,0,0,85,4,0,0,38,61,1,0,20,61,6,61,109,4,4,61,1,57,0,0,1,56,0,0,135,61,28,0,57,0,0,0,139,56,0,0,119,0,117,0,120,12,42,0,135,61,30,0,10,0,0,0,135,60,30,0,7,0,0,0,4,25,61,60,37,60,25,31,121,60,20,0,25,26,25,1,1,60,31,0,4,27,60,25,26,60,25,31,42,60,60,31,0,28,60,0,0,33,26,0,24,60,5,26,19,60,60,28,22,61,7,27,20,60,60,61,0,32,60,0,24,60,7,26,19,60,60,28,0,31,60,0,1,30,0,0,22,60,5,27,0,29,60,0,119,0,90,0,120,4,6,0,1,57,0,0,1,56,0,0,135,60,28,0,57,0,0,0,139,56,0,0,85,4,0,0,38,61,1,0,20,61,6,61,109,4,4,61,1,57,0,0,1,56,0,0,135,61,28,0,57,0,0,0,139,56,0,0,26,17,8,1,19,61,17,8,121,61,44,0,135,61,30,0,8,0,0,0,25,61,61,33,135,60,30,0,7,0,0,0,4,19,61,60,1,60,64,0,4,20,60,19,1,60,32,0,4,21,60,19,42,60,21,31,0,22,60,0,26,23,19,32,42,60,23,31,0,24,60,0,0,33,19,0,26,60,21,1,42,60,60,31,24,61,7,23,19,60,60,61,22,61,7,21,24,62,5,19,20,61,61,62,19,61,61,24,20,60,60,61,0,32,60,0,24,60,7,19,19,60,24,60,0,31,60,0,22,60,5,20,19,60,60,22,0,30,60,0,22,60,7,20,24,61,5,23,20,60,60,61,19,60,60,22,22,61,5,21,26,62,19,33,42,62,62,31,19,61,61,62,20,60,60,61,0,29,60,0,119,0,29,0,121,4,5,0,19,60,17,5,85,4,60,0,1,61,0,0,109,4,4,61,32,61,8,1,121,61,9,0,38,61,1,0,20,61,6,61,0,57,61,0,0,56,0,0,135,61,28,0,57,0,0,0,139,56,0,0,119,0,14,0,135,18,29,0,8,0,0,0,24,61,7,18,0,57,61,0,1,61,32,0,4,61,61,18,22,61,7,61,24,60,5,18,20,61,61,60,0,56,61,0,135,61,28,0,57,0,0,0,139,56,0,0,120,33,8,0,0,53,29,0,0,52,30,0,0,51,31,0,0,50,32,0,1,49,0,0,1,48,0,0,119,0,71,0,0,34,2,0,38,61,3,0,20,61,9,61,0,35,61,0,1,61,255,255,1,60,255,255,134,36,0,0,240,153,2,0,34,35,61,60,135,37,1,0,0,43,29,0,0,42,30,0,0,41,31,0,0,40,32,0,0,39,33,0,1,38,0,0,0,58,43,0,43,60,42,31,41,61,43,1,20,60,60,61,0,43,60,0,41,60,42,1,20,60,38,60,0,42,60,0,41,60,40,1,43,61,58,31,20,60,60,61,0,44,60,0,43,60,40,31,41,61,41,1,20,60,60,61,0,45,60,0,134,60,0,0,64,151,2,0,36,37,44,45,135,46,1,0,34,61,46,0,1,62,255,255,1,63,0,0,125,60,61,62,63,0,0,0,41,60,60,1,0,59,60,0,42,60,46,31,20,60,60,59,0,47,60,0,38,60,47,1,0,38,60,0,19,60,47,34,34,62,46,0,1,61,255,255,1,64,0,0,125,63,62,61,64,0,0,0,42,63,63,31,20,63,63,59,19,63,63,35,134,40,0,0,64,151,2,0,44,45,60,63,135,41,1,0,26,39,39,1,33,63,39,0,120,63,209,255,0,53,43,0,0,52,42,0,0,51,41,0,0,50,40,0,1,49,0,0,0,48,38,0,0,54,52,0,1,55,0,0,121,4,3,0,85,4,50,0,109,4,4,51,43,63,54,31,20,60,53,55,41,60,60,1,20,63,63,60,41,60,55,1,43,64,54,31,20,60,60,64,38,60,60,0,20,63,63,60,20,63,63,49,0,57,63,0,41,63,54,1,1,60,0,0,43,60,60,31,20,63,63,60,38,63,63,254,20,63,63,48,0,56,63,0,135,63,28,0,57,0,0,0,139,56,0,0,140,6,48,0,0,0,0,0,136,39,0,0,0,38,39,0,136,39,0,0,25,39,39,112,137,39,0,0,130,39,0,0,136,40,0,0,49,39,39,40,4,231,0,0,1,40,112,0,135,39,0,0,40,0,0,0,25,33,38,96,25,34,38,92,25,35,38,88,25,37,38,84,25,6,38,80,25,7,38,76,25,8,38,72,25,10,38,68,0,11,38,0,25,12,38,104,25,13,38,64,25,14,38,60,25,15,38,56,25,16,38,52,25,17,38,48,25,18,38,44,25,19,38,40,25,20,38,36,25,21,38,32,25,25,38,28,25,29,38,24,25,30,38,20,85,34,0,0,85,35,1,0,85,37,2,0,85,6,3,0,85,7,4,0,85,8,5,0,1,39,255,255,85,10,39,0,1,39,64,16,82,39,39,0,85,11,39,0,1,40,68,16,82,40,40,0,109,11,4,40,1,39,72,16,82,39,39,0,109,11,8,39,1,40,76,16,82,40,40,0,109,11,12,40,1,39,80,16,82,39,39,0,109,11,16,39,1,39,1,48,78,39,39,0,83,12,39,0,1,40,2,48,78,40,40,0,107,12,1,40,1,39,3,48,78,39,39,0,107,12,2,39,1,40,4,48,78,40,40,0,107,12,3,40,1,39,5,48,78,39,39,0,107,12,4,39,1,40,6,48,78,40,40,0,107,12,5,40,1,39,7,48,78,39,39,0,107,12,6,39,1,40,8,48,78,40,40,0,107,12,7,40,82,40,35,0,120,40,5,0,82,39,37,0,82,41,7,0,5,40,39,41,85,35,40,0,1,40,5,0,82,41,10,0,49,40,40,41,72,232,0,0,1,40,255,255,85,10,40,0,82,41,37,0,82,39,7,0,5,40,41,39,25,32,40,1,82,41,6,0,5,39,32,41,135,40,6,0,39,0,0,0,85,15,40,0,82,40,15,0,120,40,6,0,1,40,0,0,85,33,40,0,82,31,33,0,137,38,0,0,139,31,0,0,82,41,37,0,82,42,7,0,5,39,41,42,135,40,6,0,39,0,0,0,85,17,40,0,82,40,17,0,120,40,9,0,82,39,15,0,135,40,5,0,39,0,0,0,1,40,0,0,85,33,40,0,82,31,33,0,137,38,0,0,139,31,0,0,1,40,0,0,85,18,40,0,82,40,6,0,82,39,18,0,56,40,40,39,184,234,0,0,1,40,255,255,82,39,10,0,47,40,40,39,40,233,0,0,116,20,10,0,82,39,34,0,82,42,35,0,82,41,37,0,82,43,6,0,82,44,18,0,82,45,7,0,82,46,10,0,82,47,17,0,134,40,0,0,100,24,1,0,39,42,41,43,44,45,46,47,119,0,73,0,1,40,0,0,85,21,40,0,2,40,0,0,255,255,255,127,85,25,40,0,1,40,0,0,85,20,40,0,1,40,5,0,82,47,20,0,56,40,40,47,4,234,0,0,82,47,34,0,82,46,35,0,82,45,37,0,82,44,6,0,82,43,18,0,82,41,7,0,82,42,20,0,82,39,17,0,134,40,0,0,100,24,1,0,47,46,45,44,43,41,42,39,1,40,0,0,85,29,40,0,1,40,0,0,85,30,40,0,82,39,37,0,82,42,7,0,5,40,39,42,82,42,30,0,56,40,40,42,220,233,0,0,82,40,17,0,82,42,30,0,90,40,40,42,135,36,31,0,40,0,0,0,82,40,29,0,3,40,40,36,85,29,40,0,82,40,30,0,25,40,40,1,85,30,40,0,119,0,239,255,82,40,29,0,82,42,25,0,47,40,40,42,244,233,0,0,116,25,29,0,116,21,20,0,82,40,20,0,25,40,40,1,85,20,40,0,119,0,209,255,82,40,20,0,82,42,21,0,46,40,40,42,72,234,0,0,82,42,34,0,82,39,35,0,82,41,37,0,82,43,6,0,82,44,18,0,82,45,7,0,82,46,21,0,82,47,17,0,134,40,0,0,100,24,1,0,42,39,41,43,44,45,46,47,116,20,21,0,82,40,15,0,82,46,18,0,82,44,37,0,82,43,7,0,5,45,44,43,25,45,45,1,5,47,46,45,82,45,20,0,95,40,47,45,82,45,15,0,82,40,18,0,82,43,37,0,82,44,7,0,5,46,43,44,25,46,46,1,5,47,40,46,3,45,45,47,25,9,45,1,82,47,17,0,82,40,37,0,82,44,7,0,5,46,40,44,135,45,7,0,9,47,46,0,82,45,18,0,25,45,45,1,85,18,45,0,119,0,135,255,82,46,17,0,135,45,5,0,46,0,0,0,82,46,15,0,82,44,6,0,82,43,37,0,82,41,7,0,5,40,43,41,25,40,40,1,5,47,44,40,1,40,8,0,134,45,0,0,28,49,0,0,46,47,19,40,85,16,45,0,82,40,15,0,135,45,5,0,40,0,0,0,82,45,16,0,120,45,6,0,1,45,0,0,85,33,45,0,82,31,33,0,137,38,0,0,139,31,0,0,82,40,19,0,25,40,40,45,25,40,40,12,135,45,6,0,40,0,0,0,85,13,45,0,82,45,13,0,120,45,6,0,1,45,0,0,85,33,45,0,82,31,33,0,137,38,0,0,139,31,0,0,82,45,8,0,82,40,19,0,25,40,40,45,25,40,40,12,85,45,40,0,116,14,13,0,82,45,14,0,1,47,8,0,135,40,7,0,45,12,47,0,82,40,14,0,25,40,40,8,85,14,40,0,82,40,14,0,1,47,0,0,83,40,47,0,82,47,14,0,1,40,0,0,107,47,1,40,82,40,14,0,1,47,0,0,107,40,2,47,82,47,14,0,1,40,13,0,107,47,3,40,82,40,14,0,25,40,40,4,85,14,40,0,82,40,14,0,1,47,9,48,78,47,47,0,83,40,47,0,82,47,14,0,1,40,10,48,78,40,40,0,107,47,1,40,82,40,14,0,1,47,11,48,78,47,47,0,107,40,2,47,82,47,14,0,1,40,12,48,78,40,40,0,107,47,3,40,82,40,14,0,25,40,40,4,85,14,40,0,82,40,14,0,82,47,37,0,42,47,47,24,83,40,47,0,82,47,14,0,82,40,37,0,42,40,40,16,107,47,1,40,82,40,14,0,82,47,37,0,42,47,47,8,107,40,2,47,82,47,14,0,82,40,37,0,107,47,3,40,82,40,14,0,25,40,40,4,85,14,40,0,82,40,14,0,82,47,6,0,42,47,47,24,83,40,47,0,82,47,14,0,82,40,6,0,42,40,40,16,107,47,1,40,82,40,14,0,82,47,6,0,42,47,47,8,107,40,2,47,82,47,14,0,82,40,6,0,107,47,3,40,82,40,14,0,25,40,40,4,85,14,40,0,82,22,14,0,25,40,22,1,85,14,40,0,1,40,8,0,83,22,40,0,82,40,7,0,41,40,40,2,94,40,11,40,1,47,255,0,19,40,40,47,0,23,40,0,82,24,14,0,25,40,24,1,85,14,40,0,83,24,23,0,82,26,14,0,25,40,26,1,85,14,40,0,1,40,0,0,83,26,40,0,82,27,14,0,25,40,27,1,85,14,40,0,1,40,0,0,83,27,40,0,82,28,14,0,25,40,28,1,85,14,40,0,1,40,0,0,83,28,40,0,1,47,13,0,134,40,0,0,220,58,2,0,14,47,0,0,82,40,14,0,82,47,19,0,42,47,47,24,83,40,47,0,82,47,14,0,82,40,19,0,42,40,40,16,107,47,1,40,82,40,14,0,82,47,19,0,42,47,47,8,107,40,2,47,82,47,14,0,82,40,19,0,107,47,3,40,82,40,14,0,25,40,40,4,85,14,40,0,82,40,14,0,1,47,14,48,78,47,47,0,83,40,47,0,82,47,14,0,1,40,15,48,78,40,40,0,107,47,1,40,82,40,14,0,1,47,16,48,78,47,47,0,107,40,2,47,82,47,14,0,1,40,17,48,78,40,40,0,107,47,3,40,82,40,14,0,25,40,40,4,85,14,40,0,82,47,14,0,82,45,16,0,82,46,19,0,135,40,7,0,47,45,46,0,82,40,14,0,82,46,19,0,3,40,40,46,85,14,40,0,82,46,16,0,135,40,5,0,46,0,0,0,82,46,19,0,134,40,0,0,220,58,2,0,14,46,0,0,82,40,14,0,1,46,0,0,83,40,46,0,82,46,14,0,1,40,0,0,107,46,1,40,82,40,14,0,1,46,0,0,107,40,2,46,82,46,14,0,1,40,0,0,107,46,3,40,82,40,14,0,25,40,40,4,85,14,40,0,82,40,14,0,1,46,19,48,78,46,46,0,83,40,46,0,82,46,14,0,1,40,20,48,78,40,40,0,107,46,1,40,82,40,14,0,1,46,21,48,78,46,46,0,107,40,2,46,82,46,14,0,1,40,22,48,78,40,40,0,107,46,3,40,82,40,14,0,25,40,40,4,85,14,40,0,1,46,0,0,134,40,0,0,220,58,2,0,14,46,0,0,82,40,14,0,82,46,13,0,82,45,8,0,82,45,45,0,3,46,46,45,46,40,40,46,196,238,0,0,1,46,24,48,1,45,142,47,1,47,131,4,1,44,44,48,135,40,8,0,46,45,47,44,116,33,13,0,82,31,33,0,137,38,0,0,139,31,0,0,140,1,34,0,0,0,0,0,2,27,0,0,79,29,0,0,2,28,0,0,90,29,0,0,2,29,0,0,83,29,0,0,1,25,0,0,136,30,0,0,0,26,30,0,136,30,0,0,25,30,30,48,137,30,0,0,130,30,0,0,136,31,0,0,49,30,30,31,40,239,0,0,1,31,48,0,135,30,0,0,31,0,0,0,25,24,26,32,25,23,26,24,25,1,26,16,25,3,26,8,0,7,26,0,1,30,64,117,106,31,0,4,85,30,31,0,82,31,0,0,32,20,31,1,1,31,2,0,1,30,64,117,82,30,30,0,49,31,31,30,144,242,0,0,121,20,23,0,25,17,0,24,1,31,72,117,82,30,17,0,85,31,30,0,1,30,76,117,106,31,17,4,85,30,31,0,25,31,0,24,25,18,31,8,1,31,116,117,82,30,18,0,85,31,30,0,1,30,120,117,106,31,18,4,85,30,31,0,1,31,60,117,1,30,4,0,85,31,30,0,134,30,0,0,128,152,2,0,137,26,0,0,139,0,0,0,82,30,0,0,33,30,30,2,121,30,23,0,82,30,0,0,121,30,3,0,137,26,0,0,139,0,0,0,1,30,132,117,59,31,0,0,145,31,31,0,89,30,31,0,59,31,0,0,145,31,31,0,89,7,31,0,59,30,0,0,145,30,30,0], eb + 51200);
  HEAPU8.set([113,7,4,30,1,30,64,117,1,31,0,0,85,30,31,0,1,31,60,117,1,30,0,0,85,31,30,0,137,26,0,0,139,0,0,0,1,30,108,117,82,30,30,0,85,23,30,0,1,31,112,117,82,31,31,0,109,23,4,31,1,31,124,117,82,31,31,0,85,24,31,0,1,30,128,117,82,30,30,0,109,24,4,30,1,30,132,117,134,31,0,0,56,96,2,0,23,24,0,0,145,31,31,0,89,30,31,0,1,31,72,117,1,30,108,117,82,30,30,0,85,31,30,0,1,30,76,117,1,31,112,117,82,31,31,0,85,30,31,0,1,31,116,117,1,30,124,117,82,30,30,0,85,31,30,0,1,30,120,117,1,31,128,117,82,31,31,0,85,30,31,0,25,19,0,24,1,31,108,117,82,30,19,0,85,31,30,0,1,30,112,117,106,31,19,4,85,30,31,0,25,31,0,24,25,21,31,8,1,31,124,117,82,30,21,0,85,31,30,0,1,30,128,117,106,31,21,4,85,30,31,0,1,31,72,117,82,31,31,0,85,23,31,0,1,30,76,117,82,30,30,0,109,23,4,30,1,30,108,117,82,30,30,0,85,24,30,0,1,31,112,117,82,31,31,0,109,24,4,31,134,31,0,0,56,96,2,0,23,24,0,0,145,31,31,0,62,30,0,0,133,240,30,64,225,122,116,63,145,30,30,0,74,31,31,30,121,31,3,0,1,25,41,0,119,0,30,0,1,31,116,117,82,31,31,0,85,23,31,0,1,30,120,117,82,30,30,0,109,23,4,30,1,30,124,117,82,30,30,0,85,24,30,0,1,31,128,117,82,31,31,0,109,24,4,31,134,31,0,0,56,96,2,0,23,24,0,0,145,31,31,0,62,30,0,0,133,240,30,64,225,122,116,63,145,30,30,0,74,31,31,30,121,31,3,0,1,25,41,0,119,0,6,0,1,31,60,117,1,30,4,0,85,31,30,0,134,30,0,0,128,152,2,0,32,30,25,41,121,30,34,0,1,30,108,117,82,30,30,0,85,23,30,0,1,31,112,117,82,31,31,0,109,23,4,31,1,31,124,117,82,31,31,0,85,24,31,0,1,30,128,117,82,30,30,0,109,24,4,30,134,22,0,0,56,96,2,0,23,24,0,0,145,22,22,0,1,32,132,117,88,31,32,0,145,31,31,0,64,30,22,31,145,30,30,0,59,31,0,0,145,31,31,0,71,30,30,31,121,30,5,0,1,30,60,117,1,31,0,1,85,30,31,0,119,0,5,0,1,31,60,117,1,30,0,2,85,31,30,0,119,0,1,0,1,30,108,117,82,30,30,0,85,23,30,0,1,31,112,117,82,31,31,0,109,23,4,31,1,31,124,117,82,31,31,0,85,24,31,0,1,30,128,117,82,30,30,0,109,24,4,30,134,30,0,0,96,100,2,0,23,24,0,0,145,30,30,0,137,26,0,0,139,0,0,0,121,20,100,0,1,30,68,117,1,31,68,117,82,31,31,0,25,31,31,1,85,30,31,0,1,31,60,117,82,31,31,0,32,31,31,0,1,30,2,0,1,32,68,117,82,32,32,0,17,30,30,32,19,31,31,30,121,31,40,0,134,2,0,0,128,152,2,0,1,31,208,114,86,31,31,0,64,31,2,31,59,30,44,1,71,31,31,30,121,31,30,0,25,4,0,24,1,31,72,117,82,31,31,0,85,23,31,0,1,30,76,117,82,30,30,0,109,23,4,30,116,24,4,0,106,31,4,4,109,24,4,31,134,31,0,0,56,96,2,0,23,24,0,0,145,31,31,0,62,30,0,0,201,124,126,223,81,184,158,63,145,30,30,0,71,31,31,30,121,31,8,0,1,31,60,117,1,30,2,0,85,31,30,0,1,30,68,117,1,31,0,0,85,30,31,0,119,0,6,0,1,25,7,0,119,0,4,0,1,25,7,0,119,0,2,0,1,25,7,0,32,31,25,7,121,31,7,0,1,31,68,117,1,30,1,0,85,31,30,0,1,30,60,117,1,31,1,0,85,30,31,0,25,5,0,24,1,31,72,117,82,30,5,0,85,31,30,0,1,30,76,117,106,31,5,4,85,30,31,0,25,6,0,24,1,31,80,117,82,30,6,0,85,31,30,0,1,30,84,117,106,31,6,4,85,30,31,0,1,31,88,117,1,30,72,117,82,30,30,0,85,31,30,0,1,30,92,117,1,31,76,117,82,31,31,0,85,30,31,0,1,31,208,114,134,30,0,0,128,152,2,0,87,31,30,0,1,30,152,29,106,31,0,8,85,30,31,0,59,31,0,0,145,31,31,0,89,1,31,0,59,30,0,0,145,30,30,0,113,1,4,30,137,26,0,0,139,0,0,0,82,30,0,0,121,30,81,0,82,30,0,0,33,30,30,2,121,30,3,0,137,26,0,0,139,0,0,0,1,30,60,117,82,30,30,0,32,30,30,8,121,30,5,0,1,30,208,114,134,31,0,0,128,152,2,0,87,30,31,0,1,31,172,120,78,31,31,0,38,31,31,1,120,31,8,0,1,31,216,114,134,30,0,0,128,152,2,0,87,31,30,0,1,30,172,120,1,31,1,0,83,30,31,0,25,15,0,24,1,31,108,117,82,30,15,0,85,31,30,0,1,30,112,117,106,31,15,4,85,30,31,0,1,31,60,117,82,31,31,0,32,31,31,4,121,31,44,0,1,31,173,120,78,31,31,0,38,31,31,1,121,31,8,0,25,16,0,24,1,31,72,117,82,30,16,0,85,31,30,0,1,30,76,117,106,31,16,4,85,30,31,0,1,31,173,120,1,30,0,0,83,31,30,0,1,30,72,117,82,30,30,0,85,23,30,0,1,31,76,117,82,31,31,0,109,23,4,31,1,31,108,117,82,31,31,0,85,24,31,0,1,30,112,117,82,30,30,0,109,24,4,30,134,30,0,0,56,96,2,0,23,24,0,0,145,30,30,0,62,31,0,0,199,74,54,225,81,184,142,63,145,31,31,0,74,30,30,31,121,30,8,0,1,30,208,114,134,31,0,0,128,152,2,0,87,30,31,0,1,31,60,117,1,30,8,0,85,31,30,0,137,26,0,0,139,0,0,0,1,30,60,117,82,30,30,0,32,30,30,8,121,30,8,0,25,8,0,24,1,30,88,117,82,31,8,0,85,30,31,0,1,31,92,117,106,30,8,4,85,31,30,0,1,30,72,117,82,30,30,0,85,23,30,0,1,31,76,117,82,31,31,0,109,23,4,31,1,31,88,117,82,31,31,0,85,24,31,0,1,30,92,117,82,30,30,0,109,24,4,30,1,30,96,117,134,31,0,0,56,96,2,0,23,24,0,0,145,31,31,0,89,30,31,0,1,31,96,117,88,9,31,0,145,9,9,0,134,10,0,0,128,152,2,0,1,31,100,117,1,33,216,114,86,33,33,0,64,32,10,33,145,32,32,0,66,30,9,32,145,30,30,0,89,31,30,0,1,30,172,120,1,31,0,0,83,30,31,0,1,30,100,117,88,31,30,0,145,31,31,0,62,30,0,0,29,93,35,224,77,98,64,63,145,30,30,0,73,31,31,30,121,31,106,0,1,31,152,29,82,31,31,0,106,30,0,8,45,31,31,30,220,247,0,0,1,31,72,117,82,31,31,0,85,23,31,0,1,30,76,117,82,30,30,0,109,23,4,30,1,30,88,117,82,30,30,0,85,24,30,0,1,31,92,117,82,31,31,0,109,24,4,31,1,31,104,117,59,32,104,1,145,32,32,0,134,33,0,0,96,100,2,0,23,24,0,0,145,33,33,0,64,30,32,33,145,30,30,0,89,31,30,0,1,31,104,117,88,30,31,0,145,30,30,0,59,31,30,0,145,31,31,0,71,11,30,31,1,30,104,117,88,31,30,0,145,31,31,0,59,30,74,1,145,30,30,0,73,31,31,30,20,31,11,31,121,31,5,0,1,31,60,117,1,30,16,0,85,31,30,0,119,0,62,0,1,31,104,117,88,30,31,0,145,30,30,0,59,31,30,0,145,31,31,0,73,12,30,31,1,30,104,117,88,31,30,0,145,31,31,0,59,30,120,0,145,30,30,0,71,31,31,30,19,31,12,31,121,31,5,0,1,31,60,117,1,30,64,0,85,31,30,0,119,0,44,0,1,31,104,117,88,30,31,0,145,30,30,0,59,31,120,0,145,31,31,0,73,13,30,31,1,30,104,117,88,31,30,0,145,31,31,0,59,30,210,0,145,30,30,0,71,31,31,30,19,31,13,31,121,31,5,0,1,31,60,117,1,30,32,0,85,31,30,0,119,0,26,0,1,31,104,117,88,30,31,0,145,30,30,0,59,31,210,0,145,31,31,0,73,14,30,31,1,30,104,117,88,31,30,0,145,31,31,0,59,30,44,1,145,30,30,0,71,31,31,30,19,31,14,31,121,31,5,0,1,31,60,117,1,30,128,0,85,31,30,0,119,0,8,0,1,30,60,117,1,31,0,0,85,30,31,0,119,0,4,0,1,25,23,0,119,0,2,0,1,25,23,0,32,31,25,23,121,31,16,0,1,31,96,117,59,30,0,0,145,30,30,0,89,31,30,0,1,30,100,117,59,31,0,0,145,31,31,0,89,30,31,0,1,31,104,117,59,30,0,0,145,30,30,0,89,31,30,0,1,30,60,117,1,31,0,0,85,30,31,0,59,31,0,0,145,31,31,0,89,3,31,0,59,30,0,0,145,30,30,0,113,3,4,30,1,30,80,117,82,31,3,0,85,30,31,0,1,31,84,117,106,30,3,4,85,31,30,0,1,30,64,117,1,31,0,0,85,30,31,0,137,26,0,0,139,0,0,0,140,2,71,0,0,0,0,0,136,64,0,0,0,63,64,0,136,64,0,0,25,64,64,112,137,64,0,0,130,64,0,0,136,65,0,0,49,64,64,65,168,248,0,0,1,65,112,0,135,64,0,0,65,0,0,0,25,30,63,108,25,56,63,104,25,57,63,100,25,58,63,96,25,59,63,92,25,60,63,88,25,61,63,84,25,62,63,80,25,2,63,76,25,3,63,72,25,6,63,68,25,8,63,64,25,11,63,60,25,15,63,56,25,17,63,52,25,20,63,48,25,22,63,44,25,26,63,40,25,31,63,36,25,32,63,32,25,36,63,28,25,39,63,24,25,42,63,20,25,45,63,16,25,49,63,12,25,50,63,8,25,53,63,4,0,55,63,0,85,30,0,0,85,56,1,0,82,64,30,0,25,64,64,20,116,59,64,0,82,64,30,0,25,64,64,108,116,60,64,0,82,64,30,0,25,64,64,112,116,61,64,0,82,64,30,0,25,64,64,64,116,62,64,0,82,64,30,0,1,65,164,0,3,64,64,65,116,2,64,0,82,64,30,0,25,64,64,124,116,3,64,0,82,64,30,0,1,65,132,0,3,64,64,65,116,6,64,0,82,64,56,0,82,65,30,0,1,66,148,0,94,65,65,66,3,64,64,65,85,8,64,0,82,64,30,0,1,65,180,0,3,64,64,65,116,11,64,0,82,64,30,0,1,65,176,0,3,64,64,65,116,15,64,0,82,64,30,0,1,65,168,0,3,64,64,65,116,17,64,0,82,64,30,0,1,65,160,0,94,64,64,65,29,64,64,4,85,20,64,0,82,64,60,0,82,65,8,0,41,65,65,3,3,64,64,65,116,22,64,0,82,64,60,0,82,65,8,0,41,65,65,3,3,64,64,65,25,64,64,4,116,26,64,0,82,65,30,0,134,64,0,0,80,148,2,0,65,0,0,0,121,64,7,0,1,65,240,50,1,66,90,48,1,67,212,7,1,68,138,51,135,64,8,0,65,66,67,68,116,58,22,0,82,64,26,0,82,68,58,0,54,64,64,68,128,255,0,0,82,64,58,0,82,68,22,0,4,64,64,68,85,31,64,0,82,68,6,0,82,67,8,0,5,64,68,67,85,32,64,0,82,67,61,0,82,68,32,0,82,66,31,0,3,68,68,66,41,68,68,2,100,64,67,68,145,64,64,0,89,36,64,0,82,67,58,0,82,68,11,0,82,66,15,0,82,65,17,0,82,69,2,0,82,70,20,0,134,64,0,0,48,58,2,0,67,68,66,65,69,70,0,0,85,39,64,0,82,64,62,0,1,65,1,0,1,70,4,0,138,64,65,70,136,251,0,0,4,252,0,0,216,252,0,0,252,253,0,0,1,70,0,0,85,57,70,0,82,70,59,0,82,69,57,0,56,70,70,69,112,255,0,0,82,69,57,0,82,65,62,0,5,70,69,65,85,53,70,0,1,70,0,0,85,55,70,0,82,70,62,0,82,65,55,0,56,70,70,65,120,251,0,0,82,70,3,0,82,65,53,0,82,69,55,0,3,65,65,69,41,65,65,2,100,51,70,65,145,51,51,0,88,70,36,0,145,70,70,0,65,52,51,70,145,52,52,0,82,70,39,0,82,65,53,0,82,69,55,0,3,65,65,69,41,65,65,2,3,54,70,65,88,70,54,0,145,70,70,0,63,65,70,52,145,65,65,0,89,54,65,0,82,65,55,0,25,65,65,1,85,55,65,0,119,0,227,255,82,65,57,0,25,65,65,1,85,57,65,0,119,0,213,255,1,70,0,0,85,57,70,0,82,70,59,0,82,69,57,0,56,70,70,69,112,255,0,0,116,42,57,0,82,70,3,0,82,69,42,0,25,69,69,0,41,69,69,2,100,4,70,69,145,4,4,0,88,70,36,0,145,70,70,0,65,5,4,70,145,5,5,0,82,70,39,0,82,69,42,0,25,69,69,0,41,69,69,2,3,7,70,69,88,70,7,0,145,70,70,0,63,69,70,5,145,69,69,0,89,7,69,0,82,69,57,0,25,69,69,1,85,57,69,0,119,0,228,255,1,69,0,0,85,57,69,0,82,69,59,0,82,70,57,0,56,69,69,70,112,255,0,0,82,69,57,0,41,69,69,1,85,45,69,0,82,69,3,0,82,70,45,0,25,70,70,0,41,70,70,2,100,9,69,70,145,9,9,0,88,69,36,0,145,69,69,0,65,10,9,69,145,10,10,0,82,69,39,0,82,70,45,0,25,70,70,0,41,70,70,2,3,12,69,70,88,69,12,0,145,69,69,0,63,70,69,10,145,70,70,0,89,12,70,0,82,70,3,0,82,69,45,0,25,69,69,1,41,69,69,2,100,13,70,69,145,13,13,0,88,70,36,0,145,70,70,0,65,14,13,70,145,14,14,0,82,70,39,0,82,69,45,0,25,69,69,1,41,69,69,2,3,16,70,69,88,70,16,0,145,70,70,0,63,69,70,14,145,69,69,0,89,16,69,0,82,69,57,0,25,69,69,1,85,57,69,0,119,0,206,255,1,69,0,0,85,57,69,0,82,69,59,0,82,70,57,0,56,69,69,70,112,255,0,0,82,69,57,0,27,69,69,3,85,49,69,0,82,69,3,0,82,70,49,0,25,70,70,0,41,70,70,2,100,18,69,70,145,18,18,0,88,69,36,0,145,69,69,0,65,19,18,69,145,19,19,0,82,69,39,0,82,70,49,0,25,70,70,0,41,70,70,2,3,21,69,70,88,69,21,0,145,69,69,0,63,70,69,19,145,70,70,0,89,21,70,0,82,70,3,0,82,69,49,0,25,69,69,1,41,69,69,2,100,23,70,69,145,23,23,0,88,70,36,0,145,70,70,0,65,24,23,70,145,24,24,0,82,70,39,0,82,69,49,0,25,69,69,1,41,69,69,2,3,25,70,69,88,70,25,0,145,70,70,0,63,69,70,24,145,69,69,0,89,25,69,0,82,69,3,0,82,70,49,0,25,70,70,2,41,70,70,2,100,27,69,70,145,27,27,0,88,69,36,0,145,69,69,0,65,28,27,69,145,28,28,0,82,69,39,0,82,70,49,0,25,70,70,2,41,70,70,2,3,29,69,70,88,69,29,0,145,69,69,0,63,70,69,28,145,70,70,0,89,29,70,0,82,70,57,0,25,70,70,1,85,57,70,0,119,0,186,255,1,70,0,0,85,57,70,0,82,70,59,0,82,69,57,0,56,70,70,69,112,255,0,0,82,70,57,0,41,70,70,2,85,50,70,0,82,70,3,0,82,69,50,0,25,69,69,0,41,69,69,2,100,33,70,69,145,33,33,0,88,70,36,0,145,70,70,0,65,34,33,70,145,34,34,0,82,70,39,0,82,69,50,0,25,69,69,0,41,69,69,2,3,35,70,69,88,70,35,0,145,70,70,0,63,69,70,34,145,69,69,0,89,35,69,0,82,69,3,0,82,70,50,0,25,70,70,1,41,70,70,2,100,37,69,70,145,37,37,0,88,69,36,0,145,69,69,0,65,38,37,69,145,38,38,0,82,69,39,0,82,70,50,0,25,70,70,1,41,70,70,2,3,40,69,70,88,69,40,0,145,69,69,0,63,70,69,38,145,70,70,0,89,40,70,0,82,70,3,0,82,69,50,0,25,69,69,2,41,69,69,2,100,41,70,69,145,41,41,0,88,70,36,0,145,70,70,0,65,43,41,70,145,43,43,0,82,70,39,0,82,69,50,0,25,69,69,2,41,69,69,2,3,44,70,69,88,70,44,0,145,70,70,0,63,69,70,43,145,69,69,0,89,44,69,0,82,69,3,0,82,70,50,0,25,70,70,3,41,70,70,2,100,46,69,70,145,46,46,0,88,69,36,0,145,69,69,0,65,47,46,69,145,47,47,0,82,69,39,0,82,70,50,0,25,70,70,3,41,70,70,2,3,48,69,70,88,69,48,0,145,69,69,0,63,70,69,47,145,70,70,0,89,48,70,0,82,70,57,0,25,70,70,1,85,57,70,0,119,0,166,255,82,64,58,0,25,64,64,1,85,58,64,0,119,0,174,254,137,63,0,0,139,0,0,0,140,2,74,0,0,0,0,0,2,70,0,0,255,0,0,0,1,68,0,0,136,71,0,0,0,69,71,0,136,71,0,0,1,72,32,4,3,71,71,72,137,71,0,0,130,71,0,0,136,72,0,0,49,71,71,72,208,255,0,0,1,72,32,4,135,71,0,0,72,0,0,0,1,71,0,4,3,42,69,71,0,47,69,0,1,71,0,0,85,42,71,0,1,72,0,0,109,42,4,72,1,71,0,0,109,42,8,71,1,72,0,0,109,42,12,72,1,71,0,0,109,42,16,71,1,72,0,0,109,42,20,72,1,71,0,0,109,42,24,71,1,72,0,0,109,42,28,72,78,48,1,0,41,72,48,24,42,72,72,24,120,72,8,0,1,7,1,0,1,11,255,255,1,13,0,0,1,20,1,0,1,25,255,255,1,68,25,0,119,0,146,0,1,14,0,0,0,38,48,0,90,72,0,14,120,72,3,0,1,27,0,0,119,0,140,0,19,72,38,70,0,63,72,0,43,72,63,5,41,72,72,2,3,41,42,72,82,72,41,0,1,71,1,0,38,73,63,31,22,71,71,73,20,72,72,71,85,41,72,0,25,14,14,1,41,72,63,2,97,47,72,14,90,38,1,14,41,72,38,24,42,72,72,24,33,72,72,0,120,72,234,255,1,72,1,0,16,43,72,14,121,43,112,0,1,8,1,0,1,9,1,0,1,10,0,0,1,12,255,255,1,45,1,0,3,72,9,12,90,44,1,72,90,46,1,45,41,72,44,24,42,72,72,24,41,71,46,24,42,71,71,24,45,72,72,71,32,1,1,0,45,72,9,8,12,1,1,0,0,15,8,0,1,16,1,0,3,17,8,10,0,18,12,0,119,0,20,0,0,15,8,0,25,16,9,1,0,17,10,0,0,18,12,0,119,0,15,0,19,72,46,70,19,71,44,70,47,72,72,71,68,1,1,0,4,15,45,12,1,16,1,0,0,17,45,0,0,18,12,0,119,0,6,0,1,15,1,0,1,16,1,0,25,17,10,1,0,18,10,0,119,0,1,0,3,45,16,17,57,72,14,45,120,1,1,0,0,8,15,0,0,9,16,0,0,10,17,0,0,12,18,0,119,0,214,255,121,43,56,0,1,21,1,0,1,22,1,0,1,23,0,0,1,26,255,255,1,50,1,0,3,72,22,26,90,49,1,72,90,51,1,50,41,72,49,24,42,72,72,24,41,71,51,24,42,71,71,24,45,72,72,71,228,1,1,0,45,72,22,21,208,1,1,0,0,29,21,0,1,30,1,0,3,31,21,23,0,32,26,0,119,0,20,0,0,29,21,0,25,30,22,1,0,31,23,0,0,32,26,0,119,0,15,0,19,72,49,70,19,71,51,70,47,72,72,71,8,2,1,0,4,29,50,26,1,30,1,0,0,31,50,0,0,32,26,0,119,0,6,0,1,29,1,0,1,30,1,0,25,31,23,1,0,32,23,0,119,0,1,0,3,50,30,31,50,72,14,50,68,2,1,0,0,7,15,0,0,11,18,0,0,13,14,0,0,20,29,0,0,25,32,0,1,68,25,0,119,0,19,0,0,21,29,0,0,22,30,0,0,23,31,0,0,26,32,0,119,0,207,255,0,7,15,0,0,11,18,0,0,13,14,0,1,20,1,0,1,25,255,255,1,68,25,0,119,0,7,0,1,7,1,0,1,11,255,255,0,13,14,0,1,20,1,0,1,25,255,255,1,68,25,0,32,72,68,25,121,72,124,0,25,72,11,1,25,71,25,1,16,52,72,71,125,19,52,20,7,0,0,0,125,24,52,25,11,0,0,0,25,53,24,1,3,72,1,19,134,71,0,0,228,129,2,0,1,72,53,0,120,71,6,0,4,56,13,19,0,3,56,0,0,34,19,0,0,37,56,0,119,0,10,0,4,71,13,24,26,54,71,1,16,72,54,24,125,71,72,24,54,0,0,0,25,55,71,1,1,3,0,0,0,34,55,0,4,37,13,55,39,71,13,63,0,57,71,0,26,58,13,1,33,59,3,0,0,2,0,0,1,4,0,0,0,6,0,0,0,60,2,0,4,71,6,60,48,71,71,13,100,3,1,0,1,71,0,0,134,61,0,0,196,160,1,0,6,71,57,0,120,61,3,0,3,28,6,57,119,0,9,0,4,71,61,60,48,71,71,13,92,3,1,0,1,27,0,0,119,0,74,0,0,28,61,0,119,0,2,0,0,28,6,0,91,62,2,58,1,71,1,0,38,72,62,31,22,71,71,72,43,72,62,5,41,72,72,2,94,72,42,72,19,71,71,72,120,71,4,0,1,5,0,0,0,33,13,0,119,0,55,0,41,71,62,2,94,71,47,71,4,64,13,71,121,64,9,0,1,5,0,0,33,71,4,0,19,71,59,71,16,72,64,34,19,71,71,72,125,33,71,37,64,0,0,0,119,0,43,0,16,65,4,53,125,66,65,53,4,0,0,0,90,67,1,66,41,71,67,24,42,71,71,24,121,71,19,0,0,35,66,0,0,39,67,0,41,71,39,24,42,71,71,24,90,72,2,35,53,71,71,72,32,4,1,0,25,40,35,1,90,39,1,40,41,71,39,24,42,71,71,24,120,71,2,0,119,0,6,0,0,35,40,0,119,0,244,255,1,5,0,0,4,33,35,24,119,0,18,0,120,65,3,0,0,27,2,0,119,0,19,0,0,36,53,0,26,36,36,1,90,71,1,36,90,72,2,36,46,71,71,72,92,4,1,0,0,5,3,0,0,33,34,0,119,0,6,0,50,71,36,4,108,4,1,0,0,27,2,0,119,0,6,0,119,0,244,255,3,2,2,33,0,4,5,0,0,6,28,0,119,0,168,255,137,69,0,0,139,27,0,0,140,0,47,0,0,0,0,0,2,41,0,0,149,29,0,0,2,42,0,0,150,29,0,0,136,43,0,0,0,37,43,0,136,43,0,0,1,44,48,12,3,43,43,44,137,43,0,0,130,43,0,0,136,44,0,0,49,43,43,44,212,4,1,0,1,44,48,12,135,43,0,0,44,0,0,0,1,43,8,12,3,1,37,43,1,43,244,11,3,0,37,43,1,43,128,11,3,36,37,43,1,43,128,3,3,2,37,43,1,43,240,11,3,3,37,43,1,43,236,11,3,22,37,43,0,23,37,0,1,43,232,11,3,25,37,43,1,43,228,11,3,27,37,43,1,43,224,11,3,29,37,43,1,43,220,11,3,31,37,43,1,43,32,12,3,32,37,43,1,43,216,11,3,34,37,43,1,43,212,11,3,4,37,43,1,43,208,11,3,6,37,43,1,43,28,12,3,8,37,43,1,43,188,11,3,11,37,43,1,43,168,11,3,12,37,43,1,43,164,11,3,14,37,43,1,43,160,11,3,16,37,43,1,43,156,11,3,17,37,43,1,43,152,11,3,20,37,43,1,43,132,11,3,21,37,43,1,43,60,118,1,44,224,0,85,43,44,0,1,43,0,4,1,45,0,8,135,44,32,0,2,43,45,0,1,44,10,0,85,3,44,0,1,44,1,0,85,22,44,0,1,45,0,12,1,43,128,3,135,44,32,0,23,45,43,0,1,44,128,0,85,25,44,0,1,44,128,0,85,27,44,0,82,45,25,0,82,46,27,0,5,43,45,46,41,43,43,2,135,44,6,0,43,0,0,0,85,29,44,0,1,44,0,0,85,31,44,0,82,43,25,0,82,46,27,0,5,44,43,46,82,46,31,0,56,44,44,46,112,6,1,0,82,44,29,0,82,46,31,0,41,46,46,2,3,24,44,46,1,46,0,0,83,32,46,0,1,44,0,0,107,32,1,44,1,46,0,0,107,32,2,46,1,44,0,0,107,32,3,44,78,44,32,0,83,24,44,0,102,46,32,1,107,24,1,46,102,44,32,2,107,24,2,44,102,46,32,3,107,24,3,46,82,46,31,0,25,46,46,1,85,31,46,0,119,0,227,255,1,46,0,0,85,34,46,0,1,46,0,0,85,4,46,0,82,44,25,0,82,43,27,0,5,46,44,43,82,43,4,0,56,46,46,43,104,7,1,0,1,46,31,0,85,6,46,0,82,26,34,0,82,46,6,0,34,46,46,0,120,46,34,0,41,46,26,2,94,46,2,46,1,43,1,0,82,44,6,0,22,43,43,44,19,46,46,43,121,46,23,0,82,46,29,0,82,43,4,0,82,44,6,0,3,43,43,44,41,43,43,2,3,28,46,43,1,43,255,255,83,8,43,0,1,46,255,255,107,8,1,46,1,43,255,255,107,8,2,43,1,46,255,255,107,8,3,46,78,46,8,0,83,28,46,0,102,43,8,1,107,28,1,43,102,46,8,2,107,28,2,46,102,43,8,3,107,28,3,43,82,43,6,0,26,43,43,1,85,6,43,0,119,0,220,255,25,30,26,1,85,34,30,0,1,46,0,2,82,44,34,0,15,46,46,44,1,44,0,0,125,43,46,44,30,0,0,0,85,34,43,0,82,43,4,0,25,43,43,32,85,4,43,0,119,0,199,255,82,44,29,0,82,46,25,0,82,45,27,0,134,43,0,0,144,225,1,0,11,44,46,45,1,45,2,0,134,43,0,0,24,33,0,0,11,45,0,0,82,45,29,0,135,43,5,0,45,0,0,0,116,1,11,0,106,45,11,4,109,1,4,45,106,43,11,8,109,1,8,43,106,45,11,12,109,1,12,45,106,43,11,16,109,1,16,43,134,43,0,0,160,29,2,0,12,1,0,0,1,43,64,118,82,45,12,0,85,43,45,0,1,45,68,118,106,43,12,4,85,45,43,0,1,43,72,118,106,45,12,8,85,43,45,0,1,45,76,118,106,43,12,12,85,45,43,0,1,43,80,118,106,45,12,16,85,43,45,0,1,45,88,118,1,46,60,118,82,46,46,0,27,46,46,36,135,43,6,0,46,0,0,0,85,45,43,0,1,43,84,118,1,46,60,118,82,46,46,0,41,46,46,4,135,45,6,0,46,0,0,0,85,43,45,0,1,45,0,0,85,14,45,0,116,16,22,0,116,17,22,0,1,45,0,0,85,20,45,0,1,45,60,118,82,45,45,0,82,43,20,0,56,45,45,43,12,11,1,0,82,38,20,0,1,45,88,118,82,45,45,0,27,43,38,36,25,46,38,32,97,45,43,46,82,33,16,0,76,46,33,0,145,33,46,0,1,46,84,118,82,46,46,0,82,43,20,0,41,43,43,4,101,46,43,33,82,39,22,0,82,46,14,0,82,45,3,0,3,45,45,39,5,43,46,45,3,35,39,43,76,43,35,0,145,35,43,0,1,43,84,118,82,43,43,0,82,45,20,0,41,45,45,4,3,43,43,45,113,43,4,35,82,43,20,0,41,43,43,2,94,5,23,43,76,43,5,0,145,5,43,0,1,43,84,118,82,43,43,0,82,45,20,0,41,45,45,4,3,43,43,45,113,43,8,5,82,7,3,0,76,43,7,0,145,7,43,0,1,43,84,118,82,43,43,0,82,45,20,0,41,45,45,4,3,43,43,45,113,43,12,7,1,43,84,118,82,43,43,0,82,45,20,0,41,45,45,4,3,43,43,45,112,9,43,8,145,9,9,0,82,45,22,0,76,45,45,0,145,45,45,0,63,43,9,45,145,43,43,0,75,10,43,0,82,43,17,0,3,43,43,10,85,17,43,0,1,43,68,118,82,43,43,0,82,45,17,0,49,43,43,45,8,10,1,0,82,43,14,0,25,43,43,1,85,14,43,0,82,43,22,0,41,43,43,1,82,45,20,0,41,45,45,2,94,45,23,45,3,43,43,45,85,16,43,0,116,17,16,0,82,13,22,0,76,43,13,0,145,13,43,0,1,43,84,118,82,43,43,0,82,45,20,0,41,45,45,4,101,43,45,13,82,40,22,0,82,43,14,0,82,46,3,0,3,46,46,40,5,45,43,46,3,15,40,45,76,45,15,0,145,15,45,0,1,45,84,118,82,45,45,0,82,46,20,0,41,46,46,4,3,45,45,46,113,45,4,15,119,0,2,0,116,16,17,0,1,45,88,118,82,45,45,0,82,46,20,0,27,46,46,36,3,45,45,46,1,46,0,0,109,45,4,46,1,46,88,118,82,46,46,0,82,45,20,0,27,45,45,36,3,46,46,45,1,45,0,0,109,46,8,45,1,45,88,118,82,45,45,0,82,46,20,0,27,46,46,36,3,45,45,46,1,46,0,0,109,45,12,46,1,46,88,118,82,46,46,0,82,45,20,0,27,45,45,36,3,46,46,45,25,18,46,16,1,46,84,118,82,46,46,0,82,45,20,0,41,45,45,4,3,19,46,45,116,0,11,0,106,46,11,4,109,0,4,46,106,45,11,8,109,0,8,45,106,46,11,12,109,0,12,46,106,45,11,16,109,0,16,45,116,1,19,0,106,46,19,4,109,1,4,46,106,45,19,8,109,1,8,45,106,46,19,12,109,1,12,46,134,46,0,0,220,40,2,0,21,0,1,0,116,18,21,0,106,45,21,4,109,18,4,45,106,46,21,8,109,18,8,46,106,45,21,12,109,18,12,45,106,46,21,16,109,18,16,46,82,46,20,0,25,46,46,1,85,20,46,0,119,0,84,255,116,1,11,0,106,45,11,4,109,1,4,45,106,46,11,8,109,1,8,46,106,45,11,12,109,1,12,45,106,46,11,16,109,1,16,46,134,46,0,0,128,160,2,0,1,0,0,0,1,46,56,118,1,43,84,118,82,43,43,0,112,45,43,12,145,45,45,0,75,45,45,0,85,46,45,0,1,45,64,118,82,45,45,0,85,36,45,0,1,46,3,0,1,43,97,47,134,45,0,0,252,32,2,0,46,43,36,0,137,37,0,0,139,0,0,0,140,0,10,0,0,0,0,0,1,1,0,0,1,2,0,0,1,3,0,0,1,4,0,0,1,5,0,0,1,6,0,0,1,7,0,0,1,8,0,0,135,0,33,0,1,2,3,4,5,6,7,8,135,0,34,0,1,8,0,0,135,0,35,0,8,0,0,0,1,8,0,0,135,0,36,0,8,0,0,0,1,8,0,0,1,7,0,0,135,0,37,0,8,7,0,0,1,7,0,0,1,8,0,0,135,0,38,0,7,8,0,0,1,8,0,0,135,0,39,0,8,0,0,0,1,8,0,0,1,7,0,0,135,0,40,0,8,7,0,0,1,7,0,0,135,0,41,0,7,0,0,0,1,7,0,0,1,8,0,0,135,0,42,0,7,8,0,0,1,8,0,0,135,0,43,0,8,0,0,0,1,8,0,0,135,0,44,0,8,0,0,0,59,8,0,0,145,8,8,0,59,7,0,0,145,7,7,0,135,0,45,0,8,7,0,0,1,7,0,0,1,8,0,0,135,0,46,0,7,8,0,0,1,8,0,0,135,0,47,0,8,0,0,0,1,8,0,0,135,0,48,0,8,0,0,0,1,8,0,0,1,7,0,0,1,6,0,0,135,0,49,0,8,7,6,0,1,6,0,0,1,7,0,0,1,8,0,0,1,5,0,0,135,0,50,0,6,7,8,5,1,5,0,0,135,0,51,0,5,0,0,0,1,5,0,0,135,0,52,0,5,0,0,0,135,0,53,0,135,0,54,0,1,5,0,0,1,8,0,0,1,7,0,0,1,6,0,0,135,0,55,0,5,8,7,6,1,6,0,0,1,7,0,0,1,8,0,0,1,5,0,0,1,4,0,0,135,0,56,0,6,7,8,5,4,0,0,0,1,4,0,0,135,0,57,0,4,0,0,0,1,4,0,0,1,5,0,0,135,0,58,0,4,5,0,0,1,5,0,0,135,0,59,0,5,0,0,0,1,5,0,0,1,4,0,0,135,0,60,0,5,4,0,0,1,4,0,0,1,5,0,0,135,0,61,0,4,5,0,0,1,5,0,0,1,4,0,0,135,0,62,0,5,4,0,0,1,4,0,0,1,5,0,0,1,8,0,0,1,7,0,0,1,6,0,0,1,3,0,0,1,2,0,0,135,0,63,0,4,5,8,7,6,3,2,0,1,2,0,0,1,3,0,0,1,6,0,0,1,7,0,0,1,8,0,0,1,5,0,0,1,4,0,0,135,0,64,0,2,3,6,7,8,5,4,0,1,4,0,0,1,5,0,0,1,8,0,0,1,7,0,0,135,0,65,0,4,5,8,7,1,7,0,0,1,8,0,0,135,0,66,0,7,8,0,0,1,8,0,0,1,7,0,0,135,0,67,0,8,7,0,0,1,7,0,0,1,8,0,0,1,5,0,0,135,0,68,0,7,8,5,0,135,0,69,0,1,5,0,0,1,8,0,0,135,0,70,0,5,8,0,0,1,8,0,0,1,5,0,0,1,7,0,0,1,4,0,0,135,0,71,0,8,5,7,4,1,4,0,0,1,7,0,0,135,0,72,0,4,7,0,0,1,7,0,0,1,4,0,0,1,5,0,0,135,0,73,0,7,4,5,0,1,5,0,0,1,4,0,0,1,7,0,0,1,8,0,0,135,0,74,0,5,4,7,8,1,8,0,0,1,7,0,0,1,4,0,0,135,0,75,0,8,7,4,0,1,4,0,0,1,7,0,0,1,8,0,0,135,0,76,0,4,7,8,0,1,8,0,0,1,7,0,0,1,4,0,0,1,5,0,0,135,0,77,0,8,7,4,5,1,5,0,0,1,4,0,0,1,7,0,0,1,8,0,0,135,0,78,0,5,4,7,8,1,8,0,0,1,7,0,0,1,4,0,0,1,5,0,0,135,0,79,0,8,7,4,5,1,5,0,0,135,0,80,0,5,0,0,0,1,5,0,0,1,4,0,0,1,7,0,0,135,0,81,0,5,4,7,0,1,7,0,0,1,4,0,0,1,5,0,0,135,0,82,0,7,4,5,0,1,5,0,0,1,4,0,0,1,7,0,0,135,0,83,0,5,4,7,0,1,7,0,0,1,4,0,0,1,5,0,0,135,0,84,0,7,4,5,0,1,5,0,0,1,4,0,0,135,0,85,0,5,4,0,0,1,4,0,0,1,5,0,0,1,7,0,0,135,0,86,0,4,5,7,0,1,7,0,0,1,5,0,0,1,4,0,0,135,0,87,0,7,5,4,0,1,4,0,0,1,5,0,0,1,7,0,0,135,0,88,0,4,5,7,0,1,7,0,0,1,5,0,0,135,0,89,0,7,5,0,0,1,5,0,0,135,0,90,0,5,0,0,0,41,0,0,24,1,5,0,0,135,0,91,0,5,0,0,0,41,0,0,24,1,5,0,0,135,0,92,0,5,0,0,0,41,0,0,24,1,5,0,0,135,0,93,0,5,0,0,0,41,0,0,24,1,5,0,0,135,0,94,0,5,0,0,0,41,0,0,24,1,5,0,0,135,0,95,0,5,0,0,0,41,0,0,24,1,5,0,0,135,0,96,0,5,0,0,0,41,0,0,24,59,5,0,0,145,5,5,0,135,0,97,0,5,0,0,0,1,5,0,0,135,0,98,0,5,0,0,0,1,5,0,0,1,7,0,0,135,0,99,0,5,7,0,0,59,7,0,0,145,7,7,0,59,5,0,0,145,5,5,0,135,0,100,0,7,5,0,0,1,5,0,0,1,7,0,0,1,4,0,0,1,8,0,0,1,6,0,0,1,3,0,0,1,2,0,0,135,0,101,0,5,7,4,8,6,3,2,0,135,0,102,0,1,2,0,0,1,3,0,0,1,6,0,0,1,8,0,0,135,0,103,0,2,3,6,8,59,8,0,0,145,8,8,0,1,6,0,0,135,0,104,0,8,6,0,0,1,6,0,0,1,8,0,0,1,3,0,0,1,2,0,0,135,0,105,0,6,8,3,2,1,2,0,0,1,3,0,0,1,8,0,0,1,6,0,0,1,4,0,0,135,0,106,0,2,3,8,6,4,0,0,0,1,4,0,0,1,6,0,0,1,8,0,0,1,3,0,0,135,0,107,0,4,6,8,3,1,3,0,0,1,8,0,0,1,6,0,0,135,0,108,0,3,8,6,0,1,6,0,0,1,8,0,0,1,3,0,0,1,4,0,0,135,0,109,0,6,8,3,4,1,4,0,0,135,0,110,0,4,0,0,0,1,4,0,0,1,3,0,0,135,0,111,0,4,3,0,0,1,3,0,0,1,4,0,0,1,8,0,0,135,0,112,0,3,4,8,0,1,8,0,0,1,4,0,0,1,3,0,0,1,6,0,0,135,0,113,0,8,4,3,6,1,6,0,0,1,3,0,0,1,4,0,0,1,8,0,0,1,2,0,0,1,7,0,0,1,5,0,0,1,1,0,0,1,9,0,0,135,0,114,0,6,3,4,8,2,7,5,1,9,0,0,0,1,9,0,0,1,1,0,0,59,5,0,0,145,5,5,0,135,0,115,0,9,1,5,0,1,5,0,0,1,1,0,0,1,9,0,0,135,0,116,0,5,1,9,0,1,9,0,0,1,1,0,0,1,5,0,0,135,0,117,0,9,1,5,0,1,5,0,0,1,1,0,0,1,9,0,0,135,0,118,0,5,1,9,0,1,9,0,0,1,1,0,0,1,5,0,0,1,7,0,0,1,2,0,0,1,8,0,0,1,4,0,0,1,3,0,0,1,6,0,0,135,0,119,0,9,1,5,7,2,8,4,3,6,0,0,0,1,6,0,0,59,3,0,0,145,3,3,0,135,0,120,0,6,3,0,0,1,3,0,0,1,6,0,0,1,4,0,0,135,0,121,0,3,6,4,0,1,4,0,0,1,6,0,0,135,0,122,0,4,6,0,0,1,6,0,0,1,4,0,0,1,3,0,0,135,0,123,0,6,4,3,0,1,3,0,0,59,4,0,0,145,4,4,0,59,6,0,0,145,6,6,0,135,0,124,0,3,4,6,0,1,6,0,0,1,4,0,0,1,3,0,0,135,0,125,0,6,4,3,0,1,3,0,0,1,4,0,0,1,6,0,0,135,0,126,0,3,4,6,0,1,6,0,0,1,4,0,0,1,3,0,0,135,0,127,0,6,4,3,0,1,3,0,0,59,4,0,0,145,4,4,0,59,6,0,0,145,6,6,0,59,8,0,0,145,8,8,0,135,0,128,0,3,4,6,8,1,8,0,0,1,6,0,0,1,4,0,0,135,0,129,0,8,6,4,0,1,4,0,0,1,6,0,0,1,8,0,0,1,3,0,0,135,0,130,0,4,6,8,3,1,3,0,0,1,8,0,0,135,0,131,0,3,8,0,0,1,8,0,0,1,3,0,0,135,0,132,0,8,3,0,0,1,3,0,0,1,8,0,0,135,0,133,0,3,8,0,0,1,8,0,0,135,0,134,0,8,0,0,0,41,0,0,24,1,8,0,0,1,3,0,0,135,0,135,0,8,3,0,0,1,3,0,0,135,0,136,0,3,0,0,0,1,3,0,0,1,8,0,0,135,0,137,0,3,8,0,0,1,8,0,0,1,3,0,0,1,6,0,0,135,0,138,0,8,3,6,0,1,6,0,0,1,3,0,0,1,8,0,0,135,0,139,0,6,3,8,0,1,8,0,0,1,3,0,0,1,6,0,0,135,0,140,0,8,3,6,0,1,6,0,0,1,3,0,0,1,8,0,0,135,0,141,0,6,3,8,0,1,8,0,0,1,3,0,0,1,6,0,0,135,0,142,0,8,3,6,0,1,6,0,0,135,0,143,0,6,0,0,0,1,6,0,0,1,3,0,0,135,0,144,0,6,3,0,0,1,3,0,0,1,6,0,0,135,0,145,0,3,6,0,0,1,6,0,0,135,0,146,0,6,0,0,0,41,0,0,24,1,6,0,0,1,3,0,0,135,0,147,0,6,3,0,0,1,3,0,0,1,6,0,0,1,8,0,0,1,4,0,0,135,0,148,0,3,6,8,4,1,4,0,0,1,8,0,0,1,6,0,0,1,3,0,0,1,2,0,0,135,0,149,0,4,8,6,3,2,0,0,0,1,2,0,0,135,0,150,0,2,0,0,0,1,2,0,0,1,3,0,0,135,0,151,0,2,3,0,0,1,3,0,0,1,2,0,0,1,6,0,0,135,0,152,0,3,2,6,0,1,6,0,0,1,2,0,0,135,0,153,0,6,2,0,0,1,2,0,0,1,6,0,0,135,0,154,0,2,6,0,0,1,6,0,0,1,2,0,0,135,0,155,0,6,2,0,0,1,2,0,0,1,6,0,0,135,0,156,0,2,6,0,0,59,6,0,0,145,6,6,0,59,2,0,0,145,2,2,0,59,3,0,0,145,3,3,0,59,8,0,0,145,8,8,0,135,0,157,0,6,2,3,8,1,8,0,0,135,0,158,0,8,0,0,0,1,8,0,0,1,3,0,0,135,0,159,0,8,3,0,0,1,3,0,0,1,8,0,0,135,0,160,0,3,8,0,0,1,8,0,0,1,3,0,0,1,2,0,0,1,6,0,0,135,0,161,0,8,3,2,6,1,6,0,0,1,2,0,0,1,3,0,0,1,8,0,0,135,0,162,0,6,2,3,8,1,8,0,0,1,3,0,0,1,2,0,0,1,6,0,0,135,0,163,0,8,3,2,6,1,6,0,0,135,0,164,0,6,0,0,0,1,6,0,0,135,0,165,0,6,0,0,0,59,6,0,0,145,6,6,0,59,2,0,0,145,2,2,0,59,3,0,0,145,3,3,0,59,8,0,0,145,8,8,0,135,0,166,0,6,2,3,8,59,8,0,0,145,8,8,0,135,0,167,0,8,0,0,0,1,8,0,0,135,0,168,0,8,0,0,0,1,8,0,0,1,3,0,0,1,2,0,0,1,6,0,0,135,0,169,0,8,3,2,6,1,6,0,0,135,0,170,0,6,0,0,0,1,6,0,0,1,2,0,0,1,3,0,0,1,8,0,0,1,4,0,0,1,7,0,0,1,5,0,0,1,1,0,0,135,0,171,0,6,2,3,8,4,7,5,1,1,1,0,0,1,5,0,0,1,7,0,0,1,4,0,0,1,8,0,0,1,3,0,0,1,2,0,0,1,6,0,0,1,9,0,0,135,0,172,0,1,5,7,4,8,3,2,6,9,0,0,0,1,9,0,0,1,6,0,0,1,2,0,0,1,3,0,0,1,8,0,0,1,4,0,0,1,7,0,0,1,5,0,0,135,0,173,0,9,6,2,3,8,4,7,5,1,5,0,0,1,7,0,0,1,4,0,0,135,0,174,0,5,7,4,0,1,4,0,0,59,7,0,0,145,7,7,0,59,5,0,0,145,5,5,0,59,8,0,0,145,8,8,0,59,3,0,0,145,3,3,0,135,0,175,0,4,7,5,8,3,0,0,0,1,3,0,0,1,8,0,0,1,5,0,0,135,0,176,0,3,8,5,0,1,5,0,0,1,8,0,0,1,3,0,0,1,7,0,0,1,4,0,0,135,0,177,0,5,8,3,7,4,0,0,0,1,4,0,0,1,7,0,0,1,3,0,0,135,0,178,0,4,7,3,0,1,3,0,0,1,7,0,0,1,4,0,0,1,8,0,0,135,0,179,0,3,7,4,8,1,8,0,0,1,4,0,0,1,7,0,0,1,3,0,0,135,0,180,0,8,4,7,3,1,3,0,0,1,7,0,0,1,4,0,0,1,8,0,0,135,0,181,0,3,7,4,8,1,8,0,0,135,0,182,0,8,0,0,0,1,8,0,0,135,0,183,0,8,0,0,0,1,8,0,0,59,4,0,0,145,4,4,0,135,0,184,0,8,4,0,0,1,4,0,0,1,8,0,0,135,0,185,0,4,8,0,0,1,8,0,0,59,4,0,0,145,4,4,0,59,7,0,0,145,7,7,0,135,0,186,0,8,4,7,0,1,7,0,0,1,4,0,0,135,0,187,0,7,4,0,0,1,4,0,0,59,7,0,0,145,7,7,0,59,8,0,0,145,8,8,0,59,3,0,0,145,3,3,0,135,0,188,0,4,7,8,3,1,3,0,0,1,8,0,0,135,0,189,0,3,8,0,0,1,8,0,0,59,3,0,0,145,3,3,0,59,7,0,0,145,7,7,0,59,4,0,0,145,4,4,0], eb + 61440);
  HEAPU8.set([59,5,0,0,145,5,5,0,135,0,190,0,8,3,7,4,5,0,0,0,1,5,0,0,1,4,0,0,135,0,191,0,5,4,0,0,1,4,0,0,1,5,0,0,1,7,0,0,1,3,0,0,1,8,0,0,1,2,0,0,135,0,192,0,4,5,7,3,8,2,0,0,1,2,0,0,1,8,0,0,1,3,0,0,1,7,0,0,135,0,193,0,2,8,3,7,139,0,0,0,140,8,58,0,0,0,0,0,2,51,0,0,255,0,0,0,136,52,0,0,0,29,52,0,136,52,0,0,25,52,52,64,137,52,0,0,130,52,0,0,136,53,0,0,49,52,52,53,164,24,1,0,1,53,64,0,135,52,0,0,53,0,0,0,25,27,29,48,25,28,29,44,25,8,29,40,25,9,29,36,25,11,29,32,25,12,29,28,25,13,29,24,25,14,29,20,25,15,29,16,25,16,29,12,25,17,29,8,25,18,29,4,0,19,29,0,85,27,0,0,85,28,1,0,85,8,2,0,85,9,3,0,85,11,4,0,85,12,5,0,85,13,6,0,85,14,7,0,82,53,11,0,1,54,96,20,1,55,128,20,125,52,53,54,55,0,0,0,85,15,52,0,82,52,15,0,82,55,13,0,41,55,55,2,3,52,52,55,116,17,52,0,1,52,0,0,121,52,6,0,82,52,9,0,26,52,52,1,82,55,11,0,4,24,52,55,119,0,2,0,82,24,11,0,82,55,27,0,82,54,28,0,5,52,54,24,3,55,55,52,85,18,55,0,82,25,28,0,1,52,0,0,121,52,5,0,1,52,0,0,4,52,52,25,0,55,52,0,119,0,2,0,0,55,25,0,85,19,55,0,82,55,17,0,120,55,10,0,82,52,14,0,82,54,18,0,82,56,8,0,82,57,12,0,5,53,56,57,135,55,32,0,52,54,53,0,137,29,0,0,139,0,0,0,1,55,0,0,85,16,55,0,82,26,17,0,82,55,12,0,82,53,16,0,56,55,55,53,228,26,1,0,1,55,1,0,1,53,6,0,138,26,55,53,236,25,1,0,4,26,1,0,44,26,1,0,88,26,1,0,164,26,1,0,188,26,1,0,119,0,59,0,82,30,16,0,82,55,14,0,82,53,18,0,90,53,53,30,95,55,30,53,119,0,53,0,82,31,16,0,82,32,18,0,82,53,14,0,91,55,32,31,82,54,19,0,4,54,31,54,91,54,32,54,4,55,55,54,95,53,31,55,119,0,43,0,82,33,16,0,82,34,18,0,82,55,14,0,91,53,34,33,82,54,19,0,4,54,33,54,91,54,34,54,42,54,54,1,4,53,53,54,95,55,33,53,119,0,32,0,82,35,18,0,82,36,16,0,91,53,35,36,1,54,0,0,82,52,19,0,4,52,36,52,91,52,35,52,1,57,0,0,134,55,0,0,60,17,2,0,54,52,57,0,19,55,55,51,4,53,53,55,19,53,53,51,0,10,53,0,82,53,14,0,82,55,16,0,95,53,55,10,119,0,13,0,82,37,16,0,82,55,14,0,82,53,18,0,90,53,53,37,95,55,37,53,119,0,7,0,82,38,16,0,82,53,14,0,82,55,18,0,90,55,55,38,95,53,38,55,119,0,1,0,82,55,16,0,25,55,55,1,85,16,55,0,119,0,180,255,1,55,1,0,1,53,6,0,138,26,55,53,20,27,1,0,112,27,1,0,204,27,1,0,60,28,1,0,212,28,1,0,52,29,1,0,137,29,0,0,139,0,0,0,119,0,171,0,116,16,12,0,82,53,8,0,82,57,12,0,5,55,53,57,82,57,16,0,56,55,55,57,100,27,1,0,82,39,16,0,82,40,18,0,82,55,14,0,91,57,40,39,82,53,12,0,4,53,39,53,91,53,40,53,4,57,57,53,95,55,39,57,82,57,16,0,25,57,57,1,85,16,57,0,119,0,238,255,137,29,0,0,139,0,0,0,119,0,1,0,116,16,12,0,82,55,8,0,82,53,12,0,5,57,55,53,82,53,16,0,56,57,57,53,192,27,1,0,82,41,16,0,82,42,18,0,82,57,14,0,91,53,42,41,82,55,19,0,4,55,41,55,91,55,42,55,4,53,53,55,95,57,41,53,82,53,16,0,25,53,53,1,85,16,53,0,119,0,238,255,137,29,0,0,139,0,0,0,119,0,1,0,116,16,12,0,82,57,8,0,82,55,12,0,5,53,57,55,82,55,16,0,56,53,53,55,48,28,1,0,82,43,16,0,82,44,18,0,82,53,14,0,91,55,44,43,82,57,12,0,4,57,43,57,91,57,44,57,82,52,19,0,4,52,43,52,91,52,44,52,3,57,57,52,42,57,57,1,4,55,55,57,95,53,43,55,82,55,16,0,25,55,55,1,85,16,55,0,119,0,233,255,137,29,0,0,139,0,0,0,119,0,1,0,116,16,12,0,82,53,8,0,82,57,12,0,5,55,53,57,82,57,16,0,56,55,55,57,200,28,1,0,82,55,18,0,82,57,16,0,91,20,55,57,82,45,18,0,82,46,16,0,82,55,16,0,82,57,19,0,4,47,55,57,82,48,12,0,4,55,46,48,91,55,45,55,91,53,45,47,4,52,47,48,91,52,45,52,134,57,0,0,60,17,2,0,55,53,52,0,19,57,57,51,4,57,20,57,19,57,57,51,0,21,57,0,82,57,14,0,82,52,16,0,95,57,52,21,82,52,16,0,25,52,52,1,85,16,52,0,119,0,223,255,137,29,0,0,139,0,0,0,119,0,1,0,116,16,12,0,82,57,8,0,82,53,12,0,5,52,57,53,82,53,16,0,56,52,52,53,40,29,1,0,82,49,16,0,82,50,18,0,82,52,14,0,91,53,50,49,82,57,12,0,4,57,49,57,91,57,50,57,42,57,57,1,4,53,53,57,95,52,49,53,82,53,16,0,25,53,53,1,85,16,53,0,119,0,237,255,137,29,0,0,139,0,0,0,119,0,1,0,116,16,12,0,82,52,8,0,82,57,12,0,5,53,52,57,82,57,16,0,56,53,53,57,176,29,1,0,82,53,18,0,82,57,16,0,91,22,53,57,82,57,18,0,82,52,16,0,82,55,12,0,4,52,52,55,91,57,57,52,1,52,0,0,1,55,0,0,134,53,0,0,60,17,2,0,57,52,55,0,19,53,53,51,4,53,22,53,19,53,53,51,0,23,53,0,82,53,14,0,82,55,16,0,95,53,55,23,82,55,16,0,25,55,55,1,85,16,55,0,119,0,227,255,137,29,0,0,139,0,0,0,119,0,84,255,139,0,0,0,140,6,48,0,0,0,0,0,1,38,0,0,136,40,0,0,0,39,40,0,136,40,0,0,25,40,40,80,137,40,0,0,130,40,0,0,136,41,0,0,49,40,40,41,252,29,1,0,1,41,80,0,135,40,0,0,41,0,0,0,25,31,39,64,25,33,39,60,25,34,39,56,25,35,39,52,25,6,39,48,25,8,39,44,25,9,39,40,25,12,39,36,25,15,39,32,25,17,39,28,25,18,39,24,25,19,39,20,25,22,39,16,25,24,39,12,25,25,39,8,25,27,39,4,0,28,39,0,85,31,0,0,85,33,1,0,85,34,2,0,89,35,3,0,85,6,4,0,85,8,5,0,88,29,35,0,145,29,29,0,82,41,34,0,82,42,6,0,82,43,8,0,134,40,0,0,192,56,2,0,29,41,42,43,85,9,40,0,82,43,34,0,88,42,35,0,145,42,42,0,134,40,0,0,72,49,2,0,43,42,0,0,85,12,40,0,1,40,0,0,85,15,40,0,82,40,8,0,82,42,15,0,49,40,40,42,184,30,1,0,1,38,22,0,119,0,160,0,59,40,0,0,145,40,40,0,89,22,40,0,1,40,0,0,85,17,40,0,82,40,9,0,82,42,17,0,56,40,40,42,196,31,1,0,82,40,31,0,82,42,17,0,41,42,42,3,94,40,40,42,82,42,15,0,49,40,40,42,136,31,1,0,82,40,15,0,82,42,31,0,82,43,17,0,41,43,43,3,3,42,42,43,106,42,42,4,49,40,40,42,128,31,1,0,88,30,35,0,145,30,30,0,82,43,33,0,82,41,34,0,82,44,17,0,82,45,15,0,82,46,31,0,82,47,17,0,41,47,47,3,94,46,46,47,4,45,45,46,134,42,0,0,192,105,2,0,43,41,30,44,45,0,0,0,88,40,42,0,145,40,40,0,89,24,40,0,88,32,24,0,145,32,32,0,88,42,22,0,145,42,42,0,63,40,42,32,145,40,40,0,89,22,40,0,119,0,4,0,1,38,8,0,119,0,2,0,1,38,8,0,32,40,38,8,121,40,9,0,1,38,0,0,82,40,15,0,82,42,31,0,82,45,17,0,41,45,45,3,94,42,42,45,54,40,40,42,196,31,1,0,82,40,17,0,25,40,40,1,85,17,40,0,119,0,195,255,88,40,22,0,145,40,40,0,62,42,0,0,223,67,234,191,204,204,236,63,145,42,42,0,73,40,40,42,120,40,3,0,1,38,11,0,119,0,83,0,88,40,22,0,145,40,40,0,62,42,0,0,82,253,247,158,153,153,241,63,145,42,42,0,71,40,40,42,120,40,3,0,1,38,13,0,119,0,73,0,59,42,1,0,145,42,42,0,88,45,22,0,145,45,45,0,66,40,42,45,145,40,40,0,89,19,40,0,1,40,0,0,85,17,40,0,82,40,9,0,82,45,17,0,56,40,40,45,36,33,1,0,82,40,31,0,82,45,17,0,41,45,45,3,94,40,40,45,82,45,15,0,49,40,40,45,232,32,1,0,82,40,15,0,82,45,31,0,82,42,17,0,41,42,42,3,3,45,45,42,106,45,45,4,49,40,40,45,224,32,1,0,88,36,19,0,145,36,36,0,88,37,35,0,145,37,37,0,82,40,33,0,82,45,34,0,82,42,17,0,82,44,15,0,82,41,31,0,82,43,17,0,41,43,43,3,94,41,41,43,4,44,44,41,134,7,0,0,192,105,2,0,40,45,37,42,44,0,0,0,88,42,7,0,145,42,42,0,65,44,42,36,145,44,44,0,89,7,44,0,119,0,4,0,1,38,19,0,119,0,2,0,1,38,19,0,32,44,38,19,121,44,9,0,1,38,0,0,82,44,15,0,82,42,31,0,82,45,17,0,41,45,45,3,94,42,42,45,54,44,44,42,36,33,1,0,82,44,17,0,25,44,44,1,85,17,44,0,119,0,198,255,82,44,15,0,25,44,44,1,85,15,44,0,119,0,92,255,32,44,38,11,121,44,8,0,1,42,10,55,1,45,90,48,1,40,116,4,1,41,23,55,135,44,8,0,42,45,40,41,119,0,159,0,32,44,38,13,121,44,8,0,1,41,64,55,1,40,90,48,1,45,117,4,1,42,23,55,135,44,8,0,41,40,45,42,119,0,150,0,32,44,38,22,121,44,148,0,1,44,0,0,85,17,44,0,82,44,9,0,82,42,17,0,56,44,44,42,100,35,1,0,1,44,0,0,85,18,44,0,88,10,35,0,145,10,10,0,82,45,33,0,82,40,34,0,82,41,17,0,82,43,18,0,134,42,0,0,192,105,2,0,45,40,10,41,43,0,0,0,88,44,42,0,145,44,44,0,59,42,0,0,145,42,42,0,69,11,44,42,82,13,18,0,120,11,2,0,119,0,4,0,25,42,13,1,85,18,42,0,119,0,236,255,82,42,31,0,82,44,17,0,41,44,44,3,3,14,42,44,82,44,14,0,3,44,44,13,85,14,44,0,82,44,31,0,82,42,17,0,41,42,42,3,3,16,44,42,1,42,0,0,82,44,31,0,82,43,17,0,41,43,43,3,94,44,44,43,56,42,42,44,92,34,1,0,82,42,16,0,25,42,42,1,85,16,42,0,82,42,18,0,25,42,42,1,85,18,42,0,119,0,239,255,106,42,16,4,82,44,31,0,82,43,17,0,41,43,43,3,94,44,44,43,4,42,42,44,25,42,42,1,85,25,42,0,82,44,12,0,82,43,25,0,134,42,0,0,200,142,2,0,44,43,0,0,85,27,42,0,82,43,34,0,88,44,35,0,145,44,44,0,134,42,0,0,72,49,2,0,43,44,0,0,85,28,42,0,1,42,0,0,85,15,42,0,82,42,27,0,82,44,15,0,56,42,42,44,84,35,1,0,82,42,28,0,82,44,15,0,82,43,18,0,3,44,44,43,56,42,42,44,84,35,1,0,88,20,35,0,145,20,20,0,82,44,33,0,82,43,34,0,82,41,17,0,82,40,15,0,82,45,18,0,3,40,40,45,134,42,0,0,192,105,2,0,44,43,20,41,40,0,0,0,88,21,42,0,145,21,21,0,88,23,35,0,145,23,23,0,82,40,33,0,82,41,34,0,82,43,17,0,82,44,15,0,134,42,0,0,192,105,2,0,40,41,23,43,44,0,0,0,89,42,21,0,82,42,15,0,25,42,42,1,85,15,42,0,119,0,218,255,82,42,17,0,25,42,42,1,85,17,42,0,119,0,139,255,1,42,0,0,85,15,42,0,82,42,9,0,82,44,15,0,56,42,42,44,200,35,1,0,82,42,31,0,82,44,15,0,41,44,44,3,3,42,42,44,106,42,42,4,82,44,8,0,26,44,44,1,134,26,0,0,200,142,2,0,42,44,0,0,82,44,31,0,82,42,15,0,41,42,42,3,3,44,44,42,109,44,4,26,82,44,15,0,25,44,44,1,85,15,44,0,119,0,234,255,137,39,0,0,139,0,0,0,139,0,0,0,140,2,68,0,0,0,0,0,2,62,0,0,173,29,0,0,2,63,0,0,176,29,0,0,2,64,0,0,172,29,0,0,25,36,0,4,82,39,36,0,38,65,39,248,0,42,65,0,3,45,0,42,1,65,192,118,82,49,65,0,38,65,39,3,0,56,65,0,33,65,56,1,18,66,49,0,19,65,65,66,16,66,0,45,19,65,65,66,120,65,2,0,135,65,9,0,25,15,45,4,82,21,15,0,38,65,21,1,120,65,2,0,135,65,9,0,120,56,19,0,1,65,0,1,48,65,1,65,96,36,1,0,1,8,0,0,139,8,0,0,25,65,1,4,50,65,65,42,140,36,1,0,4,65,42,1,1,66,144,120,82,66,66,0,41,66,66,1,50,65,65,66,140,36,1,0,0,8,0,0,139,8,0,0,1,8,0,0,139,8,0,0,50,65,1,42,236,36,1,0,4,37,42,1,37,65,37,15,121,65,3,0,0,8,0,0,139,8,0,0,3,38,0,1,38,65,39,1,20,65,65,1,39,65,65,2,85,36,65,0,39,66,37,3,109,38,4,66,82,66,15,0,39,66,66,1,85,15,66,0,134,66,0,0,92,100,0,0,38,37,0,0,0,8,0,0,139,8,0,0,1,66,200,118,82,66,66,0,45,66,66,45,80,37,1,0,1,66,188,118,82,66,66,0,3,40,66,42,4,41,40,1,3,43,0,1,50,66,40,1,32,37,1,0,1,8,0,0,139,8,0,0,38,66,39,1,20,66,66,1,39,66,66,2,85,36,66,0,39,65,41,1,109,43,4,65,1,65,200,118,85,65,43,0,1,65,188,118,85,65,41,0,0,8,0,0,139,8,0,0,1,65,196,118,82,65,65,0,45,65,65,45,16,38,1,0,1,65,184,118,82,65,65,0,3,44,65,42,48,65,44,1,124,37,1,0,1,8,0,0,139,8,0,0,4,46,44,1,1,65,15,0,48,65,65,46,204,37,1,0,3,47,0,1,3,48,0,44,38,65,39,1,20,65,65,1,39,65,65,2,85,36,65,0,39,66,46,1,109,47,4,66,85,48,46,0,25,50,48,4,82,66,50,0,38,66,66,254,85,50,66,0,0,60,47,0,0,61,46,0,119,0,12,0,38,66,39,1,20,66,66,44,39,66,66,2,85,36,66,0,3,66,0,44,25,51,66,4,82,66,51,0,39,66,66,1,85,51,66,0,1,60,0,0,1,61,0,0,1,66,184,118,85,66,61,0,1,66,196,118,85,66,60,0,0,8,0,0,139,8,0,0,38,66,21,2,121,66,3,0,1,8,0,0,139,8,0,0,38,66,21,248,3,52,66,42,48,66,52,1,56,38,1,0,1,8,0,0,139,8,0,0,4,53,52,1,43,66,21,3,0,54,66,0,1,66,0,1,48,66,21,66,252,38,1,0,106,55,45,8,106,57,45,12,1,66,216,118,41,65,54,1,41,65,65,2,3,58,66,65,46,65,55,58,140,38,1,0,48,65,55,49,124,38,1,0,135,65,9,0,106,65,55,12,46,65,65,45,140,38,1,0,135,65,9,0,45,65,57,55,184,38,1,0,1,65,176,118,1,66,176,118,82,66,66,0,1,67,1,0,22,67,67,54,11,67,67,0,19,66,66,67,85,65,66,0,119,0,141,0,45,66,57,58,200,38,1,0,25,10,57,8,119,0,11,0,48,66,57,49,212,38,1,0,135,66,9,0,25,59,57,8,82,66,59,0,45,66,66,45,236,38,1,0,0,10,59,0,119,0,2,0,135,66,9,0,109,55,12,57,85,10,55,0,119,0,124,0,106,11,45,24,106,12,45,12,45,66,12,45,164,39,1,0,25,17,45,16,25,18,17,4,82,19,18,0,120,19,8,0,82,20,17,0,120,20,3,0,1,9,0,0,119,0,49,0,0,4,20,0,0,7,17,0,119,0,3,0,0,4,19,0,0,7,18,0,0,2,4,0,0,5,7,0,25,22,2,20,82,23,22,0,120,23,8,0,25,24,2,16,82,25,24,0,120,25,2,0,119,0,9,0,0,3,25,0,0,6,24,0,119,0,3,0,0,3,23,0,0,6,22,0,0,2,3,0,0,5,6,0,119,0,242,255,48,66,5,49,148,39,1,0,135,66,9,0,119,0,23,0,1,66,0,0,85,5,66,0,0,9,2,0,119,0,19,0,106,13,45,8,48,66,13,49,180,39,1,0,135,66,9,0,25,14,13,12,82,66,14,0,46,66,66,45,200,39,1,0,135,66,9,0,25,16,12,8,82,66,16,0,45,66,66,45,232,39,1,0,85,14,12,0,85,16,13,0,0,9,12,0,119,0,2,0,135,66,9,0,121,11,63,0,106,26,45,28,1,66,224,119,41,65,26,2,3,27,66,65,82,65,27,0,45,65,65,45,56,40,1,0,85,27,9,0,120,9,27,0,1,65,180,118,1,66,180,118,82,66,66,0,1,67,1,0,22,67,67,26,11,67,67,0,19,66,66,67,85,65,66,0,119,0,45,0,1,66,192,118,82,66,66,0,48,66,11,66,80,40,1,0,135,66,9,0,119,0,12,0,25,28,11,16,82,65,28,0,45,65,65,45,104,40,1,0,0,66,28,0,119,0,3,0,25,65,11,20,0,66,65,0,85,66,9,0,120,9,2,0,119,0,28,0,1,66,192,118,82,29,66,0,48,66,9,29,144,40,1,0,135,66,9,0,109,9,24,11,25,30,45,16,82,31,30,0,121,31,8,0,48,66,31,29,176,40,1,0,135,66,9,0,119,0,4,0,109,9,16,31,109,31,24,9,119,0,1,0,106,32,30,4,121,32,10,0,1,66,192,118,82,66,66,0,48,66,32,66,220,40,1,0,135,66,9,0,119,0,4,0,109,9,20,32,109,32,24,9,119,0,1,0,35,66,53,16,121,66,13,0,38,66,39,1,20,66,66,52,39,66,66,2,85,36,66,0,3,66,0,52,25,33,66,4,82,66,33,0,39,66,66,1,85,33,66,0,0,8,0,0,139,8,0,0,119,0,18,0,3,34,0,1,38,66,39,1,20,66,66,1,39,66,66,2,85,36,66,0,39,65,53,3,109,34,4,65,3,65,0,52,25,35,65,4,82,65,35,0,39,65,65,1,85,35,65,0,134,65,0,0,92,100,0,0,34,53,0,0,0,8,0,0,139,8,0,0,1,65,0,0,139,65,0,0,140,0,31,0,0,0,0,0,2,21,0,0,245,28,0,0,2,22,0,0,250,28,0,0,2,23,0,0,247,28,0,0,1,15,0,0,136,24,0,0,0,16,24,0,136,24,0,0,1,25,160,1,3,24,24,25,137,24,0,0,130,24,0,0,136,25,0,0,49,24,24,25,196,41,1,0,1,25,160,1,135,24,0,0,25,0,0,0,1,24,88,1,3,0,16,24,1,24,216,0,3,13,16,24,1,24,24,1,3,1,16,24,1,24,152,0,3,2,16,24,1,24,148,0,3,5,16,24,1,24,144,0,3,7,16,24,25,8,16,80,25,9,16,16,25,10,16,8,25,11,16,4,0,12,16,0,0,14,1,0,1,17,12,115,25,18,14,64,116,14,17,0,25,14,14,4,25,17,17,4,54,24,14,18,20,42,1,0,0,14,2,0,1,17,80,115,25,18,14,64,116,14,17,0,25,14,14,4,25,17,17,4,54,24,14,18,52,42,1,0,1,24,1,0,85,5,24,0,1,25,0,0,1,26,2,0,1,27,1,0,125,24,25,26,27,0,0,0,85,5,24,0,1,24,0,0,85,7,24,0,82,24,5,0,82,27,7,0,56,24,24,27,104,47,1,0,82,24,5,0,32,24,24,2,121,24,21,0,82,3,7,0,0,14,13,0,0,17,1,0,25,18,14,64,116,14,17,0,25,14,14,4,25,17,17,4,54,24,14,18,156,42,1,0,0,14,0,0,0,17,2,0,25,18,14,64,116,14,17,0,25,14,14,4,25,17,17,4,54,24,14,18,188,42,1,0,134,24,0,0,196,188,1,0,3,13,0,0,1,24,0,0,1,27,192,81,1,26,220,115,82,26,26,0,27,26,26,48,94,27,27,26,47,24,24,27,36,47,1,0,1,27,228,115,82,27,27,0,135,24,194,0,27,0,0,0,0,14,13,0,1,17,80,115,25,18,14,64,116,14,17,0,25,14,14,4,25,17,17,4,54,24,14,18,24,43,1,0,0,14,0,0,1,17,12,115,25,18,14,64,116,14,17,0,25,14,14,4,25,17,17,4,54,24,14,18,56,43,1,0,134,24,0,0,212,150,0,0,8,13,0,0,1,24,232,115,82,24,24,0,106,6,24,24,0,14,0,0,0,17,8,0,25,18,14,64,116,14,17,0,25,14,14,4,25,17,17,4,54,24,14,18,112,43,1,0,134,24,0,0,236,245,1,0,9,0,0,0,1,27,1,0,1,26,0,0,135,24,195,0,6,27,26,9,1,26,232,115,82,26,26,0,106,26,26,44,59,27,1,0,59,25,1,0,59,28,1,0,59,29,1,0,135,24,196,0,26,27,25,28,29,0,0,0,1,29,232,115,82,29,29,0,106,29,29,56,1,28,0,0,135,24,197,0,29,28,0,0,1,24,0,0,85,10,24,0,1,24,161,120,78,24,24,0,38,24,24,1,121,24,13,0,1,28,236,115,82,28,28,0,38,28,28,31,1,29,192,81,1,25,220,115,82,25,25,0,27,25,25,48,3,29,29,25,106,29,29,28,135,24,198,0,28,29,0,0,119,0,92,0,2,28,0,0,146,136,0,0,1,29,192,81,1,25,220,115,82,25,25,0,27,25,25,48,3,29,29,25,106,29,29,32,135,24,199,0,28,29,0,0,1,29,232,115,82,29,29,0,82,29,29,0,1,28,3,0,1,25,6,20,1,27,0,0,1,26,0,0,1,30,0,0,135,24,200,0,29,28,25,27,26,30,0,0,1,30,232,115,82,30,30,0,82,30,30,0,135,24,201,0,30,0,0,0,2,30,0,0,146,136,0,0,1,26,192,81,1,27,220,115,82,27,27,0,27,27,27,48,3,26,26,27,25,26,26,32,106,26,26,4,135,24,199,0,30,26,0,0,1,26,232,115,82,26,26,0,106,26,26,4,1,30,2,0,1,27,6,20,1,25,0,0,1,28,0,0,1,29,0,0,135,24,200,0,26,30,27,25,28,29,0,0,1,29,232,115,82,29,29,0,106,29,29,4,135,24,201,0,29,0,0,0,2,29,0,0,146,136,0,0,1,28,192,81,1,25,220,115,82,25,25,0,27,25,25,48,3,28,28,25,25,28,28,32,106,28,28,8,135,24,199,0,29,28,0,0,1,28,232,115,82,28,28,0,106,28,28,20,1,29,4,0,1,25,1,20,1,27,1,0,1,30,0,0,1,26,0,0,135,24,200,0,28,29,25,27,30,26,0,0,1,26,232,115,82,26,26,0,106,26,26,20,135,24,201,0,26,0,0,0,2,26,0,0,147,136,0,0,1,30,192,81,1,27,220,115,82,27,27,0,27,27,27,48,3,30,30,27,25,30,30,32,106,30,30,12,135,24,199,0,26,30,0,0,2,30,0,0,192,132,0,0,135,24,202,0,30,0,0,0,1,24,0,0,85,11,24,0,1,24,216,115,82,24,24,0,82,30,11,0,56,24,24,30,220,46,1,0,1,30,225,13,1,26,212,115,82,26,26,0,82,27,11,0,41,27,27,4,3,26,26,27,106,26,26,12,135,24,203,0,30,26,0,0,1,24,212,115,82,24,24,0,82,26,11,0,41,26,26,4,94,24,24,26,32,24,24,1,121,24,3,0,1,15,13,0,119,0,26,0,1,24,212,115,82,24,24,0,82,26,11,0,41,26,26,4,94,24,24,26,32,24,24,4,121,24,3,0,1,15,13,0,119,0,17,0,1,26,4,0,1,30,212,115,82,30,30,0,82,27,11,0,41,27,27,4,3,30,30,27,106,30,30,4,28,30,30,4,27,30,30,6,1,27,3,20,82,25,10,0,41,25,25,1,29,25,25,4,27,25,25,6,135,24,204,0,26,30,27,25,32,24,15,13,121,24,12,0,1,15,0,0,1,24,212,115,82,24,24,0,82,25,11,0,41,25,25,4,3,20,24,25,82,24,20,0,82,27,10,0,106,30,20,4,135,25,205,0,24,27,30,0,1,25,212,115,82,25,25,0,82,30,11,0,41,30,30,4,3,19,25,30,82,30,10,0,106,25,19,4,106,27,19,8,3,25,25,27,3,30,30,25,85,10,30,0,82,30,11,0,25,30,30,1,85,11,30,0,119,0,181,255,1,30,161,120,78,30,30,0,38,30,30,1,120,30,11,0,2,25,0,0,146,136,0,0,1,27,0,0,135,30,199,0,25,27,0,0,2,27,0,0,147,136,0,0,1,25,0,0,135,30,199,0,27,25,0,0,1,25,225,13,1,27,0,0,135,30,203,0,25,27,0,0,1,30,161,120,78,30,30,0,38,30,30,1,121,30,7,0,1,27,236,115,82,27,27,0,38,27,27,31,1,25,0,0,135,30,198,0,27,25,0,0,1,27,0,0,135,30,194,0,27,0,0,0,82,30,7,0,25,30,30,1,85,7,30,0,119,0,195,254,1,30,192,81,1,27,220,115,82,27,27,0,27,27,27,48,1,25,0,0,97,30,27,25,1,25,192,81,1,27,220,115,82,27,27,0,27,27,27,48,3,25,25,27,1,27,0,0,109,25,4,27,1,27,192,81,1,25,220,115,82,25,25,0,27,25,25,48,3,27,27,25,1,25,0,0,109,27,8,25,1,25,148,29,59,27,255,255,145,27,27,0,89,25,27,0,1,14,12,115,0,17,1,0,25,18,14,64,116,14,17,0,25,14,14,4,25,17,17,4,54,27,14,18,212,47,1,0,1,14,80,115,0,17,2,0,25,18,14,64,116,14,17,0,25,14,14,4,25,17,17,4,54,27,14,18,244,47,1,0,1,27,0,0,85,12,27,0,1,27,0,1,82,25,12,0,56,27,27,25,132,48,1,0,1,27,212,115,82,27,27,0,82,25,12,0,41,25,25,4,1,30,7,0,97,27,25,30,1,30,212,115,82,30,30,0,82,25,12,0,41,25,25,4,3,30,30,25,1,25,0,0,109,30,4,25,1,25,212,115,82,25,25,0,82,30,12,0,41,30,30,4,3,25,25,30,1,30,224,115,82,30,30,0,109,25,12,30,82,30,12,0,25,30,30,1,85,12,30,0,119,0,228,255,1,30,216,115,1,25,1,0,85,30,25,0,1,25,220,115,82,25,25,0,25,4,25,1,1,25,220,115,85,25,4,0,1,25,220,115,1,27,1,0,1,24,220,115,82,24,24,0,17,27,27,24,1,24,0,0,125,30,27,24,4,0,0,0,85,25,30,0,137,16,0,0,139,0,0,0,140,2,45,0,0,0,0,0,2,34,0,0,2,32,2,0,2,35,0,0,3,32,2,0,2,36,0,0,98,29,0,0,2,37,0,0,101,29,0,0,1,30,0,0,136,38,0,0,0,31,38,0,136,38,0,0,1,39,176,0,3,38,38,39,137,38,0,0,130,38,0,0,136,39,0,0,49,38,38,39,48,49,1,0,1,39,176,0,135,38,0,0,39,0,0,0,25,2,31,56,25,25,31,48,25,24,31,40,25,28,31,32,25,27,31,24,25,26,31,16,25,23,31,8,0,22,31,0,1,38,164,0,3,8,31,38,1,38,156,0,3,9,31,38,1,38,152,0,3,10,31,38,25,11,31,88,25,12,31,80,25,13,31,76,25,15,31,72,25,19,31,68,25,4,31,64,1,38,160,0,3,6,31,38,85,9,0,0,85,10,1,0,1,38,148,117,82,39,9,0,85,38,39,0,1,39,152,117,82,38,10,0,85,39,38,0,134,38,0,0,124,116,2,0,11,0,0,0,1,29,156,117,0,32,11,0,25,33,29,64,116,29,32,0,25,29,29,4,25,32,32,4,54,38,29,33,192,49,1,0,1,39,1,0,135,38,206,0,39,0,0,0,135,38,207,0,120,38,13,0,1,39,4,0,1,40,205,44,134,38,0,0,252,32,2,0,39,40,22,0,1,38,0,0,83,8,38,0,78,3,8,0,38,38,3,1,0,7,38,0,137,31,0,0,139,7,0,0,1,38,220,117,1,40,148,117,82,40,40,0,85,38,40,0,1,40,224,117,1,38,152,117,82,38,38,0,85,40,38,0,135,38,208,0,1,38,0,0,121,38,7,0,2,40,0,0,4,0,2,0,1,39,0,0,135,38,209,0,40,39,0,0,119,0,6,0,2,39,0,0,4,0,2,0,1,40,1,0,135,38,209,0,39,40,0,0,1,38,0,0,121,38,7,0,2,40,0,0,3,0,2,0,1,39,1,0,135,38,209,0,40,39,0,0,119,0,6,0,2,39,0,0,3,0,2,0,1,40,0,0,135,38,209,0,39,40,0,0,1,38,0,0,121,38,7,0,2,40,0,0,5,0,2,0,1,39,0,0,135,38,209,0,40,39,0,0,119,0,6,0,2,39,0,0,5,0,2,0,1,40,1,0,135,38,209,0,39,40,0,0,1,38,0,0,121,38,6,0,2,40,0,0,13,16,2,0,1,39,4,0,135,38,209,0,40,39,0,0,134,38,0,0,196,162,2,0,32,38,38,2,121,38,8,0,1,39,2,0,135,38,209,0,34,39,0,0,1,39,1,0,135,38,209,0,35,39,0,0,119,0,45,0,134,38,0,0,196,162,2,0,32,38,38,3,121,38,19,0,1,39,3,0,135,38,209,0,34,39,0,0,1,39,3,0,135,38,209,0,35,39,0,0,2,39,0,0,8,32,2,0,2,40,0,0,1,32,3,0,135,38,209,0,39,40,0,0,2,40,0,0,6,32,2,0,1,39,0,0,135,38,209,0,40,39,0,0,119,0,23,0,134,38,0,0,196,162,2,0,32,38,38,4,121,38,19,0,1,39,2,0,135,38,209,0,34,39,0,0,1,39,0,0,135,38,209,0,35,39,0,0,2,39,0,0,1,32,2,0,2,40,0,0,2,0,3,0,135,38,209,0,39,40,0,0,2,40,0,0,11,32,2,0,2,39,0,0,1,96,3,0,135,38,209,0,40,39,0,0,1,38,0,0,121,38,115,0,1,38,228,117,1,39,220,117,82,39,39,0,28,39,39,2,1,40,148,117,82,40,40,0,28,40,40,2,4,39,39,40,85,38,39,0,1,39,232,117,1,38,224,117,82,38,38,0,28,38,38,2,1,40,152,117,82,40,40,0,28,40,40,2,4,38,38,40,85,39,38,0,1,38,228,117,82,38,38,0,34,38,38,0,121,38,4,0,1,38,228,117,1,39,0,0,85,38,39,0,1,39,232,117,82,39,39,0,34,39,39,0,121,39,4,0,1,39,232,117,1,38,0,0,85,39,38,0,1,38,0,0,85,12,38,0,135,39,210,0,135,38,211,0,39,12,0,0,85,13,38,0,1,38,0,0,85,15,38,0,82,38,12,0,82,39,15,0,56,38,38,39,228,52,1,0,1,38,148,117,82,38,38,0,82,39,13,0,82,40,15,0,27,40,40,24,94,39,39,40,49,38,38,39,212,52,1,0,1,38,152,117,82,38,38,0,82,39,13,0,82,40,15,0,27,40,40,24,3,39,39,40,106,39,39,4,49,38,38,39,212,52,1,0,1,30,29,0,119,0,5,0,82,38,15,0,25,38,38,1,85,15,38,0,119,0,230,255,32,38,30,29,121,38,14,0,1,38,220,117,82,39,13,0,82,40,15,0,27,40,40,24,94,39,39,40,85,38,39,0,1,39,224,117,82,38,13,0,82,40,15,0,27,40,40,24,3,38,38,40,106,38,38,4,85,39,38,0,1,38,224,117,82,14,38,0,1,38,220,117,82,38,38,0,85,23,38,0,109,23,4,14,1,39,4,0,1,40,231,44,134,38,0,0,252,32,2,0,39,40,23,0,1,40,220,117,82,40,40,0,1,39,224,117,82,39,39,0,134,38,0,0,88,111,1,0,40,39,0,0,1,38,220,117,82,16,38,0,1,38,224,117,82,17,38,0,1,38,144,117,82,18,38,0,1,38,136,117,135,40,210,0,1,41,0,0,135,39,212,0,16,17,18,40,41,0,0,0,85,38,39,0,119,0,25,0,1,39,136,117,1,41,148,117,82,41,41,0,1,40,152,117,82,40,40,0,1,42,144,117,82,42,42,0,1,43,0,0,1,44,0,0,135,38,212,0,41,40,42,43,44,0,0,0,85,39,38,0,1,38,136,117,82,38,38,0,121,38,9,0,1,38,236,117,1,39,148,117,82,39,39,0,85,38,39,0,1,39,240,117,1,38,152,117,82,38,38,0,85,39,38,0,1,38,136,117,82,38,38,0,120,38,14,0,135,38,213,0,1,39,4,0,1,44,13,45,134,38,0,0,252,32,2,0,39,44,26,0,1,38,0,0,83,8,38,0,78,3,8,0,38,38,3,1,0,7,38,0,137,31,0,0,139,7,0,0,1,44,3,0,1,39,46,45,134,38,0,0,252,32,2,0,44,39,27,0,1,38,240,117,82,20,38,0,1,38,236,117,82,38,38,0,85,28,38,0,109,28,4,20,1,39,3,0,1,44,86,45,134,38,0,0,252,32,2,0,39,44,28,0,1,38,152,117,82,21,38,0,1,38,148,117,82,38,38,0,85,24,38,0,109,24,4,21,1,44,3,0,1,39,107,45,134,38,0,0,252,32,2,0,44,39,24,0,1,38,248,117,82,5,38,0,1,38,244,117,82,38,38,0,85,2,38,0,109,2,4,5,1,39,3,0,1,44,128,45,134,38,0,0,252,32,2,0,39,44,2,0,1,44,136,117,82,44,44,0,1,39,1,0,135,38,214,0,44,39,0,0,1,39,136,117,82,39,39,0,1,44,2,0,135,38,215,0,39,44,0,0,1,44,136,117,82,44,44,0,1,39,1,0,135,38,216,0,44,39,0,0,1,39,136,117,82,39,39,0,1,44,1,0,135,38,217,0,39,44,0,0,1,44,136,117,82,44,44,0,1,39,1,0,135,38,218,0,44,39,0,0,1,39,136,117,82,39,39,0,1,44,3,0,135,38,219,0,39,44,0,0,1,44,136,117,82,44,44,0,1,39,2,0,135,38,220,0,44,39,0,0,1,39,136,117,82,39,39,0,1,44,4,0,135,38,221,0,39,44,0,0,1,44,136,117,82,44,44,0,1,39,2,0,135,38,222,0,44,39,0,0,1,39,136,117,82,39,39,0,135,38,223,0,39,0,0,0,1,38,0,0,121,38,9,0,1,39,1,0,135,38,224,0,39,0,0,0,1,39,3,0,1,44,153,45,134,38,0,0,252,32,2,0,39,44,25,0,1,44,148,117,82,44,44,0,1,39,152,117,82,39,39,0,134,38,0,0,64,214,0,0,44,39,0,0,1,38,236,117,82,38,38,0,85,19,38,0,1,38,240,117,82,38,38,0,85,4,38,0,82,39,19,0,82,44,4,0,134,38,0,0,224,113,2,0,39,44,0,0,1,38,245,255,83,6,38,0,1,44,245,255,107,6,1,44,1,38,245,255,107,6,2,38,1,44,255,255,107,6,3,44,78,44,6,0,83,2,44,0,102,38,6,1,107,2,1,38,102,44,6,2,107,2,2,44,102,38,6,3,107,2,3,38,134,38,0,0,192,153,2,0,2,0,0,0,1,38,1,0,83,8,38,0,78,3,8,0,38,38,3,1,0,7,38,0,137,31,0,0,139,7,0,0,140,6,53,0,0,0,0,0,136,49,0,0,0,45,49,0,136,49,0,0,1,50,176,0,3,49,49,50,137,49,0,0,130,49,0,0,136,50,0,0,49,49,49,50,176,56,1,0,1,50,176,0,135,49,0,0,50,0,0,0,1,49,128,0,3,10,45,49,25,9,45,120,25,8,45,104,25,7,45,88,25,6,45,68,25,33,45,64,25,36,45,60,25,39,45,56,25,41,45,52,25,11,45,48,25,13,45,44,25,16,45,40,25,18,45,36,25,22,45,32,25,23,45,28,25,24,45,24,25,25,45,8,0,26,45,0,85,33,1,0,89,36,3,0,89,39,4,0,82,50,33,0,135,49,15,0,50,0,0,0,85,41,49,0,1,49,0,0,85,11,49,0,59,49,0,0,145,49,49,0,89,13,49,0,88,27,36,0,145,27,27,0,82,50,0,0,76,50,50,0,145,50,50,0,66,49,27,50,145,49,49,0,89,16,49,0,1,49,0,0,85,18,49,0,82,49,41,0,82,50,18,0,56,49,49,50,224,60,1,0,1,49,0,0,85,22,49,0,82,50,33,0,82,51,18,0,3,50,50,51,134,49,0,0,208,96,1,0,50,22,0,0,85,23,49,0,82,28,23,0,0,44,10,0,0,46,0,0,25,47,44,36,116,44,46,0,25,44,44,4,25,46,46,4,54,49,44,47,152,57,1,0,134,49,0,0,156,99,2,0,10,28,0,0,85,24,49,0,82,49,23,0,32,49,49,63,121,49,3,0,1,49,1,0,85,22,49,0,82,49,23,0,32,49,49,10,121,49,18,0,82,48,0,0,28,49,48,2,3,29,48,49,76,49,29,0,145,29,49,0,88,50,16,0,145,50,50,0,65,49,29,50,145,49,49,0,75,30,49,0,82,49,11,0,3,49,49,30,85,11,49,0,59,49,0,0,145,49,49,0,89,13,49,0,119,0,168,0,82,49,23,0,33,49,49,32,82,50,23,0,33,50,50,9,19,49,49,50,121,49,115,0,88,31,2,0,145,31,31,0,88,49,13,0,145,49,49,0,63,32,31,49,145,32,32,0,106,49,0,32,82,50,24,0,27,50,50,36,3,49,49,50,106,34,49,4,76,49,34,0,145,34,49,0,88,51,16,0,145,51,51,0,65,50,34,51,145,50,50,0,63,49,32,50,145,49,49,0,89,25,49,0,112,35,2,4,145,35,35,0,82,49,11,0,76,49,49,0,145,49,49,0,63,37,35,49,145,37,37,0,106,49,0,32,82,50,24,0,27,50,50,36,3,49,49,50,106,38,49,8,76,49,38,0,145,38,49,0,88,52,16,0,145,52,52,0,65,51,38,52,145,51,51,0,63,50,37,51,145,50,50,0,113,25,4,50,106,50,0,28,82,49,24,0,41,49,49,4,3,50,50,49,112,40,50,8,145,40,40,0,88,51,16,0,145,51,51,0,65,49,40,51,145,49,49,0,113,25,8,49,106,49,0,28,82,50,24,0,41,50,50,4,3,49,49,50,112,42,49,12,145,42,42,0,88,51,16,0,145,51,51,0,65,50,42,51,145,50,50,0,113,25,12,50,25,43,0,8,106,50,0,28,82,49,24,0,41,49,49,4,3,12,50,49,59,49,0,0,145,49,49,0,89,26,49,0,59,50,0,0,145,50,50,0,113,26,4,50,116,6,43,0,106,49,43,4,109,6,4,49,106,50,43,8,109,6,8,50,106,49,43,12,109,6,12,49,106,50,43,16,109,6,16,50,116,7,12,0,106,49,12,4,109,7,4,49,106,50,12,8,109,7,8,50,106,49,12,12,109,7,12,49,116,8,25,0,106,50,25,4,109,8,4,50,106,49,25,8,109,8,8,49,106,50,25,12,109,8,12,50,116,9,26,0,106,49,26,4,109,9,4,49,78,49,5,0,83,10,49,0,102,50,5,1,107,10,1,50,102,49,5,2,107,10,2,49,102,50,5,3,107,10,3,50,59,49,0,0,145,49,49,0,134,50,0,0,176,101,1,0,6,7,8,9,49,10,0,0,106,50,0,32,82,49,24,0,27,49,49,36,3,50,50,49,106,50,50,12,120,50,21,0,106,50,0,28,82,49,24,0,41,49,49,4,3,50,50,49,112,14,50,8,145,14,14,0,88,50,16,0,145,50,50,0,65,15,14,50,145,15,15,0,88,50,39,0,145,50,50,0,63,17,15,50,145,17,17,0,88,49,13,0,145,49,49,0,63,50,49,17,145,50,50,0,89,13,50,0,119,0,22,0,106,50,0,32,82,49,24,0,27,49,49,36,3,50,50,49,106,19,50,12,76,50,19,0,145,19,50,0,88,50,16,0,145,50,50,0,65,20,19,50,145,20,20,0,88,50,39,0,145,50,50,0,63,21,20,50,145,21,21,0,88,49,13,0,145,49,49,0,63,50,49,21,145,50,50,0,89,13,50,0,119,0,1,0,82,50,18,0,82,49,22,0,26,49,49,1,3,50,50,49,85,18,50,0,82,50,18,0,25,50,50,1,85,18,50,0,119,0,30,255,137,45,0,0,139,0,0,0,140,1,35,0,0,0,0,0,136,31,0,0,0,29,31,0,136,31,0,0,1,32,160,0,3,31,31,32,137,31,0,0,130,31,0,0,136,32,0,0,49,31,31,32,36,61,1,0,1,32,160,0,135,31,0,0,32,0,0,0,25,1,29,80,25,26,29,72,25,25,29,48,25,24,29,40,25,23,29,32,25,28,29,24,25,27,29,16,0,22,29,0,1,31,148,0,3,2,29,31,1,31,144,0,3,9,29,31,1,31,140,0,3,10,29,31,1,31,136,0,3,11,29,31,1,31,132,0,3,12,29,31,1,31,128,0,3,15,29,31,25,18,29,124,25,19,29,104,25,21,29,100,85,2,0,0,82,31,2,0,82,31,31,0,120,31,3,0,137,29,0,0,139,0,0,0,82,31,2,0,106,31,31,4,120,31,3,0,137,29,0,0,139,0,0,0,82,31,2,0,106,31,31,8,120,31,3,0,137,29,0,0,139,0,0,0,1,31,1,0,85,9,31,0,82,31,2,0,25,31,31,4,116,10,31,0,82,31,2,0,25,31,31,8,116,11,31,0,82,32,10,0,82,33,11,0,82,34,2,0,106,34,34,16,134,31,0,0,160,15,2,0,32,33,34,0,85,12,31,0,82,34,10,0,33,34,34,1,121,34,4,0,1,34,1,0,0,31,34,0,119,0,4,0,82,34,11,0,33,34,34,1,0,31,34,0,120,31,2,0,119,0,47,0,82,31,10,0,33,31,31,1,121,31,4,0,82,31,10,0,28,31,31,2,85,10,31,0,82,31,11,0,33,31,31,1,121,31,4,0,82,31,11,0,28,31,31,2,85,11,31,0,82,31,10,0,34,31,31,1,121,31,3,0,1,31,1,0,85,10,31,0,82,31,11,0,34,31,31,1,121,31,3,0,1,31,1,0,85,11,31,0,82,13,11,0,82,14,12,0,116,22,10,0,109,22,4,13,109,22,8,14,1,34,2,0,1,33,15,60,134,31,0,0,252,32,2,0,34,33,22,0,82,31,9,0,25,31,31,1,85,9,31,0,82,31,10,0,82,33,11,0,82,34,2,0,106,34,34,16,134,16,0,0,160,15,2,0,31,33,34,0,82,34,12,0,3,34,34,16,85,12,34,0,119,0,200,255,82,17,9,0,82,34,2,0,25,34,34,12,116,27,34,0,109,27,4,17,1,33,2,0,1,31,60,60,134,34,0,0,252,32,2,0,33,31,27,0,116,28,12,0,1,31,2,0,1,33,105,60,134,34,0,0,252,32,2,0,31,33,28,0,82,34,2,0,116,1,34,0,1,33,2,0,1,31,137,60,134,34,0,0,252,32,2,0,33,31,1,0,82,34,9,0,82,31,2,0,106,31,31,12,49,34,34,31,112,63,1,0,1,31,4,0,1,33,65,61,134,34,0,0,252,32,2,0,31,33,26,0,137,29,0,0,139,0,0,0,82,33,2,0,82,33,33,0,82,31,12,0,134,34,0,0,60,120,2,0,33,31,0,0,85,15,34,0,82,34,15,0,121,34,10,0,82,34,2,0,116,34,15,0,116,23,15,0,1,31,2,0,1,33,175,60,134,34,0,0,252,32,2,0,31,33,23,0,119,0,6,0,1,33,4,0,1,31,217,60,134,34,0,0,252,32,2,0,33,31,24,0,82,34,2,0,82,20,34,0,82,30,2,0,106,31,30,4,106,33,30,8,106,32,30,16,134,34,0,0,160,15,2,0,31,33,32,0,3,34,20,34,85,18,34,0,82,34,2,0,106,34,34,4], eb + 71680);
  HEAPU8.set([28,34,34,2,85,10,34,0,82,34,2,0,106,34,34,8,28,34,34,2,85,11,34,0,82,32,10,0,82,33,11,0,82,31,2,0,106,31,31,16,134,34,0,0,160,15,2,0,32,33,31,0,85,12,34,0,82,3,2,0,116,1,3,0,106,31,3,4,109,1,4,31,106,34,3,8,109,1,8,34,106,31,3,12,109,1,12,31,106,34,3,16,109,1,16,34,134,34,0,0,212,223,1,0,19,1,0,0,1,34,1,0,85,21,34,0,82,34,9,0,82,31,21,0,56,34,34,31,120,65,1,0,82,4,10,0,82,5,11,0,82,6,12,0,82,7,18,0,116,25,21,0,109,25,4,4,109,25,8,5,109,25,12,6,109,25,16,7,1,31,2,0,1,33,8,61,134,34,0,0,252,32,2,0,31,33,25,0,82,33,10,0,82,31,11,0,134,34,0,0,44,182,1,0,19,33,31,0,82,31,18,0,82,33,19,0,82,32,12,0,135,34,32,0,31,33,32,0,82,34,18,0,82,32,12,0,3,34,34,32,85,18,34,0,82,34,2,0,25,8,34,12,82,34,8,0,25,34,34,1,85,8,34,0,82,34,10,0,28,34,34,2,85,10,34,0,82,34,11,0,28,34,34,2,85,11,34,0,82,34,10,0,34,34,34,1,121,34,3,0,1,34,1,0,85,10,34,0,82,34,11,0,34,34,34,1,121,34,3,0,1,34,1,0,85,11,34,0,82,32,10,0,82,33,11,0,82,31,2,0,106,31,31,16,134,34,0,0,160,15,2,0,32,33,31,0,85,12,34,0,82,34,21,0,25,34,34,1,85,21,34,0,119,0,192,255,116,1,19,0,106,31,19,4,109,1,4,31,106,34,19,8,109,1,8,34,106,31,19,12,109,1,12,31,106,34,19,16,109,1,16,34,134,34,0,0,128,160,2,0,1,0,0,0,137,29,0,0,139,0,0,0,140,1,66,0,0,0,0,0,136,61,0,0,0,48,61,0,136,61,0,0,25,61,61,16,137,61,0,0,130,61,0,0,136,62,0,0,49,61,61,62,232,65,1,0,1,62,16,0,135,61,0,0,62,0,0,0,25,1,48,8,25,38,48,4,0,40,48,0,85,1,0,0,82,49,1,0,106,62,49,80,112,63,49,56,145,63,63,0,134,61,0,0,200,141,2,0,62,63,0,0,85,38,61,0,82,50,1,0,106,63,50,84,112,62,50,60,145,62,62,0,134,61,0,0,148,25,2,0,63,62,0,0,85,40,61,0,82,61,1,0,112,39,61,56,145,39,39,0,82,51,1,0,106,61,51,80,106,62,51,4,106,63,51,20,134,41,0,0,192,56,2,0,39,61,62,63,82,63,1,0,1,62,152,0,97,63,62,41,82,62,1,0,112,42,62,60,145,42,42,0,82,52,1,0,106,62,52,84,106,63,52,8,106,61,52,24,134,43,0,0,192,56,2,0,42,62,63,61,82,61,1,0,1,63,156,0,97,61,63,43,82,63,1,0,1,61,164,0,82,62,40,0,25,62,62,1,97,63,61,62,82,53,1,0,1,62,188,0,1,61,152,0,94,61,53,61,41,61,61,3,97,53,62,61,82,62,1,0,134,61,0,0,252,133,2,0,62,0,0,0,41,61,61,2,0,44,61,0,82,61,1,0,1,62,192,0,97,61,62,44,82,54,1,0,1,62,196,0,1,61,156,0,94,61,54,61,41,61,61,3,97,54,62,61,82,62,1,0,134,61,0,0,112,134,2,0,62,0,0,0,41,61,61,2,0,45,61,0,82,61,1,0,1,62,200,0,97,61,62,45,82,55,1,0,106,61,55,4,82,63,38,0,41,63,63,1,3,61,61,63,106,63,55,64,5,62,61,63,41,62,62,2,0,46,62,0,82,62,1,0,1,63,204,0,97,62,63,46,82,56,1,0,106,62,56,20,106,61,56,64,5,63,62,61,41,63,63,2,0,47,63,0,82,63,1,0,1,61,208,0,97,63,61,47,82,57,1,0,106,61,57,20,106,63,57,64,5,2,61,63,82,61,1,0,1,62,164,0,94,61,61,62,5,63,2,61,41,63,63,2,0,3,63,0,82,63,1,0,1,61,212,0,97,63,61,3,82,58,1,0,106,63,58,20,106,62,58,64,5,61,63,62,41,61,61,2,0,4,61,0,82,61,1,0,1,62,216,0,97,61,62,4,82,62,1,0,106,62,62,80,120,62,7,0,1,61,14,58,1,63,90,48,1,64,217,8,1,65,43,58,135,62,8,0,61,63,64,65,1,62,6,0,82,65,1,0,106,65,65,80,50,62,62,65,40,68,1,0,1,65,186,48,1,64,90,48,1,63,218,8,1,61,43,58,135,62,8,0,65,64,63,61,82,62,1,0,106,62,62,84,120,62,7,0,1,61,67,58,1,63,90,48,1,64,219,8,1,65,43,58,135,62,8,0,61,63,64,65,1,62,6,0,82,65,1,0,106,65,65,84,50,62,62,65,120,68,1,0,1,65,31,49,1,64,90,48,1,63,220,8,1,61,43,58,135,62,8,0,65,64,63,61,82,61,1,0,134,62,0,0,80,148,2,0,61,0,0,0,33,5,62,0,82,6,1,0,121,5,47,0,1,62,208,0,1,61,0,0,97,6,62,61,82,59,1,0,0,7,59,0,1,61,188,0,3,8,7,61,82,9,8,0,0,10,59,0,1,61,192,0,3,11,10,61,82,12,11,0,3,13,9,12,0,14,59,0,1,61,196,0,3,15,14,61,82,16,15,0,3,17,13,16,0,18,59,0,1,61,200,0,3,19,18,61,82,20,19,0,3,21,17,20,0,22,59,0,1,61,204,0,3,23,22,61,82,24,23,0,3,25,21,24,0,26,59,0,1,61,208,0,3,27,26,61,82,28,27,0,3,29,25,28,0,30,59,0,1,61,212,0,3,31,30,61,82,32,31,0,3,33,29,32,0,34,59,0,1,61,216,0,3,35,34,61,82,36,35,0,3,37,33,36,137,48,0,0,139,37,0,0,119,0,46,0,1,61,216,0,1,62,0,0,97,6,61,62,82,60,1,0,0,7,60,0,1,62,188,0,3,8,7,62,82,9,8,0,0,10,60,0,1,62,192,0,3,11,10,62,82,12,11,0,3,13,9,12,0,14,60,0,1,62,196,0,3,15,14,62,82,16,15,0,3,17,13,16,0,18,60,0,1,62,200,0,3,19,18,62,82,20,19,0,3,21,17,20,0,22,60,0,1,62,204,0,3,23,22,62,82,24,23,0,3,25,21,24,0,26,60,0,1,62,208,0,3,27,26,62,82,28,27,0,3,29,25,28,0,30,60,0,1,62,212,0,3,31,30,62,82,32,31,0,3,33,29,32,0,34,60,0,1,62,216,0,3,35,34,62,82,36,35,0,3,37,33,36,137,48,0,0,139,37,0,0,1,62,0,0,139,62,0,0,140,5,49,0,0,0,0,0,2,42,0,0,225,13,0,0,136,43,0,0,0,41,43,0,136,43,0,0,1,44,160,0,3,43,43,44,137,43,0,0,130,43,0,0,136,44,0,0,49,43,43,44,76,70,1,0,1,44,160,0,135,43,0,0,44,0,0,0,25,40,41,88,25,39,41,72,25,38,41,48,25,37,41,40,25,36,41,32,25,35,41,24,25,34,41,16,25,33,41,8,0,32,41,0,1,43,148,0,3,19,41,43,1,43,144,0,3,20,41,43,1,43,140,0,3,21,41,43,1,43,136,0,3,28,41,43,1,43,132,0,3,31,41,43,1,43,128,0,3,5,41,43,25,7,41,124,25,11,41,120,25,12,41,116,25,13,41,112,25,14,41,108,25,15,41,104,25,16,41,100,25,17,41,96,25,18,41,92,85,20,0,0,85,21,1,0,85,28,2,0,85,31,3,0,85,5,4,0,1,44,0,0,135,43,203,0,42,44,0,0,1,43,0,0,85,7,43,0,1,43,165,120,78,43,43,0,38,43,43,1,120,43,22,0,82,43,31,0,32,43,43,11,82,44,31,0,32,44,44,12,20,43,43,44,82,44,31,0,32,44,44,13,20,43,43,44,82,44,31,0,32,44,44,14,20,43,43,44,121,43,10,0,1,44,4,0,1,45,3,42,134,43,0,0,252,32,2,0,44,45,32,0,116,19,7,0,82,10,19,0,137,41,0,0,139,10,0,0,1,43,166,120,78,43,43,0,38,43,43,1,40,43,43,1,82,45,31,0,32,45,45,15,19,43,43,45,121,43,10,0,1,45,4,0,1,44,47,42,134,43,0,0,252,32,2,0,45,44,33,0,116,19,7,0,82,10,19,0,137,41,0,0,139,10,0,0,1,43,167,120,78,43,43,0,38,43,43,1,120,43,16,0,82,43,31,0,32,43,43,16,82,44,31,0,32,44,44,17,20,43,43,44,121,43,10,0,1,44,4,0,1,45,92,42,134,43,0,0,252,32,2,0,44,45,34,0,116,19,7,0,82,10,19,0,137,41,0,0,139,10,0,0,1,43,168,120,78,43,43,0,38,43,43,1,120,43,16,0,82,43,31,0,32,43,43,18,82,45,31,0,32,45,45,19,20,43,43,45,121,43,10,0,1,45,4,0,1,44,137,42,134,43,0,0,252,32,2,0,45,44,35,0,116,19,7,0,82,10,19,0,137,41,0,0,139,10,0,0,1,43,169,120,78,43,43,0,38,43,43,1,120,43,16,0,82,43,31,0,32,43,43,20,82,44,31,0,32,44,44,21,20,43,43,44,121,43,10,0,1,44,4,0,1,45,182,42,134,43,0,0,252,32,2,0,44,45,36,0,116,19,7,0,82,10,19,0,137,41,0,0,139,10,0,0,1,45,245,12,1,44,1,0,135,43,225,0,45,44,0,0,1,44,1,0,135,43,226,0,44,7,0,0,82,44,7,0,135,43,203,0,42,44,0,0,116,11,21,0,116,12,28,0,1,43,0,0,85,13,43,0,116,37,20,0,1,44,2,0,1,45,227,42,134,43,0,0,252,32,2,0,44,45,37,0,1,43,0,0,85,14,43,0,82,43,5,0,82,45,14,0,56,43,43,45,28,74,1,0,82,45,11,0,82,44,12,0,82,46,31,0,134,43,0,0,160,15,2,0,45,44,46,0,85,15,43,0,82,46,31,0,134,43,0,0,32,129,1,0,46,16,17,18,82,22,11,0,82,23,12,0,82,24,15,0,82,25,13,0,116,38,14,0,109,38,4,22,109,38,8,23,109,38,12,24,109,38,16,25,1,46,2,0,1,44,15,43,134,43,0,0,252,32,2,0,46,44,38,0,82,43,16,0,33,43,43,255,121,43,28,0,82,26,14,0,82,27,16,0,82,29,11,0,82,30,12,0,82,43,31,0,34,43,43,11,121,43,12,0,1,44,0,0,82,46,17,0,82,45,18,0,82,47,20,0,82,48,13,0,3,47,47,48,135,43,227,0,42,26,27,29,30,44,46,45,47,0,0,0,119,0,10,0,1,47,0,0,82,45,15,0,82,46,20,0,82,44,13,0,3,46,46,44,135,43,228,0,42,26,27,29,30,47,45,46,119,0,1,0,82,43,11,0,28,43,43,2,85,11,43,0,82,43,12,0,28,43,43,2,85,12,43,0,82,43,13,0,82,46,15,0,3,43,43,46,85,13,43,0,82,43,11,0,34,43,43,1,121,43,3,0,1,43,1,0,85,11,43,0,82,43,12,0,34,43,43,1,121,43,3,0,1,43,1,0,85,12,43,0,82,43,14,0,25,43,43,1,85,14,43,0,119,0,174,255,1,43,163,120,78,43,43,0,38,43,43,1,121,43,10,0,1,46,2,40,1,45,1,41,135,43,229,0,42,46,45,0,1,45,3,40,1,46,1,41,135,43,229,0,42,45,46,0,119,0,11,0,1,46,2,40,2,45,0,0,47,129,0,0,135,43,229,0,42,46,45,0,1,45,3,40,2,46,0,0,47,129,0,0,135,43,229,0,42,45,46,0,1,46,0,40,1,45,0,38,135,43,229,0,42,46,45,0,1,45,1,40,1,46,0,38,135,43,229,0,42,45,46,0,1,46,0,0,135,43,203,0,42,46,0,0,1,43,0,0,82,46,7,0,48,43,43,46,232,74,1,0,82,6,21,0,82,8,28,0,82,9,5,0,116,39,7,0,109,39,4,6,109,39,8,8,109,39,12,9,1,46,3,0,1,45,68,43,134,43,0,0,252,32,2,0,46,45,39,0,119,0,6,0,1,45,4,0,1,46,130,43,134,43,0,0,252,32,2,0,45,46,40,0,116,19,7,0,82,10,19,0,137,41,0,0,139,10,0,0,140,3,62,0,0,0,0,0,136,58,0,0,0,55,58,0,136,58,0,0,25,58,58,112,137,58,0,0,130,58,0,0,136,59,0,0,49,58,58,59,68,75,1,0,1,59,112,0,135,58,0,0,59,0,0,0,25,23,55,96,25,27,55,32,25,29,55,24,25,35,55,20,25,40,55,16,25,44,55,12,25,49,55,8,25,3,55,4,0,8,55,0,89,23,2,0,0,54,27,0,25,57,54,64,1,58,0,0,85,54,58,0,25,54,54,4,54,58,54,57,116,75,1,0,88,58,1,0,145,58,58,0,89,29,58,0,112,58,1,4,145,58,58,0,89,35,58,0,112,58,1,8,145,58,58,0,89,40,58,0,88,18,29,0,145,18,18,0,88,58,29,0,145,58,58,0,65,19,18,58,145,19,19,0,88,20,35,0,145,20,20,0,88,59,35,0,145,59,59,0,65,58,20,59,145,58,58,0,63,21,19,58,145,21,21,0,88,22,40,0,145,22,22,0,88,61,40,0,145,61,61,0,65,60,22,61,145,60,60,0,63,59,21,60,145,59,59,0,135,58,230,0,59,0,0,0,145,58,58,0,89,44,58,0,88,58,44,0,145,58,58,0,59,59,1,0,145,59,59,0,70,24,58,59,88,59,44,0,145,59,59,0,59,58,0,0,145,58,58,0,70,59,59,58,19,59,24,59,121,59,29,0,59,58,1,0,145,58,58,0,88,60,44,0,145,60,60,0,66,59,58,60,145,59,59,0,89,44,59,0,88,25,44,0,145,25,25,0,88,60,29,0,145,60,60,0,65,59,60,25,145,59,59,0,89,29,59,0,88,26,44,0,145,26,26,0,88,60,35,0,145,60,60,0,65,59,60,26,145,59,59,0,89,35,59,0,88,28,44,0,145,28,28,0,88,60,40,0,145,60,60,0,65,59,60,28,145,59,59,0,89,40,59,0,88,60,23,0,145,60,60,0,135,59,12,0,60,0,0,0,145,59,59,0,89,49,59,0,88,60,23,0,145,60,60,0,135,59,13,0,60,0,0,0,145,59,59,0,89,3,59,0,59,60,1,0,145,60,60,0,88,58,3,0,145,58,58,0,64,59,60,58,145,59,59,0,89,8,59,0,88,30,29,0,145,30,30,0,88,59,29,0,145,59,59,0,65,31,30,59,145,31,31,0,88,59,8,0,145,59,59,0,65,32,31,59,145,32,32,0,88,58,3,0,145,58,58,0,63,59,32,58,145,59,59,0,89,27,59,0,88,33,35,0,145,33,33,0,88,59,29,0,145,59,59,0,65,34,33,59,145,34,34,0,88,59,8,0,145,59,59,0,65,36,34,59,145,36,36,0,88,37,40,0,145,37,37,0,88,61,49,0,145,61,61,0,65,60,37,61,145,60,60,0,63,58,36,60,145,58,58,0,113,27,16,58,88,38,40,0,145,38,38,0,88,58,29,0,145,58,58,0,65,39,38,58,145,39,39,0,88,58,8,0,145,58,58,0,65,41,39,58,145,41,41,0,88,42,35,0,145,42,42,0,88,61,49,0,145,61,61,0,65,60,42,61,145,60,60,0,64,59,41,60,145,59,59,0,113,27,32,59,59,58,0,0,145,58,58,0,113,27,48,58,88,43,29,0,145,43,43,0,88,58,35,0,145,58,58,0,65,45,43,58,145,45,45,0,88,58,8,0,145,58,58,0,65,46,45,58,145,46,46,0,88,47,40,0,145,47,47,0,88,61,49,0,145,61,61,0,65,60,47,61,145,60,60,0,64,59,46,60,145,59,59,0,113,27,4,59,88,48,35,0,145,48,48,0,88,59,35,0,145,59,59,0,65,50,48,59,145,50,50,0,88,59,8,0,145,59,59,0,65,51,50,59,145,51,51,0,88,60,3,0,145,60,60,0,63,58,51,60,145,58,58,0,113,27,20,58,88,52,40,0,145,52,52,0,88,58,35,0,145,58,58,0,65,53,52,58,145,53,53,0,88,58,8,0,145,58,58,0,65,4,53,58,145,4,4,0,88,5,29,0,145,5,5,0,88,61,49,0,145,61,61,0,65,60,5,61,145,60,60,0,63,59,4,60,145,59,59,0,113,27,36,59,59,58,0,0,145,58,58,0,113,27,52,58,88,6,29,0,145,6,6,0,88,58,40,0,145,58,58,0,65,7,6,58,145,7,7,0,88,58,8,0,145,58,58,0,65,9,7,58,145,9,9,0,88,10,35,0,145,10,10,0,88,61,49,0,145,61,61,0,65,60,10,61,145,60,60,0,63,59,9,60,145,59,59,0,113,27,8,59,88,11,35,0,145,11,11,0,88,59,40,0,145,59,59,0,65,12,11,59,145,12,12,0,88,59,8,0,145,59,59,0,65,13,12,59,145,13,13,0,88,14,29,0,145,14,14,0,88,61,49,0,145,61,61,0,65,60,14,61,145,60,60,0,64,58,13,60,145,58,58,0,113,27,24,58,88,15,40,0,145,15,15,0,88,58,40,0,145,58,58,0,65,16,15,58,145,16,16,0,88,58,8,0,145,58,58,0,65,17,16,58,145,17,17,0,88,60,3,0,145,60,60,0,63,59,17,60,145,59,59,0,113,27,40,59,59,58,0,0,145,58,58,0,113,27,56,58,59,59,0,0,145,59,59,0,113,27,12,59,59,58,0,0,145,58,58,0,113,27,28,58,59,59,0,0,145,59,59,0,113,27,44,59,59,58,1,0,145,58,58,0,113,27,60,58,0,54,0,0,0,56,27,0,25,57,54,64,116,54,56,0,25,54,54,4,25,56,56,4,54,58,54,57,220,79,1,0,137,55,0,0,139,0,0,0,140,0,24,0,0,0,0,0,2,14,0,0,192,81,0,0,2,15,0,0,0,128,0,0,2,16,0,0,0,96,0,0,136,17,0,0,0,13,17,0,136,17,0,0,25,17,17,48,137,17,0,0,130,17,0,0,136,18,0,0,49,17,17,18,72,80,1,0,1,18,48,0,135,17,0,0,18,0,0,0,25,12,13,8,0,11,13,0,25,0,13,36,25,1,13,32,25,4,13,28,25,6,13,24,25,7,13,20,25,8,13,16,25,9,13,12,1,17,0,0,85,0,17,0,1,17,1,0,82,18,0,0,56,17,17,18,72,83,1,0,2,17,0,0,0,128,1,0,135,10,6,0,17,0,0,0,82,17,0,0,27,17,17,48,3,17,14,17,109,17,12,10,2,17,0,0,0,0,1,0,135,2,6,0,17,0,0,0,82,17,0,0,27,17,17,48,3,17,14,17,109,17,16,2,135,3,6,0,15,0,0,0,82,17,0,0,27,17,17,48,3,17,14,17,109,17,20,3,135,5,6,0,16,0,0,0,82,17,0,0,27,17,17,48,3,17,14,17,109,17,24,5,1,17,0,0,85,1,17,0,82,17,1,0,56,17,16,17,60,81,1,0,82,17,0,0,27,17,17,48,3,17,14,17,106,17,17,12,82,18,1,0,41,18,18,2,59,19,0,0,145,19,19,0,101,17,18,19,82,19,1,0,25,19,19,1,85,1,19,0,119,0,241,255,1,19,0,0,85,4,19,0,1,19,0,64,82,18,4,0,56,19,19,18,136,81,1,0,82,19,0,0,27,19,19,48,3,19,14,19,106,19,19,16,82,18,4,0,41,18,18,2,59,17,0,0,145,17,17,0,101,19,18,17,82,17,4,0,25,17,17,1,85,4,17,0,119,0,240,255,1,17,0,0,85,6,17,0,82,17,6,0,56,17,15,17,200,81,1,0,82,17,0,0,27,17,17,48,3,17,14,17,106,17,17,20,82,18,6,0,1,19,0,0,95,17,18,19,82,19,6,0,25,19,19,1,85,6,19,0,119,0,243,255,1,19,0,0,85,7,19,0,1,19,0,0,85,8,19,0,1,19,0,48,82,18,8,0,56,19,19,18,0,83,1,0,82,19,0,0,27,19,19,48,3,19,14,19,106,19,19,24,82,18,8,0,41,18,18,1,82,17,7,0,41,17,17,2,96,19,18,17,82,17,0,0,27,17,17,48,3,17,14,17,106,17,17,24,82,18,8,0,25,18,18,1,41,18,18,1,82,19,7,0,41,19,19,2,25,19,19,1,96,17,18,19,82,19,0,0,27,19,19,48,3,19,14,19,106,19,19,24,82,18,8,0,25,18,18,2,41,18,18,1,82,17,7,0,41,17,17,2,25,17,17,2,96,19,18,17,82,17,0,0,27,17,17,48,3,17,14,17,106,17,17,24,82,18,8,0,25,18,18,3,41,18,18,1,82,19,7,0,41,19,19,2,96,17,18,19,82,19,0,0,27,19,19,48,3,19,14,19,106,19,19,24,82,18,8,0,25,18,18,4,41,18,18,1,82,17,7,0,41,17,17,2,25,17,17,2,96,19,18,17,82,17,0,0,27,17,17,48,3,17,14,17,106,17,17,24,82,18,8,0,25,18,18,5,41,18,18,1,82,19,7,0,41,19,19,2,25,19,19,3,96,17,18,19,82,19,7,0,25,19,19,1,85,7,19,0,82,19,8,0,25,19,19,6,85,8,19,0,119,0,183,255,82,19,0,0,27,19,19,48,1,18,0,0,97,14,19,18,82,18,0,0,27,18,18,48,3,18,14,18,1,19,0,0,109,18,4,19,82,19,0,0,27,19,19,48,3,19,14,19,1,18,0,0,109,19,8,18,82,18,0,0,25,18,18,1,85,0,18,0,119,0,76,255,1,19,3,0,1,17,137,36,134,18,0,0,252,32,2,0,19,17,11,0,1,18,0,0,85,9,18,0,1,18,1,0,82,17,9,0,56,18,18,17,88,86,1,0,1,18,161,120,78,18,18,0,38,18,18,1,121,18,20,0,1,17,40,117,82,17,17,0,38,17,17,63,1,19,1,0,82,20,9,0,27,20,20,48,3,20,14,20,25,20,20,28,135,18,231,0,17,19,20,0,1,17,236,115,82,17,17,0,38,17,17,31,82,20,9,0,27,20,20,48,3,20,14,20,106,20,20,28,135,18,198,0,17,20,0,0,1,17,1,0,82,20,9,0,27,20,20,48,3,20,14,20,25,20,20,32,135,18,232,0,17,20,0,0,2,20,0,0,146,136,0,0,82,17,9,0,27,17,17,48,3,17,14,17,106,17,17,32,135,18,199,0,20,17,0,0,2,17,0,0,146,136,0,0,2,20,0,0,0,128,1,0,82,19,9,0,27,19,19,48,3,19,14,19,106,19,19,12,2,21,0,0,232,136,0,0,135,18,233,0,17,20,19,21,1,21,232,115,82,21,21,0,82,21,21,0,135,18,201,0,21,0,0,0,1,21,232,115,82,21,21,0,82,21,21,0,1,19,3,0,1,20,6,20,1,17,0,0,1,22,0,0,1,23,0,0,135,18,200,0,21,19,20,17,22,23,0,0,1,23,1,0,82,22,9,0,27,22,22,48,3,22,14,22,25,22,22,32,25,22,22,4,135,18,232,0,23,22,0,0,2,22,0,0,146,136,0,0,82,23,9,0,27,23,23,48,3,23,14,23,25,23,23,32,106,23,23,4,135,18,199,0,22,23,0,0,2,23,0,0,146,136,0,0,2,22,0,0,0,0,1,0,82,17,9,0,27,17,17,48,3,17,14,17,106,17,17,16,2,20,0,0,232,136,0,0,135,18,233,0,23,22,17,20,1,20,232,115,82,20,20,0,106,20,20,4,135,18,201,0,20,0,0,0,1,20,232,115,82,20,20,0,106,20,20,4,1,17,2,0,1,22,6,20,1,23,0,0,1,19,0,0,1,21,0,0,135,18,200,0,20,17,22,23,19,21,0,0,1,21,1,0,82,19,9,0,27,19,19,48,3,19,14,19,25,19,19,32,25,19,19,8,135,18,232,0,21,19,0,0,2,19,0,0,146,136,0,0,82,21,9,0,27,21,21,48,3,21,14,21,25,21,21,32,106,21,21,8,135,18,199,0,19,21,0,0,2,21,0,0,146,136,0,0,82,19,9,0,27,19,19,48,3,19,14,19,106,19,19,20,2,23,0,0,232,136,0,0,135,18,233,0,21,15,19,23,1,23,232,115,82,23,23,0,106,23,23,20,135,18,201,0,23,0,0,0,1,23,232,115,82,23,23,0,106,23,23,20,1,19,4,0,1,21,1,20,1,22,1,0,1,17,0,0,1,20,0,0,135,18,200,0,23,19,21,22,17,20,0,0,1,20,1,0,82,17,9,0,27,17,17,48,3,17,14,17,25,17,17,32,25,17,17,12,135,18,232,0,20,17,0,0,2,17,0,0,147,136,0,0,82,20,9,0,27,20,20,48,3,20,14,20,25,20,20,32,106,20,20,12,135,18,199,0,17,20,0,0,2,20,0,0,147,136,0,0,82,17,9,0,27,17,17,48,3,17,14,17,106,17,17,24,2,22,0,0,228,136,0,0,135,18,233,0,20,16,17,22,82,18,9,0,25,18,18,1,85,9,18,0,119,0,68,255,1,22,3,0,1,17,185,36,134,18,0,0,252,32,2,0,22,17,12,0,1,18,161,120,78,18,18,0,38,18,18,1,120,18,3,0,137,13,0,0,139,0,0,0,1,17,236,115,82,17,17,0,38,17,17,31,1,22,0,0,135,18,198,0,17,22,0,0,137,13,0,0,139,0,0,0,140,2,40,0,0,0,0,0,136,36,0,0,0,35,36,0,136,36,0,0,25,36,36,80,137,36,0,0,130,36,0,0,136,37,0,0,49,36,36,37,220,86,1,0,1,37,80,0,135,36,0,0,37,0,0,0,25,2,35,48,0,34,35,0,25,12,35,44,25,15,35,40,25,20,35,36,25,22,35,32,25,25,35,28,25,28,35,24,25,30,35,4,85,12,0,0,82,36,12,0,82,36,36,0,120,36,3,0,137,35,0,0,139,0,0,0,82,36,12,0,106,36,36,4,120,36,3,0,137,35,0,0,139,0,0,0,82,36,12,0,106,36,36,8,120,36,3,0,137,35,0,0,139,0,0,0,88,36,1,0,145,36,36,0,59,37,0,0,145,37,37,0,71,36,36,37,121,36,12,0,88,13,1,0,145,13,13,0,25,14,1,8,88,37,14,0,145,37,37,0,63,36,37,13,145,36,36,0,89,14,36,0,59,36,0,0,145,36,36,0,89,1,36,0,112,36,1,4,145,36,36,0,59,37,0,0,145,37,37,0,71,36,36,37,121,36,12,0,112,16,1,4,145,16,16,0,25,17,1,12,88,37,17,0,145,37,37,0,63,36,37,16,145,36,36,0,89,17,36,0,59,37,0,0,145,37,37,0,113,1,4,37,88,18,1,0,145,18,18,0,112,37,1,8,145,37,37,0,63,19,18,37,145,19,19,0,82,36,12,0,106,37,36,4,76,37,37,0,145,37,37,0,73,37,19,37,121,37,10,0,82,37,12,0,106,21,37,4,76,37,21,0,145,21,37,0,88,38,1,0,145,38,38,0,64,36,21,38,145,36,36,0,113,1,8,36,112,23,1,4,145,23,23,0,112,36,1,12,145,36,36,0,63,24,23,36,145,24,24,0,82,37,12,0,106,36,37,8,76,36,36,0,145,36,36,0,73,36,24,36,121,36,10,0,82,36,12,0,106,26,36,8,76,36,26,0,145,26,36,0,112,38,1,4,145,38,38,0,64,37,26,38,145,37,37,0,113,1,12,37,88,27,1,0,145,27,27,0,82,36,12,0,106,37,36,4,76,37,37,0,145,37,37,0,71,37,27,37,121,37,154,0,112,29,1,4,145,29,29,0,82,36,12,0,106,37,36,8,76,37,37,0,145,37,37,0,71,37,29,37,121,37,146,0,82,31,12,0,116,2,31,0,106,36,31,4,109,2,4,36,106,37,31,8,109,2,8,37,106,36,31,12,109,2,12,36,106,37,31,16,109,2,16,37,134,37,0,0,24,194,0,0,2,0,0,0,85,15,37,0,112,37,1,8,145,37,37,0,75,32,37,0,112,38,1,12,145,38,38,0,75,38,38,0,5,36,32,38,41,36,36,2,135,37,6,0,36,0,0,0,85,20,37,0,112,37,1,4,145,37,37,0,75,37,37,0,85,22,37,0,112,33,1,4,145,33,33,0,112,36,1,12,145,36,36,0,63,37,33,36,145,37,37,0,75,37,37,0,82,36,22,0,56,37,37,36,48,90,1,0,88,37,1,0,145,37,37,0,75,37,37,0,85,25,37,0,88,3,1,0,145,3,3,0,112,36,1,8,145,36,36,0,63,37,3,36,145,37,37,0,75,37,37,0,82,36,25,0,56,37,37,36,32,90,1,0,82,37,22,0,112,36,1,4,145,36,36,0,75,36,36,0,4,4,37,36,112,36,1,8,145,36,36,0,75,36,36,0,5,5,4,36,82,36,20,0,82,37,25,0,88,38,1,0,145,38,38,0,75,38,38,0,4,37,37,38,3,37,5,37,41,37,37,2,3,6,36,37,82,37,22,0,82,36,12,0,106,36,36,4,5,7,37,36,82,36,15,0,82,37,25,0,3,37,7,37,41,37,37,2,3,8,36,37,78,37,8,0,83,6,37,0,102,36,8,1,107,6,1,36,102,37,8,2,107,6,2,37,102,36,8,3,107,6,3,36,82,36,25,0,25,36,36,1,85,25,36,0,119,0,208,255,82,36,22,0,25,36,36,1,85,22,36,0,119,0,190,255,82,37,15,0,135,36,5,0,37,0,0,0,82,36,12,0,25,36,36,16,116,28,36,0,82,9,12,0,116,2,9,0,106,37,9,4,109,2,4,37,106,36,9,8,109,2,8,36,106,37,9,12,109,2,12,37,106,36,9,16,109,2,16,36,134,36,0,0,128,160,2,0,2,0,0,0,82,10,12,0,112,36,1,8,145,36,36,0,75,11,36,0,82,37,20,0,112,38,1,12,145,38,38,0,75,38,38,0,134,36,0,0,144,225,1,0,30,37,11,38,116,10,30,0,106,38,30,4,109,10,4,38,106,36,30,8,109,10,8,36,106,38,30,12,109,10,12,38,106,36,30,16,109,10,16,36,82,38,20,0,135,36,5,0,38,0,0,0,82,38,12,0,82,37,28,0,134,36,0,0,24,33,0,0,38,37,0,0,137,35,0,0,139,0,0,0,1,37,4,0,1,38,162,59,134,36,0,0,252,32,2,0,37,38,34,0,137,35,0,0,139,0,0,0,140,8,38,0,0,0,0,0,2,31,0,0,0,0,32,0,2,32,0,0,255,15,0,0,2,33,0,0,255,0,0,0,136,34,0,0,0,30,34,0,136,34,0,0,1,35,80,1,3,34,34,35,137,34,0,0,130,34,0,0,136,35,0,0,49,34,34,35,100,91,1,0,1,35,80,1,135,34,0,0,35,0,0,0,1,34,68,1,3,28,30,34,1,34,64,1,3,29,30,34,1,34,60,1,3,8,30,34,1,34,56,1,3,10,30,34,1,34,52,1,3,11,30,34,1,34,48,1,3,12,30,34,1,34,44,1,3,14,30,34,1,34,40,1,3,15,30,34,1,34,36,1,3,16,30,34,1,34,32,1,3,17,30,34,1,34,28,1,3,18,30,34,1,34,24,1,3,21,30,34,1,34,20,1,3,22,30,34,1,34,16,1,3,23,30,34,25,24,30,8,25,25,30,4,0,26,30,0,1,34,72,1,3,27,30,34,85,28,0,0,85,29,1,0,85,8,2,0,85,10,3,0,85,11,4,0,85,12,5,0,85,14,6,0,85,15,7,0,1,35,33,0,82,36,28,0,134,34,0,0,100,42,2,0,35,36,0,0,1,36,249,0,82,35,28,0,134,34,0,0,100,42,2,0,36,35,0,0,1,35,4,0,82,36,28,0,134,34,0,0,100,42,2,0,35,36,0,0,1,36,5,0,82,35,28,0,134,34,0,0,100,42,2,0,36,35,0,0,82,35,14,0,19,35,35,33,82,36,28,0,134,34,0,0,100,42,2,0,35,36,0,0,82,36,14,0,43,36,36,8,19,36,36,33,82,35,28,0,134,34,0,0,100,42,2,0,36,35,0,0,1,35,0,0,82,36,28,0,134,34,0,0,100,42,2,0,35,36,0,0,1,36,0,0,82,35,28,0,134,34,0,0,100,42,2,0,36,35,0,0,1,35,44,0,82,36,28,0,134,34,0,0,100,42,2,0,35,36,0,0,82,36,8,0,19,36,36,33,82,35,28,0,134,34,0,0,100,42,2,0,36,35,0,0,82,35,8,0,43,35,35,8,19,35,35,33,82,36,28,0,134,34,0,0,100,42,2,0,35,36,0,0,82,36,10,0,19,36,36,33,82,35,28,0,134,34,0,0,100,42,2,0,36,35,0,0,82,35,10,0,43,35,35,8,19,35,35,33,82,36,28,0,134,34,0,0,100,42,2,0,35,36,0,0,82,36,11,0,19,36,36,33,82,35,28,0,134,34,0,0,100,42,2,0,36,35,0,0,82,35,11,0,43,35,35,8,19,35,35,33,82,36,28,0,134,34,0,0,100,42,2,0,35,36,0,0,82,36,12,0,19,36,36,33,82,35,28,0,134,34,0,0,100,42,2,0,36,35,0,0,82,35,12,0,43,35,35,8,19,35,35,33,82,36,28,0,134,34,0,0,100,42,2,0,35,36,0,0,1,36,128,0,82,35,15,0,82,35,35,0,3,36,36,35,26,36,36,1,82,35,28,0,134,34,0,0,100,42,2,0,36,35,0,0,82,35,28,0,82,36,15,0,134,34,0,0,172,35,2,0,35,36,0,0,82,34,15,0,116,16,34,0,1,34,1,0,82,36,15,0,82,36,36,0,22,34,34,36,85,17,34,0,82,36,16,0,82,35,28,0,134,34,0,0,100,42,2,0,36,35,0,0,135,34,6,0,31,0,0,0,85,18,34,0,82,35,18,0,1,36,0,0,135,34,3,0,35,36,31,0,1,34,255,255,85,21,34,0,82,34,16,0,25,34,34,1,85,22,34,0,82,34,17,0,25,34,34,1,85,23,34,0,1,36,0,0,107,24,1,36,1,36,0,0,83,24,36,0,1,34,0,0,109,24,4,34,82,36,28,0,82,35,17,0,82,37,22,0,134,34,0,0,16,97,2,0,36,24,35,37,1,34,0,0,85,25,34,0,82,34,12,0,82,37,25,0,57,34,34,37,248,95,1,0,1,34,0,0,85,26,34,0,82,34,11,0,82,37,26,0,57,34,34,37,232,95,1,0,82,34,25,0,82,37,11,0,5,9,34,37,82,37,29,0,82,34,26,0,3,34,9,34,41,34,34,2,25,34,34,3,90,37,37,34,83,27,37,0,82,37,21,0,34,37,37,0,121,37,4,0,79,37,27,0,85,21,37,0,119,0,64,0,82,37,18,0,82,34,21,0,41,34,34,9,3,37,37,34,79,34,27,0,41,34,34,1,92,37,37,34,121,37,10,0,82,37,18,0,82,34,21,0,41,34,34,9,3,37,37,34,79,34,27,0,41,34,34,1,93,37,37,34,85,21,37,0,119,0,47,0,82,34,28,0,82,35,21,0,82,36,22,0,134,37,0,0,16,97,2,0,34,24,35,36,82,37,23,0,25,13,37,1,85,23,13,0,82,37,18,0,82,36,21,0,41,36,36,9,3,37,37,36,79,36,27,0,41,36,36,1,96,37,36,13,1,36,1,0,82,37,22,0,22,36,36,37,82,37,23,0,50,36,36,37,132,95,1,0,82,36,22,0,25,36,36,1,85,22,36,0,82,36,23,0,45,36,36,32,208,95,1,0,82,37,28,0,82,35,17,0,82,34,22,0,134,36,0,0,16,97,2,0,37,24,35,34,82,34,18,0,1,35,0,0,135,36,3,0,34,35,31,0,82,36,16,0,25,36,36,1,85,22,36,0,82,36,17,0,25,36,36,1,85,23,36,0,79,36,27,0,85,21,36,0,82,36,26,0,25,36,36,1,85,26,36,0,119,0,170,255,82,36,25,0,25,36,36,1,85,25,36,0,119,0,160,255,82,35,28,0,82,34,21,0,82,37,22,0,134,36,0,0,16,97,2,0,35,24,34,37,82,37,28,0,82,34,17,0,82,35,22,0,134,36,0,0,16,97,2,0,37,24,34,35,82,35,28,0,82,34,17,0,25,34,34,1,82,37,16,0,25,37,37,1,134,36,0,0,16,97,2,0,35,24,34,37,78,36,24,0,120,36,2,0,119,0,6,0,1,37,0,0,134,36,0,0,88,48,2,0,24,37,0,0,119,0,249,255,106,36,24,4,120,36,11,0,82,19,28,0,1,37,0,0,134,36,0,0,100,42,2,0,37,19,0,0,82,20,18,0,135,36,5,0,20,0,0,0,137,30,0,0,139,0,0,0,82,37,28,0,134,36,0,0,100,122,2,0,37,24,0,0,82,19,28,0,1,37,0,0,134,36,0,0,100,42,2,0,37,19,0,0,82,20,18,0,135,36,5,0,20,0,0,0,137,30,0,0,139,0,0,0,140,2,22,0,0,0,0,0,2,16,0,0,128,0,0,0,2,17,0,0,224,0,0,0,2,18,0,0,240,0,0,0,1,14,0,0,136,19,0,0,0,15,19,0,136,19,0,0,25,19,19,32,137,19,0,0,130,19,0,0,136,20,0,0,49,19,19,20,36,97,1,0,1,20,32,0,135,19,0,0,20,0,0,0,25,6,15,16,25,7,15,12,25,8,15,8,25,9,15,4,0,10,15,0,25,11,15,25,25,12,15,24,25,13,15,23,25,2,15,22,25,3,15,21,25,4,15,20,85,7,0,0,85,8,1,0,1,19,63,0,85,9,19,0,82,19,7,0,79,19,19,0,85,10,19,0,82,19,8,0,1,20,1,0,85,19,20,0,82,20,10,0,36,20,20,127,121,20,5,0,82,20,7,0,78,20,20,0,85,9,20,0,119,0,253,0,82,20,10,0,19,20,20,17,1,19,192,0,45,20,20,19,56,98,1,0,82,20,7,0,102,20,20,1,83,11,20,0,79,20,11,0,121,20,25,0,79,20,11,0,42,20,20,6,32,20,20,2,121,20,21,0,1,20,194,0,82,19,10,0,17,20,20,19,82,19,10,0,1,21,223,0,17,19,19,21,19,20,20,19,120,20,2,0,119,0,230,0,82,20,10,0,38,20,20,31,41,20,20,6,79,19,11,0,38,19,19,63,20,20,20,19,85,9,20,0,82,20,8,0,1,19,2,0,85,20,19,0,119,0,219,0,82,19,8,0,1,20,2,0,85,19,20,0,116,6,9,0,82,5,6,0,137,15,0,0,139,5,0,0,82,20,10,0,19,20,20,18,45,20,20,17,160,99,1,0,82,20,7,0,102,20,20,1,83,12,20,0,1,20,0,0,83,13,20,0,79,20,12,0,121,20,73,0,79,20,12,0,42,20,20,6,32,20,20,2,121,20,69,0,82,20,7,0,102,20,20,2,83,13,20,0,79,20,13,0,121,20,57,0,79,20,13,0,42,20,20,6,32,20,20,2,121,20,53,0,82,20,10,0,45,20,20,17,204,98,1,0,1,20,160,0,79,19,12,0,49,20,20,19,200,98,1,0,79,20,12,0,1,19,191,0,49,20,20,19,200,98,1,0,1,14,19,0,119,0,2,0,1,14,19,0,32,20,14,19,121,20,30,0,82,20,10,0,1,19,237,0,45,20,20,19,4,99,1,0,79,20,12,0,54,20,20,16,76,99,1,0,1,20,159,0,79,19,12,0,54,20,20,19,76,99,1,0,82,20,10,0,54,20,20,17,132,101,1,0,82,20,10,0,38,20,20,15,41,20,20,12,79,19,12,0,38,19,19,63,41,19,19,6,20,20,20,19,79,19,13,0,38,19,19,63,20,20,20,19,85,9,20,0,82,20,8,0,1,19,3,0,85,20,19,0,119,0,143,0,82,19,8,0,1,20,2,0,85,19,20,0,116,6,9,0,82,5,6,0,137,15,0,0,139,5,0,0,82,20,8,0,1,19,3,0,85,20,19,0,116,6,9,0,82,5,6,0,137,15,0,0,139,5,0,0,82,19,8,0,1,20,2,0,85,19,20,0,116,6,9,0,82,5,6,0,137,15,0,0,139,5,0,0,82,20,10,0,1,19,248,0,19,20,20,19,45,20,20,18,132,101,1,0,1,20,244,0,82,19,10,0,47,20,20,19,212,99,1,0,116,6,9,0,82,5,6,0,137,15,0,0,139,5,0,0,82,20,7,0,102,20,20,1,83,2,20,0,1,20,0,0,83,3,20,0,1,20,0,0,83,4,20,0,79,20,2,0,121,20,93,0,79,20,2,0,42,20,20,6,32,20,20,2,121,20,89,0,82,20,7,0,102,20,20,2,83,3,20,0,79,20,3,0,121,20,77,0,79,20,3,0,42,20,20,6,32,20,20,2,121,20,73,0,82,20,7,0,102,20,20,3,83,4,20,0,79,20,4,0,121,20,61,0,79,20,4,0,42,20,20,6,32,20,20,2,121,20,57,0,82,20,10,0,45,20,20,18,132,100,1,0,1,20,144,0,79,19,2,0,49,20,20,19,128,100,1,0,79,20,2,0,1,19,191,0,49,20,20,19,128,100,1,0,1,14,40,0,119,0,2,0,1,14,40,0,32,20,14,40,121,20,34,0,82,20,10,0,1,19,244,0,45,20,20,19,188,100,1,0,79,20,2,0,54,20,20,16,20,101,1,0,1,20,143,0,79,19,2,0,54,20,20,19,20,101,1,0,82,20,10,0,54,20,20,18,132,101,1,0,82,20,10,0,38,20,20,7,41,20,20,18,79,19,2,0,38,19,19,63,41,19,19,12,20,20,20,19,79,19,3,0,38,19,19,63,41,19,19,6,20,20,20,19,79,19,4,0,38,19,19,63,20,20,20,19,85,9,20,0,82,20,8,0,1,19,4,0,85,20,19,0,119,0,29,0,82,19,8,0,1,20,2,0,85,19,20,0,116,6,9,0,82,5,6,0,137,15,0,0,139,5,0,0,82,20,8,0,1,19,4,0,85,20,19,0,116,6,9,0,82,5,6,0,137,15,0,0,139,5,0,0,82,19,8,0,1,20,3,0,85,19,20,0,116,6,9,0,82,5,6,0,137,15,0,0,139,5,0,0,82,20,8,0,1,19,2,0,85,20,19,0,116,6,9,0,82,5,6,0,137,15,0,0,139,5,0,0,2,19,0,0,255,255,16,0,82,20,9,0,47,19,19,20,160,101,1,0,1,19,63,0,85,9,19,0,116,6,9,0,82,5,6,0,137,15,0,0,139,5,0,0,140,6,50,0,0,0,0,0,136,45,0,0,0,44,45,0,136,45,0,0,25,45,45,16,137,45,0,0,130,45,0,0,136,46,0,0,49,45,45,46,232,101,1,0,1,46,16,0,135,45,0,0,46,0,0,0,25,27,44,8,25,31,44,4,0,36,44,0,25,40,44,12,89,27,4,0,82,45,0,0,37,45,45,0,121,45,3,0,137,44,0,0,139,0,0,0,106,45,0,4,76,45,45,0,145,45,45,0,89,31,45,0,106,45,0,8,76,45,45,0,145,45,45,0,89,36,45,0,1,45,0,0,83,40,45,0,112,45,1,8,145,45,45,0,59,46,0,0,145,46,46,0,71,45,45,46,121,45,11,0,1,45,1,0,83,40,45,0,25,18,1,8,88,46,18,0,145,46,46,0,59,47,255,255,145,47,47,0,65,45,46,47,145,45,45,0,89,18,45,0,112,45,1,12,145,45,45,0,59,47,0,0,145,47,47,0,71,45,45,47,121,45,9,0,112,19,1,12,145,19,19,0,25,20,1,4,88,47,20,0,145,47,47,0,64,45,47,19,145,45,45,0,89,20,45,0,82,47,0,0,134,45,0,0,172,190,1,0,47,0,0,0,134,45,0,0,28,127,2,0,88,21,2,0,145,21,21,0,112,47,2,4,145,47,47,0,59,46,0,0,145,46,46,0,134,45,0,0,116,3,2,0,21,47,46,0,88,46,27,0,145,46,46,0,59,47,0,0,145,47,47,0,59,48,0,0,145,48,48,0,59,49,1,0,145,49,49,0,134,45,0,0,244,186,1,0,46,47,48,49,88,45,3,0,145,45,45,0,68,22,45,0,145,22,22,0,112,48,3,4,145,48,48,0,68,49,48,0,145,49,49,0,59,48,0,0,145,48,48,0,134,45,0,0,116,3,2,0,22,49,48,0,1,48,7,0,134,45,0,0,152,178,1,0,48,0,0,0,78,48,5,0,102,49,5,1,102,47,5,2,102,46,5,3,134,45,0,0,112,28,2,0,48,49,47,46,59,46,0,0,145,46,46,0,59,47,0,0,145,47,47,0,59,49,1,0,145,49,49,0,134,45,0,0,124,149,2,0,46,47,49,0,88,23,1,0,145,23,23,0,78,45,40,0,38,45,45,1,121,45,19,0,112,45,1,8,145,45,45,0,63,24,23,45,145,24,24,0,88,45,31,0,145,45,45,0,66,25,24,45,145,25,25,0,112,26,1,4,145,26,26,0,88,47,36,0,145,47,47,0,66,49,26,47,145,49,49,0,134,45,0,0,196,98,2,0,25,49,0,0,119,0,14,0,88,45,31,0,145,45,45,0], eb + 81920);
  HEAPU8.set([66,28,23,45,145,28,28,0,112,29,1,4,145,29,29,0,88,47,36,0,145,47,47,0,66,49,29,47,145,49,49,0,134,45,0,0,196,98,2,0,28,49,0,0,59,49,0,0,145,49,49,0,59,47,0,0,145,47,47,0,134,45,0,0,216,140,2,0,49,47,0,0,88,30,1,0,145,30,30,0,78,45,40,0,38,45,45,1,121,45,23,0,112,45,1,8,145,45,45,0,63,32,30,45,145,32,32,0,88,45,31,0,145,45,45,0,66,33,32,45,145,33,33,0,112,34,1,4,145,34,34,0,112,45,1,12,145,45,45,0,63,35,34,45,145,35,35,0,88,49,36,0,145,49,49,0,66,47,35,49,145,47,47,0,134,45,0,0,196,98,2,0,33,47,0,0,119,0,18,0,88,45,31,0,145,45,45,0,66,37,30,45,145,37,37,0,112,38,1,4,145,38,38,0,112,45,1,12,145,45,45,0,63,39,38,45,145,39,39,0,88,49,36,0,145,49,49,0,66,47,39,49,145,47,47,0,134,45,0,0,196,98,2,0,37,47,0,0,59,47,0,0,145,47,47,0,112,49,2,12,145,49,49,0,134,45,0,0,216,140,2,0,47,49,0,0,88,41,1,0,145,41,41,0,78,45,40,0,38,45,45,1,121,45,19,0,88,45,31,0,145,45,45,0,66,42,41,45,145,42,42,0,112,43,1,4,145,43,43,0,112,45,1,12,145,45,45,0,63,6,43,45,145,6,6,0,88,47,36,0,145,47,47,0,66,49,6,47,145,49,49,0,134,45,0,0,196,98,2,0,42,49,0,0,119,0,22,0,112,45,1,8,145,45,45,0,63,7,41,45,145,7,7,0,88,45,31,0,145,45,45,0,66,8,7,45,145,8,8,0,112,9,1,4,145,9,9,0,112,45,1,12,145,45,45,0,63,10,9,45,145,10,10,0,88,47,36,0,145,47,47,0,66,49,10,47,145,49,49,0,134,45,0,0,196,98,2,0,8,49,0,0,112,11,2,8,145,11,11,0,112,49,2,12,145,49,49,0,134,45,0,0,216,140,2,0,11,49,0,0,88,12,1,0,145,12,12,0,78,45,40,0,38,45,45,1,121,45,15,0,88,45,31,0,145,45,45,0,66,13,12,45,145,13,13,0,112,14,1,4,145,14,14,0,88,47,36,0,145,47,47,0,66,49,14,47,145,49,49,0,134,45,0,0,196,98,2,0,13,49,0,0,119,0,18,0,112,45,1,8,145,45,45,0,63,15,12,45,145,15,15,0,88,45,31,0,145,45,45,0,66,16,15,45,145,16,16,0,112,17,1,4,145,17,17,0,88,47,36,0,145,47,47,0,66,49,17,47,145,49,49,0,134,45,0,0,196,98,2,0,16,49,0,0,112,49,2,8,145,49,49,0,59,47,0,0,145,47,47,0,134,45,0,0,216,140,2,0,49,47,0,0,134,45,0,0,244,122,1,0,134,45,0,0,92,94,2,0,134,45,0,0,12,157,2,0,137,44,0,0,139,0,0,0,140,7,38,0,0,0,0,0,1,31,0,0,136,33,0,0,0,32,33,0,136,33,0,0,25,33,33,48,137,33,0,0,130,33,0,0,136,34,0,0,49,33,33,34,232,106,1,0,1,34,48,0,135,33,0,0,34,0,0,0,25,23,32,40,25,25,32,36,25,27,32,32,25,7,32,28,25,8,32,24,25,11,32,20,25,12,32,16,25,13,32,12,25,14,32,8,25,15,32,4,0,16,32,0,85,23,0,0,89,25,1,0,85,27,2,0,85,7,3,0,89,8,4,0,85,11,5,0,85,12,6,0,59,33,0,0,145,33,33,0,89,14,33,0,82,33,7,0,82,34,27,0,4,17,33,34,59,34,1,0,145,34,34,0,88,33,25,0,145,33,33,0,66,18,34,33,145,18,18,0,1,36,160,20,82,37,23,0,41,37,37,3,3,36,36,37,106,36,36,4,38,36,36,7,135,35,234,0,36,18,0,0,145,35,35,0,59,36,2,0,145,36,36,0,65,34,35,36,145,34,34,0,135,33,11,0,34,0,0,0,75,33,33,0,47,33,33,17,192,107,1,0,1,34,115,56,1,36,90,48,1,35,19,4,1,37,214,56,135,33,8,0,34,36,35,37,82,33,11,0,116,33,27,0,82,33,11,0,82,37,7,0,109,33,4,37,82,37,11,0,106,37,37,4,82,33,11,0,82,33,33,0,47,37,37,33,4,108,1,0,1,33,223,55,1,35,90,48,1,36,24,4,1,34,214,56,135,37,8,0,33,35,36,34,1,37,0,0,85,13,37,0,82,37,7,0,82,34,27,0,4,37,37,34,82,34,13,0,54,37,37,34,80,109,1,0,82,36,13,0,82,35,27,0,3,34,36,35,76,34,34,0,145,34,34,0,61,35,0,0,0,0,0,63,145,35,35,0,63,37,34,35,145,37,37,0,89,16,37,0,88,19,8,0,145,19,19,0,88,37,16,0,145,37,37,0,64,20,19,37,145,20,20,0,59,37,1,0,145,37,37,0,88,35,25,0,145,35,35,0,66,21,37,35,145,21,21,0,1,35,160,20,82,37,23,0,41,37,37,3,94,35,35,37,38,35,35,7,135,22,235,0,35,20,21,0,145,22,22,0,82,35,12,0,82,37,13,0,41,37,37,2,101,35,37,22,82,37,13,0,120,37,21,0,82,35,12,0,82,34,13,0,41,34,34,2,100,37,35,34,145,37,37,0,59,35,0,0,145,35,35,0,70,37,37,35,121,37,3,0,1,31,10,0,119,0,11,0,82,37,27,0,25,24,37,1,85,27,24,0,82,37,11,0,85,37,24,0,82,37,13,0,26,37,37,1,85,13,37,0,119,0,2,0,1,31,10,0,32,37,31,10,121,37,12,0,1,31,0,0,82,37,12,0,82,35,13,0,41,35,35,2,100,26,37,35,145,26,26,0,88,35,14,0,145,35,35,0,63,37,35,26,145,37,37,0,89,14,37,0,82,37,13,0,25,37,37,1,85,13,37,0,119,0,176,255,82,35,7,0,25,37,35,1,76,37,37,0,145,37,37,0,61,35,0,0,0,0,0,63,145,35,35,0,63,28,37,35,145,28,28,0,88,35,8,0,145,35,35,0,64,29,28,35,145,29,29,0,59,35,1,0,145,35,35,0,88,37,25,0,145,37,37,0,66,30,35,37,145,30,30,0,1,35,160,20,82,34,23,0,41,34,34,3,94,35,35,34,38,35,35,7,135,37,235,0,35,29,30,0,145,37,37,0,59,35,0,0,145,35,35,0,69,37,37,35,120,37,7,0,1,35,253,56,1,34,90,48,1,36,42,4,1,33,214,56,135,37,8,0,35,34,36,33,88,37,14,0,145,37,37,0,62,33,0,0,205,204,204,204,204,204,236,63,73,37,37,33,120,37,7,0,1,33,105,57,1,36,90,48,1,34,44,4,1,35,214,56,135,37,8,0,33,36,34,35,88,37,14,0,145,37,37,0,62,35,0,0,82,253,247,158,153,153,241,63,145,35,35,0,71,37,37,35,120,37,7,0,1,35,124,57,1,34,90,48,1,36,45,4,1,33,214,56,135,37,8,0,35,34,36,33,59,33,1,0,145,33,33,0,88,36,14,0,145,36,36,0,66,37,33,36,145,37,37,0,89,15,37,0,1,37,0,0,85,13,37,0,82,37,7,0,82,36,27,0,4,37,37,36,82,36,13,0,54,37,37,36,200,110,1,0,88,9,15,0,145,9,9,0,82,37,12,0,82,36,13,0,41,36,36,2,3,10,37,36,88,37,10,0,145,37,37,0,65,36,37,9,145,36,36,0,89,10,36,0,82,36,13,0,25,36,36,1,85,13,36,0,119,0,236,255,82,36,7,0,82,37,27,0,4,36,36,37,85,13,36,0,82,36,13,0,34,36,36,0,121,36,3,0,1,31,25,0,119,0,23,0,82,37,12,0,82,33,13,0,41,33,33,2,100,36,37,33,145,36,36,0,59,37,0,0,145,37,37,0,70,36,36,37,121,36,3,0,1,31,25,0,119,0,12,0,82,36,11,0,82,37,11,0,82,37,37,0,82,33,13,0,3,37,37,33,26,37,37,1,109,36,4,37,82,37,13,0,26,37,37,1,85,13,37,0,119,0,230,255,32,37,31,25,121,37,3,0,137,32,0,0,139,0,0,0,139,0,0,0,140,2,41,0,0,0,0,0,2,34,0,0,101,29,0,0,2,35,0,0,102,29,0,0,2,36,0,0,123,29,0,0,136,37,0,0,0,31,37,0,136,37,0,0,1,38,144,0,3,37,37,38,137,37,0,0,130,37,0,0,136,38,0,0,49,37,37,38,172,111,1,0,1,38,144,0,135,37,0,0,38,0,0,0,25,29,31,24,25,28,31,16,0,27,31,0,25,10,31,120,25,12,31,116,25,14,31,112,25,17,31,48,25,22,31,44,25,25,31,40,1,37,128,0,97,31,37,0,109,31,124,1,1,37,148,117,82,37,37,0,1,38,220,117,82,38,38,0,49,37,37,38,36,114,1,0,1,37,152,117,82,37,37,0,1,38,224,117,82,38,38,0,49,37,37,38,36,114,1,0,1,37,220,117,82,37,37,0,1,38,148,117,82,38,38,0,49,37,37,38,124,112,1,0,1,37,224,117,82,37,37,0,1,38,152,117,82,38,38,0,49,37,37,38,124,112,1,0,1,37,236,117,1,38,148,117,82,38,38,0,85,37,38,0,1,38,240,117,1,37,152,117,82,37,37,0,85,38,37,0,1,37,244,117,1,38,0,0,85,37,38,0,1,38,248,117,1,37,0,0,85,38,37,0,137,31,0,0,139,0,0,0,1,37,152,117,82,18,37,0,1,37,220,117,82,19,37,0,1,37,224,117,82,20,37,0,1,37,148,117,82,37,37,0,85,29,37,0,109,29,4,18,109,29,8,19,109,29,12,20,1,38,3,0,1,39,239,46,134,37,0,0,252,32,2,0,38,39,29,0,1,37,220,117,82,21,37,0,76,37,21,0,145,21,37,0,1,38,224,117,82,39,38,0,76,39,39,0,145,39,39,0,66,37,21,39,145,37,37,0,89,22,37,0,1,37,148,117,82,23,37,0,76,37,23,0,145,23,37,0,1,38,152,117,82,39,38,0,76,39,39,0,145,39,39,0,66,37,23,39,145,37,37,0,89,25,37,0,88,24,22,0,145,24,24,0,88,37,25,0,145,37,37,0,72,37,24,37,121,37,32,0,1,37,236,117,1,39,148,117,82,39,39,0,85,37,39,0,1,39,148,117,82,26,39,0,76,39,26,0,145,26,39,0,1,39,240,117,88,40,22,0,145,40,40,0,66,38,26,40,145,38,38,0,134,37,0,0,20,159,2,0,38,0,0,0,75,37,37,0,85,39,37,0,1,37,244,117,1,39,0,0,85,37,39,0,1,39,248,117,1,37,240,117,82,37,37,0,1,38,152,117,82,38,38,0,4,37,37,38,85,39,37,0,137,31,0,0,139,0,0,0,119,0,31,0,1,37,152,117,82,2,37,0,76,37,2,0,145,2,37,0,1,37,236,117,88,40,22,0,145,40,40,0,65,38,2,40,145,38,38,0,134,39,0,0,20,159,2,0,38,0,0,0,75,39,39,0,85,37,39,0,1,39,240,117,1,37,152,117,82,37,37,0,85,39,37,0,1,37,244,117,1,39,236,117,82,39,39,0,1,38,148,117,82,38,38,0,4,39,39,38,85,37,39,0,1,39,248,117,1,37,0,0,85,39,37,0,137,31,0,0,139,0,0,0,1,37,152,117,82,3,37,0,1,37,220,117,82,4,37,0,1,37,224,117,82,5,37,0,1,37,148,117,82,37,37,0,85,27,37,0,109,27,4,3,109,27,8,4,109,27,12,5,1,39,4,0,1,38,96,46,134,37,0,0,252,32,2,0,39,38,27,0,1,37,220,117,82,6,37,0,76,37,6,0,145,6,37,0,1,39,148,117,82,38,39,0,76,38,38,0,145,38,38,0,66,37,6,38,145,37,37,0,89,10,37,0,1,37,224,117,82,7,37,0,76,37,7,0,145,7,37,0,1,39,152,117,82,38,39,0,76,38,38,0,145,38,38,0,66,37,7,38,145,37,37,0,89,12,37,0,88,8,10,0,145,8,8,0,88,37,12,0,145,37,37,0,72,37,8,37,121,37,30,0,1,37,236,117,1,38,220,117,82,38,38,0,85,37,38,0,1,38,152,117,82,9,38,0,76,38,9,0,145,9,38,0,1,38,240,117,88,40,10,0,145,40,40,0,65,39,9,40,145,39,39,0,134,37,0,0,20,159,2,0,39,0,0,0,75,37,37,0,85,38,37,0,1,37,244,117,1,38,0,0,85,37,38,0,1,38,248,117,1,37,224,117,82,37,37,0,1,39,240,117,82,39,39,0,4,37,37,39,85,38,37,0,119,0,29,0,1,37,148,117,82,11,37,0,76,37,11,0,145,11,37,0,1,37,236,117,88,40,12,0,145,40,40,0,65,39,11,40,145,39,39,0,134,38,0,0,20,159,2,0,39,0,0,0,75,38,38,0,85,37,38,0,1,38,240,117,1,37,224,117,82,37,37,0,85,38,37,0,1,37,244,117,1,38,220,117,82,38,38,0,1,39,236,117,82,39,39,0,4,38,38,39,85,37,38,0,1,38,248,117,1,37,0,0,85,38,37,0,1,37,236,117,82,13,37,0,76,37,13,0,145,13,37,0,1,39,148,117,82,38,39,0,76,38,38,0,145,38,38,0,66,37,13,38,145,37,37,0,89,14,37,0,88,15,14,0,145,15,15,0,88,38,14,0,145,38,38,0,59,39,1,0,145,39,39,0,134,37,0,0,96,50,2,0,17,15,38,39,1,30,156,117,0,32,17,0,25,33,30,64,116,30,32,0,25,30,30,4,25,32,32,4,54,37,30,33,24,116,1,0,1,37,236,117,1,39,220,117,82,39,39,0,85,37,39,0,1,39,240,117,1,37,224,117,82,37,37,0,85,39,37,0,1,37,240,117,82,16,37,0,1,37,236,117,82,37,37,0,85,28,37,0,109,28,4,16,1,39,4,0,1,38,174,46,134,37,0,0,252,32,2,0,39,38,28,0,137,31,0,0,139,0,0,0,140,7,59,0,0,0,0,0,136,53,0,0,0,52,53,0,136,53,0,0,25,53,53,80,137,53,0,0,130,53,0,0,136,54,0,0,49,53,53,54,184,116,1,0,1,54,80,0,135,53,0,0,54,0,0,0,25,38,52,68,25,43,52,64,25,50,52,60,25,7,52,56,25,8,52,52,25,9,52,48,25,10,52,44,25,11,52,40,25,12,52,36,25,13,52,32,25,14,52,28,25,15,52,24,25,16,52,20,25,17,52,16,25,18,52,12,25,19,52,8,25,20,52,4,0,21,52,0,85,38,0,0,85,43,1,0,85,50,2,0,89,7,3,0,89,8,4,0,85,9,5,0,85,10,6,0,88,22,7,0,145,22,22,0,82,54,50,0,82,55,9,0,82,56,10,0,134,53,0,0,192,56,2,0,22,54,55,56,85,12,53,0,88,56,7,0,145,56,56,0,134,53,0,0,200,149,2,0,56,0,0,0,33,23,53,0,1,53,160,20,82,56,50,0,41,56,56,3,3,53,53,56,106,24,53,4,88,25,7,0,145,25,25,0,121,23,63,0,59,53,1,0,145,53,53,0,66,26,53,25,145,26,26,0,38,53,24,7,135,27,234,0,53,26,0,0,145,27,27,0,88,56,7,0,145,56,56,0,65,53,27,56,145,53,53,0,89,13,53,0,1,53,0,0,85,11,53,0,82,53,12,0,82,56,11,0,56,53,53,56,104,118,1,0,88,28,13,0,145,28,28,0,88,29,7,0,145,29,29,0,82,56,11,0,88,55,8,0,145,55,55,0,134,53,0,0,44,210,1,0,56,28,29,55,15,16,14,0,82,30,50,0,88,31,7,0,145,31,31,0,82,32,15,0,82,33,16,0,88,34,14,0,145,34,34,0,82,53,38,0,82,55,11,0,134,35,0,0,144,147,2,0,53,55,0,0,88,36,7,0,145,36,36,0,82,56,43,0,82,54,50,0,82,57,11,0,1,58,0,0,134,53,0,0,192,105,2,0,56,54,36,57,58,0,0,0,134,55,0,0,172,106,1,0,30,31,32,33,34,35,53,0,82,55,11,0,25,55,55,1,85,11,55,0,119,0,212,255,137,52,0,0,139,0,0,0,38,55,24,7,135,37,234,0,55,25,0,0,145,37,37,0,88,53,7,0,145,53,53,0,66,55,37,53,145,55,55,0,89,17,55,0,1,55,0,0,85,11,55,0,82,55,12,0,82,53,11,0,56,55,55,53,116,119,1,0,82,39,11,0,82,53,50,0,88,58,7,0,145,58,58,0,134,55,0,0,200,141,2,0,53,58,0,0,4,55,39,55,85,21,55,0,88,40,17,0,145,40,40,0,88,41,7,0,145,41,41,0,82,58,21,0,88,53,8,0,145,53,53,0,134,55,0,0,108,208,1,0,58,40,41,53,19,20,18,0,82,42,50,0,88,44,7,0,145,44,44,0,82,45,19,0,82,46,20,0,88,47,18,0,145,47,47,0,82,55,38,0,82,53,11,0,134,48,0,0,144,147,2,0,55,53,0,0,88,49,7,0,145,49,49,0,82,58,43,0,82,57,50,0,82,54,11,0,1,56,0,0,134,55,0,0,192,105,2,0,58,57,49,54,56,0,0,0,134,53,0,0,228,139,1,0,42,44,45,46,47,48,55,0,82,53,11,0,25,53,53,1,85,11,53,0,119,0,203,255,88,51,7,0,145,51,51,0,82,55,38,0,82,56,43,0,82,54,50,0,82,57,9,0,82,58,10,0,134,53,0,0,192,29,1,0,55,56,54,51,57,58,0,0,137,52,0,0,139,0,0,0,140,7,41,0,0,0,0,0,136,33,0,0,0,32,33,0,136,33,0,0,25,33,33,80,137,33,0,0,130,33,0,0,136,34,0,0,49,33,33,34,224,119,1,0,1,34,80,0,135,33,0,0,34,0,0,0,25,28,32,64,25,30,32,60,25,31,32,56,25,7,32,52,25,12,32,48,25,16,32,44,25,17,32,40,25,18,32,36,25,19,32,32,25,20,32,28,25,21,32,24,25,22,32,20,25,23,32,8,25,24,32,4,0,25,32,0,85,28,0,0,85,30,1,0,85,31,2,0,85,7,3,0,85,12,4,0,85,16,5,0,85,17,6,0,1,33,1,0,82,34,28,0,82,34,34,0,22,33,33,34,26,33,33,1,82,34,17,0,47,33,33,34,140,121,1,0,82,33,17,0,1,34,1,0,82,35,28,0,82,35,35,0,22,34,34,35,4,33,33,34,85,18,33,0,82,33,18,0,120,33,3,0,137,32,0,0,139,0,0,0,82,33,30,0,82,34,28,0,25,34,34,4,82,35,18,0,91,34,34,35,4,33,33,34,85,19,33,0,82,33,31,0,82,34,28,0,1,35,4,1,3,34,34,35,82,35,18,0,91,34,34,35,4,33,33,34,85,20,33,0,82,33,7,0,82,34,28,0,1,35,4,2,3,34,34,35,82,35,18,0,91,34,34,35,4,33,33,34,85,21,33,0,82,26,19,0,82,27,20,0,82,29,21,0,82,34,19,0,34,34,34,0,121,34,5,0,1,34,0,0,4,34,34,26,0,33,34,0,119,0,2,0,0,33,26,0,82,35,20,0,34,35,35,0,121,35,5,0,1,35,0,0,4,35,35,27,0,34,35,0,119,0,2,0,0,34,27,0,3,33,33,34,82,35,21,0,34,35,35,0,121,35,5,0,1,35,0,0,4,35,35,29,0,34,35,0,119,0,2,0,0,34,29,0,3,33,33,34,85,22,33,0,82,33,16,0,82,33,33,0,82,34,22,0,49,33,33,34,116,121,1,0,137,32,0,0,139,0,0,0,82,33,12,0,116,33,18,0,82,33,16,0,116,33,22,0,137,32,0,0,139,0,0,0,116,23,30,0,82,34,31,0,109,23,4,34,82,33,7,0,109,23,8,33,82,33,28,0,1,34,4,3,3,33,33,34,82,34,17,0,91,33,33,34,41,33,33,2,3,33,23,33,116,24,33,0,82,33,28,0,1,34,3,4,3,33,33,34,82,34,17,0,91,33,33,34,85,25,33,0,82,8,28,0,82,9,30,0,82,10,31,0,82,11,7,0,82,13,12,0,82,14,16,0,82,33,17,0,41,33,33,1,0,15,33,0,82,33,24,0,82,34,25,0,47,33,33,34,128,122,1,0,134,33,0,0,168,119,1,0,8,9,10,11,13,14,15,0,82,33,16,0,82,33,33,0,82,34,25,0,82,35,24,0,4,34,34,35,49,33,33,34,64,122,1,0,137,32,0,0,139,0,0,0,82,34,28,0,82,35,30,0,82,36,31,0,82,37,7,0,82,38,12,0,82,39,16,0,82,40,17,0,41,40,40,1,25,40,40,1,134,33,0,0,168,119,1,0,34,35,36,37,38,39,40,0,137,32,0,0,139,0,0,0,119,0,29,0,25,40,15,1,134,33,0,0,168,119,1,0,8,9,10,11,13,14,40,0,82,33,16,0,82,33,33,0,82,40,24,0,82,39,25,0,4,40,40,39,49,33,33,40,184,122,1,0,137,32,0,0,139,0,0,0,82,40,28,0,82,39,30,0,82,38,31,0,82,37,7,0,82,36,12,0,82,35,16,0,82,34,17,0,41,34,34,1,134,33,0,0,168,119,1,0,40,39,38,37,36,35,34,0,137,32,0,0,139,0,0,0,139,0,0,0,140,0,30,0,0,0,0,0,2,24,0,0,192,81,0,0,2,25,0,0,247,28,0,0,136,26,0,0,0,7,26,0,136,26,0,0,25,26,26,32,137,26,0,0,130,26,0,0,136,27,0,0,49,26,26,27,60,123,1,0,1,27,32,0,135,26,0,0,27,0,0,0,25,0,7,16,25,1,7,12,25,4,7,8,25,5,7,4,0,6,7,0,1,26,220,115,82,26,26,0,27,26,26,48,94,26,24,26,1,27,220,115,82,27,27,0,27,27,27,48,3,27,24,27,106,27,27,8,46,26,26,27,32,125,1,0,1,26,220,115,82,26,26,0,27,26,26,48,3,8,24,26,82,26,8,0,106,27,8,8,4,26,26,27,85,0,26,0,1,26,0,0,85,1,26,0,82,26,0,0,82,27,1,0,56,26,26,27,32,125,1,0,1,26,220,115,82,26,26,0,27,26,26,48,3,9,24,26,1,26,220,115,82,26,26,0,27,26,26,48,3,26,24,26,106,10,26,20,1,26,220,115,82,26,26,0,27,26,26,48,3,26,24,26,106,26,26,8,41,26,26,2,0,11,26,0,26,27,11,4,90,27,10,27,95,10,11,27,1,27,220,115,82,27,27,0,27,27,27,48,3,12,24,27,1,27,220,115,82,27,27,0,27,27,27,48,3,27,24,27,106,13,27,20,1,27,220,115,82,27,27,0,27,27,27,48,3,27,24,27,106,27,27,8,41,27,27,2,0,14,27,0,25,27,14,1,26,26,14,3,90,26,13,26,95,13,27,26,1,26,220,115,82,26,26,0,27,26,26,48,3,15,24,26,1,26,220,115,82,26,26,0,27,26,26,48,3,26,24,26,106,16,26,20,1,26,220,115,82,26,26,0,27,26,26,48,3,26,24,26,106,26,26,8,41,26,26,2,0,17,26,0,25,26,17,2,26,27,17,2,90,27,16,27,95,16,26,27,1,27,220,115,82,27,27,0,27,27,27,48,3,18,24,27,1,27,220,115,82,27,27,0,27,27,27,48,3,27,24,27,106,19,27,20,1,27,220,115,82,27,27,0,27,27,27,48,3,27,24,27,106,27,27,8,41,27,27,2,0,20,27,0,25,27,20,3,26,26,20,1,90,26,19,26,95,19,27,26,1,26,220,115,82,26,26,0,27,26,26,48,3,26,24,26,25,2,26,8,82,26,2,0,25,26,26,1,85,2,26,0,82,26,1,0,25,26,26,1,85,1,26,0,119,0,162,255,1,26,220,115,82,26,26,0,27,26,26,48,94,26,24,26,1,27,220,115,82,27,27,0,27,27,27,48,3,27,24,27,106,27,27,4,46,26,26,27,16,126,1,0,1,26,220,115,82,26,26,0,27,26,26,48,3,21,24,26,82,26,21,0,106,27,21,4,4,26,26,27,85,4,26,0,1,26,0,0,85,5,26,0,82,26,4,0,82,27,5,0,56,26,26,27,16,126,1,0,1,26,220,115,82,26,26,0,27,26,26,48,3,22,24,26,106,26,22,16,106,27,22,4,41,27,27,1,41,27,27,2,59,28,0,0,145,28,28,0,101,26,27,28,1,28,220,115,82,28,28,0,27,28,28,48,3,23,24,28,106,28,23,16,106,27,23,4,41,27,27,1,25,27,27,1,41,27,27,2,59,26,0,0,145,26,26,0,101,28,27,26,1,26,220,115,82,26,26,0,27,26,26,48,3,26,24,26,25,3,26,4,82,26,3,0,25,26,26,1,85,3,26,0,82,26,5,0,25,26,26,1,85,5,26,0,119,0,218,255,1,26,148,29,1,29,148,29,88,28,29,0,145,28,28,0,62,29,0,0,50,236,172,223,226,54,10,63,145,29,29,0,63,27,28,29,145,27,27,0,89,26,27,0,1,27,220,115,82,27,27,0,27,27,27,48,94,27,24,27,1,26,252,31,47,27,27,26,96,126,1,0,137,7,0,0,139,0,0,0,1,27,144,115,82,27,27,0,85,6,27,0,82,27,6,0,34,27,27,0,120,27,7,0,134,27,0,0,92,94,2,0,82,27,6,0,26,27,27,1,85,6,27,0,119,0,248,255,134,27,0,0,112,155,2,0,137,7,0,0,139,0,0,0,140,23,69,0,0,0,0,0,136,56,0,0,0,55,56,0,136,56,0,0,1,57,80,1,3,56,56,57,137,56,0,0,130,56,0,0,136,57,0,0,49,56,56,57,220,126,1,0,1,57,80,1,135,56,0,0,57,0,0,0,1,56,68,1,3,23,55,56,1,56,60,1,3,24,55,56,1,56,56,1,3,25,55,56,1,56,52,1,3,26,55,56,1,56,48,1,3,27,55,56,1,56,44,1,3,28,55,56,1,56,40,1,3,29,55,56,1,56,36,1,3,30,55,56,1,56,32,1,3,31,55,56,1,56,28,1,3,32,55,56,1,56,24,1,3,33,55,56,1,56,20,1,3,34,55,56,1,56,16,1,3,35,55,56,1,56,12,1,3,36,55,56,1,56,8,1,3,37,55,56,1,56,4,1,3,38,55,56,1,56,0,1,3,39,55,56,1,56,252,0,3,40,55,56,1,56,248,0,3,41,55,56,1,56,244,0,3,42,55,56,1,56,240,0,3,43,55,56,1,56,236,0,3,44,55,56,1,56,232,0,3,45,55,56,25,46,55,12,25,47,55,8,25,48,55,4,0,49,55,0,1,56,64,1,97,55,56,0,85,24,1,0,85,25,2,0,85,26,3,0,85,27,4,0,85,28,5,0,85,29,6,0,85,30,7,0,85,31,8,0,89,32,9,0,89,33,10,0,89,34,11,0,89,35,12,0,85,36,13,0,85,37,14,0,85,38,15,0,85,39,16,0,85,40,17,0,85,41,18,0,85,42,19,0,85,43,20,0,85,44,21,0,85,45,22,0,82,57,25,0,82,58,26,0,82,59,29,0,82,60,30,0,82,61,37,0,134,56,0,0,132,57,2,0,46,57,58,59,60,61,0,0,88,50,32,0,145,50,50,0,88,51,33,0,145,51,51,0,88,52,34,0,145,52,52,0,88,53,35,0,145,53,53,0,82,61,36,0,134,56,0,0,248,142,1,0,46,50,51,52,53,61,0,0,82,61,41,0,82,60,42,0,134,56,0,0,228,97,2,0,46,61,60,0,134,56,0,0,176,65,1,0,46,0,0,0,85,48,56,0,82,60,48,0,135,56,6,0,60,0,0,0,85,49,56,0,82,56,49,0,121,56,28,0,82,60,24,0,82,61,27,0,82,59,28,0,82,58,31,0,82,57,38,0,82,62,39,0,82,63,40,0,82,64,43,0,82,65,44,0,82,66,45,0,82,67,49,0,82,68,48,0,134,56,0,0,200,176,0,0,46,60,61,59,58,57,62,63,64,65,66,67,68,0,0,0,85,47,56,0,82,68,49,0,135,56,5,0,68,0,0,0,116,23,47,0,82,54,23,0,137,55,0,0,139,54,0,0,119,0,6,0,1,56,0,0,85,23,56,0,82,54,23,0,137,55,0,0,139,54,0,0,1,56,0,0,139,56,0,0,140,4,16,0,0,0,0,0,2,9,0,0,8,25,0,0,2,10,0,0,7,25,0,0,2,11,0,0,165,120,0,0,136,12,0,0,0,8,12,0,136,12,0,0,25,12,12,32,137,12,0,0,130,12,0,0,136,13,0,0,49,12,12,13,112,129,1,0,1,13,32,0,135,12,0,0,13,0,0,0,25,4,8,16,25,5,8,12,25,6,8,8,25,7,8,4,85,4,0,0,85,5,1,0,85,6,2,0,85,7,3,0,82,12,5,0,1,13,255,255,85,12,13,0,82,13,6,0,1,12,255,255,85,13,12,0,82,12,7,0,1,13,255,255,85,12,13,0,82,13,4,0,1,14,1,0,1,15,21,0,138,13,14,15,48,130,1,0,88,130,1,0,128,130,1,0,164,130,1,0,196,130,1,0,232,130,1,0,12,131,1,0,44,131,1,0,100,131,1,0,148,131,1,0,196,131,1,0,228,131,1,0,4,132,1,0,36,132,1,0,68,132,1,0,104,132,1,0,140,132,1,0,176,132,1,0,212,132,1,0,248,132,1,0,28,133,1,0,1,12,4,0,1,15,159,43,134,14,0,0,252,32,2,0,12,15,8,0,119,0,197,0,82,12,5,0,1,14,9,25,85,12,14,0,82,14,6,0,1,12,9,25,85,14,12,0,82,12,7,0,1,14,1,20,85,12,14,0,119,0,187,0,82,14,5,0,1,12,10,25,85,14,12,0,82,12,6,0,1,14,10,25,85,12,14,0,82,14,7,0,1,12,1,20,85,14,12,0,119,0,177,0,82,12,5,0,85,12,10,0,82,12,6,0,85,12,10,0,82,12,7,0,2,14,0,0,99,131,0,0,85,12,14,0,119,0,168,0,82,14,5,0,85,14,10,0,82,14,6,0,85,14,10,0,82,14,7,0,1,12,1,20,85,14,12,0,119,0,160,0,82,12,5,0,85,12,9,0,82,12,6,0,85,12,9,0,82,12,7,0,2,14,0,0,52,128,0,0,85,12,14,0,119,0,151,0,82,14,5,0,85,14,9,0,82,14,6,0,85,14,9,0,82,14,7,0,2,12,0,0,51,128,0,0,85,14,12,0,119,0,142,0,82,12,5,0,85,12,9,0,82,12,6,0,85,12,9,0,82,12,7,0,1,14,1,20,85,12,14,0,119,0,134,0,1,14,164,120,78,14,14,0,38,14,14,1,121,14,4,0,82,14,5,0,1,12,9,25,85,14,12,0,82,12,6,0,1,14,9,25,85,12,14,0,82,14,7,0,1,12,6,20,85,14,12,0,119,0,120,0,1,12,164,120,78,12,12,0,38,12,12,1,121,12,3,0,82,12,5,0,85,12,10,0,82,12,6,0,85,12,10,0,82,12,7,0,1,14,6,20,85,12,14,0,119,0,108,0,1,14,164,120,78,14,14,0,38,14,14,1,121,14,3,0,82,14,5,0,85,14,9,0,82,14,6,0,85,14,9,0,82,14,7,0,1,12,6,20,85,14,12,0,119,0,96,0,78,12,11,0,38,12,12,1,121,12,93,0,82,12,5,0,2,14,0,0,240,131,0,0,85,12,14,0,119,0,88,0,78,14,11,0,38,14,14,1,121,14,85,0,82,14,5,0,2,12,0,0,241,131,0,0,85,14,12,0,119,0,80,0,78,12,11,0,38,12,12,1,121,12,77,0,82,12,5,0,2,14,0,0,242,131,0,0,85,12,14,0,119,0,72,0,78,14,11,0,38,14,14,1,121,14,69,0,82,14,5,0,2,12,0,0,243,131,0,0,85,14,12,0,119,0,64,0,1,12,166,120,78,12,12,0,38,12,12,1,121,12,60,0,82,12,5,0,2,14,0,0,100,141,0,0,85,12,14,0,119,0,55,0,1,14,167,120,78,14,14,0,38,14,14,1,121,14,51,0,82,14,5,0,2,12,0,0,116,146,0,0,85,14,12,0,119,0,46,0,1,12,167,120,78,12,12,0,38,12,12,1,121,12,42,0,82,12,5,0,2,14,0,0,120,146,0,0,85,12,14,0,119,0,37,0,1,14,168,120,78,14,14,0,38,14,14,1,121,14,33,0,82,14,5,0,2,12,0,0,0,140,0,0,85,14,12,0,119,0,28,0,1,12,168,120,78,12,12,0,38,12,12,1,121,12,24,0,82,12,5,0,2,14,0,0,2,140,0,0,85,12,14,0,119,0,19,0,1,14,169,120,78,14,14,0,38,14,14,1,121,14,15,0,82,14,5,0,2,12,0,0,176,147,0,0,85,14,12,0,119,0,10,0,1,12,169,120,78,12,12,0,38,12,12,1,121,12,6,0,82,12,5,0,2,14,0,0,183,147,0,0,85,12,14,0,119,0,1,0,137,8,0,0,139,0,0,0,140,2,20,0,0,0,0,0,2,13,0,0,0,0,128,127,2,14,0,0,255,0,0,0,2,15,0,0,255,255,255,127,1,12,0,0,127,16,0,0,89,16,1,0,127,16,0,0,82,10,16,0,19,16,10,15,0,6,16,0,48,16,13,6,148,133,1,0,1,12,3,0,119,0,219,0,127,16,0,0,89,16,0,0,127,16,0,0,82,7,16,0,19,16,7,15,0,8,16,0,48,16,13,8,188,133,1,0,1,12,3,0,119,0,209,0,2,16,0,0,0,0,128,63,45,16,10,16,224,133,1,0,134,2,0,0,104,198,1,0,0,0,0,0,145,2,2,0,119,0,200,0,43,16,7,31,0,4,16,0,43,16,10,30,38,16,16,2,20,16,16,4,0,5,16,0,120,8,23,0,38,16,5,3,1,17,0,0,1,18,4,0,138,16,17,18,32,134,1,0,40,134,1,0,44,134,1,0,64,134,1,0,119,0,14,0,58,2,0,0,119,0,182,0,119,0,254,255,62,2,0,0,80,53,221,95,251,33,9,64,145,2,2,0,119,0,176,0,62,2,0,0,80,53,221,95,251,33,9,192,145,2,2,0,119,0,171,0,19,16,10,15,0,11,16,0,47,16,11,13,184,134,1,0,1,16,0,0,1,17,1,0,138,11,16,17,120,134,1,0,119,0,83,0,119,0,1,0,32,17,4,0,121,17,7,0,62,17,0,0,80,53,221,95,251,33,249,63,145,17,17,0,58,16,17,0,119,0,6,0,62,17,0,0,80,53,221,95,251,33,249,191,145,17,17,0,58,16,17,0,58,2,16,0,119,0,146,0,2,16,0,0,0,0,128,127,1,17,1,0,138,11,16,17,208,134,1,0,119,0,61,0,119,0,1,0,19,16,5,14,0,9,16,0,45,16,8,13,88,135,1,0,38,16,9,3,1,17,0,0,1,18,4,0,138,16,17,18,8,135,1,0,28,135,1,0,48,135,1,0,68,135,1,0,119,0,47,0,62,2,0,0,80,53,221,95,251,33,233,63,145,2,2,0,119,0,121,0,62,2,0,0,80,53,221,95,251,33,233,191,145,2,2,0,119,0,116,0,62,2,0,0,222,30,132,128,124,217,2,64,145,2,2,0,119,0,111,0,62,2,0,0,222,30,132,128,124,217,2,192,145,2,2,0,119,0,106,0,38,16,9,3,1,17,0,0,1,18,4,0,138,16,17,18,124,135,1,0,136,135,1,0,152,135,1,0,172,135,1,0,119,0,18,0,59,2,0,0,145,2,2,0,119,0,94,0,61,2,0,0,0,0,0,128,145,2,2,0,119,0,90,0,62,2,0,0,80,53,221,95,251,33,9,64,145,2,2,0,119,0,85,0,62,2,0,0,80,53,221,95,251,33,9,192,145,2,2,0,119,0,80,0,13,16,8,13,2,17,0,0,0,0,0,13,3,17,6,17,16,17,17,8,20,16,16,17,121,16,16,0,32,17,4,0,121,17,7,0,62,17,0,0,80,53,221,95,251,33,249,63,145,17,17,0,58,16,17,0,119,0,6,0,62,17,0,0,80,53,221,95,251,33,249,191,145,17,17,0,58,16,17,0,58,2,16,0,119,0,58,0,34,16,10,0,2,17,0,0,0,0,0,13,3,17,8,17,16,17,17,6,19,16,16,17,121,16,4,0,59,3,0,0,145,3,3,0,119,0,10,0,66,17,0,1,145,17,17,0,135,16,236,0,17,0,0,0,145,16,16,0,134,3,0,0,104,198,1,0,16,0,0,0,145,3,3,0,38,16,5,3,1,17,0,0,1,18,3,0,138,16,17,18,180,136,1,0,188,136,1,0,200,136,1,0,62,17,0,0,193,73,171,191,165,119,119,62,145,17,17,0,63,18,3,17,145,18,18,0,62,17,0,0,80,53,221,95,251,33,9,192,145,17,17,0,63,2,18,17,145,2,2,0,119,0,19,0,58,2,3,0,119,0,17,0,68,2,3,0,145,2,2,0,119,0,14,0,62,17,0,0,80,53,221,95,251,33,9,64,145,17,17,0,62,19,0,0,193,73,171,191,165,119,119,62,145,19,19,0,63,18,3,19,145,18,18,0,64,2,17,18,145,2,2,0,119,0,1,0,32,16,12,3,121,16,3,0,63,2,0,1,145,2,2,0,145,16,2,0,139,16,0,0,140,3,36,0,0,0,0,0,136,33,0,0,0,28,33,0,136,33,0,0,1,34,160,0,3,33,33,34,137,33,0,0,130,33,0,0,136,34,0,0,49,33,33,34,80,137,1,0,1,34,160,0,135,33,0,0,34,0,0,0,25,3,28,104,25,5,28,96,25,7,28,92,25,10,28,32,25,15,28,24,25,19,28,16,25,23,28,8,0,4,28,0,85,5,0,0,85,7,1,0,109,28,88,2,82,33,5,0,32,33,33,22,121,33,4,0,1,33,1,0,85,10,33,0,119,0,12,0,82,33,5,0,32,33,33,23,121,33,4,0,1,33,0,0,85,10,33,0,119,0,6,0,82,33,5,0,32,33,33,24,121,33,3,0,1,33,2,0,85,10,33,0,82,34,7,0,82,34,34,0,109,10,4,34,82,33,7,0,106,33,33,20,109,10,8,33,25,33,10,8,82,34,7,0,25,34,34,20,106,34,34,52,109,33,4,34,25,6,10,24,82,33,7,0,25,33,33,20,106,34,33,36,76,34,34,0,145,34,34,0,89,15,34,0,82,35,7,0,25,35,35,20,106,33,35,40,76,33,33,0,145,33,33,0,113,15,4,33,116,6,15,0,106,34,15,4,109,6,4,34,25,34,10,24,25,31,34,8,25,34,10,24,25,32,34,8,0,8,31,0,82,33,7,0,25,33,33,20,25,33,33,52,106,34,33,36,76,34,34,0,145,34,34,0,89,19,34,0,82,35,7,0,25,35,35,20,25,35,35,52,106,33,35,40,76,33,33,0,145,33,33,0,113,19,4,33,116,8,19,0,106,34,19,4,109,8,4,34,1,33,39,44,135,34,237,0,33,23,4,0,134,9,0,0,48,162,2,0,76,34,9,0,145,9,34,0,86,34,23,0,145,34,34,0,66,11,9,34,145,11,11,0,25,12,10,24,88,33,12,0,145,33,33,0,65,34,33,11,145,34,34,0,89,12,34,0,134,13,0,0,4,162,2,0,76,34,13,0,145,13,34,0,86,34,4,0,145,34,34,0,66,14,13,34,145,14,14,0,25,34,10,24,25,16,34,4,88,33,16,0,145,33,33,0,65,34,33,14,145,34,34,0,89,16,34,0,134,17,0,0,48,162,2,0,76,34,17,0,145,17,34,0,86,34,23,0,145,34,34,0,66,18,17,34,145,18,18,0,0,20,31,0,88,33,20,0,145,33,33,0,65,34,33,18,145,34,34,0,89,20,34,0,134,21,0,0,4,162,2,0,76,34,21,0,145,21,34,0,86,34,4,0,145,34,34,0,66,22,21,34,145,22,22,0,25,24,32,4,88,33,24,0,145,33,33,0,65,34,33,22,145,34,34,0,89,24,34,0,25,25,10,24,1,34,240,81,82,33,25,0,85,34,33,0,1,33,244,81,106,34,25,4,85,33,34,0,0,26,31,0,1,34,248,81,82,33,26,0,85,34,33,0,1,33,252,81,106,34,26,4,85,33,34,0,0,27,3,0,0,29,10,0,25,30,27,56,116,27,29,0,25,27,27,4,25,29,29,4,54,34,27,30,184,139,1,0,134,34,0,0,212,238,0,0,3,0,0,0,137,28,0,0,1,34,1,0,139,34,0,0,140,7,34,0,0,0,0,0,1,27,0,0,136,29,0,0,0,28,29,0,136,29,0,0,25,29,29,48,137,29,0,0,130,29,0,0,136,30,0,0,49,29,29,30,32,140,1,0,1,30,48,0,135,29,0,0,30,0,0,0,25,21,28,36,25,25,28,32,25,26,28,28,25,7,28,24,25,8,28,20,25,9,28,16,25,10,28,12,25,11,28,8,25,12,28,4,0,13,28,0,85,21,0,0,89,25,1,0,85,26,2,0,85,7,3,0,89,8,4,0,85,9,5,0,85,10,6,0,82,29,7,0,82,30,26,0,4,14,29,30,88,15,25,0,145,15,15,0,1,32,160,20,82,33,21,0,41,33,33,3,3,32,32,33,106,32,32,4,38,32,32,7,135,31,234,0,32,15,0,0,145,31,31,0,59,32,2,0,145,32,32,0,65,29,31,32,145,29,29,0,135,30,11,0,29,0,0,0,75,30,30,0,47,30,30,14,216,140,1,0,1,29,77,55,1,32,90,48,1,31,67,4,1,33,182,55,135,30,8,0,29,32,31,33,82,30,9,0,116,30,26,0,82,30,9,0,82,33,7,0,109,30,4,33,82,33,9,0,106,33,33,4,82,30,9,0,82,30,30,0,47,33,33,30,28,141,1,0,1,30,223,55,1,31,90,48,1,32,72,4,1,29,182,55,135,33,8,0,30,31,32,29,1,33,0,0,85,11,33,0,82,33,7,0,82,29,26,0,4,33,33,29,82,29,11,0,54,33,33,29,228,141,1,0,82,32,11,0,82,31,26,0,3,29,32,31,76,29,29,0,145,29,29,0,61,31,0,0,0,0,0,63,145,31,31,0,63,33,29,31,145,33,33,0,89,12,33,0,88,16,12,0,145,16,16,0,88,31,8,0,145,31,31,0,64,33,16,31,145,33,33,0,89,13,33,0,88,17,13,0,145,17,17,0,88,18,25,0,145,18,18,0,1,33,160,20,82,31,21,0,41,31,31,3,94,33,33,31,38,33,33,7,135,19,235,0,33,17,18,0,145,19,19,0,88,33,25,0,145,33,33,0,65,20,19,33,145,20,20,0,82,33,10,0,82,31,11,0,41,31,31,2,101,33,31,20,82,31,11,0,25,31,31,1,85,11,31,0,119,0,209,255,82,33,7,0,25,31,33,1,76,31,31,0,145,31,31,0,61,33,0,0,0,0,0,63,145,33,33,0,63,22,31,33,145,22,22,0,88,33,8,0,145,33,33,0,64,23,22,33,145,23,23,0,88,24,25,0,145,24,24,0,1,31,160,20,82,29,21,0,41,29,29,3,94,31,31,29,38,31,31,7,135,33,235,0,31,23,24,0,145,33,33,0,59,31,0,0,145,31,31,0,69,33,33,31,120,33,7,0,1,31,2,56,1,29,90,48,1,32,81,4,1,30,182,55,135,33,8,0,31,29,32,30,82,33,7,0,82,30,26,0,4,33,33,30,85,11,33,0,82,33,11,0,34,33,33,0,121,33,3,0,1,27,14,0,119,0,23,0,82,30,10,0,82,32,11,0,41,32,32,2,100,33,30,32,145,33,33,0,59,30,0,0,145,30,30,0,70,33,33,30,121,33,3,0,1,27,14,0,119,0,12,0,82,33,9,0,82,30,9,0,82,30,30,0,82,32,11,0,3,30,30,32,26,30,30,1,109,33,4,30,82,30,11,0,26,30,30,1,85,11,30,0,119,0,230,255,32,30,27,14,121,30,3,0,137,28,0,0,139,0,0,0,139,0,0,0,140,6,39,0,0,0,0,0,136,37,0,0,0,36,37,0,136,37,0,0,25,37,37,32,137,37,0,0,130,37,0,0,136,38,0,0,49,37,37,38,48,143,1,0,1,38,32,0,135,37,0,0,38,0,0,0,25,20,36,20,25,24,36,16,25,27,36,12,25,32,36,8,25,6,36,4,0,7,36,0,85,20,0,0,89,24,1,0,89,27,2,0,89,32,3,0,89,6,4,0,85,7,5,0,88,8,24,0,145,8,8,0,82,37,20,0,113,37,32,8,88,9,27,0,145,9,9,0,82,37,20,0,113,37,36,9,88,10,32,0,145,10,10,0,82,37,20,0,113,37,40,10,88,11,6,0,145,11,11,0,82,37,20,0,113,37,44,11,82,37,7,0,121,37,24,0,82,37,7,0,88,12,37,0,145,12,12,0,82,37,20,0,113,37,56,12,82,37,7,0,112,13,37,4,145,13,13,0,82,37,20,0,113,37,60,13,82,37,7,0,112,14,37,8,145,14,14,0,82,37,20,0,113,37,48,14,82,37,7,0,112,15,37,12,145,15,15,0,82,37,20,0,113,37,52,15,137,36,0,0,139,0,0,0], eb + 92160);
  HEAPU8.set([119,0,79,0,82,37,20,0,106,16,37,20,76,37,16,0,145,16,37,0,82,38,20,0,106,37,38,4,76,37,37,0,145,37,37,0,66,17,16,37,145,17,17,0,88,18,32,0,145,18,18,0,88,38,24,0,145,38,38,0,64,37,18,38,145,37,37,0,66,19,17,37,145,19,19,0,82,37,20,0,113,37,56,19,82,37,20,0,106,21,37,24,76,37,21,0,145,21,37,0,82,38,20,0,106,37,38,8,76,37,37,0,145,37,37,0,66,22,21,37,145,22,22,0,88,23,6,0,145,23,23,0,88,38,27,0,145,38,38,0,64,37,23,38,145,37,37,0,66,25,22,37,145,25,25,0,82,37,20,0,113,37,60,25,88,26,24,0,145,26,26,0,82,38,20,0,106,37,38,20,76,37,37,0,145,37,37,0,65,28,26,37,145,28,28,0,88,29,32,0,145,29,29,0,88,38,24,0,145,38,38,0,64,37,29,38,145,37,37,0,66,30,28,37,145,30,30,0,82,37,20,0,113,37,48,30,88,31,27,0,145,31,31,0,82,38,20,0,106,37,38,24,76,37,37,0,145,37,37,0,65,33,31,37,145,33,33,0,88,34,6,0,145,34,34,0,88,38,27,0,145,38,38,0,64,37,34,38,145,37,37,0,66,35,33,37,145,35,35,0,82,37,20,0,113,37,52,35,137,36,0,0,139,0,0,0,139,0,0,0,140,3,42,0,0,0,0,0,2,38,0,0,128,128,128,128,2,39,0,0,255,254,254,254,1,37,0,0,0,33,1,0,21,40,33,0,38,40,40,3,120,40,88,0,33,24,2,0,38,40,33,3,33,40,40,0,19,40,24,40,121,40,29,0,0,7,2,0,0,9,1,0,0,11,0,0,78,25,9,0,83,11,25,0,41,40,25,24,42,40,40,24,120,40,4,0,0,20,11,0,0,22,7,0,119,0,76,0,26,26,7,1,25,27,9,1,25,28,11,1,33,29,26,0,38,40,27,3,33,40,40,0,19,40,29,40,121,40,5,0,0,7,26,0,0,9,27,0,0,11,28,0,119,0,237,255,0,6,26,0,0,8,27,0,0,10,28,0,0,23,29,0,119,0,5,0,0,6,2,0,0,8,1,0,0,10,0,0,0,23,24,0,121,23,47,0,78,40,8,0,120,40,4,0,0,20,10,0,0,22,6,0,119,0,49,0,1,40,3,0,48,40,40,6,156,146,1,0,0,5,10,0,0,12,8,0,0,16,6,0,82,30,12,0,19,40,30,38,21,40,40,38,2,41,0,0,1,1,1,1,4,41,30,41,19,40,40,41,121,40,5,0,0,3,12,0,0,4,5,0,0,13,16,0,119,0,19,0,85,5,30,0,26,31,16,4,25,32,12,4,25,34,5,4,1,40,3,0,48,40,40,31,140,146,1,0,0,5,34,0,0,12,32,0,0,16,31,0,119,0,234,255,0,3,32,0,0,4,34,0,0,13,31,0,119,0,4,0,0,3,8,0,0,4,10,0,0,13,6,0,0,14,3,0,0,15,4,0,0,17,13,0,1,37,13,0,119,0,8,0,0,20,10,0,1,22,0,0,119,0,5,0,0,14,1,0,0,15,0,0,0,17,2,0,1,37,13,0,32,40,37,13,121,40,25,0,120,17,4,0,0,20,15,0,1,22,0,0,119,0,21,0,0,18,14,0,0,19,15,0,0,21,17,0,78,35,18,0,83,19,35,0,41,40,35,24,42,40,40,24,120,40,4,0,0,20,19,0,0,22,21,0,119,0,10,0,26,21,21,1,25,36,19,1,120,21,4,0,0,20,36,0,1,22,0,0,119,0,4,0,25,18,18,1,0,19,36,0,119,0,240,255,1,41,0,0,135,40,3,0,20,41,22,0,139,20,0,0,140,1,27,0,0,0,0,0,2,19,0,0,168,0,0,0,2,20,0,0,172,0,0,0,2,21,0,0,176,0,0,0,1,15,0,0,136,22,0,0,0,16,22,0,136,22,0,0,25,22,22,32,137,22,0,0,130,22,0,0,136,23,0,0,49,22,22,23,164,147,1,0,1,23,32,0,135,22,0,0,23,0,0,0,25,1,16,24,25,4,16,20,25,5,16,16,25,8,16,12,25,9,16,8,25,10,16,4,0,13,16,0,85,1,0,0,82,23,1,0,112,22,23,60,145,22,22,0,89,5,22,0,59,22,1,0,145,22,22,0,88,23,5,0,145,23,23,0,66,2,22,23,145,2,2,0,1,23,160,20,82,22,1,0,106,22,22,84,41,22,22,3,3,23,23,22,106,23,23,4,38,23,23,7,135,3,234,0,23,2,0,0,145,3,3,0,88,22,5,0,145,22,22,0,65,23,3,22,145,23,23,0,89,8,23,0,82,22,1,0,134,23,0,0,80,148,2,0,22,0,0,0,120,23,7,0,1,22,83,54,1,24,90,48,1,25,21,8,1,26,124,54,135,23,8,0,22,24,25,26,1,23,0,0,85,4,23,0,82,23,1,0,106,23,23,24,82,26,4,0,49,23,23,26,120,148,1,0,1,15,19,0,119,0,100,0,59,23,0,0,145,23,23,0,89,9,23,0,1,23,0,0,85,10,23,0,1,23,0,0,85,13,23,0,88,6,8,0,145,6,6,0,88,7,5,0,145,7,7,0,82,26,4,0,82,24,1,0,112,25,24,52,145,25,25,0,134,23,0,0,44,210,1,0,26,6,7,25,10,13,9,0,82,23,1,0,1,25,164,0,94,23,23,25,82,25,13,0,82,26,10,0,4,25,25,26,25,25,25,1,47,23,23,25,240,148,1,0,1,15,6,0,119,0,70,0,1,23,0,0,82,25,1,0,94,25,25,21,49,23,23,25,140,149,1,0,82,23,10,0,82,25,1,0,94,25,25,19,56,23,23,25,140,149,1,0,82,11,1,0,82,23,1,0,94,23,23,19,82,25,1,0,94,25,25,20,52,23,23,25,108,149,1,0,3,12,11,19,82,23,12,0,25,23,23,1,85,12,23,0,82,23,1,0,3,17,23,21,82,18,1,0,82,23,17,0,25,23,23,1,1,25,164,0,94,25,18,25,8,23,23,25,85,17,23,0,119,0,231,255,1,25,255,255,97,11,21,25,82,25,1,0,1,23,0,0,97,25,19,23,82,23,1,0,1,25,0,0,97,23,20,25,82,25,1,0,94,25,25,21,34,25,25,0,121,25,6,0,82,23,1,0,82,26,10,0,134,25,0,0,24,109,2,0,23,26,0,0,82,14,1,0,82,25,13,0,82,26,1,0,94,26,26,20,56,25,25,26,228,149,1,0,82,26,1,0,94,26,26,20,25,26,26,1,134,25,0,0,24,109,2,0,14,26,0,0,119,0,244,255,82,26,4,0,134,25,0,0,16,77,0,0,14,26,0,0,82,25,4,0,25,25,25,1,85,4,25,0,119,0,151,255,32,25,15,6,121,25,8,0,1,26,152,54,1,23,90,48,1,24,30,8,1,22,124,54,135,25,8,0,26,23,24,22,119,0,5,0,32,25,15,19,121,25,3,0,137,16,0,0,139,0,0,0,139,0,0,0,140,2,32,0,0,0,0,0,2,22,0,0,168,0,0,0,2,23,0,0,176,0,0,0,1,18,0,0,136,24,0,0,0,19,24,0,136,24,0,0,25,24,24,64,137,24,0,0,130,24,0,0,136,25,0,0,49,24,24,25,136,150,1,0,1,25,64,0,135,24,0,0,25,0,0,0,25,9,19,52,25,10,19,48,25,11,19,44,25,12,19,40,25,13,19,36,25,14,19,32,25,15,19,28,25,16,19,24,25,2,19,20,25,4,19,16,25,5,19,12,25,6,19,8,25,7,19,4,0,8,19,0,85,9,0,0,85,10,1,0,82,24,9,0,25,24,24,28,116,11,24,0,82,24,9,0,25,24,24,64,116,12,24,0,82,24,9,0,25,24,24,68,116,13,24,0,82,24,9,0,25,24,24,76,116,14,24,0,82,24,9,0,25,24,24,96,116,15,24,0,82,24,9,0,25,24,24,20,116,16,24,0,82,24,9,0,25,24,24,16,116,2,24,0,82,24,14,0,41,24,24,1,82,25,15,0,3,24,24,25,85,4,24,0,82,24,9,0,1,25,180,0,3,24,24,25,116,5,24,0,82,24,9,0,1,25,160,0,94,24,24,25,29,24,24,4,85,6,24,0,82,24,9,0,94,24,24,23,34,24,24,0,121,24,3,0,137,19,0,0,139,0,0,0,82,24,10,0,82,25,9,0,94,25,25,22,49,24,24,25,136,151,1,0,1,18,10,0,119,0,60,0,1,24,0,0,82,25,9,0,94,25,25,22,49,24,24,25,28,152,1,0,82,24,9,0,94,24,24,22,82,25,9,0,106,25,25,24,47,24,24,25,28,152,1,0,82,25,9,0,94,25,25,22,82,26,11,0,5,24,25,26,85,7,24,0,82,26,5,0,82,25,9,0,94,25,25,23,82,27,6,0,134,24,0,0,240,135,2,0,26,25,27,0,85,8,24,0,82,27,9,0,82,25,16,0,82,26,2,0,82,28,7,0,3,26,26,28,82,28,8,0,82,29,12,0,82,30,13,0,82,31,4,0,134,24,0,0,48,120,0,0,27,25,26,28,29,30,31,0,82,17,9,0,82,24,9,0,94,24,24,22,82,31,9,0,1,30,172,0,94,31,31,30,52,24,24,31,116,152,1,0,3,3,17,22,82,24,3,0,25,24,24,1,85,3,24,0,82,24,9,0,3,20,24,23,82,21,9,0,82,24,20,0,25,24,24,1,1,31,164,0,94,31,21,31,8,24,24,31,85,20,24,0,119,0,191,255,32,24,18,10,121,24,3,0,137,19,0,0,139,0,0,0,1,31,255,255,97,17,23,31,82,31,9,0,1,24,0,0,97,31,22,24,82,24,9,0,1,31,172,0,1,30,0,0,97,24,31,30,137,19,0,0,139,0,0,0,140,4,37,0,0,0,0,0,2,33,0,0,255,255,0,0,2,34,0,0,255,0,0,0,37,35,1,20,121,35,183,0,1,35,9,0,1,36,10,0,138,1,35,36,8,153,1,0,64,153,1,0,140,153,1,0,208,153,1,0,24,154,1,0,116,154,1,0,188,154,1,0,24,155,1,0,96,155,1,0,152,155,1,0,119,0,169,0,82,35,2,0,1,36,4,0,26,36,36,1,3,35,35,36,1,36,4,0,26,36,36,1,11,36,36,0,19,35,35,36,0,4,35,0,82,7,4,0,25,35,4,4,85,2,35,0,85,0,7,0,119,0,155,0,82,35,2,0,1,36,4,0,26,36,36,1,3,35,35,36,1,36,4,0,26,36,36,1,11,36,36,0,19,35,35,36,0,9,35,0,82,10,9,0,25,35,9,4,85,2,35,0,0,11,0,0,85,11,10,0,34,36,10,0,41,36,36,31,42,36,36,31,109,11,4,36,119,0,136,0,82,36,2,0,1,35,4,0,26,35,35,1,3,36,36,35,1,35,4,0,26,35,35,1,11,35,35,0,19,36,36,35,0,12,36,0,82,13,12,0,25,36,12,4,85,2,36,0,0,14,0,0,85,14,13,0,1,35,0,0,109,14,4,35,119,0,119,0,82,35,2,0,1,36,8,0,26,36,36,1,3,35,35,36,1,36,8,0,26,36,36,1,11,36,36,0,19,35,35,36,0,15,35,0,0,16,15,0,82,17,16,0,106,18,16,4,25,35,15,8,85,2,35,0,0,19,0,0,85,19,17,0,109,19,4,18,119,0,101,0,82,35,2,0,1,36,4,0,26,36,36,1,3,35,35,36,1,36,4,0,26,36,36,1,11,36,36,0,19,35,35,36,0,20,35,0,82,21,20,0,25,35,20,4,85,2,35,0,19,35,21,33,41,35,35,16,42,35,35,16,0,22,35,0,0,23,0,0,85,23,22,0,34,36,22,0,41,36,36,31,42,36,36,31,109,23,4,36,119,0,78,0,82,36,2,0,1,35,4,0,26,35,35,1,3,36,36,35,1,35,4,0,26,35,35,1,11,35,35,0,19,36,36,35,0,24,36,0,82,25,24,0,25,36,24,4,85,2,36,0,0,26,0,0,19,36,25,33,85,26,36,0,1,35,0,0,109,26,4,35,119,0,60,0,82,35,2,0,1,36,4,0,26,36,36,1,3,35,35,36,1,36,4,0,26,36,36,1,11,36,36,0,19,35,35,36,0,27,35,0,82,28,27,0,25,35,27,4,85,2,35,0,19,35,28,34,41,35,35,24,42,35,35,24,0,29,35,0,0,30,0,0,85,30,29,0,34,36,29,0,41,36,36,31,42,36,36,31,109,30,4,36,119,0,37,0,82,36,2,0,1,35,4,0,26,35,35,1,3,36,36,35,1,35,4,0,26,35,35,1,11,35,35,0,19,36,36,35,0,31,36,0,82,32,31,0,25,36,31,4,85,2,36,0,0,5,0,0,19,36,32,34,85,5,36,0,1,35,0,0,109,5,4,35,119,0,19,0,82,35,2,0,1,36,8,0,26,36,36,1,3,35,35,36,1,36,8,0,26,36,36,1,11,36,36,0,19,35,35,36,0,6,35,0,86,8,6,0,25,35,6,8,85,2,35,0,87,0,8,0,119,0,5,0,38,36,3,63,135,35,231,0,36,0,2,0,119,0,1,0,139,0,0,0,140,1,25,0,0,0,0,0,2,19,0,0,172,0,0,0,1,16,0,0,136,20,0,0,0,17,20,0,136,20,0,0,25,20,20,48,137,20,0,0,130,20,0,0,136,21,0,0,49,20,20,21,240,155,1,0,1,21,48,0,135,20,0,0,21,0,0,0,25,1,17,36,25,3,17,32,25,6,17,28,25,7,17,24,25,10,17,20,25,11,17,16,25,12,17,12,25,14,17,8,25,15,17,4,0,2,17,0,85,1,0,0,82,21,1,0,112,20,21,60,145,20,20,0,89,6,20,0,82,20,1,0,25,20,20,24,116,7,20,0,88,4,6,0,145,4,4,0,1,20,160,20,82,21,1,0,106,21,21,84,41,21,21,3,3,20,20,21,106,20,20,4,38,20,20,7,135,5,234,0,20,4,0,0,145,5,5,0,88,21,6,0,145,21,21,0,66,20,5,21,145,20,20,0,89,10,20,0,82,20,1,0,1,21,148,0,3,20,20,21,116,11,20,0,82,20,1,0,106,20,20,8,82,21,11,0,3,20,20,21,85,12,20,0,82,21,1,0,134,20,0,0,80,148,2,0,21,0,0,0,121,20,7,0,1,21,240,50,1,22,90,48,1,23,122,8,1,24,26,51,135,20,8,0,21,22,23,24,1,20,0,0,82,24,11,0,4,20,20,24,85,3,20,0,82,20,12,0,82,24,3,0,49,20,20,24,244,156,1,0,1,16,16,0,119,0,73,0,88,8,10,0,145,8,8,0,88,9,6,0,145,9,9,0,82,24,3,0,82,22,1,0,112,23,22,52,145,23,23,0,134,20,0,0,108,208,1,0,24,8,9,23,15,2,14,0,82,20,1,0,1,23,164,0,94,20,20,23,82,23,2,0,82,24,15,0,4,23,23,24,25,23,23,1,47,20,20,23,80,157,1,0,1,16,6,0,119,0,50,0,1,20,0,0,82,23,2,0,49,20,20,23,4,158,1,0,82,20,15,0,82,23,7,0,47,20,20,23,4,158,1,0,82,23,1,0,82,24,15,0,134,20,0,0,60,150,1,0,23,24,0,0,82,24,1,0,82,23,3,0,134,20,0,0,32,53,2,0,24,23,0,0,82,20,1,0,1,23,176,0,94,20,20,23,34,20,20,0,121,20,6,0,82,23,1,0,82,24,15,0,134,20,0,0,204,20,2,0,23,24,0,0,82,13,1,0,82,20,2,0,82,24,1,0,94,24,24,19,56,20,20,24,244,157,1,0,82,24,1,0,94,24,24,19,25,24,24,1,134,20,0,0,204,20,2,0,13,24,0,0,119,0,244,255,82,24,3,0,134,20,0,0,112,248,0,0,13,24,0,0,82,20,3,0,25,20,20,1,85,3,20,0,119,0,179,255,32,20,16,6,121,20,8,0,1,24,56,51,1,23,90,48,1,22,131,8,1,21,26,51,135,20,8,0,24,23,22,21,119,0,10,0,32,20,16,16,121,20,8,0,82,18,1,0,106,21,18,24,134,20,0,0,60,150,1,0,18,21,0,0,137,17,0,0,139,0,0,0,139,0,0,0,140,7,31,0,0,0,0,0,136,27,0,0,0,24,27,0,136,27,0,0,1,28,128,0,3,27,27,28,137,27,0,0,130,27,0,0,136,28,0,0,49,27,27,28,156,158,1,0,1,28,128,0,135,27,0,0,28,0,0,0,25,20,24,40,25,21,24,32,25,22,24,24,25,7,24,16,25,8,24,8,0,9,24,0,25,10,24,64,25,11,24,56,25,12,24,52,25,13,24,48,87,20,1,0,87,21,2,0,87,22,3,0,87,7,4,0,87,8,5,0,87,9,6,0,0,23,10,0,25,26,23,64,1,27,0,0,85,23,27,0,25,23,23,4,54,27,23,26,228,158,1,0,86,28,21,0,86,29,20,0,64,27,28,29,145,27,27,0,89,11,27,0,86,29,7,0,86,28,22,0,64,27,29,28,145,27,27,0,89,12,27,0,86,28,9,0,86,29,8,0,64,27,28,29,145,27,27,0,89,13,27,0,59,29,2,0,145,29,29,0,88,28,11,0,145,28,28,0,66,27,29,28,145,27,27,0,89,10,27,0,59,28,0,0,145,28,28,0,113,10,16,28,59,27,0,0,145,27,27,0,113,10,32,27,59,28,0,0,145,28,28,0,113,10,48,28,59,27,0,0,145,27,27,0,113,10,4,27,59,29,2,0,145,29,29,0,88,30,12,0,145,30,30,0,66,28,29,30,145,28,28,0,113,10,20,28,59,27,0,0,145,27,27,0,113,10,36,27,59,28,0,0,145,28,28,0,113,10,52,28,59,27,0,0,145,27,27,0,113,10,8,27,59,28,0,0,145,28,28,0,113,10,24,28,59,30,254,255,145,30,30,0,88,29,13,0,145,29,29,0,66,27,30,29,145,27,27,0,113,10,40,27,59,28,0,0,145,28,28,0,113,10,56,28,86,14,20,0,145,14,14,0,86,27,21,0,145,27,27,0,63,28,14,27,145,28,28,0,68,15,28,0,145,15,15,0,88,29,11,0,145,29,29,0,66,27,15,29,145,27,27,0,113,10,12,27,86,16,7,0,145,16,16,0,86,28,22,0,145,28,28,0,63,27,16,28,145,27,27,0,68,17,27,0,145,17,17,0,88,29,12,0,145,29,29,0,66,28,17,29,145,28,28,0,113,10,28,28,86,18,9,0,145,18,18,0,86,27,8,0,145,27,27,0,63,28,18,27,145,28,28,0,68,19,28,0,145,19,19,0,88,29,13,0,145,29,29,0,66,27,19,29,145,27,27,0,113,10,44,27,59,28,1,0,145,28,28,0,113,10,60,28,0,23,0,0,0,25,10,0,25,26,23,64,116,23,25,0,25,23,23,4,25,25,25,4,54,28,23,26,168,160,1,0,137,24,0,0,139,0,0,0,140,3,36,0,0,0,0,0,2,31,0,0,128,128,128,128,2,32,0,0,255,254,254,254,2,33,0,0,255,0,0,0,1,30,0,0,19,34,1,33,0,25,34,0,33,28,2,0,38,34,0,3,33,34,34,0,19,34,28,34,121,34,29,0,19,34,1,33,0,29,34,0,0,6,0,0,0,9,2,0,78,34,6,0,41,35,29,24,42,35,35,24,45,34,34,35,56,161,1,0,0,5,6,0,0,8,9,0,1,30,6,0,119,0,20,0,25,18,6,1,26,19,9,1,33,20,19,0,38,34,18,3,33,34,34,0,19,34,20,34,121,34,4,0,0,6,18,0,0,9,19,0,119,0,238,255,0,4,18,0,0,7,19,0,0,17,20,0,1,30,5,0,119,0,5,0,0,4,0,0,0,7,2,0,0,17,28,0,1,30,5,0,32,34,30,5,121,34,7,0,121,17,5,0,0,5,4,0,0,8,7,0,1,30,6,0,119,0,2,0,1,30,16,0,32,34,30,6,121,34,71,0,19,34,1,33,0,21,34,0,78,34,5,0,41,35,21,24,42,35,35,24,45,34,34,35,220,161,1,0,120,8,3,0,1,30,16,0,119,0,61,0,0,27,5,0,119,0,59,0,2,34,0,0,1,1,1,1,5,22,25,34,1,34,3,0,48,34,34,8,96,162,1,0,0,10,5,0,0,13,8,0,82,34,10,0,21,34,34,22,0,23,34,0,19,34,23,31,21,34,34,31,2,35,0,0,1,1,1,1,4,35,23,35,19,34,34,35,121,34,4,0,0,12,13,0,0,16,10,0,119,0,16,0,25,24,10,4,26,26,13,4,1,34,3,0,48,34,34,26,80,162,1,0,0,10,24,0,0,13,26,0,119,0,236,255,0,3,24,0,0,11,26,0,1,30,11,0,119,0,4,0,0,3,5,0,0,11,8,0,1,30,11,0,32,34,30,11,121,34,6,0,120,11,3,0,1,30,16,0,119,0,18,0,0,12,11,0,0,16,3,0,0,14,16,0,0,15,12,0,78,34,14,0,41,35,21,24,42,35,35,24,45,34,34,35,172,162,1,0,0,27,14,0,119,0,7,0,26,15,15,1,120,15,3,0,1,30,16,0,119,0,3,0,25,14,14,1,119,0,244,255,32,34,30,16,121,34,2,0,1,27,0,0,139,27,0,0,140,5,26,0,0,0,0,0,136,22,0,0,0,21,22,0,136,22,0,0,1,23,80,2,3,22,22,23,137,22,0,0,130,22,0,0,136,23,0,0,49,22,22,23,16,163,1,0,1,23,80,2,135,22,0,0,23,0,0,0,1,22,56,2,3,18,21,22,1,22,48,2,3,17,21,22,1,22,40,2,3,16,21,22,1,22,32,2,3,15,21,22,1,22,16,2,3,20,21,22,1,22,8,2,3,19,21,22,1,22,0,2,3,14,21,22,1,22,76,2,3,10,21,22,1,22,72,2,3,11,21,22,1,22,64,2,3,12,21,22,1,22,60,2,3,13,21,22,0,5,21,0,85,10,0,0,85,11,1,0,1,22,68,2,97,21,22,2,85,12,3,0,85,13,4,0,82,22,11,0,1,23,0,1,13,22,22,23,82,23,12,0,32,23,23,1,19,22,22,23,121,22,7,0,82,23,10,0,1,24,1,0,135,22,238,0,23,24,0,0,137,21,0,0,139,0,0,0,82,22,11,0,1,24,45,1,13,22,22,24,82,24,12,0,32,24,24,1,19,22,22,24,120,22,7,0,1,22,64,82,82,24,11,0,82,23,12,0,95,22,24,23,137,21,0,0,139,0,0,0,82,23,13,0,33,23,23,2,121,23,18,0,1,23,12,118,82,23,23,0,85,18,23,0,1,22,53,46,134,24,0,0,248,127,2,0,22,18,0,0,134,23,0,0,212,5,2,0,24,0,0,0,1,23,12,118,1,24,12,118,82,24,24,0,25,24,24,1,85,23,24,0,137,21,0,0,139,0,0,0,1,24,181,120,78,24,24,0,38,24,24,1,121,24,40,0,134,24,0,0,152,125,2,0,1,24,181,120,1,23,0,0,83,24,23,0,1,23,12,118,82,23,23,0,26,23,23,1,85,14,23,0,1,23,176,45,134,6,0,0,248,127,2,0,23,14,0,0,1,23,12,118,82,23,23,0,26,23,23,1,85,19,23,0,1,23,176,45,134,7,0,0,248,127,2,0,23,19,0,0,85,20,6,0,109,20,4,7,1,22,194,45,134,24,0,0,248,127,2,0,22,20,0,0,135,23,239,0,24,0,0,0,1,24,3,0,1,22,229,45,1,25,24,2,3,25,21,25,134,23,0,0,252,32,2,0,24,22,25,0,137,21,0,0,139,0,0,0,119,0,58,0,1,23,181,120,1,25,1,0,83,23,25,0,1,25,16,118,1,23,0,0,85,25,23,0,1,25,0,0,1,22,0,2,135,23,3,0,5,25,22,0,1,23,12,118,82,23,23,0,85,15,23,0,1,25,0,46,134,22,0,0,248,127,2,0,25,15,0,0,135,23,16,0,5,22,0,0,1,23,148,117,82,8,23,0,1,23,152,117,82,9,23,0,134,25,0,0,80,161,2,0,145,25,25,0,59,24,10,0,145,24,24,0,65,22,25,24,145,22,22,0,75,22,22,0,1,24,8,0,1,25,0,0,134,23,0,0,20,219,1,0,5,8,9,22,24,25,0,0,1,23,12,118,1,25,12,118,82,25,25,0,25,25,25,1,85,23,25,0,1,25,12,118,82,25,25,0,85,16,25,0,1,23,176,45,134,25,0,0,248,127,2,0,23,16,0,0,85,17,25,0,1,23,3,0,1,24,20,46,134,25,0,0,252,32,2,0,23,24,17,0,137,21,0,0,139,0,0,0,139,0,0,0,140,6,25,0,0,0,0,0,1,16,0,0,136,19,0,0,0,17,19,0,136,19,0,0,25,19,19,48,137,19,0,0,130,19,0,0,136,20,0,0,49,19,19,20,12,166,1,0,1,20,48,0,135,19,0,0,20,0,0,0,25,12,17,36,25,13,17,32,25,14,17,28,25,15,17,24,25,6,17,20,25,7,17,16,25,8,17,12,25,9,17,8,25,10,17,4,0,11,17,0,85,12,0,0,85,13,1,0,85,14,2,0,85,15,3,0,85,6,4,0,85,7,5,0,82,20,15,0,82,21,6,0,5,19,20,21,85,8,19,0,1,19,0,0,85,9,19,0,82,19,8,0,82,21,9,0,57,19,19,21,4,168,1,0,82,19,12,0,121,19,41,0,82,19,12,0,79,19,19,0,82,21,13,0,79,21,21,0,45,19,19,21,20,167,1,0,82,19,12,0,103,19,19,1,82,21,13,0,103,21,21,1,45,19,19,21,12,167,1,0,82,19,12,0,103,19,19,2,82,21,13,0,103,21,21,2,45,19,19,21,4,167,1,0,82,19,14,0,82,21,12,0,78,21,21,0,83,19,21,0,82,21,14,0,82,19,12,0,102,19,19,1,107,21,1,19,82,19,14,0,82,21,12,0,102,21,21,2,107,19,2,21,82,21,14,0,1,19,0,0,107,21,3,19,119,0,8,0,1,16,8,0,119,0,6,0,1,16,8,0,119,0,4,0,1,16,8,0,119,0,2,0,1,16,8,0,32,19,16,8,121,19,41,0,1,16,0,0,2,19,0,0,64,66,15,0,85,10,19,0,1,19,1,0,85,11,19,0,82,18,13,0,82,21,7,0,82,20,13,0,79,20,20,0,103,22,18,1,103,23,18,2,1,24,1,0,134,19,0,0,168,119,1,0,21,20,22,23,11,10,24,0,82,19,14,0,82,24,7,0,25,24,24,4,82,23,11,0,90,24,24,23,83,19,24,0,82,24,14,0,82,19,7,0,1,23,4,1,3,19,19,23,82,23,11,0,90,19,19,23,107,24,1,19,82,19,14,0,82,24,7,0,1,23,4,2,3,24,24,23,82,23,11,0,90,24,24,23,107,19,2,24,82,24,14,0,82,19,11,0,107,24,3,19,82,19,12,0,121,19,4,0,82,19,12,0,25,19,19,4,85,12,19,0,82,19,14,0,25,19,19,4,85,14,19,0,82,19,13,0,25,19,19,4,85,13,19,0,82,19,9,0,25,19,19,1,85,9,19,0,119,0,153,255,137,17,0,0,139,0,0,0,140,3,26,0,0,0,0,0,136,23,0,0,0,17,23,0,136,23,0,0,1,24,128,0,3,23,23,24,137,23,0,0,130,23,0,0,136,24,0,0,49,23,23,24,72,168,1,0,1,24,128,0,135,23,0,0,24,0,0,0,25,14,17,56,25,3,17,40,0,15,17,0,25,5,17,36,25,7,17,32,25,9,17,28,25,11,17,16,25,13,17,4,89,5,0,0,89,7,1,0,89,9,2,0,88,23,5,0,145,23,23,0,89,11,23,0,88,24,7,0,145,24,24,0,113,11,4,24,88,23,9,0,145,23,23,0,113,11,8,23,1,23,160,120,78,23,23,0,38,23,23,1,121,23,22,0,116,3,11,0,106,24,11,4,109,3,4,24,106,23,11,8,109,3,8,23,0,16,14,0,1,18,148,115,25,19,16,64,116,16,18,0,25,16,16,4,25,18,18,4,54,23,16,19,200,168,1,0,134,23,0,0,136,206,1,0,13,3,14,0,116,11,13,0,106,24,13,4,109,11,4,24,106,23,13,8,109,11,8,23,1,23,192,81,1,24,220,115,82,24,24,0,27,24,24,48,94,23,23,24,1,24,0,32,47,23,23,24,12,170,1,0,88,4,11,0,145,4,4,0,1,23,192,81,1,24,220,115,82,24,24,0,27,24,24,48,3,20,23,24,106,24,20,12,82,23,20,0,27,23,23,3,41,23,23,2,101,24,23,4,112,6,11,4,145,6,6,0,1,23,192,81,1,24,220,115,82,24,24,0,27,24,24,48,3,21,23,24,106,24,21,12,82,23,21,0,27,23,23,3,25,23,23,1,41,23,23,2,101,24,23,6,112,8,11,8,145,8,8,0,1,23,192,81,1,24,220,115,82,24,24,0,27,24,24,48,3,22,23,24,106,24,22,12,82,23,22,0,27,23,23,3,25,23,23,2,41,23,23,2,101,24,23,8,1,23,192,81,1,24,220,115,82,24,24,0,27,24,24,48,3,10,23,24,82,24,10,0,25,24,24,1,85,10,24,0,1,24,212,115,82,24,24,0,1,23,216,115,82,23,23,0,26,23,23,1,41,23,23,4,3,24,24,23,25,12,24,4,82,24,12,0,25,24,24,1,85,12,24,0,137,17,0,0,139,0,0,0,119,0,8,0,1,23,5,0,1,25,233,30,134,24,0,0,252,32,2,0,23,25,15,0,137,17,0,0,139,0,0,0,139,0,0,0,140,1,23,0,0,0,0,0,127,10,0,0,89,10,0,0,127,10,0,0,82,2,10,0,2,10,0,0,255,255,255,127,19,10,2,10,0,4,10,0,2,10,0,0,255,255,127,63,48,10,10,4,208,170,1,0,2,10,0,0,0,0,128,63,45,10,4,10,176,170,1,0,34,11,2,0,121,11,7,0,62,11,0,0,252,222,166,63,251,33,9,64,145,11,11,0,58,10,11,0,119,0,4,0,59,11,0,0,145,11,11,0,58,10,11,0,58,1,10,0,145,10,1,0,139,10,0,0,119,0,9,0,59,10,0,0,145,10,10,0,64,11,0,0,145,11,11,0,66,1,10,11,145,1,1,0,145,11,1,0,139,11,0,0,2,11,0,0,0,0,0,63,48,11,4,11,224,171,1,0,2,11,0,0,1,0,128,50,48,11,4,11,8,171,1,0,62,1,0,0,252,222,166,63,251,33,249,63,145,1,1,0,145,11,1,0,139,11,0,0,65,3,0,0,145,3,3,0,62,11,0,0,252,222,166,63,251,33,249,63,145,11,11,0,62,13,0,0,105,182,47,0,45,68,116,62,145,13,13,0,62,20,0,0,122,198,19,64,119,226,165,191,145,20,20,0,62,22,0,0,224,255,229,95,109,186,129,63,145,22,22,0,65,21,3,22,145,21,21,0,64,19,20,21,145,19,19,0,65,18,3,19,145,18,18,0,62,19,0,0,37,239,15,160,78,85,197,63,145,19,19,0,63,17,18,19,145,17,17,0,65,16,3,17,145,16,16,0,59,19,1,0,145,19,19,0,62,21,0,0,44,67,13,192,181,156,230,63,145,21,21,0,65,18,3,21,145,18,18,0,64,17,19,18,145,17,17,0,66,15,16,17,145,15,15,0,65,14,15,0,145,14,14,0,64,12,13,14,145,12,12,0,64,10,0,12,145,10,10,0,64,1,11,10,145,1,1,0,145,10,1,0,139,10,0,0,34,10,2,0,121,10,71,0,59,11,1,0,145,11,11,0,63,10,0,11,145,10,10,0,61,11,0,0,0,0,0,63,145,11,11,0,65,5,10,11,145,5,5,0,145,11,5,0,135,6,230,0,11,0,0,0,145,6,6,0,62,10,0,0,252,222,166,63,251,33,249,63,145,10,10,0,62,21,0,0,122,198,19,64,119,226,165,191,145,21,21,0,62,22,0,0,224,255,229,95,109,186,129,63,145,22,22,0,65,20,5,22,145,20,20,0,64,19,21,20,145,19,19,0,65,18,5,19,145,18,18,0,62,19,0,0,37,239,15,160,78,85,197,63,145,19,19,0,63,16,18,19,145,16,16,0,65,17,5,16,145,17,17,0,59,19,1,0,145,19,19,0,62,20,0,0,44,67,13,192,181,156,230,63,145,20,20,0,65,18,5,20,145,18,18,0,64,16,19,18,145,16,16,0,66,15,17,16,145,15,15,0,65,13,15,6,145,13,13,0,62,15,0,0,105,182,47,0,45,68,116,190,145,15,15,0,63,14,13,15,145,14,14,0,63,12,6,14,145,12,12,0,64,11,10,12,145,11,11,0,59,12,2,0,145,12,12,0,65,1,11,12,145,1,1,0,145,12,1,0,139,12,0,0,119,0,79,0,59,11,1,0,145,11,11,0,64,12,11,0,145,12,12,0,61,11,0,0,0,0,0,63,145,11,11,0,65,7,12,11,145,7,7,0,145,11,7,0,135,8,230,0,11,0,0,0,145,8,8,0,127,11,0,0,127,12,0,0,89,12,8,0,127,12,0,0,82,12,12,0,1,10,0,240,19,12,12,10,85,11,12,0,127,12,0,0,88,9,12,0,145,9,9,0,62,18,0,0,122,198,19,64,119,226,165,191,145,18,18,0,62,20,0,0,224,255,229,95,109,186,129,63,145,20,20,0,65,19,7,20,145,19,19,0,64,17,18,19,145,17,17,0,65,16,7,17,145,16,16,0,62,17,0,0,37,239,15,160,78,85,197,63,145,17,17,0,63,13,16,17,145,13,13,0,65,15,7,13,145,15,15,0,59,17,1,0,145,17,17,0,62,19,0,0,44,67,13,192,181,156,230,63,145,19,19,0,65,16,7,19,145,16,16,0,64,13,17,16,145,13,13,0,66,14,15,13,145,14,14,0,65,10,14,8,145,10,10,0,65,15,9,9,145,15,15,0,64,13,7,15,145,13,13,0,63,15,8,9,145,15,15,0,66,14,13,15,145,14,14,0,63,11,10,14,145,11,11,0,63,12,11,9,145,12,12,0,59,11,2,0,145,11,11,0,65,1,12,11,145,1,1,0,145,11,1,0,139,11,0,0,59,11,0,0,145,11,11,0,139,11,0,0,140,2,19,0,0,0,0,0,136,14,0,0,0,13,14,0,136,14,0,0,25,14,14,112,137,14,0,0,130,14,0,0,136,15,0,0,49,14,14,15,124,174,1,0,1,15,112,0,135,14,0,0,15,0,0,0,0,12,13,0,25,3,13,104,25,4,13,100,25,5,13,96,25,6,13,32,25,7,13,28,25,8,13,24,25,10,13,20,25,11,13,16,25,2,13,12,85,3,1,0,1,14,0,0,85,4,14,0,82,15,3,0,1,16,192,47,134,14,0,0,104,106,2,0,15,16,0,0,85,5,14,0,82,14,5,0,120,14,10,0,116,12,3,0,1,16,4,0,1,15,66,59,134,14,0,0,252,32,2,0,16,15,12,0,82,9,4,0,137,13,0,0,139,9,0,0,1,15,107,59,1,16,12,0,135,14,240,0,6,15,16,0,1,16,0,0,109,6,12,16,1,14,0,0,109,6,16,14,1,16,1,0,109,6,20,16,1,14,0,0,109,6,24,14,1,16,0,0,109,6,28,16,1,14,0,0,109,6,32,14,106,16,0,4,109,6,36,16,106,14,0,8,109,6,40,14,1,16,0,0,109,6,44,16,1,14,0,0,109,6,48,14,1,16,1,0,109,6,52,16,106,14,0,12,109,6,56,14,1,16,0,0,109,6,60,16,106,14,0,16,25,15,6,28,25,17,6,24,25,18,6,16,134,16,0,0,32,129,1,0,14,15,17,18,106,18,6,24,109,6,32,18,106,18,6,24,32,18,18,255,121,18,8,0,1,16,4,0,1,17,119,59,25,15,13,8,134,18,0,0,252,32,2,0,16,17,15,0,119,0,58,0,1,15,64,0,1,17,1,0,82,16,5,0,134,18,0,0,88,130,2,0,6,15,17,16,85,4,18,0,25,18,0,4,116,7,18,0,25,18,0,8,116,8,18,0,1,18,0,0,85,10,18,0,1,18,0,0,85,11,18,0,106,18,0,12,82,16,11,0,56,18,18,16,156,176,1,0,82,16,7,0,82,17,8,0,106,15,0,16,134,18,0,0,160,15,2,0,16,17,15,0,85,2,18,0,1,15,4,0,1,17,1,0,82,16,5,0,134,18,0,0,88,130,2,0,2,15,17,16,85,4,18,0,82,16,0,0,82,17,10,0,3,16,16,17,82,17,2,0,1,15,1,0,82,14,5,0,134,18,0,0,88,130,2,0,16,17,15,14,85,4,18,0,82,18,7,0,28,18,18,2,85,7,18,0,82,18,8,0,28,18,18,2,85,8,18,0,82,18,10,0,82,14,2,0,3,18,18,14,85,10,18,0,82,18,11,0,25,18,18,1,85,11,18,0,119,0,215,255,82,14,5,0,134,18,0,0,100,103,2,0,14,0,0,0,82,9,4,0,137,13,0,0,139,9,0,0,140,1,15,0,0,0,0,0,136,12,0,0,0,8,12,0,136,12,0,0,1,13,16,1,3,12,12,13,137,12,0,0,130,12,0,0,136,13,0,0,49,12,12,13,244,176,1,0,1,13,16,1,135,12,0,0,13,0,0,0,1,12,200,0,3,2,8,12,1,12,136,0,3,1,8,12,1,12,128,0,3,3,8,12,25,4,8,64,0,5,8,0,85,3,0,0,82,13,3,0,88,12,13,0,145,12,12,0,89,4,12,0,82,14,3,0,112,13,14,16,145,13,13,0,113,4,4,13,82,14,3,0,112,12,14,32,145,12,12,0,113,4,8,12,82,14,3,0,112,13,14,48,145,13,13,0,113,4,12,13,82,14,3,0,112,12,14,4,145,12,12,0,113,4,16,12,82,14,3,0,112,13,14,20,145,13,13,0,113,4,20,13,82,14,3,0,112,12,14,36,145,12,12,0,113,4,24,12,82,14,3,0,112,13,14,52,145,13,13,0,113,4,28,13,82,14,3,0,112,12,14,8,145,12,12,0,113,4,32,12,82,14,3,0,112,13,14,24,145,13,13,0,113,4,36,13,82,14,3,0,112,12,14,40,145,12,12,0,113,4,40,12,82,14,3,0,112,13,14,56,145,13,13,0,113,4,44,13,82,14,3,0,112,12,14,12,145,12,12,0,113,4,48,12,82,14,3,0,112,13,14,28,145,13,13,0,113,4,52,13,82,14,3,0,112,12,14,44,145,12,12,0,113,4,56,12,82,14,3,0,112,13,14,60,145,13,13,0,113,4,60,13,1,13,76,115,82,11,13,0,0,6,11,0,0,7,1,0,0,9,11,0,25,10,7,64,116,7,9,0,25,7,7,4,25,9,9,4,54,13,7,10,48,178,1,0,0,7,2,0,0,9,4,0,25,10,7,64,116,7,9,0,25,7,7,4,25,9,9,4,54,13,7,10,80,178,1,0,134,13,0,0,212,150,0,0,5,1,2,0,0,7,6,0,0,9,5,0,25,10,7,64,116,7,9,0,25,7,7,4,25,9,9,4,54,13,7,10,124,178,1,0,137,8,0,0,139,0,0,0,140,1,16,0,0,0,0,0,2,10,0,0,246,28,0,0,2,11,0,0,245,28,0,0,2,12,0,0,247,28,0,0,136,13,0,0,0,9,13,0,136,13,0,0,25,13,13,16,137,13,0,0,130,13,0,0,136,14,0,0,49,13,13,14,232,178,1,0,1,14,16,0,135,13,0,0,14,0,0,0,0,1,9,0,85,1,0,0,1,13,212,115,82,13,13,0,1,14,216,115,82,14,14,0,26,14,14,1,41,14,14,4,94,13,13,14,82,14,1,0,45,13,13,14,32,179,1,0,137,9,0,0,139,0,0,0,1,13,0,0,1,14,212,115,82,14,14,0,1,15,216,115,82,15,15,0,26,15,15,1,41,15,15,4,3,14,14,15,106,14,14,4,47,13,13,14,156,181,1,0,1,13,212,115,82,13,13,0,1,14,216,115,82,14,14,0,26,14,14,1,41,14,14,4,3,3,13,14,1,14,212,115,82,14,14,0,1,13,216,115,82,13,13,0,26,13,13,1,41,13,13,4,94,14,14,13,32,14,14,1,121,14,25,0,1,14,212,115,82,14,14,0,1,13,216,115,82,13,13,0,26,13,13,1,41,13,13,4,3,14,14,13,106,4,14,4,1,14,212,115,82,14,14,0,1,13,216,115,82,13,13,0,26,13,13,1,41,13,13,4,3,14,14,13,106,15,3,4,34,15,15,4,121,15,3,0,0,13,4,0,119,0,3,0,30,15,4,4,0,13,15,0,109,14,8,13,119,0,38,0,1,13,212,115,82,13,13,0,1,14,216,115,82,14,14,0,26,14,14,1,41,14,14,4,3,5,13,14,82,14,3,0,33,14,14,4,121,14,4,0,1,13,0,0,109,5,8,13,119,0,25,0,106,13,5,4,34,13,13,4,121,13,3,0,1,6,1,0,119,0,12,0,1,13,4,0,1,14,212,115,82,14,14,0,1,15,216,115,82,15,15,0,26,15,15,1,41,15,15,4,3,14,14,15,106,14,14,4,30,14,14,4,4,6,13,14,1,14,212,115,82,14,14,0,1,13,216,115,82,13,13,0,26,13,13,1,41,13,13,4,3,14,14,13,109,14,8,6,1,13,212,115,82,13,13,0,1,15,216,115,82,15,15,0,26,15,15,1,41,15,15,4,3,13,13,15,106,13,13,8,134,14,0,0,52,143,2,0,13,0,0,0,121,14,4,0,134,14,0,0,112,155,2,0,119,0,57,0,1,14,192,81,1,13,220,115,82,13,13,0,27,13,13,48,3,7,14,13,82,13,7,0,1,14,212,115,82,14,14,0,1,15,216,115,82,15,15,0,26,15,15,1,41,15,15,4,3,14,14,15,106,14,14,8,3,13,13,14,85,7,13,0,1,13,192,81,1,14,220,115,82,14,14,0,27,14,14,48,3,13,13,14,25,8,13,8,82,13,8,0,1,14,212,115,82,14,14,0,1,15,216,115,82,15,15,0,26,15,15,1,41,15,15,4,3,14,14,15,106,14,14,8,3,13,13,14,85,8,13,0,1,13,192,81,1,14,220,115,82,14,14,0,27,14,14,48,3,13,13,14,25,2,13,4,82,13,2,0,1,14,212,115,82,14,14,0,1,15,216,115,82,15,15,0,26,15,15,1,41,15,15,4,3,14,14,15,106,14,14,8,3,13,13,14,85,2,13,0,1,13,216,115,1,14,216,115,82,14,14,0,25,14,14,1,85,13,14,0,119,0,1,0,1,14,0,1,1,13,216,115,82,13,13,0,49,14,14,13,184,181,1,0,134,14,0,0,112,155,2,0,1,14,212,115,82,14,14,0,1,13,216,115,82,13,13,0,26,13,13,1,41,13,13,4,82,15,1,0,97,14,13,15,1,15,212,115,82,15,15,0,1,13,216,115,82,13,13,0,26,13,13,1,41,13,13,4,3,15,15,13,1,13,0,0,109,15,4,13,1,13,212,115,82,13,13,0,1,15,216,115,82,15,15,0,26,15,15,1,41,15,15,4,3,13,13,15,1,15,224,115,82,15,15,0,109,13,12,15,137,9,0,0,139,0,0,0,140,3,26,0,0,0,0,0,136,16,0,0,0,14,16,0,136,16,0,0,25,16,16,64,137,16,0,0,130,16,0,0,136,17,0,0,49,16,16,17,100,182,1,0,1,17,64,0,135,16,0,0,17,0,0,0,25,3,14,44,25,5,14,40,25,6,14,36,25,9,14,32,25,10,14,28,25,11,14,24,25,12,14,20,0,13,14,0,85,5,0,0,85,6,1,0,85,9,2,0,82,16,5,0,82,16,16,0,120,16,3,0,137,14,0,0,139,0,0,0,82,16,5,0,106,16,16,4,120,16,3,0,137,14,0,0,139,0,0,0,82,16,5,0,106,16,16,8,120,16,3,0,137,14,0,0,139,0,0,0,82,4,5,0,116,3,4,0,106,17,4,4,109,3,4,17,106,16,4,8,109,3,8,16,106,17,4,12,109,3,12,17,106,16,4,16,109,3,16,16,134,16,0,0,24,194,0,0,3,0,0,0,85,10,16,0,82,18,6,0,82,19,9,0,5,17,18,19,41,17,17,2,135,16,6,0,17,0,0,0,85,11,16,0,82,15,5,0,82,17,10,0,106,19,15,4,106,18,15,8,1,20,0,0,82,21,11,0,82,22,6,0,82,23,9,0,1,24,0,0,1,25,4,0,134,16,0,0,232,31,2,0,17,19,18,20,21,22,23,24,25,0,0,0,82,16,5,0,25,16,16,16,116,12,16,0,82,7,5,0,116,3,7,0,106,25,7,4,109,3,4,25,106,16,7,8,109,3,8,16,106,25,7,12,109,3,12,25,106,16,7,16,109,3,16,16,134,16,0,0,128,160,2,0,3,0,0,0,82,8,5,0,82,25,11,0,82,24,6,0,82,23,9,0,134,16,0,0,144,225,1,0,13,25,24,23,116,8,13,0,106,23,13,4,109,8,4,23,106,16,13,8,109,8,8,16,106,23,13,12,109,8,12,23,106,16,13,16,109,8,16,16,82,23,5,0,82,24,12,0,134,16,0,0,24,33,0,0,23,24,0,0,82,24,11,0,135,16,5,0,24,0,0,0,82,24,10,0], eb + 102400);
  HEAPU8.set([135,16,5,0,24,0,0,0,137,14,0,0,139,0,0,0,140,0,21,0,0,0,0,0,2,15,0,0,16,4,0,0,2,16,0,0,64,84,0,0,136,17,0,0,0,13,17,0,136,17,0,0,1,18,208,5,3,17,17,18,137,17,0,0,130,17,0,0,136,18,0,0,49,17,17,18,92,184,1,0,1,18,208,5,135,17,0,0,18,0,0,0,1,17,204,5,3,3,13,17,1,17,200,5,3,4,13,17,1,17,196,5,3,6,13,17,1,17,192,5,3,7,13,17,1,17,188,5,3,8,13,17,0,10,13,0,1,17,184,5,3,11,13,17,1,17,180,5,3,12,13,17,1,17,176,5,3,0,13,17,1,17,172,5,3,1,13,17,1,17,168,5,3,2,13,17,134,17,0,0,228,134,2,0,1,17,8,118,1,18,0,0,85,17,18,0,1,17,136,117,82,17,17,0,1,19,160,5,3,19,13,19,1,20,152,5,3,20,13,20,135,18,241,0,17,19,20,0,1,18,0,0,85,3,18,0,1,18,0,2,82,20,3,0,56,18,18,20,12,185,1,0,82,18,3,0,25,18,18,1,85,3,18,0,119,0,249,255,1,18,0,0,85,4,18,0,1,18,3,0,82,20,4,0,56,18,18,20,72,185,1,0,82,14,4,0,1,18,178,120,1,20,175,120,90,20,20,14,95,18,14,20,82,20,4,0,25,20,20,1,85,4,20,0,119,0,244,255,1,20,4,118,1,18,0,0,85,20,18,0,1,18,0,0,85,6,18,0,135,18,242,0,120,18,3,0,135,18,243,0,85,6,18,0,1,18,0,0,85,7,18,0,82,20,7,0,82,19,6,0,47,20,20,19,148,185,1,0,82,20,7,0,34,20,20,4,0,18,20,0,119,0,3,0,1,20,0,0,0,18,20,0,120,18,2,0,119,0,83,0,1,18,0,0,85,8,18,0,82,5,7,0,1,18,32,0,82,20,8,0,56,18,18,20,208,185,1,0,82,18,8,0,25,18,18,1,85,8,18,0,119,0,248,255,135,18,244,0,5,10,0,0,85,11,18,0,82,18,11,0,120,18,63,0,1,18,0,0,85,12,18,0,82,20,12,0,106,19,10,12,47,20,20,19,12,186,1,0,82,20,12,0,34,20,20,32,0,18,20,0,119,0,3,0,1,20,0,0,0,18,20,0,120,18,2,0,119,0,26,0,82,20,12,0,134,18,0,0,4,27,2,0,20,0,0,0,85,0,18,0,82,18,7,0,41,18,18,5,3,18,16,18,82,20,0,0,3,9,18,20,3,20,10,15,82,18,12,0,41,18,18,2,94,20,20,18,32,20,20,1,121,20,4,0,1,20,1,0,83,9,20,0,119,0,3,0,1,20,0,0,83,9,20,0,82,20,12,0,25,20,20,1,85,12,20,0,119,0,220,255,1,20,0,0,85,1,20,0,82,18,1,0,106,19,10,8,47,18,18,19,168,186,1,0,82,18,1,0,34,18,18,8,0,20,18,0,119,0,3,0,1,18,0,0,0,20,18,0,120,20,2,0,119,0,10,0,82,18,1,0,134,20,0,0,92,111,2,0,18,0,0,0,85,2,20,0,82,20,1,0,25,20,20,1,85,1,20,0,119,0,236,255,82,20,7,0,25,20,20,1,85,7,20,0,119,0,163,255,137,13,0,0,139,0,0,0,140,4,25,0,0,0,0,0,136,23,0,0,0,19,23,0,136,23,0,0,1,24,112,1,3,23,23,24,137,23,0,0,130,23,0,0,136,24,0,0,49,23,23,24,48,187,1,0,1,24,112,1,135,23,0,0,24,0,0,0,1,23,40,1,3,5,19,23,1,23,232,0,3,4,19,23,1,23,228,0,3,12,19,23,1,23,224,0,3,13,19,23,1,23,220,0,3,14,19,23,1,23,216,0,3,15,19,23,1,23,152,0,3,16,19,23,1,23,140,0,3,17,19,23,1,23,128,0,3,6,19,23,25,7,19,64,0,8,19,0,89,12,0,0,89,13,1,0,89,14,2,0,89,15,3,0,134,23,0,0,124,116,2,0,16,0,0,0,88,23,13,0,145,23,23,0,89,17,23,0,88,24,14,0,145,24,24,0,113,17,4,24,88,23,15,0,145,23,23,0,113,17,8,23,116,5,17,0,106,24,17,4,109,5,4,24,106,23,17,8,109,5,8,23,134,23,0,0,188,8,2,0,6,5,0,0,88,23,12,0,145,23,23,0,62,24,0,0,20,25,67,160,70,223,145,63,145,24,24,0,65,9,23,24,145,9,9,0,116,5,6,0,106,23,6,4,109,5,4,23,106,24,6,8,109,5,8,24,134,24,0,0,12,75,1,0,7,5,9,0,0,18,16,0,0,20,7,0,25,21,18,64,116,18,20,0,25,18,18,4,25,20,20,4,54,24,18,21,44,188,1,0,1,24,76,115,82,22,24,0,0,10,22,0,0,11,22,0,0,18,4,0,0,20,16,0,25,21,18,64,116,18,20,0,25,18,18,4,25,20,20,4,54,24,18,21,92,188,1,0,0,18,5,0,0,20,11,0,25,21,18,64,116,18,20,0,25,18,18,4,25,20,20,4,54,24,18,21,124,188,1,0,134,24,0,0,212,150,0,0,8,4,5,0,0,18,10,0,0,20,8,0,25,21,18,64,116,18,20,0,25,18,18,4,25,20,20,4,54,24,18,21,168,188,1,0,137,19,0,0,139,0,0,0,140,3,19,0,0,0,0,0,136,15,0,0,0,12,15,0,136,15,0,0,1,16,80,1,3,15,15,16,137,15,0,0,130,15,0,0,136,16,0,0,49,15,15,16,0,189,1,0,1,16,80,1,135,15,0,0,16,0,0,0,1,15,8,1,3,4,12,15,1,15,128,0,3,3,12,15,1,15,0,1,3,7,12,15,1,15,192,0,3,8,12,15,25,9,12,64,0,10,12,0,85,7,0,0,0,11,8,0,0,13,1,0,25,14,11,64,116,11,13,0,25,11,11,4,25,13,13,4,54,15,11,14,56,189,1,0,0,11,9,0,0,13,2,0,25,14,11,64,116,11,13,0,25,11,11,4,25,13,13,4,54,15,11,14,88,189,1,0,82,16,7,0,1,17,240,115,82,17,17,0,5,15,16,17,28,5,15,2,1,17,0,0,1,16,240,115,82,16,16,0,28,16,16,2,1,18,244,115,82,18,18,0,134,15,0,0,160,131,2,0,5,17,16,18,1,15,128,116,82,18,7,0,41,18,18,6,3,6,15,18,0,11,3,0,0,13,2,0,25,14,11,64,116,11,13,0,25,11,11,4,25,13,13,4,54,18,11,14,192,189,1,0,0,11,4,0,0,13,6,0,25,14,11,64,116,11,13,0,25,11,11,4,25,13,13,4,54,18,11,14,224,189,1,0,134,18,0,0,212,150,0,0,10,3,4,0,0,11,9,0,0,13,10,0,25,14,11,64,116,11,13,0,25,11,11,4,25,13,13,4,54,18,11,14,12,190,1,0,0,11,8,0,1,18,0,116,82,15,7,0,41,15,15,6,3,13,18,15,25,14,11,64,116,11,13,0,25,11,11,4,25,13,13,4,54,15,11,14,56,190,1,0,0,11,4,0,0,13,9,0,25,14,11,64,116,11,13,0,25,11,11,4,25,13,13,4,54,15,11,14,88,190,1,0,134,15,0,0,160,150,2,0,4,0,0,0,0,11,4,0,0,13,8,0,25,14,11,64,116,11,13,0,25,11,11,4,25,13,13,4,54,15,11,14,132,190,1,0,134,15,0,0,116,150,2,0,4,0,0,0,137,12,0,0,139,0,0,0,140,1,16,0,0,0,0,0,2,10,0,0,246,28,0,0,2,11,0,0,245,28,0,0,2,12,0,0,247,28,0,0,136,13,0,0,0,9,13,0,136,13,0,0,25,13,13,16,137,13,0,0,130,13,0,0,136,14,0,0,49,13,13,14,252,190,1,0,1,14,16,0,135,13,0,0,14,0,0,0,0,1,9,0,85,1,0,0,1,13,212,115,82,13,13,0,1,14,216,115,82,14,14,0,26,14,14,1,41,14,14,4,3,13,13,14,106,13,13,12,82,14,1,0,45,13,13,14,56,191,1,0,137,9,0,0,139,0,0,0,1,13,0,0,1,14,212,115,82,14,14,0,1,15,216,115,82,15,15,0,26,15,15,1,41,15,15,4,3,14,14,15,106,14,14,4,47,13,13,14,180,193,1,0,1,13,212,115,82,13,13,0,1,14,216,115,82,14,14,0,26,14,14,1,41,14,14,4,3,3,13,14,1,14,212,115,82,14,14,0,1,13,216,115,82,13,13,0,26,13,13,1,41,13,13,4,94,14,14,13,32,14,14,1,121,14,25,0,1,14,212,115,82,14,14,0,1,13,216,115,82,13,13,0,26,13,13,1,41,13,13,4,3,14,14,13,106,4,14,4,1,14,212,115,82,14,14,0,1,13,216,115,82,13,13,0,26,13,13,1,41,13,13,4,3,14,14,13,106,15,3,4,34,15,15,4,121,15,3,0,0,13,4,0,119,0,3,0,30,15,4,4,0,13,15,0,109,14,8,13,119,0,38,0,1,13,212,115,82,13,13,0,1,14,216,115,82,14,14,0,26,14,14,1,41,14,14,4,3,5,13,14,82,14,3,0,33,14,14,4,121,14,4,0,1,13,0,0,109,5,8,13,119,0,25,0,106,13,5,4,34,13,13,4,121,13,3,0,1,6,1,0,119,0,12,0,1,13,4,0,1,14,212,115,82,14,14,0,1,15,216,115,82,15,15,0,26,15,15,1,41,15,15,4,3,14,14,15,106,14,14,4,30,14,14,4,4,6,13,14,1,14,212,115,82,14,14,0,1,13,216,115,82,13,13,0,26,13,13,1,41,13,13,4,3,14,14,13,109,14,8,6,1,13,212,115,82,13,13,0,1,15,216,115,82,15,15,0,26,15,15,1,41,15,15,4,3,13,13,15,106,13,13,8,134,14,0,0,52,143,2,0,13,0,0,0,121,14,4,0,134,14,0,0,112,155,2,0,119,0,57,0,1,14,192,81,1,13,220,115,82,13,13,0,27,13,13,48,3,7,14,13,82,13,7,0,1,14,212,115,82,14,14,0,1,15,216,115,82,15,15,0,26,15,15,1,41,15,15,4,3,14,14,15,106,14,14,8,3,13,13,14,85,7,13,0,1,13,192,81,1,14,220,115,82,14,14,0,27,14,14,48,3,13,13,14,25,8,13,8,82,13,8,0,1,14,212,115,82,14,14,0,1,15,216,115,82,15,15,0,26,15,15,1,41,15,15,4,3,14,14,15,106,14,14,8,3,13,13,14,85,8,13,0,1,13,192,81,1,14,220,115,82,14,14,0,27,14,14,48,3,13,13,14,25,2,13,4,82,13,2,0,1,14,212,115,82,14,14,0,1,15,216,115,82,15,15,0,26,15,15,1,41,15,15,4,3,14,14,15,106,14,14,8,3,13,13,14,85,2,13,0,1,13,216,115,1,14,216,115,82,14,14,0,25,14,14,1,85,13,14,0,119,0,1,0,1,14,0,1,1,13,216,115,82,13,13,0,49,14,14,13,208,193,1,0,134,14,0,0,112,155,2,0,1,14,212,115,82,14,14,0,1,13,216,115,82,13,13,0,26,13,13,1,41,13,13,4,3,14,14,13,82,13,1,0,109,14,12,13,1,13,212,115,82,13,13,0,1,14,216,115,82,14,14,0,26,14,14,1,41,14,14,4,3,13,13,14,1,14,0,0,109,13,4,14,137,9,0,0,139,0,0,0,140,2,22,0,0,0,0,0,136,18,0,0,0,17,18,0,136,18,0,0,25,18,18,48,137,18,0,0,130,18,0,0,136,19,0,0,49,18,18,19,88,194,1,0,1,19,48,0,135,18,0,0,19,0,0,0,25,16,17,16,25,15,17,8,0,14,17,0,25,3,17,44,25,7,17,40,25,9,17,36,25,10,17,32,25,11,17,28,25,12,17,24,25,13,17,20,85,3,0,0,85,7,1,0,1,18,0,0,85,9,18,0,1,18,0,0,85,10,18,0,135,18,245,0,85,9,18,0,82,19,9,0,82,20,3,0,135,18,246,0,19,20,0,0,82,20,9,0,82,19,7,0,135,18,246,0,20,19,0,0,82,19,9,0,1,20,0,0,1,21,178,40,135,18,247,0,19,20,21,0,82,21,9,0,1,20,1,0,1,19,193,40,135,18,247,0,21,20,19,0,82,19,9,0,1,20,2,0,1,21,36,41,135,18,247,0,19,20,21,0,82,21,9,0,1,20,3,0,1,19,208,40,135,18,247,0,21,20,19,0,82,19,9,0,1,20,4,0,1,21,49,41,135,18,247,0,19,20,21,0,82,21,9,0,1,20,5,0,1,19,63,41,135,18,247,0,21,20,19,0,82,19,9,0,135,18,248,0,19,0,0,0,82,19,9,0,2,20,0,0,130,139,0,0,135,18,249,0,19,20,10,0,82,4,9,0,82,18,10,0,120,18,57,0,85,14,4,0,1,20,4,0,1,19,79,41,134,18,0,0,252,32,2,0,20,19,14,0,1,18,0,0,85,11,18,0,82,19,9,0,2,20,0,0,132,139,0,0,135,18,249,0,19,20,11,0,82,5,11,0,135,18,250,0,85,13,18,0,0,2,5,0,136,18,0,0,0,6,18,0,136,18,0,0,27,20,2,1,25,20,20,15,38,20,20,240,3,18,18,20,137,18,0,0,130,18,0,0,136,20,0,0,49,18,18,20,236,195,1,0,27,20,2,1,25,20,20,15,38,20,20,240,135,18,0,0,20,0,0,0,82,20,9,0,82,19,11,0,135,18,251,0,20,19,12,6,85,15,6,0,1,19,3,0,1,20,125,41,134,18,0,0,252,32,2,0,19,20,15,0,82,20,9,0,135,18,252,0,20,0,0,0,1,18,0,0,85,9,18,0,82,20,13,0,135,18,253,0,20,0,0,0,82,8,9,0,137,17,0,0,139,8,0,0,119,0,10,0,85,16,4,0,1,20,3,0,1,19,128,41,134,18,0,0,252,32,2,0,20,19,16,0,82,8,9,0,137,17,0,0,139,8,0,0,1,18,0,0,139,18,0,0,140,2,22,0,0,0,0,0,136,16,0,0,0,15,16,0,136,16,0,0,25,16,16,48,137,16,0,0,130,16,0,0,136,17,0,0,49,16,16,17,168,196,1,0,1,17,48,0,135,16,0,0,17,0,0,0,25,2,15,28,25,14,15,8,0,13,15,0,25,4,15,24,25,7,15,20,25,9,15,16,25,10,15,12,85,4,1,0,1,16,0,0,85,7,16,0,116,2,0,0,106,17,0,4,109,2,4,17,106,16,0,8,109,2,8,16,106,17,0,12,109,2,12,17,106,16,0,16,109,2,16,16,134,16,0,0,24,194,0,0,2,0,0,0,85,9,16,0,82,16,4,0,1,17,94,58,134,11,0,0,232,1,2,0,16,17,0,0,82,12,4,0,121,11,13,0,106,16,0,4,106,18,0,8,1,19,4,0,82,20,9,0,106,21,0,4,41,21,21,2,134,17,0,0,192,253,1,0,12,16,18,19,20,21,0,0,85,7,17,0,119,0,49,0,1,17,99,58,134,3,0,0,232,1,2,0,12,17,0,0,82,5,4,0,121,3,15,0,116,2,0,0,106,21,0,4,109,2,4,21,106,17,0,8,109,2,8,17,106,21,0,12,109,2,12,21,106,17,0,16,109,2,16,17,134,17,0,0,68,174,1,0,2,5,0,0,85,7,17,0,119,0,29,0,1,21,0,59,134,17,0,0,232,1,2,0,5,21,0,0,121,17,24,0,82,21,4,0,1,20,192,47,134,17,0,0,104,106,2,0,21,20,0,0,85,10,17,0,82,6,0,0,106,17,0,4,106,20,0,8,106,21,0,16,134,8,0,0,160,15,2,0,17,20,21,0,1,20,1,0,82,17,10,0,134,21,0,0,88,130,2,0,6,8,20,17,85,7,21,0,82,17,10,0,134,21,0,0,100,103,2,0,17,0,0,0,82,17,9,0,135,21,5,0,17,0,0,0,82,21,7,0,121,21,10,0,116,13,4,0,1,17,3,0,1,20,5,59,134,21,0,0,252,32,2,0,17,20,13,0,137,15,0,0,139,0,0,0,119,0,8,0,1,20,4,0,1,17,37,59,134,21,0,0,252,32,2,0,20,17,14,0,137,15,0,0,139,0,0,0,139,0,0,0,140,1,22,0,0,0,0,0,127,17,0,0,89,17,0,0,127,17,0,0,82,4,17,0,43,17,4,31,0,6,17,0,2,17,0,0,255,255,255,127,19,17,4,17,0,9,17,0,2,17,0,0,255,255,127,76,48,17,17,9,252,198,1,0,32,18,6,0,121,18,7,0,62,18,0,0,252,222,166,63,251,33,249,63,145,18,18,0,58,17,18,0,119,0,6,0,62,18,0,0,252,222,166,63,251,33,249,191,145,18,18,0,58,17,18,0,58,16,17,0,2,18,0,0,0,0,128,127,16,18,18,9,126,17,18,0,16,0,0,0,145,17,17,0,139,17,0,0,2,17,0,0,0,0,224,62,48,17,9,17,56,199,1,0,2,17,0,0,0,0,128,57,48,17,9,17,44,199,1,0,58,1,0,0,145,17,1,0,139,17,0,0,119,0,72,0,1,2,255,255,58,3,0,0,119,0,69,0,145,17,0,0,135,5,236,0,17,0,0,0,145,5,5,0,2,17,0,0,0,0,152,63,48,17,9,17,216,199,1,0,2,17,0,0,0,0,48,63,48,17,9,17,168,199,1,0,1,2,0,0,59,19,2,0,145,19,19,0,65,18,5,19,145,18,18,0,59,19,255,255,145,19,19,0,63,17,18,19,145,17,17,0,59,18,2,0,145,18,18,0,63,19,5,18,145,19,19,0,66,3,17,19,145,3,3,0,119,0,41,0,1,2,1,0,59,17,255,255,145,17,17,0,63,19,5,17,145,19,19,0,59,18,1,0,145,18,18,0,63,17,5,18,145,17,17,0,66,3,19,17,145,3,3,0,119,0,29,0,2,17,0,0,0,0,28,64,48,17,9,17,48,200,1,0,1,2,2,0,61,19,0,0,0,0,192,191,145,19,19,0,63,17,5,19,145,17,17,0,61,20,0,0,0,0,192,63,145,20,20,0,65,18,5,20,145,18,18,0,59,20,1,0,145,20,20,0,63,19,18,20,145,19,19,0,66,3,17,19,145,3,3,0,119,0,7,0,1,2,3,0,59,19,255,255,145,19,19,0,66,3,19,5,145,3,3,0,119,0,1,0,65,7,3,3,145,7,7,0,65,8,7,7,145,8,8,0,62,21,0,0,48,15,216,159,132,149,175,63,145,21,21,0,65,18,8,21,145,18,18,0,62,21,0,0,96,42,231,159,161,62,194,63,145,21,21,0,63,20,18,21,145,20,20,0,65,17,8,20,145,17,17,0,62,20,0,0,159,176,92,32,85,85,213,63,145,20,20,0,63,19,17,20,145,19,19,0,65,10,7,19,145,10,10,0,62,20,0,0,154,171,96,0,83,153,201,191,145,20,20,0,62,21,0,0,153,156,0,225,72,66,187,63,145,21,21,0,65,17,8,21,145,17,17,0,64,19,20,17,145,19,19,0,65,11,8,19,145,11,11,0,34,19,2,0,121,19,10,0,63,17,11,10,145,17,17,0,65,19,3,17,145,19,19,0,64,1,3,19,145,1,1,0,145,19,1,0,139,19,0,0,119,0,26,0,1,19,80,28,41,17,2,2,100,12,19,17,145,12,12,0,63,19,11,10,145,19,19,0,65,13,3,19,145,13,13,0,1,21,96,28,41,18,2,2,100,20,21,18,145,20,20,0,64,17,13,20,145,17,17,0,64,19,17,3,145,19,19,0,64,14,12,19,145,14,14,0,68,15,14,0,145,15,15,0,32,19,6,0,126,1,19,14,15,0,0,0,145,19,1,0,139,19,0,0,59,19,0,0,145,19,19,0,139,19,0,0,140,1,19,0,0,0,0,0,136,15,0,0,0,14,15,0,136,15,0,0,25,15,15,32,137,15,0,0,130,15,0,0,136,16,0,0,49,15,15,16,188,201,1,0,1,16,32,0,135,15,0,0,16,0,0,0,25,13,14,8,0,12,14,0,25,1,14,24,25,2,14,20,25,5,14,16,25,8,14,12,1,15,0,0,85,1,15,0,1,16,0,0,109,1,4,16,1,17,32,0,1,18,4,0,134,15,0,0,252,144,2,0,17,18,0,0,109,1,4,15,1,15,0,0,85,2,15,0,1,15,32,0,82,16,2,0,56,15,15,16,56,202,1,0,106,15,1,4,82,16,2,0,41,16,16,2,1,18,255,255,97,15,16,18,82,18,2,0,25,18,18,1,85,2,18,0,119,0,244,255,1,18,230,36,85,5,18,0,1,18,201,38,85,8,18,0,1,18,52,117,82,15,5,0,2,17,0,0,49,139,0,0,134,16,0,0,108,234,1,0,15,17,0,0,85,18,16,0,1,16,56,117,82,17,8,0,2,15,0,0,48,139,0,0,134,18,0,0,108,234,1,0,17,15,0,0,85,16,18,0,1,16,52,117,82,16,16,0,1,15,56,117,82,15,15,0,134,18,0,0,32,194,1,0,16,15,0,0,85,1,18,0,82,3,1,0,1,18,0,0,82,15,1,0,48,18,18,15,124,203,1,0,85,12,3,0,1,15,3,0,1,16,130,40,134,18,0,0,252,32,2,0,15,16,12,0,82,18,1,0,1,16,178,40,135,4,254,0,18,16,0,0,106,16,1,4,85,16,4,0,82,16,1,0,1,18,193,40,135,6,254,0,16,18,0,0,106,18,1,4,109,18,4,6,82,18,1,0,1,16,208,40,135,7,254,0,18,16,0,0,106,16,1,4,109,16,20,7,82,16,1,0,1,18,220,40,135,9,255,0,16,18,0,0,106,18,1,4,109,18,24,9,82,18,1,0,1,16,224,40,135,10,255,0,18,16,0,0,106,16,1,4,109,16,44,10,82,16,1,0,1,18,235,40,135,11,255,0,16,18,0,0,106,18,1,4,109,18,56,11,116,0,1,0,106,16,1,4,109,0,4,16,137,14,0,0,139,0,0,0,119,0,12,0,85,13,3,0,1,18,4,0,1,15,244,40,134,16,0,0,252,32,2,0,18,15,13,0,116,0,1,0,106,15,1,4,109,0,4,15,137,14,0,0,139,0,0,0,139,0,0,0,140,0,15,0,0,0,0,0,136,8,0,0,0,7,8,0,136,8,0,0,25,8,8,32,137,8,0,0,130,8,0,0,136,9,0,0,49,8,8,9,228,203,1,0,1,9,32,0,135,8,0,0,9,0,0,0,25,0,7,20,25,1,7,8,25,2,7,16,25,3,7,12,0,6,7,0,134,8,0,0,112,155,2,0,1,8,181,120,78,8,8,0,38,8,8,1,121,8,92,0,1,8,16,118,1,9,16,118,82,9,9,0,25,9,9,1,85,8,9,0,1,9,16,118,82,9,9,0,30,9,9,10,120,9,24,0,1,8,148,117,82,8,8,0,1,10,152,117,82,10,10,0,134,9,0,0,36,238,1,0,8,10,0,0,85,1,9,0,82,10,1,0,1,8,148,117,82,8,8,0,1,11,152,117,82,11,11,0,1,12,10,0,1,13,8,0,1,14,0,0,134,9,0,0,228,239,1,0,10,8,11,12,13,14,0,0,82,14,1,0,135,9,5,0,14,0,0,0,1,9,16,118,82,9,9,0,28,9,9,15,30,9,9,2,32,9,9,1,121,9,52,0,1,9,152,117,82,9,9,0,26,4,9,20,1,9,230,255,83,2,9,0,1,14,41,0,107,2,1,14,1,9,55,0,107,2,2,9,1,14,255,255,107,2,3,14,78,14,2,0,83,0,14,0,102,9,2,1,107,0,1,9,102,14,2,2,107,0,2,14,102,9,2,3,107,0,3,9,1,14,30,0,59,13,10,0,145,13,13,0,134,9,0,0,160,41,2,0,14,4,13,0,1,9,152,117,82,9,9,0,26,5,9,25,1,9,190,255,83,3,9,0,1,13,33,0,107,3,1,13,1,9,55,0,107,3,2,9,1,13,255,255,107,3,3,13,78,13,3,0,83,0,13,0,102,9,3,1,107,0,1,9,102,13,3,2,107,0,2,13,102,9,3,3,107,0,3,9,1,13,87,47,1,14,50,0,1,12,10,0,134,9,0,0,92,222,1,0,13,14,5,12,0,0,0,0,134,9,0,0,112,155,2,0,134,9,0,0,12,161,2,0,134,9,0,0,16,184,1,0,1,9,240,114,134,12,0,0,120,162,2,0,87,9,12,0,1,12,0,115,1,9,240,114,86,9,9,0,1,14,224,114,86,14,14,0,64,9,9,14,87,12,9,0,1,9,224,114,1,12,240,114,86,12,12,0,87,9,12,0,1,12,232,114,1,9,248,114,86,9,9,0,1,14,0,115,86,14,14,0,63,9,9,14,87,12,9,0,1,9,232,114,86,9,9,0,59,12,0,0,71,9,9,12,120,9,3,0,137,7,0,0,139,0,0,0,59,13,0,0,1,11,232,114,86,11,11,0,64,14,13,11,145,14,14,0,59,11,232,3,145,11,11,0,65,12,14,11,145,12,12,0,134,9,0,0,60,112,2,0,12,0,0,0,1,9,240,114,134,12,0,0,120,162,2,0,87,9,12,0,1,12,240,114,86,12,12,0,1,9,224,114,86,9,9,0,64,12,12,9,87,6,12,0,1,12,224,114,1,9,240,114,86,9,9,0,87,12,9,0,1,9,232,114,1,12,232,114,86,12,12,0,86,11,6,0,63,12,12,11,87,9,12,0,137,7,0,0,139,0,0,0,140,3,30,0,0,0,0,0,136,26,0,0,0,25,26,0,136,26,0,0,25,26,26,32,137,26,0,0,130,26,0,0,136,27,0,0,49,26,26,27,192,206,1,0,1,27,32,0,135,26,0,0,27,0,0,0,25,10,25,12,25,15,25,8,25,19,25,4,0,24,25,0,1,26,0,0,85,10,26,0,1,27,0,0,109,10,4,27,1,26,0,0,109,10,8,26,88,26,1,0,145,26,26,0,89,15,26,0,112,26,1,4,145,26,26,0,89,19,26,0,112,26,1,8,145,26,26,0,89,24,26,0,88,3,2,0,145,3,3,0,88,26,15,0,145,26,26,0,65,4,3,26,145,4,4,0,112,5,2,4,145,5,5,0,88,27,19,0,145,27,27,0,65,26,5,27,145,26,26,0,63,6,4,26,145,6,6,0,112,7,2,8,145,7,7,0,88,27,24,0,145,27,27,0,65,26,7,27,145,26,26,0,63,8,6,26,145,8,8,0,112,27,2,12,145,27,27,0,63,26,8,27,145,26,26,0,89,10,26,0,112,9,2,16,145,9,9,0,88,26,15,0,145,26,26,0,65,11,9,26,145,11,11,0,112,12,2,20,145,12,12,0,88,27,19,0,145,27,27,0,65,26,12,27,145,26,26,0,63,13,11,26,145,13,13,0,112,14,2,24,145,14,14,0,88,27,24,0,145,27,27,0,65,26,14,27,145,26,26,0,63,16,13,26,145,16,16,0,112,28,2,28,145,28,28,0,63,27,16,28,145,27,27,0,113,10,4,27,112,17,2,32,145,17,17,0,88,27,15,0,145,27,27,0,65,18,17,27,145,18,18,0,112,20,2,36,145,20,20,0,88,26,19,0,145,26,26,0,65,27,20,26,145,27,27,0,63,21,18,27,145,21,21,0,112,22,2,40,145,22,22,0,88,26,24,0,145,26,26,0,65,27,22,26,145,27,27,0,63,23,21,27,145,23,23,0,112,28,2,44,145,28,28,0,63,26,23,28,145,26,26,0,113,10,8,26,116,0,10,0,106,27,10,4,109,0,4,27,106,26,10,8,109,0,8,26,137,25,0,0,139,0,0,0,140,7,34,0,0,0,0,0,136,31,0,0,0,30,31,0,136,31,0,0,25,31,31,48,137,31,0,0,130,31,0,0,136,32,0,0,49,31,31,32,164,208,1,0,1,32,48,0,135,31,0,0,32,0,0,0,25,27,30,44,25,28,30,40,25,29,30,36,25,7,30,32,25,8,30,28,25,9,30,24,25,10,30,20,25,11,30,16,25,12,30,12,25,13,30,8,25,14,30,4,0,15,30,0,85,27,0,0,89,28,1,0,89,29,2,0,89,7,3,0,85,8,4,0,85,9,5,0,85,10,6,0,82,32,27,0,76,32,32,0,145,32,32,0,61,33,0,0,0,0,0,63,145,33,33,0,63,31,32,33,145,31,31,0,89,11,31,0,88,16,11,0,145,16,16,0,88,33,28,0,145,33,33,0,64,31,16,33,145,31,31,0,89,12,31,0,88,17,11,0,145,17,17,0,88,33,28,0,145,33,33,0,63,31,17,33,145,31,31,0,89,13,31,0,88,18,12,0,145,18,18,0,88,31,29,0,145,31,31,0,65,19,18,31,145,19,19,0,88,33,7,0,145,33,33,0,64,31,19,33,145,31,31,0,89,14,31,0,88,20,13,0,145,20,20,0,88,31,29,0,145,31,31,0,65,21,20,31,145,21,21,0,88,33,7,0,145,33,33,0,64,31,21,33,145,31,31,0,89,15,31,0,88,22,11,0,145,22,22,0,88,31,29,0,145,31,31,0,65,23,22,31,145,23,23,0,88,31,7,0,145,31,31,0,64,24,23,31,145,24,24,0,82,31,10,0,89,31,24,0,88,33,14,0,145,33,33,0,61,32,0,0,0,0,0,63,63,33,33,32,135,31,0,1,33,0,0,0,75,25,31,0,82,31,8,0,85,31,25,0,88,33,15,0,145,33,33,0,61,32,0,0,0,0,0,63,64,33,33,32,135,31,0,1,33,0,0,0,75,26,31,0,82,31,9,0,85,31,26,0,137,30,0,0,139,0,0,0,140,7,34,0,0,0,0,0,136,31,0,0,0,30,31,0,136,31,0,0,25,31,31,48,137,31,0,0,130,31,0,0,136,32,0,0,49,31,31,32,100,210,1,0,1,32,48,0,135,31,0,0,32,0,0,0,25,27,30,44,25,28,30,40,25,29,30,36,25,7,30,32,25,8,30,28,25,9,30,24,25,10,30,20,25,11,30,16,25,12,30,12,25,13,30,8,25,14,30,4,0,15,30,0,85,27,0,0,89,28,1,0,89,29,2,0,89,7,3,0,85,8,4,0,85,9,5,0,85,10,6,0,82,32,27,0,76,32,32,0,145,32,32,0,61,33,0,0,0,0,0,63,145,33,33,0,63,31,32,33,145,31,31,0,89,11,31,0,88,16,11,0,145,16,16,0,88,33,28,0,145,33,33,0,64,31,16,33,145,31,31,0,89,12,31,0,88,17,11,0,145,17,17,0,88,33,28,0,145,33,33,0,63,31,17,33,145,31,31,0,89,13,31,0,88,18,12,0,145,18,18,0,88,31,7,0,145,31,31,0,63,19,18,31,145,19,19,0,88,33,29,0,145,33,33,0,66,31,19,33,145,31,31,0,89,14,31,0,88,20,13,0,145,20,20,0,88,31,7,0,145,31,31,0,63,21,20,31,145,21,21,0,88,33,29,0,145,33,33,0,66,31,21,33,145,31,31,0,89,15,31,0,88,22,11,0,145,22,22,0,88,31,7,0,145,31,31,0,63,23,22,31,145,23,23,0,88,31,29,0,145,31,31,0,66,24,23,31,145,24,24,0,82,31,10,0,89,31,24,0,88,33,14,0,145,33,33,0,61,32,0,0,0,0,0,63,63,33,33,32,135,31,0,1,33,0,0,0,75,25,31,0,82,31,8,0,85,31,25,0,88,33,15,0,145,33,33,0,61,32,0,0,0,0,0,63,64,33,33,32,135,31,0,1,33,0,0,0,75,26,31,0,82,31,9,0,85,31,26,0,137,30,0,0,139,0,0,0,140,3,18,0,0,0,0,0,136,15,0,0,0,14,15,0,136,15,0,0,25,15,15,32,137,15,0,0,130,15,0,0,136,16,0,0,49,15,15,16,36,212,1,0,1,16,32,0,135,15,0,0,16,0,0,0,25,7,14,8,25,8,14,4,0,9,14,0,25,10,14,19,25,11,14,18,25,12,14,17,25,13,14,16,25,3,14,15,25,4,14,14,25,5,14,13,25,6,14,12,85,7,0,0,85,8,1,0,85,9,2,0,82,15,7,0,82,16,8,0,41,16,16,2,90,15,15,16,83,10,15,0,82,15,7,0,82,16,8,0,41,16,16,2,25,16,16,1,90,15,15,16,83,11,15,0,82,15,7,0,82,16,8,0,41,16,16,2,25,16,16,2,90,15,15,16,83,12,15,0,82,15,7,0,82,16,8,0,41,16,16,2,25,16,16,3,90,15,15,16,83,13,15,0,82,15,7,0,82,16,9,0,41,16,16,2,90,15,15,16,83,3,15,0,82,15,7,0,82,16,9,0,41,16,16,2,25,16,16,1,90,15,15,16,83,4,15,0,82,15,7,0,82,16,9,0,41,16,16,2,25,16,16,2,90,15,15,16,83,5,15,0,82,15,7,0,82,16,8,0,41,16,16,2,25,16,16,3,90,15,15,16,83,6,15,0,82,15,7,0,82,16,8,0,41,16,16,2,78,17,3,0,95,15,16,17,82,17,7,0,82,16,8,0,41,16,16,2,25,16,16,1,78,15,4,0,95,17,16,15,82,15,7,0,82,16,8,0,41,16,16,2,25,16,16,2,78,17,5,0,95,15,16,17,82,17,7,0,82,16,8,0,41,16,16,2,25,16,16,3,78,15,6,0,95,17,16,15,82,15,7,0,82,16,9,0,41,16,16,2,78,17,10,0,95,15,16,17,82,17,7,0,82,16,9,0,41,16,16,2,25,16,16,1,78,15,11,0,95,17,16,15,82,15,7,0,82,16,9,0,41,16,16,2,25,16,16,2,78,17,12,0,95,15,16,17,82,17,7,0,82,16,9,0,41,16,16,2,25,16,16,3,78,15,13,0,95,17,16,15,137,14,0,0,139,0,0,0,140,7,31,0,0,0,0,0,136,21,0,0,0,20,21,0,136,21,0,0,25,21,21,64,137,21,0,0,130,21,0,0,136,22,0,0,49,21,21,22,12,214,1,0,1,22,64,0,135,21,0,0,22,0,0,0,25,17,20,44,25,18,20,40,25,19,20,36,25,7,20,32,25,8,20,28,25,9,20,48,25,10,20,24,25,11,20,20,25,12,20,16,25,13,20,12,25,14,20,8,25,15,20,4,0,16,20,0,85,17,0,0,85,18,1,0,85,19,2,0,85,7,3,0,85,8,4,0,38,21,5,1,83,9,21,0,85,10,6,0,82,21,10,0,116,21,8,0,82,22,19,0,82,23,7,0,5,21,22,23,41,21,21,2,85,11,21,0,82,23,11,0,135,21,6,0,23,0,0,0,85,12,21,0,82,23,12,0,82,22,18,0,82,24,11,0,135,21,32,0,23,22,24,0,82,24,19,0,82,22,7,0,5,21,24,22,85,13,21,0,82,21,17,0,121,21,8,0,82,22,17,0,82,24,12,0,82,23,13,0,134,21,0,0,44,247,1,0,22,24,23,0,85,13,21,0,1,21,1,0,82,23,8,0,22,21,21,23,85,14,21,0,82,21,14,0,28,21,21,2,85,15,21,0,82,21,15,0,28,21,21,2,85,16,21,0,82,23,12,0,82,24,13,0,1,22,1,0,82,25,14,0,82,26,15,0,82,27,16,0,1,28,1,0,78,29,9,0,38,29,29,1,82,30,10,0,134,21,0,0,100,110,0,0,23,24,22,25,26,27,28,29,30,0,0,0,82,30,12,0,135,21,5,0,30,0,0,0,82,21,10,0,1,30,3,4,3,21,21,30,1,30,1,0,82,29,8,0,26,29,29,1,22,30,30,29,1,29,0,0,95,21,30,29,82,29,10,0,1,30,4,3,3,29,29,30,1,30,1,0,82,21,8,0,26,21,21,1,22,30,30,21,1,21,0,0,95,29,30,21,82,21,10,0,1,30,4,2,1,29,0,0,95,21,30,29,82,29,10,0,1,30,4,1,1,21,0,0,95,29,30,21,82,21,10,0,1,30,0,0,107,21,4,30,137,20,0,0,139,0,0,0,140,3,19,0,0,0,0,0,136,13,0,0,0,12,13,0,136,13,0,0,25,13,13,32,137,13,0,0,130,13,0,0,136,14,0,0,49,13,13,14,248,215,1,0,1,14,32,0,135,13,0,0,14,0,0,0,25,5,12,20,25,6,12,16,25,8,12,12,25,9,12,8,25,10,12,4,0,11,12,0,85,6,0,0,85,8,1,0,85,9,2,0,82,13,6,0,1,14,1,0,1,18,4,0,138,13,14,18,88,216,1,0,152,216,1,0,40,217,1,0,128,217,1,0,1,15,207,53,1,16,90,48,1,17,226,3,1,18,234,53,135,14,8,0,15,16,17,18,119,0,78,0,82,14,8,0,34,14,14,0,121,14,4,0,1,14,0,0,85,5,14,0,119,0,72,0,82,14,9,0,82,15,8,0,49,14,14,15,144,216,1,0,82,14,9,0,26,14,14,1,85,5,14,0,119,0,64,0,116,5,8,0,119,0,62,0,82,3,8,0,82,4,9,0,82,14,8,0,34,14,14,0,121,14,12,0,47,14,3,4,200,216,1,0,1,14,0,0,82,15,8,0,4,14,14,15,85,5,14,0,119,0,50,0,82,14,9,0,26,14,14,1,85,5,14,0,119,0,46,0,47,14,3,4,232,216,1,0,116,5,8,0,119,0,42,0,82,14,9,0,41,14,14,1,85,10,14,0,82,14,10,0,82,15,8,0,49,14,14,15,16,217,1,0,1,14,0,0,85,5,14,0,119,0,32,0,82,14,10,0,82,15,8,0,4,14,14,15,26,14,14,1,85,5,14,0,119,0,26,0,82,7,8,0,1,14,0,0,82,15,8,0,49,14,14,15,76,217,1,0,82,14,9,0,8,14,7,14,85,5,14,0,119,0,17,0,1,14,0,0,4,14,14,7,82,15,9,0,8,14,14,15,85,11,14,0,82,14,11,0,121,14,5,0,82,14,9,0,82,15,11,0,4,14,14,15,85,11,14,0,116,5,11,0,119,0,4,0,1,14,0,0,85,5,14,0,119,0,1,0,137,12,0,0,82,13,5,0,139,13,0,0,140,2,31,0,0,0,0,0,2,27,0,0,128,128,128,128,2,28,0,0,255,254,254,254,1,26,0,0,0,18,1,0,21,29,18,0,38,29,29,3,120,29,59,0,38,29,18,3,120,29,4,0,0,5,1,0,0,7,0,0,119,0,20,0,0,6,1,0,0,8,0,0,78,25,6,0,83,8,25,0,41,29,25,24,42,29,29,24,120,29,3,0,0,9,8,0,119,0,48,0,25,15,6,1,25,16,8,1,38,29,15,3,120,29,4,0,0,5,15,0,0,7,16,0,119,0,4,0,0,6,15,0,0,8,16,0,119,0,240,255,82,17,5,0,19,29,17,27,21,29,29,27,2,30,0,0,1,1,1,1,4,30,17,30,19,29,29,30,120,29,21,0,0,4,7,0,0,10,5,0,0,21,17,0,25,19,10,4,25,20,4,4,85,4,21,0,82,21,19,0,19,29,21,27,21,29,29,27,2,30,0,0,1,1,1,1,4,30,21,30,19,29,29,30,121,29,4,0,0,2,19,0,0,3,20,0,119,0,6,0,0,4,20,0,0,10,19,0,119,0,240,255,0,2,5,0,0,3,7,0,0,11,2,0,0,12,3,0,1,26,10,0,119,0,4,0,0,11,1,0,0,12,0,0,1,26,10,0,32,29,26,10,121,29,21,0,78,22,11,0,83,12,22,0,41,29,22,24,42,29,29,24,120,29,3,0,0,9,12,0,119,0,14,0,0,13,12,0,0,14,11,0,25,14,14,1,25,23,13,1,78,24,14,0,83,23,24,0,41,29,24,24,42,29,29,24,120,29,3,0,0,9,23,0,119,0,3,0,0,13,23,0,119,0,246,255,139,9,0,0,140,6,20,0,0,0,0,0,2,14,0,0,99,29,0,0,136,15,0,0,0,13,15,0,136,15,0,0,25,15,15,32,137,15,0,0,130,15,0,0,136,16,0,0,49,15,15,16,84,219,1,0,1,16,32,0,135,15,0,0,16,0,0,0,25,9,13,21,25,10,13,16,25,11,13,12,25,12,13,8,25,7,13,4,85,10,0,0,85,11,1,0,85,12,2,0,85,7,3,0,85,13,4,0,38,16,5,1,107,13,20,16,1,16,140,117,82,17,10,0,1,18,192,47,134,15,0,0,104,106,2,0,17,18,0,0,85,16,15,0,1,15,140,117,82,15,15,0,120,15,8,0,1,15,0,0,83,9,15,0,78,6,9,0,38,15,6,1,0,8,15,0,137,13,0,0,139,8,0,0,1,15,8,115,82,17,11,0,82,19,12,0,5,18,17,19,41,18,18,2,135,16,6,0,18,0,0,0,85,15,16,0,1,15,245,43,1,18,140,117,82,18,18,0,134,16,0,0,172,155,2,0,15,18,0,0,82,18,11,0,1,15,255,0,19,18,18,15,1,15,140,117,82,15,15,0,134,16,0,0,100,42,2,0,18,15,0,0,82,15,11,0,43,15,15,8,1,18,255,0,19,15,15,18,1,18,140,117,82,18,18,0,134,16,0,0,100,42,2,0,15,18,0,0,82,18,12,0,1,15,255,0,19,18,18,15,1,15,140,117,82,15,15,0,134,16,0,0,100,42,2,0,18,15,0,0,82,15,12,0,43,15,15,8,1,18,255,0,19,15,15,18,1,18,140,117,82,18,18,0,134,16,0,0,100,42,2,0,15,18,0,0,1,18,240,0,1,15,140,117,82,15,15,0,134,16,0,0,100,42,2,0,18,15,0,0,1,15,0,0,1,18,140,117,82,18,18,0,134,16,0,0,100,42,2,0,15,18,0,0,1,18,0,0,1,15,140,117,82,15,15,0,134,16,0,0,100,42,2,0,18,15,0,0,1,15,0,0,1,18,140,117,82,18,18,0,134,16,0,0,100,42,2,0,15,18,0,0,1,18,0,0,1,15,140,117,82,15,15,0,134,16,0,0,100,42,2,0,18,15,0,0,1,15,0,0,1,18,140,117,82,18,18,0,134,16,0,0,100,42,2,0,15,18,0,0,1,18,0,0,1,15,140,117,82,15,15,0,134,16,0,0,100,42,2,0,18,15,0,0,1,15,0,0,1,18,140,117,82,18,18,0,134,16,0,0,100,42,2,0,15,18,0,0,1,18,0,0,1,15,140,117,82,15,15,0,134,16,0,0,100,42,2,0,18,15,0,0,82,16,7,0,121,16,55,0,1,15,33,0,1,18,140,117,82,18,18,0,134,16,0,0,100,42,2,0,15,18,0,0,1,18,255,0,1,15,140,117,82,15,15,0,134,16,0,0,100,42,2,0,18,15,0,0,1,15,11,0,1,18,140,117,82,18,18,0,134,16,0,0,100,42,2,0,15,18,0,0,1,18,252,43,1,15,140,117,82,15,15,0,134,16,0,0,172,155,2,0,18,15,0,0,1,15,3,0,1,18,140,117,82,18,18,0,134,16,0,0,100,42,2,0,15,18,0,0,1,18,1,0,1,15,140,117,82,15,15,0,134,16,0,0,100,42,2,0,18,15,0,0,1,15,0,0,1,18,140,117,82,18,18,0,134,16,0,0,100,42,2,0,15,18,0,0,1,18,0,0,1,15,140,117,82,15,15,0,134,16,0,0,100,42,2,0,18,15,0,0,1,15,0,0,1,18,140,117,82,18,18,0,134,16,0,0,100,42,2,0,15,18,0,0,1,16,1,0,83,9,16,0,78,6,9,0,38,16,6,1,0,8,16,0,137,13,0,0,139,8,0,0,140,5,26,0,0,0,0,0,136,24,0,0,0,21,24,0,136,24,0,0,1,25,160,0,3,24,24,25,137,24,0,0,130,24,0,0,136,25,0,0,49,24,24,25,152,222,1,0,1,25,160,0,135,24,0,0,25,0,0,0,1,24,152,0,3,7,21,24,1,24,144,0,3,6,21,24,25,5,21,108,25,15,21,104,25,16,21,100,25,17,21,96,25,18,21,92,25,19,21,56,25,8,21,48,25,9,21,40,25,10,21,36,0,11,21,0,85,15,0,0,85,16,1,0,85,17,2,0,85,18,3,0,134,24,0,0,20,151,2,0,19,0,0,0,106,24,19,8,120,24,3,0,137,21,0,0,139,0,0,0,82,24,16,0,76,24,24,0,145,24,24,0,89,8,24,0,82,25,17,0,76,25,25,0,145,25,25,0,113,8,4,25,1,25,10,0,85,9,25,0,82,25,18,0,82,24,9,0,47,25,25,24,56,223,1,0,116,18,9,0,82,25,18,0,82,24,9,0,6,25,25,24,85,10,25,0,134,25,0,0,20,151,2,0,11,0,0,0,82,12,15,0,82,13,18,0,76,25,13,0,145,13,25,0,82,14,10,0,76,25,14,0,145,14,25,0,0,20,5,0,0,22,11,0,25,23,20,36,116,20,22,0,25,20,20,4,25,22,22,4,54,25,20,23,124,223,1,0,116,6,8,0,106,24,8,4,109,6,4,24,78,24,4,0,83,7,24,0,102,25,4,1,107,7,1,25,102,24,4,2,107,7,2,24,102,25,4,3,107,7,3,25,134,25,0,0,116,56,1,0,5,12,6,13,14,7,0,0,137,21,0,0,139,0,0,0,140,2,13,0,0,0,0,0,136,9,0,0,0,8,9,0,136,9,0,0,25,9,9,48,137,9,0,0,130,9,0,0,136,10,0,0,49,9,9,10,12,224,1,0], eb + 112640);
  HEAPU8.set([1,10,48,0,135,9,0,0,10,0,0,0,25,3,8,16,25,4,8,12,25,5,8,8,25,6,8,4,0,7,8,0,1,9,0,0,85,3,9,0,1,10,0,0,109,3,4,10,1,9,0,0,109,3,8,9,1,10,0,0,109,3,12,10,1,9,0,0,109,3,16,9,25,9,1,4,116,4,9,0,25,9,1,8,116,5,9,0,1,9,0,0,85,6,9,0,1,9,0,0,85,7,9,0,106,9,1,12,82,10,7,0,56,9,9,10,236,224,1,0,82,9,4,0,82,10,5,0,106,11,1,16,134,2,0,0,160,15,2,0,9,10,11,0,82,11,6,0,3,11,11,2,85,6,11,0,82,11,4,0,28,11,11,2,85,4,11,0,82,11,5,0,28,11,11,2,85,5,11,0,82,11,4,0,34,11,11,1,121,11,3,0,1,11,1,0,85,4,11,0,82,11,5,0,34,11,11,1,121,11,3,0,1,11,1,0,85,5,11,0,82,11,7,0,25,11,11,1,85,7,11,0,119,0,224,255,82,10,6,0,135,11,6,0,10,0,0,0,85,3,11,0,82,11,3,0,120,11,12,0,116,0,3,0,106,10,3,4,109,0,4,10,106,11,3,8,109,0,8,11,106,10,3,12,109,0,12,10,106,11,3,16,109,0,16,11,137,8,0,0,139,0,0,0,82,10,3,0,82,9,1,0,82,12,6,0,135,11,32,0,10,9,12,0,106,12,1,4,109,3,4,12,106,11,1,8,109,3,8,11,106,12,1,12,109,3,12,12,106,11,1,16,109,3,16,11,116,0,3,0,106,12,3,4,109,0,4,12,106,11,3,8,109,0,8,11,106,12,3,12,109,0,12,12,106,11,3,16,109,0,16,11,137,8,0,0,139,0,0,0,140,4,15,0,0,0,0,0,136,11,0,0,0,10,11,0,136,11,0,0,25,11,11,48,137,11,0,0,130,11,0,0,136,12,0,0,49,11,11,12,200,225,1,0,1,12,48,0,135,11,0,0,12,0,0,0,25,4,10,36,25,5,10,32,25,6,10,28,25,7,10,8,25,8,10,4,0,9,10,0,85,4,1,0,85,5,2,0,85,6,3,0,1,11,0,0,85,7,11,0,1,12,0,0,109,7,4,12,1,11,0,0,109,7,8,11,1,12,0,0,109,7,12,12,1,11,0,0,109,7,16,11,1,11,0,0,85,7,11,0,82,12,5,0,109,7,4,12,82,11,6,0,109,7,8,11,1,12,1,0,109,7,12,12,1,11,7,0,109,7,16,11,1,11,0,0,85,8,11,0,106,13,7,4,106,14,7,8,5,12,13,14,41,12,12,2,135,11,6,0,12,0,0,0,85,7,11,0,1,11,0,0,85,9,11,0,106,12,7,4,106,14,7,8,5,11,12,14,41,11,11,2,82,14,9,0,56,11,11,14,40,227,1,0,82,11,7,0,82,14,9,0,82,12,4,0,82,13,8,0,41,13,13,2,90,12,12,13,95,11,14,12,82,12,7,0,82,14,9,0,25,14,14,1,82,11,4,0,82,13,8,0,41,13,13,2,3,11,11,13,102,11,11,1,95,12,14,11,82,11,7,0,82,14,9,0,25,14,14,2,82,12,4,0,82,13,8,0,41,13,13,2,3,12,12,13,102,12,12,2,95,11,14,12,82,12,7,0,82,14,9,0,25,14,14,3,82,11,4,0,82,13,8,0,41,13,13,2,3,11,11,13,102,11,11,3,95,12,14,11,82,11,8,0,25,11,11,1,85,8,11,0,82,11,9,0,25,11,11,4,85,9,11,0,119,0,209,255,116,0,7,0,106,14,7,4,109,0,4,14,106,11,7,8,109,0,8,11,106,14,7,12,109,0,12,14,106,11,7,16,109,0,16,11,137,10,0,0,139,0,0,0,140,2,19,0,0,0,0,0,136,15,0,0,0,14,15,0,136,15,0,0,25,15,15,48,137,15,0,0,130,15,0,0,136,16,0,0,49,15,15,16,140,227,1,0,1,16,48,0,135,15,0,0,16,0,0,0,25,13,14,24,25,12,14,8,0,11,14,0,25,6,14,40,1,16,202,61,78,17,1,0,134,15,0,0,212,154,2,0,16,17,0,0,120,15,7,0,134,15,0,0,136,162,2,0,1,17,28,0,85,15,17,0,1,2,0,0,119,0,94,0,1,17,152,4,135,10,6,0,17,0,0,0,120,10,3,0,1,2,0,0,119,0,88,0,1,15,0,0,1,16,144,0,135,17,3,0,10,15,16,0,1,16,43,0,134,17,0,0,212,154,2,0,1,16,0,0,32,3,17,0,78,4,1,0,121,3,9,0,41,16,4,24,42,16,16,24,32,16,16,114,1,15,8,0,1,18,4,0,125,17,16,15,18,0,0,0,85,10,17,0,41,17,4,24,42,17,17,24,32,17,17,97,121,17,26,0,85,11,0,0,1,18,3,0,109,11,4,18,1,18,221,0,135,5,1,1,18,11,0,0,1,18,0,4,19,18,5,18,120,18,10,0,85,12,0,0,1,17,4,0,109,12,4,17,1,18,0,4,20,18,5,18,109,12,8,18,1,17,221,0,135,18,1,1,17,12,0,0,82,18,10,0,1,17,128,0,20,18,18,17,0,7,18,0,85,10,7,0,0,9,7,0,119,0,2,0,82,9,10,0,109,10,60,0,1,17,152,0,3,17,10,17,109,10,44,17,1,18,0,4,109,10,48,18,25,8,10,75,1,18,255,255,83,8,18,0,38,18,9,8,120,18,11,0,85,13,0,0,1,17,19,84,109,13,4,17,109,13,8,6,1,18,54,0,135,17,2,1,18,13,0,0,120,17,3,0,1,17,10,0,83,8,17,0,1,18,8,0,109,10,32,18,1,17,1,0,109,10,36,17,1,18,2,0,109,10,40,18,1,17,2,0,109,10,12,17,1,17,100,118,82,17,17,0,120,17,3,0,1,18,255,255,109,10,76,18,134,18,0,0,104,151,2,0,10,0,0,0,0,2,10,0,137,14,0,0,139,2,0,0,140,3,27,0,0,0,0,0,1,22,0,0,136,24,0,0,0,23,24,0,136,24,0,0,25,24,24,32,137,24,0,0,130,24,0,0,136,25,0,0,49,24,24,25,132,229,1,0,1,25,32,0,135,24,0,0,25,0,0,0,0,14,23,0,25,17,23,16,25,19,0,28,82,20,19,0,85,14,20,0,25,21,0,20,82,24,21,0,4,9,24,20,109,14,4,9,109,14,8,1,109,14,12,2,25,10,0,60,1,4,2,0,3,5,9,2,0,6,14,0,82,26,10,0,135,25,3,1,26,6,4,17,134,24,0,0,132,153,2,0,25,0,0,0,120,24,3,0,82,11,17,0,119,0,4,0,1,24,255,255,85,17,24,0,1,11,255,255,45,24,5,11,0,230,1,0,1,22,6,0,119,0,30,0,34,24,11,0,121,24,3,0,1,22,8,0,119,0,26,0,106,15,6,4,16,16,15,11,121,16,4,0,25,25,6,8,0,24,25,0,119,0,2,0,0,24,6,0,0,7,24,0,1,25,0,0,125,24,16,15,25,0,0,0,4,3,11,24,82,24,7,0,3,24,24,3,85,7,24,0,25,18,7,4,82,24,18,0,4,24,24,3,85,18,24,0,41,24,16,31,42,24,24,31,3,4,4,24,4,5,5,11,0,6,7,0,119,0,212,255,32,24,22,6,121,24,10,0,106,12,0,44,106,25,0,48,3,25,12,25,109,0,16,25,0,13,12,0,85,19,13,0,85,21,13,0,0,8,2,0,119,0,18,0,32,25,22,8,121,25,16,0,1,24,0,0,109,0,16,24,1,24,0,0,85,19,24,0,1,24,0,0,85,21,24,0,82,24,0,0,39,24,24,32,85,0,24,0,32,24,4,2,121,24,3,0,1,8,0,0,119,0,3,0,106,24,6,4,4,8,2,24,137,23,0,0,139,8,0,0,140,5,30,0,0,0,0,0,136,26,0,0,0,24,26,0,136,26,0,0,1,27,224,0,3,26,26,27,137,26,0,0,130,26,0,0,136,27,0,0,49,26,26,27,40,231,1,0,1,27,224,0,135,26,0,0,27,0,0,0,1,26,208,0,3,18,24,26,1,26,160,0,3,19,24,26,25,20,24,80,0,21,24,0,0,23,19,0,25,25,23,40,1,26,0,0,85,23,26,0,25,23,23,4,54,26,23,25,72,231,1,0,116,18,2,0,1,27,0,0,134,26,0,0,144,17,0,0,27,1,18,20,19,3,4,0,34,26,26,0,121,26,3,0,1,5,255,255,119,0,78,0,1,26,255,255,106,27,0,76,47,26,26,27,164,231,1,0,134,17,0,0,80,162,2,0,0,0,0,0,119,0,2,0,1,17,0,0,82,7,0,0,38,26,7,32,0,8,26,0,102,26,0,74,34,26,26,1,121,26,3,0,38,26,7,223,85,0,26,0,25,9,0,48,82,26,9,0,120,26,42,0,25,10,0,44,82,11,10,0,85,10,21,0,25,12,0,28,85,12,21,0,25,13,0,20,85,13,21,0,1,26,80,0,85,9,26,0,25,14,0,16,25,26,21,80,85,14,26,0,134,15,0,0,144,17,0,0,0,1,18,20,19,3,4,0,120,11,3,0,0,6,15,0,119,0,27,0,106,27,0,36,38,27,27,15,1,28,0,0,1,29,0,0,135,26,4,1,27,0,28,29,82,26,13,0,32,26,26,0,1,27,255,255,125,22,26,27,15,0,0,0,85,10,11,0,1,27,0,0,85,9,27,0,1,27,0,0,85,14,27,0,1,27,0,0,85,12,27,0,1,27,0,0,85,13,27,0,0,6,22,0,119,0,5,0,134,6,0,0,144,17,0,0,0,1,18,20,19,3,4,0,82,16,0,0,20,27,16,8,85,0,27,0,121,17,4,0,134,27,0,0,68,162,2,0,0,0,0,0,38,27,16,32,32,27,27,0,1,26,255,255,125,5,27,6,26,0,0,0,137,24,0,0,139,5,0,0,140,5,21,0,0,0,0,0,136,17,0,0,0,16,17,0,136,17,0,0,25,17,17,48,137,17,0,0,130,17,0,0,136,18,0,0,49,17,17,18,248,232,1,0,1,18,48,0,135,17,0,0,18,0,0,0,25,11,16,32,25,12,16,28,25,13,16,24,25,14,16,20,25,15,16,16,25,5,16,12,25,6,16,8,25,7,16,36,25,8,16,4,0,9,16,0,85,11,0,0,85,12,1,0,85,13,2,0,85,14,3,0,85,15,4,0,82,17,11,0,82,18,15,0,41,18,18,2,82,19,14,0,3,18,18,19,91,17,17,18,85,5,17,0,82,18,11,0,82,19,15,0,82,20,13,0,26,20,20,1,134,17,0,0,236,211,1,0,18,19,20,0,116,6,12,0,1,17,0,0,83,7,17,0,116,8,12,0,82,10,11,0,82,17,13,0,26,17,17,1,82,20,8,0,56,17,17,20,72,234,1,0,82,17,8,0,41,17,17,2,82,20,14,0,3,17,17,20,91,17,10,17,85,9,17,0,82,17,9,0,82,20,5,0,47,17,17,20,228,233,1,0,82,20,11,0,82,19,8,0,82,18,6,0,134,17,0,0,236,211,1,0,20,19,18,0,82,17,6,0,25,17,17,1,85,6,17,0,119,0,22,0,82,17,9,0,82,18,5,0,45,17,17,18,56,234,1,0,78,17,7,0,38,17,17,1,121,17,10,0,82,18,11,0,82,19,8,0,82,20,6,0,134,17,0,0,236,211,1,0,18,19,20,0,82,17,6,0,25,17,17,1,85,6,17,0,78,17,7,0,38,17,17,1,40,17,17,1,38,17,17,1,83,7,17,0,82,17,8,0,25,17,17,1,85,8,17,0,119,0,206,255,82,20,6,0,82,19,13,0,26,19,19,1,134,17,0,0,236,211,1,0,10,20,19,0,137,16,0,0,82,17,6,0,139,17,0,0,140,2,22,0,0,0,0,0,136,18,0,0,0,17,18,0,136,18,0,0,25,18,18,48,137,18,0,0,130,18,0,0,136,19,0,0,49,18,18,19,164,234,1,0,1,19,48,0,135,18,0,0,19,0,0,0,25,16,17,16,25,15,17,8,0,14,17,0,25,5,17,44,25,8,17,40,25,9,17,36,25,10,17,32,25,11,17,28,25,12,17,24,25,13,17,20,85,5,0,0,85,8,1,0,82,19,8,0,135,18,5,1,19,0,0,0,85,9,18,0,82,19,9,0,1,20,1,0,1,21,0,0,135,18,6,1,19,20,5,21,1,18,0,0,85,10,18,0,82,21,9,0,135,18,7,1,21,0,0,0,82,21,9,0,2,20,0,0,129,139,0,0,135,18,8,1,21,20,10,0,82,3,9,0,82,18,10,0,33,18,18,1,121,18,52,0,85,14,3,0,1,20,4,0,1,21,176,41,134,18,0,0,252,32,2,0,20,21,14,0,1,18,0,0,85,11,18,0,82,21,9,0,2,20,0,0,132,139,0,0,135,18,8,1,21,20,11,0,82,4,11,0,135,18,250,0,85,13,18,0,0,2,4,0,136,18,0,0,0,6,18,0,136,18,0,0,27,20,2,1,25,20,20,15,38,20,20,240,3,18,18,20,137,18,0,0,130,18,0,0,136,20,0,0,49,18,18,20,184,235,1,0,27,20,2,1,25,20,20,15,38,20,20,240,135,18,0,0,20,0,0,0,82,20,9,0,82,21,11,0,135,18,9,1,20,21,12,6,85,15,6,0,1,21,3,0,1,20,125,41,134,18,0,0,252,32,2,0,21,20,15,0,82,20,13,0,135,18,253,0,20,0,0,0,82,7,9,0,137,17,0,0,139,7,0,0,119,0,10,0,85,16,3,0,1,20,3,0,1,21,217,41,134,18,0,0,252,32,2,0,20,21,16,0,82,7,9,0,137,17,0,0,139,7,0,0,1,18,0,0,139,18,0,0,140,1,12,0,0,0,0,0,136,8,0,0,0,7,8,0,136,8,0,0,25,8,8,112,137,8,0,0,130,8,0,0,136,9,0,0,49,8,8,9,96,236,1,0,1,9,112,0,135,8,0,0,9,0,0,0,25,1,7,72,25,3,7,56,25,4,7,16,0,5,7,0,1,8,36,118,82,8,8,0,121,8,18,0,1,8,36,118,82,8,8,0,85,0,8,0,1,9,40,118,82,9,9,0,109,0,4,9,1,8,44,118,82,8,8,0,109,0,8,8,1,9,48,118,82,9,9,0,109,0,12,9,1,8,52,118,82,8,8,0,109,0,16,8,137,7,0,0,139,0,0,0,134,8,0,0,20,151,2,0,1,0,0,0,25,6,1,8,1,8,36,118,82,9,6,0,85,8,9,0,1,9,40,118,106,8,6,4,85,9,8,0,1,8,44,118,106,9,6,8,85,8,9,0,1,9,48,118,106,8,6,12,85,9,8,0,1,8,52,118,106,9,6,16,85,8,9,0,134,9,0,0,20,151,2,0,4,0,0,0,106,9,4,28,1,8,240,5,3,2,9,8,116,3,2,0,106,9,2,4,109,3,4,9,106,8,2,8,109,3,8,8,106,9,2,12,109,3,12,9,88,8,3,0,145,8,8,0,59,10,1,0,145,10,10,0,63,9,8,10,145,9,9,0,89,5,9,0,112,8,3,4,145,8,8,0,59,11,1,0,145,11,11,0,63,10,8,11,145,10,10,0,113,5,4,10,112,11,3,8,145,11,11,0,59,8,2,0,145,8,8,0,64,9,11,8,145,9,9,0,113,5,8,9,112,8,3,12,145,8,8,0,59,11,2,0,145,11,11,0,64,10,8,11,145,10,10,0,113,5,12,10,1,10,20,118,82,9,5,0,85,10,9,0,1,9,24,118,106,10,5,4,85,9,10,0,1,10,28,118,106,9,5,8,85,10,9,0,1,9,32,118,106,10,5,12,85,9,10,0,1,10,36,118,82,10,10,0,85,0,10,0,1,9,40,118,82,9,9,0,109,0,4,9,1,10,44,118,82,10,10,0,109,0,8,10,1,9,48,118,82,9,9,0,109,0,12,9,1,10,52,118,82,10,10,0,109,0,16,10,137,7,0,0,139,0,0,0,140,2,21,0,0,0,0,0,136,13,0,0,0,11,13,0,136,13,0,0,25,13,13,32,137,13,0,0,130,13,0,0,136,14,0,0,49,13,13,14,92,238,1,0,1,14,32,0,135,13,0,0,14,0,0,0,25,2,11,20,25,3,11,16,25,5,11,12,25,7,11,8,25,8,11,4,0,10,11,0,85,2,0,0,85,3,1,0,82,15,2,0,82,16,3,0,5,14,15,16,41,14,14,2,1,16,1,0,134,13,0,0,252,144,2,0,14,16,0,0,85,5,13,0,1,16,0,0,1,14,0,0,82,15,2,0,82,17,3,0,1,18,8,25,1,19,1,20,82,20,5,0,135,13,10,1,16,14,15,17,18,19,20,0,82,19,2,0,82,18,3,0,5,20,19,18,41,20,20,2,135,13,6,0,20,0,0,0,85,7,13,0,82,13,3,0,26,13,13,1,85,8,13,0,82,13,8,0,34,13,13,0,120,13,53,0,1,13,0,0,85,10,13,0,82,13,2,0,41,13,13,2,82,20,10,0,56,13,13,20,188,239,1,0,82,20,8,0,82,18,2,0,5,13,20,18,41,13,13,2,0,4,13,0,82,18,3,0,26,18,18,1,82,20,8,0,4,18,18,20,82,20,2,0,5,13,18,20,41,13,13,2,0,6,13,0,82,12,10,0,82,13,7,0,3,20,6,12,82,18,5,0,3,19,4,12,90,18,18,19,95,13,20,18,82,18,10,0,25,18,18,1,30,18,18,4,120,18,14,0,82,20,3,0,26,20,20,1,82,13,8,0,4,20,20,13,82,13,2,0,5,18,20,13,41,18,18,2,0,9,18,0,82,18,7,0,82,13,10,0,3,13,9,13,1,20,255,255,95,18,13,20,82,20,10,0,25,20,20,1,85,10,20,0,119,0,211,255,82,20,8,0,26,20,20,1,85,8,20,0,119,0,202,255,82,13,5,0,135,20,5,0,13,0,0,0,137,11,0,0,82,20,7,0,139,20,0,0,140,6,32,0,0,0,0,0,136,24,0,0,0,22,24,0,136,24,0,0,1,25,32,5,3,24,24,25,137,24,0,0,130,24,0,0,136,25,0,0,49,24,24,25,32,240,1,0,1,25,32,5,135,24,0,0,25,0,0,0,1,24,29,5,3,18,22,24,1,24,24,5,3,19,22,24,1,24,20,5,3,20,22,24,1,24,16,5,3,21,22,24,1,24,12,5,3,7,22,24,1,24,8,5,3,8,22,24,1,24,28,5,3,9,22,24,1,24,4,5,3,10,22,24,0,11,22,0,85,19,0,0,85,20,1,0,85,21,2,0,85,7,3,0,85,8,4,0,38,24,5,1,83,9,24,0,1,24,140,117,82,24,24,0,120,24,8,0,1,24,0,0,83,18,24,0,78,6,18,0,38,24,6,1,0,17,24,0,137,22,0,0,139,17,0,0,1,24,8,115,82,24,24,0,85,10,24,0,78,24,9,0,38,24,24,1,0,23,24,0,121,23,4,0,1,26,0,0,0,25,26,0,119,0,3,0,82,26,10,0,0,25,26,0,82,26,19,0,82,27,20,0,82,28,21,0,82,29,8,0,134,24,0,0,212,213,1,0,25,26,27,28,29,23,11,0,82,12,10,0,82,13,19,0,1,24,8,115,82,14,24,0,82,15,20,0,82,16,21,0,78,24,9,0,38,24,24,1,121,24,6,0,134,24,0,0,112,141,0,0,12,13,14,15,16,11,0,0,119,0,5,0,134,24,0,0,208,165,1,0,12,13,14,15,16,11,0,0,1,29,140,117,82,29,29,0,1,28,8,115,82,28,28,0,1,27,0,0,1,26,0,0,82,25,20,0,82,30,21,0,82,31,7,0,134,24,0,0,16,91,1,0,29,28,27,26,25,30,31,11,1,24,1,0,83,18,24,0,78,6,18,0,38,24,6,1,0,17,24,0,137,22,0,0,139,17,0,0,140,2,19,0,0,0,0,0,136,14,0,0,0,13,14,0,136,14,0,0,25,14,14,32,137,14,0,0,130,14,0,0,136,15,0,0,49,14,14,15,200,241,1,0,1,15,32,0,135,14,0,0,15,0,0,0,25,3,13,20,25,7,13,16,25,9,13,12,25,10,13,8,25,11,13,4,0,12,13,0,89,7,0,0,89,9,1,0,88,15,9,0,145,15,15,0,59,16,2,0,145,16,16,0,66,14,15,16,145,14,14,0,89,10,14,0,88,16,10,0,145,16,16,0,61,15,0,0,0,0,0,63,145,15,15,0,63,14,16,15,145,14,14,0,89,11,14,0,88,14,9,0,145,14,14,0,59,15,1,0,145,15,15,0,72,14,14,15,120,14,7,0,1,15,23,54,1,16,90,48,1,17,250,2,1,18,59,54,135,14,8,0,15,16,17,18,88,18,7,0,145,18,18,0,135,14,236,0,18,0,0,0,145,14,14,0,89,7,14,0,88,2,7,0,145,2,2,0,88,14,11,0,145,14,14,0,74,14,2,14,121,14,9,0,59,14,0,0,145,14,14,0,89,3,14,0,88,8,3,0,145,8,8,0,137,13,0,0,145,14,8,0,139,14,0,0,61,18,0,0,0,0,0,63,145,18,18,0,88,17,10,0,145,17,17,0,64,14,18,17,145,14,14,0,89,12,14,0,88,4,7,0,145,4,4,0,88,14,12,0,145,14,14,0,72,14,4,14,121,14,10,0,59,14,1,0,145,14,14,0,89,3,14,0,88,8,3,0,145,8,8,0,137,13,0,0,145,14,8,0,139,14,0,0,119,0,17,0,88,5,11,0,145,5,5,0,88,14,7,0,145,14,14,0,64,6,5,14,145,6,6,0,88,17,9,0,145,17,17,0,66,14,6,17,145,14,14,0,89,3,14,0,88,8,3,0,145,8,8,0,137,13,0,0,145,14,8,0,139,14,0,0,59,14,0,0,145,14,14,0,139,14,0,0,140,6,29,0,0,0,0,0,136,22,0,0,0,18,22,0,136,22,0,0,1,23,48,1,3,22,22,23,137,22,0,0,130,22,0,0,136,23,0,0,49,22,22,23,136,243,1,0,1,23,48,1,135,22,0,0,23,0,0,0,1,22,240,0,3,7,18,22,1,22,176,0,3,6,18,22,25,13,18,40,25,14,18,32,25,15,18,24,25,16,18,16,25,8,18,8,0,9,18,0,25,10,18,112,25,11,18,48,87,13,0,0,87,14,1,0,87,15,2,0,87,16,3,0,87,8,4,0,87,9,5,0,86,23,13,0,86,24,14,0,86,25,15,0,86,26,16,0,86,27,8,0,86,28,9,0,134,22,0,0,96,158,1,0,10,23,24,25,26,27,28,0,1,22,76,115,82,21,22,0,0,12,21,0,0,17,6,0,0,19,21,0,25,20,17,64,116,17,19,0,25,17,17,4,25,19,19,4,54,22,17,20,16,244,1,0,0,17,7,0,0,19,10,0,25,20,17,64,116,17,19,0,25,17,17,4,25,19,19,4,54,22,17,20,48,244,1,0,134,22,0,0,212,150,0,0,11,6,7,0,0,17,12,0,0,19,11,0,25,20,17,64,116,17,19,0,25,17,17,4,25,19,19,4,54,22,17,20,92,244,1,0,137,18,0,0,139,0,0,0,140,4,22,0,0,0,0,0,136,19,0,0,0,15,19,0,136,19,0,0,1,20,144,0,3,19,19,20,137,19,0,0,130,19,0,0,136,20,0,0,49,19,19,20,180,244,1,0,1,20,144,0,135,19,0,0,20,0,0,0,25,4,15,80,25,10,15,72,25,11,15,68,25,12,15,8,0,13,15,0,109,15,76,0,85,10,1,0,85,11,2,0,109,15,64,3,82,18,10,0,1,19,178,120,1,20,175,120,90,20,20,18,95,19,18,20,1,20,175,120,82,19,10,0,82,21,11,0,95,20,19,21,1,19,0,0,134,21,0,0,128,110,2,0,19,0,0,0,121,21,4,0,1,21,1,0,85,12,21,0,119,0,8,0,1,19,0,0,134,21,0,0,192,137,2,0,19,0,0,0,121,21,3,0,1,21,0,0,85,12,21,0,1,19,0,0,109,12,8,19,1,21,1,0,109,12,4,21,25,5,12,24,134,21,0,0,232,139,2,0,13,0,0,0,116,5,13,0,106,19,13,4,109,5,4,19,134,6,0,0,48,162,2,0,76,19,6,0,145,6,19,0,25,7,12,24,88,21,7,0,145,21,21,0,66,19,21,6,145,19,19,0,89,7,19,0,134,8,0,0,4,162,2,0,76,19,8,0,145,8,19,0,25,19,12,24,25,9,19,4,88,21,9,0,145,21,21,0,66,19,21,8,145,19,19,0,89,9,19,0,0,14,4,0,0,16,12,0,25,17,14,56,116,14,16,0,25,14,14,4,25,16,16,4,54,19,14,17,196,245,1,0,134,19,0,0,212,238,0,0,4,0,0,0,137,15,0,0,139,0,0,0,140,2,10,0,0,0,0,0,136,7,0,0,0,4,7,0,136,7,0,0,25,7,7,64,137,7,0,0,130,7,0,0,136,8,0,0,49,7,7,8,36,246,1,0,1,8,64,0,135,7,0,0,8,0,0,0,0,2,4,0,0,3,2,0,25,6,3,64,1,7,0,0,85,3,7,0,25,3,3,4,54,7,3,6,48,246,1,0,88,7,1,0,145,7,7,0,89,2,7,0,112,8,1,16,145,8,8,0,113,2,4,8,112,7,1,32,145,7,7,0,113,2,8,7,112,8,1,48,145,8,8,0,113,2,12,8,112,7,1,4,145,7,7,0,113,2,16,7,112,8,1,20,145,8,8,0,113,2,20,8,112,7,1,36,145,7,7,0,113,2,24,7,112,8,1,52,145,8,8,0,113,2,28,8,112,7,1,8,145,7,7,0,113,2,32,7,112,8,1,24,145,8,8,0,113,2,36,8,112,7,1,40,145,7,7,0,113,2,40,7,112,8,1,56,145,8,8,0,113,2,44,8,112,7,1,12,145,7,7,0,113,2,48,7,112,8,1,28,145,8,8,0,113,2,52,8,112,7,1,44,145,7,7,0,113,2,56,7,112,8,1,60,145,8,8,0,113,2,60,8,0,3,0,0,0,5,2,0,25,6,3,64,116,3,5,0,25,3,3,4,25,5,5,4,54,8,3,6,16,247,1,0,137,4,0,0,139,0,0,0,140,3,13,0,0,0,0,0,1,9,0,0,136,11,0,0,0,10,11,0,136,11,0,0,25,11,11,32,137,11,0,0,130,11,0,0,136,12,0,0,49,11,11,12,104,247,1,0,1,12,32,0,135,11,0,0,12,0,0,0,25,3,10,20,25,4,10,16,25,5,10,12,25,6,10,8,25,7,10,4,0,8,10,0,85,3,0,0,85,4,1,0,85,5,2,0,1,11,0,0,85,6,11,0,116,7,4,0,1,11,0,0,85,8,11,0,82,11,5,0,82,12,8,0,56,11,11,12,136,248,1,0,82,11,3,0,79,11,11,0,82,12,4,0,79,12,12,0,46,11,11,12,208,247,1,0,1,9,6,0,119,0,16,0,82,11,3,0,103,11,11,1,82,12,4,0,103,12,12,1,46,11,11,12,240,247,1,0,1,9,6,0,119,0,8,0,82,11,3,0,103,11,11,2,82,12,4,0,103,12,12,2,46,11,11,12,12,248,1,0,1,9,6,0,32,11,9,6,121,11,20,0,1,9,0,0,82,11,7,0,82,12,4,0,78,12,12,0,83,11,12,0,82,12,7,0,82,11,4,0,102,11,11,1,107,12,1,11,82,11,7,0,82,12,4,0,102,12,12,2,107,11,2,12,82,12,6,0,25,12,12,1,85,6,12,0,82,12,7,0,25,12,12,4,85,7,12,0,82,12,3,0,25,12,12,4,85,3,12,0,82,12,4,0,25,12,12,4,85,4,12,0,82,12,8,0,25,12,12,1,85,8,12,0,119,0,199,255,137,10,0,0,82,12,6,0,139,12,0,0,140,2,25,0,0,0,0,0,2,19,0,0,128,128,128,128,2,20,0,0,255,254,254,254,2,21,0,0,255,0,0,0,19,22,1,21,0,12,22,0,120,12,5,0,135,22,15,0,0,0,0,0,3,2,0,22,119,0,92,0,38,22,0,3,120,22,3,0,0,5,0,0,119,0,28,0,19,22,1,21,0,18,22,0,0,6,0,0,78,8,6,0,41,23,8,24,42,23,23,24,32,23,23,0,121,23,4,0,1,23,1,0,0,22,23,0,119,0,7,0,41,23,8,24,42,23,23,24,41,24,18,24,42,24,24,24,13,23,23,24,0,22,23,0,121,22,3,0,0,2,6,0,119,0,68,0,25,9,6,1,38,22,9,3,120,22,3,0,0,5,9,0,119,0,3,0,0,6,9,0,119,0,233,255,2,22,0,0,1,1,1,1,5,10,12,22,82,11,5,0,19,22,11,19,21,22,22,19,2,23,0,0,1,1,1,1,4,23,11,23,19,22,22,23,120,22,27,0,0,4,5,0,0,14,11,0,21,22,14,10,0,13,22,0,19,22,13,19,21,22,22,19,2,23,0,0,1,1,1,1,4,23,13,23,19,22,22,23,121,22,3,0,0,3,4,0,119,0,15,0,25,15,4,4,82,14,15,0,19,22,14,19,21,22,22,19,2,23,0,0,1,1,1,1,4,23,14,23,19,22,22,23,121,22,3,0,0,3,15,0,119,0,4,0,0,4,15,0,119,0,233,255,0,3,5,0,19,22,1,21,0,16,22,0,0,7,3,0,78,17,7,0,41,23,17,24,42,23,23,24,32,23,23,0,121,23,4,0,1,23,1,0,0,22,23,0,119,0,7,0,41,23,17,24,42,23,23,24,41,24,16,24,42,24,24,24,13,23,23,24,0,22,23,0,121,22,3,0,0,2,7,0,119,0,3,0,25,7,7,1,119,0,238,255,139,2,0,0,140,2,21,0,0,0,0,0,136,11,0,0,0,10,11,0,136,11,0,0,25,11,11,16,137,11,0,0,130,11,0,0,136,12,0,0,49,11,11,12,120,250,1,0,1,12,16,0,135,11,0,0,12,0,0,0,25,5,10,8,25,8,10,4,89,8,0,0,89,10,1,0,88,12,8,0,145,12,12,0,135,11,236,0,12,0,0,0,145,11,11,0,89,8,11,0,88,11,8,0,145,11,11,0,59,12,1,0,145,12,12,0,71,2,11,12,88,3,8,0,145,3,3,0,121,2,31,0,88,12,8,0,145,12,12,0,65,4,3,12,145,4,4,0,88,16,8,0,145,16,16,0,59,17,21,0,145,17,17,0,65,15,16,17,145,15,15,0,59,17,36,0,145,17,17,0,64,14,15,17,145,14,14,0,65,13,4,14,145,13,13,0,59,14,16,0,145,14,14,0,63,11,13,14,145,11,11,0,59,14,18,0,145,14,14,0,66,12,11,14,145,12,12,0,89,5,12,0,88,9,5,0,145,9,9,0,137,10,0,0,145,12,9,0,139,12,0,0,59,12,2,0,145,12,12,0,71,12,3,12,121,12,38,0,88,6,8,0,145,6,6,0,88,7,8,0,145,7,7,0,59,16,36,0,145,16,16,0,88,19,8,0,145,19,19,0,59,20,7,0,145,20,20,0,65,18,19,20,145,18,18,0,64,15,16,18,145,15,15,0,65,17,7,15,145,17,17,0,59,15,196,255,145,15,15,0,63,13,17,15,145,13,13,0,65,11,6,13,145,11,11,0,59,13,32,0,145,13,13,0,63,14,11,13,145,14,14,0,59,13,18,0,145,13,13,0,66,12,14,13,145,12,12,0,89,5,12,0,88,9,5,0,145,9,9,0,137,10,0,0,145,12,9,0,139,12,0,0,119,0,9,0,59,12,0,0,145,12,12,0,89,5,12,0,88,9,5,0,145,9,9,0,137,10,0,0,145,12,9,0,139,12,0,0,59,12,0,0,145,12,12,0,139,12,0,0,140,2,19,0,0,0,0,0,136,11,0,0,0,10,11,0,136,11,0,0,25,11,11,16,137,11,0,0,130,11,0,0,136,12,0,0,49,11,11,12,64,252,1,0,1,12,16,0,135,11,0,0,12,0,0,0,25,5,10,8,25,8,10,4,89,8,0,0,89,10,1,0,88,12,8,0,145,12,12,0,135,11,236,0,12,0,0,0,145,11,11,0,89,8,11,0,88,11,8,0,145,11,11,0,59,12,1,0,145,12,12,0,71,2,11,12,88,3,8,0,145,3,3,0,121,2,31,0,88,12,8,0,145,12,12,0,65,4,3,12,145,4,4,0,88,16,8,0,145,16,16,0,59,17,3,0,145,17,17,0,65,15,16,17,145,15,15,0,59,17,6,0,145,17,17,0,64,14,15,17,145,14,14,0,65,13,4,14,145,13,13,0,59,14,4,0,145,14,14,0,63,11,13,14,145,11,11,0,59,14,6,0,145,14,14,0,66,12,11,14,145,12,12,0,89,5,12,0,88,9,5,0,145,9,9,0,137,10,0,0,145,12,9,0,139,12,0,0,59,12,2,0,145,12,12,0,71,12,3,12,121,12,34,0,88,6,8,0,145,6,6,0,88,7,8,0,145,7,7,0,59,16,6,0,145,16,16,0,88,18,8,0,145,18,18,0,64,15,16,18,145,15,15,0,65,17,7,15,145,17,17,0,59,15,244,255,145,15,15,0,63,13,17,15,145,13,13,0,65,11,6,13,145,11,11,0,59,13,8,0,145,13,13,0,63,14,11,13,145,14,14,0,59,13,6,0,145,13,13,0,66,12,14,13,145,12,12,0,89,5,12,0,88,9,5,0,145,9,9,0,137,10,0,0,145,12,9,0,139,12,0,0,119,0,9,0,59,12,0,0,145,12,12,0,89,5,12,0,88,9,5,0,145,9,9,0,137,10,0,0,145,12,9,0,139,12,0,0,59,12,0,0,145,12,12,0,139,12,0,0,140,6,25,0,0,0,0,0,136,19,0,0,0,18,19,0,136,19,0,0,25,19,19,48,137,19,0,0,130,19,0,0,136,20,0,0,49,19,19,20,248,253,1,0,1,20,48,0,135,19,0,0,20,0,0,0,25,14,18,36,25,15,18,32,25,16,18,28,25,17,18,24,25,6,18,20,25,7,18,16,25,8,18,12,25,9,18,8,25,10,18,4,0,11,18,0,85,15,0,0,85,16,1,0,85,17,2,0,85,6,3,0,85,7,4,0,85,8,5,0,82,20,7,0,82,21,8,0,82,22,16,0,82,23,17,0,82,24,6,0,134,19,0,0,204,230,0,0,20,21,22,23,24,10,0,0,85,11,19,0,82,19,11,0,120,19,6,0,1,19,0,0,85,14,19,0,82,13,14,0,137,18,0,0,139,13,0,0,82,24,15,0,1,23,192,47,134,19,0,0,48,144,2,0,24,23,0,0,85,9,19,0,82,12,11,0,82,19,9,0,121,19,20,0,1,23,1,0,82,24,10,0,82,22,9,0,134,19,0,0,88,130,2,0,12,23,24,22,82,22,9,0,134,19,0,0,100,103,2,0,22,0,0,0,82,22,11,0,135,19,5,0,22,0,0,0,1,19,1,0,85,14,19,0,82,13,14,0,137,18,0,0,139,13,0,0,119,0,8,0,135,19,5,0,12,0,0,0,1,19,0,0,85,14,19,0,82,13,14,0,137,18,0,0,139,13,0,0,1,19,0,0,139,19,0,0,140,2,20,0,0,0,0,0,136,11,0,0,0,10,11,0,136,11,0,0,25,11,11,16,137,11,0,0,130,11,0,0,136,12,0,0,49,11,11,12,72,255,1,0,1,12,16,0,135,11,0,0,12,0,0,0,25,5,10,8,25,9,10,4,89,9,0,0,89,10,1,0,88,12,9,0,145,12,12,0,135,11,236,0,12,0,0,0,145,11,11,0,89,9,11,0,88,11,9,0,145,11,11,0,59,12,1,0,145,12,12,0,71,2,11,12,88,3,9,0,145,3,3,0,121,2,29,0,88,12,9,0,145,12,12,0,65,4,3,12,145,4,4,0,59,11,1,0,145,11,11,0,61,15,0,0,0,0,32,64,145,15,15,0,88,17,9,0,145,17,17,0,61,18,0,0,0,0,192,63,145,18,18,0,65,16,17,18,145,16,16,0,64,14,15,16,145,14,14,0,65,13,4,14,145,13,13,0,64,12,11,13,145,12,12,0,89,5,12,0,88,8,5,0,145,8,8,0,137,10,0,0,145,12,8,0,139,12,0,0,59,12,2,0,145,12,12,0,71,12,3,12,121,12,36,0,88,6,9,0,145,6,6,0,88,7,9,0,145,7,7,0,59,13,2,0,145,13,13,0,88,17,9,0,145,17,17,0,61,19,0,0,0,0,0,63,145,19,19,0,65,18,17,19,145,18,18,0,61,19,0,0,0,0,32,64,145,19,19,0,64,15,18,19,145,15,15,0,65,16,7,15,145,16,16,0,59,15,4,0,145,15,15,0,63,14,16,15,145,14,14,0,65,11,6,14,145,11,11,0,64,12,13,11,145,12,12,0,89,5,12,0,88,8,5,0,145,8,8,0,137,10,0,0,145,12,8,0,139,12,0,0,119,0,9,0,59,12,0,0,145,12,12,0,89,5,12,0,88,8,5,0,145,8,8,0,137,10,0,0,145,12,8,0,139,12,0,0,59,12,0,0,145,12,12,0,139,12,0,0,140,3,20,0,0,0,0,0,1,17,0,0,25,13,2,16,82,15,13,0,120,15,10,0,134,18,0,0,96,136,2,0,2,0,0,0,120,18,4,0,82,9,13,0,1,17,5,0,119,0,5,0,1,4,0,0,119,0,3,0,0,9,15,0,1,17,5,0,32,18,17,5,121,18,53,0,25,16,2,20,82,8,16,0,0,10,8,0,4,18,9,8,48,18,18,1,64,1,2,0,106,18,2,36,38,18,18,15,135,4,4,1,18,2,0,1,119,0,42,0,102,18,2,75,34,18,18,0,32,19,1,0,20,18,18,19,121,18,6,0,1,5,0,0,0,6,0,0,0,7,1,0,0,14,10,0,119,0,26,0,0,3,1,0,26,11,3,1,90,18,0,11,32,18,18,10,120,18,9,0,120,11,6,0,1,5,0,0,0,6,0,0,0,7,1,0,0,14,10,0,119,0,15,0,0,3,11,0,119,0,245,255,106,18,2,36,38,18,18,15,135,12,4,1,18,2,0,3,48,18,12,3,188,1,2,0,0,4,12,0,119,0,11,0,0,5,3,0,3,6,0,3,4,7,1,3,82,14,16,0,135,18,32,0,14,6,7,0,82,18,16,0,3,18,18,7,85,16,18,0,3,4,5,7,139,4,0,0,140,2,18,0,0,0,0,0,1,12,0,0,136,14,0,0,0,13,14,0,136,14,0,0,25,14,14,48,137,14,0,0,130,14,0,0,136,15,0,0,49,14,14,15,36,2,2,0,1,15,48,0,135,14,0,0,15,0,0,0,25,2,13,36,25,3,13,32,25,6,13,40,25,7,13,28,25,8,13,24,25,9,13,20,0,10,13,0,25,11,13,16,85,2,0,0,85,3,1,0,1,14,0,0,83,6,14,0,82,15,2,0,134,14,0,0,120,126,2,0,15,0,0,0,85,7,14,0,82,14,7,0,120,14,6,0,78,4,6,0,38,14,4,1,0,5,14,0,137,13,0,0,139,5,0,0,1,14,0,0,85,8,14,0,82,15,3,0,1,16,59,0,134,14,0,0,48,23,2,0,15,16,8,0,85,9,14,0,1,14,0,0,85,10,14,0,1,16,0,0,109,10,4,16,1,14,0,0,109,10,8,14,1,16,0,0,109,10,12,16,82,15,7,0,134,14,0,0,44,108,2,0,15,0,0,0,135,16,16,0,10,14,0,0,1,16,0,0,85,11,16,0,82,16,8,0,82,14,11,0,49,16,16,14,252,2,2,0,1,12,7,0,119,0,17,0,82,15,9,0,82,17,11,0,41,17,17,2,94,15,15,17,25,15,15,1,134,14,0,0,44,108,2,0,15,0,0,0,134,16,0,0,88,139,2,0,10,14,0,0,120,16,5,0,82,16,11,0,25,16,16,1,85,11,16,0,119,0,235,255,32,16,12,7,121,16,6,0,78,4,6,0,38,16,4,1,0,5,16,0,137,13,0,0,139,5,0,0,1,16,1,0,83,6,16,0,78,4,6,0,38,16,4,1,0,5,16,0,137,13,0,0,139,5,0,0,140,3,21,0,0,0,0,0,136,19,0,0,0,15,19,0,136,19,0,0,1,20,16,1,3,19,19,20,137,19,0,0,130,19,0,0,136,20,0,0,49,19,19,20,176,3,2,0,1,20,16,1,135,19,0,0,20,0,0,0,1,19,208,0,3,4,15,19,1,19,144,0,3,3,15,19,1,19,136,0,3,7,15,19,1,19,132,0,3,8,15,19,1,19,128,0,3,9,15,19,25,10,15,64,0,11,15,0,89,7,0,0,89,8,1,0,89,9,2,0,88,12,7,0,145,12,12,0,88,13,8,0,145,13,13,0,88,20,9,0,145,20,20,0,134,19,0,0,56,11,2,0,10,12,13,20,1,19,76,115,82,18,19,0,0,5,18,0,0,6,18,0,0,14,3,0,0,16,10,0,25,17,14,64,116,14,16,0,25,14,14,4,25,16,16,4,54,19,14,17,44,4,2,0,0,14,4,0,0,16,6,0,25,17,14,64,116,14,16,0,25,14,14,4,25,16,16,4,54,19,14,17,76,4,2,0,134,19,0,0,212,150,0,0,11,3,4,0,0,14,5,0,0,16,11,0,25,17,14,64,116,14,16,0,25,14,14,4,25,16,16,4,54,19,14,17,120,4,2,0,137,15,0,0,139,0,0,0,140,3,20,0,0,0,0,0,136,18,0,0,0,15,18,0,136,18,0,0,1,19,144,0,3,18,18,19,137,18,0,0,130,18,0,0,136,19,0,0,49,18,18,19,208,4,2,0,1,19,144,0,135,18,0,0,19,0,0,0,25,3,15,88,25,10,15,8,0,11,15,0,25,12,15,24,25,13,15,16,109,15,80,0,87,10,1,0,87,11,2,0,1,18,2,0,85,12,18,0,1,19,0,0,109,12,8,19,1,18,1,0,109,12,4,18,25,4,12,24,86,18,10,0,145,18,18,0,89,13,18,0,86,19,11,0,145,19,19,0,113,13,4,19,116,4,13,0,106,18,13,4,109,4,4,18,25,5,12,24,1,18,240,81,82,19,5,0,85,18,19,0,1,19,244,81,106,18,5,4,85,19,18,0,134,6,0,0,48,162,2,0,76,18,6,0,145,6,18,0,25,7,12,24,88,19,7,0,145,19,19,0,66,18,19,6,145,18,18,0,89,7,18,0,134,8,0,0,4,162,2,0,76,18,8,0,145,8,18,0,25,18,12,24,25,9,18,4,88,19,9,0,145,19,19,0,66,18,19,8,145,18,18,0,89,9,18,0,0,14,3,0,0,16,12,0,25,17,14,56,116,14,16,0,25,14,14,4,25,16,16,4,54,18,14,17,172,5,2,0,134,18,0,0,212,238,0,0,3,0,0,0,137,15,0,0,139,0,0,0,140,1,14,0,0,0,0,0,136,11,0,0,0,10,11,0,136,11,0,0,1,12,64,2,3,11,11,12,137,11,0,0,130,11,0,0,136,12,0,0,49,11,11,12,16,6,2,0,1,12,64,2,135,11,0,0,12,0,0,0,1,11,40,2,3,1,10,11,1,11,8,2,3,9,10,11,1,11,0,2,3,8,10,11,1,11,36,2,3,2,10,11,1,11,32,2,3,5,10,11,1,11,12,2,3,6,10,11,0,7,10,0,85,2,0,0,1,12,236,117,82,12,12,0,1,13,240,117,82,13,13,0,134,11,0,0,36,238,1,0,12,13,0,0,85,5,11,0,116,6,5,0,1,13,236,117,82,13,13,0,109,6,4,13,1,11,240,117,82,11,11,0,109,6,8,11,1,13,1,0,109,6,12,13,1,11,7,0,109,6,16,11,1,13,0,0,1,12,0,2,135,11,3,0,7,13,12,0,82,12,2,0,135,11,16,0,7,12,0,0,116,1,6,0,106,12,6,4,109,1,4,12,106,11,6,8,109,1,8,11,106,12,6,12,109,1,12,12,106,11,6,16,109,1,16,11,134,11,0,0,112,196,1,0,1,7,0,0,82,12,5,0,135,11,5,0,12,0,0,0,134,3,0,0,20,121,2,0,7,0,0,0,134,4,0,0,20,121,2,0,7,0,0,0,85,8,3,0,109,8,4,4,1,13,194,45,134,12,0,0,248,127,2,0,13,8,0,0,135,11,239,0,12,0,0,0,85,9,7,0,1,12,3,0,1,13,72,46,134,11,0,0,252,32,2,0,12,13,9,0,137,10,0,0,139,0,0,0,140,2,21,0,0,0,0,0,2,17,0,0,255,0,0,0,1,15,0,0,136,18,0,0,0,16,18,0,136,18,0,0,25,18,18,32,137,18,0,0,130,18,0,0,136,19,0,0,49,18,18,19,136,7,2,0,1,19,32,0,135,18,0,0,19,0,0,0,0,9,16,0,78,13,1,0,41,18,13,24,42,18,18,24,120,18,3,0,1,15,3,0,119,0,61,0,102,18,1,1,120,18,3,0,1,15,3,0,119,0,57,0,1,19,0,0,1,20,32,0,135,18,3,0,9,19,20,0,78,5,1,0,41,18,5,24,42,18,18,24,121,18,20,0,0,2,1,0,0,7,5,0,19,18,7,17,0,6,18,0,43,18,6,5,41,18,18,2,3,8,9,18,82,18,8,0,1,20,1,0,38,19,6,31,22,20,20,19], eb + 122880);
  HEAPU8.set([20,18,18,20,85,8,18,0,25,2,2,1,78,7,2,0,41,18,7,24,42,18,18,24,33,18,18,0,120,18,240,255,78,10,0,0,41,18,10,24,42,18,18,24,120,18,3,0,0,3,0,0,119,0,24,0,0,4,0,0,0,12,10,0,19,18,12,17,0,11,18,0,43,18,11,5,41,18,18,2,94,18,9,18,1,20,1,0,38,19,11,31,22,20,20,19,19,18,18,20,121,18,3,0,0,3,4,0,119,0,10,0,25,14,4,1,78,12,14,0,41,18,12,24,42,18,18,24,120,18,3,0,0,3,14,0,119,0,3,0,0,4,14,0,119,0,236,255,32,18,15,3,121,18,6,0,41,18,13,24,42,18,18,24,134,3,0,0,148,248,1,0,0,18,0,0,137,16,0,0,4,18,3,0,139,18,0,0,140,2,15,0,0,0,0,0,136,12,0,0,0,11,12,0,136,12,0,0,25,12,12,32,137,12,0,0,130,12,0,0,136,13,0,0,49,12,12,13,244,8,2,0,1,13,32,0,135,12,0,0,13,0,0,0,25,2,11,20,25,8,11,8,25,9,11,4,0,10,11,0,116,8,1,0,106,13,1,4,109,8,4,13,106,12,1,8,109,8,8,12,116,2,1,0,106,13,1,4,109,2,4,13,106,12,1,8,109,2,8,12,134,12,0,0,244,117,2,0,2,0,0,0,145,12,12,0,89,9,12,0,88,12,9,0,145,12,12,0,59,13,0,0,145,13,13,0,69,12,12,13,121,12,4,0,59,12,1,0,145,12,12,0,89,9,12,0,59,13,1,0,145,13,13,0,88,14,9,0,145,14,14,0,66,12,13,14,145,12,12,0,89,10,12,0,88,3,10,0,145,3,3,0,88,14,8,0,145,14,14,0,65,12,14,3,145,12,12,0,89,8,12,0,88,4,10,0,145,4,4,0,25,5,8,4,88,14,5,0,145,14,14,0,65,12,14,4,145,12,12,0,89,5,12,0,88,6,10,0,145,6,6,0,25,7,8,8,88,14,7,0,145,14,14,0,65,12,14,6,145,12,12,0,89,7,12,0,116,0,8,0,106,14,8,4,109,0,4,14,106,12,8,8,109,0,8,12,137,11,0,0,139,0,0,0,140,3,22,0,0,0,0,0,1,16,0,0,136,18,0,0,0,17,18,0,136,18,0,0,25,18,18,32,137,18,0,0,130,18,0,0,136,19,0,0,49,18,18,19,52,10,2,0,1,19,32,0,135,18,0,0,19,0,0,0,0,10,17,0,25,12,17,16,85,10,1,0,25,13,10,4,25,14,0,48,82,15,14,0,33,18,15,0,38,18,18,1,4,18,2,18,85,13,18,0,25,6,0,44,82,19,6,0,109,10,8,19,109,10,12,15,106,20,0,60,1,21,2,0,135,18,11,1,20,10,21,12,134,19,0,0,132,153,2,0,18,0,0,0,120,19,30,0,82,5,12,0,34,19,5,1,121,19,4,0,0,7,5,0,1,16,4,0,119,0,28,0,82,8,13,0,48,19,8,5,248,10,2,0,82,9,6,0,25,11,0,4,85,11,9,0,0,4,9,0,4,18,5,8,3,18,4,18,109,0,8,18,82,18,14,0,120,18,3,0,0,3,2,0,119,0,14,0,25,18,4,1,85,11,18,0,26,18,2,1,78,19,4,0,95,1,18,19,0,3,2,0,119,0,7,0,0,3,5,0,119,0,5,0,1,19,255,255,85,12,19,0,1,7,255,255,1,16,4,0,32,19,16,4,121,19,7,0,38,19,7,48,40,19,19,16,82,18,0,0,20,19,19,18,85,0,19,0,0,3,7,0,137,17,0,0,139,3,0,0,140,4,14,0,0,0,0,0,136,12,0,0,0,9,12,0,136,12,0,0,25,12,12,80,137,12,0,0,130,12,0,0,136,13,0,0,49,12,12,13,112,11,2,0,1,13,80,0,135,12,0,0,13,0,0,0,25,4,9,72,25,5,9,68,25,6,9,64,0,7,9,0,89,4,1,0,89,5,2,0,89,6,3,0,59,12,1,0,145,12,12,0,89,7,12,0,59,13,0,0,145,13,13,0,113,7,4,13,59,12,0,0,145,12,12,0,113,7,8,12,88,13,4,0,145,13,13,0,113,7,12,13,59,12,0,0,145,12,12,0,113,7,16,12,59,13,1,0,145,13,13,0,113,7,20,13,59,12,0,0,145,12,12,0,113,7,24,12,88,13,5,0,145,13,13,0,113,7,28,13,59,12,0,0,145,12,12,0,113,7,32,12,59,13,0,0,145,13,13,0,113,7,36,13,59,12,1,0,145,12,12,0,113,7,40,12,88,13,6,0,145,13,13,0,113,7,44,13,59,12,0,0,145,12,12,0,113,7,48,12,59,13,0,0,145,13,13,0,113,7,52,13,59,12,0,0,145,12,12,0,113,7,56,12,59,13,1,0,145,13,13,0,113,7,60,13,0,8,0,0,0,10,7,0,25,11,8,64,116,8,10,0,25,8,8,4,25,10,10,4,54,13,8,11,88,12,2,0,137,9,0,0,139,0,0,0,140,3,18,0,0,0,0,0,136,13,0,0,0,12,13,0,136,13,0,0,25,13,13,32,137,13,0,0,130,13,0,0,136,14,0,0,49,13,13,14,172,12,2,0,1,14,32,0,135,13,0,0,14,0,0,0,25,4,12,16,25,6,12,12,25,8,12,8,25,10,12,4,0,11,12,0,85,4,0,0,85,6,1,0,85,8,2,0,82,13,4,0,82,13,13,0,121,13,9,0,82,13,4,0,82,13,13,0,26,13,13,8,82,13,13,0,41,13,13,1,82,14,6,0,3,3,13,14,119,0,3,0,82,14,6,0,25,3,14,1,85,10,3,0,82,14,4,0,82,14,14,0,121,14,5,0,82,14,4,0,82,14,14,0,26,5,14,8,119,0,2,0,1,5,0,0,82,15,8,0,82,16,10,0,5,13,15,16,25,13,13,8,134,14,0,0,60,120,2,0,5,13,0,0,85,11,14,0,82,14,11,0,120,14,7,0,1,13,240,47,1,16,142,47,1,15,25,3,1,17,242,47,135,14,8,0,13,16,15,17,82,14,11,0,120,14,5,0,82,7,4,0,82,9,7,0,137,12,0,0,139,9,0,0,82,14,4,0,82,14,14,0,120,14,4,0,82,14,11,0,1,17,0,0,109,14,4,17,82,17,4,0,82,14,11,0,25,14,14,8,85,17,14,0,82,14,4,0,82,14,14,0,26,14,14,8,116,14,10,0,82,7,4,0,82,9,7,0,137,12,0,0,139,9,0,0,140,3,14,0,0,0,0,0,136,8,0,0,0,7,8,0,136,8,0,0,25,8,8,16,137,8,0,0,130,8,0,0,136,9,0,0,49,8,8,9,252,13,2,0,1,9,16,0,135,8,0,0,9,0,0,0,0,6,7,0,25,3,7,12,25,4,7,8,25,5,7,4,85,3,0,0,85,4,1,0,85,5,2,0,1,8,31,44,85,6,8,0,1,9,3,0,1,10,8,44,134,8,0,0,252,32,2,0,9,10,6,0,1,8,144,117,82,10,5,0,85,8,10,0,1,10,174,120,82,9,3,0,82,11,4,0,134,8,0,0,208,48,1,0,9,11,0,0,38,8,8,1,83,10,8,0,1,8,174,120,78,8,8,0,38,8,8,1,120,8,3,0,137,7,0,0,139,0,0,0,134,8,0,0,20,160,2,0,134,8,0,0,136,4,1,0,1,10,0,0,1,11,0,0,1,9,1,0,1,12,3,0,1,13,2,0,135,8,12,1,10,11,9,12,13,0,0,0,1,13,39,44,1,12,0,0,1,9,1,0,1,11,4,0,1,10,2,0,135,8,13,1,13,12,9,11,10,0,0,0,1,10,39,44,1,11,0,0,1,9,1,0,1,12,5,0,1,13,2,0,135,8,14,1,10,11,9,12,13,0,0,0,1,13,39,44,1,12,0,0,1,9,1,0,1,11,6,0,1,10,2,0,135,8,15,1,13,12,9,11,10,0,0,0,1,10,39,44,1,11,0,0,1,9,1,0,1,12,6,0,1,13,2,0,135,8,16,1,10,11,9,12,13,0,0,0,1,13,39,44,1,12,0,0,1,9,1,0,1,11,6,0,1,10,2,0,135,8,17,1,13,12,9,11,10,0,0,0,1,10,39,44,1,11,0,0,1,9,1,0,1,12,6,0,1,13,2,0,135,8,18,1,10,11,9,12,13,0,0,0,1,13,0,0,1,12,1,0,1,9,7,0,1,11,2,0,135,8,19,1,13,12,9,11,1,11,0,0,1,9,1,0,1,12,7,0,1,13,2,0,135,8,20,1,11,9,12,13,137,7,0,0,139,0,0,0,140,3,13,0,0,0,0,0,136,10,0,0,0,9,10,0,136,10,0,0,25,10,10,32,137,10,0,0,130,10,0,0,136,11,0,0,49,10,10,11,216,15,2,0,1,11,32,0,135,10,0,0,11,0,0,0,25,4,9,16,25,5,9,12,25,6,9,8,25,7,9,4,0,8,9,0,85,4,0,0,85,5,1,0,85,6,2,0,1,10,0,0,85,7,10,0,1,10,0,0,85,8,10,0,82,10,6,0,1,11,1,0,1,12,21,0,138,10,11,12,112,16,2,0,124,16,2,0,136,16,2,0,140,16,2,0,152,16,2,0,156,16,2,0,160,16,2,0,172,16,2,0,184,16,2,0,196,16,2,0,208,16,2,0,220,16,2,0,224,16,2,0,236,16,2,0,240,16,2,0,244,16,2,0,248,16,2,0,252,16,2,0,0,17,2,0,4,17,2,0,8,17,2,0,119,0,42,0,1,11,8,0,85,8,11,0,119,0,39,0,1,11,16,0,85,8,11,0,119,0,36,0,119,0,253,255,1,11,24,0,85,8,11,0,119,0,32,0,119,0,249,255,119,0,248,255,1,11,32,0,85,8,11,0,119,0,27,0,1,11,32,0,85,8,11,0,119,0,24,0,1,11,96,0,85,8,11,0,119,0,21,0,1,11,128,0,85,8,11,0,119,0,18,0,1,11,4,0,85,8,11,0,119,0,15,0,119,0,253,255,1,11,8,0,85,8,11,0,119,0,11,0,119,0,253,255,119,0,248,255,119,0,247,255,119,0,250,255,119,0,245,255,119,0,244,255,119,0,247,255,1,11,2,0,85,8,11,0,119,0,1,0,82,10,4,0,82,11,5,0,5,3,10,11,82,10,8,0,5,11,3,10,28,11,11,8,85,7,11,0,137,9,0,0,82,11,7,0,139,11,0,0,140,3,16,0,0,0,0,0,136,13,0,0,0,12,13,0,136,13,0,0,25,13,13,32,137,13,0,0,130,13,0,0,136,14,0,0,49,13,13,14,116,17,2,0,1,14,32,0,135,13,0,0,14,0,0,0,25,4,12,28,25,5,12,24,25,7,12,20,25,8,12,16,25,9,12,12,25,10,12,8,25,11,12,4,0,3,12,0,85,5,0,0,85,7,1,0,85,8,2,0,82,13,5,0,82,14,7,0,3,13,13,14,82,14,8,0,4,13,13,14,85,9,13,0,82,14,9,0,82,15,5,0,4,14,14,15,135,13,31,0,14,0,0,0,85,10,13,0,82,14,9,0,82,15,7,0,4,14,14,15,135,13,31,0,14,0,0,0,85,11,13,0,82,14,9,0,82,15,8,0,4,14,14,15,135,13,31,0,14,0,0,0,85,3,13,0,82,13,10,0,82,14,11,0,49,13,13,14,52,18,2,0,82,13,10,0,82,14,3,0,49,13,13,14,52,18,2,0,82,13,5,0,83,4,13,0,78,6,4,0,137,12,0,0,139,6,0,0,82,13,11,0,82,14,3,0,49,13,13,14,92,18,2,0,82,13,7,0,83,4,13,0,78,6,4,0,137,12,0,0,139,6,0,0,119,0,6,0,82,13,8,0,83,4,13,0,78,6,4,0,137,12,0,0,139,6,0,0,1,13,0,0,139,13,0,0,140,3,16,0,0,0,0,0,136,13,0,0,0,11,13,0,136,13,0,0,25,13,13,48,137,13,0,0,130,13,0,0,136,14,0,0,49,13,13,14,176,18,2,0,1,14,48,0,135,13,0,0,14,0,0,0,25,9,11,32,25,10,11,16,0,8,11,0,25,7,11,40,109,11,44,0,85,7,1,0,109,11,36,2,82,12,7,0,1,13,8,1,94,3,12,13,1,13,12,1,94,4,12,13,1,13,16,1,94,5,12,13,1,13,20,1,94,6,12,13,82,13,7,0,82,13,13,0,121,13,19,0,85,8,3,0,109,8,4,4,109,8,8,5,109,8,12,6,1,14,3,0,1,15,54,44,134,13,0,0,252,32,2,0,14,15,8,0,1,15,3,0,1,14,190,44,134,13,0,0,252,32,2,0,15,14,9,0,137,11,0,0,1,13,0,0,139,13,0,0,119,0,18,0,85,10,3,0,109,10,4,4,109,10,8,5,109,10,12,6,1,14,3,0,1,15,123,44,134,13,0,0,252,32,2,0,14,15,10,0,1,15,3,0,1,14,190,44,134,13,0,0,252,32,2,0,15,14,9,0,137,11,0,0,1,13,0,0,139,13,0,0,1,13,0,0,139,13,0,0,140,5,19,0,0,0,0,0,136,13,0,0,0,11,13,0,136,13,0,0,25,13,13,32,137,13,0,0,130,13,0,0,136,14,0,0,49,13,13,14,200,19,2,0,1,14,32,0,135,13,0,0,14,0,0,0,25,6,11,20,25,7,11,16,25,8,11,12,25,9,11,8,25,10,11,4,0,5,11,0,85,6,0,0,85,7,1,0,85,8,2,0,85,9,3,0,85,10,4,0,82,13,8,0,26,13,13,1,82,14,7,0,49,13,13,14,16,20,2,0,137,11,0,0,139,0,0,0,82,12,7,0,82,13,8,0,4,13,13,12,28,13,13,2,3,13,12,13,85,5,13,0,82,14,6,0,82,15,7,0,82,16,8,0,82,17,9,0,82,18,5,0,134,13,0,0,192,232,1,0,14,15,16,17,18,0,0,0,85,5,13,0,82,13,10,0,82,18,5,0,47,13,13,18,132,20,2,0,82,18,6,0,82,17,7,0,82,16,5,0,82,15,9,0,82,14,10,0,134,13,0,0,144,19,2,0,18,17,16,15,14,0,0,0,82,13,10,0,82,14,5,0,49,13,13,14,156,20,2,0,137,11,0,0,139,0,0,0,82,14,6,0,82,15,5,0,25,15,15,1,82,16,8,0,82,17,9,0,82,18,10,0,134,13,0,0,144,19,2,0,14,15,16,17,18,0,0,0,137,11,0,0,139,0,0,0,140,2,17,0,0,0,0,0,2,10,0,0,176,0,0,0,2,11,0,0,168,0,0,0,136,12,0,0,0,7,12,0,136,12,0,0,25,12,12,16,137,12,0,0,130,12,0,0,136,13,0,0,49,12,12,13,20,21,2,0,1,13,16,0,135,12,0,0,13,0,0,0,25,3,7,12,25,4,7,8,25,5,7,4,0,6,7,0,85,3,0,0,85,4,1,0,82,12,3,0,1,13,172,0,82,14,4,0,97,12,13,14,82,14,3,0,3,2,14,10,82,14,3,0,94,14,14,10,34,14,14,0,121,14,9,0,1,14,0,0,85,2,14,0,1,14,0,0,85,5,14,0,82,14,3,0,82,13,4,0,97,14,11,13,119,0,23,0,82,9,3,0,82,13,2,0,1,14,172,0,94,14,9,14,94,12,9,11,4,14,14,12,3,13,13,14,1,14,164,0,94,14,9,14,8,13,13,14,85,5,13,0,82,13,5,0,82,14,3,0,94,14,14,10,53,13,13,14,204,21,2,0,1,14,174,51,1,12,90,48,1,15,151,5,1,16,231,51,135,13,8,0,14,12,15,16,82,8,3,0,1,16,180,0,94,16,8,16,82,15,5,0,1,12,160,0,94,12,8,12,29,12,12,4,134,13,0,0,240,135,2,0,16,15,12,0,85,6,13,0,82,12,6,0,1,15,0,0,82,16,3,0,1,14,160,0,94,16,16,14,135,13,3,0,12,15,16,0,137,7,0,0,82,13,6,0,139,13,0,0,140,3,20,0,0,0,0,0,1,17,0,0,16,17,17,1,32,18,1,0,1,19,255,255,16,19,19,0,19,18,18,19,20,17,17,18,121,17,38,0,0,6,2,0,0,12,0,0,0,13,1,0,0,14,12,0,1,17,10,0,1,18,0,0,134,12,0,0,180,154,2,0,12,13,17,18,0,15,13,0,135,13,1,0,1,18,10,0,1,17,0,0,134,9,0,0,92,131,2,0,12,13,18,17,135,17,1,0,134,10,0,0,64,151,2,0,14,15,9,17,135,17,1,0,26,6,6,1,1,17,255,0,19,17,10,17,39,17,17,48,83,6,17,0,1,17,9,0,16,17,17,15,32,18,15,9,1,19,255,255,16,19,19,14,19,18,18,19,20,17,17,18,120,17,226,255,0,3,12,0,0,5,6,0,119,0,3,0,0,3,0,0,0,5,2,0,120,3,3,0,0,7,5,0,119,0,16,0,0,4,3,0,0,8,5,0,0,16,4,0,29,4,4,10,26,11,8,1,27,17,4,10,4,17,16,17,39,17,17,48,83,11,17,0,35,17,16,10,121,17,3,0,0,7,11,0,119,0,3,0,0,8,11,0,119,0,244,255,139,7,0,0,140,3,15,0,0,0,0,0,2,10,0,0,192,100,0,0,2,11,0,0,0,4,0,0,2,12,0,0,192,104,0,0,136,13,0,0,0,8,13,0,136,13,0,0,25,13,13,32,137,13,0,0,130,13,0,0,136,14,0,0,49,13,13,14,128,23,2,0,1,14,32,0,135,13,0,0,14,0,0,0,25,3,8,12,25,4,8,16,25,5,8,8,25,6,8,4,0,7,8,0,85,3,0,0,83,4,1,0,85,5,2,0,1,14,0,0,135,13,3,0,10,14,11,0,85,12,10,0,1,13,0,0,85,6,13,0,82,13,3,0,121,13,41,0,1,13,1,0,85,6,13,0,1,13,0,0,85,7,13,0,82,13,7,0,56,13,11,13,96,24,2,0,82,9,7,0,82,14,3,0,90,14,14,9,95,10,9,14,82,14,7,0,90,14,10,14,120,14,2,0,119,0,26,0,82,14,7,0,90,14,10,14,78,13,4,0,45,14,14,13,80,24,2,0,82,14,7,0,1,13,0,0,95,10,14,13,82,13,6,0,41,13,13,2,82,14,7,0,3,14,10,14,25,14,14,1,97,12,13,14,82,14,6,0,25,14,14,1,85,6,14,0,82,14,6,0,1,13,128,0,52,14,14,13,96,24,2,0,82,14,7,0,25,14,14,1,85,7,14,0,119,0,221,255,82,14,5,0,116,14,6,0,137,8,0,0,139,12,0,0,140,4,21,0,0,0,0,0,1,16,0,0,136,18,0,0,0,17,18,0,136,18,0,0,1,19,160,0,3,18,18,19,137,18,0,0,130,18,0,0,136,19,0,0,49,18,18,19,176,24,2,0,1,19,160,0,135,18,0,0,19,0,0,0,1,18,144,0,3,13,17,18,0,14,17,0,1,19,0,29,1,20,144,0,135,18,32,0,14,19,20,0,2,18,0,0,254,255,255,127,26,20,1,1,48,18,18,20,12,25,2,0,120,1,5,0,0,5,13,0,1,6,1,0,1,16,4,0,119,0,10,0,134,18,0,0,136,162,2,0,1,20,61,0,85,18,20,0,1,4,255,255,119,0,4,0,0,5,0,0,0,6,1,0,1,16,4,0,32,20,16,4,121,20,28,0,1,20,254,255,4,7,20,5,16,20,7,6,125,15,20,7,6,0,0,0,109,14,48,15,25,8,14,20,85,8,5,0,109,14,44,5,3,9,5,15,25,10,14,16,85,10,9,0,109,14,28,9,134,11,0,0,200,157,2,0,14,2,3,0,120,15,3,0,0,4,11,0,119,0,9,0,82,12,8,0,82,20,10,0,13,20,12,20,41,20,20,31,42,20,20,31,1,18,0,0,95,12,20,18,0,4,11,0,137,17,0,0,139,4,0,0,140,2,17,0,0,0,0,0,136,12,0,0,0,11,12,0,136,12,0,0,25,12,12,16,137,12,0,0,130,12,0,0,136,13,0,0,49,12,12,13,204,25,2,0,1,13,16,0,135,12,0,0,13,0,0,0,25,6,11,8,25,8,11,4,0,10,11,0,85,8,0,0,89,10,1,0,82,12,8,0,120,12,7,0,1,13,144,57,1,14,90,48,1,15,116,3,1,16,156,57,135,12,8,0,13,14,15,16,1,12,6,0,82,16,8,0,50,12,12,16,40,26,2,0,1,16,186,57,1,15,90,48,1,14,117,3,1,13,156,57,135,12,8,0,16,15,14,13,88,13,10,0,145,13,13,0,134,12,0,0,200,149,2,0,13,0,0,0,33,2,12,0,1,12,160,20,82,13,8,0,41,13,13,3,3,12,12,13,106,3,12,4,88,4,10,0,145,4,4,0,121,2,21,0,59,12,1,0,145,12,12,0,66,5,12,4,145,5,5,0,38,15,3,7,135,14,234,0,15,5,0,0,145,14,14,0,59,15,2,0,145,15,15,0,65,13,14,15,145,13,13,0,135,12,11,0,13,0,0,0,75,12,12,0,85,6,12,0,82,9,6,0,137,11,0,0,139,9,0,0,119,0,20,0,38,13,3,7,135,12,234,0,13,4,0,0,145,12,12,0,59,13,2,0,145,13,13,0,65,7,12,13,145,7,7,0,88,15,10,0,145,15,15,0,66,12,7,15,145,12,12,0,135,13,11,0,12,0,0,0,75,13,13,0,85,6,13,0,82,9,6,0,137,11,0,0,139,9,0,0,1,13,0,0,139,13,0,0,140,1,7,0,0,0,0,0,136,4,0,0,0,3,4,0,136,4,0,0,25,4,4,16,137,4,0,0,130,4,0,0,136,5,0,0,49,4,4,5,60,27,2,0,1,5,16,0,135,4,0,0,5,0,0,0,25,1,3,4,0,2,3,0,85,1,0,0,1,4,0,0,85,2,4,0,82,4,1,0,1,5,0,0,1,6,16,0,138,4,5,6,164,27,2,0,176,27,2,0,188,27,2,0,200,27,2,0,212,27,2,0,224,27,2,0,236,27,2,0,248,27,2,0,4,28,2,0,16,28,2,0,28,28,2,0,40,28,2,0,52,28,2,0,64,28,2,0,76,28,2,0,88,28,2,0,119,0,49,0,1,5,7,0,85,2,5,0,119,0,46,0,1,5,6,0,85,2,5,0,119,0,43,0,1,5,8,0,85,2,5,0,119,0,40,0,1,5,5,0,85,2,5,0,119,0,37,0,1,5,9,0,85,2,5,0,119,0,34,0,1,5,11,0,85,2,5,0,119,0,31,0,1,5,10,0,85,2,5,0,119,0,28,0,1,5,12,0,85,2,5,0,119,0,25,0,1,5,13,0,85,2,5,0,119,0,22,0,1,5,15,0,85,2,5,0,119,0,19,0,1,5,16,0,85,2,5,0,119,0,16,0,1,5,17,0,85,2,5,0,119,0,13,0,1,5,1,0,85,2,5,0,119,0,10,0,1,5,3,0,85,2,5,0,119,0,7,0,1,5,4,0,85,2,5,0,119,0,4,0,1,5,2,0,85,2,5,0,119,0,1,0,137,3,0,0,82,4,2,0,139,4,0,0,140,4,17,0,0,0,0,0,136,14,0,0,0,9,14,0,136,14,0,0,25,14,14,16,137,14,0,0,130,14,0,0,136,15,0,0,49,14,14,15,168,28,2,0,1,15,16,0,135,14,0,0,15,0,0,0,25,4,9,3,25,5,9,2,25,7,9,1,0,8,9,0,83,4,0,0,83,5,1,0,83,7,2,0,83,8,3,0,1,14,192,81,1,15,220,115,82,15,15,0,27,15,15,48,3,10,14,15,106,15,10,20,106,14,10,8,41,14,14,2,78,16,4,0,95,15,14,16,1,16,192,81,1,14,220,115,82,14,14,0,27,14,14,48,3,11,16,14,106,14,11,20,106,16,11,8,41,16,16,2,25,16,16,1,78,15,5,0,95,14,16,15,1,15,192,81,1,16,220,115,82,16,16,0,27,16,16,48,3,12,15,16,106,16,12,20,106,15,12,8,41,15,15,2,25,15,15,2,78,14,7,0,95,16,15,14,1,14,192,81,1,15,220,115,82,15,15,0,27,15,15,48,3,13,14,15,106,15,13,20,106,14,13,8,41,14,14,2,25,14,14,3,78,16,8,0,95,15,14,16,1,16,192,81,1,14,220,115,82,14,14,0,27,14,14,48,3,16,16,14,25,6,16,8,82,16,6,0,25,16,16,1,85,6,16,0,137,9,0,0,139,0,0,0,140,2,12,0,0,0,0,0,1,4,0,0,136,6,0,0,0,5,6,0,136,6,0,0,25,6,6,32,137,6,0,0,130,6,0,0,136,7,0,0,49,6,6,7,220,29,2,0,1,7,32,0,135,6,0,0,7,0,0,0,0,3,5,0,25,2,5,4,1,6,0,0,85,2,6,0,1,7,0,0,109,2,4,7,1,6,0,0,109,2,8,6,1,7,0,0,109,2,12,7,1,6,0,0,109,2,16,6,82,6,1,0,121,6,20,0,106,6,1,4,121,6,16,0,106,6,1,8,121,6,12,0,82,7,1,0,106,8,1,4,106,9,1,8,106,10,1,16,106,11,1,12,134,6,0,0,8,70,1,0,7,8,9,10,11,0,0,0,85,2,6,0,119,0,6,0,1,4,5,0,119,0,4,0,1,4,5,0,119,0,2,0,1,4,5,0,32,6,4,5,121,6,6,0,1,11,4,0,1,10,104,58,134,6,0,0,252,32,2,0,11,10,3,0,106,10,1,4,109,2,4,10,106,6,1,8,109,2,8,6,106,10,1,12,109,2,12,10,106,6,1,16,109,2,16,6,116,0,2,0,106,10,2,4,109,0,4,10,106,6,2,8,109,0,8,6,106,10,2,12,109,0,12,10,106,6,2,16,109,0,16,6,137,5,0,0,139,0,0,0,140,3,19,0,0,0,0,0,1,13,0,0,136,16,0,0,0,14,16,0,136,16,0,0,25,16,16,16,137,16,0,0,130,16,0,0,136,17,0,0,49,16,16,17,8,31,2,0,1,17,16,0,135,16,0,0,17,0,0,0,25,7,14,8,25,10,14,4,0,11,14,0,85,7,0,0,85,10,1,0,85,11,2,0,82,12,7,0,82,16,11,0,82,16,16,0,34,16,16,8,120,16,44,0,120,12,3,0,1,13,5,0,119,0,11,0,82,16,7,0,26,16,16,8,82,16,16,0,82,17,7,0,26,17,17,8,106,17,17,4,25,17,17,1,49,16,16,17,104,31,2,0,1,13,5,0,32,16,13,5,121,16,7,0,1,13,0,0,1,17,1,0,1,18,1,0,134,16,0,0,116,12,2,0,7,17,18,0,82,16,10,0,82,16,16,0,1,18,255,0,19,16,16,18,0,3,16,0,82,15,7,0,0,4,15,0,26,16,15,8,25,5,16,4,82,6,5,0,25,16,6,1,85,5,16,0,95,4,6,3,82,8,10,0,82,16,8,0,43,16,16,8,85,8,16,0,82,9,11,0,82,16,9,0,26,16,16,8,85,9,16,0,119,0,209,255,137,14,0,0,139,12,0,0,140,9,43,0,0,0,0,0,136,20,0,0,0,19,20,0,136,20,0,0,25,20,20,48,137,20,0,0,130,20,0,0,136,21,0,0,49,20,20,21,32,32,2,0,1,21,48,0,135,20,0,0,21,0,0,0,25,18,19,32,25,9,19,28,25,10,19,24,25,11,19,20,25,12,19,16,25,13,19,12,25,14,19,8,25,15,19,4,0,16,19,0,85,18,0,0,85,9,1,0,85,10,2,0,85,11,3,0,85,12,4,0,85,13,5,0,85,14,6,0,85,15,7,0,85,16,8,0,1,20,0,0,82,21,18,0,82,22,9,0,82,23,10,0,82,24,11,0,82,25,12,0,82,26,13,0,82,27,14,0,82,28,15,0,59,29,0,0,145,29,29,0,59,30,0,0,145,30,30,0,59,31,1,0,145,31,31,0,59,32,1,0,145,32,32,0,1,33,0,0,82,34,16,0,1,35,255,255,1,36,0,0,1,37,0,0,1,38,0,0,1,39,0,0,1,40,1,0,1,41,1,0,1,42,0,0,134,17,0,0,160,126,1,0,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,0,137,19,0,0,139,17,0,0,140,3,13,0,0,0,0,0,136,10,0,0,0,8,10,0,136,10,0,0,1,11,160,0,3,10,10,11,137,10,0,0,130,10,0,0,136,11,0,0,49,10,10,11,56,33,2,0,1,11,160,0,135,10,0,0,11,0,0,0,1,10,148,0,3,3,8,10,1,10,144,0,3,4,8,10,1,10,128,0,3,5,8,10,0,6,8,0,85,3,0,0,85,4,1,0,82,10,3,0,34,10,10,3,121,10,3,0,137,8,0,0,139,0,0,0,85,5,2,0,0,7,6,0,1,10,128,0,3,9,7,10,1,10,0,0,85,7,10,0,25,7,7,4,54,10,7,9,128,33,2,0,82,10,3,0,1,11,1,0,1,12,6,0,138,10,11,12,192,33,2,0,208,33,2,0,224,33,2,0,240,33,2,0,0,34,2,0,16,34,2,0,119,0,25,0,1,12,97,61,135,11,16,0,6,12,0,0,119,0,21,0,1,12,105,61,135,11,16,0,6,12,0,0,119,0,17,0,1,12,113,61,135,11,16,0,6,12,0,0,119,0,13,0,1,12,120,61,135,11,16,0,6,12,0,0,119,0,9,0,1,12,130,61,135,11,16,0,6,12,0,0,119,0,5,0,1,12,138,61,135,11,16,0,6,12,0,0,119,0,1,0,82,11,4,0,135,10,21,1,6,11,0,0,1,11,146,61,135,10,21,1,6,11,0,0,134,10,0,0,224,158,2,0,6,5,0,0,1,10,5,0,82,11,3,0,49,10,10,11,100,34,2,0,1,11,1,0,135,10,22,1,11,0,0,0,119,0,3,0,137,8,0,0,139,0,0,0,139,0,0,0,140,1,14,0,0,0,0,0,2,11,0,0,108,7,0,0,120,0,53,0,1,12,176,29,82,12,12,0,120,12,3,0,1,8,0,0,119,0,6,0,1,12,176,29,82,12,12,0,134,8,0,0,112,34,2,0,12,0,0,0,134,12,0,0,220,161,2,0,82,2,12,0,120,2,3,0,0,4,8,0,119,0,33,0,0,3,2,0,0,5,8,0,1,12,255,255,106,13,3,76,47,12,12,13,236,34,2,0,134,7,0,0,80,162,2,0,3,0,0,0,119,0,2,0,1,7,0,0,106,12,3,28,106,13,3,20,48,12,12,13,24,35,2,0,134,12,0,0,100,95,2,0,3,0,0,0,20,12,12,5,0,6,12,0,119,0,2,0,0,6,5,0,121,7,4,0,134,12,0,0,68,162,2,0,3,0,0,0,106,3,3,56,120,3,3,0,0,4,6,0,119,0,3,0,0,5,6,0,119,0,227,255,134,12,0,0,24,162,2,0,0,1,4,0,119,0,22,0,106,12,0,76,36,12,12,255,121,12,5,0,134,1,0,0,100,95,2,0,0,0,0,0,119,0,15,0,134,12,0,0,80,162,2,0,0,0,0,0,32,10,12,0,134,9,0,0,100,95,2,0,0,0,0,0,121,10,3,0,0,1,9,0,119,0,5,0,134,12,0,0,68,162,2,0,0,0,0,0,0,1,9,0,139,1,0,0,140,2,12,0,0,0,0,0,136,9,0,0,0,8,9,0,136,9,0,0,25,9,9,32,137,9,0,0,130,9,0,0,136,10,0,0,49,9,9,10,228,35,2,0,1,10,32,0,135,9,0,0,10,0,0,0,25,2,8,20,25,3,8,16,25,4,8,12,25,5,8,8,25,6,8,4,0,7,8,0,85,2,0,0,85,3,1,0,1,10,0,0,82,11,2,0,134,9,0,0,100,42,2,0,10,11,0,0,1,11,0,0,82,10,2,0,134,9,0,0,100,42,2,0,11,10,0,0,1,10,0,0,82,11,2,0,134,9,0,0,100,42,2,0,10,11,0,0,1,9,1,0,85,4,9,0,1,9,1,0,82,11,3,0,82,11,11,0,22,9,9,11,82,11,4,0,56,9,9,11,244,36,2,0,82,9,3,0,25,9,9,4,82,11,4,0,91,9,9,11,85,5,9,0,82,9,3,0,1,11,4,1,3,9,9,11,82,11,4,0,91,9,9,11,85,6,9,0,82,9,3,0,1,11,4,2,3,9,9,11,82,11,4,0,91,9,9,11,85,7,9,0,82,11,5,0,82,10,2,0,134,9,0,0,100,42,2,0,11,10,0,0,82,10,6,0,82,11,2,0,134,9,0,0,100,42,2,0,10,11,0,0,82,11,7,0,82,10,2,0,134,9,0,0,100,42,2,0,11,10,0,0,82,9,4,0,25,9,9,1,85,4,9,0,119,0,214,255,137,8,0,0,139,0,0,0,140,3,8,0,0,0,0,0,2,4,0,0,128,0,0,0,120,0,3,0,1,3,1,0,119,0,91,0,35,5,1,128,121,5,4,0,83,0,1,0,1,3,1,0,119,0,86,0,134,5,0,0,148,161,2,0,1,6,188,0,94,5,5,6,82,5,5,0,120,5,15,0,38,5,1,128,2,6,0,0,128,223,0,0,45,5,5,6,100,37,2,0,83,0,1,0,1,3,1,0,119,0,72,0,134,5,0,0,136,162,2,0,1,6,25,0,85,5,6,0,1,3,255,255,119,0,66,0,1,6,0,8,48,6,1,6,172,37,2,0,43,6,1,6,1,5,192,0,20,6,6,5,83,0,6,0,38,5,1,63,20,5,5,4,107,0,1,5,1,3,2,0,119,0,54,0,2,5,0,0,0,216,0,0,16,5,1,5,1,6,0,224,19,6,1,6,2,7,0,0,0,224,0,0,13,6,6,7,20,5,5,6,121,5,14,0,43,5,1,12,1,6,224,0,20,5,5,6,83,0,5,0,43,6,1,6,38,6,6,63,20,6,6,4,107,0,1,6,38,5,1,63,20,5,5,4,107,0,2,5,1,3,3,0,119,0,31,0,2,5,0,0,0,0,1,0,4,5,1,5,2,6,0,0,0,0,16,0,48,5,5,6,104,38,2,0,43,5,1,18,1,6,240,0,20,5,5,6,83,0,5,0,43,6,1,12,38,6,6,63,20,6,6,4,107,0,1,6,43,5,1,6,38,5,5,63,20,5,5,4,107,0,2,5,38,6,1,63,20,6,6,4,107,0,3,6,1,3,4,0,119,0,7,0,134,6,0,0,136,162,2,0,1,5,25,0,85,6,5,0,1,3,255,255,119,0,1,0,139,3,0,0,140,4,19,0,0,0,0,0,136,16,0,0,0,15,16,0,136,16,0,0,25,16,16,32,137,16,0,0,130,16,0,0,136,17,0,0,49,16,16,17,188,38,2,0,1,17,32,0,135,16,0,0,17,0,0,0,25,9,15,19,25,10,15,18,25,11,15,17,25,12,15,16,25,13,15,12,25,14,15,8,25,4,15,4,0,5,15,0,83,9,0,0,83,10,1,0,83,11,2,0,83,12,3,0,79,17,9,0,76,17,17,0,145,17,17,0,59,18,255,0,145,18,18,0,66,16,17,18,145,16,16,0,89,13,16,0,79,18,10,0,76,18,18,0,145,18,18,0,59,17,255,0,145,17,17,0,66,16,18,17,145,16,16,0,89,14,16,0,79,17,11,0,76,17,17,0,145,17,17,0,59,18,255,0,145,18,18,0,66,16,17,18,145,16,16,0,89,4,16,0,79,18,12,0,76,18,18,0,145,18,18,0,59,17,255,0,145,17,17,0,66,16,18,17,145,16,16,0,89,5,16,0,88,6,13,0,145,6,6,0,88,7,14,0,145,7,7,0,88,8,4,0,145,8,8,0,88,17,5,0,145,17,17,0,135,16,25,0,6,7,8,17,137,15,0,0,139,0,0,0,140,1,15,0,0,0,0,0,136,11,0,0,0,10,11,0,136,11,0,0,25,11,11,32,137,11,0,0,130,11,0,0,136,12,0,0,49,11,11,12,212,39,2,0,1,12,32,0,135,11,0,0,12,0,0,0,25,1,10,20,25,3,10,16,25,4,10,12,25,6,10,8,25,7,10,4,0,8,10,0,89,1,0,0,88,9,1,0,145,9,9,0,1,12,164,29,88,11,12,0,145,11,11,0,73,11,9,11,120,11,5,0,1,12,164,29,88,11,12,0,145,11,11,0,89,1,11,0,88,2,1,0,145,2,2,0,1,12,168,29,88,11,12,0,145,11,11,0,73,11,2,11,121,11,5,0,1,12,168,29,88,11,12,0,145,11,11,0,89,1,11,0,88,11,1,0,145,11,11,0,89,8,11,0,1,11,208,24,82,12,8,0,1,13,164,29,82,13,13,0,4,12,12,13,43,12,12,20,41,12,12,2,3,11,11,12,116,3,11,0,82,11,3,0,43,11,11,16,41,11,11,9,85,4,11,0,82,11,3,0,2,12,0,0,255,255,0,0,19,11,11,12,85,6,11,0,82,11,8,0,43,11,11,12,1,12,255,0,19,11,11,12,85,7,11,0,82,11,4,0,82,13,6,0,82,14,7,0,5,12,13,14,3,11,11,12,43,11,11,16,1,12,255,0,19,11,11,12,0,5,11,0,137,10,0,0,139,5,0,0,140,3,8,0,0,0,0,0,136,6,0,0,0,5,6,0,136,6,0,0,25,6,6,48,137,6,0,0,130,6,0,0,136,7,0,0,49,6,6,7,20,41,2,0,1,7,48,0,135,6,0,0,7,0,0,0,25,3,5,20,0,4,5,0,116,3,1,0,106,7,1,4,109,3,4,7,106,6,1,8,109,3,8,6,106,7,1,12,109,3,12,7,106,6,1,16,109,3,16,6,134,6,0,0,212,223,1,0,4,3,0,0,116,3,2,0,106,7,2,4,109,3,4,7,106,6,2,8,109,3,8,6,106,7,2,12,109,3,12,7,134,7,0,0,164,86,1,0,4,3,0,0,116,0,4,0,106,6,4,4,109,0,4,6,106,7,4,8,109,0,8,7,106,6,4,12,109,0,12,6,106,7,4,16,109,0,16,7,137,5,0,0,139,0,0,0,140,4,14,0,0,0,0,0,136,12,0,0,0,11,12,0,136,12,0,0,25,12,12,48,137,12,0,0,130,12,0,0,136,13,0,0,49,12,12,13,216,41,2,0,1,13,48,0,135,12,0,0,13,0,0,0,25,5,11,32,25,4,11,24,25,7,11,16,25,8,11,12,25,9,11,8,0,10,11,0,85,7,0,0,85,8,1,0,89,9,2,0,82,12,7,0,76,12,12,0,145,12,12,0,89,10,12,0,82,13,8,0,76,13,13,0,145,13,13,0,113,10,4,13,88,6,9,0,145,6,6,0,116,4,10,0,106,12,10,4,109,4,4,12,78,12,3,0,83,5,12,0,102,13,3,1,107,5,1,13,102,12,3,2,107,5,2,12,102,13,3,3,107,5,3,13,134,13,0,0,68,104,2,0,4,6,5,0,137,11,0,0,139,0,0,0,140,2,15,0,0,0,0,0,2,13,0,0,255,0,0,0,1,12,0,0,106,14,1,76,34,14,14,0,121,14,3,0,1,12,3,0,119,0,36,0,134,14,0,0,80,162,2,0,1,0,0,0,120,14,3,0,1,12,3,0,119,0,30,0,19,14,0,13,0,5,14,0,19,14,0,13,0,6,14,0,102,14,1,75,45,14,6,14,200,42,2,0,1,12,10,0,119,0,12,0,25,7,1,20,82,8,7,0,106,14,1,16,48,14,8,14,240,42,2,0,25,14,8,1,85,7,14,0,83,8,5,0,0,9,6,0,119,0,2,0,1,12,10,0,32,14,12,10,121,14,4,0,134,9,0,0,36,52,2,0,1,0,0,0,134,14,0,0,68,162,2,0,1,0,0,0,0,2,9,0,32,14,12,3,121,14,21,0,19,14,0,13,0,10,14,0,19,14,0,13,0,11,14,0,102,14,1,75,46,14,11,14,100,43,2,0,25,3,1,20,82,4,3,0,106,14,1,16,48,14,4,14,100,43,2,0,25,14,4,1,85,3,14,0,83,4,10,0,0,2,11,0,119,0,4,0,134,2,0,0,36,52,2,0,1,0,0,0,139,2,0,0,140,0,8,0,0,0,0,0,1,3,192,81,1,4,220,115,82,4,4,0,27,4,4,48,94,3,3,4,36,3,3,0,121,3,2,0,139,0,0,0,1,3,161,120,78,3,3,0,38,3,3,1,121,3,12,0,1,4,236,115,82,4,4,0,38,4,4,31,1,5,192,81,1,6,220,115,82,6,6,0,27,6,6,48,3,5,5,6,106,5,5,28,135,3,198,0,4,5,0,0,2,4,0,0,146,136,0,0,1,5,192,81,1,6,220,115,82,6,6,0,27,6,6,48,3,5,5,6,106,5,5,32,135,3,199,0,4,5,0,0,1,3,192,81,1,5,220,115,82,5,5,0,27,5,5,48,3,0,3,5,2,3,0,0,146,136,0,0,1,4,0,0,82,6,0,0,27,6,6,12,106,7,0,12,135,5,23,1,3,4,6,7,2,7,0,0,146,136,0,0,1,6,192,81,1,4,220,115,82,4,4,0,27,4,4,48,3,6,6,4,25,6,6,32,106,6,6,4,135,5,199,0,7,6,0,0,1,5,192,81,1,6,220,115,82,6,6,0,27,6,6,48,3,1,5,6,2,5,0,0,146,136,0,0,1,7,0,0,82,4,1,0,41,4,4,3,106,3,1,16,135,6,23,1,5,7,4,3,2,3,0,0,146,136,0,0,1,4,192,81,1,7,220,115,82,7,7,0,27,7,7,48,3,4,4,7,25,4,4,32,106,4,4,8,135,6,199,0,3,4,0,0,1,6,192,81,1,4,220,115,82,4,4,0,27,4,4,48,3,2,6,4,2,6,0,0,146,136,0,0,1,3,0,0,82,7,2,0,41,7,7,2,106,5,2,20,135,4,23,1,6,3,7,5,1,4,161,120,78,4,4,0,38,4,4,1,120,4,2,0,139,0,0,0,1,5,236,115,82,5,5,0,38,5,5,31,1,7,0,0,135,4,198,0,5,7,0,0,139,0,0,0,140,0,9,0,0,0,0,0,136,4,0,0,0,3,4,0,136,4,0,0,25,4,4,16,137,4,0,0,130,4,0,0,136,5,0,0,49,4,4,5,92,45,2,0,1,5,16,0,135,4,0,0,5,0,0,0,25,0,3,8,25,1,3,4,0,2,3,0,134,4,0,0,44,117,2,0,1,4,245,255,83,1,4,0,1,5,245,255,107,1,1,5,1,4,245,255,107,1,2,4,1,5,255,255,107,1,3,5,78,5,1,0,83,0,5,0,102,4,1,1,107,0,1,4,102,5,1,2,107,0,2,5,102,4,1,3,107,0,3,4,134,4,0,0,192,153,2,0,0,0,0,0,1,4,200,255,83,2,4,0,1,5,200,255,107,2,1,5,1,4,200,255,107,2,2,4,1,5,255,255,107,2,3,5,78,5,2,0,83,0,5,0,102,4,2,1,107,0,1,4,102,5,2,2,107,0,2,5,102,4,2,3,107,0,3,4,1,5,199,30,1,6,20,0,1,7,20,0,1,8,40,0,134,4,0,0,92,222,1,0,5,6,7,8,0,0,0,0,134,4,0,0,172,203,1,0,137,3,0,0,139,0,0,0,140,1,6,0,0,0,0,0,1,4,230,61,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,34,0,119,0,130,0,1,4,243,61,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,35,0,119,0,123,0,1,4,3,62,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,13,0,119,0,116,0,1,4,13,62,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,36,0,119,0,109,0,1,4,26,62,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,21,0,119,0,102,0,1,4,37,62,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,37,0,119,0,95,0,1,4,52,62,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,30,0,119,0,88,0,1,4,65,62,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,31,0,119,0,81,0,1,4,84,62,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,32,0,119,0,74,0,1,4,104,62,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,33,0,119,0,67,0,1,4,125,62,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,34,0,119,0,60,0,1,4,147,62,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,22,0,119,0,53,0,1,4,165,62,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,38,0,119,0,46,0,1,4,186,62,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,39,0,119,0,39,0,1,4,204,62,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,14,0,119,0,32,0,1,4,220,62,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,40,0,119,0,25,0,1,4,234,62,134,3,0,0,212,124,2,0], eb + 133120);
  HEAPU8.set([0,4,0,0,120,3,3,0,1,1,24,0,119,0,18,0,1,4,0,63,134,3,0,0,212,124,2,0,0,4,0,0,120,3,3,0,1,1,5,0,119,0,11,0,1,4,24,63,134,3,0,0,212,124,2,0,0,4,0,0,32,2,3,0,1,4,6,0,1,5,0,0,125,3,2,4,5,0,0,0,139,3,0,0,139,1,0,0,140,2,14,0,0,0,0,0,136,12,0,0,0,10,12,0,136,12,0,0,25,12,12,16,137,12,0,0,130,12,0,0,136,13,0,0,49,12,12,13,144,48,2,0,1,13,16,0,135,12,0,0,13,0,0,0,25,4,10,4,0,7,10,0,85,4,0,0,85,7,1,0,82,12,7,0,38,12,12,1,85,7,12,0,82,12,7,0,82,13,4,0,79,13,13,0,22,12,12,13,85,7,12,0,82,12,4,0,25,2,12,1,79,12,2,0,82,13,7,0,20,12,12,13,83,2,12,0,82,3,4,0,78,12,3,0,25,12,12,1,41,12,12,24,42,12,12,24,83,3,12,0,82,12,4,0,79,12,12,0,36,12,12,7,121,12,3,0,137,10,0,0,139,0,0,0,82,11,4,0,102,5,11,1,25,6,11,8,25,8,11,4,82,9,8,0,25,12,9,1,85,8,12,0,95,6,9,5,82,12,4,0,1,13,0,0,83,12,13,0,82,13,4,0,1,12,0,0,107,13,1,12,137,10,0,0,139,0,0,0,140,2,15,0,0,0,0,0,136,11,0,0,0,10,11,0,136,11,0,0,25,11,11,16,137,11,0,0,130,11,0,0,136,12,0,0,49,11,11,12,128,49,2,0,1,12,16,0,135,11,0,0,12,0,0,0,25,5,10,8,25,7,10,4,0,8,10,0,85,7,0,0,89,8,1,0,88,12,8,0,145,12,12,0,134,11,0,0,200,149,2,0,12,0,0,0,33,9,11,0,1,11,160,20,82,12,7,0,41,12,12,3,3,11,11,12,106,2,11,4,88,3,8,0,145,3,3,0,121,9,21,0,59,11,1,0,145,11,11,0,66,4,11,3,145,4,4,0,38,14,2,7,135,13,234,0,14,4,0,0,145,13,13,0,59,14,2,0,145,14,14,0,65,12,13,14,145,12,12,0,135,11,11,0,12,0,0,0,75,11,11,0,85,5,11,0,82,6,5,0,137,10,0,0,139,6,0,0,119,0,16,0,38,13,2,7,135,14,234,0,13,3,0,0,145,14,14,0,59,13,2,0,145,13,13,0,65,12,14,13,145,12,12,0,135,11,11,0,12,0,0,0,75,11,11,0,85,5,11,0,82,6,5,0,137,10,0,0,139,6,0,0,1,11,0,0,139,11,0,0,140,4,14,0,0,0,0,0,136,12,0,0,0,9,12,0,136,12,0,0,25,12,12,80,137,12,0,0,130,12,0,0,136,13,0,0,49,12,12,13,152,50,2,0,1,13,80,0,135,12,0,0,13,0,0,0,25,4,9,72,25,5,9,68,25,6,9,64,0,7,9,0,89,4,1,0,89,5,2,0,89,6,3,0,0,8,7,0,25,11,8,64,1,12,0,0,85,8,12,0,25,8,8,4,54,12,8,11,188,50,2,0,88,12,4,0,145,12,12,0,89,7,12,0,88,13,5,0,145,13,13,0,113,7,20,13,88,12,6,0,145,12,12,0,113,7,40,12,59,13,1,0,145,13,13,0,113,7,60,13,0,8,0,0,0,10,7,0,25,11,8,64,116,8,10,0,25,8,8,4,25,10,10,4,54,13,8,11,12,51,2,0,137,9,0,0,139,0,0,0,140,2,16,0,0,0,0,0,103,14,1,1,41,14,14,16,79,15,1,0,41,15,15,24,20,14,14,15,103,15,1,2,41,15,15,8,20,14,14,15,103,15,1,3,20,14,14,15,0,6,14,0,25,7,0,3,78,8,7,0,103,14,0,1,41,14,14,16,79,15,0,0,41,15,15,24,20,14,14,15,103,15,0,2,41,15,15,8,20,14,14,15,1,15,255,0,19,15,8,15,20,14,14,15,0,9,14,0,41,14,8,24,42,14,14,24,32,10,14,0,13,14,9,6,20,14,14,10,121,14,4,0,0,2,7,0,0,5,10,0,119,0,21,0,0,3,7,0,0,4,9,0,25,11,3,1,78,12,11,0,41,14,4,8,1,15,255,0,19,15,12,15,20,14,14,15,0,4,14,0,41,14,12,24,42,14,14,24,32,13,14,0,13,14,4,6,20,14,14,13,121,14,4,0,0,2,11,0,0,5,13,0,119,0,3,0,0,3,11,0,119,0,239,255,121,5,4,0,1,15,0,0,0,14,15,0,119,0,3,0,26,15,2,3,0,14,15,0,139,14,0,0,140,2,16,0,0,0,0,0,1,11,0,0,136,13,0,0,0,12,13,0,136,13,0,0,25,13,13,16,137,13,0,0,130,13,0,0,136,14,0,0,49,13,13,14,96,52,2,0,1,14,16,0,135,13,0,0,14,0,0,0,0,6,12,0,1,13,255,0,19,13,1,13,0,7,13,0,83,6,7,0,25,8,0,16,82,9,8,0,120,9,10,0,134,13,0,0,96,136,2,0,0,0,0,0,120,13,4,0,82,4,8,0,1,11,4,0,119,0,5,0,1,2,255,255,119,0,3,0,0,4,9,0,1,11,4,0,32,13,11,4,121,13,26,0,25,10,0,20,82,3,10,0,48,13,3,4,240,52,2,0,1,13,255,0,19,13,1,13,0,5,13,0,102,13,0,75,46,13,5,13,240,52,2,0,25,13,3,1,85,10,13,0,83,3,7,0,0,2,5,0,119,0,11,0,106,14,0,36,38,14,14,15,1,15,1,0,135,13,4,1,14,0,6,15,32,13,13,1,121,13,3,0,79,2,6,0,119,0,2,0,1,2,255,255,137,12,0,0,139,2,0,0,140,2,16,0,0,0,0,0,136,10,0,0,0,7,10,0,136,10,0,0,25,10,10,16,137,10,0,0,130,10,0,0,136,11,0,0,49,10,10,11,88,53,2,0,1,11,16,0,135,10,0,0,11,0,0,0,25,3,7,4,0,6,7,0,85,3,0,0,85,6,1,0,82,11,3,0,82,12,6,0,134,10,0,0,156,64,0,0,11,12,0,0,82,8,3,0,106,12,8,124,1,11,0,0,106,14,8,20,106,15,8,64,5,13,14,15,41,13,13,2,135,10,3,0,12,11,13,0,82,13,3,0,134,10,0,0,28,149,2,0,13,0,0,0,33,2,10,0,82,9,3,0,0,4,9,0,106,5,9,124,121,2,7,0,134,10,0,0,136,131,0,0,4,5,0,0,137,7,0,0,139,0,0,0,119,0,6,0,134,10,0,0,96,88,0,0,4,5,0,0,137,7,0,0,139,0,0,0,139,0,0,0,140,1,10,0,0,0,0,0,136,8,0,0,0,3,8,0,136,8,0,0,25,8,8,16,137,8,0,0,130,8,0,0,136,9,0,0,49,8,8,9,44,54,2,0,1,9,16,0,135,8,0,0,9,0,0,0,25,1,3,4,0,2,3,0,85,1,0,0,82,4,1,0,82,8,1,0,79,8,8,0,103,9,4,1,41,9,9,8,3,8,8,9,103,9,4,2,41,9,9,16,3,8,8,9,85,2,8,0,82,8,2,0,82,9,2,0,41,9,9,3,21,8,8,9,85,2,8,0,82,5,2,0,43,8,5,5,3,8,5,8,85,2,8,0,82,8,2,0,82,9,2,0,41,9,9,4,21,8,8,9,85,2,8,0,82,6,2,0,43,8,6,17,3,8,6,8,85,2,8,0,82,8,2,0,82,9,2,0,41,9,9,25,21,8,8,9,85,2,8,0,82,7,2,0,43,8,7,6,3,8,7,8,85,2,8,0,137,3,0,0,82,8,2,0,139,8,0,0,140,2,16,0,0,0,0,0,103,14,1,1,41,14,14,16,79,15,1,0,41,15,15,24,20,14,14,15,103,15,1,2,41,15,15,8,20,14,14,15,0,6,14,0,25,7,0,2,78,8,7,0,103,14,0,1,41,14,14,16,79,15,0,0,41,15,15,24,20,14,14,15,1,15,255,0,19,15,8,15,41,15,15,8,20,14,14,15,0,9,14,0,41,14,8,24,42,14,14,24,32,10,14,0,13,14,9,6,20,14,14,10,121,14,4,0,0,2,7,0,0,5,10,0,119,0,21,0,0,3,7,0,0,4,9,0,25,11,3,1,78,12,11,0,1,14,255,0,19,14,12,14,20,14,4,14,41,14,14,8,0,4,14,0,41,14,12,24,42,14,14,24,32,13,14,0,13,14,4,6,20,14,14,13,121,14,4,0,0,2,11,0,0,5,13,0,119,0,3,0,0,3,11,0,119,0,239,255,121,5,4,0,1,15,0,0,0,14,15,0,119,0,3,0,26,15,2,2,0,14,15,0,139,14,0,0,140,3,13,0,0,0,0,0,2,9,0,0,127,29,0,0,136,10,0,0,0,7,10,0,136,10,0,0,25,10,10,16,137,10,0,0,130,10,0,0,136,11,0,0,49,10,10,11,4,56,2,0,1,11,16,0,135,10,0,0,11,0,0,0,25,4,7,8,25,5,7,4,0,6,7,0,109,7,12,0,85,4,1,0,85,5,2,0,134,10,0,0,24,132,2,0,1,10,252,117,82,12,4,0,41,12,12,2,135,11,6,0,12,0,0,0,85,10,11,0,1,11,0,0,85,6,11,0,82,11,4,0,82,10,6,0,56,11,11,10,172,56,2,0,1,11,0,2,135,3,6,0,11,0,0,0,1,11,252,117,82,11,11,0,82,10,6,0,41,10,10,2,97,11,10,3,82,10,6,0,41,10,10,2,0,8,10,0,1,11,252,117,82,11,11,0,94,11,11,8,82,12,5,0,94,12,12,8,135,10,16,0,11,12,0,0,82,10,6,0,25,10,10,1,85,6,10,0,119,0,231,255,1,10,0,118,82,12,4,0,85,10,12,0,137,7,0,0,139,0,0,0,140,4,15,0,0,0,0,0,136,12,0,0,0,11,12,0,136,12,0,0,25,12,12,32,137,12,0,0,130,12,0,0,136,13,0,0,49,12,12,13,248,56,2,0,1,13,32,0,135,12,0,0,13,0,0,0,25,6,11,16,25,7,11,12,25,8,11,8,25,9,11,4,0,10,11,0,89,7,0,0,85,8,1,0,85,9,2,0,85,10,3,0,88,13,7,0,145,13,13,0,134,12,0,0,200,149,2,0,13,0,0,0,121,12,6,0,116,6,10,0,82,5,6,0,137,11,0,0,139,5,0,0,119,0,14,0,82,4,9,0,82,13,8,0,88,14,7,0,145,14,14,0,134,12,0,0,200,141,2,0,13,14,0,0,41,12,12,1,3,12,4,12,85,6,12,0,82,5,6,0,137,11,0,0,139,5,0,0,1,12,0,0,139,12,0,0,140,6,15,0,0,0,0,0,136,13,0,0,0,12,13,0,136,13,0,0,25,13,13,32,137,13,0,0,130,13,0,0,136,14,0,0,49,13,13,14,188,57,2,0,1,14,32,0,135,13,0,0,14,0,0,0,25,8,12,20,25,9,12,16,25,10,12,12,25,11,12,8,25,6,12,4,0,7,12,0,85,8,0,0,85,9,1,0,85,10,2,0,85,11,3,0,85,6,4,0,85,7,5,0,82,13,8,0,82,14,9,0,109,13,4,14,82,14,8,0,82,13,10,0,109,14,8,13,82,13,8,0,82,14,11,0,109,13,20,14,82,14,8,0,82,13,6,0,109,14,24,13,82,13,8,0,82,14,7,0,109,13,64,14,137,12,0,0,139,0,0,0,140,6,18,0,0,0,0,0,136,15,0,0,0,14,15,0,136,15,0,0,25,15,15,32,137,15,0,0,130,15,0,0,136,16,0,0,49,15,15,16,104,58,2,0,1,16,32,0,135,15,0,0,16,0,0,0,25,10,14,24,25,11,14,20,25,12,14,16,25,13,14,12,25,6,14,8,25,7,14,4,0,8,14,0,85,10,0,0,85,11,1,0,85,12,2,0,85,13,3,0,85,6,4,0,85,7,5,0,82,15,12,0,82,16,10,0,82,17,13,0,4,16,16,17,3,15,15,16,82,16,6,0,8,15,15,16,85,8,15,0,82,15,11,0,82,16,8,0,82,17,7,0,134,9,0,0,240,135,2,0,15,16,17,0,137,14,0,0,139,9,0,0,140,2,11,0,0,0,0,0,136,8,0,0,0,6,8,0,136,8,0,0,25,8,8,16,137,8,0,0,130,8,0,0,136,9,0,0,49,8,8,9,20,59,2,0,1,9,16,0,135,8,0,0,9,0,0,0,25,2,6,8,25,3,6,4,0,4,6,0,85,2,0,0,85,3,1,0,82,7,3,0,82,9,2,0,82,9,9,0,1,10,0,0,4,10,10,7,3,9,9,10,26,9,9,4,25,10,7,4,134,8,0,0,28,113,2,0,9,10,0,0,85,4,8,0,82,8,2,0,82,8,8,0,82,10,4,0,43,10,10,24,83,8,10,0,82,10,2,0,82,10,10,0,82,8,4,0,43,8,8,16,107,10,1,8,82,8,2,0,82,8,8,0,82,10,4,0,43,10,10,8,107,8,2,10,82,10,2,0,82,10,10,0,82,8,4,0,107,10,3,8,82,5,2,0,82,8,5,0,25,8,8,4,85,5,8,0,137,6,0,0,139,0,0,0,140,3,12,0,0,0,0,0,1,7,0,0,136,9,0,0,0,8,9,0,136,9,0,0,25,9,9,16,137,9,0,0,130,9,0,0,136,10,0,0,49,9,9,10,248,59,2,0,1,10,16,0,135,9,0,0,10,0,0,0,25,3,8,12,25,4,8,8,25,5,8,4,0,6,8,0,85,3,0,0,85,4,1,0,85,5,2,0,1,9,0,0,85,6,9,0,82,10,6,0,82,11,5,0,47,10,10,11,64,60,2,0,82,10,6,0,1,11,2,1,15,10,10,11,0,9,10,0,119,0,3,0,1,10,0,0,0,9,10,0,120,9,3,0,1,7,5,0,119,0,15,0,82,9,3,0,82,10,6,0,91,9,9,10,82,10,4,0,82,11,6,0,91,10,10,11,46,9,9,10,124,60,2,0,1,7,5,0,119,0,5,0,82,9,6,0,25,9,9,1,85,6,9,0,119,0,229,255,32,9,7,5,121,9,4,0,137,8,0,0,82,9,6,0,139,9,0,0,1,9,0,0,139,9,0,0,140,2,13,0,0,0,0,0,127,9,0,0,87,9,0,0,127,9,0,0,82,4,9,0,127,9,0,0,106,5,9,4,1,9,52,0,135,6,24,1,4,5,9,0,135,9,1,0,1,9,255,7,19,9,6,9,1,11,0,0,1,10,0,8,138,9,11,10,52,93,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0], eb + 143360);
  HEAPU8.set([236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,236,92,2,0,124,93,2,0,1,10,255,7,19,10,6,10,1,11,254,3,4,10,10,11,85,1,10,0,127,10,0,0,85,10,4,0,127,10,0,0,2,11,0,0,255,255,15,128,19,11,5,11,2,12,0,0,0,0,224,63,20,11,11,12,109,10,4,11,127,11,0,0,86,2,11,0,119,0,21,0,59,10,0,0,70,10,0,10,121,10,11,0,61,10,0,0,0,0,128,95,65,10,0,10,134,7,0,0,168,60,2,0,10,1,0,0,58,3,7,0,82,10,1,0,26,8,10,64,119,0,3,0,58,3,0,0,1,8,0,0,85,1,8,0,58,2,3,0,119,0,3,0,58,2,0,0,119,0,1,0,139,2,0,0,140,2,10,0,0,0,0,0,136,7,0,0,0,6,7,0,136,7,0,0,25,7,7,32,137,7,0,0,130,7,0,0,136,8,0,0,49,7,7,8,192,93,2,0,1,8,32,0,135,7,0,0,8,0,0,0,0,5,6,0,25,2,6,16,25,3,6,8,85,2,1,0,1,7,156,29,82,7,7,0,85,3,7,0,1,8,160,29,82,8,8,0,109,3,4,8,82,8,2,0,34,8,8,10,121,8,14,0,1,8,240,81,82,7,2,0,41,7,7,3,3,4,8,7,116,3,4,0,106,8,4,4,109,3,4,8,116,0,3,0,106,7,3,4,109,0,4,7,137,6,0,0,139,0,0,0,119,0,13,0,1,7,10,0,85,5,7,0,1,8,4,0,1,9,188,43,134,7,0,0,252,32,2,0,8,9,5,0,116,0,3,0,106,9,3,4,109,0,4,9,137,6,0,0,139,0,0,0,139,0,0,0,140,0,8,0,0,0,0,0,136,5,0,0,0,2,5,0,136,5,0,0,25,5,5,64,137,5,0,0,130,5,0,0,136,6,0,0,49,5,5,6,148,94,2,0,1,6,64,0,135,5,0,0,6,0,0,0,0,0,2,0,1,5,0,0,1,6,144,115,82,6,6,0,47,5,5,6,24,95,2,0,0,1,0,0,1,5,192,73,1,6,144,115,82,6,6,0,26,6,6,1,41,6,6,6,3,3,5,6,25,4,1,64,116,1,3,0,25,1,1,4,25,3,3,4,54,6,1,4,204,94,2,0,1,6,76,115,82,1,6,0,0,3,0,0,25,4,1,64,116,1,3,0,25,1,1,4,25,3,3,4,54,6,1,4,240,94,2,0,1,6,144,115,1,5,144,115,82,5,5,0,26,5,5,1,85,6,5,0,1,5,144,115,82,5,5,0,32,5,5,0,1,6,144,29,82,6,6,0,1,7,0,23,13,6,6,7,19,5,5,6,120,5,3,0,137,2,0,0,139,0,0,0,1,5,76,115,1,6,80,115,85,5,6,0,1,6,160,120,1,5,0,0,83,6,5,0,137,2,0,0,139,0,0,0,140,1,14,0,0,0,0,0,1,9,0,0,25,2,0,20,25,8,0,28,82,10,8,0,82,11,2,0,48,10,10,11,184,95,2,0,106,11,0,36,38,11,11,15,1,12,0,0,1,13,0,0,135,10,4,1,11,0,12,13,82,10,2,0,120,10,3,0,1,1,255,255,119,0,4,0,1,9,3,0,119,0,2,0,1,9,3,0,32,10,9,3,121,10,29,0,25,3,0,4,82,4,3,0,25,5,0,8,82,6,5,0,48,10,4,6,8,96,2,0,4,7,4,6,106,11,0,40,38,11,11,3,34,13,7,0,41,13,13,31,42,13,13,31,1,12,1,0,135,10,25,1,11,0,7,13,12,0,0,0,135,10,1,0,1,11,0,0,109,0,16,11,1,11,0,0,85,8,11,0,1,11,0,0,85,2,11,0,1,11,0,0,85,5,11,0,1,11,0,0,85,3,11,0,1,1,0,0,139,1,0,0,140,2,18,0,0,0,0,0,136,12,0,0,0,11,12,0,136,12,0,0,25,12,12,16,137,12,0,0,130,12,0,0,136,13,0,0,49,12,12,13,112,96,2,0,1,13,16,0,135,12,0,0,13,0,0,0,0,5,11,0,88,7,0,0,145,7,7,0,88,12,1,0,145,12,12,0,64,8,7,12,145,8,8,0,88,9,0,0,145,9,9,0,88,13,1,0,145,13,13,0,64,12,9,13,145,12,12,0,65,10,8,12,145,10,10,0,112,2,0,4,145,2,2,0,112,12,1,4,145,12,12,0,64,3,2,12,145,3,3,0,112,4,0,4,145,4,4,0,112,16,1,4,145,16,16,0,64,15,4,16,145,15,15,0,65,14,3,15,145,14,14,0,63,13,10,14,145,13,13,0,135,12,230,0,13,0,0,0,145,12,12,0,89,5,12,0,88,6,5,0,145,6,6,0,137,11,0,0,145,12,6,0,139,12,0,0,140,4,13,0,0,0,0,0,136,10,0,0,0,9,10,0,136,10,0,0,25,10,10,32,137,10,0,0,130,10,0,0,136,11,0,0,49,10,10,11,72,97,2,0,1,11,32,0,135,10,0,0,11,0,0,0,25,4,9,16,25,5,9,12,25,6,9,8,25,7,9,4,0,8,9,0,85,4,0,0,85,5,1,0,85,6,2,0,85,7,3,0,1,10,0,0,85,8,10,0,82,10,7,0,82,11,8,0,57,10,10,11,220,97,2,0,82,11,5,0,82,12,6,0,134,10,0,0,88,48,2,0,11,12,0,0,82,10,6,0,43,10,10,1,85,6,10,0,82,10,5,0,106,10,10,4,1,12,255,0,45,10,10,12,204,97,2,0,82,12,4,0,82,11,5,0,134,10,0,0,100,122,2,0,12,11,0,0,82,10,8,0,25,10,10,1,85,8,10,0,119,0,231,255,137,9,0,0,139,0,0,0,140,3,12,0,0,0,0,0,136,9,0,0,0,8,9,0,136,9,0,0,25,9,9,16,137,9,0,0,130,9,0,0,136,10,0,0,49,9,9,10,28,98,2,0,1,10,16,0,135,9,0,0,10,0,0,0,25,5,8,8,25,6,8,4,0,7,8,0,85,5,0,0,85,6,1,0,85,7,2,0,82,9,6,0,120,9,13,0,82,11,5,0,112,10,11,56,145,10,10,0,134,9,0,0,200,149,2,0,10,0,0,0,33,3,9,0,1,10,4,0,1,11,5,0,125,9,3,10,11,0,0,0,85,6,9,0,82,9,7,0,120,9,13,0,82,10,5,0,112,11,10,60,145,11,11,0,134,9,0,0,200,149,2,0,11,0,0,0,33,4,9,0,1,11,4,0,1,10,5,0,125,9,4,11,10,0,0,0,85,7,9,0,82,9,5,0,82,10,6,0,109,9,80,10,82,10,5,0,82,9,7,0,109,10,84,9,137,8,0,0,139,0,0,0,140,2,12,0,0,0,0,0,136,10,0,0,0,7,10,0,136,10,0,0,25,10,10,16,137,10,0,0,130,10,0,0,136,11,0,0,49,10,10,11,252,98,2,0,1,11,16,0,135,10,0,0,11,0,0,0,25,3,7,4,0,5,7,0,89,3,0,0,89,5,1,0,88,6,3,0,145,6,6,0,1,10,192,81,1,11,220,115,82,11,11,0,27,11,11,48,3,8,10,11,106,11,8,16,106,10,8,4,41,10,10,1,41,10,10,2,101,11,10,6,88,2,5,0,145,2,2,0,1,10,192,81,1,11,220,115,82,11,11,0,27,11,11,48,3,9,10,11,106,11,9,16,106,10,9,4,41,10,10,1,25,10,10,1,41,10,10,2,101,11,10,2,1,10,192,81,1,11,220,115,82,11,11,0,27,11,11,48,3,10,10,11,25,4,10,4,82,10,4,0,25,10,10,1,85,4,10,0,137,7,0,0,139,0,0,0,140,2,11,0,0,0,0,0,1,7,0,0,136,9,0,0,0,8,9,0,136,9,0,0,25,9,9,16,137,9,0,0,130,9,0,0,136,10,0,0,49,9,9,10,216,99,2,0,1,10,16,0,135,9,0,0,10,0,0,0,25,4,8,8,25,5,8,4,0,6,8,0,85,4,1,0,1,9,63,0,85,5,9,0,1,9,0,0,85,6,9,0,106,9,0,4,82,10,6,0,49,9,9,10,16,100,2,0,1,7,6,0,119,0,12,0,82,2,6,0,106,9,0,32,82,10,6,0,27,10,10,36,94,9,9,10,82,10,4,0,52,9,9,10,60,100,2,0,25,9,2,1,85,6,9,0,119,0,240,255,32,9,7,6,121,9,4,0,82,3,5,0,137,8,0,0,139,3,0,0,85,5,2,0,82,3,5,0,137,8,0,0,139,3,0,0,140,2,12,0,0,0,0,0,136,8,0,0,0,7,8,0,136,8,0,0,25,8,8,16,137,8,0,0,130,8,0,0,136,9,0,0,49,8,8,9,152,100,2,0,1,9,16,0,135,8,0,0,9,0,0,0,0,3,7,0,112,4,1,4,145,4,4,0,112,8,0,4,145,8,8,0,64,5,4,8,145,5,5,0,88,6,1,0,145,6,6,0,88,11,0,0,145,11,11,0,64,10,6,11,145,10,10,0,134,9,0,0,72,133,1,0,5,10,0,0,145,9,9,0,62,10,0,0,72,183,111,255,219,165,76,64,145,10,10,0,65,8,9,10,145,8,8,0,89,3,8,0,88,8,3,0,145,8,8,0,59,10,0,0,145,10,10,0,71,8,8,10,120,8,6,0,88,2,3,0,145,2,2,0,137,7,0,0,145,8,2,0,139,8,0,0,88,10,3,0,145,10,10,0,59,9,104,1,145,9,9,0,63,8,10,9,145,8,8,0,89,3,8,0,88,2,3,0,145,2,2,0,137,7,0,0,145,8,2,0,139,8,0,0,140,1,11,0,0,0,0,0,136,7,0,0,0,6,7,0,136,7,0,0,25,7,7,16,137,7,0,0,130,7,0,0,136,8,0,0,49,7,7,8,140,101,2,0,1,8,16,0,135,7,0,0,8,0,0,0,25,1,6,4,0,3,6,0,89,3,0,0,88,7,3,0,145,7,7,0,62,8,0,0,26,195,59,192,220,181,164,63,145,8,8,0,72,4,7,8,88,5,3,0,145,5,5,0,121,4,14,0,62,7,0,0,42,162,203,64,10,215,41,64,145,7,7,0,66,8,5,7,145,8,8,0,89,1,8,0,88,2,1,0,145,2,2,0,137,6,0,0,145,8,2,0,139,8,0,0,119,0,24,0,62,10,0,0,45,167,251,191,245,40,172,63,145,10,10,0,63,9,5,10,145,9,9,0,62,10,0,0,148,129,168,160,71,225,240,63,145,10,10,0,66,7,9,10,145,7,7,0,61,10,0,0,154,153,25,64,135,8,10,0,7,10,0,0,145,8,8,0,89,1,8,0,88,2,1,0,145,2,2,0,137,6,0,0,145,8,2,0,139,8,0,0,59,8,0,0,145,8,8,0,139,8,0,0,140,1,11,0,0,0,0,0,136,7,0,0,0,6,7,0,136,7,0,0,25,7,7,16,137,7,0,0,130,7,0,0,136,8,0,0,49,7,7,8,148,102,2,0,1,8,16,0,135,7,0,0,8,0,0,0,25,1,6,4,0,3,6,0,89,3,0,0,88,7,3,0,145,7,7,0,62,8,0,0,8,79,230,127,195,165,105,63,145,8,8,0,72,4,7,8,88,5,3,0,145,5,5,0,121,4,14,0,62,7,0,0,42,162,203,64,10,215,41,64,145,7,7,0,65,8,5,7,145,8,8,0,89,1,8,0,88,2,1,0,145,2,2,0,137,6,0,0,145,8,2,0,139,8,0,0,119,0,24,0,61,10,0,0,85,85,213,62,135,9,10,0,5,10,0,0,145,9,9,0,62,10,0,0,148,129,168,160,71,225,240,63,145,10,10,0,65,7,9,10,145,7,7,0,62,10,0,0,45,167,251,191,245,40,172,63,145,10,10,0,64,8,7,10,145,8,8,0,89,1,8,0,88,2,1,0,145,2,2,0,137,6,0,0,145,8,2,0,139,8,0,0,59,8,0,0,145,8,8,0,139,8,0,0,140,1,12,0,0,0,0,0,1,10,255,255,106,11,0,76,47,10,10,11,140,103,2,0,134,7,0,0,80,162,2,0,0,0,0,0,119,0,2,0,1,7,0,0,134,10,0,0,160,144,2,0,0,0,0,0,82,10,0,0,38,10,10,1,33,8,10,0,120,8,17,0,134,9,0,0,220,161,2,0,106,2,0,52,25,1,0,56,121,2,3,0,82,11,1,0,109,2,56,11,82,3,1,0,121,3,2,0,109,3,52,2,82,11,9,0,45,11,11,0,228,103,2,0,85,9,3,0,134,11,0,0,24,162,2,0,134,4,0,0,112,34,2,0,0,0,0,0,106,10,0,12,38,10,10,15,135,11,26,1,10,0,0,0,20,11,11,4,0,5,11,0,106,6,0,96,121,6,3,0,135,11,5,0,6,0,0,0,121,8,6,0,121,7,7,0,134,11,0,0,68,162,2,0,0,0,0,0,119,0,3,0,135,11,5,0,0,0,0,0,139,5,0,0,140,3,12,0,0,0,0,0,136,8,0,0,0,7,8,0,136,8,0,0,25,8,8,32,137,8,0,0,130,8,0,0,136,9,0,0,49,8,8,9,124,104,2,0,1,9,32,0,135,8,0,0,9,0,0,0,25,4,7,16,25,3,7,8,0,5,7,0,89,5,1,0,88,6,5,0,145,6,6,0,116,3,0,0,106,9,0,4,109,3,4,9,78,9,2,0,83,4,9,0,102,8,2,1,107,4,1,8,102,9,2,2,107,4,2,9,102,8,2,3,107,4,3,8,1,9,0,0,1,10,104,1,1,11,36,0,134,8,0,0,196,203,0,0,3,6,9,10,11,4,0,0,137,7,0,0,139,0,0,0,140,2,6,0,0,0,0,0,78,3,1,0,41,5,3,24,42,5,5,24,120,5,3,0,0,2,0,0,119,0,47,0,41,5,3,24,42,5,5,24,134,4,0,0,212,154,2,0,0,5,0,0,120,4,3,0,1,2,0,0,119,0,39,0,102,5,1,1,120,5,3,0,0,2,4,0,119,0,35,0,102,5,4,1,120,5,3,0,1,2,0,0,119,0,31,0,102,5,1,2,120,5,5,0,134,2,0,0,236,114,2,0,4,1,0,0,119,0,25,0,102,5,4,2,120,5,3,0,1,2,0,0,119,0,21,0,102,5,1,3,120,5,5,0,134,2,0,0,216,54,2,0,4,1,0,0,119,0,15,0,102,5,4,3,120,5,3,0,1,2,0,0,119,0,11,0,102,5,1,4,120,5,5,0,134,2,0,0,40,51,2,0,4,1,0,0,119,0,5,0,134,2,0,0,136,255,0,0,4,1,0,0,119,0,1,0,139,2,0,0,140,5,16,0,0,0,0,0,136,13,0,0,0,12,13,0,136,13,0,0,25,13,13,32,137,13,0,0,130,13,0,0,136,14,0,0,49,13,13,14,248,105,2,0,1,14,32,0,135,13,0,0,14,0,0,0,25,7,12,20,25,8,12,16,25,9,12,12,25,10,12,8,25,11,12,4,0,5,12,0,85,7,0,0,85,8,1,0,89,9,2,0,85,10,3,0,85,11,4,0,82,14,8,0,88,15,9,0,145,15,15,0,134,13,0,0,72,49,2,0,14,15,0,0,85,5,13,0,82,13,5,0,82,15,10,0,5,6,13,15,137,12,0,0,82,15,7,0,82,13,11,0,3,13,6,13,41,13,13,2,3,15,15,13,139,15,0,0,140,2,11,0,0,0,0,0,136,8,0,0,0,7,8,0,136,8,0,0,25,8,8,16,137,8,0,0,130,8,0,0,136,9,0,0,49,8,8,9,160,106,2,0,1,9,16,0,135,8,0,0,9,0,0,0,0,6,7,0,1,9,202,61,78,10,1,0,134,8,0,0,212,154,2,0,9,10,0,0,120,8,7,0,134,8,0,0,136,162,2,0,1,10,28,0,85,8,10,0,1,2,0,0,119,0,31,0,134,10,0,0,200,123,2,0,1,0,0,0,2,8,0,0,0,128,0,0,20,10,10,8,0,5,10,0,85,6,0,0,109,6,4,5,1,8,182,1,109,6,8,8,1,10,5,0,135,8,27,1,10,6,0,0,134,3,0,0,40,154,2,0,8,0,0,0,34,8,3,0,121,8,3,0,1,2,0,0,119,0,10,0,134,4,0,0,84,227,1,0,3,1,0,0,120,4,5,0,135,8,28,1,3,0,0,0,1,2,0,0,119,0,2,0,0,2,4,0,137,7,0,0,139,2,0,0,140,2,9,0,0,0,0,0,136,6,0,0,0,5,6,0,136,6,0,0,25,6,6,16,137,6,0,0,130,6,0,0,136,7,0,0,49,6,6,7,140,107,2,0,1,7,16,0,135,6,0,0,7,0,0,0,25,3,5,8,25,4,5,4,89,4,0,0,89,5,1,0,88,7,4,0,145,7,7,0,135,6,236,0,7,0,0,0,145,6,6,0,89,4,6,0,88,6,4,0,145,6,6,0,59,7,1,0,145,7,7,0,72,6,6,7,121,6,14,0,59,7,1,0,145,7,7,0,88,8,4,0,145,8,8,0,64,6,7,8,145,6,6,0,89,3,6,0,88,2,3,0,145,2,2,0,137,5,0,0,145,6,2,0,139,6,0,0,119,0,9,0,59,6,0,0,145,6,6,0,89,3,6,0,88,2,3,0,145,2,2,0,137,5,0,0,145,6,2,0,139,6,0,0,59,6,0,0,145,6,6,0,139,6,0,0,140,1,9,0,0,0,0,0,1,4,0,0,136,6,0,0,0,5,6,0,136,6,0,0,25,6,6,16,137,6,0,0,130,6,0,0,136,7,0,0,49,6,6,7,104,108,2,0,1,7,16,0,135,6,0,0,7,0,0,0,25,1,5,4,0,3,5,0,85,1,0,0,1,6,0,0,85,3,6,0,1,6,0,4,82,7,3,0,49,6,6,7,148,108,2,0,1,4,6,0,119,0,22,0,82,6,1,0,82,7,3,0,90,6,6,7,120,6,2,0,119,0,17,0,82,7,1,0,82,8,3,0,90,7,7,8,134,6,0,0,60,158,2,0,7,0,0,0,1,7,255,0,19,6,6,7,0,2,6,0,1,6,192,106,82,7,3,0,95,6,7,2,82,7,3,0,25,7,7,1,85,3,7,0,119,0,230,255,32,7,4,6,121,7,4,0,137,5,0,0,1,7,192,106,139,7,0,0,1,7,192,106,82,6,3,0,1,8,0,0,95,7,6,8,137,5,0,0,1,8,192,106,139,8,0,0,140,2,11,0,0,0,0,0,136,8,0,0,0,7,8,0,136,8,0,0,25,8,8,16,137,8,0,0,130,8,0,0,136,9,0,0,49,8,8,9,80,109,2,0,1,9,16,0,135,8,0,0,9,0,0,0,25,3,7,4,0,4,7,0,85,3,0,0,85,4,1,0,82,9,3,0,82,10,4,0,134,8,0,0,156,64,0,0,9,10,0,0,82,10,3,0,134,8,0,0,28,149,2,0,10,0,0,0,33,5,8,0,82,6,3,0,82,8,3,0,82,10,4,0,134,2,0,0,204,20,2,0,8,10,0,0,121,5,7,0,134,10,0,0,136,131,0,0,6,2,0,0,137,7,0,0,139,0,0,0,119,0,6,0,134,10,0,0,96,88,0,0,6,2,0,0,137,7,0,0,139,0,0,0,139,0,0,0,140,3,13,0,0,0,0,0,136,9,0,0,0,8,9,0,136,9,0,0,25,9,9,16,137,9,0,0,130,9,0,0,136,10,0,0,49,9,9,10,12,110,2,0,1,10,16,0,135,9,0,0,10,0,0,0,25,4,8,12,25,5,8,8,25,6,8,4,0,7,8,0,85,5,0,0,85,6,1,0,85,7,2,0,1,9,0,0,82,10,6,0,49,9,9,10,88,110,2,0,82,9,6,0,82,10,7,0,47,9,9,10,88,110,2,0,116,4,6,0,82,3,4,0,137,8,0,0,139,3,0,0,82,10,5,0,82,11,6,0,82,12,7,0,134,9,0,0,192,215,1,0,10,11,12,0,85,4,9,0,82,3,4,0,137,8,0,0,139,3,0,0,140,1,10,0,0,0,0,0,1,5,0,0,136,7,0,0,0,6,7,0,136,7,0,0,25,7,7,16,137,7,0,0,130,7,0,0,136,8,0,0,49,7,7,8,188,110,2,0,1,8,16,0,135,7,0,0,8,0,0,0,0,1,6,0,25,4,6,4,85,1,0,0,1,7,0,0,83,4,7,0,1,7,175,120,82,8,1,0,90,7,7,8,1,8,178,120,82,9,1,0,90,8,8,9,46,7,7,8,12,111,2,0,1,7,175,120,82,8,1,0,90,7,7,8,33,7,7,1,121,7,4,0,1,5,3,0,119,0,2,0,1,5,3,0,32,7,5,3,121,7,11,0,1,8,1,0,134,7,0,0,120,145,2,0,8,0,0,0,120,7,6,0,78,2,4,0,38,7,2,1,0,3,7,0,137,6,0,0,139,3,0,0,1,7,1,0,83,4,7,0,78,2,4,0,38,7,2,1,0,3,7,0,137,6,0,0,139,3,0,0,140,1,8,0,0,0,0,0,1,3,0,0,136,5,0,0,0,4,5,0,136,5,0,0,25,5,5,16,137,5,0,0,130,5,0,0,136,6,0,0,49,5,5,6,152,111,2,0,1,6,16,0,135,5,0,0,6,0,0,0,25,1,4,4,0,2,4,0,85,1,0,0,1,5,0,0,85,2,5,0,82,5,1,0,1,6,0,0,1,7,4,0,138,5,6,7,208,111,2,0,224,111,2,0,232,111,2,0,240,111,2,0,119,0,11,0,1,6,1,0,85,2,6,0,1,3,3,0,119,0,7,0,1,3,3,0,119,0,5,0,1,3,4,0,119,0,3,0,1,3,5,0,119,0,1,0,32,5,3,3,121,5,4,0,1,5,2,0,85,2,5,0,1,3,4,0,32,5,3,4,121,5,4,0,1,5,3,0,85,2,5,0,1,3,5,0,32,5,3,5,121,5,3,0,1,5,3,0,85,2,5,0,137,4,0,0,82,5,2,0,139,5,0,0,140,1,10,0,0,0,0,0,136,6,0,0,0,5,6,0,136,6,0,0,25,6,6,32,137,6,0,0,130,6,0,0,136,7,0,0,49,6,6,7,116,112,2,0,1,7,32,0,135,6,0,0,7,0,0,0,25,1,5,16,25,2,5,8,0,3,5,0,89,1,0,0,1,6,0,0,85,2,6,0,1,7,0,0,109,2,4,7,88,6,1,0,145,6,6,0,59,8,232,3,145,8,8,0,66,7,6,8,145,7,7,0,75,7,7,0,85,3,7,0,82,7,3,0,1,8,232,3,5,4,7,8,76,8,4,0,145,4,8,0,88,7,1,0,145,7,7,0,64,8,7,4,145,8,8,0,89,1,8,0,116,2,3,0,88,6,1,0,145,6,6,0,60,9,0,0,64,66,15,0,145,9,9,0,65,7,6,9,145,7,7,0,75,7,7,0,109,2,4,7,135,7,29,1,2,2,0,0,32,7,7,255,120,7,253,255,137,5,0,0,139,0,0,0,140,2,13,0,0,0,0,0,136,8,0,0,0,7,8,0,136,8,0,0,25,8,8,16,137,8,0,0,130,8,0,0,136,9,0,0,49,8,8,9,84,113,2,0,1,9,16,0,135,8,0,0,9,0,0,0,25,2,7,12,25,3,7,8,25,4,7,4,0,5,7,0,85,2,0,0,85,3,1,0,1,8,255,255,85,4,8,0,1,8,0,0,85,5,8,0,82,6,4,0,82,8,3,0,82,9,5,0,56,8,8,9,212,113,2,0,43,8,6,8,1,9,96,16,82,10,2,0,82,11,5,0,91,10,10,11,82,11,4,0,1,12,255,0,19,11,11,12,21,10,10,11,41,10,10,2,94,9,9,10,21,8,8,9,85,4,8,0,82,8,5,0,25,8,8,1,85,5,8,0,119,0,235,255,137,7,0,0,11,8,6,0,139,8,0,0,140,2,14,0,0,0,0,0,136,7,0,0,0,4,7,0,136,7,0,0,25,7,7,16,137,7,0,0,130,7,0,0,136,8,0,0,49,7,7,8,24,114,2,0,1,8,16,0,135,7,0,0,8,0,0,0,25,2,4,4,0,3,4,0,85,2,0,0,85,3,1,0,1,7,236,117,82,8,2,0,85,7,8,0,1,8,240,117,82,7,3,0,85,8,7,0,1,7,244,117,82,5,7,0,1,7,248,117,82,6,7,0,28,8,5,2,28,9,6,2,1,10,236,117,82,10,10,0,4,10,10,5,1,11,240,117,82,11,11,0,4,11,11,6,134,7,0,0,160,131,2,0,8,9,10,11,1,11,1,23,134,7,0,0,252,145,2,0,11,0,0,0,134,7,0,0,80,141,2,0,59,11,0,0,1,10,236,117,82,10,10,0,76,10,10,0,1,9,240,117,82,9,9,0,76,9,9,0,59,8,0,0,59,12,0,0,59,13,1,0,134,7,0,0,76,243,1,0,11,10,9,8,12,13,0,0,1,13,0,23,134,7,0,0,252,145,2,0,13,0,0,0,134,7,0,0,80,141,2,0,137,4,0,0,139,0,0,0,140,2,15,0,0,0,0,0,2,11,0,0,255,0,0,0,2,12,0,0,255,255,0,0,79,13,1,0,41,13,13,8,103,14,1,1,20,13,13,14,0,9,13,0,25,10,0,1,78,4,10,0,41,13,4,24,42,13,13,24,120,13,3,0,1,8,0,0,119,0,25,0,79,13,0,0,41,13,13,8,19,14,4,11,20,13,13,14,0,2,13,0,0,3,10,0,19,13,2,12,0,5,13,0,52,13,5,9,144,115,2,0,25,6,3,1,78,7,6,0,41,13,7,24,42,13,13,24,120,13,3,0,1,8,0,0,119,0,8,0,41,13,5,8,19,14,7,11,20,13,13,14,0,2,13,0,0,3,6,0,119,0,240,255,26,8,3,1,139,8,0,0,140,5,16,0,0,0,0,0,136,11,0,0,0,10,11,0,136,11,0,0,1,12,0,1,3,11,11,12,137,11,0,0,130,11,0,0,136,12,0,0,49,11,11,12,212,115,2,0,1,12,0,1,135,11,0,0,12,0,0,0,0,8,10,0,15,11,3,2,2,12,0,0,0,32,1,0,19,12,4,12,32,12,12,0,19,11,11,12,121,11,33,0,4,9,2,3,41,12,1,24,42,12,12,24,1,14,0,1,16,14,9,14,1,15,0,1,125,13,14,9,15,0,0,0,135,11,3,0,8,12,13,0,1,11,255,0,48,11,11,9,100,116,2,0,4,7,2,3,0,6,9,0,1,13,0,1,134,11,0,0,160,156,2,0,0,8,13,0,1,11,0,1,4,6,6,11,1,11,255,0,55,11,11,6,48,116,2,0,1,11,255,0,19,11,7,11,0,5,11,0,119,0,2,0,0,5,9,0,134,11,0,0,160,156,2,0,0,8,5,0,137,10,0,0,139,0,0,0,140,1,8,0,0,0,0,0,136,6,0,0,0,3,6,0,136,6,0,0,25,6,6,64,137,6,0,0,130,6,0,0,136,7,0,0,49,6,6,7,180,116,2,0,1,7,64,0,135,6,0,0,7,0,0,0,0,1,3,0,0,2,1,0,25,5,2,64,1,6,0,0,85,2,6,0,25,2,2,4,54,6,2,5,192,116,2,0,59,6,1,0,145,6,6,0,89,1,6,0,59,7,1,0,145,7,7,0,113,1,20,7,59,6,1,0,145,6,6,0,113,1,40,6,59,7,1,0,145,7,7,0,113,1,60,7,0,2,0,0,0,4,1,0,25,5,2,64,116,2,4,0,25,2,2,4,25,4,4,4,54,7,2,5,16,117,2,0,137,3,0,0,139,0,0,0,140,0,9,0,0,0,0,0,136,6,0,0,0,3,6,0,136,6,0,0,1,7,128,0,3,6,6,7,137,6,0,0,130,6,0,0,136,7,0,0,49,6,6,7,104,117,2,0,1,7,128,0,135,6,0,0,7,0,0,0,25,1,3,64,0,0,3,0,1,6,240,114,134,7,0,0,120,162,2,0,87,6,7,0,1,7,248,114,1,6,240,114,86,6,6,0,1,8,224,114,86,8,8,0,64,6,6,8,87,7,6,0,1,6,224,114,1,7,240,114,86,7,7,0,87,6,7,0,134,7,0,0,80,141,2,0,0,2,1,0,1,4,156,117,25,5,2,64,116,2,4,0,25,2,2,4,25,4,4,4,54,7,2,5,192,117,2,0,134,7,0,0,236,245,1,0,0,1,0,0,134,7,0,0,184,176,1,0,0,0,0,0,137,3,0,0,139,0,0,0,140,1,14,0,0,0,0,0,136,9,0,0,0,8,9,0,136,9,0,0,25,9,9,16,137,9,0,0,130,9,0,0,136,10,0,0,49,9,9,10,44,118,2,0,1,10,16,0,135,9,0,0,10,0,0,0,0,1,8,0,88,5,0,0,145,5,5,0,88,9,0,0,145,9,9,0,65,6,5,9,145,6,6,0,112,7,0,4,145,7,7,0,112,10,0,4,145,10,10,0,65,9,7,10,145,9,9,0,63,2,6,9,145,2,2,0,112,3,0,8,145,3,3,0,112,12,0,8,145,12,12,0,65,11,3,12,145,11,11,0,63,10,2,11,145,10,10,0,135,9,230,0,10,0,0,0,145,9,9,0,89,1,9,0,88,4,1,0,145,4,4,0,137,8,0,0,145,9,4,0,139,9,0,0,140,1,10,0,0,0,0,0,135,9,15,0,0,0,0,0,25,9,9,1,135,5,6,0,9,0,0,0,135,9,16,0,5,0,0,0,1,9,206,61,134,6,0,0,228,104,2,0,5,9,0,0,121,6,3,0,1,9,0,0,83,6,9,0,1,9,210,61,134,7,0,0,228,104,2,0,5,9,0,0,121,7,3,0,1,9,0,0,83,7,9,0,1,9,214,61,134,8,0,0,228,104,2,0,5,9,0,0,121,8,3,0,1,9,0,0,83,8,9,0,1,9,218,61,134,2,0,0,228,104,2,0,5,9,0,0,121,2,3,0,1,9,0,0,83,2,9,0,1,9,224,61,134,3,0,0,228,104,2,0,5,9,0,0,121,3,3,0,1,9,0,0,83,3,9,0,134,4,0,0,20,159,0,0,5,0,0,0,120,4,5,0,134,1,0,0,44,46,2,0,5,0,0,0,119,0,2,0,0,1,4,0,135,9,5,0,5,0,0,0,139,1,0,0,140,3,9,0,0,0,0,0,136,6,0,0,0,5,6,0,136,6,0,0,1,7,16,1,3,6,6,7,137,6,0,0,130,6,0,0,136,7,0,0,49,6,6,7,200,119,2,0,1,7,16,1,135,6,0,0,7,0,0,0,1,6,12,1,3,3,5,6,0,4,5,0,85,3,0,0,1,6,8,1,97,5,6,1,1,6,4,1,97,5,6,2,82,6,3,0,32,6,6,4,121,6,16,0,1,6,0,0,121,6,14,0,135,6,30,1,4,0,0,0,82,6,4,0,121,6,5,0,135,6,31,1,135,6,30,1,4,0,0,0,119,0,6,0,1,7,0,0,1,8,1,0,135,6,32,1,7,8,0,0,119,0,1,0,137,5,0,0,1,6,0,0,139,6,0,0,140,2,12,0,0,0,0,0,120,0,4,0,135,2,6,0,1,0,0,0,139,2,0,0,1,7,191,255,48,7,7,1,120,120,2,0,134,7,0,0,136,162,2,0,1,8,48,0,85,7,8,0,1,2,0,0,139,2,0,0,26,8,0,8,35,9,1,11,121,9,4,0,1,9,16,0,0,7,9,0,119,0,4,0,25,9,1,11,38,9,9,248,0,7,9,0,134,3,0,0,212,35,1,0,8,7,0,0,121,3,3,0,25,2,3,8,139,2,0,0,135,4,6,0,1,0,0,0,120,4,3,0,1,2,0,0,139,2,0,0,26,7,0,4,82,5,7,0,38,7,5,248,38,9,5,3,32,9,9,0,1,10,8,0,1,11,4,0,125,8,9,10,11,0,0,0,4,6,7,8,16,11,6,1,125,7,11,6,1,0,0,0,135,8,32,0,4,0,7,0,135,8,5,0,0,0,0,0,0,2,4,0,139,2,0,0,140,1,9,0,0,0,0,0,136,6,0,0,0,5,6,0,136,6,0,0,25,6,6,16,137,6,0,0,130,6,0,0,136,7,0,0,49,6,6,7,76,121,2,0,1,7,16,0,135,6,0,0,7,0,0,0,25,1,5,8,25,3,5,4,0,4,5,0,85,3,0,0,1,6,0,0,85,4,6,0,82,6,3,0,121,6,7,0,82,7,3,0,1,8,93,46,134,6,0,0,76,129,2,0,7,8,0,0,85,4,6,0,82,6,4,0,121,6,11,0,82,6,4,0,82,8,3,0,46,6,6,8,180,121,2,0,82,6,4,0,25,6,6,1,85,1,6,0,82,2,1,0,137,5,0,0,139,2,0,0,116,1,3,0,82,2,1,0,137,5,0,0,139,2,0,0,140,4,14,0,0,0,0,0,136,10,0,0,0,9,10,0,136,10,0,0,25,10,10,16,137,10,0,0,130,10,0,0,136,11,0,0,49,10,10,11,252,121,2,0,1,11,16,0,135,10,0,0,11,0,0,0,0,8,9,0,106,12,0,60,1,13,255,0,19,13,3,13,135,11,33,1,12,1,2,13,8,0,0,0,134,10,0,0,132,153,2,0,11,0,0,0,120,10,5,0,0,4,8,0,106,6,4,4,82,7,4,0,119,0,8,0,0,5,8,0,1,10,255,255,85,5,10,0,1,11,255,255,109,5,4,11,1,6,255,255,1,7,255,255,135,11,28,0,6,0,0,0,137,9,0,0,139,7,0,0,140,2,11,0,0,0,0,0,136,6,0,0,0,4,6,0,136,6,0,0,25,6,6,16,137,6,0,0,130,6,0,0,136,7,0,0,49,6,6,7,156,122,2,0,1,7,16,0,135,6,0,0,7,0,0,0,25,2,4,4,0,3,4,0,85,2,0,0,85,3,1,0,82,7,3,0,106,7,7,4,82,8,2,0,134,6,0,0,100,42,2,0,7,8,0,0,82,5,3,0,25,8,5,8,1,7,1,0,106,9,5,4,82,10,2,0,134,6,0,0,88,130,2,0,8,7,9,10,82,6,3,0,1,10,0,0,83,6,10,0,82,10,3,0,1,6,0,0,107,10,1,6,82,6,3,0,1,10,0,0,109,6,4,10,137,4,0,0,139,0,0,0,140,1,7,0,0,0,0,0,136,5,0,0,0,4,5,0,136,5,0,0,25,5,5,16,137,5,0,0,130,5,0,0,136,6,0,0,49,5,5,6,72,123,2,0,1,6,16,0,135,5,0,0,6,0,0,0,25,1,4,4,0,2,4,0,89,2,0,0,88,5,2,0,145,5,5,0,59,6,0,0,145,6,6,0,71,5,5,6,121,5,5,0,59,5,0,0,145,5,5,0,89,1,5,0,119,0,15,0,88,5,2,0,145,5,5,0,59,6,1,0,145,6,6,0,73,5,5,6,121,5,5,0,59,5,1,0,145,5,5,0,89,1,5,0,119,0,5,0,88,5,2,0,145,5,5,0,89,1,5,0,119,0,1,0,88,3,1,0,145,3,3,0,137,4,0,0,145,5,3,0,139,5,0,0,140,1,13,0,0,0,0,0,1,12,43,0,134,11,0,0,212,154,2,0,0,12,0,0,32,4,11,0,78,5,0,0,41,11,5,24,42,11,11,24,0,10,11,0,121,4,5,0,33,12,10,114,38,12,12,1,0,11,12,0,119,0,3,0,1,12,2,0,0,11,12,0,0,1,11,0,1,12,120,0,134,11,0,0,212,154,2,0,0,12,0,0,32,6,11,0,121,6,3,0,0,11,1,0,119,0,4,0,1,12,128,0,20,12,1,12,0,11,12,0,0,8,11,0,1,12,101,0,134,11,0,0,212,154,2,0,0,12,0,0,32,7,11,0,121,7,3,0,0,11,8,0,119,0,5,0,2,12,0,0,0,0,8,0,20,12,8,12,0,11,12,0,0,2,11,0,32,12,10,114,121,12,3,0,0,11,2,0,119,0,3,0,39,12,2,64,0,11,12,0,0,9,11,0,32,12,10,119,121,12,5,0,1,12,0,2,20,12,9,12,0,11,12,0,119,0,2,0,0,11,9,0,0,3,11,0,32,12,10,97,121,12,5,0,1,12,0,4,20,12,3,12,0,11,12,0,119,0,2,0,0,11,3,0,139,11,0,0,140,2,13,0,0,0,0,0,78,6,0,0,78,7,1,0,41,11,6,24,42,11,11,24,32,11,11,0,121,11,4,0,1,11,1,0,0,10,11,0,119,0,7,0,41,11,6,24,42,11,11,24,41,12,7,24,42,12,12,24,14,11,11,12,0,10,11,0,121,10,4,0,0,4,7,0,0,5,6,0,119,0,23,0,0,2,1,0,0,3,0,0,25,3,3,1,25,2,2,1,78,8,3,0,78,9,2,0,41,11,8,24,42,11,11,24,32,11,11,0,121,11,4,0,1,11,1,0,0,10,11,0,119,0,7,0,41,11,8,24,42,11,11,24,41,12,9,24,42,12,12,24,14,11,11,12,0,10,11,0,121,10,239,255,0,4,9,0,0,5,8,0,1,10,255,0,19,10,5,10,1,11,255,0,19,11,4,11,4,10,10,11,139,10,0,0,140,0,7,0,0,0,0,0,136,4,0,0,0,3,4,0,136,4,0,0,25,4,4,16,137,4,0,0,130,4,0,0,136,5,0,0,49,4,4,5,208,125,2,0,1,5,16,0,135,4,0,0,5,0,0,0,0,1,3,0,1,4,140,117,82,4,4,0,121,4,30,0,1,5,59,0,1,6,140,117,82,6,6,0,134,4,0,0,100,42,2,0,5,6,0,0,1,6,140,117,82,6,6,0,134,4,0,0,100,103,2,0,6,0,0,0,1,6,8,115,82,6,6,0,135,4,5,0,6,0,0,0,1,4,140,117,1,6,0,0,85,4,6,0,1,6,8,115,1,4,0,0,85,6,4,0,1,4,1,0,83,1,4,0,78,0,1,0,38,4,0,1,0,2,4,0,137,3,0,0,139,2,0,0,119,0,8,0,1,4,0,0,83,1,4,0,78,0,1,0,38,4,0,1,0,2,4,0,137,3,0,0,139,2,0,0,1,4,0,0,139,4,0,0,140,1,9,0,0,0,0,0,136,6,0,0,0,5,6,0,136,6,0,0,25,6,6,16,137,6,0,0,130,6,0,0,136,7,0,0,49,6,6,7,176,126,2,0,1,7,16,0,135,6,0,0,7,0,0,0,25,1,5,8,25,3,5,4,0,4,5,0,85,3,0,0,82,7,3,0,1,8,46,0,134,6,0,0,108,158,2,0,7,8,0,0,85,4,6,0,82,6,4,0,121,6,11,0,82,6,4,0,82,8,3,0,46,6,6,8,8,127,2,0,82,6,4,0,25,6,6,1,85,1,6,0,82,2,1,0,137,5,0,0,139,2,0,0,1,6,0,0,85,1,6,0,82,2,1,0,137,5,0,0,139,2,0,0,140,0,7,0,0,0,0,0,136,4,0,0,0,1,4,0,136,4,0,0,25,4,4,16,137,4,0,0,130,4,0,0,136,5,0,0,49,4,4,5,84,127,2,0,1,5,16,0,135,4,0,0,5,0,0,0,1,4,32,0,1,5,144,115,82,5,5,0,49,4,4,5,124,127,2,0,1,5,5,0,1,6,211,30,134,4,0,0,252,32,2,0,5,6,1,0,1,4,144,29,82,4,4,0,1,6,0,23,45,4,4,6,168,127,2,0,1,4,160,120,1,6,1,0,83,4,6,0,1,6,76,115,1,4,148,115,85,6,4,0,1,4,192,73,1,6,144,115,82,6,6,0,41,6,6,6,3,0,4,6,1,6,76,115,82,2,6,0,25,3,0,64,116,0,2,0,25,0,0,4,25,2,2,4,54,6,0,3,200,127,2,0,1,6,144,115,1,4,144,115,82,4,4,0,25,4,4,1,85,6,4,0,137,1,0,0,139,0,0,0,140,2,11,0,0,0,0,0], eb + 153600);
  HEAPU8.set([136,7,0,0,0,6,7,0,136,7,0,0,25,7,7,32,137,7,0,0,130,7,0,0,136,8,0,0,49,7,7,8,48,128,2,0,1,8,32,0,135,7,0,0,8,0,0,0,25,2,6,20,25,3,6,16,0,4,6,0,85,2,0,0,1,7,192,84,1,8,92,118,82,8,8,0,41,8,8,10,3,7,7,8,85,3,7,0,85,4,1,0,82,8,3,0,82,9,2,0,134,7,0,0,236,157,2,0,8,9,4,0,1,7,92,118,82,7,7,0,25,5,7,1,1,7,92,118,85,7,5,0,1,7,92,118,1,8,4,0,1,10,92,118,82,10,10,0,17,8,8,10,1,10,0,0,125,9,8,10,5,0,0,0,85,7,9,0,137,6,0,0,82,9,3,0,139,9,0,0,140,2,10,0,0,0,0,0,136,8,0,0,0,7,8,0,136,8,0,0,25,8,8,16,137,8,0,0,130,8,0,0,136,9,0,0,49,8,8,9,236,128,2,0,1,9,16,0,135,8,0,0,9,0,0,0,25,2,7,8,25,3,7,4,0,4,7,0,85,2,0,0,85,3,1,0,1,8,0,0,85,4,8,0,82,5,3,0,26,8,5,1,85,3,8,0,82,6,4,0,120,5,2,0,119,0,10,0,41,8,6,1,82,9,2,0,38,9,9,1,20,8,8,9,85,4,8,0,82,8,2,0,42,8,8,1,85,2,8,0,119,0,242,255,137,7,0,0,139,6,0,0,140,2,10,0,0,0,0,0,136,7,0,0,0,6,7,0,136,7,0,0,25,7,7,16,137,7,0,0,130,7,0,0,136,8,0,0,49,7,7,8,132,129,2,0,1,8,16,0,135,7,0,0,8,0,0,0,25,3,6,8,25,4,6,4,0,5,6,0,85,3,0,0,85,4,1,0,1,7,0,0,85,5,7,0,82,8,3,0,82,9,4,0,134,7,0,0,64,155,2,0,8,9,0,0,85,3,7,0,82,7,3,0,120,7,2,0,119,0,6,0,82,2,3,0,25,7,2,1,85,3,7,0,85,5,2,0,119,0,243,255,137,6,0,0,82,7,5,0,139,7,0,0,140,3,12,0,0,0,0,0,2,9,0,0,255,0,0,0,120,2,3,0,1,6,0,0,119,0,22,0,0,3,0,0,0,4,2,0,0,5,1,0,78,7,3,0,78,8,5,0,41,10,7,24,42,10,10,24,41,11,8,24,42,11,11,24,53,10,10,11,72,130,2,0,26,4,4,1,120,4,3,0,1,6,0,0,119,0,7,0,25,3,3,1,25,5,5,1,119,0,242,255,19,10,7,9,19,11,8,9,4,6,10,11,139,6,0,0,140,4,12,0,0,0,0,0,5,7,2,1,32,10,1,0,1,11,0,0,125,9,10,11,2,0,0,0,1,11,255,255,106,10,3,76,47,11,11,10,192,130,2,0,134,11,0,0,80,162,2,0,3,0,0,0,32,8,11,0,134,4,0,0,200,0,2,0,0,7,3,0,121,8,3,0,0,5,4,0,119,0,9,0,134,11,0,0,68,162,2,0,3,0,0,0,0,5,4,0,119,0,4,0,134,5,0,0,200,0,2,0,0,7,3,0,45,11,5,7,220,130,2,0,0,6,9,0,119,0,2,0,7,6,5,1,139,6,0,0,140,4,11,0,0,0,0,0,32,9,0,0,32,10,1,0,19,9,9,10,121,9,3,0,0,4,2,0,119,0,22,0,0,5,2,0,0,7,1,0,0,8,0,0,26,6,5,1,1,9,64,28,38,10,8,15,91,9,9,10,20,9,9,3,83,6,9,0,1,9,4,0,135,8,24,1,8,7,9,0,135,7,1,0,32,9,8,0,32,10,7,0,19,9,9,10,121,9,3,0,0,4,6,0,119,0,3,0,0,5,6,0,119,0,239,255,139,4,0,0,140,4,11,0,0,0,0,0,0,4,0,0,0,5,2,0,134,6,0,0,52,142,2,0,4,5,0,0,135,7,1,0,5,9,1,5,5,10,3,4,3,9,9,10,3,9,9,7,38,10,7,0,20,9,9,10,135,8,28,0,9,0,0,0,139,6,0,0,140,4,14,0,0,0,0,0,136,9,0,0,0,8,9,0,136,9,0,0,25,9,9,16,137,9,0,0,130,9,0,0,136,10,0,0,49,9,9,10,216,131,2,0,1,10,16,0,135,9,0,0,10,0,0,0,25,4,8,12,25,5,8,8,25,6,8,4,0,7,8,0,85,4,0,0,85,5,1,0,85,6,2,0,85,7,3,0,82,10,4,0,82,11,5,0,82,12,6,0,82,13,7,0,135,9,34,1,10,11,12,13,137,8,0,0,139,0,0,0,140,0,5,0,0,0,0,0,136,3,0,0,0,2,3,0,136,3,0,0,25,3,3,16,137,3,0,0,130,3,0,0,136,4,0,0,49,3,3,4,80,132,2,0,1,4,16,0,135,3,0,0,4,0,0,0,0,0,2,0,1,3,0,118,82,3,3,0,36,3,3,0,121,3,3,0,137,2,0,0,139,0,0,0,1,3,0,0,85,0,3,0,1,3,252,117,82,1,3,0,1,3,0,118,82,3,3,0,82,4,0,0,56,3,3,4,180,132,2,0,82,4,0,0,41,4,4,2,94,4,1,4,135,3,5,0,4,0,0,0,82,3,0,0,25,3,3,1,85,0,3,0,119,0,241,255,135,3,5,0,1,0,0,0,1,3,0,118,1,4,0,0,85,3,4,0,137,2,0,0,139,0,0,0,140,1,9,0,0,0,0,0,136,4,0,0,0,3,4,0,136,4,0,0,25,4,4,16,137,4,0,0,130,4,0,0,136,5,0,0,49,4,4,5,8,133,2,0,1,5,16,0,135,4,0,0,5,0,0,0,0,1,3,0,89,1,0,0,88,4,1,0,145,4,4,0,59,5,1,0,145,5,5,0,72,4,4,5,121,4,16,0,88,5,1,0,145,5,5,0,59,6,2,0,145,6,6,0,66,4,5,6,145,4,4,0,61,6,0,0,0,0,0,63,145,6,6,0,63,2,4,6,145,2,2,0,137,3,0,0,145,6,2,0,139,6,0,0,119,0,7,0,1,4,23,54,1,5,90,48,1,7,12,3,1,8,34,54,135,6,8,0,4,5,7,8,59,6,0,0,145,6,6,0,139,6,0,0,140,2,10,0,0,0,0,0,136,7,0,0,0,6,7,0,136,7,0,0,25,7,7,16,137,7,0,0,130,7,0,0,136,8,0,0,49,7,7,8,192,133,2,0,1,8,16,0,135,7,0,0,8,0,0,0,0,5,6,0,25,2,6,12,25,3,6,8,85,2,0,0,85,3,1,0,82,4,3,0,116,5,2,0,109,5,4,4,1,8,4,0,1,9,49,47,134,7,0,0,252,32,2,0,8,9,5,0,137,6,0,0,139,0,0,0,140,1,10,0,0,0,0,0,136,6,0,0,0,4,6,0,136,6,0,0,25,6,6,16,137,6,0,0,130,6,0,0,136,7,0,0,49,6,6,7,52,134,2,0,1,7,16,0,135,6,0,0,7,0,0,0,0,1,4,0,85,1,0,0,82,6,1,0,1,7,152,0,94,3,6,7,82,5,1,0,106,7,5,80,112,8,5,56,145,8,8,0,134,6,0,0,72,49,2,0,7,8,0,0,5,2,3,6,137,4,0,0,139,2,0,0,140,1,10,0,0,0,0,0,136,6,0,0,0,4,6,0,136,6,0,0,25,6,6,16,137,6,0,0,130,6,0,0,136,7,0,0,49,6,6,7,168,134,2,0,1,7,16,0,135,6,0,0,7,0,0,0,0,1,4,0,85,1,0,0,82,6,1,0,1,7,156,0,94,3,6,7,82,5,1,0,106,7,5,84,112,8,5,60,145,8,8,0,134,6,0,0,72,49,2,0,7,8,0,0,5,2,3,6,137,4,0,0,139,2,0,0,140,0,5,0,0,0,0,0,2,1,0,0,79,29,0,0,1,2,60,117,82,2,2,0,32,2,2,1,1,3,60,117,82,3,3,0,32,3,3,2,20,2,2,3,1,3,64,117,82,3,3,0,34,3,3,2,19,2,2,3,121,2,6,0,1,2,60,117,1,3,4,0,85,2,3,0,134,3,0,0,128,152,2,0,134,0,0,0,128,152,2,0,1,3,208,114,86,3,3,0,64,3,0,3,59,2,44,1,73,3,3,2,1,2,60,117,82,2,2,0,32,2,2,8,19,3,3,2,1,2,64,117,82,2,2,0,34,2,2,2,19,3,3,2,121,3,9,0,1,3,60,117,1,2,4,0,85,3,2,0,134,2,0,0,128,152,2,0,1,2,173,120,1,3,1,0,83,2,3,0,1,3,60,117,82,3,3,0,32,3,3,16,1,2,60,117,82,2,2,0,32,2,2,64,20,3,3,2,1,2,60,117,82,2,2,0,32,2,2,32,20,3,3,2,1,2,60,117,82,2,2,0,1,4,128,0,13,2,2,4,20,3,3,2,120,3,2,0,139,0,0,0,1,3,60,117,1,2,0,0,85,3,2,0,139,0,0,0,140,3,12,0,0,0,0,0,136,8,0,0,0,7,8,0,136,8,0,0,25,8,8,16,137,8,0,0,130,8,0,0,136,9,0,0,49,8,8,9,40,136,2,0,1,9,16,0,135,8,0,0,9,0,0,0,25,4,7,8,25,5,7,4,0,6,7,0,85,4,0,0,85,5,1,0,85,6,2,0,82,8,4,0,82,10,5,0,82,11,6,0,5,9,10,11,41,9,9,2,3,3,8,9,137,7,0,0,139,3,0,0,140,1,8,0,0,0,0,0,25,2,0,74,78,4,2,0,1,6,255,0,3,6,4,6,20,6,6,4,83,2,6,0,82,5,0,0,38,6,5,8,120,6,13,0,1,7,0,0,109,0,8,7,1,6,0,0,109,0,4,6,106,3,0,44,109,0,28,3,109,0,20,3,106,7,0,48,3,7,3,7,109,0,16,7,1,1,0,0,119,0,4,0,39,7,5,32,85,0,7,0,1,1,255,255,139,1,0,0,140,3,10,0,0,0,0,0,32,8,0,0,32,9,1,0,19,8,8,9,121,8,3,0,0,3,2,0,119,0,20,0,0,4,2,0,0,6,1,0,0,7,0,0,26,5,4,1,38,8,7,7,39,8,8,48,83,5,8,0,1,8,3,0,135,7,24,1,7,6,8,0,135,6,1,0,32,8,7,0,32,9,6,0,19,8,8,9,121,8,3,0,0,3,5,0,119,0,3,0,0,4,5,0,119,0,241,255,139,3,0,0,140,3,9,0,0,0,0,0,136,6,0,0,0,5,6,0,136,6,0,0,25,6,6,16,137,6,0,0,130,6,0,0,136,7,0,0,49,6,6,7,116,137,2,0,1,7,16,0,135,6,0,0,7,0,0,0,25,3,5,8,25,4,5,4,85,3,0,0,85,4,1,0,85,5,2,0,82,6,3,0,32,6,6,1,121,6,9,0,82,7,4,0,25,7,7,32,1,8,47,44,134,6,0,0,212,124,2,0,7,8,0,0,120,6,2,0,135,6,31,1,137,5,0,0,1,6,0,0,139,6,0,0,140,1,7,0,0,0,0,0,136,4,0,0,0,3,4,0,136,4,0,0,25,4,4,16,137,4,0,0,130,4,0,0,136,5,0,0,49,4,4,5,248,137,2,0,1,5,16,0,135,4,0,0,5,0,0,0,0,1,3,0,25,2,3,4,85,1,0,0,1,4,0,0,83,2,4,0,1,4,175,120,82,5,1,0,90,4,4,5,1,5,178,120,82,6,1,0,90,5,5,6,46,4,4,5,68,138,2,0,1,4,175,120,82,5,1,0,90,4,4,5,120,4,3,0,1,4,1,0,83,2,4,0,137,3,0,0,78,4,2,0,38,4,4,1,139,4,0,0,140,3,7,0,0,0,0,0,136,5,0,0,0,4,5,0,136,5,0,0,25,5,5,16,137,5,0,0,130,5,0,0,136,6,0,0,49,5,5,6,140,138,2,0,1,6,16,0,135,5,0,0,6,0,0,0,25,3,4,4,109,4,8,0,85,3,1,0,85,4,2,0,82,5,3,0,1,6,16,5,94,5,5,6,121,5,9,0,82,5,3,0,1,6,20,5,94,5,5,6,34,5,5,4,121,5,4,0,137,4,0,0,1,5,0,0,139,5,0,0,137,4,0,0,1,5,0,0,139,5,0,0,140,3,9,0,0,0,0,0,136,6,0,0,0,5,6,0,136,6,0,0,25,6,6,16,137,6,0,0,130,6,0,0,136,7,0,0,49,6,6,7,16,139,2,0,1,7,16,0,135,6,0,0,7,0,0,0,25,3,5,4,0,4,5,0,109,5,8,0,85,3,1,0,85,4,2,0,82,7,3,0,82,8,4,0,134,6,0,0,224,113,2,0,7,8,0,0,1,6,148,117,82,8,3,0,85,6,8,0,1,8,152,117,82,6,4,0,85,8,6,0,137,5,0,0,139,0,0,0,140,2,10,0,0,0,0,0,136,7,0,0,0,6,7,0,136,7,0,0,25,7,7,16,137,7,0,0,130,7,0,0,136,8,0,0,49,7,7,8,144,139,2,0,1,8,16,0,135,7,0,0,8,0,0,0,25,2,6,4,0,3,6,0,25,4,6,8,85,2,0,0,85,3,1,0,1,7,0,0,83,4,7,0,82,8,2,0,82,9,3,0,134,7,0,0,212,124,2,0,8,9,0,0,32,5,7,0,1,9,1,0,1,8,0,0,125,7,5,9,8,0,0,0,83,4,7,0,137,6,0,0,78,7,4,0,38,7,7,1,139,7,0,0,140,1,6,0,0,0,0,0,136,4,0,0,0,3,4,0,136,4,0,0,25,4,4,16,137,4,0,0,130,4,0,0,136,5,0,0,49,4,4,5,32,140,2,0,1,5,16,0,135,4,0,0,5,0,0,0,25,1,3,8,0,2,3,0,1,4,0,0,85,1,4,0,1,5,0,0,109,1,4,5,1,4,0,0,134,5,0,0,136,93,2,0,2,4,0,0,116,1,2,0,106,4,2,4,109,1,4,4,116,0,1,0,106,5,1,4,109,0,4,5,137,3,0,0,139,0,0,0,140,1,8,0,0,0,0,0,82,7,0,0,78,7,7,0,134,6,0,0,248,160,2,0,7,0,0,0,120,6,3,0,1,1,0,0,119,0,18,0,1,2,0,0,82,5,0,0,27,6,2,10,26,6,6,48,78,7,5,0,3,3,6,7,25,4,5,1,85,0,4,0,78,6,4,0,134,7,0,0,248,160,2,0,6,0,0,0,120,7,3,0,0,1,3,0,119,0,3,0,0,2,3,0,119,0,241,255,139,1,0,0,140,2,10,0,0,0,0,0,136,7,0,0,0,6,7,0,136,7,0,0,25,7,7,16,137,7,0,0,130,7,0,0,136,8,0,0,49,7,7,8,16,141,2,0,1,8,16,0,135,7,0,0,8,0,0,0,25,2,6,4,0,3,6,0,89,2,0,0,89,3,1,0,88,4,2,0,145,4,4,0,88,5,3,0,145,5,5,0,1,9,148,29,88,8,9,0,145,8,8,0,134,7,0,0,12,168,1,0,4,5,8,0,137,6,0,0,139,0,0,0,140,0,8,0,0,0,0,0,136,6,0,0,0,3,6,0,136,6,0,0,25,6,6,64,137,6,0,0,130,6,0,0,136,7,0,0,49,6,6,7,136,141,2,0,1,7,64,0,135,6,0,0,7,0,0,0,0,0,3,0,1,6,76,115,82,1,6,0,134,6,0,0,124,116,2,0,0,0,0,0,0,2,1,0,0,4,0,0,25,5,2,64,116,2,4,0,25,2,2,4,25,4,4,4,54,6,2,5,172,141,2,0,137,3,0,0,139,0,0,0,140,2,9,0,0,0,0,0,136,6,0,0,0,5,6,0,136,6,0,0,25,6,6,16,137,6,0,0,130,6,0,0,136,7,0,0,49,6,6,7,0,142,2,0,1,7,16,0,135,6,0,0,7,0,0,0,25,2,5,4,0,3,5,0,85,2,0,0,89,3,1,0,82,7,2,0,88,8,3,0,145,8,8,0,134,6,0,0,148,25,2,0,7,8,0,0,28,4,6,2,137,5,0,0,139,4,0,0,140,2,12,0,0,0,0,0,2,9,0,0,255,255,0,0,19,9,0,9,0,2,9,0,2,9,0,0,255,255,0,0,19,9,1,9,0,3,9,0,5,4,3,2,43,9,0,16,0,5,9,0,43,9,4,16,5,10,3,5,3,6,9,10,43,10,1,16,0,7,10,0,5,8,7,2,43,9,6,16,5,11,7,5,3,9,9,11,2,11,0,0,255,255,0,0,19,11,6,11,3,11,11,8,43,11,11,16,3,9,9,11,135,10,28,0,9,0,0,0,3,10,6,8,41,10,10,16,2,9,0,0,255,255,0,0,19,9,4,9,20,10,10,9,139,10,0,0,140,2,9,0,0,0,0,0,136,7,0,0,0,4,7,0,136,7,0,0,25,7,7,16,137,7,0,0,130,7,0,0,136,8,0,0,49,7,7,8,0,143,2,0,1,8,16,0,135,7,0,0,8,0,0,0,25,2,4,4,0,3,4,0,85,2,0,0,85,3,1,0,137,4,0,0,82,5,2,0,82,6,3,0,47,8,5,6,44,143,2,0,0,7,5,0,119,0,2,0,0,7,6,0,139,7,0,0,140,1,8,0,0,0,0,0,136,4,0,0,0,3,4,0,136,4,0,0,25,4,4,16,137,4,0,0,130,4,0,0,136,5,0,0,49,4,4,5,108,143,2,0,1,5,16,0,135,4,0,0,5,0,0,0,0,1,3,0,25,2,3,4,85,1,0,0,1,4,0,0,83,2,4,0,1,5,0,32,1,6,192,81,1,7,220,115,82,7,7,0,27,7,7,48,94,6,6,7,82,7,1,0,3,6,6,7,17,5,5,6,1,6,1,0,1,7,0,0,125,4,5,6,7,0,0,0,83,2,4,0,137,3,0,0,78,4,2,0,38,4,4,1,139,4,0,0,140,1,9,0,0,0,0,0,136,5,0,0,0,3,5,0,136,5,0,0,25,5,5,16,137,5,0,0,130,5,0,0,136,6,0,0,49,5,5,6,0,144,2,0,1,6,16,0,135,5,0,0,6,0,0,0,0,1,3,0,85,1,0,0,82,4,1,0,106,5,4,120,1,7,144,0,94,7,4,7,106,8,4,64,5,6,7,8,41,6,6,2,3,2,5,6,137,3,0,0,139,2,0,0,140,2,9,0,0,0,0,0,136,6,0,0,0,5,6,0,136,6,0,0,25,6,6,16,137,6,0,0,130,6,0,0,136,7,0,0,49,6,6,7,104,144,2,0,1,7,16,0,135,6,0,0,7,0,0,0,25,2,5,8,25,3,5,4,0,4,5,0,85,2,0,0,85,3,1,0,82,7,2,0,82,8,3,0,134,6,0,0,104,106,2,0,7,8,0,0,85,4,6,0,137,5,0,0,82,6,4,0,139,6,0,0,140,1,7,0,0,0,0,0,106,5,0,68,121,5,19,0,1,5,132,0,94,4,0,5,1,5,128,0,3,1,0,5,121,4,4,0,1,5,128,0,82,6,1,0,97,4,5,6,82,3,1,0,120,3,6,0,134,6,0,0,128,161,2,0,1,5,232,0,3,2,6,5,119,0,3,0,1,5,132,0,3,2,3,5,85,2,4,0,139,0,0,0,140,2,7,0,0,0,0,0,120,0,3,0,1,2,0,0,119,0,14,0,5,3,1,0,2,5,0,0,255,255,0,0,20,6,1,0,48,5,5,6,64,145,2,0,7,5,3,0,13,5,5,1,1,6,255,255,125,2,5,3,6,0,0,0,119,0,2,0,0,2,3,0,135,4,6,0,2,0,0,0,120,4,2,0,139,4,0,0,26,6,4,4,82,6,6,0,38,6,6,3,120,6,2,0,139,4,0,0,1,5,0,0,135,6,3,0,4,5,2,0,139,4,0,0,140,1,6,0,0,0,0,0,136,4,0,0,0,3,4,0,136,4,0,0,25,4,4,16,137,4,0,0,130,4,0,0,136,5,0,0,49,4,4,5,176,145,2,0,1,5,16,0,135,4,0,0,5,0,0,0,25,1,3,4,0,2,3,0,85,2,0,0,1,4,255,3,1,5,60,117,82,5,5,0,19,4,4,5,82,5,2,0,45,4,4,5,228,145,2,0,1,4,1,0,83,1,4,0,119,0,3,0,1,4,0,0,83,1,4,0,137,3,0,0,78,4,1,0,38,4,4,1,139,4,0,0,140,1,5,0,0,0,0,0,136,3,0,0,0,2,3,0,136,3,0,0,25,3,3,16,137,3,0,0,130,3,0,0,136,4,0,0,49,3,3,4,52,146,2,0,1,4,16,0,135,3,0,0,4,0,0,0,0,1,2,0,85,1,0,0,82,3,1,0,1,4,1,23,45,3,3,4,92,146,2,0,1,3,76,115,1,4,12,115,85,3,4,0,119,0,8,0,82,4,1,0,1,3,0,23,45,4,4,3,120,146,2,0,1,4,76,115,1,3,80,115,85,4,3,0,1,3,144,29,82,4,1,0,85,3,4,0,137,2,0,0,139,0,0,0,140,3,8,0,0,0,0,0,25,3,0,20,82,4,3,0,106,7,0,16,4,5,7,4,16,7,2,5,125,6,7,2,5,0,0,0,135,7,32,0,4,1,6,0,82,7,3,0,3,7,7,6,85,3,7,0,139,2,0,0,140,3,8,0,0,0,0,0,120,2,3,0,1,3,0,0,119,0,15,0,1,6,255,0,19,6,1,6,0,5,6,0,0,4,2,0,26,4,4,1,90,6,0,4,41,7,5,24,42,7,7,24,52,6,6,7,16,147,2,0,120,4,250,255,1,3,0,0,119,0,2,0,3,3,0,4,139,3,0,0,140,2,5,0,0,0,0,0,136,3,0,0,0,2,3,0,136,3,0,0,25,3,3,16,137,3,0,0,130,3,0,0,136,4,0,0,49,3,3,4,80,147,2,0,1,4,16,0,135,3,0,0,4,0,0,0,109,2,4,0,85,2,1,0,1,3,16,0,1,4,8,118,82,4,4,0,49,3,3,4,116,147,2,0,137,2,0,0,139,0,0,0,1,3,8,118,1,4,8,118,82,4,4,0,25,4,4,1,85,3,4,0,137,2,0,0,139,0,0,0,140,2,7,0,0,0,0,0,136,5,0,0,0,4,5,0,136,5,0,0,25,5,5,16,137,5,0,0,130,5,0,0,136,6,0,0,49,5,5,6,200,147,2,0,1,6,16,0,135,5,0,0,6,0,0,0,25,2,4,4,0,3,4,0,85,2,0,0,85,3,1,0,137,4,0,0,82,5,2,0,82,6,3,0,41,6,6,3,3,5,5,6,139,5,0,0,140,3,7,0,0,0,0,0,136,5,0,0,0,4,5,0,136,5,0,0,25,5,5,32,137,5,0,0,130,5,0,0,136,6,0,0,49,5,5,6,40,148,2,0,1,6,32,0,135,5,0,0,6,0,0,0,0,3,4,0,109,4,16,0,111,4,8,1,87,3,2,0,1,5,4,118,86,6,3,0,75,6,6,0,85,5,6,0,137,4,0,0,139,0,0,0,140,1,6,0,0,0,0,0,136,4,0,0,0,3,4,0,136,4,0,0,25,4,4,16,137,4,0,0,130,4,0,0,136,5,0,0,49,4,4,5,136,148,2,0,1,5,16,0,135,4,0,0,5,0,0,0,0,1,3,0,85,1,0,0,82,5,1,0,112,4,5,60,145,4,4,0,134,2,0,0,200,149,2,0,4,0,0,0,137,3,0,0,139,2,0,0,140,1,7,0,0,0,0,0,136,5,0,0,0,4,5,0,136,5,0,0,25,5,5,16,137,5,0,0,130,5,0,0,136,6,0,0,49,5,5,6,232,148,2,0,1,6,16,0,135,5,0,0,6,0,0,0,0,3,4,0,0,1,3,0,1,5,0,0,85,1,5,0,1,6,0,0,109,1,4,6,0,2,3,0,26,6,0,1,85,2,6,0,1,5,0,0,109,2,4,5,137,4,0,0,139,0,0,0,140,1,6,0,0,0,0,0,136,4,0,0,0,3,4,0,136,4,0,0,25,4,4,16,137,4,0,0,130,4,0,0,136,5,0,0,49,4,4,5,84,149,2,0,1,5,16,0,135,4,0,0,5,0,0,0,0,1,3,0,85,1,0,0,82,5,1,0,112,4,5,56,145,4,4,0,134,2,0,0,200,149,2,0,4,0,0,0,137,3,0,0,139,2,0,0,140,3,6,0,0,0,0,0,136,4,0,0,0,3,4,0,136,4,0,0,25,4,4,16,137,4,0,0,130,4,0,0,136,5,0,0,49,4,4,5,180,149,2,0,1,5,16,0,135,4,0,0,5,0,0,0,113,3,8,0,113,3,4,1,89,3,2,0,137,3,0,0,139,0,0,0,140,1,6,0,0,0,0,0,136,4,0,0,0,3,4,0,136,4,0,0,25,4,4,16,137,4,0,0,130,4,0,0,136,5,0,0,49,4,4,5,0,150,2,0,1,5,16,0,135,4,0,0,5,0,0,0,0,1,3,0,89,1,0,0,88,4,1,0,145,4,4,0,59,5,1,0,145,5,5,0,73,4,4,5,38,4,4,1,0,2,4,0,137,3,0,0,139,2,0,0,140,2,5,0,0,0,0,0,136,3,0,0,0,2,3,0,136,3,0,0,25,3,3,16,137,3,0,0,130,3,0,0,136,4,0,0,49,3,3,4,100,150,2,0,1,4,16,0,135,3,0,0,4,0,0,0,109,2,4,0,85,2,1,0,137,2,0,0,139,0,0,0,140,1,5,0,0,0,0,0,1,1,12,115,0,2,0,0,25,3,1,64,116,1,2,0,25,1,1,4,25,2,2,4,54,4,1,3,136,150,2,0,139,0,0,0,140,1,5,0,0,0,0,0,1,1,80,115,0,2,0,0,25,3,1,64,116,1,2,0,25,1,1,4,25,2,2,4,54,4,1,3,180,150,2,0,139,0,0,0,140,2,5,0,0,0,0,0,136,3,0,0,0,2,3,0,136,3,0,0,25,3,3,16,137,3,0,0,130,3,0,0,136,4,0,0,49,3,3,4,4,151,2,0,1,4,16,0,135,3,0,0,4,0,0,0,109,2,4,0,85,2,1,0,137,2,0,0,139,0,0,0,140,1,5,0,0,0,0,0,0,1,0,0,1,2,56,118,25,3,1,36,116,1,2,0,25,1,1,4,25,2,2,4,54,4,1,3,40,151,2,0,139,0,0,0,140,4,7,0,0,0,0,0,4,5,1,3,0,4,5,0,16,6,0,2,4,4,5,6,135,6,28,0,4,0,0,0,4,6,0,2,139,6,0,0,140,1,5,0,0,0,0,0,134,1,0,0,220,161,2,0,82,4,1,0,109,0,56,4,82,2,1,0,121,2,2,0,109,2,52,0,85,1,0,0,134,4,0,0,24,162,2,0,139,0,0,0,140,1,4,0,0,0,0,0,136,2,0,0,0,1,2,0,136,2,0,0,25,2,2,16,137,2,0,0,130,2,0,0,136,3,0,0,49,2,2,3,212,151,2,0,1,3,16,0,135,2,0,0,3,0,0,0,89,1,0,0,137,1,0,0,59,2,0,0,145,2,2,0,139,2,0,0,140,1,4,0,0,0,0,0,136,2,0,0,0,1,2,0,136,2,0,0,25,2,2,16,137,2,0,0,130,2,0,0,136,3,0,0,49,2,2,3,32,152,2,0,1,3,16,0,135,2,0,0,3,0,0,0,89,1,0,0,137,1,0,0,59,2,2,0,145,2,2,0,139,2,0,0,140,1,4,0,0,0,0,0,136,2,0,0,0,1,2,0,136,2,0,0,25,2,2,16,137,2,0,0,130,2,0,0,136,3,0,0,49,2,2,3,108,152,2,0,1,3,16,0,135,2,0,0,3,0,0,0,89,1,0,0,137,1,0,0,59,2,1,0,145,2,2,0,139,2,0,0,140,0,4,0,0,0,0,0,136,2,0,0,0,1,2,0,136,2,0,0,25,2,2,16,137,2,0,0,130,2,0,0,136,3,0,0,49,2,2,3,184,152,2,0,1,3,16,0,135,2,0,0,3,0,0,0,0,0,1,0,59,2,0,0,87,0,2,0,137,1,0,0,86,2,0,0,139,2,0,0,140,2,6,0,0,0,0,0,82,4,1,0,1,5,8,0,26,5,5,1,3,4,4,5,1,5,8,0,26,5,5,1,11,5,5,0,19,4,4,5,0,2,4,0,86,3,2,0,25,4,2,8,85,1,4,0,87,0,3,0,139,0,0,0,140,5,6,0,0,0,0,0,135,5,190,0,0,1,2,3,4,0,0,0,139,0,0,0,140,5,6,0,0,0,0,0,135,5,175,0,0,1,2,3,4,0,0,0,139,0,0,0,140,9,11,0,0,0,0,0,1,10,27,0,135,9,35,1,10,0,0,0,139,0,0,0,140,1,4,0,0,0,0,0,127,2,0,0,87,2,0,0,127,2,0,0,82,1,2,0,127,3,0,0,106,3,3,4,135,2,28,0,3,0,0,0,139,1,0,0,140,1,4,0,0,0,0,0,41,2,0,16,42,2,2,16,120,2,3,0,1,1,0,0,119,0,8,0,134,2,0,0,136,162,2,0,2,3,0,0,255,255,0,0,19,3,0,3,85,2,3,0,1,1,255,255,139,1,0,0,140,1,6,0,0,0,0,0,78,2,0,0,102,3,0,1,102,4,0,2,102,5,0,3,134,1,0,0,132,38,2,0,2,3,4,5,134,1,0,0,104,161,2,0,139,0,0,0,140,4,8,0,0,0,0,0,3,4,0,2,3,6,1,3,16,7,4,0,3,6,6,7,135,5,28,0,6,0,0,0,139,4,0,0,140,4,5,0,0,0,0,0,135,4,188,0,0,1,2,3,139,0,0,0,140,1,4,0,0,0,0,0,1,2,0,240,48,2,2,0,88,154,2,0,134,2,0,0,136,162,2,0,1,3,0,0,4,3,3,0,85,2,3,0,1,1,255,255,119,0,2,0,0,1,0,0,139,1,0,0,140,8,10,0,0,0,0,0,1,9,26,0,135,8,36,1,9,0,0,0,139,0,0,0,140,4,5,0,0,0,0,0,135,4,166,0,0,1,2,3,139,0,0,0,140,4,5,0,0,0,0,0,135,4,157,0,0,1,2,3,139,0,0,0,140,4,5,0,0,0,0,0,135,4,128,0,0,1,2,3,139,0,0,0,140,4,6,0,0,0,0,0,1,5,0,0,134,4,0,0,148,225,0,0,0,1,2,3,5,0,0,0,139,4,0,0,140,2,6,0,0,0,0,0,134,2,0,0,148,248,1,0,0,1,0,0,78,4,2,0,1,5,255,0,19,5,1,5,41,5,5,24,42,5,5,24,13,4,4,5,1,5,0,0,125,3,4,2,5,0,0,0,139,3,0,0,140,7,9,0,0,0,0,0,1,8,25,0,135,7,37,1,8,0,0,0,139,0,0,0,140,5,7,0,0,0,0,0,1,6,18,0,135,5,38,1,6,0,0,0,139,0,0,0,140,2,6,0,0,0,0,0,134,3,0,0,68,7,2,0,0,1,0,0,3,2,0,3,78,4,2,0,32,4,4,0,1,5,0,0,125,3,4,5,2,0,0,0,139,3,0,0,140,0,2,0,0,0,0,0,1,0,192,81,1,1,220,115,82,1,1,0,27,1,1,48,94,0,0,1,36,0,0,0,121,0,2,0,139,0,0,0,134,0,0,0,116,43,2,0,134,0,0,0,108,41,1,0,139,0,0,0,140,2,5,0,0,0,0,0,135,2,15,0,0,0,0,0,1,4,1,0,134,3,0,0,88,130,2,0,0,4,2,1,14,3,3,2,41,3,3,31,42,3,3,31,139,3,0,0,140,3,4,0,0,0,0,0,135,3,186,0,0,1,2,0,139,0,0,0,140,2,2,0,0,0,0,0,137,0,0,0,132,0,0,1,139,0,0,0,140,6,8,0,0,0,0,0,1,7,4,0,135,6,39,1,7,0,0,0,1,6,0,0,139,6,0,0,140,3,4,0,0,0,0,0,135,3,115,0,0,1,2,0,139,0,0,0,140,3,4,0,0,0,0,0,135,3,124,0,0,1,2,0,139,0,0,0,140,6,8,0,0,0,0,0,1,7,24,0,135,6,40,1,7,0,0,0,139,0,0,0,140,4,6,0,0,0,0,0,1,5,11,0,135,4,41,1,5,0,0,0,139,0,0,0,140,2,4,0,0,0,0,0,120,0,3,0,1,2,0,0,119,0,5,0,1,3,0,0,134,2,0,0,252,36,2,0,0,1,3,0,139,2,0,0,140,3,4,0,0,0,0,0,82,3,0,0,38,3,3,32,120,3,4,0,134,3,0,0,200,0,2,0,1,2,0,0,139,0,0,0,140,4,6,0,0,0,0,0,1,5,0,0,135,4,28,0,5,0,0,0,1,4,0,0,139,4,0,0,140,4,6,0,0,0,0,0,1,5,17,0,135,4,42,1,5,0,0,0,139,0,0,0,140,2,3,0,0,0,0,0,135,2,100,0,0,1,0,0,139,0,0,0,140,0,2,0,0,0,0,0,1,0,192,81,1,1,220,115,82,1,1,0,27,1,1,48,94,0,0,1,1,1,0,32,47,0,0,1,56,157,2,0,139,0,0,0,134,0,0,0,112,155,2,0,139,0,0,0,140,2,3,0,0,0,0,0,135,2,184,0,0,1,0,0,139,0,0,0,140,2,3,0,0,0,0,0,135,2,104,0,0,1,0,0,139,0,0,0,140,2,3,0,0,0,0,0,135,2,45,0,0,1,0,0,139,0,0,0,140,1,4,0,0,0,0,0,106,3,0,60,134,2,0,0,248,161,2,0,3,0,0,0,135,1,28,1,2,0,0,0,2,2,0,0,255,255,0,0,19,1,1,2,139,1,0,0,140,5,7,0,0,0,0,0,1,6,23,0,135,5,43,1,6,0,0,0,139,0,0,0,140,3,6,0,0,0,0,0,1,4,1,0,1,5,5,0,134,3,0,0,236,230,1,0,0,1,2,4,5,0,0,0,139,3,0,0,140,3,5,0,0,0,0,0,2,4,0,0,255,255,255,127,134,3,0,0,112,24,2,0,0,4,1,2,139,3,0,0,140,2,3,0,0,0,0,0,135,2,120,0,0,1,0,0,139,0,0,0,140,4,6,0,0,0,0,0,1,5,7,0,135,4,44,1,5,0,0,0,1,4,0,0,139,4,0,0,140,1,4,0,0,0,0,0,134,2,0,0,228,160,2,0,0,0,0,0,32,1,2,0,121,1,3,0,0,2,0,0,119,0,3,0,39,3,0,32,0,2,3,0,139,2,0,0,140,2,4,0,0,0,0,0,135,3,15,0,0,0,0,0,25,3,3,1,134,2,0,0,200,146,2,0,0,1,3,0,139,2,0,0,140,2,4,0,0,0,0,0,1,3,1,0,135,2,45,1,3,0,0,0,59,2,0,0,145,2,2,0,139,2,0,0,140,4,6,0,0,0,0,0,1,5,22,0,135,4,46,1,5,0,0,0,139,0,0,0,140,3,5,0,0,0,0,0,1,4,16,0,135,3,47,1,4,0,0,0,139,0,0,0,140,2,4,0,0,0,0,0,1,3,172,29,82,3,3,0,134,2,0,0,200,157,2,0,3,0,1,0,139,2,0,0,140,1,2,0,0,0,0,0,135,1,167,0,0,0,0,0,139,0,0,0,140,1,4,0,0,0,0,0,59,2,0,0,74,2,0,2,121,2,8,0,61,3,0,0,0,0,0,63,63,3,0,3,135,2,0,1,3,0,0,0,58,1,2,0,119,0,7,0,61,3,0,0,0,0,0,63,64,3,0,3,135,2,11,0,3,0,0,0,58,1,2,0,139,1,0,0,140,3,5,0,0,0,0,0,1,4,6,0,135,3,48,1,4,0,0,0,1,3,0,0,139,3,0,0,140,3,5,0,0,0,0,0,1,4,20,0,135,3,49,1,4,0,0,0,139,0,0,0,140,1,2,0,0,0,0,0,135,1,97,0,0,0,0,0,139,0,0,0,140,0,4,0,0,0,0,0,1,1,32,3,1,2,194,1,1,3,168,30,134,0,0,0,196,13,2,0,1,2,3,0,1,3,1,0,1,2,0,0,1,1,1,0,135,0,50,1,3,2,1,0,1,0,0,0,139,0,0,0,140,3,5,0,0,0,0,0,1,4,21,0,135,3,51,1,4,0,0,0,139,0,0,0,140,2,4,0,0,0,0,0,1,3,10,0,135,2,52,1,3,0,0,0,139,0,0,0,140,0,3,0,0,0,0,0,1,2,0,0,135,1,53,1,2,0,0,0,134,0,0,0,176,148,2,0,1,0,0,0,1,0,224,114,134,1,0,0,120,162,2,0,87,0,1,0,139,0,0,0,140,3,5,0,0,0,0,0,1,4,14,0,135,3,54,1,4,0,0,0,139,0,0,0,140,1,3,0,0,0,0,0,1,2,0,0,135,1,55,1,2,0,0,0,59,1,0,0,145,1,1,0,139,1,0,0,140,1,3,0,0,0,0,0,82,2,0,0,135,1,5,0,2,0,0,0,139,0,0,0,140,2,4,0,0,0,0,0,1,3,5,0,135,2,56,1,3,0,0,0,1,2,0,0,139,2,0,0,140,2,4,0,0,0,0,0,1,3,15,0,135,2,57,1,3,0,0,0,139,0,0,0,140,2,4,0,0,0,0,0,1,3,12,0,135,2,58,1,3,0,0,0,139,0,0,0,140,1,2,0,0,0,0,0,26,1,0,65,35,1,1,26,139,1,0,0,140,1,2,0,0,0,0,0,26,1,0,48,35,1,1,10,139,1,0,0,140,0,2,0,0,0,0,0,1,1,136,117,82,1,1,0,135,0,59,1,1,0,0,0,139,0,0,0,140,2,4,0,0,0,0,0,1,3,19,0,135,2,60,1,3,0,0,0,139,0,0,0,140,1,2,0,0,0,0,0,1,1,0,0,139,1,0,0,140,0,2,0,0,0,0,0,1,1,232,114,86,0,1,0,145,0,0,0,139,0,0,0,140,0,2,0,0,0,0,0,1,1,0,65,135,0,27,0,1,0,0,0,139,0,0,0,140,0,1,0,0,0,0,0,134,0,0,0,180,162,2,0,139,0,0,0,140,0,1,0,0,0,0,0,134,0,0,0,180,162,2,0,139,0,0,0,140,1,3,0,0,0,0,0,1,2,3,0,135,1,61,1,2,0,0,0,1,1,0,0,139,1,0,0,140,1,3,0,0,0,0,0,1,2,9,0,135,1,62,1,2,0,0,0,139,0,0,0,140,0,2,0,0,0,0,0,1,1,164,118,135,0,63,1,1,0,0,0,1,0,172,118,139,0,0,0,140,1,1,0,0,0,0,0,139,0,0,0,140,0,1,0,0,0,0,0,1,0,152,117,82,0,0,0,139,0,0,0,140,0,2,0,0,0,0,0,1,1,164,118,135,0,64,1,1,0,0,0,139,0,0,0,140,0,1,0,0,0,0,0,1,0,148,117,82,0,0,0,139,0,0,0,140,1,1,0,0,0,0,0,139,0,0,0,140,1,2,0,0,0,0,0,1,1,1,0,139,1,0,0,140,1,3,0,0,0,0,0,1,2,13,0,135,1,65,1,2,0,0,0,139,0,0,0,140,0,1,0,0,0,0,0,135,0,66,1,139,0,0,0,140,0,1,0,0,0,0,0,1,0,160,118,139,0,0,0,140,0,2,0,0,0,0,0,1,1,2,0,135,0,67,1,1,0,0,0,1,0,0,0,139,0,0,0,140,0,1,0,0,0,0,0,1,0,180,29,139,0,0,0,140,0,1,0,0,0,0,0,1,0,4,0,139,0,0,0,140,0,2,0,0,0,0,0,1,1,8,0,135,0,68,1,1,0,0,0,139,0,0,0,0,0,0,0], eb + 163840);

  var relocations = [];
  relocations = relocations.concat([72,764,1016,1420,1460,1588,1620,1652,1696,1792,1852,1996,2056,2096,2152,2248,2476,2656,2684,2736,2832,2924,2960,3664,3676,3708,3740,3792,3888,3920,4140,4168,4248,4296,4564,4652,4672,4768,4772,4776,4780,4784,4788,4792,4796,4800,4804,4808,4812,4816,4820,4824,4828,4832,4836,4840,4844,4848,4852,4856,4860,4864,4868,4872,4876,4880,4884,4888,4892,4896,4900,4904,4908,4912,4916,5992,6060,6352,6356,6360,6364,6368,6372,6376,6380,6384,6388,6392,6396,6400,6404,6408,6412,6416,6420,6424,6428,6432,6436,6440,6444,6448,6452,6456,6460,6464,6468,6472,6476,6480,6484,6488,6492,6496,6500,6504,6508,6512,6516,6520,6524,6528,6532,6536,6540,6544,6548,6552,6556,6560,6564,6568,6572,6972,6976,6980,6984,6988,6992,6996,7000,7720,7856,7888,8040,8444,8528,8776,8984,8988,8992,8996,9000,9004,9008,9012,9016,9020,9096,9392,9792,10132,10476,10916,11332,11716,12000,12256,12688,12948,13068,13272,13336,13460,13508,13576,13676,13832,14064,14104,14180,14316,14348,14440,14540,14856,15080,15296,15328,15668,15792,15816,16000,16132,16260,16392,16596,17028,17048,17064,17088,17188,17192,17196,17200,17204,17208,17212,17216,17260,17336,17452,17528,17716,17792,17916,17992,18224,18300,18420,18496,18720,18796,18896,18972,19192,19348,19364,19504,19528,19620,19644,19772,20460,20464,20468,20472,20492,20608,20648,20868,20984,21184,21300,21588,21704,22072,22188,22672,23172,23176,23180,23184,23208,23332,23444,23660,23772,24040,24160,24516,24636,25072,25192,25816,25836,25916,25944,25952,25968,25980,26032,26048,26068,26116,26244,26280,26300,26320,26380,26448,26472,26524,26552,26608,26660,26696,26748,26796,26864,26892,26900,26916,26928,26972,26988,27008,27048,27176,27212,27232,27252,27300,27360,27384,27428,27456,27500,27548,27612,27700,27772,28028,28128,28168,28304,28608,28680,28768,28788,28808,28828,28848,28868,28992,29008,29412,29440,29504,29568,29720,29772,29800,29864,29928,30132,30832,31148,31284,31300,31416,31432,31540,31544,31548,31552,31556,31560,31564,31568,31620,31660,31832,31872,32128,32168,32348,32388,32720,32760,32928,32968,33276,33316,33436,33476,33740,33972,34080,34116,34152,34192,34232,34260,34264,34268,34272,34292,34404,34544,34736,35016,35376,35828,35832,35836,35840,35844,35848,35852,35856,35860,35864,35868,35872,35876,35880,35884,35888,35892,35896,35900,35904,35908,35912,35916,35920,35924,35928,35932,35936,35940,35944,35948,35952,35956,35960,35964,35968,35972,35976,35980,35984,36288,36520,36608,36632,36812,36832,36852,37328,37388,37472,37560,37628,37688,37772,37860,37928,37988,38072,38160,38228,38284,38360,38440,38552,38652,38696,40712,45364,45672,45708,45744,45780,45816,45856,45984,46012,46100,46132,46820,46936,47276,47356,47428,47448,47452,47456,47460,47464,47468,47472,47476,47480,47484,49764,49872,50020,50040,50044,50048,50052,50056,50060,50064,50068,50072,50076,52252,52380,52804,54928,55472,55620,57172,57216,57380,57440,57500,57544,59124,59452,59612,59628,59728,59816,59880,59920,61096,61208,61280,63056,63640,64064,64192,64196,64200,64204,64228,64268,64412,64536,64748,65040,65472,65772,65780,65836,65888,65968,65976,66032,66084,66344,66384,66556,66636,66656,66756,67084,67220,67688,67964,71828,72128,72144,72148,72152,72156,72160,72164,72432,72436,72440,72444,72448,72452,72492,72584,72676,72788,72940,73036,73196,73388,73432,73460,73492,73648,73796,73824,73856,74000,74136,74300,74436,74460,74616,74836,74856,74880,74904,75000,75028,75100,75120,75144,75308,75340,75372,75380,75396,75408,75452,75468,75488,75528,75656,75692,75712,75732,75784,75844,75868,75912,75940,75984,76212,76324,76356,76412,76460,76492,76536,76584,76616,76672,77244,77796,77828,77852,78112,78288,78980,79012,79048,80032,80224,80296,81172,81744,82048,82392,82956,83036,83516,84188,84656,84788,84868,85996,86072,86144,86276,86352,86424,86500,86896,87756,88392,88448,88916,89728,89752,89972,89996,90388,90532,90692,90784,90800,90816,90852,90864,90880,90892,91056,91072,91224,91240,91256,91292,91304,91320,91332,91540,91608,92888,93092,93160,93216,93832,94108,94192,94216,94240,94264,95272,95400,95680,95912,96208,96340,96616,96776,96820,96940,97068,97144,97200,97608,97664,97876,97996,98656,98756,98760,98764,98768,98772,98776,98780,98784,98788,98792,98796,98800,98804,98808,98812,98816,98820,98824,98828,98832,98836,99720,99760,99784,99852,99856,99860,99864,99936,99952,100040,100064,100084,100088,100092,100096,100200,100204,100208,100212,100468,100472,100476,100672,101320,101392,101564,101632,101688,102176,102944,103032,103316,103532,103652,103680,103700,103728,103876,104056,104316,104344,104368,104504,104668,104672,104676,104680,104684,104688,104692,104696,104700,104704,105440,105704,105796,105820,105836,105940,106124,106228,106680,106788,106948,106992,107072,107168,107264,108028,108144,108176,108200,108224,108600,108760,108824,109152,109168,109276,109292,110188,110592,110820,111168,111200,111244,111320,111380,111432,112044,112212,112716,112888,112928,113024,113084,113144,113300,113440,113724,113772,113804,113848,113904,113992,114024,114128,114160,114204,114248,114280,114324,114412,114476,114528,115140,115272,115668,115864,116388,116488,116504,116564,116580,116708,117164,117264,117432,117716,118448,118932,119380,119828,120316,120808,120876,120880,120884,120888,120956,121008,121052,121088,121144,121668,122504,122672,122764,122876,122996,123320,123520,123772,124276,124404,124696,124760,124816,125160,125328,125368,125424,125588,125856,126032,126540,126740,126992,127416,127864,128032,128064,128108,128164,128468,128532,128576,128800,128856,128940,128964,128996,129028,129640,130096,130536,130872,131368,131504,131604,131824,132000,132156,132188,132232,132288,132540,132608,132984,133348,133668,133804,133984,134248,134300,134636,135112,135192,135196,135200,135204,135208,135212,135216,135220,135224,135228,135232,135236,135240,135244,135248,135252,135256,135260,135264,135268,135272,135524,135692,135708,135744,135840,136120,136196,136284,136336,136452,136624,137072,137176,137228,137292,137376,137436,137660,137740,138028,138080,138084,138088,138092,138096,138100,138104,138108,138112,138116,138120,138124,138128,138132,138136,138140,138392,138700,139000,139104,139280,139560,139664,139684,139688,139692,139696,139700,139704,139856,139992,140028,140244,140384,140628,140676,140832,140972,141252,141572,141768,142012,142040,142136,142156,142668,143488,143728,144008,144076,144156,144464,144576,144600,144712,144924,145396,145488,145640,145836,146008,146180,146408,146472,146544,146668,146672,146676,146680,146684,146688,146692,146696,146700,146704,146708,146712,146716,146720,146724,146728,146732,146736,146740,146744,146748,146752,146756,146760,146764,146768,146772,146776,146780,146784,146788,146792,146796,146800,146804,146808,146812,146816,146820,146824,146828,146832,146836,146840,146844,146848,146852,146856,146860,146864,146868,146872,146876,146880,146884,146888,146892,146896,146900,146904,146908,146912,146916,146920,146924,146928,146932,146936,146940,146944,146948,146952,146956,146960,146964,146968,146972,146976,146980,146984,146988,146992,146996,147000,147004,147008,147012,147016,147020,147024,147028,147032,147036,147040,147044,147048,147052,147056,147060,147064,147068,147072,147076,147080,147084,147088,147092,147096,147100,147104,147108,147112,147116,147120,147124,147128,147132,147136,147140,147144,147148,147152,147156,147160,147164,147168,147172,147176,147180,147184,147188,147192,147196,147200,147204,147208,147212,147216,147220,147224,147228,147232,147236,147240,147244,147248,147252,147256,147260,147264,147268,147272,147276,147280,147284,147288,147292,147296,147300,147304,147308,147312,147316,147320,147324,147328,147332,147336,147340,147344,147348,147352,147356,147360,147364,147368,147372,147376,147380,147384,147388,147392,147396,147400,147404,147408,147412,147416,147420,147424,147428,147432,147436,147440,147444,147448,147452,147456,147460,147464,147468,147472,147476,147480,147484,147488,147492,147496,147500,147504,147508,147512,147516,147520,147524,147528,147532,147536,147540,147544,147548,147552,147556,147560,147564,147568,147572,147576,147580,147584,147588,147592,147596,147600,147604,147608,147612,147616,147620,147624,147628,147632,147636,147640,147644,147648,147652,147656,147660,147664,147668,147672,147676,147680,147684,147688,147692,147696,147700,147704,147708,147712,147716,147720,147724,147728,147732,147736,147740,147744,147748,147752,147756,147760,147764,147768,147772,147776,147780,147784,147788,147792,147796,147800,147804,147808,147812,147816,147820,147824,147828,147832,147836,147840,147844,147848,147852,147856,147860,147864,147868,147872,147876,147880,147884,147888,147892,147896,147900,147904,147908,147912,147916,147920,147924,147928,147932,147936,147940,147944,147948,147952,147956,147960,147964,147968,147972,147976,147980,147984,147988,147992,147996,148000,148004,148008,148012,148016,148020,148024,148028,148032,148036,148040,148044,148048,148052,148056,148060,148064,148068,148072,148076,148080,148084,148088,148092,148096,148100,148104,148108,148112,148116,148120,148124,148128,148132,148136,148140,148144,148148,148152,148156,148160,148164,148168,148172,148176,148180,148184,148188,148192,148196,148200,148204,148208,148212,148216,148220,148224,148228,148232,148236,148240,148244,148248,148252,148256,148260,148264,148268,148272,148276,148280,148284,148288,148292,148296,148300,148304,148308,148312,148316,148320,148324,148328,148332,148336,148340,148344,148348,148352,148356,148360,148364,148368,148372,148376,148380,148384,148388,148392,148396,148400,148404,148408,148412,148416,148420,148424,148428,148432,148436,148440,148444,148448,148452,148456,148460,148464,148468,148472,148476,148480,148484,148488,148492,148496,148500,148504,148508,148512,148516,148520,148524,148528,148532,148536,148540,148544,148548,148552,148556,148560,148564,148568,148572,148576,148580,148584,148588,148592,148596,148600,148604,148608,148612,148616,148620,148624,148628,148632,148636,148640,148644,148648,148652,148656,148660,148664,148668,148672,148676,148680,148684,148688,148692,148696,148700,148704,148708,148712,148716,148720,148724,148728,148732,148736,148740,148744,148748,148752,148756,148760,148764,148768,148772,148776,148780,148784,148788,148792,148796,148800,148804,148808,148812,148816,148820,148824,148828,148832,148836,148840,148844,148848,148852,148856,148860,148864,148868,148872,148876,148880,148884,148888,148892,148896,148900,148904,148908,148912,148916,148920,148924,148928,148932,148936,148940,148944,148948,148952,148956,148960,148964,148968,148972,148976,148980,148984,148988,148992,148996,149000,149004,149008,149012,149016,149020,149024,149028,149032,149036,149040,149044,149048,149052,149056,149060,149064,149068,149072,149076,149080,149084,149088,149092,149096,149100,149104,149108,149112,149116,149120,149124,149128,149132,149136,149140,149144,149148,149152,149156,149160,149164,149168,149172,149176,149180,149184,149188,149192,149196,149200,149204,149208,149212,149216,149220,149224,149228,149232,149236,149240,149244,149248,149252,149256,149260,149264,149268,149272,149276,149280,149284,149288,149292,149296,149300,149304,149308,149312,149316,149320,149324,149328,149332,149336,149340,149344,149348,149352,149356,149360,149364,149368,149372,149376,149380,149384,149388,149392,149396,149400,149404,149408,149412,149416,149420,149424,149428,149432,149436,149440,149444,149448,149452,149456,149460,149464,149468,149472,149476,149480,149484,149488,149492,149496,149500,149504,149508,149512,149516,149520,149524,149528,149532,149536,149540,149544,149548,149552,149556,149560,149564,149568,149572,149576,149580,149584,149588,149592,149596,149600,149604,149608,149612,149616,149620,149624,149628,149632,149636,149640,149644,149648,149652,149656,149660,149664,149668,149672,149676,149680,149684,149688,149692,149696,149700,149704,149708,149712,149716,149720,149724,149728,149732,149736,149740,149744,149748,149752,149756,149760,149764,149768,149772,149776,149780,149784,149788,149792,149796,149800,149804,149808,149812,149816,149820,149824,149828,149832,149836,149840,149844,149848,149852,149856,149860,149864,149868,149872,149876,149880,149884,149888,149892,149896,149900,149904,149908,149912,149916,149920,149924,149928,149932,149936,149940,149944,149948,149952,149956,149960,149964,149968,149972,149976,149980,149984,149988,149992,149996,150000,150004,150008,150012,150016,150020,150024,150028,150032,150036,150040,150044,150048,150052,150056,150060,150064,150068,150072,150076,150080,150084,150088,150092,150096,150100,150104,150108,150112,150116,150120,150124,150128,150132,150136,150140,150144,150148,150152,150156,150160,150164,150168,150172,150176,150180,150184,150188,150192,150196,150200,150204,150208,150212,150216,150220,150224,150228,150232,150236,150240,150244,150248,150252,150256,150260,150264,150268,150272,150276,150280,150284,150288,150292,150296,150300,150304,150308,150312,150316,150320,150324,150328,150332,150336,150340,150344,150348,150352,150356,150360,150364,150368,150372,150376,150380,150384,150388,150392,150396,150400,150404,150408,150412,150416,150420,150424,150428,150432,150436,150440,150444,150448,150452,150456,150460,150464,150468,150472,150476,150480,150484,150488,150492,150496,150500,150504,150508,150512,150516,150520,150524,150528,150532,150536,150540,150544,150548,150552,150556,150560,150564,150568,150572,150576,150580,150584,150588,150592,150596,150600,150604,150608,150612,150616,150620,150624,150628,150632,150636,150640,150644,150648,150652,150656,150660,150664,150668,150672,150676,150680,150684,150688,150692,150696,150700,150704,150708,150712,150716,150720,150724,150728,150732,150736,150740,150744,150748,150752,150756,150760,150764,150768,150772,150776,150780,150784,150788,150792,150796,150800,150804,150808,150812,150816,150820,150824,150828,150832,150836,150840,150844,150848,150852,150856,150860,150864,150868,150872,150876,150880,150884,150888,150892,150896,150900,150904,150908,150912,150916,150920,150924,150928,150932,150936,150940,150944,150948,150952,150956,150960,150964,150968,150972,150976,150980,150984,150988,150992,150996,151000,151004,151008,151012,151016,151020,151024,151028,151032,151036,151040,151044,151048,151052,151056,151060,151064,151068,151072,151076,151080,151084,151088,151092,151096,151100,151104,151108,151112,151116,151120,151124,151128,151132,151136,151140,151144,151148,151152,151156,151160,151164,151168,151172,151176,151180,151184,151188,151192,151196,151200,151204,151208,151212,151216,151220,151224,151228,151232,151236,151240,151244,151248,151252,151256,151260,151264,151268,151272,151276,151280,151284,151288,151292,151296,151300,151304,151308,151312,151316,151320,151324,151328,151332,151336,151340,151344,151348,151352,151356,151360,151364,151368,151372,151376,151380,151384,151388,151392,151396,151400,151404,151408,151412,151416,151420,151424,151428,151432,151436,151440,151444,151448,151452,151456,151460,151464,151468,151472,151476,151480,151484,151488,151492,151496,151500,151504,151508,151512,151516,151520,151524,151528,151532,151536,151540,151544,151548,151552,151556,151560,151564,151568,151572,151576,151580,151584,151588,151592,151596,151600,151604,151608,151612,151616,151620,151624,151628,151632,151636,151640,151644,151648,151652,151656,151660,151664,151668,151672,151676,151680,151684,151688,151692,151696,151700,151704,151708,151712,151716,151720,151724,151728,151732,151736,151740,151744,151748,151752,151756,151760,151764,151768,151772,151776,151780,151784,151788,151792,151796,151800,151804,151808,151812,151816,151820,151824,151828,151832,151836,151840,151844,151848,151852,151856,151860,151864,151868,151872,151876,151880,151884,151888,151892,151896,151900,151904,151908,151912,151916,151920,151924,151928,151932,151936,151940,151944,151948,151952,151956,151960,151964,151968,151972,151976,151980,151984,151988,151992,151996,152000,152004,152008,152012,152016,152020,152024,152028,152032,152036,152040,152044,152048,152052,152056,152060,152064,152068,152072,152076,152080,152084,152088,152092,152096,152100,152104,152108,152112,152116,152120,152124,152128,152132,152136,152140,152144,152148,152152,152156,152160,152164,152168,152172,152176,152180,152184,152188,152192,152196,152200,152204,152208,152212,152216,152220,152224,152228,152232,152236,152240,152244,152248,152252,152256,152260,152264,152268,152272,152276,152280,152284,152288,152292,152296,152300,152304,152308,152312,152316,152320,152324,152328,152332,152336,152340,152344,152348,152352,152356,152360,152364,152368,152372,152376,152380,152384,152388,152392,152396,152400,152404,152408,152412,152416,152420,152424,152428,152432,152436,152440,152444,152448,152452,152456,152460,152464,152468,152472,152476,152480,152484,152488,152492,152496,152500,152504,152508,152512,152516,152520,152524,152528,152532,152536,152540,152544,152548,152552,152556,152560,152564,152568,152572,152576,152580,152584,152588,152592,152596,152600,152604,152608,152612,152616,152620,152624,152628,152632,152636,152640,152644,152648,152652,152656,152660,152664,152668,152672,152676,152680,152684,152688,152692,152696,152700,152704,152708,152712,152716,152720,152724,152728,152732,152736,152740,152744,152748,152752,152756,152760,152764,152768,152772,152776,152780,152784,152788,152792,152796,152800,152804,152808,152812,152816,152820,152824,152828,152832,152836,152840,152844,152848,152852,152856,152860,152864,152868,152872,152876,152880,152884,152888,152892,152896,152900,152904,152908,152912,152916,152920,152924,152928,152932,152936,152940,152944,152948,152952,152956,152960,152964,152968,152972,152976,152980,152984,152988,152992,152996,153000,153004,153008,153012,153016,153020,153024,153028,153032,153036,153040,153044,153048,153052,153056,153060,153064,153068,153072,153076,153080,153084,153088,153092,153096,153100,153104,153108,153112,153116,153120,153124,153128,153132,153136,153140,153144,153148,153152,153156,153160,153164,153168,153172,153176,153180,153184,153188,153192,153196,153200,153204,153208,153212,153216,153220,153224,153228,153232,153236,153240,153244,153248,153252,153256,153260,153264,153268,153272,153276,153280,153284,153288,153292,153296,153300,153304,153308,153312,153316,153320,153324,153328,153332,153336,153340,153344,153348,153352,153356,153360,153364,153368,153372,153376,153380,153384,153388,153392,153396,153400,153404,153408,153412,153416,153420,153424,153428,153432,153436,153440,153444,153448,153452,153456,153460,153464,153468,153472,153476,153480,153484,153488,153492,153496,153500,153504,153508,153512,153516,153520,153524,153528,153532,153536,153540,153544,153548,153552,153556,153560,153564,153568,153572,153576,153580,153584,153588,153592,153596,153600,153604,153608,153612,153616,153620,153624,153628,153632,153636,153640,153644,153648,153652,153656,153660,153664,153668,153672,153676,153680,153684,153688,153692,153696,153700,153704,153708,153712,153716,153720,153724,153728,153732,153736,153740,153744,153748,153752,153756,153760,153764,153768,153772,153776,153780,153784,153788,153792,153796,153800,153804,153808,153812,153816,153820,153824,153828,153832,153836,153840,153844,153848,153852,153856,153860,153864,153868,153872,153876,153880,153884,153888,153892,153896,153900,153904,153908,153912,153916,153920,153924,153928,153932,153936,153940,153944,153948,153952,153956,153960,153964,153968,153972,153976,153980,153984,153988,153992,153996,154000,154004,154008,154012,154016,154020,154024,154028,154032,154036,154040,154044,154048,154052,154056,154060,154064,154068,154072,154076,154080,154084,154088,154092,154096,154100,154104,154108,154112,154116,154120,154124,154128,154132,154136,154140,154144,154148,154152,154156,154160,154164,154168,154172,154176,154180,154184,154188,154192,154196,154200,154204,154208,154212,154216,154220,154224,154228,154232,154236,154240,154244,154248,154252,154256,154260,154264,154268,154272,154276,154280,154284,154288,154292,154296,154300,154304,154308,154312,154316,154320,154324,154328,154332,154336,154340,154344,154348,154352,154356,154360,154364,154368,154372,154376,154380,154384,154388,154392,154396,154400,154404,154408,154412,154416,154420,154424,154428,154432,154436,154440,154444,154448,154452,154456,154460,154464,154468,154472,154476,154480,154484,154488,154492,154496,154500,154504,154508,154512,154516,154520,154524,154528,154532,154536,154540,154544,154548,154552,154556,154560,154564,154568,154572,154576,154580,154584,154588,154592,154596,154600,154604,154608,154612,154616,154620,154624,154628,154632,154636,154640,154644,154648,154652,154656,154660,154664,154668,154672,154676,154680,154684,154688,154692,154696,154700,154704,154708,154712,154716,154720,154724,154728,154732,154736,154740,154744,154748,154752,154756,154760,154764,154768,154772,154776,154780,154784,154788,154792,154796,154800,154804,154808,154812,154816,154820,154824,154828,154832,154836,154840,154844,154848,154852,154856,155056,155268,155304,155356,155392,155524,155608,155744,155960,156032,156084,156172,156396,156616,156676,156716,156808,157052,157316,157560,157660,157804,158184,158352,158588,158808,158856,159040,159228,159284,159300,159404,159468,159624,159676,159680,159684,159688,159844,160068,160140,160264,160600,160708,160804,160848,160932,160976,161056,161112,161232,161308,161720,161884,162108,162200,162284,162444,162616,163264,163488,163564,163652,163684,163724,163800,163872,164060,164212,164392,164480,164560,164808,164928,165004,165112,165296,165412,165528,165912,166244,166376,166440,166524,166656,166784,166928,167168,167288,167356,167408,167664,167712,167772,167920,168024,168228,168352,168404,168484,168520,168552,168704,168768,168808,168888,168984,169080,169176,169284,169380,169456,169556,169624,169668,169716,169784,169924,170000,170076,170152,170552,171312,112,140,328,344,444,468,496,752,1088,1104,1132,1152,1192,1208,1232,1508,1528,1548,1564,3432,3560,3576,3604,3652,3776,3824,3876,3964,4040,4124,4184,4228,4340,4416,4436,4460,4680,5052,5088,5392,5668,5744,5772,6196,6664,6776,7172,7316,7476,7604,7676,7780,7840,7876,8108,8176,8192,8220,8244,8260,8284,8372,8844,8904,9836,9896,9956,10520,10580,10640,10960,11020,11080,11140,12556,12976,13096,13184,13240,13356,13552,13880,13976,14156,14364,14412,14460,14508,14564,14612,14652,14700,14804,14880,14928,15028,15096,15144,15176,15224,15344,15392,15424,15472,15512,15560,15628,16028,16160,16288,16420,16848,16904,17296,17488,17752,17952,18052,18260,18456,18552,18756,18932,19008,20368,20540,20828,20916,21144,21232,21548,21636,22032,22120,22596,23024,23120,29100,29232,29316,30176,30240,30304,30380,30440,30500,30556,30612,30668,31704,31924,32008,32212,32440,32456,32592,32804,33020,33036,33160,33528,33900,36980,40740,40768,40796,40824,40852,40880,40908,40936,40964,40992,41020,41048,41076,41104,41132,41160,41188,41216,41244,41272,41300,41328,41356,41384,41412,41440,41468,41496,41524,41552,41580,41608,41636,41664,41692,41720,41748,41776,41804,41832,41860,41888,41916,41944,41972,42000,42028,42056,42084,42112,42140,42168,42196,42224,42252,42280,42308,42336,42364,42392,42420,42448,42476,42504,42532,42560,42588,42616,42644,42672,42700,42728,42756,42784,42812,42840,42868,42896,42924,42952,42980,43008,43036,43064,43092,43120,43148,43176,43204,43232,43260,43288,43316,43344,43372,43400,43428,43456,43484,43512,43540,43568,43596,43624,43652,43680,43708,43736,43764,43792,43820,43848,43876,43904,43932,43960,43988,44016,44044,44072,44100,44128,44156,44184,44212,44240,44268,44296,44324,44352,44380,44408,44436,44464,44492,44520,44548,44576,44604,44632,44660,44688,44716,44744,44772,44800,44828,44856,44884,44912,44940,44968,44996,45024,45052,45080,45108,45136,45164,45192,45220,45508,46312,46352,46392,46432,46472,46512,46712,47024,47088,47108,47132,47148,47372,49888,49976,52504,52716,52732,52740,52756,52772,52828,52912,52940,53044,53208,53332,53528,53632,53860,53944,53952,53984,54068,54096,54200,54364,54488,54684,54788,54816,54828,54836,55212,55248,55284,55324,55404,55588,55644,55800,55848,55896,55940,55984,56048,56092,56156,56204,56252,56300,56368,56416,56504,56528,56564,56588,56624,56660,56696,56732,56768,56820,56856,56892,56972,57024,57048,57060,57128,57136,57404,57464,57508,57732,58728,58832,58932,59672,59768,59960,60136,60700,60912,61064,61364,61532,61724,61820,61880,61944,62076,62160,62232,62444,62548,62580,62752,62796,62924,62956,63124,64012,64160,66236,66356,67448,67464,67524,68304,68404,68464,72316,72852,73084,73328,73356,73544,73916,74176,74376,74404,74500,74548,74652,74972,76116,76500,76624,76680,78252,78324,78584,78628,78716,79172,79200,79388,79436,79480,79524,79568,79804,79832,79876,79952,80252,80304,80884,81396,81572,81612,81668,81692,81720,81760,81792,81836,81860,81896,81964,82020,82100,82120,82268,82336,82444,82476,82520,82572,82644,82704,83072,83768,83836,83912,83988,84064,84160,84208,84228,84284,84700,84724,86868,87652,88284,88692,88736,88804,88832,89108,89128,89148,89168,89192,89220,89240,89260,89280,89304,89332,89356,89384,89408,89436,89460,89488,89524,89544,89592,89700,89904,90016,90120,90144,90176,90204,90236,90272,90292,91832,91844,91876,91920,91972,91988,92016,92052,92140,92196,92224,92328,92400,92428,92516,92604,92632,92704,92776,92804,92816,92824,92832,94392,94568,94676,94816,94992,95092,95236,95344,95540,95564,95716,95768,95804,95820,95936,95984,96036,96072,96088,96148,96784,96872,96904,96988,97916,97940,98332,98384,98408,98420,98508,98852,99792,100440,101012,101068,101128,101184,101328,103472,103608,103848,103896,103916,104412,104464,105640,105752,105852,105872,105912,105960,105980,106060,107532,107544,107600,107640,107672,107696,107732,107812,107848,107888,107940,107964,108384,108768,109080,110268,110304,110464,110508,110536,110612,110640,110680,110756,111208,111780,111796,112052,112376,112460,112532,112560,112616,112820,113188,113344,113556,113624,113688,113812,114076,114168,114288,114332,114876,114892,115148,115572,115724,115796,115960,115984,116028,116056,116112,116136,116160,116192,116212,116232,116276,116308,117232,117340,117372,117404,117452,117644,117756,117832,117880,118020,118120,118136,118144,118152,118164,118312,118328,120520,120616,121748,121848,121880,121916,121948,121984,122008,122032,122056,122080,122104,122128,122152,122176,122200,122232,122256,122280,122304,122328,122352,122376,122400,122424,122596,122700,122816,123016,123816,123832,123900,124212,124368,124776,124824,124936,125052,125084,125284,125388,125456,125528,125760,125912,125964,126148,126224,126612,127212,127264,127284,127336,127980,128072,128260,128292,128336,128360,128400,128476,130640,130696,130736,130752,131300,131676,131736,131788,131860,131872,132104,132196,132432,132472,132548,132700,132824,132848,132860,132884,132916,133288,133424,133760,134456,134700,134736,134780,134788,135960,135980,136032,136052,136256,136312,136376,136684,136804,136832,136848,137464,137560,137780,138812,138872,139136,139480,139836,139940,139952,140000,140036,140068,140104,140132,140148,140164,140188,140304,140324,140344,140468,140488,140508,140592,140648,140908,141636,141676,141908,141968,142080,142092,142184,142700,142772,142864,142880,142908,142936,142964,142992,143020,143048,143076,143104,143132,143160,143188,143216,143244,143272,143300,143328,143356,143384,143412,143776,144516,144756,144808,144840,144864,145440,145704,145756,146124,146252,154960,155196,156048,156100,156236,156292,156880,157568,157588,157616,157672,157680,157740,157904,157968,158032,158072,158112,158128,158260,158384,158400,158424,158480,158508,158904,159084,159100,159128,159144,159168,159336,159520,160372,160388,160400,160448,160468,160480,160824,160876,161144,161200,161240,161252,161496,161524,161552,161580,161608,161632,161648,161892,161952,162168,162332,162492,162524,162776,162844,162892,163312,163332,163532,163700,163944,164268,164488,164504,164528,164548,164720,165356,165468,165584,165684,165692,165768,166308,166704,166840,166976,167036,167096,167232,167320,167456,168072,168156,169120,169324,169844,169876,170404,170460,170472,170560,170692,170720,170828,170908,170916,170948,171156,171192,171324,171408,171484,171520,171592,171652,171764,171968,172076,172092,172428,172448]);

  for (var i = 0; i < relocations.length; i++) {
    assert(relocations[i] % 4 === 0);
    assert(relocations[i] >= 0 && relocations[i] < eb + 172784); // in range
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
  
  
  var PATH={splitPath:function (filename) {
        var splitPathRe = /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/;
        return splitPathRe.exec(filename).slice(1);
      },normalizeArray:function (parts, allowAboveRoot) {
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
      },normalize:function (path) {
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
      },dirname:function (path) {
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
      },basename:function (path) {
        // EMSCRIPTEN return '/'' for '/', not an empty string
        if (path === '/') return '/';
        var lastSlash = path.lastIndexOf('/');
        if (lastSlash === -1) return path;
        return path.substr(lastSlash+1);
      },extname:function (path) {
        return PATH.splitPath(path)[3];
      },join:function () {
        var paths = Array.prototype.slice.call(arguments, 0);
        return PATH.normalize(paths.join('/'));
      },join2:function (l, r) {
        return PATH.normalize(l + '/' + r);
      }};
  
  
  var PATH_FS={resolve:function () {
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
      },relative:function (from, to) {
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
      },shutdown:function () {
        // https://github.com/emscripten-core/emscripten/pull/1555
        // if (ENVIRONMENT_IS_NODE) {
        //   // inolen: any idea as to why node -e 'process.stdin.read()' wouldn't exit immediately (with process.stdin being a tty)?
        //   // isaacs: because now it's reading from the stream, you've expressed interest in it, so that read() kicks off a _read() which creates a ReadReq operation
        //   // inolen: I thought read() in that case was a synchronous operation that just grabbed some amount of buffered data if it exists?
        //   // isaacs: it is. but it also triggers a _read() call, which calls readStart() on the handle
        //   // isaacs: do process.stdin.pause() and i'd think it'd probably close the pending call
        //   process['stdin']['pause']();
        // }
      },register:function (dev, ops) {
        TTY.ttys[dev] = { input: [], output: [], ops: ops };
        FS.registerDevice(dev, TTY.stream_ops);
      },stream_ops:{open:function (stream) {
          var tty = TTY.ttys[stream.node.rdev];
          if (!tty) {
            throw new FS.ErrnoError(43);
          }
          stream.tty = tty;
          stream.seekable = false;
        },close:function (stream) {
          // flush any pending line data
          stream.tty.ops.flush(stream.tty);
        },flush:function (stream) {
          stream.tty.ops.flush(stream.tty);
        },read:function (stream, buffer, offset, length, pos /* ignored */) {
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
        },write:function (stream, buffer, offset, length, pos) {
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
        }},default_tty_ops:{get_char:function (tty) {
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
        },put_char:function (tty, val) {
          if (val === null || val === 10) {
            out(UTF8ArrayToString(tty.output, 0));
            tty.output = [];
          } else {
            if (val != 0) tty.output.push(val); // val == 0 would cut text output off in the middle.
          }
        },flush:function (tty) {
          if (tty.output && tty.output.length > 0) {
            out(UTF8ArrayToString(tty.output, 0));
            tty.output = [];
          }
        }},default_tty1_ops:{put_char:function (tty, val) {
          if (val === null || val === 10) {
            err(UTF8ArrayToString(tty.output, 0));
            tty.output = [];
          } else {
            if (val != 0) tty.output.push(val);
          }
        },flush:function (tty) {
          if (tty.output && tty.output.length > 0) {
            err(UTF8ArrayToString(tty.output, 0));
            tty.output = [];
          }
        }}};
  
  var MEMFS={ops_table:null,mount:function (mount) {
        return MEMFS.createNode(null, '/', 16384 | 511 /* 0777 */, 0);
      },createNode:function (parent, name, mode, dev) {
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
      },getFileDataAsRegularArray:function (node) {
        if (node.contents && node.contents.subarray) {
          var arr = [];
          for (var i = 0; i < node.usedBytes; ++i) arr.push(node.contents[i]);
          return arr; // Returns a copy of the original data.
        }
        return node.contents; // No-op, the file contents are already in a JS array. Return as-is.
      },getFileDataAsTypedArray:function (node) {
        if (!node.contents) return new Uint8Array;
        if (node.contents.subarray) return node.contents.subarray(0, node.usedBytes); // Make sure to not return excess unused bytes.
        return new Uint8Array(node.contents);
      },expandFileStorage:function (node, newCapacity) {
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
      },resizeFileStorage:function (node, newSize) {
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
      },node_ops:{getattr:function (node) {
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
        },setattr:function (node, attr) {
          if (attr.mode !== undefined) {
            node.mode = attr.mode;
          }
          if (attr.timestamp !== undefined) {
            node.timestamp = attr.timestamp;
          }
          if (attr.size !== undefined) {
            MEMFS.resizeFileStorage(node, attr.size);
          }
        },lookup:function (parent, name) {
          throw FS.genericErrors[44];
        },mknod:function (parent, name, mode, dev) {
          return MEMFS.createNode(parent, name, mode, dev);
        },rename:function (old_node, new_dir, new_name) {
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
        },unlink:function (parent, name) {
          delete parent.contents[name];
        },rmdir:function (parent, name) {
          var node = FS.lookupNode(parent, name);
          for (var i in node.contents) {
            throw new FS.ErrnoError(55);
          }
          delete parent.contents[name];
        },readdir:function (node) {
          var entries = ['.', '..'];
          for (var key in node.contents) {
            if (!node.contents.hasOwnProperty(key)) {
              continue;
            }
            entries.push(key);
          }
          return entries;
        },symlink:function (parent, newname, oldpath) {
          var node = MEMFS.createNode(parent, newname, 511 /* 0777 */ | 40960, 0);
          node.link = oldpath;
          return node;
        },readlink:function (node) {
          if (!FS.isLink(node.mode)) {
            throw new FS.ErrnoError(28);
          }
          return node.link;
        }},stream_ops:{read:function (stream, buffer, offset, length, position) {
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
        },write:function (stream, buffer, offset, length, position, canOwn) {
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
        },llseek:function (stream, offset, whence) {
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
        },allocate:function (stream, offset, length) {
          MEMFS.expandFileStorage(stream.node, offset + length);
          stream.node.usedBytes = Math.max(stream.node.usedBytes, offset + length);
        },mmap:function (stream, buffer, offset, length, position, prot, flags) {
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
        },msync:function (stream, buffer, offset, length, mmapFlags) {
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
  
  var ERRNO_CODES={EPERM:63,ENOENT:44,ESRCH:71,EINTR:27,EIO:29,ENXIO:60,E2BIG:1,ENOEXEC:45,EBADF:8,ECHILD:12,EAGAIN:6,EWOULDBLOCK:6,ENOMEM:48,EACCES:2,EFAULT:21,ENOTBLK:105,EBUSY:10,EEXIST:20,EXDEV:75,ENODEV:43,ENOTDIR:54,EISDIR:31,EINVAL:28,ENFILE:41,EMFILE:33,ENOTTY:59,ETXTBSY:74,EFBIG:22,ENOSPC:51,ESPIPE:70,EROFS:69,EMLINK:34,EPIPE:64,EDOM:18,ERANGE:68,ENOMSG:49,EIDRM:24,ECHRNG:106,EL2NSYNC:156,EL3HLT:107,EL3RST:108,ELNRNG:109,EUNATCH:110,ENOCSI:111,EL2HLT:112,EDEADLK:16,ENOLCK:46,EBADE:113,EBADR:114,EXFULL:115,ENOANO:104,EBADRQC:103,EBADSLT:102,EDEADLOCK:16,EBFONT:101,ENOSTR:100,ENODATA:116,ETIME:117,ENOSR:118,ENONET:119,ENOPKG:120,EREMOTE:121,ENOLINK:47,EADV:122,ESRMNT:123,ECOMM:124,EPROTO:65,EMULTIHOP:36,EDOTDOT:125,EBADMSG:9,ENOTUNIQ:126,EBADFD:127,EREMCHG:128,ELIBACC:129,ELIBBAD:130,ELIBSCN:131,ELIBMAX:132,ELIBEXEC:133,ENOSYS:52,ENOTEMPTY:55,ENAMETOOLONG:37,ELOOP:32,EOPNOTSUPP:138,EPFNOSUPPORT:139,ECONNRESET:15,ENOBUFS:42,EAFNOSUPPORT:5,EPROTOTYPE:67,ENOTSOCK:57,ENOPROTOOPT:50,ESHUTDOWN:140,ECONNREFUSED:14,EADDRINUSE:3,ECONNABORTED:13,ENETUNREACH:40,ENETDOWN:38,ETIMEDOUT:73,EHOSTDOWN:142,EHOSTUNREACH:23,EINPROGRESS:26,EALREADY:7,EDESTADDRREQ:17,EMSGSIZE:35,EPROTONOSUPPORT:66,ESOCKTNOSUPPORT:137,EADDRNOTAVAIL:4,ENETRESET:39,EISCONN:30,ENOTCONN:53,ETOOMANYREFS:141,EUSERS:136,EDQUOT:19,ESTALE:72,ENOTSUP:138,ENOMEDIUM:148,EILSEQ:25,EOVERFLOW:61,ECANCELED:11,ENOTRECOVERABLE:56,EOWNERDEAD:62,ESTRPIPE:135};var FS={root:null,mounts:[],devices:{},streams:[],nextInode:1,nameTable:null,currentPath:"/",initialized:false,ignorePermissions:true,trackingDelegate:{},tracking:{openFlags:{READ:1,WRITE:2}},ErrnoError:null,genericErrors:{},filesystems:null,syncFSRequests:0,handleFSError:function (e) {
        if (!(e instanceof FS.ErrnoError)) throw e + ' : ' + stackTrace();
        return ___setErrNo(e.errno);
      },lookupPath:function (path, opts) {
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
      },getPath:function (node) {
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
      },hashName:function (parentid, name) {
        var hash = 0;
  
  
        for (var i = 0; i < name.length; i++) {
          hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
        }
        return ((parentid + hash) >>> 0) % FS.nameTable.length;
      },hashAddNode:function (node) {
        var hash = FS.hashName(node.parent.id, node.name);
        node.name_next = FS.nameTable[hash];
        FS.nameTable[hash] = node;
      },hashRemoveNode:function (node) {
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
      },lookupNode:function (parent, name) {
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
      },createNode:function (parent, name, mode, rdev) {
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
      },destroyNode:function (node) {
        FS.hashRemoveNode(node);
      },isRoot:function (node) {
        return node === node.parent;
      },isMountpoint:function (node) {
        return !!node.mounted;
      },isFile:function (mode) {
        return (mode & 61440) === 32768;
      },isDir:function (mode) {
        return (mode & 61440) === 16384;
      },isLink:function (mode) {
        return (mode & 61440) === 40960;
      },isChrdev:function (mode) {
        return (mode & 61440) === 8192;
      },isBlkdev:function (mode) {
        return (mode & 61440) === 24576;
      },isFIFO:function (mode) {
        return (mode & 61440) === 4096;
      },isSocket:function (mode) {
        return (mode & 49152) === 49152;
      },flagModes:{"r":0,"rs":1052672,"r+":2,"w":577,"wx":705,"xw":705,"w+":578,"wx+":706,"xw+":706,"a":1089,"ax":1217,"xa":1217,"a+":1090,"ax+":1218,"xa+":1218},modeStringToFlags:function (str) {
        var flags = FS.flagModes[str];
        if (typeof flags === 'undefined') {
          throw new Error('Unknown file open mode: ' + str);
        }
        return flags;
      },flagsToPermissionString:function (flag) {
        var perms = ['r', 'w', 'rw'][flag & 3];
        if ((flag & 512)) {
          perms += 'w';
        }
        return perms;
      },nodePermissions:function (node, perms) {
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
      },mayLookup:function (dir) {
        var err = FS.nodePermissions(dir, 'x');
        if (err) return err;
        if (!dir.node_ops.lookup) return 2;
        return 0;
      },mayCreate:function (dir, name) {
        try {
          var node = FS.lookupNode(dir, name);
          return 20;
        } catch (e) {
        }
        return FS.nodePermissions(dir, 'wx');
      },mayDelete:function (dir, name, isdir) {
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
      },mayOpen:function (node, flags) {
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
      },MAX_OPEN_FDS:4096,nextfd:function (fd_start, fd_end) {
        fd_start = fd_start || 0;
        fd_end = fd_end || FS.MAX_OPEN_FDS;
        for (var fd = fd_start; fd <= fd_end; fd++) {
          if (!FS.streams[fd]) {
            return fd;
          }
        }
        throw new FS.ErrnoError(33);
      },getStream:function (fd) {
        return FS.streams[fd];
      },createStream:function (stream, fd_start, fd_end) {
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
      },closeStream:function (fd) {
        FS.streams[fd] = null;
      },chrdev_stream_ops:{open:function (stream) {
          var device = FS.getDevice(stream.node.rdev);
          // override node's stream ops with the device's
          stream.stream_ops = device.stream_ops;
          // forward the open call
          if (stream.stream_ops.open) {
            stream.stream_ops.open(stream);
          }
        },llseek:function () {
          throw new FS.ErrnoError(70);
        }},major:function (dev) {
        return ((dev) >> 8);
      },minor:function (dev) {
        return ((dev) & 0xff);
      },makedev:function (ma, mi) {
        return ((ma) << 8 | (mi));
      },registerDevice:function (dev, ops) {
        FS.devices[dev] = { stream_ops: ops };
      },getDevice:function (dev) {
        return FS.devices[dev];
      },getMounts:function (mount) {
        var mounts = [];
        var check = [mount];
  
        while (check.length) {
          var m = check.pop();
  
          mounts.push(m);
  
          check.push.apply(check, m.mounts);
        }
  
        return mounts;
      },syncfs:function (populate, callback) {
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
      },mount:function (type, opts, mountpoint) {
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
      },lookup:function (parent, name) {
        return parent.node_ops.lookup(parent, name);
      },mknod:function (path, mode, dev) {
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
      },create:function (path, mode) {
        mode = mode !== undefined ? mode : 438 /* 0666 */;
        mode &= 4095;
        mode |= 32768;
        return FS.mknod(path, mode, 0);
      },mkdir:function (path, mode) {
        mode = mode !== undefined ? mode : 511 /* 0777 */;
        mode &= 511 | 512;
        mode |= 16384;
        return FS.mknod(path, mode, 0);
      },mkdirTree:function (path, mode) {
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
      },mkdev:function (path, mode, dev) {
        if (typeof(dev) === 'undefined') {
          dev = mode;
          mode = 438 /* 0666 */;
        }
        mode |= 8192;
        return FS.mknod(path, mode, dev);
      },symlink:function (oldpath, newpath) {
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
      },rename:function (old_path, new_path) {
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
      },rmdir:function (path) {
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
      },readdir:function (path) {
        var lookup = FS.lookupPath(path, { follow: true });
        var node = lookup.node;
        if (!node.node_ops.readdir) {
          throw new FS.ErrnoError(54);
        }
        return node.node_ops.readdir(node);
      },unlink:function (path) {
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
      },readlink:function (path) {
        var lookup = FS.lookupPath(path);
        var link = lookup.node;
        if (!link) {
          throw new FS.ErrnoError(44);
        }
        if (!link.node_ops.readlink) {
          throw new FS.ErrnoError(28);
        }
        return PATH_FS.resolve(FS.getPath(link.parent), link.node_ops.readlink(link));
      },stat:function (path, dontFollow) {
        var lookup = FS.lookupPath(path, { follow: !dontFollow });
        var node = lookup.node;
        if (!node) {
          throw new FS.ErrnoError(44);
        }
        if (!node.node_ops.getattr) {
          throw new FS.ErrnoError(63);
        }
        return node.node_ops.getattr(node);
      },lstat:function (path) {
        return FS.stat(path, true);
      },chmod:function (path, mode, dontFollow) {
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
      },lchmod:function (path, mode) {
        FS.chmod(path, mode, true);
      },fchmod:function (fd, mode) {
        var stream = FS.getStream(fd);
        if (!stream) {
          throw new FS.ErrnoError(8);
        }
        FS.chmod(stream.node, mode);
      },chown:function (path, uid, gid, dontFollow) {
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
      },lchown:function (path, uid, gid) {
        FS.chown(path, uid, gid, true);
      },fchown:function (fd, uid, gid) {
        var stream = FS.getStream(fd);
        if (!stream) {
          throw new FS.ErrnoError(8);
        }
        FS.chown(stream.node, uid, gid);
      },truncate:function (path, len) {
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
      },ftruncate:function (fd, len) {
        var stream = FS.getStream(fd);
        if (!stream) {
          throw new FS.ErrnoError(8);
        }
        if ((stream.flags & 2097155) === 0) {
          throw new FS.ErrnoError(28);
        }
        FS.truncate(stream.node, len);
      },utime:function (path, atime, mtime) {
        var lookup = FS.lookupPath(path, { follow: true });
        var node = lookup.node;
        node.node_ops.setattr(node, {
          timestamp: Math.max(atime, mtime)
        });
      },open:function (path, flags, mode, fd_start, fd_end) {
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
      },close:function (stream) {
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
      },isClosed:function (stream) {
        return stream.fd === null;
      },llseek:function (stream, offset, whence) {
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
      },read:function (stream, buffer, offset, length, position) {
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
      },write:function (stream, buffer, offset, length, position, canOwn) {
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
      },allocate:function (stream, offset, length) {
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
      },mmap:function (stream, buffer, offset, length, position, prot, flags) {
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
      },msync:function (stream, buffer, offset, length, mmapFlags) {
        if (!stream || !stream.stream_ops.msync) {
          return 0;
        }
        return stream.stream_ops.msync(stream, buffer, offset, length, mmapFlags);
      },munmap:function (stream) {
        return 0;
      },ioctl:function (stream, cmd, arg) {
        if (!stream.stream_ops.ioctl) {
          throw new FS.ErrnoError(59);
        }
        return stream.stream_ops.ioctl(stream, cmd, arg);
      },readFile:function (path, opts) {
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
      },writeFile:function (path, data, opts) {
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
      },cwd:function () {
        return FS.currentPath;
      },chdir:function (path) {
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
      },createDefaultDirectories:function () {
        FS.mkdir('/tmp');
        FS.mkdir('/home');
        FS.mkdir('/home/web_user');
      },createDefaultDevices:function () {
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
      },createSpecialDirectories:function () {
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
      },createStandardStreams:function () {
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
      },ensureErrnoError:function () {
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
      },staticInit:function () {
        FS.ensureErrnoError();
  
        FS.nameTable = new Array(4096);
  
        FS.mount(MEMFS, {}, '/');
  
        FS.createDefaultDirectories();
        FS.createDefaultDevices();
        FS.createSpecialDirectories();
  
        FS.filesystems = {
          'MEMFS': MEMFS,
        };
      },init:function (input, output, error) {
        assert(!FS.init.initialized, 'FS.init was previously called. If you want to initialize later with custom parameters, remove any earlier calls (note that one is automatically added to the generated code)');
        FS.init.initialized = true;
  
        FS.ensureErrnoError();
  
        // Allow Module.stdin etc. to provide defaults, if none explicitly passed to us here
        Module['stdin'] = input || Module['stdin'];
        Module['stdout'] = output || Module['stdout'];
        Module['stderr'] = error || Module['stderr'];
  
        FS.createStandardStreams();
      },quit:function () {
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
      },getMode:function (canRead, canWrite) {
        var mode = 0;
        if (canRead) mode |= 292 | 73;
        if (canWrite) mode |= 146;
        return mode;
      },joinPath:function (parts, forceRelative) {
        var path = PATH.join.apply(null, parts);
        if (forceRelative && path[0] == '/') path = path.substr(1);
        return path;
      },absolutePath:function (relative, base) {
        return PATH_FS.resolve(base, relative);
      },standardizePath:function (path) {
        return PATH.normalize(path);
      },findObject:function (path, dontResolveLastLink) {
        var ret = FS.analyzePath(path, dontResolveLastLink);
        if (ret.exists) {
          return ret.object;
        } else {
          ___setErrNo(ret.error);
          return null;
        }
      },analyzePath:function (path, dontResolveLastLink) {
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
      },createFolder:function (parent, name, canRead, canWrite) {
        var path = PATH.join2(typeof parent === 'string' ? parent : FS.getPath(parent), name);
        var mode = FS.getMode(canRead, canWrite);
        return FS.mkdir(path, mode);
      },createPath:function (parent, path, canRead, canWrite) {
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
      },createFile:function (parent, name, properties, canRead, canWrite) {
        var path = PATH.join2(typeof parent === 'string' ? parent : FS.getPath(parent), name);
        var mode = FS.getMode(canRead, canWrite);
        return FS.create(path, mode);
      },createDataFile:function (parent, name, data, canRead, canWrite, canOwn) {
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
      },createDevice:function (parent, name, input, output) {
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
      },createLink:function (parent, name, target, canRead, canWrite) {
        var path = PATH.join2(typeof parent === 'string' ? parent : FS.getPath(parent), name);
        return FS.symlink(target, path);
      },forceLoadFile:function (obj) {
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
      },createLazyFile:function (parent, name, url, canRead, canWrite) {
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
      },createPreloadedFile:function (parent, name, url, canRead, canWrite, onload, onerror, dontCreateFile, canOwn, preFinish) {
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
      },indexedDB:function () {
        return window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;
      },DB_NAME:function () {
        return 'EM_FS_' + window.location.pathname;
      },DB_VERSION:20,DB_STORE_NAME:"FILE_DATA",saveFilesToDB:function (paths, onload, onerror) {
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
      },loadFilesFromDB:function (paths, onload, onerror) {
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
      }};var SYSCALLS={DEFAULT_POLLMASK:5,mappings:{},umask:511,calculateAt:function (dirfd, path) {
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
      },doStat:function (func, path, buf) {
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
      },doMsync:function (addr, stream, len, flags) {
        var buffer = new Uint8Array(HEAPU8.subarray(addr, addr + len));
        FS.msync(stream, buffer, 0, len, flags);
      },doMkdir:function (path, mode) {
        // remove a trailing slash, if one - /a/b/ has basename of '', but
        // we want to create b in the context of this function
        path = PATH.normalize(path);
        if (path[path.length-1] === '/') path = path.substr(0, path.length-1);
        FS.mkdir(path, mode, 0);
        return 0;
      },doMknod:function (path, mode, dev) {
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
      },doReadlink:function (path, buf, bufsize) {
        if (bufsize <= 0) return -28;
        var ret = FS.readlink(path);
  
        var len = Math.min(bufsize, lengthBytesUTF8(ret));
        var endChar = HEAP8[buf+len];
        stringToUTF8(ret, buf, bufsize+1);
        // readlink is one of the rare functions that write out a C string, but does never append a null to the output buffer(!)
        // stringToUTF8() always appends a null byte, so restore the character under the null byte after the write.
        HEAP8[buf+len] = endChar;
  
        return len;
      },doAccess:function (path, amode) {
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
      },doDup:function (path, flags, suggestFD) {
        var suggest = FS.getStream(suggestFD);
        if (suggest) FS.close(suggest);
        return FS.open(path, flags, 0, suggestFD, suggestFD).fd;
      },doReadv:function (stream, iov, iovcnt, offset) {
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
      },doWritev:function (stream, iov, iovcnt, offset) {
        var ret = 0;
        for (var i = 0; i < iovcnt; i++) {
          var ptr = HEAP32[(((iov)+(i*8))>>2)];
          var len = HEAP32[(((iov)+(i*8 + 4))>>2)];
          var curr = FS.write(stream, HEAP8,ptr, len, offset);
          if (curr < 0) return -1;
          ret += curr;
        }
        return ret;
      },varargs:0,get:function (varargs) {
        SYSCALLS.varargs += 4;
        var ret = HEAP32[(((SYSCALLS.varargs)-(4))>>2)];
        return ret;
      },getStr:function () {
        var ret = UTF8ToString(SYSCALLS.get());
        return ret;
      },getStreamFromFD:function (fd) {
        // TODO: when all syscalls use wasi, can remove the next line
        if (fd === undefined) fd = SYSCALLS.get();
        var stream = FS.getStream(fd);
        if (!stream) throw new FS.ErrnoError(8);
        return stream;
      },get64:function () {
        var low = SYSCALLS.get(), high = SYSCALLS.get();
        if (low >= 0) assert(high === 0);
        else assert(high === -1);
        return low;
      },getZero:function () {
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
  }function ___wasi_fd_close() {
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
  }function ___wasi_fd_read() {
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
  }function ___wasi_fd_seek() {
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
  }function ___wasi_fd_write() {
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
        throw 'SimulateInfiniteLoop';
      }
    }var Browser={mainLoop:{scheduler:null,method:"",currentlyRunningMainloop:0,func:null,arg:0,timingMode:0,timingValue:0,currentFrameNumber:0,queue:[],pause:function () {
          Browser.mainLoop.scheduler = null;
          Browser.mainLoop.currentlyRunningMainloop++; // Incrementing this signals the previous main loop that it's now become old, and it must return.
        },resume:function () {
          Browser.mainLoop.currentlyRunningMainloop++;
          var timingMode = Browser.mainLoop.timingMode;
          var timingValue = Browser.mainLoop.timingValue;
          var func = Browser.mainLoop.func;
          Browser.mainLoop.func = null;
          _emscripten_set_main_loop(func, 0, false, Browser.mainLoop.arg, true /* do not set timing and call scheduler, we will do it on the next lines */);
          _emscripten_set_main_loop_timing(timingMode, timingValue);
          Browser.mainLoop.scheduler();
        },updateStatus:function () {
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
        },runIter:function (func) {
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
        }},isFullscreen:false,pointerLock:false,moduleContextCreatedCallbacks:[],workers:[],init:function () {
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
      },createContext:function (canvas, useWebGL, setInModule, webGLContextAttributes) {
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
      },destroyContext:function (canvas, useWebGL, setInModule) {},fullscreenHandlersInstalled:false,lockPointer:undefined,resizeCanvas:undefined,requestFullscreen:function (lockPointer, resizeCanvas, vrDevice) {
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
      },requestFullScreen:function () {
        abort('Module.requestFullScreen has been replaced by Module.requestFullscreen (without a capital S)');
      },exitFullscreen:function () {
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
      },nextRAF:0,fakeRequestAnimationFrame:function (func) {
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
      },requestAnimationFrame:function (func) {
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(func);
          return;
        }
        var RAF = Browser.fakeRequestAnimationFrame;
        RAF(func);
      },safeCallback:function (func) {
        return function() {
          if (!ABORT) return func.apply(null, arguments);
        };
      },allowAsyncCallbacks:true,queuedAsyncCallbacks:[],pauseAsyncCallbacks:function () {
        Browser.allowAsyncCallbacks = false;
      },resumeAsyncCallbacks:function () { // marks future callbacks as ok to execute, and synchronously runs any remaining ones right now
        Browser.allowAsyncCallbacks = true;
        if (Browser.queuedAsyncCallbacks.length > 0) {
          var callbacks = Browser.queuedAsyncCallbacks;
          Browser.queuedAsyncCallbacks = [];
          callbacks.forEach(function(func) {
            func();
          });
        }
      },safeRequestAnimationFrame:function (func) {
        return Browser.requestAnimationFrame(function() {
          if (ABORT) return;
          if (Browser.allowAsyncCallbacks) {
            func();
          } else {
            Browser.queuedAsyncCallbacks.push(func);
          }
        });
      },safeSetTimeout:function (func, timeout) {
        noExitRuntime = true;
        return setTimeout(function() {
          if (ABORT) return;
          if (Browser.allowAsyncCallbacks) {
            func();
          } else {
            Browser.queuedAsyncCallbacks.push(func);
          }
        }, timeout);
      },safeSetInterval:function (func, timeout) {
        noExitRuntime = true;
        return setInterval(function() {
          if (ABORT) return;
          if (Browser.allowAsyncCallbacks) {
            func();
          } // drop it on the floor otherwise, next interval will kick in
        }, timeout);
      },getMimetype:function (name) {
        return {
          'jpg': 'image/jpeg',
          'jpeg': 'image/jpeg',
          'png': 'image/png',
          'bmp': 'image/bmp',
          'ogg': 'audio/ogg',
          'wav': 'audio/wav',
          'mp3': 'audio/mpeg'
        }[name.substr(name.lastIndexOf('.')+1)];
      },getUserMedia:function (func) {
        if(!window.getUserMedia) {
          window.getUserMedia = navigator['getUserMedia'] ||
                                navigator['mozGetUserMedia'];
        }
        window.getUserMedia(func);
      },getMovementX:function (event) {
        return event['movementX'] ||
               event['mozMovementX'] ||
               event['webkitMovementX'] ||
               0;
      },getMovementY:function (event) {
        return event['movementY'] ||
               event['mozMovementY'] ||
               event['webkitMovementY'] ||
               0;
      },getMouseWheelDelta:function (event) {
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
      },mouseX:0,mouseY:0,mouseMovementX:0,mouseMovementY:0,touches:{},lastTouches:{},calculateMouseEvent:function (event) { // event should be mousemove, mousedown or mouseup
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
      },asyncLoad:function (url, onload, onerror, noRunDep) {
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
      },resizeListeners:[],updateResizeListeners:function () {
        var canvas = Module['canvas'];
        Browser.resizeListeners.forEach(function(listener) {
          listener(canvas.width, canvas.height);
        });
      },setCanvasSize:function (width, height, noUpdates) {
        var canvas = Module['canvas'];
        Browser.updateCanvasDimensions(canvas, width, height);
        if (!noUpdates) Browser.updateResizeListeners();
      },windowedWidth:0,windowedHeight:0,setFullscreenCanvasSize:function () {
        // check if SDL is available
        if (typeof SDL != "undefined") {
          var flags = HEAPU32[((SDL.screen)>>2)];
          flags = flags | 0x00800000; // set SDL_FULLSCREEN flag
          HEAP32[((SDL.screen)>>2)]=flags
        }
        Browser.updateCanvasDimensions(Module['canvas']);
        Browser.updateResizeListeners();
      },setWindowedCanvasSize:function () {
        // check if SDL is available
        if (typeof SDL != "undefined") {
          var flags = HEAPU32[((SDL.screen)>>2)];
          flags = flags & ~0x00800000; // clear SDL_FULLSCREEN flag
          HEAP32[((SDL.screen)>>2)]=flags
        }
        Browser.updateCanvasDimensions(Module['canvas']);
        Browser.updateResizeListeners();
      },updateCanvasDimensions:function (canvas, wNative, hNative) {
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
      },wgetRequests:{},nextWgetRequestHandle:0,getNextWgetRequestHandle:function () {
        var handle = Browser.nextWgetRequestHandle;
        Browser.nextWgetRequestHandle++;
        return handle;
      }};var EGL={errorCode:12288,defaultDisplayInitialized:false,currentContext:0,currentReadSurface:0,currentDrawSurface:0,contextAttributes:{alpha:false,depth:false,stencil:false,antialias:false},stringCache:{},setErrorCode:function (code) {
        EGL.errorCode = code;
      },chooseConfig:function (display, attribList, config, config_size, numConfigs) {
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

  
  var JSEvents={keyEvent:0,mouseEvent:0,wheelEvent:0,uiEvent:0,focusEvent:0,deviceOrientationEvent:0,deviceMotionEvent:0,fullscreenChangeEvent:0,pointerlockChangeEvent:0,visibilityChangeEvent:0,touchEvent:0,previousFullscreenElement:null,previousScreenX:null,previousScreenY:null,removeEventListenersRegistered:false,removeAllEventListeners:function () {
        for(var i = JSEvents.eventHandlers.length-1; i >= 0; --i) {
          JSEvents._removeHandler(i);
        }
        JSEvents.eventHandlers = [];
        JSEvents.deferredCalls = [];
      },registerRemoveEventListeners:function () {
        if (!JSEvents.removeEventListenersRegistered) {
          __ATEXIT__.push(JSEvents.removeAllEventListeners);
          JSEvents.removeEventListenersRegistered = true;
        }
      },deferredCalls:[],deferCall:function (targetFunction, precedence, argsList) {
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
      },removeDeferredCalls:function (targetFunction) {
        for(var i = 0; i < JSEvents.deferredCalls.length; ++i) {
          if (JSEvents.deferredCalls[i].targetFunction == targetFunction) {
            JSEvents.deferredCalls.splice(i, 1);
            --i;
          }
        }
      },canPerformEventHandlerRequests:function () {
        return JSEvents.inEventHandler && JSEvents.currentEventHandler.allowsDeferredCalls;
      },runDeferredCalls:function () {
        if (!JSEvents.canPerformEventHandlerRequests()) {
          return;
        }
        for(var i = 0; i < JSEvents.deferredCalls.length; ++i) {
          var call = JSEvents.deferredCalls[i];
          JSEvents.deferredCalls.splice(i, 1);
          --i;
          call.targetFunction.apply(this, call.argsList);
        }
      },inEventHandler:0,currentEventHandler:null,eventHandlers:[],isInternetExplorer:function () { return navigator.userAgent.indexOf('MSIE') !== -1 || navigator.appVersion.indexOf('Trident/') > 0; },removeAllHandlersOnTarget:function (target, eventTypeString) {
        for(var i = 0; i < JSEvents.eventHandlers.length; ++i) {
          if (JSEvents.eventHandlers[i].target == target && 
            (!eventTypeString || eventTypeString == JSEvents.eventHandlers[i].eventTypeString)) {
             JSEvents._removeHandler(i--);
           }
        }
      },_removeHandler:function (i) {
        var h = JSEvents.eventHandlers[i];
        h.target.removeEventListener(h.eventTypeString, h.eventListenerFunc, h.useCapture);
        JSEvents.eventHandlers.splice(i, 1);
      },registerOrRemoveHandler:function (eventHandler) {
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
      },getBoundingClientRectOrZeros:function (target) {
        return target.getBoundingClientRect ? target.getBoundingClientRect() : { left: 0, top: 0 };
      },getNodeNameForTarget:function (target) {
        if (!target) return '';
        if (target == window) return '#window';
        if (target == screen) return '#screen';
        return (target && target.nodeName) ? target.nodeName : '';
      },tick:function () {
        if (window['performance'] && window['performance']['now']) return window['performance']['now']();
        else return Date.now();
      },fullscreenEnabled:function () {
        return document.fullscreenEnabled || document.mozFullScreenEnabled || document.webkitFullscreenEnabled || document.msFullscreenEnabled;
      }};
  
  function __requestPointerLock(target) {
      if (target.requestPointerLock) {
        target.requestPointerLock();
      } else if (target.mozRequestPointerLock) {
        target.mozRequestPointerLock();
      } else if (target.webkitRequestPointerLock) {
        target.webkitRequestPointerLock();
      } else if (target.msRequestPointerLock) {
        target.msRequestPointerLock();
      } else {
        // document.body is known to accept pointer lock, so use that to differentiate if the user passed a bad element,
        // or if the whole browser just doesn't support the feature.
        if (document.body.requestPointerLock || document.body.mozRequestPointerLock || document.body.webkitRequestPointerLock || document.body.msRequestPointerLock) {
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
      } else if (document.mozExitPointerLock) {
        document.mozExitPointerLock();
      } else if (document.webkitExitPointerLock) {
        document.webkitExitPointerLock();
      } else {
        return -1;
      }
      return 0;
    }

  
  
  var __specialEventTargets=[0, typeof document !== 'undefined' ? document : 0, typeof window !== 'undefined' ? window : 0];function __findEventTarget(target) {
      warnOnce('Rules for selecting event targets in HTML5 API are changing: instead of using document.getElementById() that only can refer to elements by their DOM ID, new event target selection mechanism uses the more flexible function document.querySelector() that can look up element names, classes, and complex CSS selectors. Build with -s DISABLE_DEPRECATED_FIND_EVENT_TARGET_BEHAVIOR=1 to change to the new lookup rules. See https://github.com/emscripten-core/emscripten/pull/7977 for more details.');
      try {
        // The sensible "default" target varies between events, but use window as the default
        // since DOM events mostly can default to that. Specific callback registrations
        // override their own defaults.
        if (!target) return window;
        if (typeof target === "number") target = __specialEventTargets[target] || UTF8ToString(target);
        if (target === '#window') return window;
        else if (target === '#document') return document;
        else if (target === '#screen') return screen;
        else if (target === '#canvas') return Module['canvas'];
        return (typeof target === 'string') ? document.getElementById(target) : target;
      } catch(e) {
        // In Web Workers, some objects above, such as '#document' do not exist. Gracefully
        // return null for them.
        return null;
      }
    }function _emscripten_get_element_css_size(target, width, height) {
      target = target ? __findEventTarget(target) : Module['canvas'];
      if (!target) return -4;
  
      if (target.getBoundingClientRect) {
        var rect = target.getBoundingClientRect();
        HEAPF64[((width)>>3)]=rect.right - rect.left;
        HEAPF64[((height)>>3)]=rect.bottom - rect.top;
      } else {
        HEAPF64[((width)>>3)]=target.clientWidth;
        HEAPF64[((height)>>3)]=target.clientHeight;
      }
  
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

   

  
  var GL={counter:1,lastError:0,buffers:[],mappedBuffers:{},programs:[],framebuffers:[],renderbuffers:[],textures:[],uniforms:[],shaders:[],vaos:[],contexts:{},currentContext:null,offscreenCanvases:{},timerQueriesEXT:[],programInfos:{},stringCache:{},unpackAlignment:4,init:function () {
        GL.miniTempBuffer = new Float32Array(GL.MINI_TEMP_BUFFER_SIZE);
        for (var i = 0; i < GL.MINI_TEMP_BUFFER_SIZE; i++) {
          GL.miniTempBufferViews[i] = GL.miniTempBuffer.subarray(0, i+1);
        }
      },recordError:function recordError(errorCode) {
        if (!GL.lastError) {
          GL.lastError = errorCode;
        }
      },getNewId:function (table) {
        var ret = GL.counter++;
        for (var i = table.length; i < ret; i++) {
          table[i] = null;
        }
        return ret;
      },MINI_TEMP_BUFFER_SIZE:256,miniTempBuffer:null,miniTempBufferViews:[0],getSource:function (shader, count, string, length) {
        var source = '';
        for (var i = 0; i < count; ++i) {
          var len = length ? HEAP32[(((length)+(i*4))>>2)] : -1;
          source += UTF8ToString(HEAP32[(((string)+(i*4))>>2)], len < 0 ? undefined : len);
        }
        return source;
      },createContext:function (canvas, webGLContextAttributes) {
  
  
  
  
        var ctx = 
          (canvas.getContext("webgl", webGLContextAttributes) || canvas.getContext("experimental-webgl", webGLContextAttributes));
  
  
        if (!ctx) return 0;
  
        var handle = GL.registerContext(ctx, webGLContextAttributes);
  
  
  
        return handle;
      },registerContext:function (ctx, webGLContextAttributes) {
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
      },makeContextCurrent:function (contextHandle) {
  
        GL.currentContext = GL.contexts[contextHandle]; // Active Emscripten GL layer context object.
        Module.ctx = GLctx = GL.currentContext && GL.currentContext.GLctx; // Active WebGL context object.
        return !(contextHandle && !GLctx);
      },getContext:function (contextHandle) {
        return GL.contexts[contextHandle];
      },deleteContext:function (contextHandle) {
        if (GL.currentContext === GL.contexts[contextHandle]) GL.currentContext = null;
        if (typeof JSEvents === 'object') JSEvents.removeAllHandlersOnTarget(GL.contexts[contextHandle].GLctx.canvas); // Release all JS event handlers on the DOM element that the GL context is associated with since the context is now deleted.
        if (GL.contexts[contextHandle] && GL.contexts[contextHandle].GLctx.canvas) GL.contexts[contextHandle].GLctx.canvas.GLctxObject = undefined; // Make sure the canvas object no longer refers to the context object so there are no GC surprises.
        _free(GL.contexts[contextHandle]);
        GL.contexts[contextHandle] = null;
      },acquireInstancedArraysExtension:function (ctx) {
        // Extension available in WebGL 1 from Firefox 26 and Google Chrome 30 onwards. Core feature in WebGL 2.
        var ext = ctx.getExtension('ANGLE_instanced_arrays');
        if (ext) {
          ctx['vertexAttribDivisor'] = function(index, divisor) { ext['vertexAttribDivisorANGLE'](index, divisor); };
          ctx['drawArraysInstanced'] = function(mode, first, count, primcount) { ext['drawArraysInstancedANGLE'](mode, first, count, primcount); };
          ctx['drawElementsInstanced'] = function(mode, count, type, indices, primcount) { ext['drawElementsInstancedANGLE'](mode, count, type, indices, primcount); };
        }
      },acquireVertexArrayObjectExtension:function (ctx) {
        // Extension available in WebGL 1 from Firefox 25 and WebKit 536.28/desktop Safari 6.0.3 onwards. Core feature in WebGL 2.
        var ext = ctx.getExtension('OES_vertex_array_object');
        if (ext) {
          ctx['createVertexArray'] = function() { return ext['createVertexArrayOES'](); };
          ctx['deleteVertexArray'] = function(vao) { ext['deleteVertexArrayOES'](vao); };
          ctx['bindVertexArray'] = function(vao) { ext['bindVertexArrayOES'](vao); };
          ctx['isVertexArray'] = function(vao) { return ext['isVertexArrayOES'](vao); };
        }
      },acquireDrawBuffersExtension:function (ctx) {
        // Extension available in WebGL 1 from Firefox 28 onwards. Core feature in WebGL 2.
        var ext = ctx.getExtension('WEBGL_draw_buffers');
        if (ext) {
          ctx['drawBuffers'] = function(n, bufs) { ext['drawBuffersWEBGL'](n, bufs); };
        }
      },initExtensions:function (context) {
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
      },populateUniformTable:function (program) {
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
        var view = GL.miniTempBufferViews[count-1];
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
  
  
      GLctx.uniform1iv(GL.uniforms[location], HEAP32.subarray((value)>>2,(value+count*4)>>2));
    }

  function _emscripten_glUniform2f(location, v0, v1) {
      GLctx.uniform2f(GL.uniforms[location], v0, v1);
    }

  function _emscripten_glUniform2fv(location, count, value) {
  
  
      if (2*count <= GL.MINI_TEMP_BUFFER_SIZE) {
        // avoid allocation when uploading few enough uniforms
        var view = GL.miniTempBufferViews[2*count-1];
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
  
  
      GLctx.uniform2iv(GL.uniforms[location], HEAP32.subarray((value)>>2,(value+count*8)>>2));
    }

  function _emscripten_glUniform3f(location, v0, v1, v2) {
      GLctx.uniform3f(GL.uniforms[location], v0, v1, v2);
    }

  function _emscripten_glUniform3fv(location, count, value) {
  
  
      if (3*count <= GL.MINI_TEMP_BUFFER_SIZE) {
        // avoid allocation when uploading few enough uniforms
        var view = GL.miniTempBufferViews[3*count-1];
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
  
  
      GLctx.uniform3iv(GL.uniforms[location], HEAP32.subarray((value)>>2,(value+count*12)>>2));
    }

  function _emscripten_glUniform4f(location, v0, v1, v2, v3) {
      GLctx.uniform4f(GL.uniforms[location], v0, v1, v2, v3);
    }

  function _emscripten_glUniform4fv(location, count, value) {
  
  
      if (4*count <= GL.MINI_TEMP_BUFFER_SIZE) {
        // avoid allocation when uploading few enough uniforms
        var view = GL.miniTempBufferViews[4*count-1];
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
  
  
      GLctx.uniform4iv(GL.uniforms[location], HEAP32.subarray((value)>>2,(value+count*16)>>2));
    }

  function _emscripten_glUniformMatrix2fv(location, count, transpose, value) {
  
  
      if (4*count <= GL.MINI_TEMP_BUFFER_SIZE) {
        // avoid allocation when uploading few enough uniforms
        var view = GL.miniTempBufferViews[4*count-1];
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
        var view = GL.miniTempBufferViews[9*count-1];
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
        var view = GL.miniTempBufferViews[16*count-1];
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
      if (!target) target = '#canvas';
      target = __findEventTarget(target);
      if (!target) return -4;
      if (!target.requestPointerLock && !target.mozRequestPointerLock && !target.webkitRequestPointerLock && !target.msRequestPointerLock) {
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
      HEAPF64[((eventStruct)>>3)]=JSEvents.tick();
      HEAP32[(((eventStruct)+(8))>>2)]=e.screenX;
      HEAP32[(((eventStruct)+(12))>>2)]=e.screenY;
      HEAP32[(((eventStruct)+(16))>>2)]=e.clientX;
      HEAP32[(((eventStruct)+(20))>>2)]=e.clientY;
      HEAP32[(((eventStruct)+(24))>>2)]=e.ctrlKey;
      HEAP32[(((eventStruct)+(28))>>2)]=e.shiftKey;
      HEAP32[(((eventStruct)+(32))>>2)]=e.altKey;
      HEAP32[(((eventStruct)+(36))>>2)]=e.metaKey;
      HEAP16[(((eventStruct)+(40))>>1)]=e.button;
      HEAP16[(((eventStruct)+(42))>>1)]=e.buttons;
      HEAP32[(((eventStruct)+(44))>>2)]=e["movementX"] || e["mozMovementX"] || e["webkitMovementX"] || (e.screenX-JSEvents.previousScreenX);
      HEAP32[(((eventStruct)+(48))>>2)]=e["movementY"] || e["mozMovementY"] || e["webkitMovementY"] || (e.screenY-JSEvents.previousScreenY);
  
      if (Module['canvas']) {
        var rect = Module['canvas'].getBoundingClientRect();
        HEAP32[(((eventStruct)+(60))>>2)]=e.clientX - rect.left;
        HEAP32[(((eventStruct)+(64))>>2)]=e.clientY - rect.top;
      } else { // Canvas is not initialized, return 0.
        HEAP32[(((eventStruct)+(60))>>2)]=0;
        HEAP32[(((eventStruct)+(64))>>2)]=0;
      }
      if (target) {
        var rect = JSEvents.getBoundingClientRectOrZeros(target);
        HEAP32[(((eventStruct)+(52))>>2)]=e.clientX - rect.left;
        HEAP32[(((eventStruct)+(56))>>2)]=e.clientY - rect.top;
      } else { // No specific target passed, return 0.
        HEAP32[(((eventStruct)+(52))>>2)]=0;
        HEAP32[(((eventStruct)+(56))>>2)]=0;
      }
      // wheel and mousewheel events contain wrong screenX/screenY on chrome/opera
        // https://github.com/emscripten-core/emscripten/pull/4997
      // https://bugs.chromium.org/p/chromium/issues/detail?id=699956
      if (e.type !== 'wheel' && e.type !== 'mousewheel') {
        JSEvents.previousScreenX = e.screenX;
        JSEvents.previousScreenY = e.screenY;
      }
    }function __registerMouseEventCallback(target, userData, useCapture, callbackfunc, eventTypeId, eventTypeString, targetThread) {
      if (!JSEvents.mouseEvent) JSEvents.mouseEvent = _malloc( 72 );
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
      // In IE, mousedown events don't either allow deferred calls to be run!
      if (JSEvents.isInternetExplorer() && eventTypeString == 'mousedown') eventHandler.allowsDeferredCalls = false;
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
      target = target ? __findEventTarget(target) : __specialEventTargets[1];
      if (!target) return -4;
      __registerFullscreenChangeEventCallback(target, userData, useCapture, callbackfunc, 19, "fullscreenchange", targetThread);
      __registerFullscreenChangeEventCallback(target, userData, useCapture, callbackfunc, 19, "mozfullscreenchange", targetThread);
      __registerFullscreenChangeEventCallback(target, userData, useCapture, callbackfunc, 19, "webkitfullscreenchange", targetThread);
      __registerFullscreenChangeEventCallback(target, userData, useCapture, callbackfunc, 19, "msfullscreenchange", targetThread);
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
        allowsDeferredCalls: JSEvents.isInternetExplorer() ? false : true, // MSIE doesn't allow fullscreen and pointerlock requests from key handlers, others do.
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
        var canvasRect = Module['canvas'] ? Module['canvas'].getBoundingClientRect() : undefined;
        var targetRect = JSEvents.getBoundingClientRectOrZeros(target);
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
          if (canvasRect) {
            HEAP32[(((ptr)+(44))>>2)]=t.clientX - canvasRect.left;
            HEAP32[(((ptr)+(48))>>2)]=t.clientY - canvasRect.top;
          } else {
            HEAP32[(((ptr)+(44))>>2)]=0;
            HEAP32[(((ptr)+(48))>>2)]=0;            
          }
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
        var view = GL.miniTempBufferViews[16*count-1];
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

  
  var GLFW={Window:function (id, width, height, title, monitor, share) {
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
      },WindowFromId:function (id) {
        if (id <= 0 || !GLFW.windows) return null;
        return GLFW.windows[id - 1];
      },joystickFunc:null,errorFunc:null,monitorFunc:null,active:null,windows:null,monitors:null,monitorString:null,versionString:null,initialTime:null,extensions:null,hints:null,defaultHints:{131073:0,131074:0,131075:1,131076:1,131077:1,135169:8,135170:8,135171:8,135172:8,135173:24,135174:8,135175:0,135176:0,135177:0,135178:0,135179:0,135180:0,135181:0,135182:0,135183:0,139265:196609,139266:1,139267:0,139268:0,139269:0,139270:0,139271:0,139272:0},DOMToGLFWKeyCode:function (keycode) {
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
      },getModBits:function (win) {
        var mod = 0;
        if (win.keys[340]) mod |= 0x0001; // GLFW_MOD_SHIFT
        if (win.keys[341]) mod |= 0x0002; // GLFW_MOD_CONTROL
        if (win.keys[342]) mod |= 0x0004; // GLFW_MOD_ALT
        if (win.keys[343]) mod |= 0x0008; // GLFW_MOD_SUPER
        return mod;
      },onKeyPress:function (event) {
        if (!GLFW.active || !GLFW.active.charFunc) return;
        if (event.ctrlKey || event.metaKey) return;
  
        // correct unicode charCode is only available with onKeyPress event
        var charCode = event.charCode;
        if (charCode == 0 || (charCode >= 0x00 && charCode <= 0x1F)) return;
  
  
        dynCall_vii(GLFW.active.charFunc, GLFW.active.id, charCode);
      },onKeyChanged:function (keyCode, status) {
        if (!GLFW.active) return;
  
        var key = GLFW.DOMToGLFWKeyCode(keyCode);
        if (key == -1) return;
  
        var repeat = status && GLFW.active.keys[key];
        GLFW.active.keys[key] = status;
        GLFW.active.domKeys[keyCode] = status;
        if (!GLFW.active.keyFunc) return;
  
  
        if (repeat) status = 2; // GLFW_REPEAT
        dynCall_viiiii(GLFW.active.keyFunc, GLFW.active.id, key, keyCode, status, GLFW.getModBits(GLFW.active));
      },onGamepadConnected:function (event) {
        GLFW.refreshJoysticks();
      },onGamepadDisconnected:function (event) {
        GLFW.refreshJoysticks();
      },onKeydown:function (event) {
        GLFW.onKeyChanged(event.keyCode, 1); // GLFW_PRESS or GLFW_REPEAT
  
        // This logic comes directly from the sdl implementation. We cannot
        // call preventDefault on all keydown events otherwise onKeyPress will
        // not get called
        if (event.keyCode === 8 /* backspace */ || event.keyCode === 9 /* tab */) {
          event.preventDefault();
        }
      },onKeyup:function (event) {
        GLFW.onKeyChanged(event.keyCode, 0); // GLFW_RELEASE
      },onBlur:function (event) {
        if (!GLFW.active) return;
  
        for (var i = 0; i < GLFW.active.domKeys.length; ++i) {
          if (GLFW.active.domKeys[i]) {
            GLFW.onKeyChanged(i, 0); // GLFW_RELEASE
          }
        }
      },onMousemove:function (event) {
        if (!GLFW.active) return;
  
        Browser.calculateMouseEvent(event);
  
        if (event.target != Module["canvas"] || !GLFW.active.cursorPosFunc) return;
  
  
        dynCall_vidd(GLFW.active.cursorPosFunc, GLFW.active.id, Browser.mouseX, Browser.mouseY);
      },DOMToGLFWMouseButton:function (event) {
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
      },onMouseenter:function (event) {
        if (!GLFW.active) return;
  
        if (event.target != Module["canvas"] || !GLFW.active.cursorEnterFunc) return;
  
        dynCall_vii(GLFW.active.cursorEnterFunc, GLFW.active.id, 1);
      },onMouseleave:function (event) {
        if (!GLFW.active) return;
  
        if (event.target != Module["canvas"] || !GLFW.active.cursorEnterFunc) return;
  
        dynCall_vii(GLFW.active.cursorEnterFunc, GLFW.active.id, 0);
      },onMouseButtonChanged:function (event, status) {
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
      },onMouseButtonDown:function (event) {
        if (!GLFW.active) return;
        GLFW.onMouseButtonChanged(event, 1); // GLFW_PRESS
      },onMouseButtonUp:function (event) {
        if (!GLFW.active) return;
        GLFW.onMouseButtonChanged(event, 0); // GLFW_RELEASE
      },onMouseWheel:function (event) {
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
      },onCanvasResize:function (width, height) {
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
      },onWindowSizeChanged:function () {
        if (!GLFW.active) return;
  
        if (!GLFW.active.windowSizeFunc) return;
  
  
        dynCall_viii(GLFW.active.windowSizeFunc, GLFW.active.id, GLFW.active.width, GLFW.active.height);
      },onFramebufferSizeChanged:function () {
        if (!GLFW.active) return;
  
        if (!GLFW.active.framebufferSizeFunc) return;
  
        dynCall_viii(GLFW.active.framebufferSizeFunc, GLFW.active.id, GLFW.active.width, GLFW.active.height);
      },getTime:function () {
        return _emscripten_get_now() / 1000;
      },setWindowTitle:function (winid, title) {
        var win = GLFW.WindowFromId(winid);
        if (!win) return;
  
        win.title = UTF8ToString(title);
        if (GLFW.active.id == win.id) {
          document.title = win.title;
        }
      },setJoystickCallback:function (cbfun) {
        GLFW.joystickFunc = cbfun;
        GLFW.refreshJoysticks();
      },joys:{},lastGamepadState:null,lastGamepadStateFrame:null,refreshJoysticks:function () {
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
      },setKeyCallback:function (winid, cbfun) {
        var win = GLFW.WindowFromId(winid);
        if (!win) return null;
        var prevcbfun = win.keyFunc;
        win.keyFunc = cbfun;
        return prevcbfun;
      },setCharCallback:function (winid, cbfun) {
        var win = GLFW.WindowFromId(winid);
        if (!win) return null;
        var prevcbfun = win.charFunc;
        win.charFunc = cbfun;
        return prevcbfun;
      },setMouseButtonCallback:function (winid, cbfun) {
        var win = GLFW.WindowFromId(winid);
        if (!win) return null;
        var prevcbfun = win.mouseButtonFunc;
        win.mouseButtonFunc = cbfun;
        return prevcbfun;
      },setCursorPosCallback:function (winid, cbfun) {
        var win = GLFW.WindowFromId(winid);
        if (!win) return null;
        var prevcbfun = win.cursorPosFunc;
        win.cursorPosFunc = cbfun;
        return prevcbfun;
      },setScrollCallback:function (winid, cbfun) {
        var win = GLFW.WindowFromId(winid);
        if (!win) return null;
        var prevcbfun = win.scrollFunc;
        win.scrollFunc = cbfun;
        return prevcbfun;
      },setDropCallback:function (winid, cbfun) {
        var win = GLFW.WindowFromId(winid);
        if (!win) return null;
        var prevcbfun = win.dropFunc;
        win.dropFunc = cbfun;
        return prevcbfun;
      },onDrop:function (event) {
        if (!GLFW.active || !GLFW.active.dropFunc) return;
        if (!event.dataTransfer || !event.dataTransfer.files || event.dataTransfer.files.length == 0) return;
  
        event.preventDefault();
  
  
        return false;
      },onDragover:function (event) {
        if (!GLFW.active || !GLFW.active.dropFunc) return;
  
        event.preventDefault();
        return false;
      },setWindowSizeCallback:function (winid, cbfun) {
        var win = GLFW.WindowFromId(winid);
        if (!win) return null;
        var prevcbfun = win.windowSizeFunc;
        win.windowSizeFunc = cbfun;
  
  
        return prevcbfun;
      },setWindowCloseCallback:function (winid, cbfun) {
        var win = GLFW.WindowFromId(winid);
        if (!win) return null;
        var prevcbfun = win.windowCloseFunc;
        win.windowCloseFunc = cbfun;
        return prevcbfun;
      },setWindowRefreshCallback:function (winid, cbfun) {
        var win = GLFW.WindowFromId(winid);
        if (!win) return null;
        var prevcbfun = win.windowRefreshFunc;
        win.windowRefreshFunc = cbfun;
        return prevcbfun;
      },onClickRequestPointerLock:function (e) {
        if (!Browser.pointerLock && Module['canvas'].requestPointerLock) {
          Module['canvas'].requestPointerLock();
          e.preventDefault();
        }
      },setInputMode:function (winid, mode, value) {
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
      },getKey:function (winid, key) {
        var win = GLFW.WindowFromId(winid);
        if (!win) return 0;
        return win.keys[key];
      },getMouseButton:function (winid, button) {
        var win = GLFW.WindowFromId(winid);
        if (!win) return 0;
        return (win.buttons & (1 << button)) > 0;
      },getCursorPos:function (winid, x, y) {
        setValue(x, Browser.mouseX, 'double');
        setValue(y, Browser.mouseY, 'double');
      },getMousePos:function (winid, x, y) {
        setValue(x, Browser.mouseX, 'i32');
        setValue(y, Browser.mouseY, 'i32');
      },setCursorPos:function (winid, x, y) {
      },getWindowPos:function (winid, x, y) {
        var wx = 0;
        var wy = 0;
  
        var win = GLFW.WindowFromId(winid);
        if (win) {
          wx = win.x;
          wy = win.y;
        }
  
        setValue(x, wx, 'i32');
        setValue(y, wy, 'i32');
      },setWindowPos:function (winid, x, y) {
        var win = GLFW.WindowFromId(winid);
        if (!win) return;
        win.x = x;
        win.y = y;
      },getWindowSize:function (winid, width, height) {
        var ww = 0;
        var wh = 0;
  
        var win = GLFW.WindowFromId(winid);
        if (win) {
          ww = win.width;
          wh = win.height;
        }
  
        setValue(width, ww, 'i32');
        setValue(height, wh, 'i32');
      },setWindowSize:function (winid, width, height) {
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
      },createWindow:function (width, height, title, monitor, share) {
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
      },destroyWindow:function (winid) {
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
      },swapBuffers:function (winid) {
      },GLFW2ParamToGLFW3Param:function (param) {
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
  } else if (typeof performance === 'object' && performance && typeof performance['now'] === 'function') {
    _emscripten_get_now = function() { return performance['now'](); };
  } else {
    _emscripten_get_now = Date.now;
  };
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

var asmLibraryArg = { "EMTSTACKTOP": EMTSTACKTOP, "EMT_STACK_MAX": EMT_STACK_MAX, "___assert_fail": ___assert_fail, "___lock": ___lock, "___setErrNo": ___setErrNo, "___syscall221": ___syscall221, "___syscall5": ___syscall5, "___syscall54": ___syscall54, "___unlock": ___unlock, "___wasi_fd_close": ___wasi_fd_close, "___wasi_fd_read": ___wasi_fd_read, "___wasi_fd_seek": ___wasi_fd_seek, "___wasi_fd_write": ___wasi_fd_write, "__colorChannelsInGlTextureFormat": __colorChannelsInGlTextureFormat, "__computeUnpackAlignedImageSize": __computeUnpackAlignedImageSize, "__fillFullscreenChangeEventData": __fillFullscreenChangeEventData, "__fillGamepadEventData": __fillGamepadEventData, "__fillMouseEventData": __fillMouseEventData, "__fillPointerlockChangeEventData": __fillPointerlockChangeEventData, "__findEventTarget": __findEventTarget, "__glGenObject": __glGenObject, "__heapAccessShiftForWebGLHeap": __heapAccessShiftForWebGLHeap, "__heapObjectForWebGLType": __heapObjectForWebGLType, "__memory_base": 1024, "__registerFullscreenChangeEventCallback": __registerFullscreenChangeEventCallback, "__registerGamepadEventCallback": __registerGamepadEventCallback, "__registerKeyEventCallback": __registerKeyEventCallback, "__registerMouseEventCallback": __registerMouseEventCallback, "__registerTouchEventCallback": __registerTouchEventCallback, "__requestPointerLock": __requestPointerLock, "__table_base": 0, "_abort": _abort, "_eglGetProcAddress": _eglGetProcAddress, "_emscripten_exit_pointerlock": _emscripten_exit_pointerlock, "_emscripten_get_element_css_size": _emscripten_get_element_css_size, "_emscripten_get_gamepad_status": _emscripten_get_gamepad_status, "_emscripten_get_heap_size": _emscripten_get_heap_size, "_emscripten_get_now": _emscripten_get_now, "_emscripten_get_num_gamepads": _emscripten_get_num_gamepads, "_emscripten_get_pointerlock_status": _emscripten_get_pointerlock_status, "_emscripten_glActiveTexture": _emscripten_glActiveTexture, "_emscripten_glAttachShader": _emscripten_glAttachShader, "_emscripten_glBeginQueryEXT": _emscripten_glBeginQueryEXT, "_emscripten_glBindAttribLocation": _emscripten_glBindAttribLocation, "_emscripten_glBindBuffer": _emscripten_glBindBuffer, "_emscripten_glBindFramebuffer": _emscripten_glBindFramebuffer, "_emscripten_glBindRenderbuffer": _emscripten_glBindRenderbuffer, "_emscripten_glBindTexture": _emscripten_glBindTexture, "_emscripten_glBindVertexArrayOES": _emscripten_glBindVertexArrayOES, "_emscripten_glBlendColor": _emscripten_glBlendColor, "_emscripten_glBlendEquation": _emscripten_glBlendEquation, "_emscripten_glBlendEquationSeparate": _emscripten_glBlendEquationSeparate, "_emscripten_glBlendFunc": _emscripten_glBlendFunc, "_emscripten_glBlendFuncSeparate": _emscripten_glBlendFuncSeparate, "_emscripten_glBufferData": _emscripten_glBufferData, "_emscripten_glBufferSubData": _emscripten_glBufferSubData, "_emscripten_glCheckFramebufferStatus": _emscripten_glCheckFramebufferStatus, "_emscripten_glClear": _emscripten_glClear, "_emscripten_glClearColor": _emscripten_glClearColor, "_emscripten_glClearDepthf": _emscripten_glClearDepthf, "_emscripten_glClearStencil": _emscripten_glClearStencil, "_emscripten_glColorMask": _emscripten_glColorMask, "_emscripten_glCompileShader": _emscripten_glCompileShader, "_emscripten_glCompressedTexImage2D": _emscripten_glCompressedTexImage2D, "_emscripten_glCompressedTexSubImage2D": _emscripten_glCompressedTexSubImage2D, "_emscripten_glCopyTexImage2D": _emscripten_glCopyTexImage2D, "_emscripten_glCopyTexSubImage2D": _emscripten_glCopyTexSubImage2D, "_emscripten_glCreateProgram": _emscripten_glCreateProgram, "_emscripten_glCreateShader": _emscripten_glCreateShader, "_emscripten_glCullFace": _emscripten_glCullFace, "_emscripten_glDeleteBuffers": _emscripten_glDeleteBuffers, "_emscripten_glDeleteFramebuffers": _emscripten_glDeleteFramebuffers, "_emscripten_glDeleteProgram": _emscripten_glDeleteProgram, "_emscripten_glDeleteQueriesEXT": _emscripten_glDeleteQueriesEXT, "_emscripten_glDeleteRenderbuffers": _emscripten_glDeleteRenderbuffers, "_emscripten_glDeleteShader": _emscripten_glDeleteShader, "_emscripten_glDeleteTextures": _emscripten_glDeleteTextures, "_emscripten_glDeleteVertexArraysOES": _emscripten_glDeleteVertexArraysOES, "_emscripten_glDepthFunc": _emscripten_glDepthFunc, "_emscripten_glDepthMask": _emscripten_glDepthMask, "_emscripten_glDepthRangef": _emscripten_glDepthRangef, "_emscripten_glDetachShader": _emscripten_glDetachShader, "_emscripten_glDisable": _emscripten_glDisable, "_emscripten_glDisableVertexAttribArray": _emscripten_glDisableVertexAttribArray, "_emscripten_glDrawArrays": _emscripten_glDrawArrays, "_emscripten_glDrawArraysInstancedANGLE": _emscripten_glDrawArraysInstancedANGLE, "_emscripten_glDrawBuffersWEBGL": _emscripten_glDrawBuffersWEBGL, "_emscripten_glDrawElements": _emscripten_glDrawElements, "_emscripten_glDrawElementsInstancedANGLE": _emscripten_glDrawElementsInstancedANGLE, "_emscripten_glEnable": _emscripten_glEnable, "_emscripten_glEnableVertexAttribArray": _emscripten_glEnableVertexAttribArray, "_emscripten_glEndQueryEXT": _emscripten_glEndQueryEXT, "_emscripten_glFinish": _emscripten_glFinish, "_emscripten_glFlush": _emscripten_glFlush, "_emscripten_glFramebufferRenderbuffer": _emscripten_glFramebufferRenderbuffer, "_emscripten_glFramebufferTexture2D": _emscripten_glFramebufferTexture2D, "_emscripten_glFrontFace": _emscripten_glFrontFace, "_emscripten_glGenBuffers": _emscripten_glGenBuffers, "_emscripten_glGenFramebuffers": _emscripten_glGenFramebuffers, "_emscripten_glGenQueriesEXT": _emscripten_glGenQueriesEXT, "_emscripten_glGenRenderbuffers": _emscripten_glGenRenderbuffers, "_emscripten_glGenTextures": _emscripten_glGenTextures, "_emscripten_glGenVertexArraysOES": _emscripten_glGenVertexArraysOES, "_emscripten_glGenerateMipmap": _emscripten_glGenerateMipmap, "_emscripten_glGetActiveAttrib": _emscripten_glGetActiveAttrib, "_emscripten_glGetActiveUniform": _emscripten_glGetActiveUniform, "_emscripten_glGetAttachedShaders": _emscripten_glGetAttachedShaders, "_emscripten_glGetAttribLocation": _emscripten_glGetAttribLocation, "_emscripten_glGetBooleanv": _emscripten_glGetBooleanv, "_emscripten_glGetBufferParameteriv": _emscripten_glGetBufferParameteriv, "_emscripten_glGetError": _emscripten_glGetError, "_emscripten_glGetFloatv": _emscripten_glGetFloatv, "_emscripten_glGetFramebufferAttachmentParameteriv": _emscripten_glGetFramebufferAttachmentParameteriv, "_emscripten_glGetIntegerv": _emscripten_glGetIntegerv, "_emscripten_glGetProgramInfoLog": _emscripten_glGetProgramInfoLog, "_emscripten_glGetProgramiv": _emscripten_glGetProgramiv, "_emscripten_glGetQueryObjecti64vEXT": _emscripten_glGetQueryObjecti64vEXT, "_emscripten_glGetQueryObjectivEXT": _emscripten_glGetQueryObjectivEXT, "_emscripten_glGetQueryObjectui64vEXT": _emscripten_glGetQueryObjectui64vEXT, "_emscripten_glGetQueryObjectuivEXT": _emscripten_glGetQueryObjectuivEXT, "_emscripten_glGetQueryivEXT": _emscripten_glGetQueryivEXT, "_emscripten_glGetRenderbufferParameteriv": _emscripten_glGetRenderbufferParameteriv, "_emscripten_glGetShaderInfoLog": _emscripten_glGetShaderInfoLog, "_emscripten_glGetShaderPrecisionFormat": _emscripten_glGetShaderPrecisionFormat, "_emscripten_glGetShaderSource": _emscripten_glGetShaderSource, "_emscripten_glGetShaderiv": _emscripten_glGetShaderiv, "_emscripten_glGetString": _emscripten_glGetString, "_emscripten_glGetTexParameterfv": _emscripten_glGetTexParameterfv, "_emscripten_glGetTexParameteriv": _emscripten_glGetTexParameteriv, "_emscripten_glGetUniformLocation": _emscripten_glGetUniformLocation, "_emscripten_glGetUniformfv": _emscripten_glGetUniformfv, "_emscripten_glGetUniformiv": _emscripten_glGetUniformiv, "_emscripten_glGetVertexAttribPointerv": _emscripten_glGetVertexAttribPointerv, "_emscripten_glGetVertexAttribfv": _emscripten_glGetVertexAttribfv, "_emscripten_glGetVertexAttribiv": _emscripten_glGetVertexAttribiv, "_emscripten_glHint": _emscripten_glHint, "_emscripten_glIsBuffer": _emscripten_glIsBuffer, "_emscripten_glIsEnabled": _emscripten_glIsEnabled, "_emscripten_glIsFramebuffer": _emscripten_glIsFramebuffer, "_emscripten_glIsProgram": _emscripten_glIsProgram, "_emscripten_glIsQueryEXT": _emscripten_glIsQueryEXT, "_emscripten_glIsRenderbuffer": _emscripten_glIsRenderbuffer, "_emscripten_glIsShader": _emscripten_glIsShader, "_emscripten_glIsTexture": _emscripten_glIsTexture, "_emscripten_glIsVertexArrayOES": _emscripten_glIsVertexArrayOES, "_emscripten_glLineWidth": _emscripten_glLineWidth, "_emscripten_glLinkProgram": _emscripten_glLinkProgram, "_emscripten_glPixelStorei": _emscripten_glPixelStorei, "_emscripten_glPolygonOffset": _emscripten_glPolygonOffset, "_emscripten_glQueryCounterEXT": _emscripten_glQueryCounterEXT, "_emscripten_glReadPixels": _emscripten_glReadPixels, "_emscripten_glReleaseShaderCompiler": _emscripten_glReleaseShaderCompiler, "_emscripten_glRenderbufferStorage": _emscripten_glRenderbufferStorage, "_emscripten_glSampleCoverage": _emscripten_glSampleCoverage, "_emscripten_glScissor": _emscripten_glScissor, "_emscripten_glShaderBinary": _emscripten_glShaderBinary, "_emscripten_glShaderSource": _emscripten_glShaderSource, "_emscripten_glStencilFunc": _emscripten_glStencilFunc, "_emscripten_glStencilFuncSeparate": _emscripten_glStencilFuncSeparate, "_emscripten_glStencilMask": _emscripten_glStencilMask, "_emscripten_glStencilMaskSeparate": _emscripten_glStencilMaskSeparate, "_emscripten_glStencilOp": _emscripten_glStencilOp, "_emscripten_glStencilOpSeparate": _emscripten_glStencilOpSeparate, "_emscripten_glTexImage2D": _emscripten_glTexImage2D, "_emscripten_glTexParameterf": _emscripten_glTexParameterf, "_emscripten_glTexParameterfv": _emscripten_glTexParameterfv, "_emscripten_glTexParameteri": _emscripten_glTexParameteri, "_emscripten_glTexParameteriv": _emscripten_glTexParameteriv, "_emscripten_glTexSubImage2D": _emscripten_glTexSubImage2D, "_emscripten_glUniform1f": _emscripten_glUniform1f, "_emscripten_glUniform1fv": _emscripten_glUniform1fv, "_emscripten_glUniform1i": _emscripten_glUniform1i, "_emscripten_glUniform1iv": _emscripten_glUniform1iv, "_emscripten_glUniform2f": _emscripten_glUniform2f, "_emscripten_glUniform2fv": _emscripten_glUniform2fv, "_emscripten_glUniform2i": _emscripten_glUniform2i, "_emscripten_glUniform2iv": _emscripten_glUniform2iv, "_emscripten_glUniform3f": _emscripten_glUniform3f, "_emscripten_glUniform3fv": _emscripten_glUniform3fv, "_emscripten_glUniform3i": _emscripten_glUniform3i, "_emscripten_glUniform3iv": _emscripten_glUniform3iv, "_emscripten_glUniform4f": _emscripten_glUniform4f, "_emscripten_glUniform4fv": _emscripten_glUniform4fv, "_emscripten_glUniform4i": _emscripten_glUniform4i, "_emscripten_glUniform4iv": _emscripten_glUniform4iv, "_emscripten_glUniformMatrix2fv": _emscripten_glUniformMatrix2fv, "_emscripten_glUniformMatrix3fv": _emscripten_glUniformMatrix3fv, "_emscripten_glUniformMatrix4fv": _emscripten_glUniformMatrix4fv, "_emscripten_glUseProgram": _emscripten_glUseProgram, "_emscripten_glValidateProgram": _emscripten_glValidateProgram, "_emscripten_glVertexAttrib1f": _emscripten_glVertexAttrib1f, "_emscripten_glVertexAttrib1fv": _emscripten_glVertexAttrib1fv, "_emscripten_glVertexAttrib2f": _emscripten_glVertexAttrib2f, "_emscripten_glVertexAttrib2fv": _emscripten_glVertexAttrib2fv, "_emscripten_glVertexAttrib3f": _emscripten_glVertexAttrib3f, "_emscripten_glVertexAttrib3fv": _emscripten_glVertexAttrib3fv, "_emscripten_glVertexAttrib4f": _emscripten_glVertexAttrib4f, "_emscripten_glVertexAttrib4fv": _emscripten_glVertexAttrib4fv, "_emscripten_glVertexAttribDivisorANGLE": _emscripten_glVertexAttribDivisorANGLE, "_emscripten_glVertexAttribPointer": _emscripten_glVertexAttribPointer, "_emscripten_glViewport": _emscripten_glViewport, "_emscripten_memcpy_big": _emscripten_memcpy_big, "_emscripten_request_pointerlock": _emscripten_request_pointerlock, "_emscripten_resize_heap": _emscripten_resize_heap, "_emscripten_run_script": _emscripten_run_script, "_emscripten_sample_gamepad_data": _emscripten_sample_gamepad_data, "_emscripten_set_click_callback_on_thread": _emscripten_set_click_callback_on_thread, "_emscripten_set_fullscreenchange_callback_on_thread": _emscripten_set_fullscreenchange_callback_on_thread, "_emscripten_set_gamepadconnected_callback_on_thread": _emscripten_set_gamepadconnected_callback_on_thread, "_emscripten_set_gamepaddisconnected_callback_on_thread": _emscripten_set_gamepaddisconnected_callback_on_thread, "_emscripten_set_keypress_callback_on_thread": _emscripten_set_keypress_callback_on_thread, "_emscripten_set_main_loop": _emscripten_set_main_loop, "_emscripten_set_main_loop_timing": _emscripten_set_main_loop_timing, "_emscripten_set_touchcancel_callback_on_thread": _emscripten_set_touchcancel_callback_on_thread, "_emscripten_set_touchend_callback_on_thread": _emscripten_set_touchend_callback_on_thread, "_emscripten_set_touchmove_callback_on_thread": _emscripten_set_touchmove_callback_on_thread, "_emscripten_set_touchstart_callback_on_thread": _emscripten_set_touchstart_callback_on_thread, "_exit": _exit, "_fd_close": _fd_close, "_fd_read": _fd_read, "_fd_seek": _fd_seek, "_fd_write": _fd_write, "_glActiveTexture": _glActiveTexture, "_glAttachShader": _glAttachShader, "_glBindAttribLocation": _glBindAttribLocation, "_glBindBuffer": _glBindBuffer, "_glBindTexture": _glBindTexture, "_glBlendFunc": _glBlendFunc, "_glBufferData": _glBufferData, "_glBufferSubData": _glBufferSubData, "_glClear": _glClear, "_glClearColor": _glClearColor, "_glClearDepthf": _glClearDepthf, "_glCompileShader": _glCompileShader, "_glCompressedTexImage2D": _glCompressedTexImage2D, "_glCreateProgram": _glCreateProgram, "_glCreateShader": _glCreateShader, "_glCullFace": _glCullFace, "_glDeleteProgram": _glDeleteProgram, "_glDepthFunc": _glDepthFunc, "_glDisable": _glDisable, "_glDrawArrays": _glDrawArrays, "_glDrawElements": _glDrawElements, "_glEnable": _glEnable, "_glEnableVertexAttribArray": _glEnableVertexAttribArray, "_glFrontFace": _glFrontFace, "_glGenBuffers": _glGenBuffers, "_glGenTextures": _glGenTextures, "_glGetAttribLocation": _glGetAttribLocation, "_glGetFloatv": _glGetFloatv, "_glGetProgramInfoLog": _glGetProgramInfoLog, "_glGetProgramiv": _glGetProgramiv, "_glGetShaderInfoLog": _glGetShaderInfoLog, "_glGetShaderiv": _glGetShaderiv, "_glGetString": _glGetString, "_glGetUniformLocation": _glGetUniformLocation, "_glLinkProgram": _glLinkProgram, "_glPixelStorei": _glPixelStorei, "_glReadPixels": _glReadPixels, "_glShaderSource": _glShaderSource, "_glTexImage2D": _glTexImage2D, "_glTexParameteri": _glTexParameteri, "_glUniform1i": _glUniform1i, "_glUniform4f": _glUniform4f, "_glUniformMatrix4fv": _glUniformMatrix4fv, "_glUseProgram": _glUseProgram, "_glVertexAttribPointer": _glVertexAttribPointer, "_glViewport": _glViewport, "_glfwCreateWindow": _glfwCreateWindow, "_glfwDefaultWindowHints": _glfwDefaultWindowHints, "_glfwGetCursorPos": _glfwGetCursorPos, "_glfwGetPrimaryMonitor": _glfwGetPrimaryMonitor, "_glfwGetTime": _glfwGetTime, "_glfwGetVideoModes": _glfwGetVideoModes, "_glfwInit": _glfwInit, "_glfwMakeContextCurrent": _glfwMakeContextCurrent, "_glfwSetCharCallback": _glfwSetCharCallback, "_glfwSetCursorEnterCallback": _glfwSetCursorEnterCallback, "_glfwSetCursorPosCallback": _glfwSetCursorPosCallback, "_glfwSetDropCallback": _glfwSetDropCallback, "_glfwSetErrorCallback": _glfwSetErrorCallback, "_glfwSetKeyCallback": _glfwSetKeyCallback, "_glfwSetMouseButtonCallback": _glfwSetMouseButtonCallback, "_glfwSetScrollCallback": _glfwSetScrollCallback, "_glfwSetWindowIconifyCallback": _glfwSetWindowIconifyCallback, "_glfwSetWindowShouldClose": _glfwSetWindowShouldClose, "_glfwSetWindowSizeCallback": _glfwSetWindowSizeCallback, "_glfwSwapBuffers": _glfwSwapBuffers, "_glfwSwapInterval": _glfwSwapInterval, "_glfwTerminate": _glfwTerminate, "_glfwWindowHint": _glfwWindowHint, "_llvm_cos_f32": _llvm_cos_f32, "_llvm_cttz_i32": _llvm_cttz_i32, "_llvm_sin_f32": _llvm_sin_f32, "_llvm_stackrestore": _llvm_stackrestore, "_llvm_stacksave": _llvm_stacksave, "_nanosleep": _nanosleep, "_time": _time, "_usleep": _usleep, "abort": abort, "abortOnCannotGrowMemory": abortOnCannotGrowMemory, "abortStackOverflow": abortStackOverflow, "abortStackOverflowEmterpreter": abortStackOverflowEmterpreter, "demangle": demangle, "demangleAll": demangleAll, "eb": eb, "emscriptenWebGLGet": emscriptenWebGLGet, "emscriptenWebGLGetTexPixelData": emscriptenWebGLGetTexPixelData, "emscriptenWebGLGetUniform": emscriptenWebGLGetUniform, "emscriptenWebGLGetVertexAttrib": emscriptenWebGLGetVertexAttrib, "getTempRet0": getTempRet0, "jsStackTrace": jsStackTrace, "memory": wasmMemory, "nullFunc_ff": nullFunc_ff, "nullFunc_fff": nullFunc_fff, "nullFunc_i": nullFunc_i, "nullFunc_ii": nullFunc_ii, "nullFunc_iidiiii": nullFunc_iidiiii, "nullFunc_iii": nullFunc_iii, "nullFunc_iiii": nullFunc_iiii, "nullFunc_iiiii": nullFunc_iiiii, "nullFunc_v": nullFunc_v, "nullFunc_vf": nullFunc_vf, "nullFunc_vff": nullFunc_vff, "nullFunc_vffff": nullFunc_vffff, "nullFunc_vfi": nullFunc_vfi, "nullFunc_vi": nullFunc_vi, "nullFunc_vidd": nullFunc_vidd, "nullFunc_vif": nullFunc_vif, "nullFunc_viff": nullFunc_viff, "nullFunc_vifff": nullFunc_vifff, "nullFunc_viffff": nullFunc_viffff, "nullFunc_vii": nullFunc_vii, "nullFunc_viif": nullFunc_viif, "nullFunc_viii": nullFunc_viii, "nullFunc_viiii": nullFunc_viiii, "nullFunc_viiiii": nullFunc_viiiii, "nullFunc_viiiiii": nullFunc_viiiiii, "nullFunc_viiiiiii": nullFunc_viiiiiii, "nullFunc_viiiiiiii": nullFunc_viiiiiiii, "nullFunc_viiiiiiiii": nullFunc_viiiiiiiii, "setTempRet0": setTempRet0, "stackTrace": stackTrace, "stringToNewUTF8": stringToNewUTF8, "table": wasmTable, "tempDoublePtr": tempDoublePtr };
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
if (!Object.getOwnPropertyDescriptor(Module, "stackSave")) Module["stackSave"] = function() { abort("'stackSave' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "stackRestore")) Module["stackRestore"] = function() { abort("'stackRestore' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "stackAlloc")) Module["stackAlloc"] = function() { abort("'stackAlloc' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "establishStackSpace")) Module["establishStackSpace"] = function() { abort("'establishStackSpace' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "print")) Module["print"] = function() { abort("'print' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "printErr")) Module["printErr"] = function() { abort("'printErr' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "getTempRet0")) Module["getTempRet0"] = function() { abort("'getTempRet0' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "setTempRet0")) Module["setTempRet0"] = function() { abort("'setTempRet0' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "callMain")) Module["callMain"] = function() { abort("'callMain' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "abort")) Module["abort"] = function() { abort("'abort' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "Pointer_stringify")) Module["Pointer_stringify"] = function() { abort("'Pointer_stringify' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Object.getOwnPropertyDescriptor(Module, "warnOnce")) Module["warnOnce"] = function() { abort("'warnOnce' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
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
    } else if (e == 'SimulateInfiniteLoop') {
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










