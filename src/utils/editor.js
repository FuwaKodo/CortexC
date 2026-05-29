const INDENT_UNIT = "    ";

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

function initEditor(codeInput, onCommit) {
  function commitEditorChange(
    nextValue,
    selectionStart,
    selectionEnd = selectionStart,
  ) {
    codeInput.value = nextValue;
    codeInput.selectionStart = selectionStart;
    codeInput.selectionEnd = selectionEnd;
    onCommit();
  }

  function indentSelection() {
    const text = codeInput.value;
    const start = codeInput.selectionStart;
    const end = codeInput.selectionEnd;

    if (start === end) {
      commitEditorChange(
        text.slice(0, start) + INDENT_UNIT + text.slice(end),
        start + INDENT_UNIT.length,
      );
      return;
    }

    const firstLineStart = getLineStart(text, start);
    const selectionEndIndex =
      end > start && text[end - 1] === "\n" ? end - 1 : end;
    const lastLineEnd = getLineEnd(text, selectionEndIndex);
    const lines = text.slice(firstLineStart, lastLineEnd).split("\n");
    const indentedBlock = lines.map((line) => INDENT_UNIT + line).join("\n");
    commitEditorChange(
      text.slice(0, firstLineStart) + indentedBlock + text.slice(lastLineEnd),
      start + INDENT_UNIT.length,
      end + INDENT_UNIT.length * lines.length,
    );
  }

  function outdentSelection() {
    const text = codeInput.value;
    const start = codeInput.selectionStart;
    const end = codeInput.selectionEnd;
    const firstLineStart = getLineStart(text, start);
    const selectionEndIndex =
      end > start && text[end - 1] === "\n" ? end - 1 : end;
    const lastLineEnd = getLineEnd(text, selectionEndIndex);
    const lines = text.slice(firstLineStart, lastLineEnd).split("\n");

    let removedFromFirstLine = 0,
      removedTotal = 0;
    const outdentedBlock = lines
      .map((line, index) => {
        let removed = 0;
        if (line.startsWith(INDENT_UNIT)) {
          removed = INDENT_UNIT.length;
          line = line.slice(INDENT_UNIT.length);
        } else {
          const partial = line.match(/^[ \t]{1,4}/);
          if (partial) {
            removed = partial[0].length;
            line = line.slice(removed);
          }
        }
        if (index === 0) removedFromFirstLine = removed;
        removedTotal += removed;
        return line;
      })
      .join("\n");

    if (removedTotal === 0) return;

    const nextValue =
      text.slice(0, firstLineStart) + outdentedBlock + text.slice(lastLineEnd);
    if (start === end) {
      commitEditorChange(
        nextValue,
        Math.max(firstLineStart, start - removedFromFirstLine),
      );
      return;
    }
    commitEditorChange(
      nextValue,
      Math.max(firstLineStart, start - removedFromFirstLine),
      Math.max(firstLineStart, end - removedTotal),
    );
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
    const shouldIncreaseIndent = /{$/.test(beforeCaret.trimEnd());
    const shouldFormatBraceBlock =
      shouldIncreaseIndent && afterCaret.trimStart().startsWith("}");

    if (shouldFormatBraceBlock) {
      const insertion = `\n${baseIndent}${INDENT_UNIT}\n${baseIndent}`;
      commitEditorChange(
        text.slice(0, start) + insertion + text.slice(end),
        start + 1 + baseIndent.length + INDENT_UNIT.length,
      );
      return;
    }

    const nextIndent = shouldIncreaseIndent
      ? baseIndent + INDENT_UNIT
      : baseIndent;
    const insertion = `\n${nextIndent}`;
    commitEditorChange(
      text.slice(0, start) + insertion + text.slice(end),
      start + insertion.length,
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

    const nextIndent =
      beforeCaret.length >= INDENT_UNIT.length
        ? beforeCaret.slice(0, beforeCaret.length - INDENT_UNIT.length)
        : "";
    commitEditorChange(
      text.slice(0, lineStart) + nextIndent + "}" + text.slice(end),
      lineStart + nextIndent.length + 1,
    );
    return true;
  }

  return {
    indentSelection,
    outdentSelection,
    insertIndentedNewline,
    insertClosingBraceWithOutdent,
  };
}
