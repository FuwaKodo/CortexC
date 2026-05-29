class Visualizer {
  constructor() {
    this.stackEl = document.getElementById("stackViz");
    this.heapEl = document.getElementById("heapViz");
    this.globalEl = document.getElementById("globalViz");
    this.prevState = null;
  }

  hex(n) {
    return "0x" + (n >>> 0).toString(16).toUpperCase().padStart(4, "0");
  }

  formatVal(v, type) {
    if (v === null || v === undefined) return "???";
    if (type && type.pointer > 0) {
      if (v === 0) return "NULL";
      return this.hex(v);
    }
    return String(v);
  }

  isPointer(type) {
    return type && type.pointer > 0;
  }

  render(mem) {
    this.renderStack(mem);
    this.renderHeap(mem);
    this.renderGlobals(mem);
    this.prevState = this.snapshot(mem);
  }

  snapshot(mem) {
    const s = { stack: [], heap: [], globals: [] };
    for (const frame of mem.stack) {
      const vars = {};
      for (const [k, v] of frame.vars) vars[k] = JSON.stringify(v);
      s.stack.push({ name: frame.name, vars });
    }
    for (const [addr, block] of mem.heap)
      s.heap.push({ addr, freed: block.freed, vals: [...block.values] });
    for (const [k, v] of mem.globals)
      s.globals.push({ name: k, val: JSON.stringify(v) });
    return s;
  }

  isNewVar(frameName, varName) {
    if (!this.prevState) return true;
    const pf = this.prevState.stack.find((f) => f.name === frameName);
    return !pf || !pf.vars[varName];
  }

  frameColorClass(frame, index) {
    if (frame.name === "main") return "main";
    const funcIdx = index > 0 ? index - 1 : 0;
    return `func-${funcIdx % 4}`;
  }

  allocationHue(addr) {
    const hues = [202, 158, 34, 274, 332, 12];
    return hues[Math.abs((addr >>> 2) % hues.length)];
  }

  allocationMeta(addr, freed = false) {
    return { hue: this.allocationHue(addr), freed };
  }

  allocationStyleAttr(allocation) {
    return allocation ? ` style="--alloc-hue:${allocation.hue}"` : "";
  }

  renderMemName(labelHtml) {
    return `<span class="mem-name"><span class="mem-name-label">${labelHtml}</span></span>`;
  }

  renderPointerValue(name, value, type, extraClasses = "", allocation = null) {
    const classes = ["mem-value", "pointer-val", "pointer-source"];
    if (extraClasses) classes.push(extraClasses);
    if (allocation) classes.push("allocation-linked");
    if (allocation && allocation.freed) classes.push("allocation-freed");
    return `<span class="${classes.join(" ")}"${this.allocationStyleAttr(allocation)}><span class="pointer-chip-prefix">ptr</span><span class="pointer-chip-value">${this.formatVal(value, type)}</span></span>`;
  }

  renderStack(mem) {
    if (mem.stack.length === 0) {
      this.stackEl.innerHTML =
        '<div class="empty-state">Run code to see stack</div>';
      return;
    }

    let html = "";
    const topIdx = mem.stack.length - 1;

    for (let i = mem.stack.length - 1; i >= 0; i--) {
      const frame = mem.stack[i];
      const colorKey = this.frameColorClass(frame, i);
      const isActive = i === topIdx;

      if (i < topIdx) {
        html += `<div class="stack-call-connector"><span class="call-label">called by ${frame.name}()</span></div>`;
      }

      html += `<div class="stack-frame-wrapper wrapper-${colorKey}">`;
      html += `<div class="stack-depth-line"></div>`;
      html += `<div class="stack-frame frame-${colorKey} ${isActive ? "active-frame" : ""}">`;

      const badge = isActive ? "running" : i === 0 ? "entry" : "paused";
      html += `<div class="frame-header">`;
      html += `<span class="frame-label"><span>${frame.name}()</span><span class="frame-badge">${badge}</span></span>`;
      html += `<span class="addr">${this.hex(frame.base)}</span>`;
      html += `</div><div class="frame-vars">`;

      if (frame.vars.size === 0) {
        html += `<div class="mem-cell"><span class="mem-name" style="color:var(--text-muted);font-style:italic">no vars</span></div>`;
      }

      for (const [name, v] of frame.vars) {
        const isNew = this.isNewVar(frame.name, name);
        if (v.isArray) {
          html += `<div class="mem-cell ${isNew ? "new-cell" : ""}" data-base="${v.addr}">`;
          html += this.renderMemName(`${v.type.base} ${name}[${v.size}]`);
          html += `<span></span><span class="mem-addr">${this.hex(v.addr)}</span></div>`;
          html += `<div class="array-cells">`;
          for (let j = 0; j < v.size; j++) {
            html += `<div class="array-cell"><span class="array-index">[${j}]</span><span class="array-val">${v.values[j]}</span></div>`;
          }
          html += `</div>`;
        } else {
          const ptrClass = this.isPointer(v.type) ? "pointer-val" : "";
          const nullClass =
            this.isPointer(v.type) && v.value === 0 ? "null-val" : "";
          const typeStr =
            v.type.base +
            (v.type.pointer > 0 ? "*".repeat(v.type.pointer) : "");
          const allocation =
            this.isPointer(v.type) && mem.heap.has(v.value)
              ? this.allocationMeta(v.value, mem.heap.get(v.value).freed)
              : null;
          const cellClasses = ["mem-cell"];
          if (isNew) cellClasses.push("new-cell");
          if (allocation) cellClasses.push("allocation-linked");
          if (allocation && allocation.freed)
            cellClasses.push("allocation-freed");

          html += `<div class="${cellClasses.join(" ")}" data-addr="${v.addr}"${this.allocationStyleAttr(allocation)}>`;
          html += this.renderMemName(
            `<span class="mem-type">${typeStr}</span> ${name}`,
          );
          if (this.isPointer(v.type)) {
            html += this.renderPointerValue(
              name,
              v.value,
              v.type,
              `${ptrClass} ${nullClass}`.trim(),
              allocation,
            );
          } else {
            html += `<span class="mem-value ${ptrClass} ${nullClass}">${this.formatVal(v.value, v.type)}</span>`;
          }
          html += `<span class="mem-addr">${this.hex(v.addr)}</span></div>`;
        }
      }
      html += `</div></div></div>`;
    }
    this.stackEl.innerHTML = html;
  }

  renderHeap(mem) {
    if (mem.heap.size === 0) {
      this.heapEl.innerHTML =
        '<div class="empty-state">No heap allocations</div>';
      return;
    }

    let html = "";
    for (const [addr, block] of mem.heap) {
      const allocation = this.allocationMeta(addr, block.freed);
      const blockClasses = ["heap-block", "allocation-linked"];
      if (block.freed) blockClasses.push("freed", "allocation-freed");

      html += `<div class="${blockClasses.join(" ")}" data-base="${addr}"${this.allocationStyleAttr(allocation)}>`;
      html += `<div class="heap-block-header" data-addr="${addr}">`;
      html += `<span class="heap-block-title"><span class="heap-badge">malloc</span><span class="heap-block-address">${this.hex(addr)}</span></span>`;
      html += `<span class="size-info">${block.size} bytes${block.freed ? " (freed)" : ""}</span></div>`;
      html += `<div class="heap-block-body">`;
      if (block.elemCount <= 8) {
        html += `<div class="array-cells">`;
        for (let j = 0; j < block.elemCount; j++) {
          const cellAddr = addr + j * 4;
          html += `<div class="array-cell"><span class="array-index">${this.hex(cellAddr)}</span>`;
          html += `<span class="array-val ${block.freed ? "freed" : ""}">${block.values[j]}</span></div>`;
        }
        html += `</div>`;
      } else {
        html += `<div class="mem-cell"><span class="mem-name">${block.elemCount} cells</span>`;
        html += `<span class="mem-value">[${block.values.slice(0, 4).join(", ")}...]</span></div>`;
      }
      html += `</div></div>`;
    }
    this.heapEl.innerHTML = html;
  }

  renderGlobals(mem) {
    if (mem.globals.size === 0) {
      this.globalEl.innerHTML =
        '<div class="empty-state">No global variables</div>';
      return;
    }

    let html = "";
    for (const [name, v] of mem.globals) {
      if (v.isArray) {
        html += `<div class="global-cell" data-base="${v.addr}">`;
        html += this.renderMemName(`${v.type.base} ${name}[${v.size}]`);
        html += `<span></span><span class="mem-addr">${this.hex(v.addr)}</span></div>`;
        html += `<div class="array-cells">`;
        for (let j = 0; j < v.size; j++) {
          html += `<div class="array-cell"><span class="array-index">[${j}]</span><span class="array-val">${v.values[j]}</span></div>`;
        }
        html += `</div>`;
      } else {
        const typeStr =
          v.type.base + (v.type.pointer > 0 ? "*".repeat(v.type.pointer) : "");
        const ptrClass = this.isPointer(v.type) ? "pointer-val" : "";
        const allocation =
          this.isPointer(v.type) && mem.heap.has(v.value)
            ? this.allocationMeta(v.value, mem.heap.get(v.value).freed)
            : null;
        const cellClasses = ["global-cell"];
        if (allocation) cellClasses.push("allocation-linked");
        if (allocation && allocation.freed)
          cellClasses.push("allocation-freed");

        html += `<div class="${cellClasses.join(" ")}" data-addr="${v.addr}"${this.allocationStyleAttr(allocation)}>`;
        html += this.renderMemName(
          `<span class="mem-type">${typeStr}</span> ${name}`,
        );
        if (this.isPointer(v.type)) {
          html += this.renderPointerValue(
            name,
            v.value,
            v.type,
            ptrClass,
            allocation,
          );
        } else {
          html += `<span class="mem-value ${ptrClass}">${this.formatVal(v.value, v.type)}</span>`;
        }
        html += `<span class="mem-addr">${this.hex(v.addr)}</span></div>`;
      }
    }
    this.globalEl.innerHTML = html;
  }

  clear() {
    this.stackEl.innerHTML =
      '<div class="empty-state">Run code to see stack</div>';
    this.heapEl.innerHTML =
      '<div class="empty-state">No heap allocations</div>';
    this.globalEl.innerHTML =
      '<div class="empty-state">No global variables</div>';
    this.prevState = null;
  }
}
