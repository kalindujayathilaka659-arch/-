const fs = require('fs')
const path = require('path')
const chokidar = require('chokidar')

module.exports = function (client) {
    const pluginsPath = __dirname

    // Function to load plugin
    const loadPlugin = (file) => {
        if (!file.endsWith('.js') || file === 'loader.js') return
        try {
            const pluginPath = path.join(pluginsPath, file)
            delete require.cache[require.resolve(pluginPath)] // clear cache
            const plugin = require(pluginPath)
            if (typeof plugin === 'function') plugin(client)
            console.log(`✅ Loaded plugin: ${file}`)
        } catch (err) {
            console.log(`❌ Failed to load plugin ${file}:`, err)
        }
    }

    // Load all plugins on startup
    fs.readdirSync(pluginsPath).forEach(loadPlugin)

    // Watch for new plugins
    chokidar.watch(pluginsPath, { ignoreInitial: true }).on('add', loadPlugin)
}
