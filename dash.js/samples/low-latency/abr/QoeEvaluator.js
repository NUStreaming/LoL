class QoeEvaluator {

    constructor(segmentDuration, maxBitrate) {
        // Weights
        this.bitrateReward;          // chunk or segment duration, e.g. 0.5s
        this.bitrateSwitchPenalty;   // 0.02s
        this.rebufferPenalty;        // max encoding bitrate, e.g. 1000kbps
        this.latencyPenaltyRange;     // if L ≤ 1.1 seconds then = 0.005, otherwise = 0.01

        // update weights
        if (!segmentDuration) this.bitrateReward = 1;  // set some safe value, else consider throwing error
        else                  this.bitrateReward = segmentDuration;

        if (!maxBitrate) this.rebufferPenalty = 1000;   // set some safe value, else consider throwing error
        else             this.rebufferPenalty = maxBitrate;

        this.bitrateSwitchPenalty = 0.02;
        this.latencyPenaltyRange = [];
        this.latencyPenaltyRange.push({
            threshold: 1.1, penalty: 0.005,
            threshold: 100000000, penalty: 0.01
        });

        // Weighted Cumulative
        this.bitrateWC = 0;           // kbps
        this.bitrateSwitchWC = 0;     // kbps
        this.rebufferWC = 0;          // seconds
        this.latencyWC = 0;           // seconds

        this.lastBitrate = null;
    }

    logSegmentMetrics(segmentBitrate, segmentRebufferTime, currentLatency) {
        // console.log('logSegmentMetrics - segmentBitrate: ' + segmentBitrate + ', segmentRebufferTime: ' + segmentRebufferTime + ', currLatency: ' + currentLatency);
        this.bitrateWC += (this.bitrateReward * segmentBitrate);
        this.rebufferWC += (this.rebufferPenalty * segmentRebufferTime);

        // latency
        for (let i = 0; i < this.latencyPenaltyRange.length; i++) {
            let latencyRange = this.latencyPenaltyRange[i];
            if (currentLatency <= latencyRange.threshold) {
                this.latencyWC += (latencyRange.penalty * currentLatency);
                break;
            }
        }
        
        // bitrate switch
        if (this.lastBitrate) {
            // console.log('bitrateSwitch: ' + Math.abs(segmentBitrate - this.lastBitrate));
            this.bitrateSwitchWC += (this.bitrateSwitchPenalty * Math.abs(segmentBitrate - this.lastBitrate));
        }
        this.lastBitrate = segmentBitrate;
    }

    getQoeMetrics() {
        let qoeMetrics = { subtotal: {}, total: 0 };

        qoeMetrics.subtotal = {
            bitrate: this.bitrateWC,
            bitrateSwtich: this.bitrateSwitchWC,
            rebuffer: this.rebufferWC,
            latency: this.latencyWC
        }

        qoeMetrics.total = qoeMetrics.subtotal.bitrate - qoeMetrics.subtotal.bitrateSwtich - qoeMetrics.subtotal.rebuffer - qoeMetrics.subtotal.latency;

        return qoeMetrics;
    }
}