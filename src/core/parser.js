class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  peek(offset = 0) {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }
  at() {
    return this.peek();
  }
  eat(type, value) {
    const t = this.at();
    if (type && t.type !== type) this.err(`Expected ${type} but got ${t.type} (${t.value})`);
    if (value !== undefined && t.value !== value)
      this.err(`Expected '${value}' but got '${t.value}'`);
    this.pos++;
    return t;
  }
  err(msg) {
    const t = this.at();
    throw new Error(`Parse error at line ${t.line}: ${msg}`);
  }
  match(type, value) {
    const t = this.at();
    return t.type === type && (value === undefined || t.value === value);
  }
  matchAny(type, values) {
    return values.some((v) => this.match(type, v));
  }

  parse() {
    const program = { globals: [], functions: {} };
    while (!this.match(TOKENTYPES.EOF)) {
      const decl = this.parseTopLevel();
      if (decl.kind === "func") program.functions[decl.name] = decl;
      else program.globals.push(decl);
    }
    return program;
  }

  isTypeStart() {
    return this.matchAny(TOKENTYPES.KEYWORD, [
      "int",
      "char",
      "float",
      "double",
      "void",
      "long",
      "short",
      "unsigned",
      "const",
      "static",
    ]);
  }

  parseType() {
    let base = "";
    while (this.matchAny(TOKENTYPES.KEYWORD, ["const", "static", "unsigned", "long", "short"])) {
      base += this.eat().value + " ";
    }
    base += this.eat(TOKENTYPES.KEYWORD).value;
    let pointer = 0;
    while (this.match(TOKENTYPES.OP, "*")) {
      this.eat();
      pointer++;
    }
    return { base: base.trim(), pointer };
  }

  parseTopLevel() {
    const startLine = this.at().line;
    const type = this.parseType();
    const name = this.eat(TOKENTYPES.IDENT).value;

    if (this.match(TOKENTYPES.PUNC, "(")) return this.parseFuncDef(type, name, startLine);

    let value = null,
      arraySize = null,
      arrayInit = null;

    if (this.match(TOKENTYPES.PUNC, "[")) {
      this.eat();
      if (this.match(TOKENTYPES.NUMBER)) arraySize = this.eat().value;
      this.eat(TOKENTYPES.PUNC, "]");
      if (this.match(TOKENTYPES.OP, "=")) {
        this.eat();
        arrayInit = this.parseArrayInit();
      }
      if (!arraySize && arrayInit) arraySize = arrayInit.length;
      this.eat(TOKENTYPES.PUNC, ";");
      return {
        kind: "global_decl",
        type,
        name,
        arraySize,
        arrayInit,
        line: startLine,
      };
    }

    if (this.match(TOKENTYPES.OP, "=")) {
      this.eat();
      value = this.parseExpr();
    }
    this.eat(TOKENTYPES.PUNC, ";");
    return { kind: "global_decl", type, name, value, line: startLine };
  }

  parseFuncDef(type, name, startLine) {
    this.eat(TOKENTYPES.PUNC, "(");
    const params = [];
    while (!this.match(TOKENTYPES.PUNC, ")")) {
      if (params.length > 0) this.eat(TOKENTYPES.PUNC, ",");
      const ptype = this.parseType();
      const pname = this.eat(TOKENTYPES.IDENT).value;
      params.push({ type: ptype, name: pname });
    }
    this.eat(TOKENTYPES.PUNC, ")");
    const body = this.parseBlock();
    return {
      kind: "func",
      returnType: type,
      name,
      params,
      body,
      line: startLine,
    };
  }

  parseBlock() {
    this.eat(TOKENTYPES.PUNC, "{");
    const stmts = [];
    while (!this.match(TOKENTYPES.PUNC, "}")) stmts.push(this.parseStmt());
    this.eat(TOKENTYPES.PUNC, "}");
    return stmts;
  }

  parseStmt() {
    const startLine = this.at().line;

    if (this.match(TOKENTYPES.KEYWORD, "return")) {
      this.eat();
      let value = null;
      if (!this.match(TOKENTYPES.PUNC, ";")) value = this.parseExpr();
      this.eat(TOKENTYPES.PUNC, ";");
      return { kind: "return", value, line: startLine };
    }

    if (this.match(TOKENTYPES.KEYWORD, "printf")) return this.parsePrintf(startLine);

    if (this.match(TOKENTYPES.KEYWORD, "free")) {
      this.eat();
      this.eat(TOKENTYPES.PUNC, "(");
      const arg = this.parseExpr();
      this.eat(TOKENTYPES.PUNC, ")");
      this.eat(TOKENTYPES.PUNC, ";");
      return { kind: "free", arg, line: startLine };
    }

    if (this.isTypeStart()) return this.parseLocalDecl(startLine);

    if (this.match(TOKENTYPES.OP, "*")) {
      this.eat();
      const target = this.eat(TOKENTYPES.IDENT).value;
      this.eat(TOKENTYPES.OP, "=");
      const value = this.parseExpr();
      this.eat(TOKENTYPES.PUNC, ";");
      return { kind: "deref_assign", target, value, line: startLine };
    }

    if (this.match(TOKENTYPES.IDENT)) {
      const name = this.eat(TOKENTYPES.IDENT).value;

      if (this.match(TOKENTYPES.PUNC, "[")) {
        this.eat();
        const index = this.parseExpr();
        this.eat(TOKENTYPES.PUNC, "]");
        this.eat(TOKENTYPES.OP, "=");
        const value = this.parseExpr();
        this.eat(TOKENTYPES.PUNC, ";");
        return { kind: "array_assign", name, index, value, line: startLine };
      }

      if (this.match(TOKENTYPES.OP, "=")) {
        this.eat();
        const value = this.parseExpr();
        this.eat(TOKENTYPES.PUNC, ";");
        return { kind: "assign", name, value, line: startLine };
      }

      if (
        this.match(TOKENTYPES.OP, "+=") ||
        this.match(TOKENTYPES.OP, "-=") ||
        this.match(TOKENTYPES.OP, "*=") ||
        this.match(TOKENTYPES.OP, "/=")
      ) {
        const op = this.eat().value;
        const value = this.parseExpr();
        this.eat(TOKENTYPES.PUNC, ";");
        return { kind: "compound_assign", name, op, value, line: startLine };
      }

      if (this.match(TOKENTYPES.OP, "++") || this.match(TOKENTYPES.OP, "--")) {
        const op = this.eat().value;
        this.eat(TOKENTYPES.PUNC, ";");
        return { kind: "unary_stmt", name, op, line: startLine };
      }

      if (this.match(TOKENTYPES.PUNC, "(")) {
        this.pos--;
        const expr = this.parseExpr();
        this.eat(TOKENTYPES.PUNC, ";");
        return { kind: "expr_stmt", expr, line: startLine };
      }

      this.err(`Unexpected token after identifier '${name}'`);
    }

    this.err(`Unexpected token: ${this.at().value}`);
  }

  parseLocalDecl(startLine) {
    const type = this.parseType();
    const name = this.eat(TOKENTYPES.IDENT).value;

    if (this.match(TOKENTYPES.PUNC, "[")) {
      this.eat();
      let arraySize = null;
      if (this.match(TOKENTYPES.NUMBER)) arraySize = this.eat().value;
      this.eat(TOKENTYPES.PUNC, "]");
      let arrayInit = null;
      if (this.match(TOKENTYPES.OP, "=")) {
        this.eat();
        arrayInit = this.parseArrayInit();
      }
      if (!arraySize && arrayInit) arraySize = arrayInit.length;
      this.eat(TOKENTYPES.PUNC, ";");
      return {
        kind: "local_decl",
        type,
        name,
        arraySize,
        arrayInit,
        isArray: true,
        line: startLine,
      };
    }

    let value = null;
    if (this.match(TOKENTYPES.OP, "=")) {
      this.eat();
      value = this.parseExpr();
    }
    this.eat(TOKENTYPES.PUNC, ";");
    return {
      kind: "local_decl",
      type,
      name,
      value,
      isArray: false,
      line: startLine,
    };
  }

  parseArrayInit() {
    this.eat(TOKENTYPES.PUNC, "{");
    const elems = [];
    while (!this.match(TOKENTYPES.PUNC, "}")) {
      if (elems.length > 0) this.eat(TOKENTYPES.PUNC, ",");
      elems.push(this.parseExpr());
    }
    this.eat(TOKENTYPES.PUNC, "}");
    return elems;
  }

  parsePrintf(startLine) {
    this.eat();
    this.eat(TOKENTYPES.PUNC, "(");
    const fmt = this.eat(TOKENTYPES.STRING).value;
    const args = [];
    while (this.match(TOKENTYPES.PUNC, ",")) {
      this.eat();
      args.push(this.parseExpr());
    }
    this.eat(TOKENTYPES.PUNC, ")");
    this.eat(TOKENTYPES.PUNC, ";");
    return { kind: "printf", fmt, args, line: startLine };
  }

  parseExpr() {
    return this.parseOr();
  }

  parseOr() {
    let left = this.parseAnd();
    while (this.match(TOKENTYPES.OP, "||")) {
      this.eat();
      left = { kind: "binop", op: "||", left, right: this.parseAnd() };
    }
    return left;
  }
  parseAnd() {
    let left = this.parseEquality();
    while (this.match(TOKENTYPES.OP, "&&")) {
      this.eat();
      left = { kind: "binop", op: "&&", left, right: this.parseEquality() };
    }
    return left;
  }
  parseEquality() {
    let left = this.parseComparison();
    while (this.matchAny(TOKENTYPES.OP, ["==", "!="])) {
      const op = this.eat().value;
      left = { kind: "binop", op, left, right: this.parseComparison() };
    }
    return left;
  }
  parseComparison() {
    let left = this.parseAddSub();
    while (this.matchAny(TOKENTYPES.OP, ["<", ">", "<=", ">="])) {
      const op = this.eat().value;
      left = { kind: "binop", op, left, right: this.parseAddSub() };
    }
    return left;
  }
  parseAddSub() {
    let left = this.parseMulDiv();
    while (this.matchAny(TOKENTYPES.OP, ["+", "-"])) {
      const op = this.eat().value;
      left = { kind: "binop", op, left, right: this.parseMulDiv() };
    }
    return left;
  }
  parseMulDiv() {
    let left = this.parseUnary();
    while (this.matchAny(TOKENTYPES.OP, ["*", "/", "%"])) {
      const op = this.eat().value;
      left = { kind: "binop", op, left, right: this.parseUnary() };
    }
    return left;
  }

  parseUnary() {
    if (this.match(TOKENTYPES.OP, "&")) {
      this.eat();
      const name = this.eat(TOKENTYPES.IDENT).value;
      return { kind: "addr_of", name };
    }
    if (this.match(TOKENTYPES.OP, "*")) {
      this.eat();
      const expr = this.parsePrimary();
      return { kind: "deref", expr };
    }
    if (this.match(TOKENTYPES.OP, "-")) {
      this.eat();
      const expr = this.parsePrimary();
      return { kind: "negate", expr };
    }
    if (this.match(TOKENTYPES.OP, "!")) {
      this.eat();
      const expr = this.parsePrimary();
      return { kind: "not", expr };
    }
    return this.parsePrimary();
  }

  parsePrimary() {
    if (this.match(TOKENTYPES.NUMBER)) return { kind: "num", value: this.eat().value };
    if (this.match(TOKENTYPES.CHAR_LIT)) return { kind: "num", value: this.eat().value };
    if (this.match(TOKENTYPES.STRING)) return { kind: "str", value: this.eat().value };
    if (this.match(TOKENTYPES.KEYWORD, "NULL")) {
      this.eat();
      return { kind: "num", value: 0 };
    }

    if (this.match(TOKENTYPES.KEYWORD, "sizeof")) {
      this.eat();
      this.eat(TOKENTYPES.PUNC, "(");
      const type = this.parseType();
      this.eat(TOKENTYPES.PUNC, ")");
      return { kind: "sizeof", type };
    }

    if (this.match(TOKENTYPES.PUNC, "(")) {
      this.eat();
      if (this.isTypeStart()) {
        const castType = this.parseType();
        this.eat(TOKENTYPES.PUNC, ")");
        const expr = this.parseUnary();
        return { kind: "cast", castType, expr };
      }
      const expr = this.parseExpr();
      this.eat(TOKENTYPES.PUNC, ")");
      return expr;
    }

    if (this.match(TOKENTYPES.KEYWORD, "malloc")) {
      this.eat();
      this.eat(TOKENTYPES.PUNC, "(");
      const size = this.parseExpr();
      this.eat(TOKENTYPES.PUNC, ")");
      return { kind: "malloc", size };
    }

    if (this.match(TOKENTYPES.IDENT)) {
      const name = this.eat().value;
      if (this.match(TOKENTYPES.PUNC, "(")) {
        this.eat();
        const args = [];
        while (!this.match(TOKENTYPES.PUNC, ")")) {
          if (args.length > 0) this.eat(TOKENTYPES.PUNC, ",");
          args.push(this.parseExpr());
        }
        this.eat(TOKENTYPES.PUNC, ")");
        return { kind: "call", name, args };
      }
      if (this.match(TOKENTYPES.PUNC, "[")) {
        this.eat();
        const index = this.parseExpr();
        this.eat(TOKENTYPES.PUNC, "]");
        return { kind: "array_access", name, index };
      }
      return { kind: "var", name };
    }

    this.err(`Unexpected token in expression: ${this.at().type} '${this.at().value}'`);
  }
}
