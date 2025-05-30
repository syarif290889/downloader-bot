require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');

// ==== KONFIGURASI ====
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID || 0);
const DONASI_LINK = process.env.DONASI_LINK || 'https://t.me/ModuleGoten/224';
const MAX_LIMIT = Number(process.env.MAX_LIMIT || 10);
const MAX_FILE_MB = 49; // Telegram upload limit
const PORT = process.env.PORT || 8080;
const PUBLIC_HOST = process.env.PUBLIC_HOST || "127.0.0.1";

// ==== UTILITY ====
function getDownloadFolder() {
  const isTermux = process.platform === 'android' || (process.env.PREFIX && process.env.PREFIX.includes('/data/data/com.termux'));
  if (isTermux) return '/data/data/com.termux/files/home/downloader-bot/downloads';
  if (os.platform() === 'win32') return path.join(process.env.USERPROFILE || 'C:\\Users\\Administrator', 'Downloads', 'downloader-bot');
  return path.join(os.homedir(), 'Downloads', 'downloader-bot');
}
const DOWNLOAD_FOLDER = getDownloadFolder();
if (!fs.existsSync(DOWNLOAD_FOLDER)) fs.mkdirSync(DOWNLOAD_FOLDER, { recursive: true });

function getOutPath(filename) {
  return path.join(DOWNLOAD_FOLDER, filename);
}
function escapeHtml(text) {
  if (!text) return '';
  return text.toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function getFileSizeMB(filePath) {
  try { const stats = fs.statSync(filePath); return stats.size / (1024 * 1024); } catch { return 0; }
}
function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, '').slice(0, 60);
}
async function safeDelete(bot, chatId, msgId, delay = 40000) {
  setTimeout(() => bot.deleteMessage(chatId, msgId).catch(()=>{}), delay);
}
function getPlatformDownloadInfo() {
  const isTermux = process.platform === 'android' || (process.env.PREFIX && process.env.PREFIX.includes('/data/data/com.termux'));
  const isWin = os.platform() === 'win32';
  if (isTermux) {
    return "\n\n📂 File hasil download bisa diakses di folder:\n/storage/emulated/0/Download/Telegram/ (Android/Termux)\nAtau: " + DOWNLOAD_FOLDER;
  }
  if (isWin) {
    return "\n\n📂 File hasil download ada di folder:\nC:\\Users\\Administrator\\Downloads\\downloader-bot";
  }
  return "\n\n📂 File hasil download tersimpan di folder:\n" + DOWNLOAD_FOLDER;
}
function scheduleDeleteFile(outPath) {
  setTimeout(() => {
    if (fs.existsSync(outPath)) {
      try {
        fs.unlinkSync(outPath);
        console.log(`[AUTO DELETE] File ${outPath} dihapus setelah 1 menit`);
      } catch (e) {
        console.log(`[DELETE ERROR] Gagal hapus file: ${outPath}, error: ${e}`);
      }
    }
  }, 60000);
}

// ==== AUTO CLEANUP FOLDER ====
setInterval(() => {
  fs.readdir(DOWNLOAD_FOLDER, (err, files) => {
    if (err) return;
    files.forEach(file => {
      const filePath = path.join(DOWNLOAD_FOLDER, file);
      if (fs.existsSync(filePath) && fs.lstatSync(filePath).isFile()) {
        try {
          fs.unlinkSync(filePath);
          console.log(`[CLEANUP] File ${filePath} dihapus oleh cleanup`);
        } catch (e) {
          console.log(`[CLEANUP ERROR] ${filePath}: ${e}`);
        }
      }
    });
  });
}, 10 * 60 * 1000);

// ==== LOG AKTIVITAS USER KE ADMIN SETIAP AKSI ====
function adminActivityLog(msg, keterangan="") {
  if (!ADMIN_ID) return;
  const from = msg.from || (msg.chat && msg.chat.id && msg.chat);
  const chat = msg.chat || (msg.message && msg.message.chat);
  const id = from.id;
  const username = from.username || "-";
  const first_name = from.first_name || "";
  const last_name = from.last_name || "";
  const chatType = chat.type || (msg.chat && msg.chat.type) || "-";
  const chatId = chat.id || "-";
  const logText =
    `📝 <b>AKTIVITAS USER</b>\n` +
    `ID: <code>${id}</code>\n` +
    `Username: <b>${escapeHtml(username)}</b>\n` +
    `Nama: ${escapeHtml(first_name)} ${escapeHtml(last_name)}\n` +
    `Chat Type: ${chatType}\n` +
    `Chat ID: <code>${chatId}</code>\n` +
    (keterangan ? `Aktivitas: ${escapeHtml(keterangan)}` : "");
  bot.sendMessage(ADMIN_ID, logText, { parse_mode: "HTML" }).catch(()=>{});
}

// ==== TELEGRAM BOT ====
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

let premiumUsers = new Set();
let dailyLimit = {};
const PREMIUM_FILE = 'premium-users.json';
function savePremium() { fs.writeFileSync(PREMIUM_FILE, JSON.stringify([...premiumUsers]), 'utf8'); }
function loadPremium() { if (fs.existsSync(PREMIUM_FILE)) try { premiumUsers = new Set(JSON.parse(fs.readFileSync(PREMIUM_FILE, 'utf8'))); } catch {} }
loadPremium();
setInterval(() => { dailyLimit = {}; }, 1000 * 60 * 60 * 24);

// ==== ADMIN PREMIUM COMMANDS ====
// Tambah user ke premium
bot.onText(/^\/addpremium(?:\s+(\d+))?$/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const userId = Number(match[1]);
  if (!userId) return bot.sendMessage(msg.chat.id, "Format: /addpremium user_id");
  premiumUsers.add(userId);
  savePremium();
  bot.sendMessage(msg.chat.id, `✅ User <code>${userId}</code> berhasil ditambahkan ke premium.`, { parse_mode: "HTML" });
});

// Daftar semua user premium
bot.onText(/^\/listpremium$/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  if (!premiumUsers.size) return bot.sendMessage(msg.chat.id, "❌ Tidak ada user premium.");
  let text = "<b>Daftar User Premium:</b>\n";
  premiumUsers.forEach(uid => {
    text += `<code>${uid}</code>\n`;
  });
  bot.sendMessage(msg.chat.id, text, { parse_mode: "HTML" });
});

// Hapus user premium
bot.onText(/^\/deletepremium(?:\s+(\d+))?$/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const userId = Number(match[1]);
  if (!userId) return bot.sendMessage(msg.chat.id, "Format: /deletepremium user_id");
  if (premiumUsers.delete(userId)) {
    savePremium();
    bot.sendMessage(msg.chat.id, `✅ User <code>${userId}</code> berhasil dihapus dari premium.`, { parse_mode: "HTML" });
  } else {
    bot.sendMessage(msg.chat.id, `❌ User <code>${userId}</code> tidak ditemukan di daftar premium.`, { parse_mode: "HTML" });
  }
});

// Reset semua user premium
bot.onText(/^\/resetpremium$/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  premiumUsers = new Set();
  savePremium();
  bot.sendMessage(msg.chat.id, "✅ Semua user premium telah direset (dikosongkan).");
});

// ==== TV INDONESIA SESUAI REQUEST ====
const TV_ID_INLINE = [
  [
    { text: "RCTI TV 🇮🇩", url: "https://sindikasi.inews.id/embed/video/YWdlbnQ9ZGVza3RvcCZ1cmw9aHR0cHMlM0ElMkYlMkZlbWJlZC5yY3RpcGx1cy5jb20lMkZsaXZlJTJGcmN0aSUyRmluZXdzaWQmaGVpZ2h0PTEwMCUyNSZ3aWR0aD0xMDAlMjU=" },
    { text: "GLOBAL TV 🇮🇩", url: "https://sindikasi.inews.id/embed/video/YWdlbnQ9ZGVza3RvcCZ1cmw9aHR0cHMlM0ElMkYlMkZlbWJlZC5yY3RpcGx1cy5jb20lMkZsaXZlJTJGZ3R2JTJGaW5ld3NpZCZoZWlnaHQ9MTAwJTI1JndpZHRoPTEwMCUyNQ==" }
  ],
  [
    { text: "INEWS TV 🇮🇩", url: "https://sindikasi.inews.id/embed/video/YWdlbnQ9ZGVza3RvcCZ1cmw9aHR0cHMlM0ElMkYlMkZlbWJlZC5yY3RpcGx1cy5jb20lMkZsaXZlJTJGaW5ld3MlMkZpbmV3c2lkJmhlaWdodD0xMDAlMjUmd2lkdGg9MTAwJTI1" },
    { text: "MNCTV 🇮🇩", url: "https://sindikasi.inews.id/embed/video/YWdlbnQ9ZGVza3RvcCZ1cmw9aHR0cHMlM0ElMkYlMkZlbWJlZC5yY3RpcGx1cy5jb20lMkZsaXZlJTJGbW5jdHYlMkZpbmV3c2lkJmhlaWdodD0xMDAlMjUmd2lkdGg9MTAwJTI1" }
  ],
  [
    { text: "TRANS7 TV 🇮🇩", url: "https://20.detik.com/watch/livestreaming-trans7" },
    { text: "TRANS TV 🇮🇩", url: "https://20.detik.com/watch/livestreaming-transtv" }
  ],
  [
    { text: "CNN INDONESIA 🇮🇩", url: "https://www.cnnindonesia.com/tv/embed?ref=transmedia" },
    { text: "CNBC INDONESIA 🇮🇩", url: "https://www.cnbcindonesia.com/embed/tv?ref=transmedia" }
  ],
  [
    { text: "SCTV INDONESIA 🇮🇩", url: "https://m.vidio.com/live/204-sctv-tv-stream/embed?autoplay=true&player_only=true&live_chat=false&mute=false&" },
    { text: "METRO TV 🇮🇩", url: "https://www.metrotvnews.com/live" }
  ],
  [
    { text: "TV ONE INDONESIA 🇮🇩", url: "https://www.tvonenews.com/live" }
  ]
];

// Tambahan Streaming Anime & Douyin
const ANIME_INLINE = [
  [
    { text: "ANIME CHINA SUB INDO", url: "https://anichin.care/" },
    { text: "SAMEHADAKU", url: "https://samehadaku.care/" }
  ],
  [
    { text: "TIKTOK CHINA DOUYIN", url: "https://www.douyin.com/" }
  ]
];

// Tombol utama saat /mulai
const MULAI_INLINE = [
  [{ text: "📺 TV Indonesia 🇮🇩", callback_data: "menu_tv_id" }],
  [{ text: "⚽ TV BOLA Online 🇮🇩", url: "https://www.rbtv77.yoga/id" }],
  ...ANIME_INLINE,
  [{ text: "👨‍💻 Developer", url: "https://t.me/gotenbest" }],
  [{ text: "💰 Donasi", url: DONASI_LINK }]
];

// Tombol download/streaming (muncul saat user kirim URL)
const MENU_INLINE = [
  [{ text: "⬇️ Video", callback_data: "menu_video" }],
  [{ text: "🎵 MP3", callback_data: "menu_mp3" }],
  [{ text: "▶️ Streaming", callback_data: "menu_stream" }]
];
const DONASI_INLINE = [
  [{ text: "👨‍💻 Developer", url: "https://t.me/gotenbest" }],
  [{ text: "💰 Donasi", url: DONASI_LINK }]
];

// ==== DESKRIPSI BOT ====
const DESKRIPSI =
  "<b>Universal Downloader</b> (goten)\n\n" +
  "Download video, audio, dan streaming Anime Support (YouTube, TikTok, IG, FB, 18+ ).\n\n" +
  "1. Ketik /mulai untuk memulai.\n" +
  "2. Kirim link video/audio/streaming ke bot ini.\n" +
  "3. Pilih mode download (Video/MP3/Streaming).\n" +
  "4. Ikuti instruksi selanjutnya!\n\n" +
  "Limit download: 10x/hari/user (admin unlimited).\n" +
  "Developer: @Goten_Reallaccount";

// ==== BANNER STATUS TERMINAL ====
console.log(`
==============================================
🚀 Universal Downloader BOT AKTIF & SIAP PAKAI
🟢 Telegram Bot Menunggu Pesan...
📱 Download Folder: ${DOWNLOAD_FOLDER}
🌐 Streaming: http://${PUBLIC_HOST}:${PORT}/stream/
==============================================
`);

// ==== EXPRESS STATIC FOR STREAMING ====
const app = express();
app.use('/stream', express.static(DOWNLOAD_FOLDER, { setHeaders: res => res.set('Access-Control-Allow-Origin', '*') }));
app.listen(PORT, () => {
  console.log(`BOT streaming berjalan di http://${PUBLIC_HOST}:${PORT}/stream/`);
});

// ==== STATE USER ====
let userStates = {};

// ==== HANDLE /mulai ====
bot.onText(/^\/mulai$/, (msg) => {
  adminActivityLog(msg, "Menekan /mulai");
  bot.sendMessage(msg.chat.id, DESKRIPSI, {
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: MULAI_INLINE }
  });
});

// ==== HANDLE TV INDONESIA MENU ====
bot.on("callback_query", async (cb) => {
  if(cb.data === "menu_tv_id") {
    await bot.sendMessage(cb.message.chat.id, "Pilih channel TV Indonesia:", {
      reply_markup: { inline_keyboard: TV_ID_INLINE }
    });
    return;
  }

  // === HANDLE MENU DOWNLOAD/STREAMING ===
  const chatId = cb.message.chat.id;
  const userId = cb.from.id;
  const state = userStates[userId] || {};
  const url = state.lastUrl;
  const realTitle = state.realTitle || "downloaded";
  const formats = state.formats || [];
  const isDirectMp4 = state.isDirectMp4;
  const directExt = state.directExt;

  if (!url && !cb.data.startsWith("menu_tv_id")) {
    bot.answerCallbackQuery(cb.id, { text: "Kirim link video/audio/streaming dulu!", show_alert: true });
    return;
  }

  // === VIDEO MENU ===
  if (cb.data === "menu_video") {
    if (isDirectMp4) {
      const outPath = getOutPath(`${realTitle}.${directExt}`);
      const file = fs.createWriteStream(outPath);
      https.get(url, (response) => {
        response.pipe(file);
        file.on('finish', async () => {
          file.close();
          let filesize = getFileSizeMB(outPath);
          if (filesize <= MAX_FILE_MB) {
            try { await bot.sendVideo(chatId, outPath, { caption: realTitle }); }
            catch (e) { await bot.sendMessage(chatId, "❌ Gagal upload video ke Telegram."); }
          } else {
            const fileUrl = `http://${PUBLIC_HOST}:${PORT}/stream/${encodeURIComponent(path.basename(outPath))}`;
            await bot.sendMessage(chatId, `File video terlalu besar. Download manual:\n${fileUrl}` + getPlatformDownloadInfo());
          }
          scheduleDeleteFile(outPath);
        });
      }).on('error', async (e) => {
        await bot.sendMessage(chatId, "❌ Gagal download file direct.");
      });
      return;
    }
    let resButtons = [];
    let found = {};
    formats.forEach(f => {
      if (f.height && !found[f.height]) {
        resButtons.push({ text: f.height + "p", callback_data: `res_video_${f.height}` });
        found[f.height] = true;
      }
    });
    resButtons = resButtons.sort((a, b) => parseInt(b.text) - parseInt(a.text));
    const keyboard = [];
    for (let i = 0; i < resButtons.length; i += 3) {
      keyboard.push(resButtons.slice(i, i + 3));
    }
    if (keyboard.length === 0) {
      return bot.sendMessage(chatId, "❌ Tidak ada resolusi video yang tersedia.");
    }
    await bot.sendMessage(chatId, `Pilih resolusi video:`, {
      reply_markup: { inline_keyboard: keyboard }
    });
    return;
  }

  // === MP3 MENU ===
  if (cb.data === "menu_mp3") {
    if (isDirectMp4 && /^(mp3|m4a|aac|wav|flac)$/i.test(directExt)) {
      const outPath = getOutPath(`${realTitle}.${directExt}`);
      const file = fs.createWriteStream(outPath);
      https.get(url, (response) => {
        response.pipe(file);
        file.on('finish', async () => {
          file.close();
          let filesize = getFileSizeMB(outPath);
          if (filesize <= MAX_FILE_MB) {
            try { await bot.sendAudio(chatId, outPath, { title: realTitle }); }
            catch (e) { await bot.sendMessage(chatId, "❌ Gagal upload audio ke Telegram."); }
          } else {
            const fileUrl = `http://${PUBLIC_HOST}:${PORT}/stream/${encodeURIComponent(path.basename(outPath))}`;
            await bot.sendMessage(chatId, `File audio terlalu besar. Download manual:\n${fileUrl}` + getPlatformDownloadInfo());
          }
          scheduleDeleteFile(outPath);
        });
      }).on('error', async (e) => {
        await bot.sendMessage(chatId, "❌ Gagal download file direct.");
      });
      return;
    }
    const outPath = getOutPath(`${realTitle}.mp3`);
    const ytdlpCmd = `yt-dlp --extract-audio --audio-format mp3 -o "${outPath}" "${url}"`;
    try {
      await new Promise((resolve, reject) => { exec(ytdlpCmd, { timeout: 10 * 60_000 }, (e, stdout, stderr) => e ? reject(stderr || e.message) : resolve()); });
    } catch (e) {
      return bot.sendMessage(chatId, `❌ Gagal download audio (proses yt-dlp):\n${e}`);
    }
    let filesize = getFileSizeMB(outPath);
    if (filesize === 0 || !fs.existsSync(outPath)) return bot.sendMessage(chatId, "❌ Gagal download audio (file tidak ditemukan).");
    if (filesize <= MAX_FILE_MB) {
      try {
        await bot.sendAudio(chatId, outPath, { title: realTitle });
      } catch (e) {
        return bot.sendMessage(chatId, "❌ Gagal upload audio ke Telegram.");
      }
    } else {
      const fileUrl = `http://${PUBLIC_HOST}:${PORT}/stream/${encodeURIComponent(path.basename(outPath))}`;
      await bot.sendMessage(chatId, `File audio terlalu besar (>49MB). Download manual di browser:\n${fileUrl}` + getPlatformDownloadInfo());
    }
    const d = await bot.sendMessage(chatId, "Jangan lupa donasi ya boss kuh..", { reply_markup: { inline_keyboard: DONASI_INLINE } });
    safeDelete(bot, chatId, d.message_id, 40000);
    scheduleDeleteFile(outPath);
    if (userId !== ADMIN_ID && !premiumUsers.has(userId)) dailyLimit[userId]++;
    return;
  }

  // === STREAMING MENU ===
  if (cb.data === "menu_stream") {
    const outPath = getOutPath(`${realTitle}_stream.mp4`);
    const ytdlpCmd = `yt-dlp -f "bv*+ba/b" --merge-output-format mp4 -o "${outPath}" "${url}"`;
    try {
      await new Promise((resolve, reject) => { exec(ytdlpCmd, { timeout: 10 * 60_000 }, (e, stdout, stderr) => e ? reject(stderr || e.message) : resolve()); });
    } catch (e) {
      return bot.sendMessage(chatId, `❌ Gagal download video untuk streaming:\n${e}`);
    }
    if (!fs.existsSync(outPath)) return bot.sendMessage(chatId, "❌ File video streaming tidak ditemukan.");
    const fileUrl = `http://${PUBLIC_HOST}:${PORT}/stream/${encodeURIComponent(path.basename(outPath))}`;
    await bot.sendMessage(chatId, `Klik untuk streaming di browser:\n${fileUrl}` + getPlatformDownloadInfo());
    const d = await bot.sendMessage(chatId, "Jangan lupa donasi ya boss kuh..", { reply_markup: { inline_keyboard: DONASI_INLINE } });
    safeDelete(bot, chatId, d.message_id, 40000);
    scheduleDeleteFile(outPath);
    if (userId !== ADMIN_ID && !premiumUsers.has(userId)) dailyLimit[userId]++;
    return;
  }

  // === RESOLUSI VIDEO ===
  if (cb.data.startsWith("res_video_")) {
    const res = cb.data.replace("res_video_", "");
    let resCmd = `-S "res:${res}" -f "bv*[height=${res}]+ba/b[height=${res}]/bv+ba/b" --merge-output-format mp4`;
    const outPath = getOutPath(`${realTitle}_${res}.mp4`);
    const ytdlpCmd = `yt-dlp ${resCmd} -o "${outPath}" "${url}"`;
    try {
      await new Promise((resolve, reject) => { exec(ytdlpCmd, { timeout: 10 * 60_000 }, (e, stdout, stderr) => e ? reject(stderr || e.message) : resolve()); });
    } catch (e) {
      return bot.sendMessage(chatId, `❌ Gagal download video (proses yt-dlp):\n${e}`);
    }
    let filesize = getFileSizeMB(outPath);
    if (filesize === 0 || !fs.existsSync(outPath)) return bot.sendMessage(chatId, "❌ Gagal download video (file tidak ditemukan).");
    if (filesize <= MAX_FILE_MB) {
      try {
        await bot.sendVideo(chatId, outPath, { caption: realTitle });
      } catch (e) {
        return bot.sendMessage(chatId, "❌ Gagal upload video ke Telegram.");
      }
    } else {
      const fileUrl = `http://${PUBLIC_HOST}:${PORT}/stream/${encodeURIComponent(path.basename(outPath))}`;
      await bot.sendMessage(chatId, `File video terlalu besar (>49MB). Download manual di browser:\n${fileUrl}` + getPlatformDownloadInfo());
    }
    const d = await bot.sendMessage(chatId, "Jangan lupa donasi ya boss kuh..", { reply_markup: { inline_keyboard: DONASI_INLINE } });
    safeDelete(bot, chatId, d.message_id, 40000);
    scheduleDeleteFile(outPath);
    if (userId !== ADMIN_ID && !premiumUsers.has(userId)) dailyLimit[userId]++;
    return;
  }
});

// ==== HANDLE LINK ====
bot.on("message", async (msg) => {
  if (!msg.text || msg.text.startsWith("/")) return;
  adminActivityLog(msg, "Kirim link/download (pesan teks)");
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const urlPattern = /(https?:\/\/[^\s]+)/g;
  const urls = msg.text.match(urlPattern);
  if (!urls) return;

  if (userId !== ADMIN_ID && !premiumUsers.has(userId)) {
    if (!dailyLimit[userId]) dailyLimit[userId] = 0;
    if (dailyLimit[userId] >= MAX_LIMIT)
      return bot.sendMessage(chatId, `❗️ Limit download harian anda habis (${MAX_LIMIT}/hari).\nDonasi: ${DONASI_LINK}`);
  }
  userStates[userId] = {};

  // Ambil info yt-dlp dulu
  let formats = [], realTitle = "downloaded", isDirectMp4 = false, directExt = "";
  try {
    const info = await new Promise((resolve, reject) => {
      exec(`yt-dlp --print-json "${urls[0]}"`, { timeout: 60000 }, (err, stdout, stderr) => {
        if (err || !stdout) {
          // Jika error unsupported, cek apakah direct file (mp4/mp3/etc)
          if (/\.(mp4|mkv|webm|mp3|m4a|aac|wav|flac)$/i.test(urls[0])) {
            isDirectMp4 = true;
            directExt = urls[0].split('.').pop().split('?')[0];
            return resolve(null);
          }
          return reject(stderr || err?.message || "yt-dlp error tidak diketahui");
        }
        try { resolve(JSON.parse(stdout)); }
        catch (e) {
          reject("Gagal parsing info dari yt-dlp. Output:\n" + stdout + "\nError: " + e.message);
        }
      });
    });
    if (info && info.title) realTitle = sanitizeFilename(info.title);
    if (info && info.formats) formats = info.formats;
  } catch (err) {
    return bot.sendMessage(chatId, `❌ Gagal ambil info video/audio.\n${err}\n\nCek koneksi internet dan pastikan yt-dlp up-to-date. Jika tetap gagal cek error di atas.`);
  }

  userStates[userId].lastUrl = urls[0];
  userStates[userId].realTitle = realTitle;
  userStates[userId].formats = formats;
  userStates[userId].isDirectMp4 = isDirectMp4;
  userStates[userId].directExt = directExt;

  await bot.sendMessage(chatId, 
    "Pilih menu atau mode download:", 
    { reply_markup: { inline_keyboard: [...MENU_INLINE, ...DONASI_INLINE] } }
  );
});
