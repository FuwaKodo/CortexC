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

function tokenize(src) {
  const tokens = [];
  let i = 0,
    line = 1,
    col = 1;

  function advance() {
    if (src[i] === "\n") {
      line += 1;
      col = 1;
    } else {
      col += 1;
    }
    i += 1;
  }

  function isWhiteSpace(char) {
    return /\s/.test(char);
  }
  function isLineCommentStart() {
    return src[i] === "/" && src[i + 1] === "/";
  }
  function isBlockCommentStart() {
    return src[i] === "/" && src[i + 1] === "*";
  }

  function skipLineComment() {
    while (i < src.length && src[i] !== "\n") advance();
  }

  function skipBlockComment() {
    advance();
    advance();
    while (i < src.length - 1 && !(src[i] === "*" && src[i + 1] === "/"))
      advance();
    if (i < src.length - 1) {
      advance();
      advance();
    }
  }

  function skipIgnored() {
    while (i < src.length) {
      if (isWhiteSpace(src[i])) advance();
      else if (isLineCommentStart()) skipLineComment();
      else if (isBlockCommentStart()) skipBlockComment();
      else break;
    }
  }

  function pushToken(type, value, tokenLine = line, tokenCol = col) {
    tokens.push({ type, value, line: tokenLine, col: tokenCol });
  }

  while (i < src.length) {
    skipIgnored();
    if (i >= src.length) break;

    const startLine = line,
      startCol = col,
      currentChar = src[i];

    if (currentChar === '"') {
      advance();
      let string = "";
      while (i < src.length && src[i] !== '"') {
        if (src[i] === "\\") {
          advance();
          string += STRING_ESCAPE_SEQUENCE[src[i]] || src[i];
        } else string += src[i];
        advance();
      }
      if (i < src.length) advance();
      pushToken(TOKENTYPES.STRING, string, startLine, startCol);
    } else if (currentChar === "'") {
      advance();
      let char = src[i];
      if (char === "\\") {
        advance();
        char = CHAR_ESCAPE_SEQUENCE[src[i]] || src[i];
      }
      advance();
      if (i < src.length && src[i] === "'") advance();
      pushToken(TOKENTYPES.CHAR_LIT, char.charCodeAt(0), startLine, startCol);
    } else if (/[a-zA-Z_]/.test(currentChar)) {
      let word = "";
      while (i < src.length && /[a-zA-Z0-9_]/.test(src[i])) {
        word += src[i];
        advance();
      }
      pushToken(
        KEYWORDS.has(word) ? TOKENTYPES.KEYWORD : TOKENTYPES.IDENT,
        word,
        startLine,
        startCol,
      );
    } else if (/[0-9]/.test(currentChar)) {
      let number = "";
      while (i < src.length && /[0-9.xXa-fA-F]/.test(src[i])) {
        number += src[i];
        advance();
      }
      pushToken(TOKENTYPES.NUMBER, Number(number), startLine, startCol);
    } else if ("+-*/%=!<>&|^~".includes(currentChar)) {
      let operator = currentChar;
      advance();
      if (i < src.length && OPERATIONS.has(operator + src[i])) {
        operator += src[i];
        advance();
      }
      pushToken(TOKENTYPES.OP, operator, startLine, startCol);
    } else if ("(){}[];,.".includes(currentChar)) {
      pushToken(TOKENTYPES.PUNC, currentChar, startLine, startCol);
      advance();
    } else {
      advance();
    }
  }

  pushToken(TOKENTYPES.EOF, "", line, col);
  return tokens;
}
