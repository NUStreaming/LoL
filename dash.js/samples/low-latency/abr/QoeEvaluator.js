// Use singleton design (hence function) rather than class declaration
// To fit dash.js general design
function QoeEvaluator() {
    let instance,
        voPerSegmentQoeInfo,
        voPerChunkQoeInfo;

    function setup() {
        reset();

        let segmentDuration = 0.5;      // todo - obtain from dash
        let chunkDuration = 0.03333333; // todo
        let maxBitrateKbps = 1000;          // todo
        let minBitrateKbps = 200;           // todo

        // Set up Per Segment QoeInfo
        voPerSegmentQoeInfo = createQoeInfo('segment', segmentDuration, maxBitrateKbps, minBitrateKbps);

        // Set up Per Chunk QoeInfo
        voPerChunkQoeInfo = createQoeInfo('chunk', chunkDuration, maxBitrateKbps, minBitrateKbps);
    }

    function reset() {
        voPerSegmentQoeInfo = {};
        voPerChunkQoeInfo = {};
    }

    function createQoeInfo(itemType, itemDuration, maxBitrateKbps, minBitrateKbps) {
        /*
         * [Weights][Source: Abdelhak Bentaleb, 2020]
         * bitrateReward:           chunk or segment duration, e.g. 0.5s
         * bitrateSwitchPenalty:    0.02s or 1s if the bitrate switch is too important
         * rebufferPenalty:         max encoding bitrate, e.g. 1000kbps
         * latencyPenalty:          if L ≤ 1.1 seconds then = 0.005, otherwise = 0.01
         * playbackSpeedPenalty:    min encoding bitrate, e.g. 200kbps
         */

        // Create new QoeInfo object
        let qoeInfo = new QoeInfo();
        qoeInfo.type = itemType;

        // Set weight: bitrateReward
        if (!itemDuration) qoeInfo.weights.bitrateReward = 1;      // set some safe value, else consider throwing error
        else qoeInfo.weights.bitrateReward = itemDuration;

        // Set weight: bitrateSwitchPenalty
        // qoeInfo.weights.bitrateSwitchPenalty = 0.02;
        qoeInfo.weights.bitrateSwitchPenalty = 1;

        // Set weight: rebufferPenalty
        if (!maxBitrateKbps) qoeInfo.weights.rebufferPenalty = 1000;   // set some safe value, else consider throwing error
        else qoeInfo.weights.rebufferPenalty = maxBitrateKbps;

        // Set weight: latencyPenalty
        qoeInfo.weights.latencyPenalty = [];
        qoeInfo.weights.latencyPenalty.push({ threshold: 1.1, penalty: 0.005 });
        qoeInfo.weights.latencyPenalty.push({ threshold: 100000000, penalty: 0.01 });

        // Set weight: playbackSpeedPenalty
        if (!minBitrateKbps) qoeInfo.weights.playbackSpeedPenalty = 200;   // set some safe value, else consider throwing error
        else qoeInfo.weights.playbackSpeedPenalty = minBitrateKbps;

        return qoeInfo;
    }

    function logSegmentMetrics(segmentBitrate, segmentRebufferTime, currentLatency, currentPlaybackSpeed) {
        updateMetricsForQoeInfo(segmentBitrate, segmentRebufferTime, currentLatency, currentPlaybackSpeed, voPerSegmentQoeInfo);
    }

    function logChunkMetrics(chunkBitrate, chunkRebufferTime, currentLatency, currentPlaybackSpeed) {
        updateMetricsForQoeInfo(chunkBitrate, chunkRebufferTime, currentLatency, currentPlaybackSpeed, voPerChunkQoeInfo);
    }

    function updateMetricsForQoeInfo(bitrate, rebufferTime, latency, playbackSpeed, qoeInfo) {
        // console.log('[QoeEvaluator] updateMetricsForQoeInfo - bitrate: ' + bitrate + ', rebufferTime: ' + rebufferTime + ', latency: ' + latency + ', playbackSpeed: ' + playbackSpeed + ', qoeInfo: ');
        // console.log(qoeInfo);

        // Update: bitrate Weighted Cumulative value
        qoeInfo.bitrateWC += (qoeInfo.weights.bitrateReward * bitrate);

        // Update: bitrateSwitch Weighted Cumulative value
        if (qoeInfo.lastBitrate) {
            qoeInfo.bitrateSwitchWC += (qoeInfo.weights.bitrateSwitchPenalty * Math.abs(bitrate - qoeInfo.lastBitrate));
        }
        qoeInfo.lastBitrate = bitrate;

        // Update: rebuffer Weighted Cumulative value
        qoeInfo.rebufferWC += (qoeInfo.weights.rebufferPenalty * rebufferTime);

        // Update: latency Weighted Cumulative value
        for (let i = 0; i < qoeInfo.weights.latencyPenalty.length; i++) {
            let latencyRange = qoeInfo.weights.latencyPenalty[i];
            if (latency <= latencyRange.threshold) {
                qoeInfo.latencyWC += (latencyRange.penalty * latency);
                break;
            }
        }

        // Update: playbackSpeed Weighted Cumulative value
        qoeInfo.playbackSpeedWC += (qoeInfo.weights.playbackSpeedPenalty * playbackSpeed);

        // Update: Total Qoe value
        qoeInfo.totalQoe = qoeInfo.bitrateWC - qoeInfo.bitrateSwitchWC - qoeInfo.rebufferWC - qoeInfo.latencyWC - qoeInfo.playbackSpeedWC;
    }

    // Returns current Per Segment QoeInfo
    function getPerSegmentQoeInfo() {
        return voPerSegmentQoeInfo;
    }

    // Returns current Per Chunk QoeInfo
    function getPerChunkQoeInfo() {
        return voPerChunkQoeInfo;
    }

    instance = {
        logSegmentMetrics: logSegmentMetrics,
        logChunkMetrics: logChunkMetrics,
        getPerSegmentQoeInfo: getPerSegmentQoeInfo,
        getPerChunkQoeInfo: getPerChunkQoeInfo
    };

    setup();

    return instance;
}

class QoeInfo {

    constructor() {
        // Type 'segment' or 'chunk'
        this.type = null;

        // Store lastBitrate for calculation of bitrateSwitchWC
        this.lastBitrate = null;

        // Weights for each Qoe factor
        this.weights = {};
        this.weights.bitrateReward = null;
        this.weights.bitrateSwitchPenalty = null;
        this.weights.rebufferPenalty = null;
        this.weights.latencyPenalty = null;
        this.weights.playbackSpeedPenalty = null;

        // Weighted Cumulative for each Qoe factor
        this.bitrateWC = 0;           // kbps
        this.bitrateSwitchWC = 0;     // kbps
        this.rebufferWC = 0;          // seconds
        this.latencyWC = 0;           // seconds
        this.playbackSpeedWC = 0;     // e.g. 0.95, 1.0, 1.05

        // Store total Qoe value based on current WC values
        this.totalQoe = 0;
    }

}