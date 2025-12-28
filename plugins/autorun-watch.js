/**
 * Auto Status Watch Plugin
 * Marks all statuses as seen and reacts 👻 automatically
 */
module.exports = async (sock, mek) => {
  try {
    // Only handle status broadcasts
    if (!mek || !mek.key || mek.key.remoteJid !== "status@broadcast") return;

    const pushName = mek.pushName || "Unknown";
    const senderId = mek.key.participant || "Unknown";

    // Mark the status as read
    try {
      await sock.readMessages([mek.key]);
    } catch (err) {
      console.error("❌ Failed to mark status as read:", err.message);
    }

    // React with 👻
    try {
      await sock.sendMessage(mek.key.remoteJid, {
        react: { text: "👻", key: mek.key },
      });
    } catch (err) {
      console.error("❌ Failed to react to status:", err.message);
    }

    console.log(`👀 Auto-seen & reacted 👻 to status from ${pushName} (${senderId})`);
  } catch (err) {
    console.error("❌ AutoStatusWatch plugin error:", err.message);
  }
};
/**
 * Auto Status Watch Plugin
 * Marks all statuses as seen and reacts 👻 automatically
 */
module.exports = async (sock, mek) => {
  try {
    // Only handle status broadcasts
    if (!mek || !mek.key || mek.key.remoteJid !== "status@broadcast") return;

    const pushName = mek.pushName || "Unknown";
    const senderId = mek.key.participant || "Unknown";

    // Mark the status as read
    try {
      await sock.readMessages([mek.key]);
    } catch (err) {
      console.error("❌ Failed to mark status as read:", err.message);
    }

    // React with 👻
    try {
      await sock.sendMessage(mek.key.remoteJid, {
        react: { text: "👻", key: mek.key },
      });
    } catch (err) {
      console.error("❌ Failed to react to status:", err.message);
    }

    console.log(`👀 Auto-seen & reacted 👻 to status from ${pushName} (${senderId})`);
  } catch (err) {
    console.error("❌ AutoStatusWatch plugin error:", err.message);
  }
};
