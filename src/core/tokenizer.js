"use strict";

const TOKENTYPES = Object.freeze({
  KEYWORD: "KW",
  IDENT: "ID",
  NUMBER: "NUM",
  STRING: "STR",
  CHAR_LIT: "CHR",
  OP: "OP",
  PUNC: "PN",
  EOF: "EOF",
});

const KEYWORDS = new Set([
  "int",
  "char",
  "float",
  "double",
  "void",
  "long",
  "short",
  "unsigned",
  "return",
  "if",
  "else",
  "while",
  "for",
  "sizeof",
  "malloc",
  "free",
  "printf",
  "NULL",
  "const",
  "static",
]);

const OPERATIONS = new Set([
  "==",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  "++",
  "--",
  "+=",
  "-=",
  "*=",
  "/=",
  "->",
]);

const STRING_ESCAPE_SEQUENCE = Object.freeze({
  n: "\n",
  t: "\t",
  "\\": "\\",
  '"': '"',
});

const CHAR_ESCAPE_SEQUENCE = Object.freeze({
  n: "\n",
  t: "\t",
  0: "\0",
  "\\": "\\",
  "'": "'",
});

/**
 * Represents one token produced by the tokenizer.
 *
 * Examples:
 *  - int : { type: "KW", value: "int", line: 1, col: 1 }
 *  - x   : { type: "ID", value: "x", line: 1, col: 5 }
 *  - 123 : { type: "NUM", value: 123, line: 1, col: 9 }
 *  - ;   : { type: "PN", value: ";", line: 1, col: 12 }
 *
 * @typedef {Object} Token
 * @property {string} type - Token type from TOKENTYPES
 * @property {*} value - Token value, such as "int", "x", 123, or ";"
 * @property {number} line - Source line number where the token starts
 * @property {number} col - Source column number where the token starts
 */

/**
 * Converts raw C source code into a list of tokens.
 *
 * The tokenizer recognizes:
 *  - keywords: int, return, malloc
 *  - identifiers: 'x', 'ptr', 'main'
 *  - numbers: 123
 *  - strings: "hello"
 *  - char literals: 'A', 'a'
 *  - operators: '+', '-', '*', '/', '=', '==', '+=', '&&'
 *  - punctuation: ';', '(', ')', '{', '}'
 *
 * Whitespace and comments are skipped.
 *
 * @param {string} src - Raw source code from the editor
 * @returns {Token[]} Tokens for the parser, ending with an EOF token
 */
function tokenize(src) {
  const tokens = [];
  let i = 0;
  let line = 1;
  let col = 1;

  /**
   * Moves to the next source character while updating current line
   * and column position.
   *
   * @returns {void}
   */
  function advance() {
    if (src[i] === "\n") {
      line += 1;
      col = 1;
    } else {
      col += 1;
    }
    i += 1;
  }

  /**
   * Checks whether a character is whitespace.
   *
   * Whitespace includes:
   * - tabs
   * - spaces
   * - newlines
   *
   * @param {string} char - Character to check
   * @returns {boolean} True if the character is whitespace
   */
  function isWhiteSpace(char) {
    return /\s/.test(char);
  }

  /**
   * Checks whether the current source position starts a line comment.
   *
   * @returns {boolean} True if the current position starts a line comment
   */
  function isLineCommentStart() {
    return src[i] === "/" && src[i + 1] === "/";
  }

  /**
   * Checks whether the current source position starts a block comment.
   *
   * @returns {boolean} True if the current position starts a block comment
   */
  function isBlockCommentStart() {
    return src[i] === "/" && src[i + 1] === "*";
  }

  /**
   * Skips characters until the end of the current line comment.
   *
   * @returns {void}
   */
  function skipLineComment() {
    while (i < src.length && src[i] !== "\n") {
      advance();
    }
  }

  /**
   * Skips characters until the end of the current block comment.
   *
   * @returns {void}
   */
  function skipBlockComment() {
    advance();
    advance();
    while (i < src.length - 1 && !(src[i] === "*" && src[i + 1] === "/")) {
      advance();
    }
    if (i < src.length - 1) {
      advance();
      advance();
    }
  }

  /**
   * Skips characters that should not become tokens.
   *
   * Skipped characters include:
   *  - Whitespace
   *  - Line comments
   *  - Block comments
   *
   * @returns {void}
   */
  function skipIgnored() {
    while (i < src.length) {
      if (isWhiteSpace(src[i])) {
        advance();
      } else if (isLineCommentStart()) {
        skipLineComment();
      } else if (isBlockCommentStart()) {
        skipBlockComment();
      } else {
        break;
      }
    }
  }

  /**
   * Adds a token to the token list.
   *
   * tokenLine and tokenCol default to the current source position.
   *
   * @param {string} type - Token type from TOKENTYPES
   * @param {*} value - Token value
   * @param {number} tokenLine - Source line where the token starts
   * @param {number} tokenCol - Source column where the token starts
   *
   * @returns {void}
   */
  function pushToken(type, value, tokenLine = line, tokenCol = col) {
    tokens.push({
      type: type,
      value: value,
      line: tokenLine,
      col: tokenCol,
    });
  }

  /**
   * Checks whether a character can start a string token.
   *
   * @param {string} char - The character to check
   *
   * @returns {boolean} True if the character can start a string
   */
  function isStringStart(char) {
    return char === '"';
  }

  /**
   * Reads a double-quoted string literal and pushes a string token.
   *
   * @param {number} startLine - Line where the string starts
   * @param {number} startCol - Column where the string starts
   *
   * @returns {void}
   */
  function readStringLiteral(startLine, startCol) {
    // skip opening "
    advance();

    let string = "";

    while (i < src.length && src[i] !== '"') {
      if (src[i] === "\\") {
        advance();
        string += STRING_ESCAPE_SEQUENCE[src[i]] || src[i];
      } else {
        string += src[i];
      }

      advance();
    }

    if (i < src.length) {
      // skip closing "
      advance();
    }

    pushToken(TOKENTYPES.STRING, string, startLine, startCol);
  }

  /**
   * Checks whether a character can start a char token.
   *
   * @param {string} char - The character to check
   *
   * @returns {boolean} True if the character can start an char literal
   */
  function isCharStart(char) {
    return char === "'";
  }

  /**
   * Reads a single-quoted character literal and pushes a character token.
   *
   * @param {number} startLine - Line where the char literal starts
   * @param {number} startCol - Column where the char literal starts
   *
   * @returns {void}
   */
  function readCharLiteral(startLine, startCol) {
    // skip opening '
    advance();

    let char = src[i];

    if (char === "\\") {
      advance();
      char = CHAR_ESCAPE_SEQUENCE[src[i]] || src[i];
    }

    // skip character
    advance();

    if (i < src.length && src[i] === "'") {
      // skip closing '
      advance();
    }

    pushToken(TOKENTYPES.CHAR_LIT, char.charCodeAt(0), startLine, startCol);
  }

  /**
   * Checks whether a character can start a digit
   *
   * @param {string} char - The character to check
   *
   * @returns {boolean} True if the character is a digit, otherwise false
   */
  function isDigitStart(char) {
    return /[0-9]/.test(char);
  }

  /**
   * Checks whether a character can appear inside a number literal.
   *
   * Examples:
   *  - 123
   *  - 3.14
   *  - 0xff
   *  - 0xFF
   *
   * @param {string} char - The character to check
   *
   * @returns {boolean} True if the character can appear in a number literal, otherwise false
   */
  function isNumberLiteralChar(char) {
    return /[0-9.xXa-fA-F]/.test(char);
  }

  /**
   * Reads a numeric literal and pushes a number token.
   *
   * @param {number} startLine - Line where the number literal starts
   * @param {number} startCol - Column where the number literal starts
   *
   * @returns {void}
   */
  function readNumberLiteral(startLine, startCol) {
    let number = "";

    while (i < src.length && isNumberLiteralChar(src[i])) {
      number += src[i];
      advance();
    }

    pushToken(TOKENTYPES.NUMBER, Number(number), startLine, startCol);
  }

  /**
   * Checks whether a character can start an operator token.
   *
   * @param {string} char - The character to check
   *
   * @returns {boolean} True if the character can start an operator
   */
  function isOperatorStart(char) {
    return "+-*/%=!<>&|^~".includes(char);
  }

  /**
   * Reads an operator token and pushes a operator token.
   *
   * @param {number} startLine - Line where the operator starts
   * @param {number} startCol - Column where the operator starts
   *
   * @returns {void}
   */
  function readOperator(startLine, startCol) {
    let operator = src[i];
    advance();

    if (i < src.length && OPERATIONS.has(operator + src[i])) {
      operator += src[i];
      advance();
    }

    pushToken(TOKENTYPES.OP, operator, startLine, startCol);
  }

  /**
   * Checks whether a character is a punctuation symbol.
   *
   * @param {string} char - The character to check
   *
   * @returns {boolean} True if the character is punctuation, otherwise false
   */
  function isPunctuation(char) {
    return "(){}[];,.".includes(char);
  }

  /**
   * Reads a punctuation token and pushes a punctuation token.
   *
   * @param {number} startLine - Line where the punctuation starts.
   * @param {number} startCol - Column where the punctuation starts.
   *
   * @returns {void}
   */
  function readPunctuation(startLine, startCol) {
    pushToken(TOKENTYPES.PUNC, src[i], startLine, startCol);
    advance();
  }

  /**
   * Checks whether a character can start a word (identifier or keyword).
   * @param {string} char - The character to check
   *
   * @returns {boolean} True if the character can start a word (identifier or keyword)
   */
  function isWordStart(char) {
    return /[a-zA-Z_]/.test(char);
  }

  /**
   * Checks whether a character can appear in a word (identifier or keyword).
   *
   * @param {string} char - The character to check
   *
   * @returns {boolean} True if the character can appear in a word, otherwise false
   */
  function isWordChar(char) {
    return /[a-zA-Z0-9_]/.test(char);
  }

  /**
   * Reads a word (identifier or keyword) and pushes the matching token.
   *
   * Reads the full word, then checks if the word is reserved. Reserved
   * keywords become KEYWORD tokens and all other words become IDENT tokens.
   *
   * Example:
   * - int: KEYWORD token
   * - main: IDENT token
   * - x: IDENT token
   *
   * @param {number} startLine - Line where the word starts
   * @param {number} startCol - Column where the word starts
   *
   * @returns {void}
   */
  function readWord(startLine, startCol) {
    let word = "";

    while (i < src.length && isWordChar(src[i])) {
      word += src[i];
      advance();
    }

    const tokenType = KEYWORDS.has(word) ? TOKENTYPES.KEYWORD : TOKENTYPES.IDENT;

    pushToken(tokenType, word, startLine, startCol);
  }

  while (i < src.length) {
    skipIgnored();
    if (i >= src.length) {
      break;
    }

    // Store where this token begins
    const startLine = line;
    const startCol = col;
    const currentChar = src[i];

    if (isStringStart(currentChar)) {
      readStringLiteral(startLine, startCol);
    } else if (isCharStart(currentChar)) {
      readCharLiteral(startLine, startCol);
    } else if (isWordStart(currentChar)) {
      readWord(startLine, startCol);
    } else if (isDigitStart(currentChar)) {
      readNumberLiteral(startLine, startCol);
    } else if (isOperatorStart(currentChar)) {
      readOperator(startLine, startCol);
    } else if (isPunctuation(currentChar)) {
      readPunctuation(startLine, startCol);
    } else {
      // Unknown character, skip it
      advance();
    }
  }

  pushToken(TOKENTYPES.EOF, "", line, col);
  return tokens;
}

// Expose tokenizer utilities for Node-based tests
// if (typeof module !== "undefined" && module.exports) {
//   module.exports = {
//     TOKENTYPES,
//     KEYWORDS,
//     OPERATIONS,
//     STRING_ESCAPE_SEQUENCE,
//     CHAR_ESCAPE_SEQUENCE,
//     tokenize,
//   };
// }
