const THEME_STORAGE_KEY = "cortexc-theme";

function initController(mem, viz) {
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

  let interp = null;
  let running = false;
  let runTimer = null;
  let highlightEl = null;
  let errorHighlightEl = null;
  let runtimeCrash = null;
  let editorDiagnostic = {
    severity: "ok",
    label: "Syntax OK",
    message: "Ready to edit and run.",
    line: null,
  };

  const {
    indentSelection,
    outdentSelection,
    insertIndentedNewline,
    insertClosingBraceWithOutdent,
  } = initEditor(codeInput, handleEditorContentChange);

  function appendConsole(text, type = "") {
    const span = document.createElement("span");
    if (type) span.className = type;
    span.textContent = text;
    consoleOutput.appendChild(span);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
  }

  function showCrashOverlay(reason, line = null) {
    runtimeCrash = { reason, line };
    crashReason.textContent = reason;
    crashLine.textContent = line
      ? `Line ${line}`
      : "Execution stopped immediately.";
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
    appendConsole(
      (line ? `Line ${line}: ` : "") + reason + "\n",
      "console-error",
    );
    showCrashOverlay(reason, line);
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

  function analyzeEditorCode() {
    const code = codeInput.value;
    if (code.trim() === "")
      return {
        severity: "warning",
        label: "Empty",
        message: "Editor is empty.",
        line: null,
      };
    try {
      const tokens = tokenize(code);
      const parser = new Parser(tokens);
      const program = parser.parse();
      if (!program.functions.main)
        return {
          severity: "warning",
          label: "Warning",
          message: "Syntax OK. Add a main() function to run the program.",
          line: null,
        };
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

  function getCaretLine() {
    return codeInput.value.slice(0, codeInput.selectionStart).split("\n")
      .length;
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

  function updateLineNumbers(
    activeLine = getActiveEditorLine(),
    errorLine = editorDiagnostic.severity === "error"
      ? editorDiagnostic.line
      : null,
  ) {
    const lines = codeInput.value.split("\n");
    lineNumbers.innerHTML = lines
      .map((_, i) => {
        const n = i + 1;
        const classes = [];
        if (n === activeLine) classes.push("active-line");
        if (n === errorLine) classes.push("error-line");
        return `<div${classes.length ? ` class="${classes.join(" ")}"` : ""}>${n}</div>`;
      })
      .join("");
  }

  function refreshEditorDecorations() {
    const activeLine = getActiveEditorLine();
    const errorLine =
      runtimeCrash?.line ??
      (editorDiagnostic.severity === "error" ? editorDiagnostic.line : null);
    if (activeLine && errorLine && activeLine === errorLine) {
      if (errorHighlightEl) {
        errorHighlightEl.remove();
        errorHighlightEl = null;
      }
      highlightEl = setLineOverlay(
        highlightEl,
        activeLine,
        "line-highlight line-highlight-error",
      );
    } else {
      errorHighlightEl = setLineOverlay(
        errorHighlightEl,
        errorLine,
        "diagnostic-line-highlight",
      );
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

  function applyTheme(theme) {
    const t = theme === "light" ? "light" : "dark";
    document.body.dataset.theme = t;
    themeToggleBtn.textContent = t === "light" ? "Dark Mode" : "White Mode";
    themeToggleBtn.setAttribute(
      "aria-pressed",
      t === "light" ? "true" : "false",
    );
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
    const next = document.body.dataset.theme === "light" ? "dark" : "light";
    applyTheme(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }

  function initInterpreter() {
    consoleOutput.textContent = "";
    clearCrashOverlay();
    try {
      const tokens = tokenize(codeInput.value);
      const parser = new Parser(tokens);
      const program = parser.parse();
      interp = new Interpreter(
        mem,
        (msg) => appendConsole(msg),
        (msg) => appendConsole(msg + "\n", "console-error"),
        (reason, line) => handleRuntimeCrash(reason, line),
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
  codeInput.addEventListener("input", handleEditorContentChange);
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
    if (e.key === "}" && insertClosingBraceWithOutdent()) e.preventDefault();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !crashOverlay.hidden) {
      e.preventDefault();
      dismissCrashOverlay();
    }
  });
  ["click", "focus", "mouseup", "keyup", "select"].forEach((evt) =>
    codeInput.addEventListener(evt, refreshEditorDecorations),
  );

  applyTheme(loadThemePreference());
  validateEditorCode();
  refreshEditorDecorations();
}
