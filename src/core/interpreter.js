/**
 * Parsed program produced by the parser.
 *
 * @typedef {Object} Program
 * @property {Array<GlobalDeclNode>} globals - Global variable declarations
 * @property {Object<string, FunctionNode>} functions - Function declarations keyed by function name
 */

/**
 * Parsed function parameter.
 *
 * @typedef {Object} ParamNode
 * @property {string} name - Parameter name
 * @property {CType} type - Parameter C type
 */

/**
 * Parsed global variable declaration.
 *
 * @typedef {Object} GlobalDeclNode
 * @property {string} name - Global variable name
 * @property {CType} type - Global variable C type
 * @property {?ExprNode} value - Initial value expression, if this is a scalar global
 * @property {?number} arraySize - Number of array elements, if this is an array global
 * @property {?Array<ExprNode>} arrayInit - Array initializer expressions, if provided
 */

/**
 * Runtime call-stack entry used by the interpreter.
 *
 * @typedef {Object} CallFrame
 * @property {FunctionNode} func - Function currently executing
 * @property {number} pc - Program counter/index of the next statement to execute
 * @property {Array<*>} savedCallResults - Caller expression function-call results
 * @property {number} savedCallIndex - Caller expression function-call result index
 */

/**
 * Generic parsed statement node.
 *
 * Statement nodes are produced by the parser. The exact properties depend on
 * the statement kind.
 *
 * Supported statement kinds include:
 * - `local_decl`
 * - `assign`
 * - `compound_assign`
 * - `unary_stmt`
 * - `deref_assign`
 * - `array_assign`
 * - `printf`
 * - `free`
 * - `return`
 * - `expr_stmt`
 *
 * @typedef {Object} StmtNode
 * @property {string} kind - Statement kind
 * @property {?number} line - Source-code line where this statement appears
 * @property {string} [name] - Variable or array name used by this statement
 * @property {CType} [type] - Declared C type for declaration statements
 * @property {?ExprNode} [value] - Value expression used by declarations, assignments, and returns
 * @property {boolean} [isArray] - Whether a local declaration declares an array
 * @property {?number} [arraySize] - Number of elements for array declarations
 * @property {?Array<ExprNode>} [arrayInit] - Array initializer expressions
 * @property {string} [op] - Operator used by compound or unary statements
 * @property {string} [target] - Pointer variable name used by dereference assignments
 * @property {ExprNode} [index] - Array index expression
 * @property {string} [fmt] - `printf` format string
 * @property {Array<ExprNode>} [args] - `printf` argument expressions
 * @property {ExprNode} [arg] - Single argument expression, such as the argument to `free`
 * @property {ExprNode} [expr] - Expression used by expression statements
 */

/**
 * Generic parsed expression node.
 *
 * Expression nodes are produced by the parser. The exact properties depend on
 * the expression kind.
 *
 * Supported expression kinds include:
 * - `num`
 * - `str`
 * - `var`
 * - `binop`
 * - `negate`
 * - `not`
 * - `addr_of`
 * - `deref`
 * - `sizeof`
 * - `cast`
 * - `malloc`
 * - `call`
 * - `array_access`
 *
 * @typedef {Object} ExprNode
 * @property {string} kind - Expression kind
 * @property {*} [value] - Literal value for number or string expressions
 * @property {string} [name] - Variable, function, or array name
 * @property {string} [op] - Operator for binary expressions
 * @property {ExprNode} [left] - Left operand for binary expressions
 * @property {ExprNode} [right] - Right operand for binary expressions
 * @property {ExprNode} [expr] - Inner expression for unary, cast, or dereference expressions
 * @property {CType} [type] - Type used by `sizeof` or cast expressions
 * @property {ExprNode} [size] - Size expression used by `malloc`
 * @property {Array<ExprNode>} [args] - Function-call argument expressions
 * @property {ExprNode} [index] - Array index expression
 */

/**
 * Simulated memory model used by the interpreter.
 *
 * This typedef documents the methods the interpreter expects from `MemoryModel`.
 * The actual implementation lives in the memory model file.
 *
 * @typedef {Object} MemoryModel
 * @property {() => void} reset - Resets stack, heap, globals, and memory state
 * @property {(name: string) => void} pushFrame - Pushes a new function stack frame
 * @property {() => void} popFrame - Pops the current function stack frame
 * @property {(name: string, type: CType, value?: *, arraySize?: ?number, arrayInit?: ?Array<*>) => number} declareGlobal - Declares a global variable
 * @property {(name: string, type: CType, value?: *, arraySize?: ?number, arrayInit?: ?Array<*>) => number} declareLocal - Declares a local variable
 * @property {(name: string, value: *) => boolean} setLocal - Updates a variable by name
 * @property {(name: string) => ?Object} getVar - Finds a variable by name
 * @property {(addr: number) => ?Object} resolveAddress - Resolves a simulated address to a memory target
 * @property {(addr: number) => *} deref - Reads the value at a simulated address
 * @property {(addr: number, value: *) => boolean} setDeref - Writes a value through a simulated address
 * @property {(size: number) => number} allocHeap - Allocates a heap block and returns its address
 * @property {(addr: number) => boolean} freeHeap - Frees a heap block by address
 * @property {(name: string, index: number, value: *) => boolean} setArrayElem - Updates an array element
 */

/**
 * Special control-flow signal used when a function call starts during
 * expression evaluation.
 *
 * The interpreter is step-based. When `evalExpr()` reaches a function call,
 * it pushes the called function onto the call stack, then throws `CallPending`
 * to pause the current statement until the called function returns.
 */
class CallPending {
  /**
   * Creates a function-call pause signal.
   */
  constructor() {
    this.name = "CallPending";
  }
}

/**
 * Represents a runtime crash/error inside the simulated C program.
 *
 * Errors include:
 * - undefined variables
 * - invalid pointer dereferences
 * - division by zero
 * - use after free
 * - array index out of bounds
 *
 * @extends Error
 */
class RuntimeCrash extends Error {
  /**
   * Creates a runtime crash error.
   *
   * @param {string} message - Human-readable crash message
   * @param {?number} [line=null] - Source-code line where the crash happened, if known
   */
  constructor(message, line = null) {
    super(message);
    this.name = "RuntimeCrash";
    this.line = line;
  }
}

/**
 * Executes a parsed C-like program one statement at a time.
 *
 * The interpreter coordinates:
 * - memory operations through `MemoryModel`
 * - function calls and returns
 * - statement execution
 * - expression evaluation
 * - runtime crash handling
 * - printf-style output
 */
class Interpreter {
  /**
   * Creates a new interpreter instance.
   *
   * @param {MemoryModel} memory - Simulated memory model used for stack, heap, and globals
   * @param {(output: string) => void} [onOutput] - Callback fired when `printf` produces output
   * @param {(message: string) => void} [onError] - Callback for non-crashing interpreter errors
   * @param {(message: string, line: ?number) => void} [onCrash] - Callback fired when execution crashes
   */
  constructor(memory, onOutput, onError, onCrash) {
    this.mem = memory;
    /** @type {?Program} */
    this.program = null;
    /** @type {Array<CallFrame>} */
    this.callStack = [];
    this.finished = false;
    this.stepCount = 0;
    this.currentLine = -1;
    this.onOutput = onOutput || (() => {});
    this.onError = onError || (() => {});
    this.onCrash = onCrash || (() => {});
    this.callResults = [];
    this.callIndex = 0;
  }

  /**
   * Throws a runtime crash with an optional source line.
   *
   * If no line is provided, the interpreter uses the current executing line
   * when possible.
   *
   * @param {string} message - Human-readable crash message
   * @param {?number} [line] - Source-code line where the crash happened
   * @throws {RuntimeCrash}
   */
  crash(message, line = this.currentLine > 0 ? this.currentLine : null) {
    throw new RuntimeCrash(message, line);
  }

  /**
   * Loads a parsed program into the interpreter and resets runtime state.
   *
   * This clears previous execution state, resets simulated memory, clears old
   * call-stack data, and declares all global variables before execution starts.
   *
   * @param {Program} program - Parsed program AST containing globals and functions
   */
  load(program) {
    this.program = program;
    this.mem.reset();
    this.callStack = [];
    this.finished = false;
    this.stepCount = 0;
    this.currentLine = -1;
    this.callResults = [];
    this.callIndex = 0;

    for (const g of program.globals) {
      const val = g.value ? this.evalExpr(g.value) : null;
      this.mem.declareGlobal(
        g.name,
        g.type,
        val,
        g.arraySize,
        g.arrayInit ? g.arrayInit.map((e) => this.evalExpr(e)) : null,
      );
    }
  }

  /**
   * Starts execution by calling the program's `main()` function.
   *
   * @throws {RuntimeCrash} If the program does not contain a `main` function
   */
  start() {
    if (!this.program.functions["main"]) this.crash("No main() function found.");
    this.callFunction("main", []);
  }

  /**
   * Calls a function and creates a new stack frame for it.
   *
   * Each function parameter is declared as a local variable in the new frame.
   * If an argument is missing, its parameter value defaults to `0`.
   *
   * The current function-call result state is saved so it can be restored after
   * the called function returns.
   *
   * @param {string} name - Name of the function to call
   * @param {Array<*>} argValues - Evaluated argument values passed to the function
   * @throws {RuntimeCrash} If the function is not defined
   */
  callFunction(name, argValues) {
    const func = this.program.functions[name];
    if (!func) this.crash(`Undefined function '${name}'.`);
    this.mem.pushFrame(name);
    for (let i = 0; i < func.params.length; i++) {
      const val = i < argValues.length ? argValues[i] : 0;
      this.mem.declareLocal(func.params[i].name, func.params[i].type, val);
    }
    this.callStack.push({
      func,
      pc: 0,
      savedCallResults: this.callResults,
      savedCallIndex: this.callIndex,
    });
    this.callResults = [];
    this.callIndex = 0;
  }

  /**
   * Executes one interpreter step.
   *
   * A step usually executes one statement from the current function body.
   * If the current function reaches the end of its body, it returns `0`.
   *
   * Function calls inside expressions pause the current statement by throwing
   * `CallPending`, allowing the called function to run first.
   *
   * @returns {boolean} `true` if execution can continue, `false` if execution finished or crashed
   */
  step() {
    if (this.finished) return false;
    if (this.callStack.length === 0) {
      this.finished = true;
      return false;
    }

    const ctx = this.callStack[this.callStack.length - 1];
    if (ctx.pc >= ctx.func.body.length) {
      this.doReturn(0);
      return !this.finished;
    }

    const stmt = ctx.func.body[ctx.pc];
    this.currentLine = stmt.line;
    this.stepCount++;
    this.callIndex = 0;
    const depthBefore = this.callStack.length;

    try {
      ctx.pc++;
      this.execStmt(stmt);
    } catch (e) {
      if (e instanceof CallPending) {
        ctx.pc--;
        return true;
      }
      const message = e instanceof Error ? e.message : String(e);
      const line = e instanceof RuntimeCrash ? e.line : this.currentLine;
      this.currentLine = line ?? this.currentLine;
      this.onCrash(message, line ?? null);
      this.finished = true;
      return false;
    }

    if (this.callStack.length >= depthBefore) this.callResults = [];

    if (this.callStack.length > 0) {
      const top = this.callStack[this.callStack.length - 1];
      if (top.pc >= top.func.body.length && top.func.name === "main") this.doReturn(0);
    }

    return !this.finished;
  }

  /**
   * Returns from the current function.
   *
   * This pops the current memory frame, removes the current call-stack entry,
   * and sends the return value back to the caller.
   *
   * If there is no caller, program execution is marked as finished.
   *
   * @param {*} value - Runtime return value from the current function
   */
  doReturn(value) {
    this.mem.popFrame();
    const entry = this.callStack.pop();
    if (this.callStack.length === 0) {
      this.finished = true;
      this.currentLine = -1;
    } else {
      this.callResults = entry.savedCallResults;
      this.callResults.push(value);
      this.callIndex = 0;
    }
  }

  /**
   * Executes one statement AST node.
   *
   * This method handles local declarations, assignments, pointer writes,
   * array writes, `printf`, `free`, returns, and expression statements.
   *
   * @param {StmtNode} stmt - Statement AST node to execute
   * @throws {RuntimeCrash} If the statement performs an invalid runtime operation
   * @throws {CallPending} If the statement evaluates a function call that pauses execution
   */
  execStmt(stmt) {
    switch (stmt.kind) {
      case "local_decl": {
        if (stmt.isArray) {
          const initVals = stmt.arrayInit ? stmt.arrayInit.map((e) => this.evalExpr(e)) : null;
          this.mem.declareLocal(stmt.name, stmt.type, null, stmt.arraySize, initVals);
        } else {
          const val = stmt.value !== null ? this.evalExpr(stmt.value) : null;
          this.mem.declareLocal(stmt.name, stmt.type, val);
        }
        break;
      }
      case "assign": {
        const val = this.evalExpr(stmt.value);
        if (!this.mem.setLocal(stmt.name, val))
          this.crash(`Undefined variable '${stmt.name}'.`, stmt.line);
        break;
      }
      case "compound_assign": {
        const v = this.mem.getVar(stmt.name);
        if (!v) this.crash(`Undefined variable '${stmt.name}'.`, stmt.line);
        const rhs = this.evalExpr(stmt.value);
        const ops = {
          "+=": (a, b) => a + b,
          "-=": (a, b) => a - b,
          "*=": (a, b) => a * b,
          "/=": (a, b) => Math.trunc(a / b),
        };
        if (stmt.op === "/=" && rhs === 0)
          this.crash(`Division by zero while updating '${stmt.name}'.`, stmt.line);
        this.mem.setLocal(stmt.name, ops[stmt.op](v.value, rhs));
        break;
      }
      case "unary_stmt": {
        const v = this.mem.getVar(stmt.name);
        if (!v) this.crash(`Undefined variable '${stmt.name}'.`, stmt.line);
        this.mem.setLocal(stmt.name, stmt.op === "++" ? v.value + 1 : v.value - 1);
        break;
      }
      case "deref_assign": {
        const ptr = this.mem.getVar(stmt.target);
        if (!ptr) this.crash(`Undefined variable '${stmt.target}'.`, stmt.line);
        if (ptr.value === 0) this.crash(`Null pointer write through '${stmt.target}'.`, stmt.line);
        const target = this.mem.resolveAddress(ptr.value);
        if (!target)
          this.crash(
            `Invalid pointer write at 0x${ptr.value.toString(16).toUpperCase()}.`,
            stmt.line,
          );
        if (target.kind === "heap" && target.block.freed)
          this.crash(`Write after free at 0x${ptr.value.toString(16).toUpperCase()}.`, stmt.line);
        const val = this.evalExpr(stmt.value);
        if (!this.mem.setDeref(ptr.value, val))
          this.crash(
            `Invalid pointer write at 0x${ptr.value.toString(16).toUpperCase()}.`,
            stmt.line,
          );
        break;
      }
      case "array_assign": {
        const arrayVar = this.mem.getVar(stmt.name);
        if (!arrayVar) this.crash(`Undefined array '${stmt.name}'.`, stmt.line);
        if (!arrayVar.isArray) this.crash(`'${stmt.name}' is not an array.`, stmt.line);
        const idx = this.evalExpr(stmt.index);
        if (idx < 0 || idx >= arrayVar.size)
          this.crash(`Array index ${idx} is out of bounds for '${stmt.name}'.`, stmt.line);
        this.mem.setArrayElem(stmt.name, idx, this.evalExpr(stmt.value));
        break;
      }
      case "printf": {
        const vals = stmt.args.map((a) => this.evalExpr(a));
        let out = stmt.fmt,
          vi = 0;
        out = out.replace(/%[difs%]/g, (m) => {
          if (m === "%%") return "%";
          if (vi < vals.length) return String(vals[vi++]);
          return m;
        });
        this.onOutput(out);
        break;
      }
      case "free": {
        const addr = this.evalExpr(stmt.arg);
        if (addr === 0) break;
        if (!this.mem.freeHeap(addr))
          this.crash(`Invalid free() address 0x${addr.toString(16).toUpperCase()}.`, stmt.line);
        break;
      }
      case "return": {
        const val = stmt.value ? this.evalExpr(stmt.value) : 0;
        this.doReturn(val);
        break;
      }
      case "expr_stmt": {
        this.evalExpr(stmt.expr);
        break;
      }
    }
  }

  /**
   * Evaluates an expression AST node and returns its runtime value.
   *
   * This method handles literals, variables, binary operations, unary operations,
   * address-of, pointer dereference, `sizeof`, casts, `malloc`, function calls,
   * and array access.
   *
   * For function calls, this may start a new function call and throw
   * `CallPending` so the step-based interpreter can pause the current statement.
   *
   * @param {?ExprNode} node - Expression AST node to evaluate
   * @returns {*} Runtime value produced by the expression
   * @throws {RuntimeCrash} If the expression performs an invalid runtime operation
   * @throws {CallPending} If evaluating a function call pauses the current statement
   */
  evalExpr(node) {
    if (!node) return 0;
    switch (node.kind) {
      case "num":
        return node.value;
      case "str":
        return node.value;
      case "var": {
        const v = this.mem.getVar(node.name);
        if (!v) this.crash(`Undefined variable '${node.name}'.`);
        if (v.isArray) return v.addr;
        return v.value;
      }
      case "binop": {
        const l = this.evalExpr(node.left),
          r = this.evalExpr(node.right);
        if ((node.op === "/" || node.op === "%") && r === 0) this.crash("Division by zero.");
        const ops = {
          "+": (a, b) => a + b,
          "-": (a, b) => a - b,
          "*": (a, b) => a * b,
          "/": (a, b) => (b !== 0 ? Math.trunc(a / b) : 0),
          "%": (a, b) => (b !== 0 ? a % b : 0),
          "==": (a, b) => (a === b ? 1 : 0),
          "!=": (a, b) => (a !== b ? 1 : 0),
          "<": (a, b) => (a < b ? 1 : 0),
          ">": (a, b) => (a > b ? 1 : 0),
          "<=": (a, b) => (a <= b ? 1 : 0),
          ">=": (a, b) => (a >= b ? 1 : 0),
          "&&": (a, b) => (a && b ? 1 : 0),
          "||": (a, b) => (a || b ? 1 : 0),
        };
        return (ops[node.op] || (() => 0))(l, r);
      }
      case "negate":
        return -this.evalExpr(node.expr);
      case "not":
        return this.evalExpr(node.expr) ? 0 : 1;
      case "addr_of": {
        const v = this.mem.getVar(node.name);
        if (!v) this.crash(`Undefined variable '${node.name}'.`);
        return v.addr;
      }
      case "deref": {
        const addr = this.evalExpr(node.expr);
        if (addr === 0) this.crash("Null pointer dereference.");
        const target = this.mem.resolveAddress(addr);
        if (!target)
          this.crash(`Invalid pointer dereference at 0x${addr.toString(16).toUpperCase()}.`);
        if (target.kind === "heap" && target.block.freed)
          this.crash(`Use after free at 0x${addr.toString(16).toUpperCase()}.`);
        return this.mem.deref(addr);
      }
      case "sizeof":
        return getTypeSize(node.type);
      case "cast":
        return this.evalExpr(node.expr);
      case "malloc": {
        const size = this.evalExpr(node.size);
        return this.mem.allocHeap(size);
      }
      case "call": {
        if (this.callIndex < this.callResults.length) return this.callResults[this.callIndex++];
        const func = this.program.functions[node.name];
        if (!func) this.crash(`Undefined function '${node.name}'.`);
        const args = node.args.map((a) => this.evalExpr(a));
        this.callFunction(node.name, args);
        throw new CallPending();
      }
      case "array_access": {
        const arrayVar = this.mem.getVar(node.name);
        if (!arrayVar) this.crash(`Undefined array '${node.name}'.`);
        if (!arrayVar.isArray) this.crash(`'${node.name}' is not an array.`);
        const idx = this.evalExpr(node.index);
        if (idx < 0 || idx >= arrayVar.size)
          this.crash(`Array index ${idx} is out of bounds for '${node.name}'.`);
        return arrayVar.values[idx];
      }
      default:
        return 0;
    }
  }
}