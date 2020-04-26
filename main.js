const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const sdk = require("microsoft-cognitiveservices-speech-sdk");
const Discord = require('discord.js');
const taunts = require('./taunts.json');

const bot = new Discord.Client();

const RECORDINGS_FOLDER = `${__dirname}/recordings`;

function waitForReady() {
  return new Promise(resolve => bot.on('ready', resolve));
}

function waitForStream(stream) {
  return new Promise(resolve => stream.on('close', resolve));
}

/**
 * @param {Discord.Message} message
 */
async function sayTaunt(message) {
  const id = Number(message.content);
  if (id && id > taunts.length) return;

  message.reply(taunts[id - 1]);

  // https://discordjs.guide/voice/the-basics.html
  if (message.member && message.member.voice && message.member.voice.channel) {
    const connection = await message.member.voice.channel.join();
    const dispatcher = connection.play(`audio/${id}.ogg`);
    dispatcher.on("finish", () => {
      message.member.voice.channel.leave();
    });
  }
}

/**
 * @param {Discord.Message} message
 * @param {string} outputFolder
 */
async function recordAudio(message, outputFolder) {
  // TODO: create a stream for every member in voice channel
  const outputPath = `${outputFolder}/audio.wav`;

  const connection = await message.member.voice.channel.join();
  message.reply('recording for ten seconds ...');
  setTimeout(() => {
    message.member.voice.channel.leave();
  }, 1000 * 10);

  connection.on('authenticated', console.log);
  connection.on('debug', console.log);
  connection.on('disconnect', console.log);
  connection.on('error', console.log);
  connection.on('failed', console.log);
  connection.on('newSession', console.log);
  connection.on('ready', console.log);
  connection.on('reconnecting', console.log);
  connection.on('warn', console.log);

  const audioStream = connection.receiver.createStream(message.member.user, { mode: 'pcm', end: 'manual' });
  const out = fs.createWriteStream(outputPath);
  ffmpeg(audioStream)
    .inputFormat('s32le')
    .audioFrequency(16000)
    .audioChannels(1)
    .audioCodec('pcm_s16le')
    .format('wav')
    .on('error', console.error.bind(console))
    .pipe(out);
  await waitForStream(out);

  const textCandidates = await speechToText(outputPath);
  fs.writeFileSync(`${outputFolder}/text.json`, JSON.stringify(textCandidates, null, 2));
}

async function speechToText(filename) {
  const subscriptionKey = process.env.BING_SPEECH_API_KEY;
  const serviceRegion = "eastus";

  // create the push stream we need for the speech sdk.
  const pushStream = sdk.AudioInputStream.createPushStream();

  // open the file and push it to the push stream.
  fs.createReadStream(filename).on('data', function (arrayBuffer) {
    pushStream.write(arrayBuffer.slice());
  }).on('end', function () {
    pushStream.close();
  });

  // now create the audio-config pointing to our stream and
  // the speech config specifying the language.
  const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);
  const speechConfig = sdk.SpeechConfig.fromSubscription(subscriptionKey, serviceRegion);
  const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

  // setting the recognition language to English.
  speechConfig.speechRecognitionLanguage = "en-US";

  /** @type {SpeechRecognitionResult} */
  const resp = await new Promise((resolve, reject) => recognizer.recognizeOnceAsync(resolve, reject))
    .finally(() => recognizer.close());

  // return [...resp];
  // The iterator doesn't actually work, so ...

  // const results = [];
  // for (let i = 0; i < resp.length; i++) {
  //   results.push(resp.item(i));
  // }
  // return results;
  // But there are no items, so ...

  return { text: resp.privText };
}

async function main() {
  bot.login(process.env.TOKEN);
  await waitForReady();
  console.log('ready');

  let isRecording = false;
  bot.on('message', message => {
    if (message.content.trim() === 'record') {
      // TODO: begin recording when a AOE game ends.
      if (isRecording) return;

      const date = new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '').replace(/:+/g, '-');
      const outputFolder = `${RECORDINGS_FOLDER}/${date}`;
      fs.mkdirSync(outputFolder, { recursive: true });
      isRecording = true;
      recordAudio(message, outputFolder)
        .finally(() => isRecording = false);
    } else if (Number(message.content)) {
      sayTaunt(message);
    }
  });
}

main();
