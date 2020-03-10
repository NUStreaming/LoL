const fs = require("fs");
const puppeteer = require("puppeteer-core");
const normalNetworkPatterns = require("./normal-network-patterns.js");
const fastNetworkPatterns = require("./fast-network-patterns.js");
const stats = require("./stats");
const CHROME_PATH =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let patterns;
if (process.env.npm_package_config_ffmpeg_profile === 'PROFILE_FAST') {
  patterns = fastNetworkPatterns;
} else {
  patterns = normalNetworkPatterns
}

const configNetworkProfile = process.env.npm_package_config_network_profile;
const NETWORK_PROFILE = patterns[configNetworkProfile] || patterns.PROFILE_CASCADE;
console.log("Network profile:", NETWORK_PROFILE);

// custom
const readline = require('readline').createInterface({ input: process.stdin, output: process.stdout });

run()
  .then((result) => {
    if (result) {
      if (!fs.existsSync('./results')){
        fs.mkdirSync('./results');
      }

      let timestamp = Math.floor(Date.now() / 1000);
      let folder = './results/' + timestamp;
      if (!fs.existsSync(folder)){
        fs.mkdirSync(folder);
      }

      let filenameByDownload = folder + '/metrics-by-download.json';
      let filenameOverall = folder + '/metrics-overall.json';
      let filenameEvaluate = folder + '/evaluate.json';
    
      fs.writeFileSync(filenameByDownload, JSON.stringify(result.byDownload));
      fs.writeFileSync(filenameOverall, JSON.stringify(result.overall));

      /////////////////////////////////////
      // evaluate.js
      /////////////////////////////////////
      /* testTime, networkPattern, abrStrategy, comments
       * + resultsQoe obj
       *  - averageBitrate
       *  - averageBitrateVariations / numSwitches (added both)
       *  - totalRebufferTime
       *  - startupDelay (not used for now as startup is invalid with stabilization feature in the testing)
       *  - averageLatency (not in standard QoE model but avail here first)
       */
      let evaluate = {};
      evaluate.testTime = new Date();
      evaluate.networkPattern = result.networkPattern;
      evaluate.abrStrategy = result.abrStrategy;

      ///////////////////////////////////////////////////////////////////////////////////
      // QoE model - see https://xia.cs.cmu.edu/resources/Documents/Yin_sigcomm15.pdf
      // Todo: 
      // -- include averageLatency?
      // -- rethink totalRebufferTime as it varies with test duration
      ///////////////////////////////////////////////////////////////////////////////////
      // QoE score breakdown, initialize weights to 0 first
      evaluate.resultsQoe = {
        averageBitrate:           { weight: 0, value: (result.overall.averageBitrate / 1000),           subtotal: 0},  // raw units: bps, QoE units: kbps
        averageBitrateVariations: { weight: 0, value: (result.overall.averageBitrateVariations / 1000), subtotal: 0},  // raw units: bps, QoE units: kbps
        numSwitches:              { weight: 0, value: result.overall.numSwitches,                       subtotal: 0},
        totalRebufferTime:        { weight: 0, value: (result.overall.stallDurationMs / 1000),          subtotal: 0},  // raw units: ms, QoE units: s 
        averageLatency:           { weight: 0, value: result.overall.averageLatency,                    subtotal: 0}   // raw units: s, QoE units: s
        // startupDelay:             { weight: 0, value: result.startupDelay,                              subtotal: 0}  // current units: s, QoE units: s
      };

      // select desired weights - BALANCED
      evaluate.resultsQoe.averageBitrate.weight = 1;
      evaluate.resultsQoe.averageBitrateVariations.weight = 1;
      evaluate.resultsQoe.totalRebufferTime.weight = 3000;
      // evaluate.resultsQoe.startupDelay.weight = 3000;

      // calculate total QoE score
      let total = 0;
      for (var key in evaluate.resultsQoe) {
        if (evaluate.resultsQoe.hasOwnProperty(key)) { 
          // calculate subtotal for each component first
          evaluate.resultsQoe[key].subtotal = evaluate.resultsQoe[key].weight * evaluate.resultsQoe[key].value;

          if (key === 'averageBitrate') total += evaluate.resultsQoe[key].subtotal;
          else  total -= evaluate.resultsQoe[key].subtotal;
        }
      }
      evaluate.resultsQoe.total = total;
      
      // finally, allow user to optionally input comments
      readline.question('Any comments for this test run: ', data => {
        evaluate.comments = data;
        readline.close();
        
        fs.writeFileSync(filenameEvaluate, JSON.stringify(evaluate));

        console.log('Results files generated:');
        console.log('> ' + filenameByDownload);
        console.log('> ' + filenameOverall);
        console.log('> ' + filenameEvaluate);
        console.log("Test finished. Press cmd+c to exit.");
      });
    }
    else {
      console.log('Unable to generate test results, likely some error occurred.. Please check program output above.')
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

  await runNetworkPattern(cdpClient, NETWORK_PROFILE);

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
  // console.log(metrics);
  console.log('Processing client metrics to results files..');

  // metrics-by-download.json
  let resultByDownload = metrics.byDownload;
  for (var key in resultByDownload) {
    if (resultByDownload.hasOwnProperty(key)) { 
        resultByDownload[key].averageBitrate = stats.computeAverageBitrate(resultByDownload[key].switchHistory, resultByDownload[key].downloadTimeRelative);
        resultByDownload[key].numSwitches = resultByDownload[key].switchHistory.length;
    }
  }

  // metrics-overall.json
  let resultOverall = metrics.overall;
  resultOverall.averageBitrate = stats.computeAverageBitrate(resultOverall.switchHistory);
  resultOverall.numSwitches = resultOverall.switchHistory.length;
  // calculate averageBitrateVariations
  if (resultOverall.switchHistory.length > 1) {
    let totalBitrateVariations = 0;
    for (var i = 0; i < resultOverall.switchHistory.length - 1; i++) {
      totalBitrateVariations += Math.abs(resultOverall.switchHistory[i+1].quality.bitrate - resultOverall.switchHistory[i].quality.bitrate);
    }
    resultOverall.averageBitrateVariations = totalBitrateVariations / (resultOverall.switchHistory.length - 1);
  } else {
    resultOverall.averageBitrateVariations = 0; 
  }
  // delete unwanted data
  delete resultOverall.currentLatency;
  delete resultOverall.currentBufferLength;

  let result = {
    byDownload: resultByDownload,
    overall: resultOverall,
    networkPattern: NETWORK_PROFILE,
    abrStrategy: metrics.abrStrategy
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