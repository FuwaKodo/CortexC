export const TOKENTYPES = Object.freeze({
  KEYWORD: "KW",
  IDENT: "ID",
  NUMBER: "NUM",
  STRING: "STR",
  CHAR_LIT: "CHR",
  OP: "OP",
  PUNC: "PN",
  EOF: "EOF",
});

export const KEYWORDS = new Set([
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

export const OPERATIONS = new Set([
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

export function tokenize(src) {
  const tokens = [];
  let i = 0;
  let line = 1;
  let col = 1;

  function advance() {
    if (src[i] === "\n") {
      line += 1;
      col = 1;
    } else {
      col += 1;
    }

    i += 1;
  }
}
