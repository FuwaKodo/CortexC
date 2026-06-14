const test = require("node:test");
const assert = require("node:assert/strict");

const { tokenize, TOKENTYPES } = require("../src/core/tokenizer");

test("tokenize an int declaration", () => {
  const tokens = tokenize("int x = 5;");

  assert.deepEqual(
    tokens.map((token) => token.value),
    ["int", "x", "=", 5, ";", ""],
  );
});
