const { execFileSync } = require("node:child_process");
const path = require("node:path");

const backendDir = path.resolve(__dirname, "..");

function sequelizeCli(...args) {
  execFileSync("npx", ["sequelize-cli", ...args], {
    cwd: backendDir,
    env: { ...process.env, NODE_ENV: "test" },
    stdio: "pipe",
    shell: process.platform === "win32",
  });
}

//? Build the test database the way a reviewer would build a real one: roll
//? everything back, then migrate up. A migration that is not reversible or
//? not reproducible from clean fails the whole backend suite here, rather
//? than somewhere more confusing later.
module.exports = function setup() {
  sequelizeCli("db:migrate:undo:all");
  sequelizeCli("db:migrate");
};
