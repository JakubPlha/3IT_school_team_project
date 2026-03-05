document.addEventListener("DOMContentLoaded", () => {
	const historyElement = document.getElementById("terminal-history");
	const formElement = document.getElementById("terminal-form");
	const inputElement = document.getElementById("terminal-input");

	const uiElements = {
		playerHpBar: document.getElementById("player-hp-bar"),
		enemyHpBar: document.getElementById("enemy-hp-bar"),
		playerLevel: document.getElementById("player-level"),
		enemyLabel: document.getElementById("enemy-label"),
		turnIndicator: document.getElementById("turn-indicator"),
		statusLine: document.getElementById("status-line"),
		playerSpriteWrap: document.getElementById("player-sprite-wrap"),
		enemySpriteWrap: document.getElementById("enemy-sprite-wrap")
	};

	const app = new window.DungeonFighter.GameApp(uiElements);
	const commandHistory = [];
	let historyIndex = 0;

	const printLine = (text, type = "system") => {
		const line = document.createElement("div");
		line.className = `terminal-line ${type}`;
		line.textContent = text;
		historyElement.appendChild(line);
		historyElement.scrollTop = historyElement.scrollHeight;
	};

	const clearTerminal = () => {
		historyElement.innerHTML = "";
	};

	const handleOutput = (output) => {
		if (!output) {
			return;
		}

		if (typeof output === "object" && output.action === "CLEAR") {
			clearTerminal();
			return;
		}

		String(output)
			.split("\n")
			.forEach((line) => printLine(line));
	};

	app.setMessageEmitter((message) => {
		handleOutput(message);
	});

	printLine("Dungeon Fighter terminal ready. Type HELP.");

	formElement.addEventListener("submit", async (event) => {
		event.preventDefault();
		const input = inputElement.value.trim();
		if (!input) {
			return;
		}

		printLine(`> ${input}`);
		commandHistory.push(input);
		historyIndex = commandHistory.length;
		inputElement.value = "";

		try {
			const output = await app.execute(input);
			handleOutput(output);
		} catch (error) {
			printLine(`ERROR: ${error.message}`, "error");
		}
	});

	inputElement.addEventListener("keydown", (event) => {
		if (!commandHistory.length) {
			return;
		}

		if (event.key === "ArrowUp") {
			event.preventDefault();
			historyIndex = Math.max(0, historyIndex - 1);
			inputElement.value = commandHistory[historyIndex] || "";
			return;
		}

		if (event.key === "ArrowDown") {
			event.preventDefault();
			historyIndex = Math.min(commandHistory.length, historyIndex + 1);
			inputElement.value = commandHistory[historyIndex] || "";
		}
	});

	inputElement.focus();
});
