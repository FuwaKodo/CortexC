const TYPE_SIZES_BYTES = {
  int: 4,
  char: 1,
  float: 4,
  double: 8,
  void: 0,
  long: 8,
  short: 2,
};

const POINTER_SIZE_BYTES = 8;
const DEFAULT_TYPE_SIZE_BYTES = 4;

/**
 * A parsed C type object produced by Parser.parseType().
 *
 * Examples:
 * int      : { base: "int", pointer: 0 }
 * int *    : { base: "int", pointer: 1 }
 * char **  : { base: "char", pointer: 2 }
 *
 * @typedef {Object} CType
 * @property {string} base - Base C type, including supported modifiers
 * @property {number} pointer - Number of pointer stars after the base type
*/

/**
 * Returns the number of bytes needed to store a value of this C type.
 *
 * Pointer types are simulated as 8-byte addresses.
 * Non-pointer types use their cleaned base type name.
 * 
 * @param {CType} type - Parsed C type object
 * @returns {number} - Number of bytes used by this type
*/
function getTypeSize(type) {
  if (type.pointer > 0) {
    return POINTER_SIZE_BYTES;
  } 

  const baseType = getBaseTypeName(type.base);
  return TYPE_SIZES_BYTES[baseType] || DEFAULT_TYPE_SIZE_BYTES;
}

/**
 * Removes supported C modifiers from a base type string.
 * 
 * Examples:
 * "unsigned int"   : "int"
 * "const char"     : "char"
 * "static int"     : "int"
 * 
 * @param {string} typeBase - Raw base type string from parser 
 * @returns {string} - Base type name without supported modifiers
*/
function getBaseTypeName(typeBase) {
  return typeBase.replace(/unsigned |const |static /g, "").trim();
}

/**
 * Returns the default simulated value for a C type. 
 * 
 * Default values for scalar values and pointer values are 0.
 * For pointers, 0 represents NULL.
 * 
 * @param {CType} type - Parsed C type object
 * @returns {number} - Default value for this type
*/
function getDefaultValueForType(type) {
  return 0; 
}

function sizeOf(type) {
  if (type.pointer > 0) return 8;
  const base = type.base.replace(/unsigned |const |static /g, "").trim();
  return TYPE_SIZES[base] || 4;
}

function defaultVal(type) {
  if (type.pointer > 0) return 0;
  return 0;
}

class MemoryModel {
  constructor() {
    this.stack = [];
    this.heap = new Map();
    this.globals = new Map();
    this.nextHeapAddr = 0x4000;
    this.nextGlobalAddr = 0x1000;
    this.nextStackBase = 0x7ff0;
  }

  reset() {
    this.stack = [];
    this.heap.clear();
    this.globals.clear();
    this.nextHeapAddr = 0x4000;
    this.nextGlobalAddr = 0x1000;
    this.nextStackBase = 0x7ff0;
  }

  declareGlobal(name, type, value, arraySize, arrayInit) {
    const size = arraySize ? arraySize * sizeOf(type) : sizeOf(type);
    const addr = this.nextGlobalAddr;
    this.nextGlobalAddr += size + ((4 - (size % 4)) % 4);

    if (arraySize) {
      const values = [];
      for (let i = 0; i < arraySize; i++) {
        values.push(
          arrayInit ? this.evalLiteral(arrayInit[i]) : defaultVal(type),
        );
      }
      this.globals.set(name, {
        type,
        addr,
        isArray: true,
        size: arraySize,
        values,
        elemType: type,
      });
    } else {
      this.globals.set(name, {
        type,
        addr,
        value: value !== null ? value : defaultVal(type),
        isArray: false,
      });
    }
    return addr;
  }

  evalLiteral(node) {
    if (!node) return 0;
    if (typeof node === "number") return node;
    if (node.kind === "num") return node.value;
    return 0;
  }

  pushFrame(name) {
    const base = this.nextStackBase;
    this.stack.push({ name, base, vars: new Map(), currentAddr: base });
    this.nextStackBase -= 0x100;
  }

  popFrame() {
    const frame = this.stack.pop();
    if (frame) this.nextStackBase += 0x100;
    return frame;
  }

  topFrame() {
    return this.stack[this.stack.length - 1];
  }

  declareLocal(name, type, value, arraySize, arrayInit) {
    const frame = this.topFrame();
    if (!frame) return;
    const size = arraySize ? arraySize * sizeOf(type) : sizeOf(type);
    frame.currentAddr -= size + ((4 - (size % 4)) % 4);
    const addr = frame.currentAddr;

    if (arraySize) {
      const values = [];
      for (let i = 0; i < arraySize; i++) {
        values.push(arrayInit ? arrayInit[i] : defaultVal(type));
      }
      frame.vars.set(name, {
        type,
        addr,
        isArray: true,
        size: arraySize,
        values,
        elemType: type,
      });
    } else {
      frame.vars.set(name, {
        type,
        addr,
        value: value !== null && value !== undefined ? value : defaultVal(type),
        isArray: false,
      });
    }
    return addr;
  }

  setLocal(name, value) {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      if (this.stack[i].vars.has(name)) {
        this.stack[i].vars.get(name).value = value;
        return true;
      }
    }
    if (this.globals.has(name)) {
      this.globals.get(name).value = value;
      return true;
    }
    return false;
  }

  getVar(name) {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      if (this.stack[i].vars.has(name)) return this.stack[i].vars.get(name);
    }
    if (this.globals.has(name)) return this.globals.get(name);
    return null;
  }

  getVarAddr(name) {
    const v = this.getVar(name);
    return v ? v.addr : 0;
  }

  setArrayElem(name, index, value) {
    const v = this.getVar(name);
    if (v && v.isArray && index >= 0 && index < v.size) {
      v.values[index] = value;
      return true;
    }
    return false;
  }

  getArrayElem(name, index) {
    const v = this.getVar(name);
    if (v && v.isArray && index >= 0 && index < v.size) return v.values[index];
    return 0;
  }

  allocHeap(size, requestedType) {
    const addr = this.nextHeapAddr;
    const elemCount = Math.max(1, Math.ceil(size / 4));
    this.heap.set(addr, {
      size,
      elemCount,
      values: new Array(elemCount).fill(0),
      type: requestedType || { base: "int", pointer: 0 },
      freed: false,
    });
    this.nextHeapAddr += size + ((8 - (size % 8)) % 8) + 8;
    return addr;
  }

  freeHeap(addr) {
    if (this.heap.has(addr) && !this.heap.get(addr).freed) {
      this.heap.get(addr).freed = true;
      return true;
    }
    return false;
  }

  setHeapValue(addr, value) {
    for (const [base, block] of this.heap) {
      if (!block.freed && addr >= base && addr < base + block.size) {
        const idx = Math.floor((addr - base) / 4);
        if (idx < block.elemCount) {
          block.values[idx] = value;
        }
        return true;
      }
    }
    return false;
  }

  getHeapValue(addr) {
    for (const [base, block] of this.heap) {
      if (addr >= base && addr < base + block.size) {
        const idx = Math.floor((addr - base) / 4);
        return idx < block.elemCount ? block.values[idx] : 0;
      }
    }
    return 0;
  }

  resolveAddress(addr) {
    for (const [base, block] of this.heap) {
      if (addr >= base && addr < base + block.size) {
        const idx = Math.floor((addr - base) / 4);
        if (idx < block.elemCount)
          return { kind: "heap", base, block, index: idx };
      }
    }
    for (const frame of this.stack) {
      for (const [name, v] of frame.vars) {
        if (!v.isArray && v.addr === addr)
          return { kind: "stack_scalar", frame, name, variable: v };
        if (v.isArray) {
          const elemSize = sizeOf(v.elemType || v.type);
          const idx = Math.floor((addr - v.addr) / elemSize);
          if (addr >= v.addr && idx >= 0 && idx < v.size)
            return {
              kind: "stack_array",
              frame,
              name,
              variable: v,
              index: idx,
            };
        }
      }
    }
    for (const [name, v] of this.globals) {
      if (!v.isArray && v.addr === addr)
        return { kind: "global_scalar", name, variable: v };
      if (v.isArray) {
        const elemSize = sizeOf(v.elemType || v.type);
        const idx = Math.floor((addr - v.addr) / elemSize);
        if (addr >= v.addr && idx >= 0 && idx < v.size)
          return { kind: "global_array", name, variable: v, index: idx };
      }
    }
    return null;
  }

  deref(addr) {
    const resolved = this.resolveAddress(addr);
    if (!resolved) return 0;
    if (resolved.kind === "heap") return resolved.block.values[resolved.index];
    if (resolved.kind.endsWith("_array"))
      return resolved.variable.values[resolved.index];
    return resolved.variable.value;
  }

  setDeref(addr, value) {
    const resolved = this.resolveAddress(addr);
    if (!resolved) return false;
    if (resolved.kind === "heap") {
      if (resolved.block.freed) return false;
      resolved.block.values[resolved.index] = value;
      return true;
    }
    if (resolved.kind.endsWith("_array")) {
      resolved.variable.values[resolved.index] = value;
      return true;
    }
    resolved.variable.value = value;
    return true;
  }
}
