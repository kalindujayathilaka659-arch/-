const mongoose = require('mongoose');
const config = require('../config');
const EnvVar = require('./mongodbenv');

const defaultEnvVariables = [
    { key: 'ALIVE_IMG', value: 'https://github.com/nadeelachamath-crypto/GHOST-SUPPORT/blob/main/ChatGPT%20Image%20Oct%2031,%202025,%2010_10_49%20PM.png?raw=true' },
    { key: 'ALIVE_MSG', value: '👻 Hello, I am alive now!!\n\n> Developer note \n> 👻 Ghost MD was created to be simple, smooth, and convenient — no unnecessary complications, just pure functionality.\n\n> 💀 CREATED by Nadeela Chamath 💀' },
    { key: 'PREFIX', value: '.' },
];

// ==================== CONNECT TO MONGODB ====================
const connectDB = async () => {
    try {
        await mongoose.connect(config.MONGODB);
        console.log('🛜 MongoDB Connected ✅');

        // Initialize default environment variables
        for (const envVar of defaultEnvVariables) {
            const existingVar = await EnvVar.findOne({ key: envVar.key });
            if (!existingVar) {
                await EnvVar.create(envVar);
                console.log(`➕ Created default env var: ${envVar.key}`);
            }
        }

    } catch (err) {
        console.error('❌ MongoDB connection error:', err);
        process.exit(1);
    }
};

module.exports = connectDB;
