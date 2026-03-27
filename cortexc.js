// =============================================================================
//  CortexC — C Memory Visualizer
//  Tokenizer → Parser → Interpreter (step-by-step) → Visualizer
// =============================================================================

// ========================== TOKENIZER ========================================

const TT = Object.freeze({
    KEYWORD: "KW", IDENT: "ID", NUMBER: "NUM", STRING: "STR",
    CHAR_LIT: "CHR", OP: "OP", PUNC: "PN", EOF: "EOF"
});

const KEYWORDS = new Set([
    "int", "char", "float", "double", "void", "long", "short", "unsigned",
    "return", "if", "else", "while", "for",
    "sizeof", "malloc", "free", "printf", "NULL", "const", "static"
]);

function tokenize(src) {
    const tokens = [];
    let i = 0, line = 1, col = 1;

    function advance() {
        if (src[i] === "\n") { line++; col = 1; } else { col++; }
        i++;
    }

    function skipWS() {
        while (i < src.length) {
            if (/\s/.test(src[i])) { advance(); }
            else if (src[i] === "/" && src[i + 1] === "/") {
                while (i < src.length && src[i] !== "\n") advance();
            } else if (src[i] === "/" && src[i + 1] === "*") {
                advance(); advance();
                while (i < src.length - 1 && !(src[i] === "*" && src[i + 1] === "/")) advance();
                if (i < src.length) advance();
                if (i < src.length) advance();
            } else break;
        }
    }

    function pushTok(type, value) { tokens.push({ type, value, line, col }); }

    while (i < src.length) {
        skipWS();
        if (i >= src.length) break;
        const sl = line, sc = col, ch = src[i];

        if (ch === '"') {
            advance();
            let s = "";
            while (i < src.length && src[i] !== '"') {
                if (src[i] === "\\") { advance(); s += ({ n: "\n", t: "\t", "\\": "\\", '"': '"' })[src[i]] || src[i]; }
                else s += src[i];
                advance();
            }
            if (i < src.length) advance();
            pushTok(TT.STRING, s);
        } else if (ch === "'") {
            advance();
            let v = src[i];
            if (v === "\\") { advance(); v = ({ n: "\n", t: "\t", "0": "\0" })[src[i]] || src[i]; }
            advance();
            if (i < src.length && src[i] === "'") advance();
            pushTok(TT.CHAR_LIT, v.charCodeAt(0));
        } else if (/[a-zA-Z_]/.test(ch)) {
            let w = "";
            while (i < src.length && /[a-zA-Z0-9_]/.test(src[i])) { w += src[i]; advance(); }
            pushTok(KEYWORDS.has(w) ? TT.KEYWORD : TT.IDENT, w);
        } else if (/[0-9]/.test(ch)) {
            let n = "";
            while (i < src.length && /[0-9.xXa-fA-F]/.test(src[i])) { n += src[i]; advance(); }
            pushTok(TT.NUMBER, Number(n));
        } else if ("+-*/%=!<>&|^~".includes(ch)) {
            let op = ch; advance();
            if (i < src.length && ["==", "!=", "<=", ">=", "&&", "||", "++", "--", "+=", "-=", "*=", "/=", "->"].includes(op + src[i])) {
                op += src[i]; advance();
            }
            pushTok(TT.OP, op);
        } else if ("(){}[];,.".includes(ch)) {
            pushTok(TT.PUNC, ch); advance();
        } else {
            advance();
        }
    }
    pushTok(TT.EOF, "");
    return tokens;
}

// ========================== PARSER ===========================================

class Parser {
    constructor(tokens) {
        this.tokens = tokens;
        this.pos = 0;
    }

    peek(offset = 0) { return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)]; }
    at() { return this.peek(); }
    eat(type, value) {
        const t = this.at();
        if (type && t.type !== type) this.err(`Expected ${type} but got ${t.type} (${t.value})`);
        if (value !== undefined && t.value !== value) this.err(`Expected '${value}' but got '${t.value}'`);
        this.pos++;
        return t;
    }
    err(msg) { const t = this.at(); throw new Error(`Parse error at line ${t.line}: ${msg}`); }
    match(type, value) { const t = this.at(); return t.type === type && (value === undefined || t.value === value); }
    matchAny(type, values) { return values.some(v => this.match(type, v)); }

    parse() {
        const program = { globals: [], functions: {} };
        while (!this.match(TT.EOF)) {
            const decl = this.parseTopLevel();
            if (decl.kind === "func") program.functions[decl.name] = decl;
            else program.globals.push(decl);
        }
        return program;
    }

    isTypeStart() {
        return this.matchAny(TT.KEYWORD, ["int", "char", "float", "double", "void", "long", "short", "unsigned", "const", "static"]);
    }

    parseType() {
        let base = "";
        while (this.matchAny(TT.KEYWORD, ["const", "static", "unsigned", "long", "short"])) {
            base += this.eat().value + " ";
        }
        base += this.eat(TT.KEYWORD).value;
        let pointer = 0;
        while (this.match(TT.OP, "*")) { this.eat(); pointer++; }
        return { base: base.trim(), pointer };
    }

    parseTopLevel() {
        const startLine = this.at().line;
        const type = this.parseType();
        const name = this.eat(TT.IDENT).value;

        if (this.match(TT.PUNC, "(")) {
            return this.parseFuncDef(type, name, startLine);
        }

        let value = null;
        let arraySize = null;
        let arrayInit = null;

        if (this.match(TT.PUNC, "[")) {
            this.eat();
            if (this.match(TT.NUMBER)) arraySize = this.eat().value;
            this.eat(TT.PUNC, "]");
            if (this.match(TT.OP, "=")) {
                this.eat();
                arrayInit = this.parseArrayInit();
            }
            if (!arraySize && arrayInit) arraySize = arrayInit.length;
            this.eat(TT.PUNC, ";");
            return { kind: "global_decl", type, name, arraySize, arrayInit, line: startLine };
        }

        if (this.match(TT.OP, "=")) {
            this.eat();
            value = this.parseExpr();
        }
        this.eat(TT.PUNC, ";");
        return { kind: "global_decl", type, name, value, line: startLine };
    }

    parseFuncDef(type, name, startLine) {
        this.eat(TT.PUNC, "(");
        const params = [];
        while (!this.match(TT.PUNC, ")")) {
            if (params.length > 0) this.eat(TT.PUNC, ",");
            const ptype = this.parseType();
            const pname = this.eat(TT.IDENT).value;
            params.push({ type: ptype, name: pname });
        }
        this.eat(TT.PUNC, ")");
        const body = this.parseBlock();
        return { kind: "func", returnType: type, name, params, body, line: startLine };
    }

    parseBlock() {
        this.eat(TT.PUNC, "{");
        const stmts = [];
        while (!this.match(TT.PUNC, "}")) {
            stmts.push(this.parseStmt());
        }
        this.eat(TT.PUNC, "}");
        return stmts;
    }

    parseStmt() {
        const startLine = this.at().line;

        if (this.match(TT.KEYWORD, "return")) {
            this.eat();
            let value = null;
            if (!this.match(TT.PUNC, ";")) value = this.parseExpr();
            this.eat(TT.PUNC, ";");
            return { kind: "return", value, line: startLine };
        }

        if (this.match(TT.KEYWORD, "printf")) {
            return this.parsePrintf(startLine);
        }

        if (this.match(TT.KEYWORD, "free")) {
            this.eat();
            this.eat(TT.PUNC, "(");
            const arg = this.parseExpr();
            this.eat(TT.PUNC, ")");
            this.eat(TT.PUNC, ";");
            return { kind: "free", arg, line: startLine };
        }

        if (this.isTypeStart()) {
            return this.parseLocalDecl(startLine);
        }

        if (this.match(TT.OP, "*")) {
            this.eat();
            const target = this.eat(TT.IDENT).value;
            this.eat(TT.OP, "=");
            const value = this.parseExpr();
            this.eat(TT.PUNC, ";");
            return { kind: "deref_assign", target, value, line: startLine };
        }

        if (this.match(TT.IDENT)) {
            const name = this.eat(TT.IDENT).value;

            if (this.match(TT.PUNC, "[")) {
                this.eat();
                const index = this.parseExpr();
                this.eat(TT.PUNC, "]");
                this.eat(TT.OP, "=");
                const value = this.parseExpr();
                this.eat(TT.PUNC, ";");
                return { kind: "array_assign", name, index, value, line: startLine };
            }

            if (this.match(TT.OP, "=")) {
                this.eat();
                const value = this.parseExpr();
                this.eat(TT.PUNC, ";");
                return { kind: "assign", name, value, line: startLine };
            }

            if (this.match(TT.OP, "+=") || this.match(TT.OP, "-=") || this.match(TT.OP, "*=") || this.match(TT.OP, "/=")) {
                const op = this.eat().value;
                const value = this.parseExpr();
                this.eat(TT.PUNC, ";");
                return { kind: "compound_assign", name, op, value, line: startLine };
            }

            if (this.match(TT.OP, "++") || this.match(TT.OP, "--")) {
                const op = this.eat().value;
                this.eat(TT.PUNC, ";");
                return { kind: "unary_stmt", name, op, line: startLine };
            }

            if (this.match(TT.PUNC, "(")) {
                this.pos--;
                const expr = this.parseExpr();
                this.eat(TT.PUNC, ";");
                return { kind: "expr_stmt", expr, line: startLine };
            }

            this.err(`Unexpected token after identifier '${name}'`);
        }

        this.err(`Unexpected token: ${this.at().value}`);
    }

    parseLocalDecl(startLine) {
        const type = this.parseType();
        const name = this.eat(TT.IDENT).value;

        if (this.match(TT.PUNC, "[")) {
            this.eat();
            let arraySize = null;
            if (this.match(TT.NUMBER)) arraySize = this.eat().value;
            this.eat(TT.PUNC, "]");
            let arrayInit = null;
            if (this.match(TT.OP, "=")) {
                this.eat();
                arrayInit = this.parseArrayInit();
            }
            if (!arraySize && arrayInit) arraySize = arrayInit.length;
            this.eat(TT.PUNC, ";");
            return { kind: "local_decl", type, name, arraySize, arrayInit, isArray: true, line: startLine };
        }

        let value = null;
        if (this.match(TT.OP, "=")) {
            this.eat();
            value = this.parseExpr();
        }
        this.eat(TT.PUNC, ";");
        return { kind: "local_decl", type, name, value, isArray: false, line: startLine };
    }

    parseArrayInit() {
        this.eat(TT.PUNC, "{");
        const elems = [];
        while (!this.match(TT.PUNC, "}")) {
            if (elems.length > 0) this.eat(TT.PUNC, ",");
            elems.push(this.parseExpr());
        }
        this.eat(TT.PUNC, "}");
        return elems;
    }

    parsePrintf(startLine) {
        this.eat();
        this.eat(TT.PUNC, "(");
        const fmt = this.eat(TT.STRING).value;
        const args = [];
        while (this.match(TT.PUNC, ",")) {
            this.eat();
            args.push(this.parseExpr());
        }
        this.eat(TT.PUNC, ")");
        this.eat(TT.PUNC, ";");
        return { kind: "printf", fmt, args, line: startLine };
    }

    // ---- Expression parsing (precedence climbing) ----

    parseExpr() { return this.parseOr(); }

    parseOr() {
        let left = this.parseAnd();
        while (this.match(TT.OP, "||")) { this.eat(); left = { kind: "binop", op: "||", left, right: this.parseAnd() }; }
        return left;
    }
    parseAnd() {
        let left = this.parseEquality();
        while (this.match(TT.OP, "&&")) { this.eat(); left = { kind: "binop", op: "&&", left, right: this.parseEquality() }; }
        return left;
    }
    parseEquality() {
        let left = this.parseComparison();
        while (this.matchAny(TT.OP, ["==", "!="])) { const op = this.eat().value; left = { kind: "binop", op, left, right: this.parseComparison() }; }
        return left;
    }
    parseComparison() {
        let left = this.parseAddSub();
        while (this.matchAny(TT.OP, ["<", ">", "<=", ">="])) { const op = this.eat().value; left = { kind: "binop", op, left, right: this.parseAddSub() }; }
        return left;
    }
    parseAddSub() {
        let left = this.parseMulDiv();
        while (this.matchAny(TT.OP, ["+", "-"])) { const op = this.eat().value; left = { kind: "binop", op, left, right: this.parseMulDiv() }; }
        return left;
    }
    parseMulDiv() {
        let left = this.parseUnary();
        while (this.matchAny(TT.OP, ["*", "/", "%"])) { const op = this.eat().value; left = { kind: "binop", op, left, right: this.parseUnary() }; }
        return left;
    }

    parseUnary() {
        if (this.match(TT.OP, "&")) {
            this.eat();
            const name = this.eat(TT.IDENT).value;
            return { kind: "addr_of", name };
        }
        if (this.match(TT.OP, "*")) {
            this.eat();
            const expr = this.parsePrimary();
            return { kind: "deref", expr };
        }
        if (this.match(TT.OP, "-")) {
            this.eat();
            const expr = this.parsePrimary();
            return { kind: "negate", expr };
        }
        if (this.match(TT.OP, "!")) {
            this.eat();
            const expr = this.parsePrimary();
            return { kind: "not", expr };
        }
        return this.parsePrimary();
    }

    parsePrimary() {
        if (this.match(TT.NUMBER)) return { kind: "num", value: this.eat().value };
        if (this.match(TT.CHAR_LIT)) return { kind: "num", value: this.eat().value };
        if (this.match(TT.STRING)) return { kind: "str", value: this.eat().value };
        if (this.match(TT.KEYWORD, "NULL")) { this.eat(); return { kind: "num", value: 0 }; }

        if (this.match(TT.KEYWORD, "sizeof")) {
            this.eat();
            this.eat(TT.PUNC, "(");
            const type = this.parseType();
            this.eat(TT.PUNC, ")");
            return { kind: "sizeof", type };
        }

        if (this.match(TT.PUNC, "(")) {
            this.eat();
            if (this.isTypeStart()) {
                const castType = this.parseType();
                this.eat(TT.PUNC, ")");
                const expr = this.parseUnary();
                return { kind: "cast", castType, expr };
            }
            const expr = this.parseExpr();
            this.eat(TT.PUNC, ")");
            return expr;
        }

        if (this.match(TT.KEYWORD, "malloc")) {
            this.eat();
            this.eat(TT.PUNC, "(");
            const size = this.parseExpr();
            this.eat(TT.PUNC, ")");
            return { kind: "malloc", size };
        }

        if (this.match(TT.IDENT)) {
            const name = this.eat().value;
            if (this.match(TT.PUNC, "(")) {
                this.eat();
                const args = [];
                while (!this.match(TT.PUNC, ")")) {
                    if (args.length > 0) this.eat(TT.PUNC, ",");
                    args.push(this.parseExpr());
                }
                this.eat(TT.PUNC, ")");
                return { kind: "call", name, args };
            }
            if (this.match(TT.PUNC, "[")) {
                this.eat();
                const index = this.parseExpr();
                this.eat(TT.PUNC, "]");
                return { kind: "array_access", name, index };
            }
            return { kind: "var", name };
        }

        this.err(`Unexpected token in expression: ${this.at().type} '${this.at().value}'`);
    }
}

// ========================== MEMORY MODEL =====================================

const TYPE_SIZES = { int: 4, char: 1, float: 4, double: 8, void: 0, long: 8, short: 2 };

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
        this.nextStackBase = 0x7FF0;
    }

    reset() {
        this.stack = [];
        this.heap.clear();
        this.globals.clear();
        this.nextHeapAddr = 0x4000;
        this.nextGlobalAddr = 0x1000;
        this.nextStackBase = 0x7FF0;
    }

    declareGlobal(name, type, value, arraySize, arrayInit) {
        const size = arraySize ? arraySize * sizeOf(type) : sizeOf(type);
        const addr = this.nextGlobalAddr;
        this.nextGlobalAddr += size + (4 - size % 4) % 4;

        if (arraySize) {
            const values = [];
            for (let i = 0; i < arraySize; i++) {
                values.push(arrayInit ? this.evalLiteral(arrayInit[i]) : defaultVal(type));
            }
            this.globals.set(name, { type, addr, isArray: true, size: arraySize, values, elemType: type });
        } else {
            this.globals.set(name, { type, addr, value: value !== null ? value : defaultVal(type), isArray: false });
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

    topFrame() { return this.stack[this.stack.length - 1]; }

    declareLocal(name, type, value, arraySize, arrayInit) {
        const frame = this.topFrame();
        if (!frame) return;
        const size = arraySize ? arraySize * sizeOf(type) : sizeOf(type);
        frame.currentAddr -= size + (4 - size % 4) % 4;
        const addr = frame.currentAddr;

        if (arraySize) {
            const values = [];
            for (let i = 0; i < arraySize; i++) {
                values.push(arrayInit ? arrayInit[i] : defaultVal(type));
            }
            frame.vars.set(name, { type, addr, isArray: true, size: arraySize, values, elemType: type });
        } else {
            frame.vars.set(name, { type, addr, value: value !== null && value !== undefined ? value : defaultVal(type), isArray: false });
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
            freed: false
        });
        this.nextHeapAddr += size + (8 - size % 8) % 8 + 8;
        return addr;
    }

    freeHeap(addr) {
        if (this.heap.has(addr)) {
            this.heap.get(addr).freed = true;
            return true;
        }
        return false;
    }

    setHeapValue(addr, value) {
        for (const [base, block] of this.heap) {
            if (!block.freed && addr >= base && addr < base + block.size) {
                const idx = Math.floor((addr - base) / 4);
                if (idx < block.elemCount) block.values[idx] = value;
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

    deref(addr) {
        const hv = this.getHeapValue(addr);
        if (hv !== 0 || this.heap.size > 0) {
            for (const [base, block] of this.heap) {
                if (addr >= base && addr < base + block.size) return block.values[Math.floor((addr - base) / 4)];
            }
        }
        for (const frame of this.stack) {
            for (const [, v] of frame.vars) {
                if (!v.isArray && v.addr === addr) return v.value;
                if (v.isArray) {
                    const elemSize = sizeOf(v.elemType || v.type);
                    const idx = Math.floor((addr - v.addr) / elemSize);
                    if (addr >= v.addr && idx < v.size) return v.values[idx];
                }
            }
        }
        for (const [, v] of this.globals) {
            if (!v.isArray && v.addr === addr) return v.value;
        }
        return 0;
    }

    setDeref(addr, value) {
        if (this.setHeapValue(addr, value)) return true;
        for (const frame of this.stack) {
            for (const [, v] of frame.vars) {
                if (!v.isArray && v.addr === addr) { v.value = value; return true; }
            }
        }
        for (const [, v] of this.globals) {
            if (!v.isArray && v.addr === addr) { v.value = value; return true; }
        }
        return false;
    }
}

// ========================== INTERPRETER ======================================

class CallPending {
    constructor() { this.name = "CallPending"; }
}

class Interpreter {
    constructor(memory, onOutput, onError) {
        this.mem = memory;
        this.program = null;
        this.callStack = [];
        this.finished = false;
        this.stepCount = 0;
        this.currentLine = -1;
        this.onOutput = onOutput || (() => {});
        this.onError = onError || (() => {});
        this.callResults = [];
        this.callIndex = 0;
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
            this.mem.declareGlobal(g.name, g.type, val, g.arraySize,
                g.arrayInit ? g.arrayInit.map(e => this.evalExpr(e)) : null);
        }
    }

    start() {
        if (!this.program.functions["main"]) {
            this.onError("Error: no main() function found");
            this.finished = true;
            return;
        }
        this.callFunction("main", []);
    }

    callFunction(name, argValues) {
        const func = this.program.functions[name];
        if (!func) { this.onError(`Error: undefined function '${name}'`); return; }

        this.mem.pushFrame(name);
        for (let i = 0; i < func.params.length; i++) {
            const val = i < argValues.length ? argValues[i] : 0;
            this.mem.declareLocal(func.params[i].name, func.params[i].type, val);
        }
        this.callStack.push({
            func, pc: 0,
            savedCallResults: this.callResults,
            savedCallIndex: this.callIndex
        });
        this.callResults = [];
        this.callIndex = 0;
    }

    step() {
        if (this.finished) return false;
        if (this.callStack.length === 0) { this.finished = true; return false; }

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
            this.onError(e.message);
            this.finished = true;
            return false;
        }

        if (this.callStack.length >= depthBefore) {
            this.callResults = [];
        }

        if (this.callStack.length > 0) {
            const top = this.callStack[this.callStack.length - 1];
            if (top.pc >= top.func.body.length && top.func.name === "main") {
                this.doReturn(0);
            }
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
                    const initVals = stmt.arrayInit ? stmt.arrayInit.map(e => this.evalExpr(e)) : null;
                    this.mem.declareLocal(stmt.name, stmt.type, null, stmt.arraySize, initVals);
                } else {
                    const val = stmt.value !== null ? this.evalExpr(stmt.value) : null;
                    this.mem.declareLocal(stmt.name, stmt.type, val);
                }
                break;
            }
            case "assign": {
                const val = this.evalExpr(stmt.value);
                this.mem.setLocal(stmt.name, val);
                break;
            }
            case "compound_assign": {
                const v = this.mem.getVar(stmt.name);
                if (!v) break;
                const rhs = this.evalExpr(stmt.value);
                const ops = { "+=": (a, b) => a + b, "-=": (a, b) => a - b, "*=": (a, b) => a * b, "/=": (a, b) => Math.trunc(a / b) };
                this.mem.setLocal(stmt.name, ops[stmt.op](v.value, rhs));
                break;
            }
            case "unary_stmt": {
                const v = this.mem.getVar(stmt.name);
                if (!v) break;
                this.mem.setLocal(stmt.name, stmt.op === "++" ? v.value + 1 : v.value - 1);
                break;
            }
            case "deref_assign": {
                const ptr = this.mem.getVar(stmt.target);
                if (!ptr) break;
                const val = this.evalExpr(stmt.value);
                this.mem.setDeref(ptr.value, val);
                break;
            }
            case "array_assign": {
                const idx = this.evalExpr(stmt.index);
                const val = this.evalExpr(stmt.value);
                this.mem.setArrayElem(stmt.name, idx, val);
                break;
            }
            case "printf": {
                const vals = stmt.args.map(a => this.evalExpr(a));
                let out = stmt.fmt;
                let vi = 0;
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
                if (!this.mem.freeHeap(addr)) {
                    this.onError(`Warning: free() on invalid address 0x${addr.toString(16)}`);
                }
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
            case "num": return node.value;
            case "str": return node.value;
            case "var": {
                const v = this.mem.getVar(node.name);
                if (!v) { this.onError(`Warning: undefined variable '${node.name}'`); return 0; }
                if (v.isArray) return v.addr;
                return v.value;
            }
            case "binop": {
                const l = this.evalExpr(node.left), r = this.evalExpr(node.right);
                const ops = {
                    "+": (a, b) => a + b, "-": (a, b) => a - b, "*": (a, b) => a * b,
                    "/": (a, b) => b !== 0 ? Math.trunc(a / b) : 0, "%": (a, b) => b !== 0 ? a % b : 0,
                    "==": (a, b) => a === b ? 1 : 0, "!=": (a, b) => a !== b ? 1 : 0,
                    "<": (a, b) => a < b ? 1 : 0, ">": (a, b) => a > b ? 1 : 0,
                    "<=": (a, b) => a <= b ? 1 : 0, ">=": (a, b) => a >= b ? 1 : 0,
                    "&&": (a, b) => (a && b) ? 1 : 0, "||": (a, b) => (a || b) ? 1 : 0,
                };
                return (ops[node.op] || (() => 0))(l, r);
            }
            case "negate": return -this.evalExpr(node.expr);
            case "not": return this.evalExpr(node.expr) ? 0 : 1;
            case "addr_of": return this.mem.getVarAddr(node.name);
            case "deref": {
                const addr = this.evalExpr(node.expr);
                return this.mem.deref(addr);
            }
            case "sizeof": return sizeOf(node.type);
            case "cast": return this.evalExpr(node.expr);
            case "malloc": {
                const size = this.evalExpr(node.size);
                return this.mem.allocHeap(size);
            }
            case "call": {
                if (this.callIndex < this.callResults.length) {
                    return this.callResults[this.callIndex++];
                }
                const func = this.program.functions[node.name];
                if (!func) { this.onError(`Error: undefined function '${node.name}'`); return 0; }
                const args = node.args.map(a => this.evalExpr(a));
                this.callFunction(node.name, args);
                throw new CallPending();
            }
            case "array_access": {
                const idx = this.evalExpr(node.index);
                return this.mem.getArrayElem(node.name, idx);
            }
            default: return 0;
        }
    }
}

// ========================== VISUALIZER =======================================

class Visualizer {
    constructor() {
        this.stackEl = document.getElementById("stackViz");
        this.heapEl = document.getElementById("heapViz");
        this.globalEl = document.getElementById("globalViz");
        this.prevState = null;
    }

    hex(n) { return "0x" + (n >>> 0).toString(16).toUpperCase().padStart(4, "0"); }

    formatVal(v, type) {
        if (v === null || v === undefined) return "???";
        if (type && type.pointer > 0) {
            if (v === 0) return "NULL";
            return this.hex(v);
        }
        return String(v);
    }

    isPointer(type) { return type && type.pointer > 0; }

    render(mem) {
        this.renderStack(mem);
        this.renderHeap(mem);
        this.renderGlobals(mem);
        this.prevState = this.snapshot(mem);
    }

    snapshot(mem) {
        const s = { stack: [], heap: [], globals: [] };
        for (const frame of mem.stack) {
            const vars = {};
            for (const [k, v] of frame.vars) vars[k] = JSON.stringify(v);
            s.stack.push({ name: frame.name, vars });
        }
        for (const [addr, block] of mem.heap) {
            s.heap.push({ addr, freed: block.freed, vals: [...block.values] });
        }
        for (const [k, v] of mem.globals) {
            s.globals.push({ name: k, val: JSON.stringify(v) });
        }
        return s;
    }

    isNewVar(frameName, varName) {
        if (!this.prevState) return true;
        const pf = this.prevState.stack.find(f => f.name === frameName);
        return !pf || !pf.vars[varName];
    }

    frameColorClass(frame, index, total) {
        if (frame.name === "main") return "main";
        const funcIdx = index > 0 ? index - 1 : 0;
        return `func-${funcIdx % 4}`;
    }

    renderStack(mem) {
        if (mem.stack.length === 0) {
            this.stackEl.innerHTML = '<div class="empty-state">Run code to see stack</div>';
            return;
        }

        let html = "";
        const topIdx = mem.stack.length - 1;

        for (let i = mem.stack.length - 1; i >= 0; i--) {
            const frame = mem.stack[i];
            const colorKey = this.frameColorClass(frame, i, mem.stack.length);
            const isActive = (i === topIdx);
            const activeClass = isActive ? "active-frame" : "";

            if (i < topIdx) {
                const caller = mem.stack[i + 1];
                html += `<div class="stack-call-connector"><span class="call-label">called by ${frame.name}()</span></div>`;
            }

            html += `<div class="stack-frame-wrapper wrapper-${colorKey}">`;
            html += `<div class="stack-depth-line"></div>`;
            html += `<div class="stack-frame frame-${colorKey} ${activeClass}">`;

            const badge = isActive ? "running" : (i === 0 ? "entry" : "paused");
            html += `<div class="frame-header">`;
            html += `<span class="frame-label"><span>${frame.name}()</span><span class="frame-badge">${badge}</span></span>`;
            html += `<span class="addr">${this.hex(frame.base)}</span>`;
            html += `</div>`;
            html += `<div class="frame-vars">`;

            if (frame.vars.size === 0) {
                html += `<div class="mem-cell"><span class="mem-name" style="color:var(--text-muted);font-style:italic">no vars</span></div>`;
            }

            for (const [name, v] of frame.vars) {
                const isNew = this.isNewVar(frame.name, name);
                if (v.isArray) {
                    html += `<div class="mem-cell ${isNew ? "new-cell" : ""}">`;
                    html += `<span class="mem-name">${v.type.base} ${name}[${v.size}]</span>`;
                    html += `<span></span>`;
                    html += `<span class="mem-addr">${this.hex(v.addr)}</span>`;
                    html += `</div>`;
                    html += `<div class="array-cells">`;
                    for (let j = 0; j < v.size; j++) {
                        html += `<div class="array-cell"><span class="array-index">[${j}]</span><span class="array-val">${v.values[j]}</span></div>`;
                    }
                    html += `</div>`;
                } else {
                    const ptrClass = this.isPointer(v.type) ? "pointer-val" : "";
                    const nullClass = this.isPointer(v.type) && v.value === 0 ? "null-val" : "";
                    const typeStr = v.type.base + (v.type.pointer > 0 ? "*".repeat(v.type.pointer) : "");
                    html += `<div class="mem-cell ${isNew ? "new-cell" : ""}" data-addr="${v.addr}">`;
                    html += `<span class="mem-name"><span class="mem-type">${typeStr}</span> ${name}</span>`;
                    html += `<span class="mem-value ${ptrClass} ${nullClass}">${this.formatVal(v.value, v.type)}</span>`;
                    html += `<span class="mem-addr">${this.hex(v.addr)}</span>`;
                    html += `</div>`;
                }
            }
            html += `</div></div></div>`;
        }
        this.stackEl.innerHTML = html;
    }

    renderHeap(mem) {
        if (mem.heap.size === 0) {
            this.heapEl.innerHTML = '<div class="empty-state">No heap allocations</div>';
            return;
        }

        let html = "";
        for (const [addr, block] of mem.heap) {
            const freedClass = block.freed ? "freed" : "";
            html += `<div class="heap-block ${freedClass}" data-base="${addr}">`;
            html += `<div class="heap-block-header">`;
            html += `<span>${this.hex(addr)}</span>`;
            html += `<span class="size-info">${block.size} bytes${block.freed ? " (freed)" : ""}</span>`;
            html += `</div>`;
            html += `<div class="heap-block-body">`;
            if (block.elemCount <= 8) {
                html += `<div class="array-cells">`;
                for (let j = 0; j < block.elemCount; j++) {
                    const cellAddr = addr + j * 4;
                    html += `<div class="array-cell"><span class="array-index">${this.hex(cellAddr)}</span>`;
                    html += `<span class="array-val ${block.freed ? "freed" : ""}">${block.values[j]}</span></div>`;
                }
                html += `</div>`;
            } else {
                html += `<div class="mem-cell"><span class="mem-name">${block.elemCount} cells</span>`;
                html += `<span class="mem-value">[${block.values.slice(0, 4).join(", ")}...]</span></div>`;
            }
            html += `</div></div>`;
        }
        this.heapEl.innerHTML = html;
    }

    renderGlobals(mem) {
        if (mem.globals.size === 0) {
            this.globalEl.innerHTML = '<div class="empty-state">No global variables</div>';
            return;
        }

        let html = "";
        for (const [name, v] of mem.globals) {
            if (v.isArray) {
                html += `<div class="global-cell">`;
                html += `<span class="mem-name">${v.type.base} ${name}[${v.size}]</span>`;
                html += `<span></span>`;
                html += `<span class="mem-addr">${this.hex(v.addr)}</span>`;
                html += `</div>`;
                html += `<div class="array-cells">`;
                for (let j = 0; j < v.size; j++) {
                    html += `<div class="array-cell"><span class="array-index">[${j}]</span><span class="array-val">${v.values[j]}</span></div>`;
                }
                html += `</div>`;
            } else {
                const typeStr = v.type.base + (v.type.pointer > 0 ? "*".repeat(v.type.pointer) : "");
                const ptrClass = this.isPointer(v.type) ? "pointer-val" : "";
                html += `<div class="global-cell">`;
                html += `<span class="mem-name"><span class="mem-type">${typeStr}</span> ${name}</span>`;
                html += `<span class="mem-value ${ptrClass}">${this.formatVal(v.value, v.type)}</span>`;
                html += `<span class="mem-addr">${this.hex(v.addr)}</span>`;
                html += `</div>`;
            }
        }
        this.globalEl.innerHTML = html;
    }

    clear() {
        this.stackEl.innerHTML = '<div class="empty-state">Run code to see stack</div>';
        this.heapEl.innerHTML = '<div class="empty-state">No heap allocations</div>';
        this.globalEl.innerHTML = '<div class="empty-state">No global variables</div>';
        this.prevState = null;
    }
}

// ========================== UI CONTROLLER ====================================

const codeInput = document.getElementById("codeInput");
const lineNumbers = document.getElementById("lineNumbers");
const consoleOutput = document.getElementById("consoleOutput");
const runBtn = document.getElementById("runBtn");
const stepBtn = document.getElementById("stepBtn");
const resetBtn = document.getElementById("resetBtn");
const speedSelect = document.getElementById("speedSelect");
const stepCounter = document.getElementById("stepCounter");

const mem = new MemoryModel();
const viz = new Visualizer();
let interp = null;
let running = false;
let runTimer = null;
let highlightEl = null;

function updateLineNumbers() {
    const lines = codeInput.value.split("\n");
    lineNumbers.innerHTML = lines.map((_, i) =>
        `<div>${i + 1}</div>`
    ).join("");
}

function highlightLine(lineNum) {
    if (highlightEl) highlightEl.remove();
    if (lineNum < 1) return;

    const lineHeight = parseFloat(getComputedStyle(codeInput).lineHeight);
    const paddingTop = parseFloat(getComputedStyle(codeInput).paddingTop);
    const top = paddingTop + (lineNum - 1) * lineHeight - codeInput.scrollTop;

    highlightEl = document.createElement("div");
    highlightEl.className = "line-highlight";
    highlightEl.style.top = top + "px";
    highlightEl.style.height = lineHeight + "px";
    codeInput.parentElement.appendChild(highlightEl);

    const nums = lineNumbers.children;
    for (let i = 0; i < nums.length; i++) {
        nums[i].className = (i + 1 === lineNum) ? "active-line" : "";
    }
}

function appendConsole(text, type = "") {
    const span = document.createElement("span");
    if (type) span.className = type;
    span.textContent = text;
    consoleOutput.appendChild(span);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

function initInterpreter() {
    const code = codeInput.value;
    consoleOutput.textContent = "";

    try {
        const tokens = tokenize(code);
        const parser = new Parser(tokens);
        const program = parser.parse();

        interp = new Interpreter(
            mem,
            (msg) => appendConsole(msg),
            (msg) => appendConsole(msg + "\n", "console-error")
        );
        interp.load(program);
        interp.start();
        viz.render(mem);
        highlightLine(interp.currentLine);
        stepCounter.textContent = "Step 0";
        return true;
    } catch (e) {
        appendConsole(e.message + "\n", "console-error");
        return false;
    }
}

function doStep() {
    if (!interp || interp.finished) return false;
    const cont = interp.step();
    viz.render(mem);
    highlightLine(interp.currentLine);
    stepCounter.textContent = `Step ${interp.stepCount}`;

    if (interp.finished) {
        appendConsole("\n--- Program finished ---\n", "console-info");
        runBtn.textContent = "\u25B6 Run";
        runBtn.classList.remove("running");
        running = false;
        highlightLine(-1);
    }
    return cont;
}

function doRun() {
    if (running) {
        clearInterval(runTimer);
        running = false;
        runBtn.textContent = "\u25B6 Run";
        runBtn.classList.remove("running");
        return;
    }

    if (!interp || interp.finished) {
        if (!initInterpreter()) return;
    }

    running = true;
    runBtn.textContent = "\u23F8 Pause";
    runBtn.classList.add("running");

    runTimer = setInterval(() => {
        if (!doStep()) {
            clearInterval(runTimer);
            running = false;
            runBtn.textContent = "\u25B6 Run";
            runBtn.classList.remove("running");
        }
    }, parseInt(speedSelect.value));
}

function doReset() {
    clearInterval(runTimer);
    running = false;
    interp = null;
    mem.reset();
    viz.clear();
    highlightLine(-1);
    consoleOutput.textContent = "";
    runBtn.textContent = "\u25B6 Run";
    runBtn.classList.remove("running");
    stepCounter.textContent = "Step 0";
    updateLineNumbers();
}

runBtn.addEventListener("click", doRun);

stepBtn.addEventListener("click", () => {
    if (!interp || interp.finished) {
        if (!initInterpreter()) return;
    }
    doStep();
});

resetBtn.addEventListener("click", doReset);

codeInput.addEventListener("input", () => {
    updateLineNumbers();
    if (interp) doReset();
});

codeInput.addEventListener("scroll", () => {
    lineNumbers.scrollTop = codeInput.scrollTop;
    if (interp && interp.currentLine > 0) highlightLine(interp.currentLine);
});

codeInput.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
        e.preventDefault();
        const start = codeInput.selectionStart;
        const end = codeInput.selectionEnd;
        codeInput.value = codeInput.value.substring(0, start) + "    " + codeInput.value.substring(end);
        codeInput.selectionStart = codeInput.selectionEnd = start + 4;
        updateLineNumbers();
    }
});

updateLineNumbers();
