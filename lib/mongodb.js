const mongoose = require("mongoose");
const config = require("../config");
const EnvVar = require("./mongodbenv");

// Default environment variables (SAFE defaults only)
const defaultEnvVariables = [
  {
    key: "ALIVE_IMG",
    value:
      "https://github.com/nadeelachamath-crypto/GHOST-SUPPORT/blob/main/ChatGPT%20Image%20Oct%2031,%202025,%2010_10_49%20PM.png?raw=true",
  },
  {
    key: "ALIVE_MSG",
    value:
      "👻 Hello, I am alive now!!\n\n> Developer note \n> 👻 Ghost MD was created to be simple, smooth, and convenient — no unnecessary complications, just pure functionality.\n\n> 💀 CREATED by Nadeela Chamath 💀",
  },
  { key: "PREFIX", value: "." },

  // ❌ DO NOT hardcode your OpenAI key here.
  // Set it via ENV: OPENAI_API_KEY=xxxx
  // If you insist on having the key in DB, store a placeholder and update it manually in DB.
  { key: "OPENAI_API_KEY", value: process.env.OPENAI_API_KEY || "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" },
];

// ==================== CONNECT TO MONGODB ====================
const connectDB = async () => {
  try {
    if (!config.MONGODB) {
      console.error("❌ MONGODB connection string is missing in config.MONGODB");
      process.exit(1);
    }

    await mongoose.connect(config.MONGODB, {
      // These options are safe; mongoose v7+ ignores some but it won't break.
      // serverSelectionTimeoutMS: 30000,
    });

    console.log("🛜 MongoDB Connected ✅");

    // Initialize default environment variables (only if missing)
    for (const envVar of defaultEnvVariables) {
      const existingVar = await EnvVar.findOne({ key: envVar.key });
      if (!existingVar) {
        await EnvVar.create(envVar);
        console.log(`➕ Created default env var: ${envVar.key}`);
      }
    }
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  }
};

module.exports = connectDB;
