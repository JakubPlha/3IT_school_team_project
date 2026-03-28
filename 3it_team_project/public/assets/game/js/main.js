(function () {
	class Player {
		constructor(name = "Traveler") {
			this.name = name;
			this.maxHp = 100;
			this.hp = 100;
			this.level = 1;
			this.stage = 1;
			this.isBlocking = false;
			this.selectedClass = null;
		}

		takeDamage(amount) {
			this.hp = Math.max(0, this.hp - amount);
		}

		healFull() {
			this.hp = this.maxHp;
		}

		increaseLevel(newLevel) {
			this.level = Math.max(this.level, Number(newLevel) || 1);
			this.maxHp = 100 + (this.level - 1) * 8;
			this.hp = Math.min(this.hp, this.maxHp);
		}

		setStage(newStage) {
			this.stage = Math.max(1, Number(newStage) || 1);
		}

		setClass(classNumber) {
			this.selectedClass = Number(classNumber) || null;
		}

		resetProgress() {
			this.maxHp = 100;
			this.hp = 100;
			this.level = 1;
			this.stage = 1;
			this.isBlocking = false;
			this.selectedClass = null;
		}
	}

	class Enemy {
		constructor(stage) {
			this.stage = stage;
			this.name = `DUNGEON FOE ${stage}`;
			this.maxHp = 35 + stage * 14;
			this.hp = this.maxHp;
		}

		takeDamage(amount) {
			this.hp = Math.max(0, this.hp - amount);
		}
	}

	class UIRenderer {
		constructor(elements) {
			this.elements = elements;
		}

		updateAll(player, enemy, turnText) {
			this.updateHp("player", player.hp, player.maxHp);
			this.updateHp("enemy", enemy.hp, enemy.maxHp);
			this.elements.playerLevel.textContent = `LVL ${player.level}`;
			this.elements.enemyLabel.textContent = enemy.name;
			this.elements.turnIndicator.textContent = `TURN: ${turnText}`;
		}

		updateHp(side, value, maxValue) {
			const ratio = maxValue <= 0 ? 0 : (value / maxValue) * 100;
			const width = `${Math.max(0, Math.min(100, ratio))}%`;
			if (side === "player") {
				this.elements.playerHpBar.style.width = width;
				return;
			}
			this.elements.enemyHpBar.style.width = width;
		}

		setStatus(message) {
			this.elements.statusLine.textContent = message;
		}

		animate(type, side) {
			const key = side === "player" ? "playerSpriteWrap" : "enemySpriteWrap";
			const target = this.elements[key];
			const className = type === "block" ? "anim-block" : "anim-hit";
			target.classList.remove("anim-hit", "anim-block");
			void target.offsetWidth;
			target.classList.add(className);
		}
	}

	class BackendApi {
		async request(action, payload) {
			const response = await fetch("backend/auth.php", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action, ...payload })
			});

			const data = await response.json();
			if (!response.ok || !data.ok) {
				throw new Error(data.message || "Backend request failed.");
			}
			return data;
		}

		register(username, password) {
			return this.request("register", { username, password });
		}

		login(username, password) {
			return this.request("login", { username, password });
		}

		updateLevel(username, level) {
			return this.request("update_level", { username, level });
		}
	}

	class CombatController {
		constructor(player, ui, api) {
			this.player = player;
			this.ui = ui;
			this.api = api;
			this.enemy = new Enemy(this.player.stage);
			this.currentUser = null;
			this.turn = "PLAYER";
			this.enemyBlockChance = 0.1;
			this.basePlayerBlockChance = 0.2;
			this.blockWindowMs = 5000;
			this.pendingEnemyAttack = null;
			this.messageEmitter = null;
			this.ui.updateAll(this.player, this.enemy, this.turn);
		}

		setMessageEmitter(emitter) {
			this.messageEmitter = typeof emitter === "function" ? emitter : null;
		}

		emitMessage(message) {
			if (!this.messageEmitter || !message) {
				return;
			}
			this.messageEmitter(message);
		}

		helpText() {
			return [
				"Available commands:",
				"HELP",
				"STATUS",
				"CLEAR",
				"REGISTER <username> <password>",
				"LOGIN <username> <password>",
				"SIGN OUT",
				"CLASS <number>",
				"HIT ENEMY",
				"BLOCK"
			].join("\n");
		}

		statusText() {
			const auth = this.currentUser ? `Logged as ${this.currentUser}` : "Not logged in";
			const selectedClass = this.player.selectedClass ? this.player.selectedClass : "none";
			return [
				`Player: ${this.player.name}`,
				auth,
				`Class: ${selectedClass}`,
				`HP: ${this.player.hp}/${this.player.maxHp}`,
				`Level: ${this.player.level}`,
				`Dungeon stage: ${this.player.stage}`,
				`Enemy HP: ${this.enemy.hp}/${this.enemy.maxHp}`
			].join(" | ");
		}

		async register(username, password) {
			this.cancelPendingEnemyAttack();
			const data = await this.api.register(username, password);
			this.currentUser = data.user.username;
			this.player.increaseLevel(data.user.level);
			this.player.setStage(data.user.level);
			this.player.healFull();
			this.enemy = new Enemy(this.player.stage);
			this.syncUi("PLAYER");
			this.ui.setStatus("Registration successful. Enter combat commands.");
			return `Registered and logged in as ${data.user.username}.`;
		}

		async login(username, password) {
			this.cancelPendingEnemyAttack();
			const data = await this.api.login(username, password);
			this.currentUser = data.user.username;
			this.player.increaseLevel(data.user.level);
			this.player.setStage(data.user.level);
			this.player.healFull();
			this.enemy = new Enemy(this.player.stage);
			this.syncUi("PLAYER");
			this.ui.setStatus(`Welcome back, ${data.user.username}.`);
			return `Login successful. Loaded level ${data.user.level}.`;
		}

		syncUi(turn) {
			this.turn = turn;
			this.ui.updateAll(this.player, this.enemy, this.turn);
		}

		async processCombat(action) {
			if (action === "HIT") {
				if (this.pendingEnemyAttack) {
					return "Enemy attack is incoming. Type BLOCK.";
				}
				return this.performHit();
			}
			if (action === "BLOCK") {
				return this.resolveEnemyAttack(true);
			}
			return "Invalid combat command.";
		}

		async performHit() {
			this.syncUi("PLAYER");
			this.ui.animate("hit", "enemy");
			const lines = ["You attack the enemy!"];

			const enemyBlocked = Math.random() < this.enemyBlockChance;
			if (enemyBlocked) {
				this.ui.animate("block", "enemy");
				this.ui.setStatus("Enemy blocked your attack.");
				lines.push("Enemy blocked the attack!");
			} else {
				const playerDamage = this.randomInt(9 + this.player.level, 15 + this.player.level);
				this.enemy.takeDamage(playerDamage);
				this.ui.setStatus(`Enemy takes ${playerDamage} damage.`);
				lines.push(`Enemy takes ${playerDamage} damage.`);
			}

			this.syncUi("PLAYER");

			if (this.enemy.hp <= 0) {
				const defeatMessage = await this.handleEnemyDefeat();
				lines.push(defeatMessage);
				return lines.join("\n");
			}

			lines.push(this.startEnemyAttackWindow());
			return lines.join("\n");
		}

		startEnemyAttackWindow() {
			this.syncUi("ENEMY");
			this.ui.setStatus("Enemy prepares to attack...");

			this.cancelPendingEnemyAttack();
			this.pendingEnemyAttack = {
				timerId: setTimeout(() => {
					const timeoutMessage = this.resolveEnemyAttack(false);
					this.emitMessage(timeoutMessage);
				}, this.blockWindowMs)
			};

			return 'Enemy prepares to attack...\n(5 seconds to type "block")';
		}

		resolveEnemyAttack(playerAttemptedBlock) {
			if (!this.pendingEnemyAttack) {
				return "No incoming attack to block.";
			}

			clearTimeout(this.pendingEnemyAttack.timerId);
			this.pendingEnemyAttack = null;

			if (playerAttemptedBlock) {
				this.ui.animate("block", "player");
				const blockSuccess = Math.random() < this.getPlayerBlockChance();
				if (blockSuccess) {
					this.syncUi("PLAYER");
					this.ui.setStatus("You blocked the attack!");
					return "You blocked the attack!";
				}

				const failedResult = this.applyEnemyDamage();
				return ["Block failed!", failedResult].join("\n");
			}

			return this.applyEnemyDamage();
		}

		applyEnemyDamage() {
			const enemyDamage = this.randomInt(6 + this.player.stage, 12 + this.player.stage);
			this.player.takeDamage(enemyDamage);
			this.ui.animate("hit", "player");

			if (this.player.hp <= 0) {
				this.player.healFull();
				this.ui.setStatus("You were defeated. HP restored.");
				this.syncUi("PLAYER");
				return `Enemy attacks!\nEnemy deals ${enemyDamage} damage. You were defeated and restored to full HP.`;
			}

			this.ui.setStatus(`Enemy deals ${enemyDamage} damage.`);
			this.syncUi("PLAYER");
			return `Enemy attacks!\nEnemy deals ${enemyDamage} damage.`;
		}

		getPlayerBlockChance() {
			return this.basePlayerBlockChance;
		}

		cancelPendingEnemyAttack() {
			if (!this.pendingEnemyAttack) {
				return;
			}
			clearTimeout(this.pendingEnemyAttack.timerId);
			this.pendingEnemyAttack = null;
		}

		signOut() {
			this.cancelPendingEnemyAttack();
			this.currentUser = null;
			this.player.resetProgress();
			this.enemy = new Enemy(this.player.stage);
			this.syncUi("PLAYER");
			this.ui.setStatus("Signed out. Please login to continue.");
			return "Signed out. Session ended.";
		}

		setPlayerClass(classNumber) {
			if (![1, 2, 3].includes(classNumber)) {
				return "Usage: CLASS <1|2|3>";
			}
			this.player.setClass(classNumber);
			return `Class ${classNumber} selected.`;
		}

		async handleEnemyDefeat() {
			this.cancelPendingEnemyAttack();
			this.player.setStage(this.player.stage + 1);
			const shouldLevelUp = this.player.stage > this.player.level;
			if (shouldLevelUp) {
				this.player.increaseLevel(this.player.level + 1);
			}

			if (this.currentUser) {
				try {
					await this.api.updateLevel(this.currentUser, this.player.level);
				} catch (error) {
					this.ui.setStatus(`Progress save failed: ${error.message}`);
				}
			}

			this.enemy = new Enemy(this.player.stage);
			this.syncUi("PLAYER");
			this.ui.setStatus(`Enemy defeated. Stage ${this.player.stage} begins.`);
			return `Enemy defeated. You advance to stage ${this.player.stage}.`;
		}

		randomInt(min, max) {
			return Math.floor(Math.random() * (max - min + 1)) + min;
		}
	}

	class CommandParser {
		parse(input) {
			const cleaned = (input || "").trim();
			if (!cleaned) {
				return { type: "EMPTY" };
			}

			const tokens = cleaned.split(/\s+/);
			const normalized = tokens.map((token) => token.toUpperCase());

			if (normalized[0] === "HELP") return { type: "HELP" };
			if (normalized[0] === "STATUS") return { type: "STATUS" };
			if (normalized[0] === "CLEAR") return { type: "CLEAR" };
			if (normalized[0] === "SIGN" && normalized[1] === "OUT") return { type: "SIGN_OUT" };
			if (normalized[0] === "CLASS") {
				return { type: "CLASS", classNumber: Number(tokens[1]) };
			}

			if (normalized[0] === "REGISTER") {
				return { type: "REGISTER", username: tokens[1], password: tokens[2] };
			}

			if (normalized[0] === "LOGIN") {
				return { type: "LOGIN", username: tokens[1], password: tokens[2] };
			}

			if (normalized[0] === "HIT" && normalized[1] === "ENEMY") {
				return { type: "COMBAT", action: "HIT" };
			}

			if (normalized[0] === "BLOCK") {
				return { type: "COMBAT", action: "BLOCK" };
			}

			return { type: "UNKNOWN" };
		}
	}

	class GameApp {
		constructor(uiElements) {
			this.ui = new UIRenderer(uiElements);
			this.api = new BackendApi();
			this.player = new Player();
			this.combat = new CombatController(this.player, this.ui, this.api);
			this.parser = new CommandParser();
		}

		setMessageEmitter(emitter) {
			this.combat.setMessageEmitter(emitter);
		}

		async execute(rawInput) {
			const command = this.parser.parse(rawInput);

			if (command.type === "EMPTY") {
				return "";
			}

			if (command.type === "HELP") {
				return this.combat.helpText();
			}

			if (command.type === "STATUS") {
				return this.combat.statusText();
			}

			if (command.type === "CLEAR") {
				return { action: "CLEAR" };
			}

			if (command.type === "REGISTER") {
				if (!command.username || !command.password) {
					return "Usage: REGISTER <username> <password>";
				}
				return this.combat.register(command.username, command.password);
			}

			if (command.type === "LOGIN") {
				if (!command.username || !command.password) {
					return "Usage: LOGIN <username> <password>";
				}
				return this.combat.login(command.username, command.password);
			}

			if (command.type === "SIGN_OUT") {
				return this.combat.signOut();
			}

			if (command.type === "CLASS") {
				if (!Number.isInteger(command.classNumber)) {
					return "Usage: CLASS <1|2|3>";
				}
				return this.combat.setPlayerClass(command.classNumber);
			}

			if (command.type === "COMBAT") {
				return this.combat.processCombat(command.action);
			}

			return "Unknown command. Type HELP.";
		}
	}

	window.DungeonFighter = { GameApp };
})();
