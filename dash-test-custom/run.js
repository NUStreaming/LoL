const fs = require("fs");
const puppeteer = require("puppeteer-core");
const patterns = require("./network-patterns.js");
const stats = require("./stats");
const CHROME_PATH =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const PROFILE = process.env.PROFILE;

run()
  .then((result) => {
    if (result) {
      console.log("Test finished. Press cmd+c to exit.");
      if (!fs.existsSync('./results')){
        fs.mkdirSync('./results');
      }

      let timestamp = Math.floor(Date.now() / 1000);
      let folder = './results/' + timestamp;
      if (!fs.existsSync(folder)){
        fs.mkdirSync(folder);
      }

      let filenameNetworkPattern = folder + '/network-pattern.json';
      let filenameByDownload = folder + '/metrics-by-download.json';
      let filenameOverall = folder + '/metrics-overall.json';
    
      fs.writeFileSync(filenameNetworkPattern, JSON.stringify(result.networkPattern));
      fs.writeFileSync(filenameByDownload, JSON.stringify(result.byDownload));
      fs.writeFileSync(filenameOverall, JSON.stringify(result.overall));

      console.log('Results files generated:');
      console.log('> ' + filenameByDownload);
      console.log('> ' + filenameOverall);
    }
  })
  .catch(error => console.log(error));

async function run() {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: CHROME_PATH,
    defaultViewport: null,
    devtools: true,
  });

  const page = await browser.newPage();
  await page.goto("http://localhost:3000/samples/low-latency-custom/index.html");
  const cdpClient = await page.target().createCDPSession();

  console.log("Waiting for player to setup.");
  await page.evaluate(() => {
    return new Promise(resolve => {
      const hasLoaded = player.getBitrateInfoListFor("video").length !== 0;
      if (hasLoaded) {
        console.log('Stream loaded, setup complete.');
        resolve();
      } else {
        console.log('Waiting for stream to load.');
        player.on(dashjs.MediaPlayer.events.STREAM_INITIALIZED, (e) => {
          console.log('Load complete.')
          resolve();
      });
      }
    });
  });

  console.log("Waiting for 10 seconds of uninterrupted max-quality playback before starting.");
  const stabilized = await awaitStabilization(page);
  if (!stabilized) {
    console.error(
      "Timed out after 30 seconds. The player must be stable at the max rendition before emulation begins. Make sure you're on a stable connection of at least 3mbps, and try again."
    );
    return;
  }
  console.log("Player is stable at the max quality, beginning network emulation");
  page.evaluate(() => {
    window.startRecording();
  });

  const networkPattern = patterns[PROFILE] || patterns.PROFILE_NORMAL;
  console.log(networkPattern);
  await runNetworkPattern(cdpClient, networkPattern);

  const metrics = await page.evaluate(() => {
    if (window.stopRecording) {
      // Guard against closing the browser window early
      window.stopRecording();
    }
    player.pause();
    return window.abrHistory;
  });
  console.log("Run complete");
  if (!metrics) {
    console.log("No metrics were returned. Stats will not be logged.");
  }

  ////////////////////////////////////
  // original results returned
  ////////////////////////////////////
  // console.log(metrics);

  // for (let i = 0; i < metrics.switchHistory.length; i++) {
  //   console.log('switchHistory: bitrate = ' + metrics.switchHistory[i].quality.bitrate + ', qualityIndex = ' + metrics.switchHistory[i].quality.qualityIndex);
  // }

  // ({ switchHistory, ...result } = metrics);
  // result.averageBitrate = stats.computeAverageBitrate(switchHistory);
  // result.numSwitches = switchHistory.length;

  // console.log(result);

  ////////////////////////////////////
  // may.lim: custom results returned
  ////////////////////////////////////
  console.log(metrics);
  console.log('Processing client metrics to results files..');

  // metrics-by-download.json
  let resultByDownload = metrics.byDownload;
  for (var key in resultByDownload) {
    // check if the property/key is defined in the object itself, not in parent
    if (resultByDownload.hasOwnProperty(key)) { 
        resultByDownload[key].averageBitrate = stats.computeAverageBitrate(resultByDownload[key].switchHistory, resultByDownload[key].downloadTimeRelative);
        resultByDownload[key].numSwitches = resultByDownload[key].switchHistory.length;
    }
  }

  // metrics-overall.json
  let resultOverall = metrics.overall;
  resultOverall.averageBitrate = stats.computeAverageBitrate(resultOverall.switchHistory);
  resultOverall.numSwitches = resultOverall.switchHistory.length;
  delete resultOverall.currentLatency;
  delete resultOverall.currentBufferLength;

  let result = {
    byDownload: resultByDownload,
    overall: resultOverall,
    networkPattern: networkPattern
  };

  return result;
}

async function awaitStabilization (page) {
  return await page.evaluate(() => {
    console.log('Awaiting stabilization...')
    return new Promise(resolve => {
      const maxQuality = player.getBitrateInfoListFor("video").length - 1;
      let timer = -1;

      const failTimer = setTimeout(() => {
        resolve(false);
      }, 30000)

      if (player.getQualityFor("video") === maxQuality) {
        console.log('Starting stabilization timer...')
        timer = setTimeout(() => {
          clearTimeout(failTimer);
          resolve(true);
        }, 10000);
      }

      player.on(dashjs.MediaPlayer.events.QUALITY_CHANGE_RENDERED, e => {
        console.warn("Quality changed requested", e);
        if (e.newQuality !== maxQuality) {
          console.log('Clearing stabilization timer...', e.newQuality, maxQuality)
          clearTimeout(timer);
          timer = -1;
        } else if (timer === -1) {
          console.log('Starting stabilization timer...')
          timer = setTimeout(() => {
            clearTimeout(failTimer);
            resolve(true);
          }, 10000);
        }
      });
    });
  });
}

async function runNetworkPattern(client, pattern) {
  for await (const profile of pattern) {
    console.log(
      `Setting network speed to ${profile.speed}kbps for ${profile.duration} seconds`
    );
    setNetworkSpeedInMbps(client, profile.speed);
    await new Promise(resolve => setTimeout(resolve, profile.duration * 1000));
  }
}

function setNetworkSpeedInMbps(client, mbps) {
  client.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 0,
    uploadThroughput: (mbps * 1024) / 8,
    downloadThroughput: (mbps * 1024) / 8
  });
}