const fs = require("fs");
const path = require("path");

const commands = [];

function cmd(options, callback) {
  if (!options.pattern || typeof callback !== "function") {
    console.error("Invalid command definition:", options);
    return;
  }

  commands.push({ ...options, function: callback }); // FIXED HERE
}

function loadPlugins() {
  const pluginPath = path.join(__dirname, "../plugins");

  if (!fs.existsSync(pluginPath)) return;

  const files = fs.readdirSync(pluginPath).filter(file => file.endsWith(".js"));

  for (const file of files) {
    const pluginFile = path.join(pluginPath, file);
    try {
      require(pluginFile); // plugin should call cmd()
      console.log(`✅ Loaded plugin: ${file}`);
    } catch (err) {
      console.error(`❌ Failed to load plugin ${file}:`, err.message);
    }
  }
}

function getCommands() {
  return commands;
}

module.exports = {
  cmd,
  loadPlugins,
  commands // This allows you to access the command list directly in index.js
};
