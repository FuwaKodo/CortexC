export const TT = Object.freeze({
    KEYWORD: "KW", IDENT: "ID", NUMBER: "NUM", STRING: "STR",
    CHAR_LIT: "CHR", OP: "OP", PUNC: "PN", EOF: "EOF"
});

export const KEYWORDS = new Set([
    "int", "char", "float", "double", "void", "long", "short", "unsigned",
    "return", "if", "else", "while", "for",
    "sizeof", "malloc", "free", "printf", "NULL", "const", "static"
]);

export function tokenize(src) {
    const tokens = [];
}