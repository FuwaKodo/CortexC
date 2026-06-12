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
 * @returns {number} Number of bytes used by this type
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
 * @returns {string} Base type name without supported modifiers
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
 * @returns {number} Default value for this type
*/
function getDefaultValueForType(type) {
  return 0; 
}


/**
 * Represents one simulated function call stack frame.
 * 
 * A new stack frame is created whenever the interpreter enters a function.
 * Local variables and function parameters are stored inside the object.
 * 
 * Example: 
 * {
 *    name: "main", 
 *    base: 0x7ff0,
 *    vars: Map {
 *      "x" : { type, addr, value, isArray }
 *    }
 * }
 * 
 * @typedef {Object} StackFrame
 * @property {string} name - Function name for this stack frame
 * @property {number} base  - Base address of this stack frame
 * @property {Map<string, MemoryVariable>} vars - Variables declared in this frame
 * @property {number} currentAddr - Next available stack address
*/

/**
 * Represents one variable stored in simulated memory. 
 * 
 * Scalar example:
 * {
 *    type: { base: "int", pointer: 0 }, 
 *    addr: 0x7fec, 
 *    value: 5, 
 *    isArray: false
 * }
 * 
 * Array example:
 * {
 *    type: { base: "int", pointer: 0 }, 
 *    addr: 0x7fe0, 
 *    isArray: true, 
 *    size: 4, 
 *    values: [10, 20, 30 , 40], 
 *    elemType: { base: "int", pointer: 0 }
 * } 
 * 
 * @typedef {Object} MemoryVariable
 * @property {CType} type - Parsed C type object
 * @property {number} addr - Simulated memory address
 * @property {boolean} isArray - Whether this variable is an array
 * @property {*} [value] - Scalar value, used when isArray is false
 * @property {number} [size] - Number of elements, used when isArray is true
 * @property {Array<*>} [values] - Array element values, used when isArray is true
 * @property {CType} [elemType] - Element type, used when isArray is true
*/

/**
 * Represents one allocated heap block from malloc().
 *
 * @typedef {Object} HeapBlock
 * @property {number} size - Requested allocation size in bytes
 * @property {number} elemCount - Number of simulated 4-byte slots in this block
 * @property {Array<*>} values - Stored values inside the heap block
 * @property {CType} type - Type associated with the allocated block
 * @property {boolean} freed - Whether this block has been freed
*/

/**
 * Represents the result of resolving a memory address.
 *
 * The resolved object tells us which memory region owns the address:
 * heap, stack scalar, stack array, global scalar, or global array.
 *
 * @typedef {Object} ResolvedAddress
 * @property {string} kind - Memory location kind
 * @property {number} [base] - Base heap address, used for heap blocks
 * @property {HeapBlock} [block] - Heap block, used when kind is "heap"
 * @property {StackFrame} [frame] - Stack frame, used for stack variables
 * @property {string} [name] - Variable name, used for stack/global variables
 * @property {MemoryVariable} [variable] - Resolved variable object
 * @property {number} [index] - Array/heap slot index
*/

class MemoryModel {
  /**
   * Creates a new simulated memory model. 
   * 
   * Model tracks tree memory regions:
   * - stack: function call frames and local variables
   * - heap: malloc/free allocations
   * - globals: global and static variables
   * 
   * Address ranges are simulated:
   * - globals: start from 0x1000 and grow toward larger addresses 
   * - heap: starts from 0x4000 and grows towards larger addresses
   * - stack: starts from 0x7ff0 and grows towards smaller addresses
  */
  constructor() {
    /** @type {StackFrame[]} */
    this.stack = [];

    /** @type {Map<Number, HeapBlock>} */
    this.heap = new Map();

    /** @type  {Map<string, MemoryVariable>} */
    this.globals = new Map();

    this.nextHeapAddr = 0x4000;
    this.nextGlobalAddr = 0x1000;
    this.nextStackBase = 0x7ff0;
  }

  /**
   * Clears all simulated memory and resets address counters. 
   * 
   * @returns {void} 
  */
  reset() {
    this.stack = [];
    this.heap.clear();
    this.globals.clear();
    this.nextHeapAddr = 0x4000;
    this.nextGlobalAddr = 0x1000;
    this.nextStackBase = 0x7ff0;
  }

  /**
   * Declares a global or static variable in simulated global memory. 
   * 
   * If arraySize is this provided, this declares an array. Otherwise, declares
   * a scalar value with one value. 
   * 
   * @param {string} name -  Variable name 
   * @param {CType} type - Parsed C type object 
   * @param {*} value  - Initial scalar value, or null/undefined for default value
   * @param {number | null | undefined} arraySize - Number of array elements, if this is an array 
   * @param {Array<*> | null | undefined} arrayInit - Initial array values, if provided 
   * @returns  {number} Simulated global memory address of the declared variable
  */
  declareGlobal(name, type, value, arraySize, arrayInit) {
    const size = arraySize ? arraySize * getTypeSize(type) : getTypeSize(type);
    const addr = this.nextGlobalAddr;
    this.nextGlobalAddr += size + ((4 - (size % 4)) % 4);

    if (arraySize) {
      const values = [];
      for (let i = 0; i < arraySize; i++) {
        values.push(
          arrayInit ? this.evalLiteral(arrayInit[i]) : getDefaultValueForType(type),
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
        value: value !== null ? value : getDefaultValueForType(type),
        isArray: false,
      });
    }
    return addr;
  }

  /**
   * Converts a simple literal AST node into its runtime value. 
   * Extracts the actual JavaScript value from simple literals. 
   * 
   * @param {*} node - Literal value or parsed expression node
   * @returns {number} The numeric value or 0 if the input is empty/unsupported
  */
  evalLiteral(node) {
    if (!node) return 0;
    if (typeof node === "number") return node;
    if (node.kind === "num") return node.value;
    return 0;
  }

  /**
   * Creates a new stack frame for a function call. 
   * 
   * The frame starts at nextStackBase. 
   * Local variables are allocated by moving currentAddr downwards. 
   *  
   * @param {string} name - Function name for the new stack frame
   * @returns {void}
  */
  pushFrame(name) {
    const base = this.nextStackBase;
    this.stack.push({ 
      name: name, 
      base: base, 
      vars: new Map(), 
      currentAddr: base, 
    });

    this.nextStackBase -= 0x100;
  }

  /**
   * Removes the current function's stack frame. 
   * 
   * @returns {StackFrame | undefined} The removed stack frame, or undefined if stack was empty
  */
  popFrame() {
    const frame = this.stack.pop();
    if (frame) this.nextStackBase += 0x100;
    return frame;
  }

  /**
   * Returns the stack frame for the currently executing function.
   * Local variables should be declared in this frame. 
   * 
   * @returns {StackFrame | undefined} Current stack frame, or undefined if no function is active
  */
  getCurrentStackFrame() {
    return this.stack[this.stack.length - 1];
  }

  /**
   * Declare a local variable or local array in the current stack frame. 
   * 
   * @param {string} name - Variable name
   * @param {CType} type - Parsed C type object
   * @param {*} value - Initial scalar value, or null/undefined for default value
   * @param {number | null | undefined} arraySize - Number of array elements, if this variable is an array
   * @param {Array<*> | null | undefined} arrayInit - Initial array values, if provided 
   * @returns {number | undefined} Simulated address of the variable, or undefined if no stack frame exists
  */
  declareLocal(name, type, value, arraySize, arrayInit) {
    const frame = this.getCurrentStackFrame();
    if (!frame) {
      return; 
    }

    const size = arraySize ? arraySize * getTypeSize(type) : getTypeSize(type);
    frame.currentAddr -= size + ((4 - (size % 4)) % 4);
    const addr = frame.currentAddr;

    if (arraySize) {
      const values = [];
      for (let i = 0; i < arraySize; i++) {
        values.push(arrayInit ? arrayInit[i] : getDefaultValueForType(type));
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
        value: value !== null && value !== undefined ? value : getDefaultValueForType(type),
        isArray: false,
      });
    }
    return addr;
  }

  /**
   * Updates the value of an existing scalar variable. 
   * 
   * Searching from the newest stack frame to the oldest stack frame, 
   * then checks global variables. 
   *  
   * @param {string} name - Variable name 
   * @param {*} value - New value to store
   * @returns {boolean} True if the variable was found and updated
  */
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

  /**
   * Finds a variable by name.
   * 
   * Searching from the newest stack frame to the oldest stack frame, 
   * then checks global variables. 
   * 
   * @param {string} name - Variable name 
   * @returns {MemoryVariable | null} The variable object, or null if not found
  */
  getVar(name) {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      if (this.stack[i].vars.has(name)) return this.stack[i].vars.get(name);
    }
    if (this.globals.has(name)) return this.globals.get(name);
    return null;
  }

  /**
   * Returns the simulated memory address of a variable. 
   * 
   * @param {string} name - Variable name 
   * @returns {number} Variable address, or 0 if the variable does not exist
  */
  getVarAddr(name) {
    const v = this.getVar(name);
    return v ? v.addr : 0;
  }

  /**
   * Updates one element in an array variable. 
   * 
   * @param {string} name - Array variable name 
   * @param {number} index - Array index to update
   * @param {*} value - New element value
   * @returns {booelan} True if the array element was updated 
  */
  setArrayElem(name, index, value) {
    const v = this.getVar(name);
    if (v && v.isArray && index >= 0 && index < v.size) {
      v.values[index] = value;
      return true;
    }
    return false;
  }

  /**
   * Reads on element from an array variable.
   * 
   * @param {string} name - Array variable name 
   * @param {number} index - Array index to read 
   * @returns {*} Array element value, or 0 if invalid
  */
  getArrayElem(name, index) {
    const v = this.getVar(name);
    if (v && v.isArray && index >= 0 && index < v.size) return v.values[index];
    return 0;
  }

  /**
   * Allocates a new heap block. 
   * 
   * Simulates the behaviour of malloc().
   * 
   * @param {number} size - Requested allocation size in bytes
   * @param {CType | undefined} requestedType - Optional type for this heap block
   * @returns {number} Starting address of the allocated heap block
  */
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

  /**
   * Marks a heap block as freed. 
   * 
   * @param {number} addr - Starting address of the heap block to free 
   * @returns {boolean} True if the block existed and was not already freed
  */
  freeHeap(addr) {
    if (this.heap.has(addr) && !this.heap.get(addr).freed) {
      this.heap.get(addr).freed = true;
      return true;
    }
    return false;
  }

  /**
   * Writes a value to a heap address. 
   * 
   * @param {number} addr - Heap address to write to
   * @param {*} value - Value to store 
   * @returns {boolean} True if the address was inside a live heap block
  */
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

  /**
   * Reads a value from a heap address.
   *
   * @param {number} addr - Heap address to read from
   * @returns {*} Stored heap value, or 0 if the address is invalid
  */
  getHeapValue(addr) {
    for (const [base, block] of this.heap) {
      if (addr >= base && addr < base + block.size) {
        const idx = Math.floor((addr - base) / 4);
        return idx < block.elemCount ? block.values[idx] : 0;
      }
    }
    return 0;
  }

  /**
   * Resolves a raw memory address to the simulated memory object it belongs to. 
   * 
   * Checks heap blocks first, then stack variables, then global variables.
   * Used for pointer dereferencing logic. 
   * 
   * @param {number} addr - Simulated memory address
   * @returns {ResolvedAddress | null} Description of the resolved address, or null if invalid
  */
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
          const elemSize = getTypeSize(v.elemType || v.type);
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
        const elemSize = getTypeSize(v.elemType || v.type);
        const idx = Math.floor((addr - v.addr) / elemSize);
        if (addr >= v.addr && idx >= 0 && idx < v.size)
          return { kind: "global_array", name, variable: v, index: idx };
      }
    }
    return null;
  }

  /**
   * Reads the value stored at a simulated memory address.
   * 
   * @param {number} addr - Address to read from 
   * @returns {*} Value at that address, or 0 if the address cannot be resolved
  */
  deref(addr) {
    const resolved = this.resolveAddress(addr);
    if (!resolved) return 0;
    if (resolved.kind === "heap") return resolved.block.values[resolved.index];
    if (resolved.kind.endsWith("_array"))
      return resolved.variable.values[resolved.index];
    return resolved.variable.value;
  }

  /**
   * Writes a value to a simulated memory address.
   * 
   * @param {number} addr - Address to read from 
   * @param {*} value - Value to store 
   * @returns {boolean} True if the write succeeded
  */
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
