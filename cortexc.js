const parseBtn = document.getElementById("parseBtn");
const codeInput = document.getElementById("codeInput");
const output = document.getElementById("output");

// TODO: change to run or execute button
parseBtn.addEventListener("click", () => {
    const code = codeInput.value;
    console.log(`code:\n${code}`);
    parseCode(code);
});

function parseCode(code) {
    const lines = code.split("\n");
    output.textContent = "";

    lines.forEach((rawLine, index) => {
        console.log(`${index}: ${rawLine}`);
        const line = rawLine.trim();

        if (line === "") return;

        const result = parseLine(line);

        // update console
        if (result) {
            output.textContent += JSON.stringify(result) + "\n";
        } else {
            output.textContent += `Unrecognized: ${line}\n`;
        }
    });
}

function parseLine(line) {
    // initialized variable (int x = 4;)
    let match = line.match(/^int\s+([a-zA-Z_]\w*)\s*=\s*(-?\d+)\s*;$/);
    if (match) {
        console.log(match);
        return {
            type: "variable_declaration",
            dataType: "int",
            name: match[1],
            value: parseInt(match[2]),
            initialized: true
        };
    }

    // default initialized variable (int x;)
    match = line.match(/^int\s+([a-zA-Z_]\w*)\s*;$/);
    if (match) {
        return {
            type: "variable_declaration",
            dataType: "int",
            name: match[1],
            value: null,
            initialized: false
        };
    }

    return null;
}