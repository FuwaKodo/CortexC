/**
 * Represents the full parsed program.
 *
 * @typedef {Object} ProgramNode
 * @property {GlobalDeclarationNode[]} globals - Global variable declarations
 * @property {Object<string, FunctionNode>} functions - Function definitions indexed by function name
 */

/**
 * Represents one function parameter.
 *
 * @typedef {Object} ParameterNode
 * @property {CType} type - Parameter type
 * @property {string} name - Parameter name
 */

/**
 * Represents a parsed function definition.
 *
 * @typedef {Object} FunctionNode
 * @property {"func"} kind - Node kind
 * @property {CType} returnType - Function return type
 * @property {string} name - Function name
 * @property {ParameterNode[]} params - Function parameters
 * @property {StatementNode[]} body - Function body statements
 * @property {number} line - Source line where the function starts
 */

/**
 * Represents a parsed global variable declaration.
 *
 * @typedef {Object} GlobalDeclarationNode
 * @property {"global_decl"} kind - Node kind
 * @property {CType} type - Variable type
 * @property {string} name - Variable name
 * @property {ExpressionNode | null} [value] - Initial scalar value expression
 * @property {number | null} [arraySize] - Array size, if this is an array
 * @property {ExpressionNode[] | null} [arrayInit] - Array initializer expressions
 * @property {number} line - Source line where the declaration starts
 */

/**
 * Represents a parsed statement inside a function body.
 *
 * Statement kinds:
 * - "local_decl": local variable or local array declaration
 * - "return": return statement
 * - "printf": printf statement
 * - "free": free(ptr) statement
 * - "deref_assign": pointer dereference assignment, such as *ptr = 42;
 * - "deref_compound_assign": pointer dereference compound assignment, such as *ptr += 1; 
 * - "array_assign": array element assignment, such as arr[2] = 99;
 * - "assign": scalar variable assignment, such as x = 5;
 * - "compound_assign": compound assignment, such as x += 1;
 * - "unary_stmt": unary update statement, such as x++ or x--;
 * - "expr_stmt": expression used as a statement, usually a function call.
 * - "if": conditional statement with an optional else branch
 *
 * @typedef {Object} StatementNode
 * @property {
 *  "local_decl" | 
 *  "return" | 
 *  "printf" | 
 *  "free" | 
 *  "deref_assign" | 
 *  "deref_compound_assign" | 
 *  "array_assign" | 
 *  "assign" | 
 *  "compound_assign" | 
 *  "unary_stmt" | 
 *  "expr_stmt | 
 *  if"
 * } kind - Statement kind
 * @property {number} line - Source line where the statement starts
 * @property {ExpressionNode} [condition] - Condition used by an if statement
 * @property {StatementNode[]} [thenBranch] - Statements executed when the condition is true
 * @property {StatementNode[] | null} [elseBranch] - Statements executed when the condition is false
 */

/**
 * Represents a parsed expression.
 *
 * Expression kinds:
 * - "num": numeric value, including number literals, char literals, and NULL
 * - "str": string literal
 * - "var": variable reference
 * - "binop": binary operation, such as a + b or a == b
 * - "addr_of": address-of expression, such as &x
 * - "deref": pointer dereference expression, such as *ptr
 * - "negate": numeric negation, such as -x
 * - "not": logical not, such as !x
 * - "sizeof": sizeof(type)
 * - "cast": type cast, such as (int*)ptr
 * - "malloc": malloc(size)
 * - "call": function call, such as add(x, y)
 * - "array_access": array access, such as arr[2]
 *
 * Note: expression nodes currently do not store source line/column positions.
 * Runtime errors usually use the containing statement's line instead.
 *
 * @typedef {Object} ExpressionNode
 * @property {"num" | "str" | "var" | "binop" | "addr_of" | "deref" | "negate" | "not" | "sizeof" | "cast" | "malloc" | "call" | "array_access"} kind - Expression kind
 */

class Parser {
  /**
   * Creates a parser for a list of tokens.
   *
   * @param {Token[]} tokens - Tokens produced by tokenizer
   */
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  /**
   * Looks ahead at a token without consuming it.
   *
   * The offset depends on the current parser position,
   * offset 0 means the current token, offset 1 means next token.
   *
   * @param {number} offset - Number of tokens ahead to inspect
   *
   * @returns {Token} Token at the requested position
   */
  peek(offset = 0) {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }

  /**
   * Returns the current token without consuming it.
   *
   * Wrapper around peek(0)
   *
   * @returns {Token} Current token
   */
  at() {
    return this.peek();
  }

  /**
   * Consumes and returns the current token.
   *
   * If an expected type or value is provided, this validates the current token
   * before consuming it. If token does not match, a parse error is thrown.
   *
   * @param {string} [type] - Expected token type (TOKENTYPES)
   * @param {*} [value] - Expected token value
   *
   * @returns {Token} Consumed token
   */
  eat(type, value) {
    const currentToken = this.at();
    if (type && currentToken.type !== type)
      this.err(`Expected ${type} but got ${currentToken.type} (${currentToken.value})`);
    if (value !== undefined && currentToken.value !== value)
      this.err(`Expected '${value}' but got '${currentToken.value}'`);
    this.pos++;
    return currentToken;
  }

  /**
   * Throws a parser error at the current token's source line
   *
   * @param {string} msg - Error message
   *
   * @throws {Error} Parse error with line information
   */
  err(msg) {
    const currentToken = this.at();
    throw new Error(`Parse error at line ${currentToken.line}: ${msg}`);
  }

  /**
   * Checks whether the current token matches an expected type and optional value.
   *
   * Doesn't consume the token.
   *
   * @param {string} type - Token type to match
   * @param {*} [value] - Optional token value to match
   *
   * @returns {boolean} True if the current token matches
   */
  match(type, value) {
    const currentToken = this.at();
    return currentToken.type === type && (value === undefined || currentToken.value === value);
  }

  /**
   * Checks whether the current token matches one of several possible values.
   *
   * @param {string} type - Token type to match
   * @param {Array<*>} values - Allowed token values
   *
   * @returns {boolean} True if the current token matches one of the values
   */
  matchAny(type, values) {
    return values.some((value) => this.match(type, value));
  }

  /**
   * Parses the full token list into a program node.
   *
   * Parser repeatedly reads top-level declarations until it reaches EOF.
   * Each top-level declaration:
   * - function definition stored in program.functions
   * - global declaration stored in program.globals
   *
   * @returns {ProgramNode} Parsed program
   */
  parse() {
    const program = { globals: [], functions: {} };

    while (!this.match(TOKENTYPES.EOF)) {
      const decl = this.parseTopLevel();
      if (decl.kind === "func") program.functions[decl.name] = decl;
      else program.globals.push(decl);
    }
    return program;
  }

  /**
   * Parses an if statement with an optional else or else-if branch
   * 
   * @param {number} startLine - Source line wher the if statement starts
   * @param {StatementNode} Parsed if statement
  */
  parseIf(startLine) {
    this.eat(TOKENTYPES.KEYWORD, "if");
    this.eat(TOKENTYPES.PUNC, "(");

    const condition = this.parseExpr();

    this.eat(TOKENTYPES.PUNC, ")");

    const thenBranch = this.parseStatementBody();
    let elseBranch = null;

    if (this.match(TOKENTYPES.KEYWORD, "else")) {
      this.eat(TOKENTYPES.KEYWORD, "else");

      if (this.match(TOKENTYPES.KEYWORD, "if")) {
        elseBranch = [this.parseIf(this.at().line)];
      } else {
        elseBranch = this.parseStatementBody();
      }
    }

    return {
      kind: "if",
      condition,
      thenBranch,
      elseBranch,
      line: startLine,
    };
  }

  /**
   * Parses the body controlled by an if or else statement
   * 
   * @returns {StatementNode[]} Parsed statements
   */
  parseStatementBody() {
    if (this.match(TOKENTYPES.PUNC, "{")) {
      return this.parseBlock(); 
    }

    return [this.parseStmt()]; 
  }

  /**
   * Checks whether the current token can start a C type.
   *
   * @returns {boolean} True if the current token starts a type
   */
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

  /**
   * Parses a C type into a CType object.
   *
   * Example:
   * - int: { base: "int", pointer: 0 }
   *
   * @returns {CType} Parsed C type
   */
  parseType() {
    let base = "";
    let storageClass = null;
    while (this.matchAny(TOKENTYPES.KEYWORD, ["const", "static", "unsigned", "long", "short"])) {
      const modifier = this.eat().value;
      if (modifier === "static") storageClass = "static";
      base += modifier + " ";
    }
    base += this.eat(TOKENTYPES.KEYWORD).value;
    let pointer = 0;
    while (this.match(TOKENTYPES.OP, "*")) {
      this.eat();
      pointer++;
    }
    return { base: base.trim(), pointer, storageClass };
  }

  parseArrayDimensions(allowExpressions = false) {
    const dimensions = [];
    while (this.match(TOKENTYPES.PUNC, "[")) {
      this.eat();
      let dimension = null;
      if (this.match(TOKENTYPES.NUMBER)) {
        dimension = this.eat().value;
      } else if (allowExpressions && !this.match(TOKENTYPES.PUNC, "]")) {
        const expression = this.parseExpr();
        if (expression.kind === "num") dimension = expression.value;
      }
      this.eat(TOKENTYPES.PUNC, "]");
      dimensions.push(dimension);
    }
    return dimensions;
  }

  flattenArrayInitializer(initializer) {
    if (!Array.isArray(initializer)) return [initializer];
    return initializer.flatMap((value) => this.flattenArrayInitializer(value));
  }

  normalizeArrayInitializer(initializer, dimensions, depth = 0) {
    if (!initializer) return null;
    const totalSize = dimensions.slice(depth).reduce((total, size) => total * size, 1);
    const values = Array.isArray(initializer) ? initializer : [initializer];
    const hasNestedValues = values.some((value) => Array.isArray(value));

    if (depth === dimensions.length - 1 || !hasNestedValues) {
      const flattened = this.flattenArrayInitializer(values).slice(0, totalSize);
      while (flattened.length < totalSize) flattened.push({ kind: "num", value: 0 });
      return flattened;
    }

    const normalized = [];
    const childSize = dimensions
      .slice(depth + 1)
      .reduce((total, size) => total * size, 1);
    for (let i = 0; i < dimensions[depth]; i++) {
      if (i < values.length) {
        normalized.push(
          ...this.normalizeArrayInitializer(values[i], dimensions, depth + 1),
        );
      } else {
        for (let j = 0; j < childSize; j++) {
          normalized.push({ kind: "num", value: 0 });
        }
      }
    }
    return normalized;
  }

  resolveArrayDeclaration(dimensions, initializer) {
    const resolvedDimensions = [...dimensions];
    if (resolvedDimensions[0] === null && initializer) {
      const innerSize = resolvedDimensions
        .slice(1)
        .reduce((total, size) => total * size, 1);
      const topLevelSize = initializer.some((value) => Array.isArray(value))
        ? initializer.length
        : Math.ceil(this.flattenArrayInitializer(initializer).length / innerSize);
      resolvedDimensions[0] = topLevelSize;
    }
    const arraySize = resolvedDimensions.includes(null)
      ? null
      : resolvedDimensions.reduce((total, size) => total * size, 1);
    const arrayInit = arraySize
      ? this.normalizeArrayInitializer(initializer, resolvedDimensions)
      : initializer;
    return { arrayDimensions: resolvedDimensions, arraySize, arrayInit };
  }

  /**
   * Parses one top-level declaration.
   *
   * @returns {FunctionNode | GlobalDeclarationNode} Parsed top-level node
   */
  parseTopLevel() {
    const startLine = this.at().line;
    const type = this.parseType();
    const name = this.eat(TOKENTYPES.IDENT).value;

    if (this.match(TOKENTYPES.PUNC, "(")) return this.parseFuncDef(type, name, startLine);

    let value = null;
    const arrayDimensions = this.parseArrayDimensions();

    if (arrayDimensions.length > 0) {
      let arrayInit = null;
      if (this.match(TOKENTYPES.OP, "=")) {
        this.eat();
        arrayInit = this.parseArrayInit();
      }
      const layout = this.resolveArrayDeclaration(arrayDimensions, arrayInit);
      this.eat(TOKENTYPES.PUNC, ";");
      return {
        kind: "global_decl",
        type,
        name,
        arraySize: layout.arraySize,
        arrayDimensions: layout.arrayDimensions,
        arrayInit: layout.arrayInit,
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

  /**
   * Parses a function definition after the return type and name are known.
   *
   * @param {CType} type - Function return type
   * @param {string} name - Function name
   * @param {number} startLine - Source line where the function starts
   *
   * @returns {FunctionNode} - Parsed function node
   */
  parseFuncDef(type, name, startLine) {
    this.eat(TOKENTYPES.PUNC, "(");
    const params = [];
    while (!this.match(TOKENTYPES.PUNC, ")")) {
      if (params.length > 0) this.eat(TOKENTYPES.PUNC, ",");
      let ptype = this.parseType();
      const pname = this.eat(TOKENTYPES.IDENT).value;
      const arrayDimensions = this.parseArrayDimensions(true);
      if (arrayDimensions.length > 0) {
        ptype = { ...ptype, pointer: ptype.pointer + 1 };
      }
      params.push({
        type: ptype,
        name: pname,
        arrayDimensions: arrayDimensions.length > 0 ? arrayDimensions : null,
      });
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

  /**
   * Parses a block of statements surrounded by braces
   *
   * @returns {StatementNode[]} Parsed statements inside the block
   */
  parseBlock() {
    this.eat(TOKENTYPES.PUNC, "{");
    const stmts = [];
    while (!this.match(TOKENTYPES.PUNC, "}")) stmts.push(this.parseStmt());
    this.eat(TOKENTYPES.PUNC, "}");
    return stmts;
  }

  /**
   * Parses one statement inside a function body.
   *
   * @returns {StatementNode} Parsed statement node
   */
  parseStmt() {
    const startLine = this.at().line;

    if (this.match(TOKENTYPES.KEYWORD, "if")) {
      return this.parseIf(startLine);
    }

    if (this.match(TOKENTYPES.KEYWORD, "while")) {
      return this.parseWhile(startLine);
    }

    if (this.match(TOKENTYPES.KEYWORD, "for")) {
      return this.parseFor(startLine);
    }

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

    return this.parseSimpleStatement(startLine, ";");
  }

  /**
   * Parses a simple statement.
   *
   * Simple statements:
   * - pointer dereference assignments: *ptr = 5
   * - pointer compound assignments: *ptr += 1
   * - array element assignments: arr[0] = 5
   * - variable assignments: x = 5
   * - compound assignments: x += 1
   * - increment and decrement statements: x++ or x--
   * - function-call statements: foo()
   *
   * @param {number} startLine - Source line where the statement starts
   * @param {string} terminator - Punctuation that ends the statement
   * @returns {StatementNode} Parsed simple statement
 */
  parseSimpleStatement(startLine, terminator = ";") {
    const checkpoint = this.pos;
    const parsedTarget = this.parseExpr();

    if (this.matchAny(TOKENTYPES.OP, ["=", "+=", "-=", "*=", "/="])) {
      const op = this.eat().value;
      const value = this.parseExpr();
      this.eat(TOKENTYPES.PUNC, terminator);
      return {
        kind: "lvalue_assign",
        target: parsedTarget,
        op,
        value,
        line: startLine,
      };
    }

    if (this.matchAny(TOKENTYPES.OP, ["++", "--"])) {
      const op = this.eat().value;
      this.eat(TOKENTYPES.PUNC, terminator);
      return {
        kind: "lvalue_update",
        target: parsedTarget,
        op,
        line: startLine,
      };
    }

    if (this.match(TOKENTYPES.PUNC, terminator)) {
      this.eat();
      return {
        kind: "expr_stmt",
        expr: parsedTarget,
        line: startLine,
      };
    }

    this.pos = checkpoint;
    // Pointer dereference statements:
    if (this.match(TOKENTYPES.OP, "*")) {
      this.eat(TOKENTYPES.OP, "*");

      const target = this.eat(TOKENTYPES.IDENT).value;

      if (this.match(TOKENTYPES.OP, "=")) {
        this.eat(TOKENTYPES.OP, "=");

        const value = this.parseExpr();

        this.eat(TOKENTYPES.PUNC, terminator);

        return {
          kind: "deref_assign",
          target,
          value,
          line: startLine,
        };
      }

      if (
        this.matchAny(
          TOKENTYPES.OP,
          ["+=", "-=", "*=", "/="],
        )
      ) {
        const op = this.eat().value;
        const value = this.parseExpr();

        this.eat(TOKENTYPES.PUNC, terminator);

        return {
          kind: "deref_compound_assign",
          target,
          op,
          value,
          line: startLine,
        };
      }

      this.err(
        `Expected an assignment operator after '*${target}'`,
      );
    }

    if (!this.match(TOKENTYPES.IDENT)) {
      this.err(`Unexpected token: ${this.at().value}`);
    }

    const name = this.eat(TOKENTYPES.IDENT).value;

    // Array element assign
    if (this.match(TOKENTYPES.PUNC, "[")) {
      this.eat(TOKENTYPES.PUNC, "[");

      const index = this.parseExpr();

      this.eat(TOKENTYPES.PUNC, "]");
      this.eat(TOKENTYPES.OP, "=");

      const value = this.parseExpr();

      this.eat(TOKENTYPES.PUNC, terminator);

      return {
        kind: "array_assign",
        name,
        index,
        value,
        line: startLine,
      };
    }

    // Ordinary assignment
    if (this.match(TOKENTYPES.OP, "=")) {
      this.eat(TOKENTYPES.OP, "=");

      const value = this.parseExpr();

      this.eat(TOKENTYPES.PUNC, terminator);

      return {
        kind: "assign",
        name,
        value,
        line: startLine,
      };
    }

    // Compound assignment
    if (
      this.matchAny(
        TOKENTYPES.OP,
        ["+=", "-=", "*=", "/="],
      )
    ) {
      const op = this.eat().value;
      const value = this.parseExpr();

      this.eat(TOKENTYPES.PUNC, terminator);

      return {
        kind: "compound_assign",
        name,
        op,
        value,
        line: startLine,
      };
    }

    // Postfix increment or decrement
    if (
      this.matchAny(
        TOKENTYPES.OP,
        ["++", "--"],
      )
    ) {
      const op = this.eat().value;

      this.eat(TOKENTYPES.PUNC, terminator);

      return {
        kind: "unary_stmt",
        name,
        op,
        line: startLine,
      };
    }

    // Function call
    if (this.match(TOKENTYPES.PUNC, "(")) {
      this.pos--;

      const expr = this.parseExpr();

      this.eat(TOKENTYPES.PUNC, terminator);

      return {
        kind: "expr_stmt",
        expr,
        line: startLine,
      };
    }

    this.err(
      `Unexpected token after identifier '${name}': ${this.at().value}`,
    );
  }

  /** 
   * Parses a while loop.
   * 
   * @param {number} startLine - Source line where the loop starts
   * @returns {StatementNode} Parsed while-loop statement
   */
  parseWhile(startLine) {
    this.eat(TOKENTYPES.KEYWORD, "while");
    this.eat(TOKENTYPES.PUNC, "(");

    const condition = this.parseExpr();

    this.eat(TOKENTYPES.PUNC, ")");

    return {
      kind: "while",
      condition,
      body: this.parseStatementBody(),
      line: startLine,
    };
  }

/**
 * Parses a for loop.
 *
 * @param {number} startLine - Source line where the loop starts
 * @returns {StatementNode} Parsed for-loop statement
 */
  parseFor(startLine) {
    this.eat(TOKENTYPES.KEYWORD, "for");
    this.eat(TOKENTYPES.PUNC, "(");

    let initializer = null;

    if (this.match(TOKENTYPES.PUNC, ";")) {
      this.eat(TOKENTYPES.PUNC, ";");
    } else if (this.isTypeStart()) {
      initializer = this.parseLocalDecl(this.at().line);
    } else {
      initializer = this.parseSimpleStatement(
        this.at().line,
        ";",
      );
    }

    let condition = null;

    if (!this.match(TOKENTYPES.PUNC, ";")) {
      condition = this.parseExpr();
    }

    this.eat(TOKENTYPES.PUNC, ";");

    let update = null;

    if (this.match(TOKENTYPES.PUNC, ")")) {
      this.eat(TOKENTYPES.PUNC, ")");
    } else {
      update = this.parseSimpleStatement(
        this.at().line,
        ")",
      );
    }

    return {
      kind: "for",
      initializer,
      condition,
      update,
      body: this.parseStatementBody(),
      line: startLine,
    };
  }

  /**
   * Parses a local variable or local array declaration.
   *
   * Note: local declarations appear inside function bodies.
   * Returns: a "local_decl" statement node.
   *
   * @param {number} startLine = Source line where the declaration starts
   *
   * @returns {StatementNode} Parsed local declaration statement
   */
  parseLocalDecl(startLine) {
    const type = this.parseType();
    const name = this.eat(TOKENTYPES.IDENT).value;
    const arrayDimensions = this.parseArrayDimensions();

    if (arrayDimensions.length > 0) {
      let arrayInit = null;
      if (this.match(TOKENTYPES.OP, "=")) {
        this.eat();
        arrayInit = this.parseArrayInit();
      }
      const layout = this.resolveArrayDeclaration(arrayDimensions, arrayInit);
      this.eat(TOKENTYPES.PUNC, ";");
      return {
        kind: "local_decl",
        type,
        name,
        arraySize: layout.arraySize,
        arrayDimensions: layout.arrayDimensions,
        arrayInit: layout.arrayInit,
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

  /**
   * Parsed an array initializer.
   *  
   * Supports both:
   * - int arr[3] = {1, 2, 3};
   * - char word[6] = "Hello";
   * 
   * Note: each element is parsed as an expression
   *
   * @returns {ExpressionNode[]} Parsed array initializer expressions
   */
  parseArrayInit() {
    if (this.match(TOKENTYPES.STRING)) {
      const stringValue = this.eat(TOKENTYPES.STRING).value;
      return this.convertStringToCharInitializer(stringValue);
    } else {
      this.eat(TOKENTYPES.PUNC, "{");
      const elems = [];
      while (!this.match(TOKENTYPES.PUNC, "}")) {
        if (elems.length > 0) this.eat(TOKENTYPES.PUNC, ",");
        elems.push(
          this.match(TOKENTYPES.PUNC, "{") ? this.parseArrayInit() : this.parseExpr(),
        );
      }
      this.eat(TOKENTYPES.PUNC, "}");
      return elems;
    }
  }

  /**
   * Converts a string literal into char initializer expressions
   * 
   * Example:
   * "Hi" 
   * [
   *  { kind: "num", value: 72 },
   *  { kind: "num", value: 105 },
   *  { kind: "num", value: 0 } (For null terminator)
   * ]
   * 
   * @param {string} value - String literal value without quotes
   * @returns {ExpressionNode[]} Character code nodes ending with '\0'
   */
  convertStringToCharInitializer(value) {
    const elems = [];

    for (const char of value) {
      elems.push({
        kind: "num", 
        value: char.charCodeAt(0), 
      });
    }

    elems.push({ kind: "num", value: 0 });
    return elems;
  }

  /**
   * Parses a printf statement
   *
   * Note: first argument must be a string token. Any remaining comma-seperated
   * arguments are parsed as expressions.
   *
   * @param {number} startLine - Source line where the printf statement starts
   *
   * @returns {StatementNode} Parsed printf statement
   */
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

  /**
   * Parses an expression.
   *
   * @returns {ExpressionNode} Parsed expression node
   */
  parseExpr() {
    return this.parseOr();
  }

  /**
   * Parses logical OR expressions.
   *
   * @returns {ExpressionNode} Parsed expression node
   */
  parseOr() {
    let left = this.parseAnd();
    while (this.match(TOKENTYPES.OP, "||")) {
      this.eat();
      left = { kind: "binop", op: "||", left, right: this.parseAnd() };
    }
    return left;
  }

  /**
   * Parses logical AND expressions.
   *
   * @returns {ExpressionNode} Parsed expression node
   */
  parseAnd() {
    let left = this.parseEquality();
    while (this.match(TOKENTYPES.OP, "&&")) {
      this.eat();
      left = { kind: "binop", op: "&&", left, right: this.parseEquality() };
    }
    return left;
  }

  /**
   * Parsed equality comparison expressions.
   *
   * Supported operators:
   * - ==
   * - !=
   *
   * @returns {ExpressionNode} Parsed expression node
   */
  parseEquality() {
    let left = this.parseComparison();
    while (this.matchAny(TOKENTYPES.OP, ["==", "!="])) {
      const op = this.eat().value;
      left = { kind: "binop", op, left, right: this.parseComparison() };
    }
    return left;
  }

  /**
   * Parses relational comparison expressions.
   *
   * Supported operators:
   * - <
   * - >
   * - <=
   * - >=
   *
   * @returns {ExpressionNode} Parsed expression node
   */
  parseComparison() {
    let left = this.parseAddSub();
    while (this.matchAny(TOKENTYPES.OP, ["<", ">", "<=", ">="])) {
      const op = this.eat().value;
      left = { kind: "binop", op, left, right: this.parseAddSub() };
    }
    return left;
  }

  /**
   * Parses addition and subtraction expressions.
   *
   * Supported operators:
   * - +
   * - -
   *
   * @returns {ExpressionNode} Parsed expression node
   */
  parseAddSub() {
    let left = this.parseMulDiv();
    while (this.matchAny(TOKENTYPES.OP, ["+", "-"])) {
      const op = this.eat().value;
      left = { kind: "binop", op, left, right: this.parseMulDiv() };
    }
    return left;
  }

  /**
   * Parses multiplication, division, and modulo expresions
   *
   * Supported operators:
   * - *
   * - /
   * - %
   *
   * @returns {ExpressionNode} Parsed expression node
   */
  parseMulDiv() {
    let left = this.parseUnary();
    while (this.matchAny(TOKENTYPES.OP, ["*", "/", "%"])) {
      const op = this.eat().value;
      left = { kind: "binop", op, left, right: this.parseUnary() };
    }
    return left;
  }

  /**
   * Parses unary expressions.
   *
   * Supported unary operators:
   * - &x: address of
   * - *ptr: pointer dereference
   * - -x: numeric negation
   * - !x: logical not
   *
   * @returns {ExpressionNode} Parsed expression node
   */
  parseUnary() {
    if (this.match(TOKENTYPES.OP, "&")) {
      this.eat();
      const expr = this.parseUnary();
      return { kind: "addr_of", expr };
    }
    if (this.match(TOKENTYPES.OP, "*")) {
      this.eat();
      const expr = this.parseUnary();
      return { kind: "deref", expr };
    }
    if (this.match(TOKENTYPES.OP, "-")) {
      this.eat();
      const expr = this.parseUnary();
      return { kind: "negate", expr };
    }
    if (this.match(TOKENTYPES.OP, "!")) {
      this.eat();
      const expr = this.parseUnary();
      return { kind: "not", expr };
    }
    return this.parsePrimary();
  }

  /**
   * Parses primary expressions
   *
   * Supported forms:
   * - number literal: 123
   * - char literal: 'A'
   * - string literal: "hello"
   * - NULL
   * - sizeof(type)
   * - cast expression: (int*)ptr
   * - parenthesized expression: (a + b)
   * - malloc(size)
   * - function call: add(x, y)
   * - array access: arr[2]
   * - variable reference: x
   *
   * @returns {ExpressionNode} Parsed expression node
   */
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
        const indices = [];
        while (this.match(TOKENTYPES.PUNC, "[")) {
          this.eat();
          indices.push(this.parseExpr());
          this.eat(TOKENTYPES.PUNC, "]");
        }
        return { kind: "array_access", name, index: indices[0], indices };
      }
      return { kind: "var", name };
    }

    this.err(`Unexpected token in expression: ${this.at().type} '${this.at().value}'`);
  }
}
