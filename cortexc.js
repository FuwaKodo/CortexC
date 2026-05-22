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

    resolveAddress(addr) {
        for (const [base, block] of this.heap) {
            if (addr >= base && addr < base + block.size) {
                const idx = Math.floor((addr - base) / 4);
                if (idx < block.elemCount) {
                    return { kind: "heap", base, block, index: idx };
                }
            }
        }

        for (const frame of this.stack) {
            for (const [name, v] of frame.vars) {
                if (!v.isArray && v.addr === addr) {
                    return { kind: "stack_scalar", frame, name, variable: v };
                }
                if (v.isArray) {
                    const elemSize = sizeOf(v.elemType || v.type);
                    const idx = Math.floor((addr - v.addr) / elemSize);
                    if (addr >= v.addr && idx >= 0 && idx < v.size) {
                        return { kind: "stack_array", frame, name, variable: v, index: idx };
                    }
                }
            }
        }

        for (const [name, v] of this.globals) {
            if (!v.isArray && v.addr === addr) {
                return { kind: "global_scalar", name, variable: v };
            }
            if (v.isArray) {
                const elemSize = sizeOf(v.elemType || v.type);
                const idx = Math.floor((addr - v.addr) / elemSize);
                if (addr >= v.addr && idx >= 0 && idx < v.size) {
                    return { kind: "global_array", name, variable: v, index: idx };
                }
            }
        }

        return null;
    }

    deref(addr) {
        const resolved = this.resolveAddress(addr);
        if (!resolved) return 0;
        if (resolved.kind === "heap") return resolved.block.values[resolved.index];
        if (resolved.kind.endsWith("_array")) return resolved.variable.values[resolved.index];
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

// ========================== INTERPRETER ======================================

class CallPending {
    constructor() { this.name = "CallPending"; }
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
            this.mem.declareGlobal(g.name, g.type, val, g.arraySize,
                g.arrayInit ? g.arrayInit.map(e => this.evalExpr(e)) : null);
        }
    }

    start() {
        if (!this.program.functions["main"]) {
            this.crash("No main() function found.");
        }
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
            const message = e instanceof Error ? e.message : String(e);
            const line = e instanceof RuntimeCrash ? e.line : this.currentLine;
            this.currentLine = line ?? this.currentLine;
            this.onCrash(message, line ?? null);
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
                if (!this.mem.setLocal(stmt.name, val)) {
                    this.crash(`Undefined variable '${stmt.name}'.`, stmt.line);
                }
                break;
            }
            case "compound_assign": {
                const v = this.mem.getVar(stmt.name);
                if (!v) this.crash(`Undefined variable '${stmt.name}'.`, stmt.line);
                const rhs = this.evalExpr(stmt.value);
                const ops = { "+=": (a, b) => a + b, "-=": (a, b) => a - b, "*=": (a, b) => a * b, "/=": (a, b) => Math.trunc(a / b) };
                if ((stmt.op === "/=") && rhs === 0) {
                    this.crash(`Division by zero while updating '${stmt.name}'.`, stmt.line);
                }
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
                if (!target) {
                    this.crash(`Invalid pointer write at 0x${ptr.value.toString(16).toUpperCase()}.`, stmt.line);
                }
                if (target.kind === "heap" && target.block.freed) {
                    this.crash(`Write after free at 0x${ptr.value.toString(16).toUpperCase()}.`, stmt.line);
                }
                const val = this.evalExpr(stmt.value);
                if (!this.mem.setDeref(ptr.value, val)) {
                    this.crash(`Invalid pointer write at 0x${ptr.value.toString(16).toUpperCase()}.`, stmt.line);
                }
                break;
            }
            case "array_assign": {
                const arrayVar = this.mem.getVar(stmt.name);
                if (!arrayVar) this.crash(`Undefined array '${stmt.name}'.`, stmt.line);
                if (!arrayVar.isArray) this.crash(`'${stmt.name}' is not an array.`, stmt.line);
                const idx = this.evalExpr(stmt.index);
                if (idx < 0 || idx >= arrayVar.size) {
                    this.crash(`Array index ${idx} is out of bounds for '${stmt.name}'.`, stmt.line);
                }
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
                if (addr === 0) break;
                if (!this.mem.freeHeap(addr)) {
                    this.crash(`Invalid free() address 0x${addr.toString(16).toUpperCase()}.`, stmt.line);
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
                if (!v) this.crash(`Undefined variable '${node.name}'.`);
                if (v.isArray) return v.addr;
                return v.value;
            }
            case "binop": {
                const l = this.evalExpr(node.left), r = this.evalExpr(node.right);
                if ((node.op === "/" || node.op === "%") && r === 0) {
                    this.crash("Division by zero.");
                }
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
            case "addr_of": {
                const v = this.mem.getVar(node.name);
                if (!v) this.crash(`Undefined variable '${node.name}'.`);
                return v.addr;
            }
            case "deref": {
                const addr = this.evalExpr(node.expr);
                if (addr === 0) this.crash("Null pointer dereference.");
                const target = this.mem.resolveAddress(addr);
                if (!target) {
                    this.crash(`Invalid pointer dereference at 0x${addr.toString(16).toUpperCase()}.`);
                }
                if (target.kind === "heap" && target.block.freed) {
                    this.crash(`Use after free at 0x${addr.toString(16).toUpperCase()}.`);
                }
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
                if (!func) this.crash(`Undefined function '${node.name}'.`);
                const args = node.args.map(a => this.evalExpr(a));
                this.callFunction(node.name, args);
                throw new CallPending();
            }
            case "array_access": {
                const arrayVar = this.mem.getVar(node.name);
                if (!arrayVar) this.crash(`Undefined array '${node.name}'.`);
                if (!arrayVar.isArray) this.crash(`'${node.name}' is not an array.`);
                const idx = this.evalExpr(node.index);
                if (idx < 0 || idx >= arrayVar.size) {
                    this.crash(`Array index ${idx} is out of bounds for '${node.name}'.`);
                }
                return arrayVar.values[idx];
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

    createSvgEl(name, attrs = {}) {
        const el = document.createElementNS("http://www.w3.org/2000/svg", name);
        for (const [key, value] of Object.entries(attrs)) {
            el.setAttribute(key, value);
        }
        return el;
    }

    escapeHtml(value) {
        return String(value)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#39;");
    }

    allocationHue(addr) {
        const hues = [202, 158, 34, 274, 332, 12];
        return hues[Math.abs((addr >>> 2) % hues.length)];
    }

    allocationMeta(addr, freed = false) {
        return { hue: this.allocationHue(addr), freed };
    }

    allocationStyleAttr(allocation) {
        return allocation ? ` style="--alloc-hue:${allocation.hue}"` : "";
    }

    renderMemName(labelHtml) {
        return `<span class="mem-name"><span class="mem-name-label">${labelHtml}</span></span>`;
    }

    renderPointerValue(name, value, type, extraClasses = "", allocation = null) {
        const classes = ["mem-value", "pointer-val", "pointer-source"];
        if (extraClasses) classes.push(extraClasses);
        if (allocation) classes.push("allocation-linked");
        if (allocation && allocation.freed) classes.push("allocation-freed");

        return `<span class="${classes.join(" ")}"${this.allocationStyleAttr(allocation)}><span class="pointer-chip-prefix">ptr</span><span class="pointer-chip-value">${this.formatVal(value, type)}</span></span>`;
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
                    html += `<div class="mem-cell ${isNew ? "new-cell" : ""}" data-base="${v.addr}">`;
                    html += this.renderMemName(`${v.type.base} ${name}[${v.size}]`);
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
                    const allocation = this.isPointer(v.type) && mem.heap.has(v.value)
                        ? this.allocationMeta(v.value, mem.heap.get(v.value).freed)
                        : null;
                    const cellClasses = ["mem-cell"];
                    if (isNew) cellClasses.push("new-cell");
                    if (allocation) cellClasses.push("allocation-linked");
                    if (allocation && allocation.freed) cellClasses.push("allocation-freed");

                    html += `<div class="${cellClasses.join(" ")}" data-addr="${v.addr}"${this.allocationStyleAttr(allocation)}>`;
                    html += this.renderMemName(`<span class="mem-type">${typeStr}</span> ${name}`);
                    if (this.isPointer(v.type)) {
                        html += this.renderPointerValue(name, v.value, v.type, `${ptrClass} ${nullClass}`.trim(), allocation);
                    } else {
                        html += `<span class="mem-value ${ptrClass} ${nullClass}">${this.formatVal(v.value, v.type)}</span>`;
                    }
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
            const allocation = this.allocationMeta(addr, block.freed);
            const blockClasses = ["heap-block", "allocation-linked"];
            if (block.freed) blockClasses.push("freed", "allocation-freed");

            html += `<div class="${blockClasses.join(" ")}" data-base="${addr}"${this.allocationStyleAttr(allocation)}>`;
            html += `<div class="heap-block-header" data-addr="${addr}">`;
            html += `<span class="heap-block-title"><span class="heap-badge">malloc</span><span class="heap-block-address">${this.hex(addr)}</span></span>`;
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
                html += `<div class="global-cell" data-base="${v.addr}">`;
                html += this.renderMemName(`${v.type.base} ${name}[${v.size}]`);
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
                const allocation = this.isPointer(v.type) && mem.heap.has(v.value)
                    ? this.allocationMeta(v.value, mem.heap.get(v.value).freed)
                    : null;
                const cellClasses = ["global-cell"];
                if (allocation) cellClasses.push("allocation-linked");
                if (allocation && allocation.freed) cellClasses.push("allocation-freed");

                html += `<div class="${cellClasses.join(" ")}" data-addr="${v.addr}"${this.allocationStyleAttr(allocation)}>`;
                html += this.renderMemName(`<span class="mem-type">${typeStr}</span> ${name}`);
                if (this.isPointer(v.type)) {
                    html += this.renderPointerValue(name, v.value, v.type, ptrClass, allocation);
                } else {
                    html += `<span class="mem-value ${ptrClass}">${this.formatVal(v.value, v.type)}</span>`;
                }
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
const themeToggleBtn = document.getElementById("themeToggleBtn");
const speedSelect = document.getElementById("speedSelect");
const stepCounter = document.getElementById("stepCounter");
const syntaxBadge = document.getElementById("syntaxBadge");
const syntaxMessage = document.getElementById("syntaxMessage");
const crashOverlay = document.getElementById("crashOverlay");
const crashReason = document.getElementById("crashReason");
const crashLine = document.getElementById("crashLine");
const crashCloseBtn = document.getElementById("crashCloseBtn");
const THEME_STORAGE_KEY = "cortexc-theme";
const INDENT_UNIT = "    ";

const mem = new MemoryModel();
const viz = new Visualizer();
let interp = null;
let running = false;
let runTimer = null;
let highlightEl = null;
let errorHighlightEl = null;
let editorDiagnostic = {
    severity: "ok",
    label: "Syntax OK",
    message: "Ready to edit and run.",
    line: null,
};
let runtimeCrash = null;

function getLineStart(text, index) {
    const safeIndex = Math.max(0, Math.min(index, text.length));
    return text.lastIndexOf("\n", safeIndex - 1) + 1;
}

function getLineEnd(text, index) {
    const safeIndex = Math.max(0, Math.min(index, text.length));
    const nextBreak = text.indexOf("\n", safeIndex);
    return nextBreak === -1 ? text.length : nextBreak;
}

function getLineIndent(line) {
    return (line.match(/^[ \t]*/) || [""])[0];
}

function getCaretLine() {
    return codeInput.value.slice(0, codeInput.selectionStart).split("\n").length;
}

function getActiveEditorLine() {
    if (interp && interp.currentLine > 0) return interp.currentLine;
    return getCaretLine();
}

function setLineOverlay(existingEl, lineNum, className) {
    if (existingEl) existingEl.remove();
    const totalLines = codeInput.value.split("\n").length;
    if (!lineNum || lineNum < 1 || lineNum > totalLines) return null;

    const lineHeight = parseFloat(getComputedStyle(codeInput).lineHeight);
    const paddingTop = parseFloat(getComputedStyle(codeInput).paddingTop);
    const top = paddingTop + (lineNum - 1) * lineHeight - codeInput.scrollTop;

    const el = document.createElement("div");
    el.className = className;
    el.style.top = top + "px";
    el.style.height = lineHeight + "px";
    codeInput.parentElement.appendChild(el);
    return el;
}

function updateLineNumbers(activeLine = getActiveEditorLine(), errorLine = editorDiagnostic.severity === "error" ? editorDiagnostic.line : null) {
    const lines = codeInput.value.split("\n");
    lineNumbers.innerHTML = lines.map((_, i) => {
        const lineNumber = i + 1;
        const classes = [];
        if (lineNumber === activeLine) classes.push("active-line");
        if (lineNumber === errorLine) classes.push("error-line");
        const classAttr = classes.length > 0 ? ` class="${classes.join(" ")}"` : "";
        return `<div${classAttr}>${lineNumber}</div>`;
    }).join("");
}

function updateSyntaxStatus() {
    if (runtimeCrash) {
        syntaxBadge.className = "syntax-badge syntax-error";
        syntaxBadge.textContent = "Runtime Crash";
        syntaxMessage.textContent = runtimeCrash.line
            ? `Line ${runtimeCrash.line}: ${runtimeCrash.reason}`
            : runtimeCrash.reason;
        return;
    }

    syntaxBadge.className = `syntax-badge syntax-${editorDiagnostic.severity}`;
    syntaxBadge.textContent = editorDiagnostic.label;
    syntaxMessage.textContent = editorDiagnostic.message;
}

function showCrashOverlay(reason, line = null) {
    runtimeCrash = { reason, line };
    crashReason.textContent = reason;
    crashLine.textContent = line ? `Line ${line}` : "Execution stopped immediately.";
    crashOverlay.hidden = false;
    updateSyntaxStatus();
    refreshEditorDecorations();
}

function clearCrashOverlay() {
    runtimeCrash = null;
    crashOverlay.hidden = true;
    crashReason.textContent = "Execution stopped because of a runtime error.";
    crashLine.textContent = "";
    updateSyntaxStatus();
}

function dismissCrashOverlay() {
    clearCrashOverlay();
    codeInput.focus();
}

function handleRuntimeCrash(reason, line = null) {
    clearInterval(runTimer);
    running = false;
    if (interp) interp.finished = true;
    runBtn.textContent = "\u25B6 Run";
    runBtn.classList.remove("running");

    appendConsole("\n=== PROGRAM CRASHED ===\n", "console-error");
    appendConsole((line ? `Line ${line}: ` : "") + reason + "\n", "console-error");
    showCrashOverlay(reason, line);
}

function analyzeEditorCode() {
    const code = codeInput.value;
    if (code.trim() === "") {
        return {
            severity: "warning",
            label: "Empty",
            message: "Editor is empty.",
            line: null,
        };
    }

    try {
        const tokens = tokenize(code);
        const parser = new Parser(tokens);
        const program = parser.parse();

        if (!program.functions.main) {
            return {
                severity: "warning",
                label: "Warning",
                message: "Syntax OK. Add a main() function to run the program.",
                line: null,
            };
        }

        return {
            severity: "ok",
            label: "Syntax OK",
            message: "No syntax errors detected.",
            line: null,
        };
    } catch (e) {
        const message = String(e.message || e);
        const lineMatch = message.match(/line\s+(\d+)/i);
        return {
            severity: "error",
            label: "Syntax Error",
            message,
            line: lineMatch ? Number(lineMatch[1]) : null,
        };
    }
}

function validateEditorCode() {
    editorDiagnostic = analyzeEditorCode();
    updateSyntaxStatus();
    return editorDiagnostic;
}

function refreshEditorDecorations() {
    const activeLine = getActiveEditorLine();
    const errorLine = runtimeCrash?.line ?? (editorDiagnostic.severity === "error" ? editorDiagnostic.line : null);

    if (activeLine && errorLine && activeLine === errorLine) {
        if (errorHighlightEl) {
            errorHighlightEl.remove();
            errorHighlightEl = null;
        }
        highlightEl = setLineOverlay(highlightEl, activeLine, "line-highlight line-highlight-error");
    } else {
        errorHighlightEl = setLineOverlay(errorHighlightEl, errorLine, "diagnostic-line-highlight");
        highlightEl = setLineOverlay(highlightEl, activeLine, "line-highlight");
    }

    updateLineNumbers(activeLine, errorLine);
}

function handleEditorContentChange() {
    if (interp) {
        doReset();
        return;
    }

    clearCrashOverlay();
    validateEditorCode();
    refreshEditorDecorations();
}

function commitEditorChange(nextValue, selectionStart, selectionEnd = selectionStart) {
    codeInput.value = nextValue;
    codeInput.selectionStart = selectionStart;
    codeInput.selectionEnd = selectionEnd;
    handleEditorContentChange();
}

function indentSelection() {
    const text = codeInput.value;
    const start = codeInput.selectionStart;
    const end = codeInput.selectionEnd;

    if (start === end) {
        commitEditorChange(
            text.slice(0, start) + INDENT_UNIT + text.slice(end),
            start + INDENT_UNIT.length
        );
        return;
    }

    const firstLineStart = getLineStart(text, start);
    const selectionEndIndex = end > start && text[end - 1] === "\n" ? end - 1 : end;
    const lastLineEnd = getLineEnd(text, selectionEndIndex);
    const block = text.slice(firstLineStart, lastLineEnd);
    const lines = block.split("\n");
    const indentedBlock = lines.map(line => INDENT_UNIT + line).join("\n");
    const nextValue = text.slice(0, firstLineStart) + indentedBlock + text.slice(lastLineEnd);
    const nextStart = start + INDENT_UNIT.length;
    const nextEnd = end + (INDENT_UNIT.length * lines.length);

    commitEditorChange(nextValue, nextStart, nextEnd);
}

function outdentSelection() {
    const text = codeInput.value;
    const start = codeInput.selectionStart;
    const end = codeInput.selectionEnd;
    const firstLineStart = getLineStart(text, start);
    const selectionEndIndex = end > start && text[end - 1] === "\n" ? end - 1 : end;
    const lastLineEnd = getLineEnd(text, selectionEndIndex);
    const block = text.slice(firstLineStart, lastLineEnd);
    const lines = block.split("\n");

    let removedFromFirstLine = 0;
    let removedTotal = 0;

    const outdentedBlock = lines.map((line, index) => {
        let removed = 0;

        if (line.startsWith(INDENT_UNIT)) {
            removed = INDENT_UNIT.length;
            line = line.slice(INDENT_UNIT.length);
        } else {
            const partialIndent = line.match(/^[ \t]{1,4}/);
            if (partialIndent) {
                removed = partialIndent[0].length;
                line = line.slice(removed);
            }
        }

        if (index === 0) removedFromFirstLine = removed;
        removedTotal += removed;
        return line;
    }).join("\n");

    if (removedTotal === 0) return;

    const nextValue = text.slice(0, firstLineStart) + outdentedBlock + text.slice(lastLineEnd);
    if (start === end) {
        const nextCaret = Math.max(firstLineStart, start - removedFromFirstLine);
        commitEditorChange(nextValue, nextCaret);
        return;
    }

    const nextStart = Math.max(firstLineStart, start - removedFromFirstLine);
    const nextEnd = Math.max(nextStart, end - removedTotal);
    commitEditorChange(nextValue, nextStart, nextEnd);
}

function insertIndentedNewline() {
    const text = codeInput.value;
    const start = codeInput.selectionStart;
    const end = codeInput.selectionEnd;
    const lineStart = getLineStart(text, start);
    const lineEnd = getLineEnd(text, end);
    const lineText = text.slice(lineStart, lineEnd);
    const beforeCaret = text.slice(lineStart, start);
    const afterCaret = text.slice(end, lineEnd);
    const baseIndent = getLineIndent(lineText);
    const trimmedBefore = beforeCaret.trimEnd();
    const trimmedAfter = afterCaret.trimStart();
    const shouldIncreaseIndent = /{$/.test(trimmedBefore);
    const shouldFormatBraceBlock = shouldIncreaseIndent && trimmedAfter.startsWith("}");

    if (shouldFormatBraceBlock) {
        const insertion = `\n${baseIndent}${INDENT_UNIT}\n${baseIndent}`;
        const caretPos = start + 1 + baseIndent.length + INDENT_UNIT.length;
        commitEditorChange(
            text.slice(0, start) + insertion + text.slice(end),
            caretPos
        );
        return;
    }

    const nextIndent = shouldIncreaseIndent ? baseIndent + INDENT_UNIT : baseIndent;
    const insertion = `\n${nextIndent}`;
    const caretPos = start + insertion.length;
    commitEditorChange(
        text.slice(0, start) + insertion + text.slice(end),
        caretPos
    );
}

function insertClosingBraceWithOutdent() {
    const text = codeInput.value;
    const start = codeInput.selectionStart;
    const end = codeInput.selectionEnd;
    if (start !== end) return false;

    const lineStart = getLineStart(text, start);
    const beforeCaret = text.slice(lineStart, start);
    if (!/^\s+$/.test(beforeCaret)) return false;

    const nextIndent = beforeCaret.length >= INDENT_UNIT.length
        ? beforeCaret.slice(0, beforeCaret.length - INDENT_UNIT.length)
        : "";
    const nextValue = text.slice(0, lineStart) + nextIndent + "}" + text.slice(end);
    const nextCaret = lineStart + nextIndent.length + 1;
    commitEditorChange(nextValue, nextCaret);
    return true;
}

function applyTheme(theme) {
    const normalizedTheme = theme === "light" ? "light" : "dark";
    document.body.dataset.theme = normalizedTheme;
    themeToggleBtn.textContent = normalizedTheme === "light" ? "Dark Mode" : "White Mode";
    themeToggleBtn.setAttribute("aria-pressed", normalizedTheme === "light" ? "true" : "false");
    updateSyntaxStatus();
    refreshEditorDecorations();
}

function loadThemePreference() {
    try {
        return localStorage.getItem(THEME_STORAGE_KEY) || "dark";
    } catch {
        return "dark";
    }
}

function toggleTheme() {
    const nextTheme = document.body.dataset.theme === "light" ? "dark" : "light";
    applyTheme(nextTheme);

    try {
        localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
        // Ignore storage failures; the toggle still works for the current session.
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
    clearCrashOverlay();

    try {
        const tokens = tokenize(code);
        const parser = new Parser(tokens);
        const program = parser.parse();

        interp = new Interpreter(
            mem,
            (msg) => appendConsole(msg),
            (msg) => appendConsole(msg + "\n", "console-error"),
            (reason, line) => handleRuntimeCrash(reason, line)
        );
        interp.load(program);
        interp.start();
        if (runtimeCrash) return false;
        viz.render(mem);
        stepCounter.textContent = "Step 0";
        refreshEditorDecorations();
        return true;
    } catch (e) {
        if (e instanceof RuntimeCrash) {
            handleRuntimeCrash(e.message, e.line ?? null);
            return false;
        }
        appendConsole(e.message + "\n", "console-error");
        validateEditorCode();
        refreshEditorDecorations();
        return false;
    }
}

function doStep() {
    if (!interp || interp.finished) return false;
    const cont = interp.step();
    viz.render(mem);
    stepCounter.textContent = `Step ${interp.stepCount}`;

    if (interp.finished) {
        appendConsole("\n--- Program finished ---\n", "console-info");
        runBtn.textContent = "\u25B6 Run";
        runBtn.classList.remove("running");
        running = false;
    }
    refreshEditorDecorations();
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
    clearCrashOverlay();
    consoleOutput.textContent = "";
    runBtn.textContent = "\u25B6 Run";
    runBtn.classList.remove("running");
    stepCounter.textContent = "Step 0";
    validateEditorCode();
    updateSyntaxStatus();
    refreshEditorDecorations();
}

runBtn.addEventListener("click", doRun);

stepBtn.addEventListener("click", () => {
    if (!interp || interp.finished) {
        if (!initInterpreter()) return;
    }
    doStep();
});

resetBtn.addEventListener("click", doReset);
crashCloseBtn.addEventListener("click", dismissCrashOverlay);
themeToggleBtn.addEventListener("click", toggleTheme);

codeInput.addEventListener("input", () => {
    handleEditorContentChange();
});

codeInput.addEventListener("scroll", () => {
    lineNumbers.scrollTop = codeInput.scrollTop;
    refreshEditorDecorations();
});

codeInput.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
        e.preventDefault();
        if (e.shiftKey) outdentSelection();
        else indentSelection();
        return;
    }

    if (e.key === "Enter") {
        e.preventDefault();
        insertIndentedNewline();
        return;
    }

    if (e.key === "}" && insertClosingBraceWithOutdent()) {
        e.preventDefault();
    }
});

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !crashOverlay.hidden) {
        e.preventDefault();
        dismissCrashOverlay();
    }
});

["click", "focus", "mouseup", "keyup", "select"].forEach((eventName) => {
    codeInput.addEventListener(eventName, refreshEditorDecorations);
});

applyTheme(loadThemePreference());
validateEditorCode();
refreshEditorDecorations();
