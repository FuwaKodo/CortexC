class CallPending {
  constructor() {
    this.name = "CallPending";
  }
}

class RuntimeCrash extends Error {
  constructor(message, line = null) {
    super(message);
    this.name = "RuntimeCrash";
    this.line = line;
  }
}

class Interpreter {
  constructor(memory, onOutput, onError, onCrash) {
    this.mem = memory;
    this.program = null;
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

  crash(message, line = this.currentLine > 0 ? this.currentLine : null) {
    throw new RuntimeCrash(message, line);
  }

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

  start() {
    if (!this.program.functions["main"])
      this.crash("No main() function found.");
    this.callFunction("main", []);
  }

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
      if (top.pc >= top.func.body.length && top.func.name === "main")
        this.doReturn(0);
    }

    return !this.finished;
  }

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

  execStmt(stmt) {
    switch (stmt.kind) {
      case "local_decl": {
        if (stmt.isArray) {
          const initVals = stmt.arrayInit
            ? stmt.arrayInit.map((e) => this.evalExpr(e))
            : null;
          this.mem.declareLocal(
            stmt.name,
            stmt.type,
            null,
            stmt.arraySize,
            initVals,
          );
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
          this.crash(
            `Division by zero while updating '${stmt.name}'.`,
            stmt.line,
          );
        this.mem.setLocal(stmt.name, ops[stmt.op](v.value, rhs));
        break;
      }
      case "unary_stmt": {
        const v = this.mem.getVar(stmt.name);
        if (!v) this.crash(`Undefined variable '${stmt.name}'.`, stmt.line);
        this.mem.setLocal(
          stmt.name,
          stmt.op === "++" ? v.value + 1 : v.value - 1,
        );
        break;
      }
      case "deref_assign": {
        const ptr = this.mem.getVar(stmt.target);
        if (!ptr) this.crash(`Undefined variable '${stmt.target}'.`, stmt.line);
        if (ptr.value === 0)
          this.crash(`Null pointer write through '${stmt.target}'.`, stmt.line);
        const target = this.mem.resolveAddress(ptr.value);
        if (!target)
          this.crash(
            `Invalid pointer write at 0x${ptr.value.toString(16).toUpperCase()}.`,
            stmt.line,
          );
        if (target.kind === "heap" && target.block.freed)
          this.crash(
            `Write after free at 0x${ptr.value.toString(16).toUpperCase()}.`,
            stmt.line,
          );
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
        if (!arrayVar.isArray)
          this.crash(`'${stmt.name}' is not an array.`, stmt.line);
        const idx = this.evalExpr(stmt.index);
        if (idx < 0 || idx >= arrayVar.size)
          this.crash(
            `Array index ${idx} is out of bounds for '${stmt.name}'.`,
            stmt.line,
          );
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
          this.crash(
            `Invalid free() address 0x${addr.toString(16).toUpperCase()}.`,
            stmt.line,
          );
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
        if ((node.op === "/" || node.op === "%") && r === 0)
          this.crash("Division by zero.");
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
          this.crash(
            `Invalid pointer dereference at 0x${addr.toString(16).toUpperCase()}.`,
          );
        if (target.kind === "heap" && target.block.freed)
          this.crash(`Use after free at 0x${addr.toString(16).toUpperCase()}.`);
        return this.mem.deref(addr);
      }
      case "sizeof":
        return sizeOf(node.type);
      case "cast":
        return this.evalExpr(node.expr);
      case "malloc": {
        const size = this.evalExpr(node.size);
        return this.mem.allocHeap(size);
      }
      case "call": {
        if (this.callIndex < this.callResults.length)
          return this.callResults[this.callIndex++];
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
