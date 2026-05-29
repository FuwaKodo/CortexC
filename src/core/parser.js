"use strict";

import { TOKENTYPES } from "./tokenizer.js";

export class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.position = 0;
  }

  peek(offset = 0) {
    const tokenIndex = Math.min(this.pos + offset, this.tokens.length - 1);
    return this.tokens[tokenIndex];
  }

  getCurrentToken() {
    return this.peek();
  }

  err(message) {
    const token = this.getCurrentToken();
    throw new Error(`Parse error at line ${token.line}: ${message}`);
  }

  isMatch(type, value) {
    const token = this.getCurrentToken();
    const matchType = token.type === type;
    const matchValue = value === undefined || token.value === value;
    return matchType && matchValue;
  }

  isMatchAny(type, values) {
    return values.some((value) => this.isMatch(type, value));
  }

  consumeExpectedToken(type, value) {
    const token = this.getCurrentToken();
    if (type && token.type !== type) {
      this.err(`Expected ${type} but got ${token.type} (${token.value})`);
    }

    if (value !== undefined && token.value !== value) {
      this.err(`Expected '${value}' but got '${token.value}'`);
    }

    this.position += 1;
    return token;
  }
}
