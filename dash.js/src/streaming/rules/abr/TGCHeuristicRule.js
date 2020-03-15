import FactoryMaker from '../../../core/FactoryMaker';
import Debug from '../../../core/Debug';
import SwitchRequest from '../SwitchRequest';
import Constants from '../../constants/Constants';
import MetricsConstants from '../../constants/MetricsConstants';
import BufferLevel from '../../vo/metrics/BufferLevel';

function TGCHeuristicRule(config) {

    config = config || {};
    const context = this.context;
    const dashMetrics = config.dashMetrics;

    let instance,
        logger;

    function setup() {
        logger = Debug(context).getInstance().getLogger(instance);
    }

    function checkConfig() {
        if (!dashMetrics || !dashMetrics.hasOwnProperty('getLatestBufferInfoVO')) {
            throw new Error(Constants.MISSING_CONFIG_ERROR);
        }
    }

    let currentQuality = -1;

    // const CMA = () => {
    //     let average = 0;
    //     let count = 0;

    //     return {
    //         average(val) {
    //             if (isNaN(val)) {
    //                 return 0;
    //             }
    //             average = average + ((val - average) / ++count);
    //             return average;
    //         },
    //         tryAverage(val) {
    //             if (isNaN(val)) {
    //                 return 0;
    //             }
    //             return (average + ((val - average) / (count + 1)));
    //         }
    //     }
    // }

    /* 
     * A cumulative moving average object
     * Usage: averageLatency = latencyCMA.average(currentLatency);
     * Ideal to update every 200ms for more accurate average esp for buffer and latency
     */
    // const bitrateCMA = CMA();           // averageBitrate
    // const bitrateVariationsCMA = CMA(); // averageBitrateVariations
    // const bufferCMA = CMA();            // averageBufferLength
    // const latencyCMA = CMA();           // averageLatency

    // triggered at segment boundary
    function getMaxIndex(rulesContext) {
        let switchRequest = SwitchRequest(context).create();

        if (!rulesContext || !rulesContext.hasOwnProperty('getMediaInfo') || !rulesContext.hasOwnProperty('getMediaType') || !rulesContext.hasOwnProperty('useBufferOccupancyABR') ||
            !rulesContext.hasOwnProperty('getAbrController') || !rulesContext.hasOwnProperty('getScheduleController')) {
            return switchRequest;
        }

        checkConfig();

        const mediaInfo = rulesContext.getMediaInfo();
        const mediaType = rulesContext.getMediaType();
        const bufferStateVO = dashMetrics.getLatestBufferInfoVO(mediaType, true, MetricsConstants.BUFFER_STATE);
        const scheduleController = rulesContext.getScheduleController();
        const abrController = rulesContext.getAbrController();
        const streamInfo = rulesContext.getStreamInfo();
        const isDynamic = streamInfo && streamInfo.manifestInfo ? streamInfo.manifestInfo.isDynamic : null;
        const throughputHistory = abrController.getThroughputHistory();
        const bitrateList = mediaInfo.bitrateList;  // [{bandwidth: 200000, width: 640, height: 360}, ...]
        const currentBufferLevel = dashMetrics.getCurrentBufferLevel(mediaType, true);
        
        /*
         * decide which throughput value to use
         */
        // const throughput = throughputHistory.getAverageThroughput(mediaType, isDynamic);
        const throughput = throughputHistory.getSafeAverageThroughput(mediaType, isDynamic);
        console.log('[TGCHeuristicRule] throughput: ' + Math.round(throughput) + 'kbps');
        
        // todo - verify this latency value vs. parseFloat(player.getCurrentLiveLatency(), 10);
        const latency = throughputHistory.getAverageLatency(mediaType);

        // todo - verify if I need this part
        const useBufferOccupancyABR = rulesContext.useBufferOccupancyABR();

        // todo - why is useBufferOccupancyABR triggered midway while the abrStrategy is unchanged?
        // todo - check if I need this useBufferOccupancyABR part
        // if (isNaN(throughput) || !bufferStateVO || useBufferOccupancyABR) {
        if (isNaN(throughput) || !bufferStateVO) {
            return switchRequest;
        }

        if (abrController.getAbandonmentStateFor(mediaType) === MetricsConstants.ABANDON_LOAD) {
            return switchRequest;
        }

        scheduleController.setTimeToLoadDelay(0);

        // todo - check if I need this part
        // if (bufferStateVO.state === MetricsConstants.BUFFER_LOADED || isDynamic) { ... }

        /* ************************
         *    Main abr logic
         * ************************
         * attempting to do enumeration online since we don't consider future chunks (as in Pensive's FastMPC implementation)
         * Pensieve only does the segment enumeration offline ("itertools.product([0,1,2,3,4,5], repeat=5)")
         *   - i.e. 0,0,0,0,0 / 0,0,0,0,1 /...
         * hence since Pensive is also doing the bitrate-reward calculation dynamically, lets try to do this online here too
         */
        
        let segmentDuration = 0.5;      // todo - retrieve from dash
        let futureSegmentCount = 5;     // lookahead window
        let maxReward = -100000000;
        let bestOption = [];

        // iterate all possible combinations of bitrates
        // (numBitrates^futureSegmentCount e.g. 3^5 = 243 options)
        let qualityList = [];
        bitrateList.forEach(function (bitrateInfo, index) { qualityList.push(index); });
        let options = getPermutations(qualityList, futureSegmentCount);
        // console.log(options.length); // e.g. 243

        // for each option, compute reward and identify option with maxReward
        options.forEach(function (segments, optionIndex) {
            let totalBitrate = 0;
            let totalBitrateVariations = 0;
            let totalRebufferTime = 0;
            // let totalLatency = 0;
            let tmpBuffer = currentBufferLevel;
            let prevQuality = currentQuality;

            // for each segment quality in lookahead window (size: futureSegmentCount)
            segments.forEach(function (quality, segmentIndex) {
                let bitrate = bitrateList[quality].bandwidth;

                // update reward factor - totalBitrate
                totalBitrate += bitrate;

                // update reward factor - totalBitrateVariations
                if (prevQuality !== -1) {
                    let prevBitrate = bitrateList[prevQuality].bandwidth;
                    totalBitrateVariations += Math.abs(bitrate - prevBitrate);
                }
                
                /*
                 * previously attempted to use average values here
                 * but not necessary since we are comparing qoe within single stream session
                 * hence these metrics will not be affected by test run duration
                 * hence "total" values will give same reward trajectory as "average" values
                 */
                // let tryAverageBitrate = bitrateCMA.tryAverage(tryBitrate);
                // let tryAverageBitrateVariations = bitrateVariationsCMA.tryAverage(Math.abs(tryBitrate - currentBitrate));

                // estimate bandwidth based on throughput and segmentIndex
                // naive one for now - assume throughput constant
                // todo - use harmonic mean or something
                let bandwidth = throughput;                             // units: kbps
                let segmentSize = segmentDuration * bitrate / 1000.0;   // units: bps * s -> bits, divide by 1000 -> kbits
                let downloadTime = segmentSize / bandwidth;             // units: kbits / kbps -> s
                
                // update reward factor - totalRebufferTime
                if (downloadTime > tmpBuffer) { // rebuffer
                    totalRebufferTime += (downloadTime - tmpBuffer);
                    tmpBuffer = 0;
                } else {
                    tmpBuffer -= downloadTime;
                    tmpBuffer += segmentDuration;
                }

                // update reward factor - totalLatency?
                // todo

                prevQuality = quality;
            })

            // calculate potential reward
            // note qoe units - 
            //   bitrate, bitrateVariations : kbps
            //   rebufferTime, latency      : s
            let wtBitrate = 1, wtBitrateVariations = 1, wtRebufferTime = 3000;
            let reward = totalBitrate * wtBitrate - totalBitrateVariations * wtBitrateVariations - totalRebufferTime * wtRebufferTime;
            
            if (reward > maxReward) {
                maxReward = reward;
                bestOption = options[optionIndex];
            }
        });

        let nextQuality;
        if (bestOption.length < 1) { 
            // if no bestOption was found, use quality best matched to throughput
            nextQuality = abrController.getQualityForBitrate(mediaInfo, throughput, latency);
        } else {
            nextQuality = bestOption[0];
        }

        // prevBitrate = currentBitrate;
        // currentBitrate = bitrateList[nextQuality].bandwidth;
        currentQuality = nextQuality;
        switchRequest.quality = nextQuality;
        switchRequest.reason = { throughput: throughput, latency: latency};

        // logger.debug('[' + mediaType + '] requesting switch to index: ', switchRequest.quality, 'Average throughput', Math.round(throughput), 'kbps');
        console.log('[' + mediaType + '] requesting switch to index: ', switchRequest.quality, 'Average throughput', Math.round(throughput), 'kbps');

        return switchRequest;

        // Ask to switch to the lowest bitrate - for debugging
        // switchRequest = SwitchRequest(context).create();
        // switchRequest.quality = 0;
        // switchRequest.reason = 'Always switching to the lowest bitrate';
        // switchRequest.priority = SwitchRequest.PRIORITY.STRONG;
        // return switchRequest;
    }
        
    function getPermutations(list, length) {
        // Copy initial values as arrays
        var perm = list.map(function(val) {
            return [val];
        });
        // Our permutation generator
        var generate = function(perm, length, currLen) {
            // Reached desired length
            if (currLen === length) {
                return perm;
            }
            // For each existing permutation
            for (var i = 0, len = perm.length; i < len; i++) {
                var currPerm = perm.shift();
                // Create new permutation
                for (var k = 0; k < list.length; k++) {
                    perm.push(currPerm.concat(list[k]));
                }
            }
            // Recurse
            return generate(perm, length, currLen + 1);
        };
        // Start with size 1 because of initial values
        return generate(perm, length, 1);
    };

    // function calculateReward(totalBitrate, totalBitrateVariations, totalRebufferTime) {
    //     // note that the data structure used here is overkill
    //     // so as to conincide with dash-test-custom/run.js first
    //     // for ease of copying in case of weight changes
    //     // todo - refractor code in future
    //     let evaluate = {};

    //     // QoE score breakdown, initialize weights to 0 first
    //     evaluate.resultsQoe = {
    //         averageBitrate:           { weight: 0, value: (averageBitrate / 1000),           subtotal: 0},  // raw units: bps, QoE units: kbps
    //         averageBitrateVariations: { weight: 0, value: (averageBitrateVariations / 1000), subtotal: 0},  // raw units: bps, QoE units: kbps
    //         totalRebufferTimePerMin:  { weight: 0, value: (stallDurationMs / 1000),          subtotal: 0},  // raw units: ms, QoE units: s 
    //         averageLatency:           { weight: 0, value: averageLatency,                    subtotal: 0}   // raw units: s, QoE units: s
    //     };

    //     // select desired weights - BALANCED
    //     evaluate.resultsQoe.averageBitrate.weight = 1;
    //     evaluate.resultsQoe.averageBitrateVariations.weight = 1;
    //     evaluate.resultsQoe.totalRebufferTimePerMin.weight = 3000;
    //     evaluate.resultsQoe.averageLatency.weight = 3000;

    //     // calculate total QoE score
    //     let total = 0;
    //     for (var key in evaluate.resultsQoe) {
    //         if (evaluate.resultsQoe.hasOwnProperty(key)) { 
    //             // calculate subtotal for each component first
    //             evaluate.resultsQoe[key].subtotal = evaluate.resultsQoe[key].weight * evaluate.resultsQoe[key].value;

    //             if (key === 'averageBitrate') total += evaluate.resultsQoe[key].subtotal;
    //             else  total -= evaluate.resultsQoe[key].subtotal;
    //         }
    //     }

    //     // evaluate.resultsQoe.total = total;
    //     return total;
    // }

    function reset() {
        // no persistent information to reset
    }

    instance = {
        getMaxIndex: getMaxIndex,
        reset: reset
    };

    setup();

    return instance;
}

TGCHeuristicRule.__dashjs_factory_name = 'TGCHeuristicRule';
export default FactoryMaker.getClassFactory(TGCHeuristicRule);