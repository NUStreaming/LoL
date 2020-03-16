var TgcHeuristicRule;

function TgcHeuristicRuleClass() {

    let factory = dashjs.FactoryMaker;
    let SwitchRequest = factory.getClassFactoryByName('SwitchRequest');
    let MetricsModel = factory.getSingletonFactoryByName('MetricsModel');
    let DashMetrics = factory.getSingletonFactoryByName('DashMetrics');
    let StreamController = factory.getSingletonFactoryByName('StreamController');
    let context = this.context;
    let instance;

    let metricsConstants = {
        ABANDON_LOAD: 'abandonload',
        BUFFER_STATE: 'BufferState'
    }

    let currentQuality = -1;

    // A cumulative moving average object
    const CMA = () => {
        let average = 0;
        let count = 0;

        return {
            average(val) {
                if (isNaN(val)) {
                    return 0;
                }
                average = average + ((val - average) / ++count);
                return average;
            },
            getAverage() {
                return average;
            }
        }
    }

    function setup() {
    }

    function getMaxIndex(rulesContext) {
        let switchRequest = SwitchRequest(context).create();

        let metricsModel = MetricsModel(context).getInstance();
        let dashMetrics = DashMetrics(context).getInstance();
        let mediaType = rulesContext.getMediaInfo().type;
        let metrics = metricsModel.getMetricsFor(mediaType, true);

        // Get current bitrate
        let streamController = StreamController(context).getInstance();
        let abrController = rulesContext.getAbrController();
        let current = abrController.getQualityFor(mediaType, streamController.getActiveStreamInfo());

        // Additional stuff
        const mediaInfo = rulesContext.getMediaInfo();
        const bitrateList = mediaInfo.bitrateList;  // [{bandwidth: 200000, width: 640, height: 360}, ...]
        const bufferStateVO = dashMetrics.getLatestBufferInfoVO(mediaType, true, metricsConstants.BUFFER_STATE);
        const scheduleController = rulesContext.getScheduleController();
        const currentBufferLevel = dashMetrics.getCurrentBufferLevel(mediaType, true);
        const streamInfo = rulesContext.getStreamInfo();
        const isDynamic = streamInfo && streamInfo.manifestInfo ? streamInfo.manifestInfo.isDynamic : null;
        const throughputHistory = abrController.getThroughputHistory();
        // todo - verify this latency value vs. parseFloat(player.getCurrentLiveLatency(), 10);
        const latency = throughputHistory.getAverageLatency(mediaType);
        
        /*
         * decide which throughput value to use
         */
        // const throughput = throughputHistory.getAverageThroughput(mediaType, isDynamic);
        const throughput = throughputHistory.getSafeAverageThroughput(mediaType, isDynamic);
        console.log('[TgcHeuristicRule] throughput: ' + Math.round(throughput) + 'kbps');

        if (isNaN(throughput)) {
            return switchRequest;
        }

        if (abrController.getAbandonmentStateFor(mediaType) === metricsConstants.ABANDON_LOAD) {
            return switchRequest;
        }

        /* ************************
         *    Main abr logic
         * ************************ */
        
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
            // let totalBitrate = 0;
            // let totalBitrateVariations = 0;
            let totalRebufferTime = 0;
            // let totalLatency = 0;
            let tmpBuffer = currentBufferLevel;
            let prevQuality = currentQuality;

            let averageBitrateCMA = CMA();
            let averageBitrateVariationsCMA = CMA();

            // for each segment quality in lookahead window (size: futureSegmentCount)
            segments.forEach(function (quality, segmentIndex) {
                let bitrate = bitrateList[quality].bandwidth;

                // update reward factor - totalBitrate
                // totalBitrate += bitrate;
                averageBitrateCMA.average(bitrate / 1000); 

                // update reward factor - totalBitrateVariations
                if (prevQuality !== -1) {
                    let prevBitrate = bitrateList[prevQuality].bandwidth;
                    // totalBitrateVariations += Math.abs(bitrate - prevBitrate);
                    let bitrateVariation = Math.abs(bitrate - prevBitrate);
                    averageBitrateVariationsCMA.average(bitrateVariation / 1000); 
                }

                // estimate bandwidth based on throughput and segmentIndex
                // naive one for now - assume throughput constant
                // todo - use harmonic mean or something
                let bandwidth = throughput;                             // units: kbps
                let segmentSize = segmentDuration * bitrate / 1000.0;   // units: bps * s -> bits, divide by 1000 -> kbits
                let downloadTime = segmentSize / bandwidth;             // units: kbits / kbps -> s
                
                // console.log('----------------------------------------------------');
                // console.log('throughput: ' + throughput + ', segmentSize: ' + segmentSize + ', downloadTime: ' + downloadTime + ', tmpBuffer (bef): ' + tmpBuffer);

                // update reward factor - totalRebufferTime
                if (downloadTime > tmpBuffer) { // rebuffer
                    totalRebufferTime += (downloadTime - tmpBuffer);
                    tmpBuffer = 0;
                } else {
                    tmpBuffer -= downloadTime;
                    tmpBuffer += segmentDuration;
                }

                // console.log('totalRebufferTime: ' + totalRebufferTime + ', tmpBuffer (aft): ' + tmpBuffer)

                // update reward factor - totalLatency?
                // todo

                prevQuality = quality;
            })

            // calculate potential reward
            // note qoe units - 
            //   bitrate, bitrateVariations : kbps
            //   rebufferTime, latency      : s
            let wtBitrate = 1, wtBitrateVariations = 1, wtRebufferTime = 3000;
            // let reward = totalBitrate * wtBitrate - totalBitrateVariations * wtBitrateVariations - totalRebufferTime * wtRebufferTime;
            let reward = averageBitrateCMA.getAverage() * wtBitrate 
                - averageBitrateVariationsCMA.getAverage() * wtBitrateVariations 
                - totalRebufferTime * wtRebufferTime;

            // console.log('averageBitrate: ' + averageBitrateCMA.getAverage() + ', averageBrVariations: ' + averageBitrateVariationsCMA.getAverage() + ', totalRebuffer: ' + totalRebufferTime + ' (' + (totalRebufferTime * wtRebufferTime) + ')');
            // console.log('--- Option ' + optionIndex + ' -> segments: ' + segments + ', reward: ' + reward);
            
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

        currentQuality = nextQuality;

        // let switchRequest = SwitchRequest(context).create();
        switchRequest.quality = nextQuality;
        switchRequest.reason = { throughput: throughput, latency: latency};
        switchRequest.priority = SwitchRequest.PRIORITY.STRONG;

        // todo - check what is this for
        scheduleController.setTimeToLoadDelay(0);

        // logger.debug('[' + mediaType + '] requesting switch to index: ', switchRequest.quality, 'Average throughput', Math.round(throughput), 'kbps');
        console.log('[TgcHeuristicRule][' + mediaType + '] requesting switch to index: ', switchRequest.quality, 'Average throughput', Math.round(throughput), 'kbps');

        return switchRequest;


        // For debugging
        // Ask to switch to the lowest bitrate
        // let switchRequest = SwitchRequest(context).create();
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

    instance = {
        getMaxIndex: getMaxIndex
    };

    setup();

    return instance;
}

TgcHeuristicRuleClass.__dashjs_factory_name = 'TgcHeuristicRule';
TgcHeuristicRule = dashjs.FactoryMaker.getClassFactory(TgcHeuristicRuleClass);