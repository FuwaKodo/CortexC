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
    for (const [k, v] of mem.globals) s.globals.push({ name: k, val: JSON.stringify(v) });
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

  formatArrayDimensions(variable) {
    const dimensions = variable.dimensions || [variable.size];
    return dimensions.map((size) => `[${size ?? ""}]`).join("");
  }

  formatArrayIndex(index, variable) {
    const dimensions = variable.dimensions || [variable.size];
    let remaining = index;
    return dimensions
      .map((size, dimensionIndex) => {
        const stride = dimensions
          .slice(dimensionIndex + 1)
          .reduce((total, value) => total * value, 1);
        const coordinate = Math.floor(remaining / stride);
        remaining %= stride;
        return `[${coordinate}]`;
      })
      .join("");
  }

  formatType(type) {
    return type.base + (type.pointer > 0 ? "*".repeat(type.pointer) : "");
  }

  renderStructFields(variable) {
    let html = `<div class="array-cells">`;
    for (const field of variable.structDef.fields) {
      const storedField = variable.fields[field.name];
      html += `<div class="array-cell"><span class="array-index">${this.formatType(field.type)} .${field.name} @ ${this.hex(variable.addr + field.offset)}</span><span class="array-val">${this.formatVal(storedField.value, field.type)}</span></div>`;
    }
    html += `</div>`;
    return html;
  }

  renderPointerValue(name, value, type, extraClasses = "", allocation = null) {
    const classes = ["mem-value", "pointer-val", "pointer-source"];
    if (extraClasses) classes.push(extraClasses);
    if (allocation) classes.push("allocation-linked");
    if (allocation && allocation.freed) classes.push("allocation-freed");
    return `<span class="${classes.join(" ")}"${this.allocationStyleAttr(allocation)}><span class="pointer-chip-prefix">ptr</span><span class="pointer-chip-value">${this.formatVal(value, type)}</span></span>`;
  }

  variableByteSize(variable) {
    if (Number.isFinite(variable.byteSize)) return variable.byteSize;
    if (variable.isArray) {
      return variable.size * getTypeSize(variable.elemType || variable.type);
    }
    return getTypeSize(variable.type);
  }

  variableAllocatedSize(variable) {
    const byteSize = this.variableByteSize(variable);
    if (Number.isFinite(variable.allocatedSize)) return variable.allocatedSize;
    return byteSize + ((4 - (byteSize % 4)) % 4);
  }

  variableDeclaration(name, variable) {
    const dimensions = variable.isArray ? this.formatArrayDimensions(variable) : "";
    return `<span class="mem-type">${this.formatType(variable.type)}</span> ${name}${dimensions}`;
  }

  addRowItem(rows, byteOffset, byteSize, item) {
    const firstRow = Math.floor(byteOffset / 4);
    const lastRow = Math.floor((byteOffset + Math.max(1, byteSize) - 1) / 4);
    for (let i = firstRow; i <= lastRow && i < rows.length; i++) {
      rows[i].items.push({ ...item, continuation: i !== firstRow });
    }
  }

  buildVariableRows(name, variable, mem, isNew = false) {
    const byteSize = this.variableByteSize(variable);
    const allocatedSize = Math.max(4, this.variableAllocatedSize(variable));
    const allocation =
      !variable.isArray &&
      this.isPointer(variable.type) &&
      mem.heap.has(variable.value)
        ? this.allocationMeta(variable.value, mem.heap.get(variable.value).freed)
        : null;
    const rows = [];

    for (let offset = 0; offset < allocatedSize; offset += 4) {
      rows.push({
        address: variable.addr + offset,
        base: variable.addr,
        byteOffset: offset,
        byteSize,
        declaration: offset === 0 ? this.variableDeclaration(name, variable) : "",
        items: [],
        variable,
        isNew,
        allocation,
      });
    }

    if (variable.isStruct) {
      for (const field of variable.structDef.fields) {
        const storedField = variable.fields[field.name];
        const fieldSize = field.arraySize
          ? field.arraySize * getTypeSize(field.type)
          : getTypeSize(field.type);
        this.addRowItem(rows, field.offset, fieldSize, {
          label: `${this.formatType(field.type)} .${field.name}`,
          value: this.formatVal(storedField.value, field.type),
        });
      }
    } else if (variable.isArray) {
      const elemType = variable.elemType || variable.type;
      const elemSize = getTypeSize(elemType);
      for (let i = 0; i < variable.size; i++) {
        this.addRowItem(rows, i * elemSize, elemSize, {
          label: this.formatArrayIndex(i, variable),
          value: this.formatVal(variable.values[i], elemType),
        });
      }
    } else {
      this.addRowItem(rows, 0, byteSize, {
        label: "",
        value: this.formatVal(variable.value, variable.type),
        scalar: true,
      });
    }

    if (rows.length > 1) {
      const groupHue = allocation ? allocation.hue : this.allocationHue(variable.addr);
      for (const row of rows) row.groupHue = groupHue;
    }

    return rows;
  }

  renderRowItems(row) {
    if (row.items.length === 0) {
      return `<span class="memory-row-continuation">padding</span>`;
    }

    const visibleItems = row.items.filter((item) => !item.continuation);
    if (visibleItems.length === 0) {
      return `<span class="memory-row-continuation" aria-hidden="true"></span>`;
    }

    if (visibleItems.length === 1 && visibleItems[0].scalar) {
      const nullClass = this.isPointer(row.variable.type) && row.variable.value === 0
        ? "null-val"
        : "";
      if (this.isPointer(row.variable.type)) {
        return this.renderPointerValue(
          "",
          row.variable.value,
          row.variable.type,
          nullClass,
          row.allocation,
        );
      }
      return `<span class="mem-value">${visibleItems[0].value}</span>`;
    }

    return `<span class="memory-row-items">${visibleItems
      .map(
        (item) =>
          `<span class="memory-row-item"><span class="memory-row-item-label">${item.label}</span><span class="memory-row-item-value">${item.value}</span></span>`,
      )
      .join("")}</span>`;
  }

  renderMemoryRow(row, regionClass) {
    const classes = [regionClass, "memory-row"];
    if (row.isNew) classes.push("new-cell");
    if (row.allocation) classes.push("allocation-linked");
    if (row.allocation && row.allocation.freed) classes.push("allocation-freed");
    if (Number.isFinite(row.groupHue)) classes.push("memory-row-grouped");
    const name = row.declaration
      ? this.renderMemName(row.declaration)
      : `<span class="memory-row-blank" aria-hidden="true"></span>`;
    const styles = [];
    if (row.allocation) styles.push(`--alloc-hue:${row.allocation.hue}`);
    if (Number.isFinite(row.groupHue)) styles.push(`--row-group-hue:${row.groupHue}`);
    const styleAttr = styles.length > 0 ? ` style="${styles.join(";")}"` : "";
    return `<div class="${classes.join(" ")}" data-addr="${row.address}" data-base="${row.base}"${styleAttr}>${name}${this.renderRowItems(row)}<span class="mem-addr">${this.hex(row.address)}</span></div>`;
  }

  renderStack(mem) {
    if (mem.stack.length === 0) {
      this.stackEl.innerHTML = '<div class="empty-state">Run code to see stack</div>';
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

      const rows = [];
      for (const [name, v] of frame.vars) {
        rows.push(...this.buildVariableRows(name, v, mem, this.isNewVar(frame.name, name)));
      }
      rows.sort((a, b) => b.address - a.address);
      html += rows.map((row) => this.renderMemoryRow(row, "mem-cell")).join("");
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
      const blockClasses = [
        "heap-block",
        "allocation-linked",
      ];

      if (block.freed) {
        blockClasses.push("freed", "allocation-freed");
      }

      const isCharArray =
        Array.isArray(block.bytes) &&
        block.type?.base === "char" &&
        block.type?.pointer === 0;

      const displayType = isCharArray
        ? "char"
        : this.formatType(
            block.type || {
              base: "int",
              pointer: 0,
            },
          );

      const arrayLength = isCharArray
        ? block.size
        : block.elemCount;

      html += `
        <div
          class="${blockClasses.join(" ")}"
          data-base="${addr}"
          ${this.allocationStyleAttr(allocation)}
        >
      `;

      html += `
        <div
          class="heap-block-header"
          data-addr="${addr}"
        >
      `;

      html += `
        <span class="heap-block-title">
          <span class="heap-badge">malloc</span>
          <span class="heap-block-address">
            ${this.hex(addr)}
          </span>
        </span>
      `;

      html += `
        <span class="size-info">
          ${block.size} bytes
          ${block.freed ? " (freed)" : ""}
        </span>
      `;

      html += `</div>`;
      html += `<div class="heap-block-body">`;

      for (let rowIndex = 0; rowIndex < block.elemCount; rowIndex++) {
        const cellAddr = addr + rowIndex * 4;
        const rowByteStart = rowIndex * 4;
        const rowByteEnd = Math.min(
          rowByteStart + 4,
          block.size,
        );

        html += `
          <div
            class="mem-cell memory-row memory-row-grouped"
            data-addr="${cellAddr}"
            data-base="${addr}"
            style="--row-group-hue:${allocation.hue}"
          >
        `;

        if (rowIndex === 0) {
          html += this.renderMemName(
            `<span class="mem-type">${displayType}</span>[${arrayLength}]`,
          );
        } else {
          html += `
            <span
              class="memory-row-blank"
              aria-hidden="true"
            ></span>
          `;
        }

        html += `<span class="memory-row-items">`;

        if (isCharArray) {
          for (
            let byteIndex = rowByteStart;
            byteIndex < rowByteEnd;
            byteIndex++
          ) {
            const value = block.bytes[byteIndex] ?? 0;

            html += `
              <span class="memory-row-item">
                <span class="memory-row-item-label">
                  [${byteIndex}]
                </span>

                <span class="memory-row-item-value ${
                  block.freed ? "freed" : ""
                }">
                  ${value}
                </span>
              </span>
            `;
          }
        } else {
          const value = block.values[rowIndex] ?? 0;

          html += `
            <span class="memory-row-item">
              <span class="memory-row-item-label">
                [${rowIndex}]
              </span>

              <span class="memory-row-item-value ${
                block.freed ? "freed" : ""
              }">
                ${this.formatVal(value, block.type)}
              </span>
            </span>
          `;
        }

        html += `</span>`;

        html += `
          <span class="mem-addr">
            ${this.hex(cellAddr)}
          </span>
        `;

        html += `</div>`;
      }

      html += `</div>`;
      html += `</div>`;
    }

    this.heapEl.innerHTML = html;
  }

  renderGlobals(mem) {
    if (mem.globals.size === 0) {
      this.globalEl.innerHTML = '<div class="empty-state">No global variables</div>';
      return;
    }

    let html = "";
    const rows = [];
    for (const [name, v] of mem.globals) {
      const displayName = v.displayName || name;
      rows.push(...this.buildVariableRows(displayName, v, mem));
    }
    rows.sort((a, b) => a.address - b.address);
    html += rows.map((row) => this.renderMemoryRow(row, "global-cell")).join("");
    this.globalEl.innerHTML = html;
  }

  clear() {
    this.stackEl.innerHTML = '<div class="empty-state">Run code to see stack</div>';
    this.heapEl.innerHTML = '<div class="empty-state">No heap allocations</div>';
    this.globalEl.innerHTML = '<div class="empty-state">No global variables</div>';
    this.prevState = null;
  }
}
