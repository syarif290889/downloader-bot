require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// ---- Helper untuk deteksi platform ----
function detectPlatform(url) {
  if (/tiktok\.com|douyin\.com/i.test(url)) return "TikTok/Douyin";
  if (/facebook\.com|fb\.watch/i.test(url)) return "Facebook";
  if (/instagram\.com/i.test(url)) return "Instagram";
  if (/youtube\.com|youtu\.be/i.test(url)) return "YouTube";
  return "Video";
}

function getYtDlpCommand() {
  const homeBin = path.join(process.env.HOME || process.env.USERPROFILE, 'bin', 'yt-dlp');
  if (fs.existsSync(homeBin)) return `"${homeBin}"`;
  try {
    const which = require('child_process').execSync('which yt-dlp').toString().trim();
    if (which && fs.existsSync(which)) return `"${which}"`;
  } catch (e) {}
  return 'python -m yt_dlp';
}

const YTDLP_CMD = getYtDlpCommand();
const token = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(token, { polling: true });

const SUPPORTED_URL = /(https?:\/\/[^\s]+)/i;

// ---- Menu Deskripsi Bot (Command /mulai atau /start) ----
const DESKRIPSI_BOT = `✨ <b>Downloader Bot</b> oleh <a href="https://t.me/syarif290889">syarif290889</a> ✨

Bot serba bisa untuk download video & audio:
• <b>Video</b>: <i>TikTok, YouTube, Facebook, Instagram, Douyin (TikTok China), dll!</i>
• <b>Audio MP3</b>: YouTube ke MP3 (HD)
• <b>Resolusi Video YouTube</b>: 720p, 480p, 360p, 240p, 144p

<b>Cara pakai:</b>
1. Kirim link video/audio yang ingin di-download.
2. Untuk YouTube, gunakan <code>/ytmp3 [link]</code> untuk audio, <code>/ytmp4 [resolusi] [link]</code> untuk video.
3. Untuk link lain, langsung kirim saja!

Contoh:
• <code>/ytmp3 https://youtube.com/watch?v=xxxx</code>
• <code>/ytmp4 720 https://youtube.com/watch?v=xxxx</code>
• <code>https://vt.tiktok.com/xxxx</code>
• <code>https://facebook.com/xxxx</code>

<b>Note:</b>
- Maksimal file 50MB untuk langsung dikirim ke Telegram.
- Semua platform didukung selama didukung oleh yt-dlp.
- Bot ini gratis & selalu update!

<code>Selamat mencoba! 🚀</code>
`;

console.log("🔥 Bot sedang berjalan...");

// ---- Handler /start & /mulai ----
bot.onText(/\/(start|mulai)/, (msg) => {
  bot.sendMessage(msg.chat.id, DESKRIPSI_BOT, { parse_mode: "HTML", disable_web_page_preview: true });
});

// ---- Handler /ytmp3 [link] ----
bot.onText(/\/ytmp3 (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const url = match[1].trim();
  const statusMsg = await bot.sendMessage(chatId, "Sedang mendownload audio MP3 dari YouTube, mohon tunggu...");

  const filename = `audio_${Date.now()}.mp3`;
  const filepath = path.resolve(__dirname, filename);

  exec(
    `${YTDLP_CMD} -x --audio-format mp3 -o "${filepath}" "${url}"`,
    { timeout: 5 * 60 * 1000 },
    async (error, stdout, stderr) => {
      if (error || !fs.existsSync(filepath)) {
        await bot.editMessageText(
          `Gagal download audio!\n\n${stderr || error.message || 'Tidak ada file.'}\nCek link atau coba beberapa menit lagi.`,
          { chat_id: chatId, message_id: statusMsg.message_id }
        );
        if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
        return;
      }
      try {
        await bot.sendAudio(chatId, filepath, {}, { filename });
        setTimeout(() => { bot.deleteMessage(chatId, statusMsg.message_id); }, 10000);
      } catch (e) {
        await bot.editMessageText("Gagal mengirim file audio.", { chat_id: chatId, message_id: statusMsg.message_id });
      } finally {
        fs.existsSync(filepath) && fs.unlinkSync(filepath);
      }
    }
  );
});

// ---- Handler /ytmp4 [resolusi] [link] ----
bot.onText(/\/ytmp4 (\d+) (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const res = match[1];
  const url = match[2].trim();

  // Peta kode format yt-dlp YouTube
  const formatMap = {
    "144": "18/160/278",
    "240": "133/242/395",
    "360": "18/134/243/396",
    "480": "135/244/397",
    "720": "22/136/247/398",
    "1440": "271/308/400"
  };

  const format = formatMap[res] || "18/22";
  const statusMsg = await bot.sendMessage(chatId, `Sedang mendownload video YouTube (${res}p), mohon tunggu...`);

  const filename = `video_${Date.now()}_${res}p.mp4`;
  const filepath = path.resolve(__dirname, filename);

  exec(
    `${YTDLP_CMD} -f "${format}" -o "${filepath}" "${url}"`,
    { timeout: 8 * 60 * 1000 },
    async (error, stdout, stderr) => {
      if (error || !fs.existsSync(filepath)) {
        await bot.editMessageText(
          `Gagal download video!\n\n${stderr || error.message || 'Tidak ada file.'}`,
          { chat_id: chatId, message_id: statusMsg.message_id }
        );
        if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
        return;
      }
      try {
        const stats = fs.statSync(filepath);
        if (stats.size > 49 * 1024 * 1024) {
          await bot.editMessageText("File terlalu besar (>50MB). Download manual di server.", { chat_id: chatId, message_id: statusMsg.message_id });
        } else {
          await bot.sendVideo(chatId, filepath, {}, { filename });
          setTimeout(() => { bot.deleteMessage(chatId, statusMsg.message_id); }, 10000);
        }
      } catch (e) {
        await bot.editMessageText("Gagal mengirim file video.", { chat_id: chatId, message_id: statusMsg.message_id });
      } finally {
        fs.existsSync(filepath) && fs.unlinkSync(filepath);
      }
    }
  );
});

// ---- Handler universal link video ----
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  if (!msg.text) return;
  if (msg.text.startsWith("/ytmp3") || msg.text.startsWith("/ytmp4") || msg.text.startsWith("/start") || msg.text.startsWith("/mulai")) return;

  const urlMatch = msg.text.match(SUPPORTED_URL);
  if (!urlMatch) return;

  const url = urlMatch[0];
  if (/facebook\.com\/share\//i.test(url)) {
    bot.sendMessage(chatId, "❗ Link Facebook yang kamu kirim adalah link share. Kirim link langsung ke video Facebook (misal: .../videos/...), bukan link share.");
    return;
  }
  const platform = detectPlatform(url);

  const statusMsg = await bot.sendMessage(chatId, `Sedang mendownload video dari ${platform}, mohon tunggu...`);

  const filename = `video_${Date.now()}.mp4`;
  const filepath = path.resolve(__dirname, filename);

  exec(
    `${YTDLP_CMD} -o "${filepath}" -f best "${url}"`,
    { timeout: 8 * 60 * 1000 },
    async (error, stdout, stderr) => {
      if (error || !fs.existsSync(filepath)) {
        await bot.editMessageText(
          `Gagal download!\n\n${stderr || error.message || 'Tidak ada file.'}\nCek link, pastikan video publik & didukung yt-dlp.`,
          { chat_id: chatId, message_id: statusMsg.message_id }
        );
        if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
        return;
      }
      try {
        const stats = fs.statSync(filepath);
        if (stats.size > 49 * 1024 * 1024) {
          await bot.editMessageText("File terlalu besar (>50MB). Download manual di server.", { chat_id: chatId, message_id: statusMsg.message_id });
        } else {
          await bot.sendVideo(chatId, filepath, {}, { filename });
          setTimeout(() => { bot.deleteMessage(chatId, statusMsg.message_id); }, 10000);
        }
      } catch (e) {
        await bot.editMessageText("Gagal mengirim file video.", { chat_id: chatId, message_id: statusMsg.message_id });
      } finally {
        fs.existsSync(filepath) && fs.unlinkSync(filepath);
      }
    }
  );
});